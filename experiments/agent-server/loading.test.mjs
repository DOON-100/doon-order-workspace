import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {createStudioAssets} from '../mastra-studio/assets.mjs';
import {createAgentServer} from './http-server.mjs';

test('Studio packaged UI loads without creating user storage; gzip, ETag, HEAD and fonts work',async()=>{
 const assets=createStudioAssets({cloud:true,liveReadOnly:true,hasManager:true,hasWorkflowManager:true});
 await assets.warm();
 const call=(route,headers={},method='GET')=>assets.handle(new Request('https://synthetic.test/studio/'+route,{headers,method}));
 const html=await(await call('')).text();assert.match(html,/真实业务只读/);assert(!html.includes('%%'));
 for(const route of ['','manage/','workflow-manager/','workflow-preview/','workflow-schedules/','process-change/','purchase-change/']){
  const page=await(await call(route)).text();assert.match(page,/<head[^>]*><script>\/\/ Observe failures/);assert.equal(page.split("banner.id='doon-auth-status'").length,2,route+' installs one observer before app scripts');
 }
 const root=path.join(path.dirname(fileURLToPath(import.meta.resolve('../mastra-studio/node_modules/mastra/package.json'))),'dist/studio/assets');
 const files=await fs.readdir(root),script='assets/'+files.find(file=>/^main-.*\.js$/.test(file));
 const identity=await call(script),plain=Buffer.from(await identity.arrayBuffer());
 const zipped=await call(script,{'Accept-Encoding':'gzip'}),etag=zipped.headers.get('etag'),bytes=Buffer.from(await zipped.arrayBuffer());
 assert.equal(zipped.headers.get('content-encoding'),'gzip');assert(bytes.length<plain.length*.45);
 assert.deepEqual(gunzipSync(bytes),plain,'compression must preserve localized code byte for byte');
 assert.match(zipped.headers.get('cache-control'),/private/);assert.equal(zipped.headers.get('vary'),'Accept-Encoding');
 const unchanged=await call(script,{'Accept-Encoding':'gzip','If-None-Match':etag});assert.equal(unchanged.status,304);assert.equal((await unchanged.arrayBuffer()).byteLength,0);
 const head=await call(script,{'Accept-Encoding':'gzip'},'HEAD');assert.equal(head.headers.get('etag'),etag);assert.equal(Number(head.headers.get('content-length')),bytes.length);assert.equal((await head.arrayBuffer()).byteLength,0);
 assert.equal((await call(script,{'Accept-Encoding':'gzip;q=0'})).headers.get('content-encoding'),null);
 assert.equal((await call(script,{'Accept-Encoding':'br, gzip;q=0.5'})).headers.get('content-encoding'),'gzip');
 const manager=await(await call('workflow-manager/')).text();assert.match(manager,/真实业务只读/);assert(!manager.includes('<option value="reviewed">'));
 const font=files.find(file=>file.endsWith('.ttf'));assert(font);assert.equal((await call('assets/'+font)).status,200);
 for(const route of ['api/agents','api/auth/capabilities','manage/api/agents','workflow-manager/api/workflows','integrations/deepseek/status','business/profiles'])assert.equal(await call(route),null);
 assert.equal((await call('%5cpackage.json')).status,404);assert.equal((await call('assets/missing.js')).status,404);
 console.log(JSON.stringify({studioScriptBytes:plain.length,gzipBytes:bytes.length,reductionPercent:Math.round((1-bytes.length/plain.length)*100)}));
});

test('Gateway still authenticates cached assets and loads UI while a user runtime is cold',async()=>{
 let revoked=false,external=false,authCalls=0,runtimes=0,releases=0,release;
 const cold=new Promise(resolve=>release=resolve),assets=createStudioAssets({cloud:true,liveReadOnly:true});
 const server=createAgentServer({publicOrigin:'https://synthetic.test',staticStudio:assets,authenticate:async cookie=>{authCalls++;return !revoked&&cookie?{username:'synthetic',role:'clerk',personnelType:external?'external':'internal',mustChange:false}:null;},acquireRuntime:async()=>{runtimes++;await cold;return{studio:{handle:async()=>Response.json({ok:true})},release:()=>releases++};}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
 const call=(route,headers={})=>new Promise((resolve,reject)=>{
  const req=http.get({hostname:'127.0.0.1',port,path:'/studio/'+route,headers:{Host:'synthetic.test',Cookie:'synthetic',...headers}},res=>{const chunks=[];res.on('data',bytes=>chunks.push(bytes));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));});req.on('error',reject);
 });
 let api;
 try{
  const first=await call('brand.css');assert.equal(first.status,200);assert.equal(runtimes,0);
  const etag=first.headers.etag,prior=authCalls;
  assert.equal((await call('brand.css',{'If-None-Match':etag})).status,304);assert.equal(authCalls,prior+1);
  external=true;assert.equal((await call('brand.css',{'If-None-Match':etag})).status,403,'改为外部后不能通过已有静态缓存进入 Studio');external=false;
  revoked=true;assert.equal((await call('brand.css',{'If-None-Match':etag})).status,401);revoked=false;
  api=call('api/agents');await new Promise(resolve=>setTimeout(resolve,25));assert.equal(runtimes,1);
  const ui=await Promise.race([call(''),new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('UI waited on runtime initialization')),1500);t.unref();})]);
  assert.equal(ui.status,200);assert.equal(runtimes,1);release();const dynamic=await api;assert.equal(dynamic.status,200);assert.equal(dynamic.headers['cache-control'],'no-store');
 }finally{release();await api?.catch(()=>{});await new Promise(resolve=>server.close(resolve));}
 assert.equal(releases,1);
});
