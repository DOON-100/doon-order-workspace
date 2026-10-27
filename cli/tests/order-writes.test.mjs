import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {OrderWriteService} from '../dist/order-write.js';
import {store,session} from './helpers.mjs';

test('factory writes and imports refuse an old server before any mutation',async()=>{
 const state=await store();await state.setup('https://employee.test');await state.saveSession(session('https://employee.test'));
 const file=path.join(state.directory,'synthetic.json');await fs.writeFile(file,JSON.stringify({lineId:'o1'}));const requests=[];
 const service=new OrderWriteService(state,async(url,init)=>{requests.push({url,method:init.method});assert.equal(init.method,'GET');return Response.json(url.endsWith('/data')?{orders:[{id:'o1',version:1,customer:'C1'}]}:{items:[]});});
 await assert.rejects(service.saveFactory('draft',file,'0','1',randomUUID()),{code:'UNSUPPORTED_SERVER'});
 await assert.rejects(service.tableCommit(file),{code:'UNSUPPORTED_SERVER'});
 await assert.rejects(service.tablePreview(file,'nonexistent.xlsx'),{code:'UNSUPPORTED_SERVER'});
 assert.equal(requests.filter(row=>row.method==='POST').length,0);
});

test('factory transport loss does not retry or claim the order was saved',async()=>{
 const state=await store();await state.setup('https://employee.test');await state.saveSession(session('https://employee.test'));
 const file=path.join(state.directory,'synthetic.json');await fs.writeFile(file,JSON.stringify({lineId:'o1',sourceEnglish:'Synthetic'}));let writes=0;
 const service=new OrderWriteService(state,async(url,init)=>{if(init.method==='POST'){writes++;throw Error('Synthetic lost response');}return Response.json(url.endsWith('/data')?{orders:[{id:'o1',version:1,customer:'C1'}]}:{items:[],writeContract:'factory-order-version-token-v1'});});
 await assert.rejects(service.saveFactory('draft',file,'0','1',randomUUID()),error=>error.code==='CONNECTION_FAILED'&&error.details.outcomeUnknown===true&&error.details.retryable===false);assert.equal(writes,1);
});
