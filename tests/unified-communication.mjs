// Only synthetic records, an in-memory SQLite database and a disposable bundle.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {AsyncLocalStorage} from 'node:async_hooks';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const db=new DatabaseSync(':memory:');
for(const name of (await fs.readdir('drizzle')).filter(n=>n.endsWith('.sql')).sort())db.exec(await fs.readFile('drizzle/'+name,'utf8'));
class Statement{
 constructor(sql,args=[]){this.sql=sql;this.args=args;}
 bind(...args){return new Statement(this.sql,args);}
 async first(){return db.prepare(this.sql).get(...this.args)||null;}
 async all(){return {results:db.prepare(this.sql).all(...this.args)};}
 async run(){return db.prepare(this.sql).run(...this.args);}
}
const identity=new AsyncLocalStorage();
globalThis.__communicationTestIdentity=identity;
globalThis.__communicationTestEnv={DB:{prepare:sql=>new Statement(sql),batch:async statements=>{
 db.exec('BEGIN');try{const result=statements.map(s=>db.prepare(s.sql).run(...s.args));db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}
}},BUCKET:{get:async()=>{throw new Error('Unexpected file access');},put:async()=>{throw new Error('Unexpected file write');}}};
await fs.mkdir('test-output',{recursive:true});
await build({stdin:{contents:"export {GET,POST} from './app/api/workspace/[action]/route';export {unifiedCommunicationPost} from './lib/unified-communication-api';",resolveDir:process.cwd(),loader:'ts'},outfile:'test-output/unified-communication-api.mjs',bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@':process.cwd()},plugins:[{name:'communication-test-bindings',setup(b){
 b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'test'}));
 b.onResolve({filter:/chatgpt-auth$/},()=>({path:'auth',namespace:'test'}));
 b.onLoad({filter:/.*/,namespace:'test'},a=>({contents:a.path==='env'?'export const env=globalThis.__communicationTestEnv;':'export async function getChatGPTUser(){return globalThis.__communicationTestIdentity.getStore()||null;}'}));
}}]});
const api=await import(pathToFileURL(path.resolve('test-output/unified-communication-api.mjs')).href);
const put=r=>db.prepare('INSERT INTO records(id,kind,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,data=excluded.data').run(r.id,r.kind,JSON.stringify(r));
const rows=()=>db.prepare('SELECT data FROM records ORDER BY id').all().map(r=>JSON.parse(r.data));
const one=id=>rows().find(r=>r.id===id),revision=()=>db.prepare("SELECT revision FROM workspace_revision WHERE id='main'").get()?.revision||0;
const state=()=>({revision:revision(),records:rows()}),uuid=()=>crypto.randomUUID();
const member=(id,role,customers=[])=>({id,kind:'member',userId:id,name:'Synthetic '+id,email:id+'@example.invalid',active:true,role,customers,createdAt:'2026-10-01T00:00:00Z'});
const admin=member('admin','admin'),alice=member('alice','sales',['TEST-1','TEST-2']),service=member('service','clerk',['TEST-1']),other=member('other','sales',['TEST-2']),pmc=member('pmc','pmc'),finance=member('finance','finance'),restricted=member('restricted','sales');
const customer={id:'c1',kind:'customer_account',customer:'Synthetic customer one',customerCode:'TEST-1',active:true,salesMemberIds:['alice','restricted'],serviceMemberIds:['service','finance'],salesName:alice.name,serviceName:service.name,version:1};
const project={id:'p1',kind:'customer_project',customerId:'c1',code:'P-1',title:'Synthetic project',salesMemberId:'alice',status:'active'};
const order={id:'o1',kind:'order',customer:'TEST-1',orderNo:'SYN-1',drawing:'D-1',ownerEmail:alice.email,version:1,quantity:1,stage:'待下达',lifecycle:'active'};
for(const r of [admin,alice,service,other,pmc,finance,restricted,customer,{...customer,id:'c2',customer:'Synthetic customer two',customerCode:'TEST-2',salesMemberIds:['other'],serviceMemberIds:[]},project,{...project,id:'p2',customerId:'c2'},order,{...order,id:'o2',customer:'TEST-2'}])put(r);
async function call(action,body,who=alice,headers={}){
 const full=action.startsWith('unified-communication-')||['data','backup'].includes(action)?action:'unified-communication-'+action,method=body===undefined?'GET':'POST';
 const req=new Request('https://synthetic.invalid/api/workspace/'+full,{method,headers:{'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
 return identity.run(who?{userId:who.userId,email:who.email}:null,async()=>{const res=await api[method](req,{params:Promise.resolve({action:full.split('?')[0]})});return {status:res.status,data:await res.json()};});
}
async function ok(action,body,who,headers){const result=await call(action,body,who,headers);assert.equal(result.status,200,JSON.stringify(result));return result.data;}
async function fail(action,body,status=403,who=alice,headers){const result=await call(action,body,who,headers);assert.equal(result.status,status,JSON.stringify(result));return result.data;}
const fields={customerId:'c1',projectId:'p1',orderId:'o1',channel:'email',title:'Synthetic communication',sourceText:'Original manual message\n  preserve spacing  ',sourceReference:'Manual entry from source',occurredAt:'2026-10-01',draftText:'An unsent reply draft',internalNote:'Synthetic internal note'};
const beforeGet=JSON.stringify(rows());
assert.equal((await ok('unified-communication-data')).items.length,0);
assert.equal(JSON.stringify(rows()),beforeGet);assert.equal(revision(),0);
await fail('unified-communication-data',undefined,401,null);
console.log('PASS authenticated GET creates no business records or seed data');

const create={token:uuid(),...fields},created=await ok('save',create),id=created.item.id;
assert.equal(created.item.version,1);assert.equal(created.item.inputMode,'manual');assert.equal(created.item.status,'draft');
assert.equal(created.item.sourceText,fields.sourceText);
assert.equal((await ok('unified-communication-data',undefined,finance)).items[0].canWrite,false);
const afterCreate=JSON.stringify(rows());assert.equal((await ok('save',create)).idempotent,true);assert.equal(JSON.stringify(rows()),afterCreate);
await fail('save',{...create,title:'Changed replay'},409);
await fail('save',create,409,service);
await fail('save',{...create,token:uuid(),status:'sent'},400);
await fail('save',{...create,token:uuid(),id,expectedVersion:undefined},400);
await fail('save',{...create,token:uuid(),occurredAt:'2026-02-30'},400);
await fail('save',{...create,token:uuid(),sourceText:'',draftText:''},400);
await fail('save',{...create,token:uuid()},403,alice,{Origin:'https://elsewhere.invalid'});
await fail('save',{...create,token:uuid()},403,finance);
console.log('PASS manual create, strict fields, UUID replay binding and existing actor/origin controls');

for(const who of [other,pmc])assert.equal((await ok('unified-communication-data',undefined,who)).items.length,0);
await fail('history?id='+id,undefined,403,other);
await fail('save',{...create,token:uuid(),projectId:'p2'},403);
await fail('save',{...create,token:uuid(),orderId:'o2'},403);
await fail('save',{...create,token:uuid()},403,restricted);
await fail('save',{...create,token:uuid(),id,expectedVersion:1,customerId:'c2',projectId:'p2',orderId:'o2'},409,admin);
put({...customer,id:'ambiguous',customer:'Synthetic ambiguous',customerCode:'TEST-1',salesMemberIds:[],serviceMemberIds:[]});
await fail('save',{...create,token:uuid()},403);
db.prepare('DELETE FROM records WHERE id=?').run('ambiguous');
assert.equal((await ok('data',undefined,pmc)).audits.some(r=>r.targetId===id),false);
assert.equal((await ok('data',undefined,admin)).audits.some(r=>r.targetId===id),false);
console.log('PASS customer/project/order relation, ambiguous identity and broad PMC audit isolation');

const submit={token:uuid(),id,expectedVersion:1,comment:'Please check source and reply'};
const pending=(await ok('submit',submit)).item;assert.equal(pending.status,'pending_check');assert.equal(pending.version,2);
assert.equal((await ok('submit',submit)).idempotent,true);
const review=rows().find(r=>r.kind==='unified_communication_review'&&r.action==='submit'),reviewBytes=JSON.stringify(review);
assert.equal(review.basedOnVersion,1);assert.equal(review.snapshot.draftText,fields.draftText);
await fail('return',{token:uuid(),id,expectedVersion:2,comment:'Return'},403,service);
await fail('return',{token:uuid(),id,expectedVersion:2,comment:'Return'},403,admin);
await fail('submit',{token:uuid(),id,expectedVersion:2},409);
await fail('save',{...fields,token:uuid(),id,expectedVersion:1},409);
const edited=(await ok('save',{...fields,token:uuid(),id,expectedVersion:2,sourceText:'Changed manual source',orderId:''},service)).item;
assert.equal(edited.version,3);assert.equal(edited.sourceRevision,2);assert.equal(edited.status,'draft');assert.equal(edited.requiresRecheck,true);
assert.equal(JSON.stringify(one(review.id)),reviewBytes);
const restrictedHistory=await ok('history?id='+id,undefined,restricted);
assert.deepEqual(restrictedHistory.revisions.map(r=>r.version),[3]);assert.equal(restrictedHistory.reviews.length,0);
const pending2=(await ok('submit',{token:uuid(),id,expectedVersion:3})).item;
const returned=(await ok('return',{token:uuid(),id,expectedVersion:pending2.version,comment:'Verify revised source'})).item;
assert.equal(returned.status,'returned');assert.equal(returned.requiresRecheck,true);
const history=await ok('history?id='+id);assert.equal(history.revisions.length,5);assert.equal(history.reviews.length,3);
assert.equal(history.reviews.find(r=>r.action==='return').comment,'Verify revised source');
assert.equal(JSON.stringify(one(review.id)),reviewBytes);
console.log('PASS optimistic versions, immutable review snapshots and history rechecks old links');

const accountOnly=await ok('save',{...fields,token:uuid(),projectId:'',orderId:''});
await ok('submit',{token:uuid(),id:accountOnly.item.id,expectedVersion:1});
await fail('return',{token:uuid(),id:accountOnly.item.id,expectedVersion:2,comment:'Return'},403,service);
await ok('return',{token:uuid(),id:accountOnly.item.id,expectedVersion:2,comment:'Customer responsible sales returned'});
put({...customer,salesMemberIds:[],serviceMemberIds:[]});
assert.equal((await ok('unified-communication-data')).items.length,0);await fail('history?id='+id,undefined);
await fail('save',create);await fail('submit',submit);
put(customer);
put({...alice,active:false});await fail('unified-communication-data',undefined);await fail('save',create);put(alice);
put({...project,status:'archived'});await fail('save',{...fields,token:uuid(),id,expectedVersion:5},403);put(project);
console.log('PASS explicit responsibility, immediate revocation, replay denial and archived project lock');

const forCheck=(await ok('save',{...fields,token:uuid(),orderId:'',title:'Synthetic internal check'})).item;
await fail('complete-review',{token:uuid(),id:forCheck.id,expectedVersion:1},409);
const checkPending=(await ok('submit',{token:uuid(),id:forCheck.id,expectedVersion:1})).item;
assert.equal(checkPending.canCompleteReview,true);
for(const who of [admin,service,finance,restricted,pmc])await fail('complete-review',{token:uuid(),id:forCheck.id,expectedVersion:2},403,who);
await fail('complete-review',{token:uuid(),id:forCheck.id,expectedVersion:1},409);
await fail('complete-review',{token:uuid(),id:forCheck.id,expectedVersion:2,approved:true},400);
const checkSubmission=rows().find(r=>r.id===checkPending.lastSubmissionId),checkSubmissionBytes=JSON.stringify(checkSubmission);
const checkInput={token:uuid(),id:forCheck.id,expectedVersion:2,comment:''},checked=(await ok('complete-review',checkInput)).item;
assert.equal(checked.status,'checked');assert.equal(checked.version,3);assert.equal(checked.requiresRecheck,false);assert.equal(checked.canSubmit,false);assert.equal(checked.canCompleteReview,false);
const checkedSnapshot=rows().find(r=>r.kind==='unified_communication_review'&&r.recordId===checked.id&&r.action==='complete-review'),checkedBytes=JSON.stringify(checkedSnapshot);
assert.equal(checkedSnapshot.basedOnVersion,2);assert.equal(checkedSnapshot.contentHash,checkSubmission.contentHash);assert.equal(checkedSnapshot.sourceHash,checkSubmission.sourceHash);
assert.equal((await ok('complete-review',checkInput)).idempotent,true);
await fail('complete-review',{...checkInput,token:uuid(),expectedVersion:3},409);
await fail('submit',{token:uuid(),id:checked.id,expectedVersion:3},409);
const afterCheck=(await ok('save',{...fields,token:uuid(),id:checked.id,expectedVersion:3,orderId:'',draftText:'Changed draft after internal check'})).item;
assert.equal(afterCheck.status,'draft');assert.equal(afterCheck.requiresRecheck,true);
assert.equal(JSON.stringify(one(checkSubmission.id)),checkSubmissionBytes);assert.equal(JSON.stringify(one(checkedSnapshot.id)),checkedBytes);
await fail('complete-review',{token:uuid(),id:checked.id,expectedVersion:4},409);
const reSubmitted=(await ok('submit',{token:uuid(),id:checked.id,expectedVersion:4})).item;
put({...project,salesMemberId:'restricted'});
await fail('complete-review',{token:uuid(),id:checked.id,expectedVersion:reSubmitted.version},403);
await ok('complete-review',{token:uuid(),id:checked.id,expectedVersion:reSubmitted.version},restricted);
put(project);
const accountCheck=(await ok('save',{...fields,token:uuid(),projectId:'',orderId:'',title:'Synthetic account-responsible check'})).item;
await ok('submit',{token:uuid(),id:accountCheck.id,expectedVersion:1});
await fail('complete-review',{token:uuid(),id:accountCheck.id,expectedVersion:2},403,admin);
await ok('complete-review',{token:uuid(),id:accountCheck.id,expectedVersion:2},restricted);
assert.equal((await ok('history?id='+checked.id)).reviews.filter(r=>r.action==='complete-review').length,2);
console.log('PASS explicit sales-only internal completion, immutable submitted-version basis, responsibility changes and recheck after edit');

const stale=state(),makeReq=body=>new Request('https://synthetic.invalid/api/workspace/unified-communication-save',{method:'POST',body:JSON.stringify(body)});
await api.unifiedCommunicationPost('unified-communication-save',makeReq({...fields,token:uuid(),title:'Synthetic concurrent A'}),stale,alice);
const beforeConflict=JSON.stringify(rows());
await assert.rejects(()=>api.unifiedCommunicationPost('unified-communication-save',makeReq({...fields,token:uuid(),title:'Synthetic concurrent B'}),stale,alice),e=>e.status===409);
assert.equal(JSON.stringify(rows()),beforeConflict);
for(const action of ['delete','send','approve','ai-generate'])await fail(action,{token:uuid(),id,expectedVersion:5},404);
assert.equal(rows().some(r=>/^(ai_|mail_job|whatsapp_|finance_|customer_quote)/.test(r.kind)),false);
const supportedKinds=new Set(['unified_communication','unified_communication_revision','unified_communication_review','unified_communication_request','audit','member','customer_account','customer_project','order']);
assert(rows().every(r=>supportedKinds.has(r.kind)));
console.log('PASS atomic stale-revision rollback; no deletion, sending, AI or financial mutations');
db.close();console.log('Unified communication synthetic regression suite passed.');
