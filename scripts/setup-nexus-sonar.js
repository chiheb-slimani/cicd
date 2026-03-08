const fs = require("fs");
const { execFileSync } = require("child_process");

function parseCreds(text) {
  const result = {};
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const normalizeKey = (key) =>
    key
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  for (const line of lines) {
    const m = line.match(/^([^:=]+)\s*[:=]\s*(.+)$/);
    if (m) result[normalizeKey(m[1])] = m[2].trim();
  }
  return result;
}

function pick(creds, keys) {
  for (const key of keys) {
    if (creds[key]) return creds[key];
  }
  return "";
}

function pickLooseValue(text, patterns) {
  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    for (const pattern of patterns) {
      const m = line.match(pattern);
      if (m && m[1]) {
        return m[1].trim();
      }
    }
  }
  return "";
}

function run(bin, args, options = {}) {
  return execFileSync(bin, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();
}

function dockerMachineSSH(command) {
  return run("docker-machine", ["ssh", "default", "sh", "-lc", command]);
}

function dockerMachineExec(args) {
  return run("docker-machine", ["ssh", "default", ...args]);
}

function basicAuth(user, pass) {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttp(url, matcher, timeoutMs = 600000, intervalMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      const body = await res.text();
      if (matcher(res.status, body)) return;
    } catch {
      // Service might still be booting.
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function nexusRequest(baseUrl, path, user, pass, options = {}) {
  const headers = {
    Authorization: basicAuth(user, pass),
    ...(options.headers || {}),
  };
  return fetch(`${baseUrl}${path}`, { ...options, headers });
}

async function sonarRequest(baseUrl, path, user, pass, options = {}) {
  const headers = {
    Authorization: basicAuth(user, pass),
    ...(options.headers || {}),
  };
  return fetch(`${baseUrl}${path}`, { ...options, headers });
}

function normalizeUserId(input) {
  const normalized = input
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return normalized || "cicd-user";
}

function xmlEscape(input) {
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function ensureNexus(ip, targetUser, targetPass) {
  const baseUrl = `http://${ip}:8082`;
  const repository = "cicd-artifacts";

  dockerMachineSSH("docker network inspect cicd-monitoring >/dev/null 2>&1 || docker network create cicd-monitoring >/dev/null");
  dockerMachineSSH("docker volume create nexus_data >/dev/null");
  dockerMachineSSH("docker network connect cicd-monitoring jenkins-cicd >/dev/null 2>&1 || true");

  const exists = dockerMachineSSH("docker ps -a --format '{{.Names}}' | grep -x nexus-cicd >/dev/null 2>&1 && echo yes || echo no");
  if (exists !== "yes") {
    dockerMachineSSH("docker run -d --name nexus-cicd --restart unless-stopped --network cicd-monitoring -p 8082:8081 -v nexus_data:/nexus-data sonatype/nexus3:3.70.1 >/dev/null");
  } else {
    dockerMachineSSH("docker start nexus-cicd >/dev/null 2>&1 || true");
    dockerMachineSSH("docker network connect cicd-monitoring nexus-cicd >/dev/null 2>&1 || true");
  }

  await waitForHttp(
    `${baseUrl}/service/rest/v1/status`,
    (status) => status === 200,
    900000,
    5000,
  );

  let adminDefaultPassword = "";
  for (let i = 0; i < 24; i += 1) {
    try {
      const raw = dockerMachineExec(["docker", "exec", "nexus-cicd", "cat", "/nexus-data/admin.password"]);
      if (raw) {
        adminDefaultPassword = raw.trim();
        break;
      }
    } catch {
      // Keep retrying while Nexus is still initializing.
    }
    await sleep(5000);
  }

  const adminCandidates = [adminDefaultPassword, targetPass, "admin"].filter(Boolean);
  let activeAdminPass = "";
  for (let i = 0; i < adminCandidates.length; i += 1) {
    const candidate = adminCandidates[i];
    const res = await nexusRequest(baseUrl, "/service/rest/v1/repositories", "admin", candidate);
    if (res.status === 200) {
      activeAdminPass = candidate;
      break;
    }
  }
  if (!activeAdminPass) {
    throw new Error("Could not authenticate to Nexus with either default or target password.");
  }

  if (adminDefaultPassword && activeAdminPass === adminDefaultPassword && adminDefaultPassword !== targetPass) {
    const changeRes = await nexusRequest(
      baseUrl,
      "/service/rest/v1/security/users/admin/change-password",
      "admin",
      adminDefaultPassword,
      {
        method: "PUT",
        headers: {
          "Content-Type": "text/plain",
        },
        body: targetPass,
      },
    );
    if (![200, 204].includes(changeRes.status)) {
      throw new Error(`Failed to change Nexus admin password (HTTP ${changeRes.status}).`);
    }
    activeAdminPass = targetPass;
  }

  const reposRes = await nexusRequest(baseUrl, "/service/rest/v1/repositories", "admin", activeAdminPass);
  if (reposRes.status !== 200) {
    throw new Error(`Failed listing Nexus repositories (HTTP ${reposRes.status}).`);
  }
  const repositories = await reposRes.json();
  const hasRepo = Array.isArray(repositories) && repositories.some((r) => r.name === repository);
  if (!hasRepo) {
    const createRepoRes = await nexusRequest(
      baseUrl,
      "/service/rest/v1/repositories/raw/hosted",
      "admin",
      activeAdminPass,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: repository,
          online: true,
          storage: {
            blobStoreName: "default",
            strictContentTypeValidation: true,
            writePolicy: "ALLOW",
          },
        }),
      },
    );
    if (![200, 201, 204].includes(createRepoRes.status)) {
      throw new Error(`Failed creating Nexus repository (HTTP ${createRepoRes.status}).`);
    }
  }

  let ciUser = normalizeUserId(targetUser);
  let ciPass = targetPass;

  if (ciUser !== "admin") {
    const createUserRes = await nexusRequest(
      baseUrl,
      "/service/rest/v1/security/users",
      "admin",
      activeAdminPass,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: ciUser,
          firstName: "CI",
          lastName: "Pipeline",
          emailAddress: "ci-pipeline@example.local",
          password: ciPass,
          status: "active",
          roles: ["nx-admin"],
        }),
      },
    );
    if (![200, 201, 204, 400, 409, 500].includes(createUserRes.status)) {
      ciUser = "admin";
      ciPass = activeAdminPass;
    }
  } else {
    ciPass = activeAdminPass;
  }

  const ciAuthTest = await nexusRequest(baseUrl, "/service/rest/v1/repositories", ciUser, ciPass);
  if (ciAuthTest.status !== 200) {
    ciUser = "admin";
    ciPass = activeAdminPass;
  }

  return {
    baseUrl,
    repository,
    adminDefaultPassword: adminDefaultPassword || activeAdminPass,
    ciUser,
    ciPass,
  };
}

