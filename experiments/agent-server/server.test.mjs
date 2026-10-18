import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createAgentServer} from './http-server.mjs';
import {parsePublicOrigin,sessionCookie,canEnterStudio} from './session.mjs';

const client=(port,path,{method='GET',headers={},body}={})=>new Promise((resolve,reject)=>{
 const request=http.request({hostname:'127.0.0.1',port,path,method,headers},response=>{const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:response.statusCode,headers:response.headers})));response.on('error',reject);});request.on('error',reject);request.end(body);
});

test('HTTPS origin、会话筛选和角色策略拒绝不明确的授权',()=>{
 assert.throws(()=>parsePublicOrigin('http://example.test'));assert.throws(()=>parsePublicOrigin('https://user:secret@example.test'));assert.throws(()=>parsePublicOrigin('https://example.test/path'));
 assert.equal(sessionCookie('other=secret; doon_employee_session='+'a'.repeat(43)),'doon_employee_session='+'a'.repeat(43));assert.equal(sessionCookie('doon_session=invalid'),'');
 for(const user of [null,{username:'test',mustChange:true,role:'admin'},{username:'test',mustChange:false,role:'sales'},{username:'test',mustChange:false,role:'admin',active:false},{role:'admin'}])assert.equal(canEnterStudio(user),false);
 assert.equal(canEnterStudio({username:'test',role:'programmer',mustChange:false}),true);
});
test('真实 HTTP 网关逐次鉴权、保护静态和 API、校验 Origin、不转发 Cookie',async()=>{
 let revoked=false,unavailable=false,calls=0;
 const server=createAgentServer({publicOrigin:'https://example.test',authenticate:async cookie=>{calls++;if(unavailable)throw new Error('private auth detail');if(revoked||!cookie)return null;return{username:'synthetic',role:cookie==='sales'?'sales':'admin',mustChange:cookie==='initial'};},studio:{handle:async request=>Response.json({ok:true,cookie:request.headers.get('cookie'),authorization:request.headers.get('authorization')})}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
 const request=(path,{cookie,method='GET',origin='https://example.test',host='example.test'}={})=>client(port,path,{method,headers:{Host:host,...(cookie?{Cookie:cookie}:{}),...(method==='GET'?{}:{Origin:origin}),'X-Role':'admin',Authorization:'untrusted'}});
 try{
  assert.equal((await request('/health',{host:'127.0.0.1'})).status,200);
  assert.equal((await request('/agent-studio-entry.js')).status,200);
  assert.equal((await request('/studio/')).status,302);assert.equal((await request('/studio/api/agents')).status,401);assert.equal((await request('/studio/assets/test.js')).status,401);
  assert.equal((await request('/studio/',{cookie:'sales'})).status,403);assert.equal((await request('/studio/',{cookie:'initial'})).status,403);
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
  assert.equal((await request('/studio/api/agents',{cookie:'valid',host:'evil.test'})).status,403);
  const result=await (await request('/studio/api/agents',{cookie:'valid'})).json();assert.equal(result.ok,true);assert.equal(result.cookie,null);assert.equal(result.authorization,null);
  const prior=calls;assert.equal((await request('/studio/api/agents',{cookie:'valid'})).status,200);assert.equal(calls,prior+1);
  revoked=true;assert.equal((await request('/studio/api/agents',{cookie:'valid'})).status,401);
  unavailable=true;const failure=await request('/studio/api/agents',{cookie:'valid'});assert.equal(failure.status,503);assert(!(await failure.text()).includes('private auth detail'));
 }finally{await new Promise(resolve=>server.close(resolve));}
});
test('模型并发上限与大载荷拒绝，客户端取消不使服务退出',async()=>{
 let release;const pending=new Promise(resolve=>release=resolve);
 const server=createAgentServer({publicOrigin:'https://example.test',maxActive:1,authenticate:async()=>({username:'synthetic',role:'admin',mustChange:false}),studio:{handle:async request=>{if(request.url.endsWith('/stream'))await pending;return new Response('ok');}}});
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
