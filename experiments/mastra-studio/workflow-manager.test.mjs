import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {createStudio} from './server.mjs';
import {createAgents,syntheticOrders} from './agents.mjs';
import {createWorkflowManager,workflowTemplate} from './workflow-manager.mjs';

test('可视化流程：执行真实图、暂停审核、身份/版本/来源/有效期、拒绝暂缓、幂等及重启保全',async()=>{
 const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'doon-workflow-manager-'));let clock=Date.now(),source='synthetic-source-v1',studio;
 const setup=()=>createStudio({dataDir,deepseekOptions:{env:{}},createRuntime:async()=>{const lab=createAgents(dataDir);await lab.editorReady;lab.workflowManager=await createWorkflowManager({...lab,sourceFingerprint:()=>source,now:()=>clock});return lab;}});
 studio=await setup();const origin='http://127.0.0.1:19897',admin={id:'SYN-ADMIN',name:'合成管理员',role:'admin'},programmer={id:'SYN-PROGRAMMER',name:'合成程序员',role:'programmer'};
 const call=async(route,method='GET',body,actor=admin,requestOrigin=origin)=>{const response=await studio.handle(new Request(origin+'/studio/workflow-manager/api/'+route,{method,headers:{Origin:requestOrigin,'Content-Type':'application/json','X-Actor-Id':'SYN-ADMIN'},body:body===undefined?undefined:JSON.stringify(body)}),{actor});return{status:response.status,body:await response.json()};};
 const task=async runId=>(await call('reviews')).body.reviews.find(t=>t.runId===runId);
 const decisionBody=(t,action)=>({action,comment:'已核对合成证据与内部草稿范围。',expectedVersionId:t.versionId,requestId:randomUUID()});
 const decide=async(t,action,actor=admin,body=decisionBody(t,action))=>call('reviews/'+t.taskId+'/decision','POST',body,actor);
 const run=async row=>{const result=await call('workflows/'+row.id+'/test','POST',{expectedVersionId:row.versionId});assert.equal(result.status,200,JSON.stringify(result.body));return result.body;};
 try{
  const original=JSON.stringify(syntheticOrders),agents=await studio.storage.getStore('agents'),prior=await agents.getLatestVersion('procurement');
  const baseline=(await call('workflows')).body.workflows[0];assert.equal(baseline.id,'followup');assert.equal((await run(baseline)).result.drafts.length,1);
  const graph=workflowTemplate(true);graph.nodes.find(n=>n.type==='review').params={title:'合成采购审核',role:'admin',reviewerId:'SYN-ADMIN',instructions:'只核对合成证据。',maxAgeMinutes:1};
  const input={name:'合成可视化审核流程',description:'只使用合成工具',...graph,requestId:randomUUID()};
  assert.equal((await call('workflows','POST',input,admin,'https://untrusted.example')).status,403);
  const created=await call('workflows','POST',input);assert.equal(created.status,201,JSON.stringify(created.body));let row=created.body;
  assert.equal((await call('workflows','POST',input)).body.id,row.id,'重复新建不产生另一流程');
  assert.equal((await call('workflows','POST',{...input,name:'不同内容'})).status,409);
  const cyclic=structuredClone(input);cyclic.requestId=randomUUID();cyclic.edges.find(e=>e.from==='draft').to='scan';assert.equal((await call('workflows','POST',cyclic)).status,400);
  const missing=structuredClone(input);missing.requestId=randomUUID();missing.edges=missing.edges.filter(e=>e.port!=='rejected');assert.equal((await call('workflows','POST',missing)).status,400);
  const shell=structuredClone(input);shell.requestId=randomUUID();shell.nodes[1].type='shell';assert.equal((await call('workflows','POST',shell)).status,400);
  const first=await run(row);assert.equal(first.status,'suspended');let pending=await task(first.runId);assert.equal(pending.payload.drafts.length,0);assert.equal(pending.status,'pending');
  assert.equal((await decide(pending,'approve',null)).status,401,'伪造身份头不提供审核权限');
  assert.equal((await decide(pending,'approve',programmer)).status,403);
  assert.equal((await decide(pending,'approve',{...admin,id:'OTHER-ADMIN'})).status,403);
  assert.equal((await decide(pending,'defer')).status,200);pending=await task(first.runId);assert.equal(pending.status,'deferred');assert.equal(pending.audit.length,1);
  const approval=decisionBody(pending,'approve'),responses=await Promise.all([decide(pending,'approve',admin,approval),decide(pending,'approve',admin,approval)]);for(const r of responses){assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.execution.status,'success');assert.equal(r.body.execution.result.drafts.length,1);}
  pending=await task(first.runId);assert.equal(pending.audit.length,2,'相同审核请求只记录一次决定');assert.equal((await decide(pending,'approve')).status,409);
  const second=await run(row),rejected=await decide(await task(second.runId),'reject');assert.equal(rejected.status,200,JSON.stringify(rejected.body));assert.equal(rejected.body.execution.result.drafts.length,0);assert.equal(rejected.body.execution.result.nodeStates.draft.status,'skipped');
  const lostReceipt=await run(row),lostTask=await task(lostReceipt.runId),lostBody=decisionBody(lostTask,'approve'),ledger=await studio.storage.getStore('workflowDefinitions'),upsert=ledger.upsert.bind(ledger);let interrupted=false;
  ledger.upsert=async input=>{if(!interrupted&&input.metadata?.payload?.execution){interrupted=true;throw new Error('synthetic receipt interruption');}return upsert(input);};
  try{assert.equal((await decide(lostTask,'approve',admin,lostBody)).status,503);}finally{ledger.upsert=upsert;}
  const recovered=await decide(lostTask,'approve',admin,lostBody);assert.equal(recovered.status,200,JSON.stringify(recovered.body));assert.equal(recovered.body.execution.result.drafts.length,1,'回执中断后回读已有执行结果，不重新执行');assert.equal((await task(lostReceipt.runId)).audit.length,1);
  const expired=await run(row);clock+=60001;assert.equal((await decide(await task(expired.runId),'approve')).status,409,'过期不等于批准');
  const staleSource=await run(row);source='synthetic-source-v2';assert.equal((await decide(await task(staleSource.runId),'approve')).status,409,'来源变化须重新审核');source='synthetic-source-v1';
  const staleVersion=await run(row),{versionId,versionNumber,id:workflowId,publishedVersionId,hasDraft,runtimeId,createdAt,...config}=row;
  const saved=await call('workflows/'+row.id,'PATCH',{...config,name:'合成流程改名',expectedVersionId:row.versionId});assert.equal(saved.status,200,JSON.stringify(saved.body));row=saved.body;
  assert.equal((await decide(await task(staleVersion.runId),'approve')).status,409,'草稿试运行绑定保存版本');
  assert.equal((await call('workflows/'+row.id,'PATCH',{...config,expectedVersionId:versionId})).status,409);
  const published=await call('workflows/'+row.id+'/publish','POST',{expectedVersionId:row.versionId});assert.equal(published.status,200);row=published.body;
  for(const key of ['followup','synthetic-procurement-followup',row.id])for(const suffix of ['/resume','/restart','/time-travel','/runs/fake/steps/execute'])assert.equal((await studio.handle(new Request(origin+'/studio/api/workflows/'+key+suffix,{method:'POST',body:'{}',headers:{'Content-Type':'application/json'}}))).status,403,key+suffix);
  const bypassRow=(await studio.workflowManager.records('config',row.id)).at(-1),bypassWorkflow=studio.workflowManager.compile(bypassRow,{preview:true,engineId:'bypass-test'}),bypassRun=await bypassWorkflow.createRun();assert.equal((await bypassRun.start({inputData:{}})).status,'suspended');assert.equal((await bypassRun.resume({step:'review',resumeData:{approved:true,actor:admin}})).status,'suspended','直接 resumeData 不能代替审核记录');
  const restartRun=await run(row),restartTask=await task(restartRun.runId);await studio.close();studio=await setup();
  const resumed=await decide(await task(restartRun.runId),'approve');assert.equal(resumed.status,200,JSON.stringify(resumed.body));assert.equal(resumed.body.execution.result.drafts.length,1,'重启后从原审核节点恢复');
  const history=(await call('workflows/'+row.id+'/versions')).body.versions;
  const restored=await call('workflows/'+row.id+'/restore','POST',{expectedVersionId:row.versionId,versionId:history.at(-1).id});assert.equal(restored.status,200);assert.equal(restored.body.hasDraft,true);assert.equal(restored.body.publishedVersionId,row.publishedVersionId);
  assert.equal((await call('workflows/'+row.id,'DELETE',{})).status,405);
  assert.equal((await(await studio.storage.getStore('agents')).getLatestVersion('procurement')).id,prior.id);assert.equal(JSON.stringify(syntheticOrders),original);
  assert.equal(studio.mastra.getEditor().hasEnabledBuilderConfig(),false);
  for(const route of ['/studio/workflow-manager/','/studio/workflow-manager/app.js','/studio/workflow-manager/style.css'])assert.equal((await studio.handle(new Request(origin+route))).status,200);
  assert.equal((await call('reviews')).body.reviews.find(t=>t.taskId===restartTask.taskId).audit[0].actor.id,'SYN-ADMIN');
  const branchGraph=workflowTemplate(true),branch=branchGraph.nodes.find(n=>n.id==='review');branch.type='branch';branch.params={metric:'count',operator:'gte',threshold:2};
  branchGraph.nodes.push({id:'filter',type:'filter',label:'筛选合成条目',x:400,y:400,params:{minMissing:31,supplier:''}},{id:'summary',type:'summary',label:'固定汇总',x:160,y:540,params:{title:'合成摘要'}});
  for(const edge of branchGraph.edges){if(edge.from==='review'){edge.port=edge.port==='approved'?'yes':'no';if(edge.port==='yes')edge.to='filter';}if(edge.from==='draft')edge.to='summary';}
  branchGraph.edges.push({from:'filter',to:'draft',port:'next'},{from:'summary',to:'end',port:'next'});
  const branchCreated=await call('workflows','POST',{name:'合成条件图',description:'',...branchGraph,requestId:randomUUID()});assert.equal(branchCreated.status,201);let branchRow=branchCreated.body;
  const noBranch=await run(branchRow);assert.equal(noBranch.result.nodeStates.filter.status,'skipped');assert.equal(noBranch.result.messages.length,0);
  branchGraph.nodes.find(n=>n.id==='review').params.threshold=1;
  branchRow=(await call('workflows/'+branchRow.id,'PATCH',{name:'合成条件图',description:'',...branchGraph,expectedVersionId:branchRow.versionId})).body;
  const yesBranch=await run(branchRow);assert.equal(yesBranch.result.orders.length,0);assert.equal(yesBranch.result.nodeStates.filter.status,'completed');assert.match(yesBranch.result.messages[0].text,/0 个合成条目/);
  const agentGraph={name:'合成岗位调用',description:'',nodes:[{id:'start',type:'start',label:'开始',x:40,y:40,params:{}},{id:'agent',type:'agent',label:'客服核查',x:40,y:180,params:{agentId:'service',prompt:'核对合成证据并说明执行范围。'}},{id:'end',type:'end',label:'结束',x:40,y:320,params:{}}],edges:[{from:'start',to:'agent',port:'next'},{from:'agent',to:'end',port:'next'}],requestId:randomUUID()};
  const agentCreated=await call('workflows','POST',agentGraph);assert.equal(agentCreated.status,201);const agentResult=await run(agentCreated.body);assert.equal(agentResult.result.messages[0].agentId,'service');assert.match(agentResult.result.messages[0].text,/离线合成演练/);
 }finally{await studio.close();assert(dataDir.startsWith(path.join(os.tmpdir(),'doon-workflow-manager-')));await fs.rm(dataDir,{recursive:true,force:true,maxRetries:5,retryDelay:100}).catch(e=>{if(e.code!=='EBUSY')throw e;});}
});
