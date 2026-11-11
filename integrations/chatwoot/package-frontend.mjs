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
const original=execFileSync('git',['show','HEAD:app/javascript/dashboard/i18n/index.js'],{cwd:source,encoding:'utf8'});
const languages=[...original.matchAll(/from '\.\/locale\/([^']+)'/g)].map(match=>match[1]);
for(const locale of languages.filter(locale=>!['en','zh_CN'].includes(locale)))if(!Object.entries(manifest).some(([key,row])=>(row.src||key).endsWith('/locale/'+locale+'/index.js')&&row.isDynamicEntry))throw Error('Missing lazy language pack: '+locale);
const files={};
async function inventory(folder){for(const item of await readdir(folder)){const file=path.join(folder,item),stat=await lstat(file);if(stat.isDirectory())await inventory(file);else{if(!stat.isFile()||stat.isSymbolicLink())throw Error('Unexpected generated asset');const bytes=await readFile(file);files[path.relative(publicDir,file).split(path.sep).join('/') ]={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};}}}
await inventory(publicDir);await mkdir(output,{recursive:true});
const archive='chatwoot-v4.19.1-lazy-locales.tar.gz';execFileSync('tar',['-czf',path.join(output,archive),'-C',path.join(source,'public'),'vite']);
const report={format:'doon-chatwoot-frontend-v1',upstream,patchCommit:process.env.GITHUB_SHA||null,runId:process.env.GITHUB_RUN_ID||null,archive,archiveSha256:createHash('sha256').update(await readFile(path.join(output,archive))).digest('hex'),initialCodeBytes:initialBytes,initialCodeGzipBytes:initialGzipBytes,maxInitialJsBytes,referencedNonCodeAssets:referencedAssets.size,languages:languages.length,lazyLanguages:languages.length-2,files};
await writeFile(path.join(output,'frontend-release.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,files:Object.keys(files).length}));
