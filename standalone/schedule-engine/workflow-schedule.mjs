// Shared calendar schedules. Legacy {time, timezone} stays daily, without migration.
const weekdays=['周一','周二','周三','周四','周五','周六','周日'];
export function validateSchedule(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['time','timezone','frequency','weekdays'].includes(k))||!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)||input.timezone!=='Asia/Shanghai')throw new Error('定时任务使用北京时间 HH:mm。');
 const frequency=input.frequency===undefined?'daily':input.frequency,days=input.weekdays===undefined?[]:input.weekdays;
 if(!['daily','weekdays','weekly'].includes(frequency)||!Array.isArray(days)||days.some(d=>!Number.isInteger(d)||d<1||d>7)||new Set(days).size!==days.length||frequency==='weekly'&&!days.length||frequency!=='weekly'&&days.length)throw new Error('请选择有效的执行频率和星期。');
 return{time:input.time,timezone:'Asia/Shanghai',frequency,weekdays:[...days].sort((a,b)=>a-b)};
}
const selected=(s,weekday)=>s.frequency==='daily'||s.frequency==='weekdays'&&weekday<=5||s.frequency==='weekly'&&s.weekdays.includes(weekday);
export function scheduleSlot(input,at=Date.now()){
 const schedule=validateSchedule(input),date=new Date(Number(at)+8*3600000),day=date.toISOString().slice(0,10),weekday=date.getUTCDay()||7,dueAt=day+'T'+schedule.time+':00+08:00';
 return{day,dueAt,selected:selected(schedule,weekday),due:selected(schedule,weekday)&&Number(at)>=Date.parse(dueAt)};
}
export function nextScheduleRuns(input,after=Date.now(),count=3){
 const schedule=validateSchedule(input),day=scheduleSlot(schedule,after).day,start=Date.parse(day+'T00:00:00+08:00'),runs=[];
 for(let offset=0;offset<32&&runs.length<count;offset++){const slot=scheduleSlot(schedule,start+offset*86400000);if(slot.selected&&Date.parse(slot.dueAt)>Number(after))runs.push(slot.dueAt);}
 return runs;
}
export function describeSchedule(input){const s=validateSchedule(input);return(s.frequency==='daily'?'每天':s.frequency==='weekdays'?'每周一至周五':s.weekdays.map(d=>weekdays[d-1]).join('、'))+' '+s.time+'（北京时间）';}
