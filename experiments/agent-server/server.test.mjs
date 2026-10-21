import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createAgentServer} from './http-server.mjs';
import {parsePublicOrigin,sessionCookie,canEnterStudio,SessionCheckError} from './session.mjs';

const client=(port,path,{method='GET',headers={},body}={})=>new Promise((resolve,reject)=>{
 const request=http.request({hostname:'127.0.0.1',port,path,method,headers},response=>{const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:response.statusCode,headers:response.headers})));response.on('error',reject);});request.on('error',reject);request.end(body);
});

test('auth failures distinguish temporary, expired and forbidden without invoking or replaying actions',async()=>{
 let mode='AUTH_TIMEOUT',actions=0;
 const server=createAgentServer({publicOrigin:'https://example.test',authenticate:async()=>{if(mode==='expired')return null;if(mode==='verified')return{username:'SYN',role:'admin',personnelType:'internal',mustChange:false};throw new SessionCheckError(mode);},studio:{handle:async()=>{actions++;return Response.json({ok:true});}}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
 const call=(path,options={})=>client(port,path,{...options,headers:{Host:'example.test',Origin:'https://example.test',...options.headers}});
 try{
  for(mode of ['AUTH_TIMEOUT','AUTH_UNAVAILABLE','AUTH_BUSY']){
   const response=await call('/studio/api/save',{method:'POST',body:'SYN'});assert.equal(response.status,503);assert.equal(response.headers.get('X-Doon-Auth-Status'),'temporary');assert.equal(response.headers.get('location'),null);assert.equal((await response.json()).code,mode);
   const page=await call('/studio/',{headers:{Accept:'text/html'}});assert.equal(page.status,503);assert.equal(page.headers.get('cache-control'),'no-store');assert.match(await page.text(),/重新检查并打开工作台/);assert.equal(page.headers.get('location'),null);
  }
  mode='AUTH_FORBIDDEN';const denied=await call('/studio/api/save',{method:'POST'});assert.equal(denied.status,403);assert.equal(denied.headers.get('X-Doon-Auth-Status'),'forbidden');
  mode='expired';const expired=await call('/studio/api/save',{method:'POST'});assert.equal(expired.status,401);assert.equal((await expired.json()).code,'AUTH_EXPIRED');assert.equal(expired.headers.get('X-Doon-Auth-Status'),'expired');assert.equal(actions,0);
  mode='verified';const accepted=await call('/studio/api/save',{method:'POST',body:'SYN'});assert.equal(accepted.status,200);assert.equal(accepted.headers.get('X-Doon-Auth-Status'),'verified');assert.equal(actions,1);
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test('disconnect during gateway authentication cancels its waiter before Studio is invoked',async()=>{
 let entered,cancelled,actions=0;const started=new Promise(resolve=>entered=resolve),aborted=new Promise(resolve=>cancelled=resolve);
 const server=createAgentServer({publicOrigin:'https://example.test',authenticate:async(_cookie,{signal})=>{entered();return new Promise((_,reject)=>signal.addEventListener('abort',()=>{cancelled();reject(new SessionCheckError('AUTH_CANCELLED'));},{once:true}));},studio:{handle:()=>{actions++;return Response.json({ok:true});}}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const request=http.get({hostname:'127.0.0.1',port:server.address().port,path:'/studio/api/agents',headers:{Host:'example.test'}});request.on('error',()=>{});
 try{await started;request.destroy();await Promise.race([aborted,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('authentication was not cancelled')),1000);timer.unref();})]);assert.equal(actions,0);}
 finally{request.destroy();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('HTTPS origin、会话筛选和角色策略拒绝不明确的授权',()=>{
 assert.throws(()=>parsePublicOrigin('http://example.test'));assert.throws(()=>parsePublicOrigin('https://user:secret@example.test'));assert.throws(()=>parsePublicOrigin('https://example.test/path'));
 assert.equal(sessionCookie('other=secret; doon_employee_session='+'a'.repeat(43)),'doon_employee_session='+'a'.repeat(43));assert.equal(sessionCookie('doon_session=invalid'),'');
 for(const user of [null,{username:'test',mustChange:true,role:'admin',personnelType:'internal'},{username:'test',mustChange:false,role:'admin',personnelType:'external'},{username:'test',mustChange:false,role:'programmer'},{username:'test',personnelType:'internal',mustChange:false,role:'admin',active:false},{username:'test',personnelType:'internal',mustChange:false,role:'supplier'},{role:'admin'}])assert.equal(canEnterStudio(user),false);
 for(const role of ['admin','pmc','production','clerk','sales','finance','programmer','viewer'])assert.equal(canEnterStudio({username:'test',role,personnelType:'internal',mustChange:false}),true);
});
test('真实 HTTP 网关逐次鉴权、保护静态和 API、校验 Origin、不转发 Cookie',async()=>{
 let revoked=false,unavailable=false,calls=0;
 const server=createAgentServer({publicOrigin:'https://example.test',authenticate:async cookie=>{calls++;if(unavailable)throw new Error('private auth detail');if(revoked||!cookie)return null;return{username:'synthetic',identity:{id:'SYN-REAL-ID',name:'合成登录用户'},role:['sales','internal-sales'].includes(cookie)?'sales':'admin',personnelType:['sales','external-admin'].includes(cookie)?'external':'internal',mustChange:cookie==='initial'};},studio:{handle:async(request,context)=>Response.json({ok:true,cookie:request.headers.get('cookie'),authorization:request.headers.get('authorization'),actor:context?.actor})}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
 const request=(path,{cookie,method='GET',origin='https://example.test',host='example.test'}={})=>client(port,path,{method,headers:{Host:host,...(cookie?{Cookie:cookie}:{}),...(method==='GET'?{}:{Origin:origin}),'X-Role':'admin',Authorization:'untrusted'}});
 try{
  assert.equal((await request('/health',{host:'127.0.0.1'})).status,200);
  assert.equal((await request('/agent-studio-entry.js')).status,200);
  assert.equal((await request('/studio/')).status,302);assert.equal((await request('/studio/api/agents')).status,401);assert.equal((await request('/studio/assets/test.js')).status,401);
  assert.equal((await request('/studio/',{cookie:'sales'})).status,403);assert.equal((await request('/studio/',{cookie:'initial'})).status,403);
  assert.equal((await request('/studio/',{cookie:'external-admin'})).status,403);
  assert.equal((await request('/studio/api/agents',{cookie:'internal-sales'})).status,200,'内部销售不再受管理员/程序员角色限制');
  assert.equal((await request('/studio/api/agents',{cookie:'valid',method:'POST',origin:'https://evil.test'})).status,403);
  const editorRoute='/studio/api/stored/agents/procurement';
  assert.equal((await request(editorRoute,{method:'PATCH'})).status,401,'Editor 保存同样需要现有会话');
  assert.equal((await request(editorRoute,{cookie:'sales',method:'PATCH'})).status,403,'普通员工不能编辑岗位');
  assert.equal((await request(editorRoute,{cookie:'valid',method:'PATCH',origin:'https://evil.test'})).status,403,'Editor 保存拒绝跨站请求');
  assert.equal((await request(editorRoute,{cookie:'valid',method:'PATCH'})).status,200);
  const managerRoute='/studio/manage/api/agents';
  assert.equal((await request('/studio/manage/')).status,401,'管理界面同样必须登录');
  assert.equal((await request(managerRoute,{method:'POST'})).status,401);
  assert.equal((await request(managerRoute,{cookie:'sales',method:'POST'})).status,403);
  assert.equal((await request(managerRoute,{cookie:'valid',method:'POST',origin:'https://evil.test'})).status,403);
  assert.equal((await request(managerRoute,{cookie:'valid',method:'POST'})).status,200);
  const reviewRoute='/studio/workflow-manager/api/reviews/synthetic-review/decision';
  assert.equal((await request('/studio/workflow-manager/')).status,401);
  assert.equal((await request(reviewRoute,{cookie:'sales',method:'POST'})).status,403);
  assert.equal((await request(reviewRoute,{cookie:'valid',method:'POST',origin:'https://evil.test'})).status,403);
  const reviewActor=await(await request(reviewRoute,{cookie:'valid',method:'POST'})).json();assert.deepEqual(reviewActor.actor,{id:'SYN-REAL-ID',name:'合成登录用户',role:'admin'},'审核身份由认证会话提供，不采用客户端角色头');
  assert.equal((await request('/studio/api/agents',{cookie:'valid',host:'evil.test'})).status,403);
  const result=await (await request('/studio/api/agents',{cookie:'valid'})).json();assert.equal(result.ok,true);assert.equal(result.cookie,null);assert.equal(result.authorization,null);
  const prior=calls;assert.equal((await request('/studio/api/agents',{cookie:'valid'})).status,200);assert.equal(calls,prior+1);
  revoked=true;assert.equal((await request('/studio/api/agents',{cookie:'valid'})).status,401);
  unavailable=true;const failure=await request('/studio/api/agents',{cookie:'valid'});assert.equal(failure.status,503);assert(!(await failure.text()).includes('private auth detail'));
 }finally{await new Promise(resolve=>server.close(resolve));}
});
test('模型并发上限与大载荷拒绝，客户端取消不使服务退出',async()=>{
 let release;const pending=new Promise(resolve=>release=resolve);
 const server=createAgentServer({publicOrigin:'https://example.test',maxActive:1,authenticate:async()=>({username:'synthetic',role:'admin',personnelType:'internal',mustChange:false}),studio:{handle:async request=>{if(request.url.endsWith('/stream'))await pending;return new Response('ok');}}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
 const request=(path,body)=>client(port,path,{method:'POST',headers:{Host:'example.test',Origin:'https://example.test'},body});
 let running;
 try{
  running=request('/studio/api/agents/test/stream','{}');await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal((await request('/studio/api/agents/test/generate','{}')).status,429);release();assert.equal((await running).status,200);
  assert.equal((await request('/studio/api/tools/test','x'.repeat(512*1024+1))).status,413);
  assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status,200);
 }finally{release();await running?.catch(()=>{});await new Promise(resolve=>server.close(resolve));}
});

for(const domain of ['process','purchase'])test(domain+' 确认会话只交给页面，工具上下文只获得登记预览能力',async()=>{
 const contextKey=domain+'Changes',stageKey=domain==='process'?'stageProcessDraft':'stagePurchaseDraft';
 const user={username:'SYN',identity:{id:'SYN-A'},role:'admin',personnelType:'internal',mustChange:false};
 let staged=0,handled=0,revoked=false,toolAccess;
 const changes={stage:async()=>{staged++;return {executed:false};},handle:async()=>{handled++;return Response.json({confirmed:true});}};
 const server=createAgentServer({publicOrigin:'https://example.test',authenticate:async cookie=>!revoked&&cookie==='SYN-session'?user:null,
  [contextKey]:({cookie,user:current})=>{assert.equal(cookie,'SYN-session');assert.equal(current,user);return changes;},
  businessAccess:options=>{assert.equal(options.handle,undefined);assert.equal(options.processChanges,undefined);assert.equal(options.purchaseChanges,undefined);return {[stageKey]:options[stageKey]};},
  withAccess:async(access,run)=>{toolAccess=access;return run();},
  studio:{handle:async(request,context)=>{
   assert.equal(context.actor.id,'SYN-A');assert.equal(toolAccess.handle,undefined);assert.equal(toolAccess.confirm,undefined);
   if(request.url.endsWith('/stage'))return Response.json(await toolAccess[stageKey]({}));
   return context[contextKey].handle(request,{actor:context.actor});
  }}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
 const request=(route,origin='https://example.test')=>client(port,route,{method:'POST',headers:{Host:'example.test',Origin:origin,Cookie:'SYN-session'},body:'{}'});
 try{
  assert.equal((await request('/studio/api/tools/stage')).status,200);assert.equal(staged,1);assert.equal(handled,0);
  assert.equal((await request('/studio/'+domain+'-change/api','https://cross-site.invalid')).status,403);assert.equal(handled,0);
  assert.equal((await request('/studio/'+domain+'-change/api')).status,200);assert.equal(handled,1);
  revoked=true;assert.equal((await request('/studio/'+domain+'-change/api')).status,401);assert.equal(handled,1);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
