import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';

const OWNER='bfipbf', PRIVATE='bfipbf/PRIVATE-PBF', PUBLIC='bfipbf/SILENT-PBF';
const envName='prod-write-approval';
const token=process.env.PRIVATE_PBF_TOKEN, publicToken=process.env.GITHUB_TOKEN;
const apiKey=process.env.SF_BFI_PROD_APIKEY, clientId=process.env.SF_CLIENT_ID;
const clientSecret=process.env.SF_CLIENT_SECRET;
const issueNo=Number(process.env.PRIVATE_ISSUE_NUMBER);
const expected=process.env.REQUEST_ID;
const actor=process.env.GITHUB_ACTOR;
const allowed=new Set(['bfipbf','jimmytobing','098595']);
const origin='https://ptbfifinance.my.salesforce.com';
if(!allowed.has(actor)||!Number.isSafeInteger(issueNo)||issueNo<1||
  !token||!publicToken||!expected||!apiKey||!clientId||!clientSecret)throw Error('PRECONDITIONS_FAILED');

async function github(repo,path,auth=token,method='GET',body){
  const r=await fetch('https://api.github.com/repos/'+repo+path,{
    method,redirect:'error',signal:AbortSignal.timeout(15000),
    headers:{Authorization:'Bearer '+auth,Accept:'application/vnd.github+json',
      'X-GitHub-Api-Version':'2022-11-28'},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  if(!r.ok)throw Error('GITHUB_API_'+r.status);
  return r.json();
}

// Fail closed when protection is not configured. A named environment alone is not approval.
const protection=await github(PUBLIC,'/environments/'+envName,publicToken);
const reviewerRule=(protection.protection_rules||[]).find(r=>r.type==='required_reviewers');
if(!reviewerRule||!Array.isArray(reviewerRule.reviewers)||reviewerRule.reviewers.length===0)
  throw Error('APPROVAL_RULE_MISSING');
if(protection.prevent_self_review!==true)throw Error('SELF_REVIEW_NOT_DISABLED');

const issue=await github(PRIVATE,'/issues/'+issueNo);
if(issue.pull_request||!allowed.has(issue.user?.login))throw Error('PRIVATE_AUTHOR_NOT_ALLOWED');
const body=String(issue.body||'');
const headings=[...body.matchAll(/^### Jim POST[ \t]*$/gm)];
if(headings.length!==1)throw Error('HEADING_INVALID');
const section=body.slice(headings[0].index+headings[0][0].length).split(/^#{1,3}\s+/m)[0];
const f=String.fromCharCode(96,96,96);
const expression=new RegExp(f+'json[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n'+f,'gi');
const matches=[...section.matchAll(expression)];
if(matches.length!==1||Buffer.byteLength(matches[0][1])>10000)throw Error('JSON_INVALID');
const req=JSON.parse(matches[0][1]);
if(!req||typeof req!=='object'||Array.isArray(req)||
  Object.keys(req).some(k=>!['requestId','url','body','reason'].includes(k)))
  throw Error('REQUEST_FIELDS_INVALID');
if(req.requestId!==expected||!/^PBF-[A-Z0-9-]{10,70}$/.test(expected))
  throw Error('REQUEST_ID_MISMATCH');
if(typeof req.reason!=='string'||req.reason.length<12)throw Error('REASON_MISSING');
if(!req.body||typeof req.body!=='object'||Array.isArray(req.body))throw Error('BODY_INVALID');
const url=new URL(req.url);
if(url.protocol!=='https:'||url.username||url.password||url.hash||
  (url.port&&url.port!=='443')||!url.hostname.includes('.')||
  /^(?:\d{1,3}\.){3}\d{1,3}$/.test(url.hostname))throw Error('URL_INVALID');

const comments=[];
for(let page=1;page<=10;page++){
  const rows=await github(PRIVATE,'/issues/'+issueNo+'/comments?per_page=100&page='+page);
  comments.push(...rows);
  if(rows.length<100)break;
  if(page===10)throw Error('COMMENTS_LIMIT');
}
const marker='<!-- pbf-jim-post-execution:'+expected+' -->';
if(comments.some(c=>typeof c.body==='string'&&c.body.includes(marker)))
  throw Error('REPLAY_BLOCKED');

const auth=await fetch(origin+'/services/oauth2/token',{
 method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
 body:new URLSearchParams({grant_type:'client_credentials',client_id:clientId,client_secret:clientSecret}),
 redirect:'error',signal:AbortSignal.timeout(20000)});
if(!auth.ok)throw Error('OAUTH_HTTP_'+auth.status);
const accessToken=(await auth.json()).access_token;
if(!accessToken)throw Error('OAUTH_TOKEN_MISSING');
if(process.env.GITHUB_ACTIONS==='true')process.stdout.write('::add-mask::'+accessToken+'\n');
async function tooling(q){
 const r=await fetch(origin+'/services/data/v68.0/tooling/query?q='+encodeURIComponent(q),
  {headers:{Authorization:'Bearer '+accessToken},redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error('TOOLING_HTTP_'+r.status);
 const d=await r.json();
 if(!d.done||!Array.isArray(d.records))throw Error('TOOLING_INCOMPLETE');
 return d.records;
}
const regs=await tooling('SELECT Id, NamedCredential, NamedCredentialReferenceId, Status FROM ExternalServiceRegistration');
const creds=await tooling('SELECT Id, DeveloperName FROM NamedCredential');
const byId=new Map(creds.map(c=>[c.Id,c])),byName=new Map(creds.map(c=>[c.DeveloperName,c]));
const ids=new Set();
for(const s of regs.filter(s=>String(s.Status).toLowerCase()==='complete')){
 const c=s.NamedCredentialReferenceId?byId.get(s.NamedCredentialReferenceId):byName.get(s.NamedCredential);
 if(c)ids.add(c.Id);
}
const hosts=new Set();
for(const id of ids){
 if(!/^[A-Za-z0-9]{15,18}$/.test(id))continue;
 const row=await tooling("SELECT Id, Metadata FROM NamedCredential WHERE Id = '"+id+"' LIMIT 1");
 const m=row[0]?.Metadata||{},p=m.namedCredentialParameters||m.namedCredentialParameter||[];
 const params=Array.isArray(p)?p:[p];
 const raw=params.find(v=>String(v?.parameterType||v?.type).toLowerCase()==='url')?.parameterValue||m.endpoint||m.url;
 if(typeof raw==='string')try{
  const u=new URL(raw);
  if(u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443'))hosts.add(u.origin);
 }catch{}
}
if(!hosts.has(url.origin))throw Error('HOST_NOT_REGISTERED_LIVE');
const payload=JSON.stringify(req.body);
const sha=createHash('sha256').update(payload).digest('hex');
const run=process.env.GITHUB_RUN_ID;
const claim=marker+'\nState: STARTED (do not replay even if timeout)\nRun: '+run+
 '\nPayload SHA256: '+sha+'\nHost: '+url.origin;
await github(PRIVATE,'/issues/'+issueNo+'/comments',token,'POST',{body:claim});
let status='UNKNOWN',http=null,response=null;
try{
 const r=await fetch(url,{method:'POST',headers:{'X-Apikey':apiKey,Accept:'application/json',
  'Content-Type':'application/json'},body:payload,redirect:'error',signal:AbortSignal.timeout(30000)});
 http=r.status;
 const raw=await r.text();
 response=Buffer.byteLength(raw)>50000?{notice:'RESPONSE_TOO_LARGE'}:(()=>{
  try{return JSON.parse(raw)}catch{return {text:raw}}})();
 status=r.ok?'SUCCESS':'FAILED';
}catch{status='UNKNOWN_NETWORK_OUTCOME'}
const scrub = value => {
  let s=JSON.stringify(value);
  for(const secret of [apiKey,clientId,clientSecret,accessToken]) if(secret) s=s.split(secret).join('[HIDDEN]');
  return JSON.parse(s);
};
const result={kind:'JIM_POST',requestId:expected,runId:run,status,http,
  payloadSha256:sha,endpoint:url.origin+url.pathname,response:scrub(response)};
await github(PRIVATE,'/issues/'+issueNo+'/comments',token,'POST',
 {body:'## Jim POST result (private)\n'+f+'json\n'+JSON.stringify(result,null,2)+'\n'+f});
console.log('Jim POST finished; response stored privately, never in public logs');
if(status!=='SUCCESS')process.exitCode=1;
