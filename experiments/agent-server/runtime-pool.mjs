import {createHash} from 'node:crypto';
export const userSchema=id=>'agent_user_'+createHash('sha256').update(id).digest('hex').slice(0,32);

export const runtimeCacheLimit=20;

// Admission reserves a cache slot before initialization. The short admission
// queue never waits for create(): warm users bypass it and cold users share a
// bounded initialization queue. Eviction only closes idle connections, never
// deletes a user's schema or persisted history.
export function createRuntimePool({create,max=runtimeCacheLimit,maxInitializing=2,idleMs=15*60000,now=()=>Date.now()}){
 if(!Number.isInteger(max)||max<1||max>runtimeCacheLimit||!Number.isInteger(maxInitializing)||maxInitializing<1||maxInitializing>runtimeCacheLimit)throw new Error('Invalid runtime pool limits');
 const entries=new Map(),pending=[];let admission=Promise.resolve(),initializing=0,closing=false,closed;
 const unavailable=()=>Object.assign(new Error('工作台正在关闭，请稍后重试。'),{status:503});
 const serial=fn=>{const next=admission.then(fn);admission=next.catch(()=>{});return next;};
 function pump(){
  while(initializing<maxInitializing&&pending.length){
   const {id,user,entry,resolve,reject}=pending.shift();initializing++;
   Promise.resolve().then(()=>create(user,userSchema(id))).then(runtime=>{
    entry.runtime=runtime;resolve(runtime);
   },error=>{
    if(entries.get(id)===entry)entries.delete(id);
    reject(error);
   }).finally(()=>{initializing--;pump();});
  }
 }
 function reserve(id,user){
  let resolve,reject;const ready=new Promise((yes,no)=>{resolve=yes;reject=no;});
  const entry={ready,runtime:null,active:1,used:now(),retiring:false};
  // The reservation can fail before its acquire continuation starts awaiting.
  ready.catch(()=>{});
  entries.set(id,entry);pending.push({id,user,entry,resolve,reject});pump();return entry;
 }
 function claim(entry){entry.active++;entry.used=now();return entry;}
 async function lease(entry){
  try{await entry.ready;if(closing)throw unavailable();}
  catch(error){entry.active--;entry.used=now();throw error;}
  let released=false;
  return{studio:entry.runtime,release(){if(!released){released=true;entry.active--;entry.used=now();}}};
 }
 const idle=entry=>entry.runtime&&!entry.active&&!entry.retiring&&!entry.runtime.isBusy?.();
 return{
  async acquire(user,{background=false}={}){
   if(closing)throw unavailable();
   const id=String(user.identity?.id||user.username),existing=entries.get(id);
   if(existing&&!existing.retiring)return lease(claim(existing));
   const entry=await serial(async()=>{
    if(closing)throw unavailable();
    const current=entries.get(id);if(current)return claim(current);
    if(entries.size>=max){
     const candidate=[...entries].filter(([,item])=>idle(item)&&(background||now()-item.used>idleMs)).sort((a,b)=>a[1].used-b[1].used)[0];
     if(candidate){
      const [key,item]=candidate;item.retiring=true;
      try{await item.runtime.close();entries.delete(key);}finally{item.retiring=false;}
     }
    }
    if(closing)throw unavailable();
    if(entries.size>=max)throw Object.assign(new Error('工作台当前使用人数已满，请稍后重试。'),{status:429});
    return reserve(id,user);
   });
   return lease(entry);
  },
  close(){
   if(!closed){
    closing=true;
    closed=(async()=>{
     await admission;
     const current=[...entries.values()];
     await Promise.allSettled(current.map(entry=>entry.ready));
     const results=await Promise.allSettled(current.filter(entry=>entry.runtime).map(entry=>entry.runtime.close()));
     entries.clear();
     const failure=results.find(result=>result.status==='rejected');if(failure)throw failure.reason;
    })();
   }
   return closed;
  },
 };
}
