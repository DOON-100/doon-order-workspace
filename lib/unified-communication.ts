import {z} from 'zod';
import {all,canRead,clean,strictDate,type CustomerAccount,type Entity,type Member,type Order,type State} from './domain';
import {assignedServiceCustomer,serviceOrderCustomerKeys} from './service-workspace';
import {canReadProject,isProjectTrashed,projectAccess} from './customer-projects';
import {matchesCustomerResponsibility} from './customer-responsibility';
import {customerQuoteAccessPolicy} from './customer-quote-access';
import {frameworkChannelAccess} from './framework-channel-access';
import {customerPrimarySalesMemberId} from './customer-workflow-responsibility';

export const communicationChannels=['email','whatsapp','wechat','phone','meeting','other'] as const;
export type Communication=Entity & {
 kind:'unified_communication';version:number;customerId:string;projectId:string;orderId:string;
 channel:typeof communicationChannels[number];title:string;sourceText:string;sourceReference:string;occurredAt:string;
 draftText:string;internalNote:string;status:'draft'|'pending_check'|'returned'|'checked';inputMode:'manual';
 sourceHash:string;sourceRevision:number;contentHash:string;requiresRecheck:boolean;lastSubmissionId:string;
 createdAt:string;createdBy:string;createdById:string;updatedAt:string;updatedBy:string;updatedById:string;
};
export type CommunicationLinks={customerId:string;projectId:string;orderId:string;id?:string};
const id=z.string().trim().min(1).max(160),text=(max:number)=>z.string().max(max).default('');
const day=text(10).refine(value=>{try{return !value||/^\d{4}-\d{2}-\d{2}$/.test(value)&&strictDate(value)===value;}catch{return false;}},'日期须为有效 YYYY-MM-DD');
const actionHashes={expectedSourceHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),expectedContentHash:z.string().regex(/^[a-f0-9]{64}$/).optional()};
export const communicationFields={
 customerId:id,projectId:text(160),orderId:text(160),channel:z.enum(communicationChannels),
 title:z.string().trim().min(1).max(300),sourceText:text(100000),sourceReference:text(3000),occurredAt:day,
 draftText:text(100000),internalNote:text(10000),
};
export const communicationSchemas={
 save:z.object({token:z.string().uuid(),id:id.optional(),expectedVersion:z.number().int().positive().optional(),...communicationFields}).strict().superRefine((v,c)=>{
  if(v.id&&v.expectedVersion===undefined)c.addIssue({code:'custom',path:['expectedVersion'],message:'更新必须提供当前版本号'});
  if(!v.id&&v.expectedVersion!==undefined)c.addIssue({code:'custom',path:['expectedVersion'],message:'新记录不能带版本号'});
  if(!v.sourceText.trim()&&!v.draftText.trim())c.addIssue({code:'custom',path:['sourceText'],message:'请录入沟通原文或回复草稿'});
 }),
 submit:z.object({token:z.string().uuid(),id,expectedVersion:z.number().int().positive(),...actionHashes,comment:text(6000)}).strict(),
 completeReview:z.object({token:z.string().uuid(),id,expectedVersion:z.number().int().positive(),...actionHashes,comment:text(6000)}).strict(),
 return:z.object({token:z.string().uuid(),id,expectedVersion:z.number().int().positive(),...actionHashes,comment:z.string().trim().min(1).max(6000)}).strict(),
};

/** The customer is necessary but never sufficient when project/order links exist. */
export function communicationAccess(s:State,m:Member,links:CommunicationLinks,write=false){
 if(links.id&&!frameworkChannelAccess(s,m,links.id,write))return false;
 const customer=all(s,'customer_account').find(c=>c.id===links.customerId) as CustomerAccount|undefined;
 if(!customer||!assignedServiceCustomer(s,m,customer))return false;
 if(write&&(!customer.active||!['admin','sales','clerk','pmc'].includes(m.role)))return false;
 if(links.projectId){
  const project=all(s,'customer_project').find(p=>p.id===links.projectId);
  if(!project||project.customerId!==customer.id||!canReadProject(s,m,project))return false;
  if(write&&(!projectAccess(s,m,customer.id).write||project.status==='archived'||isProjectTrashed(project)))return false;
 }
 if(links.orderId){
  const order=all(s,'order').find(o=>o.id===links.orderId) as Order|undefined;
  if(!order||!canRead(m,order)||!serviceOrderCustomerKeys(s,customer).some(key=>clean(key).toLowerCase()===clean(order.customer).toLowerCase()))return false;
 }
 return true;
}

/** Internal checking grants no quote approval or sending, including for administrators. */
export function canReviewCommunication(s:State,m:Member,row:Communication){
 if(!communicationAccess(s,m,row,true))return false;
 if(row.projectId)return all(s,'customer_project').some(p=>p.id===row.projectId&&p.customerId===row.customerId&&p.salesMemberId===m.id);
 const assignedPrimary=all(s,'customer_workflow_state').find(r=>r.customerId===row.customerId)?.primarySalesMemberId;
 if(assignedPrimary)return customerPrimarySalesMemberId(s,row.customerId)===m.id;
 const customer=all(s,'customer_account').find(c=>c.id===row.customerId) as CustomerAccount;
 const policy=customerQuoteAccessPolicy(s),aliases=policy?.aliasesByMember[m.id]||[];
 return matchesCustomerResponsibility(customer,m,'sales',aliases);
}
export function publicCommunication(s:State,m:Member,row:Communication){
 const canWrite=communicationAccess(s,m,row,true);
 const reviewer=row.status==='pending_check'&&canReviewCommunication(s,m,row);
 return {...row,canWrite,canSubmit:canWrite&&['draft','returned'].includes(row.status)&&!!row.draftText.trim(),canReturn:reviewer,canCompleteReview:reviewer};
}
