import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createSyntheticState} from '../fixtures.mjs';
import {createProjectSyntheticState,projectIds as ids} from '../project-fixtures.mjs';
import {createReadAdapter} from '../policy.mjs';
import {createProjectReadPolicy} from '../project-policy.mjs';
import {createProjectIdentity} from '../project-auth.mjs';
import {createSandbox,openSuggestionStore,removeSandbox,sandboxDigest} from '../sandbox.mjs';
import {startReadonlyServer,syntheticSession} from '../server.mjs';
import {generateSyntheticSuggestions} from '../generate.mjs';
import {makeScriptedModel} from '../mock-model.mjs';

const fixtureAttachment='SYNTHETIC_PROJECT_HTTP_ATTACHMENT';
const attachmentBody='SYNTHETIC_PRIVATE_ATTACHMENT_BYTES';
const sorted=values=>[...values].sort();
const itemIds=body=>sorted(body.items.map(item=>item.id));

async function setup(t) {
  const state=createProjectSyntheticState(),before=structuredClone(state),directory=await createSandbox();
  let server,identity,reader,writer,testControl,digest;
  await writeFile(path.join(directory,fixtureAttachment),attachmentBody,{encoding:'utf8',flag:'wx'});
  t.after(async()=>{
    try {
      assert.deepEqual(state,before,'HTTP operations must preserve every original synthetic source record');
      if(digest)assert.equal(await sandboxDigest(directory),digest,'HTTP operations must preserve the suggestion database');
      assert.equal(await readFile(path.join(directory,fixtureAttachment),'utf8'),attachmentBody);
    } finally {
      try {if(server)await server.close();else await identity?.close();}
      finally {reader?.close();writer?.close();await removeSandbox(directory);}
    }
  });
  const adapter=await createReadAdapter(state),projectPolicy=await createProjectReadPolicy(state);
  const provisioned=await createProjectIdentity({state,adapter,testOnly:true});
  identity=provisioned.identity;testControl=provisioned.testControl;
  reader=await openSuggestionStore(directory);writer=await openSuggestionStore(directory,{readOnly:false});
  server=await startReadonlyServer({adapter,store:reader,identity,projectPolicy});
  assert.notEqual(server.port,8787);assert.equal(new URL(server.origin).hostname,'127.0.0.1');
  digest=await sandboxDigest(directory);
  const cookies=new Map();
  async function login(actorId) {
    const item=provisioned.credentials.find(value=>value.actorId===actorId);
    assert(item,'trusted fixture account must exist');
    const cookie=await syntheticSession(server.origin,{username:item.username,password:item.password});
    cookies.set(actorId,cookie);return cookie;
  }
  async function request(route,actorId=ids.actors.a,options={}) {
    const {cookie:explicitCookie,headers={},...rest}=options;
    const cookie=explicitCookie??(actorId?(cookies.get(actorId)||await login(actorId)):null);
    return fetch(server.origin+route,{...rest,headers:{origin:server.origin,...(cookie?{cookie}:{}),...headers},redirect:'error',signal:AbortSignal.timeout(15_000)});
  }
  async function read(route,actorId=ids.actors.a) {const response=await request(route,actorId);assert.equal(response.status,200);return response.json();}
  async function acceptNewSuggestions(){digest=await sandboxDigest(directory);}
  return {state,before,directory,adapter,projectPolicy,identity,testControl,server,reader,writer,login,request,read,acceptNewSuggestions,credentials:provisioned.credentials};
}

async function denied(response,status) {
  assert.equal(response.status,status);
  assert.equal(response.headers.get('cache-control'),'no-store');
  const body=await response.json();assert.deepEqual(Object.keys(body),['error']);
  assert.doesNotMatch(JSON.stringify(body),/SYNTHETIC_.*PRIVATE|password_hash|token_hash|SQLite format/);
}

test('project fixture retains all eight original synthetic orders and supplies independent permission graphs',()=>{
  const state=createProjectSyntheticState(),base=createSyntheticState();
  assert.deepEqual(state.records.filter(row=>row.kind==='order'),base.records.filter(row=>row.kind==='order'));
  assert.equal(new Set(state.records.map(row=>row.id)).size,state.records.length);
  assert(state.records.every(row=>row.id.startsWith('syn-')));
  assert(state.records.filter(row=>row.kind==='member').every(row=>row.privateMarker==='SYNTHETIC_MEMBER_PRIVATE'&&row.email.endsWith('@example.invalid')));
  assert(state.records.filter(row=>row.kind==='customer_account').every(row=>row.notes==='SYNTHETIC_CUSTOMER_PRIVATE'));
  state.records[0].name='合成独立副本';
  assert.notEqual(createProjectSyntheticState().records[0].name,state.records[0].name);
});

