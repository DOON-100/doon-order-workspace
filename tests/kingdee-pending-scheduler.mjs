// Test environment, synthetic SQLite and Kingdee responses only.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID,createHash} from 'node:crypto';
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import {kingdeePendingScheduleConfig,createKingdeePendingScheduler} from '../standalone/kingdee-pending-job.mjs';
const settings={DOON_KINGDEE_PENDING_SYNC_ENABLED:'1',DOON_KINGDEE_READONLY_ENABLED:'1',DOON_KINGDEE_CLIENT_ID:'synthetic-client',DOON_KINGDEE_CLIENT_SECRET:'synthetic-secret',DOON_KINGDEE_INSTANCE_ID:'synthetic-instance',DOON_KINGDEE_ACCOUNT_ID:'synthetic-account'};
assert.equal(kingdeePendingScheduleConfig({}),null);
const config=kingdeePendingScheduleConfig(settings);assert.deepEqual(config.schedule,{kind:'daily',startMinute:480,count:2,spacingMinutes:240,dayInterval:1});
assert.notEqual(config.bindingHash,kingdeePendingScheduleConfig({...settings,DOON_KINGDEE_ACCOUNT_ID:'other'}).bindingHash);
function timers(){let queue=[];return {setTimeout(fn,ms){const t={fn,ms,unref(){}};queue.push(t);return t},clearTimeout(t){queue=queue.filter(x=>x!==t)},peek(){return queue[0]},async fire(){await queue.shift().fn()}}}
const scheduleDb=new DatabaseSync(':memory:');let time=Date.parse('2026-01-02T07:59:00+08:00'),runs=0;
const logger={error(){},info(){}},ta=timers(),tb=timers();
const create=t=>createKingdeePendingScheduler({db:scheduleDb,config,clock:()=>time,timers:t,logger,runWorker:async()=>{runs++}});
const a=create(ta),b=create(tb);a.start();b.start();assert.equal(ta.peek().ms,60000);time+=60000;await ta.fire();await tb.fire();assert.equal(runs,1);assert.equal(ta.peek().ms,4*3600000);a.stop();b.stop();
time+=3600000;const tr=timers(),restart=create(tr);restart.start();assert.equal(tr.peek().ms,3*3600000);time+=3*3600000;await tr.fire();assert.equal(runs,2);assert.equal(tr.peek().ms,20*3600000);restart.stop();
time+=24*3600000;const tm=timers(),missed=create(tm);missed.start();assert.equal(tm.peek().ms,1000);await tm.fire();assert.equal(runs,3);assert.equal(tm.peek().ms,20*3600000);missed.stop();scheduleDb.close();

