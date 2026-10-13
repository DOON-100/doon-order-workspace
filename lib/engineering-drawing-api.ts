import {z} from 'zod';
import {all,clean,newId,now,type CustomerAccount,type Entity,type Member,type State} from './domain';
import {AppError,audit,commit,json} from './store';
import {sha} from './workbooks';
import {assignedDrawingCustomer,assertDrawingLifecycle,buildImportedDrawings,canApproveDrawings,canCreateDrawings,canEditDrawingRequest,canManageDrawings,canReadDrawing,createDrawing,drawingCustomers,drawingDefaultFields,drawingExecutionFields,drawingFieldsSchema,drawingRequestFields,drawingRevision,drawingSaveSchema,publicDrawing,type DrawingEvent,type EngineeringDrawing} from './engineering-drawings';

function parse<T extends z.ZodTypeAny>(schema:T,value:unknown):z.output<T>{const r=schema.safeParse(value);if(!r.success)throw new AppError(r.error.issues.slice(0,4).map(i=>`${i.path.join('.')||'内容'}：${i.message}`).join('；'));return r.data;}
const id=z.string().trim().min(1).max(800),version=z.number().int().positive();
const text=(max=3000)=>z.string().trim().max(max).default('');
function stable(value:unknown):unknown{if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,stable(v)]));return value;}
async function fingerprint(value:unknown){return sha(JSON.stringify(stable(value)));}
function readable(s:State,m:Member,id:string):EngineeringDrawing{const r=all(s,'engineering_drawing').find(r=>r.id===id) as EngineeringDrawing|undefined;if(!r||!canReadDrawing(s,m,r))throw new AppError('画图需求不存在或不在你的客户权限范围内。',403);return r;}
function current(r:EngineeringDrawing,v:number|undefined){if(r.version!==v)throw new AppError('这条画图需求已被更新，请刷新核对后再保存；本次没有覆盖。',409);}
function lifecycle(r:EngineeringDrawing){try{assertDrawingLifecycle(r);}catch(e){throw new AppError((e as Error).message);}}
function account(s:State,m:Member,customerId:string){const c=all(s,'customer_account').find(c=>c.id===customerId) as CustomerAccount|undefined;if(!c?.active)throw new AppError('请选择有效客户责任档案。');if(!canManageDrawings(m)&&!assignedDrawingCustomer(m,c))throw new AppError('只能提交明确绑定给本人的客户需求。',403);return c;}
function assignee(s:State,r:EngineeringDrawing){if(!r.assigneeId)return;const a=all(s,'member').find(a=>a.id===r.assigneeId) as Member|undefined;if(!a||!canManageDrawings(a))throw new AppError('画图人员必须是有效工程画图成员。');if(!r.assignee)r.assignee=a.name;}
function pending(s:State,r:EngineeringDrawing){return all(s,'engineering_drawing_event').some(e=>e.recordId===r.id&&e.status==='pending');}
function advance(r:EngineeringDrawing,m:Member){return {...r,version:r.version+1,updatedAt:now(),updatedBy:m.name};}
function changed(a:unknown,b:unknown){return JSON.stringify(a)!==JSON.stringify(b);}
async function persist(s:State,m:Member,r:EngineeringDrawing,before:EngineeringDrawing|null,action:string,extra:Entity[]=[]){await commit(s.revision,[r,drawingRevision(r,m,action),audit(m,r,before,action,'工程画图工作台'),...extra]);return json({ok:true,record:publicDrawing(s,m,r),item:publicDrawing(s,m,r)});}

export async function engineeringDrawingGet(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['drawing-data','drawing-history'].includes(action))return null;
 if(action==='drawing-data'){
  const records=(all(s,'engineering_drawing') as EngineeringDrawing[]).filter(r=>canReadDrawing(s,m,r)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)),ids=new Set(records.map(r=>r.id));
  return json({records:records.map(r=>publicDrawing(s,m,r)),customers:drawingCustomers(s,m).map(c=>({id:c.id,customer:c.customer,customerCode:c.customerCode,active:c.active})),
   members:(all(s,'member') as Member[]).filter(a=>canManageDrawings(a)||canApproveDrawings(a)).map(a=>({id:a.id,name:a.name,active:a.active,canManage:canManageDrawings(a),canApprove:canApproveDrawings(a)})),
   events:all(s,'engineering_drawing_event').filter(e=>ids.has(e.recordId)&&e.customerId===records.find(r=>r.id===e.recordId)?.customerId),
   details:all(s,'engineering_drawing_detail').filter(e=>ids.has(e.recordId)&&e.customerId===records.find(r=>r.id===e.recordId)?.customerId),
   canCreate:canCreateDrawings(s,m),canManage:canManageDrawings(m),canApprove:canApproveDrawings(m)});
 }
 const record=readable(s,m,new URL(req.url).searchParams.get('id')||'');
 return json({history:all(s,'engineering_drawing_revision').filter(r=>r.recordId===record.id&&r.snapshot&&canReadDrawing(s,m,r.snapshot)).sort((a,b)=>b.version-a.version),
  events:all(s,'engineering_drawing_event').filter(e=>e.recordId===record.id&&e.customerId===record.customerId),details:all(s,'engineering_drawing_detail').filter(e=>e.recordId===record.id&&e.customerId===record.customerId)});
}

