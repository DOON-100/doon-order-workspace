import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {departmentGroups,departmentActions,departmentCatalog,processPayloadSchema} from './department-contracts.mjs';
import {executeDepartment} from './department-executor.mjs';
import {createDepartmentTools} from './department-tools.mjs';
import {Agent} from '@mastra/core/agent';
import {createDeepSeekStatus} from './deepseek.mjs';
import {createWorkflowTools} from './workflow-tools.mjs';
import {createBusinessAccess,createBusinessReader,withBusinessAccess,currentBusinessAccess} from '../agent-server/business-api.mjs';

const user={username:'SYN-user',role:'admin',personnelType:'internal',mustChange:false,identity:{id:'SYN-A'}};
function setup(){
 let revoked=false,canEdit=true,canCreate=true,sourceUnavailable=false,reads=0;
 const record={...processPayloadSchema('iqc').parse({type:'iqc',title:'合成来料检验',orderId:'SYN-O',notes:'保留旧备注',details:{supplierName:'合成供应商',lotNo:'SYN-LOT',inspectedQuantity:10,acceptedQuantity:8,rejectedQuantity:2}}),id:'SYN-IQC',version:3,canEdit:true};
 const calls=[];
 const access=createBusinessAccess({cookie:'synthetic-private-cookie',user,authenticate:async()=>revoked?null:user,read:async(cookie,source,scope)=>{
  reads++;calls.push({source,scope});assert.equal(cookie,'synthetic-private-cookie');
  if(sourceUnavailable)throw Object.assign(new Error('not available'),{status:404});
  return source==='process-data'?{revision:5,records:scope.type==='iqc'?[{...record,canEdit}]:[],allowedKinds:canCreate?[scope.type]:[],canCreate,customers:[],orders:[],members:[]}:
   {revision:5,records:[{id:'SYN-R',version:2,title:'合成业务记录',password:'never-expose',price:12}]};
 }});
 return{access,record,calls,get reads(){return reads;},revoke(){revoked=true;},readOnly(){canEdit=false;canCreate=false;},unavailable(){sourceUnavailable=true;}};
}
const basis={sources:[{field:'title',reference:'合成用户请求',location:'本轮指令'}],unknowns:['关联及负责人需人工核对'],conflicts:[]};
const run=(fixture,group,operation,action,args)=>executeDepartment(group,{operation,...(action?{action}:{}),...(args?{arguments:operation==='prepare'?{basis,...args}:args}:{})},fixture.access);
const createFields={title:'合成记录',orderId:'SYN-O'};

test('实际 SDK 的部门工具请求符合 DeepSeek 对象契约，流式及非流式均能完成工具回合',async()=>{
 for(const streaming of [false,true]){
  let calls=0;
  const model=await createDeepSeekStatus({env:{DOON_STUDIO_MODEL:'deepseek-flash',DEEPSEEK_API_KEY:'synthetic-only'},fetchImpl:async(url,init)=>{
   const body=JSON.parse(init.body);calls++;
   assert.equal(body.thinking.type,'disabled');
   for(const tool of body.tools){
    assert.equal(tool.function.parameters.type,'object',tool.function.name+' needs a root object');
    assert(!tool.function.parameters.oneOf&&!tool.function.parameters.anyOf,'root union is not accepted');
   }
   const done=body.messages.some(message=>message.role==='tool');
   if(done){const catalog=JSON.parse(body.messages.find(message=>message.role==='tool').content);assert.equal(catalog.department.id,'sales');}
   const tool_calls=[{id:'SYN-call',type:'function',function:{name:'departmentSales',arguments:'{"operation":"list"}'}}];
   const message=done?{role:'assistant',content:'SYN completed'}:{role:'assistant',content:'',tool_calls};
   const finish_reason=done?'stop':'tool_calls';
   if(body.stream){
    const delta=done?message:{...message,tool_calls:tool_calls.map(call=>({index:0,...call}))};
    return new Response('data: '+JSON.stringify({id:'SYN',object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta,finish_reason}]})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
   }
   return Response.json({id:'SYN',object:'chat.completion',created:1,model:body.model,choices:[{index:0,message,finish_reason}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}});
  }}).model();
  const agent=new Agent({id:'SYN-schema',name:'SYN schema',instructions:'Synthetic tool check',model,tools:{...createDepartmentTools(),...createWorkflowTools(()=>undefined)},defaultOptions:{maxSteps:2,modelSettings:{maxRetries:0},providerOptions:{deepseek:{thinking:{type:'disabled'}}}}});
  const f=setup();
  await withBusinessAccess(f.access,async()=>{
   const result=streaming?await agent.stream('SYN list'):await agent.generate('SYN list');
   assert.equal(await result.text,'SYN completed');
  });
  assert.equal(calls,2);assert.equal(f.reads,0,'list does not read business records');
 }
});

