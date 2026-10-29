import {createStudio} from '../mastra-studio/server.mjs';
import {createStudioAssets} from '../mastra-studio/assets.mjs';
import {createCloudStorage} from '../mastra-studio/postgres.mjs';
import {createSessionChecker,sessionCheckOptions} from './session.mjs';
import {createAgentServer} from './http-server.mjs';
import {createBusinessReader,createBusinessAccess,withBusinessAccess} from './business-api.mjs';
import {createRuntimePool} from './runtime-pool.mjs';
import {loadScheduleKey,createScheduleClient} from './schedule-client.mjs';
import {createScheduleWorker} from './schedule-worker.mjs';
import {processModelScheduler} from '../mastra-studio/model-scheduler.mjs';
import {createProcessChangeClient,createProcessChangeSession} from './process-change-client.mjs';

const publicOrigin=process.env.DOON_AGENT_PUBLIC_ORIGIN;
const authenticate=createSessionChecker({publicOrigin,connectHost:process.env.DOON_PLATFORM_CONNECT_HOST||'host.docker.internal',...sessionCheckOptions(process.env)});
// Aggregate counters only; no cookies, their hashes, identities or upstream responses.
let lastAuthSummary='';
const authMetrics=setInterval(()=>{const summary=authenticate.stats(),serialized=JSON.stringify(summary);if(summary.requests&&serialized!==lastAuthSummary){lastAuthSummary=serialized;console.log(JSON.stringify({event:'session-check-summary',...summary}));}},60000);authMetrics.unref();
const live=process.env.DOON_AGENT_DATA_MODE==='live-readonly';
const pool=live?createRuntimePool({create:async(user,schema)=>{
 const storage=await createCloudStorage(process.env,{schemaName:schema});
 try{return await createStudio({dataDir:'/tmp/agent-studio/'+schema,storage,cloud:true,liveReadOnly:true,scopeId:schema});}catch(error){await storage.close();throw error;}
}}):null;
const studio=live?null:await createStudio({dataDir:'/tmp/agent-studio',storage:await createCloudStorage(),cloud:true});
const staticStudio=live?createStudioAssets({cloud:true,liveReadOnly:true,hasManager:true,hasWorkflowManager:true,documentsEnabled:true}):studio.assets;
const read=live?createBusinessReader({publicOrigin,connectHost:process.env.DOON_PLATFORM_CONNECT_HOST||'host.docker.internal'}):null;
// Opt-in only; a code/image update alone must never enable business confirmations.
const processChangeClient=live&&process.env.DOON_AGENT_PROCESS_CHANGES_ENABLED==='1'?createProcessChangeClient({publicOrigin,connectHost:process.env.DOON_PLATFORM_CONNECT_HOST||'host.docker.internal'}):null;
const purchaseChangeClient=live&&process.env.DOON_AGENT_PURCHASE_CHANGES_ENABLED==='1'?createProcessChangeClient({publicOrigin,connectHost:process.env.DOON_PLATFORM_CONNECT_HOST||'host.docker.internal',domain:'purchase'}):null;
const scheduleKey=live?await loadScheduleKey():null,scheduleClient=scheduleKey?createScheduleClient({publicOrigin,key:scheduleKey,connectHost:process.env.DOON_PLATFORM_CONNECT_HOST||'host.docker.internal'}):null;
const scheduleWorker=scheduleClient?createScheduleWorker({client:scheduleClient,pool}):null;
const server=createAgentServer({publicOrigin,studio,staticStudio,authenticate,syntheticOnly:!live,schedulerStatus:()=>scheduleWorker?.status()||{state:'disabled'},...(live?{acquireRuntime:user=>pool.acquire(user),businessAccess:({cookie,user,stageProcessDraft,stagePurchaseDraft})=>createBusinessAccess({cookie,user,authenticate,read,scheduleClient,stageProcessDraft,stagePurchaseDraft,schedulerStatus:()=>scheduleWorker?.status()}),withAccess:withBusinessAccess}:{} ),...(processChangeClient?{processChanges:({cookie,user})=>createProcessChangeSession({cookie,user,authenticate,client:processChangeClient})}:{}),...(purchaseChangeClient?{purchaseChanges:({cookie,user})=>createProcessChangeSession({cookie,user,authenticate,client:purchaseChangeClient,domain:'purchase'})}:{})});
await staticStudio.warm();
scheduleWorker?.start();
server.listen(8799,'0.0.0.0',()=>console.log(JSON.stringify({event:'ready',service:'agent-studio',syntheticOnly:!live,model:process.env.DOON_STUDIO_MODEL||'offline'})));
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{void processModelScheduler.close();void scheduleWorker?.close();server.close(async()=>{await processModelScheduler.close();await scheduleWorker?.close();await(pool||studio).close();clearInterval(authMetrics);authenticate.close();process.exit(0);});});
