const fs = require("fs");
const { execSync } = require("child_process");

function parseCreds(text) {
  const result = {};
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
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

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const creds = parseCreds(fs.readFileSync("jenkins.txt", "utf8"));
  const user = pick(creds, ["username", "user", "login", "jenkins_user"]);
  const pass = pick(creds, [
    "password",
    "pass",
    "jenkins_password",
    "adminpass",
    "admin_password",
    "default_admin_pass",
  ]);
  if (!user || !pass) throw new Error("Could not parse Jenkins credentials.");

  const ip = execSync("docker-machine ip default", { encoding: "utf8" }).trim();
  const base = `http://${ip}:8080`;
  const auth = Buffer.from(`${user}:${pass}`).toString("base64");

  async function jf(path, options = {}) {
    const headers = { Authorization: `Basic ${auth}`, ...(options.headers || {}) };
    return fetch(`${base}${path}`, { ...options, headers, redirect: "manual" });
  }

  const who = await jf("/whoAmI/api/json");
  if (who.status !== 200) throw new Error(`Auth check failed: ${who.status}`);
  const whoJson = await who.json();
  if (!whoJson.authenticated) throw new Error("Credentials are not authenticated.");

  const pluginRes = await jf("/pluginManager/api/json?tree=plugins[shortName,active,enabled]");
  if (pluginRes.status !== 200) throw new Error(`Plugin API failed: ${pluginRes.status}`);
  const pluginJson = await pluginRes.json();
  const installed = new Map(
    (pluginJson.plugins || []).map((p) => [p.shortName, Boolean(p.active && p.enabled)]),
  );

  const required = ["pipeline-stage-view", "pipeline-graph-view", "prometheus", "sonar"];
  const missing = required.filter((p) => !installed.get(p));
  if (missing.length === 0) {
    console.log("PLUGINS_ALREADY_OK");
    return;
  }

  const crumbRes = await jf("/crumbIssuer/api/json");
  if (crumbRes.status !== 200) throw new Error(`Crumb failed: ${crumbRes.status}`);
  const crumb = await crumbRes.json();
  const cookie = (crumbRes.headers.get("set-cookie") || "").split(";")[0];

  const installXml =
    "<jenkins>" +
    missing.map((p) => `<install plugin=\"${p}@latest\" />`).join("") +
    "</jenkins>";

  const headers = {
    "Content-Type": "text/xml",
    [crumb.crumbRequestField]: crumb.crumb,
  };
  if (cookie) headers.Cookie = cookie;

  const installRes = await jf("/pluginManager/installNecessaryPlugins", {
    method: "POST",
    headers,
    body: installXml,
  });
  if (![200, 201, 302].includes(installRes.status)) {
    throw new Error(`Install request failed: ${installRes.status}`);
  }

  console.log(`INSTALL_REQUESTED=${missing.join(",")}`);

  // Wait for download/install to settle.
  for (let i = 0; i < 120; i += 1) {
    const upd = await jf("/updateCenter/api/json?tree=jobs[name,status]");
    if (upd.status === 200) {
      const uj = await upd.json();
      const jobs = uj.jobs || [];
      if (jobs.length === 0) break;
      const busy = jobs.some((j) => ["Pending", "Installing", "SuccessButRestartRequired"].includes(j.status));
      if (!busy) break;
    }
    await sleep(3000);
  }

  // Safe restart to fully load new UI plugins.
  const crumb2Res = await jf("/crumbIssuer/api/json");
  const crumb2 = await crumb2Res.json();
  const cookie2 = (crumb2Res.headers.get("set-cookie") || "").split(";")[0];
  const restartHeaders = { [crumb2.crumbRequestField]: crumb2.crumb };
  if (cookie2) restartHeaders.Cookie = cookie2;
  await jf("/safeRestart", { method: "POST", headers: restartHeaders });

  console.log("SAFE_RESTART_TRIGGERED");
}

main().catch((err) => {
  console.error(`PLUGIN_INSTALL_FAILED: ${err.message}`);
  process.exit(1);
});
