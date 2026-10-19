import {projectedDatasets,valueAt,validateTrigger,equal} from './workflow-triggers.mjs';

const fail=(message,status=403)=>Object.assign(new Error(message),{status});
const privateKey=key=>['me','capabilities','integration','businessTeamScope'].includes(key)||/(?:password|passwd|secret|token|cookie|authorization|credential|api.?key|session)/i.test(key);
export function businessProjection(value){
 if(Array.isArray(value))return value.map(businessProjection);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!privateKey(key)&&!['__proto__','prototype','constructor'].includes(key)).map(([key,item])=>[key,businessProjection(item)]));
 return value;
}
export function liveDataset(body,trigger){
 const projected=businessProjection(body),definition=projectedDatasets(projected).find(d=>d.path===trigger.dataset);
 if(!definition||definition.triggerable===false)throw fail('数据对象不可见或缺少稳定 ID。');
 try{validateTrigger(trigger,definition);}catch{throw fail('触发字段或读取权限已变化。');}
 const value=trigger.dataset==='/'?Object.fromEntries(Object.entries(projected).filter(([key])=>!['revision','asOf'].includes(key))):valueAt(projected,trigger.dataset),rows=Array.isArray(value)?value.flat(Infinity).filter(r=>r&&typeof r==='object'&&!Array.isArray(r)):value&&typeof value==='object'?[{...value,id:typeof value.id==='string'?value.id:'projection:'+trigger.dataset}]:[];
 return{definition,rows,revision:body.revision??null};
}
export function sameLiveEvent(event,trigger,rows){
 if(!equal(validateTrigger(event.triggerConfig),validateTrigger(trigger))||event.source!==trigger.source||event.dataset!==trigger.dataset||!equal(event.scope||{},trigger.scope||{}))return false;
 return rows.some(row=>row.id===event.recordId&&equal(row,event.after));
}
export function readableLiveHistory(previous,current){
 if(Array.isArray(previous))return Array.isArray(current)&&previous.every(value=>{const shape=value&&typeof value==='object'?current.find(v=>v&&typeof v==='object'&&typeof value.id==='string'&&v.id===value.id):current.find(v=>equal(value,v));return shape!==undefined&&readableLiveHistory(value,shape);});
 if(previous&&typeof previous==='object')return !!current&&typeof current==='object'&&!Array.isArray(current)&&Object.keys(previous).every(key=>Object.hasOwn(current,key)&&readableLiveHistory(previous[key],current[key]));
 return current!==undefined;
}
export function queryForEvent(query,event){
 if(query.source!==event.source||query.dataset!==event.dataset||!equal(query.scope||{},event.scope||{})||query.id&&query.id!==event.recordId)throw fail('查询超出本次触发记录的只读范围。');
 return{...query,id:event.recordId};
}
export function liveQuery({rows,definition,revision},input,now=Date.now()){
 const {offset=0,limit=10,id,query,fields}=input;
 if(!Number.isInteger(offset)||offset<0||offset>100000||!Number.isInteger(limit)||limit<1||limit>20||id!==undefined&&(typeof id!=='string'||id.length>160)||query!==undefined&&(typeof query!=='string'||query.length>160)||fields!==undefined&&(!Array.isArray(fields)||!fields.length||fields.length>40||fields.some(f=>!definition.fields.some(d=>d.path===f))))throw fail('查询范围或字段无效。');
 if(id)rows=rows.filter(row=>row.id===id);if(query)rows=rows.filter(row=>JSON.stringify(row).toLowerCase().includes(query.toLowerCase()));
 const selected=rows.slice(offset,offset+limit).map(row=>fields?.length?Object.fromEntries([...new Set(['/id','/version',...fields])].map(field=>[field,valueAt(row,field)])):row);
 const receipt={mode:'live-readonly',source:input.source,dataset:input.dataset,scope:input.scope||{},readAt:new Date(now).toISOString(),revision,total:rows.length,offset,nextOffset:offset+limit<rows.length?offset+limit:null,records:selected};
 if(Buffer.byteLength(JSON.stringify(receipt))>48*1024)throw fail('本页内容过多，请指定必要字段或缩小 limit。',413);
 return receipt;
}
