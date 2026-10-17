import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
let pending;
// Reuse the real checked-out authorization functions. No business runtime is imported.
export function loadBusinessPolicy(){
 return pending??=(async()=>{
  const out=await build({stdin:{contents:`export {canRead} from './lib/domain'; export {visiblePurchases,remaining} from './lib/purchases'; export {canReadProject} from './lib/customer-projects'; export {canReadServiceRecord} from './lib/service-workspace'; export {getVisibleProjectFollowups} from './lib/customer-project-followup';`,resolveDir:root,loader:'ts'},absWorkingDir:root,bundle:true,write:false,format:'esm',platform:'node',logLevel:'silent',plugins:[{name:'deny-business-runtime',setup(b){
   b.onResolve({filter:/^\.\/store$/},()=>({path:'store',namespace:'studio-pure'}));
   b.onLoad({filter:/.*/,namespace:'studio-pure'},()=>({contents:'export class AppError extends Error { constructor(message,status=400){super(message);this.status=status;} }'}));
   b.onResolve({filter:/^(cloudflare:|chatgpt-auth|@\/)/},()=>({errors:[{text:'Business runtime imports are forbidden in snapshot policy'}]}));
  }}]});
  return import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
 })();
}
