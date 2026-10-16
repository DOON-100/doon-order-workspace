import {writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {createSyntheticState} from './fixtures.mjs';
import {createReadAdapter} from './policy.mjs';
import {createSandbox,openSuggestionStore,assertIsolatedEnvironment,validateSandbox} from './sandbox.mjs';
import {startReadonlyServer,syntheticSession} from './server.mjs';
import {createProjectIdentity} from './project-auth.mjs';
import {createGatewayIdentity} from './gateway-identity.mjs';
import {createProjectReadPolicy} from './project-policy.mjs';
import {generateSyntheticSuggestions} from './generate.mjs';

assertIsolatedEnvironment();
const args=process.argv.slice(2);
if(!args.includes('--synthetic'))throw new Error('请显式运行 npm run preview -- --synthetic；实验仅使用内置合成数据');
let resume;
for(let index=0;index<args.length;index++) {
  if(args[index]==='--synthetic'||args[index]==='--prepare-only'||args[index]==='--gateway-auth')continue;
  if(args[index]==='--resume' && args[index+1]){resume=args[++index];continue;}
  throw new Error('不支持的实验参数');
}
const directory=resume||await createSandbox();
// Reject an invalid resume path before provisioning any synthetic accounts.
await validateSandbox(directory);
let identity,reader,server,stopping=false;
async function stop(){
  if(stopping)return;stopping=true;
  try {if(server)await server.close();else await identity?.close();}
  finally {reader?.close();}
}
try {
  const state=createSyntheticState(),adapter=await createReadAdapter(state),projectPolicy=await createProjectReadPolicy(state);
  const provision=await (args.includes('--gateway-auth')?createGatewayIdentity:createProjectIdentity)({state,adapter});identity=provision.identity;
  const {credentials}=provision;
  reader=await openSuggestionStore(directory);
  server=await startReadonlyServer({adapter,store:reader,identity,projectPolicy});
  const runs=[];
  // A nonempty sandbox may be an interrupted partial run. Recompute both fixed
  // synthetic employees; the suggestion ledger preserves existing rows unchanged.
  const writer=await openSuggestionStore(directory,{readOnly:false});
  try {
    for(const actorId of ['syn-employee-a','syn-employee-b']) {
      const {username,password}=credentials.find(item=>item.actorId===actorId);
      const sessionCookie=await syntheticSession(server.origin,{username,password});
      runs.push(await generateSyntheticSuggestions({origin:server.origin,adapter,store:writer,sessionCookie,resolveSession:server.resolveSession}));
    }
  }
  finally{writer.close();}
  let credentialsFile=null;
  if(!args.includes('--prepare-only')) {
    const root=await validateSandbox(directory);
    credentialsFile=path.join(root,`credentials-${randomUUID()}.json`);
    await writeFile(credentialsFile,JSON.stringify({application:'doon-mastra-p1',syntheticOnly:true,credentials:credentials.filter(item=>['syn-employee-a','syn-employee-b'].includes(item.actorId))},null,2)+'\n',{encoding:'utf8',flag:'wx',mode:0o600});
  }
  console.log('PREVIEW_READY '+JSON.stringify({url:server.origin,directory,credentialsFile,suggestions:reader.count(),resumed:Boolean(resume),runs,synthetic:true,authentication:provision.evidence.implementation}));
  if(args.includes('--prepare-only'))await stop();
  else for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stop().catch(error=>{console.error(error.message);process.exitCode=1;});});
}catch(error){await stop();throw error;}
