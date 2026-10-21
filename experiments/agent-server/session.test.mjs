import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createSessionChecker,sessionCheckOptions,canEnterStudio} from './session.mjs';
import {createAgentServer} from './http-server.mjs';

const cookie=n=>'doon_employee_session='+n.repeat(43);
const user={username:'SYN-user',identity:{id:'SYN-A'},role:'admin',personnelType:'internal',mustChange:false};
let directory,key,cert;
before(async()=>{
 directory=await fs.mkdtemp(path.join(os.tmpdir(),'doon-auth-tls-'));
 const openssl=process.env.DOON_TEST_OPENSSL||(existsSync('C:/Program Files/Git/usr/bin/openssl.exe')?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl');
 execFileSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-days','2','-keyout',path.join(directory,'key.pem'),'-out',path.join(directory,'cert.pem'),'-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost'],{stdio:'ignore',windowsHide:true});
 [key,cert]=await Promise.all(['key.pem','cert.pem'].map(name=>fs.readFile(path.join(directory,name))));
});
after(async()=>{await fs.rm(directory,{recursive:true,force:true});});
async function fixture(t,handle,options={}){
 let requests=0;const sockets=new Set();
 const server=https.createServer({key,cert},(req,res)=>{requests++;handle(req,res,requests);});
 server.on('connection',s=>{sockets.add(s);s.once('close',()=>sockets.delete(s));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const agent=new https.Agent({ca:cert,keepAlive:true,maxSockets:8});
 const origin='https://localhost:'+server.address().port;
 const check=createSessionChecker({publicOrigin:origin,connectHost:'127.0.0.1',agent,totalTimeoutMs:1000,attemptTimeoutMs:600,retryDelayMs:10,...options});
 t.after(async()=>{check.close();agent.destroy();for(const s of sockets)s.destroy();await new Promise(resolve=>server.close(resolve));});
 return{check,server,origin,requests:()=>requests};
}
const send=(res,value=user,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify({user:value}));};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('default limits accept an authentication response slower than the old four-second cutoff',async t=>{
 const f=await fixture(t,(_req,res)=>setTimeout(()=>send(res),4200),sessionCheckOptions());
 const start=performance.now();assert.equal((await f.check(cookie('a'))).username,'SYN-user');assert(performance.now()-start>=4200);assert.equal(f.requests(),1);assert.equal(f.check.stats().retries,0);
});

test('20 overlapping requests share one real TLS lookup; completed results never survive revocation',async t=>{
 let current=user;
 const f=await fixture(t,(_req,res)=>setTimeout(()=>send(res,current),35));
 const results=await Promise.all(Array.from({length:20},()=>f.check(cookie('a'))));
 assert.equal(f.requests(),1);assert.equal(f.check.stats().coalesced,19);
 results[0].identity.id='mutated';assert.equal(results[1].identity.id,'SYN-A');
 current=null;assert.equal(await f.check(cookie('a')),null);assert.equal(f.requests(),2);
 current={...user,active:false};assert.equal(canEnterStudio(await f.check(cookie('a'))),false);
 current={...user,personnelType:'external'};assert.equal(canEnterStudio(await f.check(cookie('a'))),false);
 current={...user,role:'viewer'};assert.equal((await f.check(cookie('a'))).role,'viewer');assert.equal(f.requests(),5);
 assert.equal(f.check.stats().inFlight,0);
 const metrics=JSON.stringify(f.check.stats());for(const secret of [cookie('a'),'SYN-user','SYN-A','doon_employee_session'])assert(!metrics.includes(secret));
});

test('different cookies remain isolated; only filtered cookies reach the fixed session GET',async t=>{
 const seen=[];
 const f=await fixture(t,(req,res)=>{seen.push(req.headers.cookie);assert.equal(req.method,'GET');assert.equal(req.url,'/api/auth/session');assert.equal(req.headers.authorization,undefined);assert.equal(req.headers.host,new URL(f.origin).host);setTimeout(()=>send(res,{...user,username:req.headers.cookie===cookie('a')?'SYN-A':'SYN-B'}),20);});
 const [a,b,a2]=await Promise.all([f.check(cookie('a')+'; unrelated=private'),f.check(cookie('b')),f.check('unrelated=other; '+cookie('a'))]);
 assert.equal(a.username,'SYN-A');assert.equal(a2.username,'SYN-A');assert.equal(b.username,'SYN-B');assert.equal(f.requests(),2);
 assert.deepEqual(new Set(seen),new Set([cookie('a'),cookie('b')]));assert.equal(await f.check('doon_session=invalid'),null);assert.equal(f.requests(),2);
});

test('a network reset retries only the session GET once, shared by all waiters',async t=>{
 const f=await fixture(t,(req,res,n)=>{if(n===1)req.socket.destroy();else send(res);});
 const result=await Promise.all(Array.from({length:12},()=>f.check(cookie('a'))));
 assert(result.every(v=>v.username==='SYN-user'));assert.equal(f.requests(),2);assert.equal(f.check.stats().retries,1);
});

test('a real retried TLS session check allows one original POST, and no action after exhausted retries',async t=>{
 let mode='recover',actions=0;
 const f=await fixture(t,(_req,res,n)=>send(res,user,mode==='recover'&&n===2?200:503));
 const gateway=createAgentServer({publicOrigin:'https://synthetic.test',authenticate:f.check,studio:{handle:async request=>{assert.equal(request.method,'POST');assert.equal(await request.text(),'SYN-payload');actions++;return Response.json({ok:true});}}});
 await new Promise(resolve=>gateway.listen(0,'127.0.0.1',resolve));
 const post=()=>new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:gateway.address().port,path:'/studio/api/save',method:'POST',headers:{Host:'synthetic.test',Origin:'https://synthetic.test',Cookie:cookie('a')}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end('SYN-payload');});
 try{assert.equal(await post(),200);assert.equal(f.requests(),2);assert.equal(actions,1);mode='fail';assert.equal(await post(),503);assert.equal(f.requests(),4);assert.equal(actions,1);}
 finally{gateway.closeAllConnections();await new Promise(resolve=>gateway.close(resolve));}
});

