import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaultTrigger,describeDataset,evaluateTrigger,projectedDatasets,validateTrigger} from './workflow-triggers.mjs';
import {createStudio} from './server.mjs';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

test('通用字段条件：多模块、嵌套、类型、空值、AND/OR、旧值、首次进入与精确变化',()=>{
 const before={id:'SYN-A',version:1,quantity:10,date:'2026-10-20',status:'待核查',note:'旧备注',fields:{'a/b':false},lines:[{id:'SYN-L',quantity:2}]},after={...before,version:2,date:'2026-10-25',status:'已审核',note:'新备注'};
 const catalog=describeDataset([before,after],'/records'),trigger={...defaultTrigger(),mode:'change',source:'drawing-data',dataset:'/records',watchFields:['/date'],conditions:{mode:'all',items:[{field:'/date',operator:'gt',compare:'before'},{mode:'any',items:[{field:'/status',operator:'eq',compare:'literal',value:'已审核'},{field:'/quantity',operator:'gt',compare:'literal',value:50}]}]}};
 const event={id:'SYN-E',recordId:after.id,type:'updated',source:trigger.source,dataset:trigger.dataset,before,after};
 assert.equal(evaluateTrigger(trigger,event,catalog).matched,true);
 assert.equal(evaluateTrigger(trigger,{...event,after:{...after,date:before.date}},catalog).matched,false,'仅修改备注不触发');
 assert.equal(evaluateTrigger(trigger,{...event,before:{...before,date:''}},catalog).matched,false,'空日期不被当作旧日期');
 const entering={...trigger,watchFields:[],transition:'enter',conditions:{mode:'all',items:[{field:'/status',operator:'eq',compare:'literal',value:'已审核'}]}};
 assert.equal(evaluateTrigger(entering,event,catalog).matched,true);assert.equal(evaluateTrigger(entering,{...event,before:after},catalog).matched,false);
 assert.equal(evaluateTrigger(trigger,{...event,origin:'workflow'},catalog).matched,false);
 assert.throws(()=>validateTrigger({...trigger,conditions:{mode:'all',items:[{field:'/hiddenCost',operator:'eq',compare:'literal',value:1}]}},catalog),/授权/);
 assert.throws(()=>validateTrigger({...trigger,conditions:{mode:'all',items:[{field:'/quantity',operator:'gt',compare:'literal',value:'1'}]}},catalog),/类型/);
 assert.throws(()=>validateTrigger({...trigger,conditions:{mode:'all',items:[{field:'/__proto__/x',operator:'eq',compare:'literal',value:1}]}},catalog));
 assert.ok(catalog.fields.some(f=>f.path==='/fields/a~1b'));
 assert.ok(catalog.fields.some(f=>f.path==='/lines/*/quantity'));
 for(const source of ['data','drawing-data','project-finance-data','service-data'])assert.equal(evaluateTrigger({...trigger,source},{...event,source},catalog).matched,true);
 const empty={...trigger,watchFields:[],conditions:{mode:'all',items:[{field:'/quantity',operator:'eq',compare:'literal',value:0}]}};
 assert.equal(evaluateTrigger(empty,{...event,after:{...after,quantity:null}},catalog).matched,false);
 assert.ok(projectedDatasets({rows:[after]}).some(d=>d.path==='/rows'));
 const scheduled={...defaultTrigger(),mode:'schedule',source:'data',dataset:'/records',conditions:{mode:'all',items:[{field:'/quantity',operator:'gt',compare:'literal',value:0}]}};
 assert.equal(evaluateTrigger(scheduled,{...event,source:'data',type:'schedule',before:null},catalog).matched,true);
 assert.throws(()=>validateTrigger({...scheduled,transition:'enter'},catalog),/定时/);
 const decimalRows=describeDataset([{unitPrice:'0.10',updatedAt:'2026-10-18T01:00:00Z'}],'/records');
 const price={...trigger,watchFields:[],conditions:{mode:'all',items:[{field:'/unitPrice',operator:'gt',compare:'literal',value:'0.09'}]}};assert.equal(evaluateTrigger(price,{...event,after:{unitPrice:'0.10'}},decimalRows).matched,true);
});

