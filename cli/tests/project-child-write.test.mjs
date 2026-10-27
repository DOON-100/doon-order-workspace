import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {StateStore} from '../dist/state.js';
import {ProjectChildWriteService} from '../dist/project-child-write.js';
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
