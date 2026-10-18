import {env} from 'cloudflare:workers';
import {packed,productTypeOf,type Member,type State,type Order,type Report} from './domain';
import {balance,currentStage,warehouse,stageDefs,stageNumbers,dateCols,quantityCols,dateValue,countValue,colLabels} from './ledger';
import {remaining,full,purchaseStatus,type Purchase} from './purchases';
import {AppError,database,json} from './store';
import {workflowEventStates,workflowEventsEnabled} from './workflow-events';
import {workflowSources} from '../experiments/mastra-studio/workflow-sources.mjs';
import {describeDataset,equal,evaluateTrigger,projectedDatasets,validateTrigger,valueAt,operatorsFor} from '../experiments/mastra-studio/workflow-triggers.mjs';
type ReadView=(action:string,req:Request,s:State,m:Member)=>Promise<Response>;
type Row=Record<string,any>;
const scopeKeys=['customerId','projectId','id','teamId'];
function scopeOf(raw:unknown){if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new AppError('查询范围无效');const scope=raw as Record<string,string>;if(Object.entries(scope).some(([k,v])=>!scopeKeys.includes(k)||typeof v!=='string'||v.length>160))throw new AppError('查询范围无效');return scope;}
async function payload(read:ReadView,source:string,scope:Record<string,string>,req:Request,s:State,m:Member){
 const definition=workflowSources.find(v=>v.id===source);if(!definition)throw new AppError('业务模块未注册',404);
 if(Object.entries(scope).some(([key,value])=>value&&!definition.scopeParams.includes(key)))throw new AppError('该模块不支持此范围筛选，请使用字段条件。');
 const url=new URL('/api/workspace/'+source,req.url);for(const [k,v] of Object.entries(scope))if(v)url.searchParams.set(k,v);
 const response=await read(source,new Request(url,{headers:req.headers}),s,m);
 if(!response.ok)throw new AppError('该业务模块或查询范围不可用',response.status===403?403:400);
 if(!response.headers.get('Content-Type')?.includes('application/json'))throw new AppError('该模块不提供结构化字段',400);
 const body=await response.json() as Row;
 if(source==='data'&&Array.isArray(body.orders))body.orders=body.orders.map((order:Order)=>({...order,computed:{productType:productTypeOf(order),currentStage:currentStage(order),remaining:balance(order,(body.reports||[]) as Report[]),warehouse:warehouse(order),packed:packed(order,(body.reports||[]) as Report[]),processes:stageDefs.map(def=>({id:def.id,name:def.name,...stageNumbers(order,def)})),normalizedColumns:order.ledger?Object.fromEntries([...dateCols.map(k=>[k,dateValue(order.ledger!.columns[k])]),...quantityCols.map(k=>[k,countValue(order.ledger!.columns[k])])]):{}}}));
 if(source==='purchase-data'&&Array.isArray(body.rows))body.rows=body.rows.map((row:Purchase)=>({...row,computed:{remaining:remaining(row),full:full(row),status:purchaseStatus(row)}}));
 return body;
}
function datasetsOf(body:Row){const datasets=projectedDatasets(body);for(const d of datasets)for(const f of d.fields){const match=f.path.match(/\/(?:ledger\/columns|computed\/normalizedColumns)\/([A-Z]+)$/);if(match&&colLabels[match[1]]){f.label=(f.path.includes('/normalizedColumns/')?'规范化原表 / ':'原表 / ')+colLabels[match[1]]+'（'+match[1]+'）';if(f.path.includes('/normalizedColumns/')&&!f.path.includes('/*/')){f.type=dateCols.includes(match[1])?'date':'number';f.operators=operatorsFor(f.type);}}}return datasets;}
function rowsAt(body:Row,path:string):Row[]{const value=valueAt(body,path);if(Array.isArray(value))return value.flat(Infinity).filter(r=>r&&typeof r==='object'&&!Array.isArray(r));if(value&&typeof value==='object'){const row=path==='/'?Object.fromEntries(Object.entries(value).filter(([key])=>!['me','revision','asOf','capabilities','integration','businessTeamScope'].includes(key))):value;return[{...row,id:typeof row.id==='string'?row.id:'projection:'+path}];}return[];}
function memberAt(state:State,m:Member){return state.records.find(r=>r.kind==='member'&&r.id===m.id) as Member|undefined;}
function readableShape(value:any,shape:any):any{
 if(Array.isArray(value)){if(!Array.isArray(shape))return undefined;return value.flatMap(v=>{const visible=v&&typeof v==='object'&&typeof v.id==='string'?shape.find(r=>r?.id===v.id):shape.find(r=>equal(r,v));return visible===undefined?[]:[readableShape(v,visible)];});}
 if(value&&typeof value==='object'){if(!shape||typeof shape!=='object'||Array.isArray(shape))return undefined;return Object.fromEntries(Object.keys(shape).filter(k=>Object.hasOwn(value,k)).map(k=>[k,readableShape(value[k],shape[k])]));}
 return shape===undefined?undefined:value;
}
function sameRouting(row:Row,current:Row){return ['customerId','customerAccountId','customer','projectId','orderId','lineId','orderLineId','supplierId'].every(key=>row[key]===current[key]);}
/** Fresh permissions are retained while replaying historical business versions. */
function withCurrentGrants(historical:State,current:State):State{
 const grant=(r:Row)=>r.kind==='member'||/(?:access|grant|policy|binding|configuration|responsib|_team|assignment|channel_account)/.test(r.kind);
 return{revision:historical.revision,records:[...historical.records.filter(r=>!grant(r)),...current.records.filter(grant)]};
}
export async function workflowSourceGet(action:string,req:Request,s:State,m:Member,read:ReadView){
 if(action!=='workflow-field-catalog')return null;
 if(!m.active)throw new AppError('账号不可用',403);
 const q=new URL(req.url).searchParams,source=q.get('source'),scope=scopeOf(Object.fromEntries([...q.entries()].filter(([key])=>scopeKeys.includes(key))));
 if(source){const body=await payload(read,source,scope,req,s,m),customerScope=workflowSources.find(v=>v.id===source)!.scopeParams.includes('customerId');return json({source,datasets:datasetsOf(body),scope,scopeOptions:{customers:(customerScope?(body.customers||body.customerAccounts||[]):[]).filter((r:Row)=>typeof r.id==='string').map((r:Row)=>({id:r.id,label:r.customer||r.name||r.id}))},revision:s.revision,mode:'authorized',eventsEnabled:workflowEventsEnabled(env),emptyNote:'字段只来自本次有权读取的数据；空对象不推测字段，数组支持整体变化与包含判断。'});}
 const modules=[];for(const item of workflowSources){try{const body=await payload(read,item.id,{},req,s,m);const datasets=datasetsOf(body);if(datasets.length)modules.push({...item,datasetCount:datasets.length,fieldCount:datasets.reduce((n,d)=>n+d.fields.length,0)});}catch(error){if(!(error instanceof AppError)||error.status>=500)throw error;}}
 return json({modules,revision:s.revision,mode:'authorized',eventsEnabled:workflowEventsEnabled(env)});
}
export async function workflowSourcePost(action:string,req:Request,s:State,m:Member,read:ReadView){
 if(!['workflow-trigger-check','workflow-trigger-events','workflow-trigger-schedule','workflow-trigger-verify'].includes(action))return null;
 if(!m.active)throw new AppError('账号不可用',403);
 const input=await req.json() as Row;if(Object.keys(input).some(k=>!['trigger','cursor','eventId','scope','event'].includes(k)))throw new AppError('触发请求字段无效');
 let trigger:any;try{trigger=validateTrigger(input.trigger);}catch(error){throw new AppError((error as Error).message);}const scope=scopeOf(trigger.scope||{});
 const current=await payload(read,trigger.source,scope,req,s,m),dataset=datasetsOf(current).find(d=>d.path===trigger.dataset);
 if(!dataset)throw new AppError('数据对象不存在或当前没有访问权限',403);
 if(dataset.triggerable===false)throw new AppError('该明细对象没有唯一稳定 ID，请在上层记录或页面概览中选择它的字段。');
 try{validateTrigger(trigger,dataset);}catch(error){throw new AppError((error as Error).message,403);}
 if(action==='workflow-trigger-verify'){
  const event=input.event,row=event&&rowsAt(current,trigger.dataset).find(r=>r.id===event.recordId);
  return json({valid:!!row&&equal(readableShape(event.after,row),row),revision:s.revision});
 }
 if(!workflowEventsEnabled(env))return json({enabled:false,mode:'authorized',events:[],cursor:s.revision,message:'业务事件采集未启用。规则可配置，不能宣称已开始监听。'});
 if(action==='workflow-trigger-schedule'){
  const time=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date()),day=time.slice(0,10),clock=time.slice(11,16);
  if(trigger.mode!=='schedule'||clock<trigger.schedule.time)return json({enabled:true,events:[],day,cursor:s.revision});
  const events=rowsAt(current,trigger.dataset).filter(r=>typeof r.id==='string').map(after=>{const event={id:'schedule-'+day+'-'+trigger.schedule.time,recordId:after.id,type:'schedule',source:trigger.source,dataset:trigger.dataset,scope,origin:'schedule',revision:s.revision,before:null,after};return{...event,...evaluateTrigger(trigger,event,describeDataset([after],trigger.dataset))};});
  return json({enabled:true,events,day,cursor:s.revision});
 }
 if(!Number.isSafeInteger(input.cursor)||input.cursor<0)throw new AppError('需要有效的变更游标');
 const result=await workflowEventStates(database(),input.cursor,s.revision),events:Row[]=[];
 for(const event of result.events){
  if(input.eventId&&input.eventId!==event.id)continue;
  const oldState=withCurrentGrants(event.before,s),newState=withCurrentGrants(event.after,s),actor=memberAt(s,m);if(!actor?.active)throw new AppError('账号权限已变化',403);
  let beforeBody:Row,afterBody:Row;try{beforeBody=await payload(read,trigger.source,scope,req,oldState,actor);afterBody=await payload(read,trigger.source,scope,req,newState,actor);}catch{continue;}
  const oldRows=new Map(rowsAt(beforeBody,trigger.dataset).filter(r=>typeof r.id==='string').map(r=>[r.id,r])),currentRows=new Map(rowsAt(current,trigger.dataset).filter(r=>typeof r.id==='string').map(r=>[r.id,r]));
  for(const historicalAfter of rowsAt(afterBody,trigger.dataset)){
   if(typeof historicalAfter.id!=='string'||!currentRows.has(historicalAfter.id))continue;
   const visible=currentRows.get(historicalAfter.id)!;if(!sameRouting(historicalAfter,visible))continue;const after=readableShape(historicalAfter,visible),old=oldRows.get(after.id),before=old&&sameRouting(old,visible)?readableShape(old,visible):null;
   // Only fields readable both now and in this exact historical projection.
   const historical=describeDataset([visible],trigger.dataset),allowed={...dataset,fields:dataset.fields.filter((f:any)=>historical.fields.some(h=>h.path===f.path))};
   if(before&&equal(before,after))continue;
   const candidate={id:event.id,revision:event.revision,at:event.at,source:trigger.source,dataset:trigger.dataset,recordId:after.id,type:before?'updated':'created',origin:'business',fieldLabels:Object.fromEntries(allowed.fields.map((f:any)=>[f.path,f.label])),before,after};
   let match;try{match=evaluateTrigger(trigger,candidate,allowed);}catch{continue;}
   // Non-matching events contain explanations, never raw rows or old values.
   events.push({...candidate,before:undefined,after:undefined,...match,...(match.matched?{before,after}: {})});
  }
 }
 return json({enabled:true,mode:'authorized',events,cursor:result.cursor,revision:s.revision});
}
