// Build-time only. Read committed public source; never import middleware modules.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {workflowSources} from './workflow-sources.mjs';

const here=path.dirname(fileURLToPath(import.meta.url)),args=process.argv.slice(2);
const option=name=>args[args.indexOf(name)+1];
assert(args.includes('--repo')&&args.includes('--ref'),'Supply --repo <middleware checkout> --ref <audited commit>');
const repo=path.resolve(option('--repo')),ref=option('--ref');
assert(/^[a-f0-9]{7,40}$/.test(ref),'Use an immutable commit hash');
const commit=execFileSync('git',['rev-parse',ref+'^{commit}'],{cwd:repo,encoding:'utf8'}).trim();
const sources=[];
function read(file){
 const text=execFileSync('git',['show',commit+':'+file],{cwd:repo,encoding:'utf8',maxBuffer:16*1024*1024}).replaceAll('\r\n','\n');
 sources.push({file,sha256:createHash('sha256').update(text).digest('hex')});return text;
}
const plan=JSON.parse(read('docs/api-inventory/department-tools.json'));
assert.equal(plan.status,'planning-only');assert.equal(plan.groups.length,10);
const endpoints=plan.endpoints.map(({method,path,action,groups,object,boundary})=>({method,path,action,groups,object,boundary}));
const reads=workflowSources.map(source=>{
 const endpoint=endpoints.find(e=>e.method==='GET'&&e.action===source.id);
 assert(endpoint,'Unmapped read source: '+source.id);
 return{id:source.id,label:source.label,groups:endpoint.groups,source:source.id,scopeParams:source.id==='customer-quote-templates'?['customerAccountId']:source.scopeParams,...(source.id==='customer-quote-templates'?{requiredScope:['customerAccountId']}:{})};
});
const processes=plan.processContracts.map(({type,label,group})=>({type,label,group}));
assert.equal(processes.length,14);
const selections={
 'lib/domain.ts':['clean','strictDate'],
 'lib/process-workspace.ts':['processKinds','processStatuses','processGateStatuses','detail','common','inspection','processDetailFields','text','day','processSaveSchema','processDetailsSchema','assertProcessCompletion'],
};
const pieces=[];
for(const [file,names] of Object.entries(selections)){
 const source=read(file),sf=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true),found=new Map();
 for(const statement of sf.statements){
  if(ts.isFunctionDeclaration(statement)&&statement.name)found.set(statement.name.text,statement.getText(sf));
  if(ts.isVariableStatement(statement))for(const d of statement.declarationList.declarations)if(ts.isIdentifier(d.name)){
   const exported=statement.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword);
   found.set(d.name.text,(exported?'export ':'')+'const '+d.getText(sf)+';');
  }
 }
 for(const name of names){assert(found.has(name),'Missing pure contract: '+file+'#'+name);pieces.push(found.get(name));}
}
const pure=ts.transpileModule("import {z} from 'zod';\n"+pieces.join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const registry={format:'doon-department-contracts-v1',middlewareCommit:commit,sources,groups:plan.groups.map(({id,label,phase})=>({id,label,phase})),reads,processes,endpoints};
for(const [file,content] of Object.entries({
 'department-registry.json':JSON.stringify(registry,null,2)+'\n',
 'process-contract.generated.mjs':'// Generated from committed middleware pure validation functions. Do not edit.\n// Middleware commit: '+commit+'\n'+pure,
})){
 const target=path.join(here,file);
 if(args.includes('--check'))assert.equal(fs.readFileSync(target,'utf8').replaceAll('\r\n','\n'),content,'Contract drift: '+file);
 else fs.writeFileSync(target,content);
}
console.log(JSON.stringify({groups:10,readViews:reads.length,processTypes:processes.length,endpoints:endpoints.length,checked:args.includes('--check')}));
