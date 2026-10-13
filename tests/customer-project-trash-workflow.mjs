// Synthetic route checks. A rejected mutation must never reach database or attachment storage.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

let storageAccess=0;
const forbidden=()=>{storageAccess++;throw new Error('Rejected recycled-project mutation reached storage');};
globalThis.__trashWorkflowEnv={DB:{prepare:forbidden,batch:forbidden},BUCKET:{put:forbidden,get:forbidden}};
const output=path.resolve('test-output','customer-project-trash-workflow-'+process.pid);
await fs.mkdir(output,{recursive:true});
const outfile=path.join(output,'api.mjs');
await build({stdin:{contents:"export * from './lib/customer-workflow-files';export * from './lib/customer-project-followup';export * from './lib/customer-project-followup-api';export {communicationAccess} from './lib/unified-communication';export * from './lib/unified-communication-api';export * from './lib/handoff-framework-api';export * from './lib/handoff-business-api';export {businessAccess} from './lib/handoff-business';export * from './lib/framework-offboarding';export * from './lib/handoff-production-review';",resolveDir:process.cwd(),loader:'ts'},outfile,bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@':process.cwd()},plugins:[{name:'trash-workflow-bindings',setup(b){
 b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'synthetic'}));
 b.onResolve({filter:/chatgpt-auth$/},()=>({path:'auth',namespace:'synthetic'}));
 b.onLoad({filter:/.*/,namespace:'synthetic'},a=>({contents:a.path==='env'?'export const env=globalThis.__trashWorkflowEnv;':'export async function getChatGPTUser(){return null;}'}));
}}]});
const api=await import(pathToFileURL(outfile).href);
const alice={id:'alice',kind:'member',name:'Synthetic Alice',role:'sales',active:true},admin={...alice,id:'admin',name:'Synthetic admin',role:'admin'};
const customer={id:'customer',kind:'customer_account',customer:'Synthetic customer',customerCode:'SYNTH',active:true,salesMemberIds:['alice'],serviceMemberIds:[],salesName:alice.name};
const project={id:'recycled-project',kind:'customer_project',customerId:customer.id,salesMemberId:alice.id,code:'SYNTH-P',title:'Synthetic project',status:'active',version:2,trashedAt:'2026-10-13T12:00:00.000Z'};
const active={...project,id:'active-project',trashedAt:''};
const followupFields={ownerId:alice.id,customerId:customer.id,projectId:project.id,title:'Synthetic followup',category:'engineering',stars:0,status:'pending',followUpDate:'',notes:'Preserve original notes',nextAction:'Original next action',checklist:[]};
const followup={...followupFields,id:'recycled-followup',kind:'customer_project_followup',version:1,sourceKey:'synthetic-import',sourceId:'source-followup',sourceHash:'unused',source:{original:true}};
const activeFollowup={...followup,id:'active-followup',projectId:active.id};
const mail={id:'original-mail',kind:'customer_project_followup_mail',ownerId:alice.id,followupIds:[followup.id],subject:'Original synthetic email',body:'Preserve original email body',version:1};
const file={id:'original-file',kind:'customer_workflow_attachment',customerId:customer.id,projectId:project.id,folder:'03_图纸',title:'Original file',filename:'synthetic.png',fileVersion:'1',version:1,status:'有效',fileKey:'synthetic-only-key',hash:'synthetic-hash',size:8,contentType:'image/png',note:''};
const document={id:'original-document',kind:'customer_workflow_document',customerId:customer.id,projectId:project.id,version:1,content:'Original project document'};
const development={id:'original-development',kind:'customer_workflow_project',customerId:customer.id,projectId:project.id,version:1,stage:'需求了解',next:'Original next action',notes:'Original notes'};
const s={revision:1,records:[alice,admin,customer,project,active,followup,activeFollowup,mail,file,document,development]};
const original=structuredClone(s),token=()=>crypto.randomUUID();
const request=(action,body)=>new Request('https://synthetic.invalid/api/workspace/'+action,{method:body===undefined?'GET':'POST',headers:body instanceof FormData?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});
async function workflowGet(action){return (await api.customerWorkflowFileGet(action,request(action+'?customerId='+customer.id+'&projectId='+project.id),s,alice)).json();}
async function denied(fn,action,body,who=alice,status=409){await assert.rejects(()=>fn(action,request(action,body),s,who),e=>e.status===status);assert.deepEqual(s,original);assert.equal(storageAccess,0);}

for(const action of ['customer-workflow-project','customer-workflow-files','customer-workflow-project-document'])assert.equal((await workflowGet(action)).canWrite,false);
assert.equal((await workflowGet('customer-workflow-project')).project.notes,development.notes);
assert.equal((await workflowGet('customer-workflow-project-document')).document.content,document.content);
const visibleFiles=(await workflowGet('customer-workflow-files')).files;assert.equal(visibleFiles[0].filename,file.filename);assert.equal(Object.hasOwn(visibleFiles[0],'fileKey'),false);
assert.doesNotThrow(()=>api.workflowFileAccess(s,alice,file));
assert.doesNotThrow(()=>api.workflowFileAccess(s,alice,{customerId:customer.id,projectId:active.id},true));
assert.doesNotThrow(()=>api.workflowFileAccess(s,alice,{customerId:customer.id},true));
console.log('PASS recycled project workflow history and original metadata remain readable; write controls disabled, active projects and customer files unaffected');

