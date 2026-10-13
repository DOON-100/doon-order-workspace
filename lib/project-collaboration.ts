import {all,type Entity,type Member,type State} from './domain';
import {projectAccess,projectServiceMemberIds,type CustomerProject} from './customer-projects';

// Confirmed collaboration policy: assignment grants access to this task only.
// Existing project/customer permissions and the old two-stage task review stay separate.
export const collaborationTaskKind='customer_project_collaboration_task' as const;
export const collaborationStepKeys=['directory','overview','communication','drawings','quotes','samples','finance','documents','orders','after-sales'] as const;
export const collaborationDepartments=['sales','service','pmc','purchasing','engineering','factory','finance','other'] as const;
export const collaborationTaskStatuses=['open','in_progress','blocked','done','cancelled'] as const;
export const collaborationStepLabels:Record<typeof collaborationStepKeys[number],string>={directory:'项目资料目录',overview:'需求与款色',communication:'沟通与待办',drawings:'图纸与客批',quotes:'报价版本',samples:'样办与寄样',finance:'费用与收款',documents:'PI / CI 单据',orders:'大货交接','after-sales':'售后与额外费用'};
export type ProjectCollaborationChange={field:string;before:string;after:string};
export type ProjectCollaborationEvent={id:string;actorId:string;actorName:string;at:string;action:'create'|'save'|'assign'|'followup'|'complete'|'cancel'|'acknowledge'|'transfer';comment:string;changes?:ProjectCollaborationChange[]};
export type ProjectCollaborationTask=Entity&{
 kind:typeof collaborationTaskKind;version:number;projectId:string;customerId:string;roundId:string;
 stepKey:typeof collaborationStepKeys[number];department:typeof collaborationDepartments[number];ownerId:string;
 title:string;description:string;dueDate:string;status:typeof collaborationTaskStatuses[number];result:string;history:ProjectCollaborationEvent[];
 createdById:string;createdBy:string;createdAt:string;updatedBy:string;updatedAt:string;
 completedBy:string;completedAt:string;acknowledgedBy:string;acknowledgedAt:string;
};
export type ProjectCollaborationPermissions={canAssign:boolean;canReply:boolean;canComplete:boolean;canAcknowledge:boolean;canOpenProject:boolean};
export type ProjectCollaborationTaskDto=ProjectCollaborationTask&ProjectCollaborationPermissions&{projectTitle:string;projectCode:string;customerLabel:string;ownerName:string;stepLabel:string;roundTitle:string};
export type ProjectCollaborationFeed={tasks:ProjectCollaborationTaskDto[];members:Pick<Member,'id'|'name'|'role'>[];canAssign:boolean};

export function collaborationTaskOpen(task:{status?:unknown}):boolean{return ['open','in_progress','blocked'].includes(String(task.status));}
export function eligibleCollaborationOwner(member:Member|undefined|null):member is Member{return !!member&&member.active&&member.role!=='supplier';}
export function collaborationTaskProject(s:State,task:Pick<ProjectCollaborationTask,'projectId'|'customerId'>):CustomerProject|undefined{
 return all(s,'customer_project').find(p=>p.id===task.projectId&&p.customerId===task.customerId) as CustomerProject|undefined;
}
export function collaborationProjectWritable(s:State,project:CustomerProject):boolean{
 return !project.trashedAt&&project.status==='active'&&all(s,'customer_account').some(c=>c.id===project.customerId&&c.active);
}
export function canAssignProjectCollaboration(s:State,member:Member,project:CustomerProject):boolean{
 return eligibleCollaborationOwner(member)&&collaborationProjectWritable(s,project)&&projectAccess(s,member,project.customerId).write&&(member.role==='admin'||project.salesMemberId===member.id||projectServiceMemberIds(project).includes(member.id));
}
export function canReadProjectCollaboration(s:State,member:Member,task:ProjectCollaborationTask):boolean{
 if(!eligibleCollaborationOwner(member))return false;
 const project=collaborationTaskProject(s,task);
 return !!project&&(task.ownerId===member.id||projectAccess(s,member,project.customerId).read);
}
export function projectCollaborationPermissions(s:State,member:Member,task:ProjectCollaborationTask):ProjectCollaborationPermissions{
 const project=collaborationTaskProject(s,task),writable=!!project&&eligibleCollaborationOwner(member)&&collaborationProjectWritable(s,project),manager=!!project&&canAssignProjectCollaboration(s,member,project),open=collaborationTaskOpen(task),owner=task.ownerId===member.id;
 return {canAssign:manager&&open,canReply:writable&&open&&(owner||manager),canComplete:writable&&open&&owner,canAcknowledge:manager&&task.status==='done'&&!task.acknowledgedAt,canOpenProject:!!project&&!project.trashedAt&&eligibleCollaborationOwner(member)&&projectAccess(s,member,project.customerId).read};
}

const historyFields=new Set(['roundId','stepKey','department','ownerId','title','description','dueDate','status']);
/** Explicit projection also applies to mutation/replay responses. Never return unknown record fields. */
export function projectCollaborationTaskDto(s:State,member:Member,task:ProjectCollaborationTask):ProjectCollaborationTaskDto{
 const project=collaborationTaskProject(s,task),customer=project&&all(s,'customer_account').find(c=>c.id===project.customerId),owner=all(s,'member').find(m=>m.id===task.ownerId);
 const history=(Array.isArray(task.history)?task.history:[]).map(event=>({id:event.id,actorId:event.actorId,actorName:event.actorName,at:event.at,action:event.action,comment:event.comment,...(Array.isArray(event.changes)?{changes:event.changes.filter(change=>historyFields.has(change.field)).map(change=>({field:change.field,before:change.before,after:change.after}))}:{})}));
 return {id:task.id,kind:collaborationTaskKind,version:task.version,projectId:task.projectId,customerId:task.customerId,roundId:task.roundId||'',roundTitle:task.roundId?all(s,'customer_project_round').find(r=>r.id===task.roundId&&r.projectId===task.projectId&&r.customerId===task.customerId)?.title||'待核查轮次':'项目级（不指定轮次）',stepKey:task.stepKey,department:task.department,ownerId:task.ownerId,title:task.title,description:task.description,dueDate:task.dueDate,status:task.status,result:task.result,history,createdById:task.createdById,createdBy:task.createdBy,createdAt:task.createdAt,updatedBy:task.updatedBy,updatedAt:task.updatedAt,completedBy:task.completedBy||'',completedAt:task.completedAt||'',acknowledgedBy:task.acknowledgedBy||'',acknowledgedAt:task.acknowledgedAt||'',projectTitle:project?.title||'',projectCode:project?.code||'',customerLabel:customer?.customer||'',ownerName:owner?.name||'',stepLabel:collaborationStepLabels[task.stepKey]||'',...projectCollaborationPermissions(s,member,task)};
}
