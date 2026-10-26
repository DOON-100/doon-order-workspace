import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {ApiClient} from '../dist/client.js';
import {SalesService} from '../dist/sales.js';
import {serverConfig} from '../dist/state.js';
import {store, session, temporary} from './helpers.mjs';

const quote = (id, customerAccountId) => ({id, version:2, customerAccountId, quoteNo:'Q-'+id, status:'draft', currency:'EUR', internalCosts:[{notes:'COST-SECRET'}], fileKey:'FILE-SECRET',
  lines:[{id:'line-'+id, quantity:null, unitPrice:0, toolingFee:null, model:'M', unit:'unknown', scopeReviewed:false, sourceFormula:'FORMULA-SECRET'}],
  terms:[{id:'term',labelZh:'数量',labelEn:'Quantity',zh:'待定',en:'TBD',needsReview:true,reviewNote:'REVIEW-SECRET'}], customerCharges:[{id:'charge',amount:null,needsReview:true}],
  history:[{id:'rev-'+id,version:1,status:'draft',action:'保存',snapshot:{secret:'HISTORY-SECRET'}}]});
async function fixture(overrides = {}) {
  const state = await store(); await state.setup('https://employee.test', false); await state.saveSession(session('https://employee.test'));
  const data = {
    'business-team-data':{customers:[{id:'c1',customer:'Alpha',customerCode:'A'},{id:'c2',customer:'Beta',customerCode:'B'}],teams:[{id:'t1',name:'One',active:true,customerIds:['c1']}]},
    'customer-workflow-data':{customers:['c1','c2'].map(id=>({id,profile:{version:1,fields:{stage:'报价'}},workflow:null,reminder:'待安排'}))},
    'customer-workflow-history':{events:[{id:'e1',action:'更新',actor:'Synthetic',before:{bank:'BANK-SECRET'}}]},
    'customer-project-data':{projects:[{id:'p1',customerId:'c1',teamId:'t1',title:'Alpha project',canWrite:true},{id:'p2',customerId:'c2',title:'Beta project'}],items:[{id:'i1',projectId:'p1',customerId:'c1',quantity:0,fileKey:'FILE-SECRET'},{id:'bad',projectId:'p1',customerId:'c2',model:'WRONG-CUSTOMER'}],rounds:[],tasks:[],communications:[]},
    'customer-project-history':{history:[{id:'h1',action:'更新',after:{password:'HISTORY-SECRET'}}]},
    'process-data':{records:[{id:'r1',type:'rfq',customerId:'c1',title:'Alpha RFQ',details:{quantity:null,requirement:'资料待核对',private:'DETAIL-SECRET'}},{id:'r2',type:'rfq',customerId:'c2',title:'Beta RFQ',details:{}}]},
    'process-history':{history:[{id:'rrev',recordId:'r1',version:1,requestToken:'TOKEN-SECRET',snapshot:{id:'r1',type:'rfq',customerId:'c1',details:{quantity:0}}}]},
    'customer-quotes':{quotes:[quote('q1','c1'),quote('q2','c2')]},
    'customer-quote-version':{quote:{...quote('q1','c1'),version:1}},
    ...overrides,
  };
  const calls=[];
  const transport = async (raw, init) => {
    const url=new URL(raw), action=url.pathname.split('/').at(-1); calls.push({url,init}); assert.equal(init.method,'GET');
    assert.match(init.headers.Cookie,/^doon_employee_session=/);
    if(action==='customer-quote-completed-export')return new Response(Buffer.from('504b0304010203','hex'),{headers:{'content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}});
    let result=structuredClone(data[action]);
    if(action==='customer-workflow-data'&&url.searchParams.has('customerId'))result={customer:{id:url.searchParams.get('customerId'),customer:'Alpha'},profile:{version:1,fields:{legalName:'Alpha',bankPaymentInfo:'BANK-SECRET',courierAccount:'COURIER-SECRET'}},workflow:null,capabilities:{read:true,readBank:true},followups:[]};
    const team=init.headers['X-Workspace-Team'];
    if(team){
      result.businessTeamScope={teamId:team};
      for(const key of ['customers','projects','records','quotes'])if(Array.isArray(result[key]))result[key]=result[key].filter(row=>(row.customerId||row.customerAccountId||row.id)==='c1');
    }
    return Response.json(result);
  };
  return {state,calls,data,service:new SalesService(state,transport),transport};
}

test('sales customer list/search/pagination joins safe names and shows exact scope',async()=>{
  const {service,calls}=await fixture();
  const result=await service.execute('customers','list',{limit:'1',offset:'1'});assert.equal(result.page.total,2);assert.equal(result.page.rows[0].id,'c2');assert.equal(result.page.nextOffset,null);assert.equal(result.scope.pagination,'client');
  const searched=await service.execute('customers','list',{search:'alpha'});assert.equal(searched.page.total,1);
  const team=await service.execute('customers','list',{team:'t1'});assert.deepEqual(team.page.rows.map(r=>r.id),['c1']);assert(calls.some(c=>c.init.headers['X-Workspace-Team']==='t1'));
});

test('customer detail/history omit bank, courier, raw snapshots and verify selected team before direct reads',async()=>{
  const {service,calls}=await fixture();const detail=await service.execute('customers','show',{team:'t1'},'c1');assert.equal(detail.record.profile.fields.legalName,'Alpha');assert(detail.record.capabilities.readBank);
  assert(!JSON.stringify(detail).includes('SECRET'));
  assert.equal((await service.execute('customers','history',{},'c1')).page.rows[0].action,'更新');
  const before=calls.length;await assert.rejects(service.execute('customers','history',{team:'t1'},'c2'),{code:'NOT_IN_SCOPE'});assert(!calls.slice(before).some(c=>c.url.pathname.endsWith('/customer-workflow-history')));
});

test('project detail filters association and projects history is summary only',async()=>{
  const {service}=await fixture();const detail=await service.execute('projects','show',{},'p1');assert.equal(detail.items.total,1);assert.equal(detail.items.rows[0].quantity,0);assert(!JSON.stringify(detail).includes('SECRET'));
  assert.equal((await service.execute('projects','list',{customer:'c2'})).page.rows[0].id,'p2');
  assert(!JSON.stringify(await service.execute('projects','history',{},'p1')).includes('HISTORY-SECRET'));
});

test('inquiries are rfq only; unknown and zero stay distinct; non-rfq history rejected',async()=>{
  const f=await fixture();const detail=await f.service.execute('inquiries','show',{},'r1');assert.equal(detail.record.details.quantity,null);assert(!JSON.stringify(detail).includes('DETAIL-SECRET'));
  const history=await f.service.execute('inquiries','history',{},'r1');assert.equal(history.page.rows[0].snapshot.details.quantity,0);assert(!JSON.stringify(history).includes('TOKEN-SECRET'));
  assert(f.calls.some(c=>c.url.searchParams.get('type')==='rfq'));
  f.data['process-history'].history[0].snapshot.type='warehouse';await assert.rejects(f.service.execute('inquiries','history',{},'r1'),{code:'INVALID_RESPONSE'});
});

test('quote current/version/history preserve prices and review flags without costs, formulas or raw history',async()=>{
  const f=await fixture();const current=await f.service.execute('quotes','show',{},'q1');assert.equal(current.lines.rows[0].unitPrice,0);assert.equal(current.lines.rows[0].quantity,null);assert.equal(current.lines.rows[0].scopeReviewed,false);assert(current.terms.rows[0].needsReview);assert.equal(current.charges.rows[0].amount,null);assert(!JSON.stringify(current).includes('SECRET'));
  assert.equal((await f.service.execute('quotes','version',{},'q1','1')).record.version,1);
  assert.equal((await f.service.execute('quotes','history',{},'q1')).page.rows[0].version,1);
  f.data['customer-quote-version'].quote.customerAccountId='c2';await assert.rejects(f.service.execute('quotes','version',{},'q1','1'),{code:'NOT_IN_SCOPE'});
});

test('export verifies XLSX, uses team scope, writes exclusive local file and reports hash only',async()=>{
  const f=await fixture(), dir=await temporary(), output=path.join(dir,'synthetic.xlsx');
  const result=await f.service.execute('quotes','export-completed',{team:'t1',output});assert.equal(result.file.bytes,7);assert.match(result.file.sha256,/^[a-f0-9]{64}$/);assert.equal(result.scope.exportScope,'all-authorized-completed-rows-in-team');
  const calls=f.calls.length;await assert.rejects(f.service.execute('quotes','export-completed',{output}),{code:'OUTPUT_EXISTS'});assert.equal(f.calls.length,calls);assert.equal((await fs.readFile(output)).length,7);
  await assert.rejects(f.service.execute('quotes','export-completed',{customer:'c1',output:path.join(dir,'other.xlsx')}),{code:'INVALID_ARGUMENT'});
});

test('server contract drift/team not applied, auth revocation and invalid command params fail visibly',async()=>{
  const f=await fixture();await assert.rejects(f.service.execute('projects','list',{limit:'0'}),{code:'INVALID_ARGUMENT'});assert.equal(f.calls.length,0);
  await assert.rejects(new SalesService(f.state,async()=>Response.json({projects:[]})).execute('projects','list',{team:'t1'}),{code:'SCOPE_NOT_CONFIRMED'});
  await assert.rejects(new SalesService(f.state,async()=>Response.json({})).execute('quotes','list'),{code:'INVALID_RESPONSE'});
  await assert.rejects(new SalesService(f.state,async()=>Response.json({}, {status:401})).execute('projects','list'),{code:'AUTH_REQUIRED'});assert.equal(await f.state.hasSession(),false);
});

test('business transport forbids writes, unknown query keys, all-process access and anonymous access',async()=>{
  const cfg=serverConfig('https://employee.test'), saved=session(cfg.origin), api=new ApiClient(cfg,async()=>{throw Error('Must not be called');});
  await assert.rejects(api.request('/api/workspace/customer-quotes'),{code:'AUTH_REQUIRED'});
  await assert.rejects(api.request('/api/workspace/customer-quotes',saved,{actor:'spoof'}),{code:'UNSUPPORTED_OPERATION'});
  await assert.rejects(api.request('/api/workspace/customer-quotes',saved,undefined,{query:{actor:'spoof'}}),{code:'INVALID_QUERY'});
  await assert.rejects(api.request('/api/workspace/process-data',saved),{code:'INVALID_QUERY'});
  await assert.rejects(api.request('/api/workspace/process-data',saved,undefined,{query:{type:'warehouse'}}),{code:'UNSUPPORTED_OPERATION'});
  await assert.rejects(api.request('/api/workspace/customer-quote-template-export',saved),{code:'UNSUPPORTED_OPERATION'});
});

test('business response cap cancels oversized stream and binary protocol rejects HTML and bad signatures',async()=>{
  const cfg=serverConfig('https://employee.test'), saved=session(cfg.origin);let cancelled=false;
  const stream=new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(1024*1024));},cancel(){cancelled=true;}});
  const api=new ApiClient(cfg,async()=>new Response(stream,{headers:{'content-type':'application/json'}}));
  await assert.rejects(api.request('/api/workspace/customer-quotes',saved),{code:'RESPONSE_TOO_LARGE'});assert(cancelled);
  for(const [content,type] of [['<html>sign in</html>','text/html'],['invalid zip','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']]){
    const bad=new ApiClient(cfg,async()=>new Response(content,{headers:{'content-type':type}}));
    await assert.rejects(bad.request('/api/workspace/customer-quote-completed-export',saved),{code:'INVALID_RESPONSE'});
  }
});
