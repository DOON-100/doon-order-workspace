import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {StateStore} from '../dist/state.js';
import {SalesWriteService} from '../dist/sales-write.js';
import {testCodec,session} from './helpers.mjs';

test('write readback mismatch or network loss never claims success or retries',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'doon-w1-test-'));
 try{
  const state=new StateStore(path.join(dir,'state'),testCodec());await state.setup('https://employee.test',false);await state.saveSession(session('https://employee.test'));
  const file=path.join(dir,'input.json');await fs.writeFile(file,JSON.stringify({customerId:'c1',patch:{legalName:'Synthetic'}}));
  let posts=0;
  const mismatch=new SalesWriteService(state,async(url,init)=>{
   if(init.method==='POST'){posts++;return Response.json({ok:true,customerId:'c1'});}
   return Response.json({customer:{id:'c1'},profile:{version:2,fields:{legalName:'Different'}}});
  });
  const token='11111111-1111-4111-8111-111111111111';
  await assert.rejects(mismatch.execute('profile-update',file,'1',token),e=>e.code==='READBACK_FAILED'&&e.details.outcomeUnknown===true);assert.equal(posts,1);
  const lost=new SalesWriteService(state,async()=>{posts++;throw Error('network');});
  await assert.rejects(lost.execute('profile-update',file,'1',token),e=>e.code==='CONNECTION_FAILED'&&e.details.outcomeUnknown===true&&e.details.retryable!==true);assert.equal(posts,2);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});


test('create readback compares supplied project and inquiry fields',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'doon-w1-readback-'));
 try{
  const state=new StateStore(path.join(dir,'state'),testCodec());await state.setup('https://employee.test',false);await state.saveSession(session('https://employee.test'));
  const file=path.join(dir,'input.json'),token='22222222-2222-4222-8222-222222222222';
  for(const [action,input,readback] of [
   ['project-create',{customerId:'c1',title:'P',description:'wanted'},{projects:[{id:'p1',customerId:'c1',title:'P',version:1,description:'changed'}]}],
   ['inquiry-create',{customerId:'c1',title:'I',details:{quantity:3}},{records:[{id:'r1',customerId:'c1',title:'I',version:1,type:'rfq',details:{quantity:4}}]}]
  ]){
   await fs.writeFile(file,JSON.stringify(input));
   const service=new SalesWriteService(state,async(_url,init)=>init.method==='POST'?Response.json({ok:true,...(action==='project-create'?{item:{id:'p1',customerId:'c1'}}:{record:{id:'r1',customerId:'c1'}})}):Response.json(readback));
   await assert.rejects(service.execute(action,file,'',token),e=>e.code==='READBACK_FAILED'&&e.details.outcomeUnknown===true);
  }
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('followup creation checks nested identifiers before writing and verifies the saved checklist',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'doon-w1-followup-'));
 try{
  const state=new StateStore(path.join(dir,'state'),testCodec());await state.setup('https://employee.test',false);await state.saveSession(session('https://employee.test'));
  const file=path.join(dir,'input.json'),token='33333333-3333-4333-8333-333333333333';let posts=0;
  const input={ownerId:'a',title:'Followup',checklist:[{id:'  item',text:'Check',checked:false}]};await fs.writeFile(file,JSON.stringify(input));
  const service=new SalesWriteService(state,async(_url,init)=>{if(init.method==='POST'){posts++;return Response.json({ok:true,item:{id:'f1',ownerId:'a'}});}return Response.json({followups:[{id:'f1',ownerId:'a',title:'Followup',version:1,checklist:[{id:'item',text:'Changed',checked:false}]}]});});
  await assert.rejects(service.execute('followup-create',file,'',token),{code:'INVALID_INPUT'});assert.equal(posts,0);
  input.checklist[0].id='item';await fs.writeFile(file,JSON.stringify(input));
  await assert.rejects(service.execute('followup-create',file,'',token),{code:'READBACK_FAILED'});assert.equal(posts,1);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
