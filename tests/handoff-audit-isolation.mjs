// Cross-module regression: private handoff snapshots must never leak through
// the legacy order audit feed, including dangling historical target records.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {AsyncLocalStorage} from 'node:async_hooks';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=process.cwd(),dir=path.join(root,'test-output','handoff-audit-'+process.pid);
await fs.mkdir(dir,{recursive:true});
const db=new DatabaseSync(':memory:');
for(const file of (await fs.readdir('drizzle')).filter(n=>n.endsWith('.sql')).sort())db.exec(await fs.readFile('drizzle/'+file,'utf8'));
class Statement{constructor(sql,args=[]){this.sql=sql;this.args=args;}bind(...args){return new Statement(this.sql,args);}async first(){return db.prepare(this.sql).get(...this.args)||null;}async all(){return {results:db.prepare(this.sql).all(...this.args)};}async run(){return db.prepare(this.sql).run(...this.args);}}
const identity=new AsyncLocalStorage();globalThis.__handoffAuditIdentity=identity;
globalThis.__handoffAuditEnv={DB:{prepare:sql=>new Statement(sql),batch:async statements=>{db.exec('BEGIN');try{const r=statements.map(s=>db.prepare(s.sql).run(...s.args));db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}},BUCKET:{get:async()=>{throw Error('GET data must not access files');},put:async()=>{throw Error('GET data must not write files');}}};
await build({entryPoints:['app/api/workspace/[action]/route.ts'],outfile:path.join(dir,'api.mjs'),bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@':root},plugins:[{name:'synthetic-bindings',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'test'}));b.onResolve({filter:/chatgpt-auth$/},()=>({path:'auth',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},a=>({contents:a.path==='env'?'export const env=globalThis.__handoffAuditEnv;':'export async function getChatGPTUser(){return globalThis.__handoffAuditIdentity.getStore()||null;}'}));}}]});
const api=await import(pathToFileURL(path.join(dir,'api.mjs')).href);
const put=r=>db.prepare('INSERT INTO records(id,kind,data) VALUES(?,?,?)').run(r.id,r.kind,JSON.stringify(r));
const snapshot=()=>db.prepare('SELECT id,kind,data FROM records ORDER BY id').all();
const members=['admin','pmc','production','clerk','sales','finance','programmer','viewer'].map(role=>({id:role,kind:'member',userId:role,name:'Synthetic '+role,email:role+'@example.invalid',role,active:true,orderScope:'all',customers:['SYNTH-1'],createdAt:'2026-10-01T00:00:00Z'}));
members.forEach(put);
put({id:'synthetic-order',kind:'order',orderNo:'SYNTH-1',customer:'SYNTH-1',ownerEmail:'sales@example.invalid',drawing:'TEST',color:'TEST',lens:'TEST',quantity:10,version:1,extra:{unrecognizedHistoricalColumn:'Preserve exactly'},createdAt:'2026-10-01T00:00:00Z'});
put({id:'synthetic-customer',kind:'customer_account',customer:'Synthetic customer',customerCode:'SYNTH-1',active:true,salesMemberIds:['sales'],serviceMemberIds:['clerk'],version:1});
const prefixes=['handoff_business_','customer_workflow_','customer_shared_','framework_','unified_communication_'];
for(const [index,prefix] of prefixes.entries()){
 const record={id:'private-'+index,kind:prefix+'synthetic',customerId:'synthetic-customer',lineId:'synthetic-order',body:'SYNTHETIC_PRIVATE_SENTINEL_'+index};put(record);
 for(const placement of ['target','before','after'])put({id:'audit-private-'+index+'-'+placement,kind:'audit',targetId:placement==='target'?record.id:'missing-target-'+index,lineId:'synthetic-order',action:'synthetic-private',before:placement==='before'?record:null,after:placement==='after'?record:null});
}
put({id:'audit-original-order',kind:'audit',lineId:'synthetic-order',targetId:'synthetic-order',action:'original-order-check',before:null,after:{kind:'order',id:'synthetic-order',quantity:10}});
const before=snapshot();
for(const member of members){
 const response=await identity.run({userId:member.userId,email:member.email},()=>api.GET(new Request('https://synthetic.invalid/api/workspace/data'),{params:Promise.resolve({action:'data'})}));
 assert.equal(response.status,200,member.role);const body=await response.json();
 assert.equal(body.audits.some(a=>a.action==='synthetic-private'),false,member.role+' private audit leaked');
 assert.equal(JSON.stringify(body).includes('SYNTHETIC_PRIVATE_SENTINEL'),false,member.role+' private payload leaked');
 assert.equal(body.orders[0].extra.unrecognizedHistoricalColumn,'Preserve exactly');
 assert.equal(body.audits.some(a=>a.id==='audit-original-order'),true,member.role+' original order audit lost');
 assert.deepEqual(snapshot(),before,member.role+' GET changed original records');
}
assert.equal(db.prepare("SELECT revision FROM workspace_revision WHERE id='main'").get().revision,0);
console.log('PASS 8 roles × 5 private prefixes × target/before/after audit isolation; legacy order history and all source records unchanged');
db.close();
