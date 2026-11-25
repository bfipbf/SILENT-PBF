import dns from "node:dns/promises";
import net from "node:net";

const apiKey = process.env.SF_BFI_PROD_APIKEY || "";
const issueBody = process.env.ISSUE_BODY || "";
const fence = "\x60\x60\x60";
const credentialOrigin = "https://gateway.prod.bravo.bfi.co.id";

function readRequest(text) {
  const lines = text.split(/\r?\n/);
  const sections = [];
  let section = null;
  for (const line of lines) {
    if (/^### Direct Request\s*$/.test(line)) {
      section = [];
      sections.push(section);
    } else if (section && /^#{1,3}\s+/.test(line)) {
      section = null;
    } else if (section) {
      section.push(line);
    }
  }
  if (sections.length !== 1) throw new Error("Harus ada tepat satu heading ### Direct Request.");
  const matches = [...sections[0].join("\n").matchAll(/(?:^|\n)\x60{3}json[ \t]*\n([\s\S]*?)\n\x60{3}[ \t]*(?=\n|$)/gi)];
  if (matches.length !== 1 || Buffer.byteLength(matches[0][1], "utf8") > 10000) {
    throw new Error("Direct Request wajib berisi satu JSON code block maksimal 10 KB.");
  }
  let request;
  try { request = JSON.parse(matches[0][1]); }
  catch { throw new Error("JSON Direct Request tidak valid."); }
  if (!request || Array.isArray(request) || typeof request !== "object") {
    throw new Error("Request harus JSON object.");
  }
  if (Object.keys(request).some(k => !["url", "method", "body", "request_id"].includes(k))) {
    throw new Error("Property yang didukung: url, method, body, request_id.");
  }
  if (typeof request.request_id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{5,79}$/.test(request.request_id)) {
    throw new Error("request_id unik wajib (6-80 karakter: huruf, angka, titik, underscore, dash).");
  }
  if (typeof request.url !== "string" || request.url.length > 2048) {
    throw new Error("url wajib berupa string maksimal 2048 karakter.");
  }
  let url;
  try { url = new URL(request.url); } catch { throw new Error("URL tidak valid."); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error("Hanya URL HTTPS tanpa credentials atau fragment yang diperbolehkan.");
  }
  const method = String(request.method || "GET").toUpperCase();
  if (!["GET", "HEAD", "POST"].includes(method)) {
    throw new Error("Method yang didukung: GET, HEAD, POST.");
  }
  if (method !== "POST" && Object.hasOwn(request, "body")) {
    throw new Error("body hanya dapat digunakan untuk POST.");
  }
  if (method === "POST" && (!Object.hasOwn(request, "body") || request.body === null)) {
    throw new Error("POST memerlukan property body.");
  }
  return { url, method, body: request.body, requestId: request.request_id };
}

// Protect the runner from local-network targets; this is not a hostname/path allowlist.
async function checkDestination(url) {
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") || net.isIP(hostname)) {
    throw new Error("URL ke localhost, jaringan lokal, atau alamat IP langsung ditolak.");
  }
  const records = await dns.lookup(hostname, { all: true });
  if (!records.length) throw new Error("DNS target tidak ditemukan.");
  for (const { address } of records) {
    const v4 = net.isIP(address) === 4 ? address.split(".").map(Number) : null;
    if (v4 && (v4[0] === 0 || v4[0] === 10 || v4[0] === 127 ||
      v4[0] >= 224 || (v4[0] === 169 && v4[1] === 254) ||
      (v4[0] === 172 && v4[1] >= 16 && v4[1] <= 31) ||
      (v4[0] === 192 && v4[1] === 168) ||
      (v4[0] === 100 && v4[1] >= 64 && v4[1] <= 127) ||
      (v4[0] === 192 && v4[1] === 0 && v4[2] === 0))) {
      throw new Error("URL mengarah ke alamat jaringan non-public.");
    }
    if (net.isIP(address) === 6 && (
      address === "::1" || address === "::" ||
      /^f[cd]/i.test(address) || /^fe[89ab]/i.test(address) ||
      /^::ffff:/i.test(address))) {
      throw new Error("URL mengarah ke alamat jaringan non-public.");
    }
  }
}

function hideSecrets(value) {
  let out = String(value ?? "");
  if (apiKey) out = out.split(apiKey).join("[HIDDEN]");
  return out;
}
function quote(value) { return "'" + String(value).replaceAll("'", "'\\''") + "'"; }

const allowedRepository = "bfipbf/PRIVATE-PBF";
const repository = process.env.GITHUB_REPOSITORY || "";
const githubToken = process.env.GH_TOKEN || "";
const issueNumber = Number(process.env.ISSUE_NUMBER || "0");

