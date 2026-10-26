import test from 'node:test';
import assert from 'node:assert/strict';
import {EngineeringService} from '../dist/engineering.js';
import {store,session} from './helpers.mjs';

async function fixture(){
  const state=await store();await state.setup('https://employee.test',false);await state.saveSession(session('https://employee.test'));
  const drawing={id:'d1',customerId:'c1',version:2,modelNo:'MODEL',newCount:0,revisionCount:null,canManage:true,canApprove:false,source:{rawColumns:{secret:'SOURCE-SECRET'}}};
  const sop={id:'s1',customerId:'c1',drawingRecordId:'d1',version:2,targetVersion:'V2',canInstruct:true,canApprove:false};
  const sample={id:'smp1',customerId:'c1',projectId:'p1',version:1,scope:[{itemId:'i1',quantity:0}],paymentSnapshot:{secret:'PAYMENT-SECRET'}};
  const quote={id:'ie1',customerAccountId:'c1',version:2,revision:1,quoteNo:'IE',exchangeRateCnyPerUsd:null,status:'draft',lines:[{id:'l1',model:'M',quantityMin:null,quantityMax:10,materials:[{id:'m1',basePrice:0,usage:null,notApplicable:false,priceSource:'TBD'}],processes:[],outsourcing:[]}],tooling:[],costs:{formulaVersion:'v1',lines:[{lineId:'l1',productionCost:null,factoryPriceCny:0}],toolingChargeCny:0},history:[{version:1,revision:1,status:'draft'}]};
  const data={'drawing-data':{records:[drawing]},'drawing-history':{history:[{id:'dh',recordId:'d1',version:1,snapshot:{...drawing,version:1}}]},'sop-data':{records:[sop]},'sop-history':{history:[{id:'sh',sopId:'s1',version:1,snapshot:{...sop,version:1}}]},'customer-project-data':{samples:[sample]},'ie-quotes':{quotes:[quote]},'ie-quote':{quote:{...quote,version:1}}};
  const calls=[];const transport=async(url,init)=>{const action=new URL(url).pathname.split('/').at(-1);calls.push({action,init});assert.equal(init.method,'GET');const body=structuredClone(data[action]);if(init.headers['X-Workspace-Team'])body.businessTeamScope={teamId:init.headers['X-Workspace-Team']};return Response.json(body);};
  return {state,data,calls,service:new EngineeringService(state,transport)};
}
test('drawing and SOP histories require current scoped list and suppress raw source snapshots',async()=>{
 const f=await fixture();const drawing=await f.service.execute('drawings','show',{team:'t1'},'d1');assert.equal(drawing.record.newCount,0);assert.equal(drawing.record.canApprove,false);assert.equal((await f.service.execute('sops','show',{},'s1')).record.canInstruct,true);assert.equal((await f.service.execute('sops','history',{},'s1')).page.total,1);assert(!JSON.stringify(await f.service.execute('drawings','history',{},'d1')).includes('SECRET'));
 f.data['drawing-history'].history[0].snapshot.customerId='c2';await assert.rejects(f.service.execute('drawings','history',{team:'t1'},'d1'),{code:'INVALID_RESPONSE'});await assert.rejects(f.service.execute('drawings','show',{customer:'c2'},'d1'),{code:'NOT_IN_SCOPE'});
});
test('samples keep quantity and explicit project association without private payment snapshots',async()=>{
 const f=await fixture();const result=await f.service.execute('samples','show',{project:'p1'},'smp1');assert.equal(result.items.rows[0].quantity,0);assert(!JSON.stringify(result).includes('SECRET'));await assert.rejects(f.service.execute('samples','show',{project:'p2'},'smp1'),{code:'NOT_IN_SCOPE'});
});
test('IE quote costs preserve zero and unknowns, current and historical bindings, and reject unsupported team filtering',async()=>{
 const f=await fixture();const result=await f.service.execute('ie-quotes','show',{},'ie1');assert.equal(result.lines.rows[0].materials[0].basePrice,0);assert.equal(result.lines.rows[0].materials[0].usage,null);assert.equal(result.costs.lines.rows[0].productionCost,null);assert.equal(result.costs.lines.rows[0].factoryPriceCny,0);
 assert.equal((await f.service.execute('ie-quotes','version',{},'ie1','1')).record.version,1);assert.equal((await f.service.execute('ie-quotes','history',{},'ie1')).page.total,1);
 f.data['ie-quote'].quote.customerAccountId='c2';await assert.rejects(f.service.execute('ie-quotes','version',{},'ie1','1'),{code:'INVALID_RESPONSE'});
 const before=f.calls.length;await assert.rejects(f.service.execute('ie-quotes','list',{team:'t1'}),{code:'INVALID_ARGUMENT'});assert.equal(f.calls.length,before);
});
test('unconfirmed team and unsupported writes fail closed',async()=>{
 const f=await fixture();await assert.rejects(new EngineeringService(f.state,async()=>Response.json({records:[]})).execute('drawings','list',{team:'t1'}),{code:'SCOPE_NOT_CONFIRMED'});
 for(const r of ['drawings','sops','samples','ie-quotes'])await assert.rejects(f.service.execute(r,'approve',{},'id'),{code:'UNSUPPORTED_OPERATION'});
});
