import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

// A positive file list prevents credentials, fixtures, data and local node_modules
// from entering either the upload or the Docker build context.
const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const destination=path.resolve(process.argv[2]||'');
if(!process.argv[2]||await fs.stat(destination).then(()=>true,()=>false))throw new Error('Choose a new absolute staging directory');
const ignore=await fs.readFile(new URL('./Dockerfile.dockerignore',import.meta.url),'utf8');
const files=ignore.split(/\r?\n/).filter(line=>line.startsWith('!')&&!line.endsWith('/')).map(line=>line.slice(1));
files.push('agent-server/Dockerfile','agent-server/Dockerfile.dockerignore');
await fs.mkdir(destination,{recursive:true});const manifest=[];
for(const relative of files){
 if(!/^(?:agent-server|mastra-studio)\/[\w./-]+$/.test(relative)||relative.includes('..')||/test|secret|sqlite|\.env/i.test(relative))throw new Error('Unsafe runtime path');
 const bytes=await fs.readFile(path.join(root,relative)),target=path.join(destination,relative);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes);manifest.push({file:relative,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
await fs.writeFile(path.join(destination,'image-manifest.json'),JSON.stringify({revision,files:manifest},null,2)+'\n');
const archive=destination+'.tar.gz';execFileSync('tar',['-czf',archive,'-C',destination,'.']);
console.log(JSON.stringify({archive,revision,fileCount:manifest.length,sha256:createHash('sha256').update(await fs.readFile(archive)).digest('hex')}));
