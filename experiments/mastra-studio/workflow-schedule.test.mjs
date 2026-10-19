import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {validateSchedule,scheduleSlot,nextScheduleRuns,describeSchedule} from './workflow-schedule.mjs';
import {createStudio} from './server.mjs';
import {createAgents,workflowToolDemo} from './agents.mjs';
import {createWorkflowManager} from './workflow-manager.mjs';
import {describeDataset} from './workflow-triggers.mjs';

test('北京时间日历：每天、周一至周五、指定星期、跨年、边界与旧配置兼容',()=>{
 const daily={time:'09:00',timezone:'Asia/Shanghai'};
 assert.equal(validateSchedule(daily).frequency,'daily');assert.equal(describeSchedule(daily),'每天 09:00（北京时间）');
 assert.equal(scheduleSlot(daily,Date.parse('2026-10-19T08:59:59+08:00')).due,false);assert.equal(scheduleSlot(daily,Date.parse('2026-10-19T09:00:00+08:00')).due,true);
 const weekdays={...daily,frequency:'weekdays',weekdays:[]};assert.equal(scheduleSlot(weekdays,Date.parse('2026-10-17T10:00:00+08:00')).due,false);
 assert.equal(nextScheduleRuns(weekdays,Date.parse('2026-10-16T09:00:00+08:00'))[0],'2026-10-19T09:00:00+08:00');
 const weekly={...daily,frequency:'weekly',weekdays:[7,1]};assert.deepEqual(validateSchedule(weekly).weekdays,[1,7]);assert.equal(nextScheduleRuns(weekly,Date.parse('2026-12-31T23:59:00+08:00'))[0],'2027-01-03T09:00:00+08:00');
 assert.equal(scheduleSlot(daily,Date.parse('2026-10-18T16:00:00Z')).day,'2026-10-19');
 for(const bad of [{...daily,time:'24:00'},{...daily,timezone:'UTC'},{...weekly,weekdays:[]},{...weekly,weekdays:[1,1]},{...weekly,weekdays:[0]},{...daily,frequency:'monthly'},{...daily,frequency:null}])assert.throws(()=>validateSchedule(bad));
});

