import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {StringDecoder} from 'node:string_decoder';
import {createAgentServer} from './http-server.mjs';
import {createRuntimePool} from './runtime-pool.mjs';
import {createStudio} from '../mastra-studio/server.mjs';
import {LibSQLStore} from '../mastra-studio/node_modules/@mastra/libsql/dist/index.js';

const origin='https://synthetic.test';
const person={username:'SYN-stream',role:'sales',personnelType:'internal',mustChange:false,identity:{id:'SYN-stream'}};
const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return{promise,resolve};};
async function until(check){
 const deadline=Date.now()+5000;
 while(!check()){if(Date.now()>deadline)throw new Error('Synthetic stream did not advance');await new Promise(resolve=>setTimeout(resolve,10));}
}
function open(port,route,body){
 return new Promise((resolve,reject)=>{
  const req=http.request({hostname:'127.0.0.1',port,path:'/studio/'+route,method:body?'POST':'GET',headers:{Host:'synthetic.test',Origin:origin,Cookie:'synthetic','Content-Type':'application/json'}},res=>{
   const done=deferred(),decoder=new StringDecoder('utf8');
   const result={status:res.statusCode,headers:res.headers,text:'',ended:false,done:done.promise,close:()=>res.destroy()};
   res.on('data',chunk=>{result.text+=decoder.write(chunk);});res.on('end',()=>{result.text+=decoder.end();result.ended=true;done.resolve();});res.on('close',()=>done.resolve());res.on('error',()=>done.resolve());resolve(result);
  });
  req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
 });
}

test('gateway flushes stream headers before the first chunk and forwards each chunk before completion',async()=>{
 const first=deferred(),last=deferred();let signal,releases=0;
 const server=createAgentServer({publicOrigin:origin,authenticate:async()=>person,acquireRuntime:async()=>({
  release:()=>releases++,studio:{handle:async request=>{
   signal=request.signal;
   return new Response(new ReadableStream({async start(controller){
    await first.promise;if(signal.aborted)return controller.close();
    controller.enqueue(new TextEncoder().encode('data: SYN-first\n\n'));
    await last.promise;if(signal.aborted)return controller.close();
    controller.enqueue(new TextEncoder().encode('data: SYN-last\n\n'));controller.close();
   }}),{headers:{'Content-Type':'text/event-stream'}});
  }},
 })});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let response;
 try{
  response=await open(server.address().port,'api/agents/supervisor/stream',{messages:[{role:'user',content:'SYN'}]});
  assert.equal(response.status,200);assert.equal(response.text,'');assert.equal(response.headers['x-accel-buffering'],'no');assert.match(response.headers['cache-control'],/no-transform/);
  first.resolve();await until(()=>response.text.includes('SYN-first'));assert.equal(response.ended,false);assert(!response.text.includes('SYN-last'));assert.equal(releases,0);
  last.resolve();await response.done;assert(response.text.includes('SYN-last'));await until(()=>releases===1);
 }finally{first.resolve();last.resolve();response?.close();await new Promise(resolve=>server.close(resolve));}
});