async function ensureSonarQube(ip, targetPass) {
  const baseUrl = `http://${ip}:9000`;

  dockerMachineSSH("docker network inspect cicd-monitoring >/dev/null 2>&1 || docker network create cicd-monitoring >/dev/null");
  dockerMachineSSH("docker volume create sonarqube_data >/dev/null");
  dockerMachineSSH("docker volume create sonarqube_logs >/dev/null");
  dockerMachineSSH("docker volume create sonarqube_extensions >/dev/null");
  dockerMachineSSH("docker network connect cicd-monitoring jenkins-cicd >/dev/null 2>&1 || true");

  const exists = dockerMachineSSH("docker ps -a --format '{{.Names}}' | grep -x sonarqube-cicd >/dev/null 2>&1 && echo yes || echo no");
  if (exists !== "yes") {
    dockerMachineSSH("docker run -d --name sonarqube-cicd --restart unless-stopped --network cicd-monitoring --security-opt seccomp=unconfined -p 9000:9000 -e SONAR_ES_BOOTSTRAP_CHECKS_DISABLE=true -v sonarqube_data:/opt/sonarqube/data -v sonarqube_logs:/opt/sonarqube/logs -v sonarqube_extensions:/opt/sonarqube/extensions sonarqube:lts-community >/dev/null");
  } else {
    dockerMachineSSH("docker start sonarqube-cicd >/dev/null 2>&1 || true");
    dockerMachineSSH("docker network connect cicd-monitoring sonarqube-cicd >/dev/null 2>&1 || true");
  }

  await waitForHttp(
    `${baseUrl}/api/system/status`,
    (_status, body) => body.includes("\"UP\""),
    180000,
    5000,
  );

  let adminPass = "";
  const targetRes = await sonarRequest(baseUrl, "/api/authentication/validate", "admin", targetPass);
  if (targetRes.status === 200) {
    const targetBody = await targetRes.json();
    if (targetBody.valid) adminPass = targetPass;
  }
  if (!adminPass) {
    const defaultRes = await sonarRequest(baseUrl, "/api/authentication/validate", "admin", "admin");
    if (defaultRes.status === 200) {
      const defaultBody = await defaultRes.json();
      if (defaultBody.valid) adminPass = "admin";
    }
  }
  if (!adminPass) {
    throw new Error("Could not authenticate to SonarQube with known admin credentials.");
  }

  // Revoke old token if it exists, ignore failures.
  await sonarRequest(
    baseUrl,
    "/api/user_tokens/revoke",
    "admin",
    adminPass,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "name=jenkins-cicd",
    },
  );

  const tokenRes = await sonarRequest(
    baseUrl,
    "/api/user_tokens/generate",
    "admin",
    adminPass,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "name=jenkins-cicd",
    },
  );
  if (tokenRes.status !== 200) {
    throw new Error(`Failed generating SonarQube token (HTTP ${tokenRes.status}).`);
  }
  const tokenJson = await tokenRes.json();
  const token = tokenJson.token;
  if (!token) {
    throw new Error("SonarQube token generation did not return a token.");
  }

  return {
    baseUrl,
    adminUser: "admin",
    adminPass,
    token,
  };
}

