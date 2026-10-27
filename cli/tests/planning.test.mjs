import test from 'node:test';
import assert from 'node:assert/strict';
import {PlanningService} from '../dist/planning.js';
import {store,session} from './helpers.mjs';

async function fixture(){
 const state=await store();await state.setup('https://employee.test',false);await state.saveSession(session('https://employee.test'));
 const data={'pmc-data':{rounds:[{id:'r1',productionScope:'internal',lineIds:['o1']}],reviews:[{id:'v1',roundId:'r1',lineId:'o1',status:'pending'}]},'purchase-data':{rows:[{id:'p1',customerOrder:'SO1',supplier:'S',quantity:10,balanceKnown:false,received:0,returnPending:0,raw:{secret:'PRIVATE'}},{id:'p2',customerOrder:'SO2',balanceKnown:true,received:0,returnPending:0}]},'purchase-history':{events:[{id:'e1',purchaseId:'p1',type:'receipt',quantity:0,token:'PRIVATE'}],edits:[{id:'a1',action:'更新',before:{secret:'PRIVATE'}}]},data:{outsource:[{id:'x1',lineId:'o1',quantity:10}]},'factory-orders':{items:[{id:'f1',lineId:'o1',version:1,status:'待客服确认'}]}};
 const calls=[];const transport=async(url,init)=>{const u=new URL(url),action=u.pathname.split('/').at(-1);calls.push({url:u,init});assert.equal(init.method,'GET');const body=structuredClone(data[action]);if(init.headers['X-Workspace-Team']&&action!=='purchase-history')body.businessTeamScope={teamId:init.headers['X-Workspace-Team']};return Response.json(body);};
 return {state,data,calls,service:new PlanningService(state,transport)};
}
test('purchase quantities distinguish unverified balances from verified zero and omit imported raw data',async()=>{
 const f=await fixture(),one=await f.service.execute('purchases','show',{team:'t1'},'p1'),two=await f.service.execute('purchases','show',{},'p2');assert.equal(one.record.received,null);assert.equal(one.record.returnPending,null);assert.equal(two.record.received,0);assert(!JSON.stringify(one).includes('PRIVATE'));
 const history=await f.service.execute('purchases','history',{team:'t1'},'p1');assert.equal(history.events.rows[0].quantity,0);assert.equal(history.editsLimit,'server-last-50');assert(!JSON.stringify(history).includes('PRIVATE'));
 f.data['purchase-history'].events[0].purchaseId='p2';await assert.rejects(f.service.execute('purchases','history',{},'p1'),{code:'INVALID_RESPONSE'});
});
test('PMC scope is explicit, team must be confirmed, and reviews stay in their selected round',async()=>{
 const f=await fixture();const result=await f.service.execute('rounds','show',{team:'t1',scope:'internal'},'r1');assert.equal(result.reviews.rows[0].status,'pending');assert.equal(f.calls[0].url.searchParams.get('scope'),'internal');await assert.rejects(f.service.execute('rounds','list',{scope:'all'}),{code:'INVALID_ARGUMENT'});
 await assert.rejects(new PlanningService(f.state,async()=>Response.json({rounds:[]})).execute('rounds','list',{team:'t1'}),{code:'SCOPE_NOT_CONFIRMED'});
});
test('outsource and factory orders are filtered by exact order line and cannot be used for writes',async()=>{
 const f=await fixture();assert.equal((await f.service.execute('outsource','show',{order:'o1'},'x1')).record.quantity,10);await assert.rejects(f.service.execute('factory-orders','show',{order:'other'},'f1'),{code:'NOT_IN_SCOPE'});
 for(const resource of ['rounds','purchases','outsource','factory-orders'])await assert.rejects(f.service.execute(resource,'save',{},'x'),{code:'UNSUPPORTED_OPERATION'});
});