test('模型入口保持逐动作严格校验，缺少字段和额外字段在业务读取之前拒绝',async()=>{
 const f=setup(),tool=createDepartmentTools().departmentSales;
 for(const input of [{operation:'query'},{operation:'query',action:'customer-data'},{operation:'inspect'},{operation:'list',action:'customer-data'},{operation:'list',arguments:{}},{operation:'prepare',action:'prepare-process-rfq'}]){
  await withBusinessAccess(f.access,async()=>assert.rejects(()=>tool.execute(input,{}),/参数/));
 }
 assert.equal(f.reads,0);
});

test('十组共享固定执行器；每组均能发现契约并按现有登录读取',async()=>{
 const f=setup(),tools=createDepartmentTools();
 assert.equal(Object.keys(tools).length,10);
 for(const group of departmentGroups){
  const catalog=await run(f,group.id,'list');assert.equal(catalog.department.label,group.label);assert.equal(catalog.writeEnabled,false);
  const action=departmentActions.find(row=>row.kind==='read'&&row.groups.includes(group.id)&&!row.type&&!row.requiredScope&&row.id!=='framework-settings');
  assert(action,group.id);
  const contract=await run(f,group.id,'inspect',action.id);
  assert(contract.arguments.properties.dataset);assert(!JSON.stringify(contract).includes('合成业务记录'));
  const result=await run(f,group.id,'query',action.id,{dataset:'/records',fields:['/title'],limit:1});
  assert.equal(result.records[0]['/title'],'合成业务记录');assert.equal(result.mode,'live-readonly');
  assert(!JSON.stringify(result).includes('never-expose'));assert(!JSON.stringify(result).includes('synthetic-private-cookie'));
 }
 const catalog=departmentCatalog('management');assert(catalog.pendingEndpoints.some(row=>row.path==='/api/auth/reset'&&row.status==='not-executable'));
 const recordBefore=JSON.stringify(f.record);
 await withBusinessAccess(f.access,async()=>{const result=await tools.departmentQuality.execute({operation:'query',action:'process-iqc',arguments:{dataset:'/records',fields:['/title']}},{});assert.equal(result.source,'process-data');});
 assert.deepEqual(f.calls.at(-1),{source:'process-data',scope:{type:'iqc'}});assert.equal(JSON.stringify(f.record),recordBefore);
});

test('固定 HTTP GET 与类型/客户参数；禁止额外地址、伪造身份、越组、任意动作和超量分页',async()=>{
 const f=setup();
 for(const [group,operation,action,args] of [
  ['sales','query','process-iqc',{dataset:'/records'}],
  ['quality','query','process-iqc',{dataset:'/records',scope:{type:'rfq'}}],
  ['sales','query','customer-quote-template-export',{dataset:'/records'}],
  ['management','query','/api/auth/reset',{dataset:'/records'}],
  ['purchasing','query','purchase-data',{dataset:'/records',limit:100}],
  ['purchasing','query','purchase-data',{dataset:'/records',actorId:'SYN-ADMIN'}],
  ['purchasing','query','purchase-data',{dataset:'/records',scope:{url:'https://evil.invalid'}}],
  ['purchasing','prepare','purchase-data',{mode:'create',fields:createFields}],
 ])await assert.rejects(run(f,group,operation,action,args));
 assert.equal(f.reads,0);
 await assert.rejects(executeDepartment('sales',{operation:'list',cookie:'forged'},f.access));
 await assert.rejects(run(f,'sales','inspect','customer-quote-templates'),/参数/);
 await run(f,'sales','inspect','customer-quote-templates',{scope:{customerAccountId:'SYN-C'}});
 assert.deepEqual(f.calls.at(-1).scope,{customerAccountId:'SYN-C'});
 const calls=[],transport=(options,done)=>{
  calls.push(options);const req=new EventEmitter();req.end=()=>{const res=new EventEmitter();res.statusCode=200;res.headers={'content-type':'application/json'};done(res);queueMicrotask(()=>{res.emit('data',Buffer.from('{"records":[]}'));res.emit('end');});};return req;
 };
 const read=createBusinessReader({publicOrigin:'https://example.test',transport});
 await read('doon_employee_session='+'s'.repeat(43),'process-data',{type:'iqc'});
 assert.equal(calls[0].method,'GET');assert.equal(calls[0].path,'/api/workspace/process-data?type=iqc');
 for(const scope of [{},{type:'unknown'},{type:'iqc',token:'forged'}])await assert.rejects(read('doon_employee_session='+'s'.repeat(43),'process-data',scope));
 assert.equal(calls.length,1);
});

