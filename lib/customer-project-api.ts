import {z} from 'zod';
import {all,canRead,clean,newId,now,strictDate,type CustomerAccount,type Entity,type Member,type Order,type State} from './domain';
import {AppError,audit,bucket,commit,json} from './store';
import {sha} from './workbooks';
import {serviceOrderCustomerKeys} from './service-workspace';
import {canReadCustomerQuote,customerQuoteVersion,type CustomerQuote} from './customer-quotes';
import {currentStage,warehouse} from './ledger';
import {projectAccess,requireProject,projectRound,canReadProject,internalSampleAccess,remainingRoundScope,projectServiceMemberIds,canManageProjectAssignments,canManageProjectTasks,projectTaskPermissions,projectKey,assertProjectNotTrashed,type CustomerProject,type CustomerProjectTask,type CustomerProjectTaskReviewEvent,type CustomerProjectRound,type ProjectScope,type CustomerProjectSample} from './customer-projects';
import {customerProjectAssignmentRosterId,customerProjectAssignmentRoster,projectTaskAssignmentCandidates,projectTaskParticipantsInScope} from './customer-project-assignment';
import {officialProjectHandovers} from './customer-projects';
import {saveCustomerProjectEntry} from './customer-project-entries';

const id=z.string().trim().min(1).max(160),text=(n=2000)=>z.string().trim().max(n).default(''),ids=z.array(id).max(300).refine(v=>new Set(v).size===v.length,'编号不能重复').default([]),token=z.string().uuid();
const day=text(10).refine(v=>{try{return !v||/^\d{4}-\d{2}-\d{2}$/.test(v)&&strictDate(v)===v;}catch{return false;}},'日期须为有效YYYY-MM-DD');
const qty=z.number().int().positive().max(10_000_000),scope=z.array(z.object({itemId:id,quantity:qty}).strict()).min(1).max(300).refine(v=>new Set(v.map(x=>x.itemId)).size===v.length,'款色范围不可重复');
const mutation={id:id.optional(),version:z.number().int().positive().optional(),token:token.optional()};
const append={token,projectId:id,roundId:text(160)};
export const customerProjectSchemas={
 trash:z.object({id,version:z.number().int().positive(),token,reason:z.string().trim().min(1).max(2000)}).strict(),
 restore:z.object({id,version:z.number().int().positive(),token}).strict(),
 'assignment-roster-save':z.object({...mutation,token,serviceFollowerIds:ids.removeDefault(),salesReviewerIds:ids.removeDefault()}).strict(),
 'team-save':z.object({...mutation,name:id,leaderIds:ids,salesMemberIds:ids,serviceMemberIds:ids,customerIds:ids,active:z.boolean().default(true)}).strict(),
 save:z.object({...mutation,customerId:id,code:text(120),title:id,description:text(10000),teamId:text(160),salesMemberId:text(160),serviceMemberId:text(160).optional(),serviceMemberIds:ids.optional(),serviceReviewerId:text(160).optional(),salesReviewerId:text(160).optional(),dueDate:day,status:z.enum(['active','paused','cancelled','archived']).default('active'),development:z.object({stage:z.enum(['待核实','需求了解','可行性','报价','打样','样品反馈','商务确认','暂缓','关闭']),next:z.string().trim().max(300),notes:z.string().max(12000)}).strict().optional()}).strict(),
 'item-save':z.object({...mutation,projectId:id,model:id,customerModel:text(160),drawing:text(160),color:text(160),lens:text(160),material:text(160),requirements:text(6000),quantity:qty}).strict(),
 'round-save':z.object({...mutation,projectId:id,title:id,type:z.enum(['development','revision','sales_sample','preproduction','bulk']),parentRoundId:text(160),scope,stage:text(160),requiredDrawingTypes:z.array(z.enum(['2d','3d'])).max(2).default(['2d']),requireQuote:z.boolean().default(true),requiredSampleIds:ids,sampleGateStage:z.enum(['order','before_production','not_required']).default('order'),sampleGateNote:text(2000),dueDate:day,reason:text(3000),status:z.enum(['open','cancelled']).optional()}).strict(),
 communication:z.object({...append,channel:text(120),contact:text(240),occurredAt:day,content:z.string().trim().min(1).max(10000),nextAction:text(2000),ownerId:text(160),dueDate:day,visibility:z.enum(['internal','customer']).default('internal'),attachmentIds:ids}).strict(),
 'task-save':z.object({...mutation,projectId:id,roundId:text(160),title:id,description:text(6000),ownerId:id,serviceReviewerId:text(160).optional(),salesReviewerId:text(160).optional(),waitingFor:text(240),dueDate:day,status:z.enum(['open','cancelled']).default('open'),result:text(3000),changeReason:text(3000)}).strict(),
 'task-submit':z.object({token,projectId:id,id,version:z.number().int().positive(),result:z.string().trim().min(1).max(3000)}).strict(),
 'task-review':z.object({token,projectId:id,id,version:z.number().int().positive(),stage:z.enum(['service','sales']),decision:z.enum(['approve','return']),comment:text(3000)}).strict(),
 drawing:z.object({...append,roundId:id,itemIds:ids,type:z.enum(['customer','2d','3d','artwork','packing']),drawingNo:id,revision:id,previousId:text(160),pairedDrawingId:text(160),attachmentIds:ids,changeNote:text(3000)}).strict(),
 'drawing-withdraw':z.object({id,version:z.number().int().positive(),reason:z.string().trim().min(3).max(2000)}).strict(),
 confirmation:z.object({...append,roundId:id,drawingId:id,itemIds:ids,decision:z.enum(['approved','conditional','rejected']),contact:id,date:day,evidence:z.string().trim().min(3).max(3000),conditions:text(3000),attachmentIds:ids}).strict(),
 'quote-link':z.object({...append,roundId:id,itemIds:ids,quoteId:id,quoteVersion:z.number().int().positive(),lineIds:ids,acceptedBy:id,acceptedDate:day,evidence:z.string().trim().min(3).max(3000)}).strict(),
 'sample-release':z.object({...append,roundId:id,roundVersion:z.number().int().positive(),purpose:z.enum(['development','revision','color','sales_sample','preproduction']),scope,drawingIds:ids,quoteLinkId:text(160),ownerId:id,requiredDate:day,note:text(3000)}).strict(),
 'sample-update':z.object({id,version:z.number().int().positive(),status:z.enum(['pending','accepted','making','qc','ready','closed','cancelled']),plannedDate:day,note:text(3000)}).strict(),
 'sample-promise':z.object({id,version:z.number().int().positive(),promisedDate:day,promiseNote:z.string().trim().min(3).max(3000)}).strict(),
 'sample-dispatch':z.object({token,projectId:id,sampleId:id,lines:scope,carrier:id,trackingNo:id,recipient:id,address:text(3000),shipDate:day,receivedDate:day,note:text(3000),attachmentIds:ids}).strict(),
 'dispatch-receive':z.object({id,version:z.number().int().positive(),receivedDate:day}).strict(),
 'sample-feedback':z.object({token,projectId:id,sampleId:id,itemId:id,decision:z.enum(['approved','conditional','revise','rejected']),contact:id,date:day,evidence:z.string().trim().min(3).max(3000),note:text(3000),attachmentIds:ids}).strict(),
 'bulk-link':z.object({...append,roundId:id,roundVersion:z.number().int().positive(),orderLinks:z.array(z.object({itemId:id,orderId:id,quantity:qty,orderVersion:z.number().int().positive()}).strict()).min(1).max(300),drawingIds:ids,quoteLinkId:text(160)}).strict(),
};
function parse<T extends z.ZodTypeAny>(schema:T,value:unknown):z.output<T>{const p=schema.safeParse(value);if(!p.success)throw new AppError(p.error.issues.slice(0,4).map(e=>`${e.path.join('.')}: ${e.message}`).join('；'));return p.data;}
function fresh(before:Entity,version:number|undefined){if(before.version!==version)throw new AppError('记录已更新，请刷新后重试；旧版本未覆盖。',409);}
function meta(m:Member,before?:Entity){return {version:(before?.version||0)+1,createdAt:before?.createdAt||now(),createdBy:before?.createdBy||m.name,updatedAt:now(),updatedBy:m.name};}
function member(s:State,memberId:string,required=true){if(!memberId&&!required)return;const found=all(s,'member').find(v=>v.id===memberId&&v.active) as Member|undefined;if(!found)throw new AppError('负责人不存在或已停用。');return found;}
function writerOwner(s:State,project:CustomerProject,memberId:string,required=false){const found=member(s,memberId,required);if(found&&!projectAccess(s,found,project.customerId).write)throw new AppError('项目主责须为该客户现有业务或客服责任成员。');}
function ensureOpen(project:CustomerProject){if(project.status!=='active')throw new AppError('项目已暂停、取消或归档，请先重新开启。',409);}
function requireRound(s:State,p:CustomerProject,roundId:string,open=false){const r=projectRound(s,p,roundId);if(open&&['cancelled','transferred'].includes(r.status))throw new AppError('该轮次已取消或全部转单，请新增开发轮次。',409);return r;}
function checkItems(s:State,p:CustomerProject,itemIds:string[],round?:CustomerProjectRound){if(!itemIds.length)throw new AppError('请选择至少一个款色子项。');for(const itemId of itemIds){if(!all(s,'customer_project_item').some(i=>i.id===itemId&&i.projectId===p.id&&i.customerId===p.customerId))throw new AppError('款色子项不属于该客户项目。');if(round&&!round.scope.some(i=>i.itemId===itemId))throw new AppError('款色不属于本轮范围。');}}
function attachments(s:State,p:CustomerProject,attachmentIds:string[]){for(const x of attachmentIds)if(!all(s,'customer_project_attachment').some(a=>a.id===x&&a.projectId===p.id&&a.customerId===p.customerId))throw new AppError('附件不属于当前项目。');}
function scopedRecord(s:State,m:Member,kind:string,recordId:string,write=true){const item=all(s,kind).find(r=>r.id===recordId);if(!item)throw new AppError('记录不存在或无权限。',403);const project=requireProject(s,m,item.projectId,{write});return {item,project};}
function nextState(s:State,updates:Entity[]){const changed=new Set(updates.map(r=>r.id));return {...s,records:[...s.records.filter(r=>!changed.has(r.id)),...updates]};}
function safeRecord(row:Entity){const {fileKey,requestFingerprint,executionSnapshot,...safe}=row;return safe;}
function safeSample(row:Entity){const {paymentSnapshot,quoteLinkId,...safe}=safeRecord(row);return safe;}
function safeTrashedProject(project:CustomerProject){
 const {id,kind,customerId,code,title,teamId,salesMemberId,serviceMemberId,status,version,createdAt,createdBy,updatedAt,updatedBy,trashedAt,trashedBy,trashedById,trashReason}=project;
 return {id,kind,customerId,code,title,teamId,salesMemberId,serviceMemberId,serviceMemberIds:projectServiceMemberIds(project),status,version,createdAt,createdBy,updatedAt,updatedBy,trashedAt,trashedBy,trashedById,trashReason,canWrite:false,canManageAssignments:true,canManageRecycle:true};
}
function quoteVisible(s:State,m:Member,link:Entity){if(!link.quoteId)return true;const quote=all(s,'customer_quote').find(q=>q.id===link.quoteId) as CustomerQuote|undefined;return !!quote&&canReadCustomerQuote(s,m,quote);}
function publicLink(s:State,m:Member,link:Entity){return quoteVisible(s,m,link)?safeRecord(link):{id:link.id,kind:link.kind,projectId:link.projectId,roundId:link.roundId,itemIds:link.itemIds,accepted:true,restricted:true};}
async function replay(s:State,m:Member,action:string,input:any){if(!input.token)return null;const found=all(s,'customer_project_request').find(r=>r.id==='customer_project_request_'+input.token);if(!found)return null;const hash=await sha(JSON.stringify({action,input}));if(found.actorId!==m.id||found.action!==action||found.hash!==hash)throw new AppError('请求编号已用于其他内容，请刷新核对。',409);const result=s.records.find(r=>r.id===found.resultId);if(!result)throw new AppError('原操作结果待核对。',409);if(result.kind==='customer_project_quote_link'&&!quoteVisible(s,m,result))throw new AppError('当前报价授权已变更，不能通过重放历史请求读取。',403);return json({ok:true,item:result.kind==='customer_project_sample'?safeSample(result):safeRecord(result),idempotent:true});}
async function persist(s:State,m:Member,action:string,input:any,item:Entity,before:Entity|null=null,extra:Entity[]=[]){const updates=[item,...extra,audit(m,item,before,'客户项目 · '+action,'客户项目',safeRecord(item))];if(input.token)updates.push({id:'customer_project_request_'+input.token,kind:'customer_project_request',projectId:item.projectId||item.id,customerId:item.customerId||'',action,actorId:m.id,hash:await sha(JSON.stringify({action,input})),resultId:item.id,createdAt:now()});await commit(s.revision,updates);return json({ok:true,item:item.kind==='customer_project_sample'?safeSample(item):safeRecord(item)});}
function newRecord(kind:string,p:CustomerProject,m:Member,input:any){const {token:_,id:__,version:___,...fields}=input;const taskDefaults=kind==='customer_project_task'?{serviceReviewerId:p.serviceReviewerId||'',salesReviewerId:p.salesReviewerId||'',reviewHistory:[],reviewCycle:0}:{};return {...taskDefaults,...fields,id:newId(kind),kind,customerId:p.customerId,projectId:p.id,...meta(m)} as Entity;}
function existingOrNew(s:State,m:Member,kind:string,input:any){if(input.id){const found=all(s,kind).find(i=>i.id===input.id);if(!found)throw new AppError('记录不存在。',404);fresh(found,input.version);return found;}if(!input.token)throw new AppError('新记录需要唯一请求编号。');return null;}
function safeOrders(s:State,m:Member,customers:CustomerAccount[]){const keys=new Set(customers.flatMap(c=>serviceOrderCustomerKeys(s,c).map(projectKey)));return (all(s,'order') as Order[]).filter(o=>keys.has(projectKey(o.customer))&&canRead(m,o)).map(o=>({id:o.id,version:o.version,customer:o.customer,orderNo:o.orderNo,customerPO:o.customerPO,drawing:o.drawing,color:o.color,lens:o.lens,quantity:o.quantity,sourceStatus:o.sourceStatus,workflowStatus:o.workflowStatus,lifecycle:o.lifecycle,stage:currentStage(o),plannedDate:o.plannedDate,promisedDate:o.promiseConfirmed?o.promisedDate:'',requestedDate:o.requestedDate,warehouse:warehouse(o),updatedAt:o.updatedAt}));}

