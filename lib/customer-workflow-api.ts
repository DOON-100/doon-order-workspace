import {z} from 'zod';
import {all,newId,now,type CustomerAccount,type Entity,type Member,type State} from './domain';
import {AppError,audit,commit,json} from './store';
import {assignedServiceCustomer} from './service-workspace';
import {sha} from './workbooks';
import {customerProfileSchema,customerWorkflowSchemas,customerPoolEligibility,customerReminder,workflowDate,workflowVersion,type CustomerWorkflowProfile,type CustomerWorkflowState,type CustomerWorkflowFollowup,type CustomerProfileData} from './customer-workflow';
import {customerWorkflowTransferGet,customerWorkflowTransferPost} from './customer-workflow-transfers';
import {customerPrimarySalesMemberId,customerSalesMemberIds} from './customer-workflow-responsibility';
import {customerWorkflowFileGet,customerWorkflowFilePost} from './customer-workflow-files';
import {customerWorkflowTaskGet,customerWorkflowTaskPost} from './customer-workflow-tasks';

export type CustomerWorkflowPolicy=Entity&{kind:'customer_workflow_policy';version:number;confirmed:boolean;supplement:'existing_responsible';bank:'admin_finance';pool:'admin_only'|'sales_apply_admin_confirm';handoff:'recipient_only'|'admin_may_accept';newCustomer:'admin_pmc'|'sales_self'};
// Human confirmation, 2026-10-13: assigned staff supplement; active sales see pool
// summaries and apply, administrator confirms; designated primary salesperson alone
// accepts a handoff. User clarified “客户” meant customer-service employees:
// bank data is visible to admin/finance/sales/service within existing customer
// authorization. Existing admin/finance maintenance remains separate from viewing.
export const customerWorkflowPolicyVersion='2026-10-13-confirmed-pool-self-accept-bank-staff-v2';
export const customerWorkflowPolicy=(_s:State)=>({confirmed:true,pool:'sales_apply_admin_confirm',handoff:'recipient_only',bank:'authorized_internal_staff',supplement:'existing_responsible',version:customerWorkflowPolicyVersion} as const);
export function workflowCustomer(s:State,m:Member,customerId:string){
 const customer=all(s,'customer_account').find(row=>row.id===customerId) as CustomerAccount|undefined;
 if(!customer||!assignedServiceCustomer(s,m,customer))throw new AppError('客户不在当前资料权限范围内。',403);
 return customer;
}
export function workflowCapabilities(s:State,m:Member,customer:CustomerAccount){
 const policy=customerWorkflowPolicy(s),read=assignedServiceCustomer(s,m,customer),enabled=!!policy&&m.active&&customer.active;
 return {read,policyConfirmed:!!policy,policyVersion:policy.version,writeProfile:enabled&&read&&['admin','sales','clerk','pmc'].includes(m.role),readBank:read&&['admin','finance','sales','clerk','pmc'].includes(m.role),writeBank:enabled&&read&&['admin','finance'].includes(m.role),writeWorkflow:enabled&&read&&['admin','sales','clerk','pmc'].includes(m.role),canAssign:enabled&&m.role==='admin',poolConfigured:true,canUsePool:enabled&&['admin','sales'].includes(m.role)};
}
export function workflowProfile(s:State,customerId:string){return all(s,'customer_workflow_profile').find(row=>row.customerId===customerId) as CustomerWorkflowProfile|undefined;}
export function workflowState(s:State,customerId:string){return all(s,'customer_workflow_state').find(row=>row.customerId===customerId) as CustomerWorkflowState|undefined;}
export const customerWorkflowMasterInputSchema=z.object({profile:customerProfileSchema.optional(),profileVersion:workflowVersion.optional(),next:z.string().trim().max(300).optional(),nextDate:workflowDate.optional(),stateVersion:workflowVersion.optional()}).strict();
/** Caller commits these records with the original customer-save record and audit. */
export function prepareCustomerWorkflowMasterChanges(s:State,m:Member,beforeCustomer:CustomerAccount|undefined,customer:CustomerAccount,value:unknown):Entity[]{
 if(value===undefined)return [];
 const input=parse(customerWorkflowMasterInputSchema,value),records:Entity[]=[];
 if(input.profile){
  if(Object.prototype.hasOwnProperty.call(input.profile,'bankPaymentInfo')&&(!beforeCustomer?m.role!=='admin':!workflowCapabilities(s,m,beforeCustomer).writeBank))throw new AppError('银行资料维护仍限现有管理员/财务权限，查看权限不授予修改权。',403);
  if(beforeCustomer&&!workflowCapabilities(s,m,beforeCustomer).writeProfile)throw new AppError('没有客户补充资料权限。',403);
  const before=workflowProfile(s,customer.id);if(before&&input.profileVersion===undefined)throw new AppError('修改通用资料必须提供其当前版本。',409);workflowVersionCheck(before,input.profileVersion??0);
  const fields=parse(customerProfileSchema,{...before?.fields,...input.profile});if(fields.orderHistory==='从未下单'&&fields.lastOrderOn)throw new AppError('从未下单不能填写最后正式订单日期。');
  const item={...before,id:before?.id||newId('customer_workflow_profile'),kind:'customer_workflow_profile',customerId:customer.id,version:(before?.version||0)+1,fields,createdAt:before?.createdAt||now(),createdBy:before?.createdBy||m.name,updatedAt:now(),updatedBy:m.name};records.push(item,audit(m,item,before||null,'客户通用资料随主档保存','统一客户档案'));
 }
 if(input.next!==undefined||input.nextDate!==undefined){
  if(beforeCustomer&&!workflowCapabilities(s,m,beforeCustomer).writeWorkflow)throw new AppError('没有客户跟进安排权限。',403);
  const before=workflowState(s,customer.id);if(before&&input.stateVersion===undefined)throw new AppError('修改跟进安排必须提供其当前版本。',409);workflowVersionCheck(before,input.stateVersion??0);
  const next=input.next??before?.next??'',nextDate=input.nextDate??before?.nextDate??'';if(nextDate&&!next)throw new AppError('安排日期时必须填写下一步。');
  const item={...before,id:before?.id||newId('customer_workflow_state'),kind:'customer_workflow_state',customerId:customer.id,version:(before?.version||0)+1,next,nextDate,followState:nextDate?'已安排':'待安排',latestFollowupOn:before?.latestFollowupOn||'',updatedAt:now(),updatedBy:m.name};records.push(item,audit(m,item,before||null,'客户跟进安排随主档保存','统一客户档案'));
 }
 return records;
}
export function workflowProfileDto(s:State,m:Member,customer:CustomerAccount){
 const profile=workflowProfile(s,customer.id),fields={...(profile?.fields||{})},capabilities=workflowCapabilities(s,m,customer);
 const legacy=all(s,'service_record').filter(row=>row.customerId===customer.id&&row.type==='customer_profile');
 const sourceFields:Record<string,string>={};
 // Exact customerId and one unambiguous legacy profile only. The combined legacy
 // address is never guessed to be company, billing, or delivery address.
 if(legacy.length===1){for(const key of ['contactPerson','email','phone'] as const){if(!Object.prototype.hasOwnProperty.call(fields,key)&&typeof legacy[0].details?.[key]==='string'){fields[key]=legacy[0].details[key];sourceFields[key]=legacy[0].id;}}}
 if(!capabilities.readBank)delete fields.bankPaymentInfo;
 return profile?{...profile,fields,sourceFields,legacyProfileCount:legacy.length}:{customerId:customer.id,version:0,fields,sourceFields,legacyProfileCount:legacy.length};
}
function parse<T extends z.ZodTypeAny>(schema:T,value:unknown):z.output<T>{const parsed=schema.safeParse(value);if(!parsed.success)throw new AppError(parsed.error.issues.slice(0,4).map(issue=>`${issue.path.join('.')}: ${issue.message}`).join('；'));return parsed.data;}
export function workflowVersionCheck(before:Entity|undefined,version:number){if((before?.version||0)!==version)throw new AppError('资料已由其他同事更新，请刷新后重新核对；本次未覆盖。',409);}
export function workflowEvent(m:Member,customerId:string,action:string,reason:string,extra:Record<string,unknown>={}){return {id:newId('customer_workflow_event'),kind:'customer_workflow_event',customerId,action,reason,actorId:m.id,actor:m.name,createdAt:now(),...extra};}
export async function workflowReplay(s:State,m:Member,action:string,input:{token:string;customerId:string}){
 const record=all(s,'customer_workflow_request').find(row=>row.id==='customer_workflow_request_'+input.token);
 if(!record)return null;
 if(record.actorId!==m.id||record.action!==action||record.fingerprint!==await sha(JSON.stringify(input)))throw new AppError('此请求编号已用于其他内容，请重新核对。',409);
 workflowCustomer(s,m,input.customerId);
 return json({ok:true,idempotent:true,customerId:input.customerId});
}
export async function workflowCommit(s:State,m:Member,action:string,input:{token:string;customerId:string},changes:{item:Entity;before?:Entity}[],reason:string){
 const events=workflowEvent(m,input.customerId,action,reason);
 const updates=[...changes.flatMap(({item,before})=>[item,audit(m,item,before||null,action,'统一客户档案')]),events,{id:'customer_workflow_request_'+input.token,kind:'customer_workflow_request',customerId:input.customerId,actorId:m.id,action,fingerprint:await sha(JSON.stringify(input)),createdAt:now()}];
 await commit(s.revision,updates);return json({ok:true,customerId:input.customerId});
}
function historyDto(entry:Entity){return {id:entry.id,action:entry.action,reason:entry.reason,actor:entry.actor,createdAt:entry.createdAt};}
export async function customerWorkflowGet(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 const task=customerWorkflowTaskGet(action,req,s,m);if(task)return task;
 if(action==='customer-workflow-export'){
  if(!m.active||m.role!=='admin')throw new AppError('仅管理员可导出客户完整资料记录。',403);
  const customers=all(s,'customer_account'),ids=new Set(customers.map(c=>c.id)),projects=all(s,'customer_project').filter(p=>ids.has(p.customerId)),projectIds=new Set(projects.map(p=>p.id));
  const included=s.records.filter(row=>ids.has(row.customerId)&&(row.kind.startsWith('customer_workflow_')&&row.kind!=='customer_workflow_request'||row.kind.startsWith('customer_project')||['service_record','service_attachment'].includes(row.kind))||projectIds.has(row.projectId)&&row.kind.startsWith('customer_project'));
  const records=[...customers,...projects,...included].filter((row,index,rows)=>rows.findIndex(other=>other.id===row.id)===index).map(row=>{const {fileKey,...value}=row;return value;});
  const result={format:'doon-customer-record-export-v1',exportedAt:now(),revision:s.revision,attachmentBytesIncluded:false,scope:'客户主档、客户补充资料及流转、精确客户ID关联的客服资料与项目记录；不含附件原件、账号或会话。',records};
  return new Response(JSON.stringify(result,null,2),{headers:{'Content-Type':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="customer-records-${new Date().toISOString().slice(0,10)}.json"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 }
 const file=await customerWorkflowFileGet(action,req,s,m);if(file)return file;
 const transfer=customerWorkflowTransferGet(action,req,s,m);if(transfer)return transfer;
 if(!['customer-workflow-data','customer-workflow-history'].includes(action))return null;
 const customerId=new URL(req.url).searchParams.get('customerId')||'';
 if(!customerId){
  if(action==='customer-workflow-history')throw new AppError('请选择客户。');
  const customers=(all(s,'customer_account') as CustomerAccount[]).filter(customer=>assignedServiceCustomer(s,m,customer));
  return json({customers:customers.map(customer=>{const profile=workflowProfileDto(s,m,customer),state=workflowState(s,customer.id);return {id:customer.id,profile,workflow:state||null,reminder:customerReminder(state||null),capabilities:workflowCapabilities(s,m,customer)};}),policyConfirmed:!!customerWorkflowPolicy(s)});
 }
 const customer=workflowCustomer(s,m,customerId),profile=workflowProfileDto(s,m,customer),state=workflowState(s,customerId);
 if(action==='customer-workflow-history')return json({events:all(s,'customer_workflow_event').filter(row=>row.customerId===customerId).map(historyDto).reverse()});
 return json({customer:{id:customer.id,customer:customer.customer,customerCode:customer.customerCode,country:customer.directory?.country||''},profile,workflow:state||null,primarySalesMemberId:customerPrimarySalesMemberId(s,customerId),salesMemberIds:customerSalesMemberIds(s,customer),followups:all(s,'customer_workflow_followup').filter(row=>row.customerId===customerId).sort((a,b)=>b.at.localeCompare(a.at)||b.createdAt.localeCompare(a.createdAt)),events:all(s,'customer_workflow_event').filter(row=>row.customerId===customerId).map(historyDto).reverse(),capabilities:workflowCapabilities(s,m,customer),reminder:customerReminder(state||null),poolEligibility:customerPoolEligibility(profile.fields)});
}
export async function customerWorkflowPost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 const task=await customerWorkflowTaskPost(action,req,s,m);if(task)return task;
 const file=await customerWorkflowFilePost(action,req,s,m);if(file)return file;
 const transfer=await customerWorkflowTransferPost(action,req,s,m);if(transfer)return transfer;
 const names:Record<string,keyof typeof customerWorkflowSchemas>={'customer-workflow-profile-save':'profile','customer-workflow-followup':'followup','customer-workflow-schedule':'schedule'};
 const name=names[action];if(!name)return null;
 const input=parse(customerWorkflowSchemas[name],await req.json()) as any;
 const customer=workflowCustomer(s,m,input.customerId),capabilities=workflowCapabilities(s,m,customer);
 if(!capabilities.policyConfirmed)throw new AppError('客户补充资料及流转权限尚待管理员确认，当前未开放保存。',403);
 if(name==='profile'){
  const keys=Object.keys(input.patch);if(!keys.length)throw new AppError('没有需要保存的资料。');
  if(keys.some(key=>key!=='bankPaymentInfo')&&!capabilities.writeProfile||keys.includes('bankPaymentInfo')&&!capabilities.writeBank)throw new AppError('没有本次资料字段的维护权限。',403);
  const replay=await workflowReplay(s,m,action,input);if(replay)return replay;
  const before=workflowProfile(s,customer.id);workflowVersionCheck(before,input.version);
  const fields:CustomerProfileData={...before?.fields,...input.patch};
  parse(customerProfileSchema,fields);
  if(fields.orderHistory==='从未下单'&&fields.lastOrderOn)throw new AppError('从未下单不能同时填写最后正式订单日期，请核对订单情况。');
  const item:CustomerWorkflowProfile={...before,id:before?.id||newId('customer_workflow_profile'),kind:'customer_workflow_profile',customerId:customer.id,version:(before?.version||0)+1,fields,createdAt:before?.createdAt||now(),createdBy:before?.createdBy||m.name,updatedAt:now(),updatedBy:m.name};
  return workflowCommit(s,m,action,input,[{item,before}],'更新客户通用资料字段：'+keys.join('、'));
 }
 if(!capabilities.writeWorkflow)throw new AppError('没有当前客户的跟进维护权限。',403);
 const replay=await workflowReplay(s,m,action,input);if(replay)return replay;
 const before=workflowState(s,customer.id);workflowVersionCheck(before,input.version);
 const state:CustomerWorkflowState={...before,id:before?.id||newId('customer_workflow_state'),kind:'customer_workflow_state',customerId:customer.id,version:(before?.version||0)+1,next:before?.next||'',nextDate:before?.nextDate||'',followState:before?.followState||'待安排',latestFollowupOn:before?.latestFollowupOn||'',updatedAt:now(),updatedBy:m.name};
 if(name==='schedule'){
  state.next=input.next;state.nextDate=input.nextDate;state.followState='已安排';
  return workflowCommit(s,m,action,input,[{item:state,before}],'安排下次跟进：'+input.nextDate);
 }
 const item:CustomerWorkflowFollowup={id:newId('customer_workflow_followup'),kind:'customer_workflow_followup',customerId:customer.id,at:input.at,authorId:m.id,author:m.name,channel:input.channel,content:input.content,result:input.result,disposition:input.disposition,next:input.next,nextDate:input.disposition==='暂停跟进'?'':input.nextDate,evidence:input.evidence,createdAt:now()};
 if(!state.latestFollowupOn||input.at>=state.latestFollowupOn){state.next=item.next;state.nextDate=item.nextDate;state.followState=input.disposition==='暂停跟进'?'暂停':item.nextDate?'已安排':'待安排';state.latestFollowupOn=input.at;}
 return workflowCommit(s,m,action,input,[{item},{item:state,before}],input.disposition==='暂停跟进'?'记录跟进并暂停提醒':'记录客户跟进');
}
