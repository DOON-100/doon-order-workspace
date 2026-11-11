import {readFile,writeFile,mkdir,readdir,lstat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import path from 'node:path';
const source=path.resolve(process.argv[2]||''),output=path.resolve(process.argv[3]||'');
if(!process.argv[2]||!process.argv[3]||path.basename(source)!=='chatwoot-v4.19.1'||output===source||output.startsWith(source+path.sep))throw Error('Specify separate pinned source and output directories');
const upstream='caab07a8f00032d5205b5a5d7e2eb0ba2f3d2d82';
if(execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim()!==upstream)throw Error('Unexpected upstream version');
const publicDir=path.join(source,'public/vite');
const candidates=[path.join(publicDir,'.vite/manifest.json'),path.join(publicDir,'manifest.json')];
let manifest;
for(const filename of candidates){try{const value=JSON.parse(await readFile(filename,'utf8'));if(Object.values(value).some(row=>row?.isEntry&&row.src?.endsWith('dashboard.js'))){manifest=value;break;}}catch{}}
if(!manifest)throw Error('Missing native dashboard asset manifest');
const entry=Object.entries(manifest).find(([key,row])=>row.isEntry&&(row.src||key).endsWith('entrypoints/dashboard.js'));
if(!entry)throw Error('Dashboard entry not found');
const initial=new Set(),referencedAssets=new Set(),visited=new Set();
function walk(key){if(visited.has(key))return;visited.add(key);const row=manifest[key];if(!row)throw Error('Missing imported chunk');for(const file of [row.file,...row.css||[]])initial.add(file);for(const file of row.assets||[])referencedAssets.add(file);for(const imported of row.imports||[])walk(imported);}
walk(entry[0]);let initialBytes=0,initialGzipBytes=0,maxInitialJsBytes=0;
for(const name of initial){const file=path.resolve(publicDir,name);if(!file.startsWith(publicDir+path.sep))throw Error('Invalid asset path');const bytes=await readFile(file);initialBytes+=bytes.length;initialGzipBytes+=gzipSync(bytes,{level:4}).length;if(name.endsWith('.js'))maxInitialJsBytes=Math.max(maxInitialJsBytes,bytes.length);}
console.log(JSON.stringify({initialCodeBytes:initialBytes,initialCodeGzipBytes:initialGzipBytes,maxInitialJsBytes,referencedNonCodeAssets:referencedAssets.size}));
if(maxInitialJsBytes>5*1024*1024||initialGzipBytes>4*1024*1024)throw Error('Initial JS/CSS language bundle is still too large');
const languages=['en','zh_CN'],found=new Map(['dashboard','widget','survey'].map(app=>[app,new Set()]));
for(const filename of await readdir(path.join(publicDir,'assets'))){
 if(!filename.endsWith('.js.map'))continue;
 const map=JSON.parse(await readFile(path.join(publicDir,'assets',filename),'utf8'));
 for(const name of map.sources||[]){
  const match=name.match(/\/(dashboard|widget|survey)\/i18n\/locale\/([^/.]+)(?:\/|\.json$)/);
  if(!match)continue;
  if(!languages.includes(match[2]))throw Error('Unexpected bundled language: '+match[2]);
  found.get(match[1]).add(match[2]);
 }
}
for(const [app,locales] of found)if(languages.some(locale=>!locales.has(locale)))throw Error('Missing language source map evidence for '+app);
const files={};
async function inventory(folder){for(const item of await readdir(folder)){const file=path.join(folder,item),stat=await lstat(file);if(stat.isDirectory())await inventory(file);else{if(!stat.isFile()||stat.isSymbolicLink())throw Error('Unexpected generated asset');const bytes=await readFile(file);files[path.relative(publicDir,file).split(path.sep).join('/') ]={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};}}}
await inventory(publicDir);await mkdir(output,{recursive:true});
const runtimePath='app/helpers/application_helper.rb',runtimeBytes=await readFile(path.join(source,runtimePath));
const runtimeFiles={[runtimePath]:{bytes:runtimeBytes.length,sha256:createHash('sha256').update(runtimeBytes).digest('hex')}};
const archive='chatwoot-v4.19.1-zh-en.tar.gz';execFileSync('tar',['-czf',path.join(output,archive),'-C',path.join(source,'public'),'vite','-C',source,runtimePath]);
const report={format:'doon-chatwoot-frontend-v2',upstream,patchCommit:process.env.GITHUB_SHA||null,runId:process.env.GITHUB_RUN_ID||null,archive,archiveSha256:createHash('sha256').update(await readFile(path.join(output,archive))).digest('hex'),initialCodeBytes:initialBytes,initialCodeGzipBytes:initialGzipBytes,maxInitialJsBytes,referencedNonCodeAssets:referencedAssets.size,languages,lazyLanguages:0,otherLanguagePacksBuilt:false,runtimeFiles,files};
await writeFile(path.join(output,'frontend-release.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,files:Object.keys(files).length}));
