import fs from 'node:fs/promises';
const publicRepo = 'bfipbf/SILENT-PBF';
const privateRepo = 'bfipbf/PRIVATE-PBF';
const issueNumber = Number(process.env.ISSUE_NUMBER);
const token = process.env.PRIVATE_PBF_TOKEN;
const evidenceFile = process.env.EVIDENCE_FILE;
const runId = process.env.GITHUB_RUN_ID;
if (!Number.isSafeInteger(issueNumber) || issueNumber < 1 || !token ||
    !evidenceFile || !/^\d+$/.test(runId || '')) {
  throw Error('Private evidence preflight failed');
}
async function api(path, method='GET', body) {
  const result = await fetch('https://api.github.com/repos/' + privateRepo + path, {
    method,
    headers: { Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  if (!result.ok) throw Error('Private evidence GitHub HTTP ' + result.status);
  return result.json();
}
async function list(path) {
  const result=[];
  for (let page=1;page<=20;page++) {
    const rows=await api(path+(path.includes('?')?'&':'?')+'per_page=100&page='+page);
    if (!Array.isArray(rows)) throw Error('Private evidence pagination failed');
    result.push(...rows);
    if (rows.length<100) return result;
  }
  throw Error('Private evidence pagination limit');
}
const sourceMarker = '<!-- silent-pbf-issue:' + issueNumber + ' -->';
const issues = (await list('/issues?state=all')).filter(i=> !i.pull_request &&
  typeof i.body==='string' && i.body.includes(sourceMarker));
if(issues.length!==1) throw Error('Private evidence needs exactly one linked mirror');
const data=await fs.readFile(evidenceFile);
const maxBytes=58000;
let evidence=data.subarray(0,maxBytes).toString('utf8');
if (data.length>maxBytes) evidence+='\n\n[Private evidence truncated: GitHub comment size limit]';
const marker='<!-- silent-pbf-evidence-run:' + runId + ' -->';
const body='Source: https://github.com/'+ publicRepo +'/issues/'+issueNumber+
  '\nRun ID: '+runId+'\n'+marker+'\n\n'+evidence;
const comments=await list('/issues/'+issues[0].number+'/comments');
const matches=comments.filter(c=>typeof c.body==='string' && c.body.includes(marker));
if(matches.length>1) throw Error('Duplicate private evidence detected');
if(matches.length===1) {
  if(matches[0].body!==body) await api('/issues/comments/'+matches[0].id,'PATCH',{body});
} else {
  await api('/issues/'+issues[0].number+'/comments','POST',{body});
}
console.log('Private evidence published (content suppressed in public logs)');
