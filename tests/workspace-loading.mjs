import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {setTimeout as delay} from 'node:timers/promises';
await build({entryPoints:['app/workspace-read-queue.ts','lib/domain.ts'],outdir:'test-output/loading-tests',bundle:true,platform:'node',format:'esm',alias:{'@':process.cwd()}});
const {WorkspaceReadQueue}=await import('../test-output/loading-tests/app/workspace-read-queue.js');
const {all,indexReadState}=await import('../test-output/loading-tests/lib/domain.js');
const response=(value={ok:true},status=200)=>Response.json(value,{status});
const tick=()=>delay(0);
function controlled(){
 let resolve,reject,signal,started=false;
 const result=new Promise((a,b)=>{resolve=a;reject=b;});
 return {run:async s=>{started=true;signal=s;s.addEventListener('abort',()=>reject(s.reason),{once:true});return result;},finish:()=>resolve(response()),get started(){return started;},get signal(){return signal;}};
}
{
 const q=new WorkspaceReadQueue(0),a=controlled(),b=controlled(),c=controlled(),warm=controlled();
 const pending=[q.read(':a',a.run),q.read(':b',b.run),q.read(':c',c.run),q.read(':warm',warm.run,{background:true})];
 assert(a.started&&b.started&&!c.started&&!warm.started);
 a.finish();await tick();assert(c.started&&!warm.started);b.finish();c.finish();await Promise.all(pending.slice(0,3));await tick();assert(warm.started);
 warm.finish();await Promise.all(pending);q.clear();
}
{
 const q=new WorkspaceReadQueue(0),warm=controlled();
 const preload=q.read(':warm',warm.run,{background:true});const rejected=assert.rejects(preload,{name:'AbortError'});
 const foreground=await q.read(':page',async()=>response());assert.equal(foreground.status,200);await rejected;q.clear();
}
{
 let now=100;const q=new WorkspaceReadQueue(0,()=>now);
 await q.read(':page',async()=>response({source:'preload'}),{background:true});
 assert.equal((await (await q.read(':page',async()=>{throw Error('cache miss');})).json()).source,'preload');
 let reads=0;await q.read(':page',async()=>{reads++;return response();});assert.equal(reads,1,'prefetch is consumed once');
 await q.read(':expiry',async()=>response(),{background:true});now+=300001;
 await q.read(':expiry',async()=>{reads++;return response();});assert.equal(reads,2);
 await q.read(':scope',async()=>response({old:true}),{background:true});q.setScope('another-user');
 assert.deepEqual(await (await q.read(':scope',async()=>response({fresh:true}))).json(),{fresh:true});
 await q.read(':mutation',async()=>response({old:true}),{background:true});q.invalidate();
 assert.deepEqual(await (await q.read(':mutation',async()=>response({fresh:true}))).json(),{fresh:true});q.clear();
}
{
 const q=new WorkspaceReadQueue(0);q.setPage('first');const old=controlled(),shared=controlled(),queued=controlled();
 const a=q.read(':old-page',old.run),b=q.read(':data',shared.run),c=q.read(':queued-page',queued.run);
 const errors=[assert.rejects(a,{name:'AbortError'}),assert.rejects(c,{name:'AbortError'})];
 q.setPage('second');await Promise.all(errors);assert(!shared.signal.aborted,'required shared data survives navigation');
 shared.finish();await b;await q.read(':second-page',async()=>response());q.clear();
}
{
 const q=new WorkspaceReadQueue(0);const a=controlled(),b=controlled(),abort=new AbortController();
 const jobs=[q.read(':a',a.run),q.read(':b',b.run)];
 const c=q.read(':cancel',async()=>{throw Error('cancelled read ran');},{signal:abort.signal});const error=assert.rejects(c,{name:'AbortError'});
 abort.abort();await error;a.finish();b.finish();await Promise.all(jobs);q.clear();
}
{
 const q=new WorkspaceReadQueue(0),bytes=JSON.stringify({large:'x'.repeat(750001)});
 await q.read(':large',async()=>new Response(bytes,{headers:{'Content-Type':'application/json'}}),{background:true});
 assert.deepEqual(await (await q.read(':large',async()=>response({fresh:true}))).json(),{fresh:true});
 await q.read(':denied',async()=>response({error:'denied'},403),{background:true});
 assert.deepEqual(await (await q.read(':denied',async()=>response({fresh:true}))).json(),{fresh:true});q.clear();
}
{
 const q=new WorkspaceReadQueue(0);let reads=0;
 await q.read(':revoked',async()=>response({old:true}),{background:true});
 const latest=await q.read(':revoked',async()=>{reads++;return response({error:'no permission'},403);},{validate:async()=>false});
 assert.equal(latest.status,403);assert.equal(reads,1,'prefetch cannot bypass a new permission or data revision');
 await q.read(':same-version',async()=>response({warm:true}),{background:true});
 const warm=await q.read(':same-version',async()=>{throw Error('validated prefetch was discarded');},{validate:async()=>true});
 assert.deepEqual(await warm.json(),{warm:true});q.clear();
}
{
 let visible=false;const q=new WorkspaceReadQueue(0,()=>Date.now(),()=>visible),warm=controlled(),abort=new AbortController();
 const pending=q.read(':hidden',warm.run,{background:true,signal:abort.signal});const error=assert.rejects(pending,{name:'AbortError'});
 await tick();assert(!warm.started);abort.abort();await error;q.clear();
}
const records=Array.from({length:5000},(_,i)=>({id:'synthetic-'+i,kind:i%10?'audit':'order',quantity:i}));
const state=indexReadState({revision:1,records});
const before=JSON.stringify(records),orders=all(state,'order');assert.deepEqual(orders,records.filter(r=>r.kind==='order'));
orders.reverse();orders.pop();assert.equal(all(state,'order').length,500,'readers receive independent arrays');
assert.equal(JSON.stringify(records),before,'index never edits business records');
const other={revision:2,records:[{id:'new',kind:'order'}]};assert.deepEqual(all(other,'order'),other.records);
other.records[0]={id:'replacement',kind:'member'};assert.equal(all(other,'order').length,0,'mutable/write states are never indexed');
const clone={...state,records:[{id:'separate',kind:'order'}]};assert.deepEqual(all(clone,'order'),clone.records,'derived states have no stale index');
assert.deepEqual(all(state,'missing'),[]);
console.log('PASS foreground priority, bounded background prefetch, preemption, navigation, scope/mutation invalidation, expiry, cancellation, hidden tabs, payload limits and read-index preservation');
