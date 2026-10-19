export function scheduleFields(host,value,onChange){
 let schedule={frequency:'daily',weekdays:[],...value};
 const el=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
 const label=(text,input)=>{const l=el('label');l.append(el('span',text),input);host.append(l);};
 const frequency=el('select');frequency.setAttribute('aria-label','执行频率');for(const [key,text]of [['daily','每天'],['weekdays','每周一至周五'],['weekly','每周指定星期']]){const o=el('option',text);o.value=key;frequency.append(o);}frequency.value=schedule.frequency;label('执行频率',frequency);
 const time=el('input');time.type='time';time.value=schedule.time;time.required=true;time.setAttribute('aria-label','执行时间（北京时间）');label('执行时间（北京时间）',time);
 const days=el('fieldset'),legend=el('legend','选择星期');days.append(legend);const checks=[];
 ['周一','周二','周三','周四','周五','周六','周日'].forEach((day,index)=>{const l=el('label'),c=el('input');c.type='checkbox';c.value=String(index+1);c.checked=schedule.weekdays.includes(index+1);c.setAttribute('aria-label',day);checks.push(c);l.append(c,el('span',day));days.append(l);c.addEventListener('change',()=>{schedule={...schedule,weekdays:checks.filter(c=>c.checked).map(c=>Number(c.value))};onChange(schedule);});});host.append(days);
 days.hidden=schedule.frequency!=='weekly';frequency.addEventListener('change',()=>{schedule={...schedule,frequency:frequency.value,weekdays:frequency.value==='weekly'?[1]:[]};for(const c of checks)c.checked=schedule.weekdays.includes(Number(c.value));days.hidden=frequency.value!=='weekly';onChange(schedule);});time.addEventListener('change',()=>{schedule={...schedule,time:time.value};onChange(schedule);});
}
