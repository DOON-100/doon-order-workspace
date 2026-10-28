// 测试环境，不含正式业务数据。Real handlers and transaction guards, in-memory SQLite.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url)),output=path.join(root,'test-output');
await fs.mkdir(output,{recursive:true});
const dir=await fs.mkdtemp(path.join(output,'production-history-access-')),db=new DatabaseSync(':memory:');
try{
 for(const file of (await fs.readdir(path.join(root,'drizzle'))).filter(n=>n.endsWith('.sql')).sort())db.exec(await fs.readFile(path.join(root,'drizzle',file),'utf8'));
 class Statement{constructor(sql,args=[]){this.sql=sql;this.args=args;}bind(...args){return new Statement(this.sql,args);}async first(){return db.prepare(this.sql).get(...this.args)||null;}async all(){return {results:db.prepare(this.sql).all(...this.args)};}async run(){return db.prepare(this.sql).run(...this.args);}}
 const identity=new AsyncLocalStorage();globalThis.__productionHistoryIdentity=identity;
 globalThis.__productionHistoryEnv={DB:{prepare:sql=>new Statement(sql),batch:async statements=>{db.exec('BEGIN');try{const results=statements.map(statement=>db.prepare(statement.sql).run(...statement.args));db.exec('COMMIT');return results;}catch(error){db.exec('ROLLBACK');throw error;}}},BUCKET:{get:async()=>{throw Error('History tests must not access attachments');},put:async()=>{throw Error('History tests must not write attachments');}}};
 await build({entryPoints:[path.join(root,'app/api/workspace/[action]/route.ts')],outfile:path.join(dir,'api.mjs'),bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@':root},plugins:[{name:'synthetic-production-history',setup(builder){builder.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'test'}));builder.onResolve({filter:/chatgpt-auth$/},()=>({path:'auth',namespace:'test'}));builder.onLoad({filter:/.*/,namespace:'test'},args=>({contents:args.path==='env'?'export const env=globalThis.__productionHistoryEnv;':'export async function getChatGPTUser(){return globalThis.__productionHistoryIdentity.getStore()||null;}'}));}}]});
 const api=await import(pathToFileURL(path.join(dir,'api.mjs')).href);
 const insert=row=>db.prepare('INSERT INTO records(id,kind,data) VALUES(?,?,?)').run(row.id,row.kind,JSON.stringify(row));
 const snapshot=()=>({rows:db.prepare('SELECT id,kind,data FROM records ORDER BY id').all(),revision:db.prepare("SELECT revision FROM workspace_revision WHERE id='main'").get()});
 const member=(id,role,customers)=>({id,kind:'member',userId:id,name:'Synthetic '+id,email:id+'@example.invalid',role,active:true,orderScope:'assigned',customers,createdAt:'2026-10-28T00:00:00Z'});
 const admin=member('history-admin','admin',[]),pmc=member('history-pmc','pmc',[]),salesA=member('history-sales-A','sales',['SYN-A']),salesB=member('history-sales-B','sales',['SYN-B']),finance=member('history-finance','finance',[]);
 [admin,pmc,salesA,salesB,finance].forEach(insert);
 const order=(id,customer)=>({id,kind:'order',version:1,customer,ownerEmail:'',orderNo:'SYN-SHARED',drawing:'SYN-DRAWING',color:'Black',lens:'Clear',quantity:100,extra:{},createdAt:'2026-10-28T00:00:00Z'});
 const orderA=order('history-order-A','SYN-A'),orderB=order('history-order-B','SYN-B');[orderA,orderB].forEach(insert);
 const report=(id,lineId)=>({id,kind:'report',lineId,version:1,orderNo:orderA.orderNo,drawing:orderA.drawing,color:orderA.color,lens:orderA.lens,quantity:73,workOrder:'SYN-WORK',approval:'已审批'});
 const old=report('history-report',orderB.id),current={...old,version:2,quantity:5},unlinked=report('history-unlinked','');
 [current,unlinked,{id:'history-audit-B',kind:'audit',targetId:current.id,before:old,after:current,action:'Synthetic MES import'}, {id:'history-audit-unlinked',kind:'audit',targetId:unlinked.id,before:null,after:unlinked,action:'Synthetic unlinked import'}].forEach(insert);
 const call=(action,actor,body)=>identity.run({userId:actor.userId,email:actor.email},()=>api[body===undefined?'GET':'POST'](new Request('https://synthetic.invalid/api/workspace/'+action,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}),{params:Promise.resolve({action:action.split('?')[0]})}));
 const ok=async(action,actor,body)=>{const response=await call(action,actor,body),data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data;};
 const history=(id,actor,type='report')=>ok('production-workspace-history?type='+type+'&id='+id,actor);
 const match=async(id,expectedVersion)=>ok('production-report-action',pmc,{type:'match',token:randomUUID(),reportId:id,lineId:orderA.id,expectedVersion,orderVersion:orderA.version,reason:'Synthetic exact identity reassociation'});

 assert.equal((await call('production-workspace-history?type=report&id='+current.id,salesA)).status,403);
 assert.deepEqual((await history(current.id,salesB)).history.map(row=>row.id),['history-audit-B']);
 await match(current.id,2); // A valid PMC rematch from customer B to customer A.
 const sameOrder=await match(current.id,3);assert.equal(sameOrder.record.version,4);
 await match(unlinked.id,1);
 const correction=await ok('production-report-action',salesA,{type:'correction',token:randomUUID(),reportId:current.id,expectedVersion:4,quantity:4,reason:'Synthetic correction in the authorized order'});
 const beforeRead=snapshot();
 const feed=await ok('production-workspace-data',salesA);assert.deepEqual(feed.orders.map(row=>row.id),[orderA.id]);
 const scoped=await history(current.id,salesA);
 assert.equal(scoped.historyScopeContract,'production-history-snapshot-scope-v1');
 assert.equal(scoped.history.length,1);assert.equal(scoped.history[0].before.lineId,orderA.id);assert.equal(scoped.history[0].after.lineId,orderA.id);
 assert.equal(JSON.stringify(scoped).includes(orderB.id),false);assert.equal(scoped.history.some(row=>row.before?.quantity===73||row.after?.quantity===73),false);
 assert.equal((await call('production-workspace-history?type=report&id='+current.id,salesB)).status,403,'Current target access must still apply');
 assert.equal((await history(unlinked.id,salesA)).history.length,0,'An unlinked original must not inherit the new order scope');
 assert.equal((await history(unlinked.id,finance)).history.length,0,'All-order finance access does not grant unlinked report access');
 const correctionHistory=await history(correction.record.id,salesA,'correction');assert.equal(correctionHistory.history.length,1);assert.equal(correctionHistory.history[0].after.lineId,orderA.id);
 assert.equal((await call('production-workspace-history?type=correction&id='+correction.record.id,salesB)).status,403);
 for(const privileged of [admin,pmc]){
  assert.equal((await history(current.id,privileged)).history.length,3);
  assert.equal((await history(unlinked.id,privileged)).history.length,2);
 }
 assert.deepEqual(snapshot(),beforeRead,'History reads preserve all original records and audit snapshots');
 console.log('PASS production history: legal cross-customer rematch, authorized history retained, unlinked original scope, current target scope and read-only data preservation');
}finally{
 db.close();delete globalThis.__productionHistoryIdentity;delete globalThis.__productionHistoryEnv;
 const resolved=await fs.realpath(dir),parent=await fs.realpath(output);
 if(path.dirname(resolved)!==parent||!path.basename(resolved).startsWith('production-history-access-'))throw Error('Unsafe test fixture cleanup');
 await fs.rm(resolved,{recursive:true,force:true});
}
