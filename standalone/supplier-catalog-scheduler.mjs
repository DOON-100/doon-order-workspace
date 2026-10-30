import {createHash,randomUUID} from 'node:crypto';

// This scheduler is opt-in and uses the exact same database as the service.
// The worker verifies this lease and the workspace revision in its commit.
export function supplierCatalogScheduleConfig(env=process.env){
 if(env.DOON_KINGDEE_SUPPLIER_SYNC_ENABLED!=='1')return null;
 const raw=env.DOON_KINGDEE_SUPPLIER_SYNC_INTERVAL_SECONDS||'86400';
 if(!/^\d{1,5}$/.test(raw))throw Error('金蝶供应商同步间隔无效。');
 const seconds=Number(raw);if(seconds<60||seconds>86400)throw Error('金蝶供应商同步间隔须为 60 至 86400 秒。');
 const bindingHash=createHash('sha256').update(JSON.stringify(['kingdee-supplier-catalog-v1',env.DOON_KINGDEE_CLIENT_ID||'',env.DOON_KINGDEE_INSTANCE_ID||'',env.DOON_KINGDEE_ACCOUNT_ID||''])).digest('hex');
 return {intervalMs:seconds*1000,leaseMs:45000,renewMs:10000,bindingHash};
}

export function createSupplierCatalogScheduler({db,config,runWorker,clock=Date.now,logger=console,timers={setTimeout,clearTimeout}}){
 if(!config||typeof runWorker!=='function')throw Error('供应商同步调度配置无效。');
 // New table only on explicitly enabled startup. Never modify existing business tables.
 db.exec('CREATE TABLE IF NOT EXISTS kingdee_supplier_catalog_lease(id TEXT PRIMARY KEY,worker TEXT NOT NULL,fence INTEGER NOT NULL,expires_at INTEGER NOT NULL)');
 db.exec('CREATE TABLE IF NOT EXISTS kingdee_supplier_catalog_schedule_status(id TEXT PRIMARY KEY,binding_hash TEXT NOT NULL,last_attempt_at TEXT NOT NULL,last_result TEXT NOT NULL,last_success_at TEXT NOT NULL)');
 let stopped=true,running=false,timer=null,heartbeat=null,active=null;
 function transaction(fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}
 // The persisted attempt is scoped to the configured account. A restart retains
 // the next due time; a missed run or a new account runs after startup.
 function delayUntilDue(){
  const row=db.prepare("SELECT binding_hash,last_attempt_at FROM kingdee_supplier_catalog_schedule_status WHERE id='scheduler'").get();
  if(!row||row.binding_hash!==config.bindingHash)return 0;
  const attempt=Date.parse(row.last_attempt_at);if(!Number.isFinite(attempt))return 0;
  return Math.max(0,Math.min(config.intervalMs,attempt+config.intervalMs-clock()));
 }
 function acquire(workerId,onlyIfDue){
  const now=clock();return transaction(()=>{
   // Check while holding the same SQLite write lock as lease acquisition: two
   // processes waking together cannot both start the same scheduled day.
   if(onlyIfDue&&delayUntilDue()>0)return {notDue:true};
   db.prepare("INSERT OR IGNORE INTO kingdee_supplier_catalog_lease(id,worker,fence,expires_at) VALUES('scheduler','',0,0)").run();
   const changed=db.prepare("UPDATE kingdee_supplier_catalog_lease SET worker=?,fence=fence+1,expires_at=? WHERE id='scheduler' AND expires_at<=? AND fence<9007199254740990").run(workerId,now+config.leaseMs,now);
   if(changed.changes!==1)return null;
   const row=db.prepare("SELECT fence FROM kingdee_supplier_catalog_lease WHERE id='scheduler' AND worker=?").get(workerId);
   return row&&Number.isSafeInteger(row.fence)?{workerId,fence:row.fence}:null;
  });
 }
 function renew(lease){
  const now=clock();return db.prepare("UPDATE kingdee_supplier_catalog_lease SET expires_at=? WHERE id='scheduler' AND worker=? AND fence=? AND expires_at>?").run(now+config.leaseMs,lease.workerId,lease.fence,now+1000).changes===1;
 }
 function release(lease){return db.prepare("UPDATE kingdee_supplier_catalog_lease SET worker='',expires_at=0 WHERE id='scheduler' AND worker=? AND fence=?").run(lease.workerId,lease.fence).changes===1;}
 function status(lease,result,attemptedAt){return db.prepare("INSERT INTO kingdee_supplier_catalog_schedule_status(id,binding_hash,last_attempt_at,last_result,last_success_at) SELECT 'scheduler',?,?,?,? WHERE EXISTS(SELECT 1 FROM kingdee_supplier_catalog_lease WHERE id='scheduler' AND worker=? AND fence=? AND expires_at>?) ON CONFLICT(id) DO UPDATE SET binding_hash=excluded.binding_hash,last_attempt_at=excluded.last_attempt_at,last_result=excluded.last_result,last_success_at=CASE WHEN excluded.last_result='complete' THEN excluded.last_success_at WHEN kingdee_supplier_catalog_schedule_status.binding_hash=excluded.binding_hash THEN kingdee_supplier_catalog_schedule_status.last_success_at ELSE '' END").run(config.bindingHash,attemptedAt,result,result==='complete'?new Date(clock()).toISOString():'',lease.workerId,lease.fence,clock()+1000).changes===1;}
 async function runOnce(onlyIfDue=false){
  if(stopped||running)return {status:'not_started'};
  running=true;let lease,attemptedAt,startedMs;
  try{
   lease=acquire(randomUUID(),onlyIfDue);if(!lease)return {status:'busy'};if(lease.notDue){lease=null;return {status:'not_due'};}
   active=lease;
   startedMs=clock();attemptedAt=new Date(startedMs).toISOString();if(!status(lease,'started',attemptedAt))throw Error('lease expired');
   heartbeat=setInterval(()=>{try{if(!renew(lease)){clearInterval(heartbeat);heartbeat=null;}}catch{clearInterval(heartbeat);heartbeat=null;}},config.renewMs);heartbeat.unref?.();
   await runWorker({requestId:randomUUID(),lease});
   if(!status(lease,'complete',attemptedAt))throw Error('lease expired before completion status');
   return {status:'complete'};
  }catch{if(lease&&attemptedAt)try{status(lease,'failed',attemptedAt);}catch{}logger.error('金蝶供应商定时同步未完成，请检查服务端配置和最近成功时间。');return {status:'failed'};}
  finally{if(startedMs!==undefined)logger.info?.(`金蝶供应商定时检查耗时 ${Math.max(0,clock()-startedMs)} 毫秒。`);if(heartbeat){clearInterval(heartbeat);heartbeat=null;}if(lease)try{release(lease);}catch{}active=null;running=false;}
 }
 function schedule(minimumDelay=0){
  if(stopped)return;let delay;
  try{delay=Math.max(minimumDelay,delayUntilDue());}catch{logger.error('金蝶供应商定时同步状态不可用，请检查服务端配置。');delay=60000;}
  // A short startup delay keeps server startup independent of network access.
  timer=timers.setTimeout(async()=>{timer=null;const result=await runOnce(true);schedule(result.status==='busy'?10000:0);},Math.max(1000,delay));timer.unref?.();
 }
 function start(){if(!stopped)return;stopped=false;schedule();}
 function stop(){stopped=true;if(timer){timers.clearTimeout(timer);timer=null;}if(heartbeat){clearInterval(heartbeat);heartbeat=null;}if(active)try{release(active);}catch{}}
 return {start,stop,runOnce};
}
