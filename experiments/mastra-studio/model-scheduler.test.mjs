import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createModelScheduler} from './model-scheduler.mjs';
import {createDeepSeekStatus} from './deepseek.mjs';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return{promise,resolve};};
async function until(check){const deadline=Date.now()+5000;while(!check()){if(Date.now()>deadline)throw Error('Synthetic scheduler did not advance');await sleep(5);}}
const access=owner=>({owner});
const simple=()=>Response.json({ok:true});

test('20 actual provider SDK streams share six permits; 14 wait and every account completes',async()=>{
 const scheduler=createModelScheduler(),calls=[];let active=0,peak=0,done=0;
 const provider=async(url,init)=>{
  assert(String(url).endsWith('/chat/completions'));assert.equal(JSON.parse(init.body).stream,true);
  active++;peak=Math.max(peak,active);const gate=deferred();calls.push(gate);let finished=false;
  const finish=()=>{if(!finished){finished=true;active--;}};
  return new Response(new ReadableStream({start(controller){
   const encoder=new TextEncoder(),frame=(delta,finish_reason=null)=>encoder.encode('data: '+JSON.stringify({id:'SYN',object:'chat.completion.chunk',created:1,model:'deepseek-flash',choices:[{index:0,delta,finish_reason}]})+'\n\n');
   controller.enqueue(frame({role:'assistant',content:'SYN-partial'}));
   void gate.promise.then(()=>{controller.enqueue(frame({content:' SYN-final'},'stop'));controller.enqueue(encoder.encode('data: [DONE]\n\n'));controller.close();finish();});
  },cancel(){finish();}}),{headers:{'Content-Type':'text/event-stream'}});
 };
 const requests=Array.from({length:20},(_,i)=>(async()=>{
  const model=await createDeepSeekStatus({scheduler,modelOwner:'SYN-'+i,env:{DOON_STUDIO_MODEL:'deepseek-flash',DEEPSEEK_API_KEY:'synthetic-only'},fetchImpl:provider}).model();
  const result=await model.doStream({mode:{type:'regular'},prompt:[{role:'user',content:[{type:'text',text:'SYN question'}]}]});
  let text='';for await(const part of result.stream)if(part.type==='text-delta')text+=part.delta;
  done++;return text;
 })());
 try{
  await until(()=>calls.length===6&&scheduler.snapshot().queued===14);
  assert.equal(scheduler.snapshot().active,6);assert.equal(peak,6);
  while(done<20){for(const gate of calls)gate.resolve();await sleep(5);}
  for(const text of await Promise.all(requests))assert.equal(text,'SYN-partial SYN-final');
  const summary=scheduler.snapshot();assert.equal(summary.completed,20);assert.equal(summary.active,0);assert.equal(summary.queued,0);assert.equal(summary.peakQueued,14);assert.equal(peak,6);
  console.log(JSON.stringify({syntheticAccounts:20,peakModelCalls:peak,peakQueued:summary.peakQueued,completed:summary.completed}));
 }finally{for(const gate of calls)gate.resolve();await scheduler.close();await Promise.allSettled(requests);}
});

test('permit survives response headers and is released on body cancellation or a body read error',async()=>{
 const scheduler=createModelScheduler({maxRunning:1});
 try{
  const first=await scheduler.fetch(async()=>new Response(new ReadableStream()),'SYN',{},access('A'));
  const next=scheduler.fetch(simple,'SYN',{},access('B'));assert.equal(scheduler.snapshot().queued,1);
  await first.body.cancel();const second=await next;await second.text();assert.equal(scheduler.snapshot().active,0);
  const broken=await scheduler.fetch(async()=>new Response(new ReadableStream({pull(controller){controller.error(Error('synthetic stream failure'));}})),'SYN',{},access('C'));
  await assert.rejects(broken.text(),/synthetic/);assert.equal(scheduler.snapshot().active,0);assert.equal(scheduler.snapshot().failed,1);
 }finally{await scheduler.close();}
});

test('one active and one pending per account; a different account gets the next available permit',async()=>{
 const scheduler=createModelScheduler({maxRunning:1});
 try{
  const first=await scheduler.fetch(simple,'SYN',{},access('A'));
  const same=scheduler.fetch(simple,'SYN',{},access('A'));
  await assert.rejects(scheduler.fetch(simple,'SYN',{},access('A')),{code:'owner',status:429});
  const other=scheduler.fetch(simple,'SYN',{},access('B'));
  await first.text();const b=await other;assert.equal(scheduler.snapshot('B').own.active,1);assert.equal(scheduler.snapshot('A').own.queued,1);
  await b.text();await(await same).text();assert.equal(scheduler.snapshot().completed,3);
 }finally{await scheduler.close();}
});

