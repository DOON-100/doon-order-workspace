import {z} from 'zod';
import {all,newId,now,type CustomerAccount,type Entity,type Member,type State} from './domain';
import {AppError,audit,commit,json} from './store';
import {assignedServiceCustomer} from './service-workspace';
import {customerSalesMemberIds} from './customer-workflow-responsibility';
import {workflowDate,workflowId,workflowToken,workflowVersion} from './customer-workflow';
import {sha} from './workbooks';

// Handoff prototype check-app task schema / team-permissions, intersected with
// current server customer responsibilities. A task never grants customer access.
export const customerTaskStatuses=['待接手','进行中','受阻','完成','取消'] as const;
export const customerTaskOpenStatuses=['待接手','进行中','受阻'] as const;
export type CustomerWorkflowTask=Entity&{kind:'customer_workflow_task';customerId:string;title:string;ownerId:string;owner:string;due:string;status:typeof customerTaskStatuses[number];result:string;notes:string;version:number;createdAt:string;createdBy:string;updatedAt:string;updatedBy:string};
export function customerTaskOwnerEligible(s:State,m:Member,customerId:string):boolean{
 if(!m.active||!['admin','sales','clerk','pmc'].includes(m.role))return false;
 if(!customerId)return true;
 const customer=all(s,'customer_account').find(c=>c.id===customerId) as CustomerAccount|undefined;
 return !!customer?.active&&assignedServiceCustomer(s,m,customer);
}
export function customerTaskCanEdit(s:State,m:Member,task:CustomerWorkflowTask):boolean{
 if(!customerTaskOwnerEligible(s,m,task.customerId))return false;
 if(m.role==='admin'||task.ownerId===m.id)return true;
 const customer=all(s,'customer_account').find(c=>c.id===task.customerId) as CustomerAccount|undefined;
 return !!customer&&customerSalesMemberIds(s,customer).includes(m.id);
}
export function customerTaskDtos(s:State,m:Member){return (all(s,'customer_workflow_task') as CustomerWorkflowTask[]).filter(task=>customerTaskCanEdit(s,m,task)).map(task=>({...task,canEdit:true})).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));}
export function customerTaskRevisionChanges(s:State,m:Member,before:CustomerWorkflowTask|undefined,item:CustomerWorkflowTask,reason:string):{item:Entity;before?:Entity}[]{
 const revision=(value:CustomerWorkflowTask,note:string)=>({id:newId('customer_task_revision'),kind:'customer_workflow_task_revision',taskId:value.id,customerId:value.customerId,version:value.version,snapshot:{...value},actorId:m.id,actor:m.name,createdAt:now(),reason:note});
 return [{item,before},...(before&&!all(s,'customer_workflow_task_revision').some(r=>r.taskId===before.id&&r.version===before.version)?[{item:revision(before,'保留更新前版本')}]:[]),{item:revision(item,reason)}];
}
const schema=z.object({token:workflowToken,id:workflowId.optional(),version:workflowVersion,customerId:z.string().max(160).default(''),title:z.string().trim().min(1,'请填写任务名称').max(300),ownerId:workflowId,due:workflowDate,status:z.enum(customerTaskStatuses),result:z.string().trim().max(12000),notes:z.string().max(12000)}).strict();
export function customerWorkflowTaskGet(action:string,req:Request,s:State,m:Member):Response|null{
 if(!['customer-workflow-tasks','customer-workflow-task-history'].includes(action))return null;
 if(!customerTaskOwnerEligible(s,m,''))throw new AppError('没有客户任务权限。',403);
 const query=new URL(req.url).searchParams,customerId=query.get('customerId')||'';
 if(customerId&&!customerTaskOwnerEligible(s,m,customerId))throw new AppError('客户不在当前任务权限范围内。',403);
 if(action==='customer-workflow-task-history'){
  const task=all(s,'customer_workflow_task').find(r=>r.id===query.get('id')) as CustomerWorkflowTask|undefined;
  if(!task||!customerTaskCanEdit(s,m,task))throw new AppError('任务不存在或当前无权读取。',403);
  // Rebinding by admin must not expose the previous customer's private text.
  return json({taskId:task.id,revisions:all(s,'customer_workflow_task_revision').filter(r=>r.taskId===task.id&&(m.role==='admin'||r.customerId===task.customerId)).sort((a,b)=>b.version-a.version)});
 }
 const customers=(all(s,'customer_account') as CustomerAccount[]).filter(c=>customerTaskOwnerEligible(s,m,c.id));
 const owners=(all(s,'member') as Member[]).filter(owner=>customerTaskOwnerEligible(s,owner,'')&&(m.role==='admin'||owner.id===m.id));
 return json({customers:customers.map(c=>({id:c.id,customer:c.customer,customerCode:c.customerCode})),ownerCandidates:owners.map(owner=>({id:owner.id,name:owner.name,customerIds:customers.filter(c=>customerTaskOwnerEligible(s,owner,c.id)).map(c=>c.id)})),tasks:customerTaskDtos(s,m).filter(task=>!customerId||task.customerId===customerId),canCreate:true});
}
export async function customerWorkflowTaskPost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(action!=='customer-workflow-task-save')return null;
 const parsed=schema.safeParse(await req.json());if(!parsed.success)throw new AppError(parsed.error.issues.slice(0,3).map(i=>i.message).join('；'));const input=parsed.data;
 if(!customerTaskOwnerEligible(s,m,input.customerId))throw new AppError('客户不在当前任务权限范围内。',403);
 const before=input.id?all(s,'customer_workflow_task').find(r=>r.id===input.id) as CustomerWorkflowTask|undefined:undefined;
 if(input.id&&(!before||!customerTaskCanEdit(s,m,before)))throw new AppError('任务不存在或当前无权维护。',403);
 if(m.role!=='admin'&&(before?input.ownerId!==before.ownerId||input.customerId!==before.customerId:input.ownerId!==m.id))throw new AppError('本人创建任务只能指定自己；现有任务负责人和关联客户仅管理员可调整。',403);
 const owner=all(s,'member').find(r=>r.id===input.ownerId) as Member|undefined;if(!owner||!customerTaskOwnerEligible(s,owner,input.customerId))throw new AppError('负责人须为当前客户已有授权内的在职成员；任务不能扩展客户权限。',403);
 if(input.status==='完成'&&!input.result)throw new AppError('完成任务必须填写处理结果或完成依据。');
 const fingerprint=await sha(JSON.stringify(input)),previous=all(s,'customer_workflow_request').find(r=>r.id==='customer_workflow_request_'+input.token);
 if(previous){if(previous.actorId!==m.id||previous.action!==action||previous.fingerprint!==fingerprint)throw new AppError('请求编号冲突。',409);const task=all(s,'customer_workflow_task').find(r=>r.id===previous.taskId) as CustomerWorkflowTask|undefined;if(!task||!customerTaskCanEdit(s,m,task))throw new AppError('任务权限已变化。',403);return json({ok:true,idempotent:true,item:task});}
 if((before?.version||0)!==input.version)throw new AppError('任务已更新，请刷新核对后再保存；本次未覆盖。',409);
 const item:CustomerWorkflowTask={...before,id:before?.id||newId('customer_workflow_task'),kind:'customer_workflow_task',customerId:input.customerId,title:input.title,ownerId:owner.id,owner:owner.name,due:input.due,status:input.status,result:input.result,notes:input.notes,version:(before?.version||0)+1,createdAt:before?.createdAt||now(),createdBy:before?.createdBy||m.name,updatedAt:now(),updatedBy:m.name};
 const changes=customerTaskRevisionChanges(s,m,before,item,before?'修改客户任务':'创建客户任务');
 const updates=[...changes.flatMap(({item,before})=>[item,audit(m,item,before||null,action,'客户任务')]),{id:'customer_workflow_request_'+input.token,kind:'customer_workflow_request',customerId:item.customerId,taskId:item.id,actorId:m.id,action,fingerprint,createdAt:now()}];
 await commit(s.revision,updates);return json({ok:true,item});
}