function previewSignatureMatches(contentType:string,header:Uint8Array){
 const matches=(offset:number,bytes:number[])=>bytes.every((value,index)=>header[offset+index]===value);
 if(contentType==='image/png')return matches(0,[137,80,78,71,13,10,26,10]);
 if(contentType==='image/jpeg')return matches(0,[255,216,255]);
 if(contentType==='image/gif')return matches(0,[71,73,70,56,55,97])||matches(0,[71,73,70,56,57,97]);
 if(contentType==='image/webp')return matches(0,[82,73,70,70])&&matches(8,[87,69,66,80]);
 if(contentType==='application/pdf')return matches(0,[37,80,68,70,45])&&[49,50].includes(header[5])&&header[6]===46&&header[7]>=48&&header[7]<=57;
 return false;
}
async function previewStream(body:BodyInit){
 // Inspect only a short header. Return every original chunk, without copying the whole attachment.
 const reader=new Response(body).body!.getReader(),chunks:Uint8Array[]=[],header=new Uint8Array(12);let length=0,ended=false;
 try{while(length<header.length){const next=await reader.read();if(next.done){ended=true;break;}chunks.push(next.value);const count=Math.min(next.value.length,header.length-length);header.set(next.value.subarray(0,count),length);length+=count;}}
 catch(error){try{await reader.cancel(error);}finally{reader.releaseLock();}throw error;}
 let index=0;
 const stream=new ReadableStream<Uint8Array>({async pull(controller){
  if(index<chunks.length){controller.enqueue(chunks[index++]);return;}
  if(ended){reader.releaseLock();controller.close();return;}
  try{const next=await reader.read();if(next.done){ended=true;reader.releaseLock();controller.close();}else controller.enqueue(next.value);}catch(error){reader.releaseLock();controller.error(error);}
 },async cancel(reason){try{await reader.cancel(reason);}finally{reader.releaseLock();}}});
 return {header:header.subarray(0,length),stream};
}