test('transient 503 retries once; denial, rate limiting, redirects and malformed bodies do not retry',async t=>{
 let mode='transient';
 const f=await fixture(t,(_req,res,n)=>{
  if(mode==='transient')return n===1?send(res,null,503):send(res);
  if(typeof mode==='number')return send(res,null,mode);
  res.writeHead(200,{'Content-Type':mode==='html'?'text/html':'application/json'});res.end(mode==='large'?'x'.repeat(32769):mode==='schema'?'{}':'broken');
 });
 assert.equal((await f.check(cookie('a'))).username,'SYN-user');assert.equal(f.requests(),2);
 for(mode of [401,403,429,302,400,'html','large','schema','json']){
  const before=f.requests();
  if(mode===401)assert.equal(await f.check(cookie('a')),null);
  else await assert.rejects(f.check(cookie('a')),e=>e.code===(mode===403?'AUTH_FORBIDDEN':'AUTH_UNAVAILABLE'));
  assert.equal(f.requests(),before+1,String(mode));assert.equal(f.check.stats().inFlight,0);
 }
});

test('the total deadline bounds stalled headers and a trickling body; failures are not cached',async t=>{
 let mode='stall';
 const f=await fixture(t,(_req,res)=>{
  if(mode==='fast')return send(res);
  if(mode==='trickle'){res.writeHead(200,{'Content-Type':'application/json'});const timer=setInterval(()=>res.write(' '),15);res.once('close',()=>clearInterval(timer));}
 },{totalTimeoutMs:240,attemptTimeoutMs:150,retryDelayMs:15});
 for(mode of ['stall','trickle']){
  const start=performance.now(),before=f.requests();await assert.rejects(f.check(cookie('a')),{code:'AUTH_TIMEOUT'});
  const elapsed=performance.now()-start;assert(elapsed>=210&&elapsed<900,`elapsed ${elapsed}`);assert.equal(f.requests(),before+2);assert.equal(f.check.stats().inFlight,0);
 }
 mode='fast';assert.equal((await f.check(cookie('a'))).username,'SYN-user');assert.equal(f.requests(),5);
});

