import {AsyncLocalStorage} from 'node:async_hooks';

// Server-only identity/authorization closures. Never put cookies in model
// arguments, requestContext, traces, queue receipts or persistent storage.
const accessContext=new AsyncLocalStorage();
export const withModelAccess=(access,operation)=>accessContext.run(access,operation);
export const currentModelAccess=()=>accessContext.getStore();
export class ModelScheduleError extends Error{
 constructor(message,status,code){super(message);this.name='ModelScheduleError';this.status=status;this.code=code;}
}
const failure=(code)=>{
 const [message,status]={full:['当前模型等待人数已满，请稍后再试。',429],owner:['本账号已有等待请求，请等待完成或先停止。',429],timeout:['模型调用超时，请核查本次结果后重试。',504],waiting:['模型等待超时，请稍后重新提交。',504],closed:['模型服务正在关闭，请稍后重新提交。',503],authorization:['登录或权限已变化，本次等待请求未调用模型。',403]}[code];
 return new ModelScheduleError(message,status,code);
};

// A single process owns this bounded, ephemeral queue. A permit covers fetching
// headers AND consuming/cancelling the upstream body, not the Studio HTTP ACK.
export function createModelScheduler({maxRunning=6,maxQueued=20,waitMs=120000,runMs=60000,now=Date.now}={}){
 if(!Number.isInteger(maxRunning)||maxRunning<1||maxRunning>20||!Number.isInteger(maxQueued)||maxQueued<0||maxQueued>100||![waitMs,runMs].every(value=>Number.isFinite(value)&&value>0))throw Error('Invalid model scheduler limits');
 const queue=[],running=new Set(),owners=new Set();let closed=false,lastOwner;
 const stats={started:0,completed:0,failed:0,cancelled:0,timedOut:0,rejected:0,peakRunning:0,peakQueued:0,totalWaitMs:0,maxWaitMs:0};
 const cancelled=signal=>signal?.reason||new DOMException('模型调用已停止。','AbortError');
 function pump(){
  while(!closed&&running.size<maxRunning){
   // One running call per owner; prefer a different owner on the next turn.
   let index=queue.findIndex(job=>!owners.has(job.owner)&&job.owner!==lastOwner);
   if(index<0)index=queue.findIndex(job=>!owners.has(job.owner));
   if(index<0)return;
   const [job]=queue.splice(index,1);clearTimeout(job.timer);job.signal?.removeEventListener('abort',job.cancel);
   running.add(job);owners.add(job.owner);lastOwner=job.owner;
   const waited=now()-job.created;stats.totalWaitMs+=waited;stats.maxWaitMs=Math.max(stats.maxWaitMs,waited);stats.started++;stats.peakRunning=Math.max(stats.peakRunning,running.size);
   void execute(job);
  }
 }
 function discard(job,error){
  const index=queue.indexOf(job);if(index<0)return;
  queue.splice(index,1);clearTimeout(job.timer);job.signal?.removeEventListener('abort',job.cancel);
  if(error.code==='waiting')stats.timedOut++;else stats.cancelled++;
  job.reject(error);pump();
 }
 async function execute(job){
  const controller=new AbortController(),signal=job.signal?AbortSignal.any([job.signal,controller.signal]):controller.signal;
  let reader,output,finished=false,aborting=false;
  let finishDone;job.done=new Promise(resolve=>{finishDone=resolve;});
  const finish=outcome=>{
   if(finished)return;finished=true;clearTimeout(timer);signal.removeEventListener('abort',abort);
   running.delete(job);owners.delete(job.owner);stats[outcome]++;finishDone();pump();
  };
  const abort=()=>{
   if(finished||aborting)return;aborting=true;
   const reason=signal.reason,publicError=reason instanceof ModelScheduleError?reason:cancelled(signal);
   job.reject(publicError);if(output)output.error(publicError);
   const outcome=reason?.code==='timeout'?'timedOut':'cancelled';
   if(reader)void reader.cancel(publicError).catch(()=>{}).finally(()=>finish(outcome));else finish(outcome);
  };
  job.stop=()=>controller.abort(failure('closed'));
  const timer=setTimeout(()=>controller.abort(failure('timeout')),runMs);timer.unref?.();
  signal.addEventListener('abort',abort,{once:true});
  try{
   signal.throwIfAborted();
   if(job.authorize){try{await job.authorize();}catch{throw failure('authorization');}}
   signal.throwIfAborted();
   const response=await job.fetchImpl(job.input,{...job.init,signal});
   if(signal.aborted){await response.body?.cancel().catch(()=>{});return;}
   if(!response.body){finish(response.ok?'completed':'failed');job.resolve(response);return;}
   reader=response.body.getReader();
   const body=new ReadableStream({
    start(controller){output=controller;},
    async pull(controller){
     try{
      const part=await reader.read();if(finished||aborting)return;
      if(part.done){controller.close();finish(response.ok?'completed':'failed');}else controller.enqueue(part.value);
     }catch(error){if(!finished&&!aborting){controller.error(error);finish('failed');}}
    },
    async cancel(){output=null;controller.abort(new DOMException('模型输出已停止。','AbortError'));await job.done;},
   },{highWaterMark:0});
   job.resolve(new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers}));
  }catch(error){if(!finished){job.reject(error);finish(signal.aborted?'cancelled':'failed');}}
 }
 return{
  fetch(fetchImpl,input,init={},access={}){
   const owner=String(access.owner||'local');
   if(closed)return Promise.reject(failure('closed'));
   if(init.signal?.aborted)return Promise.reject(cancelled(init.signal));
   if(queue.some(job=>job.owner===owner)){stats.rejected++;return Promise.reject(failure('owner'));}
   if((running.size>=maxRunning||owners.has(owner))&&queue.length>=maxQueued){stats.rejected++;return Promise.reject(failure('full'));}
   return new Promise((resolve,reject)=>{
    const job={owner,authorize:access.authorize,fetchImpl,input,init,signal:init.signal,created:now(),resolve,reject};
    job.cancel=()=>discard(job,cancelled(job.signal));job.signal?.addEventListener('abort',job.cancel,{once:true});
    job.timer=setTimeout(()=>discard(job,failure('waiting')),waitMs);job.timer.unref?.();queue.push(job);pump();stats.peakQueued=Math.max(stats.peakQueued,queue.length);
   });
  },
  snapshot(owner){
   const own=queue.filter(job=>job.owner===owner);
   return{limits:{running:maxRunning,queued:maxQueued,waitMs,runMs},active:running.size,queued:queue.length,closed,own:{active:owners.has(owner)?1:0,queued:own.length,waitingMs:own.length?Math.max(0,now()-own[0].created):0},...stats};
  },
  async close(){closed=true;for(const job of [...queue])discard(job,failure('closed'));const jobs=[...running];for(const job of jobs)job.stop();await Promise.all(jobs.map(job=>job.done));},
 };
}

// All account runtimes in this Agent container share these six permits.
export const processModelScheduler=createModelScheduler({maxRunning:Number(process.env.DOON_AGENT_MODEL_MAX_RUNNING||6),maxQueued:Number(process.env.DOON_AGENT_MODEL_MAX_QUEUED||20)});
