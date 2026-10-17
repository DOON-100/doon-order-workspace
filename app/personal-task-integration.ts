'use client';
import {useEffect,useState} from 'react';

export type IntegratedPersonalTask={id:string;title:string;sourceLabel:string;description:string;status:'pending'|'done';statusLabel:string;originLabel?:string};
// Optional local integration bridge. No requests or additional tasks exist unless
// a server-enabled workbench integration publishes the current actor's feed.
// This is presentation only: actions still recheck identity and payload server-side.
export function useIntegratedPersonalTasks(actorId:string,enabled:boolean){
 const [feed,setFeed]=useState<{actorId:string;tasks:IntegratedPersonalTask[]}>({actorId:'',tasks:[]});
 useEffect(()=>{
  if(!enabled||!actorId)return;
  const receive=(event:Event)=>{
   const data=(event as CustomEvent).detail;if(data?.actorId!==actorId||!Array.isArray(data.tasks))return;
   const tasks:IntegratedPersonalTask[]=data.tasks.filter((row:IntegratedPersonalTask)=>row&&['id','title','sourceLabel','description','statusLabel'].every(key=>typeof row[key as keyof IntegratedPersonalTask]==='string')&&(row.originLabel===undefined||typeof row.originLabel==='string')&&['pending','done'].includes(row.status));
   setFeed(previous=>previous.actorId===actorId&&JSON.stringify(previous.tasks)===JSON.stringify(tasks)?previous:{actorId,tasks});
  };
  window.addEventListener('doon:personal-tasks:update',receive);window.dispatchEvent(new Event('doon:personal-tasks:ready'));
  return()=>window.removeEventListener('doon:personal-tasks:update',receive);
 },[actorId,enabled]);
 return enabled&&feed.actorId===actorId?feed.tasks:[];
}
export const integratedTaskInQueue=(task:IntegratedPersonalTask,queue:string)=>queue==='all'||(queue==='pending'&&task.status==='pending')||(queue==='done'&&task.status==='done');
export function openIntegratedPersonalTask(id:string){window.dispatchEvent(new CustomEvent('doon:personal-tasks:open',{detail:{id}}));}