test('project HTTP: real login binds A/B/admin identities and CRM DTOs remain narrower than broad order access',{timeout:60_000},async t=>{
  const c=await setup(t);
  await denied(await c.request('/api/customers',null),401);
  assert.deepEqual(itemIds(await c.read('/api/customers',ids.actors.a)),[ids.customers.a]);
  assert.deepEqual(itemIds(await c.read('/api/customers',ids.actors.b)),[ids.customers.b]);
  assert.deepEqual(itemIds(await c.read('/api/customers',ids.actors.admin)),sorted([ids.customers.a,ids.customers.b]));
  assert.deepEqual(itemIds(await c.read('/api/customers',ids.actors.clerk)),[ids.customers.a]);
  for(const actorId of [ids.actors.finance,ids.actors.pmc,ids.actors.production]) {
    assert.equal((await c.read('/api/orders',actorId)).items.length,8);
    assert.equal((await c.read('/api/customers',actorId)).items.length,0);
    assert.equal((await c.read('/api/teams',actorId)).items.length,0);
    await denied(await c.request('/api/customers/'+ids.customers.a,actorId),404);
  }
  const me=await c.read('/api/me');assert.equal(me.id,ids.actors.a);assert.notEqual(me.id,ids.actors.a+'-user');
  assert(Number.isFinite(me.sessionExpiresAt)&&me.sessionExpiresAt>Date.now());
  const customer=await c.read('/api/customers/'+ids.customers.a);
  assert.deepEqual(sorted(Object.keys(customer)),sorted(['id','customer','customerCode','active','version','capabilities']));
  await denied(await c.request('/api/customers/'+ids.customers.b),404);
  await denied(await c.request('/api/orders/syn-order-b-overdue'),404);
  assert.doesNotMatch(JSON.stringify(customer),/PRIVATE|salesMemberIds|serviceMemberIds|notes|email|userId/);
});

test('project HTTP: three task classes enforce exact source permissions; task-only assignment grants no CRM or project access',{timeout:60_000},async t=>{
  const c=await setup(t),task=ids.tasks;
  const a=await c.read('/api/tasks'),b=await c.read('/api/tasks',ids.actors.b),clerk=await c.read('/api/tasks',ids.actors.clerk);
  assert.deepEqual(itemIds(a),sorted([task.workflowA,task.workflowAClerk,task.projectA,task.projectTrashed,task.collaborationA,task.collaborationAFinance]));
  assert.deepEqual(itemIds(b),sorted([task.workflowB,task.workflowBAssignedA,task.projectB,task.projectBAssignedA,task.collaborationB,task.collaborationBViewer]));
  assert.deepEqual(itemIds(clerk),sorted([task.workflowAClerk,task.projectA,task.projectTrashed,task.collaborationA,task.collaborationAFinance]));
  assert.deepEqual(sorted(new Set(a.items.map(item=>item.kind))),sorted(['customer_workflow_task','customer_project_task','customer_project_collaboration_task']));
  for(const id of [task.workflowBAssignedA,task.projectBAssignedA,task.collaborationBroken])await denied(await c.request('/api/tasks/'+id),404);
  for(const [actorId,taskId] of [[ids.actors.viewer,task.collaborationBViewer],[ids.actors.finance,task.collaborationAFinance]]) {
    const feed=await c.read('/api/tasks',actorId);assert.deepEqual(itemIds(feed),[taskId]);
    const item=await c.read('/api/tasks/'+taskId,actorId);
    assert.equal(item.ownedByMe,true);assert.equal(item.customerId,'');assert.equal(item.projectId,'');assert.equal(item.teamId,'');
    assert.equal(item.capabilities.canOpenProject,false);
    assert.deepEqual(sorted(Object.keys(item)),sorted(['id','kind','version','title','status','dueDate','customerId','projectId','teamId','ownedByMe','capabilities']));
    assert.equal((await c.read('/api/customers',actorId)).items.length,0);
    await denied(await c.request('/api/tasks/'+task.projectB,actorId),404);
    await denied(await c.request('/api/tasks/'+task.collaborationBroken,actorId),404);
  }
  const admin=await c.read('/api/tasks',ids.actors.admin);assert.equal(admin.items.length,12);
  assert(!admin.items.some(item=>item.id===task.collaborationBroken));
  assert.equal((await c.read('/api/tasks/'+task.projectTrashed)).capabilities.canOpenProject,false);
  assert.doesNotMatch(JSON.stringify([a,b,clerk,admin]),/PRIVATE|internalSecret|description|reviewHistory|history|ownerEmail|attachmentKey/);
});

