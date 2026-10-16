import {createSyntheticState} from './fixtures.mjs';

export const projectIds=Object.freeze({
  actors:Object.freeze({a:'syn-employee-a',b:'syn-employee-b',admin:'syn-admin',clerk:'syn-clerk',viewer:'syn-viewer',finance:'syn-finance',pmc:'syn-pmc',production:'syn-production',programmer:'syn-programmer',disabled:'syn-disabled',supplier:'syn-supplier'}),
  customers:Object.freeze({a:'syn-customer-a',b:'syn-customer-b'}),
  teams:Object.freeze({a:'syn-team-a',b:'syn-team-b',mixed:'syn-team-mixed'}),
  projects:Object.freeze({a:'syn-project-a',b:'syn-project-b',trashed:'syn-project-a-trashed'}),
  tasks:Object.freeze({
    workflowA:'syn-workflow-task-a',workflowAClerk:'syn-workflow-task-a-clerk',workflowB:'syn-workflow-task-b',workflowBAssignedA:'syn-workflow-task-b-assigned-a',
    projectA:'syn-project-task-a',projectB:'syn-project-task-b',projectBAssignedA:'syn-project-task-b-assigned-a',projectTrashed:'syn-project-task-a-trashed',
    collaborationA:'syn-collaboration-task-a',collaborationB:'syn-collaboration-task-b',collaborationBViewer:'syn-collaboration-task-b-viewer',collaborationAFinance:'syn-collaboration-task-a-finance',collaborationBroken:'syn-collaboration-task-invalid-link',
  }),
});

