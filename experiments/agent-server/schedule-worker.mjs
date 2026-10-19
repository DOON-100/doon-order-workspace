import {randomUUID} from 'node:crypto';
import {createScheduledAccess} from './schedule-client.mjs';
import {withBusinessAccess} from './business-api.mjs';
import {withWorkflowToolContext} from '../mastra-studio/workflow-tools.mjs';

// One leased worker across containers; users and their durable schemas are
// discovered from explicit grants without opening Studio or persisting cookies.
export function createScheduleWorker({client,pool,intervalMs=15000,renewMs=20000}){
 const workerId=randomUUID();let timer,renewal,running,stopping=false,fence,valid=false,renewing;
 let state={state:'starting',lastTick:null,lastError:null};
 const worker=()=>({workerId,fence});
 const service=(action,body)=>client('service/'+action,body,{service:true});
 async function renew(){if(renewing||!valid)return;renewing=service('lease',worker());try{const lease=await renewing;if(!lease.acquired||lease.fence!==fence)valid=false;}catch{valid=false;state.lastError='lease-unavailable';}finally{renewing=null;}}
 async function perform(){
  if(stopping)return[];const results=[];
  try{
   const lease=await service('lease',worker());if(!lease.acquired){state.state='standby';return[];}fence=lease.fence;valid=true;state.state='running';renewal=setInterval(()=>void renew(),renewMs);renewal.unref();
   const {users}=await service('owners',worker());
   for(const user of users){
    if(!valid||stopping)break;let handle;
    try{handle=await pool.acquire(user,{background:true});const manager=handle.studio.workflowManager;
     const output=await manager.processTriggers(async(ownerId,{row,control,trigger})=>{
      if(ownerId!==user.identity.id||trigger.mode!=='schedule'||!control?.payload.enabled||control.payload.configVersionId!==row.versionId||!control.payload.grantId||!valid)return null;
      return createScheduledAccess({client,worker,user,grantId:control.payload.grantId,configVersionId:row.versionId,trigger,valid:()=>valid&&!stopping});
     },{runWithAccess:(access,operation)=>withBusinessAccess(access,()=>withWorkflowToolContext({actor:{id:user.identity.id,name:user.identity.name,role:user.role},workflowAccess:access,readOnly:true},operation))});results.push(...output);
    }catch{results.push({status:'runtime-unavailable'});}finally{handle?.release();}
   }
   state={state:valid?'idle':'blocked',lastTick:new Date().toISOString(),lastError:results.some(r=>['blocked','needs-attention','runtime-unavailable'].includes(r.status))?'task-needs-attention':null};return results;
  }catch{state={...state,state:'blocked',lastError:'bridge-unavailable'};return[{status:'bridge-unavailable'}];}
  finally{clearInterval(renewal);renewal=null;valid=false;await renewing?.catch(()=>{});}
 }
 const tick=()=>running||((running=perform()).finally(()=>{running=null;}));
 return{
  tick,status:()=>({...state}),
  start(){if(!timer){void tick();timer=setInterval(()=>void tick(),intervalMs);timer.unref();}},
  async close(){stopping=true;clearInterval(timer);timer=null;await running;if(fence)try{await service('lease',{...worker(),release:true});}catch{}state.state='stopped';},
 };
}
