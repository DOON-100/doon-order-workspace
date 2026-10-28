import test from 'node:test';
import assert from 'node:assert/strict';
import {ProductionWriteService} from '../dist/production-write.js';
import {store,session} from './helpers.mjs';

test('production history rejects older servers before returning historical business content',async()=>{
 const state=await store();await state.setup('https://employee.test');await state.saveSession(session('https://employee.test'));
 for(const type of ['ledger','report','correction']){
  const service=new ProductionWriteService(state,async()=>Response.json({contract:'production-workspace-v1',id:'record1',type,history:[{id:'history1',before:null,after:{id:'record1',lineId:'other-customer-order',quantity:73}}]}));
  await assert.rejects(service.history(type,'record1'),error=>error.code==='UNSUPPORTED_SERVER'&&!JSON.stringify(error).includes('other-customer-order'));
 }
});

test('production history accepts scoped snapshots and validates the requested resource type',async()=>{
 const state=await store();await state.setup('https://employee.test');await state.saveSession(session('https://employee.test'));
 const data={contract:'production-workspace-v1',historyScopeContract:'production-history-snapshot-scope-v1',id:'record1',type:'report',history:[{id:'history1',before:{id:'record1',lineId:'allowed-order',quantity:5},after:{id:'record1',lineId:'allowed-order',quantity:6}}]};
 const service=new ProductionWriteService(state,async()=>Response.json(data));
 const result=await service.history('report','record1');assert.equal(result.page.total,1);assert.equal(result.page.rows[0].before.quantity,5);assert.equal(result.page.rows[0].after.quantity,6);
 await assert.rejects(service.history('correction','record1'),{code:'INVALID_RESPONSE'});
});