/** Fresh, entirely synthetic CRM/team/task graph. Never imports an application runtime or file. */
export function createProjectSyntheticState() {
  const state=createSyntheticState(),at='2026-10-15T00:00:00.000Z',ids=projectIds;
  const meta={version:1,createdAt:at,updatedAt:at,createdBy:'合成初始化',updatedBy:'合成初始化'};
  const existing=id=>state.records.find(row=>row.id===id);
  const member=(id,name,role,customers=[])=>({
    id,kind:'member',userId:id+'-user',email:id+'@example.invalid',name,role,customers,active:true,
    orderScope:'assigned',departments:[],createdAt:at,privateMarker:'SYNTHETIC_MEMBER_PRIVATE',
  });
  state.records.push(
    member(ids.actors.admin,'合成管理员','admin'),
    member(ids.actors.clerk,'合成客服甲','clerk',['合成客户甲']),
    member(ids.actors.viewer,'合成指派只读成员','viewer'),
    member(ids.actors.finance,'合成财务成员','finance'),
    member(ids.actors.pmc,'合成PMC成员','pmc'),
    member(ids.actors.production,'合成生产成员','production'),
    member(ids.actors.programmer,'合成程序成员','programmer'),
  );
  existing(ids.customers.a).serviceMemberIds=[ids.actors.clerk];
  existing(ids.customers.a).serviceName=existing(ids.actors.clerk).name;
  const team=(id,name,customerIds,owner)=>({id,kind:'customer_project_team',...meta,name,active:true,customerIds,leaderIds:[owner],salesMemberIds:[owner],serviceMemberIds:owner===ids.actors.a?[ids.actors.clerk]:[],internalSecret:'SYNTHETIC_TEAM_PRIVATE'});
  state.records.push(
    team(ids.teams.a,'合成甲组',[ids.customers.a],ids.actors.a),
    team(ids.teams.b,'合成乙组',[ids.customers.b],ids.actors.b),
    team(ids.teams.mixed,'合成交叉客户组',[ids.customers.a,ids.customers.b],ids.actors.a),
  );
  const project=(id,customerId,teamId,salesMemberId,title)=>({
    id,kind:'customer_project',...meta,customerId,teamId,salesMemberId,serviceMemberId:customerId===ids.customers.a?ids.actors.clerk:'',
    serviceMemberIds:customerId===ids.customers.a?[ids.actors.clerk]:[],serviceReviewerId:'',salesReviewerId:'',
    title,code:id.toUpperCase(),description:'合成权限验证项目',dueDate:'2026-10-30',status:'active',internalSecret:'SYNTHETIC_PROJECT_PRIVATE',
  });
  state.records.push(
    project(ids.projects.a,ids.customers.a,ids.teams.a,ids.actors.a,'合成甲项目'),
    project(ids.projects.b,ids.customers.b,ids.teams.b,ids.actors.b,'合成乙项目'),
    {...project(ids.projects.trashed,ids.customers.a,ids.teams.a,ids.actors.a,'合成甲回收项目'),trashedAt:at,trashedBy:'合成管理员',trashedById:ids.actors.admin,trashReason:'合成回收场景'},
  );
  const workflowTask=(id,customerId,ownerId,title)=>({
    id,kind:'customer_workflow_task',...meta,customerId,ownerId,owner:existing(ownerId).name,title,due:'2026-10-30',status:'待接手',
    notes:'合成客户任务',result:'',internalSecret:'SYNTHETIC_TASK_PRIVATE',
  });
  const projectTask=(id,projectId,customerId,ownerId,title)=>({
    id,kind:'customer_project_task',...meta,projectId,customerId,ownerId,title,roundId:'',serviceReviewerId:'',salesReviewerId:'',
    description:'合成旧双审任务，尚未配置审核链',waitingFor:'',dueDate:'2026-10-30',status:'open',result:'',reviewHistory:[],reviewCycle:0,
    internalSecret:'SYNTHETIC_TASK_PRIVATE',
  });
  const collaborationTask=(id,projectId,customerId,ownerId,title)=>({
    id,kind:'customer_project_collaboration_task',...meta,projectId,customerId,ownerId,title,roundId:'',stepKey:'overview',department:'other',
    description:'合成精确指派任务',dueDate:'2026-10-30',status:'open',result:'',history:[],createdById:ids.actors.admin,
    completedBy:'',completedAt:'',acknowledgedBy:'',acknowledgedAt:'',internalSecret:'SYNTHETIC_TASK_PRIVATE',
  });
  state.records.push(
    workflowTask(ids.tasks.workflowA,ids.customers.a,ids.actors.a,'合成甲客户任务'),
    workflowTask(ids.tasks.workflowAClerk,ids.customers.a,ids.actors.clerk,'合成甲客服任务'),
    workflowTask(ids.tasks.workflowB,ids.customers.b,ids.actors.b,'合成乙客户任务'),
    workflowTask(ids.tasks.workflowBAssignedA,ids.customers.b,ids.actors.a,'合成跨客指派不授予客户权限'),
    projectTask(ids.tasks.projectA,ids.projects.a,ids.customers.a,ids.actors.clerk,'合成甲旧双审任务'),
    projectTask(ids.tasks.projectB,ids.projects.b,ids.customers.b,ids.actors.b,'合成乙旧双审任务'),
    projectTask(ids.tasks.projectBAssignedA,ids.projects.b,ids.customers.b,ids.actors.a,'合成跨客旧双审指派'),
    projectTask(ids.tasks.projectTrashed,ids.projects.trashed,ids.customers.a,ids.actors.a,'合成回收项目任务'),
    collaborationTask(ids.tasks.collaborationA,ids.projects.a,ids.customers.a,ids.actors.clerk,'合成甲跨部门任务'),
    collaborationTask(ids.tasks.collaborationB,ids.projects.b,ids.customers.b,ids.actors.b,'合成乙跨部门任务'),
    collaborationTask(ids.tasks.collaborationBViewer,ids.projects.b,ids.customers.b,ids.actors.viewer,'合成只读成员精确指派'),
    collaborationTask(ids.tasks.collaborationAFinance,ids.projects.a,ids.customers.a,ids.actors.finance,'合成财务成员精确指派'),
    collaborationTask(ids.tasks.collaborationBroken,ids.projects.b,ids.customers.a,ids.actors.viewer,'合成错误项目客户关联'),
    {id:'syn-project-attachment-private',kind:'customer_project_attachment',...meta,projectId:ids.projects.b,customerId:ids.customers.b,roundId:'',filename:'synthetic-private.txt',contentType:'text/plain',size:32,hash:'SYNTHETIC_ATTACHMENT_HASH',fileKey:'SYNTHETIC_ATTACHMENT_KEY_PRIVATE',note:'SYNTHETIC_ATTACHMENT_PRIVATE'},
  );
  return state;
}
