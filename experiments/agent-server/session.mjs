import https from 'node:https';
import tls from 'node:tls';
import {isIP} from 'node:net';
import {createHash} from 'node:crypto';

export function parsePublicOrigin(value){
 const url=new URL(value);
 if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash||![url.origin,url.origin+'/'].includes(value))throw new Error('A canonical HTTPS public origin is required');
 return url;
}
export function sessionCookie(value=''){
 if(value.length>8192)return '';
 return value.split(';').map(item=>item.trim()).filter(item=>/^(doon_employee_session|doon_session)=[\w-]{43}$/.test(item)).join('; ');
}
export class SessionCheckError extends Error{
 constructor(code='AUTH_UNAVAILABLE',{retryable=false}={}){
  super(code==='AUTH_TIMEOUT'?'登录状态验证暂时超时，请稍后重试。':code==='AUTH_FORBIDDEN'?'当前账号无权访问工作台。':'登录状态暂时无法验证，请稍后重试。');
  this.name='SessionCheckError';this.code=code;this.retryable=retryable;
 }
}
export function sessionCheckOptions(env={}){
 const number=(name,fallback,min,max)=>{const raw=env[name],value=raw===undefined?fallback:Number(raw);if((raw!==undefined&&!/^\d+$/.test(raw))||!Number.isInteger(value)||value<min||value>max)throw new Error('Invalid '+name);return value;};
 const totalTimeoutMs=number('DOON_AGENT_AUTH_TOTAL_TIMEOUT_MS',8000,1000,30000);
 const attemptTimeoutMs=number('DOON_AGENT_AUTH_ATTEMPT_TIMEOUT_MS',Math.min(5000,totalTimeoutMs),500,15000);
 if(attemptTimeoutMs>totalTimeoutMs)throw new Error('Authentication attempt exceeds total deadline');
 return{totalTimeoutMs,attemptTimeoutMs};
}
const transientNetwork=new Set(['ECONNRESET','ECONNREFUSED','ETIMEDOUT','EPIPE','EAI_AGAIN','ENETUNREACH','EHOSTUNREACH']);
// The platform remains authoritative. Only overlapping requests share a lookup;
// settled results are removed before delivery, with no grace period or TTL cache.
export function createSessionChecker({publicOrigin,connectHost='host.docker.internal',totalTimeoutMs=8000,attemptTimeoutMs=5000,retryDelayMs=100,maxPending=128,requestImpl=https.request,agent}={}){
 const origin=parsePublicOrigin(publicOrigin);
 if(!['host.docker.internal','127.0.0.1','localhost'].includes(connectHost))throw new Error('Invalid platform connection host');
 for(const [value,max] of [[totalTimeoutMs,30000],[attemptTimeoutMs,totalTimeoutMs],[maxPending,1024]])if(!Number.isInteger(value)||value<1||value>max)throw new Error('Invalid authentication limits');
 if(!Number.isInteger(retryDelayMs)||retryDelayMs<0||retryDelayMs>=totalTimeoutMs)throw new Error('Invalid authentication retry delay');
 const ownedAgent=agent===undefined,transport=agent??new https.Agent({keepAlive:true,maxSockets:32,maxTotalSockets:32,maxFreeSockets:8,timeout:5000});
 const pending=new Map();let closed=false;
 const counts={requests:0,coalesced:0,lookups:0,attempts:0,retries:0,verified:0,expired:0,forbidden:0,timeout:0,unavailable:0,cancelled:0,overloaded:0};
 const timings={connect:{count:0,totalMs:0,maxMs:0},firstByte:{count:0,totalMs:0,maxMs:0},lookup:{count:0,totalMs:0,maxMs:0}};
 const observe=(name,ms)=>{const row=timings[name],value=Math.max(0,Math.round(ms));row.count++;row.totalMs+=value;row.maxMs=Math.max(row.maxMs,value);};
 const cancelled=()=>new SessionCheckError('AUTH_CANCELLED');
 function attempt(cookie,signal,timeoutMs){
  counts.attempts++;
  return new Promise((resolve,reject)=>{
   const start=performance.now();let request,done=false;
   const finish=(error,user)=>{if(done)return;done=true;clearTimeout(timer);signal.removeEventListener('abort',abort);if(error){request?.destroy();reject(error);}else resolve(user);};
   const abort=()=>finish(cancelled());
   // A wall-clock deadline covers DNS, socket admission, TLS and the entire body;
   // receiving a trickle of bytes cannot keep an authorization request alive.
   const timer=setTimeout(()=>finish(new SessionCheckError('AUTH_TIMEOUT',{retryable:true})),timeoutMs);
   signal.addEventListener('abort',abort,{once:true});
   if(signal.aborted){abort();return;}
   try{
    request=requestImpl({hostname:connectHost,port:Number(origin.port||443),path:'/api/auth/session',method:'GET',servername:isIP(origin.hostname)?'':origin.hostname,
     agent:transport,rejectUnauthorized:true,checkServerIdentity:(_,cert)=>tls.checkServerIdentity(origin.hostname,cert),
     headers:{Host:origin.host,Cookie:cookie,Accept:'application/json'}},response=>{
      observe('firstByte',performance.now()-start);
      response.on('error',()=>finish(new SessionCheckError('AUTH_UNAVAILABLE',{retryable:true})));
      response.on('aborted',()=>finish(new SessionCheckError('AUTH_UNAVAILABLE',{retryable:true})));
      const status=response.statusCode;
      if(status===401){finish(null,null);response.destroy();return;}
      if(status===403){finish(new SessionCheckError('AUTH_FORBIDDEN'));return;}
      if(status!==200){finish(new SessionCheckError('AUTH_UNAVAILABLE',{retryable:[502,503,504].includes(status)}));return;}
      if(!/^application\/json(?:\s*;|$)/i.test(response.headers['content-type']||'')){finish(new SessionCheckError());return;}
      let size=0;const chunks=[];
      response.on('data',chunk=>{size+=chunk.length;if(size>32768){finish(new SessionCheckError());return;}if(!done)chunks.push(chunk);});
      response.on('end',()=>{
       if(done)return;
       try{
        const data=JSON.parse(Buffer.concat(chunks));
        if(!data||typeof data!=='object'||Array.isArray(data)||!Object.hasOwn(data,'user')||(data.user!==null&&(typeof data.user!=='object'||Array.isArray(data.user))))throw new Error();
        finish(null,data.user);
       }catch{finish(new SessionCheckError());}
      });
     });
    request.on('socket',socket=>{if(socket.connecting)socket.once('secureConnect',()=>observe('connect',performance.now()-start));else observe('connect',0);});
    request.on('error',error=>finish(new SessionCheckError('AUTH_UNAVAILABLE',{retryable:transientNetwork.has(error.code)})));
    request.end();
   }catch{finish(new SessionCheckError());}
  });
 }
 async function lookup(cookie,signal){
  counts.lookups++;const start=performance.now(),deadline=start+totalTimeoutMs;
  try{
   for(let n=0;n<2;n++){
    if(signal.aborted)throw cancelled();
    const remaining=deadline-performance.now();
    if(remaining<=0)throw new SessionCheckError('AUTH_TIMEOUT');
    try{const user=await attempt(cookie,signal,Math.min(attemptTimeoutMs,remaining));counts[user?'verified':'expired']++;return user;}
    catch(error){
     if(!error.retryable||n===1||signal.aborted||deadline-performance.now()<=retryDelayMs)throw error;
     if(retryDelayMs)await new Promise((resolve,reject)=>{
      const abort=()=>{clearTimeout(timer);reject(cancelled());};
      const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},retryDelayMs);
      signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
     });
     counts.retries++;
    }
   }
  }catch(error){counts[error.code==='AUTH_TIMEOUT'?'timeout':error.code==='AUTH_CANCELLED'?'cancelled':error.code==='AUTH_FORBIDDEN'?'forbidden':'unavailable']++;throw error;}
  finally{observe('lookup',performance.now()-start);}
 }
 function check(cookie,{signal}={}){
  counts.requests++;
  if(closed||signal?.aborted)return Promise.reject(cancelled());
  const filtered=sessionCookie(cookie);if(!filtered)return Promise.resolve(null);
  const key=createHash('sha256').update(filtered).digest('hex');let entry=pending.get(key);
  if(entry)counts.coalesced++;
  else{
   if(pending.size>=maxPending){counts.overloaded++;return Promise.reject(new SessionCheckError('AUTH_BUSY'));}
   entry={controller:new AbortController(),waiters:0,settled:false};pending.set(key,entry);
   entry.promise=Promise.resolve().then(()=>lookup(filtered,entry.controller.signal)).finally(()=>{entry.settled=true;if(pending.get(key)===entry)pending.delete(key);});
  }
  entry.waiters++;
  return new Promise((resolve,reject)=>{
   let finished=false;
   const complete=(error,user)=>{
    if(finished)return;finished=true;signal?.removeEventListener('abort',abort);entry.waiters--;
    if(!entry.waiters&&!entry.settled){if(pending.get(key)===entry)pending.delete(key);entry.controller.abort();}
    if(error)reject(error);else resolve(user?structuredClone(user):null);
   };
   const abort=()=>complete(cancelled());signal?.addEventListener('abort',abort,{once:true});
   entry.promise.then(user=>complete(null,user),error=>complete(error));if(signal?.aborted)abort();
  });
 }
 check.stats=()=>structuredClone({...counts,inFlight:pending.size,timings});
 check.close=()=>{closed=true;for(const entry of pending.values())entry.controller.abort();pending.clear();if(ownedAgent)transport.destroy();};
 return check;
}
export const canEnterStudio=user=>!!user&&typeof user.username==='string'&&user.active!==false&&user.mustChange===false&&user.personnelType==='internal'&&['admin','pmc','production','clerk','sales','finance','programmer','viewer'].includes(user.role);