export async function engineeringDrawingPost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['drawing-save','drawing-review','drawing-event-review','drawing-detail-add','drawing-email-intake','drawing-import'].includes(action))return null;
 if(action==='drawing-email-intake')return emailIntake(s,m,await req.json());
 if(action==='drawing-import'){
  if(m.role!=='admin')throw new AppError('只有管理员可导入历史工程表。',403);
  let built:ReturnType<typeof buildImportedDrawings>;try{built=buildImportedDrawings(await req.json(),m);}catch(e){throw new AppError(e instanceof z.ZodError?e.issues.slice(0,3).map(i=>i.message).join('；'):(e as Error).message);}
  const fresh:EngineeringDrawing[]=[];
  for(const r of built.records){if(r.customerId)account(s,m,r.customerId);const existing=s.records.find(e=>e.id===r.id);if(existing){if(existing.kind!=='engineering_drawing'||existing.source?.hash!==r.source.hash||existing.source?.sheet!==r.source.sheet||existing.source?.row!==r.source.row||JSON.stringify(stable(existing.source?.rawColumns))!==JSON.stringify(stable(r.source.rawColumns)))throw new AppError('历史来源标识或原始单元格内容冲突。',409);}else fresh.push(r);}
  if(fresh.length){const ids=new Set(fresh.map(r=>r.id));await commit(s.revision,[...fresh,...built.revisions.filter(r=>ids.has(r.recordId)),...fresh.map(r=>audit(m,r,null,'导入工程画图原表','历史迁移'))]);}
  return json({ok:true,imported:fresh.length,skipped:built.records.length-fresh.length});
 }
 if(action==='drawing-save')return save(s,m,await req.json());
 if(action==='drawing-review'){
  if(!canApproveDrawings(m))throw new AppError('仅明确分配审图权限的成员或管理员可以审批。',403);
  const input=parse(z.object({id,version,approval:z.enum(['通过','退回']),note:z.string().trim().min(1).max(6000)}).strict(),await req.json()),before=readable(s,m,input.id);current(before,input.version);
  if(before.status!=='待审核')throw new AppError('工程须先填写完成信息并送审，才能审批。');
  if(pending(s,before))throw new AppError('邮件变更尚未核对，不能审批。',409);
  const r=advance(before,m);r.approval=input.approval;r.approvalNote=input.note;r.approvalBy=m.id;r.approvalAt=now();r.status=input.approval==='通过'?'已完成':'画图中';r.legacyNeedsReview=false;lifecycle(r);
  return persist(s,m,r,before,'工程审图'+input.approval);
 }
 if(action==='drawing-event-review'){
  if(!canManageDrawings(m))throw new AppError('只有工程成员或管理员可核对邮件变更。',403);
  const input=parse(z.object({eventId:id,recordId:id,version,decision:z.enum(['accepted','rejected']),note:z.string().trim().min(1).max(6000)}).strict(),await req.json());
  const before=readable(s,m,input.recordId);current(before,input.version);const event=all(s,'engineering_drawing_event').find(e=>e.id===input.eventId&&e.recordId===before.id);
  if(!event)throw new AppError('邮件事件不存在。',404);if(event.status!=='pending')throw new AppError('邮件变更已核对，请刷新。',409);
  const r=advance(before,m),updated={...event,status:input.decision,reviewNote:input.note,reviewedBy:m.id,reviewedAt:now()};
  if(input.decision==='accepted'){
   if(r.status==='已取消')throw new AppError('已取消需求不能采纳变更，请先由工程明确恢复或建立新需求。',409);
   r.approval='待审核';r.approvalBy='';r.approvalAt='';r.approvalNote='';r.status='画图中';r.deliveredDate='';r.deliveryNote='';
  }
  // Acceptance is a recorded decision. Any business-field changes are explicit, separate human edits.
  const decision={id:newId('drawing_event_decision'),kind:'engineering_drawing_event_decision',recordId:r.id,customerId:r.customerId,eventId:event.id,decision:input.decision,note:input.note,actorId:m.id,createdAt:now()};
  return persist(s,m,r,before,'核对邮件变更（'+(input.decision==='accepted'?'已采纳':'未采纳')+'）',[updated,decision]);
 }
 const input=parse(z.object({recordId:id,version,modelNo:text(3000),requirement:z.string().trim().min(1).max(12000),note:text(6000)}).strict(),await req.json()),before=readable(s,m,input.recordId);current(before,input.version);
 if(!canEditDrawingRequest(s,m,before))throw new AppError('没有追加画图明细权限。',403);
 if(['已完成','已交接','已取消'].includes(before.status))throw new AppError('已完成或关闭的需求应建立新的改图需求，不能追加未处理明细。');
 const detail={id:newId('drawing_detail'),kind:'engineering_drawing_detail',recordId:before.id,customerId:before.customerId,modelNo:input.modelNo,requirement:input.requirement,note:input.note,actorId:m.id,actor:m.name,createdAt:now()};
 const r=advance(before,m);if(r.approval==='通过'){r.approval='待审核';r.status='待审核';r.approvalAt='';r.approvalBy='';r.approvalNote='';}
 return persist(s,m,r,before,'追加画图需求明细',[detail]);
}

