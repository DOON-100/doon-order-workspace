import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
await fs.mkdir(path.join(project,'test-output'),{recursive:true});
const root=await fs.mkdtemp(path.join(project,'test-output','service-host-')),dataDir=path.join(root,'data');
await fs.mkdir(dataDir);
const reservation=net.createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
const fixture=path.join(root,'fixture.mjs'),entry=path.join(root,'host.mjs');
await fs.writeFile(fixture,`import http from 'node:http';http.createServer((q,s)=>{s.setHeader('Content-Type','application/json');s.end(JSON.stringify({ok:true,service:'度昂订单协作中台·内网版'}));}).listen(Number(process.env.DOON_PORT),'127.0.0.1');`);
await fs.writeFile(entry,`import {supervise} from ${JSON.stringify(new URL('./service-host.mjs',import.meta.url).href)};supervise(${JSON.stringify({root,dataDir,port,serverPath:fixture,pollMs:150})});`);
const spawnNode=(file)=>spawn(process.execPath,[file],{cwd:root,env:{...process.env,DOON_PORT:String(port)},windowsHide:true,stdio:'ignore'});
async function until(fn){const end=Date.now()+15000;while(Date.now()<end){const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,100));}throw new Error('等待守护状态超时');}
async function status(){try{return JSON.parse(await fs.readFile(path.join(dataDir,'service-status.json'),'utf8'));}catch{return null;}}
let external,host,ownedPid;
try{
 external=spawnNode(fixture);await until(async()=>{try{return (await fetch(`http://127.0.0.1:${port}/health`)).ok;}catch{return false;}});
 host=spawnNode(entry);await until(async()=>{const s=await status();return s?.state==='monitoring-existing'&&s;});
 assert.equal((await status()).childPid,null);console.log('PASS 已运行的网站不会被重复启动');
 external.kill();
 const first=await until(async()=>{const s=await status();return s?.state==='running'&&s.childPid&&s;});ownedPid=first.childPid;
 assert.notEqual(ownedPid,external.pid);console.log('PASS 外部服务退出后接管并恢复');
 process.kill(ownedPid);ownedPid=null;
 const second=await until(async()=>{const s=await status();return s?.state==='running'&&s.childPid!==first.childPid&&s;});ownedPid=second.childPid;
 const events=(await fs.readFile(path.join(dataDir,'service-events.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
 assert(events.some(e=>e.type==='server-exit'&&e.childPid===first.childPid));assert.equal(events.filter(e=>e.type==='server-start').length,2);
 console.log('PASS 受管服务异常退出自动恢复，且退出记录留存');
}finally{
 host?.kill();await new Promise(r=>setTimeout(r,200));
 if(ownedPid)try{process.kill(ownedPid);}catch{}
 external?.kill();
}
