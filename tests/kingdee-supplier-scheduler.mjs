// Synthetic SQLite, independent test directory; never contacts Kingdee.
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {supplierCatalogScheduleConfig,createSupplierCatalogScheduler} from '../standalone/supplier-catalog-scheduler.mjs';

assert.equal(supplierCatalogScheduleConfig({}),null);
assert.equal(supplierCatalogScheduleConfig({DOON_KINGDEE_SUPPLIER_SYNC_ENABLED:'true'}),null);
assert.equal(supplierCatalogScheduleConfig({DOON_KINGDEE_SUPPLIER_SYNC_ENABLED:'1'}).intervalMs,86400000);
assert.throws(()=>supplierCatalogScheduleConfig({DOON_KINGDEE_SUPPLIER_SYNC_ENABLED:'1',DOON_KINGDEE_SUPPLIER_SYNC_INTERVAL_SECONDS:'59'}));
assert.throws(()=>supplierCatalogScheduleConfig({DOON_KINGDEE_SUPPLIER_SYNC_ENABLED:'1',DOON_KINGDEE_SUPPLIER_SYNC_INTERVAL_SECONDS:'1;DROP TABLE'}));
const config=supplierCatalogScheduleConfig({DOON_KINGDEE_SUPPLIER_SYNC_ENABLED:'1',DOON_KINGDEE_SUPPLIER_SYNC_INTERVAL_SECONDS:'60'});
const dir=await mkdtemp(path.resolve('test-output','supplier-scheduler-')),file=path.join(dir,'synthetic.sqlite');
const first=new DatabaseSync(file),second=new DatabaseSync(file);first.exec('PRAGMA journal_mode=WAL;CREATE TABLE protected_business(id TEXT PRIMARY KEY,value TEXT);INSERT INTO protected_business VALUES(\'original\',\'keep\');CREATE TABLE synthetic_effects(id TEXT PRIMARY KEY);');second.exec('PRAGMA busy_timeout=1000;');
const original=first.prepare('SELECT * FROM protected_business').all();let time=Date.now(),releaseA,releaseB;
const errors=[],logger={error:message=>errors.push(message)};
const waitA=new Promise(resolve=>{releaseA=resolve}),waitB=new Promise(resolve=>{releaseB=resolve});
function guardedWorker(db,wait,effect){return async({requestId,lease})=>{assert.match(requestId,/^[a-f0-9-]{36}$/);await wait;const held=db.prepare("SELECT 1 FROM kingdee_supplier_catalog_lease WHERE id='scheduler' AND worker=? AND fence=? AND expires_at>?").get(lease.workerId,lease.fence,time+1000);if(!held)throw Error('private upstream detail');db.prepare('INSERT INTO synthetic_effects VALUES(?)').run(effect);};}
const s1=createSupplierCatalogScheduler({db:first,config,runWorker:guardedWorker(first,waitA,'first'),clock:()=>time,logger}),s2=createSupplierCatalogScheduler({db:second,config,runWorker:guardedWorker(second,waitB,'second'),clock:()=>time,logger});
s1.start();s2.start();const a=s1.runOnce();assert.deepEqual(await s2.runOnce(),{status:'busy'});assert.deepEqual(await s1.runOnce(),{status:'not_started'});
time+=45001;const b=s2.runOnce();releaseA();assert.deepEqual(await a,{status:'failed'});let state=first.prepare("SELECT * FROM kingdee_supplier_catalog_schedule_status WHERE id='scheduler'").get();assert.equal(state.last_result,'started');assert.deepEqual(first.prepare('SELECT * FROM synthetic_effects').all(),[]);
releaseB();assert.deepEqual(await b,{status:'complete'});state=first.prepare("SELECT * FROM kingdee_supplier_catalog_schedule_status WHERE id='scheduler'").get();assert.equal(state.last_result,'complete');assert.ok(state.last_success_at);assert.deepEqual(first.prepare('SELECT id FROM synthetic_effects').all().map(v=>v.id),['second']);assert.deepEqual(first.prepare('SELECT * FROM protected_business').all(),original);
assert(errors.every(value=>!value.includes('private upstream detail')));s1.stop();s2.stop();assert.deepEqual(await s1.runOnce(),{status:'not_started'});
let unblock;const waitStop=new Promise(resolve=>{unblock=resolve});const other=supplierCatalogScheduleConfig({DOON_KINGDEE_SUPPLIER_SYNC_ENABLED:'1',DOON_KINGDEE_CLIENT_ID:'synthetic-client',DOON_KINGDEE_INSTANCE_ID:'synthetic-instance',DOON_KINGDEE_ACCOUNT_ID:'different-account'});assert.notEqual(other.bindingHash,config.bindingHash);const s3=createSupplierCatalogScheduler({db:first,config:other,runWorker:guardedWorker(first,waitStop,'stopped'),clock:()=>time,logger});s3.start();const c=s3.runOnce();state=first.prepare("SELECT * FROM kingdee_supplier_catalog_schedule_status WHERE id='scheduler'").get();assert.equal(state.binding_hash,other.bindingHash);assert.equal(state.last_success_at,'');s3.stop();unblock();assert.deepEqual(await c,{status:'failed'});assert.deepEqual(first.prepare('SELECT id FROM synthetic_effects').all().map(v=>v.id),['second']);
// A manual sync uses the same lease table and blocks the scheduler without invoking its worker.
first.prepare("UPDATE kingdee_supplier_catalog_lease SET worker='manual_test',fence=fence+1,expires_at=? WHERE id='scheduler'").run(time+180000);
let invoked=0;const s4=createSupplierCatalogScheduler({db:first,config,runWorker:async()=>{invoked++},clock:()=>time,logger});s4.start();assert.deepEqual(await s4.runOnce(),{status:'busy'});assert.equal(invoked,0);s4.stop();first.prepare("UPDATE kingdee_supplier_catalog_lease SET expires_at=0 WHERE id='scheduler'").run();
// A restarted scheduler recovers after a failed run, and renews its lease while running.
let unblockRenew;const waitRenew=new Promise(resolve=>{unblockRenew=resolve});const fast={...config,renewMs:20};const s5=createSupplierCatalogScheduler({db:second,config:fast,runWorker:guardedWorker(second,waitRenew,'renewed'),clock:()=>time,logger});s5.start();const d=s5.runOnce();const beforeRenew=first.prepare("SELECT expires_at FROM kingdee_supplier_catalog_lease WHERE id='scheduler'").get().expires_at;time+=5000;await new Promise(resolve=>setTimeout(resolve,60));const afterRenew=first.prepare("SELECT expires_at FROM kingdee_supplier_catalog_lease WHERE id='scheduler'").get().expires_at;assert(afterRenew>beforeRenew);unblockRenew();assert.deepEqual(await d,{status:'complete'});s5.stop();assert.deepEqual(first.prepare('SELECT id FROM synthetic_effects ORDER BY id').all().map(v=>v.id),['renewed','second']);
// A no-op read cannot report success if its lease expires before status is recorded.
const s6=createSupplierCatalogScheduler({db:first,config,clock:()=>time,logger,runWorker:async()=>{time+=45001}});s6.start();assert.deepEqual(await s6.runOnce(),{status:'failed'});s6.stop();assert.equal(first.prepare("SELECT last_result FROM kingdee_supplier_catalog_schedule_status WHERE id='scheduler'").get().last_result,'started');
// If commit succeeded but the lease is lost before the response, retain the commit;
// do not misreport success or restore an older database.
const s7=createSupplierCatalogScheduler({db:first,config,clock:()=>time,logger,runWorker:async()=>{first.prepare('INSERT INTO synthetic_effects VALUES(?)').run('committed-before-expiry');time+=45001}});s7.start();assert.deepEqual(await s7.runOnce(),{status:'failed'});s7.stop();assert(first.prepare("SELECT id FROM synthetic_effects WHERE id='committed-before-expiry'").get());assert.equal(first.prepare("SELECT last_result FROM kingdee_supplier_catalog_schedule_status WHERE id='scheduler'").get().last_result,'started');
first.close();second.close();

