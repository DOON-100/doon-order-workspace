import {randomUUID} from 'node:crypto';
import {scheduleDelay} from './fixed-schedule.mjs';

export function createFixedScheduler({db,config,runWorker,leaseTable,statusTable,taskLabel,clock=Date.now,logger=console,timers={setTimeout,clearTimeout}}){
 if(!/^[a-z][a-z0-9_]{0,80}$/.test(leaseTable)||!/^[a-z][a-z0-9_]{0,80}$/.test(statusTable)||typeof taskLabel!=='string'||!taskLabel.trim())throw Error('定时任务定义无效。');
 if(!config||typeof runWorker!=='function')throw Error('固定任务定时配置无效。');
 // New table only on explicitly enabled startup. Never modify existing business tables.
 db.exec(`CREATE TABLE IF NOT EXISTS ${leaseTable}(id TEXT PRIMARY KEY,worker TEXT NOT NULL,fence INTEGER NOT NULL,expires_at INTEGER NOT NULL)`);
 db.exec(`CREATE TABLE IF NOT EXISTS ${statusTable}(id TEXT PRIMARY KEY,binding_hash TEXT NOT NULL,last_attempt_at TEXT NOT NULL,last_result TEXT NOT NULL,last_success_at TEXT NOT NULL)`);
 const registrationTable=statusTable+'_registration';
 db.exec(`CREATE TABLE IF NOT EXISTS ${registrationTable}(binding_hash TEXT NOT NULL,mode TEXT NOT NULL,registered_at INTEGER NOT NULL,last_attempt_at INTEGER,PRIMARY KEY(binding_hash,mode))`);
 const limited=config.schedule.kind==='interval'&&config.schedule.maxRuns!==null,counterTable=statusTable+'_runs';
 if(limited)db.exec(`CREATE TABLE IF NOT EXISTS ${counterTable}(binding_hash TEXT PRIMARY KEY,attempts INTEGER NOT NULL)`);
 let stopped=true,running=false,timer=null,heartbeat=null,active=null,registeredAt=clock()-(config.schedule.kind==='daily'?1:0);
 function transaction(fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}
 // Attempts are scoped to the registered task binding and schedule mode.
 // A restart retains the next due time and coalesces missed slots.
 function delayUntilDue(){
  if(limitReached())return Infinity;
  const row=ensureRegistration();
  const attempt=row?.last_attempt_at??row?.registered_at??registeredAt;
  return scheduleDelay(config.schedule,clock(),attempt,row?.registered_at??registeredAt);
 }
 function ensureRegistration(){
  let row=db.prepare(`SELECT registered_at,last_attempt_at FROM ${registrationTable} WHERE binding_hash=? AND mode=?`).get(config.bindingHash,config.schedule.kind);
  if(row)return row;
  db.prepare(`INSERT OR IGNORE INTO ${registrationTable}(binding_hash,mode,registered_at,last_attempt_at) VALUES(?,?,?,NULL)`).run(config.bindingHash,config.schedule.kind,registeredAt);
  row=db.prepare(`SELECT registered_at,last_attempt_at FROM ${registrationTable} WHERE binding_hash=? AND mode=?`).get(config.bindingHash,config.schedule.kind);
  if(!row)throw Error('定时登记不可用。');return row;
 }
 function limitReached(){if(!limited)return false;const row=db.prepare(`SELECT attempts FROM ${counterTable} WHERE binding_hash=?`).get(config.bindingHash);return !!row&&row.attempts>=config.schedule.maxRuns;}
 function acquire(workerId,onlyIfDue){
  const now=clock();return transaction(()=>{
   // Check while holding the same SQLite write lock as lease acquisition: two
   // processes waking together cannot both start the same scheduled day.
   if(limitReached()||(onlyIfDue&&delayUntilDue()>0))return {notDue:true};
   ensureRegistration();
   db.prepare(`INSERT OR IGNORE INTO ${leaseTable}(id,worker,fence,expires_at) VALUES('scheduler','',0,0)`).run();
   const changed=db.prepare(`UPDATE ${leaseTable} SET worker=?,fence=fence+1,expires_at=? WHERE id='scheduler' AND expires_at<=? AND fence<9007199254740990`).run(workerId,now+config.leaseMs,now);
   if(changed.changes!==1)return null;
   const row=db.prepare(`SELECT fence FROM ${leaseTable} WHERE id='scheduler' AND worker=?`).get(workerId);
   return row&&Number.isSafeInteger(row.fence)?{workerId,fence:row.fence}:null;
  });
 }
 function renew(lease){
  const now=clock();return db.prepare(`UPDATE ${leaseTable} SET expires_at=? WHERE id='scheduler' AND worker=? AND fence=? AND expires_at>?`).run(now+config.leaseMs,lease.workerId,lease.fence,now+1000).changes===1;
 }
 function release(lease){return db.prepare(`UPDATE ${leaseTable} SET worker='',expires_at=0 WHERE id='scheduler' AND worker=? AND fence=?`).run(lease.workerId,lease.fence).changes===1;}
 function status(lease,result,attemptedAt){return db.prepare(`INSERT INTO ${statusTable}(id,binding_hash,last_attempt_at,last_result,last_success_at) SELECT 'scheduler',?,?,?,? WHERE EXISTS(SELECT 1 FROM ${leaseTable} WHERE id='scheduler' AND worker=? AND fence=? AND expires_at>?) ON CONFLICT(id) DO UPDATE SET binding_hash=excluded.binding_hash,last_attempt_at=excluded.last_attempt_at,last_result=excluded.last_result,last_success_at=CASE WHEN excluded.last_result='complete' THEN excluded.last_success_at WHEN ${statusTable}.binding_hash=excluded.binding_hash THEN ${statusTable}.last_success_at ELSE '' END`).run(config.bindingHash,attemptedAt,result,result==='complete'?new Date(clock()).toISOString():'',lease.workerId,lease.fence,clock()+1000).changes===1;}
 async function runOnce(onlyIfDue=false){
  if(stopped||running)return {status:'not_started'};
  running=true;let lease,attemptedAt,startedMs;
  try{
   lease=acquire(randomUUID(),onlyIfDue);if(!lease)return {status:'busy'};if(lease.notDue){lease=null;return {status:'not_due'};}
   active=lease;
   startedMs=clock();attemptedAt=new Date(startedMs).toISOString();transaction(()=>{if(!status(lease,'started',attemptedAt))throw Error('lease expired');if(db.prepare(`UPDATE ${registrationTable} SET last_attempt_at=? WHERE binding_hash=? AND mode=?`).run(startedMs,config.bindingHash,config.schedule.kind).changes!==1)throw Error('定时登记不可用。');if(limited)db.prepare(`INSERT INTO ${counterTable}(binding_hash,attempts) VALUES(?,1) ON CONFLICT(binding_hash) DO UPDATE SET attempts=attempts+1`).run(config.bindingHash);});
   heartbeat=setInterval(()=>{try{if(!renew(lease)){clearInterval(heartbeat);heartbeat=null;}}catch{clearInterval(heartbeat);heartbeat=null;}},config.renewMs);heartbeat.unref?.();
   await runWorker({requestId:randomUUID(),lease});
   if(!status(lease,'complete',attemptedAt))throw Error('lease expired before completion status');
   return {status:'complete'};
  }catch{if(lease&&attemptedAt)try{status(lease,'failed',attemptedAt);}catch{}logger.error(`${taskLabel}未完成，请检查服务端配置和最近成功时间。`);return {status:'failed'};}
  finally{if(startedMs!==undefined)logger.info?.(`${taskLabel}耗时 ${Math.max(0,clock()-startedMs)} 毫秒。`);if(heartbeat){clearInterval(heartbeat);heartbeat=null;}if(lease)try{release(lease);}catch{}active=null;running=false;}
 }
 function schedule(minimumDelay=0){
  if(stopped)return;let delay;
  try{delay=Math.max(minimumDelay,delayUntilDue());}catch{logger.error(`${taskLabel}状态不可用，请检查服务端配置。`);delay=60000;}
  if(!Number.isFinite(delay))return;
  // A short startup delay keeps server startup independent of network access.
  timer=timers.setTimeout(async()=>{timer=null;const result=await runOnce(true);schedule(result.status==='busy'?10000:0);},Math.min(2147483647,Math.max(1000,delay)));timer.unref?.();
 }
 function start(){if(!stopped)return;registeredAt=clock()-(config.schedule.kind==='daily'?1:0);stopped=false;schedule();}
 function stop(){stopped=true;if(timer){timers.clearTimeout(timer);timer=null;}if(heartbeat){clearInterval(heartbeat);heartbeat=null;}if(active)try{release(active);}catch{}}
 return {start,stop,runOnce};
}
