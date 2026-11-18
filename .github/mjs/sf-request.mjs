import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

// GitHub Issue-driven Salesforce PROD API gateway.
// Validasi host/endpoint wajib sebelum memakai token. Jangan log credential.
function getProdLoginUrl() {
  const pinned = 'https://ptbfifinance.my.salesforce.com';
  const supplied = (process.env.SF_BFI_PROD_LOGIN_URL || pinned).trim();
  let url;
  try { url = new URL(supplied); }
  catch { throw new Error('SF_BFI_PROD_LOGIN_URL harus URL HTTPS valid.'); }
  if (url.origin !== pinned || url.username || url.password || url.search || url.hash ||
      (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('SF_BFI_PROD_LOGIN_URL harus domain Salesforce PROD yang disetujui, tanpa path/query.');
  }
  return url.origin;
}
var instanceUrl = getProdLoginUrl();
var clientId = process.env.SF_CLIENT_ID;
var clientSecret = process.env.SF_CLIENT_SECRET;
var issueBody = process.env.ISSUE_BODY || '';

function parseIssueRequest(text) {
  var lines = text.split(/\r?\n/);
  var headings = [];
  for (var i = 0; i < lines.length; i++) {
    if (/^### Sf Request\s*$/.test(lines[i])) headings.push(i);
  }
  if (headings.length !== 1) {
    throw new Error('Body Issue harus memiliki tepat satu heading ### Sf Request.');
  }
  var section = [];
  for (var line of lines.slice(headings[0] + 1)) {
    if (/^#{1,3}\s+/.test(line)) break;
    section.push(line);
  }
  var blocks = [];
  var sectionText = section.join('\n');
  var expression = /(?:^|\n)```json[ \t]*\n([\s\S]*?)\n```[ \t]*(?=\n|$)/gi;
  var match = expression.exec(sectionText);
  while (match) {
    blocks.push(match[1]);
    match = expression.exec(sectionText);
  }
  if (blocks.length !== 1 || Buffer.byteLength(blocks[0], 'utf8') > 12000) {
    throw new Error('Section Sf Request wajib berisi satu code fence json maksimal 12 KB.');
  }
  var data;
  try { data = JSON.parse(blocks[0]); }
  catch { throw new Error('JSON pada section Sf Request tidak valid.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Sf Request harus berupa JSON object.');
  }
  if (!data.options || typeof data.options !== 'object' || Array.isArray(data.options)) {
    throw new Error('options harus berupa JSON object.');
  }
  return data;
}

function validateRequest(input) {
  if (typeof input.url !== 'string') throw new Error('url wajib berupa string HTTPS.');
  var url;
  try { url = new URL(input.url); }
  catch { throw new Error('URL request tidak valid.'); }
  if (
    url.protocol !== 'https:' ||
    url.origin !== instanceUrl ||
    url.username || url.password || url.hash ||
    input.url.length > 2048
  ) {
    throw new Error('URL harus HTTPS Salesforce PROD dengan host yang disetujui.');
  }
  var method = (input.options.method || 'GET').toUpperCase();
  if (method !== 'GET') throw new Error('SILENT-PBF gateway public hanya mengizinkan GET read-only.');
  // Restrict GET to Salesforce REST read-only endpoints.
  var readOnlyPath = /^\/services\/data\/v\d+\.\d+\/(?:query|queryAll|tooling\/query|tooling\/queryAll)(?:\/.*)?$/;
  var approvedPostPath = '/services/apexrest/apigw/Expose_API_BFI_Leads_Report';
  if (method === 'GET' && !readOnlyPath.test(url.pathname)) {
    throw new Error('GET hanya diizinkan untuk endpoint REST query/tooling query.');
  }
  if (method === 'POST' && (url.pathname !== approvedPostPath || url.search)) {
    throw new Error('POST hanya diizinkan ke endpoint Apex REST yang telah ditentukan.');
  }

  var rawHeaders = input.options.headers || {};
  if (!rawHeaders || typeof rawHeaders !== 'object' || Array.isArray(rawHeaders)) {
    throw new Error('options.headers harus berupa object.');
  }
  var headers = new Headers();
  for (var [key, value] of Object.entries(rawHeaders)) {
    if (!['accept', 'content-type'].includes(key.toLowerCase()) || typeof value !== 'string') {
      throw new Error('Hanya header Accept dan Content-Type yang boleh ditentukan Issue.');
    }
    if (value.length > 150) throw new Error('Header terlalu panjang.');
    headers.set(key, value);
  }
  if (method === 'GET' && input.options.body !== undefined) {
    throw new Error('GET tidak menerima body.');
  }
  if (method === 'POST' && input.options.body !== undefined &&
      (typeof input.options.body !== 'object' || input.options.body === null)) {
    throw new Error('POST body harus berupa JSON object.');
  }
  if (method === 'POST' && !headers.has('content-type')) {
    headers.set('Content-Type', 'application/json');
  }
  var body = method === 'POST' ? JSON.stringify(input.options.body === undefined ? {} : input.options.body) : undefined;
  if (body && body.length > 10000) throw new Error('Request body terlalu besar.');
  return { url, method, headers, body };
}

var MAX_RESPONSE_BYTES = 1000000; // Full response accepted internally; evidence is size-limited below.
function compactFlowMetadata(data) {
  if (!data || !Array.isArray(data.records)) return data;
  var found = data.records.some(r => r && r.Metadata);
  if (!found) return data;
  return { totalSize: data.totalSize, done: data.done, records: data.records.map(r => {
    if (!r.Metadata) return r;
    var m = r.Metadata;
    var keys = ['label','processType','status','start','loops','actionCalls','subflows'];
    var result = {Id:r.Id};
    for (var key of keys) if (m[key] !== undefined) result[key] = m[key];
    // Compact element structures; keep references, action names and loop wiring only.
    for (var key of ['loops','actionCalls','subflows']) {
      if (!Array.isArray(result[key])) continue;
      result[key] = result[key].map(e => {
        var out={};
        for (var k of ['name','label','actionName','actionType','flowName','collectionReference','iterationOrder','nextValueConnector','noMoreValuesConnector','connector','faultConnector'])
          if (e[k] !== undefined) out[k]=e[k];
        return out;
      });
    }
    return result;
  }) };
}
var EVIDENCE_FILE = (process.env.RUNNER_TEMP || '/tmp') + '/sf-evidence.md';
var SUMMARY_FILE = (process.env.RUNNER_TEMP || '/tmp') + '/sf-summary.md';
var COMMENT_LIMIT_BYTES = 55000;
var maskKey = /(?:token|secret|password|authorization|credential|api[_-]?key)/i;

function sanitize(value, secrets = [], depth = 0) {
  if (depth > 15) return '[DEPTH_LIMIT]';
  if (typeof value === 'string') {
    var result = value;
    for (var i = 0; i < secrets.length; i++) {
      if (secrets[i]) result = result.split(secrets[i]).join('[HIDDEN]');
    }
    return result;
  }
  if (Array.isArray(value)) {
    var list = [];
    for (var i = 0; i < value.length; i++) list.push(sanitize(value[i], secrets, depth + 1));
    return list;
  }
  if (value && typeof value === 'object') {
    var result = {};
    var keys = Object.keys(value);
    for (var j = 0; j < keys.length; j++) {
      var key = keys[j];
      result[key] = maskKey.test(key) ? '[HIDDEN]' : sanitize(value[key], secrets, depth + 1);
    }
    return result;
  }
  return value;
}

function quoteShell(value) {
  return "'" + String(value).split("'").join("'\\''") + "'";
}

async function readResponse(response) {
  var length = Number(response.headers.get('content-length') || '0');
  if (length > MAX_RESPONSE_BYTES) return { notice: 'Response body melebihi batas 50 KB dan tidak ditampilkan.' };
  var content = await response.text();
  if (Buffer.byteLength(content) > MAX_RESPONSE_BYTES) {
    return { notice: 'Response body melebihi batas 50 KB dan tidak ditampilkan.' };
  }
  try { return JSON.parse(content); } catch { return { text: content }; }
}

async function writeEvidence(evidence) {
  var parsed = evidence.parsed;
  var response = evidence.response;
  var data = evidence.data;
  var error = evidence.error;
  var secrets = evidence.secrets || [];
  var issue = process.env.ISSUE_NUMBER || '?';
  var status = response ? response.status : 'N/A';
  var method = parsed ? parsed.method : 'N/A';
  var url = parsed ? parsed.url.toString() : '(request belum valid)';
  var lines = ['## Sf Request — BFI_PROD — Issue #' + issue, '',
    'Status: **' + (error ? 'FAILED' : response && response.ok ? 'SUCCESS' : 'FAILED') + '** · HTTP ' + status + ' · Method ' + method, ''];
  if (parsed) {
    var soql = parsed.url.searchParams.get('q');
    if (soql && /^\/services\/data\/v[0-9]+\.[0-9]+\/(?:query|tooling\/query)/.test(parsed.url.pathname)) {
      lines.push('SOQL:', '```sql', soql, '```', '');
    }
    lines.push('<details>', '<summary>cURL (credential masked)</summary>', '', '```bash',
      'curl --request ' + parsed.method + ' ' + quoteShell(url) + ' \\',
      "  --header 'Authorization: Bearer [HIDDEN]'" + (parsed.body !== undefined ? ' \\' : ''));
    if (parsed.body !== undefined) lines.push("  --header 'Content-Type: application/json' \\", '  --data ' + quoteShell(parsed.body));
    lines.push('```', '', '</details>', '');
  }
  lines.push('### Response', '', '<details>', '<summary>Response JSON — HTTP ' + status + '</summary>', '');
  if (error) {
    lines.push('Error: `' + String(error.message || error).split('`').join("'") + '`', '');
  }
  lines.push('```json',
    JSON.stringify(sanitize(data === undefined || data === null ? { notice: 'Tidak tersedia.' } : data, secrets), null, 2),
    '```', '', '</details>', '');
  var markdown = lines.join('\n');
  markdown = sanitize(markdown, secrets);
  // Full, sanitized evidence remains intact; 55 KB applies only to the Issue comment.
  await fs.writeFile(EVIDENCE_FILE, markdown, { mode: 0o600 });
  var bytes = Buffer.byteLength(markdown, 'utf8');
  var sha256 = createHash('sha256').update(markdown, 'utf8').digest('hex');
  var runId = process.env.GITHUB_RUN_ID || 'unknown';
  var runUrl = 'https://github.com/' + (process.env.GITHUB_REPOSITORY || 'bfipbf/GPT-PBF') + '/actions/runs/' + runId;
  // Render the same comment as a normal request. Only the collapsible response body differs.
  // The artifact URL is replaced after upload by sf.yaml.
  var responseStart = lines.findIndex((line) => line === '```json');
  if (responseStart < 0) throw new Error('EVIDENCE_FAILED: response renderer not found');
  var summaryLines = lines.slice(0, responseStart);
  summaryLines.push(
    '[Download response lengkap (.md)]({{SF_ARTIFACT_URL}})',
    '',
    'Evidence size: ' + bytes + ' bytes · SHA-256: \`' + sha256 + '\` · Run ID: ' + runId,
    '',
    '</details>',
    ''
  );
  var summary = sanitize(summaryLines.join('\n'), secrets);
  if (Buffer.byteLength(summary, 'utf8') > COMMENT_LIMIT_BYTES) {
    throw new Error('EVIDENCE_FAILED: fallback comment exceeds limit; reduce request size');
  }
  await fs.writeFile(SUMMARY_FILE, summary, { mode: 0o600 });
  console.log('Evidence bytes=' + bytes + ' SHA256=' + sha256 + ' commentLimit=' + COMMENT_LIMIT_BYTES);
}

async function main() {
  var parsed;
  var response;
  var data;
  var accessToken;
  try {
    parsed = validateRequest(parseIssueRequest(issueBody));
    if (!clientId || !clientSecret) {
      throw new Error('GitHub Secrets SF_CLIENT_ID / SF_CLIENT_SECRET belum lengkap.');
    }
    var auth = await fetch(instanceUrl + '/services/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret,
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    });
    if (!auth.ok) {
      let code = 'unknown';
      try {
        const payload = await auth.json();
        if (typeof payload?.error === 'string' && /^[a-z0-9_]{1,60}$/i.test(payload.error)) {
          code = payload.error;
        }
      } catch {}
      throw new Error('OAuth Salesforce gagal: HTTP ' + auth.status + ' (' + code + ')');
    }
    var tokenPayload = await auth.json();
    accessToken = tokenPayload ? tokenPayload.access_token : null;
    if (typeof accessToken !== 'string' || !accessToken) throw new Error('OAuth tidak memberikan access_token.');
    if (process.env.GITHUB_ACTIONS === 'true') process.stdout.write('::add-mask::' + accessToken + '\n');

    parsed.headers.set('Authorization', 'Bearer ' + accessToken);
    response = await fetch(parsed.url, {
      method: parsed.method,
      headers: parsed.headers,
      body: parsed.body,
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    });
    data = compactFlowMetadata(await readResponse(response));
    await writeEvidence({ parsed, response, data, secrets: [clientId, clientSecret, accessToken] });
    console.log('Issue #' + (process.env.ISSUE_NUMBER || '?') + ': ' + parsed.method + ' Salesforce PROD HTTP ' + response.status);
    if (!response.ok) process.exitCode = 1;
  } catch (error) {
    console.error('SF API FAILED: detail hanya pada private evidence.');
    await writeEvidence({ parsed, response, data, error, secrets: [clientId, clientSecret, accessToken] });
    process.exitCode = 1;
  }
}

if (process.env.SF_EVIDENCE_TEST_MODE !== 'true') await main();

export { writeEvidence, sanitize };
