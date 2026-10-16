import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createProjectReadPolicy} from '../project-policy.mjs';
import {loadProjectPermissionFunctions} from '../project-policy-loader.mjs';
import {createReadAdapter} from '../policy.mjs';

// Mirrors the record shapes in the project's responsibility, cross-team,
// two-stage review and project-collaboration regression suites. All data is new.
function fixture(){
  const at='2026-10-16T00:00:00.000Z';
  const roles=['admin','pmc','production','clerk','sales','finance','programmer','viewer','supplier'];
  const members=Object.fromEntries(roles.map(role=>[role,{id:'syn-m-'+role,kind:'member',userId:'syn-user-'+role,
    email:role+'@example.invalid',name:'合成'+role,role,active:true,customers:['合成客户甲'],orderScope:'assigned',departments:[],createdAt:at,
    privateMarker:'SYNTHETIC_MEMBER_PRIVATE'}]));
  for(const [key,role] of [['salesB','sales'],['reviewer','clerk'],['leader','sales'],['outsider','sales'],['disabled','sales']])members[key]={
    ...members[role],id:'syn-m-'+key,userId:'syn-user-'+key,email:key+'@example.invalid',name:'合成'+key,customers:[],active:key!=='disabled'};
  const customer=(suffix,sales,service)=>({id:'syn-c-'+suffix,kind:'customer_account',customer:suffix==='a'?'合成客户甲':'合成客户乙',customerCode:'SYN-'+suffix,
    salesName:'',serviceName:'',pmcName:'',salesMemberIds:sales.map(key=>members[key].id),serviceMemberIds:service.map(key=>members[key].id),quoteMemberIds:[],active:true,version:1,
    notes:'SYNTHETIC_CUSTOMER_PRIVATE',directory:{bank:'SYNTHETIC_BANK_PRIVATE'},createdAt:at,updatedAt:at,updatedBy:'synthetic'});
  const a=customer('a',['sales','leader'],['clerk','reviewer','pmc','finance']),b=customer('b',['salesB'],[]);
  const inactive={...a,id:'syn-c-inactive',customer:'合成停用客户',customerCode:'SYN-INACTIVE',active:false};
  const team=(suffix,customerIds,leaderIds,salesMemberIds,serviceMemberIds)=>({id:'syn-team-'+suffix,kind:'customer_project_team',name:'合成组'+suffix,
    active:true,customerIds,leaderIds,salesMemberIds,serviceMemberIds,version:1,notes:'SYNTHETIC_TEAM_PRIVATE'});
  const teamA=team('a',[a.id],[members.leader.id],[members.sales.id,members.outsider.id],[members.clerk.id,members.reviewer.id]);
  const teamB=team('b',[b.id],[],[members.salesB.id],[]),mixed=team('mixed',[a.id,b.id],[],[members.sales.id,members.salesB.id],[]);
  const project=(suffix,c,t,sales,service)=>({id:'syn-project-'+suffix,kind:'customer_project',customerId:c.id,teamId:t.id,salesMemberId:members[sales].id,
    serviceMemberId:members[service]?.id||'',serviceMemberIds:service?[members[service].id,members.reviewer.id]:[],status:'active',version:1,
    title:'合成项目'+suffix,code:'SYN-P-'+suffix,description:'SYNTHETIC_PROJECT_PRIVATE'});
  const projectA=project('a',a,teamA,'sales','clerk'),projectB=project('b',b,teamB,'salesB','');
  const task=(id,kind,c,p,owner)=>({id,kind,version:1,customerId:c.id,...(p?{projectId:p.id}:{}),ownerId:members[owner].id,
    title:'合成任务'+id,status:kind==='customer_workflow_task'?'待接手':'open',due:'2026-11-01',dueDate:'2026-11-01',updatedAt:at,
    serviceReviewerId:members.reviewer.id,salesReviewerId:members.sales.id,acknowledgedAt:'',
    description:'SYNTHETIC_TASK_PRIVATE',notes:'SYNTHETIC_TASK_PRIVATE',result:'SYNTHETIC_RESULT_PRIVATE',history:[{private:'SYNTHETIC_HISTORY_PRIVATE'}],sourceSnapshot:{email:'private@example.invalid'}});
  const workflow=task('syn-task-workflow','customer_workflow_task',a,null,'clerk');
  const review=task('syn-task-review','customer_project_task',a,projectA,'clerk');
  const collaboration=task('syn-task-collab','customer_project_collaboration_task',a,projectA,'production');
  const taskOnly=task('syn-task-only','customer_project_collaboration_task',b,projectB,'viewer');
  const order=(suffix,c,owner)=>({id:'syn-order-'+suffix,kind:'order',version:1,orderNo:'SYN-O-'+suffix,customer:c.customer,ownerEmail:members[owner].email,
    quantity:100,requestedDate:'2026-11-01',plannedDate:'',promisedDate:'',promiseConfirmed:false,stage:'生产中',lifecycle:'active',notes:'SYNTHETIC_ORDER_PRIVATE'});
  const orderA=order('a',a,'clerk'),orderB=order('b',b,'salesB');
  const state={revision:1,records:[...Object.values(members),a,b,inactive,teamA,teamB,mixed,projectA,projectB,workflow,review,collaboration,taskOnly,orderA,orderB]};
  return {state,members,a,b,inactive,teamA,teamB,mixed,projectA,projectB,workflow,review,collaboration,taskOnly,orderA,orderB,task};
}
const ids=response=>response.items.map(item=>item.id);
const denied=(fn,status)=>assert.throws(fn,error=>error.status===status);

