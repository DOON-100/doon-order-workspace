import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {OrderWriteService} from '../dist/order-write.js';
import {WorkspaceToolsService} from '../dist/workspace-tools-write.js';
import {resolveOwnerUsername,ownerUsername} from '../dist/owner-username.js';
import {store,session} from './helpers.mjs';

// Synthetic members and orders only; no real server or business data.
const member={id:'synthetic-owner',name:'Synthetic Employee',email:'unrelated@example.test',username:'test_owner',active:true};
async function fixture(transport){
 const state=await store();await state.setup('https://employee.test');await state.saveSession(session('https://employee.test'));
 return {orders:new OrderWriteService(state,transport),workspace:new WorkspaceToolsService(state,transport),async input(data){const file=path.join(state.directory,'owner.json');await fs.writeFile(file,JSON.stringify(data));return file;}};
}

test('login matching uses current native members, not display names or external email prefixes',()=>{
 assert.equal(ownerUsername(member),'test_owner');
 for(const name of ['test_owner','TEST_OWNER',' Test_Owner '])assert.equal(resolveOwnerUsername(name,[member]),member.username);
 for(const name of [member.email,'Synthetic Employee','', '  '])assert.throws(()=>resolveOwnerUsername(name,[member]),{code:'INVALID_INPUT'});
 for(const members of [[],[{...member,active:false}],[{...member,username:undefined}],[member,{...member,id:'other'}]])assert.throws(()=>resolveOwnerUsername('test_owner',members),{code:'INVALID_INPUT'});
 assert.throws(()=>resolveOwnerUsername('test_owner',null),{code:'INVALID_RESPONSE'});
});

test('single-order username input submits canonical member identity and verifies the saved value',async()=>{
 for(const username of ['test_owner','TEST_OWNER',' Test_Owner ']){
  const order={id:'synthetic-order',version:3,customer:'SYN',ownerUsername:'',notes:'original'};let posts=0;
  const f=await fixture(async(url,init)=>{
   if(init.method==='GET')return Response.json({orders:[order],members:[member]});
   assert(url.endsWith('/edit-order'));posts++;const body=JSON.parse(init.body);
   assert.deepEqual(body,{id:order.id,patch:{ownerUsername:member.username,notes:'changed'},version:3});Object.assign(order,body.patch,{version:4});return Response.json({ok:true});
  });
  const result=await f.orders.update(await f.input({id:order.id,patch:{ownerUsername:username,notes:'changed'}}),'3');
  assert.equal(result.record.ownerUsername,member.username);assert.equal(posts,1);
  assert(f.orders.schema('order').fields.patch.properties.ownerUsername);assert(!f.orders.schema('order').fields.patch.properties.ownerEmail);
 }
});

test('single-order email fields, email values and invalid member matches never submit a write',async()=>{
 for(const [patch,members] of [[{ownerEmail:member.email},[member]],[{ownerUsername:member.email},[member]],[{ownerUsername:'missing'},[member]],[{ownerUsername:'test_owner'},[{...member,active:false}]],[{ownerUsername:'test_owner'},[member,{...member,id:'duplicate'}]],[{ownerUsername:'test_owner'},null]]){
  let posts=0;const f=await fixture(async(url,init)=>{if(init.method==='POST')posts++;return Response.json({orders:[],members});});
  await assert.rejects(f.orders.update(await f.input({id:'synthetic-order',patch}),'1'),e=>['INVALID_INPUT','INVALID_RESPONSE'].includes(e.code));assert.equal(posts,0);
 }
});

test('explicit unassignment remains possible and readback mismatch never claims success',async()=>{
 let posts=0,wrong=false;const order={id:'synthetic-order',version:1,ownerUsername:member.username};
 const f=await fixture(async(url,init)=>{if(init.method==='GET')return Response.json({orders:[order],members:[member]});posts++;const body=JSON.parse(init.body);if(!wrong)Object.assign(order,body.patch);return Response.json({ok:true});});
 assert.equal((await f.orders.update(await f.input({id:order.id,patch:{ownerUsername:''}}),'1')).record.ownerUsername,'');
 wrong=true;await assert.rejects(f.orders.update(await f.input({id:order.id,patch:{ownerUsername:'TEST_OWNER'}}),'1'),e=>e.code==='READBACK_FAILED'&&e.details.outcomeUnknown===true);assert.equal(posts,2);
});

test('batch preview and assignment resolve the same username and preserve the server preview contract',async()=>{
 const order={id:'synthetic-order',version:1,ownerUsername:''},previewHash='a'.repeat(64);let posts=0;
 const f=await fixture(async(url,init)=>{
  if(init.method==='GET')return Response.json({contract:'workspace-tools-v1',comments:[],orders:[order],members:[member]});
  posts++;const body=JSON.parse(init.body);assert.equal(body.username,member.username);assert(!Object.hasOwn(body,'email'));
  if(url.endsWith('/workspace-owner-preview'))return Response.json({readOnly:true,previewHash,rows:[order]});
  assert(url.endsWith('/workspace-owner-assign'));assert.equal(body.previewHash,previewHash);assert.deepEqual(body.orders,[{id:order.id,version:1}]);Object.assign(order,{ownerUsername:member.username,version:2});return Response.json({ok:true,rows:[order]});
 });
 const refs=await f.workspace.references('owner');assert.equal(refs.members[0].username,'test_owner');
 const selection={orders:[{id:order.id,version:1}],username:'Test_Owner'};
 const plan=await f.workspace.preview('owner',await f.input(selection));assert.equal(plan.previewHash,previewHash);
 const saved=await f.workspace.save('owner-assign',await f.input({...selection,previewHash}),randomUUID());assert.equal(saved.rows[0].ownerUsername,member.username);assert.equal(posts,2);
});

test('batch rejects email input and rechecks member availability after preview',async()=>{
 let posts=0,active=true;const hash='b'.repeat(64);
 const f=await fixture(async(url,init)=>{
  if(init.method==='GET')return Response.json({contract:'workspace-tools-v1',comments:[],orders:[],members:active?[member]:[]});
  posts++;return Response.json({readOnly:true,previewHash:hash,rows:[]});
 });
 const selection={orders:[{id:'synthetic-order',version:1}]};
 for(const owner of [{email:member.email},{username:member.email},{username:'missing'}]){
  await assert.rejects(f.workspace.preview('owner',await f.input({...selection,...owner})),{code:'INVALID_INPUT'});
  await assert.rejects(f.workspace.save('owner-assign',await f.input({...selection,...owner,previewHash:hash}),randomUUID()),{code:'INVALID_INPUT'});
 }
 assert.equal(posts,0);
 await f.workspace.preview('owner',await f.input({...selection,username:'test_owner'}));active=false;
 await assert.rejects(f.workspace.save('owner-assign',await f.input({...selection,username:'test_owner',previewHash:hash}),randomUUID()),{code:'INVALID_INPUT'});assert.equal(posts,1);
});
