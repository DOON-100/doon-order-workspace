import {createStudio} from '../mastra-studio/server.mjs';
import {createCloudStorage} from '../mastra-studio/postgres.mjs';
import {createSessionChecker} from './session.mjs';
import {createAgentServer} from './http-server.mjs';

const publicOrigin=process.env.DOON_AGENT_PUBLIC_ORIGIN;
const authenticate=createSessionChecker({publicOrigin,connectHost:process.env.DOON_PLATFORM_CONNECT_HOST||'host.docker.internal'});
const storage=await createCloudStorage();
const studio=await createStudio({dataDir:'/tmp/agent-studio',storage,cloud:true});
const server=createAgentServer({publicOrigin,studio,authenticate});
server.listen(8799,'0.0.0.0',()=>console.log(JSON.stringify({event:'ready',service:'agent-studio',syntheticOnly:true,model:process.env.DOON_STUDIO_MODEL||'offline'})));
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>server.close(async()=>{await studio.close();process.exit(0);}));
