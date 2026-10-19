import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {createScheduleBridge} from '../../standalone/agent-schedules.mjs';
import {createScheduleWorker} from './schedule-worker.mjs';
import {createRuntimePool} from './runtime-pool.mjs';
import {createBusinessAccess,withBusinessAccess,currentBusinessAccess} from './business-api.mjs';
import {createStudio} from '../mastra-studio/server.mjs';
import {createWorkflowManager} from '../mastra-studio/workflow-manager.mjs';
import {defaultTrigger} from '../mastra-studio/workflow-triggers.mjs';
import {LibSQLStore} from '../mastra-studio/node_modules/@mastra/libsql/dist/index.js';
import {liveDataset,sameLiveEvent} from '../mastra-studio/workflow-live-data.mjs';

const key='SYN_'+ 'k'.repeat(43),origin='https://schedule.example.test';
function fixture(){
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE records(id TEXT PRIMARY KEY,data TEXT);');db.prepare('INSERT INTO records VALUES(?,?)').run('SYN-ORIGINAL',JSON.stringify({version:7,attachment:'SYN-HASH'}));
 let clock=Date.parse('2026-10-19T08:59:00+08:00'),active=true,role='admin',rows=[{id:'SYN-A',version:1,status:'待确认',password:'SYN-private'}],reads=0;
 const current=()=>({member:{id:'SYN-MEMBER',userId:'SYN-OWNER',name:'合成配置人',active,role},account:{id:'SYN-ACCOUNT',username:'synthetic',must_change:0}}),user=()=>({username:'synthetic',identity:{id:'SYN-OWNER',name:'合成配置人'},mustChange:false,role});
 const read=async(_,source,scope)=>{assert.equal(source,'drawing-data');assert.deepEqual(scope,{});reads++;if(!active)throw Object.assign(Error(),{status:403});return{revision:1,records:structuredClone(rows)};};
 const bridge=createScheduleBridge({db,config:{token:key},currentForOwner:async id=>id==='SYN-OWNER'?current():null,readView:read,now:()=>clock});
 const client=async(action,body,{service=false,cookie='SYN-cookie'}={})=>{const request=new Request(origin+'/api/agent-schedules/'+action,{method:body===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json',...(service?{Authorization:'Bearer '+key}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const response=await bridge.handle(request,service?null:cookie==='SYN-cookie'?current():null);return response.json();};
 const trigger={...defaultTrigger(),mode:'schedule',source:'drawing-data',dataset:'/records'};
 const digest=()=>createHash('sha256').update(JSON.stringify(db.prepare('SELECT * FROM records').all())).digest('hex');
 return{db,bridge,client,current,user,read,trigger,digest,clock:()=>clock,setClock:v=>{clock=Date.parse(v);},setActive:v=>{active=v;},setRole:v=>{role=v;},setRows:v=>{rows=v;},reads:()=>reads};
}

test('独立后台授权：当前身份、精确范围、过期/撤销、来源变化、租约隔离和原始数据保全',async()=>{
 const f=fixture(),baseline=f.digest();
 try{
  const grant=await f.client('grant',{workflowId:'SYN-WF',configVersionId:'SYN-V1',trigger:f.trigger});
  const lease=await f.client('service/lease',{workerId:'SYN-WORKER'},{service:true}),worker={workerId:'SYN-WORKER',fence:lease.fence,grantId:grant.grantId};
  assert.equal((await f.client('service/lease',{workerId:'SYN-OTHER'},{service:true})).acquired,false);
  const catalog=await f.client('service/catalog',worker,{service:true});assert(!JSON.stringify(catalog).includes('password'));assert.equal(catalog.ownerId,'SYN-OWNER');
  await assert.rejects(f.client('service/query',{...worker,query:{source:'purchase-data',dataset:'/records',scope:{}}},{service:true}),/超出/);
  f.setClock('2026-10-19T09:00:00+08:00');
  const renewed=await f.client('service/lease',{workerId:worker.workerId,fence:worker.fence},{service:true});assert.equal(renewed.fence,worker.fence);
  const page=await f.client('service/schedule',worker,{service:true});assert.equal(page.events.length,1);assert(!JSON.stringify(page).includes('SYN-private'));
  const event={...page.events[0],triggerConfig:f.trigger};assert.equal((await f.client('service/verify',{...worker,event},{service:true})).valid,true);
  f.setRows([{id:'SYN-A',version:2,status:'已确认'}]);assert.equal((await f.client('service/verify',{...worker,event},{service:true})).valid,false);
  f.setRole('viewer');await assert.rejects(f.client('service/catalog',worker,{service:true}),/身份已失效/);f.setRole('admin');
  await f.client('revoke',{workflowId:'SYN-WF',grantId:grant.grantId});await assert.rejects(f.client('service/catalog',worker,{service:true}),/授权已/);
  const next=await f.client('grant',{workflowId:'SYN-WF',configVersionId:'SYN-V2',trigger:f.trigger});assert.notEqual(next.grantId,grant.grantId);
  f.setClock('2026-10-19T09:02:00+08:00');const second=await f.client('service/lease',{workerId:'SYN-OTHER'},{service:true});assert(second.fence>worker.fence);
  await assert.rejects(f.client('service/catalog',{...worker,grantId:next.grantId},{service:true}),/租约已失效/);
  f.setRows(Array.from({length:101},(_,i)=>({id:'SYN-'+i,status:'待确认'})));await assert.rejects(f.client('service/schedule',{workerId:'SYN-OTHER',fence:second.fence,grantId:next.grantId},{service:true}),/超过 100/);
  f.setClock('2026-11-20T09:00:00+08:00');const last=await f.client('service/lease',{workerId:'SYN-OTHER'},{service:true});await assert.rejects(f.client('service/catalog',{workerId:'SYN-OTHER',fence:last.fence,grantId:next.grantId},{service:true}),/过期/);
  assert.equal(f.digest(),baseline);assert.equal(f.db.prepare('SELECT count(*) n FROM studio_schedule_grants').get().n,3);
  await assert.rejects(f.bridge.handle(new Request(origin+'/api/agent-schedules/service/owners',{method:'POST',body:'{}'}),f.current()),/服务身份无效/);
  await assert.rejects(f.bridge.handle(new Request(origin+'/api/agent-schedules/grant',{method:'POST',headers:{Origin:'https://evil.test'},body:'{}'}),f.current()),/跨站/);
 }finally{f.db.close();}
});

test('页面概览使用稳定记录，响应时间与工作区版本不伪装成业务内容变化',()=>{
 const trigger={...defaultTrigger(),mode:'schedule',source:'drawing-data',dataset:'/'},body={me:{password:'SYN-private'},revision:1,asOf:'2026-10-19T00:00:00Z',records:[{id:'SYN-A',status:'待确认'}]};
 const before=liveDataset(body,trigger),after=liveDataset({...body,revision:2,asOf:'2026-10-19T00:00:01Z'},trigger),event={source:trigger.source,dataset:'/',scope:{},recordId:before.rows[0].id,after:before.rows[0],triggerConfig:trigger};
 assert.equal(sameLiveEvent(event,trigger,after.rows),true);assert(!JSON.stringify(before.rows).includes('asOf'));assert(!JSON.stringify(before.rows).includes('SYN-private'));
});

test('云端真实模式路径：无需浏览器，重启后到点执行、只读工具、人工审核、持久结果、防重与暂停撤权',async()=>{
 const f=fixture(),baseline=f.digest(),dir=await fs.mkdtemp(path.join(os.tmpdir(),'doon-live-scheduler-'));let pool,worker,manager,studio;
 const actor={id:'SYN-OWNER',name:'合成配置人',role:'admin'},access=createBusinessAccess({cookie:'SYN-cookie',user:f.user(),authenticate:async()=>f.current().member.active?f.user():null,read:f.read,scheduleClient:f.client,now:f.clock});
 const build=async()=>{
  const storage=new LibSQLStore({id:'scheduler-'+randomUUID(),url:'file:'+path.join(dir,'agent.sqlite').replaceAll('\\','/')});
  studio=await createStudio({dataDir:dir,storage,cloud:true,liveReadOnly:true,scopeId:'SYN-OWNER',deepseekOptions:{env:{}}});
  const original=studio.mastra.getAgentById.bind(studio.mastra);studio.mastra.getAgentById=async(id,...args)=>id==='service'?{generate:async()=>{const catalog=await studio.tools.inspectWorkflowSources.execute({source:'drawing-data'});assert.equal(catalog.source,'drawing-data');await assert.rejects(()=>studio.tools.previewRecordReviewWorkflow.execute({name:'SYN禁止后台创建',source:'drawing-data',dataset:'/records'}),/后台运行只允许/);const read=await currentBusinessAccess().query({source:'drawing-data',dataset:'/records',scope:{},fields:['/status']});assert.equal(read.records[0]['/status'],'待确认');await assert.rejects(currentBusinessAccess().query({source:'purchase-data',dataset:'/records',scope:{}}),/超出/);return{text:'SYN 只读核查完成'};}}:original(id,...args);
  manager=await createWorkflowManager({mastra:studio.mastra,storage,tools:studio.tools,sourceFingerprint:()=> 'SYN-OWNER',realData:true,now:f.clock});return{...studio,workflowManager:manager};
 };
 const setup=()=>{pool=createRuntimePool({create:build});worker=createScheduleWorker({client:f.client,pool});};
 const call=async(route,method='GET',body)=>withBusinessAccess(access,async()=>{const response=await manager.handle(new Request(origin+'/studio/workflow-manager/api/'+route,{method,headers:{Origin:origin,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}),{actor,workflowAccess:access});return{status:response.status,body:await response.json()};});
 const schedule=async()=> (await call('schedules')).body.schedules[0];
 const control=async enabled=>{const task=await schedule();return call('schedules/'+task.id+'/state','POST',{expectedVersionId:task.versionId,expectedControlVersionId:task.controlVersionId,enabled});};
 try{
  setup();const handle=await pool.acquire(f.user());handle.release();
  const n=(id,type,params={})=>({id,type,label:id,x:40,y:40,params});
  const nodes=[n('start','start',{trigger:f.trigger}),n('read','agent',{agentId:'service',prompt:'SYN 只读检查'}),n('review','review',{title:'SYN人工审核',role:'technical',reviewerId:'',instructions:'SYN 核对',maxAgeMinutes:30}),n('summary','summary',{title:'SYN汇总'}),n('end','end')],edges=[{from:'start',to:'read',port:'next'},{from:'read',to:'review',port:'next'},{from:'review',to:'summary',port:'approved'},{from:'review',to:'end',port:'rejected'},{from:'summary',to:'end',port:'next'}];
  const draft=(await call('workflows','POST',{requestId:randomUUID(),name:'SYN自动调度',description:'合成授权数据',nodes,edges})).body;
  const published=(await call('workflows/'+draft.id+'/publish','POST',{expectedVersionId:draft.versionId})).body;assert.equal((await schedule()).state,'paused','发布不隐式授权后台');
  assert.equal((await control(true)).status,200);assert.equal((await schedule()).state,'active');assert.deepEqual(await worker.tick(),[]);
  await worker.close();await pool.close();setup();
  // No foreground pool acquisition or UI request before this background tick.
  f.setClock('2026-10-19T09:00:00+08:00');const outputs=await worker.tick();assert.equal(outputs[0]?.status,'suspended',JSON.stringify(outputs));
  let reviews=(await call('reviews')).body.reviews;assert.equal(reviews.length,1);assert.equal(reviews[0].status,'pending');
  let runs=(await call('runs')).body.runs;assert.equal(runs.length,1);assert.equal(runs[0].status,'suspended');
  assert.deepEqual(await worker.tick(),[]);assert.equal((await call('runs')).body.runs.length,1);
  const decision=await call('reviews/'+reviews[0].taskId+'/decision','POST',{action:'approve',comment:'SYN核对',expectedVersionId:reviews[0].versionId,requestId:randomUUID()});assert.equal(decision.status,200);assert.equal(decision.body.execution.status,'success');
  assert.equal((await call('runs/'+runs[0].runId)).body.status,'success');
  f.setRows([{id:'SYN-A',version:2,status:'已确认'}]);assert.equal((await call('runs')).body.runs.length,1,'仍有原字段权限时可以查看历史结果');
  f.setRows([{id:'SYN-A',version:2}]);assert.equal((await call('runs')).body.runs.length,0,'撤去原字段后不暴露包含该字段的历史内容');f.setRows([{id:'SYN-A',version:1,status:'待确认'}]);
  await worker.close();await pool.close();setup();await worker.tick();assert.equal((await call('runs')).body.runs[0].status,'success','刷新和重启后可回读最终结果');
  assert.equal((await control(false)).status,200);f.setClock('2026-10-20T09:00:00+08:00');assert.deepEqual(await worker.tick(),[]);
  f.setClock('2026-10-20T08:59:00+08:00');assert.equal((await control(true)).status,200);f.setActive(false);f.setClock('2026-10-20T09:00:00+08:00');assert.deepEqual(await worker.tick(),[],'停用账号从后台发现列表排除');f.setActive(true);
  const ledger=await studio.storage.getStore('workflowDefinitions'),upsert=ledger.upsert.bind(ledger);let loseReceipt=true;
  ledger.upsert=async input=>{if(loseReceipt&&input.metadata?.category==='delivery'&&input.metadata.payload.execution){loseReceipt=false;throw Error('SYN receipt interruption');}return upsert(input);};
  assert.equal((await worker.tick())[0].status,'needs-attention');ledger.upsert=upsert;
  f.setRows([{id:'SYN-A',version:1,status:'待确认'},{id:'SYN-LATE',version:1,status:'待确认'}]);await worker.tick();assert.equal((await call('reviews')).body.reviews.length,2,'丢失执行回执先回读原运行，不重复执行，也不重新纳入晚到记录');
  assert.equal((await call('runs')).body.runs.length,2);
  f.setRows([]);assert.equal((await call('runs')).body.runs.length,0,'当前无权读取的结果不可通过历史旁路访问');
  assert.equal(f.digest(),baseline);assert(!JSON.stringify(await manager.records('schedule-control')).includes('SYN-cookie'));
  assert.equal((await call('schedules/'+published.id+'/state','POST',{expectedVersionId:published.versionId,expectedControlVersionId:null,enabled:false})).status,409);
 }finally{await worker?.close();await pool?.close();f.db.close();if(path.dirname(path.resolve(dir))!==path.resolve(os.tmpdir())||!path.basename(dir).startsWith('doon-live-scheduler-'))throw Error('Unexpected temporary directory');await fs.rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

test('多容器互斥与失去续约后停止新读取，后台轮转不受四人缓存上限限制',async()=>{
 const f=fixture();let entered=0,release;const blocked=new Promise(resolve=>release=resolve),pool={acquire:async()=>({studio:{workflowManager:{processTriggers:async()=>{entered++;await blocked;return[];}}},release(){}})};
 const a=createScheduleWorker({client:f.client,pool}),b=createScheduleWorker({client:f.client,pool});
 try{
  await f.client('grant',{workflowId:'SYN-WF',configVersionId:'SYN-V1',trigger:f.trigger});
  const running=a.tick();while(!entered)await new Promise(resolve=>setTimeout(resolve,1));assert.deepEqual(await b.tick(),[]);assert.equal(b.status().state,'standby');assert.equal(entered,1);release();await running;
 }finally{release();await a.close();await b.close();f.db.close();}
 let leaseCalls=0,stopped=false;
 const lost=createScheduleWorker({renewMs:5,client:async action=>{if(action==='service/lease'){if(++leaseCalls===1)return{acquired:true,fence:1};throw Error('SYN lease outage');}if(action==='service/owners')return{users:[{identity:{id:'SYN-OWNER'}}]};throw Error('must not reach data after lease loss');},pool:{acquire:async()=>({release(){},studio:{workflowManager:{processTriggers:async resolve=>{const access=await resolve('SYN-OWNER',{row:{versionId:'SYN-V1'},control:{payload:{enabled:true,configVersionId:'SYN-V1',grantId:'SYN-GRANT'}},trigger:{...defaultTrigger(),mode:'schedule',source:'drawing-data',dataset:'/records'}});await new Promise(resolve=>setTimeout(resolve,20));await assert.rejects(access.query({source:'drawing-data',dataset:'/records'}),/租约已失效/);stopped=true;return[{status:'blocked'}];}}}})}});
 try{await lost.tick();assert(stopped);assert.equal(lost.status().lastError,'task-needs-attention');}finally{await lost.close();}
 let opened=0,closed=0;const rotating=createRuntimePool({max:2,create:async()=>({close:async()=>{closed++;},number:++opened})});
 try{for(let n=0;n<6;n++){const handle=await rotating.acquire({identity:{id:'SYN-'+n}},{background:true});handle.release();}assert.equal(opened,6);assert.equal(closed,4);}finally{await rotating.close();}
});
