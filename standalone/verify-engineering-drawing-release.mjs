// Run the required suite, then bind its evidence to the exact source and staging build.
// --check-only verifies existing evidence without running tests or changing production.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),args=process.argv.slice(2);
const index=args.indexOf('--build-dir'),checkOnly=args.includes('--check-only');
if(index<0||!args[index+1]||args.some((value,i)=>i!==index&&i!==index+1&&value!=='--check-only')||args.filter(value=>value==='--build-dir').length!==1)throw new Error('Usage: --build-dir <test-output staging build> [--check-only]');
const buildDir=await fs.realpath(path.resolve(args[index+1])),testRoot=await fs.realpath(path.join(root,'test-output'));
if(!buildDir.startsWith(testRoot+path.sep))throw new Error('Only an isolated build below test-output can be release-validated.');
const evidence=path.join(testRoot,'engineering-drawing-release.json'),sha=value=>createHash('sha256').update(value).digest('hex');
async function filesHash(directory,filter=()=>true){
 const result={};
 async function visit(folder,prefix=''){
  for(const entry of (await fs.readdir(folder,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
   const relative=prefix+entry.name,target=path.join(folder,entry.name);
   if(entry.isSymbolicLink())throw new Error('Release input contains a symbolic link.');
   if(entry.isDirectory())await visit(target,relative+'/');else if(entry.isFile()&&filter(relative))result[relative]=sha(await fs.readFile(target));
  }
 }
 await visit(directory);return result;
}
async function sources(){
 const result={};for(const dir of ['app','components','lib','db','standalone','tests','scripts','build','public'])for(const [name,hash] of Object.entries(await filesHash(path.join(root,dir))))result[dir+'/'+name]=hash;
 for(const name of ['package.json','package-lock.json','tsconfig.json','postcss.config.mjs','vite.config.ts'])result[name]=sha(await fs.readFile(path.join(root,name)));
 return result;
}
for(const name of ['workspace-api.mjs','runtime.mjs','auth.mjs','server.mjs','manage.mjs','client/index.html'])await fs.access(path.join(buildDir,name));
const beforeSource=await sources(),beforeBuild=await filesHash(buildDir);
const required=['business','types','standalone','drawing-import','drawing-browser','sop-browser'];
if(checkOnly){
 const saved=JSON.parse(await fs.readFile(evidence,'utf8'));
 if(saved.format!=='doon-engineering-release-v1'||saved.buildDir!==buildDir||JSON.stringify(saved.sourceHashes)!==JSON.stringify(beforeSource)||JSON.stringify(saved.buildHashes)!==JSON.stringify(beforeBuild)||!required.every(name=>saved.checks?.some(item=>item.name===name&&item.passed===true)))throw new Error('Release evidence is missing, failed, or stale; build and validate the exact sources again.');
 console.log(JSON.stringify({verified:true,buildDir,evidence,verifiedAt:saved.verifiedAt}));
}else{
 const commands=[['business',['tests/run.mjs']],['types',['node_modules/typescript/bin/tsc','--noEmit']],['standalone',['standalone/test.mjs']],['drawing-import',['standalone/test-engineering-drawing-import.mjs']],['drawing-browser',['standalone/test-engineering-drawing-browser.mjs']],['sop-browser',['standalone/test-engineering-sop-browser.mjs']]],checks=[];
 const env={...Object.fromEntries(Object.entries(process.env).filter(([name])=>!/^DOON_KINGDEE_/i.test(name))),DOON_KINGDEE_SUPPLIER_SYNC_ENABLED:'0',DOON_KINGDEE_READONLY_ENABLED:'0',DOON_BUILD_DIR:buildDir};delete env.DOON_DATA_DIR;delete env.DOON_TEST_ORIGINALS;delete env.DOON_TEST_ORIGINALS_MANIFEST;
 for(const [name,command] of commands){
  console.log(`Verifying ${name}…`);execFileSync(process.execPath,command,{cwd:root,env,stdio:'inherit'});checks.push({name,passed:true});
 }
 if(JSON.stringify(beforeSource)!==JSON.stringify(await sources())||JSON.stringify(beforeBuild)!==JSON.stringify(await filesHash(buildDir)))throw new Error('Source or staging build changed while tests ran; rerun verification.');
 const result={format:'doon-engineering-release-v1',verifiedAt:new Date().toISOString(),buildDir,checks,sourceHashes:beforeSource,buildHashes:beforeBuild};
 await fs.writeFile(evidence,JSON.stringify(result,null,2));console.log(JSON.stringify({verified:true,buildDir,evidence,checks}));
}
