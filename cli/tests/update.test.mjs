import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {setImmediate as turn} from 'node:timers/promises';
import {UpdateService} from '../dist/update.js';
import {ApiClient} from '../dist/client.js';
import {version} from '../dist/catalog.js';
import {store,session} from './helpers.mjs';

test('update check uses the employee session and a fixed HTTPS route',async()=>{
 const state=await store();await state.setup('https://employee.test',false);await state.saveSession(session('https://employee.test'));
 const release={format:'doon-cli-update-v1',version:'0.44.0',commit:'a'.repeat(40),file:'doon-cli-0.44.0-aaaaaaaaaaaa-windows-x64.zip',bytes:10,sha256:'b'.repeat(64),sourceDirty:false};
 const update=new UpdateService(state,async(url,options)=>{assert.equal(url,'https://employee.test/api/cli-update/latest');assert.equal(options.headers.Cookie,'doon_employee_session='+'X'.repeat(43));assert.equal(options.redirect,'manual');return Response.json(release);});
 assert.deepEqual(await update.check(),{installedVersion:version,latestVersion:'0.44.0',updateAvailable:true,commit:release.commit});
});

test('a progressing package download can exceed the old 30 second deadline', {timeout:45000}, async()=>{
 const server=http.createServer((_request,response)=>{
  response.writeHead(200,{'Content-Type':'application/octet-stream'});
  response.write('start');
  const progress=setInterval(()=>response.write('.'),1000);
  const end=setTimeout(()=>response.end('end'),31000);
  response.on('close',()=>{clearInterval(progress);clearTimeout(end);});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 try {
  const {data}=await new ApiClient({origin,localHttp:true},fetch,30000).request('/api/cli-update/package',session(origin));
  assert.match(data.toString(),/^start\.+end$/);
 } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

async function timedPackage(t,headers=true){
 t.mock.timers.enable({apis:['setTimeout']});
 const origin='https://employee.test';let stream,signal;
 const client=new ApiClient({origin,localHttp:false},async(_url,options)=>{
  signal=options.signal;
  if(!headers)return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
  return new Response(new ReadableStream({start(controller){stream=controller;signal.addEventListener('abort',()=>controller.error(signal.reason),{once:true});}}));
 },30000);
 const result=client.request('/api/cli-update/package',session(origin));
 // Observe errors immediately; clock advancement can reject between assertions.
 result.catch(()=>{});await turn();
 return {result,get signal(){return signal;},async progress(){stream.enqueue(new Uint8Array([1]));await turn();},async finish(){stream.close();return result;}};
}

test('package timeout covers stalled headers and stalled response bodies',async t=>{
 for(const headers of [false,true])await t.test(headers?'body':'headers',async child=>{
  const request=await timedPackage(child,headers);
  if(headers){child.mock.timers.tick(20000);await request.progress();child.mock.timers.tick(20000);assert.equal(request.signal.aborted,false);}
  child.mock.timers.tick(30000);await assert.rejects(request.result,{code:'REQUEST_TIMEOUT'});
 });
});

test('continuous package progress cannot extend the 15 minute total budget',async t=>{
 const request=await timedPackage(t);
 for(let i=0;i<44;i++){t.mock.timers.tick(20000);await request.progress();}
 assert.equal(request.signal.aborted,false);
 t.mock.timers.tick(20000);await assert.rejects(request.result,{code:'REQUEST_TIMEOUT'});
});

test('finished package requests clear both download timers',async t=>{
 const request=await timedPackage(t);await request.progress();await request.finish();
 t.mock.timers.tick(16*60000);assert.equal(request.signal.aborted,false);
});

test('update check rejects incomplete or dirty release manifests',async()=>{
 const state=await store();await state.setup('https://employee.test',false);await state.saveSession(session('https://employee.test'));
 const update=new UpdateService(state,async()=>Response.json({format:'doon-cli-update-v1',version:'0.44.0',sourceDirty:true}));
 await assert.rejects(update.check(),{code:'INVALID_RELEASE'});
});
