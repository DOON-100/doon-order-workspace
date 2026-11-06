import {all,type Member,type State} from './domain';
import {projectAccess,projectServiceMemberIds,type CustomerProject} from './customer-projects';
import {canAssignProjectCollaboration,eligibleCollaborationOwner} from './project-collaboration';

export type ProjectCollaborationAssignment={preferredOwnerIds:string[];defaultOwnerId:string;defaultDepartment:'service';unavailableReason:string};

/** Recommendations use existing responsibility records; they neither grant access nor create tasks. */
export function projectCollaborationAssignment(s:State,m:Member,project:CustomerProject):ProjectCollaborationAssignment{
 const canAssign=canAssignProjectCollaboration(s,m,project);
 let unavailableReason='';
 if(!canAssign){
  if(!eligibleCollaborationOwner(m))unavailableReason='当前账号不是可用的内部成员，不能指派待办。';
  else if(project.trashedAt)unavailableReason='项目已移入回收站，不能新增或调整待办。';
  else if(project.status!=='active')unavailableReason='项目已暂停、取消或归档，当前仅可查看待办历史。';
  else if(!all(s,'customer_account').some(customer=>customer.id===project.customerId&&customer.active))unavailableReason='所属客户已停用或不可用，不能指派待办。';
  else if(!projectAccess(s,m,project.customerId).write)unavailableReason='当前账号没有此客户的维护权限，不能指派待办。';
  else unavailableReason='仅项目业务主负责人、项目客服负责人或管理员可指派待办。';
 }
 const eligible=new Set((all(s,'member') as Member[]).filter(eligibleCollaborationOwner).map(member=>member.id));
 const preferredOwnerIds=canAssign?[...new Set(projectServiceMemberIds(project))].filter(id=>eligible.has(id)):[];
 return {preferredOwnerIds,defaultOwnerId:preferredOwnerIds.length===1?preferredOwnerIds[0]:'',defaultDepartment:'service',unavailableReason};
}
