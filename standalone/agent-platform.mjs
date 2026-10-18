import {createHash,randomUUID,timingSafeEqual} from 'node:crypto';
import fs from 'node:fs/promises';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=(message,status=409)=>{throw Object.assign(new Error(message),{status});};
const strict=(input,keys)=>{if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!keys.includes(key)))fail('请求包含不支持的字段',400);};
const word=(value,max=160)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
export async function agentPlatformConfig(env=process.env){
 if(env.DOON_AGENT_PLATFORM_ENABLED!=='1')return null;
 try{const value=JSON.parse(await fs.readFile(env.DOON_AGENT_PLATFORM_SECRET_FILE,'utf8'));if(!/^[\w-]{43,128}$/.test(value.token)||!word(value.serviceMemberId))throw Error();return value;}catch{throw Error('Agent 中台配置无效，请检查服务端私有配置文件');}
}

// Middle-platform owned records. Existing purchases, members and attachments are
// only referenced; no Agent action can update them through this interface.
export function createAgentPlatform({db,records,transaction,readPurchase,config,now=Date.now,scanMs=30000,approvalMs=86400000}){
 const ruleVersion='purchase-review-v1';let timer=null,lastScan=0,lastError=null;
 const list=kind=>db.prepare('SELECT data FROM records WHERE kind=? ORDER BY rowid').all(kind).map(row=>JSON.parse(row.data));
 const get=(kind,id)=>{const row=db.prepare('SELECT data FROM records WHERE kind=? AND id=?').get(kind,id);return row?JSON.parse(row.data):null;};
 const put=row=>{if(!row.kind.startsWith('agent_'))fail('仅允许保存独立协作记录',403);const old=db.prepare('SELECT kind FROM records WHERE id=?').get(row.id);if(old&&old.kind!==row.kind)fail('记录主键冲突，原记录保持不变');db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(row.id,row.kind,JSON.stringify(row));return row;};
 const member=id=>records().find(row=>row.kind==='member'&&row.id===id);
 function source(id,memberId=config.serviceMemberId){const value=readPurchase(records(),memberId,id);if(!value)fail('采购记录不在当前授权范围',403);return {...value,fingerprint:hash(value)};}
 function binding(id){const row=list('agent_binding').find(item=>item.sourceId===id&&item.active);if(!row)fail('尚未配置当前采购的协作关系',403);source(id);for(const memberId of [row.reviewerMemberId,row.coordinatorMemberId])if(!member(memberId)?.active||!readPurchase(records(),memberId,id))fail('审核人或协调人权限已变化',403);return row;}
 function event(type,data){const id='agent_event_'+hash([type,data.key]);return get('agent_event',id)||put({id,kind:'agent_event',type,createdAt:now(),...data});}
 function idempotent(requestId,input,execute){if(!word(requestId,240))fail('需要稳定请求标识',400);const id='agent_request_'+hash(requestId),saved=get('agent_request',id),fingerprint=hash(input);if(saved){if(saved.fingerprint!==fingerprint)fail('相同请求标识不能更改内容');return saved.result;}const result=execute();put({id,kind:'agent_request',fingerprint,result});return result;}
 function setBinding(current,input){
  strict(input,['sourceId','reviewerMemberId','coordinatorMemberId','expectedVersion','active','requestId']);if(current?.member.role!=='admin'||current.account.must_change)fail('需要有效管理员身份',403);
  if(!word(input.requestId,240)||!word(input.sourceId)||!word(input.reviewerMemberId)||!word(input.coordinatorMemberId)||typeof input.active!=='boolean')fail('请指定业务对象、审核人和协调人',400);
  source(input.sourceId,current.member.id);source(input.sourceId);
  for(const id of [input.reviewerMemberId,input.coordinatorMemberId])if(!member(id)?.active||!readPurchase(records(),id,input.sourceId))fail('人员无权处理当前采购',403);
  return transaction(()=>idempotent('binding:'+current.member.id+':'+input.requestId,input,()=>{const old=list('agent_binding').find(row=>row.sourceId===input.sourceId);if((old?.version||0)!==input.expectedVersion)fail('协作配置已变化');const row={id:old?.id||'agent_binding_'+randomUUID(),kind:'agent_binding',sourceId:input.sourceId,reviewerMemberId:input.reviewerMemberId,coordinatorMemberId:input.coordinatorMemberId,active:input.active,version:(old?.version||0)+1,updatedAt:now(),updatedBy:current.member.id,history:[...(old?.history||[]),{actorId:current.member.id,at:now(),...input,requestId:undefined}]};put(row);return row;}));
 }
 function scan(){return transaction(()=>{
  const emitted=[];for(const candidate of list('agent_binding').filter(row=>row.active)){
   let selected,current;try{selected=binding(candidate.sourceId);current=source(selected.sourceId);}catch{continue;}
   const key=hash([selected.id,selected.version,current.fingerprint]),old=get('agent_observation','agent_observation_'+selected.id);
   if(old?.key!==key){const risk=current.eligible&&(!current.balanceKnown||current.remaining>0||current.returnPending>0);const row=event('purchase_changed',{key,sourceId:current.id,sourceVersion:current.version,sourceFingerprint:current.fingerprint,bindingVersion:selected.version,risk,recipient:member(selected.reviewerMemberId).userId,coordinator:member(selected.coordinatorMemberId).userId});emitted.push(row);put({id:'agent_observation_'+selected.id,kind:'agent_observation',key,at:now()});}
  }
  for(const human of list('agent_human_task').filter(row=>['pending','approved'].includes(row.status)&&row.validUntil<=now()))event('review_expired',{key:human.id+':'+human.version,sourceId:human.sourceId,taskId:human.taskId,humanId:human.id});
  lastScan=now();lastError=null;return emitted;
 });}
 function requestReview(input){
  strict(input,['requestId','sourceId','sourceVersion','sourceFingerprint','bindingVersion','taskId','caseId','taskRevision','category','reason','proposal','deadline','targetTaskId','targetRole','targetRevision','goal']);
  if(!word(input.requestId,240)||!['purchase-followup','coordination'].includes(input.category)||!word(input.taskId)||!word(input.caseId)||!word(input.reason,1500)||!word(input.proposal,1500)||!Number.isInteger(input.taskRevision)||input.taskRevision<0)fail('审核方案参数无效',400);
  const route=binding(input.sourceId),current=source(input.sourceId);
  if(current.version!==input.sourceVersion||current.fingerprint!==input.sourceFingerprint||route.version!==input.bindingVersion)fail('业务来源或协作关系已变化');
  if(input.category==='coordination'&&(!word(input.targetTaskId)||!word(input.targetRole,32)||!word(input.goal,1500)||!Number.isInteger(input.targetRevision)||input.targetRevision<0))fail('协调方案缺少恢复目标',400);
  return transaction(()=>idempotent('review:'+input.requestId,input,()=>{
   const old=list('agent_human_task').find(row=>row.taskId===input.taskId&&row.status==='pending');
   if(old&&(old.caseId!==input.caseId||old.sourceId!==input.sourceId||old.category!==input.category))fail('审核任务上下文不一致');
   const existingContext=list('agent_human_task').find(row=>row.taskId===input.taskId);if(existingContext&&(existingContext.caseId!==input.caseId||existingContext.sourceId!==input.sourceId||existingContext.category!==input.category))fail('任务标识不能跨业务复用');
   const recipientMemberId=input.category==='coordination'?route.coordinatorMemberId:route.reviewerMemberId;
   if(old&&old.recipientMemberId!==recipientMemberId)fail('待办归属已变化，需要管理员先处理原待办');
   const validUntil=now()+approvalMs,evidence={...current},payload={action:input.category==='coordination'?'resume-role-task':'internal-followup-plan',sourceId:current.id,sourceVersion:current.version,sourceFingerprint:current.fingerprint,bindingVersion:route.version,ruleVersion,taskRevision:input.taskRevision,reason:input.reason,proposal:input.proposal,evidence,validUntil,...(input.category==='coordination'?{targetTaskId:input.targetTaskId,targetRole:input.targetRole,targetRevision:input.targetRevision,goal:input.goal}:{})};
   if(input.category==='coordination'&&input.targetRevision>=3){payload.manualOnly=true;payload.action='manual-handoff';}
   const payloadHash=hash(payload),row={id:old?.id||'agent_human_'+randomUUID(),kind:'agent_human_task',category:input.category,originRole:input.category==='coordination'?'supervisor':'procurement',taskId:input.taskId,caseId:input.caseId,sourceId:current.id,recipientMemberId,recipient:member(recipientMemberId).userId,payload,payloadHash,version:(old?.version||0)+1,status:'pending',createdAt:old?.createdAt||now(),deadline:Number.isFinite(input.deadline)?Math.min(Math.max(input.deadline,now()+1000),validUntil):now()+60000,validUntil,escalatedAt:null,decision:null,history:[...(old?.history||[]),{action:old?'revised':'created',at:now(),payloadHash}]};put(row);return row;
  }));
 }
 function inbox(current){if(!current||current.account.must_change||current.member.role==='supplier')fail('请使用有效内部员工身份',403);return list('agent_human_task').filter(row=>row.recipientMemberId===current.member.id&&!!readPurchase(records(),current.member.id,row.sourceId)).map(row=>({...row,canDecide:row.status==='pending'&&row.validUntil>now()}));}
 function decide(current,input){
  strict(input,['id','version','payloadHash','action','comment','requestId']);if(!current||current.account.must_change)fail('请先登录有效工作台账号',401);
  if(!word(input.requestId,240)||!['approve','return','reject'].includes(input.action)||!word(input.comment,2000))fail('请选择处理结果并填写说明',400);
  return transaction(()=>{
   const row=get('agent_human_task',input.id);if(!row||row.recipientMemberId!==current.member.id||!current.member.active||!readPurchase(records(),current.member.id,row.sourceId))fail('不在本人当前处理范围',403);
   return idempotent('decision:'+current.member.id+':'+input.requestId,input,()=>{
    const value=source(row.sourceId,current.member.id);
    if(row.status!=='pending'||row.version!==input.version||row.payloadHash!==input.payloadHash)fail('审核内容已变化，请重新读取');
    if(input.action==='approve'){
     const route=binding(row.sourceId);
     if(row.validUntil<=now())fail('方案已过期，需要重新核验；待办仍保留');
     if(row.payload.ruleVersion!==ruleVersion||route.version!==row.payload.bindingVersion||value.fingerprint!==row.payload.sourceFingerprint)fail('来源、规则或协作关系已变化，原审核不能执行');
    }
    const decision={id:'agent_decision_'+randomUUID(),actorId:current.member.userId,actorMemberId:current.member.id,action:input.action,comment:input.comment.trim(),at:now(),payloadHash:row.payloadHash,sourceVersion:value.version};row.status=input.action==='approve'?'approved':input.action==='return'?'returned':'rejected';row.decision=decision;row.history.push({action:'decision:'+input.action,...decision});put(row);put({id:decision.id,kind:'agent_decision',humanId:row.id,taskId:row.taskId,sourceId:row.sourceId,...decision});
    event('human_decision',{key:decision.id,sourceId:row.sourceId,humanId:row.id,taskId:row.taskId,caseId:row.caseId,decision});return{ok:true,id:row.id,status:row.status,decisionId:decision.id,executedBusinessWrite:false};
   });
  });
 }
 function validateDecision(input){
  strict(input,['humanId','decisionId','payloadHash','taskId','purpose']);const row=get('agent_human_task',input.humanId);if(!row||row.taskId!==input.taskId||row.payloadHash!==input.payloadHash||row.decision?.id!==input.decisionId||row.decision.action!=='approve')fail('缺少有效人工批准');
  const route=binding(row.sourceId),current=source(row.sourceId);if(row.payload.bindingVersion!==route.version||row.payload.ruleVersion!==ruleVersion||!member(row.decision.actorMemberId)?.active||!readPurchase(records(),row.decision.actorMemberId,row.sourceId))fail('批准人的当前权限或规则已变化',403);
  if(input.purpose==='resume'){if(row.payload.manualOnly)fail('人工接管不能自动恢复岗位');if(row.category!=='coordination'||row.validUntil<=now()||current.fingerprint!==row.payload.sourceFingerprint)fail('协调批准已过期或来源已变化');}
  else if(input.purpose==='complete'){if(row.validUntil<=now())fail('原采购确认已过期，需要重新审核');if(row.category!=='purchase-followup'||!current.eligible||!current.full)fail('当前证据不能证明本次采购已齐货');}
  else fail('核验用途无效',400);
  return transaction(()=>{const id='agent_execution_'+hash([input.purpose,row.decision.id,current.fingerprint]),saved=get('agent_execution_receipt',id);return saved||put({id,kind:'agent_execution_receipt',purpose:input.purpose,humanId:row.id,decisionId:row.decision.id,payloadHash:row.payloadHash,sourceId:current.id,sourceVersion:current.version,sourceFingerprint:current.fingerprint,verifiedAt:now(),businessWrite:false,plan:row.category==='coordination'?row.payload:null,source:current});});
 }
 function poll(input){
  strict(input,['ack']);if(!Array.isArray(input.ack)||input.ack.length>100||input.ack.some(id=>!word(id,200)))fail('回执参数无效',400);if(!lastScan||now()-lastScan>=scanMs)scan();
  const routes=list('agent_binding').filter(row=>row.active).filter(row=>{try{binding(row.sourceId);return true;}catch{return false;}}),ids=new Set(routes.map(row=>row.sourceId));
  return transaction(()=>{
   for(const id of input.ack){const row=get('agent_event',id);if(!row||!ids.has(row.sourceId))fail('回执事件不在服务范围',403);put({id:'agent_ack_'+hash([config.serviceMemberId,id]),kind:'agent_event_ack',eventId:id,consumer:config.serviceMemberId,at:now()});}
   const events=list('agent_event').filter(row=>ids.has(row.sourceId)&&!get('agent_event_ack','agent_ack_'+hash([config.serviceMemberId,row.id]))).slice(0,100);
   return{events,sources:routes.map(row=>source(row.sourceId)),bindings:routes.map(row=>({...row,recipient:member(row.reviewerMemberId).userId,coordinator:member(row.coordinatorMemberId).userId})),humans:list('agent_human_task').filter(row=>ids.has(row.sourceId)),asOf:now()};
  });
 }
 function authenticate(request){const value=request.headers.get('authorization')||'',expected='Bearer '+config.token,a=Buffer.from(value),b=Buffer.from(expected);if(a.length!==b.length||!timingSafeEqual(a,b))fail('服务身份无效',401);if(!member(config.serviceMemberId)?.active||member(config.serviceMemberId)?.role==='supplier')fail('服务委托身份已停用',403);}
 async function handle(request,current){
  const url=new URL(request.url),path=url.pathname;if(!path.startsWith('/api/agent-platform/'))return null;
  if(!config)fail('协作接口尚未启用',404);
  if(path.includes('/service/')){authenticate(request);if(request.method!=='POST')fail('服务接口只接受POST',405);const input=await request.json();const action=path.split('/').at(-1);
   if(action==='poll')return Response.json(poll(input));if(action==='review')return Response.json(requestReview(input));if(action==='verify')return Response.json(validateDecision(input));
   if(action==='escalated'){strict(input,['humanId']);const row=get('agent_human_task',input.humanId);if(!row)fail('待办不存在',404);binding(row.sourceId);if(!row.escalatedAt&&row.status==='pending')transaction(()=>put({...row,escalatedAt:now()}));return Response.json({ok:true});}
   fail('接口不存在',404);
  }
  if(!current||current.account.must_change)fail('请先登录有效工作台账号',401);
  if(path.endsWith('/identity')&&request.method==='GET'){if(current.member.role==='supplier')fail('当前身份不能进入内部协作',403);return Response.json({user:{username:current.account.username,mustChange:false,role:current.member.role,identity:{id:current.member.userId,name:current.member.name,email:current.member.email}}});}
  if(path.endsWith('/inbox')&&request.method==='GET')return Response.json({identity:current.member.userId,role:current.member.role,items:inbox(current)});
  if(path.endsWith('/decide')&&request.method==='POST')return Response.json(decide(current,await request.json()));
  if(path.endsWith('/bindings')&&request.method==='POST'){const result=setBinding(current,await request.json());scan();return Response.json(result);}
  if(path.endsWith('/status')&&request.method==='GET'){if(current.member.role!=='admin')fail('运行管理仅管理员可用',403);return Response.json({bindings:list('agent_binding'),pending:list('agent_human_task').filter(row=>row.status==='pending').length,lastScan,lastError});}
  fail('接口不存在',404);
 }
 return{handle,scan,poll,source,setBinding,requestReview,inbox,decide,validateDecision,start(){if(!timer){timer=setInterval(()=>{try{scan();}catch{lastError='scan-failed';}},scanMs);timer.unref();}},close(){if(timer)clearInterval(timer);timer=null;}};
}
