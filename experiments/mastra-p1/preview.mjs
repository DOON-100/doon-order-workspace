import {createSyntheticState} from './fixtures.mjs';
import {createReadAdapter} from './policy.mjs';
import {createSandbox,openSuggestionStore,assertIsolatedEnvironment} from './sandbox.mjs';
import {startReadonlyServer} from './server.mjs';
import {generateSyntheticSuggestions} from './generate.mjs';

assertIsolatedEnvironment();
const args=process.argv.slice(2);
if(!args.includes('--synthetic'))throw new Error('请显式运行 npm run preview -- --synthetic；实验仅使用内置合成数据');
let resume;
for(let index=0;index<args.length;index++) {
  if(args[index]==='--synthetic'||args[index]==='--prepare-only')continue;
  if(args[index]==='--resume' && args[index+1]){resume=args[++index];continue;}
  throw new Error('不支持的实验参数');
}
const directory=resume||await createSandbox();
const adapter=await createReadAdapter(createSyntheticState());
const reader=await openSuggestionStore(directory),server=await startReadonlyServer({adapter,store:reader});
let stopping=false;
async function stop(){if(stopping)return;stopping=true;await server.close();reader.close();}
try {
  const runs=[];
  // A nonempty sandbox may be an interrupted partial run. Recompute both fixed
  // synthetic employees; the suggestion ledger preserves existing rows unchanged.
  const writer=await openSuggestionStore(directory,{readOnly:false});
  try {for(const actorId of ['syn-employee-a','syn-employee-b'])runs.push(await generateSyntheticSuggestions({origin:server.origin,adapter,store:writer,actorId}));}
  finally{writer.close();}
  console.log('PREVIEW_READY '+JSON.stringify({url:server.origin,directory,suggestions:reader.count(),resumed:Boolean(resume),runs,synthetic:true}));
  if(args.includes('--prepare-only'))await stop();
  else for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stop().catch(error=>{console.error(error.message);process.exitCode=1;});});
}catch(error){await stop();throw error;}
