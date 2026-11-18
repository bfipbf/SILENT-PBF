import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';

const token=process.env.PRIVATE_PBF_TOKEN;
const actor=process.env.GITHUB_ACTOR;
const issueNumber=Number(process.env.MUTATION_PRIVATE_ISSUE);
const expectedId=process.env.MUTATION_REQUEST_ID||'';
const allowed=new Set(['bfipbf','098595','jimmytobing']);
if(!allowed.has(actor)||!token||!Number.isSafeInteger(issueNumber)||issueNumber<1)
  throw Error('BLOCKED_PREFLIGHT');
const headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json',
  'X-GitHub-Api-Version':'2022-11-28'};
async function read(path){
  const r=await fetch('https://api.github.com/repos/bfipbf/PRIVATE-PBF'+path,
    {headers,redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw Error('PRIVATE_READ_HTTP_'+r.status);
  return r.json();
}
const issue=await read('/issues/'+issueNumber);
if(issue.pull_request||!allowed.has(issue.user?.login))throw Error('BLOCKED_AUTHOR');
const section=String(issue.body||'').split(/^### Mutation Request[ \t]*$/m);
if(section.length!==2)throw Error('INVALID_HEADING');
const remainder=section[1].split(/^#{1,3}\s+/m)[0];
const fence=String.fromCharCode(96,96,96);
const re=new RegExp(fence+'json[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n'+fence,'gi');
const blocks=[...remainder.matchAll(re)];
if(blocks.length!==1||Buffer.byteLength(blocks[0][1])>10000)throw Error('INVALID_JSON_BLOCK');
const request=JSON.parse(blocks[0][1]);
if(!request||typeof request!=='object'||Array.isArray(request))throw Error('INVALID_REQUEST');
const keys=Object.keys(request);
if(keys.some(k=>!['requestId','org','kind','reason','payloadSha256'].includes(k)))
  throw Error('UNKNOWN_REQUEST_FIELDS');
if(request.org!=='BFI_PROD'||!['SF_POST','SF_DML','DEPLOY','JIM_POST'].includes(request.kind))
  throw Error('INVALID_OPERATION');
if(typeof request.requestId!=='string'||!/^PBF-[A-Z0-9-]{10,70}$/.test(request.requestId)||
   request.requestId!==expectedId)throw Error('REQUEST_ID_INVALID');
if(typeof request.reason!=='string'||request.reason.length<12||request.reason.length>1000)
  throw Error('REASON_INVALID');
if(typeof request.payloadSha256!=='string'||!/^[a-f0-9]{64}$/.test(request.payloadSha256))
  throw Error('PAYLOAD_HASH_INVALID');
const comments=[];
for(let page=1;page<=10;page++){
 const x=await read('/issues/'+issueNumber+'/comments?per_page=100&page='+page);
 if(!Array.isArray(x))throw Error('COMMENTS_INVALID');
 comments.push(...x);
 if(x.length<100)break;
 if(page===10)throw Error('COMMENTS_LIMIT');
}
const marker='<!-- pbf-mutation-executed:'+request.requestId+' -->';
if(comments.some(c=>typeof c.body==='string'&&c.body.includes(marker)))
  throw Error('REPLAY_BLOCKED');
const digest=createHash('sha256').update(blocks[0][1]).digest('hex');
const summary={result:'PREFLIGHT_ONLY',org:request.org,operation:request.kind,
  requestId:request.requestId,requestDigest:digest,privateIssue:issueNumber,
  payloadSha256:request.payloadSha256,notice:'No Salesforce or external mutation was performed'};
const out=(process.env.RUNNER_TEMP||'/tmp')+'/mutation-preflight.json';
await fs.writeFile(out,JSON.stringify(summary,null,2),{mode:0o600});
console.log('Mutation preflight validated. No PROD mutation executed.');
