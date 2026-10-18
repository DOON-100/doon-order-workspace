import {randomUUID} from 'node:crypto';
import {Store,RoleRegistry,fingerprint,problem} from './store.mjs';

export class TaskEngine{
 constructor(file,{platform,registry=new RoleRegistry(),now=Date.now,leaseMs=90000,retryMs=300,humanTimeoutMs=60000,followupMs=10000,shadow=false}={}){
  this.store=new Store(file);Object.assign(this,{platform,registry,now,leaseMs,retryMs,humanTimeoutMs,followupMs,shadow});this.busy=false;this.timer=null;this.runAgent=null;
 }
 event(type,data={}){this.store.put('event',{id:randomUUID(),at:this.now(),type,...data});}
 task(id){const task=this.store.get('task',id);if(!task)throw problem('任务不存在',404);return task;}
 case(id){const item=this.store.get('case',id);if(!item)throw problem('事项不存在',404);return item;}
 enqueue({caseId,role,capability,parentId=null,key,trigger='role-task',goal=capability}){
  const existing=this.store.list('task').find(row=>row.key===key);if(existing)return existing;
  if(!this.registry.get(role).capabilities.includes(capability))throw problem('岗位不能处理此类任务',403);
  const task={id:randomUUID(),key,caseId,role,capability,goal,parentId,trigger,state:'queued',attempts:0,createdAt:this.now(),updatedAt:this.now(),retryAt:0,runId:null,leaseUntil:0,decision:null,humanId:null,waitUntil:null,result:null};this.store.put('task',task);this.event('task_created',{taskId:task.id,role,caseId});return task;
 }
 startCase({sourceId,recipient,coordinator=recipient,requestId}){
  if(!recipient||!requestId)throw problem('需要已配置的审核员工与请求标识',400);
  return this.store.transaction(()=>{const source=this.platform.source(sourceId),key='material-risk:'+source.id+':'+(source.fingerprint||source.version),existing=this.store.list('case').find(row=>row.sourceId===sourceId&&row.state==='open'||row.key===key);if(existing)return existing;
   const item={id:randomUUID(),key,sourceId,recipient,coordinator,state:'open',lastSourceFingerprint:source.fingerprint||null,createdAt:this.now(),requestId,shadow:this.shadow};this.store.put('case',item);this.enqueue({caseId:item.id,role:'pmc',capability:'material-risk',key:item.id+':root',trigger:'business-event'});return item;});
 }
 context(id){const task=this.task(id),item=this.case(task.caseId),caseTasks=this.store.list('task').filter(row=>row.caseId===item.id);return{task,item,children:caseTasks.filter(row=>row.parentId===id),caseTasks,humanRequests:this.platform.store.list('human').filter(row=>row.caseId===item.id),coverage:this.platform.coverage||null,events:this.store.list('event').filter(row=>row.caseId===item.id).slice(-12),availableRoles:this.registry.catalog(),observationTime:new Date(this.now()).toISOString(),shadow:this.shadow};}
 facts(id){const context=this.context(id);return{...context,source:this.platform.source(context.item.sourceId),human:context.task.humanId?this.platform.store.get('human',context.task.humanId):null};}
 nextAction(id){
  const {task,source,human,children}=this.facts(id);
  if(task.role==='supervisor'){
   const target=this.task(task.targetTaskId);
   if(task.decision&&task.decision.action!=='approve'||!['waiting_human','waiting_coordination','failed'].includes(target.state))return'holdCoordination';
   if((target.revision||0)>=3)return task.decision?'holdCoordination':'requestCoordination';
   if(task.decision?.action==='approve'&&(!human?.validUntil||human.validUntil>this.now())&&human?.payload.sourceFingerprint===source.fingerprint&&human?.payload.targetRevision===(target.revision||0))return'resumeTask';
   return'requestCoordination';
  }
  if(task.role==='pmc'||task.role==='service')return children.some(child=>child.state==='completed'&&child.result?.fulfilled)&&source.balanceKnown&&source.remaining===0&&!(source.returnPending>0)&&source.eligible!==false?'completeTask':'submitTask';
  if(task.role!=='procurement')throw problem('岗位尚未配置固定执行流程',403);
  if(!task.decision)return'requestHumanReview';
  if(task.decision.action!=='approve')return'escalateTask';
  if(human?.validUntil&&human.validUntil<=this.now())return'requestHumanReview';
  if(source.balanceKnown&&source.remaining===0&&!(source.returnPending>0)&&source.eligible!==false)return'completeTask';
  if(source.version!==task.decision.sourceVersion||task.trigger==='review-expired')return'requestHumanReview';
  return task.trigger==='due-time'?'escalateTask':'waitForTime';
 }
 claim(){return this.store.transaction(()=>{
  const now=this.now();const task=this.store.list('task').find(row=>((row.state==='queued'&&row.retryAt<=now)||(row.state==='running'&&row.leaseUntil<=now))&&(!this.platform.isAuthorised||this.platform.isAuthorised(this.case(row.caseId).sourceId)));if(!task)return null;
  if(task.attempts>=2){task.state='failed';task.runId=null;this.store.put('task',task);this.escalateFailed(task);return null;}
  task.state='running';task.runId=randomUUID();task.leaseUntil=now+this.leaseMs;task.attempts++;task.updatedAt=now;this.store.put('task',task);this.event('run_started',{caseId:task.caseId,taskId:task.id,runId:task.runId,role:task.role,trigger:task.trigger});return task;
 });}
 active(id,runId){const task=this.task(id);if(task.runId!==runId||task.leaseUntil<=this.now())throw problem('执行租约失效，禁止旧执行提交');return task;}
 action(id,runId,name,input,fn){return this.store.transaction(()=>{
  const task=this.active(id,runId),key=id+':'+runId+':'+name,hash=fingerprint(input),saved=this.store.get('receipt',key);
  if(saved){if(saved.hash!==hash)throw problem('同一动作重试的载荷不一致');return saved.result;}
  if(task.state!=='running')throw problem('本轮已经提交下一步，请停止调用动作');
  const result=fn(task);this.store.put('receipt',{id:key,taskId:id,runId,name,hash,result});this.event('tool_succeeded',{taskId:id,caseId:task.caseId,runId,role:task.role,tool:name});return result;
 });}
 submit(id,runId,{targetRole,capability,goal}){return this.action(id,runId,'submitTask',{targetRole,capability,goal},task=>{
  this.registry.route(task.role,targetRole,capability);if(typeof goal!=='string'||!goal.trim())throw problem('缺少任务目标',400);
  const source=this.platform.source(this.case(task.caseId).sourceId),pending=this.store.list('task').find(row=>row.parentId===id&&row.role===targetRole&&row.capability===capability&&row.state!=='completed');
  const child=pending||this.enqueue({caseId:task.caseId,role:targetRole,capability,goal,parentId:id,key:id+':'+targetRole+':'+capability+':'+(source.fingerprint||source.version)+':'+(task.revision||0)});task.state='waiting_child';task.updatedAt=this.now();this.store.put('task',task);return{ok:true,taskId:child.id,state:task.state,businessDispatch:false};
 });}
 reviewRequest(task,input,category='purchase-followup'){const item=this.case(task.caseId);return{taskId:task.id,caseId:item.id,recipient:category==='coordination'?(item.coordinator||item.recipient):item.recipient,sourceId:item.sourceId,taskRevision:task.revision||0,category,deadline:this.now()+this.humanTimeoutMs,...input};}
 requestHuman(id,runId,{reason,proposal},preparedHuman){return this.action(id,runId,'requestHumanReview',{reason,proposal},task=>{
  if(task.role!=='procurement')throw problem('岗位无权发起此类审核',403);const item=this.case(task.caseId);
  if(this.shadow){task.state='waiting_configuration';this.store.put('task',task);return{ok:false,shadow:true,reason:'未启用员工任务映射，本次验证不创建员工待办'};}
  const human=preparedHuman||this.platform.requestReview(this.reviewRequest(task,{reason,proposal}));
  task.state='waiting_human';task.humanId=human.id;task.decision=null;this.store.put('task',task);return{ok:true,humanId:human.id,state:task.state,persisted:true};
 });}
 wait(id,runId){return this.action(id,runId,'waitForTime',{},task=>{
  if(task.role!=='procurement'||task.decision?.action!=='approve')throw problem('没有有效人工确认，不能跳过审核');const source=this.platform.source(this.case(task.caseId).sourceId);
  const human=this.platform.store.get('human',task.humanId);if(human?.validUntil&&human.validUntil<=this.now())throw problem('原人工确认已过期，需要重新审核');
  if(source.version!==task.decision.sourceVersion)throw problem('人工确认后来源已变化，需要重新核查');
  task.state='waiting_time';task.waitUntil=this.now()+this.followupMs;this.store.put('task',task);return{ok:true,state:task.state,wakeAt:task.waitUntil,externalMessageSent:false};
 });}
 complete(id,runId,{conclusion},verification){return this.action(id,runId,'completeTask',{conclusion},task=>{
  const context=this.facts(id);
  if(task.role==='procurement'&&(task.decision?.action!=='approve'||context.source.remaining!==0||!context.source.balanceKnown||(context.source.returnPending||0)>0||context.source.eligible===false))throw problem('采购事项缺少人工确认或实际齐货证据');
  if(['pmc','service'].includes(task.role)&&!context.children.some(child=>child.role===(task.role==='pmc'?'procurement':'pmc')&&child.state==='completed'&&child.result?.fulfilled))throw problem('依赖岗位任务尚未完成');
  if(['pmc','service'].includes(task.role)&&(!context.source.balanceKnown||context.source.remaining!==0||(context.source.returnPending||0)>0||context.source.eligible===false))throw problem('当前来源不能证明本次到料风险已经解除');
  if(typeof conclusion!=='string'||!conclusion.trim())throw problem('缺少结论',400);
  if(this.platform.remote&&['procurement','pmc','service'].includes(task.role)&&(!verification||verification.sourceFingerprint!==context.source.fingerprint))throw problem('缺少中台当前来源核验回执');
  task.state='completed';task.result={conclusion,sourceId:context.source.id,sourceVersion:context.source.version,sourceFingerprint:context.source.fingerprint,humanId:task.humanId||context.children.findLast(row=>row.result?.fulfilled)?.result?.humanId||null,verificationId:verification?.id||null,fulfilled:task.role==='supervisor'?false:context.source.remaining===0};this.store.put('task',task);this.event('task_completed',{taskId:id,caseId:task.caseId,role:task.role});
  if(task.parentId){const parent=this.task(task.parentId);if(parent.state==='waiting_child'){parent.state='queued';parent.trigger='child-result';parent.attempts=0;parent.runId=null;this.store.put('task',parent);}}
  else if(['pmc','service'].includes(task.role)){const item=this.case(task.caseId);item.state='completed';this.store.put('case',item);}
  return{ok:true,state:task.state,caseClosed:task.role==='pmc',businessOrderClosed:false};
 });}
 escalateFailed(task){if(task.role!=='supervisor'){const coordination=this.enqueue({caseId:task.caseId,role:'supervisor',capability:'coordinate',key:task.id+':coordination:'+(task.revision||0),trigger:'task-failed'});this.store.put('task',{...coordination,targetTaskId:task.id});this.event('task_failed_escalated',{taskId:task.id,caseId:task.caseId});}}
 escalate(id,runId,{reason}){return this.action(id,runId,'escalateTask',{reason},task=>{
  this.registry.route(task.role,'supervisor','coordinate');const child=this.enqueue({caseId:task.caseId,role:'supervisor',capability:'coordinate',goal:reason,key:id+':coordination:'+(task.revision||0),trigger:'role-escalation'});this.store.put('task',{...child,targetTaskId:id});task.state='waiting_coordination';this.store.put('task',task);return{ok:true,taskId:child.id,state:task.state};
 });}
 coordinate(id,runId,input,preparedHuman){return this.action(id,runId,'requestCoordination',input,task=>{
  if(task.role!=='supervisor'||!task.targetTaskId)throw problem('当前没有可协调的岗位任务',403);
  const target=this.task(task.targetTaskId);this.registry.route('supervisor',input.targetRole,target.capability);if(target.caseId!==task.caseId||target.role!==input.targetRole||!['waiting_human','waiting_coordination','failed'].includes(target.state))throw problem('协调目标状态或岗位已变化');
  const request=this.reviewRequest(task,{reason:input.reason,proposal:input.proposal,targetTaskId:target.id,targetRole:input.targetRole,targetRevision:target.revision||0,goal:input.goal},'coordination');
  const human=preparedHuman||this.platform.requestReview(request);task.humanId=human.id;task.decision=null;task.state='waiting_human';this.store.put('task',task);return{ok:true,humanId:human.id,state:task.state};
 });}
 resumeCoordinated(id,runId,verification){return this.action(id,runId,'resumeTask',{},task=>{
  const human=this.platform.store.get('human',task.humanId),plan=human?.payload,target=this.task(task.targetTaskId),source=this.platform.source(this.case(task.caseId).sourceId);
  if(task.role!=='supervisor'||task.decision?.action!=='approve'||human?.category!=='coordination'||human.decision?.id!==task.decision.id||plan.targetTaskId!==target.id||plan.targetRole!==target.role||plan.targetRevision!==(target.revision||0)||(target.revision||0)>=3||plan.sourceFingerprint!==source.fingerprint||human.validUntil&&human.validUntil<=this.now())throw problem('协调批准无效、过期或来源/目标已变化');
  this.registry.route('supervisor',target.role,target.capability);if(!['waiting_human','waiting_coordination','failed'].includes(target.state)||target.caseId!==task.caseId)throw problem('目标任务已变化，不能重复恢复');
  if(this.platform.remote&&(!verification||verification.decisionId!==task.decision.id||verification.sourceFingerprint!==source.fingerprint))throw problem('缺少中台协调执行核验回执');
  target.state='queued';target.goal=plan.goal;target.revision=(target.revision||0)+1;target.coordinationGoal=plan.goal;target.coordinationDecisionId=task.decision.id;target.trigger='coordination-approved';target.attempts=0;target.retryAt=0;target.runId=null;target.decision=null;this.store.put('task',target);
  task.state='completed';task.result={fulfilled:false,resumedTaskId:target.id,decisionId:task.decision.id,verificationId:verification?.id||null};this.store.put('task',task);this.event('task_resumed',{caseId:task.caseId,taskId:target.id,revision:target.revision,coordinatorTaskId:task.id});return{ok:true,resumedTaskId:target.id,requiresNewReview:true,businessWrite:false};
 });}
 holdCoordination(id,runId){return this.action(id,runId,'holdCoordination',{},task=>{const target=task.targetTaskId?this.task(task.targetTaskId):null;if(task.role!=='supervisor'||!(task.decision&&task.decision.action!=='approve'||target&&!['waiting_human','waiting_coordination','failed'].includes(target.state)||(target?.revision||0)>=3))throw problem('当前没有可保留的人工协调结果');task.state='waiting_manual';this.store.put('task',task);return{ok:true,state:task.state};});}
 ingestBusinessEvent(event){return this.store.transaction(()=>{
  if(this.store.get('inbox',event.id))return;const source=this.platform.source(event.sourceId);let item=this.store.list('case').find(row=>row.sourceId===source.id&&row.state==='open');
  if(!item&&source.eligible!==false&&(!source.balanceKnown||source.remaining>0||(source.returnPending||0)>0))item=this.startCase({sourceId:source.id,recipient:event.recipient,coordinator:event.coordinator,requestId:event.id});
  if(item&&item.lastSourceFingerprint!==source.fingerprint){item.lastSourceFingerprint=source.fingerprint;this.store.put('case',item);this.changedSource(source.id);}
  this.store.put('inbox',{id:event.id});this.event('business_event_received',{sourceId:source.id,caseId:item?.id||null,eventId:event.id});
 });}
 ingestExpiredReview(event){return this.store.transaction(()=>{if(this.store.get('inbox',event.id))return;const task=this.store.get('task',event.taskId),human=this.platform.store.get('human',event.humanId);if(['waiting_human','waiting_time'].includes(task?.state)&&task.humanId===event.humanId&&human?.validUntil<=this.now()){task.state='queued';task.trigger='review-expired';task.runId=null;task.attempts=0;this.store.put('task',task);}this.store.put('inbox',{id:event.id});});}
 ingestDecision(event){return this.store.transaction(()=>{
  if(this.store.get('inbox',event.id))return;const task=this.task(event.taskId);
  if(task.humanId!==event.humanId){
   // Recover the API-commit / agent-ledger-commit crash window using the
   // authoritative outbox and human record, never model-supplied identifiers.
   const human=this.platform.store.get('human',event.humanId),item=this.case(task.caseId);
   const recipient=human?.category==='coordination'?(item.coordinator||item.recipient):item.recipient;
   if(!human||human.taskId!==task.id||human.caseId!==item.id||human.recipient!==recipient||human.sourceId!==item.sourceId||human.decision?.id!==event.id||(human.payload.taskRevision||0)!==(task.revision||0)||task.decision&&task.humanId)throw problem('审核回执不属于当前任务');
   task.humanId=human.id;
  }
  task.decision=event.decision;task.state='queued';task.trigger='human-result';task.runId=null;task.attempts=0;this.store.put('task',task);this.store.put('inbox',{id:event.id});this.event('human_result_received',{caseId:task.caseId,taskId:task.id,action:event.decision.action});
 });}
 changedSource(sourceId){this.store.transaction(()=>{for(const task of this.store.list('task')){
  if(this.case(task.caseId).sourceId!==sourceId||!['waiting_time','waiting_human'].includes(task.state))continue;
  task.state='queued';task.runId=null;task.attempts=0;task.trigger='source-change';this.store.put('task',task);
 }});}
 timers(){this.store.transaction(()=>{for(const task of this.store.list('task')){
  if(task.state==='waiting_time'&&task.waitUntil<=this.now()){task.state='queued';task.runId=null;task.attempts=0;task.trigger='due-time';this.store.put('task',task);}
  if(task.state==='waiting_human'){
   const human=this.platform.store.get('human',task.humanId);if(human?.status==='pending'&&human.deadline<=this.now()){
    if(task.role!=='supervisor'){const coordination=this.enqueue({caseId:task.caseId,role:'supervisor',capability:'coordinate',key:task.id+':coordination:'+(task.revision||0),trigger:'human-overdue'});this.store.put('task',{...coordination,targetTaskId:task.id});}this.platform.markEscalated(human.id);
   }
  }
 }});}
 async tick(){
  if(this.busy||!this.runAgent)return;this.busy=true;
  try{
   if(this.platform.refresh)await this.platform.refresh();
   for(const event of this.platform.pendingEvents()){if(event.type==='purchase_changed')this.ingestBusinessEvent(event);else if(event.type==='review_expired')this.ingestExpiredReview(event);else this.ingestDecision(event);this.platform.delivered(event.id);}
   this.timers();const task=this.claim();if(!task)return;
   try{
    const response=await this.runAgent(task,this.context(task.id));const current=this.task(task.id);
    if(current.runId!==task.runId)return;
    if(current.state==='running')throw problem('模型没有提交可验证的下一步');
    this.event('run_finished',{caseId:task.caseId,taskId:task.id,role:task.role,runId:task.runId,textHash:fingerprint(response.text||''),steps:response.steps?.length||0});
   }catch{
    const current=this.task(task.id);if(current.runId!==task.runId)return;
    if(current.state==='running'){current.state=current.attempts<2?'queued':'failed';current.retryAt=this.now()+this.retryMs;current.runId=null;current.lastErrorCode='agent-run-failed';this.store.put('task',current);if(current.state==='failed')this.escalateFailed(current);}
    this.event('run_failed',{caseId:task.caseId,taskId:task.id,role:task.role,runId:task.runId,state:current.state});
   }
  }finally{this.busy=false;}
 }
 start(intervalMs=500){if(!this.timer)this.timer=setInterval(()=>this.tick().catch(()=>{if(!this.loopErrorReported){this.loopErrorReported=true;this.event('worker_error',{code:'task-loop-failed'});}}),intervalMs);}
 stop(){if(this.timer)clearInterval(this.timer);this.timer=null;}
 overview(){return{roles:this.registry.catalog(),cases:this.store.list('case'),tasks:this.store.list('task'),events:this.store.list('event')};}
 close(){this.stop();if(this.busy)throw problem('执行尚未结束');this.store.close();}
}
