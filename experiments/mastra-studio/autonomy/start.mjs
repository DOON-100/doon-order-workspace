import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createValidationServer} from './http.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const parent=path.join(root,'test-output'),directory=path.resolve(process.env.DOON_AUTONOMY_DIR||path.join(parent,'agent-autonomy-validation'));
if(!directory.toLowerCase().split(path.sep).includes('test-output'))throw Error('验证目录必须位于test-output');
const frontPort=Number(process.env.DOON_AUTONOMY_PORT||8807),backendPort=Number(process.env.DOON_AUTONOMY_BACKEND_PORT||8808);
for(const port of [frontPort,backendPort]){if(!Number.isInteger(port)||port<1024||port>65535||[8787,8797].includes(port))throw Error('拒绝正式或既有Studio端口');await new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(port,'127.0.0.1',()=>server.close(resolve));});}
if(frontPort===backendPort)throw Error('测试端口必须不同');
await fs.mkdir(parent,{recursive:true});let marker;
try{marker=JSON.parse(await fs.readFile(path.join(directory,'autonomy-sandbox.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;await fs.mkdir(directory,{recursive:false});marker={kind:'doon-autonomy-synthetic-v1'};await fs.writeFile(path.join(directory,'autonomy-sandbox.json'),JSON.stringify(marker),{flag:'wx'});}
if(marker.kind!=='doon-autonomy-synthetic-v1')throw Error('验证目录标识无效');
const dist=path.resolve(process.env.DOON_BUILD_DIR||path.join(parent,'autonomy-runtime-build'));
await fs.access(path.join(dist,'server.mjs'));
const env={...process.env,DOON_HOST:'127.0.0.1',DOON_PORT:String(backendPort),DOON_DATA_DIR:directory,DOON_BUILD_DIR:dist,DOON_SYNTHETIC_ONLY:'1',DOON_NO_AUTO_BACKUP:'1',DOON_STUDIO_ENABLED:'0',DOON_SERVER_MODE:'internal',DOON_REVIEW_MODE:'0',DOON_EMPLOYEE_PUBLIC_ORIGIN:'',DOON_SUPPLIER_PUBLIC_ORIGIN:'',DOON_TLS_CERT:'',DOON_TLS_KEY:''};
try{await fs.access(path.join(directory,'synthetic-accounts.json'));}catch(error){if(error.code!=='ENOENT')throw error;await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[fileURLToPath(new URL('./seed.mjs',import.meta.url))],{cwd:root,env,stdio:['ignore','pipe','pipe'],windowsHide:true});child.on('exit',code=>code===0?resolve():reject(Error('合成初始化失败，保留现场')));child.on('error',reject);});}
const accounts=JSON.parse(await fs.readFile(path.join(directory,'synthetic-accounts.json'),'utf8')),recipient=accounts.find(row=>row.username==='validation_buyer').userId;
const backend=spawn(process.execPath,[path.join(dist,'server.mjs')],{cwd:root,env,stdio:['ignore','ignore','pipe'],windowsHide:true});backend.stderr.on('data',()=>{});
process.once('exit',()=>backend.kill());
let ready=false;for(let i=0;i<80;i++){try{if((await fetch(`http://127.0.0.1:${backendPort}/health`)).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}if(!ready){backend.kill();throw Error('隔离工作台启动失败');}
const validation=await createValidationServer({origin:`http://127.0.0.1:${frontPort}`,backendOrigin:`http://127.0.0.1:${backendPort}`,dataDir:path.join(directory,'agent'),recipient});
await validation.listen();
await fs.writeFile(path.join(directory,'validation-status.json'),JSON.stringify({pid:process.pid,backendPid:backend.pid,port:frontPort,backendPort,modelLive:validation.studio.modelLive,startedAt:new Date().toISOString()},null,2));
console.log(JSON.stringify({ready:true,url:`http://127.0.0.1:${frontPort}/personal-tasks`,modelLive:validation.studio.modelLive,accountsFile:path.join(directory,'本地验证账号.txt')}));
let closing=false;for(const signal of ['SIGTERM','SIGINT'])process.once(signal,async()=>{if(closing)return;closing=true;await validation.close();backend.kill();process.exit(0);});