test('twenty waiting slots are bounded and queue cancellation never calls the provider',async()=>{
 const scheduler=createModelScheduler({maxRunning:1}),abort=new AbortController();let calls=0;
 const provider=()=>{calls++;return simple();};const pending=[];
 try{
  const first=await scheduler.fetch(provider,'SYN',{},access('A'));
  for(let i=0;i<20;i++){const promise=scheduler.fetch(provider,'SYN',i===0?{signal:abort.signal}:{},access('Q'+i));promise.catch(()=>{});pending.push(promise);}
  assert.equal(scheduler.snapshot().queued,20);
  await assert.rejects(scheduler.fetch(provider,'SYN',{},access('overflow')),{code:'full',status:429});
  abort.abort();await assert.rejects(pending[0],{name:'AbortError'});assert.equal(calls,1);assert.equal(scheduler.snapshot().queued,19);
  await first.text();
 }finally{await scheduler.close();await Promise.allSettled(pending);}
});

test('authorization is checked when admitted, not at enqueue time; revoked identity is never sent upstream',async()=>{
 const scheduler=createModelScheduler({maxRunning:1});let allowed=true,calls=0;
 try{
  const first=await scheduler.fetch(simple,'SYN',{},access('A'));
  const next=scheduler.fetch(()=>{calls++;return simple();},'SYN',{}, {owner:'B',authorize:async()=>{if(!allowed)throw Error('private credential');}});
  next.catch(()=>{});allowed=false;await first.text();
  await assert.rejects(next,error=>error.code==='authorization'&&!error.message.includes('private'));assert.equal(calls,0);assert.equal(scheduler.snapshot().active,0);
 }finally{await scheduler.close();}
});

test('waiting and running have separate timeouts and shutdown cancels queued and active bodies',async()=>{
 const scheduler=createModelScheduler({maxRunning:1,waitMs:20,runMs:100});
 const pending=[];
 try{
  const running=await scheduler.fetch(async()=>new Response(new ReadableStream()),'SYN',{},access('A'));
  const queued=scheduler.fetch(simple,'SYN',{},access('B'));pending.push(queued);
  await Promise.all([assert.rejects(queued,{code:'waiting'}),sleep(30)]);
  await Promise.all([assert.rejects(running.text(),{code:'timeout'}),sleep(110)]);
  assert.equal(scheduler.snapshot().active,0);assert.equal(scheduler.snapshot().timedOut,2);
  const active=await scheduler.fetch(async()=>new Response(new ReadableStream()),'SYN',{},access('C'));
  const waiting=scheduler.fetch(simple,'SYN',{},access('D'));waiting.catch(()=>{});pending.push(waiting);
  await scheduler.close();await assert.rejects(waiting,{code:'closed'});await assert.rejects(active.text(),{code:'closed'});
  await assert.rejects(scheduler.fetch(simple,'SYN'),{code:'closed'});assert.equal(scheduler.snapshot().active,0);assert.equal(scheduler.snapshot().queued,0);
 }finally{await scheduler.close();await Promise.allSettled(pending);}
});

test('an aborted queued request, a failed fetch and an already-aborted signal release their slots',async()=>{
 const scheduler=createModelScheduler({maxRunning:1}),controller=new AbortController();controller.abort();
 try{
  await assert.rejects(scheduler.fetch(simple,'SYN',{signal:controller.signal}),{name:'AbortError'});
  await assert.rejects(scheduler.fetch(async()=>{throw Error('synthetic network failure');},'SYN',{},access('A')),/network/);
  await(await scheduler.fetch(simple,'SYN',{},access('B'))).text();assert.equal(scheduler.snapshot().active,0);
  assert(!JSON.stringify(scheduler.snapshot('B')).includes('SYN'));
 }finally{await scheduler.close();}
});

test('invalid limits cannot silently disable model concurrency control',()=>{
 for(const options of [{maxRunning:0},{maxRunning:21},{maxRunning:1.5},{maxQueued:-1},{maxQueued:101},{waitMs:0},{runMs:Infinity}])assert.throws(()=>createModelScheduler(options),/limits/);
});

test('local overload is not a provider error or automatic retry; status queries bypass generation permits',async()=>{
 const scheduler=createModelScheduler({maxRunning:1,maxQueued:0});let generations=0;
 try{
  await scheduler.fetch(async()=>new Response(new ReadableStream()),'SYN',{},access('A'));
  const env={DOON_STUDIO_MODEL:'deepseek-flash',DEEPSEEK_API_KEY:'synthetic-only'},service=createDeepSeekStatus({env,scheduler,modelOwner:'B',fetchImpl:async url=>{
   if(String(url).endsWith('/chat/completions'))generations++;
   return Response.json({is_available:false,balance_infos:[]});
  }});
  const model=await service.model();
  await assert.rejects(model.doGenerate({prompt:[{role:'user',content:[{type:'text',text:'SYN private prompt'}]}]}),error=>error.code==='full'&&error.status===429&&!JSON.stringify(error).includes('private')&&!error.requestBodyValues);
  assert.equal(generations,0);assert.equal((await service.get()).status,'ok');
  const guarded=await createDeepSeekStatus({env,scheduler,requireModelAccess:true}).model();
  await assert.rejects(guarded.doGenerate({prompt:[]}),{code:'authorization',status:403});
 }finally{await scheduler.close();}
});