async function privateGitHubApi(method, path, data) {
  const response = await fetch("https://api.github.com/repos/" + allowedRepository + path, {
    method,
    headers: {
      Authorization: "Bearer " + githubToken,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "private-direct-request"
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    redirect: "error",
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error("PRIVATE GitHub API " + method + " HTTP " + response.status);
  return response.status === 204 ? null : response.json();
}

async function getExistingComments() {
  const comments = [];
  for (let page = 1; page <= 30; page++) {
    const next = await privateGitHubApi("GET", "/issues/" + issueNumber + "/comments?per_page=100&page=" + page);
    if (!Array.isArray(next)) throw new Error("Unexpected PRIVATE issue comments payload.");
    comments.push(...next);
    if (next.length < 100) return comments;
  }
  throw new Error("PRIVATE issue comments pagination limit exceeded.");
}

async function main() {
  if (repository !== allowedRepository) throw new Error("Direct Request only runs in private bfipbf/PRIVATE-PBF.");
  if (!githubToken) throw new Error("GitHub issue-token is unavailable; refusing external callout.");
  if (!Number.isSafeInteger(issueNumber) || issueNumber < 1) throw new Error("Invalid private issue number.");

  const request = readRequest(issueBody);
  await checkDestination(request.url);
  if (request.url.origin === credentialOrigin && !apiKey) {
    throw new Error("PRIVATE repo secret SF_BFI_PROD_APIKEY is missing.");
  }
  const requestMarker = "<!-- direct-request-started:" + request.requestId + " -->";
  const resultMarker = "<!-- direct-request-result:" + request.requestId + " -->";
  const existing = await getExistingComments();
  if (existing.some(comment => typeof comment.body === "string" &&
      (comment.body.includes(requestMarker) || comment.body.includes(resultMarker)))) {
    throw new Error("Duplicate request_id already STARTED or finished; inspect PRIVATE evidence before retry.");
  }

  let sentBody;
  if (request.method === "POST") {
    sentBody = JSON.stringify(request.body);
    if (Buffer.byteLength(sentBody, "utf8") > 10000) throw new Error("POST body exceeds 10 KB.");
  }

  // STARTED is committed to the PRIVATE issue before the external request.
  await privateGitHubApi("POST", "/issues/" + issueNumber + "/comments", {
    body: requestMarker + "\n\n" +
      "Direct Request | STARTED | request_id=" + request.requestId +
      " | method=" + request.method + " | endpoint=" + request.url.origin + request.url.pathname +
      " | run=" + (process.env.GITHUB_RUN_ID || "N/A") +
      "\n\nRequest payload omitted from STARTED marker."
  });

  let response;
  let result = {};
  let errorMessage = "";
  try {
    const headers = { Accept: "application/json" };
    if (request.url.origin === credentialOrigin) headers["X-Apikey"] = apiKey;
    if (request.method === "POST") headers["Content-Type"] = "application/json";
    response = await fetch(request.url, {
      method: request.method,
      headers,
      ...(sentBody === undefined ? {} : { body: sentBody }),
      redirect: "error",
      signal: AbortSignal.timeout(30000)
    });
    const responseText = await response.text();
    if (Buffer.byteLength(responseText, "utf8") > 50000) {
      result = { notice: "Response exceeds 50 KB and is not displayed." };
    } else {
      try { result = JSON.parse(responseText); }
      catch { result = { text: responseText.slice(0, 2000) }; }
    }
    if (!response.ok) errorMessage = "Gateway HTTP " + response.status;
  } catch (error) {
    errorMessage = error.message || String(error);
  }

  const status = response ? response.status : "N/A";
  const curl = [
    "curl --location --request " + request.method + " " + quote(request.url.toString()),
    "  --header 'Accept: application/json'",
    ...(request.url.origin === credentialOrigin ? ["  --header 'X-Apikey: [HIDDEN]'"] : []),
    ...(sentBody === undefined ? [] : ["  --header 'Content-Type: application/json'",
      "  --data " + quote(sentBody)])
  ].join(" \\\n");
  const lines = [
    resultMarker, "",
    "## Direct Request — PRIVATE issue #" + issueNumber, "",
    "Status: **" + (errorMessage ? "FAILED" : "HTTP_SUCCESS") +
      "** · HTTP " + status + " · " + request.method +
      " · request_id=" + request.requestId, "",
    "HTTP success does not by itself confirm a valid business response.", "",
    "### Direct Request", "", fence + "json",
    hideSecrets(JSON.stringify({
      request_id: request.requestId, url: request.url.toString(),
      method: request.method,
      ...(request.method === "POST" ? { body: request.body } : {})
    }, null, 2)), fence, "",
    "<details>", "<summary>cURL (API key masked; private evidence)</summary>", "",
    fence + "bash", hideSecrets(curl), fence, "", "</details>", "",
    "<details>", "<summary>Response JSON — HTTP " + status + "</summary>", ""
  ];
  if (errorMessage) lines.push("Error: " + hideSecrets(errorMessage), "");
  lines.push(fence + "json", hideSecrets(JSON.stringify(result, null, 2)),
    fence, "", "</details>");
  const evidence = lines.join("\n");
  if (Buffer.byteLength(evidence, "utf8") > 60000) {
    throw new Error("Evidence too large; original STARTED marker retained. Do not repeat callout.");
  }
  await privateGitHubApi("POST", "/issues/" + issueNumber + "/comments", { body: evidence });
  console.log("Direct Request " + (errorMessage ? "FAILED" : "HTTP_SUCCESS") +
    " HTTP " + status + " | evidence in PRIVATE issue #" + issueNumber + ".");
  if (errorMessage) process.exitCode = 1;
}

await main().catch(error => {
  console.error("Direct Request stopped: " +
    String(error.message || error).replaceAll(apiKey || "\u0000", "[HIDDEN]"));
  process.exitCode = 1;
});
