import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {TaskEngine} from './engine.mjs';
import {HumanPlatform} from './platform.mjs';
import {RoleRegistry,fingerprint} from './store.mjs';
import {createAutonomyRuntime} from './runtime.mjs';

const employee={identity:{id:'synthetic-purchaser'}},other={identity:{id:'synthetic-other'}},source={id:'SYN-PURCHASE-001',version:1,quantity:160,received:100,balanceKnown:true,unit:'件',promisedDate:'2026-10-16',sourceAsOf:'2026-10-17'};
async function fixture(fn){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'doon-autonomy-'));let clock=Date.now();const now=()=>clock,platform=new HumanPlatform(path.join(dir,'platform.sqlite'),{now});platform.seedSource(source);const engine=new TaskEngine(path.join(dir,'tasks.sqlite'),{platform,now,humanTimeoutMs:100,followupMs:100,retryMs:0});try{await fn({dir,platform,engine,advance:ms=>clock+=ms,now});}finally{engine.close();platform.close();await fs.rm(dir,{recursive:true,force:true});}}
function started(engine){const item=engine.startCase({sourceId:source.id,recipient:employee.identity.id,requestId:'synthetic-start'}),root=engine.claim(),child=engine.submit(root.id,root.runId,{targetRole:'procurement',capability:'purchase-check',goal:'合成采购核查'}),task=engine.claim();assert.equal(task.id,child.taskId);return{item,root,task};}
function request(engine,task){return engine.requestHuman(task.id,task.runId,{reason:'合成来源需要核对',proposal:'确认允许内部继续跟进，不修改原采购单'});}
function decision(platform,human,action='approve',requestId='synthetic-decision'){return platform.decide(employee,{id:human.id,version:human.version,payloadHash:human.payloadHash,action,comment:'已核对合成依据',requestId});}

test('任务路由受控、稳定去重，不能通过模型参数扩大岗位能力',async()=>fixture(async({engine})=>{
 const item=engine.startCase({sourceId:source.id,recipient:employee.identity.id,requestId:'one'});assert.equal(engine.startCase({sourceId:source.id,recipient:employee.identity.id,requestId:'two'}).id,item.id);
 const task=engine.claim();assert.throws(()=>engine.submit(task.id,task.runId,{targetRole:'service',capability:'customer-impact',goal:'越权任务'}),/未授权/);
 const input={targetRole:'procurement',capability:'purchase-check',goal:'合成采购核查'},first=engine.submit(task.id,task.runId,input);assert.equal(engine.submit(task.id,task.runId,input).taskId,first.taskId);assert.equal(engine.task(first.taskId).goal,input.goal);assert.equal(engine.store.list('task').length,2);
 assert.throws(()=>engine.complete(task.id,'forged-run',{conclusion:'伪造'}),/租约/);
}));

test('关闭/读取不完成待办，跨员工拒绝，审核重放幂等且不改源单',async()=>fixture(async({engine,platform})=>{
 const {task}=started(engine),before=fingerprint(platform.source(source.id));request(engine,task);const human=platform.inbox(employee)[0];
 for(let i=0;i<4;i++)assert.equal(platform.inbox(employee)[0].status,'pending');assert.equal(platform.inbox(other).length,0);
 const input={id:human.id,version:human.version,payloadHash:human.payloadHash,action:'approve',comment:'已核对',requestId:'decision'};assert.throws(()=>platform.decide(other,input),/范围/);
 const result=platform.decide(employee,input);assert.equal(platform.decide(employee,input).decisionId,result.decisionId);assert.equal(platform.pendingEvents().length,1);
 assert.throws(()=>platform.decide(employee,{...input,comment:'更改内容'}),/不能更改/);assert.equal(fingerprint(platform.source(source.id)),before);
 engine.ingestDecision(platform.pendingEvents()[0]);const resumed=engine.claim();assert.equal(resumed.trigger,'human-result');assert.throws(()=>engine.complete(resumed.id,resumed.runId,{conclusion:'已齐货'}),/齐货证据/);
}));

