import {createHash} from 'node:crypto';
export const userSchema=id=>'agent_user_'+createHash('sha256').update(id).digest('hex').slice(0,32);

// Persisted schemas are never removed by cache eviction. A small bounded cache
// protects the shared server; entries are retired only after an idle interval.
export function createRuntimePool({create,max=4,idleMs=15*60000,now=()=>Date.now()}){
 const entries=new Map();let queue=Promise.resolve();
 const serial=fn=>{const next=queue.then(fn);queue=next.catch(()=>{});return next;};
 return{
  acquire(user){return serial(async()=>{
   const id=String(user.identity?.id||user.username);let entry=entries.get(id);
   if(!entry){
    for(const [key,candidate] of entries)if(!candidate.active&&now()-candidate.used>idleMs){await candidate.runtime.close();entries.delete(key);}
    if(entries.size>=max)throw Object.assign(new Error('工作台当前使用人数已满，请稍后重试。'),{status:429});
    const runtime=await create(user,userSchema(id));entry={runtime,active:0,used:now()};entries.set(id,entry);
   }
   entry.active++;entry.used=now();let released=false;
   return{studio:entry.runtime,release(){if(!released){entry.active--;entry.used=now();released=true;}}};
  });},
  async close(){await queue;await Promise.all([...entries.values()].map(entry=>entry.runtime.close()));entries.clear();},
 };
}