async function getJenkinsCrumb(baseUrl, authHeader) {
  const res = await fetch(`${baseUrl}/crumbIssuer/api/json`, {
    headers: { Authorization: authHeader },
  });
  if (res.status !== 200) return { headerName: "", value: "", cookie: "" };
  const body = await res.json();
  return {
    headerName: body.crumbRequestField,
    value: body.crumb,
    cookie: (res.headers.get("set-cookie") || "").split(";")[0],
  };
}

async function jenkinsRequest(baseUrl, path, authHeader, options = {}) {
  const headers = {
    Authorization: authHeader,
    ...(options.headers || {}),
  };
  return fetch(`${baseUrl}${path}`, { ...options, headers, redirect: "manual" });
}

async function upsertJenkinsCredentials(jenkinsBase, authHeader, id, xml) {
  const crumb = await getJenkinsCrumb(jenkinsBase, authHeader);
  const baseHeaders = {
    "Content-Type": "application/xml",
  };
  if (crumb.headerName && crumb.value) {
    baseHeaders[crumb.headerName] = crumb.value;
  }
  if (crumb.cookie) {
    baseHeaders.Cookie = crumb.cookie;
  }

  let res = await jenkinsRequest(
    jenkinsBase,
    "/credentials/store/system/domain/_/createCredentials",
    authHeader,
    { method: "POST", headers: baseHeaders, body: xml },
  );

  if ([200, 201, 302].includes(res.status)) return;

  // Delete + recreate for idempotent replacement.
  const deleteHeaders = {};
  if (crumb.headerName && crumb.value) {
    deleteHeaders[crumb.headerName] = crumb.value;
  }
  if (crumb.cookie) {
    deleteHeaders.Cookie = crumb.cookie;
  }

  await jenkinsRequest(
    jenkinsBase,
    `/credentials/store/system/domain/_/credential/${encodeURIComponent(id)}/doDelete`,
    authHeader,
    { method: "POST", headers: deleteHeaders },
  );

  res = await jenkinsRequest(
    jenkinsBase,
    "/credentials/store/system/domain/_/createCredentials",
    authHeader,
    { method: "POST", headers: baseHeaders, body: xml },
  );
  if (![200, 201, 302].includes(res.status)) {
    throw new Error(`Failed upserting Jenkins credential '${id}' (HTTP ${res.status}).`);
  }
}

async function ensureJenkinsCredentials(ip, jenkinsUser, jenkinsPass, nexusUser, nexusPass, sonarToken = "") {
  const baseUrl = `http://${ip}:8080`;
  const authHeader = basicAuth(jenkinsUser, jenkinsPass);

  const who = await jenkinsRequest(baseUrl, "/whoAmI/api/json", authHeader);
  if (who.status !== 200) {
    throw new Error(`Jenkins auth failed while syncing credentials (HTTP ${who.status}).`);
  }

  const nexusXml =
    "<com.cloudbees.plugins.credentials.impl.UsernamePasswordCredentialsImpl>" +
    "<scope>GLOBAL</scope>" +
    "<id>nexus-creds</id>" +
    "<description>Nexus credentials for cicd pipeline</description>" +
    `<username>${xmlEscape(nexusUser)}</username>` +
    `<password>${xmlEscape(nexusPass)}</password>` +
    "</com.cloudbees.plugins.credentials.impl.UsernamePasswordCredentialsImpl>";

  await upsertJenkinsCredentials(baseUrl, authHeader, "nexus-creds", nexusXml);

  if (sonarToken) {
    const sonarXml =
      "<org.jenkinsci.plugins.plaincredentials.impl.StringCredentialsImpl>" +
      "<scope>GLOBAL</scope>" +
      "<id>sonarqube-token</id>" +
      "<description>SonarQube token for cicd pipeline</description>" +
      `<secret>${xmlEscape(sonarToken)}</secret>` +
      "</org.jenkinsci.plugins.plaincredentials.impl.StringCredentialsImpl>";

    await upsertJenkinsCredentials(baseUrl, authHeader, "sonarqube-token", sonarXml);
  }
}

