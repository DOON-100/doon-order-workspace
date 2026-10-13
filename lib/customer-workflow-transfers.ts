import {z} from 'zod';
import {all,newId,now,type CustomerAccount,type Entity,type Member,type State} from './domain';
import {AppError,json} from './store';
import {customerPoolEligibility,workflowDate,workflowId,workflowToday,workflowToken,workflowVersion} from './customer-workflow';
import {customerPrimarySalesMemberId,customerSalesMemberIds} from './customer-workflow-responsibility';
import {workflowCapabilities,workflowCommit,workflowCustomer,workflowProfile,workflowReplay,workflowState,workflowVersionCheck} from './customer-workflow-api';
import {customerTaskDtos,customerTaskOpenStatuses,customerTaskRevisionChanges,type CustomerWorkflowTask} from './customer-workflow-tasks';

const reason=z.string().trim().min(1,'请填写原因或确认说明').max(3000);
const base={token:workflowToken,customerId:workflowId,version:workflowVersion,customerVersion:workflowVersion};
const schemas={
 'primary':z.object({...base,to:workflowId,reason}).strict(),
 'handoff':z.object({...base,to:workflowId,reason}).strict(),
 'accept':z.object({...base,id:workflowId,requestVersion:workflowVersion,note:reason}).strict(),
 'cancel-handoff':z.object({...base,id:workflowId,requestVersion:workflowVersion,note:reason}).strict(),
 'pool-request':z.object({...base,reason:z.enum(['两年未下单','多轮跟进未成功']),basis:reason}).strict(),
 'pool-approve':z.object({...base,id:workflowId,requestVersion:workflowVersion,note:reason}).strict(),
 'pool-reject':z.object({...base,id:workflowId,requestVersion:workflowVersion,note:reason}).strict(),
 'pool-withdraw':z.object({...base,id:workflowId,requestVersion:workflowVersion,note:reason}).strict(),
 'claim':z.object({...base,next:z.string().trim().min(1).max(300),nextDate:workflowDate.refine(Boolean,'请填写下次跟进日期'),reason}).strict(),
 'claim-approve':z.object({...base,id:workflowId,requestVersion:workflowVersion,note:reason}).strict(),
} as const;
function customerRecord(s:State,id:string){const customer=all(s,'customer_account').find(c=>c.id===id) as CustomerAccount|undefined;if(!customer||!customer.active)throw new AppError('客户不存在或已停用。',403);return customer;}
function targetMember(s:State,id:string){const m=all(s,'member').find(m=>m.id===id&&m.active&&m.role==='sales') as Member|undefined;if(!m)throw new AppError('请选择一位有效销售成员。');return m;}
function requestRecord(s:State,kind:string,input:any){const item=all(s,kind).find(r=>r.id===input.id&&r.customerId===input.customerId);if(!item||item.status!=='pending')throw new AppError('申请已处理或不存在，请刷新核对。',409);workflowVersionCheck(item,input.requestVersion);return item;}
function stateRecord(s:State,m:Member,id:string){const before=workflowState(s,id);return {...before,id:before?.id||newId('customer_workflow_state'),kind:'customer_workflow_state',customerId:id,version:(before?.version||0)+1,next:before?.next||'',nextDate:before?.nextDate||'',followState:before?.followState||'待安排',latestFollowupOn:before?.latestFollowupOn||'',updatedAt:now(),updatedBy:m.name} as Entity;}
function addSales(s:State,m:Member,customer:CustomerAccount,to:Member){return {...customer,salesName:to.name,salesMemberIds:[...new Set([...(Array.isArray(customer.salesMemberIds)?customer.salesMemberIds:customerSalesMemberIds(s,customer)),to.id])],directory:{...customer.directory,handoffOn:workflowToday()},version:customer.version+1,updatedAt:now(),updatedBy:m.name};}
function summary(s:State,customer:CustomerAccount){const state=workflowState(s,customer.id);return {id:customer.id,customer:customer.customer,customerCode:customer.customerCode,country:customer.directory?.country||'',grade:customer.directory?.grade||'待核查',version:state?.version||0,customerVersion:customer.version,poolAt:state?.poolAt||'',primarySalesMemberId:customerPrimarySalesMemberId(s,customer.id)};}
function safeRequest(r:Entity){const {token,fingerprint,...safe}=r;return safe;}
export function customerWorkflowTransferGet(action:string,req:Request,s:State,m:Member):Response|null{
 if(action!=='customer-workflow-transfers')return null;
 if(!m.active||!['admin','sales','clerk','pmc'].includes(m.role))throw new AppError('无权读取客户流转工作台。',403);
 const customers=(all(s,'customer_account') as CustomerAccount[]).filter(c=>c.active);
 const allowed=new Set(customers.filter(c=>workflowCapabilities(s,m,c).read).map(c=>c.id));
 const handoffs=all(s,'customer_workflow_handoff').filter(r=>m.role==='admin'||r.to===m.id||allowed.has(r.customerId));
 const poolRequests=all(s,'customer_workflow_pool_request').filter(r=>m.role==='admin'||r.actorId===m.id||allowed.has(r.customerId));
 const claims=all(s,'customer_workflow_claim').filter(r=>m.role==='admin'||r.actorId===m.id);
 // Pool is deliberately a small summary projection; no contacts, notes, files,
 // profile metadata, bank details, customer history or followup text is included.
 const pool=['admin','sales'].includes(m.role)?customers.filter(c=>workflowState(s,c.id)?.inPool===true).map(c=>summary(s,c)):[];
 const relevant=new Set([...allowed,...handoffs.map(r=>r.customerId),...claims.map(r=>r.customerId)]);
 return json({pool,handoffs:handoffs.map(safeRequest),poolRequests:poolRequests.map(safeRequest),claims:claims.map(safeRequest),tasks:customerTaskDtos(s,m),customers:customers.filter(c=>relevant.has(c.id)).map(c=>summary(s,c)),sales:all(s,'member').filter(row=>row.active&&row.role==='sales').map(row=>({id:row.id,name:row.name})),canApprove:m.role==='admin'});
}
export async function customerWorkflowTransferPost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 const name=action.replace(/^customer-workflow-/, '') as keyof typeof schemas;if(!Object.prototype.hasOwnProperty.call(schemas,name))return null;
 const parsed=schemas[name].safeParse(await req.json());if(!parsed.success)throw new AppError(parsed.error.issues.slice(0,3).map(i=>i.message).join('；'));const input=parsed.data as any;
 if(!m.active)throw new AppError('账号已停用。',403);
 const customer=customerRecord(s,input.customerId),before=workflowState(s,customer.id),primary=customerPrimarySalesMemberId(s,customer.id),admin=m.role==='admin';
 const isClaim=name==='claim',isAccept=name==='accept';
 if(isClaim){if(m.role!=='sales'||!before?.inPool)throw new AppError('只有在职销售可申请领取公海客户。',403);}
 else if(isAccept){const handoff=all(s,'customer_workflow_handoff').find(r=>r.id===input.id&&r.customerId===customer.id);if(m.role!=='sales'||handoff?.to!==m.id)throw new AppError('必须由指定接收销售本人确认，管理员不能代接收。',403);}
 else workflowCustomer(s,m,customer.id);
 if(['primary','pool-approve','pool-reject','claim-approve'].includes(name)&&!admin)throw new AppError('此操作须由管理员确认。',403);
 if(['handoff','pool-request'].includes(name)&&!admin&&primary!==m.id)throw new AppError('此操作须由当前明确主负责人发起。',403);
 // Replays of pending outsider claim/handoff use the same actor/fingerprint but
 // cannot rely on broad full-customer access. Replayed records reveal no content.
 const previous=all(s,'customer_workflow_request').find(r=>r.id==='customer_workflow_request_'+input.token);
 if(previous){
  const {sha}=await import('./workbooks');if(previous.actorId!==m.id||previous.action!==action||previous.fingerprint!==await sha(JSON.stringify(input)))throw new AppError('请求编号冲突。',409);return json({ok:true,idempotent:true,customerId:customer.id});
 }
 workflowVersionCheck(before,input.version);workflowVersionCheck(customer,input.customerVersion);
 const state=stateRecord(s,m,customer.id),changes:{item:Entity;before?:Entity}[]=[];let message='';
 if(name==='primary'){
  const to=targetMember(s,input.to);if(!customerSalesMemberIds(s,customer).includes(to.id))throw new AppError('主负责人须先在该客户现有销售责任名单中，不能借此新增访问权限。',403);
  if(all(s,'customer_workflow_handoff').some(r=>r.customerId===customer.id&&r.status==='pending'))throw new AppError('存在待接收交接，请先完成或取消。',409);
  state.primarySalesMemberId=to.id;message='确认客户主负责人：'+to.name+'；'+input.reason;
 }else if(name==='handoff'){
  if(!primary||before?.inPool)throw new AppError('请先明确当前主负责人，公海客户使用领取流程。',409);
  const to=targetMember(s,input.to);if(to.id===primary)throw new AppError('接收人不能是当前主负责人。');
  if(all(s,'customer_workflow_handoff').some(r=>r.customerId===customer.id&&r.status==='pending'))throw new AppError('已有待接收交接。',409);
  changes.push({item:{id:newId('customer_workflow_handoff'),kind:'customer_workflow_handoff',customerId:customer.id,version:1,from:primary,to:to.id,status:'pending',reason:input.reason,actorId:m.id,actor:m.name,createdAt:now()}});message='发起交接给 '+to.name+'，等待本人接收';
 }else if(name==='accept'||name==='cancel-handoff'){
  const handoff=requestRecord(s,'customer_workflow_handoff',input);
  if(name==='cancel-handoff'&&!admin&&handoff.from!==m.id)throw new AppError('仅发起主负责人或管理员可取消交接。',403);
  if(name==='accept'){
   if(primary!==handoff.from||before?.inPool)throw new AppError('当前主负责人或公海状态已改变，原交接不能继续。',409);
   const to=targetMember(s,handoff.to);state.primarySalesMemberId=to.id;changes.push({item:addSales(s,m,customer,to),before:customer});
   for(const task of all(s,'customer_workflow_task') as CustomerWorkflowTask[]){if(task.customerId===customer.id&&(!task.ownerId||task.ownerId===handoff.from)&&(customerTaskOpenStatuses as readonly string[]).includes(task.status))changes.push(...customerTaskRevisionChanges(s,m,task,{...task,ownerId:to.id,owner:to.name,version:task.version+1,updatedAt:now(),updatedBy:m.name},'接收客户时移交原负责人未完成任务'));}
  }
  changes.push({item:{...handoff,status:name==='accept'?'accepted':'cancelled',version:handoff.version+1,note:input.note,processedBy:m.id,processedAt:now()},before:handoff});message=name==='accept'?'接收人本人确认交接，保留原协作成员':'取消客户交接';
 }else if(name==='pool-request'){
  if(before?.inPool)throw new AppError('客户已在公海。',409);
  if(all(s,'customer_workflow_pool_request').some(r=>r.customerId===customer.id&&r.status==='pending'))throw new AppError('已有待确认移入公海申请。',409);
  if(input.reason==='两年未下单'&&!customerPoolEligibility(workflowProfile(s,customer.id)?.fields||{}).eligible)throw new AppError('已核实的订单日期尚未满足两年条件。');
  changes.push({item:{id:newId('customer_workflow_pool_request'),kind:'customer_workflow_pool_request',customerId:customer.id,version:1,status:'pending',reason:input.reason,basis:input.basis,actorId:m.id,actor:m.name,createdAt:now()}});message='申请移入公海，等待管理员确认';
 }else if(name==='pool-approve'||name==='pool-reject'||name==='pool-withdraw'){
  const request=requestRecord(s,'customer_workflow_pool_request',input);if(name==='pool-withdraw'&&!admin&&request.actorId!==m.id)throw new AppError('仅申请人或管理员可撤回。',403);
  if(name==='pool-approve'){
   if(request.reason==='两年未下单'&&!customerPoolEligibility(workflowProfile(s,customer.id)?.fields||{}).eligible)throw new AppError('订单依据已变化，当前不满足两年条件。',409);
   if(before?.inPool)throw new AppError('客户已在公海。',409);
   state.inPool=true;state.poolAt=now();state.beforePoolBucket=customer.directory?.bucket||'';state.previousPrimarySalesMemberId=primary;state.primarySalesMemberId='';state.nextDate='';state.followState='暂停';
   changes.push({item:{...customer,directory:{...customer.directory,bucket:'搁置与公海'},version:customer.version+1,updatedAt:now(),updatedBy:m.name},before:customer});
   for(const handoff of all(s,'customer_workflow_handoff').filter(r=>r.customerId===customer.id&&r.status==='pending'))changes.push({item:{...handoff,status:'cancelled',version:handoff.version+1,note:'移入公海取消待接收交接',processedBy:m.id,processedAt:now()},before:handoff});
  }
  changes.push({item:{...request,status:name==='pool-approve'?'approved':name==='pool-reject'?'rejected':'withdrawn',version:request.version+1,note:input.note,processedBy:m.id,processedAt:now()},before:request});message=name==='pool-approve'?'管理员确认移入公海，既有成员授权保留':name==='pool-reject'?'管理员驳回移入公海申请：'+input.note:'撤回移入公海申请';
 }else if(name==='claim'){
  if(all(s,'customer_workflow_claim').some(r=>r.customerId===customer.id&&r.actorId===m.id&&r.status==='pending'))throw new AppError('你已有待确认领取申请。',409);
  changes.push({item:{id:newId('customer_workflow_claim'),kind:'customer_workflow_claim',customerId:customer.id,version:1,status:'pending',actorId:m.id,actor:m.name,next:input.next,nextDate:input.nextDate,reason:input.reason,createdAt:now()}});message='销售提交公海领取申请，尚未获得客户权限';
 }else if(name==='claim-approve'){
  const claim=requestRecord(s,'customer_workflow_claim',input);if(!before?.inPool)throw new AppError('客户已离开公海，请重新核对。',409);
  const to=targetMember(s,claim.actorId),updated=addSales(s,m,customer,to);updated.directory.bucket=['潜力／在谈','现有合作'].includes(before.beforePoolBucket)?before.beforePoolBucket:'潜力／在谈';
  state.inPool=false;state.primarySalesMemberId=to.id;state.next=claim.next;state.nextDate=claim.nextDate;state.followState='已安排';changes.push({item:updated,before:customer});
  for(const request of all(s,'customer_workflow_claim').filter(r=>r.customerId===customer.id&&r.status==='pending'))changes.push({item:{...request,status:request.id===claim.id?'approved':'superseded',version:request.version+1,note:request.id===claim.id?input.note:'其他申请已获管理员确认',processedBy:m.id,processedAt:now()},before:request});message='管理员确认领取，追加接收销售权限并保留既有成员';
 }
 changes.push({item:state,before});return workflowCommit(s,m,action,input,changes,message);
}
