import {createHash} from 'node:crypto';
import {dailySchedule} from './fixed-schedule.mjs';
import {createFixedScheduler} from './fixed-scheduler.mjs';

export function kingdeePendingScheduleConfig(env=process.env){
 if(env.DOON_KINGDEE_PENDING_SYNC_ENABLED!=='1')return null;
 const bindingHash=createHash('sha256').update(JSON.stringify(['kingdee-pending-schedule-v1',env.DOON_KINGDEE_CLIENT_ID||'',env.DOON_KINGDEE_INSTANCE_ID||'',env.DOON_KINGDEE_ACCOUNT_ID||''])).digest('hex');
 return {schedule:dailySchedule({start:'08:00',count:2,spacingMinutes:240}),leaseMs:45000,renewMs:10000,bindingHash};
}
export function createKingdeePendingScheduler(options){
 return createFixedScheduler({...options,leaseTable:'kingdee_pending_schedule_lease',statusTable:'kingdee_pending_schedule_status',taskLabel:'金蝶采购未上货定时同步'});
}