test('审核来源变化时旧批准拒绝，待办保留；更新方案继续使用原待办ID',async()=>fixture(async({engine,platform})=>{
 const {task}=started(engine);request(engine,task);const old=platform.inbox(employee)[0];platform.recordReceipt(source.id,{received:120,expectedVersion:1});assert.throws(()=>decision(platform,old),/来源已变化/);assert.equal(platform.inbox(employee)[0].status,'pending');
 engine.changedSource(source.id);const refreshed=engine.claim();request(engine,refreshed);const current=platform.inbox(employee)[0];assert.equal(current.id,old.id);assert.equal(current.version,old.version+1);assert.throws(()=>decision(platform,old),/内容已经变化/);
 decision(platform,current);assert.equal(platform.inbox(employee)[0].status,'approved');
}));

test('超时升级去重且不关闭原待办；真实时间条件进入队列',async()=>fixture(async({engine,platform,advance})=>{
 const {task}=started(engine);request(engine,task);advance(101);engine.timers();const firstEscalation=platform.inbox(employee)[0].escalatedAt;advance(10);engine.timers();assert.equal(platform.inbox(employee)[0].escalatedAt,firstEscalation);assert.equal(engine.store.list('task').filter(row=>row.role==='supervisor').length,1);assert.equal(platform.inbox(employee)[0].status,'pending');assert.equal(engine.task(task.id).state,'waiting_human');
 const supervisor=engine.claim();engine.complete(supervisor.id,supervisor.runId,{conclusion:'需员工处理，原待办保留'});assert.equal(platform.inbox(employee)[0].status,'pending');assert.equal(engine.case(task.caseId).state,'open');
 decision(platform,platform.inbox(employee)[0]);engine.ingestDecision(platform.pendingEvents()[0]);const resumed=engine.claim();engine.wait(resumed.id,resumed.runId);advance(101);engine.timers();assert.equal(engine.task(task.id).state,'queued');assert.equal(engine.task(task.id).trigger,'due-time');
}));

test('人工请求和回执跨进程对象重建后保留，结果回传且真正齐货后才结束',async()=>fixture(async({dir,engine,platform,now})=>{
 const {task,root,item}=started(engine);request(engine,task);const human=platform.inbox(employee)[0];
 const secondPlatform=new HumanPlatform(path.join(dir,'platform.sqlite'),{now}),secondEngine=new TaskEngine(path.join(dir,'tasks.sqlite'),{platform:secondPlatform,now});
 try{
  assert.equal(secondPlatform.inbox(employee)[0].id,human.id);decision(secondPlatform,human);secondEngine.ingestDecision(secondPlatform.pendingEvents()[0]);secondEngine.ingestDecision(secondPlatform.pendingEvents()[0]);
  const resumed=secondEngine.claim();secondEngine.wait(resumed.id,resumed.runId);secondPlatform.recordReceipt(source.id,{received:160,expectedVersion:1});secondEngine.changedSource(source.id);
  const final=secondEngine.claim();secondEngine.complete(final.id,final.runId,{conclusion:'合成采购齐货依据已验证'});assert.equal(secondEngine.task(root.id).state,'queued');const pmc=secondEngine.claim();secondEngine.complete(pmc.id,pmc.runId,{conclusion:'仅关闭采购风险事项，不关闭业务订单'});assert.equal(secondEngine.case(item.id).state,'completed');
 }finally{secondEngine.close();secondPlatform.close();}
}));

