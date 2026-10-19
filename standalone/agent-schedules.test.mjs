import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,createHash} from 'node:crypto';
import {defaultTrigger} from './schedule-engine/workflow-triggers.mjs';

test('原生 HTTP 后台只读桥：真实登录授权、独立服务身份、退出和重启后保留、停用即拒绝且不改源单',async()=>{
 const dist=path.resolve(process.env.DOON_BUILD_DIR||'test-output/agent-schedule-build'),dir=await fs.mkdtemp(path.resolve('test-output/schedule-bridge-http-')),origin='http://127.0.0.1:19914',key=randomBytes(32).toString('base64url'),keyFile=path.join(dir,'schedule-key');
 await fs.writeFile(keyFile,key);
 const env={...process.env,DOON_DATA_DIR:dir,DOON_HOST:'127.0.0.1',DOON_PORT:'19914',DOON_NO_AUTO_BACKUP:'1',DOON_STUDIO_ENABLED:'0',DOON_WORKFLOW_EVENTS_ENABLED:'0',DOON_STUDIO_SCHEDULES_ENABLED:'1',DOON_STUDIO_SCHEDULES_KEY_FILE:keyFile};
 execFileSync(process.execPath,[path.join(dist,'manage.mjs'),'init'],{env,stdio:'pipe',windowsHide:true});
 const initial=(await fs.readFile(path.join(dir,'管理员首次登录.txt'),'utf8')).match(/初始密码：([^\n]+)/)[1];
 const db=new DatabaseSync(path.join(dir,'workspace.sqlite')),at='2026-10-19T00:00:00Z',order={id:'SYN-SCHEDULE-ORDER',kind:'order',version:1,createdAt:at,updatedAt:at,updatedBy:'SYN',source:'synthetic',orderNo:'SYN-SCHEDULE',customer:'SYN合成客户',customerPO:'',drawing:'SYN-D',color:'',lens:'',batch:'',quantity:10,requestedDate:'2026-10-25',ownerEmail:'',stage:'生产中',plannedDate:'',shipDate:'',promisedDate:'',promiseConfirmed:false,customerNote:'',arrangement:'',notes:'SYN',sourceStatus:'',extra:{}};
 db.prepare('INSERT INTO records VALUES(?,?,?)').run(order.id,order.kind,JSON.stringify(order));const digest=()=>createHash('sha256').update(db.prepare('SELECT data FROM records WHERE id=?').get(order.id).data).digest('hex'),baseline=digest();let server,cookie='';
 const start=async()=>{server=spawn(process.execPath,[path.join(dist,'server.mjs')],{env,stdio:'ignore',windowsHide:true});for(let n=0;n<80;n++){try{if((await fetch(origin+'/health')).ok)return;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Synthetic schedule server not ready');};
 const stop=async()=>{if(server&&server.exitCode===null){const ended=new Promise(resolve=>server.once('exit',resolve));server.kill('SIGTERM');await ended;}};
 const request=async(route,body,{service=false,auth=cookie,token=key}={})=>{const response=await fetch(origin+route,{method:body===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json',...(service?{Authorization:'Bearer '+token}:auth?{Cookie:auth}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await response.json();if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return{status:response.status,data};};
 try{
  await start();assert.equal((await request('/api/agent-schedules/status')).status,403);
  assert.equal((await request('/api/auth/login',{username:'admin',password:initial})).status,200);assert.equal((await request('/api/agent-schedules/status')).status,403);
  assert.equal((await request('/api/auth/password',{currentPassword:initial,password:'SYN-Schedule-Only-2026!'})).status,200);
  assert.equal((await request('/api/agent-schedules/status')).data.ready,true);
  const trigger={...defaultTrigger(),mode:'schedule',source:'data',dataset:'/orders',schedule:{time:'00:00',timezone:'Asia/Shanghai'}};
  const grant=await request('/api/agent-schedules/grant',{workflowId:'SYN-WF',configVersionId:'SYN-V1',trigger});assert.equal(grant.status,200);
  assert.equal((await request('/api/agent-schedules/service/lease',{workerId:'SYN-HTTP'},{service:true,token:'SYN-WRONG'})).status,401);
  let lease=(await request('/api/agent-schedules/service/lease',{workerId:'SYN-HTTP'},{service:true})).data,worker={workerId:'SYN-HTTP',fence:lease.fence,grantId:grant.data.grantId};
  let result=await request('/api/agent-schedules/service/schedule',worker,{service:true});assert.equal(result.status,200);assert.equal(result.data.events.length,1);assert.equal(result.data.events[0].recordId,order.id);
  const cookieValue=cookie.split('=')[1];assert(!JSON.stringify(db.prepare('SELECT data FROM studio_schedule_grants').all()).includes(cookieValue));
  await request('/api/auth/logout',{});cookie='';assert.equal((await request('/api/agent-schedules/service/schedule',worker,{service:true})).status,200,'后台凭据不依赖普通会话续期');
  await stop();await start();lease=(await request('/api/agent-schedules/service/lease',{workerId:'SYN-HTTP',fence:worker.fence},{service:true})).data;assert.equal(lease.acquired,true);worker.fence=lease.fence;
  assert.equal((await request('/api/agent-schedules/service/schedule',worker,{service:true})).data.events.length,1,'授权在独立表中持久保存');
  const member=JSON.parse(db.prepare("SELECT data FROM records WHERE kind='member' AND json_extract(data,'$.role')='admin'").get().data);member.active=false;db.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify(member),member.id);
  assert.equal((await request('/api/agent-schedules/service/schedule',worker,{service:true})).status,403);
  assert.equal(digest(),baseline);assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='workflow_event_outbox'").get().n,0,'定时只读无需启用业务变更采集');
 }finally{await stop();db.close();const root=path.resolve('test-output')+path.sep;if(!path.resolve(dir).startsWith(root))throw Error('Unexpected test directory');await fs.rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