export async function customerProjectGet(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['customer-project-data','customer-project-file','customer-project-history'].includes(action))return null;
 if(!m.active)throw new AppError('账号已停用。',403);
 if(action==='customer-project-file'){
  const params=new URL(req.url).searchParams,attachment=all(s,'customer_project_attachment').find(r=>r.id===params.get('id'));if(!attachment)throw new AppError('附件不存在。',404);
  const samples=all(s,'customer_project_sample').filter(sample=>internalSampleAccess(s,m,sample));
  const technical=samples.some(sample=>all(s,'customer_project_drawing').some(d=>sample.drawingIds.includes(d.id)&&d.attachmentIds.includes(attachment.id)));
  if(!canReadProject(s,m,attachment)&&!technical)throw new AppError('无权读取当前项目附件。',403);
  const preview=params.get('preview')==='1',previewType=attachment.contentType;
  if(preview&&(!['general',undefined].includes(attachment.category)||!['image/png','image/jpeg','image/gif','image/webp','application/pdf'].includes(previewType)))throw new AppError('此文件不支持在线预览，请使用下载按钮查看原件。',415);
  const object=await bucket().get(attachment.fileKey);if(!object)throw new AppError('原附件暂不可用，请核对存储。',404);
  if(preview){
   const {header,stream}=await previewStream(object.body);
   if(!previewSignatureMatches(previewType,header)){await stream.cancel();throw new AppError('文件内容与预览格式不符，请使用下载按钮查看原件。',415);}
   // The native PDF viewer cannot run in a CSP sandbox. Restrict it to same-origin frames instead.
   const policy="default-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
   const headers={'Content-Type':previewType,'Content-Disposition':`inline; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'SAMEORIGIN','Cross-Origin-Resource-Policy':'same-origin','Referrer-Policy':'no-referrer','Content-Security-Policy':previewType==='application/pdf'?policy:policy+'; sandbox'};
   if(req.method==='HEAD'){await stream.cancel();return new Response(null,{headers});}
   return new Response(stream,{headers});
  }
  return new Response(object.body,{headers:{'Content-Type':attachment.category==='original-communication'?'application/octet-stream':attachment.contentType,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}});
 }
 if(action==='customer-project-history'){
  const project=requireProject(s,m,new URL(req.url).searchParams.get('projectId')||'');
  return json({history:all(s,'audit').filter(a=>(a.after?.projectId===project.id||a.after?.id===project.id)&&String(a.after?.kind||'').startsWith('customer_project')&&a.after.kind!=='customer_project_request').filter(a=>a.after.kind!=='customer_project_quote_link'||quoteVisible(s,m,a.after)).map(a=>({id:a.id,action:a.action,actor:a.actor,createdAt:a.createdAt,targetId:a.targetId,before:a.before?safeRecord(a.before):null,after:safeRecord(a.after)})).reverse()});
 }
 // These caches belong only to this data response's immutable snapshot. File,
 // history and subsequent requests perform their own current permission checks.
 const members=all(s,'member') as Member[],accessByMember=new Map<string,Map<string,ReturnType<typeof projectAccess>>>();
 const access=(assigned:Member,customerId:string)=>{let byCustomer=accessByMember.get(assigned.id);if(!byCustomer){byCustomer=new Map();accessByMember.set(assigned.id,byCustomer);}let result=byCustomer.get(customerId);if(!result){result=projectAccess(s,assigned,customerId);byCustomer.set(customerId,result);}return result;};
 const assignmentRoster=customerProjectAssignmentRoster(s),assignableByCustomer=new Map<string,string[]>();
 const assignableMembers=(customerId:string)=>{let ids=assignableByCustomer.get(customerId);if(!ids){ids=members.filter(assigned=>access(assigned,customerId).write).map(assigned=>assigned.id);assignableByCustomer.set(customerId,ids);}return ids;};
 const customers=(all(s,'customer_account') as CustomerAccount[]).filter(c=>access(m,c.id).read),customerIds=new Set(customers.map(c=>c.id));
 const allProjects=all(s,'customer_project') as CustomerProject[],liveProjectIds=new Set(allProjects.filter(p=>!p.trashedAt).map(p=>p.id));
 const trashedProjects=allProjects.filter(p=>!!p.trashedAt&&customerIds.has(p.customerId)&&canManageProjectAssignments(s,m,p)).map(safeTrashedProject);
 const projects=allProjects.filter(p=>!p.trashedAt&&customerIds.has(p.customerId)).map(p=>({...p,...projectTaskAssignmentCandidates(s,p,assignmentRoster,assignableMembers(p.customerId))})),projectIds=new Set(projects.map(p=>p.id));
 const projectById=new Map(projects.map(p=>[p.id,p as CustomerProject]));
 const rows=(kind:string)=>all(s,kind).filter(r=>projectIds.has(r.projectId)&&customerIds.has(r.customerId));
 const ownedSamples=all(s,'customer_project_sample').filter(r=>liveProjectIds.has(r.projectId)&&internalSampleAccess(s,m,r)),samples=all(s,'customer_project_sample').filter(r=>projectIds.has(r.projectId)||ownedSamples.some(x=>x.id===r.id));
 const technicalIds=new Set(ownedSamples.flatMap(x=>x.drawingIds)),drawings=all(s,'customer_project_drawing').filter(r=>liveProjectIds.has(r.projectId)&&(projectIds.has(r.projectId)||technicalIds.has(r.id)));
 const technicalFiles=new Set(drawings.filter(d=>technicalIds.has(d.id)).flatMap(d=>d.attachmentIds));
 const teams=all(s,'customer_project_team').filter(t=>m.role==='admin'||t.customerIds.some((c:string)=>customerIds.has(c))).map(t=>({...t,customerIds:t.customerIds.filter((c:string)=>m.role==='admin'||customerIds.has(c))}));
 const quotes=(all(s,'customer_quote') as CustomerQuote[]).filter(q=>customerIds.has(q.customerAccountId||'')&&canReadCustomerQuote(s,m,q)).flatMap(q=>{const versions=all(s,'customer_quote_revision').filter(r=>r.quoteId===q.id&&r.snapshot?.status==='confirmed').map(r=>r.snapshot);return versions.filter(v=>v.customerAccountId===q.customerAccountId).map(v=>({id:v.id,version:v.version,quoteNo:v.quoteNo,customerId:v.customerAccountId,status:v.status,lines:v.lines.map((l:any)=>({id:l.id,model:l.model}))}));});
 return json({collaborationTasks:rows('customer_project_collaboration_task').map(t=>({id:t.id,projectId:t.projectId,customerId:t.customerId,roundId:t.roundId,title:t.title,ownerId:t.ownerId,dueDate:t.dueDate,status:t.status,stepKey:t.stepKey,department:t.department})),customers:customers.map(c=>({id:c.id,customer:c.customer,customerCode:c.customerCode,salesName:c.salesName,serviceName:c.serviceName,active:c.active,assignableMemberIds:assignableMembers(c.id)})),teams,trashedProjects,projects:projects.map(p=>({...p,serviceMemberIds:projectServiceMemberIds(p as CustomerProject),canWrite:access(m,p.customerId).write,canManageTasks:canManageProjectTasks(s,m,p as CustomerProject),canManageAssignments:canManageProjectAssignments(s,m,p as CustomerProject),assignableMemberIds:assignableMembers(p.customerId)})),items:rows('customer_project_item'),rounds:rows('customer_project_round').map(r=>({...r,remainingScope:remainingRoundScope(s,r as CustomerProjectRound)})),communications:rows('customer_project_communication'),tasks:rows('customer_project_task').map(task=>({...task,reviewHistory:Array.isArray(task.reviewHistory)?task.reviewHistory:[],reviewCycle:task.reviewCycle||0,...projectTaskPermissions(s,m,projectById.get(task.projectId)!,task as CustomerProjectTask)})),drawings,confirmations:rows('customer_project_confirmation'),quoteLinks:rows('customer_project_quote_link').map(q=>publicLink(s,m,q)),samples:samples.map(sample=>({...safeSample(sample),canExecute:internalSampleAccess(s,m,sample),canCommunicate:projectIds.has(sample.projectId)&&access(m,sample.customerId).write})),dispatches:rows('customer_project_dispatch'),feedback:rows('customer_project_feedback'),handovers:rows('customer_project_handover').map(h=>{const {paymentSnapshot,...safe}=safeRecord(h);return safe;}),attachments:all(s,'customer_project_attachment').filter(a=>projectIds.has(a.projectId)||technicalFiles.has(a.id)).map(safeRecord),orders:safeOrders(s,m,customers),quotes,members:members.filter(x=>x.active&&x.role!=='supplier').map(x=>({id:x.id,name:x.name,role:x.role})),canManageTeams:m.role==='admin',canWrite:customers.some(c=>access(m,c.id).write),canExecute:ownedSamples.length>0});
}

export async function customerProjectPost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!action.startsWith('customer-project-'))return null;const name=action.slice('customer-project-'.length);
 if(name==='entry-save')return saveCustomerProjectEntry(req,s,m);
 if(name==='attachment')return upload(req,s,m);
 if(!(name in customerProjectSchemas))return null;
 if(!m.active)throw new AppError('账号已停用。',403);
 const input:any=parse(customerProjectSchemas[name as keyof typeof customerProjectSchemas],await req.json());
 if(name==='trash'||name==='restore'){
  // Recycling neither changes workflow status nor bypasses current customer/management authorization.
  const before=requireProject(s,m,input.id);
  if(!canManageProjectAssignments(s,m,before))throw new AppError('仅当前客户范围内的项目业务负责人、所属小组组长或管理员可移入回收站或恢复项目。',403);
  const repeated=await replay(s,m,action,input);if(repeated)return repeated;
  fresh(before,input.version);
  if(name==='trash'&&before.trashedAt)throw new AppError('项目已在回收站，请刷新列表。',409);
  if(name==='restore'&&!before.trashedAt)throw new AppError('项目已恢复，请刷新列表。',409);
  if(name==='trash'){
   if(all(s,'customer_project_collaboration_task').some(task=>task.projectId===before.id&&!['done','cancelled'].includes(task.status)))throw new AppError('项目还有未完成的跨部门待办，请先完成或取消待办后再移入回收站。',409);
   const handovers=officialProjectHandovers(s).filter(h=>h.projectId===before.id),sampleIds=new Set(handovers.map(h=>h.sampleId).filter(Boolean));
   if(all(s,'customer_project_sample').some(sample=>sample.projectId===before.id&&sampleIds.has(sample.id)&&!['closed','cancelled'].includes(sample.status)))throw new AppError('已有正式下达且未关闭的内部样办，请先完成或取消样办后再移入回收站。',409);
   const orderIds=new Set(handovers.flatMap(h=>h.orderLinks||[]).map(link=>link.orderId));
   if([...orderIds].some(orderId=>{const order=all(s,'order').find(row=>row.id===orderId);return !order||order.lifecycle!=='archived'&&order.workflowStatus!=='已完成';}))throw new AppError('已有未完成的正式大货交接订单，请先完成关联订单后再移入回收站。',409);
   const {projectFinanceOpenReasons}=await import('./customer-project-finance'),reasons=projectFinanceOpenReasons(s,before.id);
   if(reasons.length)throw new AppError('项目还有未结财务事项，暂不能移入回收站：'+reasons.join('；'),409);
  }
  const item:CustomerProject={...before,...meta(m,before)};
  if(name==='trash')Object.assign(item,{trashedAt:now(),trashedBy:m.name,trashedById:m.id,trashReason:input.reason});
  else{delete item.trashedAt;delete item.trashedBy;delete item.trashedById;delete item.trashReason;}
  return persist(s,m,action,input,item,before);
 }
 if(name==='assignment-roster-save'){
  if(m.role!=='admin')throw new AppError('仅管理员可维护项目跟进与审核人员名单。',403);
  if(input.id&&input.id!==customerProjectAssignmentRosterId)throw new AppError('项目人员名单使用固定记录编号。');
  for(const assignedId of [...input.serviceFollowerIds,...input.salesReviewerIds])member(s,assignedId);
  const rows=all(s,'customer_project_assignment_roster');
  if(rows.length>1||rows.some(row=>row.id!==customerProjectAssignmentRosterId)||s.records.some(row=>row.id===customerProjectAssignmentRosterId&&row.kind!=='customer_project_assignment_roster'))throw new AppError('项目人员名单存在重复或异常记录，请先核对配置。',409);
  const repeated=await replay(s,m,action,input);if(repeated)return repeated;
  const before=rows[0]||null;if(before)fresh(before,input.version);else if(input.version!==undefined)throw new AppError('项目人员名单尚未建立，请刷新后重试。',409);
  const item={id:customerProjectAssignmentRosterId,kind:'customer_project_assignment_roster',serviceFollowerIds:input.serviceFollowerIds,salesReviewerIds:input.salesReviewerIds,...meta(m,before||undefined)};
  return persist(s,m,action,input,item,before);
 }
 if(name==='team-save'){
  if(m.role!=='admin')throw new AppError('仅管理员可维护客户业务小组。',403);const repeated=await replay(s,m,action,input);if(repeated)return repeated;const before=existingOrNew(s,m,'customer_project_team',input);
  for(const x of [...input.leaderIds,...input.salesMemberIds,...input.serviceMemberIds])member(s,x);
  for(const customerId of input.customerIds)if(!all(s,'customer_account').some(c=>c.id===customerId&&c.active))throw new AppError('组内客户不存在或已停用。');
  if(all(s,'customer_project_team').some(t=>t.id!==before?.id&&projectKey(t.name)===projectKey(input.name)))throw new AppError('小组名称已存在。',409);
  const {id:_,version:__,token:___,...fields}=input,item={...fields,id:before?.id||newId('customer_project_team'),kind:'customer_project_team',...meta(m,before||undefined)};return persist(s,m,action,input,item,before);
 }
 if(name==='save'){
  if(!projectAccess(s,m,input.customerId).write)throw new AppError('只能建立或维护原客户责任清单中负责的客户项目。',403);
  if(input.id){const existing=requireProject(s,m,input.id);assertProjectNotTrashed(existing);}
  // A create request replay can point to a project that has since been recycled.
  if(input.token){const prior=all(s,'customer_project_request').find(row=>row.id==='customer_project_request_'+input.token);const existing=prior&&all(s,'customer_project').find(row=>row.id===prior.resultId);if(existing){requireProject(s,m,existing.id);assertProjectNotTrashed(existing as CustomerProject);}}
  const repeated=await replay(s,m,action,input);if(repeated)return repeated;const before=existingOrNew(s,m,'customer_project',input) as CustomerProject|null;
  if(before&&input.development!==undefined)throw new AppError('已有项目的开发资料须在项目资料页按独立版本维护，不能由旧主档表单覆盖。',409);
  if(before&&before.customerId!==input.customerId)throw new AppError('项目不能换到另一个客户。');
  if(before?.status==='archived'&&m.role!=='admin')throw new AppError('归档项目仅管理员可重新开启。',403);
  const p=(before||{id:'',customerId:input.customerId}) as CustomerProject;writerOwner(s,p,input.salesMemberId);
  const serviceReviewerId=input.serviceReviewerId??before?.serviceReviewerId??'',salesReviewerId=input.salesReviewerId??before?.salesReviewerId??'';
  if(before&&!canManageProjectAssignments(s,m,before)&&(input.teamId!==before.teamId||input.salesMemberId!==before.salesMemberId||serviceReviewerId!==(before.serviceReviewerId||'')||salesReviewerId!==(before.salesReviewerId||'')))throw new AppError('仅项目业务负责人、所属小组组长或管理员可调整业务主责、小组及默认审核人。',403);
  writerOwner(s,p,serviceReviewerId);writerOwner(s,p,salesReviewerId);
  // Stale single-owner forms may update other fields, but must not silently drop additional staff.
  const priorServices=before?projectServiceMemberIds(before):[];
  if(input.serviceMemberIds===undefined&&priorServices.length>1&&input.serviceMemberId!==undefined&&input.serviceMemberId!==before?.serviceMemberId)throw new AppError('本项目已有多名客服，请刷新页面后在客服多选框中修改。',409);
  const services:string[]=input.serviceMemberIds??(input.serviceMemberId===undefined||before&&input.serviceMemberId===before.serviceMemberId?priorServices:input.serviceMemberId?[input.serviceMemberId]:[]);
  for(const serviceId of services)writerOwner(s,p,serviceId,true);
  const selectedTeam=input.teamId?all(s,'customer_project_team').find(t=>t.id===input.teamId&&t.active&&t.customerIds.includes(input.customerId)):undefined;
  if(input.teamId&&!selectedTeam)throw new AppError('小组不包含当前客户，请先由管理员配置组织归属。');
  if(selectedTeam){
   // Keep historical assignments on an unchanged team; additions and team changes use its current service roster.
   const retainedServices=new Set(before&&before.teamId===input.teamId?priorServices:[]);
   const teamServices=new Set(Array.isArray(selectedTeam.serviceMemberIds)?selectedTeam.serviceMemberIds:[]);
   if(services.some(serviceId=>!retainedServices.has(serviceId)&&!teamServices.has(serviceId)))throw new AppError('客服负责人须为所选业务客服组的客服成员；切换小组时请重新选择客服。');
  }
  if(before&&['archived','cancelled'].includes(input.status)&&all(s,'customer_project_collaboration_task').some(task=>task.projectId===before.id&&!['done','cancelled'].includes(task.status)))throw new AppError('项目还有未完成的跨部门待办，请先完成或取消待办后再关闭项目。',409);
  if(input.status==='archived'){
   if(!before)throw new AppError('新项目不能直接归档。');
   const open=s.records.some(r=>r.projectId===before.id&&((r.kind==='customer_project_round'&&['open','partial'].includes(r.status))||(r.kind==='customer_project_task'&&!['done','cancelled'].includes(r.status))||(r.kind==='customer_project_sample'&&!['closed','cancelled'].includes(r.status))));if(open)throw new AppError('尚有开发轮次、样办或待办未完成，不能归档。');
   // Finance explicitly validates its own customer balances; core must not infer settlement.
   const {projectFinanceOpenReasons}=await import('./customer-project-finance');const reasons=projectFinanceOpenReasons(s,before.id);if(reasons.length)throw new AppError(reasons.join('；'));
   const orders=officialProjectHandovers(s).filter(h=>h.projectId===before.id).flatMap(h=>h.orderLinks||[]).map(l=>all(s,'order').find(o=>o.id===l.orderId));if(orders.some(o=>!o||o.lifecycle!=='archived'&&o.workflowStatus!=='已完成'))throw new AppError('仍有关联大货订单未交付关闭，不能归档。');
  }
  const {id:_,version:__,token:___,development,...fields}=input,item={...fields,serviceMemberIds:services,serviceMemberId:services[0]||'',serviceReviewerId,salesReviewerId,id:before?.id||newId('customer_project'),kind:'customer_project',...meta(m,before||undefined)};
  const extra:Entity[]=[];
  if(development){const record={id:newId('customer_workflow_project'),kind:'customer_workflow_project',customerId:input.customerId,projectId:item.id,version:1,...development,updatedBy:m.name,updatedAt:now()};extra.push(record,audit(m,record,null,'新建前期开发资料','前期开发'));}
  return persist(s,m,action,input,item,before,extra);
 }
 if(['sample-update','sample-promise'].includes(name))return updateSample(s,m,action,input,name);
 if(name==='drawing-withdraw'){
  const {item:before,project}=scopedRecord(s,m,'customer_project_drawing',input.id);fresh(before,input.version);const item={...before,status:'withdrawn',withdrawReason:input.reason,...meta(m,before)};
  const impacted=officialProjectHandovers(s).filter(h=>h.projectId===project.id&&h.drawingIds.includes(before.id));
  const extra=impacted.map(h=>newRecord('customer_project_task',project,m,{roundId:h.roundId,title:'已下达资料撤回，请核对停工或改版',description:input.reason,ownerId:project.serviceMemberId||project.salesMemberId||m.id,waitingFor:'内部评估',dueDate:'',status:'open',result:'',handoverId:h.id}));return persist(s,m,action,input,item,before,extra);
 }
 if(name==='dispatch-receive'){
  const {item:before}=scopedRecord(s,m,'customer_project_dispatch',input.id);fresh(before,input.version);if(!input.receivedDate||input.receivedDate<before.shipDate)throw new AppError('签收日期不得早于寄出日期。');return persist(s,m,action,input,{...before,receivedDate:input.receivedDate,...meta(m,before)},before);
 }
 const project=requireProject(s,m,input.projectId,{write:true});ensureOpen(project);
 if(['task-save','task-submit','task-review'].includes(name))return taskAction(s,m,project,action,name,input);
 const repeated=await replay(s,m,action,input);if(repeated)return repeated;
 if(name==='item-save'){
  const before=existingOrNew(s,m,'customer_project_item',input);if(before&&before.projectId!==project.id)throw new AppError('款色不属于当前项目。');
  if(before&&officialProjectHandovers(s).some(h=>h.projectId===project.id&&h.scope.some((l:ProjectScope)=>l.itemId===before.id)))throw new AppError('款色已用于下单，请保留原资料并新增款色或改版轮次。',409);
  const item={...newRecord('customer_project_item',project,m,input),id:before?.id||newId('customer_project_item'),...meta(m,before||undefined)};return persist(s,m,action,input,item,before);
 }
 if(name==='round-save'){
  const before=existingOrNew(s,m,'customer_project_round',input);if(before&&before.projectId!==project.id)throw new AppError('轮次不属于当前项目。');
  if(before&&officialProjectHandovers(s).some(h=>h.roundId===before.id))throw new AppError('已有转单的轮次不可重写，请新增变更轮次。',409);
  checkItems(s,project,input.scope.map((v:ProjectScope)=>v.itemId));
  if(input.parentRoundId){requireRound(s,project,input.parentRoundId);if(before?.id===input.parentRoundId)throw new AppError('上一轮不能是自身。');}
  if(input.type==='revision'&&(!input.parentRoundId||!input.reason))throw new AppError('修改轮次须关联上一轮并填写修改原因。');
  for(const sampleId of input.requiredSampleIds)if(!all(s,'customer_project_sample').some(sample=>sample.id===sampleId&&sample.projectId===project.id&&sample.status!=='cancelled'))throw new AppError('必需客批样办不属于当前项目或已取消。');
  if(input.sampleGateStage==='before_production'&&!input.sampleGateNote)throw new AppError('请明确产前样卡哪个内部节点。');
  const item={...newRecord('customer_project_round',project,m,input),id:before?.id||newId('customer_project_round'),status:input.status||'open',...meta(m,before||undefined)};return persist(s,m,action,input,item,before);
 }
 if(name==='communication'){
  if(input.roundId)requireRound(s,project,input.roundId);member(s,input.ownerId,false);attachments(s,project,input.attachmentIds);if(!input.occurredAt)throw new AppError('请填写沟通发生日期。');
  if(input.nextAction)writerOwner(s,project,input.ownerId||m.id,true);
  const item=newRecord('customer_project_communication',project,m,input),extra=input.nextAction?[newRecord('customer_project_task',project,m,{roundId:input.roundId,title:input.nextAction,description:'由沟通记录生成',ownerId:input.ownerId||m.id,waitingFor:'',dueDate:input.dueDate,status:'open',result:'',communicationId:item.id})]:[];return persist(s,m,action,input,item,null,extra);
 }
 if(['sample-dispatch','sample-feedback'].includes(name))return sampleCustomerEvent(s,m,project,action,name,input);
 const round=requireRound(s,project,input.roundId,['drawing','quote-link','sample-release','bulk-link'].includes(name));
 if(name==='drawing'){
  checkItems(s,project,input.itemIds,round);attachments(s,project,input.attachmentIds);if(!input.attachmentIds.length)throw new AppError('请先上传图纸原文件或预览文件。');
  for(const relatedId of [input.previousId,input.pairedDrawingId].filter(Boolean)){const d=all(s,'customer_project_drawing').find(d=>d.id===relatedId&&d.projectId===project.id);if(!d)throw new AppError('上一版或配套图纸不属于该项目。');}
  if(all(s,'customer_project_drawing').some(d=>d.projectId===project.id&&d.type===input.type&&d.drawingNo===input.drawingNo&&d.revision===input.revision))throw new AppError('该图号与版本已存在，请新建版本而不是覆盖。',409);
  return persist(s,m,action,input,{...newRecord('customer_project_drawing',project,m,input),status:'submitted'});
 }
 if(name==='confirmation'){
  const drawing=all(s,'customer_project_drawing').find(d=>d.id===input.drawingId&&d.projectId===project.id&&d.status!=='withdrawn');if(!drawing)throw new AppError('图纸不存在或已撤回。');checkItems(s,project,input.itemIds,round);if(input.itemIds.some((x:string)=>!drawing.itemIds.includes(x)))throw new AppError('确认范围超出图纸适用款色。');attachments(s,project,input.attachmentIds);if(!input.date||input.decision==='conditional'&&!input.conditions)throw new AppError('填写确认日期及有条件通过的具体条件。');
  const item=newRecord('customer_project_confirmation',project,m,input),extra=input.decision==='approved'?[]:officialProjectHandovers(s).filter(h=>h.projectId===project.id&&h.drawingIds.includes(drawing.id)).map(h=>newRecord('customer_project_task',project,m,{roundId:h.roundId,title:'已下达图纸客户确认有变，请评估内部执行',description:input.conditions||input.evidence,ownerId:project.serviceMemberId||project.salesMemberId||m.id,waitingFor:'内部评估',dueDate:'',status:'open',result:'',handoverId:h.id}));return persist(s,m,action,input,item,null,extra);
 }
 if(name==='quote-link'){
  checkItems(s,project,input.itemIds,round);const quote=customerQuoteVersion(s,m,input.quoteId,input.quoteVersion);if(!quote||quote.status!=='confirmed'||quote.customerAccountId!==project.customerId)throw new AppError('请关联本客户有权限读取的已确认报价版本。',403);
  if(!input.lineIds.length||input.lineIds.some((x:string)=>!quote.lines.some(l=>l.id===x)))throw new AppError('报价行不属于选定版本。');if(!input.acceptedDate)throw new AppError('请记录客户接受日期。');return persist(s,m,action,input,{...newRecord('customer_project_quote_link',project,m,input),quoteNo:quote.quoteNo});
 }
 if(name==='sample-release'||name==='bulk-link')return release(s,m,project,round,action,name,input);
 throw new AppError('不支持的客户项目操作。');
}

function taskEvent(m:Member,task:CustomerProjectTask,action:CustomerProjectTaskReviewEvent['action'],stage:CustomerProjectTaskReviewEvent['stage'],comment:string,cycle=task.reviewCycle||0):CustomerProjectTaskReviewEvent{
 return {id:newId('customer_project_task_event'),action,stage,actorId:m.id,actorName:m.name,at:now(),comment,cycle};
}
function taskHistory(task:CustomerProjectTask){return Array.isArray(task.reviewHistory)?task.reviewHistory:[];}
function validateTaskAssignments(s:State,p:CustomerProject,task:CustomerProjectTask){
 if(!task.serviceReviewerId||!task.salesReviewerId)throw new AppError('请先由项目业务负责人、小组组长或管理员配置客服审核人与业务审核人。');
 for(const assignedId of [task.ownerId,task.serviceReviewerId,task.salesReviewerId])writerOwner(s,p,assignedId,true);
 if([task.serviceReviewerId,task.salesReviewerId].includes(task.ownerId))throw new AppError('跟进人不能审核自己提交的事项，请另选审核人。');
}
function validateTaskRosterAssignments(s:State,p:CustomerProject,task:Pick<CustomerProjectTask,'ownerId'|'serviceReviewerId'|'salesReviewerId'>,before?:CustomerProjectTask){
 const changed={owner:!before||task.ownerId!==before.ownerId,service:!before||(task.serviceReviewerId||'')!==(before.serviceReviewerId||''),sales:!before||(task.salesReviewerId||'')!==(before.salesReviewerId||'')};
 if(!changed.owner&&!changed.service&&!changed.sales)return;
 const roster=customerProjectAssignmentRoster(s);if(!roster.configured)return;
 if(!roster.valid)throw new AppError('项目跟进与审核人员名单配置无效，请由管理员核对。',409);
 const writable=(all(s,'member') as Member[]).filter(assigned=>projectAccess(s,assigned,p.customerId).write).map(assigned=>assigned.id);
 const candidates=projectTaskAssignmentCandidates(s,p,roster,writable);
 if(changed.owner&&!candidates.taskOwnerMemberIds.includes(task.ownerId))throw new AppError('客服跟进人须为当前客户负责组内已授权的客服名单成员，请重新选择。',403);
 if(changed.service&&!candidates.taskServiceReviewerMemberIds.includes(task.serviceReviewerId||''))throw new AppError('客服审核人须属于当前客户负责组并已获客户权限，请重新指派。',403);
 if(changed.sales&&!candidates.taskSalesReviewerMemberIds.includes(task.salesReviewerId||''))throw new AppError('业务审核人须为当前客户负责组内已授权的业务审核名单成员，请重新指派。',403);
}
async function taskAction(s:State,m:Member,p:CustomerProject,action:string,name:string,input:any){
 const before=input.id?all(s,'customer_project_task').find(task=>task.id===input.id) as CustomerProjectTask|undefined:undefined;
 if(input.id&&(!before||before.projectId!==p.id||before.customerId!==p.customerId))throw new AppError('待办不存在或不属于当前项目。',403);
 // Current actor and customer authorization always precede idempotent replay; admins do not substitute for a reviewer.
 if(name==='task-save'){
  if(!canManageProjectTasks(s,m,p))throw new AppError('仅项目业务负责人、所属小组组长或管理员可指派或调整待办。',403);
  // Cancellation and unchanged historical assignees preserve their original configuration.
  if(!(before&&input.status==='cancelled'))validateTaskRosterAssignments(s,p,{ownerId:input.ownerId,serviceReviewerId:input.serviceReviewerId??before?.serviceReviewerId??p.serviceReviewerId??'',salesReviewerId:input.salesReviewerId??before?.salesReviewerId??p.salesReviewerId??''},before);
 }else if(name==='task-submit'){
  if(!before||before.ownerId!==m.id)throw new AppError('仅本事项指定跟进人可提交完成结果。',403);
 }else{
  const reviewerId=input.stage==='service'?before?.serviceReviewerId:before?.salesReviewerId;
  if(!before||reviewerId!==m.id||before.ownerId===m.id)throw new AppError('仅本阶段指定审核人可审核，跟进人不能审核自己的事项。',403);
 }
 if(name!=='task-save'&&before&&customerProjectAssignmentRoster(s).configured){
  validateTaskAssignments(s,p,before);
  if(!projectTaskParticipantsInScope(s,p,[before.ownerId,before.serviceReviewerId||'',before.salesReviewerId||'']))throw new AppError('跟进或审核人员已不属于当前客户负责组，或人员名单配置无效。请由项目业务负责人重新指派后继续；原记录保留。',403);
 }
 const repeated=await replay(s,m,action,input);if(repeated)return repeated;
 if(before)fresh(before,input.version);else if(!input.token)throw new AppError('新记录需要唯一请求编号。');
 if(name==='task-save'){
  if(before&&['done','cancelled'].includes(before.status))throw new AppError('已完成或已取消事项保留原始记录，请另建跟进事项。',409);
  if(!before&&input.status!=='open')throw new AppError('新跟进事项须从待跟进开始。');
  if(input.roundId)requireRound(s,p,input.roundId);
  if(before&&['service_review','sales_review'].includes(before.status)&&!input.changeReason)throw new AppError('审核中的事项如需调整或取消，请填写变更原因；调整后须重新提交审核。');
  if(before&&input.status==='cancelled')return persist(s,m,action,input,{...before,status:'cancelled',reviewHistory:[...taskHistory(before),taskEvent(m,before,'cancel','configuration',input.changeReason||'管理人员取消事项。')],...meta(m,before)},before);
  const {result:_,changeReason:__,...configuration}=input;
  const item={...before,...newRecord('customer_project_task',p,m,configuration),id:before?.id||newId('customer_project_task'),serviceReviewerId:input.serviceReviewerId??before?.serviceReviewerId??p.serviceReviewerId??'',salesReviewerId:input.salesReviewerId??before?.salesReviewerId??p.salesReviewerId??'',result:before?.result||'',reviewCycle:before?.reviewCycle||0,reviewHistory:before?taskHistory(before):[],...meta(m,before)} as CustomerProjectTask;
  validateTaskAssignments(s,p,item);
  if(before)item.reviewHistory=[...taskHistory(before),taskEvent(m,before,'reconfigure','configuration',input.changeReason||'管理人员调整事项，重新等待跟进提交。')];
  return persist(s,m,action,input,item,before||null);
 }
 if(name==='task-submit'){
  if(!before||!['open','returned'].includes(before.status))throw new AppError('仅待跟进或退回修改事项可提交，请刷新当前状态。',409);
  validateTaskAssignments(s,p,before);
  const cycle=(before.reviewCycle||0)+1,item={...before,status:'service_review',result:input.result,reviewCycle:cycle,reviewHistory:[...taskHistory(before),taskEvent(m,before,'submit','followup',input.result,cycle)],...meta(m,before)};
  return persist(s,m,action,input,item,before);
 }
 const expected=input.stage==='service'?'service_review':'sales_review';
 if(!before||before.status!==expected)throw new AppError('事项尚未到本审核阶段或已被处理，请刷新当前状态。',409);
 validateTaskAssignments(s,p,before);
 if(input.decision==='return'&&!input.comment)throw new AppError('退回修改须填写具体审核意见。');
 const item={...before,status:input.decision==='return'?'returned':input.stage==='service'?'sales_review':'done',reviewHistory:[...taskHistory(before),taskEvent(m,before,input.decision,input.stage,input.comment)],...meta(m,before)};
 return persist(s,m,action,input,item,before);
}

async function upload(req:Request,s:State,m:Member){
 const form=await req.formData(),project=requireProject(s,m,String(form.get('projectId')||''));if(!projectAccess(s,m,project.customerId).write)throw new AppError('没有当前客户项目的修改权限。',403);
 assertProjectNotTrashed(project);
 const category=parse(z.enum(['general','original-communication']).default('general'),form.get('category')??undefined),original=category==='original-communication',roundId=String(form.get('roundId')||'');
 if(original&&roundId)throw new AppError('原始沟通文档保存在项目级，请不要关联开发轮次。');if(roundId)requireRound(s,project,roundId);
 const file=form.get('file');if(!(file instanceof File)||file.size<=0||file.size>50*1024*1024)throw new AppError('请选择非空且不超过 50 MiB 的项目资料。');
 const allowed:Record<string,string>={pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',xls:'application/vnd.ms-excel',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',dwg:'application/octet-stream',dxf:'application/octet-stream',step:'application/octet-stream',stp:'application/octet-stream',iges:'application/octet-stream',igs:'application/octet-stream',stl:'application/octet-stream',eml:'message/rfc822'};
 const ext=file.name.split('.').at(-1)?.toLowerCase()||'';if(!original&&!Object.prototype.hasOwnProperty.call(allowed,ext))throw new AppError('不支持此附件格式；支持工程图纸、图片、PDF、办公文件及邮件EML。');
 const note=parse(text(3000),String(form.get('note')||'')),safeName=Array.from(file.name.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g,'_')).slice(0,240).join('').replace(/[. ]+$/g,''),filename=(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safeName)?'_'+safeName:safeName)||(original?'未命名原始文档':'未命名资料'),bytes=await file.arrayBuffer(),hash=await sha(bytes);
 const prior=all(s,'customer_project_attachment').find(a=>a.projectId===project.id&&a.customerId===project.customerId&&a.roundId===roundId&&(a.category||'general')===category&&a.hash===hash&&a.filename===filename&&a.note===note);if(prior)return json({ok:true,item:safeRecord(prior),idempotent:true});
 const item={...newRecord('customer_project_attachment',project,m,{roundId,category,filename,note}),contentType:original?'application/octet-stream':allowed[ext],size:file.size,hash,fileKey:newId('customer_project_file')};await bucket().put(item.fileKey,bytes);return persist(s,m,'attachment',{},item);
}

function checkScope(s:State,p:CustomerProject,r:CustomerProjectRound,lines:ProjectScope[]){checkItems(s,p,lines.map(l=>l.itemId),r);const remaining=new Map(remainingRoundScope(s,r).map(l=>[l.itemId,l.quantity]));for(const l of lines)if(l.quantity>(remaining.get(l.itemId)||0))throw new AppError('本次下单超过该轮款色尚未转单数量。',409);}
function technicalGate(s:State,p:CustomerProject,r:CustomerProjectRound,lines:ProjectScope[],drawingIds:string[],quoteLinkId:string){
 const drawings=drawingIds.map(did=>all(s,'customer_project_drawing').find(d=>d.id===did&&d.projectId===p.id&&d.status!=='withdrawn'));if(drawings.some(d=>!d))throw new AppError('选定图纸不存在或已撤回。');
 for(const line of lines)for(const type of r.requiredDrawingTypes){const applicable=drawings.filter(d=>d?.type===type&&d.itemIds.includes(line.itemId));if(applicable.length!==1)throw new AppError(`款色须选定唯一${type.toUpperCase()}图纸版本。`);const drawing=applicable[0]!;const confirmation=all(s,'customer_project_confirmation').filter(c=>c.drawingId===drawing.id&&c.projectId===p.id&&c.itemIds.includes(line.itemId)).at(-1);if(!confirmation||confirmation.decision!=='approved')throw new AppError('选定图纸版本尚未取得对应款色的无条件确认。');if(type==='3d'&&r.requiredDrawingTypes.includes('2d')&&!drawings.some(d=>!!d&&d.id===drawing.pairedDrawingId&&d.type==='2d'&&d.itemIds.includes(line.itemId)))throw new AppError('3D图纸必须配套本次选定的2D版本。');}
 if(r.requireQuote){const link=all(s,'customer_project_quote_link').find(q=>q.id===quoteLinkId&&q.roundId===r.id&&q.projectId===p.id);if(!link||lines.some(l=>!link.itemIds.includes(l.itemId)))throw new AppError('本轮款色尚未关联准确版本并取得客户接受报价。');const q=all(s,'customer_quote').find(q=>q.id===link.quoteId);if(!q||q.customerAccountId!==p.customerId)throw new AppError('报价客户关系已变更，请重新核对。');}
 if(r.sampleGateStage==='order'&&(r.requiredSampleIds||[]).length){const samples=r.requiredSampleIds!.map(sampleId=>all(s,'customer_project_sample').find(x=>x.id===sampleId&&x.projectId===p.id&&x.status!=='cancelled'));if(samples.some(sample=>!sample))throw new AppError('必需确认的样办不存在或已取消。');for(const line of lines){const applicable=samples.filter(sample=>sample!.scope.some((x:ProjectScope)=>x.itemId===line.itemId));if(!applicable.length)throw new AppError('必需客批样办尚未覆盖本次下单款色。');for(const sample of applicable){const feedback=all(s,'customer_project_feedback').filter(f=>f.sampleId===sample!.id&&f.itemId===line.itemId).at(-1);if(!feedback||feedback.decision!=='approved')throw new AppError('下单前必须确认的样办款色仍未客批。');}}}
}
async function release(s:State,m:Member,p:CustomerProject,r:CustomerProjectRound,action:string,name:string,input:any){
 fresh(r,input.roundVersion);if(name==='bulk-link'&&r.type!=='bulk')throw new AppError('大货转单请建立大货准备轮次。');if(name==='sample-release'&&r.type==='bulk')throw new AppError('大货轮次不能用于样办下单。');
 const lines:ProjectScope[]=name==='sample-release'?input.scope:Object.entries(input.orderLinks.reduce((a:Record<string,number>,l:any)=>{a[l.itemId]=(a[l.itemId]||0)+l.quantity;return a;},{})).map(([itemId,quantity])=>({itemId,quantity:Number(quantity)}));
 checkScope(s,p,r,lines);technicalGate(s,p,r,lines,input.drawingIds,input.quoteLinkId);
 const {paymentGate}=await import('./customer-project-finance');const payment=paymentGate(s,p.id,r.id);if(!payment.allowed)throw new AppError('收款条件未满足：'+payment.missing.join('；'));
 let item:Entity,extra:Entity[]=[];const handover=newRecord('customer_project_handover',p,m,{roundId:r.id,type:name==='sample-release'?'sample':'bulk',scope:lines,drawingIds:input.drawingIds,quoteLinkId:input.quoteLinkId,paymentSnapshot:payment,sampleId:'',orderLinks:[]});
 if(name==='sample-release'){
  const owner=member(s,input.ownerId)!;if(!['admin','pmc','production'].includes(owner.role))throw new AppError('样办内部负责人须为PMC或生产人员。');if(!input.requiredDate)throw new AppError('请填写样办要求日期。');
  const sampleId=newId('customer_project_sample');item={...newRecord('customer_project_sample',p,m,input),id:sampleId,sampleNo:'SP-'+now().slice(0,10).replace(/-/g,'')+'-'+sampleId.slice(-8).toUpperCase(),plannedDate:'',promisedDate:'',promiseNote:'',status:'pending',paymentSnapshot:payment,itemSnapshot:lines.map(l=>({...all(s,'customer_project_item').find(i=>i.id===l.itemId),quantity:l.quantity})),releasedAt:now(),releasedBy:m.name};handover.sampleId=item.id;extra.push(handover);
 }else{
  const account=projectAccess(s,m,p.customerId).customer!,keys=serviceOrderCustomerKeys(s,account).map(projectKey),seen=new Set<string>();
  for(const link of input.orderLinks){if(seen.has(link.orderId))throw new AppError('一次转单不能重复绑定同一订单明细。');seen.add(link.orderId);const order=all(s,'order').find(o=>o.id===link.orderId) as Order|undefined;if(!order||!canRead(m,order)||!keys.includes(projectKey(order.customer)))throw new AppError('正式订单不属于当前客户或不可访问。',403);fresh(order,link.orderVersion);
   if(!order.orderNo||!order.drawing||order.quantity<=0||order.sourceStatus!=='正式订单'||['业务待提交','客服待审核','退回业务补充'].includes(order.workflowStatus||''))throw new AppError('所选订单须经原流程确认来源状态为“正式订单”；草稿、未知来源及取消单不能完成开发交接。');
   const item=all(s,'customer_project_item').find(i=>i.id===link.itemId)!;if(item.drawing&&projectKey(item.drawing)!==projectKey(order.drawing)||item.color&&projectKey(item.color)!==projectKey(order.color)||item.lens&&projectKey(item.lens)!==projectKey(order.lens))throw new AppError('订单图号、颜色或镜片与项目款色不一致，请核对关联。');
   const allocated=officialProjectHandovers(s).flatMap(h=>h.orderLinks||[]).filter(l=>l.orderId===order.id).reduce((sum,l)=>sum+l.quantity,0);if(allocated+link.quantity>order.quantity)throw new AppError('关联数量超过正式订单尚未关联数量。',409);
  }
  item={...handover,orderLinks:input.orderLinks};
  if(r.sampleGateStage==='before_production')extra.push(newRecord('customer_project_task',p,m,{roundId:r.id,title:'产前样放行待核：'+r.sampleGateNote,description:'大货已关联；需内部负责人在约定节点核对产前样。此提醒不自动阻止原PMC操作。',ownerId:p.serviceMemberId||p.salesMemberId||m.id,waitingFor:'PMC/样办负责人',dueDate:r.dueDate,status:'open',result:'',requiredSampleIds:r.requiredSampleIds||[],handoverId:item.id}));
 }
 const after=nextState(s,name==='sample-release'?[handover]:[item]),remaining=remainingRoundScope(after,r),round={...r,status:remaining.length?'partial':'transferred',...meta(m,r)};
 extra.push(round);return persist(s,m,action,input,item,null,extra);
}

async function updateSample(s:State,m:Member,action:string,input:any,name:string){
 const before=all(s,'customer_project_sample').find(x=>x.id===input.id) as CustomerProjectSample|undefined;if(!before)throw new AppError('样办执行单不存在或无权限。',403);fresh(before,input.version);
 if(name==='sample-promise'){requireProject(s,m,before.projectId,{write:true});if(!input.promisedDate)throw new AppError('请填写已核对的对客回复日期。');return persist(s,m,action,input,{...before,promisedDate:input.promisedDate,promiseNote:input.promiseNote,...meta(m,before)},before);}
 if(!internalSampleAccess(s,m,before))throw new AppError('仅所分配的内部样办负责人或管理员可维护样办执行。',403);
 const parent=all(s,'customer_project').find(project=>project.id===before.projectId&&project.customerId===before.customerId) as CustomerProject|undefined;
 if(!parent)throw new AppError('样办所属项目不存在。',409);assertProjectNotTrashed(parent);
 const transitions:Record<string,string[]>={pending:['accepted','cancelled'],accepted:['making','cancelled'],making:['qc','cancelled'],qc:['making','ready','cancelled'],ready:['closed','making','cancelled'],closed:[],cancelled:[]};if(input.status!==before.status&&!transitions[before.status].includes(input.status))throw new AppError('样办状态不能跳过接单、制作或品质核对。');if(['cancelled','making'].includes(input.status)&&input.status!==before.status&&!input.note)throw new AppError('请记录执行或取消依据。');
 const extra:Entity[]=[];if(input.plannedDate!==before.plannedDate){if(!input.note)throw new AppError('变更内部预计日期须记录原因。');const project=all(s,'customer_project').find(p=>p.id===before.projectId) as CustomerProject;extra.push(newRecord('customer_project_task',project,m,{roundId:before.roundId,title:'样办预计完成期已变，请核对对客复期',description:`原计划${before.plannedDate||'未定'} → ${input.plannedDate||'未定'}；${input.note}`,ownerId:project.serviceMemberId||project.salesMemberId||m.id,waitingFor:'客服',dueDate:input.plannedDate,status:'open',result:'',sampleId:before.id}));}
 return persist(s,m,action,input,{...before,status:input.status,plannedDate:input.plannedDate,note:input.note,...meta(m,before)},before,extra);
}
async function sampleCustomerEvent(s:State,m:Member,p:CustomerProject,action:string,name:string,input:any){
 const sample=all(s,'customer_project_sample').find(x=>x.id===input.sampleId&&x.projectId===p.id) as CustomerProjectSample|undefined;if(!sample)throw new AppError('样办单不属于当前项目。');if(sample.status==='cancelled')throw new AppError('已取消样办单不能继续寄样或确认。');attachments(s,p,input.attachmentIds);
 if(name==='sample-dispatch'){
  if(!['ready','closed'].includes(sample.status))throw new AppError('样办须完成品质核对并可寄出后才能登记实寄。');if(!input.shipDate||input.receivedDate&&input.receivedDate<input.shipDate)throw new AppError('请填写正确寄出与签收日期。');
  const previous=all(s,'customer_project_dispatch').filter(d=>d.sampleId===sample.id);for(const line of input.lines){const target=sample.scope.find(l=>l.itemId===line.itemId),shipped=previous.flatMap(d=>d.lines).filter(l=>l.itemId===line.itemId).reduce((sum,l)=>sum+l.quantity,0);if(!target||line.quantity+shipped>target.quantity)throw new AppError('本次实寄数量超过样办款色未寄数量。');}
  const item=newRecord('customer_project_dispatch',p,m,{...input,roundId:sample.roundId}),task=newRecord('customer_project_task',p,m,{roundId:sample.roundId,title:'样办已寄出，跟进签收与逐款反馈',description:input.carrier+' '+input.trackingNo,ownerId:p.serviceMemberId||p.salesMemberId||m.id,waitingFor:'客户',dueDate:'',status:'open',result:'',sampleId:sample.id,dispatchId:item.id});return persist(s,m,action,input,item,null,[task]);
 }
 if(!sample.scope.some(l=>l.itemId===input.itemId)||!input.date)throw new AppError('反馈款色或日期无效。');
 const item=newRecord('customer_project_feedback',p,m,{...input,roundId:sample.roundId}),extra:Entity[]=[];
 if(['revise','rejected','conditional'].includes(input.decision))extra.push(newRecord('customer_project_task',p,m,{roundId:sample.roundId,title:input.decision==='conditional'?'客户有条件通过，核对未完成条件':'客户要求改图改样，建立新轮次',description:input.note||input.evidence,ownerId:p.serviceMemberId||p.salesMemberId||m.id,waitingFor:'客服/工程',dueDate:'',status:'open',result:'',feedbackId:item.id}));
 return persist(s,m,action,input,item,null,extra);
}