test('定时流程：预览改时间后确认、发布、到点暂停审核、按日期只检查一次、暂停恢复、重启与权限校验',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'doon-schedule-'));let clock=Date.parse('2026-10-19T08:59:00+08:00'),studio;
 const setup=()=>createStudio({dataDir:directory,deepseekOptions:{env:{}},createRuntime:async()=>{const lab=createAgents(directory);await lab.editorReady;lab.workflowManager=await createWorkflowManager({...lab,sourceFingerprint:()=>'',now:()=>clock});return lab;}});
 studio=await setup();const origin='http://127.0.0.1:19896',actor={id:'SYN-SCHEDULE-OWNER',name:'合成定时配置人',role:'admin'},row={id:'SYN-SCHEDULE-RECORD',status:'待核查'},dataset=describeDataset([row],'/records');let readable=true,reads=0;
 const access={syntheticOnly:true,catalog:async()=>{if(!readable)throw Object.assign(new Error('权限已撤销'),{status:403});return{mode:'authorized',eventsEnabled:true,datasets:[dataset],revision:1};},schedule:async trigger=>{reads++;const slot=scheduleSlot(trigger.schedule,clock);return{enabled:true,day:slot.day,events:slot.due?[{id:'schedule-'+slot.day+'-'+trigger.schedule.time,recordId:row.id,source:'drawing-data',dataset:'/records',type:'schedule',origin:'schedule',after:row,before:null,matched:true}]:[]};},verify:async()=>readable};
 const call=async(route,method='GET',body,person=actor,provider=access,requestOrigin=origin)=>{const response=await studio.handle(new Request(origin+'/studio/workflow-manager/api/'+route,{method,headers:{Origin:requestOrigin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),{actor:person,workflowAccess:provider});return{status:response.status,body:await response.json()};};
 const list=async()=>(await call('schedules')).body.schedules;
 const control=async(task,enabled,person=actor)=>call('schedules/'+task.id+'/state','POST',{expectedVersionId:task.versionId,expectedControlVersionId:task.controlVersionId,enabled},person);
 try{
  const input=workflowToolDemo(true),proposal=await studio.workflowManager.previewDraft(input,{actor,workflowAccess:access});
  const change={expectedVersionId:proposal.versionId,schedule:{time:'09:00',timezone:'Asia/Shanghai',frequency:'weekdays',weekdays:[]}};
  assert.equal((await call('proposals/'+proposal.id+'/schedule','PATCH',{...change,schedule:{...change.schedule,frequency:'weekly',weekdays:[]}})).status,400);
  assert.equal((await call('proposals/'+proposal.id+'/schedule','PATCH',change,{...actor,id:'OTHER'})).status,404);
  assert.equal((await call('proposals/'+proposal.id+'/schedule','PATCH',change,actor,access,'https://untrusted.example')).status,403);
  const updated=await call('proposals/'+proposal.id+'/schedule','PATCH',change);assert.equal(updated.status,200);assert.notEqual(updated.body.versionId,proposal.versionId);
  assert.equal((await call('proposals/'+proposal.id+'/confirm','POST',{expectedVersionId:proposal.versionId})).status,409);
  const saved=await call('proposals/'+proposal.id+'/confirm','POST',{expectedVersionId:updated.body.versionId});assert.equal(saved.status,200);
  let task=(await list())[0];assert.equal(task.state,'draft');assert.equal(task.canEnable,false);
  const workflow=(await call('workflows/'+saved.body.workflowId)).body;let published=(await call('workflows/'+workflow.id+'/publish','POST',{expectedVersionId:workflow.versionId})).body;
  task=(await list())[0];assert.equal(task.state,'active');assert.deepEqual(await studio.workflowManager.processTriggers(async()=>access),[]);assert.equal(reads,0,'到点前不读取运行快照');
  clock=Date.parse('2026-10-19T09:00:00+08:00');assert.equal((await studio.workflowManager.processTriggers(async()=>access))[0].status,'suspended');
  assert.deepEqual(await studio.workflowManager.processTriggers(async()=>access),[]);assert.equal(reads,1,'当日批次完成后不再扫描新数据或重复执行');
  const review=(await call('reviews')).body.reviews[0];assert.equal(review.status,'pending');
  task=(await list())[0];assert.equal(task.lastCheck.matched,1);assert.equal((await control(task,false,{...actor,id:'OTHER'})).status,403);
  assert.equal((await control(task,false)).status,200);assert.equal((await control(task,true)).status,409,'旧控制版本不可覆盖新状态');
  clock=Date.parse('2026-10-20T09:05:00+08:00');assert.deepEqual(await studio.workflowManager.processTriggers(async()=>access),[]);
  task=(await list())[0];assert.equal(task.state,'paused');assert.equal((await control(task,true)).status,200);assert.deepEqual(await studio.workflowManager.processTriggers(async()=>access),[],'恢复时不倒跑今天恢复前的时间');
  await studio.close();studio=await setup();clock=Date.parse('2026-10-21T09:00:00+08:00');assert.equal((await studio.workflowManager.processTriggers(async()=>access))[0].status,'suspended','重启后按下一计划执行');
  assert.deepEqual(await studio.workflowManager.processTriggers(async()=>access),[]);assert.equal((await call('reviews')).body.reviews.length,2);
  readable=false;clock=Date.parse('2026-10-22T09:00:00+08:00');assert.equal((await studio.workflowManager.processTriggers(async()=>access))[0].status,'blocked','权限撤销不执行');
  const deniedList=await call('schedules','GET',undefined,actor,{...access,catalog:async source=>{if(source)throw new Error('字段权限已撤销');return{mode:'authorized',eventsEnabled:true};}});assert.equal(deniedList.body.schedules[0].state,'blocked');assert.equal(deniedList.body.schedules[0].canEnable,false);readable=true;
  const graph=structuredClone(input);delete graph.requestId;graph.description='SYN 新版本';published=(await call('workflows/'+workflow.id,'PATCH',{...graph,expectedVersionId:published.versionId})).body;
  published=(await call('workflows/'+workflow.id+'/publish','POST',{expectedVersionId:published.versionId})).body;task=(await list())[0];assert.equal(task.state,'version-changed');assert.deepEqual(await studio.workflowManager.processTriggers(async()=>access),[],'版本改变需要重新启用');
  const unavailable=(await call('schedules','GET',undefined,actor,null)).body;assert.equal(unavailable.runtimeReady,false);
  assert.equal((await studio.handle(new Request(origin+'/studio/workflows/schedules'))).status,302);
 }finally{await studio.close();assert(path.resolve(directory).startsWith(path.resolve(os.tmpdir(),'doon-schedule-')));await fs.rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100}).catch(error=>{if(error.code!=='EBUSY')throw error;});}
});
