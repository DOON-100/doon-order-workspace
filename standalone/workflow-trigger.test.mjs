// Reusable end-to-end test: isolated synthetic DB, account, port and Studio.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {defaultTrigger} from '../experiments/mastra-studio/workflow-triggers.mjs';
test('合成 HTTP 闭环：当前登录权限 → 全模块字段 → 事务变更 → 自动启动 → 人工审核 → 重启防重',async()=>{
 const dist=path.resolve(process.env.DOON_BUILD_DIR||'test-output/workflow-trigger-build'),dir=await fs.mkdtemp(path.resolve('test-output/workflow-trigger-http-')),origin='http://127.0.0.1:19912';
 const env={...process.env,DOON_DATA_DIR:dir,DOON_HOST:'127.0.0.1',DOON_PORT:'19912',DOON_NO_AUTO_BACKUP:'1',DOON_STUDIO_ENABLED:'1',DOON_SYNTHETIC_ONLY:'1',DOON_WORKFLOW_EVENTS_ENABLED:'1',DOON_STUDIO_DIR:path.resolve('experiments/mastra-studio')};
 await fs.writeFile(path.join(dir,'studio-sandbox.json'),JSON.stringify({kind:'doon-synthetic-studio-v1'}));
 execFileSync(process.execPath,[path.join(dist,'manage.mjs'),'init'],{env:{...env,DOON_WORKFLOW_EVENTS_ENABLED:'0'},stdio:'pipe',windowsHide:true});
 const initial=(await fs.readFile(path.join(dir,'管理员首次登录.txt'),'utf8')).match(/初始密码：([^\n]+)/)[1];
 const db=new DatabaseSync(path.join(dir,'workspace.sqlite')),at='2026-10-18T00:00:00Z',order={id:'SYN-HTTP-ORDER',kind:'order',version:1,createdAt:at,updatedAt:at,updatedBy:'SYN',source:'synthetic',orderNo:'SYN-HTTP',customer:'合成客户',customerPO:'',drawing:'SYN-D',color:'',lens:'',batch:'',quantity:10,requestedDate:'2026-10-25',ownerEmail:'',stage:'生产中',plannedDate:'',shipDate:'',promisedDate:'',promiseConfirmed:false,customerNote:'',arrangement:'',notes:'SYN initial',sourceStatus:'',extra:{}};
 db.prepare('INSERT INTO records VALUES(?,?,?)').run(order.id,order.kind,JSON.stringify(order));db.close();
 let server,cookie='';const start=async()=>{server=spawn(process.execPath,[path.join(dist,'server.mjs')],{env,stdio:'ignore',windowsHide:true});for(let n=0;n<80;n++){try{if((await fetch(origin+'/health')).ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('Synthetic HTTP server not ready');};
 const stop=async()=>{if(!server||server.exitCode!==null)return;const ended=new Promise(resolve=>server.once('exit',resolve));server.kill('SIGTERM');await ended;};
 const request=async(route,body)=>{const response=await fetch(origin+route,{method:body===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const result=await response.json();if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];assert.equal(response.status,200,JSON.stringify({route,status:response.status,error:result.error}));return result;};
 try{
  await start();await request('/api/auth/login',{username:'admin',password:initial});await request('/api/auth/password',{currentPassword:initial,password:'SYN-Workflow-Only-2026!'});
  const source=await request('/studio/workflow-manager/api/sources?source=data');assert.equal(source.mode,'authorized');assert.equal(source.eventsEnabled,true);assert.ok(source.datasets.find(d=>d.path==='/orders').fields.some(f=>f.path==='/notes'));
  const trigger={...defaultTrigger(),mode:'change',source:'data',dataset:'/orders',watchFields:['/notes'],conditions:{mode:'all',items:[{field:'/notes',operator:'eq',compare:'literal',value:'SYN HTTP trigger'}]}};
  const node=(id,type,params={})=>({id,type,label:id,x:80,y:40,params}),graph={name:'SYN HTTP 全模块触发',description:'合成验证',nodes:[node('start','start',{trigger}),node('record','record'),node('review','review',{title:'SYN HTTP 审核',role:'admin',reviewerId:'',instructions:'仅审核本次合成条目',maxAgeMinutes:30}),node('summary','summary',{title:'SYN HTTP 结果'}),node('end','end')],edges:[{from:'start',to:'record',port:'next'},{from:'record',to:'review',port:'next'},{from:'review',to:'summary',port:'approved'},{from:'review',to:'end',port:'rejected'},{from:'summary',to:'end',port:'next'}]};
  // Creation is 201, so use the ordinary fetch path for this single endpoint.
  const create=await fetch(origin+'/studio/workflow-manager/api/workflows',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({...graph,requestId:crypto.randomUUID()})});assert.equal(create.status,201);let row=await create.json();
  row=await request('/studio/workflow-manager/api/workflows/'+row.id+'/publish',{expectedVersionId:row.versionId});
  await request('/api/workspace/edit-order',{id:order.id,version:1,patch:{notes:'SYN HTTP trigger'}});
  let task;for(let n=0;n<30;n++){task=(await request('/studio/workflow-manager/api/reviews')).reviews.find(r=>r.workflowId===row.id);if(task)break;await new Promise(r=>setTimeout(r,250));}
  assert.ok(task,'真实保存事件应在后台启动流程并暂停审核');assert.equal(task.payload.trigger.recordId,order.id);assert.equal(task.payload.records[0].notes,'SYN HTTP trigger');
  const approved=await request('/studio/workflow-manager/api/reviews/'+task.taskId+'/decision',{action:'approve',comment:'SYN 核对隔离环境的触发记录与前后值',expectedVersionId:task.versionId,requestId:crypto.randomUUID()});assert.equal(approved.execution.status,'success');
  const planned=new Date(Date.now()+60000+8*3600000).toISOString(),scheduleTime=planned.slice(11,16),dueAt=Date.parse(planned.slice(0,10)+'T'+scheduleTime+':00+08:00'),scheduled=structuredClone(graph);
  scheduled.name='SYN HTTP 定时核查';scheduled.nodes[0].params.trigger={...trigger,mode:'schedule',watchFields:[],schedule:{time:scheduleTime,timezone:'Asia/Shanghai',frequency:'daily',weekdays:[]}};
  const createdSchedule=await fetch(origin+'/studio/workflow-manager/api/workflows',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({...scheduled,requestId:crypto.randomUUID()})});assert.equal(createdSchedule.status,201);const scheduleDraft=await createdSchedule.json();
  const publishedSchedule=await request('/studio/workflow-manager/api/workflows/'+scheduleDraft.id+'/publish',{expectedVersionId:scheduleDraft.versionId});
  assert.equal((await request('/studio/workflow-manager/api/schedules')).schedules.find(s=>s.id===publishedSchedule.id).state,'active');
  await stop();await start();
  // Do not visit Studio: its timer must load persisted workflows on its own.
  while(Date.now()<dueAt+4500)await new Promise(r=>setTimeout(r,Math.min(1000,dueAt+4500-Date.now())));
  const scheduledReviews=(await request('/studio/workflow-manager/api/reviews')).reviews.filter(r=>r.workflowId===publishedSchedule.id);assert.equal(scheduledReviews.length,1,'重启后无需打开 Studio，定时批次在真实后台自动启动');assert.equal(scheduledReviews[0].status,'pending');
  await new Promise(r=>setTimeout(r,3500));assert.equal((await request('/studio/workflow-manager/api/reviews')).reviews.filter(r=>r.workflowId===publishedSchedule.id).length,1,'轮询不会重复启动本日定时批次');
  const reviews=(await request('/studio/workflow-manager/api/reviews')).reviews.filter(r=>r.workflowId===row.id);assert.equal(reviews.length,1,'重启不重复创建审核任务');
  const receipts=(await request('/studio/workflow-manager/api/deliveries')).deliveries.filter(r=>r.workflowId===row.id);assert.equal(new Set(receipts.map(r=>r.runId)).size,1);
 }finally{await stop();if(!dir.startsWith(path.resolve('test-output')+path.sep))throw Error('Unexpected test path');await fs.rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100}).catch(error=>{if(error.code!=='EBUSY')throw error;});}
});
