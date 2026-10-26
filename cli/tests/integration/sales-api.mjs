// Real middle-platform handlers and native authentication; synthetic data only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {spawn, execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import * as XLSX from 'xlsx';
import {StateStore, windowsCodec} from '../../dist/state.js';
import {FoundationService} from '../../dist/service.js';
import {commands} from '../../dist/catalog.js';
import {temporary, root, testCodec} from '../helpers.mjs';

const dir=await temporary(), runtime=path.join(dir,'runtime');await fs.mkdir(path.join(runtime,'client'),{recursive:true});
for(const name of ['runtime.mjs','ie-mail.mjs','auth.mjs','personnel.mjs','server.mjs','supplier-gateway.mjs','employee-gateway.mjs','agent-schedules.mjs'])await fs.copyFile(path.join(root,'standalone',name),path.join(runtime,name));
await fs.cp(path.join(root,'standalone/schedule-engine'),path.join(runtime,'schedule-engine'),{recursive:true});
await fs.writeFile(path.join(runtime,'client/index.html'),'Synthetic sales CLI integration');
await build({absWorkingDir:root,entryPoints:['app/api/workspace/[action]/route.ts'],outfile:path.join(runtime,'workspace-api.mjs'),bundle:true,format:'esm',platform:'node',packages:'external',alias:{'@':root},plugins:[{name:'native-cli-bindings',setup(b){b.onResolve({filter:/^cloudflare:workers$|chatgpt-auth$/},()=>({path:'./runtime.mjs',external:true}));}}]});
await fs.writeFile(path.join(runtime,'seed.mjs'), `
import fs from 'node:fs/promises';import path from 'node:path';import {db,saveRecords,dataDir} from './runtime.mjs';import {createAccount} from './auth.mjs';
const at='2026-10-20T00:00:00.000Z',a=await createAccount({username:'sales_a',name:'Synthetic Sales A',role:'sales',password:'Synthetic-Only-2026!'},null),b=await createAccount({username:'sales_b',name:'Synthetic Sales B',role:'sales',password:'Synthetic-Only-2026!'},null);
await createAccount({username:'broad',name:'Synthetic Broad Reader',role:'viewer',orderScope:'all',password:'Synthetic-Only-2026!'},null);await createAccount({username:'unassigned',name:'Synthetic Unassigned',role:'sales',orderScope:'assigned',password:'Synthetic-Only-2026!'},null);db.prepare('UPDATE local_accounts SET must_change=0').run();await createAccount({username:'initial',name:'Synthetic Initial',role:'sales',password:'Synthetic-Only-2026!'},null);
const customer=(id,name,memberIds)=>({id,kind:'customer_account',customer:name,customerCode:id.toUpperCase(),salesName:'',serviceName:'',pmcName:'',salesMemberIds:memberIds,serviceMemberIds:[],quoteMemberIds:memberIds,active:true,notes:'',version:1,createdAt:at,updatedAt:at});
const quote=(id,cid)=>({id,kind:'customer_quote',version:2,status:'draft',customerAccountId:cid,customerName:cid,customerCode:cid.toUpperCase(),companyEn:'Synthetic Co',companyZh:'合成公司',collectionEn:'Frames',collectionZh:'镜架',quoteNo:'TEST-'+id,quoteDate:'2026-10-20',validUntil:'2026-12-31',currency:'EUR',contactName:'Synthetic',businessType:'frame',quoteMode:'order',pricingBasis:'row_item',currencyReviewed:true,lines:[{id:'line_'+id,model:'SYNTH-'+id,descriptionZh:'合成产品',descriptionEn:'Synthetic product',quantity:10,unitPrice:0,toolingFee:0,unit:'pair',supplyStage:'finished',productType:'frame',scopeReviewed:true,sourceFormula:'SYNTHETIC_INTERNAL_FORMULA'}],terms:[{id:'term_'+id,labelZh:'条款',labelEn:'Terms',zh:'待核查',en:'Check',needsReview:true}],reviewNotes:['待核查'],internalNotesZh:'SYNTHETIC_INTERNAL_COST',internalCosts:[],customerCharges:[],createdAt:at,createdBy:'Synthetic',updatedAt:at,updatedBy:'Synthetic'});
const q1=quote('q1','c1'),q2=quote('q2','c2'),snap=q=>({...q,version:1,status:'confirmed',terms:q.terms.map(t=>({...t,needsReview:false})),reviewNotes:[],confirmedAt:at,confirmedBy:'Synthetic',confirmedById:a.memberId});
const project=(id,cid,team)=>({id,kind:'customer_project',customerId:cid,teamId:team,title:'Synthetic '+id,code:id,description:'Test only',salesMemberId:a.memberId,serviceMemberId:'',serviceMemberIds:[],dueDate:'2026-11-01',status:'active',version:1,createdAt:at,updatedAt:at,createdBy:'Synthetic',updatedBy:'Synthetic'});
const rfq=(id,cid,team)=>({id,kind:'process_record',type:'rfq',customerId:cid,orderId:'',teamId:team,title:'Synthetic RFQ '+id,ownerId:a.memberId,responsibleId:'',status:'待核实',gateStatus:'待核实',details:{quantity:null,requirement:'待确认',currency:'EUR'},version:1,createdAt:at,updatedAt:at,updatedBy:'Synthetic'});
const p1=project('p1','c1','t1'),p2=project('p2','c2','t2'),r1=rfq('r1','c1','t1'),r2=rfq('r2','c2','t2');
saveRecords([customer('c1','Synthetic Alpha',[a.memberId]),customer('c2','Synthetic Beta',[a.memberId,b.memberId]),
{id:'policy',kind:'customer_quote_access',memberIds:[a.memberId,b.memberId],aliasesByMember:{},customerMemberIds:{c1:[a.memberId],c2:[a.memberId,b.memberId]}},
...['1','2'].map(n=>({id:'t'+n,kind:'customer_project_team',name:'Synthetic Team '+n,customerIds:['c'+n],leaderIds:[],salesMemberIds:[a.memberId],serviceMemberIds:[],active:true,version:1})),
{id:'profile1',kind:'customer_workflow_profile',customerId:'c1',version:1,fields:{stage:'报价',legalName:'Synthetic Alpha',bankPaymentInfo:'SYNTHETIC_BANK_PRIVATE'}},
{id:'event1',kind:'customer_workflow_event',customerId:'c1',action:'合成跟进',actor:'Synthetic',createdAt:at},p1,p2,r1,r2,
{id:'rrev1',kind:'process_record_revision',recordId:'r1',customerId:'c1',orderId:'',teamId:'t1',version:1,action:'新增',actor:'Synthetic',createdAt:at,snapshot:r1},
{id:'project_audit',kind:'audit',targetId:'p1',action:'合成项目',actor:'Synthetic',createdAt:at,before:null,after:p1},q1,q2,
...([q1,q2].map(q=>({id:'rev_'+q.id,kind:'customer_quote_revision',quoteId:q.id,version:1,snapshot:snap(q),action:'确认',updatedAt:at,updatedBy:'Synthetic'}))),
...([q1,q2].map(q=>({id:'completed_'+q.id,kind:'customer_quote_completed',quoteId:q.id,quoteVersion:1,lineId:q.lines[0].id,...q.lines[0],id:'completed_'+q.id,kind:'customer_quote_completed',customerAccountId:q.customerAccountId,customerName:q.customerName,customerCode:q.customerCode,quoteNo:q.quoteNo,currency:'EUR',quoteDate:q.quoteDate,validUntil:q.validUntil,confirmedAt:at,confirmedBy:'Synthetic',customerCharges:[]})))
]);
const order=(id,customer)=>({id,kind:'order',version:1,createdAt:at,updatedAt:at,updatedBy:'Synthetic',source:'synthetic',orderNo:'SO-'+id,customer,customerPO:'PO-'+id,drawing:'DRAW-'+id,color:'Black',lens:'Clear',batch:'1',quantity:10,requestedDate:'2026-11-01',ownerEmail:'',stage:'待下达',plannedDate:'',shipDate:'',promisedDate:'',promiseConfirmed:false,customerNote:'',arrangement:'',notes:'',workflowStatus:'业务待提交'});
const source=(id,customer)=>({id,kind:'sales_order_source',version:1,status:'待核对',customer,orderNo:'SOURCE-'+id,contentFingerprint:'b'.repeat(64),createdAt:at,createdById:a.memberId,source:{schemaVersion:1,orderNo:'SOURCE-'+id,customer,productType:'frame',customerPO:'SYNTHETIC-PO',documentType:'Sales Order Confirmation',source:{filename:'synthetic.xlsx',sha256:'a'.repeat(64),sheet:'Sales',detailRange:'A1:C2'},warnings:['Synthetic pending value'],lines:[{id:'source-line-'+id,sourceRow:2,drawing:'DRAW',model:'MODEL',color:'Black',sku:'',quantity:10,unit:'pair',sampleQuantity:null,unitPrice:'0',deliveryText:'TBD',colorFields:[{sourceColumn:'A',sourceLabel:'色号',sourceCell:'A2',value:null,status:'pending',standardZh:'',standardEn:'',qualifier:'',candidates:[]}],rawFields:[{column:'B',label:'数量',cell:'B2',value:'10'}],notes:[]}]}});
const doc=(id,type,cid,oid,kind='handoff_business_document')=>({id,kind,type,customerId:cid,projectId:'',orderId:oid,version:2,number:'SYNTHETIC-'+id,status:'draft',fields:{date:'2026-10-20',currency:'EUR',buyer:'Synthetic buyer',seller:'Synthetic seller',billingAddress:'Synthetic billing',shippingAddress:'Synthetic shipping',paymentTerms:'TBD',depositPercent:'',tradeTerms:'TBD',paymentDueDate:'',delivery:'TBD',reference:'',notes:'',templateLabel:'',manualBasis:'',courierAccount:'SYNTHETIC_COURIER_PRIVATE',path:'SYNTHETIC_PRIVATE_PATH',materialState:'未开始',purchaseState:'未开始'},lines:[{orderLineId:oid,description:'Synthetic product',quantity:10,unitPrice:'0'}],sourceRefs:[],sourceSnapshots:[],originRefs:[],originSnapshots:[],attachmentRefs:[],createdAt:at,createdById:a.memberId,updatedAt:at,updatedBy:'Synthetic'});
const po=doc('po1','po','c1','o1','handoff_business_source'),pi=doc('pi1','pi','c1','o1'),invoice=doc('invoice1','invoice','c1','o1'),production=doc('production1','production_order','c1','o1','handoff_business_source');
pi.sourceRefs=[{id:'po1',version:2}];pi.sourceSnapshots=[po];
const members=db.prepare("SELECT data FROM records WHERE kind='member'").all().map(row=>JSON.parse(row.data)).map(row=>({...row,orderScope:row.role==='viewer'?'all':'assigned',customers:row.id===a.memberId?['C1','C2']:row.id===b.memberId?['C2']:[]}));
saveRecords([...members,order('o1','C1'),order('o2','C2'),source('source1','C1'),source('source2','C2'),po,pi,invoice,production,doc('pi2','pi','c2','o2'),
...([pi,invoice,production].map(row=>({id:'hist-'+row.id,kind:'handoff_business_history',recordId:row.id,customerId:row.customerId,version:1,action:'合成保存',actor:'Synthetic',createdAt:at,snapshot:{...row,version:1,status:'draft'}})))
]);
const drawing=(id,cid)=>({id,kind:'engineering_drawing',version:2,customerId:cid,customerCode:cid.toUpperCase(),drawingType:'2d',requestedDate:'2026-10-20',newCount:0,revisionCount:null,requester:'Synthetic',modelNo:'MODEL',drawingNotes:'',assigneeId:'',assignee:'',deadline:'',completedDate:'',approval:'待审核',status:'待分配',upstreamDepartment:'',priority:'普通',requirement:'待核对',downstream:'',deliveredDate:'',deliveryNote:'',source:{rawColumns:{private:'SYNTHETIC_SOURCE_SECRET'}},legacyNeedsReview:true,approvalNote:'',approvalBy:'',approvalAt:'',createdAt:at,updatedAt:at,updatedBy:'Synthetic',createdBy:'Synthetic'});
const d1=drawing('drawing1','c1'),d2=drawing('drawing2','c2');
const sop={id:'sop1',kind:'engineering_sop',version:2,drawingRecordId:'drawing1',customerId:'c1',modelNo:'MODEL',targetVersion:'V2',currentVersion:'V1',status:'待更新SOP',mode:'change_instruction',requirement:'待核对',isCurrent:true,predecessorId:'',sourceEventId:'',sopFileId:'',preparedVersion:'',latestUploadId:'',targetNote:'',confirmationNote:'',confirmedBy:'',confirmedAt:'',createdBy:'Synthetic',createdAt:at,updatedAt:at,updatedBy:'Synthetic'};
const sample={id:'sample1',kind:'customer_project_sample',version:1,projectId:'p1',customerId:'c1',roundId:'',sampleNo:'SAMPLE-1',purpose:'development',scope:[{itemId:'item1',quantity:0}],drawingIds:[],quoteLinkId:'',ownerId:a.memberId,requiredDate:'',plannedDate:'',promisedDate:'',promiseNote:'',status:'pending',note:'待核对',paymentSnapshot:{secret:'SYNTHETIC_PAYMENT_SECRET'},itemSnapshot:[],createdAt:at,updatedAt:at,updatedBy:'Synthetic'};
const ie={id:'ie1',kind:'ie_quote',version:2,revision:1,customerAccountId:'c1',quoteNo:'IE-1',quoteDate:'2026-10-20',validUntil:'2026-12-31',batchId:'B1',exchangeRateCnyPerUsd:null,exchangeRateDate:'',exchangeRateSource:'',notes:'待核对',status:'draft',customerName:'Synthetic Alpha',customerCode:'C1',preparedByIds:[a.memberId],policyVersion:1,requiredReviewMemberId:'',lines:[{id:'ieline',model:'MODEL',customerModel:'',color:'Black',drawingNo:'DRAW',drawingRevision:'V1',quantityMin:null,quantityMax:10,structureNotes:'',scopeNotes:'',materials:[],processes:[],outsourcing:[]}],tooling:[],createdAt:at,createdBy:'Synthetic',createdById:a.memberId,updatedAt:at,updatedBy:'Synthetic',updatedById:a.memberId};
saveRecords([d1,d2,sop,sample,ie,{id:'drawing-history1',kind:'engineering_drawing_revision',recordId:'drawing1',customerId:'c1',version:1,action:'保存',actor:'Synthetic',createdAt:at,snapshot:{...d1,version:1}},
{id:'sop-history1',kind:'engineering_sop_revision',sopId:'sop1',customerId:'c1',version:1,action:'保存',actor:'Synthetic',createdAt:at,snapshot:{...sop,version:1}},
{id:'ie-history1',kind:'ie_quote_revision',quoteId:'ie1',version:1,revision:1,action:'保存',updatedAt:at,updatedBy:'Synthetic',snapshot:{...ie,version:1}},
{id:'ie-policy',kind:'ie_quote_policy',version:1,engineerMemberId:a.memberId,reviewerMemberId:b.memberId,finalApproverMemberId:members.find(m=>m.role==='viewer').id,updatedAt:at,updatedBy:'Synthetic'}]);
await fs.mkdir(path.join(dataDir,'files'),{recursive:true});await fs.writeFile(path.join(dataDir,'files','synthetic-original.bin'),'SYNTHETIC ORIGINAL BYTES');db.close();
`);
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('DOON_')));
Object.assign(env,{DOON_DATA_DIR:path.join(dir,'data'),DOON_HOST:'127.0.0.1',DOON_NO_AUTO_BACKUP:'1',DOON_SYNTHETIC_ONLY:'1'});
execFileSync(process.execPath,[path.join(runtime,'seed.mjs')],{env,windowsHide:true,stdio:'pipe'});
const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const origin='http://127.0.0.1:'+port;
const child=spawn(process.execPath,[path.join(runtime,'server.mjs')],{env:{...env,DOON_PORT:String(port)},windowsHide:true,stdio:['ignore','ignore','pipe']});
let logs='';child.stderr.on('data',b=>logs+=b);let exited=false;const done=new Promise(resolve=>child.once('exit',()=>{exited=true;resolve();}));
function snapshot(){const db=new DatabaseSync(path.join(env.DOON_DATA_DIR,'workspace.sqlite'),{readOnly:true});try{return {records:db.prepare("SELECT id,kind,data FROM records WHERE kind!='auth_event' ORDER BY id").all(),revision:db.prepare("SELECT revision FROM workspace_revision WHERE id='main'").get().revision};}finally{db.close();}}
let checks=0;const pass=()=>checks++;const testedCommands=[];
try{
  let ready=false;for(let i=0;i<80;i++){try{if((await fetch(origin+'/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert(ready,'Native server starts');
  const services={};
  for(const username of ['sales_a','sales_b','broad','unassigned','initial']){
    const state=new StateStore(path.join(dir,username),testCodec());await state.setup(origin,true);const f=new FoundationService(state);await f.login(async()=>({username,password:'Synthetic-Only-2026!'}));services[username]={foundation:f,sales:f.sales(),state};
  }
  // Authentication audit may advance the workspace revision; establish all test sessions before the read-only baseline.
  let processState;
  if(process.platform==='win32'){
    processState=new StateStore(path.join(dir,'process-client'),windowsCodec);await processState.setup(origin,true);await new FoundationService(processState).login(async()=>({username:'sales_a',password:'Synthetic-Only-2026!'}));
  }
  const before=snapshot(),original=await fs.readFile(path.join(env.DOON_DATA_DIR,'files/synthetic-original.bin'));
  const a=services.sales_a.sales,b=services.sales_b.sales;
  const eng=services.sales_a.foundation.engineering(),otherEng=services.sales_b.foundation.engineering();
  assert.equal((await eng.execute('drawings','list',{team:'t1'})).page.total,1);assert.equal((await eng.execute('drawings','show',{},'drawing1')).record.newCount,0);assert.equal((await eng.execute('drawings','history',{},'drawing1')).page.total,1);await assert.rejects(otherEng.execute('drawings','show',{},'drawing1'),{code:'NOT_IN_SCOPE'});pass();
  assert.equal((await eng.execute('sops','list',{team:'t1'})).page.total,1);assert.equal((await eng.execute('sops','show',{},'sop1')).record.targetVersion,'V2');assert.equal((await eng.execute('sops','history',{},'sop1')).page.total,1);pass();
  assert.equal((await eng.execute('samples','show',{team:'t1',project:'p1'},'sample1')).items.rows[0].quantity,0);assert.equal((await eng.execute('samples','list',{})).page.total,1);pass();
  assert.equal((await eng.execute('ie-quotes','list',{})).page.total,1);assert.equal((await eng.execute('ie-quotes','show',{},'ie1')).record.exchangeRateCnyPerUsd,null);assert.equal((await eng.execute('ie-quotes','history',{},'ie1')).page.total,1);assert.equal((await eng.execute('ie-quotes','version',{},'ie1','1')).record.version,1);await assert.rejects(eng.execute('ie-quotes','list',{team:'t1'}),{code:'INVALID_ARGUMENT'});pass();
  const unassigned=services.unassigned.foundation.engineering();assert.equal((await unassigned.execute('drawings','list')).page.total,0);await assert.rejects(unassigned.execute('ie-quotes','list'),{code:'FORBIDDEN'});pass();
  const orders=services.sales_a.foundation.orders(),otherOrders=services.sales_b.foundation.orders();
  assert.equal((await orders.execute('orders','list',{team:'t1'})).page.total,1);assert.equal((await orders.execute('orders','show',{},'o1')).record.customer,'C1');await assert.rejects(otherOrders.execute('orders','show',{},'o1'),{code:'NOT_IN_SCOPE'});pass();
  assert.equal((await orders.execute('sources','list',{team:'t1'})).page.total,1);assert.equal((await orders.execute('sources','show',{},'source1')).lines.rows[0].sampleQuantity,null);pass();
  const broad=services.broad.foundation.orders();assert.equal((await broad.execute('orders','list')).page.total,2);assert.equal((await broad.execute('sources','list')).page.total,0);assert.equal((await broad.execute('pi','list')).page.total,0);pass();
  const sourceOutput=path.join(dir,'source.xlsx');await orders.execute('sources','export',{team:'t1',output:sourceOutput},'source1');assert(XLSX.read(await fs.readFile(sourceOutput),{type:'buffer'}).SheetNames.length>0);pass();
  for(const resource of ['pi','documents','production-orders']){
    const id=resource==='production-orders'?'production1':'pi1';assert((await orders.execute(resource,'list',{team:'t1'})).page.total>0);const shown=await orders.execute(resource,'show',{team:'t1'},id);assert.equal(shown.record.customerId,'c1');assert(!JSON.stringify(shown).includes('SYNTHETIC_COURIER_PRIVATE'));assert(!JSON.stringify(shown).includes('SYNTHETIC_PRIVATE_PATH'));assert.equal((await orders.execute(resource,'history',{team:'t1'},id)).page.rows[0].version,1);
    if(resource!=='production-orders')assert.equal((await orders.execute(resource,'version',{team:'t1'},id,'1')).record.version,1);pass();
  }
  await assert.rejects(otherOrders.execute('pi','show',{},'pi1'),{code:'NOT_IN_SCOPE'});await assert.rejects(orders.execute('pi','history',{team:'t2'},'pi1'),{code:'NOT_IN_SCOPE'});pass();
  assert.deepEqual((await a.execute('teams','list')).page.rows.map(row=>row.id).sort(),['t1','t2']);pass();
  assert.equal((await a.execute('customers','list')).page.total,2);assert.equal((await b.execute('customers','list')).page.total,1);pass();
  const detail=await a.execute('customers','show',{team:'t1'},'c1');assert.equal(detail.record.customer.customer,'Synthetic Alpha');assert(!JSON.stringify(detail).includes('SYNTHETIC_BANK_PRIVATE'));pass();
  assert.equal((await a.execute('customers','history',{},'c1')).page.total,1);pass();
  assert.equal((await a.execute('projects','list',{team:'t1'})).page.rows[0].id,'p1');assert.equal((await a.execute('projects','show',{},'p1')).record.code,'p1');assert.equal((await a.execute('projects','history',{},'p1')).page.total,1);pass();
  await assert.rejects(b.execute('projects','show',{},'p1'),{code:'NOT_IN_SCOPE'});await assert.rejects(a.execute('projects','history',{team:'t1'},'p2'),{code:'NOT_IN_SCOPE'});pass();
  assert.equal((await a.execute('inquiries','list',{team:'t1'})).page.total,1);assert.equal((await a.execute('inquiries','show',{},'r1')).record.details.quantity,null);assert.equal((await a.execute('inquiries','history',{},'r1')).page.rows[0].snapshot.type,'rfq');pass();
  assert.equal((await b.execute('quotes','list')).page.total,1);assert.equal((await a.execute('quotes','show',{team:'t1'},'q1')).lines.rows[0].unitPrice,0);assert.equal((await a.execute('quotes','history',{},'q1')).page.rows[0].version,1);pass();
  const archived=await a.execute('quotes','version',{team:'t1'},'q1','1');assert.equal(archived.record.version,1);assert.equal(archived.record.status,'confirmed');assert(!JSON.stringify(archived).includes('SYNTHETIC_INTERNAL'));pass();
  const output=path.join(dir,'completed.xlsx');await a.execute('quotes','export-completed',{team:'t1',output});const book=XLSX.read(await fs.readFile(output),{type:'buffer'}),rows=XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]]);assert.equal(rows.length,1);assert.equal(rows[0]['客户编号'],'C1');assert.equal(rows[0]['对客单价'],0);pass();
  await assert.rejects(a.execute('quotes','export-completed',{output}),{code:'OUTPUT_EXISTS'});await assert.rejects(services.initial.sales.execute('projects','list'),{code:'FORBIDDEN'});pass();
  assert.deepEqual(snapshot(),before);assert.deepEqual(await fs.readFile(path.join(env.DOON_DATA_DIR,'files/synthetic-original.bin')),original);pass();
  if(processState){
    // The server is another process, so synchronous child CLI calls cannot deadlock it.
    const flag=process.argv.indexOf('--cli-root'),cliRoot=flag<0?path.join(root,'cli'):path.resolve(process.argv[flag+1]);
    const nodeBinary=flag<0?process.execPath:path.join(cliRoot,'node.exe');
    const argumentsFor={setup:['--server',origin,'--allow-local-http'],login:[],logout:[],whoami:[],doctor:[],commands:[],modules:[]};
    const ids={customers:'c1',projects:'p1',inquiries:'r1',quotes:'q1',orders:'o1',sources:'source1',pi:'pi1',documents:'invoice1','production-orders':'production1',drawings:'drawing1',sops:'sop1',samples:'sample1','ie-quotes':'ie1'};
    // Run every command from the actual catalog, rather than maintaining an unrelated fixed command count.
    for(const spec of [...commands.filter(c=>c.name!=='logout'),commands.find(c=>c.name==='logout')]){
      const parts=spec.name.split(' ');let args=[...parts];
      if(parts.length===1)args.push(...argumentsFor[spec.name]);
      else{
        const [,resource,action]=parts;
        if(!['list','export-completed'].includes(action))args.push(ids[resource]);
        if(action==='version')args.push('1');
        if(action==='export'||action==='export-completed')args.push('--output',path.join(dir,'command-'+testedCommands.length+'.xlsx'));
        if(resource!=='ie-quotes')args.push('--team','t1');
      }
      const value=JSON.parse(execFileSync(nodeBinary,[path.join(cliRoot,'dist/index.js'),...args,'--json'],{env:{...env,DOON_CLI_HOME:processState.directory},windowsHide:true,encoding:'utf8',maxBuffer:1024*1024}));
      assert.equal(value.ok,true,spec.name);assert.equal(value.command,spec.name);testedCommands.push(spec.name);
      if(spec.name==='commands')assert.deepEqual(value.data.map(c=>c.name),commands.map(c=>c.name));
      if(spec.name==='logout')assert.equal(value.data.serverRevoked,true);
      else assert.deepEqual(snapshot(),before,'Business calls must preserve records and revision: '+spec.name);
    }
    assert.equal(testedCommands.length,commands.length);assert.equal(await processState.hasSession(),false);pass();
  }
  assert.deepEqual(snapshot().records,before.records);assert.deepEqual(await fs.readFile(path.join(env.DOON_DATA_DIR,'files/synthetic-original.bin')),original);
  await fs.writeFile(path.join(runtime,'disable.mjs'),`import {db} from './runtime.mjs';const a=db.prepare("SELECT member_id FROM local_accounts WHERE username='sales_b'").get(),row=JSON.parse(db.prepare('SELECT data FROM records WHERE id=?').get(a.member_id).data);db.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify({...row,active:false}),a.member_id);db.close();`);
  execFileSync(process.execPath,[path.join(runtime,'disable.mjs')],{env,windowsHide:true,stdio:'pipe'});await assert.rejects(b.execute('projects','list'),{code:'AUTH_REQUIRED'});assert.equal(await services.sales_b.state.hasSession(),false);pass();
}catch(error){console.error(logs.slice(-2000));throw error;}finally{
  if(!exited)child.kill();await done;
  const base=path.resolve(root,'test-output'),target=path.resolve(dir);
  if(path.dirname(target)!==base||!path.basename(target).startsWith('cli-test-'))throw Error('Refusing cleanup outside the generated test directory');
  await fs.rm(target,{recursive:true,force:true});assert.equal(await fs.stat(target).then(()=>true,()=>false),false);
}
console.log(JSON.stringify({passed:checks,syntheticOnly:true,productionRequests:0,businessRecordsAndOriginalBytesPreserved:true,testDirectoryRemoved:true,testedCommands}));