// A daily schedule persists its last attempt, including failures, so restarts
// neither duplicate a day's run nor postpone one that was missed while offline.
const scheduleDb=new DatabaseSync(':memory:'),daily=supplierCatalogScheduleConfig({DOON_KINGDEE_SUPPLIER_SYNC_ENABLED:'1',DOON_KINGDEE_ACCOUNT_ID:'synthetic-account'});
let scheduleTime=Date.parse('2026-01-01T00:00:00.000Z'),calls=0,failNext=false;
function fakeTimers(){let queue=[];return {setTimeout(fn,ms){const item={fn,ms,unref(){}};queue.push(item);return item;},clearTimeout(item){queue=queue.filter(value=>value!==item);},peek(){return queue[0];},async fire(){const item=queue.shift();assert(item);await item.fn();}};}
function scheduled(timers,config=daily){return createSupplierCatalogScheduler({db:scheduleDb,config,clock:()=>scheduleTime,logger, timers,runWorker:async()=>{calls++;if(failNext)throw Error('synthetic failure');}});}
const timersA=fakeTimers(),timersB=fakeTimers(),aDaily=scheduled(timersA),bDaily=scheduled(timersB);aDaily.start();bDaily.start();assert.equal(timersA.peek().ms,1000);assert.equal(timersB.peek().ms,1000);
await timersA.fire();assert.equal(calls,1);assert.equal(timersA.peek().ms,86400000);await timersB.fire();assert.equal(calls,1);assert.equal(timersB.peek().ms,86400000);aDaily.stop();bDaily.stop();
scheduleTime+=3600000;const restartTimers=fakeTimers(),restart=scheduled(restartTimers);restart.start();assert.equal(restartTimers.peek().ms,23*3600000);restart.stop();
scheduleTime+=24*3600000;const missedTimers=fakeTimers(),missed=scheduled(missedTimers);failNext=true;missed.start();assert.equal(missedTimers.peek().ms,1000);await missedTimers.fire();assert.equal(calls,2);assert.equal(scheduleDb.prepare("SELECT last_result FROM kingdee_supplier_catalog_schedule_status WHERE id='scheduler'").get().last_result,'failed');assert.equal(missedTimers.peek().ms,86400000);missed.stop();
const retryTimers=fakeTimers(),retry=scheduled(retryTimers);retry.start();assert.equal(retryTimers.peek().ms,86400000);retry.stop();scheduleTime+=86400000;failNext=false;const dueTimers=fakeTimers(),due=scheduled(dueTimers);due.start();assert.equal(dueTimers.peek().ms,1000);await dueTimers.fire();assert.equal(calls,3);due.stop();
const different=supplierCatalogScheduleConfig({DOON_KINGDEE_SUPPLIER_SYNC_ENABLED:'1',DOON_KINGDEE_ACCOUNT_ID:'another-synthetic-account'}),otherTimers=fakeTimers(),accountChanged=scheduled(otherTimers,different);accountChanged.start();assert.equal(otherTimers.peek().ms,1000);await otherTimers.fire();assert.equal(calls,4);accountChanged.stop();scheduleDb.close();
console.log('PASS supplier scheduler: daily persisted attempts, restart/missed/failure/account change, concurrency and unchanged original records');
