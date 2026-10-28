import {z} from 'zod';
import {all,clean,newId,now,strictDate,type CustomerAccount,type Entity,type Member,type Order,type State} from './domain';
import {AppError,audit,commit,json} from './store';
import {businessAccess,businessOrder} from './handoff-business';
import {serviceOrderCustomerKeys,canReadServiceRecord,publicServiceRecord,type ServiceRecord} from './service-workspace';
import {businessEvidenceCurrent} from './handoff-business-evidence';
import {buildFrameworkFinancialQuery} from './framework-business-query';

export const frameworkFinanceOpenStatuses=['草稿','待财务接收','财务处理中','待业务核对'] as const;
export type FrameworkFinanceTask=Entity&{kind:'framework_finance_task';version:number;customerId:string;customerLabel:string;orderId:string;orderLabel:string;type:string;recipientId:string;businessOwnerId:string;requesterId:string;requesterName:string;due:string;body:string;evidence:string;status:string;sourceSnapshot:string;sourceRequestId:string;sourceRequestVersion:number;result:string;resultPath:string;createdAt:string;updatedAt:string;updatedBy:string};
const live=(m:Member)=>m.active&&m.role!=='supplier';
const manager=(m:Member)=>live(m)&&m.role==='admin';
export function frameworkFinanceBusinessAccess(s:State,m:Member,t:Pick<FrameworkFinanceTask,'customerId'|'orderId'>){return live(m)&&['admin','sales','clerk'].includes(m.role)&&businessAccess(s,m,{customerId:t.customerId,orderId:t.orderId,projectId:''},true);}
const businessParticipant=(s:State,m:Member,t:FrameworkFinanceTask)=>frameworkFinanceBusinessAccess(s,m,t);
const worker=(m:Member,t:FrameworkFinanceTask)=>live(m)&&(manager(m)||m.role==='finance'&&t.recipientId===m.id);
function visible(s:State,m:Member,t:FrameworkFinanceTask){return businessParticipant(s,m,t)||t.status!=='草稿'&&worker(m,t);}
function requireTask(s:State,m:Member,id:string){const row=all(s,'framework_finance_task').find(r=>r.id===id) as FrameworkFinanceTask|undefined;if(!row||!visible(s,m,row))throw new AppError('财务任务不存在或当前无权读取。',403);return row;}
function version(row:Entity|undefined,n:number){if((row?.version||0)!==n)throw new AppError('财务任务已更新，请刷新当前阶段和版本后重核。',409);}
function assignee(s:State,id:string){return all(s,'member').find(m=>m.id===id&&m.active&&m.role==='finance');}
/** Private server-side source basis. Selected recipients never receive it or gain customer permissions. */
function sourceSnapshot(s:State,t:Pick<FrameworkFinanceTask,'customerId'|'orderId'|'sourceRequestId'>){
 const o=all(s,'order').find(o=>o.id===t.orderId);if(!o)return '';
 const pi=all(s,'handoff_business_document').filter(r=>r.type==='pi'&&r.customerId===t.customerId&&(r.orderId===t.orderId||r.lines?.some((l:Entity)=>l.orderLineId===t.orderId)));
 const receivables=all(s,'service_record').filter(r=>r.type==='receivable'&&r.customerId===t.customerId&&r.orderId===t.orderId),receivableIds=new Set(receivables.map(r=>r.id));
 const receipts=all(s,'service_receipt').filter(r=>receivableIds.has(r.recordId));
 const source=t.sourceRequestId?all(s,'handoff_business_source').find(r=>r.id===t.sourceRequestId):undefined;
 return JSON.stringify({order:{id:o.id,customer:o.customer,orderNo:o.orderNo,customerPO:o.customerPO,drawing:o.drawing,color:o.color,lens:o.lens,quantity:o.quantity,batch:o.batch,unit:o.unit,productCode:o.productCode,productType:o.productType,specialRequirements:o.specialRequirements,requestedDate:o.requestedDate},pi,receivables,receipts,source});
}
export function frameworkFinanceTaskDto(s:State,m:Member,t:FrameworkFinanceTask){
 const business=businessParticipant(s,m,t),work=worker(m,t),current=sourceSnapshot(s,t),sourceChanged=!current||current!==t.sourceSnapshot;
 // Deliberate whitelist: no stored snapshot, credentials, customer records, other tasks or private source fields.
 return {id:t.id,version:t.version,customerId:t.customerId,customerLabel:t.customerLabel,orderId:t.orderId,orderLabel:t.orderLabel,type:t.type,recipientId:t.recipientId,recipientName:all(s,'member').find(x=>x.id===t.recipientId)?.name||'原财务接收人',businessOwnerId:t.businessOwnerId,requesterName:t.requesterName,due:t.due,body:t.body,evidence:t.evidence,status:t.status,result:t.result,resultPath:t.resultPath,sourceRequestId:business?t.sourceRequestId:'',sourceRequestVersion:t.sourceRequestVersion,createdAt:t.createdAt,updatedAt:t.updatedAt,updatedBy:t.updatedBy,sourceChanged,canEdit:business&&t.status==='草稿',canSubmit:business&&t.status==='草稿'&&!sourceChanged,canAccept:work&&t.status==='待财务接收',canReturn:work&&t.status==='财务处理中',canReview:business&&t.status==='待业务核对'&&!sourceChanged,canCancel:business&&frameworkFinanceOpenStatuses.includes(t.status as any),canOpenOrder:business};
}
export function frameworkFinanceTaskRevision(s:State,m:Member,before:FrameworkFinanceTask|undefined,t:FrameworkFinanceTask,action:string,note:string){return {id:newId('framework_finance_task_history'),kind:'framework_finance_task_history',taskId:t.id,version:t.version,action,note,actorId:m.id,actor:m.name,createdAt:now(),snapshot:structuredClone(t)};}
const id=z.string().trim().min(1).max(160),token=z.string().uuid(),expectedVersion=z.number().int().nonnegative(),note=z.string().trim().min(1).max(12000);
const saveSchema=z.object({token,id:id.optional(),expectedVersion,customerId:id,orderId:id,type:z.enum(['收款核对','对账','退款核对']),recipientId:id,due:z.string().min(10).max(10),body:note,evidence:z.string().max(12000),sourceRequestId:z.string().max(160).default('')}).strict();
const actionSchema=z.object({token,id,expectedVersion,note}).strict();
const returnSchema=actionSchema.extend({path:z.string().trim().min(1).max(2000)}).strict();
function parse<T extends z.ZodTypeAny>(schema:T,body:unknown):z.output<T>{const r=schema.safeParse(body);if(!r.success)throw new AppError(r.error.issues.slice(0,3).map(i=>i.path.join('.')+': '+i.message).join('；'));return r.data;}
async function hash(x:unknown){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(x))))).map(x=>x.toString(16).padStart(2,'0')).join('');}
async function replay(s:State,m:Member,action:string,input:{token:string}){const r=s.records.find(r=>r.id==='framework_finance_task_request_'+input.token);if(!r)return null;if(r.kind!=='framework_finance_task_request'||r.actorId!==m.id||r.action!==action||r.hash!==await hash(input))throw new AppError('请求标识已用于其他内容。',409);const t=requireTask(s,m,r.taskId);return json({ok:true,idempotent:true,item:frameworkFinanceTaskDto(s,m,t)});}
async function save(s:State,m:Member,action:string,input:{token:string},t:FrameworkFinanceTask,before?:FrameworkFinanceTask,note=''){
 const request={id:'framework_finance_task_request_'+input.token,kind:'framework_finance_task_request',taskId:t.id,actorId:m.id,action,hash:await hash(input),createdAt:now()};
 await commit(s.revision,[t,frameworkFinanceTaskRevision(s,m,before,t,action,note),request,audit(m,t,before||null,action,'内部财务任务，不改到账底账')]);return json({ok:true,item:frameworkFinanceTaskDto({...s,records:s.records.map(r=>r.id===t.id?t:r)},m,t)});
}
export async function frameworkFinanceTaskGet(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['framework-finance-tasks','framework-finance-task-history','framework-finance-task-summary'].includes(action))return null;if(!live(m))throw new AppError('没有内部财务任务权限。',403);
 if(action==='framework-finance-task-summary'){
  const query=new URL(req.url).searchParams,customerId=query.get('customerId')||'',orderId=query.get('orderId')||'',type=query.get('type')||'收款核对',o=businessOrder(s,m,customerId,orderId);
  if(!o||!frameworkFinanceBusinessAccess(s,m,{customerId,orderId}))throw new AppError('没有该订单核对资料的业务权限。',403);
  const items=s.records.filter(r=>['handoff_business_source','handoff_business_document'].includes(r.kind)&&r.customerId===customerId&&r.orderId===orderId&&businessAccess(s,m,{customerId:r.customerId,orderId:r.orderId,projectId:r.projectId||'',type:r.type})).map(r=>({...r,sourceChanged:!businessEvidenceCurrent(s,r)})),service=(all(s,'service_record') as ServiceRecord[]).filter(r=>r.customerId===customerId&&r.orderId===orderId&&canReadServiceRecord(s,m,r)).map(r=>publicServiceRecord(s,r));
  const rows=buildFrameworkFinancialQuery({items,customers:[],orders:[],projects:[],members:[],queues:{service}},now().slice(0,10)),basis=rows.length===1?rows[0]:undefined,amount=(n:number|null)=>n===null?'待核实':(n/100).toFixed(2),c=all(s,'customer_account').find(c=>c.id===customerId);
  const details=basis?['确认 PI：'+basis.piNumber,'币种：'+basis.currency,'正式净收款：'+amount(basis.receivedCents),'整单未收余额：'+amount(basis.balanceCents),...(basis.problems.length?['待核实：'+basis.problems.join('；')]:[])]:['待核实：尚无唯一且明确关联的当前确认 PI、生产单及原应收依据。'];
  return json({body:['客户：'+(c?.customer||''),'订单：'+o.orderNo,'事项：'+type,...details,'请按正式财务资料核实并回传依据；本段为核对草稿，不代表新的到账确认。'].join('\n')});
 }
 if(action==='framework-finance-task-history'){
  const task=requireTask(s,m,new URL(req.url).searchParams.get('id')||'');
  return json({taskId:task.id,history:all(s,'framework_finance_task_history').filter(h=>h.taskId===task.id&&h.snapshot&&(businessParticipant(s,m,task)||h.snapshot.status!=='草稿'&&worker(m,task))).sort((a,b)=>b.version-a.version).map(h=>({id:h.id,version:h.version,action:h.action,note:h.note,actor:h.actor,createdAt:h.createdAt,snapshot:frameworkFinanceTaskDto(s,m,h.snapshot)}))});
 }
 const customers=all(s,'customer_account').filter(c=>c.active&&frameworkFinanceBusinessAccess(s,m,{customerId:c.id,orderId:''}));
 const orders=all(s,'order').flatMap(o=>{const c=customers.find(c=>serviceOrderCustomerKeys(s,c as CustomerAccount).some(k=>clean(k).toLowerCase()===clean(o.customer).toLowerCase()));return c&&businessOrder(s,m,c.id,o.id)?[{id:o.id,orderNo:o.orderNo,customerPO:o.customerPO,drawing:o.drawing,customerId:c.id,customerLabel:c.customer}]:[];});
 const sources=all(s,'handoff_business_source').filter(r=>r.type==='finance_request'&&frameworkFinanceBusinessAccess(s,m,r as FrameworkFinanceTask)&&businessAccess(s,m,{type:r.type,customerId:r.customerId,projectId:r.projectId||'',orderId:r.orderId},true)&&orders.some(o=>o.id===r.orderId)).map(r=>({id:r.id,version:r.version,customerId:r.customerId,orderId:r.orderId,fields:r.fields,number:r.number}));
 return json({tasks:(all(s,'framework_finance_task') as FrameworkFinanceTask[]).filter(t=>visible(s,m,t)).map(t=>frameworkFinanceTaskDto(s,m,t)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)),orders,sourceRequests:sources,financeMembers:orders.length?all(s,'member').filter(m=>m.active&&m.role==='finance').map(m=>({id:m.id,name:m.name})):[],canCreate:orders.length>0,asOf:now()});
}
export async function frameworkFinanceTaskPost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['framework-finance-task-save','framework-finance-task-submit','framework-finance-task-accept','framework-finance-task-return','framework-finance-task-review','framework-finance-task-cancel'].includes(action))return null;if(!live(m))throw new AppError('没有内部财务任务权限。',403);
 const raw=await req.text();if(raw.length>90000)throw new AppError('任务内容超过限制。');let body;try{body=JSON.parse(raw);}catch{throw new AppError('任务内容无效。');}
 if(action==='framework-finance-task-save'){
  const input=parse(saveSchema,body);try{strictDate(input.due);}catch{throw new AppError('希望反馈日期无效。');}
  if(!frameworkFinanceBusinessAccess(s,m,input)||!businessOrder(s,m,input.customerId,input.orderId))throw new AppError('没有该客户及订单的业务维护权限。',403);
  if(!assignee(s,input.recipientId))throw new AppError('请指定在职财务人员。',403);
  const before=input.id?requireTask(s,m,input.id):undefined;if(before&&(!businessParticipant(s,m,before)||before.status!=='草稿'))throw new AppError('只有业务可修改未交接草稿。',403);
  if(before&&(before.customerId!==input.customerId||before.orderId!==input.orderId))throw new AppError('已有财务任务不可改绑客户或订单。',409);
  const source=input.sourceRequestId?all(s,'handoff_business_source').find(r=>r.id===input.sourceRequestId&&r.type==='finance_request'&&r.customerId===input.customerId&&r.orderId===input.orderId):undefined;
  if(input.sourceRequestId&&(!source||!businessAccess(s,m,{type:source.type,customerId:source.customerId,orderId:source.orderId,projectId:source.projectId||''},true)))throw new AppError('原财务核对资料不在同一客户及订单授权范围。',403);
  const prior=await replay(s,m,action,input);if(prior)return prior;version(before,input.expectedVersion);
  const c=all(s,'customer_account').find(c=>c.id===input.customerId)!,o=all(s,'order').find(o=>o.id===input.orderId)!,at=now(),t:FrameworkFinanceTask={...before,id:before?.id||newId('framework_finance_task'),kind:'framework_finance_task',version:input.expectedVersion+1,customerId:c.id,customerLabel:c.customer,orderId:o.id,orderLabel:[o.orderNo,o.customerPO,o.drawing].filter(Boolean).join(' / '),type:input.type,recipientId:input.recipientId,businessOwnerId:before?.businessOwnerId||m.id,requesterId:before?.requesterId||m.id,requesterName:before?.requesterName||m.name,due:input.due,body:input.body,evidence:input.evidence,status:'草稿',sourceRequestId:source?.id||'',sourceRequestVersion:source?.version||0,sourceSnapshot:'',result:'',resultPath:'',createdAt:before?.createdAt||at,updatedAt:at,updatedBy:m.name};t.sourceSnapshot=sourceSnapshot(s,t);return save(s,m,action,input,t,before,'准备内容与来源；尚未交财务');
 }
 const input=action==='framework-finance-task-return'?parse(returnSchema,body):parse(actionSchema,body),before=requireTask(s,m,input.id),business=businessParticipant(s,m,before),work=worker(m,before);
 if(['framework-finance-task-submit','framework-finance-task-review','framework-finance-task-cancel'].includes(action)?!business:!work)throw new AppError('当前成员不能执行此财务任务阶段。',403);
 const prior=await replay(s,m,action,input);if(prior)return prior;version(before,input.expectedVersion);
 const transitions:Record<string,[string,string]>={'framework-finance-task-submit':['草稿','待财务接收'],'framework-finance-task-accept':['待财务接收','财务处理中'],'framework-finance-task-return':['财务处理中','待业务核对'],'framework-finance-task-review':['待业务核对','已核对']};
 if(action==='framework-finance-task-cancel'){if(!frameworkFinanceOpenStatuses.includes(before.status as any))throw new AppError('已核对或取消任务不能再次取消。',409);}else if(before.status!==transitions[action][0])throw new AppError('任务阶段已变化，不能跳过或重复执行。',409);
 if(action==='framework-finance-task-submit'&&!assignee(s,before.recipientId))throw new AppError('所选财务已经停用，请先重核草稿。',403);
 if(['framework-finance-task-submit','framework-finance-task-review'].includes(action)&&sourceSnapshot(s,before)!==before.sourceSnapshot)throw new AppError('订单、PI或正式款项来源已变化。草稿须重新编辑核对；已交接任务请取消后重新准备，保留原结果。',409);
 const t={...before,version:before.version+1,status:action==='framework-finance-task-cancel'?'已取消':transitions[action][1],updatedAt:now(),updatedBy:m.name};
 if(action==='framework-finance-task-return'){const path=(input as z.infer<typeof returnSchema>).path;if(!/^(?:[A-Za-z]:[\\/]|\\\\|\/|https?:\/\/)/.test(path))throw new AppError('请登记可核对的正式依据完整路径或内部资料链接。');t.result=input.note;t.resultPath=path;}
 return save(s,m,action,input,t,before,input.note);
}
