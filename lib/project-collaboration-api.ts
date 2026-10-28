import {z} from 'zod';
import {all,newId,now,strictDate,type Entity,type Member,type State} from './domain';
import {AppError,audit,commit,json} from './store';
import {sha} from './workbooks';
import {projectAccess,type CustomerProject} from './customer-projects';
import {collaborationTaskKind,collaborationStepKeys,collaborationDepartments,collaborationTaskOpen,eligibleCollaborationOwner,collaborationTaskProject,collaborationProjectWritable,canAssignProjectCollaboration,canReadProjectCollaboration,projectCollaborationTaskDto,type ProjectCollaborationTask,type ProjectCollaborationEvent,type ProjectCollaborationFeed} from './project-collaboration';

const id=z.string().trim().min(1).max(160),text=(max:number)=>z.string().trim().max(max).default(''),token=z.string().uuid(),version=z.number().int().nonnegative();
const day=text(10).refine(value=>{try{return !value||/^\d{4}-\d{2}-\d{2}$/.test(value)&&strictDate(value)===value;}catch{return false;}},'日期须为有效的YYYY-MM-DD');
const comment=z.string().trim().min(1,'请填写跟进说明或完成结果').max(12000),existing={token,id,version:z.number().int().positive()};
const schemas={
 save:z.object({token,id:id.optional(),version,projectId:id,roundId:text(160),stepKey:z.enum(collaborationStepKeys),department:z.enum(collaborationDepartments),ownerId:id,title:z.string().trim().min(1,'请填写任务名称').max(300),description:text(12000),dueDate:day,reason:text(3000)}).strict(),
 followup:z.object({...existing,comment,status:z.enum(['in_progress','blocked']).optional()}).strict(),
 complete:z.object({...existing,comment}).strict(),
 cancel:z.object({...existing,comment}).strict(),
 acknowledge:z.object({...existing,comment:text(12000)}).strict(),
};
type Action=keyof typeof schemas;
const requestKind='customer_project_collaboration_request';
function requireInternal(member:Member){if(!eligibleCollaborationOwner(member))throw new AppError('当前账号没有内部协作任务权限。',403);}
function findTask(s:State,id:string){return all(s,collaborationTaskKind).find(t=>t.id===id) as ProjectCollaborationTask|undefined;}
function requireProject(s:State,id:string){const project=all(s,'customer_project').find(p=>p.id===id) as CustomerProject|undefined;if(!project)throw new AppError('项目不存在或当前没有权限。',403);return project;}
function writable(s:State,project:CustomerProject){if(!collaborationProjectWritable(s,project))throw new AppError('项目已暂停、取消、归档、移入回收站或客户已停用，当前只可查看任务历史。',409);}
function assertActionAccess(s:State,m:Member,project:CustomerProject,task:ProjectCollaborationTask|undefined,action:Action,input:any){
 const manager=canAssignProjectCollaboration(s,m,project),owner=!!task&&task.ownerId===m.id;
 // Authorize before request-token lookup. State transitions are checked after replay,
 // so an unchanged actor may safely retry a successful completion without writing again.
 if(action==='save'||action==='cancel'||action==='acknowledge'){
  if(!manager)throw new AppError('仅当前客户授权内的项目业务负责人、项目客服或管理员可管理此协作任务。',403);
 }else if(action==='complete'){
  if(!owner)throw new AppError('仅指定负责人本人可完成协作任务。',403);
 }else{
  if(!owner&&!manager)throw new AppError('仅负责人本人或当前项目负责人可回复此任务。',403);
  if(!owner&&input.status!==undefined)throw new AppError('项目负责人回复不能替执行人变更进度状态。',403);
 }
 writable(s,project);
}
function event(m:Member,action:ProjectCollaborationEvent['action'],comment:string,at:string):ProjectCollaborationEvent{return {id:newId('project_collaboration_event'),actorId:m.id,actorName:m.name,at,action,comment};}

export function projectCollaborationGet(action:string,req:Request,s:State,m:Member):Response|null{
 if(action!=='project-collaboration-data')return null;
 requireInternal(m);
 const query=new URL(req.url).searchParams,projectId=query.get('projectId')||'',taskId=query.get('taskId')||'';
 let project:CustomerProject|undefined;
 if(projectId){project=requireProject(s,projectId);if(!projectAccess(s,m,project.customerId).read)throw new AppError('项目不在当前客户授权范围内。',403);}
 let tasks=all(s,collaborationTaskKind) as ProjectCollaborationTask[];
 if(taskId){const task=findTask(s,taskId);if(!task||!canReadProjectCollaboration(s,m,task)||(projectId&&task.projectId!==projectId))throw new AppError('任务不存在或当前没有读取权限。',403);tasks=[task];}
 else if(project)tasks=tasks.filter(task=>task.projectId===project.id&&task.customerId===project.customerId&&canReadProjectCollaboration(s,m,task));
 else tasks=tasks.filter(task=>{const parent=collaborationTaskProject(s,task);return !!parent&&(task.ownerId===m.id||task.status==='done'&&!task.acknowledgedAt&&canAssignProjectCollaboration(s,m,parent));});
 const canAssign=!!project&&canAssignProjectCollaboration(s,m,project);
 const result:ProjectCollaborationFeed={tasks:tasks.map(task=>projectCollaborationTaskDto(s,m,task)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id)),members:canAssign?(all(s,'member') as Member[]).filter(eligibleCollaborationOwner).map(owner=>({id:owner.id,name:owner.name,role:owner.role})):[],canAssign};
 return json({...result,writeContract:'project-collaboration-version-token-v1'});
}

