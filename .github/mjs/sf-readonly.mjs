import fs from 'node:fs/promises';

const event = JSON.parse(await fs.readFile(process.env.GITHUB_EVENT_PATH,'utf8'));
const body = event.issue?.body ?? '';
const file = (process.env.RUNNER_TEMP ?? '/tmp') + '/sf-evidence.md';
const origin = 'https://ptbfifinance.my.salesforce.com';
const summary = {org:'BFI_PROD', operation:'READ_ONLY', run:process.env.GITHUB_RUN_ID, status:'FAILED'};
let failed = false;

try {
  if (process.env.SF_BFI_PROD_LOGIN_URL && process.env.SF_BFI_PROD_LOGIN_URL !== origin)
    throw Error('ORG_NOT_ALLOWLISTED');
  const heads = [...body.matchAll(/^### Sf Request[ \t]*$/gm)];
  if (heads.length !== 1) throw Error('REQUEST_HEADING_INVALID');
  const section = body.slice(heads[0].index + heads[0][0].length).split(/^#{1,3}\s+/m)[0];
  const fences = [...section.matchAll(/```json[ \t]*\r?\n([\s\S]*?)\r?\n```/gi)];
  if (fences.length !== 1 || fences[0][1].length > 10000) throw Error('JSON_BLOCK_INVALID');
  const input = JSON.parse(fences[0][1]);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('INVALID_REQUEST');
  if (Object.keys(input).some(k=>!['url','options'].includes(k))) throw Error('REQUEST_FIELDS_INVALID');
  if ((input.options?.method ?? 'GET').toUpperCase() !== 'GET') throw Error('METHOD_NOT_ALLOWED');
  if (input.options?.body !== undefined || input.options?.headers !== undefined) throw Error('CUSTOM_BODY_OR_HEADERS_NOT_ALLOWED');
  const url = new URL(input.url);
  if (url.origin !== origin || url.username || url.password || url.hash) throw Error('HOST_NOT_ALLOWED');
  if (!/^\/services\/data\/v[0-9]+\.[0-9]+\/(query|queryAll|tooling\/query|tooling\/queryAll)$/.test(url.pathname))
    throw Error('ENDPOINT_NOT_ALLOWED');
  const q = url.searchParams.get('q') ?? '';
  if ([...url.searchParams.keys()].some(k=>k!=='q') || !/^SELECT\s+/i.test(q.trim()) ||
     /[;\x00-\x1f]/.test(q) || q.length>8000) throw Error('SOQL_NOT_ALLOWED');
  const clientId = process.env.SF_CLIENT_ID, clientSecret=process.env.SF_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw Error('OAUTH_CONFIG_MISSING');
  const auth = await fetch(origin+'/services/oauth2/token',{
    method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'client_credentials',client_id:clientId,client_secret:clientSecret}),
    redirect:'error',signal:AbortSignal.timeout(20000)
  });
  if (!auth.ok) throw Error('OAUTH_HTTP_'+auth.status);
  const token=(await auth.json()).access_token;
  if(typeof token!=='string'||!token) throw Error('OAUTH_TOKEN_MISSING');
  if (process.env.GITHUB_ACTIONS === 'true') process.stdout.write('::add-mask::'+token+'\n');
  const response=await fetch(url,{headers:{Authorization:'Bearer '+token,Accept:'application/json'},
    redirect:'error',signal:AbortSignal.timeout(25000)});
  summary.http=response.status;
  const text=await response.text();
  if (Buffer.byteLength(text)>200000) throw Error('RESPONSE_TOO_LARGE');
  const parsed=JSON.parse(text);
  summary.soql=q;
  summary.endpoint=url.pathname;
  summary.response=parsed;
  summary.status=response.ok?'SUCCESS':'FAILED';
  if(!response.ok) failed=true;
} catch(e) {
  failed=true;
  summary.error=String(e.message || 'UNKNOWN').replace(/[^A-Z_0-9]/g,'_').slice(0,80);
}
await fs.writeFile(file, '# Salesforce read-only evidence\n\n'+'```json\n'+JSON.stringify(summary,null,2)+'\n```\n',{mode:0o600});
console.log('SF read-only request: '+(failed?'FAILED':'SUCCESS')+' (private evidence only)');
if(failed) process.exitCode=1;
