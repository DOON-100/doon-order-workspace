import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {fingerprint} from './store.mjs';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,timeout=25000){const end=Date.now()+timeout;while(Date.now()<end){const value=await check();if(value)return value;await sleep(100);}throw Error('隔离HTTP验证等待超时');}
async function freePort(){const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const {port}=server.address();await new Promise(resolve=>server.close(resolve));return port;}

test('实际工作台鉴权、后台唤醒、跨进程待办保留、人工回执和收货闭环', {timeout:120000},async()=>{
 await fs.mkdir(path.join(root,'test-output'),{recursive:true});
 const directory=await fs.mkdtemp(path.join(root,'test-output','autonomy-http-'));
 await fs.writeFile(path.join(directory,'autonomy-sandbox.json'),JSON.stringify({kind:'doon-autonomy-synthetic-v1'}));
 const port=await freePort(),backendPort=await freePort(),origin=`http://127.0.0.1:${port}`;
 let child,backendPid;const cookies={};
 async function launch(){
  child=spawn(process.execPath,[fileURLToPath(new URL('./start.mjs',import.meta.url))],{cwd:root,env:{...process.env,DOON_AUTONOMY_DIR:directory,DOON_AUTONOMY_PORT:String(port),DOON_AUTONOMY_BACKEND_PORT:String(backendPort),DOON_STUDIO_MODEL:'offline'},stdio:['ignore','ignore','pipe'],windowsHide:true});child.stderr.on('data',()=>{});
  await until(async()=>{try{return(await fetch(origin+'/health',{signal:AbortSignal.timeout(1000)})).ok;}catch{return false;}});
  backendPid=await until(async()=>{try{const saved=JSON.parse(await fs.readFile(path.join(directory,'validation-status.json'),'utf8'));return saved.pid===child.pid?saved.backendPid:false;}catch{return false;}});
 }
 async function stop(){
  // Kill only the two PIDs created by this test. Never search/kill by port/name.
  if(child){const ended=new Promise(resolve=>child.once('exit',resolve));child.kill();await ended;child=null;}
  if(backendPid){try{process.kill(backendPid);}catch(error){if(error.code!=='ESRCH')throw error;}backendPid=null;}
  await until(async()=>{try{await fetch(origin+'/health',{signal:AbortSignal.timeout(300)});return false;}catch{return true;}});
  await sleep(200);
 }
 async function request(route,body,who='admin',extra={}){const response=await fetch(origin+route,{method:body===undefined?'GET':'POST',headers:{...(cookies[who]?{Cookie:cookies[who]}:{}),...(body===undefined?{}:{Origin:origin,'Content-Type':'application/json'}),...extra},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(8000)});return{status:response.status,data:await response.json(),response};}
 async function ok(route,body,who){const result=await request(route,body,who);assert.equal(result.status,200,JSON.stringify(result.data));return result.data;}
 const state=()=>ok('/api/agent-validation/status');
 const inbox=()=>ok('/api/agent-inbox',undefined,'buyer');
 const baseline=()=>{const db=new DatabaseSync(path.join(directory,'workspace.sqlite'),{readOnly:true});try{return fingerprint(db.prepare('SELECT id,kind,data FROM records ORDER BY id').all());}finally{db.close();}};
 try{
  await launch();const accounts=JSON.parse(await fs.readFile(path.join(directory,'synthetic-accounts.json'),'utf8'));
  for(const [who,username]of Object.entries({admin:'validation_admin',buyer:'validation_buyer',other:'validation_other'})){
   const account=accounts.find(row=>row.username===username),signed=await request('/api/auth/login',{username,password:account.password},'anonymous');assert.equal(signed.status,200);cookies[who]=signed.response.headers.get('set-cookie').split(';')[0];
  }
  const before=baseline();
  assert.equal((await request('/api/agent-inbox',undefined,'anonymous')).status,401);
  assert.equal((await request('/api/agent-validation/start',{requestId:'forged'},'buyer')).status,403);
  assert.equal((await request('/api/agent-validation/start',{requestId:'cross-origin'},'admin',{Origin:'https://example.invalid'})).status,403);
  assert.equal((await fetch(origin+'/studio/',{headers:{Cookie:cookies.buyer}})).status,403);
  assert.equal((await fetch(origin+'/studio/api/agents',{method:'POST',headers:{Cookie:cookies.admin,Origin:origin}})).status,403);
  const workbench=await fetch(origin+'/personal-tasks',{headers:{Cookie:cookies.buyer}});assert.match(await workbench.text(),/agent-inbox\.js/);
  const item=await ok('/api/agent-validation/start',{requestId:'background-start'});
  assert.equal((await ok('/api/agent-validation/start',{requestId:'repeat-start'})).id,item.id);
  const human=await until(async()=>{const data=await inbox();return data.items.find(row=>row.status==='pending');});
  assert.equal((await ok('/api/agent-inbox',undefined,'other')).items.length,0);
  const input={id:human.id,version:human.version,payloadHash:human.payloadHash,action:'approve',comment:'合成审核：核对内部跟进方案，不代表收货',requestId:'synthetic-approve'};
  assert.equal((await request('/api/agent-inbox/decide',input,'other')).status,403);
  assert.equal((await request('/api/agent-inbox/decide',{...input,actorId:'forged'},'buyer')).status,400);
  for(let i=0;i<3;i++)assert.equal((await inbox()).items[0].status,'pending');
  await stop();await launch();
  const retained=(await inbox()).items[0];assert.equal(retained.id,human.id);assert.equal(retained.status,'pending');
  await ok('/api/agent-validation/advance-clock',{seconds:120});
  await until(async()=>{const data=await state();return data.tasks.some(row=>row.role==='supervisor'&&row.state==='waiting_human');});
  assert.equal((await inbox()).items[0].status,'pending');
  assert.equal((await state()).tasks.filter(row=>row.trigger==='human-overdue').length,1);
  const approved=await ok('/api/agent-inbox/decide',input,'buyer');assert.equal(approved.executedBusinessWrite,false);
  assert.equal((await ok('/api/agent-inbox/decide',input,'buyer')).decisionId,approved.decisionId);
  await until(async()=>{const data=await state();return data.tasks.some(row=>row.role==='procurement'&&row.state==='waiting_time');});
  let data=await state();assert.equal(data.source.received,100);assert.equal(data.cases[0].state,'open');
  await ok('/api/agent-validation/receipt',{received:160,expectedVersion:data.source.version});
  await until(async()=>{const data=await state();return data.cases[0].state==='completed';});
  data=await state();assert(data.tasks.some(row=>row.role==='procurement'&&row.result?.fulfilled));assert(data.tasks.some(row=>row.role==='pmc'&&row.state==='completed'));
  const remaining=(await inbox()).items.filter(row=>row.status==='pending');assert(remaining.every(row=>row.category==='coordination'));assert.equal(baseline(),before,'既有工作台成员记录字节保持不变');
 }finally{if(child)await stop();await fs.rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100}).catch(error=>{if(error.code!=='EBUSY')throw error;});}
});
