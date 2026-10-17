import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {createStudio} from './server.mjs';
import {studioConfig} from '../../standalone/studio.mjs';

const directory=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(directory,'../..');
const dist=path.resolve(root,process.env.DOON_BUILD_DIR||'test-output/mastra-studio-build');
const freePort=()=>new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port));});});

test('真实 Studio、工具委派、工作流、memory 与 trace 均使用独立合成库',async()=>{
 const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'doon-studio-sdk-'));
 let studio=await createStudio({dataDir,deepseekOptions:{env:{}}});
 const origin='http://127.0.0.1:19897';
 try{
  const html=await (await studio.handle(new Request(origin+'/studio/'))).text();
  assert.match(html,/<title>Agent Studio<\/title>/);assert.match(html,/<base href="\/studio\/"/);assert.match(html,/MASTRA_API_PREFIX = '\/studio\/api'/);assert(!html.includes('%%'));
  const asset=html.match(/src="\.\/(assets\/[^\"]+\.js)"/)[1];assert.equal((await studio.handle(new Request(origin+'/studio/'+asset))).status,200);
  assert.equal((await studio.handle(new Request(origin+'/studio/%5cpackage.json'))).status,404);
  const list=await (await studio.handle(new Request(origin+'/studio/api/agents'))).json();assert.equal(Object.keys(list).length,4);assert.equal(list.supervisor.tools.delegateProcurement.id,'delegate-procurement');
  const provider=await (await studio.handle(new Request(origin+'/studio/integrations/deepseek/status?agent=procurement'))).json();assert.equal(provider.model.id,'scripted-studio-v1');assert.equal(provider.model.live,false);
  assert.equal((await studio.handle(new Request(origin+'/studio/integrations/deepseek/status?agent=unknown'))).status,404);
  const memory={thread:'synthetic-thread-'+randomUUID(),resource:'synthetic-reviewer'};
  const first=await studio.agents.supervisor.generate('检查逾期欠料',{memory});
  assert.match(first.text,/已委派采购 Agent/);assert.equal(first.steps.length,3);
  const followup=await studio.agents.supervisor.generate('再检查一次',{memory});assert.equal(followup.steps.length,3,'下一轮不能误用历史工具结果');
  const stream=await studio.agents.procurement.stream('核对供应商复期');let streamed='';for await(const text of stream.textStream)streamed+=text;assert.match(streamed,/未发送企业微信/);
  const workflow=studio.mastra.getWorkflow('followup'),run=await workflow.createRun();
  const outcome=await run.start({inputData:{}});assert.equal(outcome.status,'success');assert.equal(outcome.result.sent,false);assert.equal(outcome.result.drafts.length,1);assert.equal(outcome.result.drafts[0].orderId,'SYN-STUDIO-001');
  await studio.observability.flush();
  const check=new DatabaseSync(path.join(dataDir,'mastra.sqlite'),{readOnly:true});
  try{assert(check.prepare('SELECT COUNT(*) n FROM mastra_ai_spans').get().n>0,'trace 应落到测试库');}finally{check.close();}
  await studio.close();
  studio=await createStudio({dataDir,deepseekOptions:{env:{}}});
  const mem=await studio.agents.supervisor.getMemory(),thread=await mem.getThreadById({threadId:memory.thread});assert.equal(thread.resourceId,memory.resource);
  const saved=await mem.recall({threadId:memory.thread,resourceId:memory.resource});assert(saved.messages.length>0,'重启后会话必须保留');
  assert.equal((await studio.tools.inspectOverdue.execute({})).orders.length,1);
 }finally{await studio.close();await fs.rm(dataDir,{recursive:true,force:true,maxRetries:5,retryDelay:100}).catch(error=>{if(error.code!=='EBUSY')throw error;});}
});

test('默认关闭；显式开启仍拒绝正式端口和非本机监听',async()=>{
 const before=process.env.DOON_STUDIO_ENABLED;
 try{
  delete process.env.DOON_STUDIO_ENABLED;assert.equal(await studioConfig({}),null);
  process.env.DOON_STUDIO_ENABLED='1';
  await assert.rejects(()=>studioConfig({host:'127.0.0.1',port:8787}),/独立端口/);
  await assert.rejects(()=>studioConfig({host:'0.0.0.0',port:19897}),/独立端口/);
 }finally{if(before===undefined)delete process.env.DOON_STUDIO_ENABLED;else process.env.DOON_STUDIO_ENABLED=before;}
});