test('project HTTP: team filtering narrows already-authorized lists without granting customers or modifying direct-detail authorization',{timeout:60_000},async t=>{
  const c=await setup(t);
  const teams=await c.read('/api/teams');
  assert.deepEqual(itemIds(teams),sorted([ids.teams.a,ids.teams.mixed]));
  assert(teams.items.every(team=>JSON.stringify(team.customerIds)===JSON.stringify([ids.customers.a])));
  assert(teams.items.every(team=>Object.keys(team).every(key=>['id','name','active','customerIds'].includes(key))));
  assert.deepEqual(itemIds(await c.read('/api/customers?teamId='+ids.teams.mixed)),[ids.customers.a]);
  await denied(await c.request('/api/customers?teamId='+ids.teams.b),403);
  await denied(await c.request('/api/tasks?teamId='+ids.teams.b),403);
  await denied(await c.request('/api/tasks?teamId='+ids.teams.b,ids.actors.viewer),403);
  const adminA=await c.read('/api/tasks?teamId='+ids.teams.a,ids.actors.admin);
  assert(adminA.items.length>0);assert(adminA.items.every(item=>item.customerId===ids.customers.a));
  assert.equal((await c.read('/api/tasks?teamId=__ungrouped',ids.actors.admin)).items.length,0);
  const direct=await c.read('/api/tasks/'+ids.tasks.projectB,ids.actors.admin);assert.equal(direct.id,ids.tasks.projectB);
  await denied(await c.request('/api/tasks/'+ids.tasks.projectB+'?teamId='+ids.teams.a,ids.actors.admin),400);
});

test('project HTTP: forged actor/role/email/token and obsolete demo selectors never replace a real project session',{timeout:60_000},async t=>{
  const c=await setup(t),a=await c.login(ids.actors.a),cookieName=a.slice(0,a.indexOf('='));
  for(const cookie of [`${cookieName}=${'a'.repeat(43)}`,`${cookieName}=${ids.actors.b}`,'doon_session=synthetic-admin'])await denied(await c.request('/api/tasks',null,{cookie}),401);
  const forged={'authorization':'Bearer synthetic-admin','x-actor-id':ids.actors.b,'x-user-role':'admin','x-user-email':'syn-admin@example.invalid','oai-authenticated-user-id':ids.actors.b};
  await denied(await c.request('/api/customers',null,{headers:forged}),401);
  const me=await (await c.request('/api/me',ids.actors.a,{headers:forged})).json();assert.equal(me.id,ids.actors.a);
  for(const route of ['/api/customers?actorId='+ids.actors.b,'/api/tasks?role=admin','/api/customers?email=syn-admin@example.invalid','/api/teams?memberId='+ids.actors.b])await denied(await c.request(route),400);
  for(const body of [{employeeId:ids.actors.b},{username:'synthetic-forged',password:'synthetic-invalid',role:'admin'},{username:'synthetic-forged',password:'synthetic-invalid',actorId:ids.actors.b}]) {
    const route=Object.hasOwn(body,'employeeId')?'/api/demo-session':'/api/session';
    await denied(await c.request(route,null,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),route.endsWith('demo-session')?404:400);
  }
  await denied(await c.request('/api/session',null,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'synthetic-forged',password:'synthetic-invalid'})}),401);
  assert.equal((await c.read('/api/me')).id,ids.actors.a);
});

test('project HTTP: disabling members and revoking customer responsibility immediately affect existing sessions and assigned tasks',{timeout:60_000},async t=>{
  const c=await setup(t);await c.login(ids.actors.a);await c.login(ids.actors.viewer);
  const a=c.state.records.find(row=>row.id===ids.actors.a),customer=c.state.records.find(row=>row.id===ids.customers.a);
  const task=c.state.records.find(row=>row.id===ids.tasks.collaborationBViewer);
  try {
    a.active=false;
    const disabled=await c.request('/api/customers');assert([401,403].includes(disabled.status));
    await denied(await c.request('/api/tasks'),401);
    a.active=true;await c.login(ids.actors.a);
    customer.salesMemberIds=[];
    assert.equal((await c.read('/api/customers')).items.length,0);
    assert.equal((await c.read('/api/tasks')).items.length,0);
    await denied(await c.request('/api/customers/'+ids.customers.a),404);
    // Order authorization is a separate current project policy, not a CRM grant.
    assert.equal((await c.read('/api/orders')).items.length,4);
    a.customers=[];a.email='syn-revoked@example.invalid';
    assert.equal((await c.read('/api/orders')).items.length,0);
    task.ownerId=ids.actors.b;
    assert.equal((await c.read('/api/tasks',ids.actors.viewer)).items.length,0);
    await denied(await c.request('/api/tasks/'+task.id,ids.actors.viewer),404);
  } finally {c.state.records.splice(0,c.state.records.length,...structuredClone(c.before.records));c.state.revision=c.before.revision;}
});

