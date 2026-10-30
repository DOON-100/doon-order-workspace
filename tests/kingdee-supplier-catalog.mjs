import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {AsyncLocalStorage} from 'node:async_hooks';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {supplierCatalogScheduleConfig,createSupplierCatalogScheduler} from '../standalone/supplier-catalog-job.mjs';
await fs.mkdir('test-output',{recursive:true});
const db=new DatabaseSync(':memory:');for(const name of (await fs.readdir('drizzle')).filter(n=>n.endsWith('.sql')).sort())db.exec(await fs.readFile('drizzle/'+name,'utf8'));
class Statement{constructor(sql,args=[]){this.sql=sql;this.args=args}bind(...args){return new Statement(this.sql,args)}async first(){return db.prepare(this.sql).get(...this.args)||null}async all(){return {results:db.prepare(this.sql).all(...this.args)}}async run(){return db.prepare(this.sql).run(...this.args)}}
const identity=new AsyncLocalStorage(),files=new Map();globalThis.__testIdentity=identity;globalThis.__testEnv={DB:{prepare:sql=>new Statement(sql),batch:async statements=>{db.exec('BEGIN');try{for(const st of statements)db.prepare(st.sql).run(...st.args);db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}}},BUCKET:{put:async(k,v)=>files.set(k,v)}};
await build({entryPoints:['app/api/workspace/[action]/route.ts'],outfile:'test-output/kingdee-supplier-catalog-api.mjs',bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@':process.cwd()},plugins:[{name:'test-bindings',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'cloudflare',namespace:'test'}));b.onResolve({filter:/chatgpt-auth$/},()=>({path:'auth',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},a=>({contents:a.path==='auth'?'export async function getChatGPTUser(){return globalThis.__testIdentity.getStore()||null}':'export const env=globalThis.__testEnv;'}))}}]});
await build({entryPoints:['lib/kingdee-supplier-catalog.ts'],outfile:'test-output/kingdee-supplier-catalog-worker.mjs',bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@':process.cwd()},plugins:[{name:'worker-test-bindings',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'cloudflare',namespace:'test'}));b.onResolve({filter:/chatgpt-auth$/},()=>({path:'auth',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},a=>({contents:a.path==='auth'?'export async function getChatGPTUser(){return null}':'export const env=globalThis.__testEnv;'}))}}]});
const api=await import('../test-output/kingdee-supplier-catalog-api.mjs'),admin={userId:'admin',email:'admin@test.invalid',displayName:'测试管理员'},clerk={userId:'clerk',email:'clerk@test.invalid',displayName:'测试文员'};
const worker=await import('../test-output/kingdee-supplier-catalog-worker.mjs');
async function call(action,body,user=admin,headers={}){const method=body===undefined?'GET':'POST';return identity.run(user,()=>api[method](new Request('https://orders.test/api/workspace/'+action,{method,headers:body===undefined?headers:{'content-type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)}),{params:Promise.resolve({action:action.split('?')[0]})}));}
async function ok(action,body,user=admin){const r=await call(action,body,user),v=await r.json();assert.equal(r.status,200,JSON.stringify(v));return v}
await ok('enroll',{});await ok('member',{name:'测试文员',email:clerk.email,role:'clerk',customers:[],active:true});await ok('enroll',{},clerk);
const digest=()=>db.prepare("SELECT id,kind,data FROM records WHERE kind NOT LIKE 'kingdee_supplier_catalog%' AND kind!='audit' ORDER BY rowid").all();const original=digest();
assert.equal((await call('kingdee-supplier-catalog')).status,503);assert.equal((await call('kingdee-supplier-catalog',undefined,clerk)).status,403);assert.equal((await call('kingdee-supplier-catalog-sync',{requestId:randomUUID()},admin,{'X-Workspace-Team':'x'})).status,403);
Object.assign(globalThis.__testEnv,{DOON_KINGDEE_READONLY_ENABLED:'1',DOON_KINGDEE_CLIENT_ID:'synthetic-client',DOON_KINGDEE_CLIENT_SECRET:'synthetic-secret',DOON_KINGDEE_INSTANCE_ID:'synthetic-instance',DOON_KINGDEE_ACCOUNT_ID:'synthetic-account'});
const syntheticCreatedAt=Date.now()-10000;
let calls=[],authorizations=0,tokens=0,mode='ok',rows=Array.from({length:205},(_,i)=>({id:String(i+1),number:'S'+String(i+1).padStart(3,'0'),name:i<2?'同名合成供应商':'合成供应商'+i,...(i===0?{group_name:'',rate:'0'}:i===1?{group_name:'合成分类',rate:''}:{}),bank_account:'private-bank',phone:'private-phone'}));const originalFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{const url=new URL(input);calls.push({path:url.pathname,method:init.method,query:Object.fromEntries(url.searchParams)});
 if(url.pathname.endsWith('push_app_authorize')){authorizations++;return Response.json({code:200,data:[{clientId:'synthetic-client',outerInstanceId:'synthetic-instance',accountId:'synthetic-account',status:1,appKey:'synthetic-key',appSecret:'synthetic-app-secret',domain:'https://tf.jdy.com'}]});}
 if(url.pathname.endsWith('kingdee_auth_token')){tokens++;return Response.json({errcode:0,data:{'app-token':'synthetic-token'}});}
 if(url.pathname==='/jdy/v2/bd/supplier'){
  const p=Number(url.searchParams.get('page')),pageCalls=calls.filter(c=>c.path==='/jdy/v2/bd/supplier').length;
  const start=url.searchParams.get('create_start_time'),end=url.searchParams.get('create_end_time');
  const filtered=start===null?rows:rows.filter(r=>(r.createdMs??syntheticCreatedAt)>=Number(start)&&(r.createdMs??syntheticCreatedAt)<=Number(end));
  let page=filtered.slice((p-1)*100,p*100).map(r=>({...r}));
  if(mode==='duplicate'&&p===2)page[0].id=rows[0].id;
  if(mode==='changing'&&pageCalls%6>3&&p===1)page[0].name='变化';
  if(mode==='short'&&p===2)page.pop();
  if(mode==='bad-rate'&&p===1)page[0].rate=0;
  if(mode==='expire-lease'&&p===2)db.prepare("UPDATE kingdee_supplier_catalog_lease SET expires_at=0 WHERE id='scheduler'").run();
  if(mode==='replace-lease'&&p===2)db.prepare("UPDATE kingdee_supplier_catalog_lease SET fence=2 WHERE id='scheduler'").run();
  return Response.json({errcode:0,data:{count:String(filtered.length),page:p,page_size:100,current_page_size:page.length,total_page:Math.ceil(filtered.length/100),rows:page}});
 }
 throw Error('unexpected synthetic route');
};
try{
 const req=randomUUID(),first=await ok('kingdee-supplier-catalog-sync',{requestId:req});assert.deepEqual({inserted:first.inserted,existing:first.existing,changed:first.changed,total:first.total},{inserted:205,existing:0,changed:0,total:205});
 assert.equal(first.addedSuppliers.length,205);assert(first.addedSuppliers.some(row=>row.code==='S001'&&row.name==='同名合成供应商'));
 assert(Number.isSafeInteger(first.durationMs)&&first.durationMs>=0);
 const pageCalls=calls.filter(c=>c.path==='/jdy/v2/bd/supplier');assert.equal(pageCalls.length,6);assert(pageCalls.every(c=>c.method==='GET'&&c.query.page_size==='100'&&c.query.enable==='-1'&&c.query.show_contact_detail==='false'));
 const catalog=await ok('kingdee-supplier-catalog');assert.equal(catalog.rows.length,205);assert.equal(catalog.rows.filter(r=>r.name==='同名合成供应商').length,2);assert.deepEqual(catalog.issues,[]);assert.equal(catalog.rows.find(r=>r.code==='S001').groupName,'');assert.equal(catalog.rows.find(r=>r.code==='S001').taxRate,'0');assert.equal(catalog.rows.find(r=>r.code==='S002').taxRate,'');assert.equal(catalog.rows.find(r=>r.code==='S003').taxRate,null);const output=JSON.stringify(catalog);for(const secret of ['private-bank','private-phone','synthetic-secret','synthetic-token','synthetic-account'])assert(!output.includes(secret));
 db.exec("CREATE TABLE kingdee_supplier_catalog_schedule_status(id TEXT PRIMARY KEY,binding_hash TEXT NOT NULL,last_attempt_at TEXT NOT NULL,last_result TEXT NOT NULL,last_success_at TEXT NOT NULL)");
 const bindHash=createHash('sha256').update(JSON.stringify(['kingdee-supplier-catalog-v1','synthetic-client','synthetic-instance','synthetic-account'])).digest('hex');db.prepare('INSERT INTO kingdee_supplier_catalog_schedule_status VALUES(?,?,?,?,?)').run('scheduler',bindHash,'2026-01-01T00:00:00.000Z','failed','2025-12-31T00:00:00.000Z');
 assert.equal((await ok('kingdee-supplier-catalog')).autoStatus.lastResult,'failed');db.prepare("UPDATE kingdee_supplier_catalog_schedule_status SET binding_hash='other' WHERE id='scheduler'").run();assert.equal((await ok('kingdee-supplier-catalog')).autoStatus,null);
 const before=calls.length;assert.deepEqual(await ok('kingdee-supplier-catalog-sync',{requestId:req}),first);assert.equal(calls.length,before);assert.deepEqual((await ok('kingdee-supplier-catalog-result?requestId='+req)).receipt,first);
 assert.equal((await call('kingdee-supplier-catalog-result?requestId='+req,undefined,clerk)).status,403);assert.equal((await call('kingdee-supplier-catalog-sync',{requestId:randomUUID(),rows:[]})).status,400);
 rows=rows.map((r,i)=>i===204?{...r,createdMs:0}:r);rows=[...rows,{id:'206',number:'S206',name:'新合成供应商'},{id:'999',number:'S999',name:'窗口外合成供应商',createdMs:0}];const beforeDaily=calls.length;const second=await ok('kingdee-supplier-catalog-sync',{requestId:randomUUID()});assert.equal(second.inserted,1);assert.equal(second.existing,204);assert.deepEqual(second.addedSuppliers,[{code:'S206',name:'新合成供应商'}]);assert.equal(second.scope,'last-24-hours');const dailyCalls=calls.slice(beforeDaily).filter(c=>c.path==='/jdy/v2/bd/supplier');assert(dailyCalls.every(c=>Number(c.query.create_end_time)-Number(c.query.create_start_time)===86400000));assert(!(await ok('kingdee-supplier-catalog')).rows.some(r=>r.code==='S999'));
 rows=rows.map((r,i)=>i===0?{...r,name:'源名称更改'}:i===1?{...r,rate:'13'}:r);const third=await ok('kingdee-supplier-catalog-sync',{requestId:randomUUID()});assert.equal(third.inserted,0);assert.equal(third.changed,2);const details=await ok('kingdee-supplier-catalog');assert.equal(details.issues.length,2);assert(details.issues.some(r=>r.name==='源名称更改'));assert(details.issues.some(r=>r.code==='S002'&&r.previousTaxRate===''&&r.taxRate==='13'));assert(details.rows.some(r=>r.code==='S001'&&r.name==='同名合成供应商'));assert.equal(details.rows.find(r=>r.code==='S002').taxRate,'');
 const repeatChanged=await ok('kingdee-supplier-catalog-sync',{requestId:randomUUID()});assert.equal(repeatChanged.changed,2);assert.equal(db.prepare("SELECT COUNT(*) AS n FROM records WHERE kind='kingdee_supplier_catalog_issue'").get().n,2);assert.equal((await ok('kingdee-supplier-catalog')).issues.length,2);
 const stable=JSON.stringify(db.prepare('SELECT id,kind,data FROM records ORDER BY rowid').all());mode='duplicate';assert.equal((await call('kingdee-supplier-catalog-sync',{requestId:randomUUID()})).status,409);assert.equal(JSON.stringify(db.prepare('SELECT id,kind,data FROM records ORDER BY rowid').all()),stable);
 mode='short';assert.equal((await call('kingdee-supplier-catalog-sync',{requestId:randomUUID()})).status,502);assert.equal(JSON.stringify(db.prepare('SELECT id,kind,data FROM records ORDER BY rowid').all()),stable);
 mode='bad-rate';assert.equal((await call('kingdee-supplier-catalog-sync',{requestId:randomUUID()})).status,502);assert.equal(JSON.stringify(db.prepare('SELECT id,kind,data FROM records ORDER BY rowid').all()),stable);
 mode='changing';calls=[];assert.equal((await call('kingdee-supplier-catalog-sync',{requestId:randomUUID()})).status,409);assert.equal(JSON.stringify(db.prepare('SELECT id,kind,data FROM records ORDER BY rowid').all()),stable);
 db.exec("CREATE TABLE IF NOT EXISTS kingdee_supplier_catalog_lease(id TEXT PRIMARY KEY,worker TEXT NOT NULL,fence INTEGER NOT NULL,expires_at INTEGER NOT NULL)");
 const workerReq=randomUUID(),lease={workerId:'synthetic_worker',fence:1};
 await assert.rejects(()=>worker.runKingdeeSupplierCatalogWorker({requestId:workerReq,lease}));
 globalThis.__testEnv.DOON_KINGDEE_SUPPLIER_SYNC_ENABLED='1';mode='ok';db.prepare("UPDATE kingdee_supplier_catalog_lease SET worker=?,fence=?,expires_at=? WHERE id='scheduler'").run(lease.workerId,lease.fence,Date.now()+120000);
 const blockedCalls=calls.length;assert.equal((await call('kingdee-supplier-catalog-sync',{requestId:randomUUID()})).status,429);assert.equal(calls.length,blockedCalls);
 rows=[...rows,{id:'207',number:'S207',name:'后台新增合成供应商'}];const scheduled=await worker.runKingdeeSupplierCatalogWorker({requestId:workerReq,lease});assert.equal(scheduled.inserted,1);
 assert.equal(authorizations,1);assert.equal(tokens,1);
 const savedReceipt=db.prepare("SELECT data FROM records WHERE kind='kingdee_supplier_catalog_receipt' ORDER BY rowid DESC LIMIT 1").get();assert.equal(JSON.parse(savedReceipt.data).actorId,'service_kingdee_supplier_catalog');
 const beforeWorker=JSON.stringify(db.prepare('SELECT id,kind,data FROM records ORDER BY rowid').all());
 mode='expire-lease';await assert.rejects(()=>worker.runKingdeeSupplierCatalogWorker({requestId:randomUUID(),lease}));assert.equal(JSON.stringify(db.prepare('SELECT id,kind,data FROM records ORDER BY rowid').all()),beforeWorker);
 db.prepare("UPDATE kingdee_supplier_catalog_lease SET expires_at=?,fence=1 WHERE id='scheduler'").run(Date.now()+120000);mode='replace-lease';await assert.rejects(()=>worker.runKingdeeSupplierCatalogWorker({requestId:randomUUID(),lease}));assert.equal(JSON.stringify(db.prepare('SELECT id,kind,data FROM records ORDER BY rowid').all()),beforeWorker);
 db.prepare("UPDATE kingdee_supplier_catalog_lease SET expires_at=?,fence=1 WHERE id='scheduler'").run(Date.now()+120000);mode='ok';const noChange=await worker.runKingdeeSupplierCatalogWorker({requestId:randomUUID(),lease});assert.equal(noChange.inserted,0);assert.equal(noChange.changed,2);assert.equal(JSON.stringify(db.prepare('SELECT id,kind,data FROM records ORDER BY rowid').all()),beforeWorker);
 rows=[...rows,{id:'208',number:'S208',name:'失锁合成供应商'}];mode='expire-lease';
 await assert.rejects(()=>worker.runKingdeeSupplierCatalogWorker({requestId:randomUUID(),lease}));assert.equal(JSON.stringify(db.prepare('SELECT id,kind,data FROM records ORDER BY rowid').all()),beforeWorker);
 db.prepare("UPDATE kingdee_supplier_catalog_lease SET expires_at=?,fence=2 WHERE id='scheduler'").run(Date.now()+120000);mode='ok';await assert.rejects(()=>worker.runKingdeeSupplierCatalogWorker({requestId:randomUUID(),lease}));assert.equal(JSON.stringify(db.prepare('SELECT id,kind,data FROM records ORDER BY rowid').all()),beforeWorker);
 // Exercise the actual scheduler and worker together using only the fake API and in-memory SQLite.
 db.prepare("UPDATE kingdee_supplier_catalog_lease SET expires_at=0 WHERE id='scheduler'").run();rows=[...rows,{id:'209',number:'S209',name:'定时器合成供应商'}];
 const config=supplierCatalogScheduleConfig(globalThis.__testEnv),scheduler=createSupplierCatalogScheduler({db,config,runWorker:worker.runKingdeeSupplierCatalogWorker,logger:{error:()=>{}}});scheduler.start();
 assert.deepEqual(await scheduler.runOnce(),{status:'complete'});scheduler.stop();
 const scheduledCatalog=await ok('kingdee-supplier-catalog');assert(scheduledCatalog.rows.some(row=>row.code==='S209'));assert.equal(scheduledCatalog.autoStatus.lastResult,'complete');assert(scheduledCatalog.autoStatus.lastSuccessAt);
 assert.deepEqual(digest(),original);assert.equal(files.size,0);
 const corrupted=db.prepare("SELECT id,data FROM records WHERE kind='kingdee_supplier_catalog' ORDER BY rowid LIMIT 1").get(),tampered=JSON.parse(corrupted.data);tampered.name='篡改';db.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify(tampered),corrupted.id);assert.equal((await call('kingdee-supplier-catalog-result?requestId='+req)).status,409);
 console.log('PASS supplier catalog: two full scans, same-name identities, incremental append, idempotent receipts, changed identities, pagination failure and privacy');
 console.log('PASS supplier catalog worker: disabled by default, service identity, append-only and transactional fencing on lease expiry or replacement');
}finally{globalThis.fetch=originalFetch;db.close();}