test('HTTP 入口、静态资源与 API 均校验现有会话、角色、改密和 Origin',async()=>{
 const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'doon-studio-http-')),port=await freePort(),origin=`http://127.0.0.1:${port}`;
 const env={...process.env,DEEPSEEK_API_KEY:'',DEEPSEEK_API_KEY_FILE:'',DOON_STUDIO_MODEL:'offline',DOON_DATA_DIR:dataDir,DOON_HOST:'127.0.0.1',DOON_PORT:String(port),DOON_STUDIO_ENABLED:'1',DOON_SYNTHETIC_ONLY:'1',DOON_STUDIO_DIR:directory,DOON_NO_AUTO_BACKUP:'1'};
 await fs.writeFile(path.join(dataDir,'studio-sandbox.json'),JSON.stringify({kind:'doon-synthetic-studio-v1'}));
 execFileSync(process.execPath,[path.join(dist,'manage.mjs'),'init'],{env,stdio:'pipe',windowsHide:true});
 const initial=(await fs.readFile(path.join(dataDir,'管理员首次登录.txt'),'utf8')).match(/初始密码：([^\r\n]+)/)[1];
 const child=spawn(process.execPath,[path.join(dist,'server.mjs')],{env,stdio:'pipe',windowsHide:true});let errors='';child.stderr.on('data',bytes=>errors+=bytes);child.stdout.on('data',()=>{});
 const request=(route,body,cookie='',originHeader=origin,method=body===undefined?'GET':'POST')=>fetch(origin+route,{method,redirect:'manual',headers:{Origin:originHeader,'Content-Type':'application/json',Cookie:cookie},body:body===undefined?undefined:JSON.stringify(body)});
 const cookieOf=res=>res.headers.get('set-cookie').split(';')[0];
 try{
  let ready=false;for(let i=0;i<80;i++){try{if((await request('/health')).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}assert(ready,errors);
  assert.equal((await request('/studio/')).status,302);assert.equal((await request('/studio/assets/example.js')).status,401);assert.equal((await request('/studio/api/agents')).status,401);
  let res=await request('/api/auth/login',{username:'admin',password:initial}),cookie=cookieOf(res);assert.equal(res.status,200);
  assert.equal((await request('/studio/api/agents',undefined,cookie)).status,403,'初始密码不能进入 Studio');
  res=await request('/api/auth/password',{currentPassword:initial,password:'Synthetic-Studio-Admin-2026!'},cookie);cookie=cookieOf(res);
  assert.equal((await (await request('/api/auth/session',undefined,cookie)).json()).studioAvailable,true);
  const htmlResponse=await request('/studio/',undefined,cookie);assert.equal(htmlResponse.status,200);
  const asset=(await htmlResponse.text()).match(/src="\.\/(assets\/[^\"]+\.js)"/)[1];
  const cancelled=await request('/studio/'+asset,undefined,cookie);await cancelled.body.cancel();
  assert.equal((await request('/health')).status,200,'浏览器取消流式资源请求不能令服务退出');
  assert.equal((await request('/studio/api/agents',undefined,cookie)).status,200);
  assert.equal((await (await request('/studio/integrations/deepseek/status',undefined,cookie)).json()).status,'unconfigured');
  assert.equal((await request('/studio/integrations/deepseek/refresh',{},cookie,'https://example.invalid')).status,403);
  assert.equal((await request('/studio/deepseek.svg',undefined,cookie)).status,200);
  assert.equal((await request('/studio/api/agents',{},cookie,'https://example.invalid')).status,403);
  assert.equal((await request('/studio/api/agents',{},cookie,'https://example.invalid','DELETE')).status,403);
  res=await request('/api/auth/accounts',{username:'studio_sales',name:'合成销售',password:'Synthetic-Sales-Initial-2026!',role:'sales',customers:[]},cookie);assert.equal(res.status,200);
  res=await request('/api/auth/login',{username:'studio_sales',password:'Synthetic-Sales-Initial-2026!'});let salesCookie=cookieOf(res);
  res=await request('/api/auth/password',{currentPassword:'Synthetic-Sales-Initial-2026!',password:'Synthetic-Sales-Personal-2026!'},salesCookie);salesCookie=cookieOf(res);
  assert.equal((await request('/studio/api/agents',undefined,salesCookie)).status,403);
  assert.equal((await request('/studio/integrations/deepseek/status',undefined,salesCookie)).status,403);
  assert.equal((await (await request('/api/auth/session',undefined,salesCookie)).json()).studioAvailable,false);
  await request('/api/auth/logout',{},cookie);
  assert.equal((await request('/studio/api/agents',undefined,cookie)).status,401);
  assert.equal((await request('/studio/integrations/deepseek/status',undefined,cookie)).status,401);
  assert.equal((await request('/studio/assets/example.js',undefined,cookie)).status,401);
 }finally{
  child.kill();await new Promise(resolve=>{if(child.exitCode!==null)resolve();else child.once('exit',resolve);});
  assert(!errors.includes('CLIENT_CLOSED'),errors);
  await fs.rm(dataDir,{recursive:true,force:true});
 }
});
