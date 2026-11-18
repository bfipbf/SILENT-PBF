import fs from 'node:fs/promises';
const event=JSON.parse(await fs.readFile(process.env.GITHUB_EVENT_PATH,'utf8'));
const allowed=new Set(['bfipbf','jimmytobing','098595']);
if(!allowed.has(event.sender?.login)||!allowed.has(event.issue?.user?.login)||
   !Number.isSafeInteger(event.issue?.number)||event.issue?.pull_request)
  throw Error('ISSUE_ACTOR_OR_AUTHOR_NOT_ALLOWED');
const text=String(event.issue.body||'');
const headings=[...text.matchAll(/^### Jim POST Request[ \t]*$/gm)];
if(headings.length!==1)throw Error('JIM_POST_HEADING_INVALID');
const section=text.slice(headings[0].index+headings[0][0].length).split(/^#{1,3}\s+/m)[0];
const tick=String.fromCharCode(96,96,96);
const match=[...section.matchAll(new RegExp(tick+'json[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n'+tick,'gi'))];
if(match.length!==1||Buffer.byteLength(match[0][1])>2048)throw Error('POST_REFERENCE_INVALID');
const request=JSON.parse(match[0][1]);
if(!request||Array.isArray(request)||typeof request!=='object'||
 Object.keys(request).some(k=>!['privateIssue','requestId'].includes(k)))
 throw Error('POST_REFERENCE_FIELDS_INVALID');
const privateIssue=request.privateIssue;
const id=request.requestId;
if(!Number.isSafeInteger(privateIssue)||privateIssue<1||
 typeof id!=='string'||!/^PBF-[A-Z0-9-]{10,70}$/.test(id))
 throw Error('POST_REFERENCE_VALUES_INVALID');
if(!process.env.GITHUB_OUTPUT)throw Error('OUTPUT_FILE_MISSING');
await fs.appendFile(process.env.GITHUB_OUTPUT,'private_issue='+privateIssue+'\nrequest_id='+id+'\n');
console.log('Jim POST reference validated (private payload not read; no callout)');
