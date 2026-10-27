import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {StateStore} from '../dist/state.js';
import {ProjectChildWriteService,ProjectTaskWriteService} from '../dist/project-child-write.js';
import {testCodec,session} from './helpers.mjs';

test('communication does not claim success when the requested follow-up task is missing',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'doon-w1-child-'));
 try{
  const state=new StateStore(path.join(dir,'state'),testCodec());await state.setup('https://employee.test',false);await state.saveSession(session('https://employee.test'));
  const file=path.join(dir,'input.json'),input={projectId:'p1',occurredAt:'2026-10-20',content:'Synthetic',nextAction:'Next'};
  await fs.writeFile(file,JSON.stringify(input));let posts=0;
  const service=new ProjectChildWriteService(state,async(_url,init)=>{
   if(init.method==='POST'){posts++;return Response.json({ok:true,item:{id:'c1',projectId:'p1',customerId:'customer1'}});}
   return Response.json({projects:[{id:'p1',customerId:'customer1'}],communications:[{id:'c1',version:1,customerId:'customer1',...input}],tasks:[]});
  });
  await assert.rejects(service.execute('communication-add',file,'11111111-1111-4111-8111-111111111111'),e=>e.code==='READBACK_FAILED'&&e.details.outcomeUnknown===true);
  assert.equal(posts,1);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('task review requires a matching version and review event on readback',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'doon-w1-task-'));
 try{
  const state=new StateStore(path.join(dir,'state'),testCodec());await state.setup('https://employee.test',false);await state.saveSession(session('https://employee.test'));
  const file=path.join(dir,'input.json'),input={projectId:'p1',id:'task1',stage:'service',decision:'approve',comment:'Looks good'};await fs.writeFile(file,JSON.stringify(input));let posts=0;
  const service=new ProjectTaskWriteService(state,async(_url,init)=>{if(init.method==='POST'){posts++;return Response.json({ok:true,item:{id:'task1',projectId:'p1',customerId:'c1'}});}return Response.json({projects:[{id:'p1',customerId:'c1'}],tasks:[{id:'task1',projectId:'p1',customerId:'c1',version:2,status:'sales_review',reviewHistory:[{action:'approve',stage:'service',comment:'different'}]}]});});
  await assert.rejects(service.execute('review',file,'1','44444444-4444-4444-8444-444444444444'),{code:'READBACK_FAILED'});assert.equal(posts,1);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
