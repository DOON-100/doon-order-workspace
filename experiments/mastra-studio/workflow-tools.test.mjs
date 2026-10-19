import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createStudio} from './server.mjs';
import {workflowToolDemo} from './agents.mjs';
import {withWorkflowToolContext} from './workflow-tools.mjs';
import {defaultTrigger} from './workflow-triggers.mjs';
import {createWorkflowManager} from './workflow-manager.mjs';

test('Agent preview → user confirmation: identity, graph validation, permissions, cancellation, idempotency, real review and restart',async()=>{
 const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'doon-workflow-tools-'));
 let studio=await createStudio({dataDir,deepseekOptions:{env:{}}});
 const origin='http://127.0.0.1:19897',actor={id:'SYN-TOOL-ADMIN',name:'合成管理员',role:'admin',synthetic:true},other={...actor,id:'SYN-OTHER'};
 const call=async(route,method='GET',body,identity=actor,requestOrigin=origin)=>{
  const response=await studio.handle(new Request(origin+'/studio/workflow-manager/api/'+route,{method,headers:{Origin:requestOrigin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),{actor:identity});return{status:response.status,body:await response.json()};
 };
 const list=async()=>(await call('workflows')).body.workflows;
 const tool=()=>studio.tools.previewWorkflow;
 const preview=(input,extra={})=>withWorkflowToolContext({actor,...extra},()=>tool().execute(input));
 const confirm=(p,extra={},identity=actor,requestOrigin=origin)=>call('proposals/'+p.id+'/confirm','POST',{expectedVersionId:p.versionId,...extra},identity,requestOrigin);
 try{
  const before=await list(),agents=await studio.storage.getStore('agents'),prior=await agents.getLatestVersion('supervisor');
  const input=workflowToolDemo();
  await assert.rejects(tool().execute(input),/管理身份/);
  await assert.rejects(preview(input,{actor:{...actor,role:'sales'}}),/管理身份/);
  const invalid=structuredClone(input);invalid.edges=invalid.edges.filter(e=>e.port!=='rejected');await assert.rejects(preview(invalid),/出口/);
  const unsafe=structuredClone(input);unsafe.nodes[1].type='shell';assert.notEqual((await preview(unsafe)).status,'pending');
  const fieldInput=workflowToolDemo();fieldInput.nodes[0].params.trigger={...defaultTrigger(),mode:'change',source:'drawing-data',dataset:'/records',watchFields:['/secret']};
  await assert.rejects(preview(fieldInput,{workflowAccess:{catalog:async()=>{throw new Error('合成字段权限拒绝');}}}),/权限拒绝/);
  assert.equal((await studio.workflowManager.records('proposal')).length,0,'失败验证不保存预览');
  const first=await preview(input);assert.equal(first.status,'pending');assert.equal(first.saved,false);assert.equal(first.published,false);assert.equal(first.executed,false);
  assert.equal((await list()).length,before.length,'Agent Tool 返回预览时没有创建工作流');
  const repeat=await preview(input);assert.equal(repeat.id,first.id);assert.equal((await studio.workflowManager.records('proposal')).length,1);
  await assert.rejects(preview(input,{actor:other}),/已被使用/);
  assert.equal((await call('proposals/'+first.id,'GET',undefined,other)).status,404);
  assert.equal((await confirm(first,{},other)).status,404);
  assert.equal((await confirm(first,{},actor,'https://untrusted.example')).status,403);
  assert.equal((await confirm({...first,versionId:'stale-version'})).status,409);
  assert.equal((await confirm(first,{config:{name:'forged'}})).status,400,'确认只接受保存的版本，不接受浏览器替换配置');
  const concurrent=await Promise.all([confirm(first),confirm(first)]),accepted=concurrent[0];for(const result of concurrent){assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.status,'confirmed');}
  const workflowId=accepted.body.workflowId;assert.equal((await list()).length,before.length+1);assert(!studio.mastra.listWorkflows()[workflowId],'确认保存不自动发布或运行');
  assert.equal((await confirm(first)).body.workflowId,workflowId);assert.equal((await list()).length,before.length+1,'重复点击确认只保存一个工作流');
  const collision=workflowToolDemo();assert.equal((await call('workflows','POST',collision)).status,201);const collisionPreview=await preview(collision);assert.equal((await confirm(collisionPreview)).status,409,'不能把独立创建的同 ID 工作流冒充成此次预览的保存结果');
  const cancelled=await preview(workflowToolDemo());assert.equal((await call('proposals/'+cancelled.id+'/cancel','POST',{expectedVersionId:cancelled.versionId})).body.status,'cancelled');assert.equal((await confirm(cancelled)).status,409);
  const afterCollision=(await list()).length,permissionInput=workflowToolDemo();permissionInput.nodes[0].params.trigger={...defaultTrigger(),mode:'change',source:'drawing-data',dataset:'/records',watchFields:['/status']};const permissionPreview=await preview(permissionInput);
  const denied=await studio.handle(new Request(origin+'/studio/workflow-manager/api/proposals/'+permissionPreview.id+'/confirm',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({expectedVersionId:permissionPreview.versionId})}),{actor,workflowAccess:{catalog:async()=>{throw Object.assign(new Error('字段权限已撤销'),{status:403});}}});assert.equal(denied.status,403,'预览后撤销字段权限，确认不能保存');assert.equal((await list()).length,afterCollision);
  let clock=Date.now();const timed=await createWorkflowManager({...studio,sourceFingerprint:()=>'',now:()=>clock}),expiring=await timed.previewDraft(workflowToolDemo(),{actor});clock+=31*60000;
  const expired=await timed.handle(new Request(origin+'/studio/workflow-manager/api/proposals/'+expiring.id+'/confirm',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({expectedVersionId:expiring.versionId})}),{actor});assert.equal(expired.status,409,'过期预览不能保存');
  const catalog=await withWorkflowToolContext({actor,workflowAccess:{catalog:async()=>({mode:'authorized',datasets:[],sample:{secret:'SYN-PRIVATE'}})}},()=>studio.tools.inspectWorkflowSources.execute({source:'drawing-data'}));assert.equal(catalog.sample,undefined);
  const http=async(identity,requestOrigin=origin)=>{
   const response=await studio.handle(new Request(origin+'/studio/api/agents/supervisor/generate',{method:'POST',headers:{Origin:requestOrigin,'Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:'/工作流工具演练'}],requestContext:{actor,workflowAccess:{}}})}),{actor:identity});assert.equal(response.status,200,await response.clone().text());return response.json();
  };
  const proposalsBefore=(await studio.workflowManager.records('proposal')).length;
  await http(undefined);await http(actor,'https://untrusted.example');assert.equal((await studio.workflowManager.records('proposal')).length,proposalsBefore,'伪造上下文和跨站调用不能生成预览');
  const reply=await http(actor);assert((reply.toolCalls||[]).some(c=>(c.payload?.toolName||c.toolName)==='previewWorkflow'));assert.match(reply.text,/\[预览工作流\]\(\/studio\/workflow-preview\/\?id=proposal-/);
  assert.equal((await list()).length,afterCollision,'真实 Agent HTTP 对话也只有预览，没有偷偷创建');
  const stored=(await call('workflows/'+workflowId)).body;assert(stored.nodes.some(n=>n.type==='review'));assert.equal(stored.publishedVersionId,null);
  const run=await call('workflows/'+workflowId+'/test','POST',{expectedVersionId:stored.versionId});assert.equal(run.body.status,'suspended','确认保存的人工审核节点真实暂停');
  assert.equal((await agents.getLatestVersion('supervisor')).id,prior.id,'保全既有 Agent 配置版本');
  const pending=await preview(workflowToolDemo());await studio.close();studio=await createStudio({dataDir,deepseekOptions:{env:{}}});
  assert.equal((await call('proposals/'+pending.id)).body.status,'pending');assert.equal((await confirm(pending)).body.status,'confirmed','重启后原对话预览仍可确认');
  assert((await(await studio.mastra.getAgentById('supervisor',{status:'published'})).listTools()).previewWorkflow,'已有 Agent 重启后仍可调用预览工具');
 }finally{await studio.close();assert(path.resolve(dataDir).startsWith(path.resolve(os.tmpdir(),'doon-workflow-tools-')));await fs.rm(dataDir,{recursive:true,force:true,maxRetries:5,retryDelay:100}).catch(error=>{if(error.code!=='EBUSY')throw error;});}
});
