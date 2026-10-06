// Scheduled Task entry: keep the existing LAN service alive without touching accounts or orders.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export function supervise({root,dataDir=path.join(root,'lan-data'),port=8787,serverPath=path.join(root,'lan-dist','server.mjs'),pollMs=5000}){
 fs.mkdirSync(dataDir,{recursive:true});
 const eventPath=path.join(dataDir,'service-events.jsonl'),statusPath=path.join(dataDir,'service-status.json');
 let child=null,stopping=false,timer=null,checking=false,lastState='';
 function event(type,details={}){const row={at:new Date().toISOString(),type,hostPid:process.pid,...details};if(fs.existsSync(eventPath)&&fs.statSync(eventPath).size>2_000_000)fs.renameSync(eventPath,eventPath+'.previous');fs.appendFileSync(eventPath,JSON.stringify(row)+'\n');}
 function status(state,details={}){fs.writeFileSync(statusPath,JSON.stringify({at:new Date().toISOString(),hostPid:process.pid,state,childPid:child?.pid||null,...details},null,2));if(state!==lastState){event(state,details);lastState=state;}}
 async function healthy(){try{const r=await fetch(`http://127.0.0.1:${port}/health`,{signal:AbortSignal.timeout(2000)}),v=await r.json();return r.ok&&v.ok&&v.service==='度昂订单协作中台·内网版';}catch{return false;}}
 async function occupied(){return new Promise(resolve=>{const s=net.createConnection({host:'127.0.0.1',port});let done=false;const finish=v=>{if(done)return;done=true;s.destroy();resolve(v);};s.setTimeout(1500,()=>finish(true));s.on('connect',()=>finish(true));s.on('error',()=>finish(false));});}
 async function tick(){
  if(stopping||checking)return;checking=true;
  try{
   if(await healthy()){status(child?'running':'monitoring-existing');return;}
   if(child){status('starting-or-unhealthy');return;}
   if(await occupied()){status('port-in-use');return;}
   const out=fs.openSync(path.join(dataDir,'server.log'),'a'),err=fs.openSync(path.join(dataDir,'server-error.log'),'a');
   try{child=spawn(process.execPath,[serverPath],{cwd:root,windowsHide:true,env:{...process.env,DOON_DATA_DIR:dataDir,DOON_PORT:String(port)},stdio:['ignore',out,err]});}finally{fs.closeSync(out);fs.closeSync(err);}
   const started=child;
   status('starting');event('server-start',{childPid:started.pid});
   started.once('error',e=>{event('server-spawn-error',{message:e.message});if(child===started)child=null;});
   started.once('exit',(code,signal)=>{event('server-exit',{childPid:started.pid,code,signal,intentional:stopping});if(child===started)child=null;if(!stopping)status('waiting-to-restart');});
  }catch(e){event('supervisor-error',{message:e.message});}finally{checking=false;}
 }
 function stop(){if(stopping)return;stopping=true;clearInterval(timer);status('stopping');if(child){child.kill('SIGTERM');const timeout=setTimeout(()=>process.exit(0),8000);timeout.unref();child.once('exit',()=>process.exit(0));}else process.exit(0);}
 process.once('SIGTERM',stop);process.once('SIGINT',stop);
 event('supervisor-start',{port});timer=setInterval(tick,pollMs);void tick();
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 supervise({root});
}