test('拒绝/退回不批准，失败最多重试一次；新增岗位沿用统一任务入口',async()=>fixture(async({engine,platform})=>{
 const {task}=started(engine);request(engine,task);decision(platform,platform.inbox(employee)[0],'reject');engine.ingestDecision(platform.pendingEvents()[0]);const resumed=engine.claim();assert.throws(()=>engine.wait(resumed.id,resumed.runId),/有效人工确认/);engine.escalate(resumed.id,resumed.runId,{reason:'员工拒绝，需协调'});assert.equal(engine.task(task.id).state,'waiting_coordination');
 engine.registry.register({id:'quality',name:'质检 Agent',capabilities:['quality-check'],routes:['supervisor'],tools:['readTaskFacts','completeTask']});engine.registry.get('supervisor').routes.push('quality');const leader=engine.claim();const child=engine.submit(leader.id,leader.runId,{targetRole:'quality',capability:'quality-check',goal:'合成质检分析'});assert.equal(engine.task(child.taskId).role,'quality');
 engine.runAgent=async()=>{throw Error('synthetic provider failure')};await engine.tick();await engine.tick();assert.equal(engine.task(child.taskId).state,'failed');assert.equal(engine.task(child.taskId).attempts,2);
}));

test('人工接口已提交、任务账本未关联时崩溃，回执仍能恢复而不重复建待办',async()=>fixture(async({engine,platform})=>{
 const {item,task}=started(engine);
 const human=platform.requestReview({taskId:task.id,caseId:item.id,recipient:employee.identity.id,sourceId:source.id,reason:'合成崩溃窗口',proposal:'已提交人工API但未写回任务账本',deadline:Date.now()+60000});
 assert.equal(engine.task(task.id).humanId,null);decision(platform,human);engine.ingestDecision(platform.pendingEvents()[0]);
 const restored=engine.claim();assert.equal(restored.id,task.id);assert.equal(restored.humanId,human.id);assert.equal(restored.decision.action,'approve');assert.equal(platform.store.list('human').length,1);
 assert.throws(()=>engine.wait(task.id,task.runId),/租约/);
}));

test('过期执行被新租约接管，旧执行不能提交；PMC必须复核当前齐货事实',async()=>fixture(async({engine,platform,advance})=>{
 const {task,root}=started(engine);advance(90001);const renewed=engine.claim();assert.equal(renewed.id,task.id);assert.notEqual(renewed.runId,task.runId);assert.throws(()=>request(engine,task),/租约/);
 request(engine,renewed);decision(platform,platform.inbox(employee)[0]);engine.ingestDecision(platform.pendingEvents()[0]);
 platform.recordReceipt(source.id,{received:160,expectedVersion:1});const procurement=engine.claim();engine.complete(procurement.id,procurement.runId,{conclusion:'合成收货齐全'});
 platform.recordReceipt(source.id,{received:100,expectedVersion:2});const pmc=engine.claim();assert.equal(pmc.id,root.id);assert.throws(()=>engine.complete(pmc.id,pmc.runId,{conclusion:'引用旧的齐货回执'}),/当前来源/);
}));

test('Mastra 实际工具循环由后台定时驱动，离开聊天后仍完成PMC采购人工闭环',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'doon-autonomy-sdk-'));const runtime=await createAutonomyRuntime({dataDir:dir,engineOptions:{followupMs:100,humanTimeoutMs:60000}});runtime.platform.seedSource(source);
 const until=async check=>{for(let i=0;i<150;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,50));}throw Error('background condition timed out');};
 try{
  const item=runtime.engine.startCase({sourceId:source.id,recipient:employee.identity.id,requestId:'native-sdk'});runtime.engine.start(30);
  await until(()=>runtime.platform.inbox(employee).some(row=>row.status==='pending'));assert.equal(runtime.engine.case(item.id).state,'open');decision(runtime.platform,runtime.platform.inbox(employee)[0]);
  await until(()=>runtime.engine.store.list('task').some(row=>['waiting_time','waiting_coordination'].includes(row.state)));
  runtime.platform.recordReceipt(source.id,{received:160,expectedVersion:1});runtime.engine.changedSource(source.id);await until(()=>runtime.engine.case(item.id).state==='completed');
  assert(runtime.engine.store.list('event').some(event=>event.type==='run_finished'));assert.equal(runtime.platform.source(source.id).received,160);
 }finally{await runtime.close();await fs.rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100}).catch(error=>{if(error.code!=='EBUSY')throw error;});}
});
