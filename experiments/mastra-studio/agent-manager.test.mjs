import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createStudio} from './server.mjs';
import {syntheticOrders} from './agents.mjs';

test('自建免费管理入口：草稿、发布、可选工具、并发版本、历史及重启均不改变原数据',async()=>{
 const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'doon-visual-agent-test-'));
 let studio=await createStudio({dataDir,deepseekOptions:{env:{}}});
 const origin='http://127.0.0.1:19897',original=JSON.stringify(syntheticOrders);
 const call=async(route='',method='GET',body,requestOrigin=origin)=>{
  const response=await studio.handle(new Request(origin+'/studio/manage/api/agents'+route,{method,headers:{Origin:requestOrigin,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}));
  return{status:response.status,body:await response.json()};
 };
 const config={name:'合成工程助手',description:'合成岗位配置验证',instructions:'只解释已有证据，未知信息明确列出。',toolKeys:['inspectOverdue']};
 const publish=agent=>call('/'+agent.id+'/publish','POST',{versionId:agent.versionId,expectedVersionId:agent.versionId});
 try{
  const initial=await call();assert.equal(initial.status,200);assert.equal(initial.body.agents.length,4);
  const prior=new Map(initial.body.agents.map(agent=>[agent.id,agent.versionId]));
  assert.equal((await call('','POST',config,'https://untrusted.example')).status,403);
  assert.equal((await call('','POST',{...config,model:{name:'untrusted'}})).status,400);
  assert.equal((await call('','POST',{...config,toolKeys:['shell']})).status,403);
  const createBody={...config,requestId:'11111111-1111-4111-8111-111111111111'};
  const created=await call('','POST',createBody);assert.equal(created.status,201,JSON.stringify(created.body));
  let agent=created.body;assert.match(agent.id,/^visual-/);assert.equal(agent.publishedVersionId,null);
  const replay=await call('','POST',createBody);assert.equal(replay.status,200);assert.equal(replay.body.id,agent.id);
  assert.equal((await call('','POST',{...createBody,name:'同请求不同内容'})).status,409);
  assert.equal(Object.keys(await(await studio.mastra.getAgentById(agent.id,{status:'draft'})).listTools()).length,1);
  await assert.rejects(()=>studio.mastra.getAgentById(agent.id,{status:'published'}),/no version has been published/);
  assert.equal((await studio.handle(new Request(origin+'/studio/api/agents'))).status,200);
  const pub=await publish(agent);assert.equal(pub.status,200,JSON.stringify(pub.body));agent=pub.body;
  const memory={thread:'synthetic-visual-thread',resource:'synthetic-reviewer'};
  const result=await(await studio.mastra.getAgentById(agent.id,{status:'published'})).generate('核对合成输入',{memory});assert.match(result.text,/离线配置验证/);
  const before=await(await studio.agents[agent.id].getMemory()).recall({threadId:memory.thread,resourceId:memory.resource});assert(before.messages.length>0);
  const edits=await Promise.all([
   call('/'+agent.id,'PATCH',{...config,name:'合成工程助手新版',toolKeys:[],expectedVersionId:agent.versionId}),
   call('/'+agent.id,'PATCH',{...config,name:'不应覆盖的并发版本',expectedVersionId:agent.versionId}),
  ]);assert.deepEqual(edits.map(response=>response.status).sort(),[200,409]);agent=edits.find(response=>response.status===200).body;
  assert.equal(studio.agents[agent.id].name,config.name,'草稿改名不影响已发布运行时');
  assert.deepEqual(Object.keys(await(await studio.mastra.getAgentById(agent.id,{status:'published'})).listTools()),['inspectOverdue']);
  const published=await publish(agent);assert.equal(published.status,200);agent=published.body;
  assert.equal(studio.agents[agent.id].name,'合成工程助手新版');assert.deepEqual(Object.keys(await studio.agents[agent.id].listTools()),[]);
  const procurement=(await call('/procurement')).body;
  assert.equal((await call('/procurement','PATCH',{...config,toolKeys:['delegateProcurement'],expectedVersionId:procurement.versionId})).status,403);
  assert.equal((await call('/'+agent.id+'/restore','POST',{versionId:procurement.versionId,expectedVersionId:agent.versionId})).status,404);
  const history=await call('/'+agent.id+'/versions');assert.equal(history.body.versions.length,2);
  const restored=await call('/'+agent.id+'/restore','POST',{versionId:created.body.versionId,expectedVersionId:agent.versionId});assert.equal(restored.status,200);
  assert.equal(restored.body.versionNumber,3);assert.equal(studio.agents[agent.id].name,'合成工程助手新版','还原不会自动发布');
  assert.equal((await call('/'+agent.id,'DELETE',{})).status,405);
  await studio.close();studio=await createStudio({dataDir,deepseekOptions:{env:{}}});
  const loaded=(await call('/'+agent.id)).body;assert.equal(loaded.id,agent.id);assert.equal(loaded.name,config.name,'未发布的还原草稿仍保留');
  assert.equal(studio.agents[agent.id].name,'合成工程助手新版','重启保留正式版本与工具选择');
  const after=await(await studio.agents[agent.id].getMemory()).recall({threadId:memory.thread,resourceId:memory.resource});assert.deepEqual(after.messages,before.messages);
  for(const [id,versionId] of prior)assert.equal((await call('/'+id)).body.versionId,versionId,'原岗位版本未被新建流程覆盖');
  assert.equal(JSON.stringify(syntheticOrders),original);
  assert.equal(studio.mastra.getEditor().hasEnabledBuilderConfig(),false);
  for(const route of ['/studio/manage/','/studio/manage/app.js','/studio/manage/style.css','/studio/agent-manager-entry.js'])assert.equal((await studio.handle(new Request(origin+route))).status,200);
  const html=await(await studio.handle(new Request(origin+'/studio/'))).text();
  assert.match(html,/src="\/studio\/agent-manager-entry.js"/);assert.doesNotMatch(html,/＋ 新建 Agent/,'全局顶部没有新建按钮');
 }finally{
  await studio.close();assert(dataDir.startsWith(path.join(os.tmpdir(),'doon-visual-agent-test-')));
  await fs.rm(dataDir,{recursive:true,force:true,maxRetries:5,retryDelay:100}).catch(error=>{if(error.code!=='EBUSY')throw error;});
 }
});
