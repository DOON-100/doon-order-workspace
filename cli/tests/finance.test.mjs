import test from 'node:test';
import assert from 'node:assert/strict';
import {FinanceService,financeKinds} from '../dist/finance.js';
import {store,session} from './helpers.mjs';

async function fixture(){
 const state=await store();await state.setup('https://employee.test',false);await state.saveSession(session('https://employee.test'));
 const record={id:'f1',kind:'project_charge',version:1,customerId:'c1',projectId:'p1',currency:'USD',amountCents:0,status:'draft',net:{amountCents:0,receivedCents:0,balanceCents:null},account:'BANK-SECRET',payer:'PAYER-SECRET'};
 const receivable={id:'r1',version:1,type:'receivable',customerId:'c1',orderId:'o1',status:'open',details:{invoiceNo:'I1',currency:'USD',amountCents:1000,account:'BANK-SECRET'},receivedCents:0,balanceCents:1000};
 const complaint={id:'c1',version:1,type:'complaint',customerId:'c1',orderId:'o1',details:{complaintRef:'C1',cause:'待核对'}};
 const data={'project-finance-data':Object.fromEntries(financeKinds.map(k=>[k,[record]])),'project-finance-history':{history:[{id:'h1',targetId:'f1',customerId:'c1',action:'创建',after:structuredClone(record)}]},'service-data':{records:[receivable,{...receivable,id:'s1',type:'shipment'}]},'service-history':{history:[{id:'sh1',recordId:'r1',version:1,snapshot:structuredClone(receivable)}]},'process-data':{records:[complaint]},'process-history':{history:[{id:'ph1',recordId:'c1',version:1,snapshot:structuredClone(complaint)}]}};
 const calls=[];const transport=async(url,init)=>{const u=new URL(url),action=u.pathname.split('/').at(-1);calls.push({u,init});assert.equal(init.method,'GET');const body=structuredClone(data[action]);if(init.headers['X-Workspace-Team']&&['project-finance-data','service-data','process-data'].includes(action))body.businessTeamScope={teamId:init.headers['X-Workspace-Team']};return Response.json(body);};return {state,data,calls,service:new FinanceService(state,transport)};
}
test('all project finance categories are explicit; amounts and draft state stay distinct without bank data',async()=>{
 const f=await fixture();for(const kind of financeKinds){const x=await f.service.execute('records','show',{kind,team:'t1'},'f1');assert.equal(x.record.amountCents,0);assert.equal(x.record.status,'draft');assert.equal(x.record.net.balanceCents,null);assert(!JSON.stringify(x).includes('SECRET'));}
 await assert.rejects(f.service.execute('records','list',{kind:'all'}),{code:'INVALID_ARGUMENT'});await assert.rejects(f.service.execute('records','show',{kind:'charges',project:'other'},'f1'),{code:'NOT_IN_SCOPE'});
});
test('finance history is constrained by current customer, kind and project; raw snapshots never output',async()=>{
 const f=await fixture();assert.equal((await f.service.execute('records','history',{kind:'charges',project:'p1'},'f1')).page.total,1);assert(!JSON.stringify(await f.service.execute('records','history',{kind:'charges'},'f1')).includes('SECRET'));
 f.data['project-finance-history'].history[0].after.customerId='c2';await assert.rejects(f.service.execute('records','history',{kind:'charges'},'f1'),{code:'INVALID_RESPONSE'});f.data['project-finance-history'].history[0].after.customerId='c1';f.data['project-finance-history'].history[0].after.projectId='p2';await assert.rejects(f.service.execute('records','history',{kind:'charges',team:'t1'},'f1'),{code:'INVALID_RESPONSE'});
});
test('receivables do not include shipment records; complaints and histories remain scoped',async()=>{
 const f=await fixture();const r=await f.service.execute('receivables','show',{},'r1');assert.equal(r.record.receivedCents,0);assert.equal(r.record.balanceCents,1000);assert(!JSON.stringify(r).includes('BANK-SECRET'));assert.equal((await f.service.execute('receivables','list')).page.total,1);await assert.rejects(f.service.execute('receivables','show',{},'s1'),{code:'NOT_IN_SCOPE'});
 assert.equal((await f.service.execute('complaints','history',{},'c1')).page.total,1);f.data['process-history'].history[0].snapshot.orderId='other';await assert.rejects(f.service.execute('complaints','history',{},'c1'),{code:'INVALID_RESPONSE'});
});
test('team echo and read-only method guard fail closed',async()=>{
 const f=await fixture();await assert.rejects(new FinanceService(f.state,async()=>Response.json({charges:[]})).execute('records','list',{kind:'charges',team:'t1'}),{code:'SCOPE_NOT_CONFIRMED'});for(const resource of ['records','receivables','reconciliations','complaints'])await assert.rejects(f.service.execute(resource,'save',{},'id'),{code:'UNSUPPORTED_OPERATION'});
});
