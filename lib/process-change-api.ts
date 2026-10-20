import {z} from 'zod';
import {all,now,newId,strictDate,type State,type Member,type Entity} from './domain';
import {AppError,commit,json} from './store';
import {buildProcessSave} from './process-workspace-api';
import {processSaveSchema,processDetailsSchema,processKinds,processKindLabels,processDetailFields,assertProcessCompletion,canEditProcessRecord,type ProcessFields} from './process-workspace';

const protocol='doon-process-change-v1';
const basisSchema=z.object({
 sources:z.array(z.object({field:z.string().min(1).max(160),reference:z.string().min(1).max(500),location:z.string().min(1).max(500)}).strict()).min(1).max(40),
 unknowns:z.array(z.string().min(1).max(500)).max(40),conflicts:z.array(z.string().min(1).max(500)).max(40),
}).strict();
const payloadSchema=processSaveSchema.omit({token:true}).strict();
const previewSchema=z.object({requestId:z.string().uuid(),rulesVersion:z.string().length(64),payload:payloadSchema,basis:basisSchema}).strict();
const confirmationSchema=z.object({id:z.string().uuid(),digest:z.string().length(64),approved:z.literal(true)}).strict();
const cancelSchema=z.object({id:z.string().uuid(),digest:z.string().length(64)}).strict();
type Change=Entity&{kind:'process_change';requestId:string;ownerId:string;status:'pending'|'confirmed'|'cancelled';createdAt:string;expiresAt:string;rulesVersion:string;digest:string;requestHash:string;sourceHash:string;references:Record<string,string>;payload:z.output<typeof payloadSchema>;basis:z.output<typeof basisSchema>;before:unknown;receipt?:{recordId:string;version:number;confirmedAt:string;actorId:string};receiptHash?:string;closedAt?:string};
function parse<T extends z.ZodTypeAny>(schema:T,input:unknown):z.output<T>{
 const result=schema.safeParse(input);if(!result.success)throw new AppError('请核对变更参数：'+result.error.issues.slice(0,4).map(issue=>issue.path.join('.')).join('、'));return result.data;
}
const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical((value as Record<string,unknown>)[key])])):value;
async function hash(value:unknown){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(canonical(value)))))].map(n=>n.toString(16).padStart(2,'0')).join('');}
function signature(schema:z.ZodTypeAny):unknown{
 const d=schema._def;
 if(d.typeName==='ZodObject')return Object.fromEntries(Object.entries((schema as z.AnyZodObject).shape).map(([key,value])=>[key,signature(value as z.ZodTypeAny)]));
 if(d.typeName==='ZodDefault')return{type:d.typeName,value:d.defaultValue(),inner:signature(d.innerType)};
 if(d.innerType)return{type:d.typeName,inner:signature(d.innerType)};
 if(d.schema)return{type:d.typeName,inner:signature(d.schema),effect:d.effect?Object.fromEntries(Object.entries(d.effect).map(([key,value])=>[key,typeof value==='function'?String(value):value])):undefined};
 return {type:d.typeName,checks:d.checks,values:d.values,value:d.value};
}
let rulesPromise:Promise<string>|undefined;
export const processChangeRules=()=>rulesPromise??=hash({protocol,schema:signature(processSaveSchema),details:processKinds.map(type=>signature(processDetailsSchema(type))),code:[String(strictDate),String(processDetailsSchema),String(assertProcessCompletion),String(buildProcessSave),String(canEditProcessRecord)]});
function allowed(s:State,m:Member,payload:ProcessFields){
 if(!m.active||!canEditProcessRecord(s,m,payload))throw new AppError('当前身份没有这条流程记录的维护权限。',403);
}
function getChange(s:State,m:Member,id:string){
 const row=all(s,'process_change').find(row=>row.requestId===id) as Change|undefined;
 if(!row||row.ownerId!==m.id)throw new AppError('变更不存在或不属于当前登录人。',403);
 allowed(s,m,row.payload as ProcessFields);return row;
}
function sourceRows(s:State,m:Member,payload:Change['payload']){
 const ids=new Set([payload.id,payload.customerId,payload.orderId,payload.teamId,payload.ownerId,payload.responsibleId,payload.nextOwnerId,m.id].filter(Boolean));
 return s.records.filter(row=>ids.has(row.id)).sort((a,b)=>a.id.localeCompare(b.id));
}
function bound(row:Change){return {ownerId:row.ownerId,requestId:row.requestId,payload:row.payload,basis:row.basis,before:row.before,sourceHash:row.sourceHash,references:row.references,rulesVersion:row.rulesVersion,createdAt:row.createdAt,expiresAt:row.expiresAt};}
async function verified(row:Change){
 if(await hash(bound(row))!==row.digest)throw new AppError('预览内容完整性校验失败，请重新核对。',409);
 if(row.status==='confirmed'&&(!row.receipt||await hash({digest:row.digest,receipt:row.receipt})!==row.receiptHash))throw new AppError('执行回执完整性校验失败，请人工核查。',409);
}
function publicChange(row:Change,currentRecord?:Entity){
 return{protocol,id:row.requestId,status:row.status,ownerId:row.ownerId,createdAt:row.createdAt,expiresAt:row.expiresAt,expired:Date.parse(row.expiresAt)<=Date.now(),rulesVersion:row.rulesVersion,digest:row.digest,payload:row.payload,basis:row.basis,before:row.before,references:row.references,receipt:row.receipt||null,
  ...(row.receipt?{currentRecord:currentRecord||null}:{}),label:processKindLabels[row.payload.type],detailFields:processDetailFields[row.payload.type]};
}
async function body(req:Request){const text=await req.text();if(new TextEncoder().encode(text).length>64*1024)throw new AppError('预览内容超过限制。',413);try{return JSON.parse(text);}catch{throw new AppError('请求内容不是有效 JSON。');}}
function exactQuery(req:Request,key:string){
 const params=new URL(req.url).searchParams;
 if([...params.keys()].some(name=>name!==key)||params.getAll(key).length!==1)throw new AppError('查询参数无效。');
 return parse(z.string().uuid(),params.get(key));
}
export async function processChangeGet(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['process-change-contract','process-change'].includes(action))return null;
 if(!m.active||m.role==='supplier')throw new AppError('此身份不能访问流程变更。',403);
 if(action==='process-change-contract')return json({protocol,rulesVersion:await processChangeRules(),expiresInSeconds:1800,types:processKinds});
 const row=getChange(s,m,exactQuery(req,'id'));await verified(row);
 const current=row.receipt?s.records.find(record=>record.id===row.receipt!.recordId):undefined;
 if(current&&!canEditProcessRecord(s,m,current as unknown as ProcessFields))throw new AppError('记录权限已变化。',403);
 return json(publicChange(row,current));
}
export async function processChangePost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['process-change-preview','process-change-confirm','process-change-cancel'].includes(action))return null;
 if(req.headers.get('origin')!==new URL(req.url).origin)throw new AppError('流程确认必须由同源登录页面提交。',403);
 if(action==='process-change-preview'){
  const input=parse(previewSchema,await body(req));
  const rulesVersion=await processChangeRules();if(input.rulesVersion!==rulesVersion)throw new AppError('业务规则版本已变化，请重新预览。',409);
  const requestHash=await hash(input),existing=all(s,'process_change').find(row=>row.requestId===input.requestId) as Change|undefined;
  if(existing){
   const row=getChange(s,m,input.requestId);await verified(row);
   if(row.requestHash!==requestHash)throw new AppError('同一请求标识不能替换预览内容。',409);
   return json({id:row.requestId,status:row.status,executed:row.status==='confirmed',idempotent:true});
  }
  const plan=await buildProcessSave(req,s,m,input.payload);
  const payload={...plan.fields,...(plan.before?{id:plan.before.id,version:plan.before.version}:{})};
  const sources=sourceRows(s,m,payload),references=Object.fromEntries(sources.map(record=>[record.id,String(record.orderNo?[record.orderNo,record.drawing].filter(Boolean).join(' · '):record.name||record.customerCode||record.title||record.id)]));
  const createdAt=now(),row:Change={id:'process_change_'+input.requestId,kind:'process_change',requestId:input.requestId,ownerId:m.id,status:'pending',createdAt,expiresAt:new Date(Date.parse(createdAt)+1800000).toISOString(),rulesVersion,digest:'',requestHash,sourceHash:await hash(sources),references,payload,basis:input.basis,before:plan.before||null};
  row.digest=await hash(bound(row));
  // Preview is an independent record. No business row, history or original file is changed.
  await commit(s.revision,[row]);
  return json({id:row.requestId,status:row.status,executed:false},201);
 }
 const input=parse(action==='process-change-confirm'?confirmationSchema:cancelSchema,await body(req));
 const row=getChange(s,m,input.id);await verified(row);
 if(input.digest!==row.digest)throw new AppError('确认内容与所见预览不一致。',409);
 if(action==='process-change-cancel'){
  if(row.status==='confirmed')throw new AppError('已经执行，不能用取消预览撤销业务记录。',409);
  if(row.status!=='cancelled')await commit(s.revision,[{...row,status:'cancelled',closedAt:now()}]);
  return json({id:input.id,status:'cancelled',executed:false});
 }
 if(row.status==='confirmed'){
  const current=s.records.find(record=>record.id===row.receipt?.recordId);
  if(!current||!canEditProcessRecord(s,m,current as unknown as ProcessFields))throw new AppError('结果不存在或权限已变化，请人工核查。',403);
  return json({...publicChange(row,current),executed:true,idempotent:true});
 }
 if(row.status!=='pending')throw new AppError('预览已取消，请重新提出变更。',409);
 if(Date.parse(row.expiresAt)<=Date.now())throw new AppError('预览已过期，请重新核对。',409);
 if(row.rulesVersion!==await processChangeRules())throw new AppError('业务规则版本已变化，请重新预览。',409);
 if(row.basis.unknowns.length||row.basis.conflicts.length)throw new AppError('仍有未知项或冲突，请核实并重新预览。',409);
 if(row.sourceHash!==await hash(sourceRows(s,m,row.payload)))throw new AppError('原记录、关联资料或人员权限已变化，请重新预览。',409);
 const plan=await buildProcessSave(req,s,m,{...row.payload,token:'process-change:'+row.requestId},'人工确认流程变更');
 if(plan.idempotent)throw new AppError('发现独立提交记录，请先核查原结果。',409);
 const confirmedAt=now(),receipt={recordId:plan.record.id,version:plan.record.version,confirmedAt,actorId:m.id};
 const closed={...row,status:'confirmed' as const,receipt,receiptHash:await hash({digest:row.digest,receipt}),closedAt:confirmedAt};
 const audit:Entity={id:newId('process_change_audit'),kind:'process_change_audit',proposalId:row.id,actorId:m.id,recordId:plan.record.id,digest:row.digest,receipt,createdAt:confirmedAt};
 await commit(s.revision,[...plan.updates,closed,audit]);
 return json({...publicChange(closed,plan.record),executed:true,idempotent:false});
}
