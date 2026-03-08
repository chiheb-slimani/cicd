const fs = require("fs");
const { execSync } = require("child_process");

function parseCreds(text) {
  const result = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = line.match(/^([^:=\s]+)\s*[:=]\s*(.+)$/);
    if (m) result[m[1].toLowerCase()] = m[2].trim();
  }
  return result;
}

function pick(creds, keys) {
  for (const key of keys) {
    if (creds[key]) return creds[key];
  }
  return "";
}

async function main() {
  const argBuild = process.argv[2] ? Number(process.argv[2]) : null;
  const tailLines = process.argv[3] ? Number(process.argv[3]) : 120;

  if (argBuild !== null && Number.isNaN(argBuild)) {
    throw new Error("First argument must be a numeric build number.");
  }

  const credsText = fs.readFileSync("jenkins.txt", "utf8");
  const creds = parseCreds(credsText);
  const user = pick(creds, ["username", "user", "login", "jenkins_user"]);
  const pass = pick(creds, [
    "password",
    "pass",
    "jenkins_password",
    "adminpass",
    "admin_password",
    "default_admin_pass",
  ]);
  if (!user || !pass) {
    throw new Error("Could not parse Jenkins credentials from jenkins.txt");
  }

  const ip = execSync("docker-machine ip default", { encoding: "utf8" }).trim();
  const base = `http://${ip}:8080`;
  const auth = Buffer.from(`${user}:${pass}`).toString("base64");

  async function jenkinsFetch(path) {
    return fetch(`${base}${path}`, {
      headers: { Authorization: `Basic ${auth}` },
    });
  }

  let buildNumber = argBuild;
  if (buildNumber === null) {
    const lastRes = await jenkinsFetch("/job/cicd-pipeline/lastBuild/api/json?tree=number");
    if (lastRes.status !== 200) {
      throw new Error(`Failed to get last build number (HTTP ${lastRes.status})`);
    }
    const last = await lastRes.json();
    buildNumber = last.number;
  }

  const metaRes = await jenkinsFetch(`/job/cicd-pipeline/${buildNumber}/api/json?tree=number,result,building,url`);
  if (metaRes.status !== 200) {
    throw new Error(`Failed to load build metadata for #${buildNumber} (HTTP ${metaRes.status})`);
  }
  const meta = await metaRes.json();

  const logRes = await jenkinsFetch(`/job/cicd-pipeline/${buildNumber}/consoleText`);
  if (logRes.status !== 200) {
    throw new Error(`Failed to load console log for #${buildNumber} (HTTP ${logRes.status})`);
  }
  const text = await logRes.text();
  const lines = text.split(/\r?\n/);
  const start = Math.max(lines.length - Math.max(tailLines, 1), 0);

  console.log(`JENKINS_URL=${base}`);
  console.log(`JOB_NAME=cicd-pipeline`);
  console.log(`BUILD_NUMBER=${meta.number}`);
  console.log(`BUILD_RESULT=${meta.result || "IN_PROGRESS"}`);
  console.log(`BUILD_BUILDING=${meta.building ? "YES" : "NO"}`);
  console.log(`BUILD_URL=${meta.url}`);
  console.log("----- CONSOLE TAIL -----");
  console.log(lines.slice(start).join("\n"));
}

main().catch((err) => {
  console.error(`CONSOLE_FETCH_FAILED: ${err.message}`);
  process.exit(1);
});
