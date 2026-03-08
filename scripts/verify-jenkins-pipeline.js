const fs = require("fs");
const { execSync } = require("child_process");

function parseCreds(text) {
  const result = {};
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const m = line.match(/^([^:=\s]+)\s*[:=]\s*(.+)$/);
    if (m) {
      result[m[1].toLowerCase()] = m[2].trim();
    }
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

  async function jenkinsFetch(path, options = {}) {
    const headers = { Authorization: `Basic ${auth}`, ...(options.headers || {}) };
    const res = await fetch(`${base}${path}`, { ...options, headers, redirect: "manual" });
    return res;
  }

  // Check auth.
  const who = await jenkinsFetch("/whoAmI/api/json");
  if (who.status !== 200) {
    throw new Error(`Jenkins auth failed with HTTP ${who.status}`);
  }
  const whoJson = await who.json();
  if (!whoJson.authenticated || !whoJson.name || whoJson.name === "anonymous") {
    throw new Error("Jenkins credentials are not authenticated for API calls.");
  }

  // Crumb (if enabled).
  let crumbHeaderName = "";
  let crumbValue = "";
  let crumbCookie = "";
  const crumbRes = await jenkinsFetch("/crumbIssuer/api/json");
  if (crumbRes.status === 200) {
    const crumbJson = await crumbRes.json();
    crumbHeaderName = crumbJson.crumbRequestField;
    crumbValue = crumbJson.crumb;
    crumbCookie = crumbRes.headers.get("set-cookie") || "";
  }

  const triggerHeaders = {};
  if (crumbHeaderName && crumbValue) {
    triggerHeaders[crumbHeaderName] = crumbValue;
  }
  if (crumbCookie) {
    triggerHeaders.Cookie = crumbCookie.split(";")[0];
  }

  let triggerRes = await jenkinsFetch("/job/cicd-pipeline/build", {
    method: "POST",
    headers: triggerHeaders,
  });

  if (triggerRes.status === 400 || triggerRes.status === 404) {
    triggerRes = await jenkinsFetch("/job/cicd-pipeline/buildWithParameters", {
      method: "POST",
      headers: triggerHeaders,
    });
  }

  if (![201, 302].includes(triggerRes.status)) {
    throw new Error(
      `Build trigger failed with HTTP ${triggerRes.status} (crumb status: ${crumbRes.status})`,
    );
  }

  let queueUrl = triggerRes.headers.get("location");
  if (!queueUrl) {
    throw new Error("No queue location returned from Jenkins.");
  }

  if (queueUrl.startsWith("http://localhost")) {
    queueUrl = queueUrl.replace("http://localhost:8080", base);
  }

  // Wait for queue item to get executable build number.
  let buildNumber = null;
  for (let i = 0; i < 120; i += 1) {
    const qRes = await fetch(`${queueUrl}api/json`, {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (qRes.status !== 200) {
      await sleep(2000);
      continue;
    }
    const q = await qRes.json();
    if (q.executable && q.executable.number) {
      buildNumber = q.executable.number;
      break;
    }
    await sleep(2000);
  }

  if (!buildNumber) {
    throw new Error("Timed out waiting for Jenkins queue item to start.");
  }

  // Wait for build completion.
  let result = "";
  for (let i = 0; i < 180; i += 1) {
    const bRes = await jenkinsFetch(`/job/cicd-pipeline/${buildNumber}/api/json?tree=number,result,building`);
    if (bRes.status !== 200) {
      await sleep(3000);
      continue;
    }
    const b = await bRes.json();
    if (!b.building) {
      result = b.result || "UNKNOWN";
      break;
    }
    await sleep(3000);
  }

  if (!result) {
    throw new Error("Timed out waiting for build completion.");
  }

  // Stage data for graph/diagram.
  let stageCount = 0;
  const wfRes = await jenkinsFetch(`/job/cicd-pipeline/${buildNumber}/wfapi/describe`);
  if (wfRes.status === 200) {
    const wf = await wfRes.json();
    stageCount = Array.isArray(wf.stages) ? wf.stages.length : 0;
  }

  // Graph view plugin availability.
  let graphPluginActive = false;
  const pluginRes = await jenkinsFetch("/pluginManager/api/json?tree=plugins[shortName,active,enabled]");
  if (pluginRes.status === 200) {
    const p = await pluginRes.json();
    const plugin = (p.plugins || []).find((x) => x.shortName === "pipeline-graph-view");
    graphPluginActive = Boolean(plugin && plugin.active && plugin.enabled);
  }

  // Build console summary.
  const logRes = await jenkinsFetch(`/job/cicd-pipeline/${buildNumber}/consoleText`);
  const logText = logRes.status === 200 ? await logRes.text() : "";
  const sawStages =
    logText.includes("Stage \"Install\"") ||
    logText.includes("[Pipeline] stage") ||
    logText.includes("Docker Build");

  // Check build page has graph view link/action.
  const buildPageRes = await jenkinsFetch(`/job/cicd-pipeline/${buildNumber}/`);
  const buildPageText = buildPageRes.status === 200 ? await buildPageRes.text() : "";
  const graphUiLinkPresent =
    buildPageText.includes("pipeline-graph-view") ||
    buildPageText.includes("pipeline-stage-view") ||
    buildPageText.includes("pipeline-overview") ||
    buildPageText.includes("Pipeline Graph") ||
    buildPageText.includes("Stage View") ||
    buildPageText.includes("pipelineGraphView");

  console.log(`JENKINS_URL=${base}`);
  console.log(`JOB_NAME=cicd-pipeline`);
  console.log(`BUILD_NUMBER=${buildNumber}`);
  console.log(`BUILD_RESULT=${result}`);
  console.log(`STAGE_DATA_COUNT=${stageCount}`);
  console.log(`PIPELINE_GRAPH_PLUGIN_ACTIVE=${graphPluginActive ? "YES" : "NO"}`);
  console.log(`PIPELINE_STAGE_LOG_MARKERS=${sawStages ? "YES" : "NO"}`);
  console.log(`PIPELINE_GRAPH_UI_LINK_PRESENT=${graphUiLinkPresent ? "YES" : "NO"}`);

  if (result !== "SUCCESS") {
    throw new Error(`Pipeline build result is ${result}`);
  }
  if (!graphPluginActive) {
    throw new Error("pipeline-graph-view plugin is not active.");
  }
  if (stageCount < 4 && !sawStages) {
    throw new Error("No pipeline stage metadata found for diagram rendering.");
  }
  if (!graphUiLinkPresent) {
    throw new Error("Pipeline graph UI link not found on build page.");
  }
}

main().catch((err) => {
  console.error(`VERIFY_FAILED: ${err.message}`);
  process.exit(1);
});
