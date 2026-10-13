// Independent regression suite; synthetic records and an in-memory database only.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const db=new DatabaseSync(':memory:');
db.exec("CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,data TEXT NOT NULL);CREATE TABLE workspace_revision(id TEXT PRIMARY KEY,revision INTEGER NOT NULL);INSERT INTO workspace_revision VALUES('main',0);CREATE TABLE transaction_guards(id TEXT PRIMARY KEY,valid INTEGER NOT NULL CONSTRAINT revision_must_match CHECK(valid=1));");
class Statement{constructor(sql,args=[]){this.sql=sql;this.args=args;}bind(...args){return new Statement(this.sql,args);}async first(){return db.prepare(this.sql).get(...this.args)||null;}async all(){return {results:db.prepare(this.sql).all(...this.args)};}async run(){return db.prepare(this.sql).run(...this.args);}}
const files=new Map();globalThis.__followupTestEnv={DB:{prepare:sql=>new Statement(sql),batch:async statements=>{db.exec('BEGIN');try{const results=statements.map(s=>db.prepare(s.sql).run(...s.args));db.exec('COMMIT');return results;}catch(e){db.exec('ROLLBACK');throw e;}}},BUCKET:{put:async(key,bytes)=>files.set(key,bytes),get:async key=>files.has(key)?{body:files.get(key)}:null}};
await fs.mkdir('test-output',{recursive:true});
await build({stdin:{contents:"export * from './lib/customer-project-followup-api';export {collaborationPost} from './lib/collaboration-api';",resolveDir:process.cwd(),loader:'ts'},outfile:'test-output/customer-project-followup-api.mjs',bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@':process.cwd()},plugins:[{name:'followup-test-bindings',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'test'}));b.onResolve({filter:/chatgpt-auth$/},()=>({path:'auth',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},a=>({contents:a.path==='env'?'export const env=globalThis.__followupTestEnv;':'export async function getChatGPTUser(){return null;}'}));}}]});
const api=await import(pathToFileURL(path.resolve('test-output/customer-project-followup-api.mjs')).href);
const put=row=>db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,data=excluded.data').run(row.id,row.kind,JSON.stringify(row));
const records=()=>db.prepare('SELECT data FROM records').all().map(r=>JSON.parse(r.data));
const state=()=>({revision:db.prepare("SELECT revision FROM workspace_revision WHERE id='main'").get().revision,records:records()});
const one=id=>records().find(r=>r.id===id),uuid=()=>crypto.randomUUID();
const admin={id:'admin',kind:'member',name:'Synthetic admin',role:'admin',active:true},alice={id:'alice',kind:'member',name:'Synthetic Alice',role:'sales',active:true},service={id:'service',kind:'member',name:'Synthetic service',role:'clerk',active:true},other={id:'other',kind:'member',name:'Synthetic other',role:'sales',active:true};
const customer={id:'c1',kind:'customer_account',customer:'Synthetic customer',customerCode:'TEST-1',active:true,salesMemberIds:['alice'],serviceMemberIds:['service'],salesName:'Synthetic Alice',serviceName:'Synthetic service'};
for(const r of [admin,alice,service,other,customer,{...customer,id:'c2',customerCode:'TEST-2',salesMemberIds:['other'],serviceMemberIds:[]}])put(r);
async function call(name,body,actor=alice,s=state()){
 const action='customer-project-followup-'+name,req=new Request('https://synthetic.invalid/api/workspace/'+action,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
 try{const res=await (body?api.customerProjectFollowupPost:api.customerProjectFollowupGet)(action,req,s,actor);return {status:res.status,data:await res.json()};}catch(e){return {status:e.status||500,error:e.message};}
}
async function ok(name,body,actor=alice,s){const result=await call(name,body,actor,s);assert.equal(result.status,200,JSON.stringify(result));return result.data;}
async function denied(name,body,actor=alice,status=403){const result=await call(name,body,actor);assert.equal(result.status,status,JSON.stringify(result));}
const followup=(extra={})=>({ownerId:'alice',customerId:'',projectId:'',title:'Synthetic followup',category:'exhibition',stars:2,status:'pending',followUpDate:'',notes:'Original note',nextAction:'Verify sample request',checklist:[{id:'check1',text:'Review original request',checked:false}],...extra});
const sourceRow={...followup({customerId:'c1'}),sourceId:'source1',source:{project:'Synthetic original',oldState:'pending'},sourceTitle:'Original exhibition row'};delete sourceRow.ownerId;
const unassigned={...sourceRow,sourceId:'source2',customerId:'',source:{project:'Synthetic unassigned'}};
const payload={token:uuid(),format:'doon-customer-followup-v1',sourceKey:'synthetic-v1',ownerId:'alice',followups:[sourceRow,unassigned],mails:[{sourceId:'mail1',followupSourceIds:['source1'],subject:'Synthetic email',from:'customer@example.invalid',to:'alice@example.invalid',sentAt:'2026-10-01',body:'Original email text',summary:'Do not treat draft as sent',draftStatus:'draft',sourceUrl:'https://example.invalid/mail',links:[{label:'Original',url:'https://example.invalid/mail'}],source:{rawFlag:'draft',reply:'Unsent original reply'}},{sourceId:'mail2',followupSourceIds:[],subject:'Synthetic unassigned email',source:{raw:'unassigned'}}],sourceFiles:[{sourceId:'html',filename:'original.html',base64:Buffer.from('<script>throw new Error("must never execute")</script>').toString('base64')}]};
await denied('import',payload,alice);const imported=await ok('import',payload,admin);assert.deepEqual(imported.created,{followups:2,mails:2,sourceFiles:1});
const [f1,f2]=imported.followups.map(r=>r.id),[mail1,mail2]=imported.mails.map(r=>r.id),sourceFile=imported.sourceBundles[0].id;
assert.equal((await ok('import',payload,admin)).idempotent,true);
assert.equal((await ok('data',undefined,alice)).followups.length,2);assert.equal((await ok('data',undefined,service)).followups.length,1);assert.equal((await ok('data',undefined,other)).followups.length,0);
assert.equal((await ok('data',undefined,service)).mails.length,1);assert.equal((await ok('data',undefined,service)).sourceBundles.length,0);
console.log('PASS owner/admin unassigned isolation and existing customer scopes');
const edit={token:uuid(),id:f1,version:1,...followup({customerId:'c1',status:'completed',followUpDate:'2026-10-20',notes:'Human changed note',checklist:[{id:'check1',text:'Review original request',checked:true}]})};
await ok('save',edit);await denied('save',{...edit,token:uuid()},alice,409);await denied('save',{...edit,token:uuid(),version:2,source:{overwritten:true}},alice,400);
await denied('save',{...edit,token:uuid(),version:2,customerId:'c2'},alice);
const again=await ok('import',{...payload,token:uuid()},admin);assert.deepEqual(again.created,{followups:0,mails:0,sourceFiles:0});assert.equal(one(f1).status,'completed');assert.equal(one(f1).notes,'Human changed note');assert.equal(one(f1).followUpDate,'2026-10-20');assert.equal(one(f1).checklist[0].checked,true);
await denied('import',{...payload,token:uuid(),followups:[{...sourceRow,source:{changed:true}}]},admin,409);
assert.equal(records().filter(r=>['customer_project_task','customer_project_round','order','project_receipt','customer_project_confirmation'].includes(r.kind)).length,0);
console.log('PASS strict version/source immutability/reimport preserves all human edits and creates no business facts');
await denied('mail-classify',{token:uuid(),id:mail1,version:1,followupIds:[f2]},service);
await denied('mail-classify',{token:uuid(),id:mail2,version:1,followupIds:[f1]},other);
await ok('mail-classify',{token:uuid(),id:mail2,version:1,followupIds:[f1,f2]});assert.equal((await ok('data',undefined,service)).mails.length,1);
const invalidUrl={...payload,token:uuid(),sourceKey:'invalid-url',followups:[],mails:[{...payload.mails[0],followupSourceIds:[],sourceUrl:'javascript:alert(1)'}],sourceFiles:[]};await denied('import',invalidUrl,admin,400);
const sourceReq=new Request('https://synthetic.invalid/api/workspace/customer-project-followup-source-file?id='+sourceFile),download=await api.customerProjectFollowupGet('customer-project-followup-source-file',sourceReq,state(),alice);assert.equal(download.headers.get('Content-Type'),'application/octet-stream');assert.match(download.headers.get('Content-Disposition'),/^attachment/);assert.match(download.headers.get('Content-Security-Policy'),/sandbox/);assert.equal(await download.text(),'<script>throw new Error("must never execute")</script>');await assert.rejects(()=>api.customerProjectFollowupGet('customer-project-followup-source-file',sourceReq,state(),service),e=>e.status===403);
console.log('PASS mail classification cannot transfer other owners and source HTML downloads with no execution');
put({...customer,salesMemberIds:[]});assert.equal((await ok('data',undefined,alice)).followups.some(r=>r.id===f1),false);assert.equal((await ok('data',undefined,alice)).mails.length,0);await denied('save',{...edit,token:uuid(),version:2,customerId:''});await denied('save',edit);await denied('mail-classify',{token:uuid(),id:mail1,version:1,followupIds:[]});
put(customer);console.log('PASS current customer revocation immediately removes owner access, replay and unlink routes');
const promote={token:uuid(),id:f2,version:1,customerId:'c1',title:'Synthetic full project',description:'Promoted explicitly',code:'SYNTHETIC'};
const promoted=await ok('promote',promote);assert.equal((await ok('promote',promote)).idempotent,true);assert.equal(one(f2).projectId,promoted.project.id);assert.equal(records().filter(r=>r.kind==='customer_project').length,1);assert.equal(records().filter(r=>r.kind==='customer_project_item').length,0);await denied('save',{token:uuid(),id:f2,version:2,...followup({customerId:'c1'})},alice,409);await denied('promote',{...promote,token:uuid(),version:2},alice,409);
assert.equal(promoted.project.dueDate,'');
console.log('PASS explicit promotion keeps one full project and never creates placeholder quantities');
const stale=state(),newPayload={token:uuid(),...followup({title:'Synthetic concurrent A'})};await ok('save',newPayload,alice,stale);const failed=await call('save',{token:uuid(),...followup({title:'Synthetic concurrent B'})},alice,stale);assert.equal(failed.status,409);assert.equal(records().some(r=>r.title==='Synthetic concurrent B'),false);
console.log('PASS revision guard rejects concurrent stale mutation atomically');
const saveCustomer=async body=>api.collaborationPost('customer-save',new Request('https://synthetic.invalid/api/workspace/customer-save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),state(),admin);
const customerInput={createOnly:true,customer:'  Synthetic newly identified  ',customerCode:'',salesName:'Synthetic Alice',serviceName:'',salesMemberIds:['alice'],serviceMemberIds:[],quoteMemberIds:[],notes:'Synthetic original evidence',active:true};
const createdCustomer=(await (await saveCustomer(customerInput)).json()).item;assert.equal(createdCustomer.customer,'Synthetic newly identified');assert.equal(createdCustomer.customerCode,'');assert.deepEqual(createdCustomer.salesMemberIds,['alice']);assert.deepEqual(createdCustomer.serviceMemberIds,[]);assert.equal(Object.hasOwn(createdCustomer,'createOnly'),false);
const customerHash=()=>createHash('sha256').update(JSON.stringify(one(createdCustomer.id))).digest('hex'),savedHash=customerHash(),beforeConflictCount=records().length;
for(const name of ['Synthetic newly identified','  SYNTHETIC NEWLY IDENTIFIED  '])await assert.rejects(()=>saveCustomer({...customerInput,customer:name,notes:'Must not replace',salesMemberIds:['other']}),e=>e.status===409);
await assert.rejects(()=>saveCustomer({...customerInput,id:createdCustomer.id,notes:'ID overwrite prohibited'}),e=>e.status===409);
assert.equal(customerHash(),savedHash);assert.equal(records().length,beforeConflictCount);assert.equal(records().some(r=>r.kind==='customer_account'&&Object.hasOwn(r,'createOnly')),false);
console.log('PASS customer createOnly permits blank code and explicit owner, rejects trimmed/case duplicate without changing records');
db.close();console.log('Customer followup regression suite passed.');