test('permission provenance contains real allowlisted source hashes and excludes production runtime',async()=>{
  const f=fixture(),before=structuredClone(f.state),policy=await createProjectReadPolicy(f.state);
  assert.equal(policy.policyInputs.length,17);
  assert(policy.policyInputs.every(file=>/[\\/]lib[\\/][a-z-]+\.ts$/.test(file)));
  assert(!policy.policyInputs.some(file=>/[\\/](store|workbooks|runtime|auth)\./.test(file)));
  for(const input of policy.policyProvenance.inputs){
    assert.equal(createHash('sha256').update(await readFile(input.path,'utf8')).digest('hex'),input.sha256);
  }
  assert.equal(policy.policyProvenance.externalDependencies.length,1);
  assert.match(policy.policyProvenance.externalDependencies[0],/node_modules\/zod\//);
  assert(policy.policyProvenance.blockedIo.some(value=>value.includes('commit/json throw')));
  assert.deepEqual(Object.keys(policy).sort(),['getCustomer','getTask','listCustomers','listTasks','listTeams','policyInputs','policyProvenance'].sort());
  policy.listCustomers(f.members.sales.id);policy.listTeams(f.members.sales.id);policy.listTasks(f.members.sales.id);
  assert.deepEqual(f.state,before);
});

test('real order policy matrix covers all nine roles and separate field capabilities',async t=>{
  const {functions:p}=await loadProjectPermissionFunctions();
  const broad=new Set(['admin','pmc','production','finance']);
  for(const role of p.roles)await t.test(role,async()=>{
    const f=fixture(),actor=f.members[role],adapter=await createReadAdapter(f.state);
    assert.equal(p.canRead(actor,f.orderA),role!=='supplier');
    assert.equal(p.canRead(actor,f.orderB),broad.has(role));
    if(role==='supplier')denied(()=>adapter.listOrders(actor.id),403);
    else assert.equal(adapter.listOrders(actor.id).items.length,broad.has(role)?2:1);
    const writable=p.allowedFields(actor,f.orderA);
    assert.equal(writable.length>0,['admin','pmc','production','clerk','sales'].includes(role));
    assert.deepEqual(p.allowedFields(actor,{...f.orderA,lifecycle:'archived'}),[]);
    if(['viewer','finance','programmer','supplier'].includes(role))assert.deepEqual(writable,[]);
    if(role==='production')assert.deepEqual(writable,['stage','plannedDate','shipDate','notes']);
    if(role==='sales')assert(!p.allowedFields({...actor,orderScope:'all'},f.orderB).length);
    if(role!=='supplier')assert.equal(p.canRead({...actor,orderScope:'all'},f.orderB),true);
    actor.active=false;
    if(role!=='supplier')assert.equal(p.canRead(actor,f.orderA),true,'Pure legacy rule relies on actor/session boundary for active status.');
    denied(()=>adapter.listOrders(actor.id),403);
  });
  await t.test('legacy clerk department fallback is absent for an explicit assigned scope',()=>{
    const f=fixture(),actor={...f.members.clerk,customers:[],email:'unassigned@example.invalid',departments:['plating']};
    const legacy={...f.orderB,ledger:{columns:{}}};
    assert.equal(p.canRead(actor,legacy),false);
    delete actor.orderScope;
    assert.equal(p.canRead(actor,legacy),true);
    assert.equal(p.canRead(actor,f.orderB),false);
  });
});

test('customer responsibility bindings, aliases, role limits and inactivity are checked on every read',async t=>{
  await t.test('order breadth, customers array and team membership never substitute for CRM responsibilities',async()=>{
    const f=fixture(),policy=await createProjectReadPolicy(f.state);
    for(const key of ['sales','clerk','pmc','finance'])assert.deepEqual(ids(policy.listCustomers(f.members[key].id)),[f.a.id]);
    for(const key of ['production','programmer','viewer','outsider'])assert.deepEqual(policy.listCustomers(f.members[key].id).items,[]);
    assert.deepEqual(ids(policy.listCustomers(f.members.admin.id)),[f.a.id,f.b.id,f.inactive.id]);
    f.members.sales.orderScope='all';f.members.sales.customers.push(f.b.customer);
    denied(()=>policy.getCustomer(f.members.sales.id,f.b.id),404);
    assert.equal(policy.getCustomer(f.members.sales.id,f.a.id).capabilities.master,true);
    assert.equal(policy.getCustomer(f.members.pmc.id,f.a.id).capabilities.master,false);
    assert.equal(policy.getCustomer(f.members.pmc.id,f.a.id).capabilities.directory,true);
    assert.equal(policy.getCustomer(f.members.finance.id,f.a.id).capabilities.create,false);
  });
  await t.test('empty or malformed explicit list overrides matching names and administrative aliases',async()=>{
    const f=fixture(),policy=await createProjectReadPolicy(f.state);
    f.a.salesName=f.members.sales.name;f.a.salesMemberIds=[];
    denied(()=>policy.getCustomer(f.members.sales.id,f.a.id),404);
    f.a.salesMemberIds='malformed';denied(()=>policy.getCustomer(f.members.sales.id,f.a.id),404);
    delete f.a.salesMemberIds;
    assert.equal(policy.getCustomer(f.members.sales.id,f.a.id).id,f.a.id);
    f.a.salesName='Confirmed Synthetic Alias';
    denied(()=>policy.getCustomer(f.members.sales.id,f.a.id),404);
    f.state.records.push({id:'syn-quote-policy',kind:'customer_quote_access',memberIds:[],aliasesByMember:{[f.members.sales.id]:['Confirmed Synthetic Alias']}});
    assert.equal(policy.getCustomer(f.members.sales.id,f.a.id).id,f.a.id);
    f.a.salesName='Confirmed Synthetic Alias Extra';denied(()=>policy.getCustomer(f.members.sales.id,f.a.id),404);
    f.a.salesName='Confirmed Synthetic Alias';f.a.salesMemberIds=[];denied(()=>policy.getCustomer(f.members.sales.id,f.a.id),404);
  });
  await t.test('revoked responsibility and disabled customer disappear without reconstructing policy',async()=>{
    const f=fixture(),policy=await createProjectReadPolicy(f.state);
    f.a.salesMemberIds=[];denied(()=>policy.getCustomer(f.members.sales.id,f.a.id),404);
    f.a.salesMemberIds=[f.members.sales.id];f.a.active=false;
    denied(()=>policy.getCustomer(f.members.sales.id,f.a.id),404);
    assert.equal(policy.getCustomer(f.members.admin.id,f.a.id).active,false);
    f.state.records.push({...f.b});denied(()=>policy.getCustomer(f.members.admin.id,f.b.id),404);
  });
});

test('team selection narrows authorized records without becoming a customer security boundary',async()=>{
  const f=fixture(),policy=await createProjectReadPolicy(f.state),sales=f.members.sales.id;
  assert.deepEqual(ids(policy.listTeams(sales)),[f.teamA.id,f.mixed.id].sort());
  assert.deepEqual(policy.listTeams(sales).items.find(team=>team.id===f.mixed.id).customerIds,[f.a.id]);
  assert.deepEqual(policy.listTeams(f.members.outsider.id),{items:[]});
  denied(()=>policy.listCustomers(sales,{teamId:f.teamB.id}),403);
  denied(()=>policy.listTasks(sales,{teamId:f.teamB.id}),403);
  assert.deepEqual(ids(policy.listCustomers(sales,{teamId:f.mixed.id})),[f.a.id]);
  assert(policy.listTasks(sales,{teamId:f.teamA.id}).items.every(task=>task.customerId===f.a.id));
  // A second group sharing a customer is a display choice, not a separate grant.
  f.teamB.customerIds.push(f.a.id);
  assert.equal(policy.listCustomers(sales,{teamId:f.teamB.id}).items[0].id,f.a.id);
  assert.equal(policy.getTask(sales,f.review.id).id,f.review.id);
  assert(!ids(policy.listTasks(sales,{teamId:f.teamB.id})).includes(f.review.id));
  denied(()=>policy.getCustomer(sales,f.b.id),404);
  const ungrouped={...f.a,id:'syn-c-ungrouped',customer:'合成未分组客户'};f.state.records.push(ungrouped);
  assert.deepEqual(ids(policy.listCustomers(sales,{teamId:'__ungrouped'})),[ungrouped.id]);
});

test('customer tasks require existing customer authorization plus owner, sales responsibility or admin',async()=>{
  const f=fixture(),policy=await createProjectReadPolicy(f.state);
  for(const key of ['admin','sales','clerk','leader'])assert.deepEqual(policy.getTask(f.members[key].id,f.workflow.id).capabilities,{canEdit:true});
  for(const key of ['reviewer','pmc','finance','viewer','outsider'])denied(()=>policy.getTask(f.members[key].id,f.workflow.id),404);
  f.workflow.customerId=f.b.id;
  denied(()=>policy.getTask(f.members.clerk.id,f.workflow.id),404);
  f.workflow.customerId='';
  assert.equal(policy.getTask(f.members.clerk.id,f.workflow.id).ownedByMe,true);
  denied(()=>policy.getTask(f.members.sales.id,f.workflow.id),404);
  f.workflow.ownerId=f.members.viewer.id;
  denied(()=>policy.getTask(f.members.viewer.id,f.workflow.id),404);
});

test('old project tasks retain explicit two-stage reviewers and current scope checks',async t=>{
  await t.test('manager, owner and both review stages stay distinct, including administrator',async()=>{
    const f=fixture(),policy=await createProjectReadPolicy(f.state),caps=key=>policy.getTask(f.members[key].id,f.review.id).capabilities;
    assert.equal(caps('sales').canManage,true);assert.equal(caps('leader').canManage,true);assert.equal(caps('admin').canManage,true);
    assert.equal(caps('clerk').canManage,false);assert.equal(caps('clerk').canSubmit,true);assert.equal(caps('admin').canSubmit,false);
    f.review.status='service_review';assert.equal(caps('reviewer').canReviewService,true);assert.equal(caps('admin').canReviewService,false);assert.equal(caps('sales').canReviewSales,false);
    f.review.status='sales_review';assert.equal(caps('sales').canReviewSales,true);assert.equal(caps('admin').canReviewSales,false);
    f.review.status='done';assert.equal(caps('sales').canManage,false);assert.equal(caps('clerk').canSubmit,false);
    assert.equal(caps('finance').canManage,false);assert.equal(caps('finance').canSubmit,false);
    denied(()=>policy.getTask(f.members.outsider.id,f.review.id),404);
  });
  await t.test('assignment alone, self-review, revoked reviewers and malformed roster cannot authorize action',async()=>{
    const f=fixture(),policy=await createProjectReadPolicy(f.state);
    f.review.ownerId=f.members.viewer.id;denied(()=>policy.getTask(f.members.viewer.id,f.review.id),404);
    f.review.ownerId=f.members.clerk.id;f.review.serviceReviewerId=f.members.clerk.id;
    assert.equal(policy.getTask(f.members.clerk.id,f.review.id).capabilities.canSubmit,false);
    f.review.serviceReviewerId=f.members.reviewer.id;f.members.reviewer.active=false;
    assert.equal(policy.getTask(f.members.clerk.id,f.review.id).capabilities.reviewConfigurationValid,false);
    f.members.reviewer.active=true;
    f.state.records.push({id:'customer_project_assignment_roster',kind:'customer_project_assignment_roster',version:1,serviceFollowerIds:[f.members.clerk.id],salesReviewerIds:[f.members.sales.id]});
    assert.equal(policy.getTask(f.members.clerk.id,f.review.id).capabilities.canSubmit,true);
    f.teamA.serviceMemberIds=[];assert.equal(policy.getTask(f.members.clerk.id,f.review.id).capabilities.canSubmit,false);
    f.teamA.serviceMemberIds=[f.members.clerk.id,f.members.reviewer.id];
    f.state.records.push({...f.state.records.at(-1)});
    assert.equal(policy.getTask(f.members.clerk.id,f.review.id).capabilities.reviewConfigurationValid,false);
  });
  await t.test('paused, recycled and misbound projects fail action checks without repairing records',async()=>{
    const f=fixture(),policy=await createProjectReadPolicy(f.state);
    for(const status of ['paused','cancelled','archived']){
      f.projectA.status=status;const caps=policy.getTask(f.members.clerk.id,f.review.id).capabilities;
      assert.equal(caps.canSubmit,false);assert.equal(caps.canManage,false);
    }
    f.projectA.status='active';f.projectA.trashedAt='2026-10-16';
    assert.equal(policy.getTask(f.members.clerk.id,f.review.id).capabilities.canOpenProject,false);
    f.review.customerId=f.b.id;denied(()=>policy.getTask(f.members.admin.id,f.review.id),404);
  });
});

test('new collaboration assigns only a task, with seven internal roles and no implied project access',async t=>{
  for(const role of ['sales','clerk','pmc','production','finance','programmer','viewer'])await t.test(role,async()=>{
    const f=fixture(),policy=await createProjectReadPolicy(f.state);
    f.taskOnly.ownerId=f.members[role].id;
    const dto=policy.getTask(f.members[role].id,f.taskOnly.id);
    assert.equal(dto.ownedByMe,true);assert.equal(dto.capabilities.canReply,true);assert.equal(dto.capabilities.canComplete,true);
    assert.equal(dto.capabilities.canAssign,false);assert.equal(dto.capabilities.canOpenProject,false);
    assert.equal(dto.customerId,'');assert.equal(dto.projectId,'');assert.equal(dto.teamId,'');
    denied(()=>policy.getCustomer(f.members[role].id,f.b.id),404);
    assert(ids(policy.listTasks(f.members[role].id)).includes(f.taskOnly.id));
    f.taskOnly.ownerId=f.members.salesB.id;denied(()=>policy.getTask(f.members[role].id,f.taskOnly.id),404);
  });
  await t.test('project managers cannot complete for owner; team leaders are not implicit collaboration managers',async()=>{
    const f=fixture(),policy=await createProjectReadPolicy(f.state),caps=key=>policy.getTask(f.members[key].id,f.collaboration.id).capabilities;
    for(const key of ['admin','sales','clerk']){assert.equal(caps(key).canAssign,true);assert.equal(caps(key).canComplete,false);}
    assert.equal(caps('leader').canAssign,false);assert.equal(caps('production').canComplete,true);
    f.collaboration.status='done';assert.equal(caps('sales').canAcknowledge,true);assert.equal(caps('production').canAcknowledge,false);
    f.collaboration.acknowledgedAt='2026-10-16';assert.equal(caps('sales').canAcknowledge,false);
    f.collaboration.status='open';f.projectA.status='paused';assert.equal(caps('production').canComplete,false);
    f.projectA.status='active';f.a.active=false;assert.equal(caps('production').canReply,false);
  });
  await t.test('task-only assignment cannot bypass mismatched, missing or ambiguous project bindings',async()=>{
    const f=fixture(),policy=await createProjectReadPolicy(f.state),actor=f.members.viewer.id;
    f.taskOnly.customerId=f.a.id;denied(()=>policy.getTask(actor,f.taskOnly.id),404);
    f.taskOnly.customerId=f.b.id;f.taskOnly.projectId='syn-missing-project';denied(()=>policy.getTask(actor,f.taskOnly.id),404);
    f.taskOnly.projectId=f.projectB.id;f.state.records.push({...f.projectB});denied(()=>policy.getTask(actor,f.taskOnly.id),404);
    assert(!ids(policy.listTasks(actor)).includes(f.taskOnly.id));
  });
});

test('all entry points recheck actor status and reject ambiguous or malformed requests',async()=>{
  const f=fixture(),policy=await createProjectReadPolicy(f.state);
  const methods=id=>[()=>policy.listCustomers(id),()=>policy.getCustomer(id,f.a.id),()=>policy.listTeams(id),()=>policy.listTasks(id),()=>policy.getTask(id,f.workflow.id)];
  for(const key of ['disabled','supplier'])for(const call of methods(f.members[key].id))denied(call,403);
  for(const actorId of ['',null,'missing'])for(const call of methods(actorId))denied(call,401);
  f.members.sales.active=false;for(const call of methods(f.members.sales.id))denied(call,403);f.members.sales.active=true;
  for(const options of [null,[],{limit:0},{limit:51},{limit:1.5},{limit:'20'},{teamId:12},{actorId:f.members.admin.id},{unexpected:true}]){
    denied(()=>policy.listCustomers(f.members.sales.id,options),400);denied(()=>policy.listTasks(f.members.sales.id,options),400);
  }
  assert.equal(policy.listTasks(f.members.sales.id,{limit:1}).items.length,1);
  assert(policy.listTasks(f.members.sales.id,{limit:1}).total>1);
  f.state.records.push({...f.workflow});denied(()=>policy.getTask(f.members.clerk.id,f.workflow.id),404);
  assert(!ids(policy.listTasks(f.members.clerk.id)).includes(f.workflow.id));
  f.state.records.push({...f.members.sales});for(const call of methods(f.members.sales.id))denied(call,401);
});

test('DTO projection is detached, excludes private fields and preserves every synthetic source byte',async()=>{
  const f=fixture(),before=JSON.stringify(f.state),policy=await createProjectReadPolicy(f.state);
  const responses=Object.values(f.members).filter(member=>member.active&&member.role!=='supplier').flatMap(member=>[
    policy.listCustomers(member.id),policy.listTeams(member.id),policy.listTasks(member.id),
  ]);
  const text=JSON.stringify(responses);
  assert(!text.includes('PRIVATE'));assert(!text.includes('@example.invalid'));assert(!text.includes('sourceSnapshot'));
  const customer=policy.getCustomer(f.members.sales.id,f.a.id),team=policy.listTeams(f.members.sales.id).items[0],task=policy.getTask(f.members.sales.id,f.review.id);
  assert.deepEqual(Object.keys(customer).sort(),['id','customer','customerCode','active','version','capabilities'].sort());
  assert.deepEqual(Object.keys(team).sort(),['id','name','active','customerIds'].sort());
  assert.deepEqual(Object.keys(task).sort(),['id','kind','version','title','status','dueDate','customerId','projectId','teamId','ownedByMe','capabilities'].sort());
  customer.capabilities.master=false;team.customerIds.push(f.b.id);task.capabilities.canSubmit=true;
  assert.equal(JSON.stringify(f.state),before);
});