async function save(s:State,m:Member,body:unknown){
 const input=parse(drawingSaveSchema,body),{id:recordId,version:expected,token,...patch}=input,before=recordId?readable(s,m,recordId):null;
 if(before)current(before,expected);else if(!canCreateDrawings(s,m))throw new AppError('没有新建画图需求权限。',403);
 if(before&&!canManageDrawings(m)&&!canEditDrawingRequest(s,m,before))throw new AppError('没有当前画图需求的修改权限，请使用对应的审图操作。',403);
 if(!before&&!token)throw new AppError('新建需求须提供操作标识，请刷新后重试。');
 if(!before&&expected!==undefined)throw new AppError('新建需求不能指定历史版本。');
 const fields=parse(drawingFieldsSchema,{...drawingDefaultFields(),...(before?Object.fromEntries(Object.keys(drawingDefaultFields()).map(k=>[k,before[k]])):{}),...patch});
 const mutationKey=!before?`drawing_create_${await fingerprint({actorId:m.id,token})}`:'',digest=!before?await fingerprint(patch):'';
 if(!before){const prior=s.records.find(e=>e.id===mutationKey);if(prior){if(prior.fingerprint!==digest)throw new AppError('操作标识已用于不同需求，请重新核对。',409);const record=readable(s,m,prior.recordId);return json({ok:true,idempotent:true,record:publicDrawing(s,m,record),item:publicDrawing(s,m,record)});}}
 const defaults=drawingDefaultFields(),comparison=before||defaults;
 for(const key of Object.keys(patch)){
  if(!changed(fields[key as keyof typeof fields],comparison[key as keyof typeof comparison]))continue;
  if(key==='approval')throw new AppError('审批结果只能通过独立审图操作更新。',403);
  if((drawingExecutionFields as readonly string[]).includes(key)&&!canManageDrawings(m))throw new AppError('画图执行字段由工程部门维护。',403);
  if((drawingRequestFields as readonly string[]).includes(key)&&before&&!canEditDrawingRequest(s,m,before))throw new AppError('当前状态或客户范围不允许修改需求信息。',403);
 }
 if(!before&&fields.status!=='待分配')throw new AppError('新需求从待分配开始，接单后再更新进度。');
 if(before&&fields.customerId!==before.customerId&&before.customerId)throw new AppError('已绑定客户的需求不能更换归属，请建立新需求。');
 if(fields.customerId){const c=account(s,m,fields.customerId);if(!fields.customerCode)fields.customerCode=c.customerCode||c.customer;}
 else if(!canManageDrawings(m)||!before?.source||before.source.type!=='excel')throw new AppError('请先在客户责任清单中选择客户。');
 if(!fields.drawingType||!fields.requestedDate||!fields.requester)throw new AppError('请填写画图类型、需求日期与需求者。');
 if(before&&fields.status==='历史待核对'&&before.status!=='历史待核对')throw new AppError('历史待核对仅用于原表迁移。');
 const r:EngineeringDrawing=before?{...advance(before,m),...fields}:createDrawing(fields,m);
 const assigneeChanged=!before||fields.assigneeId!==before.assigneeId||fields.assignee!==before.assignee;
 if(assigneeChanged)assignee(s,r);
 const approvalSensitive=['drawingType','newCount','revisionCount','requirement','modelNo','drawingNotes','assigneeId','assignee','completedDate'];
 if(before?.approval==='通过'&&approvalSensitive.some(k=>changed(r[k],before[k]))){r.approval='待审核';r.approvalAt='';r.approvalBy='';r.approvalNote='';if(['已完成','已交接'].includes(r.status))r.status='待审核';r.deliveredDate='';r.deliveryNote='';}
 if(r.status==='已交接'&&pending(s,r))throw new AppError('邮件变更尚未核对，不能交接。',409);
 if(r.status!=='历史待核对'){
  // Unchanged historical completions remain evidence; any execution change enters the current workflow.
  const executionChanged=!before||drawingExecutionFields.some(k=>changed(r[k],before[k]));
  if(!r.legacyNeedsReview||executionChanged)lifecycle(r);
  if(executionChanged)r.legacyNeedsReview=false;
 }
 const extra:Entity[]=mutationKey?[{id:mutationKey,kind:'engineering_drawing_mutation',recordId:r.id,actorId:m.id,fingerprint:digest,createdAt:now()}]:[];
 return persist(s,m,r,before,before?'更新工程画图跟进':'新建画图需求',extra);
}