const base={token:token(),customerId:customer.id,projectId:project.id,version:1};
const workflowMutations=[
 ['customer-workflow-project-save',{...base,stage:'需求了解',next:'Blocked change',notes:'Blocked change',reason:'Synthetic test'}],
 ['customer-workflow-project-log',{...base,stage:'需求了解',next:'Blocked change',result:'Blocked log'}],
 ['customer-workflow-project-document-save',{...base,content:'Blocked replacement',reason:'Synthetic test'}],
 ['customer-workflow-file-save',{...base,id:file.id,folder:file.folder,title:file.title,fileVersion:file.fileVersion,status:'已归档',note:'Blocked edit',reason:'Synthetic test'}]
];
for(const who of [alice,admin])for(const [action,body] of workflowMutations)await denied(api.customerWorkflowFilePost,action,{...body,token:token()},who);
const upload=new FormData();for(const [key,value] of Object.entries({token:token(),customerId:customer.id,projectId:project.id,folder:'03_图纸',title:'Blocked upload',fileVersion:'2'}))upload.set(key,value);upload.set('file',new File(['synthetic bytes'],'synthetic.png'));
await denied(api.customerWorkflowFilePost,'customer-workflow-file-upload',upload);
console.log('PASS workflow save/log/document edit/file edit/upload are blocked before storage, including administrator');

const feed=await (await api.customerProjectFollowupGet('customer-project-followup-data',request('customer-project-followup-data'),s,alice)).json();
assert.deepEqual(feed.followups.map(r=>r.id),[activeFollowup.id]);assert.deepEqual(feed.projects.map(r=>r.id),[active.id]);
assert.equal(feed.mails.find(r=>r.id===mail.id).body,mail.body);assert.equal(feed.mails.find(r=>r.id===mail.id).canClassify,false);
assert.equal(api.followupAccess(s,alice,followup),true);assert.equal(api.followupAccess(s,alice,followup,true),false);
assert.equal(api.followupMailAccess(s,alice,mail),true);assert.equal(api.followupMailAccess(s,alice,mail,true),false);
console.log('PASS daily followup/project choices hide recycled project while original email remains readable and unmodifiable');

for(const who of [alice,admin]){
 for(const projectId of [project.id,active.id,''])await denied(api.customerProjectFollowupPost,'customer-project-followup-save',{token:token(),id:followup.id,version:1,...followupFields,projectId},who,403);
 await denied(api.customerProjectFollowupPost,'customer-project-followup-save',{token:token(),...followupFields},who);
 await denied(api.customerProjectFollowupPost,'customer-project-followup-mail-classify',{token:token(),id:mail.id,version:1,followupIds:[]},who,403);
}
const freshMail={...mail,id:'unlinked-mail',followupIds:[]};s.records.push(freshMail);original.records.push(structuredClone(freshMail));
await denied(api.customerProjectFollowupPost,'customer-project-followup-mail-classify',{token:token(),id:freshMail.id,version:1,followupIds:[followup.id]},alice,403);
await denied(api.customerProjectFollowupPost,'customer-project-followup-import',{token:token(),format:'doon-customer-followup-v1',sourceKey:'synthetic-import',ownerId:alice.id,followups:[],mails:[{sourceId:'new-mail',followupSourceIds:[followup.sourceId],source:{synthetic:true}}],sourceFiles:[]},admin,403);
console.log('PASS clearing/rebinding original followup and unlinking/relinking/importing mail cannot bypass recycled-project write protection; zero storage access');

