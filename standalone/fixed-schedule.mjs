// Fixed-program schedules use a fixed UTC+8 offset, independent of server timezone.
// dayInterval controls frequency; count and spacingMinutes control runs per day.
const DAY=86400000, MINUTE=60000, OFFSET=8*60*MINUTE;
export function dailySchedule({start='07:00',count=1,spacingMinutes=60,dayInterval=1}={}){
 if(typeof start!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(start))throw Error('定时开始时间无效。');
 if(!Number.isInteger(count)||count<1||count>24||!Number.isInteger(spacingMinutes)||spacingMinutes<1||spacingMinutes>1440||!Number.isInteger(dayInterval)||dayInterval<1||dayInterval>365)throw Error('定时频率或次数无效。');
 const [hour,minute]=start.split(':').map(Number),startMinute=hour*60+minute;
 if(startMinute+(count-1)*spacingMinutes>=1440)throw Error('定时次数超出当天范围。');
 return Object.freeze({kind:'daily',startMinute,count,spacingMinutes,dayInterval});
}
// maxRuns limits total attempts for this task binding; null means no limit.
export function intervalSchedule(seconds,maxRuns=null){
 if(!Number.isInteger(seconds)||seconds<60||seconds>86400||!(maxRuns===null||Number.isSafeInteger(maxRuns)&&maxRuns>=1&&maxRuns<=1000000))throw Error('定时间隔或执行次数无效。');
 return Object.freeze({kind:'interval',intervalMs:seconds*1000,maxRuns});
}
// A missed slot is coalesced into one execution. Repeated restarts and failures
// do not repeat the same slot. Never replay every missed interval as a burst.
export function scheduleDelay(schedule,now,lastAttempt,registeredAt){
 if(!Number.isFinite(now))throw Error('定时时钟无效。');
 const last=Number.isFinite(lastAttempt)?lastAttempt:null;
 if(schedule.kind==='interval')return last===null?0:Math.max(0,Math.min(schedule.intervalMs,last+schedule.intervalMs-now));
 if(schedule.kind!=='daily')throw Error('定时规则无效。');
 const day=Math.floor((now+OFFSET)/DAY),dayStart=day*DAY-OFFSET;
 const anchor=Number.isFinite(registeredAt)?Math.floor((registeredAt+OFFSET)/DAY):0;
 const isActive=value=>((value-anchor)%schedule.dayInterval+schedule.dayInterval)%schedule.dayInterval===0;
 const active=isActive(day);
 let latest=null,next=null;
 if(active)for(let i=0;i<schedule.count;i++){const slot=dayStart+(schedule.startMinute+i*schedule.spacingMinutes)*MINUTE;if(slot<=now)latest=slot;else if(next===null)next=slot;}
 if(latest!==null&&(last===null?latest===now:last<latest))return 0;
 if(last!==null&&latest===null){let previousDay=day-1;while(!isActive(previousDay))previousDay--;const previous=previousDay*DAY-OFFSET+(schedule.startMinute+(schedule.count-1)*schedule.spacingMinutes)*MINUTE;if(last<previous)return 0;}
 if(next!==null)return Math.max(0,next-now);
 let nextDay=day+1;while(!isActive(nextDay))nextDay++;
 return Math.max(0,nextDay*DAY-OFFSET+schedule.startMinute*MINUTE-now);
}
