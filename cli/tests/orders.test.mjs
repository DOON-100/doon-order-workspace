import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {OrderService} from '../dist/orders.js';
import {ApiClient} from '../dist/client.js';
import {serverConfig} from '../dist/state.js';
import {store,session,temporary} from './helpers.mjs';

const document=(id,type='pi',kind='handoff_business_document')=>({id,kind,type,version:2,number:'DOC-'+id,customerId:'c1',orderId:'o1',projectId:'',status:'draft',sourceChanged:true,changedSourceIds:['po1'],fields:{currency:'EUR',paymentTerms:'TBD',depositPercent:'',courierAccount:'COURIER-SECRET',path:'PATH-SECRET',requirements:'核对'},sourceRefs:[{id:'po1',version:1}],originRefs:[{id:'o1',kind:'order',version:1}],sourceSnapshots:[{secret:'SNAPSHOT-SECRET'}],lines:[{orderLineId:'o1',description:'Synthetic',quantity:0,unitPrice:''}]});
async function fixture(){
  const state=await store();await state.setup('https://employee.test',false);await state.saveSession(session('https://employee.test'));
  const pi=document('pi1'),prod=document('prod1','production_order','handoff_business_source');
  const data={
    data:{orders:[{id:'o1',customer:'CODE-A',orderNo:'SO1',quantity:0,lifecycle:'archived',closedDate:'2026-10-01',ledger:{password:'LEDGER-SECRET'}},{id:'o2',customer:'CODE-B',orderNo:'SO2'}],comments:[{id:'c',lineId:'o1',text:'Follow up'},{id:'bad',lineId:'o2',text:'WRONG-ORDER'}],attachments:[{id:'att',lineId:'o1',filename:'original.txt',fileKey:'KEY-SECRET'}],audits:[{id:'audit',before:{secret:'AUDIT-SECRET'}}]},
    'sales-order-sources-data':{items:[{id:'s1',customer:'CODE-A',orderNo:'SO1',source:{orderNo:'SO1',source:{filename:'synthetic.xlsx',sheet:'S',sha256:'a'.repeat(64),detailRange:'A1:C2'},warnings:['TBD'],lines:[{id:'l1',sourceRow:2,quantity:0,sampleQuantity:null,unitPrice:'',colorFields:[{sourceCell:'A2',value:null,status:'pending'}],rawFields:[{cell:'B2',value:'0',formula:'FORMULA-SECRET'}]}]}}]},
    'handoff-business-data':{items:[pi,document('i1','invoice'),prod,document('po1','po','handoff_business_source')]},
    'handoff-business-history':{history:[{id:'h',recordId:'pi1',customerId:'c1',version:1,action:'保存',snapshot:{...pi,version:1,status:'checked'}}]},
  },calls=[];
  const transport=async(raw,init)=>{
    const url=new URL(raw),action=url.pathname.split('/').at(-1);calls.push({url,init});assert.equal(init.method,'GET');
    if(action==='sales-order-sources-export')return new Response(Buffer.from('504b0304010203','hex'),{headers:{'content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}});
    const body=structuredClone(data[action]);if(init.headers['X-Workspace-Team'])body.businessTeamScope={teamId:init.headers['X-Workspace-Team']};
    return Response.json(body,{headers:{Vary:'X-Workspace-Team'}});
  };
  return {state,data,calls,service:new OrderService(state,transport)};
}
test('orders match exact raw customer identity and never expose truncated audits or unrelated comments',async()=>{
  const f=await fixture(),list=await f.service.execute('orders','list',{customerCode:'CODE-A',team:'t1',limit:'1'});assert.equal(list.page.total,1);assert.equal(list.page.rows[0].quantity,0);assert.equal(list.scope.customerCode,'CODE-A');
  const detail=await f.service.execute('orders','show',{},'o1');assert.equal(detail.record.lifecycle,'archived');assert.equal(detail.record.closedDate,'2026-10-01');assert.equal(detail.comments.total,1);assert.equal(detail.attachments.rows[0].filename,'original.txt');assert(!JSON.stringify(detail).includes('SECRET'));assert(!JSON.stringify(detail).includes('WRONG-ORDER'));assert.match(detail.historyAvailability,/truncated/);
  await assert.rejects(f.service.execute('orders','show',{customerCode:'CODE-B'},'o1'),{code:'NOT_IN_SCOPE'});
});
test('source evidence preserves zero/null/unknown values and locations while omitting raw formulas',async()=>{
  const f=await fixture(),detail=await f.service.execute('sources','show',{team:'t1'},'s1');assert.equal(detail.lines.rows[0].quantity,0);assert.equal(detail.lines.rows[0].sampleQuantity,null);assert.equal(detail.lines.rows[0].unitPrice,'');assert.equal(detail.lines.rows[0].colorFields[0].value,null);assert.equal(detail.lines.rows[0].rawFields[0].cell,'B2');assert(!JSON.stringify(detail).includes('FORMULA-SECRET'));
  assert.equal((await f.service.execute('sources','list',{customerCode:'wrong'})).page.total,0);
});
test('source export resolves ID within selected list and refuses old destination before requests',async()=>{
  const f=await fixture(),dir=await temporary(),output=path.join(dir,'source.xlsx');
  const result=await f.service.execute('sources','export',{team:'t1',output},'s1');assert.equal(result.file.bytes,7);assert.equal(f.calls.at(-1).url.searchParams.get('id'),'s1');
  const count=f.calls.length;await assert.rejects(f.service.execute('sources','export',{output},'s1'),{code:'OUTPUT_EXISTS'});assert.equal(f.calls.length,count);assert.equal((await fs.readFile(output)).length,7);
  await assert.rejects(f.service.execute('sources','export',{output:path.join(dir,'missing.xlsx')},'not-visible'),{code:'NOT_IN_SCOPE'});
});
test('PI/documents are type filtered and show stale-source and unknown-price flags without private snapshots',async()=>{
  const f=await fixture();assert.equal((await f.service.execute('pi','list')).page.total,1);assert.equal((await f.service.execute('documents','list',{type:'invoice'})).page.rows[0].id,'i1');
  const detail=await f.service.execute('pi','show',{customer:'c1',order:'o1'},'pi1');assert.equal(detail.record.sourceChanged,true);assert.equal(detail.lines.rows[0].unitPrice,'');assert(!JSON.stringify(detail).includes('SECRET'));
  await assert.rejects(f.service.execute('pi','show',{},'i1'),{code:'NOT_IN_SCOPE'});await assert.rejects(f.service.execute('pi','show',{order:'o2'},'pi1'),{code:'NOT_IN_SCOPE'});
  assert.equal((await f.service.execute('production-orders','show',{},'prod1')).record.type,'production_order');
});
test('document history and versions guard current scope, kind and immutable customer/order/project bindings',async()=>{
  const f=await fixture();assert.equal((await f.service.execute('pi','history',{},'pi1')).page.rows[0].status,'checked');const old=await f.service.execute('pi','version',{},'pi1','1');assert.equal(old.record.version,1);assert(old.historical);assert(!JSON.stringify(old).includes('SECRET'));
  assert.equal((await f.service.execute('pi','version',{},'pi1','2')).historical,false);
  await assert.rejects(f.service.execute('pi','version',{},'pi1','9'),{code:'NOT_FOUND'});
  for(const change of [{customerId:'c2'},{orderId:'o2'},{projectId:'p2'},{type:'invoice'},{kind:'handoff_business_source'},{version:99}]){
    const original=structuredClone(f.data['handoff-business-history'].history[0].snapshot);Object.assign(f.data['handoff-business-history'].history[0].snapshot,change);await assert.rejects(f.service.execute('pi','history',{},'pi1'),{code:'INVALID_RESPONSE'});f.data['handoff-business-history'].history[0].snapshot=original;
  }
});
test('unconfirmed list scope and source Vary contracts fail closed; revoked account clears session',async()=>{
  const f=await fixture();for(const resource of ['orders','sources','pi'])await assert.rejects(new OrderService(f.state,async()=>Response.json({orders:[],items:[]})).execute(resource,'list',{team:'t1'}),{code:'SCOPE_NOT_CONFIRMED'});
  await assert.rejects(new OrderService(f.state,async()=>Response.json({},{status:401})).execute('pi','list'),{code:'AUTH_REQUIRED'});assert.equal(await f.state.hasSession(),false);
});
test('unsupported business writes, invalid filters and ambiguous order customer IDs never contact server',async()=>{
  const f=await fixture();for(const [resource,action,opts,id,version] of [['orders','history',{}],['pi','save',{}],['documents','list',{type:'engineering_quote'}],['orders','list',{customer:'c1'}],['pi','list',{customerCode:'CODE-A'}],['sources','export',{output:'a.xlsx',limit:'20'},'s1'],['pi','version',{},'pi1','0']])await assert.rejects(f.service.execute(resource,action,opts,id,version),error=>error.exitCode===2);assert.equal(f.calls.length,0);
  let requests=0;const api=new ApiClient(serverConfig('https://employee.test'),async()=>{requests++;assert.fail('No request expected');});for(const route of ['/api/workspace/experimental-order-write','/api/workspace/unregistered-ledger-write','/api/workspace/backup','/api/auth/reset','/api/agent-schedules/grant'])await assert.rejects(api.request(route,session('https://employee.test')),{code:'UNSUPPORTED_OPERATION'});for(const body of [undefined,[],"invalid-export-input"])await assert.rejects(api.request('/api/workspace/export',session('https://employee.test'),body),{code:'INVALID_INPUT'});assert.equal(requests,0);await assert.rejects(api.request('/api/workspace/ledger-edit',session('https://employee.test')),{code:'INVALID_INPUT'});
});
