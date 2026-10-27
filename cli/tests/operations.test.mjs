import test from 'node:test';
import assert from 'node:assert/strict';
import {OperationsService} from '../dist/operations.js';
import {store,session} from './helpers.mjs';

async function fixture(){
 const state=await store();await state.setup('https://employee.test',false);await state.saveSession(session('https://employee.test'));
 const processRecord={id:'q1',version:1,type:'iqc',customerId:'c1',orderId:'o1',status:'待核实',details:{inspectedQuantity:null,acceptedQuantity:0,rejectedQuantity:0,private:'SECRET'}};
 const ship={id:'s1',version:1,type:'shipment',customerId:'c1',orderId:'o1',status:'open',details:{quantity:2,shipDate:'',trackingNo:'T1'}};
 const data={data:{reports:[{id:'r1',lineId:'o1',quantity:0}]},'finished-supplier-data':{tasks:[{id:'f1',lineId:'o1',baselineStatus:'pending',stocked:null,inTransit:null,stages:[{id:'packing',baseline:null,completed:0}]}],shipments:[{id:'x1',taskId:'f1',quantity:2,received:0,stocked:0,status:'在途'}],reworks:[],events:[{id:'e1',taskId:'f1',action:'创建',data:{secret:'SECRET'}}]},'process-data':{records:[processRecord]},'process-history':{history:[{id:'h1',recordId:'q1',version:1,snapshot:structuredClone(processRecord)}]},'service-data':{records:[ship,{...ship,id:'private',type:'receivable',details:{bank:'SECRET'}}]},'service-history':{history:[{id:'sh1',recordId:'s1',version:1,snapshot:structuredClone(ship)}]}};
 const calls=[];const transport=async(url,init)=>{const u=new URL(url),action=u.pathname.split('/').at(-1);calls.push({u,init});assert.equal(init.method,'GET');const body=structuredClone(data[action]);if(init.headers['X-Workspace-Team']&&['data','finished-supplier-data','service-data','process-data'].includes(action))body.businessTeamScope={teamId:init.headers['X-Workspace-Team']};return Response.json(body);};
 return {state,data,calls,service:new OperationsService(state,transport)};
}
test('finished tasks distinguish pending baseline, in-transit, receipt, inspection and stock',async()=>{
 const f=await fixture(),task=await f.service.execute('finished','show',{team:'t1'},'f1');assert.equal(task.record.stocked,null);assert.equal(task.record.inTransit,null);assert.equal(task.stages.rows[0].baseline,null);assert.equal(task.stages.rows[0].completed,0);assert.equal(task.shipments.rows[0].status,'在途');assert.equal(task.shipments.rows[0].received,0);assert(!JSON.stringify(await f.service.execute('finished','history',{},'f1')).includes('SECRET'));
});
test('quality requires exact type and history remains bound to customer, order, record and version',async()=>{
 const f=await fixture(),q=await f.service.execute('quality','show',{type:'iqc',team:'t1'},'q1');assert.equal(q.record.details.inspectedQuantity,null);assert.equal(q.record.details.acceptedQuantity,0);assert(!JSON.stringify(q).includes('SECRET'));assert.equal((await f.service.execute('quality','history',{type:'iqc'},'q1')).page.total,1);
 f.data['process-history'].history[0].snapshot.orderId='o2';await assert.rejects(f.service.execute('quality','history',{type:'iqc'},'q1'),{code:'INVALID_RESPONSE'});await assert.rejects(f.service.execute('quality','list',{type:'rfq'}),{code:'INVALID_ARGUMENT'});
});
test('actual customer shipment is limited to shipment records and does not imply shipment from packaging',async()=>{
 const f=await fixture(),s=await f.service.execute('shipments','show',{},'s1');assert.equal(s.record.status,'open');assert.equal(s.record.details.shipDate,'');assert.equal((await f.service.execute('shipments','list')).page.total,1);await assert.rejects(f.service.execute('shipments','show',{},'private'),{code:'NOT_IN_SCOPE'});
 await assert.rejects(new OperationsService(f.state,async()=>Response.json({records:[]})).execute('packaging','list',{team:'t1'}),{code:'SCOPE_NOT_CONFIRMED'});
 for(const r of ['reports','finished','quality','packaging','releases','shipments'])await assert.rejects(f.service.execute(r,'save',{},'id'),{code:'UNSUPPORTED_OPERATION'});
});
