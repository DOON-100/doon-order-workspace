import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

const directory=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(directory,'../..');
const dataDir=path.join(root,'test-output','mastra-studio-sandbox'),dist=path.join(root,'test-output','mastra-studio-build');
const port=Number(process.env.DOON_STUDIO_PORT||8797);
if(!Number.isInteger(port)||port<1024||port>65535||port===8787)throw new Error('Studio 需要独立的本地测试端口（默认 8797）。');
await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',()=>reject(new Error(`本地测试端口 ${port} 已占用，请使用现有预览或设置 DOON_STUDIO_PORT。`)));probe.listen(port,'127.0.0.1',()=>probe.close(resolve));});
const env={...process.env,DOON_HOST:'127.0.0.1',DOON_PORT:String(port),DOON_DATA_DIR:dataDir,DOON_BUILD_DIR:dist,DOON_SYNTHETIC_ONLY:'1',DOON_STUDIO_ENABLED:'1',DOON_STUDIO_DIR:directory,DOON_NO_AUTO_BACKUP:'1'};
const run=(file,args,options={})=>new Promise((resolve,reject)=>{const child=spawn(file,args,{cwd:root,env,stdio:'inherit',windowsHide:true,...options});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`子进程退出 ${code}`)));});
let exists=false;
try{await fs.access(dataDir);exists=true;}catch(error){if(error.code!=='ENOENT')throw error;}
if(exists){const marker=JSON.parse(await fs.readFile(path.join(dataDir,'studio-sandbox.json'),'utf8'));if(marker.kind!=='doon-synthetic-studio-v1')throw new Error('拒绝使用非专用测试目录。');}
else{await fs.mkdir(dataDir,{recursive:true});await fs.writeFile(path.join(dataDir,'studio-sandbox.json'),JSON.stringify({kind:'doon-synthetic-studio-v1',createdAt:new Date().toISOString()}),{flag:'wx'});}
await run(process.execPath,['standalone/build.mjs']);
try{await fs.access(path.join(dataDir,'workspace.sqlite'));}catch(error){if(error.code!=='ENOENT')throw error;await run(process.execPath,[path.join(directory,'seed.mjs')]);}
console.log(`本地测试入口：http://127.0.0.1:${port}\n测试凭据文件：${path.join(dataDir,'本地测试登录.txt')}\n登录后点击公司图标 → Studio；数据模式：${process.env.DOON_STUDIO_DATA_MODE||'synthetic'}。模型：${process.env.DOON_STUDIO_MODEL||'offline'}。`);
await run(process.execPath,[path.join(dist,'server.mjs')]);
