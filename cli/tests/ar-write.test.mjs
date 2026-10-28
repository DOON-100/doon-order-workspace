import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {Command} from 'commander';
import {ArWriteService} from '../dist/ar-write.js';
import {registerArWrites} from '../dist/ar-write-program.js';
import {store,session} from './helpers.mjs';

// Synthetic DTOs follow arWorkspaceData's public accounting contract.
// 测试环境，不含正式业务数据。
async function fixture(body={}) {
 const state=await store();await state.setup('https://employee.test');await state.saveSession(session('https://employee.test'));
 const calls=[],service=new ArWriteService(state,async(url,init)=>{const request=new URL(url);calls.push({request,init});assert.equal(init.method,'GET');return Response.json(request.pathname.endsWith('ar-cli-contract')?{contract:'ar-cli-v1'}:body);});
 return {state,calls,service};
}
test('AR public output retains exact balance totals, period contributions and due-date plans without private fields',async()=>{
 const totals={USD:{receivableCents:10000,receivedCents:2500,balanceCents:7500,overdueCents:7500,settledCount:0,openCount:1,pendingCount:1}};
 const contribution={currency:'USD',receiptsCents:2500,refundsCents:3000,netCashCents:-500,shipmentCents:0,cashEventCount:2,shipmentCount:0};
 const performance={periodType:'month',period:'2026-10',start:'2026-10-01',end:'2026-11-01',byCurrency:{USD:contribution},byTeam:[{...contribution,teamId:'t1',teamName:'Synthetic team'}],byCustomer:[{...contribution,customerId:'c1',customer:'Synthetic customer',customerCode:'SYN'}]};
 const row={id:'r1',currency:'USD',amountCents:10000,receivedCents:2500,balanceCents:7500,dueDate:'2026-10-01',overdueCents:7500,pendingDueCents:0,prepayCents:0,plan:[{id:'due1',title:'Synthetic payment',amountCents:10000,dueDate:'2026-10-01',beforeOrder:false,trigger:'fixed',offsetDays:0,index:0,receivedCents:2500,balanceCents:7500}]};
 const f=await fixture({receivables:[{...row,account:'PRIVATE_ACCOUNT',source:{password:'PRIVATE_PASSWORD'}},{id:'unknown',amountCents:null,balanceCents:null}],totalsByCurrency:totals,performance:{...performance,privateAccount:'PRIVATE_ACCOUNT'},scope:{allowed:true},dataQuality:{pendingCount:1,undatedCashCount:0,unvaluedShipmentCount:2},filter:{customerId:'c1',teamId:'t1',currency:'USD'},generatedAt:'2026-10-28T00:00:00Z'});
 const listed=await f.service.list('workspace'),references=await f.service.references('workspace');
 assert.deepEqual(listed.totals,totals);assert.deepEqual(listed.page.rows[0],row);assert.equal(listed.page.rows[1].amountCents,null);
 assert.deepEqual(references.data.performance,performance);assert.deepEqual(references.data.dataQuality,{pendingCount:1,undatedCashCount:0,unvaluedShipmentCount:2});
 assert.deepEqual(references.data.filter,{customerId:'c1',teamId:'t1',currency:'USD'});assert(!JSON.stringify({listed,references}).includes('PRIVATE_'));
});

test('AR resources reject unsupported filters before any network request, including document-only and export queries',async()=>{
 const f=await fixture();
 for(const [resource,options]of [['workspace',{invoiceId:'i1'}],['documents',{currency:'USD'}],['documents',{period:'2026-10'}],['bindings',{customerId:'c1'}],['invoices',{currency:'USD'}],['invoices',{teamId:'t1'}],['imports',{periodType:'month'}],['statements',{invoiceId:'i1'}],['files',{id:'file1'}],['profiles',{teamId:'t1'}],['master',{currency:'USD'}]]){
  for(const run of [()=>f.service.list(resource,options),()=>f.service.references(resource,options),()=>f.service.form(resource,'record1',options)])await assert.rejects(run(),e=>e.code==='INVALID_ARGUMENT'&&e.message.includes(resource));
 }
 for(const [resource,options]of [['workspace',{invoiceId:'i1'}],['master',{currency:'USD'}],['master',{period:'2026-10'}]])await assert.rejects(f.service.export(resource,path.join(f.state.directory,'unused.csv'),options),{code:'INVALID_ARGUMENT'});
 assert.equal(f.calls.length,0);
});

test('AR forwards every supported resource filter while keeping pagination local',async()=>{
 const f=await fixture({receivables:[],documents:[],bindings:[],invoices:[],batches:[],statements:[],attachments:[],profiles:[],rows:[]});
 const cases=[['workspace',{customerId:'c1',teamId:'t1',currency:'USD',periodType:'month',period:'2026-10'}],['documents',{customerId:'c1',teamId:'t1'}],['bindings',{}],['invoices',{customerId:'c1'}],['imports',{customerId:'c1'}],['statements',{customerId:'c1'}],['files',{customerId:'c1'}],['profiles',{customerId:'c1',invoiceId:'i1'}],['master',{customerId:'c1',teamId:'t1',id:'master1'}]];
 for(const [resource,options]of cases){await f.service.list(resource,{...options,limit:'10',offset:'0'});assert.deepEqual(Object.fromEntries(f.calls.at(-1).request.searchParams),options);await f.service.references(resource,options);assert.deepEqual(Object.fromEntries(f.calls.at(-1).request.searchParams),options);}
});

test('AR Commander maps explicit filters without discarding unsupported flags or forwarding command metadata',async()=>{
 const f=await fixture({receivables:[]});let result;
 const program=()=>{const p=new Command();p.exitOverride();p.command('finance');registerArWrites(p,()=>({arWrite:()=>f.service}),(_name,data)=>{result=data;});return p;};
 await program().parseAsync(['node','doon','finance','ar','list','--resource','workspace','--customer','c1','--team','t1','--currency','USD','--period-type','month','--period','2026-10','--limit','10']);
 assert.equal(result.page.total,0);assert.deepEqual(Object.fromEntries(f.calls.at(-1).request.searchParams),{customerId:'c1',teamId:'t1',currency:'USD',periodType:'month',period:'2026-10'});
 const before=f.calls.length;
 await assert.rejects(program().parseAsync(['node','doon','finance','ar','list','--resource','invoices','--currency','USD']),e=>e.code==='INVALID_ARGUMENT'&&e.message.includes('--currency'));
 assert.equal(f.calls.length,before);
});
