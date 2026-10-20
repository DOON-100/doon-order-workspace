import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRuntimePool,userSchema,runtimeCacheLimit} from './runtime-pool.mjs';

const user=id=>({identity:{id},username:id});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
async function bounded(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('operation blocked on another user')),2000);})]);}finally{clearTimeout(timer);}}

test('default cache admits 20 users, reserves pending slots and initializes at most two users at once',async()=>{
 const gates=[],schemas=[];let active=0,peak=0,closed=0;
 const pool=createRuntimePool({create:async(person,schema)=>{
  schemas.push(schema);const gate=deferred();gates.push(gate);active++;peak=Math.max(peak,active);
  await gate.promise;active--;return{owner:person.identity.id,close:async()=>{closed++;}};
 }});
 const requests=Array.from({length:20},(_,i)=>pool.acquire(user('SYN-'+i)));
 try{
  await turn();assert.equal(gates.length,2);assert.equal(runtimeCacheLimit,20);
  await assert.rejects(pool.acquire(user('SYN-overflow')),{status:429});
  for(let done=0;done<20;){
   const started=gates.length;for(let i=done;i<started;i++)gates[i].resolve();done=started;await turn();
  }
  const handles=await Promise.all(requests);assert.equal(peak,2);assert.equal(new Set(schemas).size,20);
  handles.forEach((handle,i)=>{assert.equal(handle.studio.owner,'SYN-'+i);assert.equal(schemas[i],userSchema('SYN-'+i));handle.release();});
 }finally{for(const gate of gates)gate.resolve();await Promise.allSettled(requests);await pool.close();}
 assert.equal(closed,20);
});

test('warm users bypass cold initialization; one cold identity shares its initialization and leases',async()=>{
 const gate=deferred();let creates=0;
 const pool=createRuntimePool({create:async person=>{creates++;if(person.identity.id==='SYN-cold')await gate.promise;return{close:async()=>{}};}});
 const warm=await pool.acquire(user('SYN-warm'));warm.release();
 const cold=Array.from({length:8},()=>pool.acquire(user('SYN-cold')));
 try{
  await turn();
  const hot=await bounded(pool.acquire(user('SYN-warm')));assert.equal(hot.studio,warm.studio);hot.release();
  assert.equal(creates,2);gate.resolve();
  const leases=await Promise.all(cold);assert(leases.every(handle=>handle.studio===leases[0].studio));
  leases.forEach(handle=>{handle.release();handle.release();});
 }finally{gate.resolve();await Promise.allSettled(cold);await pool.close();}
});

test('a slow initializer does not block another cold user; failure frees its slot and can retry',async()=>{
 const slow=deferred();let attempts=0;
 const pool=createRuntimePool({max:2,create:async person=>{
  if(person.identity.id==='SYN-slow'&&++attempts===1)await slow.promise;
  return{close:async()=>{}};
 }});
 const first=pool.acquire(user('SYN-slow')),rejection=assert.rejects(first,/synthetic init failure/);
 try{
  const second=await bounded(pool.acquire(user('SYN-other')));second.release();
  slow.reject(new Error('synthetic init failure'));await rejection;
  const retried=await pool.acquire(user('SYN-slow'));assert.equal(attempts,2);retried.release();
 }finally{slow.resolve();await rejection;await pool.close();}
});

test('shutdown drains reserved initialization and closes each created runtime exactly once',async()=>{
 const gate=deferred();let created=0,closed=0;
 const pool=createRuntimePool({max:3,maxInitializing:1,create:async()=>{
  created++;if(created===1)await gate.promise;return{close:async()=>{closed++;}};
 }});
 const a=pool.acquire(user('SYN-A')),b=pool.acquire(user('SYN-B'));
 const settled=Promise.allSettled([a,b]);await turn();assert.equal(created,1);
 const closing=pool.close();assert.equal(pool.close(),closing);
 await assert.rejects(pool.acquire(user('SYN-C')),{status:503});
 gate.resolve();await closing;
 assert((await settled).every(result=>result.status==='rejected'&&result.reason.status===503));
 assert.equal(created,2);assert.equal(closed,2);
});

test('HTTP-idle runtime with a background stream is never evicted',async()=>{
 let busy=true,closed=0,now=0;
 const pool=createRuntimePool({max:1,idleMs:10,now:()=>now,create:async()=>({isBusy:()=>busy,close:async()=>{closed++;}})});
 try{
  const first=await pool.acquire(user('SYN-A'));first.release();now=100;
  await assert.rejects(pool.acquire(user('SYN-B'),{background:true}),{status:429});assert.equal(closed,0);
  busy=false;const second=await pool.acquire(user('SYN-B'));second.release();assert.equal(closed,1);
 }finally{await pool.close();}
 assert.equal(closed,2);
});

test('retiring an idle runtime never blocks unrelated warm users; failed close preserves its cache entry',async()=>{
 const gate=deferred();let now=0,failClose=true;
 const pool=createRuntimePool({max:2,idleMs:10,now:()=>now,create:async person=>({close:async()=>{
  if(person.identity.id==='SYN-A'&&failClose){await gate.promise;throw Error('synthetic close failure');}
 }})});
 const a=await pool.acquire(user('SYN-A'));a.release();now=1;
 const b=await pool.acquire(user('SYN-B'));b.release();now=100;
 const next=pool.acquire(user('SYN-C')),failed=assert.rejects(next,/synthetic close failure/);
 try{
  await turn();const hot=await bounded(pool.acquire(user('SYN-B')));assert.equal(hot.studio,b.studio);hot.release();
  gate.resolve();await failed;const preserved=await pool.acquire(user('SYN-A'));assert.equal(preserved.studio,a.studio);preserved.release();
 }finally{failClose=false;gate.resolve();await failed;await pool.close();}
});

test('invalid or oversized limits are rejected',()=>{
 for(const max of [0,21,1.5])assert.throws(()=>createRuntimePool({max,create:async()=>({})}),/limits/);
 for(const maxInitializing of [0,1.5,21])assert.throws(()=>createRuntimePool({maxInitializing,create:async()=>({})}),/limits/);
});