await fs.mkdir('test-output',{recursive:true});const db=new DatabaseSync(':memory:');
for(const name of (await fs.readdir('drizzle')).filter(n=>n.endsWith('.sql')).sort())db.exec(await fs.readFile('drizzle/'+name,'utf8'));
db.exec("INSERT OR IGNORE INTO workspace_revision VALUES('main',0);CREATE TABLE kingdee_pending_schedule_lease(id TEXT PRIMARY KEY,worker TEXT,fence INTEGER,expires_at INTEGER)");
class Statement{constructor(sql,args=[]){this.sql=sql;this.args=args}bind(...args){return new Statement(this.sql,args)}async first(){return db.prepare(this.sql).get(...this.args)||null}async all(){return {results:db.prepare(this.sql).all(...this.args)}}async run(){return db.prepare(this.sql).run(...this.args)}}
let failCommit='',calls=0,mode='ok';const blobs=new Map();
const batch=async statements=>{if(failCommit==='revision')db.exec("UPDATE workspace_revision SET revision=revision+1");if(failCommit==='lease')db.exec("UPDATE kingdee_pending_schedule_lease SET expires_at=0");db.exec('BEGIN');try{for(const s of statements)db.prepare(s.sql).run(...s.args);if(failCommit==='storage')throw Error('synthetic storage failure');db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}};
globalThis.__pendingTestEnv={...settings,DB:{prepare:sql=>new Statement(sql),batch},BUCKET:{get:async key=>({body:blobs.get(key)})}};
await build({entryPoints:['lib/kingdee-pending-worker.ts'],outfile:'test-output/kingdee-pending-worker-test.mjs',bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@':process.cwd()},plugins:[{name:'synthetic',setup(b){b.onResolve({filter:/^cloudflare:workers$|chatgpt-auth$/},a=>({path:a.path,namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},a=>({contents:a.path==='cloudflare:workers'?'export const env=globalThis.__pendingTestEnv':'export async function getChatGPTUser(){return null}'}))}}]});
const {runKingdeePendingWorker:run}=await import('../test-output/kingdee-pending-worker-test.mjs');
const lease={workerId:'synthetic-worker',fence:1};
const renew=()=>db.prepare("INSERT INTO kingdee_pending_schedule_lease VALUES('scheduler',?,?,?) ON CONFLICT(id) DO UPDATE SET worker=excluded.worker,fence=excluded.fence,expires_at=excluded.expires_at").run(lease.workerId,lease.fence,Date.now()+120000);
const rows=()=>db.prepare('SELECT data FROM records ORDER BY id').all().map(x=>JSON.parse(x.data));const insert=r=>db.prepare('INSERT INTO records VALUES(?,?,?)').run(r.id,r.kind,JSON.stringify(r));
const legacy={id:'legacy',kind:'purchase',po:'PO-30',itemCode:'MAT',supplier:'Synthetic supplier',unit:'件',note:'preserve'};insert(legacy);
const originals=JSON.stringify(rows());let count=91;const oldFetch=globalThis.fetch;
const summary=i=>({id:String(i),bill_no:'PO-'+i,bill_status:'C',supplier_id:'SUP',supplier_name:'Synthetic supplier',real_io_status:i<30?'C':'A'});
globalThis.fetch=async(input,init)=>{
 calls++;const u=new URL(input);
 if(u.pathname.endsWith('push_app_authorize'))return Response.json({code:200,data:[{clientId:settings.DOON_KINGDEE_CLIENT_ID,outerInstanceId:settings.DOON_KINGDEE_INSTANCE_ID,accountId:settings.DOON_KINGDEE_ACCOUNT_ID,status:1,appKey:'key',appSecret:'secret',domain:'https://tf.jdy.com'}]});
 if(u.pathname.endsWith('kingdee_auth_token'))return Response.json({errcode:0,data:{'app-token':'synthetic-token'}});
 assert.equal(init.method,'GET');
 if(u.pathname.endsWith('/pur_order')){assert.equal(u.searchParams.get('page_size'),'30');assert.equal(u.searchParams.get('bill_status'),'C');const page=Number(u.searchParams.get('page')),rs=Array.from({length:count},(_,i)=>summary(i)).slice((page-1)*30,page*30);if(mode==='short'&&page===2)rs.pop();if(mode==='duplicate'&&page===2)rs[0].id='0';return Response.json({errcode:0,data:{count,page,page_size:30,current_page_size:rs.length,rows:rs}});}
 assert.equal(u.pathname,'/jdy/v2/scm/pur_order_detail');const id=Number(u.searchParams.get('id'));assert(id>=30);const s=summary(id);
 return Response.json({errcode:0,data:{...s,id:mode==='identity'&&id===30?'wrong':s.id,bill_date:'2026-01-01',bill_close_state:'C',material_entity:[{id:'line-'+id,material_number:'MAT',material_name:'Synthetic item',unit_name:'件',qty:mode==='changed'&&id===30?20:10,delivery_date:'2026-01-05',entry_realio_status:'A',close_state:'1'}]}});
};
try{
 globalThis.__pendingTestEnv.DOON_KINGDEE_PENDING_SYNC_ENABLED='0';await assert.rejects(()=>run({requestId:randomUUID(),lease}));assert.equal(calls,0);globalThis.__pendingTestEnv.DOON_KINGDEE_PENDING_SYNC_ENABLED='1';renew();
 const requestId=randomUUID(),first=await run({requestId,lease});assert.deepEqual(first,{inserted:61,existing:0,held:0,changed:0,total:61});assert.equal(rows().filter(r=>r.kind==='kingdee_pending_api_row').length,61);assert.deepEqual(rows().find(r=>r.id==='legacy'),legacy);
 const beforeRepeat=JSON.stringify(rows()),beforeCalls=calls;assert.deepEqual(await run({requestId,lease}),first);assert.equal(calls,beforeCalls);assert.equal(JSON.stringify(rows()),beforeRepeat);
 assert.equal((await run({requestId:randomUUID(),lease})).inserted,0);
 mode='changed';assert.equal((await run({requestId:randomUUID(),lease})).changed,1);assert.equal(rows().find(r=>r.kind==='kingdee_pending_api_row'&&r.row.values[14]==='30').row.values[9],'10');assert.equal(rows().filter(r=>r.kind==='kingdee_pending_schedule_issue').length,1);await run({requestId:randomUUID(),lease});assert.equal(rows().filter(r=>r.kind==='kingdee_pending_schedule_issue').length,1);
 for(const failure of ['short','duplicate','identity']){mode=failure;const before=JSON.stringify(rows());await assert.rejects(()=>run({requestId:randomUUID(),lease}));assert.equal(JSON.stringify(rows()),before);}mode='ok';count++;
 for(const failure of ['revision','lease','storage']){renew();failCommit=failure;const before=JSON.stringify(rows());await assert.rejects(()=>run({requestId:randomUUID(),lease}));assert.equal(JSON.stringify(rows()),before);}failCommit='';renew();
 assert.equal((await run({requestId:randomUUID(),lease})).inserted,1);
 // An Excel row is already part of this view; its raw snapshot must not be duplicated.
 const text=JSON.stringify([{rowType:'data',values:['PO-92','MAT','Synthetic supplier','件']}]);blobs.set('synthetic',text);insert({id:'snapshot',kind:'kingdee_pending_snapshot',rowsKey:'synthetic',rowsHash:createHash('sha256').update(text).digest('hex'),headers:['单据编号','商品编码','供应商','单位']});count++;
 assert.equal((await run({requestId:randomUUID(),lease})).inserted,0);assert.equal(JSON.stringify(rows().filter(r=>r.id==='legacy')),originals);
 const beforeExpired=calls;db.exec("UPDATE kingdee_pending_schedule_lease SET expires_at=0");await assert.rejects(()=>run({requestId:randomUUID(),lease}));assert.equal(calls,beforeExpired);
}finally{globalThis.fetch=oldFetch;db.close()}
console.log('PASS pending scheduler: Shanghai 08:00/12:00, restart, two workers, full pagination, legacy/Excel preservation, idempotency, source changes, lease/revision/storage rollback; manual routes untouched');
