// Local maintenance import. Uses the initialized owner, as manage.mjs import does;
// never reads passwords or sessions. Defaults to a SQLite snapshot rehearsal.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {DatabaseSync,backup} from 'node:sqlite';
import assert from 'node:assert/strict';
const args=process.argv.slice(2),filename=args.shift();
if(!filename)throw new Error('Usage: node scripts/data-tools/import-customer-followup.mjs <private-payload.json> [--plan private-plan.json] [--build directory] [--data directory] [--report private-report.json] [--apply --preflight private-report.json]');
const options={};while(args.length){const key=args.shift();if(key==='--apply'){options.apply=true;continue;}if(!['--plan','--build','--data','--report','--preflight'].includes(key)||!args.length)throw new Error('Unexpected option');options[key.slice(2)]=args.shift();}
const sha=b=>createHash('sha256').update(b).digest('hex');
const sourceData=path.resolve(options.data||'lan-data'),dist=path.resolve(options.build||'lan-dist');
const bytes=await fs.readFile(filename),payload=JSON.parse(bytes);
assert.equal(payload.format,'doon-customer-followup-v1');
const planBytes=options.plan?await fs.readFile(options.plan):Buffer.from('{}'),plan=JSON.parse(planBytes);
if(plan.sourceKey)assert.equal(plan.sourceKey,payload.sourceKey);
const bundleHash=sha(await fs.readFile(path.join(dist,'workspace-api.mjs')));
const at=new Date().toISOString(),report=path.resolve(options.report||'test-output/customer-followup-import-'+at.replace(/[:.]/g,'-')+'.json');
const input={payloadHash:sha(bytes),planHash:sha(planBytes),bundleHash,sourceData};
if(options.apply){
 assert(options.preflight,'Production import requires a successful rehearsal report');
 const prior=JSON.parse(await fs.readFile(options.preflight,'utf8'));
 assert.equal(prior.mode,'rehearsal');assert.equal(prior.success,true);assert.deepEqual(prior.input,input);
 assert(Date.now()-Date.parse(prior.at)<24*60*60*1000,'Rehearsal expired');
}
const checkpointDir=path.resolve('test-output/customer-followup-'+(options.apply?'backup-':'rehearsal-')+at.replace(/[:.]/g,'-'));
await fs.mkdir(checkpointDir,{recursive:true});
const original=new DatabaseSync(path.join(sourceData,'workspace.sqlite'),{readOnly:true});
try{await backup(original,path.join(checkpointDir,'workspace.sqlite'));}finally{original.close();}
await fs.cp(path.join(sourceData,'files'),path.join(checkpointDir,'files'),{recursive:true,errorOnExist:true,force:false});
const checked=new DatabaseSync(path.join(checkpointDir,'workspace.sqlite'),{readOnly:true});
try{assert.equal(Object.values(checked.prepare('PRAGMA integrity_check').get())[0],'ok');}finally{checked.close();}
process.env.DOON_DATA_DIR=options.apply?sourceData:checkpointDir;
const runtime=await import(pathToFileURL(path.join(dist,'runtime.mjs')).href);
const api=await import(pathToFileURL(path.join(dist,'workspace-api.mjs')).href);
const recordRows=()=>runtime.db.prepare('SELECT id,kind,data FROM records ORDER BY id').all();
const metaHash=()=>sha(JSON.stringify(runtime.db.prepare('SELECT id,username,member_id,must_change,created_at FROM local_accounts ORDER BY id').all()));
const before=recordRows(),beforeMeta=metaHash(),beforeMap=new Map(before.map(row=>[row.id,row]));
const beforeFiles={};
for(const entry of await fs.readdir(path.join(checkpointDir,'files'),{withFileTypes:true})){
 assert(entry.isFile(),'Unexpected file-store subdirectory');beforeFiles[entry.name]=sha(await fs.readFile(path.join(checkpointDir,'files',entry.name)));
}
const admins=before.filter(r=>r.kind==='member').map(r=>JSON.parse(r.data)).filter(m=>m.owner&&m.active&&m.role==='admin');
assert.equal(admins.length,1,'Exactly one initialized active owner is required');
const admin=admins[0];assert(admin.userId,'Initialized owner must have a local identity');
assert(runtime.db.prepare('SELECT id FROM local_accounts WHERE member_id=?').get(admin.id),'Owner account missing');
const context={identity:{userId:admin.userId,email:admin.email,displayName:admin.name,fullName:admin.name}};
const call=async(action,body)=>{
 const req=new Request('http://localhost:8787/api/workspace/'+action,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 const response=await runtime.context.run(context,()=>api[body?'POST':'GET'](req,{params:Promise.resolve({action})}));
 const result=await response.json();if(!response.ok)throw new Error(action+': '+(result.error||response.status));return result;
};
let result={mode:options.apply?'apply':'rehearsal',at,input,success:false,checkpointDir};
try{
 const newCustomerResults=[],allowedMutable=new Set();
 for(const entry of plan.newCustomers||[]){
  assert.equal(entry.customerCode,'','New lead customer codes must remain empty');
  assert(payload.followups.some(f=>f.sourceId===entry.sourceId),'Customer plan has no source followup');
  const existing=runtime.records().find(r=>r.kind==='customer_account'&&r.customer.trim().toLowerCase()===entry.customer.trim().toLowerCase());
  let customer;
  if(existing){
   assert.equal(existing.notes,entry.notes,'Existing same-name customer does not belong to this migration');
   assert.equal(existing.customerCode,'','Previously created lead has been numbered; review before retry');
   assert.deepEqual(existing.salesMemberIds,entry.salesMemberIds,'Lead ownership changed');
   customer=existing;
  }else{
   const {sourceId,...fields}=entry;
   customer=(await call('customer-save',{...fields,createOnly:true})).item;
  }
  assert.equal(customer.customerCode,'');
  payload.followups.find(f=>f.sourceId===entry.sourceId).customerId=customer.id;
  const promotion=(plan.promotions||[]).find(p=>p.sourceId===entry.sourceId);if(promotion)promotion.customerId=customer.id;
  newCustomerResults.push({sourceId:entry.sourceId,customerId:customer.id,customer:customer.customer,customerCode:customer.customerCode,existing:!!existing});
 }
 if(plan.teamId&&newCustomerResults.length){
  const team=runtime.records().find(r=>r.kind==='customer_project_team'&&r.id===plan.teamId);assert(team?.active,'Migration team missing');
  const customerIds=[...new Set([...team.customerIds,...newCustomerResults.map(r=>r.customerId)])];
  if(customerIds.length!==team.customerIds.length){
   await call('customer-project-team-save',{token:randomUUID(),id:team.id,version:team.version,name:team.name,leaderIds:team.leaderIds,salesMemberIds:team.salesMemberIds,serviceMemberIds:team.serviceMemberIds,customerIds,active:true});
   allowedMutable.add(team.id);
  }
 }
 const imported=await call('customer-project-followup-import',payload);
 const promoted=[];
 for(const entry of plan.promotions||[]){
  const id=imported.followups.find(row=>row.sourceId===entry.sourceId)?.id;assert(id,'Missing imported followup');
  const row=JSON.parse(runtime.db.prepare('SELECT data FROM records WHERE id=?').get(id).data);
  if(row.projectId){promoted.push({sourceId:entry.sourceId,followupId:id,projectId:row.projectId,existing:true});continue;}
  const item=await call('customer-project-followup-promote',{token:randomUUID(),id,version:row.version,customerId:entry.customerId,title:entry.title,description:entry.description,code:entry.code});
  promoted.push({sourceId:entry.sourceId,followupId:id,projectId:item.project.id});
 }
 // Reimport with a fresh request token exercises source identity, not token replay.
 const repeated=await call('customer-project-followup-import',{...payload,token:randomUUID()});
 assert.equal(Object.values(repeated.created).reduce((a,b)=>a+b,0),0,'Repeat import created duplicates');
 const after=recordRows(),afterMap=new Map(after.map(row=>[row.id,row]));
 const mutable=new Set([...allowedMutable,...promoted.filter(p=>!p.existing).map(p=>p.followupId)]);
 const changed=[];for(const row of before){const current=afterMap.get(row.id);assert(current,'Existing record disappeared');if(row.data!==current.data){assert(mutable.has(row.id),'Unrelated record changed: '+row.id);changed.push(row.id);}}
 assert.equal(metaHash(),beforeMeta,'Account metadata changed');
 const additions=after.filter(row=>!beforeMap.has(row.id));
 const allowed=new Set(['customer_project_followup','customer_project_followup_mail','customer_project_followup_source','customer_project_followup_request','customer_project','customer_project_request','customer_account','audit']);
 for(const row of additions)assert(allowed.has(row.kind),'Unexpected record kind: '+row.kind);
 const all=after.map(row=>JSON.parse(row.data));
 const migrated=all.filter(r=>r.kind==='customer_project_followup'&&r.sourceKey===payload.sourceKey&&r.ownerId===payload.ownerId);
 const mails=all.filter(r=>r.kind==='customer_project_followup_mail'&&r.sourceKey===payload.sourceKey&&r.ownerId===payload.ownerId);
 assert.equal(migrated.length,payload.followups.length);assert.equal(mails.length,payload.mails.length);
 for(const source of payload.followups){const actual=migrated.find(r=>r.sourceId===source.sourceId);assert.deepEqual(actual.source,source.source);}
 for(const source of payload.mails){const actual=mails.find(r=>r.sourceId===source.sourceId);assert.deepEqual(actual.source,source.source);assert.equal(actual.draftStatus,source.draftStatus);}
 for(const [filename,hash] of Object.entries(beforeFiles))assert.equal(sha(await fs.readFile(path.join(process.env.DOON_DATA_DIR,'files',filename))),hash,'Original attachment changed');
 assert.equal(Object.values(runtime.db.prepare('PRAGMA integrity_check').get())[0],'ok');
 const owner=all.find(r=>r.id===payload.ownerId&&r.kind==='member');assert(owner?.active&&owner.userId);
 const ownerView=await runtime.context.run({identity:{userId:owner.userId,email:owner.email,displayName:owner.name}},()=>api.GET(new Request('http://localhost:8787/api/workspace/customer-project-followup-data'),{params:Promise.resolve({action:'customer-project-followup-data'})}));
 assert.equal(ownerView.status,200);const visible=await ownerView.json();
 assert.equal(visible.followups.filter(r=>r.sourceKey===payload.sourceKey).length,payload.followups.length,'Owner cannot see all imported followups');
 assert.equal(visible.mails.filter(r=>r.sourceKey===payload.sourceKey).length,payload.mails.length,'Owner cannot see all imported mails');
 result={...result,success:true,imported,promoted,newCustomers:newCustomerResults,repeat:repeated,counts:{followups:migrated.length,checklistItems:migrated.reduce((n,r)=>n+r.checklist.length,0),mails:mails.length,unassignedFollowups:migrated.filter(r=>!r.customerId).length,unassignedMails:mails.filter(r=>!r.followupIds.length).length,drafts:mails.filter(r=>r.draftStatus==='draft').length},preservedRecords:before.length-changed.length,changedIds:changed,additions: additions.reduce((a,r)=>(a[r.kind]=(a[r.kind]||0)+1,a),{}),integrity:'ok',ownerVisibilityVerified:true};
}catch(error){result.error=error.message;throw error;}finally{
 await fs.mkdir(path.dirname(report),{recursive:true});await fs.writeFile(report,JSON.stringify(result,null,2));runtime.db.close();
 console.log(JSON.stringify({mode:result.mode,success:result.success,counts:result.counts,report,checkpointDir,error:result.error}));
}
