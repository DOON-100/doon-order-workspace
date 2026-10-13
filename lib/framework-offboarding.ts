import {z} from 'zod';
import {all,clean,newId,now,type Entity,type Member,type State} from './domain';
import {AppError,audit,commit,json} from './store';
import {canUseCustomerQuotes} from './customer-quote-access';
import {canManageDrawings,drawingRevision,type EngineeringDrawing} from './engineering-drawings';
import {projectAccess,taskReviewConfigurationValid,type CustomerProject,type CustomerProjectTask} from './customer-projects';
import {communicationAccess} from './unified-communication';
import {customerTaskOpenStatuses,customerTaskOwnerEligible,customerTaskRevisionChanges,type CustomerWorkflowTask} from './customer-workflow-tasks';
import {frameworkFinanceOpenStatuses,frameworkFinanceBusinessAccess,frameworkFinanceTaskRevision,type FrameworkFinanceTask} from './framework-finance-task';

/** A plan is an inventory, not authorization to rewrite any original business record. */
export type OffboardingItem={key:string;recordId:string;kind:string;field:string;label:string;category:string;customerId:string;projectId:string;orderId:string;version:number;sourceHash:string;mode:'id'|'ids'|'name'|'email'|'delegate'|'manual';roles:string[];requiresQuote:boolean;blocker:string;recipientId:string;acceptedBy:string;acceptedAt:string;acceptanceNote:string};
export type OffboardingPlan=Entity&{kind:'framework_offboarding_plan';version:number;memberId:string;memberName:string;memberRole:string;reason:string;status:'draft'|'cancelled'|'completed';items:OffboardingItem[];createdAt:string;createdById:string;updatedAt:string;updatedBy:string};
export const frameworkOffboardingPolicy={recipientConfirmation:'recipient_self_confirmation_required',canFinalize:true,requireCompletedHandoverForDisable:true} as const;
const id=z.string().trim().min(1).max(800),short=z.string().trim().max(3000),base={token:z.string().uuid(),id:id.optional(),expectedVersion:z.number().int().nonnegative()};
const draftSchema=z.object({...base,memberId:id,reason:short.min(1),assignments:z.array(z.object({key:id,recipientId:z.string().trim().max(160)}).strict()).max(30000)}).strict();
const actionSchema=z.object({token:z.string().uuid(),id,expectedVersion:z.number().int().positive(),reason:short.min(1)}).strict();
const acceptSchema=z.object({token:z.string().uuid(),id,expectedVersion:z.number().int().positive(),keys:z.array(id).min(1).max(30000),note:short.min(1)}).strict();
const internal=(m:Member)=>m.active&&m.role!=='supplier';
const manager=(m:Member)=>internal(m)&&m.role==='admin';
const value=(r:Entity,path:string):any=>path.split('.').reduce((a,k)=>a?.[k],r);
const sameName=(a:unknown,b:unknown)=>!!clean(a)&&clean(a).toLowerCase()===clean(b).toLowerCase();
const ended=(r:Entity)=>r.active===false||r.lifecycle==='archived'||['done','completed','closed','cancelled','archived','已完成','已交接','已取消'].includes(r.status);
async function hash(v:unknown){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(v))))).map(n=>n.toString(16).padStart(2,'0')).join('');}
function parse<T extends z.ZodTypeAny>(schema:T,input:unknown):z.output<T>{const result=schema.safeParse(input);if(!result.success)throw new AppError(result.error.issues.slice(0,3).map(x=>x.path.join('.')+': '+x.message).join('；'));return result.data;}
function departingMember(s:State,id:string){const m=all(s,'member').find(m=>m.id===id) as Member|undefined;if(!m||m.role==='supplier'||m.owner)throw new AppError('请选择非初始管理员的内部成员。',403);return m;}
function title(r:Entity){return String(r.customerCode||r.code||r.orderNo||r.number||r.title||r.name||r.label||r.modelNo||r.sampleNo||r.id).slice(0,240);}

