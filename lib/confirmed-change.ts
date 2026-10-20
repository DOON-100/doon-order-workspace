import {z} from 'zod';
import {all,now,newId,type State,type Member,type Entity} from './domain';
import {AppError,commit,json} from './store';

export const changeBasisSchema=z.object({
 sources:z.array(z.object({field:z.string().min(1).max(160),reference:z.string().min(1).max(500),location:z.string().min(1).max(500)}).strict()).min(1).max(40),
 unknowns:z.array(z.string().min(1).max(500)).max(40),conflicts:z.array(z.string().min(1).max(500)).max(40),
}).strict();
type Change=Entity&{kind:string;requestId:string;ownerId:string;status:'pending'|'confirmed'|'cancelled';createdAt:string;expiresAt:string;rulesVersion:string;digest:string;requestHash:string;sourceHash:string;references:Record<string,string>;payload:Record<string,any>;basis:z.output<typeof changeBasisSchema>;effects?:Record<string,unknown>;before:unknown;receipt?:{recordId:string;version:number;confirmedAt:string;actorId:string};receiptHash?:string;closedAt?:string};
function parse<T extends z.ZodTypeAny>(schema:T,input:unknown):z.output<T>{
 const result=schema.safeParse(input);if(!result.success)throw new AppError('请核对变更参数：'+result.error.issues.slice(0,4).map(issue=>issue.path.join('.')).join('、'));return result.data;
}
const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical((value as Record<string,unknown>)[key])])):value;
export async function changeHash(value:unknown){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(canonical(value)))))].map(n=>n.toString(16).padStart(2,'0')).join('');}
export function schemaSignature(schema:z.ZodTypeAny):unknown{
 const d=schema._def;
 if(d.typeName==='ZodDiscriminatedUnion'||d.typeName==='ZodUnion')return{type:d.typeName,options:d.options.map(schemaSignature)};
 if(d.typeName==='ZodArray')return{type:d.typeName,items:schemaSignature(d.type),min:d.minLength,max:d.maxLength};
 if(d.typeName==='ZodObject')return{type:d.typeName,unknownKeys:d.unknownKeys,shape:Object.fromEntries(Object.entries((schema as z.AnyZodObject).shape).map(([key,value])=>[key,schemaSignature(value as z.ZodTypeAny)]))};
 if(d.typeName==='ZodDefault')return{type:d.typeName,value:d.defaultValue(),inner:schemaSignature(d.innerType)};
 if(d.innerType)return{type:d.typeName,inner:schemaSignature(d.innerType)};
 if(d.schema)return{type:d.typeName,inner:schemaSignature(d.schema),effect:d.effect?Object.fromEntries(Object.entries(d.effect).map(([key,value])=>[key,typeof value==='function'?String(value):value])):undefined};
 return {type:d.typeName,checks:d.checks,values:d.values,value:d.value};
}
export type ChangePlan={payload:Record<string,any>;before:Entity|null;record:Entity;updates:Entity[];idempotent?:boolean;effects?:Record<string,unknown>};
export type ChangeAdapter={prefix:string;kind:string;protocol:string;payloadSchema:z.ZodTypeAny;types:readonly string[];rules:()=>Promise<string>;authorize:(s:State,m:Member,payload:Record<string,any>)=>void;sources:(s:State,m:Member,payload:Record<string,any>)=>Entity[];build:(req:Request,s:State,m:Member,payload:Record<string,any>,requestId?:string)=>Promise<ChangePlan>|ChangePlan;describe:(payload:Record<string,any>)=>Record<string,unknown>};
// Only server-registered adapters are accepted. No client-selected URLs or code.
export function createConfirmedChangeApi(adapter:ChangeAdapter){
 const {prefix,kind,protocol}=adapter;
 const previewSchema=z.object({requestId:z.string().uuid(),rulesVersion:z.string().length(64),payload:adapter.payloadSchema,basis:changeBasisSchema}).strict();
 const confirmationSchema=z.object({id:z.string().uuid(),digest:z.string().length(64),approved:z.literal(true)}).strict();
 const cancelSchema=z.object({id:z.string().uuid(),digest:z.string().length(64)}).strict();
 const rules=async()=>changeHash({adapter:await adapter.rules(),engine:String(createConfirmedChangeApi),basis:schemaSignature(changeBasisSchema),payload:schemaSignature(adapter.payloadSchema),functions:[adapter.build,adapter.authorize,adapter.sources,adapter.describe].map(String)});
 function getChange(s:State,m:Member,id:string){
  const row=all(s,kind).find(row=>row.requestId===id) as Change|undefined;
  if(!row||row.ownerId!==m.id)throw new AppError('变更不存在或不属于当前登录人。',403);
  adapter.authorize(s,m,row.payload);return row;
 }
function bound(row:Change){return {ownerId:row.ownerId,requestId:row.requestId,payload:row.payload,basis:row.basis,before:row.before,sourceHash:row.sourceHash,references:row.references,rulesVersion:row.rulesVersion,createdAt:row.createdAt,expiresAt:row.expiresAt,...(row.effects?{effects:row.effects}:{})};}
async function verified(row:Change){
 if(await changeHash(bound(row))!==row.digest)throw new AppError('预览内容完整性校验失败，请重新核对。',409);
 if(row.status==='confirmed'&&(!row.receipt||await changeHash({digest:row.digest,receipt:row.receipt})!==row.receiptHash))throw new AppError('执行回执完整性校验失败，请人工核查。',409);
}
function publicChange(row:Change,currentRecord?:Entity){
 return{protocol,id:row.requestId,status:row.status,ownerId:row.ownerId,createdAt:row.createdAt,expiresAt:row.expiresAt,expired:Date.parse(row.expiresAt)<=Date.now(),rulesVersion:row.rulesVersion,digest:row.digest,payload:row.payload,basis:row.basis,before:row.before,references:row.references,receipt:row.receipt||null,
  ...(row.receipt?{currentRecord:currentRecord||null}:{}),...adapter.describe(row.payload),...(row.effects?{effects:row.effects}:{})};
}
async function body(req:Request){const text=await req.text();if(new TextEncoder().encode(text).length>64*1024)throw new AppError('预览内容超过限制。',413);try{return JSON.parse(text);}catch{throw new AppError('请求内容不是有效 JSON。');}}
function exactQuery(req:Request,key:string){
 const params=new URL(req.url).searchParams;
 if([...params.keys()].some(name=>name!==key)||params.getAll(key).length!==1)throw new AppError('查询参数无效。');
 return parse(z.string().uuid(),params.get(key));
}
async function get(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(![prefix+'-contract',prefix].includes(action))return null;
 if(!m.active||m.role==='supplier')throw new AppError('此身份不能访问流程变更。',403);
 if(action===prefix+'-contract')return json({protocol,rulesVersion:await rules(),expiresInSeconds:1800,types:adapter.types});
 const row=getChange(s,m,exactQuery(req,'id'));await verified(row);
 const current=row.receipt?s.records.find(record=>record.id===row.receipt!.recordId):undefined;
 if(current)adapter.authorize(s,m,current);
 return json(publicChange(row,current));
}
async function post(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(![prefix+'-preview',prefix+'-confirm',prefix+'-cancel'].includes(action))return null;
 if(req.headers.get('origin')!==new URL(req.url).origin)throw new AppError('流程确认必须由同源登录页面提交。',403);
 if(action===prefix+'-preview'){
  const input=parse(previewSchema,await body(req));
  const rulesVersion=await rules();if(input.rulesVersion!==rulesVersion)throw new AppError('业务规则版本已变化，请重新预览。',409);
  const requestHash=await changeHash(input),existing=all(s,kind).find(row=>row.requestId===input.requestId) as Change|undefined;
  if(existing){
   const row=getChange(s,m,input.requestId);await verified(row);
   if(row.requestHash!==requestHash)throw new AppError('同一请求标识不能替换预览内容。',409);
   return json({id:row.requestId,status:row.status,executed:row.status==='confirmed',idempotent:true});
  }
  adapter.authorize(s,m,input.payload);
  const plan=await adapter.build(req,s,m,input.payload,input.requestId);
  if(plan.idempotent)throw new AppError('发现独立提交记录，请核查原请求。',409);
  const payload=plan.payload;
  const sources=adapter.sources(s,m,payload),references=Object.fromEntries(sources.filter(record=>record.kind!=='purchase_event').map(record=>[record.id,String(record.po?[record.po,record.supplier,record.itemCode,record.itemName,record.unit,'源行 '+record.sourceRow].filter(Boolean).join(' · '):record.orderNo?[record.orderNo,record.drawing].filter(Boolean).join(' · '):record.name||record.customerCode||record.title||record.id)]));
  const createdAt=now(),row:Change={id:kind+'_'+input.requestId,kind,requestId:input.requestId,ownerId:m.id,status:'pending',createdAt,expiresAt:new Date(Date.parse(createdAt)+1800000).toISOString(),rulesVersion,digest:'',requestHash,sourceHash:await changeHash(sources),references,payload,basis:input.basis,before:plan.before||null,...(plan.effects?{effects:plan.effects}:{})};
  row.digest=await changeHash(bound(row));
  // Preview is an independent record. No business row, history or original file is changed.
  await commit(s.revision,[row]);
  return json({id:row.requestId,status:row.status,executed:false},201);
 }
 const input=parse(action===prefix+'-confirm'?confirmationSchema:cancelSchema,await body(req));
 const row=getChange(s,m,input.id);await verified(row);
 if(input.digest!==row.digest)throw new AppError('确认内容与所见预览不一致。',409);
 if(action===prefix+'-cancel'){
  if(row.status==='confirmed')throw new AppError('已经执行，不能用取消预览撤销业务记录。',409);
  if(row.status!=='cancelled')await commit(s.revision,[{...row,status:'cancelled',closedAt:now()}]);
  return json({id:input.id,status:'cancelled',executed:false});
 }
 if(row.status==='confirmed'){
  const current=s.records.find(record=>record.id===row.receipt?.recordId);
  if(!current)throw new AppError('结果不存在，请人工核查。',403);adapter.authorize(s,m,current);
  return json({...publicChange(row,current),executed:true,idempotent:true});
 }
 if(row.status!=='pending')throw new AppError('预览已取消，请重新提出变更。',409);
 if(Date.parse(row.expiresAt)<=Date.now())throw new AppError('预览已过期，请重新核对。',409);
 if(row.rulesVersion!==await rules())throw new AppError('业务规则版本已变化，请重新预览。',409);
 if(row.basis.unknowns.length||row.basis.conflicts.length)throw new AppError('仍有未知项或冲突，请核实并重新预览。',409);
 if(row.sourceHash!==await changeHash(adapter.sources(s,m,row.payload)))throw new AppError('原记录、关联资料或人员权限已变化，请重新预览。',409);
 const plan=await adapter.build(req,s,m,row.payload,row.requestId);
 if(await changeHash(plan.effects||null)!==await changeHash(row.effects||null))throw new AppError('执行结果与预览不一致，请重新核对。',409);
 if(plan.idempotent)throw new AppError('发现独立提交记录，请先核查原结果。',409);
 const confirmedAt=now(),receipt={recordId:plan.record.id,version:plan.record.version,confirmedAt,actorId:m.id};
 const closed={...row,status:'confirmed' as const,receipt,receiptHash:await changeHash({digest:row.digest,receipt}),closedAt:confirmedAt};
 const audit:Entity={id:newId(kind+'_audit'),kind:kind+'_audit',proposalId:row.id,actorId:m.id,recordId:plan.record.id,digest:row.digest,receipt,createdAt:confirmedAt};
 await commit(s.revision,[...plan.updates,closed,audit]);
 return json({...publicChange(closed,plan.record),executed:true,idempotent:false});
}

 return {get,post,rules};
}
