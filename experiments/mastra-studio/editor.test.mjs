import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createStudio} from './server.mjs';
import {syntheticOrders} from './agents.mjs';

test('免费 Editor 草稿、发布、历史还原、重启持久化和岗位边界',async()=>{
 const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'doon-editor-test-'));
 let studio=await createStudio({dataDir,deepseekOptions:{env:{}}});
 const source=JSON.stringify(syntheticOrders);
 const call=async(route,method='GET',body)=>{
  const res=await studio.handle(new Request('http://127.0.0.1:19897/studio/api/'+route,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}));
  return{status:res.status,body:await res.json()};
 };
 const instructions=async(status='published')=>(await studio.mastra.getAgentById('procurement',{status})).getInstructions();
 try{
  assert.equal(studio.mastra.getEditor().hasEnabledBuilderConfig(),false);
  assert.equal((await call('editor/builder/settings')).body.enabled,false);
  const metadata=await call('agents/procurement');assert.equal(metadata.status,200);
  assert.deepEqual(metadata.body.editor,{instructions:true,tools:{description:true}});
  const rendered=await call('stored/agents/preview-instructions','POST',{blocks:[{type:'text',content:'合成预览 {{label}}'}],context:{label:'通过'}});
  assert.equal(rendered.status,200,JSON.stringify(rendered.body));assert.equal(rendered.body.result,'合成预览 通过');
  const baseline=await instructions();
  const model=await studio.agents.procurement.getModel();
  const initial=await call('stored/agents/procurement/versions');assert.equal(initial.body.total,1);
  const baselineVersion=initial.body.versions[0];
  const draft='合成 Editor 草稿：请先核对证据，再说明未知项。';
  let response=await call('stored/agents/procurement','PATCH',{instructions:draft,model:{provider:'untrusted',name:'untrusted'},name:'伪造岗位',workspace:{type:'inline',config:{}},mcpClients:{untrusted:{}}});
  assert.equal(response.status,200,JSON.stringify(response.body));
  assert.equal(await instructions(),baseline,'保存不能立即影响发布版本');
  assert.equal(await instructions('draft'),draft,'草稿应独立可预览');
  assert.equal(studio.agents.procurement.name,'采购 Agent');
  assert.equal((await(await studio.mastra.getAgentById('procurement',{status:'draft'})).getModel()).modelId,model.modelId);
  const saved=await call('stored/agents/procurement/versions');assert.equal(saved.body.total,2);
  const latest=saved.body.versions.find(v=>v.instructions===draft);assert(latest);
  assert.equal((await call('stored/agents/procurement/versions/'+latest.id+'/activate','POST',{})).status,200);
  assert.equal(await instructions(),draft);
  const toolsBefore=await studio.agents.procurement.listTools();
  response=await call('stored/agents/procurement','PATCH',{instructions:draft,tools:{inspectOverdue:{description:'合成工具说明编辑验证'}}});assert.equal(response.status,200);
  const preview=await studio.mastra.getAgentById('procurement',{status:'draft'});
  assert.equal((await preview.listTools()).inspectOverdue.description,'合成工具说明编辑验证');
  assert.deepEqual(Object.keys(await preview.listTools()),Object.keys(toolsBefore));
  assert.equal((await call('stored/agents/procurement','PATCH',{tools:{shell:{description:'不应新增'}}})).status,403);
  for(const [route,method,body] of [
   ['stored/agents','POST',{id:'unregistered',name:'不应创建',instructions:'test'}],
   ['stored/agents/procurement','DELETE',undefined],
   ['stored/agents/procurement/versions/'+baselineVersion.id,'DELETE',undefined],
   ['stored/mcp-clients','POST',{name:'untrusted'}],
   ['stored/workspaces','POST',{name:'untrusted'}],
   ['agents/procurement/clone','POST',{name:'untrusted'}],
   ['stored/agents/unknown/versions/fake/activate','POST',{}],
  ])assert.equal((await call(route,method,body)).status,403,route);
  assert.equal((await call('stored/agents/procurement/versions/'+baselineVersion.id+'/restore','POST',{})).status,200);
  assert.equal(await instructions(),draft,'还原先创建草稿，不自动发布');
  assert.equal(await instructions('draft'),baseline);
  await studio.close();studio=await createStudio({dataDir,deepseekOptions:{env:{}}});
  assert.equal(await instructions(),draft,'重启保留已发布配置');
  assert.equal(await instructions('draft'),baseline,'重启保留未发布草稿');
  // The upstream handlers normally remove history after 50 versions.
  for(let i=0;i<51;i++){
   const result=await call('stored/agents/procurement','PATCH',{instructions:'合成历史保存验证 '+i});
   assert.equal(result.status,200,JSON.stringify(result.body));
  }
  const versions=await call('stored/agents/procurement/versions?perPage=100');assert(versions.body.total>50);
  assert(versions.body.versions.some(v=>v.id===baselineVersion.id),'最早历史版本必须保留');
  assert.equal(await instructions(),draft,'后续草稿不影响正式选择');
  assert.equal((await call('stored/agents/procurement','PATCH',{instructions:'合成显式保存并发布',autoPublish:true})).status,200);
  assert.equal(await instructions(),'合成显式保存并发布','显式 Save & Publish 与普通草稿保存必须区分');
  assert.equal(JSON.stringify(syntheticOrders),source,'原合成业务来源未变');
 }finally{
  await studio.close();
  assert(dataDir.startsWith(path.join(os.tmpdir(),'doon-editor-test-')));
  await fs.rm(dataDir,{recursive:true,force:true,maxRetries:5,retryDelay:100}).catch(e=>{if(e.code!=='EBUSY')throw e;});
 }
});
