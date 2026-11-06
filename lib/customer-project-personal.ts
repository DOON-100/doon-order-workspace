import {all,type Member,type State} from './domain';
import {getVisibleProjectFollowups,followupAccess} from './customer-project-followup';
import {projectAccess,projectServiceMemberIds,projectTaskPermissions,type CustomerProject,type CustomerProjectTask} from './customer-projects';

export type PersonalProjectAction={id:string;source:'project'|'followup';projectId:string;customerId:string;projectTitle:string;projectCode:string;customerLabel:string;title:string;dueDate:string;status:string;stage:'followup'|'service_review'|'sales_review';canAct:boolean;unavailableReason:string};
export type PersonalResponsibleProject={id:string;customerId:string;title:string;code:string;customerLabel:string;status:string;dueDate:string;roles:('sales'|'service')[]};
export type CustomerProjectPersonalWork={actions:PersonalProjectAction[];projects:PersonalResponsibleProject[]};

/** Read projections retain original IDs and workflows; responsibility never creates a task or grants customer access. */
export function customerProjectPersonalWork(s:State,m:Member):CustomerProjectPersonalWork{
 if(!m.active)return {actions:[],projects:[]};
 const customers=new Map(all(s,'customer_account').map(row=>[row.id,row]));
 const projects=(all(s,'customer_project') as CustomerProject[]).filter(project=>!project.trashedAt&&projectAccess(s,m,project.customerId).read);
 const projectById=new Map(projects.map(project=>[project.id,project]));
 const labels=(customerId:string,project?:CustomerProject)=>({customerLabel:customers.get(customerId)?.customer||'未关联客户',projectTitle:project?.title||'未关联项目',projectCode:project?.code||''});
 const actions:PersonalProjectAction[]=[];
 for(const task of all(s,'customer_project_task') as CustomerProjectTask[]){
  const project=projectById.get(task.projectId);if(!project||task.customerId!==project.customerId)continue;
  const stage=task.status==='service_review'?'service_review':task.status==='sales_review'?'sales_review':['open','returned'].includes(task.status)?'followup':null;
  if(!stage||(stage==='service_review'?task.serviceReviewerId:stage==='sales_review'?task.salesReviewerId:task.ownerId)!==m.id)continue;
  const permissions=projectTaskPermissions(s,m,project,task);
  const canAct=stage==='service_review'?permissions.canReviewService:stage==='sales_review'?permissions.canReviewSales:permissions.canSubmit;
  const unavailableReason=canAct?'':project.status!=='active'?'项目当前仅可查看，请先核对项目状态。':!permissions.reviewConfigurationValid?'跟进或审核配置待核对，请联系项目负责人完善。':'当前仅有查看权限，请联系项目负责人核对。';
  actions.push({id:task.id,source:'project',projectId:project.id,customerId:project.customerId,...labels(project.customerId,project),title:task.title,dueDate:task.dueDate||'',status:task.status,stage,canAct,unavailableReason});
 }
 for(const row of getVisibleProjectFollowups(s,m)){
  if(row.ownerId!==m.id||['completed','done','cancelled'].includes(row.status))continue;
  const project=row.projectId?projectById.get(row.projectId):undefined;
  if(row.projectId&&!project)continue;
  const canAct=followupAccess(s,m,row,true);
  actions.push({id:row.id,source:'followup',projectId:row.projectId||'',customerId:row.customerId||'',...labels(row.customerId,project),title:row.nextAction||row.title,dueDate:row.followUpDate||'',status:row.status,stage:'followup',canAct,unavailableReason:canAct?'':'当前仅可查看，请核对项目状态和客户授权。'});
 }
 const responsible=projects.flatMap(project=>{
  const roles:PersonalResponsibleProject['roles']=[];
  if(project.salesMemberId===m.id)roles.push('sales');
  if(projectServiceMemberIds(project).includes(m.id))roles.push('service');
  return roles.length?[{id:project.id,customerId:project.customerId,title:project.title,code:project.code||'',customerLabel:labels(project.customerId).customerLabel,status:project.status,dueDate:project.dueDate||'',roles}]:[];
 });
 const byDate=(a:{dueDate:string;id:string},b:{dueDate:string;id:string})=>(a.dueDate||'9999').localeCompare(b.dueDate||'9999')||a.id.localeCompare(b.id);
 return {actions:actions.sort(byDate),projects:responsible.sort(byDate)};
}