test('bounded retry recovers a slow first lookup within the same total budget',async t=>{
 const f=await fixture(t,(_req,res,n)=>{if(n===2)send(res);},{totalTimeoutMs:400,attemptTimeoutMs:150,retryDelayMs:10});
 assert.equal((await f.check(cookie('a'))).username,'SYN-user');assert.equal(f.requests(),2);assert.equal(f.check.stats().retries,1);
});

test('one cancellation does not cancel another waiter; the last cancellation releases the lookup',async t=>{
 let respond;
 const f=await fixture(t,(_req,res)=>{respond=()=>send(res);});
 const a=new AbortController(),b=new AbortController();
 const first=f.check(cookie('a'),{signal:a.signal}),second=f.check(cookie('a'),{signal:b.signal});
 const rejected=assert.rejects(first,{code:'AUTH_CANCELLED'});
 while(!respond)await wait(5);a.abort();await rejected;respond();assert.equal((await second).username,'SYN-user');assert.equal(f.requests(),1);
 respond=null;const last=new AbortController(),pending=f.check(cookie('a'),{signal:last.signal});const lastRejected=assert.rejects(pending,{code:'AUTH_CANCELLED'});
 while(!respond)await wait(5);last.abort();await lastRejected;await wait(30);assert.equal(f.check.stats().inFlight,0);assert.equal(f.check.stats().retries,0);
 respond=null;const next=f.check(cookie('a'));while(!respond)await wait(5);respond();await next;assert.equal(f.requests(),3);
});

test('pending capacity, abort before start, and shutdown are bounded and fail closed',async t=>{
 const f=await fixture(t,()=>{},{maxPending:1});
 const a=new AbortController();a.abort();await assert.rejects(f.check(cookie('a'),{signal:a.signal}),{code:'AUTH_CANCELLED'});assert.equal(f.requests(),0);
 const pending=f.check(cookie('a'));const rejected=assert.rejects(pending,{code:'AUTH_CANCELLED'});
 await assert.rejects(f.check(cookie('b')),{code:'AUTH_BUSY'});f.check.close();await rejected;assert.equal(f.check.stats().inFlight,0);
 await assert.rejects(f.check(cookie('a')),{code:'AUTH_CANCELLED'});
});

test('certificate trust and hostname validation remain mandatory; TLS failure is not retried',async t=>{
 const f=await fixture(t,(_req,res)=>send(res));
 const untrusted=createSessionChecker({publicOrigin:f.origin,connectHost:'127.0.0.1'});
 t.after(()=>untrusted.close());await assert.rejects(untrusted(cookie('a')),{code:'AUTH_UNAVAILABLE'});assert.equal(untrusted.stats().attempts,1);
 const agent=new https.Agent({ca:cert});const wrongHost=createSessionChecker({publicOrigin:f.origin.replace('localhost','127.0.0.1'),connectHost:'127.0.0.1',agent});
 t.after(()=>{wrongHost.close();agent.destroy();});await assert.rejects(wrongHost(cookie('a')),{code:'AUTH_UNAVAILABLE'});assert.equal(wrongHost.stats().attempts,1);assert.equal(f.requests(),0);
});

test('timeout configuration has finite defaults and rejects unsafe values',()=>{
 assert.deepEqual(sessionCheckOptions(),{totalTimeoutMs:8000,attemptTimeoutMs:5000});
 assert.deepEqual(sessionCheckOptions({DOON_AGENT_AUTH_TOTAL_TIMEOUT_MS:'2000'}),{totalTimeoutMs:2000,attemptTimeoutMs:2000});
 for(const value of ['', '0','Infinity','-1','8000junk','30001'])assert.throws(()=>sessionCheckOptions({DOON_AGENT_AUTH_TOTAL_TIMEOUT_MS:value}));
 assert.throws(()=>sessionCheckOptions({DOON_AGENT_AUTH_TOTAL_TIMEOUT_MS:'2000',DOON_AGENT_AUTH_ATTEMPT_TIMEOUT_MS:'3000'}));
});