test('real Studio HTTP sends partial model text, reconnects thread subscriptions and aborts without evicting an active runtime',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'doon-streaming-'));
 const storage=new LibSQLStore({id:'SYN-stream-'+randomUUID(),url:'file:'+path.join(dir,'test.sqlite').replaceAll('\\','/')});
 const calls=[],connections=[];let studio,server,pool,revoked=false;
 async function provider(url,init){
  assert(String(url).endsWith('/chat/completions'),'no external provider calls');
  const body=JSON.parse(init.body);assert.equal(body.stream,true,'the SDK must request streaming tokens');
  const finish=deferred(),call={finish,aborted:false,index:calls.length+1};calls.push(call);
  const encoder=new TextEncoder();
  const frame=(delta,reason=null)=>encoder.encode('data: '+JSON.stringify({id:'synthetic-'+call.index,object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason:reason}]})+'\n\n');
  return new Response(new ReadableStream({start(controller){
   let closed=false;
   const abort=()=>{if(closed)return;closed=true;call.aborted=true;finish.resolve();controller.error(new DOMException('Synthetic stop','AbortError'));};
   init.signal?.addEventListener('abort',abort,{once:true});
   controller.enqueue(frame({role:'assistant',content:'SYN-partial-'+call.index}));
   void finish.promise.then(()=>{
    if(closed)return;
    controller.enqueue(frame({content:' SYN-final-'+call.index}));controller.enqueue(frame({},'stop'));controller.enqueue(encoder.encode('data: [DONE]\n\n'));closed=true;controller.close();init.signal?.removeEventListener('abort',abort);
   });
  },cancel(){call.aborted=true;finish.resolve();}}),{headers:{'Content-Type':'text/event-stream'}});
 }
 try{
  studio=await createStudio({dataDir:dir,storage,cloud:true,liveReadOnly:true,scopeId:'SYN-stream',deepseekOptions:{env:{DOON_STUDIO_MODEL:'deepseek-flash',DEEPSEEK_API_KEY:'synthetic-not-a-credential'},fetchImpl:provider}});
  pool=createRuntimePool({max:1,create:async()=>studio});
  server=createAgentServer({publicOrigin:origin,authenticate:async()=>revoked?null:person,acquireRuntime:user=>pool.acquire(user)});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
  const request=async(route,body)=>{const result=await open(port,route,body);connections.push(result);return result;};
  const json=async(route,body)=>{const response=await request(route,body);await response.done;assert.equal(response.status,200,response.text);return JSON.parse(response.text);};
  const direct=await request('api/agents/supervisor/stream',{messages:[{role:'user',content:'SYN direct streaming'}],memory:{thread:'SYN-direct',resource:'SYN-stream'}});
  await until(()=>direct.text.includes('SYN-partial-1'));assert.equal(direct.ended,false);assert(!direct.text.includes('SYN-final-1'));
  calls[0].finish.resolve();await direct.done;assert(direct.text.includes('SYN-final-1'));

  const ids={threadId:'SYN-background',resourceId:'SYN-stream'};
  const subscription=await request('api/agents/supervisor/threads/subscribe',{...ids,withInitialHistory:true});
  await until(()=>subscription.text.includes(': connected'));
  await json('api/agents/supervisor/send-message',{...ids,message:'SYN subscription streaming'});
  await until(()=>subscription.text.includes('SYN-partial-2'));assert(!subscription.text.includes('SYN-final-2'));assert.equal(studio.isBusy(),true);
  subscription.close();await subscription.done;
  await assert.rejects(pool.acquire({identity:{id:'SYN-another'}},{background:true}),{status:429});
  revoked=true;const denied=await request('api/agents/supervisor/threads/subscribe',ids);await denied.done;assert.equal(denied.status,401);revoked=false;
  const reconnected=await request('api/agents/supervisor/threads/subscribe',{...ids,withInitialHistory:true});
  await until(()=>reconnected.text.includes(': connected'));calls[1].finish.resolve();
  await until(()=>reconnected.text.includes('SYN-final-2'));await until(()=>!studio.isBusy());reconnected.close();await reconnected.done;
  const saved=await json('api/memory/threads/SYN-background/messages?agentId=supervisor&resourceId=SYN-stream');assert(JSON.stringify(saved).includes('SYN-final-2'));

  const stopIds={threadId:'SYN-stop',resourceId:'SYN-stream'};
  const stopping=await request('api/agents/supervisor/threads/subscribe',stopIds);await until(()=>stopping.text.includes(': connected'));
  await json('api/agents/supervisor/send-message',{...stopIds,message:'SYN stop midway'});await until(()=>stopping.text.includes('SYN-partial-3'));
  const stopped=await json('api/agents/supervisor/threads/abort',stopIds);assert.equal(stopped.aborted,true);
  await until(()=>calls[2].aborted);await until(()=>!studio.isBusy());assert(!stopping.text.includes('SYN-final-3'));stopping.close();await stopping.done;
 }finally{
  for(const call of calls)call.finish.resolve();
  for(const connection of connections)connection.close();
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  // The SDK acknowledges abort before its final tracing microtasks/batch have
  // settled (the configured exporter batches for 200ms).
  await new Promise(resolve=>setTimeout(resolve,250));
  await studio?.observability.flush();
  if(pool)await pool.close();else if(studio)await studio.close();else await storage.close();
  await fs.rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});
 }
});