test('project HTTP: strict resource queries, bounded batches, attachment paths and all business writes remain closed',{timeout:60_000},async t=>{
  const c=await setup(t);
  for(const resource of ['customers','tasks']) {
    for(const limit of ['0','-1','51','1.5','1000000','NaN','Infinity',''])await denied(await c.request('/api/'+resource+'?limit='+limit),400);
    await denied(await c.request('/api/'+resource+'?limit=1&limit=20'),400);
    await denied(await c.request('/api/'+resource+'?teamId='+ids.teams.a+'&teamId='+ids.teams.b),400);
    await denied(await c.request('/api/'+resource+'?fields=*'),400);
    const bounded=await c.read('/api/'+resource+'?limit=1',ids.actors.admin);assert.equal(bounded.items.length,1);assert(bounded.total>1);
  }
  for(const route of ['/api/tasks/'+ids.tasks.projectA+'?history=true','/api/customers/'+ids.customers.a+'?fields=*','/api/teams?limit=1'])await denied(await c.request(route),400);
  for(const route of ['/files/'+fixtureAttachment,'/api/attachments/syn-project-attachment-private','/public/%2e%2e%2f'+fixtureAttachment,'/api/tasks/%2e%2e%2ffiles%2f'+fixtureAttachment])await denied(await c.request(route),404);
  const payload=JSON.stringify({actorId:ids.actors.admin,approved:true,items:Array.from({length:51},()=>({id:ids.tasks.projectB,version:1,status:'done'}))});
  for(const method of ['POST','PUT','PATCH','DELETE'])for(const route of ['/api/customers','/api/teams','/api/tasks','/api/tasks/'+ids.tasks.projectB,'/api/approve','/api/workflows/resume']) {
    await denied(await c.request(route,ids.actors.admin,{method,headers:{'content-type':'application/json'},body:payload}),405);
  }
});

test('project HTTP: actual project login preserves the trusted mock-or-DeepSeek suggestion entry and rejects non-sales before model use',{timeout:60_000},async t=>{
  const c=await setup(t);
  for(const actorId of [ids.actors.a,ids.actors.b]) {
    const sessionCookie=await c.login(actorId);
    const result=await generateSyntheticSuggestions({origin:c.server.origin,adapter:c.adapter,store:c.writer,sessionCookie,resolveSession:c.server.resolveSession});
    assert.equal(result.actorId,actorId);assert.equal(result.created,2);assert.equal(result.readCalls,1);assert.equal(result.modelCalls,3);
  }
  await c.acceptNewSuggestions();assert.equal(c.reader.count(),4);
  for(const actorId of [ids.actors.admin,ids.actors.clerk,ids.actors.viewer,ids.actors.finance]) {
    const model=makeScriptedModel(()=>{throw new Error('NON_SALES_MODEL_MUST_NOT_RUN');});
    await assert.rejects(generateSyntheticSuggestions({origin:c.server.origin,adapter:c.adapter,store:c.writer,sessionCookie:await c.login(actorId),resolveSession:c.server.resolveSession,model,modelId:'deepseek-v4-pro'}),/P1_ACTOR_REJECTED/);
    assert.equal(model.calls.length,0);
  }
  const a=await c.read('/api/suggestions'),b=await c.read('/api/suggestions',ids.actors.b);
  assert.equal(a.items.length,2);assert.equal(b.items.length,2);
  assert(a.items.every(item=>item.source.id.startsWith('syn-order-a-')));assert(b.items.every(item=>item.source.id.startsWith('syn-order-b-')));
});

test('project HTTP: login history stays inside the synthetic auth worker and never appears in public or source records',{timeout:60_000},async t=>{
  const c=await setup(t);
  for(const actorId of [ids.actors.a,ids.actors.b,ids.actors.admin])await c.login(actorId);
  assert.equal((await c.request('/api/logout',ids.actors.a,{method:'POST'})).status,200);
  assert.equal(typeof c.testControl?.history,'function');
  const history=await c.testControl.history(),events=Array.isArray(history)?history:history.events;
  assert(Array.isArray(events)&&events.length>=4);
  const names=new Set(c.credentials.map(item=>item.username)),actors=new Set(c.state.records.filter(row=>row.kind==='member').map(row=>row.name));
  assert(events.every(event=>names.has(event.username)&&actors.has(event.actor)));
  assert(events.some(event=>event.event==='login_success'));assert(events.some(event=>event.event==='logout'));
  assert(events.every(event=>!('password' in event)&&!('password_hash' in event)&&!('token' in event)&&!('token_hash' in event)));
  assert.equal(c.state.records.some(row=>row.kind==='auth_event'),false);
  await denied(await c.request('/api/auth/history',ids.actors.admin),404);
  await denied(await c.request('/api/auth/accounts',ids.actors.admin),404);
});
