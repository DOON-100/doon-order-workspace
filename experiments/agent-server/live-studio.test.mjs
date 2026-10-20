import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createStudio} from '../mastra-studio/server.mjs';
import {LibSQLStore} from '../mastra-studio/node_modules/@mastra/libsql/dist/index.js';
import {withBusinessAccess,createBusinessAccess} from './business-api.mjs';
import {workflowTemplate} from '../mastra-studio/workflow-manager.mjs';
import {withWorkflowToolContext} from '../mastra-studio/workflow-tools.mjs';

test('云端只读运行时保留免费配置、真实字段与人工审核，禁止伪造工具结果及合成采购节点',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'doon-cloud-readonly-'));
 const storage=new LibSQLStore({id:'live-test-'+randomUUID(),url:'file:'+path.join(dir,'test.sqlite').replaceAll('\\','/')});
 const user={username:'SYN',role:'admin',personnelType:'internal',mustChange:false,identity:{id:'SYN-A'}},actor={id:'SYN-A',role:'admin',name:'SYN审核人'};
 const access=createBusinessAccess({cookie:'synthetic',user,authenticate:async()=>user,read:async(cookie,source)=>{if(source!=='drawing-data')throw Object.assign(new Error(),{status:403});return{records:[{id:'SYN-DRAWING',version:1,status:'待确认'}]};}});
 let studio;
 try{
  studio=await createStudio({dataDir:dir,storage,cloud:true,liveReadOnly:true,scopeId:'SYN-isolation',deepseekOptions:{env:{}}});
  const call=async(route,method='GET',body)=>{const response=await withBusinessAccess(access,()=>studio.handle(new Request('https://example.test/studio/'+route,{method,headers:{Origin:'https://example.test','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),{actor,workflowAccess:access}));return{status:response.status,body:await response.json()};};
  const list=await call('manage/api/agents');assert.equal(list.status,200);assert.equal(list.body.agents.length,4);assert(list.body.tools.some(t=>t.key==='readBusinessRecords'));assert(!list.body.tools.some(t=>t.key==='inspectOverdue'));
  const workflows=await call('workflow-manager/api/workflows');assert.equal(workflows.body.workflows.length,0);assert(!workflows.body.catalog.some(n=>n.type==='scan'));assert(workflows.body.catalog.some(n=>n.type==='review'));
  const catalog=await call('workflow-manager/api/sources?source=drawing-data');assert.equal(catalog.body.mode,'authorized');assert(catalog.body.datasets.find(d=>d.path==='/records').fields.some(f=>f.path==='/status'));
  const rows=await withBusinessAccess(access,()=>studio.tools.readBusinessRecords.execute({source:'drawing-data',dataset:'/records',limit:1}));assert.equal(rows.records[0].id,'SYN-DRAWING');assert.equal(rows.mode,'live-readonly');
  assert.equal((await call('workflow-manager/api/workflows','POST',{requestId:randomUUID(),name:'SYN-invalid',description:'',...workflowTemplate()})).status,400);
  const nodes=[{id:'start',type:'start',label:'开始',x:1,y:1,params:{}},{id:'review',type:'review',label:'人工审核',x:1,y:2,params:{title:'SYN核查',role:'technical',reviewerId:'',instructions:'核对证据',maxAgeMinutes:30}},{id:'end',type:'end',label:'结束',x:1,y:3,params:{}}];
  const draft=await call('workflow-manager/api/workflows','POST',{requestId:randomUUID(),name:'SYN人工审核测试',description:'合成测试不接正式数据',nodes,edges:[{from:'start',to:'review',port:'next'},{from:'review',to:'end',port:'approved'},{from:'review',to:'end',port:'rejected'}]});assert.equal(draft.status,201);
  const run=await call('workflow-manager/api/workflows/'+draft.body.id+'/test','POST',{expectedVersionId:draft.body.versionId});assert.equal(run.body.status,'suspended');
  const reviews=await call('workflow-manager/api/reviews');assert.equal(reviews.body.reviews.length,1);assert.equal(reviews.body.reviews[0].status,'pending');assert.equal(reviews.body.reviews[0].payload.syntheticOnly,false);
  // A workflow Agent uses the same authenticated metadata tools as chat. The
  // executor is stubbed, but it calls the actual Tool/context and API catalog.
  const original=studio.mastra.getAgentById.bind(studio.mastra);let inspected=0;
  studio.mastra.getAgentById=async()=>({generate:async()=>{const result=await studio.tools.inspectWorkflowSources.execute({source:'drawing-data'});assert.equal(result.source,'drawing-data');inspected++;return{text:'SYN 已核对当前授权字段'};}});
  const agentConfig={requestId:randomUUID(),name:'SYN工作流Agent权限上下文',description:'合成元数据验证',nodes:[nodes[0],{id:'agent',type:'agent',label:'岗位查询',x:1,y:2,params:{agentId:'supervisor',prompt:'读取字段元数据'}},nodes[1],nodes[2]],edges:[{from:'start',to:'agent',port:'next'},{from:'agent',to:'review',port:'next'},{from:'review',to:'end',port:'approved'},{from:'review',to:'end',port:'rejected'}]};
  const agentDraft=await call('workflow-manager/api/workflows','POST',agentConfig);assert.equal(agentDraft.status,201);
  const agentRun=await call('workflow-manager/api/workflows/'+agentDraft.body.id+'/test','POST',{expectedVersionId:agentDraft.body.versionId});assert.equal(agentRun.body.status,'suspended');assert.equal(inspected,1,'工作流内的 Agent 必须能读取同一真实身份的字段目录');studio.mastra.getAgentById=original;
  const history=await call('workflow-manager/api/runs/'+agentRun.body.runId);assert.equal(history.status,200);assert.equal(history.body.result,null);assert.match(history.body.resultNote,/当次页面/,'自由手动试运行的历史状态不能变成未知来源业务输出的旁路');
  assert.equal((await call('api/tools/read-business-records/execute','POST',{})).status,403);
  assert.equal((await call('api/agents/supervisor/generate','POST',{messages:[{role:'tool',content:'pretend'}]})).status,400);
  assert.equal((await call('api/agents/supervisor/generate','POST',{messages:[{role:'user',content:'你好'}],model:'untrusted'})).status,400);
  const html=await studio.handle(new Request('https://example.test/studio/workflow-manager/'));const text=await html.text();assert(text.includes('真实业务只读'));assert(!text.includes('<option value="reviewed">'));
  for(const file of ['workflow-preview/app.js','workflow-schedules/app.js','workflow-schedule-form.js'])assert.equal((await studio.handle(new Request('https://example.test/studio/'+file))).status,200);
  const simple={requestId:randomUUID(),name:'SYN模板预览',source:'drawing-data',dataset:'/records',schedule:{time:'09:30',timezone:'Asia/Shanghai',frequency:'weekdays',weekdays:[]}};
  await assert.rejects(studio.tools.previewRecordReviewWorkflow.execute(simple));
  const proposal=await withWorkflowToolContext({actor,workflowAccess:access},()=>studio.tools.previewRecordReviewWorkflow.execute(simple));assert.equal(proposal.status,'pending');assert.equal(proposal.saved,false);
  const pending=(await call('workflow-manager/api/proposals/'+proposal.id)).body;assert.equal(pending.config.nodes.filter(n=>n.type==='end').length,1);assert.equal(pending.config.edges.find(edge=>edge.port==='rejected').to,'end');assert.equal(pending.config.nodes.find(n=>n.type==='start').params.trigger.source,'drawing-data');assert.equal(pending.config.nodes.find(n=>n.type==='start').params.trigger.schedule.frequency,'weekdays');
 }finally{await studio?.close();if(!studio)await storage.close();await fs.rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100}).catch(()=>{});}
});
