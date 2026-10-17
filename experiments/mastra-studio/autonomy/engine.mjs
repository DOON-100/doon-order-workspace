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
 startCase({sourceId,recipient,requestId}){
  if(!recipient||!requestId)throw problem('需要已配置的审核员工与请求标识',400);
  return this.store.transaction(()=>{const source=this.platform.source(sourceId),key='material-risk:'+source.id+':'+source.version,existing=this.store.list('case').find(row=>row.key===key);if(existing)return existing;
   const item={id:randomUUID(),key,sourceId,recipient,state:'open',createdAt:this.now(),requestId,shadow:this.shadow};this.store.put('case',item);this.enqueue({caseId:item.id,role:'pmc',capability:'material-risk',key:item.id+':root',trigger:'business-event'});return item;});
 }
 context(id){const task=this.task(id),item=this.case(task.caseId),caseTasks=this.store.list('task').filter(row=>row.caseId===item.id);return{task,item,children:caseTasks.filter(row=>row.parentId===id),caseTasks,humanRequests:this.platform.store.list('human').filter(row=>row.caseId===item.id),coverage:this.platform.coverage||null,events:this.store.list('event').filter(row=>row.caseId===item.id).slice(-12),availableRoles:this.registry.catalog(),observationTime:new Date(this.now()).toISOString(),shadow:this.shadow};}
 facts(id){const context=this.context(id);return{...context,source:this.platform.source(context.item.sourceId),human:context.task.humanId?this.platform.store.get('human',context.task.humanId):null};}
 claim(){return this.store.transaction(()=>{
  const now=this.now();const task=this.store.list('task').find(row=>(row.state==='queued'&&row.retryAt<=now)||(row.state==='running'&&row.leaseUntil<=now));if(!task)return null;
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
  const child=this.enqueue({caseId:task.caseId,role:targetRole,capability,goal,parentId:id,key:id+':'+targetRole+':'+capability});task.state='waiting_child';task.updatedAt=this.now();this.store.put('task',task);return{ok:true,taskId:child.id,state:task.state,businessDispatch:false};
 });}
 requestHuman(id,runId,{reason,proposal}){return this.action(id,runId,'requestHumanReview',{reason,proposal},task=>{
  if(task.role!=='procurement')throw problem('岗位无权发起此类审核',403);const item=this.case(task.caseId);
  if(this.shadow){task.state='waiting_configuration';this.store.put('task',task);return{ok:false,shadow:true,reason:'真实快照只读影子验证，没有配置真实人工任务映射，不创建员工待办'};}
  const human=this.platform.requestReview({taskId:id,caseId:item.id,recipient:item.recipient,sourceId:item.sourceId,reason,proposal,deadline:this.now()+this.humanTimeoutMs});
  task.state='waiting_human';task.humanId=human.id;task.decision=null;this.store.put('task',task);return{ok:true,humanId:human.id,state:task.state,persisted:true};
 });}
 wait(id,runId){return this.action(id,runId,'waitForTime',{},task=>{
  if(task.role!=='procurement'||task.decision?.action!=='approve')throw problem('没有有效人工确认，不能跳过审核');const source=this.platform.source(this.case(task.caseId).sourceId);
  if(source.version!==task.decision.sourceVersion)throw problem('人工确认后来源已变化，需要重新核查');
  task.state='waiting_time';task.waitUntil=this.now()+this.followupMs;this.store.put('task',task);return{ok:true,state:task.state,wakeAt:task.waitUntil,externalMessageSent:false};
 });}
 complete(id,runId,{conclusion}){return this.action(id,runId,'completeTask',{conclusion},task=>{
  const context=this.facts(id);
  if(task.role==='procurement'&&(task.decision?.action!=='approve'||context.source.remaining!==0||!context.source.balanceKnown))throw problem('采购事项缺少人工确认或实际齐货证据');
  if(['pmc','service'].includes(task.role)&&!context.children.some(child=>child.role===(task.role==='pmc'?'procurement':'pmc')&&child.state==='completed'&&child.result?.fulfilled))throw problem('依赖岗位任务尚未完成');
  if(['pmc','service'].includes(task.role)&&(!context.source.balanceKnown||context.source.remaining!==0))throw problem('当前来源不能证明本次到料风险已经解除');
  if(typeof conclusion!=='string'||!conclusion.trim())throw problem('缺少结论',400);
  task.state='completed';task.result={conclusion,sourceId:context.source.id,sourceVersion:context.source.version,sourceFingerprint:context.source.fingerprint,fulfilled:task.role==='supervisor'?false:context.source.remaining===0};this.store.put('task',task);this.event('task_completed',{taskId:id,caseId:task.caseId,role:task.role});
  if(task.parentId){const parent=this.task(task.parentId);if(parent.state==='waiting_child'){parent.state='queued';parent.trigger='child-result';parent.attempts=0;parent.runId=null;this.store.put('task',parent);}}
  else if(task.role==='pmc'){const item=this.case(task.caseId);item.state='completed';this.store.put('case',item);}
  return{ok:true,state:task.state,caseClosed:task.role==='pmc',businessOrderClosed:false};
 });}
 escalateFailed(task){if(task.role!=='supervisor'){this.enqueue({caseId:task.caseId,role:'supervisor',capability:'coordinate',key:task.id+':failure',trigger:'task-failed'});this.event('task_failed_escalated',{taskId:task.id,caseId:task.caseId});}}
 escalate(id,runId,{reason}){return this.action(id,runId,'escalateTask',{reason},task=>{
  this.registry.route(task.role,'supervisor','coordinate');const child=this.enqueue({caseId:task.caseId,role:'supervisor',capability:'coordinate',goal:reason,key:id+':coordination',trigger:'role-escalation'});task.state='waiting_coordination';this.store.put('task',task);return{ok:true,taskId:child.id,state:task.state};
 });}
 ingestDecision(event){return this.store.transaction(()=>{
  if(this.store.get('inbox',event.id))return;const task=this.task(event.taskId);
  if(task.humanId!==event.humanId){
   // Recover the API-commit / agent-ledger-commit crash window using the
   // authoritative outbox and human record, never model-supplied identifiers.
   const human=this.platform.store.get('human',event.humanId),item=this.case(task.caseId);
   if(task.humanId||!human||human.taskId!==task.id||human.caseId!==item.id||human.recipient!==item.recipient||human.sourceId!==item.sourceId||human.decision?.id!==event.id)throw problem('审核回执不属于当前任务');
   task.humanId=human.id;
  }
  task.decision=event.decision;task.state='queued';task.trigger='human-result';task.runId=null;task.attempts=0;this.store.put('task',task);this.store.put('inbox',{id:event.id});this.event('human_result_received',{caseId:task.caseId,taskId:task.id,action:event.decision.action});
 });}
 changedSource(sourceId){this.store.transaction(()=>{for(const task of this.store.list('task')){
  if(this.case(task.caseId).sourceId!==sourceId||!['waiting_time','waiting_human','waiting_coordination'].includes(task.state))continue;
  task.state='queued';task.runId=null;task.attempts=0;task.trigger='source-change';this.store.put('task',task);
 }});}
 timers(){this.store.transaction(()=>{for(const task of this.store.list('task')){
  if(task.state==='waiting_time'&&task.waitUntil<=this.now()){task.state='queued';task.runId=null;task.attempts=0;task.trigger='due-time';this.store.put('task',task);}
  if(task.state==='waiting_human'){
   const human=this.platform.store.get('human',task.humanId);if(human?.status==='pending'&&human.deadline<=this.now()){
    this.enqueue({caseId:task.caseId,role:'supervisor',capability:'coordinate',key:human.id+':overdue',trigger:'human-overdue'});this.platform.markEscalated(human.id);
   }
  }
 }});}
 async tick(){
  if(this.busy||!this.runAgent)return;this.busy=true;
  try{
   for(const event of this.platform.pendingEvents()){this.ingestDecision(event);this.platform.delivered(event.id);}
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
