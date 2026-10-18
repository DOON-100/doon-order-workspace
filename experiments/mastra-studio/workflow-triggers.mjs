// Pure, deterministic conditions. Inputs must already be projected by the source
// module's authorization code. Never pass raw database rows to this evaluator.
export const triggerOperators={eq:'等于',ne:'不等于',gt:'大于 / 晚于',gte:'大于等于',lt:'小于 / 早于',lte:'小于等于',contains:'包含',empty:'为空',notEmpty:'不为空',changed:'发生变化',unchanged:'没有变化',becameEmpty:'从有值变为空',becameSet:'从空变为有值'};
const empty=v=>v===null||v===undefined||v===''||Array.isArray(v)&&v.length===0;
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
export const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const safeKey=k=>typeof k==='string'&&k.length<=200&&!['__proto__','constructor','prototype'].includes(k);
export const pointer=parts=>'/'+parts.map(p=>String(p).replaceAll('~','~0').replaceAll('/','~1')).join('/');
export function parts(path){if(typeof path!=='string'||!path.startsWith('/')||path.length>1200)throw new Error('字段路径无效');if(path==='/')return[];const result=path.slice(1).split('/').map(p=>p.replaceAll('~1','/').replaceAll('~0','~'));if(result.length>12||result.some(p=>!safeKey(p)))throw new Error('字段路径无效');return result;}
export function valueAt(value,path){const keys=parts(path);const read=(row,i)=>{if(i===keys.length)return row;const key=keys[i];if(key==='*')return Array.isArray(row)?row.map(v=>read(v,i+1)):undefined;return row&&typeof row==='object'&&Object.hasOwn(row,key)?read(row[key],i+1):undefined;};return read(value,0);}
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const timestamp=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:[zZ]|[+-]\d{2}:\d{2})?$/.test(v)&&date(v.slice(0,10))&&Number(v.slice(11,13))<=23&&Number(v.slice(14,16))<=59&&Number.isFinite(Date.parse(v));
const timestampNumber=v=>Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(v)?v:v.replace(' ','T')+'+08:00');
const decimal=v=>typeof v==='string'&&/^-?\d{1,15}(?:\.\d{1,8})?$/.test(v);
const inferred=(key,value)=>{
 if(empty(value)){if(/(?:Date|日期|交期|复期)$/.test(key))return'date';if(/(?:At|时间)$/.test(key))return'datetime';if(/^(quantity|received|remaining|missing|returnPending)$|Cents$/.test(key))return'number';if(/^(balanceKnown|active|promiseConfirmed)$/.test(key))return'boolean';return value===''?'string':'unknown';}
 return Array.isArray(value)?'array':typeof value==='object'?'object':typeof value==='string'&&date(value)?'date':timestamp(value)?'datetime':/(?:Price|price|单价)$/.test(key)&&decimal(value)?'decimal':typeof value;
};
const fieldLabels={id:'记录 ID',kind:'记录类型',version:'版本',name:'名称',title:'标题',status:'状态',customer:'客户',customerId:'客户 ID',supplier:'供应商',quantity:'数量',received:'已收数量',returnPending:'退货待补数量',balanceKnown:'收货已核对',remaining:'剩余数量',missing:'欠数',expectedDate:'预计到货',promisedDate:'供应商复期',dueDate:'到期日期',requestedDate:'客户要求交期',plannedDate:'预计完工日',shipDate:'预计可出货日',auditStatus:'审核状态',closeStatus:'关闭状态',lifecycle:'在跟 / 存档',orderNo:'订单号',po:'采购单号',drawing:'图纸编号',itemName:'商品名称',itemCode:'商品编码',buyer:'采购跟进人',notes:'备注',followupNote:'采购跟进备注',updatedAt:'更新时间',createdAt:'创建时间',fields:'业务字段',lines:'明细',ledger:'原表',columns:'原表列',profile:'客户档案',workflow:'跟进状态',amountCents:'金额（分）',currency:'币种'};
Object.assign(fieldLabels,{records:'业务记录',rows:'数据行',items:'业务条目',orders:'订单明细',reports:'报工记录',projects:'项目',tasks:'任务',customers:'客户',quotes:'报价',targetVersion:'目标版本',description:'说明',type:'类别',customerAccountId:'客户账户 ID',unitPrice:'单价',internalNotesZh:'内部说明',internalCosts:'内部成本',totalsByCurrency:'按币种汇总',balanceCents:'未结金额（分）',receivedCents:'已收金额（分）'});
const display=key=>fieldLabels[key]||key;
export function operatorsFor(type){return ['changed','unchanged','empty','notEmpty','becameEmpty','becameSet',...(['object','array','unknown'].includes(type)?[]:['eq','ne']),...(['number','date','datetime','decimal'].includes(type)?['gt','gte','lt','lte']:[]),...(['string','array'].includes(type)?['contains']:[])];}
export function describeDataset(rows,path,label=path){
 const map=new Map();
 const walk=(value,keys=[],depth=0)=>{
  if(depth>10||!value||typeof value!=='object')return;
  if(Array.isArray(value)){for(const item of value)if(item&&typeof item==='object')walk(item,[...keys,'*'],depth+1);return;}
  for(const key of Object.keys(value)){
   if(!safeKey(key))continue;const v=value[key],p=pointer([...keys,key]),type=keys.includes('*')?'array':inferred(key,v),old=map.get(p);
   const itemType=type==='array'?(keys.includes('*')?inferred(key,v):inferred(key,Array.isArray(v)?v.find(v=>!empty(v)):undefined)):undefined;
   const operators=operatorsFor(type).filter(op=>op!=='contains'||itemType!=='object');
   if(!old||old.type==='unknown')map.set(p,{path:p,label:[...keys,key].map(k=>k==='*'?'任一明细':display(k)).join(' / '),type,...(itemType?{itemType}:{}),operators});
   else if(type!=='unknown'&&old.type!==type){old.type='unknown';old.operators=operatorsFor('unknown');}
   else if(old.itemType==='unknown'&&itemType){old.itemType=itemType;old.operators=operators;}
   if(v&&typeof v==='object')walk(v,[...keys,key],depth+1);
  }
 };
 for(const row of rows)walk(row);
 return{path,label,fields:[...map.values()].sort((a,b)=>a.path.localeCompare(b.path)),count:rows.length};
}
export function projectedDatasets(payload){
 const datasets=[];const root=Object.fromEntries(Object.entries(payload).filter(([key])=>!['me','revision','asOf','capabilities','integration','businessTeamScope'].includes(key)));if(Object.keys(root).length)datasets.push(describeDataset([root],'/','页面数据概览（含计算与汇总字段）'));
 const walk=(value,keys=[],depth=0)=>{if(depth>8||!value||typeof value!=='object')return;
  if(Array.isArray(value)){if(value.some(v=>v&&typeof v==='object'&&!Array.isArray(v))){const rows=value.filter(v=>v&&typeof v==='object'&&!Array.isArray(v));datasets.push(describeDataset(rows,pointer(keys),keys.map(k=>k==='*'?'任一明细':display(k)).join(' / ')));for(const row of rows)for(const [key,child] of Object.entries(row))if(child&&typeof child==='object'&&safeKey(key))walk(child,[...keys,'*',key],depth+1);}return;}
  for(const [key,child] of Object.entries(value))if(safeKey(key)&&!['me','capabilities','integration','businessTeamScope'].includes(key)){if(child&&typeof child==='object'&&!Array.isArray(child))datasets.push(describeDataset([child],pointer([...keys,key]),[...keys,key].map(display).join(' / ')));walk(child,[...keys,key],depth+1);}
 };
 walk(payload);const merged=new Map();for(const d of datasets){const old=merged.get(d.path);if(!old)merged.set(d.path,d);else{old.count+=d.count;const fields=new Map(old.fields.map(f=>[f.path,f]));for(const f of d.fields)if(!fields.has(f.path))fields.set(f.path,f);old.fields=[...fields.values()];}}for(const d of merged.values()){const value=valueAt(payload,d.path);if(Array.isArray(value)){const rows=value.flat(Infinity).filter(r=>r&&typeof r==='object');d.triggerable=rows.every(r=>typeof r.id==='string')&&new Set(rows.map(r=>r.id)).size===rows.length;}else d.triggerable=true;}return[...merged.values()];
}
export const defaultTrigger=()=>({mode:'manual',source:'',dataset:'',scope:{},events:['updated'],watchFields:[],watchMode:'any',transition:'every',conditions:{mode:'all',items:[]},dedupe:'event-record',ignoreWorkflow:true,schedule:{time:'09:00',timezone:'Asia/Shanghai'}});
export function validateTrigger(input,catalog){
 const t={...defaultTrigger(),...input};
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!Object.hasOwn(defaultTrigger(),k)))throw new Error('触发器配置包含不支持的字段');
 if(!['manual','change','schedule'].includes(t.mode)||!['any','all'].includes(t.watchMode)||!['every','enter'].includes(t.transition)||t.dedupe!=='event-record'||t.ignoreWorkflow!==true)throw new Error('触发方式或去重策略无效');
 if(!Array.isArray(t.events)||!t.events.length||t.events.some(e=>!['created','updated'].includes(e))||new Set(t.events).size!==t.events.length)throw new Error('请选择新增或更新事件');
 if(!Array.isArray(t.watchFields)||t.watchFields.length>100||new Set(t.watchFields).size!==t.watchFields.length)throw new Error('监听字段无效');
 if(!t.schedule||Object.keys(t.schedule).some(k=>!['time','timezone'].includes(k))||!/^([01]\d|2[0-3]):[0-5]\d$/.test(t.schedule.time)||t.schedule.timezone!=='Asia/Shanghai')throw new Error('时间使用北京时间 HH:mm');
 if(t.mode!=='manual'&&(typeof t.source!=='string'||!t.source||t.source.length>160||!t.dataset))throw new Error('请选择业务模块和数据对象');
 if(t.dataset)parts(t.dataset);
 if(!t.scope||typeof t.scope!=='object'||Array.isArray(t.scope)||Object.entries(t.scope).some(([k,v])=>!['customerId','projectId','id','teamId'].includes(k)||typeof v!=='string'||v.length>160))throw new Error('查询范围无效');
 const allowed=catalog?new Map(catalog.fields.map(f=>[f.path,f])):null;
 const checkField=path=>{parts(path);if(allowed&&!allowed.has(path))throw new Error('字段不存在或不在当前授权范围内：'+path);};
 for(const f of t.watchFields)checkField(f);
 let size=0;
 const group=(g,depth=0)=>{if(++size>100||depth>4||!g||!['all','any'].includes(g.mode)||!Array.isArray(g.items)||g.items.length>30||Object.keys(g).some(k=>!['mode','items'].includes(k)))throw new Error('条件组无效，最多 4 层 / 100 项');
  for(const rule of g.items){if(rule?.mode){group(rule,depth+1);continue;}if(!rule||Object.keys(rule).some(k=>!['field','operator','value','compare'].includes(k))||!Object.hasOwn(triggerOperators,rule.operator)||!['literal','before'].includes(rule.compare))throw new Error('条件格式无效');checkField(rule.field);const f=allowed?.get(rule.field);if(f&&!f.operators.includes(rule.operator))throw new Error('字段类型不支持该比较方式');
   if(t.mode==='schedule'&&(rule.compare==='before'||['changed','unchanged','becameEmpty','becameSet'].includes(rule.operator)))throw new Error('定时检查没有修改前快照，请使用当前值筛选；字段变化请选业务变更触发。');
   if(rule.compare==='before'&&!['eq','ne','gt','gte','lt','lte'].includes(rule.operator))throw new Error('此条件不支持比较修改前的值');
   if(!['empty','notEmpty','changed','unchanged','becameEmpty','becameSet'].includes(rule.operator)&&rule.compare!=='before'){
    if(rule.value===undefined||rule.value===null||typeof rule.value==='object'||typeof rule.value==='string'&&rule.value.length>2000||typeof rule.value==='number'&&!Number.isFinite(rule.value))throw new Error('请填写有效的比较值');
    if(rule.value==='')throw new Error('请填写比较值；空值请使用“为空 / 不为空”条件。');
    if(f&&f.type!=='unknown'&&rule.operator!=='contains'&&(f.type==='number'?typeof rule.value!=='number':f.type==='boolean'?typeof rule.value!=='boolean':typeof rule.value!=='string'))throw new Error('比较值类型与字段不一致');
    if(f?.type==='date'&&!date(rule.value))throw new Error('日期应为有效的 YYYY-MM-DD');
    if(f?.type==='datetime'&&!timestamp(rule.value))throw new Error('请填写有效的日期时间，注明时区');
    if(f?.type==='decimal'&&!decimal(rule.value))throw new Error('单价最多 15 位整数、8 位小数');
   }
  }
 };
 group(t.conditions);if(t.mode==='schedule'&&t.transition==='enter')throw new Error('定时检查按每天当前值筛选，不支持首次进入条件。');if(t.transition==='enter'&&!t.conditions.items.length)throw new Error('首次进入条件需要至少一条筛选条件');return t;
}
export function evaluateTrigger(input,event,catalog){
 const t=validateTrigger(input,catalog),reasons=[],checks=[];const before=event.before??null,after=event.after??null;
 const compare=(rule,now,old,explain)=>{
  const a=valueAt(now,rule.field),previous=valueAt(old,rule.field),b=rule.compare==='before'?previous:rule.value;
  const definition=catalog.fields.find(f=>f.path===rule.field);let left=a,right=b;
  if(definition?.type==='datetime'&&timestamp(a)&&timestamp(b)){left=timestampNumber(a);right=timestampNumber(b);}
  if(definition?.type==='decimal'&&decimal(a)&&decimal(b)){const normalize=v=>{const [whole,fraction='']=v.replace(/^-/,'').split('.');const n=BigInt(whole+fraction.padEnd(8,'0'));return v.startsWith('-')?-n:n;};left=normalize(a);right=normalize(b);}
  let pass=false;switch(rule.operator){case'changed':pass=!equal(a,previous);break;case'unchanged':pass=equal(a,previous);break;case'empty':pass=empty(a);break;case'notEmpty':pass=!empty(a);break;case'becameEmpty':pass=!empty(previous)&&empty(a);break;case'becameSet':pass=empty(previous)&&!empty(a);break;case'eq':pass=!empty(a)&&!empty(b)&&typeof left===typeof right&&left===right;break;case'ne':pass=!empty(a)&&!empty(b)&&typeof left===typeof right&&left!==right;break;case'contains':pass=typeof a==='string'&&typeof b==='string'?a.includes(b):Array.isArray(a)&&a.some(v=>equal(v,b));break;default:if(!empty(a)&&!empty(b)&&typeof left===typeof right&&(typeof left==='bigint'||typeof left==='number'&&Number.isFinite(left)&&Number.isFinite(right)||date(left)&&date(right)))pass=({gt:left>right,gte:left>=right,lt:left<right,lte:left<=right})[rule.operator]===true;}
  if(explain)checks.push({field:rule.field,operator:rule.operator,pass,reason:empty(a)?'当前值缺失或为空':rule.compare==='before'&&empty(previous)?'修改前的值缺失或为空':pass?'条件满足':'条件不满足'});return pass;
 };
 const group=(g,now,old,explain)=>{const values=g.items.map(r=>r.mode?group(r,now,old,explain):compare(r,now,old,explain));return !values.length||g.mode==='all'?values.every(Boolean):values.some(Boolean);};
 if(t.mode==='manual')reasons.push('当前为手动触发');
 if(event.source!==t.source||event.dataset!==t.dataset)reasons.push('业务模块或数据对象不匹配');
 if(event.origin==='workflow')reasons.push('忽略工作流产生的变更，防止自触发');
 if(!after)reasons.push('记录已删除、不可见或无当前授权，不自动执行');
 if(t.mode==='change'){
  if(!t.events.includes(event.type))reasons.push('事件类型不匹配');
  const changed=catalog.fields.filter(f=>!equal(valueAt(before,f.path),valueAt(after,f.path))).map(f=>f.path);
  if(event.type==='updated'&&!changed.length)reasons.push('没有实际字段变化');
  if(t.watchFields.length){const values=t.watchFields.map(p=>changed.includes(p));if(!(t.watchMode==='all'?values.every(Boolean):values.some(Boolean)))reasons.push('监听字段未按要求变化');}
 }
 if(t.mode==='schedule'&&event.type!=='schedule')reasons.push('等待时间触发，不由普通修改启动');
 if(!group(t.conditions,after,before,true))reasons.push('当前数据不满足条件组');
 if(t.transition==='enter'&&group(t.conditions,before,null,false))reasons.push('修改前已经满足条件，本次不是首次进入');
 return{matched:reasons.length===0,reasons:reasons.length?reasons:['触发条件全部满足'],checks,dedupeKey:[event.id,event.recordId].join(':')};
}
