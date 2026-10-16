import {build} from 'esbuild';
import {readFile, realpath, lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const projectRoot=fileURLToPath(new URL('../../',import.meta.url));
const sourceNames=Object.freeze([
  'domain','service-workspace','customer-responsibility','customer-quote-access',
  'customer-identities','payment-terms','customer-master-policy','customer-projects',
  'customer-project-assignment','customer-project-followup','customer-project-finance',
  'engineering-drawings','business-team-scope','customer-workflow','customer-workflow-responsibility',
  'customer-workflow-tasks','project-collaboration',
]);
const allowed=new Set(sourceNames.map(name=>path.resolve(projectRoot,'lib',name+'.ts')));
const zodUrl=import.meta.resolve('zod');
const entry=`
export {roles,canRead,allowedFields} from './lib/domain.ts';
export {assignedServiceCustomer} from './lib/service-workspace.ts';
export {customerMasterCapabilities} from './lib/customer-master-policy.ts';
export {businessTeamData,filterBusinessTeamRows} from './lib/business-team-scope.ts';
export {projectAccess,canReadProject,projectTaskPermissions} from './lib/customer-projects.ts';
export {customerTaskCanEdit} from './lib/customer-workflow-tasks.ts';
export {canReadProjectCollaboration,projectCollaborationPermissions} from './lib/project-collaboration.ts';
`;
const samePath=(left,right)=>process.platform==='win32'?left.toLowerCase()===right.toLowerCase():left===right;
const fail=()=>{throw new Error('P1_PROJECT_POLICY_IMPORT_REJECTED');};
let cached;

/** Actual permission source, isolated from production storage, sessions and API mutations. */
export async function loadProjectPermissionFunctions() {
  cached??=(async()=>{
    const hashes=new Map();
    const output=await build({stdin:{contents:entry,resolveDir:projectRoot,loader:'ts'},
      absWorkingDir:projectRoot,bundle:true,write:false,metafile:true,platform:'node',format:'esm',logLevel:'silent',
      plugins:[{name:'explicit-project-permission-boundary',setup(builder){
        builder.onResolve({filter:/.*/},args=>{
          if(args.path==='zod'&&allowed.has(args.importer))return {path:zodUrl,external:true};
          if(args.path==='./store'&&allowed.has(args.importer))return {path:'store',namespace:'blocked-io'};
          if(args.path==='./workbooks'&&args.importer===path.resolve(projectRoot,'lib/customer-workflow-tasks.ts'))return {path:'workbooks',namespace:'blocked-io'};
          if(args.path.startsWith('.')&&(args.importer==='<stdin>'||allowed.has(args.importer))){
            const file=path.resolve(args.importer==='<stdin>'?projectRoot:path.dirname(args.importer),args.path);
            const target=file.endsWith('.ts')?file:file+'.ts';
            if(allowed.has(target))return {path:target};
          }
          return {errors:[{text:'P1_PROJECT_POLICY_IMPORT_REJECTED'}]};
        });
        builder.onLoad({filter:/.*/,namespace:'blocked-io'},args=>({loader:'js',contents:
          args.path==='store'?`export class AppError extends Error {constructor(message,status=400){super(message);this.status=status;}}
            const denied=()=>{throw new Error('P1_PROJECT_POLICY_IO_FORBIDDEN');};
            export const audit=denied,commit=denied,json=denied;`
          :`export const sha=()=>{throw new Error('P1_PROJECT_POLICY_IO_FORBIDDEN');};`}));
        builder.onLoad({filter:/\.ts$/},async args=>{
          if(!allowed.has(args.path))fail();
          const stat=await lstat(args.path);
          if(!stat.isFile()||stat.isSymbolicLink()||!samePath(await realpath(args.path),args.path))fail();
          const contents=await readFile(args.path,'utf8');
          hashes.set(args.path,createHash('sha256').update(contents).digest('hex'));
          return {contents,loader:'ts'};
        });
      }}]});
    if(Object.values(output.metafile.outputs).some(value=>value.imports.some(item=>item.path!==zodUrl)))fail();
    const sourceInputs=Object.keys(output.metafile.inputs).filter(name=>name!=='<stdin>'&&!name.startsWith('blocked-io:')).map(name=>path.resolve(projectRoot,name));
    if(!sourceInputs.length||sourceInputs.some(name=>!allowed.has(name)||!hashes.has(name)))fail();
    const compiled=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
    for(const name of ['canRead','allowedFields','assignedServiceCustomer','customerMasterCapabilities','businessTeamData','filterBusinessTeamRows','projectAccess','canReadProject','projectTaskPermissions','customerTaskCanEdit','canReadProjectCollaboration','projectCollaborationPermissions'])if(typeof compiled[name]!=='function')fail();
    const inputs=Object.freeze(sourceInputs.sort());
    const provenance=Object.freeze({
      source:'checked-out-project',inputs:Object.freeze(inputs.map(file=>Object.freeze({path:file,sha256:hashes.get(file)}))),
      externalDependencies:Object.freeze([zodUrl]),
      blockedIo:Object.freeze(['lib/store.ts: AppError only; audit/commit/json throw','lib/workbooks.ts: sha throws','all unlisted imports, including production runtime, cloudflare and identity']),
    });
    return Object.freeze({functions:compiled,inputs,provenance});
  })();
  return cached;
}