test('触发工作流：授权目录、发布游标、只运行一次、审核证据、恢复回执与重启',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'doon-trigger-'));let studio=await createStudio({dataDir:directory,deepseekOptions:{env:{}}});
 const actor={id:'SYN-TRIGGER-OWNER',name:'合成配置人',role:'admin'},origin='http://127.0.0.1:19896',record={id:'SYN-DRAWING',status:'待核查',date:'2026-10-20',version:2},dataset=describeDataset([record],'/records');
 let revision=10,valid=true,reads=0;
 const event={id:'SYN-EVENT-11',revision:11,recordId:record.id,source:'drawing-data',dataset:'/records',type:'updated',origin:'business',before:{...record,version:1,status:'待分配'},after:record,matched:true};
 const access={syntheticOnly:true,catalog:async source=>source?{mode:'authorized',eventsEnabled:true,revision,datasets:[dataset]}:{mode:'authorized',eventsEnabled:true,modules:[{id:'drawing-data',label:'工程画图'}]},poll:async(t,cursor)=>{reads++;return{enabled:true,cursor:revision,events:revision>cursor?[event]:[]};},verify:async()=>valid};
 const call=async(route,method='GET',body,person=actor,provider=access)=>{const response=await studio.handle(new Request(origin+'/studio/workflow-manager/api/'+route,{method,headers:{Origin:origin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),{actor:person,workflowAccess:provider});return{status:response.status,body:await response.json()};};
 const trigger={...defaultTrigger(),mode:'change',source:'drawing-data',dataset:'/records',watchFields:['/status'],conditions:{mode:'all',items:[{field:'/status',operator:'eq',compare:'literal',value:'待核查'}]}};
 const node=(id,type,params={})=>({id,type,label:id,x:80,y:40,params});
 const graph={name:'SYN 通用触发审核',description:'合成',nodes:[node('start','start',{trigger}),node('record','record'),node('review','review',{title:'合成审核',role:'admin',reviewerId:'',instructions:'核对本次合成记录变化',maxAgeMinutes:30}),node('summary','summary',{title:'合成摘要'}),node('end','end')],edges:[{from:'start',to:'record',port:'next'},{from:'record',to:'review',port:'next'},{from:'review',to:'summary',port:'approved'},{from:'review',to:'end',port:'rejected'},{from:'summary',to:'end',port:'next'}]};
 try{
  const created=await call('workflows','POST',{...graph,requestId:randomUUID()});assert.equal(created.status,201,JSON.stringify(created.body));let row=created.body;
  assert.equal((await call('workflows/'+row.id,'GET',null,{...actor,id:'OTHER'})).status,403);
  const unauthorized=await call('workflows/'+row.id,'PATCH',{...graph,expectedVersionId:row.versionId,nodes:graph.nodes.map(n=>n.type==='start'?{...n,params:{trigger:{...trigger,watchFields:['/secret']}}}:n)});assert.equal(unauthorized.status,403);
  row=(await call('workflows/'+row.id+'/publish','POST',{expectedVersionId:row.versionId})).body;
  assert.deepEqual(await studio.workflowManager.processTriggers(async()=>access),[],'发布时不回跑历史');
  revision=11;const emitted=await studio.workflowManager.processTriggers(async()=>access);assert.equal(emitted[0].status,'suspended');
  assert.deepEqual(await studio.workflowManager.processTriggers(async()=>access),[]);
  const reviews=(await call('reviews')).body.reviews;assert.equal(reviews.length,1);assert.equal(reviews[0].payload.trigger.recordId,record.id);assert.equal(reviews[0].payload.records[0].status,'待核查');
  assert.equal((await call('reviews','GET',null,actor,{...access,verify:async()=>false})).body.reviews.length,0,'当前没有读取权限的审核证据不返回');
  const task=reviews[0],decision={action:'approve',comment:'核对合成记录与来源版本',expectedVersionId:task.versionId,requestId:randomUUID()};valid=false;assert.equal((await call('reviews/'+task.taskId+'/decision','POST',decision)).status,409);valid=true;
  const approved=await call('reviews/'+task.taskId+'/decision','POST',decision);assert.equal(approved.status,200,JSON.stringify(approved.body));assert.equal(approved.body.execution.status,'success');
  await studio.close();studio=await createStudio({dataDir:directory,deepseekOptions:{env:{}}});assert.deepEqual(await studio.workflowManager.processTriggers(async()=>access),[],'重启后游标和投递去重保留');
  assert.equal((await call('deliveries')).body.deliveries.filter(d=>d.workflowId===row.id).length,2,'独立追加启动与回执记录');
  assert.ok(reads>=3);
 }finally{await studio.close();await fs.rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100}).catch(error=>{if(error.code!=='EBUSY')throw error;});}
});