async function main() {
  const jenkinsText = fs.readFileSync("jenkins.txt", "utf8");
  const creds = parseCreds(jenkinsText);
  let jenkinsUser = pick(creds, ["username", "user", "login", "jenkins_user"]);
  let jenkinsPass = pick(creds, [
    "password",
    "pass",
    "jenkins_password",
    "adminpass",
    "admin_password",
    "default_admin_pass",
  ]);

  if (!jenkinsUser) {
    jenkinsUser = pickLooseValue(jenkinsText, [
      /username\s*[:=\-]\s*(.+)$/i,
      /user\s*[:=\-]\s*(.+)$/i,
      /login\s*[:=\-]\s*(.+)$/i,
      /jenkins[_\s-]*user\s*[:=\-]\s*(.+)$/i,
    ]);
  }

  if (!jenkinsPass) {
    jenkinsPass = pickLooseValue(jenkinsText, [
      /password\s*[:=\-]\s*(.+)$/i,
      /pass\s*[:=\-]\s*(.+)$/i,
      /admin[_\s-]*password\s*[:=\-]\s*(.+)$/i,
      /default[_\s-]*admin[_\s-]*pass(?:word)?\s*[:=\-]\s*(.+)$/i,
      /default[_\s-]*pass(?:word)?\s*[:=\-]\s*(.+)$/i,
    ]);
  }

  if (!jenkinsUser || !jenkinsPass) {
    throw new Error("Could not parse Jenkins credentials from jenkins.txt");
  }

  const ip = run("docker-machine", ["ip", "default"]);

  console.log("Setting up Nexus container...");
  const nexus = await ensureNexus(ip, jenkinsUser, jenkinsPass);

  let sonar = {
    baseUrl: `http://${ip}:9000`,
    adminUser: "admin",
    adminPass: "",
    token: "",
    status: "NOT_CONFIGURED",
  };

  try {
    console.log("Setting up SonarQube container...");
    const sonarConfigured = await ensureSonarQube(ip, jenkinsPass);
    sonar = {
      ...sonarConfigured,
      status: "READY",
    };
  } catch (error) {
    sonar.status = `FAILED: ${error.message}`;
    console.log(`SonarQube setup warning: ${error.message}`);
  }

  console.log("Syncing Jenkins credentials...");
  await ensureJenkinsCredentials(ip, jenkinsUser, jenkinsPass, nexus.ciUser, nexus.ciPass, sonar.token);

  const nexusFile = [
    "# Local secret file generated by scripts/setup-nexus-sonar.js",
    "# Do not commit this file.",
    `docker_machine_ip=${ip}`,
    `jenkins_username=${jenkinsUser}`,
    `jenkins_password=${jenkinsPass}`,
    `nexus_url=http://${ip}:8082`,
    `nexus_repository=${nexus.repository}`,
    "nexus_admin_username=admin",
    `nexus_admin_default_password=${nexus.adminDefaultPassword}`,
    `nexus_username=${nexus.ciUser}`,
    `nexus_password=${nexus.ciPass}`,
    `nexus_ci_username=${nexus.ciUser}`,
    `nexus_ci_password=${nexus.ciPass}`,
    `sonarqube_url=${sonar.baseUrl}`,
    "sonarqube_admin_username=admin",
    `sonarqube_admin_password=${sonar.adminPass || "NOT_READY"}`,
    `sonarqube_token=${sonar.token}`,
    `sonarqube_status=${sonar.status}`,
    "jenkins_nexus_credentials_id=nexus-creds",
    "jenkins_sonarqube_token_credentials_id=sonarqube-token",
  ].join("\n");

  fs.writeFileSync("nexus.txt", `${nexusFile}\n`, { encoding: "utf8" });
  console.log("nexus.txt generated and local credentials synced.");
}

main().catch((err) => {
  console.error(`SETUP_FAILED: ${err.message}`);
  process.exit(1);
});