export async function projectCollaborationPost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!action.startsWith('project-collaboration-'))return null;
 const name=action.slice('project-collaboration-'.length) as Action;if(!Object.prototype.hasOwnProperty.call(schemas,name))return null;
 requireInternal(m);
 const parsed=schemas[name].safeParse(await req.json());if(!parsed.success)throw new AppError(parsed.error.issues.slice(0,4).map(issue=>`${issue.path.join('.')}: ${issue.message}`).join('；'));
 const input=parsed.data as any,before=input.id?findTask(s,input.id):undefined;
 if(input.id&&!before)throw new AppError('任务不存在或当前没有维护权限。',403);
 const project=before?collaborationTaskProject(s,before):requireProject(s,input.projectId);
 if(!project)throw new AppError('任务项目关系异常，请管理员核对。',409);
 if(name==='save'&&before&&input.projectId!==before.projectId)throw new AppError('现有任务不能改绑到其他项目。',409);
 assertActionAccess(s,m,project,before,name,input);
 const fingerprint=await sha(JSON.stringify({action,input})),requestId=requestKind+'_'+input.token,previous=s.records.find(row=>row.id===requestId);
 if(previous&&previous.kind!==requestKind)throw new AppError('请求编号已被其他类型记录占用，本次未写入。',409);
 if(previous){
  if(previous.actorId!==m.id||previous.action!==action||previous.fingerprint!==fingerprint)throw new AppError('请求编号已用于其他内容，请核对后重试。',409);
  const current=findTask(s,previous.taskId);
  if(!current||!canReadProjectCollaboration(s,m,current))throw new AppError('原任务结果不存在或当前授权已变更。',403);
  const currentProject=collaborationTaskProject(s,current)!;assertActionAccess(s,m,currentProject,current,name,input);
  return json({ok:true,idempotent:true,item:projectCollaborationTaskDto(s,m,current)});
 }
 if((before?.version||0)!==input.version)throw new AppError('任务已更新，请刷新核对；本次未覆盖旧版本。',409);
 const at=now();let item:ProjectCollaborationTask,entry:ProjectCollaborationEvent;
 if(name==='save'){
  if(before&&!collaborationTaskOpen(before))throw new AppError('已完成或已取消的任务不能改写，请另建任务。',409);
  if(before&&!input.reason)throw new AppError('修改或重新指派任务须填写原因。');
  const owner=all(s,'member').find(member=>member.id===input.ownerId) as Member|undefined;if(!eligibleCollaborationOwner(owner))throw new AppError('请选择在职内部成员，不能指派已停用或供应商账号。',403);
  if(input.roundId&&!all(s,'customer_project_round').some(round=>round.id===input.roundId&&round.projectId===project.id&&round.customerId===project.customerId))throw new AppError('开发轮次不属于当前项目。');
  // A different executor starts pending; previous progress stays in the history.
  const fields={roundId:input.roundId,stepKey:input.stepKey,department:input.department,ownerId:input.ownerId,title:input.title,description:input.description,dueDate:input.dueDate,status:before&&before.ownerId===input.ownerId?before.status:'open' as const};
  entry=event(m,before?(before.ownerId!==input.ownerId?'assign':'save'):'create',input.reason,at);
  if(before)entry.changes=Object.entries(fields).filter(([key,value])=>before[key]!==value).map(([field,value])=>({field,before:String(before[field]??''),after:String(value)}));
  item={...before,...fields,id:before?.id||newId(collaborationTaskKind),kind:collaborationTaskKind,version:(before?.version||0)+1,projectId:project.id,customerId:project.customerId,result:before?.result||'',history:[...(before?.history||[]),entry],createdById:before?.createdById||m.id,createdBy:before?.createdBy||m.name,createdAt:before?.createdAt||at,updatedBy:m.name,updatedAt:at,completedBy:before?.completedBy||'',completedAt:before?.completedAt||'',acknowledgedBy:before?.acknowledgedBy||'',acknowledgedAt:before?.acknowledgedAt||''};
 }else{
  if(!before)throw new AppError('任务不存在。',403);
  if(name==='acknowledge'){
   if(before.status!=='done'||before.acknowledgedAt)throw new AppError('仅未阅的完成反馈可标记已阅。',409);
  }else if(!collaborationTaskOpen(before))throw new AppError('任务已完成或已取消，当前只可查看历史。',409);
  entry=event(m,name,input.comment,at);
  item={...before,version:before.version+1,updatedBy:m.name,updatedAt:at,history:[...(before.history||[]),entry]};
  if(name==='followup'&&input.status)item.status=input.status;
  if(name==='complete')Object.assign(item,{status:'done',result:input.comment,completedBy:m.name,completedAt:at});
  if(name==='cancel')item.status='cancelled';
  if(name==='acknowledge')Object.assign(item,{acknowledgedBy:m.name,acknowledgedAt:at});
 }
 const request:Entity={id:requestId,kind:requestKind,projectId:item.projectId,customerId:item.customerId,taskId:item.id,actorId:m.id,action,fingerprint,createdAt:at};
 await commit(s.revision,[item,audit(m,item,before||null,action,'项目协作任务'),request]);
 return json({ok:true,item:projectCollaborationTaskDto(s,m,item)});
}