test('14类流程具有各自严格草稿契约；草稿不写入、无批准或执行入口',async()=>{
 const f=setup();
 for(const action of departmentActions.filter(row=>row.kind==='draft')){
  const contract=await run(f,action.groups[0],'inspect',action.id);
  assert(contract.arguments.oneOf);
  const draft=await run(f,action.groups[0],'prepare',action.id,{mode:'create',fields:createFields});
  assert.equal(draft.proposed.type,action.type);assert.equal(draft.status,'draft-only');assert.equal(draft.saved,false);assert.equal(draft.executed,false);
  assert.equal(draft.binding.actorId,'SYN-A');assert.equal(draft.binding.payloadHash.length,64);
  assert.equal(draft.proposed.status,'待处理');assert.equal(draft.proposed.gateStatus,'待核实');
  assert.equal(draft.proposed.ownerId,'');assert.equal(draft.proposed.outputEvidence,'');
  assert.deepEqual(draft.basis,basis);assert.equal(draft.basisVerified,false);
 }
 await assert.rejects(executeDepartment('quality',{operation:'confirm',action:'prepare-process-iqc',arguments:{}},f.access));
 assert(f.calls.every(call=>!call.source.includes('save')));
});

test('更新基于当前可编辑版本；只改明确字段，保留原明细，不接受身份/版本/关联改写',async()=>{
 const f=setup(),before=structuredClone(f.record);
 const args={mode:'update',id:'SYN-IQC',expectedVersion:3,changes:{title:'合成新名称',details:{lotNo:'SYN-NEW'}}};
 const draft=await run(f,'quality','prepare','prepare-process-iqc',args);
 assert.equal(draft.proposed.notes,'保留旧备注');assert.equal(draft.proposed.details.supplierName,'合成供应商');assert.equal(draft.proposed.details.inspectedQuantity,10);
 assert.deepEqual(draft.changes.map(row=>row.field),['title','details']);assert.deepEqual(f.record,before);
 const repeat=await run(f,'quality','prepare','prepare-process-iqc',args);assert.deepEqual(repeat.binding,draft.binding);
 await assert.rejects(run(f,'quality','prepare','prepare-process-iqc',{...args,expectedVersion:2}),{status:409});
 await assert.rejects(run(f,'quality','prepare','prepare-process-iqc',{...args,id:'SYN-OTHER'}),{status:403});
 for(const changes of [{},{version:99},{type:'rfq'},{token:'model-token'},{createdById:'SYN-X'},{customerId:'SYN-OTHER'},{details:{unknown:'x'}}])
  await assert.rejects(run(f,'quality','prepare','prepare-process-iqc',{...args,changes}));
});

test('中台原规则拒绝不实完成条件、错误日期、数量不平及金额精度；未知不补全',async()=>{
 const f=setup();
 const invalid=[
  ['quality','iqc',{...createFields,plannedDate:'2026-02-30'}],
  ['quality','iqc',{...createFields,details:{inspectedQuantity:10,acceptedQuantity:9,rejectedQuantity:2}}],
  ['quality','iqc',{...createFields,status:'已完成'}],
  ['quality','iqc',{...createFields,details:{inspectedQuantity:'10'}}],
  ['finance','supplier-reconciliation',{...createFields,details:{amount:1.234}}],
  ['planning','material-kit',{...createFields,status:'受阻',blocker:''}],
  ['engineering','engineering-change',{...createFields,gateStatus:'不适用'}],
  ['sales','rfq',{title:'缺关联'}],
 ];
 for(const [group,type,fields] of invalid)await assert.rejects(run(f,group,'prepare','prepare-process-'+type,{mode:'create',fields}));
});

test('逐次重验真实权限；撤销、源模块缺失及后台事件范围都不能绕过',async()=>{
 const f=setup();await run(f,'quality','query','process-iqc',{dataset:'/records'});
 f.readOnly();await assert.rejects(run(f,'quality','prepare','prepare-process-iqc',{mode:'update',id:'SYN-IQC',expectedVersion:3,changes:{title:'更名'}}),{status:403});
 await assert.rejects(run(f,'quality','prepare','prepare-process-iqc',{mode:'create',fields:createFields}),{status:403});
 const reads=f.reads;f.revoke();await assert.rejects(run(f,'quality','list'),{status:403});
 await assert.rejects(run(f,'quality','query','process-iqc',{dataset:'/records'}),{status:403});assert.equal(f.reads,reads);
 const missing=setup();missing.unavailable();await assert.rejects(run(missing,'quality','query','process-iqc',{dataset:'/records'}),{status:404});
 const eventFixture=setup();
 await eventFixture.access.withEvent({source:'purchase-data',dataset:'/records',scope:{},recordId:'SYN-R'},async()=>{
  const eventAccess=currentBusinessAccess();
  await assert.rejects(executeDepartment('quality',{operation:'prepare',action:'prepare-process-iqc',arguments:{mode:'create',fields:createFields,basis}},eventAccess),{status:403});
  await assert.rejects(executeDepartment('sales',{operation:'query',action:'data',arguments:{dataset:'/records'}},eventAccess));
  const page=await executeDepartment('purchasing',{operation:'query',action:'purchase-data',arguments:{dataset:'/records'}},eventAccess);assert.equal(page.total,1);
 });
});
