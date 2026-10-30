import {createHash} from 'node:crypto';
import {dailySchedule,intervalSchedule} from './fixed-schedule.mjs';
import {createFixedScheduler} from './fixed-scheduler.mjs';

// This configuration never starts a task unless explicitly enabled.
export function supplierCatalogScheduleConfig(env=process.env){
 if(env.DOON_KINGDEE_SUPPLIER_SYNC_ENABLED!=='1')return null;
 const integer=(key,fallback)=>{const v=env[key]??String(fallback);if(typeof v!=='string'||!/^\d{1,7}$/.test(v))throw Error('金蝶供应商定时配置无效。');return Number(v);};
 const mode=env.DOON_KINGDEE_SUPPLIER_SCHEDULE_MODE??'daily';
 if(!['daily','interval'].includes(mode))throw Error('金蝶供应商定时模式无效。');
 const maxRuns=integer('DOON_KINGDEE_SUPPLIER_SCHEDULE_MAX_RUNS',0);
 const schedule=mode==='interval'?intervalSchedule(integer('DOON_KINGDEE_SUPPLIER_SCHEDULE_INTERVAL_SECONDS',86400),maxRuns===0?null:maxRuns):dailySchedule({start:env.DOON_KINGDEE_SUPPLIER_SYNC_START_TIME??'07:00',count:integer('DOON_KINGDEE_SUPPLIER_SYNC_DAILY_COUNT',1),spacingMinutes:integer('DOON_KINGDEE_SUPPLIER_SYNC_SPACING_MINUTES',60),dayInterval:integer('DOON_KINGDEE_SUPPLIER_SYNC_EVERY_DAYS',1)});
 if(mode==='daily'&&maxRuns!==0)throw Error('每日定时不使用总次数上限。');
 const bindingHash=createHash('sha256').update(JSON.stringify(['kingdee-supplier-catalog-v1',env.DOON_KINGDEE_CLIENT_ID||'',env.DOON_KINGDEE_INSTANCE_ID||'',env.DOON_KINGDEE_ACCOUNT_ID||''])).digest('hex');
 return {schedule,leaseMs:45000,renewMs:10000,bindingHash};
}
export function createSupplierCatalogScheduler(options){
 return createFixedScheduler({...options,leaseTable:'kingdee_supplier_catalog_lease',statusTable:'kingdee_supplier_catalog_schedule_status',taskLabel:'金蝶供应商定时检查'});
}