/** Explicit current responsibility fields only. Historical authors, messages, signatures and attachments never become assignments. */
export async function frameworkOffboardingInventory(s:State,member:Member):Promise<OffboardingItem[]>{
 const items:OffboardingItem[]=[];
 const add=async(r:Entity,field:string,label:string,category:string,roles:string[],mode:OffboardingItem['mode']='id',blocker='',requiresQuote=false)=>{
  const v=value(r,field),matched=mode==='ids'?Array.isArray(v)&&v.includes(member.id):mode==='email'?sameName(v,member.email):mode==='name'?sameName(v,member.name):mode==='manual'?true:v===member.id;
  if(!matched)return;
  if(mode==='name'&&all(s,'member').filter(m=>sameName(m.name,member.name)).length!==1)blocker='现有姓名对应多个账号，须先在原业务页核实为明确成员。';
  items.push({key:r.id+'::'+field,recordId:r.id,kind:r.kind,field,label:title(r)+' · '+label,category,customerId:r.customerId||(r.kind==='customer_account'?r.id:''),projectId:r.projectId||'',orderId:r.orderId||(r.kind==='order'?r.id:''),version:Number(r.version)||0,sourceHash:await hash(r),mode,roles,requiresQuote,blocker,recipientId:'',acceptedBy:'',acceptedAt:'',acceptanceNote:''});
 };
 const sales=['sales'],service=['sales','clerk','pmc'],engineering=['admin','clerk'],pmc=['pmc'],business=['sales','clerk','pmc'];
 for(const r of s.records){
  if(ended(r))continue;
  if(r.kind.startsWith('customer_project')&&r.projectId){const parent=all(s,'customer_project').find(p=>p.id===r.projectId);if(parent&&['archived','cancelled'].includes(parent.status))continue;}
  if(r.kind==='customer_account'){
   await add(r,'salesMemberIds','负责销售','客户',sales,'ids');await add(r,'serviceMemberIds','负责客服','客户',service,'ids');await add(r,'quoteMemberIds','报价责任范围','客户',business,'ids','',true);
   // A present ID list is authoritative; stale display names must not create another responsibility.
   for(const [field,list,label,roles] of [['salesName','salesMemberIds','负责销售',sales],['serviceName','serviceMemberIds','负责客服',service],['pmcName','','负责PMC',pmc]] as const)if(!list||!Array.isArray(r[list]))await add(r,field,label,'客户',[...roles],'name');
  }else if(r.kind==='customer_workflow_state')await add(r,'primarySalesMemberId','客户主负责人','客户',sales);
  else if(r.kind==='customer_workflow_task'&&customerTaskOpenStatuses.includes(r.status))await add(r,'ownerId','客户任务执行人','客户任务',['admin',...business]);
  else if(r.kind==='framework_finance_task'&&frameworkFinanceOpenStatuses.includes(r.status)){
   await add(r,'recipientId','待处理财务任务','财务',['finance']);await add(r,'businessOwnerId','财务协作业务跟进责任','财务',['admin','sales','clerk']);
  }
  else if(r.kind==='customer_workflow_handoff'&&r.status==='pending'){
   if(r.to===member.id||r.from===member.id)await add(r,'pendingHandoff','尚未完成的客户交接','客户',sales,'manual','须先在客户责任页取消或完成原交接，不能改写原申请与接收人。');
  }else if(r.kind==='customer_project'){
   await add(r,'salesMemberId','项目销售','前期开发',sales);await add(r,'serviceMemberId','项目客服','前期开发',service);await add(r,'serviceMemberIds','项目客服名单','前期开发',service,'ids');await add(r,'serviceReviewerId','客服核对责任','前期开发',service);await add(r,'salesReviewerId','销售核对责任','前期开发',sales);
  }else if(r.kind==='customer_project_team'){
   await add(r,'leaderIds','团队负责人','前期开发',business,'ids');await add(r,'salesMemberIds','团队销售','前期开发',sales,'ids');await add(r,'serviceMemberIds','团队客服','前期开发',service,'ids');
  }else if(r.kind==='customer_project_task'){
   await add(r,'ownerId','跟进执行人','前期开发',business);await add(r,'serviceReviewerId','客服核对责任','前期开发',service);await add(r,'salesReviewerId','销售核对责任','前期开发',sales);
  }else if(['customer_project_followup','customer_project_communication','customer_project_followup_mail'].includes(r.kind)){if(r.kind!=='customer_project_communication'||r.nextAction||r.dueDate)await add(r,'ownerId','当前跟进责任','前期开发',business);}
  else if(r.kind==='customer_project_sample')await add(r,'ownerId','样品制作负责人','前期开发',['pmc','production']);
  else if(r.kind==='engineering_drawing'){
   await add(r,'assigneeId','画图执行人','工程',engineering);if(!r.assigneeId)await add(r,'assignee','历史画图执行人','工程',engineering,'name');
  }else if(r.kind==='order'){
   await add(r,'ownerEmail','订单负责人','订单',business,'email');await add(r,'salesName','负责销售','订单',sales,'name');await add(r,'serviceName','负责客服','订单',service,'name');await add(r,'pmcName','负责PMC','订单',pmc,'name');
  }else if(r.kind==='handoff_business_source'){
   if(r.type==='production_order')await add(r,'fields.pmcId','生产单PMC','生产',pmc);
   if(r.type==='finance_request')await add(r,'fields.recipientId','财务请求接收人','财务',['finance']);
  }else if(r.kind==='framework_configuration')await add(r,'ownerId','配置负责人','系统配置',['admin','programmer',...business,'finance','production']);
  else if(r.kind==='framework_channel_account')await add(r,r.continuityMemberId?'continuityMemberId':'ownerId','渠道持续处理责任','沟通渠道',business,'delegate');
  else if(r.kind==='handoff_business_policy'){
   for(const field of ['drawingLeadMemberId','engineeringSupervisorMemberId'])if(r[field]===member.id)await add(r,field,'生产采用双签岗位','工程',[],'manual','双签岗位只能在审核与发送中明确重新配置，不能随离岗交接自动授予审核权。');
  }
 }
 // Access entitlements are not unfinished duties. Disabling revokes them; they are never copied to a recipient.
 return items.sort((a,b)=>a.key.localeCompare(b.key));
}
export function frameworkOffboardingCandidate(s:State,source:Member,item:OffboardingItem,target:Member):boolean{
 if(!internal(target)||target.id===source.id||item.blocker||item.mode==='manual'||!item.roles.includes(target.role))return false;
 if(item.requiresQuote&&!canUseCustomerQuotes(s,target))return false;
 if(item.kind==='engineering_drawing'&&!canManageDrawings(target))return false;
 if(item.kind==='customer_workflow_task'&&!customerTaskOwnerEligible(s,target,item.customerId)){
  // Preview only: a new recipient may receive the customer's explicit responsibility
  // in this same plan. finalTransfers rechecks the real projected assignments below.
  const customer=all(s,'customer_account').find(c=>c.id===item.customerId);if(!customer)return false;
  const preview=structuredClone(customer);let possible=false;
  for(const side of ['sales','service']){const ids=customer[side+'MemberIds'],owned=Array.isArray(ids)?ids.includes(source.id):sameName(customer[side+'Name'],source.name),eligible=side==='sales'?target.role==='sales':['sales','clerk','pmc'].includes(target.role);if(owned&&eligible){preview[side+'MemberIds']=[...new Set([...(Array.isArray(ids)?ids:[source.id]),target.id])];possible=true;}}
  if(!possible||!customerTaskOwnerEligible({...s,records:s.records.map(r=>r.id===preview.id?preview:r)},target,item.customerId))return false;
 }
 const record=s.records.find(r=>r.id===item.recordId);
 if(item.kind==='customer_project_task'&&record){const otherFields=item.field==='ownerId'?['serviceReviewerId','salesReviewerId']:['ownerId'];if(otherFields.some(k=>record[k]===target.id))return false;}
 return true;
}
function plan(s:State,id:string){const p=all(s,'framework_offboarding_plan').find(p=>p.id===id) as OffboardingPlan|undefined;if(!p)throw new AppError('交接清单不存在。',404);return p;}
function version(p:Entity|undefined,n:number){if((p?.version||0)!==n)throw new AppError('交接清单已更新，请刷新后重核。',409);}
function requireManager(m:Member){if(!manager(m))throw new AppError('只有管理员可编制离岗交接清单。',403);}
async function save(s:State,m:Member,action:string,input:{token:string},row:OffboardingPlan,before?:OffboardingPlan,extra:Entity[]=[]){
 const request={id:'framework_offboarding_request_'+input.token,kind:'framework_offboarding_request',actorId:m.id,action,payloadHash:await hash(input),planId:row.id,createdAt:now()};
 const history={id:newId('framework_offboarding_history'),kind:'framework_offboarding_history',planId:row.id,version:row.version,snapshot:structuredClone(row),actorId:m.id,actor:m.name,createdAt:now(),action};
 await commit(s.revision,[row,...extra,history,request,audit(m,row,before||null,action,'离岗交接清单')]);return json({ok:true,id:row.id,version:row.version});
}
async function replay(s:State,m:Member,action:string,input:{token:string}){const p=s.records.find(p=>p.id==='framework_offboarding_request_'+input.token);if(!p)return null;if(p.actorId!==m.id||p.action!==action||p.payloadHash!==await hash(input))throw new AppError('请求标识已用于其他内容。',409);return json({ok:true,id:p.planId,idempotent:true});}
export async function frameworkOffboardingGet(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(action==='framework-offboarding-incoming'){
  if(!internal(m))throw new AppError('无内部交接权限。',403);
  return json({plans:all(s,'framework_offboarding_plan').filter(p=>p.status==='draft'&&all(s,'member').some(x=>x.id===p.memberId&&x.active)).map(p=>{const source=departingMember(s,p.memberId);return {id:p.id,version:p.version,memberName:p.memberName,reason:p.reason,items:p.items.filter((i:OffboardingItem)=>i.recipientId===m.id&&frameworkOffboardingCandidate(s,source,i,m)).map(({sourceHash,roles,...i}:OffboardingItem)=>i)};}).filter(p=>p.items.length),asOf:now()});
 }
 if(action!=='framework-offboarding')return null;requireManager(m);
 const memberId=new URL(req.url).searchParams.get('memberId'),selected=memberId?departingMember(s,memberId):undefined,items=selected?await frameworkOffboardingInventory(s,selected):[];
 return json({policy:frameworkOffboardingPolicy,members:all(s,'member').filter(m=>m.active&&m.role!=='supplier'&&!m.owner).map(m=>({id:m.id,name:m.name,role:m.role})),items:items.map(item=>({...item,candidateIds:selected?all(s,'member').filter(m=>frameworkOffboardingCandidate(s,selected,item,m as Member)).map(m=>m.id):[]})),plans:all(s,'framework_offboarding_plan'),history:all(s,'framework_offboarding_history'),permissionNote:'停用后原账号失权；不删除历史成员、不复制旧整客户访问范围、报价管理或成本权限。',asOf:now()});
}
async function currentInventory(s:State,p:OffboardingPlan){const source=departingMember(s,p.memberId);if(!source.active)throw new AppError('离岗成员状态已变化，请核实原交接。',409);const current=await frameworkOffboardingInventory(s,source);if(current.length!==p.items.length||current.some(i=>!p.items.some(old=>old.key===i.key&&old.sourceHash===i.sourceHash)))throw new AppError('原业务责任或版本已变化，请管理员重读并保存清单，接收人重新核对。',409);return source;}
function setValue(r:Entity,path:string,next:unknown){const keys=path.split('.');let obj=r;for(const key of keys.slice(0,-1)){obj[key]={...obj[key]};obj=obj[key];}obj[keys[keys.length-1]]=next;}
function finalTransfers(s:State,m:Member,p:OffboardingPlan,source:Member):Entity[]{
 const at=now(),changed=new Map<string,Entity>(),beforeById=new Map<string,Entity>(),pick=(id:string)=>{if(!changed.has(id)){const before=s.records.find(r=>r.id===id);if(!before)throw new AppError('原责任不存在，须重新编制清单。',409);beforeById.set(id,before);changed.set(id,structuredClone(before));}return changed.get(id)!;};
 const accepted=p.items.every(i=>i.recipientId&&i.acceptedBy===i.recipientId&&i.acceptedAt&&!i.blocker&&i.mode!=='manual');if(!accepted)throw new AppError('每项责任必须由指定接收人本人确认，阻塞项须先处理。',409);
 for(const i of p.items){const target=all(s,'member').find(x=>x.id===i.recipientId) as Member|undefined;if(!target||!frameworkOffboardingCandidate(s,source,i,target))throw new AppError('接收人状态或权限已变化，须重核交接。',403);const r=pick(i.recordId);
  if(i.mode==='delegate'){r.continuityMemberId=target.id;r.grants={...r.grants,[target.id]:{view:true,draft:true,send:false}};delete r.grants[source.id];}
  else if(i.mode==='ids')setValue(r,i.field,[...new Set(r.kind==='customer_account'?[...(value(r,i.field)||[]),target.id]:(value(r,i.field)||[]).map((id:string)=>id===source.id?target.id:id))]);
  else setValue(r,i.field,i.mode==='name'?target.name:i.mode==='email'?target.email:target.id);
  if(r.kind==='customer_account'){
   const side=i.field.startsWith('sales')?'sales':i.field.startsWith('service')?'service':'';
   if(side){const key=side+'MemberIds';r[key]=[...new Set([...(Array.isArray(r[key])?r[key]:[source.id]),target.id])];r[side+'Name']=target.name;}
   if(side==='sales'){
    const states=all(s,'customer_workflow_state').filter(w=>w.customerId===r.id);if(states.length>1)throw new AppError('客户有多个责任状态，请先核实。',409);const old=states[0];
    if(!old?.primarySalesMemberId||old.primarySalesMemberId===source.id){const separate=p.items.find(x=>x.recordId===old?.id&&x.field==='primarySalesMemberId');if(separate&&separate.recipientId!==target.id)throw new AppError('客户销售交接与主负责人须选择同一接收销售。',409);const state=old?pick(old.id):{id:newId('customer_workflow_state'),kind:'customer_workflow_state',customerId:r.id,version:0,next:'',nextDate:'',followState:'待安排',latestFollowupOn:''};state.primarySalesMemberId=target.id;state.updatedAt=at;state.updatedBy=m.name;changed.set(state.id,state);}
   }
  }
  if(r.kind==='engineering_drawing'&&i.field==='assigneeId')r.assignee=target.name;
  if(r.kind==='customer_project'&&i.field==='serviceMemberIds')r.serviceMemberId=(r.serviceMemberIds||[])[0]||'';
  if(r.kind==='customer_workflow_task'&&i.field==='ownerId')r.owner=target.name;
 }
 const projected:State={revision:s.revision,records:s.records.map(r=>changed.get(r.id)||r).concat([...changed.values()].filter(r=>!s.records.some(x=>x.id===r.id)))};
 for(const i of p.items){const target=all(s,'member').find(x=>x.id===i.recipientId) as Member,r=changed.get(i.recordId)!;
  if(r.kind.startsWith('customer_project')&&r.customerId&&!['customer_project_sample'].includes(r.kind)&&!projectAccess(projected,target,r.customerId).write)throw new AppError('接收人尚不具备该项目客户范围，请先在同一交接中明确客户责任或核实原权限。',403);
  if(r.kind==='customer_project_task'){const project=projected.records.find(x=>x.id===r.projectId&&x.kind==='customer_project') as CustomerProject|undefined;if(!project||!taskReviewConfigurationValid(projected,project,r as CustomerProjectTask))throw new AppError('交接后的任务执行人和核对人须保持独立，并全部具备现有客户范围。',403);}
  if(r.kind==='handoff_business_source'&&!communicationAccess(projected,target,{customerId:r.customerId,projectId:r.projectId||'',orderId:r.orderId||''},r.type!=='finance_request'))throw new AppError('接收人没有该生产或财务资料的现有客户及订单权限。',403);
  if(r.kind==='customer_workflow_state'){const c=projected.records.find(x=>x.id===r.customerId&&x.kind==='customer_account');if(!c?.salesMemberIds?.includes(r.primarySalesMemberId))throw new AppError('客户主负责人须在明确销售责任名单中。',403);}
  if(r.kind==='customer_workflow_task'&&!customerTaskOwnerEligible(projected,target,r.customerId||''))throw new AppError('接收人不具备该客户任务的当前授权；任务不能单独授予客户权限。',403);
  if(r.kind==='framework_finance_task'&&i.field==='businessOwnerId'&&!frameworkFinanceBusinessAccess(projected,target,r as FrameworkFinanceTask))throw new AppError('财务任务的业务接收人须具备原客户及订单维护权限。',403);
 }
 const updates:Entity[]=[];
 for(const row of changed.values()){
  const before=beforeById.get(row.id);row.version=(Number(before?.version)||0)+1;row.updatedAt=at;row.updatedBy=m.name;
  if(row.kind==='customer_project_task'){row.reviewCycle=(row.reviewCycle||0)+1;row.reviewHistory=[...(row.reviewHistory||[]),{id:newId('task_review'),action:'reconfigure',stage:'configuration',actorId:m.id,actorName:m.name,at,comment:'离岗交接：接收人本人确认后重新安排执行与核对',cycle:row.reviewCycle}];row.status='open';}
  updates.push(row,{id:newId('framework_offboarding_record_history'),kind:'framework_offboarding_record_history',planId:p.id,targetId:row.id,targetKind:row.kind,before:before?structuredClone(before):null,after:structuredClone(row),createdAt:at,actorId:m.id});
  if(row.kind==='customer_workflow_task')updates.push(...customerTaskRevisionChanges(s,m,before as CustomerWorkflowTask|undefined,row as CustomerWorkflowTask,'离岗交接：指定接收人本人确认责任').filter(change=>change.item.id!==row.id).map(change=>change.item));
  if(row.kind==='framework_finance_task')updates.push(frameworkFinanceTaskRevision(s,m,before as FrameworkFinanceTask|undefined,row as FrameworkFinanceTask,'离岗交接责任调整','指定接收人本人确认后管理员转交；原发起人、来源和处理结果保留'));
  if(row.kind.startsWith('customer_project'))updates.push(audit(m,row,before||null,'离岗交接责任调整','本人接收后的管理员最终交接'));
  if(row.kind==='engineering_drawing')updates.push(drawingRevision(row as EngineeringDrawing,m,'离岗交接画图执行责任'));
  if(row.kind==='handoff_business_source')updates.push({id:newId('handoff_business_history'),kind:'handoff_business_history',recordId:row.id,customerId:row.customerId,version:row.version,action:'离岗交接责任调整',actorId:m.id,actor:m.name,createdAt:at,snapshot:structuredClone(row)});
 }
 updates.push({...source,active:false,offboardingPlanId:p.id,offboardedAt:at});return updates;
}
export async function frameworkOffboardingPost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['framework-offboarding-draft','framework-offboarding-cancel','framework-offboarding-finalize','framework-offboarding-accept'].includes(action))return null;if(!internal(m))throw new AppError('无内部交接权限。',403);if(action!=='framework-offboarding-accept')requireManager(m);
 const raw=await req.text();if(raw.length>3500000)throw new AppError('清单超过大小限制。');let body:unknown;try{body=JSON.parse(raw);}catch{throw new AppError('清单内容无效。');}
 if(action==='framework-offboarding-accept'){
  const input=parse(acceptSchema,body),before=plan(s,input.id),source=departingMember(s,before.memberId);if(new Set(input.keys).size!==input.keys.length)throw new AppError('接收事项不能重复。');
  const chosen=input.keys.map(key=>before.items.find(i=>i.key===key));if(chosen.some(i=>!i||i.recipientId!==m.id||!frameworkOffboardingCandidate(s,source,i,m)))throw new AppError('只能由当前指定接收人本人确认，不得代确认。',403);
  const prior=await replay(s,m,action,input);if(prior)return prior;version(before,input.expectedVersion);if(before.status!=='draft')throw new AppError('该交接已关闭。',409);await currentInventory(s,before);
  const at=now(),row={...before,version:before.version+1,items:before.items.map(i=>input.keys.includes(i.key)?{...i,acceptedBy:m.id,acceptedAt:at,acceptanceNote:input.note}:i),updatedAt:at,updatedBy:m.name};return save(s,m,action,input,row,before);
 }
 if(action==='framework-offboarding-finalize'){
  const input=parse(actionSchema,body),before=plan(s,input.id),prior=await replay(s,m,action,input);if(prior)return prior;version(before,input.expectedVersion);if(before.status!=='draft')throw new AppError('交接已经关闭。',409);
  const source=await currentInventory(s,before),updates=finalTransfers(s,m,before,source),at=now();return save(s,m,action,input,{...before,status:'completed',version:before.version+1,completedAt:at,completedById:m.id,completionReason:input.reason,updatedAt:at,updatedBy:m.name},before,updates);
 }
 if(action==='framework-offboarding-cancel'){
  const input=parse(actionSchema,body),before=plan(s,input.id),prior=await replay(s,m,action,input);if(prior)return prior;version(before,input.expectedVersion);if(before.status!=='draft')throw new AppError('只能取消尚未执行的交接草稿。',409);
  return save(s,m,action,input,{...before,version:before.version+1,status:'cancelled',cancelReason:input.reason,updatedAt:now(),updatedBy:m.name},before);
 }
 const input=parse(draftSchema,body),source=departingMember(s,input.memberId);if(!source.active)throw new AppError('该成员已停用，请核实原交接记录。',409);
 const before=input.id?plan(s,input.id):undefined,prior=await replay(s,m,action,input);if(prior)return prior;version(before,input.expectedVersion);
 if(before&&(before.memberId!==source.id||before.status!=='draft'))throw new AppError('不能改换离岗成员或编辑已关闭清单。',409);
 if(!before&&all(s,'framework_offboarding_plan').some(p=>p.memberId===source.id&&p.status==='draft'))throw new AppError('该成员已有交接草稿，请继续原清单。',409);
 if(new Set(input.assignments.map(a=>a.key)).size!==input.assignments.length)throw new AppError('交接事项不能重复。');
 const items=await frameworkOffboardingInventory(s,source),byKey=new Map(items.map(item=>[item.key,item]));
 for(const assignment of input.assignments){const item=byKey.get(assignment.key);if(!item)throw new AppError('业务责任已变化，请刷新清单后重核。',409);if(!assignment.recipientId)continue;const target=all(s,'member').find(m=>m.id===assignment.recipientId) as Member|undefined;if(!target||!frameworkOffboardingCandidate(s,source,item,target))throw new AppError('接收人不符合该项现有部门、报价或独立核对权限。',403);item.recipientId=target.id;}
 const at=now(),row:OffboardingPlan={id:before?.id||newId('framework_offboarding_plan'),kind:'framework_offboarding_plan',version:(before?.version||0)+1,memberId:source.id,memberName:source.name,memberRole:source.role,reason:input.reason,status:'draft',items,createdAt:before?.createdAt||at,createdById:before?.createdById||m.id,updatedAt:at,updatedBy:m.name};
 return save(s,m,action,input,row,before);
}
/** Confirmed policy: no unfinished duties permits ordinary disable; otherwise only the atomic handover transaction disables. */
export async function assertFrameworkMemberDisableAllowed(s:State,member:Member){
 if(!member.active||member.role==='supplier')return;
 if((await frameworkOffboardingInventory(s,member)).length)throw new AppError('该成员仍有责任事项。须由指定接收人本人确认交接后，在离岗交接清单执行管理员最终停用。',409);
}
