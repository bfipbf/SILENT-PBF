import fs from "node:fs/promises";

const PUBLIC = "bfipbf/SILENT-PBF";
const PRIVATE = "bfipbf/PRIVATE-PBF";
const token = process.env.PRIVATE_PBF_TOKEN;
const issue = Number(process.env.ISSUE_NUMBER);
const file = process.env.EVIDENCE_FILE;
const marker = "<!-- silent-pbf-issue:" + issue + " -->";
const publishMarker = "<!-- jim-evidence:" + process.env.GITHUB_RUN_ID + ":" + (process.env.EVIDENCE_KIND || "request") + " -->";

if (!token) throw Error("PRIVATE_PBF_TOKEN missing; refusing public fallback.");
if (!Number.isSafeInteger(issue) || issue < 1) throw Error("Invalid issue number.");
if (!file) throw Error("EVIDENCE_FILE missing.");

const evidence = await fs.readFile(file, "utf8");
if (!evidence.trim()) throw Error("Evidence is empty.");

async function api(path, method = "GET", body) {
  const response = await fetch("https://api.github.com/repos/" + PRIVATE + path, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "silent-pbf-jim-evidence"
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) {
    // Do not print private issue body or response.
    throw Error("Private GitHub API " + method + " HTTP " + response.status);
  }
  return response.status === 204 ? null : response.json();
}
async function list(path) {
  const result = [];
  for (let page = 1; page <= 20; page++) {
    const separator = path.includes("?") ? "&" : "?";
    const data = await api(path + separator + "per_page=100&page=" + page);
    if (!Array.isArray(data)) throw Error("Unexpected private API response.");
    result.push(...data);
    if (data.length < 100) return result;
  }
  throw Error("Private pagination limit exceeded.");
}

// The issue-sync workflow is the sole creator of mirrored issues.
// Wait briefly because independent GitHub Actions workflows start concurrently.
let targets = [];
for (let attempt = 0; attempt < 12; attempt++) {
  targets = (await list("/issues?state=all"))
    .filter(x => !x.pull_request && typeof x.body === "string" && x.body.includes(marker));
  if (targets.length) break;
  await new Promise(resolve => setTimeout(resolve, 5000));
}
if (targets.length !== 1) {
  throw Error("Expected one linked private issue; found " + targets.length + ". Evidence not published.");
}
const target = targets[0];
const comments = await list("/issues/" + target.number + "/comments");
const found = comments.filter(x => x.body?.includes(publishMarker));
if (found.length > 1) throw Error("Duplicate private evidence marker.");
if (!found.length) {
  await api("/issues/" + target.number + "/comments", "POST", {
    body: "Source: https://github.com/" + PUBLIC + "/issues/" + issue +
      "\n" + publishMarker + "\n\n" + evidence
  });
}
console.log("Jim evidence published to linked private issue #" + target.number + " only.");