const bob={...alice,id:'bob',name:'Synthetic Bob'},context={customerId:customer.id,projectId:project.id,orderId:''};
const message={...context,id:'original-communication',kind:'unified_communication',version:1,channel:'email',title:'Original communication',sourceText:'Original body',sourceReference:'Synthetic source',occurredAt:'2026-10-13',draftText:'Original draft',internalNote:'',status:'draft',updatedAt:'2026-10-13T00:00:00.000Z'};
const drawing={...context,id:'original-business-drawing',kind:'handoff_business_source',type:'engineering_drawing',version:1,number:'SYNTH-DRAWING',status:'checked',fields:{versionLabel:'1',path:'synthetic drawing',drawingNumber:'SYNTH-DRAWING'},lines:[],sourceRefs:[],originRefs:[],sourceSnapshots:[],updatedAt:message.updatedAt};
const ordinaryOrder={id:'ordinary-order',kind:'order',customer:customer.customer,ownerEmail:'synthetic@example.invalid',salesName:alice.name,orderNo:'SYNTH-ORDER',workflowStatus:'业务待提交',lifecycle:'active'};
const added=[bob,message,drawing,ordinaryOrder,{id:api.productionReviewPolicyId,kind:'handoff_business_policy',version:1,drawingLeadMemberId:alice.id,engineeringSupervisorMemberId:admin.id}];
s.records.push(...added);original.records.push(...structuredClone(added));
assert.equal(api.communicationAccess(s,alice,context),true);assert.equal(api.communicationAccess(s,alice,context,true),false);
assert.equal(api.businessAccess(s,alice,drawing),true);assert.equal(api.businessAccess(s,alice,drawing,true),false);
assert.equal(api.communicationAccess(s,admin,{customerId:customer.id,projectId:'',orderId:ordinaryOrder.id},true),true);
assert.equal(api.communicationAccess(s,alice,{...context,projectId:active.id},true),true);
for(const [get,action] of [[api.unifiedCommunicationGet,'unified-communication-data'],[api.frameworkGet,'framework-channels'],[api.handoffBusinessGet,'handoff-business-data']]){
 const data=await (await get(action,request(action+(action==='framework-channels'?'?channel=email':'')),s,admin)).json();assert.deepEqual(data.projects.map(p=>p.id),[active.id]);
 const row=data.items.find(r=>r.id===(action==='handoff-business-data'?drawing.id:message.id));assert.ok(row,'Original record must remain in readable history');assert.equal(row.canWrite,false);
}
const savedFields={...context,channel:message.channel,title:message.title,sourceText:message.sourceText,sourceReference:message.sourceReference,occurredAt:message.occurredAt,draftText:message.draftText,internalNote:''};
await denied(api.unifiedCommunicationPost,'unified-communication-save',{token:token(),id:message.id,expectedVersion:1,...savedFields,projectId:''},alice,403);
await denied(api.unifiedCommunicationPost,'unified-communication-save',{token:token(),...savedFields},alice,403);
await denied(api.frameworkPost,'framework-message-process',{token:token(),id:message.id,expectedVersion:1,processed:true},alice,403);
const businessUpload=new FormData();for(const [key,value] of Object.entries({token:token(),id:drawing.id,expectedVersion:'1',note:'Synthetic attachment'}))businessUpload.set(key,value);businessUpload.set('file',new File(['synthetic bytes'],'synthetic.png'));
await denied(api.handoffBusinessPost,'handoff-business-attachment',businessUpload,alice,403);
console.log('PASS communication/framework/handoff project choices hide recycled projects; historical reads survive, edits and attachment writes cannot unlink around guard, ordinary orders remain writable');

assert.ok(api.productionReviewData(s,alice).drawings.some(r=>r.id===drawing.id),'Reviewer original drawing/attachment read scope must survive recycling');
const signatureAction='handoff-business-adoption-sign',signatureInput={token:token(),sourceId:drawing.id,expectedVersion:1,expectedPolicyVersion:1,decision:'return',note:'Synthetic return'};
await denied(api.productionReviewPost,signatureAction,signatureInput,alice);
const priorSignature={id:'handoff_business_request_'+signatureInput.token,kind:'handoff_business_request',actorId:alice.id,fingerprint:JSON.stringify({action:signatureAction,input:signatureInput})};s.records.push(priorSignature);original.records.push(structuredClone(priorSignature));
await denied(api.productionReviewPost,signatureAction,signatureInput,alice);
const notices=await (await api.frameworkGet('framework-notices',request('framework-notices'),s,alice)).json();assert.equal(notices.items.find(r=>r.id===drawing.id).canReceive,false);
await denied(api.frameworkPost,'framework-notice-receive',{token:token(),id:drawing.id,expectedVersion:1},alice);
console.log('PASS dedicated engineering signature and notice receipt routes block mutations while retaining original review evidence');

const inventory=await api.frameworkOffboardingInventory(s,alice);
for(const recordId of [project.id,followup.id,mail.id])assert.equal(inventory.some(item=>item.recordId===recordId),false);
assert.equal(inventory.some(item=>item.recordId===active.id),true);assert.equal(inventory.some(item=>item.recordId===customer.id),true);assert.equal(inventory.some(item=>item.recordId===ordinaryOrder.id),true);
assert.equal(api.frameworkOffboardingCandidate(s,alice,{recordId:project.id,kind:project.kind,mode:'id',roles:['sales'],blocker:'',requiresQuote:false},bob),false);
assert.equal(api.frameworkOffboardingCandidate(s,alice,{recordId:mail.id,kind:mail.kind,mode:'id',roles:['sales'],blocker:'',requiresQuote:false},bob),false);
assert.deepEqual(s,original);assert.equal(storageAccess,0);
console.log('PASS offboarding omits recycled assignments and stale plan candidates but keeps ordinary customer/order/active-project responsibilities');

delete project.trashedAt;
assert.equal(api.followupAccess(s,alice,followup,true),true);assert.equal(api.followupMailAccess(s,alice,mail,true),true);
assert.equal((await workflowGet('customer-workflow-files')).canWrite,true);
const restored=await (await api.customerProjectFollowupGet('customer-project-followup-data',request('customer-project-followup-data'),s,alice)).json();assert.equal(restored.followups.some(r=>r.id===followup.id),true);assert.equal(restored.projects.some(r=>r.id===project.id),true);
console.log('PASS restoring project restores normal workflow and followup access without rewriting child records');
delete globalThis.__trashWorkflowEnv;