const emailRequestSchema=drawingFieldsSchema.pick({customerId:true,customerCode:true,drawingType:true,requestedDate:true,newCount:true,revisionCount:true,requester:true,upstreamDepartment:true,priority:true,requirement:true}).strict();
const emailSchema=z.object({messageId:z.string().trim().min(1).max(800),itemKey:z.string().trim().min(1).max(160),threadId:text(800),sender:z.string().trim().email().max(320),subject:text(1000),receivedAt:z.string().datetime({offset:true}),recordId:z.string().trim().max(800).optional(),request:emailRequestSchema}).strict();
async function emailIntake(s:State,m:Member,body:unknown){
 if(!canManageDrawings(m))throw new AppError('邮箱接入只允许已登录的工程授权账号或管理员；此接口不是公开 webhook。',403);
 const input=parse(emailSchema,body),eventId=`drawing_event_${await fingerprint({messageId:input.messageId,itemKey:input.itemKey})}`,digest=await fingerprint(input),prior=all(s,'engineering_drawing_event').find(e=>e.id===eventId);
 if(prior){if(prior.fingerprint!==digest)throw new AppError('相同邮件及明细标识已记录不同内容，请人工核对，禁止覆盖。',409);const record=readable(s,m,prior.recordId);return json({ok:true,idempotent:true,record:publicDrawing(s,m,record),event:prior});}
 let before:EngineeringDrawing|null=null,r:EngineeringDrawing;
 if(input.recordId){before=readable(s,m,input.recordId);if(input.request.customerId!==before.customerId)throw new AppError('邮件变更的客户与关联需求不一致。');r=advance(before,m);}
 else{const c=account(s,m,input.request.customerId);if(!input.request.drawingType||!input.request.requestedDate||!input.request.requester)throw new AppError('邮件缺少画图类型、需求日期或需求者，请先人工补充。');
  r=createDrawing(drawingFieldsSchema.parse({...input.request,customerCode:input.request.customerCode||c.customerCode||c.customer}),m,{type:'email',messageId:input.messageId,itemKey:input.itemKey,threadId:input.threadId});
 }
 const event:DrawingEvent={id:eventId,kind:'engineering_drawing_event',recordId:r.id,customerId:r.customerId,messageId:input.messageId,itemKey:input.itemKey,threadId:input.threadId,sender:input.sender,subject:input.subject,receivedAt:input.receivedAt,request:input.request,fingerprint:digest,status:before?'pending':'created',reviewNote:'',actorId:m.id,createdAt:now()};
 await commit(s.revision,[r,drawingRevision(r,m,before?'收取邮件变更（待核对）':'邮件新画图需求'),event,audit(m,r,before,before?'收取邮件变更（待核对）':'邮件新画图需求','授权邮箱接入')]);
 return json({ok:true,record:publicDrawing(s,m,r),event});
}
