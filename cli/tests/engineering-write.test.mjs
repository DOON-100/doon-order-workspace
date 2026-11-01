import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {EngineeringWriteService} from '../dist/engineering-write.js';import {store,session} from './helpers.mjs';
test('MES fact registration only posts to the authenticated application and reads back its record',async()=>{
 const state=await store();await state.setup('https://employee.test');await state.saveSession(session('https://employee.test'));const file=path.join(state.directory,'synthetic.json');await fs.writeFile(file,JSON.stringify({id:'s1',uploadedVersion:'V1',uploadedAt:'2026-10-20',mesReference:'Synthetic existing proof',mesUrl:'https://mes.example.invalid/existing-evidence',actualUploader:'Synthetic',proofFileId:'proof1'}));
 const record={id:'s1',version:4,customerId:'c1',drawingRecordId:'d1',modelNo:'Synthetic',targetVersion:'V1',status:'待确认',isCurrent:true,latestUploadId:'u1'},calls=[];
 const service=new EngineeringWriteService(state,async(url,options)=>{calls.push({url,method:options.method});assert.equal(new URL(url).origin,'https://employee.test');if(options.method==='POST'){assert(new URL(url).pathname.endsWith('/sop-mes-upload'));assert.equal(JSON.parse(options.body).version,3);return Response.json({ok:true,record});}return Response.json({records:[record]});});
 assert.equal((await service.sopAction('mes-upload',file,'3')).record.status,'待确认');assert.equal(calls.filter(row=>row.method==='POST').length,1);assert.equal(calls.length,2);
});
test('lost drawing mutation response reports uncertainty and is never retried',async()=>{
 const state=await store();await state.setup('https://employee.test');await state.saveSession(session('https://employee.test'));const file=path.join(state.directory,'synthetic.json');await fs.writeFile(file,JSON.stringify({id:'drawing1',requirement:'Synthetic change'}));let calls=0;const service=new EngineeringWriteService(state,async()=>{calls++;throw Error('Synthetic lost reply');});await assert.rejects(service.saveDrawing(file,'1','misleading-operation-token'),{code:'INVALID_ARGUMENT'});assert.equal(calls,0);await assert.rejects(service.saveDrawing(file,'1'),error=>error.code==='CONNECTION_FAILED'&&error.details.outcomeUnknown===true&&error.details.retryable===false);assert.equal(calls,1);
});

test('drawing table schema exposes partial creation, symbols and a separate boolean approval action',async()=>{
 const service=new EngineeringWriteService(await store()),schema=service.schema('drawing');
 assert.deepEqual(schema.fields.sheetStatus.enum,['⌛️','❗❗']);assert.equal(schema.fields.tableEntry.type,'boolean');
 assert.equal(schema.tableColumns.length,13);assert.equal(schema.tableColumns.at(-1).action,'approval-toggle');
 assert.equal(service.schema('drawing','approval-toggle').fields.checked.type,'boolean');
});

test('approval toggle preserves false, uses the dedicated route and checks readback',async()=>{
 const state=await store();await state.setup('https://employee.test');await state.saveSession(session('https://employee.test'));
 const file=path.join(state.directory,'toggle.json');await fs.writeFile(file,JSON.stringify({id:'d1',checked:false,sheetStatus:'❗❗'}));const posts=[];
 const record={id:'d1',version:3,approval:'待审核',sheetStatus:'❗❗',tableEntry:true};
 const service=new EngineeringWriteService(state,async(url,options)=>{if(options.method==='POST'){assert.equal(new URL(url).pathname,'/api/workspace/drawing-approval-toggle');posts.push(JSON.parse(options.body));return Response.json({ok:true,record});}return Response.json({records:[record],canToggleApproval:true});});
 const result=await service.drawingAction('approval-toggle',file,'2');assert.deepEqual(posts,[{id:'d1',checked:false,sheetStatus:'❗❗',version:2}]);assert.equal(result.record.displayStatus,'❗❗');assert.equal(result.record.tableEntry,true);assert.equal(result.capabilities.canToggleApproval,true);
 await fs.writeFile(file,JSON.stringify({id:'d1',checked:'false'}));await assert.rejects(service.drawingAction('approval-toggle',file,'3'),{code:'INVALID_INPUT'});assert.equal(posts.length,1);
});

test('old servers do not pretend to provide login account choices or checkbox permission',async()=>{
 const state=await store();await state.setup('https://employee.test');await state.saveSession(session('https://employee.test'));
 const row={id:'d1',version:1,source:{rawColumns:{状态:'❗❗',private:'not exposed'}}};
 const service=new EngineeringWriteService(state,async()=>Response.json({records:[row],members:[{id:'m1',name:'Display name'}]}));
 const refs=await service.references('drawing');assert.equal(refs.requestersAvailable,false);assert.deepEqual(refs.requesters,[]);assert.equal(refs.canToggleApproval,false);
 const result=await service.form('drawing','d1');assert.equal(result.record.displayStatus,'❗❗');assert.equal(result.record.sheetStatus,'❗❗');assert(!JSON.stringify(result).includes('not exposed'));
});
