import fs from 'node:fs/promises';
const ev=JSON.parse(await fs.readFile(process.env.GITHUB_EVENT_PATH,'utf8'));
const out=(process.env.RUNNER_TEMP||'/tmp')+'/jim-evidence.md';
const sf='https://ptbfifinance.my.salesforce.com';
const report={org:'BFI_PROD',operation:'JIM_GET_READ_ONLY',status:'FAILED'};
let failed=true;
try{
  const text=ev.issue?.body||'';
  const h=[...text.matchAll(/^### Jim Request[ \t]*$/gm)];
  if(h.length!==1)throw Error('HEADING_INVALID');
  const section=text.slice(h[0].index+h[0][0].length).split(/^#{1,3}\s+/m)[0];
  const fence=String.fromCharCode(96,96,96);
  const re=new RegExp(fence+'json[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n'+fence,'gi');
  const blocks=[...section.matchAll(re)];
  if(blocks.length!==1||Buffer.byteLength(blocks[0][1])>10000)throw Error('JSON_INVALID');
  const req=JSON.parse(blocks[0][1]);
  if(!req||typeof req!=='object'||Array.isArray(req)||Object.keys(req).some(k=>!['url','method'].includes(k)))
    throw Error('REQUEST_INVALID');
  const method=String(req.method||'GET').toUpperCase();
  if(!['GET','HEAD'].includes(method))throw Error('METHOD_NOT_ALLOWED');
  const url=new URL(req.url);
  if(url.protocol!=='https:'||url.username||url.password||url.hash||
    (url.port&&url.port!=='443')||!url.hostname.includes('.')||
    /^(?:\d{1,3}\.){3}\d{1,3}$/.test(url.hostname))throw Error('URL_INVALID');
  if(process.env.SF_BFI_PROD_LOGIN_URL&&process.env.SF_BFI_PROD_LOGIN_URL!==sf)throw Error('ORG_MISMATCH');
  const id=process.env.SF_CLIENT_ID,secret=process.env.SF_CLIENT_SECRET,key=process.env.SF_BFI_PROD_APIKEY;
  if(!id||!secret||!key)throw Error('CREDENTIALS_MISSING');
  const auth=await fetch(sf+'/services/oauth2/token',{method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'client_credentials',client_id:id,client_secret:secret}),
    redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!auth.ok)throw Error('OAUTH_HTTP_'+auth.status);
  const token=(await auth.json()).access_token;
  if(!token)throw Error('OAUTH_TOKEN_MISSING');
  if(process.env.GITHUB_ACTIONS==='true')process.stdout.write('::add-mask::'+token+'\n');
  const tooling=async q=>{
    const res=await fetch(sf+'/services/data/v68.0/tooling/query?q='+encodeURIComponent(q),
      {headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(20000)});
    if(!res.ok)throw Error('TOOLING_HTTP_'+res.status);
    const obj=await res.json();
    if(!obj.done||!Array.isArray(obj.records))throw Error('TOOLING_INCOMPLETE');
    return obj.records;
  };
  const regs=await tooling('SELECT Id, NamedCredential, NamedCredentialReferenceId, Status FROM ExternalServiceRegistration');
  const credentials=await tooling('SELECT Id, DeveloperName FROM NamedCredential');
  const byId=new Map(credentials.map(c=>[c.Id,c]));
  const byName=new Map(credentials.map(c=>[c.DeveloperName,c]));
  const ids=new Set();
  for(const r of regs.filter(x=>String(x.Status).toLowerCase()==='complete')){
    const c=r.NamedCredentialReferenceId?byId.get(r.NamedCredentialReferenceId):byName.get(r.NamedCredential);
    if(c)ids.add(c.Id);
  }
  if(!ids.size)throw Error('NO_REGISTERED_CREDENTIAL');
  const hosts=new Set();
  for(const id of ids){
    if(!/^[A-Za-z0-9]{15,18}$/.test(id))continue;
    const rows=await tooling("SELECT Id, Metadata FROM NamedCredential WHERE Id = '"+id+"' LIMIT 1");
    const m=rows[0]?.Metadata||{};
    const pp=m.namedCredentialParameters||m.namedCredentialParameter||[];
    const arr=Array.isArray(pp)?pp:[pp];
    const raw=arr.find(p=>String(p?.parameterType||p?.type).toLowerCase()==='url')?.parameterValue||m.endpoint||m.url;
    if(typeof raw==='string')try{
      const u=new URL(raw);
      if(u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443'))hosts.add(u.origin);
    }catch{}
  }
  if(!hosts.has(url.origin))throw Error('HOST_NOT_REGISTERED_LIVE');
  const res=await fetch(url,{method,headers:{'X-Apikey':key,Accept:'application/json'},
    redirect:'error',signal:AbortSignal.timeout(25000)});
  const raw=method==='HEAD'?'':await res.text();
  if(Buffer.byteLength(raw)>50000)throw Error('RESPONSE_TOO_LARGE');
  report.http=res.status;
  report.method=method;
  report.endpoint=url.pathname;
  report.response=raw?JSON.parse(raw):{};
  report.status=res.ok?'SUCCESS':'FAILED';
  failed=!res.ok;
}catch(e){report.error=String(e?.message||'UNKNOWN').replace(/[^A-Z_0-9]/g,'_').slice(0,80);}
const tick=String.fromCharCode(96,96,96);
await fs.writeFile(out,'# Jim read-only evidence\n\n'+tick+'json\n'+JSON.stringify(report,null,2)+'\n'+tick+'\n',{mode:0o600});
console.log('Jim read-only '+(failed?'FAILED':'SUCCESS')+' (private evidence only)');
if(failed)process.exitCode=1;
