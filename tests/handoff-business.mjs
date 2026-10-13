// Isolated synthetic records; no production database, files, identities or network.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const db=new DatabaseSync(':memory:');
for(const name of (await fs.readdir('drizzle')).filter(n=>n.endsWith('.sql')).sort())db.exec(await fs.readFile('drizzle/'+name,'utf8'));
db.exec("INSERT OR IGNORE INTO workspace_revision(id,revision) VALUES('main',0)");
class Statement{constructor(sql,args=[]){this.sql=sql;this.args=args;}bind(...args){return new Statement(this.sql,args);}async first(){return db.prepare(this.sql).get(...this.args)||null;}async all(){return {results:db.prepare(this.sql).all(...this.args)};}async run(){return db.prepare(this.sql).run(...this.args);}}
const syntheticFiles=new Map();
globalThis.__handoffBusinessEnv={DB:{prepare:sql=>new Statement(sql),batch:async statements=>{db.exec('BEGIN');try{const result=statements.map(s=>db.prepare(s.sql).run(...s.args));db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}},BUCKET:{get:async key=>syntheticFiles.has(key)?{body:new Uint8Array(syntheticFiles.get(key))}:null,put:async(key,bytes)=>{assert.ok(!syntheticFiles.has(key));syntheticFiles.set(key,bytes);}}};
await fs.mkdir('test-output',{recursive:true});
await build({stdin:{contents:"export {handoffBusinessGet,handoffBusinessPost} from './lib/handoff-business-api';export {communicationAccess,canReviewCommunication} from './lib/unified-communication';export {handoffProductionGate,requiresProductionGate} from './lib/handoff-production-gate';export {collaborationPost} from './lib/collaboration-api';export {pmcPost} from './lib/pmc-api';export {operationPost} from './lib/operations';export {commitImport} from './lib/import-commit';export {finishedSupplierPost} from './lib/finished-supplier-api';",resolveDir:process.cwd(),loader:'ts'},outfile:'test-output/handoff-business.mjs',bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@':process.cwd()},plugins:[{name:'synthetic-business',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'test'}));b.onResolve({filter:/chatgpt-auth$/},()=>({path:'auth',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},a=>({contents:a.path==='env'?'export const env=globalThis.__handoffBusinessEnv;':'export async function getChatGPTUser(){return null;}'}));}}]});
const api=await import(pathToFileURL(path.resolve('test-output/handoff-business.mjs')).href);
const put=r=>db.prepare('INSERT INTO records(id,kind,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,data=excluded.data').run(r.id,r.kind,JSON.stringify(r));
const rows=()=>db.prepare('SELECT data FROM records ORDER BY rowid').all().map(r=>JSON.parse(r.data));
const state=()=>({revision:db.prepare("SELECT revision FROM workspace_revision WHERE id='main'").get().revision,records:rows()});
const find=id=>rows().find(r=>r.id===id),uuid=()=>crypto.randomUUID();
const member=(id,role,customers=[])=>({id,kind:'member',active:true,role,customers,name:'Synthetic '+id,email:id+'@example.invalid'});
const sales=member('sales','sales',['TEST-C']),old=member('old','sales',['TEST-C']),service=member('service','clerk',['TEST-C']),other=member('other','sales',['OTHER']),admin=member('admin','admin'),lead=member('lead','clerk'),supervisor=member('supervisor','clerk');
const customer={id:'c1',kind:'customer_account',customer:'Synthetic customer',customerCode:'TEST-C',active:true,salesMemberIds:['sales','old'],serviceMemberIds:['service'],salesName:sales.name,serviceName:service.name,version:1};
const order={id:'o1',kind:'order',customer:'TEST-C',orderNo:'TEST-PO-1',customerPO:'PO-1',drawing:'STYLE-1',color:'A',lens:'CLEAR',batch:'1',quantity:100,ownerEmail:sales.email,stage:'待下达',version:1};
for(const row of [sales,old,service,other,admin,lead,supervisor,customer,order,{...customer,id:'c2',customer:'Other synthetic',customerCode:'OTHER',salesMemberIds:['other'],serviceMemberIds:[]},{...order,id:'o2',customer:'OTHER'}])put(row);
async function call(action,body,who=sales){const req=new Request('https://synthetic.invalid/api/workspace/handoff-business-'+action,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});try{const res=await api[body===undefined?'handoffBusinessGet':'handoffBusinessPost']('handoff-business-'+action.split('?')[0],req,state(),who);assert.ok(res);return {status:res.status,data:res.headers.get('content-type')?.includes('application/json')?await res.json():await res.text()};}catch(e){return {status:e.status||500,data:e.message};}}
async function ok(action,body,who){const r=await call(action,body,who);assert.equal(r.status,200,JSON.stringify(r));return r.data;}
async function fail(action,body,status,who){const r=await call(action,body,who);assert.equal(r.status,status,JSON.stringify(r));}
const sourceFields={reference:'PO-1',date:'2026-10-01',currency:'USD',buyer:'Synthetic buyer',seller:'Synthetic seller',billingAddress:'Synthetic bill',shippingAddress:'Synthetic ship',paymentTerms:'As recorded',tradeTerms:'As recorded',paymentDueDate:'2026-10-20',delivery:'Recorded delivery',path:'D:\\synthetic\\po.pdf',confirmedBy:'Source signatory',notes:'Synthetic original'};
const line={orderLineId:'o1',description:'STYLE-1 / A / CLEAR',quantity:100,unitPrice:'12.34'};
const body={kind:'source',type:'po',customerId:'c1',projectId:'',orderId:'o1',number:'SOURCE-1',fields:sourceFields,lines:[line],sourceRefs:[],token:uuid()};
const start=JSON.stringify(rows());assert.equal((await ok('data')).items.length,0);assert.equal(JSON.stringify(rows()),start);
const po=(await ok('save',body)).item;assert.equal(po.version,1);assert.equal((await ok('save',body)).idempotent,true);assert.equal(rows().filter(r=>r.kind==='handoff_business_source').length,1);
await fail('save',{...body,number:'DIFFERENT'},409);await fail('save',{...body,token:uuid(),fields:{...sourceFields,unknown:'not allowed'}},400);await fail('save',{...body,token:uuid(),orderId:'o2'},403);await fail('save',{...body,token:uuid()},403,other);
await fail('save',{...body,token:uuid(),id:po.id,expectedVersion:9},409);await fail('save',{...body,token:uuid(),id:po.id,expectedVersion:1,customerId:'c2',orderId:'o2'},409,admin);
assert.equal((await ok('data',undefined,other)).items.length,0);await fail('history?id='+po.id,undefined,403,other);
const mapped=(await ok('save',{...body,token:uuid(),number:'MAPPED-PO',originRefs:[{kind:'order',id:'o1',version:1}]})).item;
await fail('save',{...body,token:uuid(),number:'WRONG-MAP',originRefs:[{kind:'order',id:'o2',version:1}]},403);
await fail('save',{...body,token:uuid(),id:mapped.id,expectedVersion:1,number:'MAPPED-PO',originRefs:[]},409);
put({...order,version:2});assert.equal((await ok('data')).items.find(r=>r.id===mapped.id).sourceChanged,true);await fail('save',{...body,token:uuid(),number:'STALE-MAP',originRefs:[{kind:'order',id:'o1',version:1}]},409);put(order);
console.log('PASS no GET seeds, strict schema, immutable ownership, version conflict, transaction and UUID replay');
const pi=(await ok('generate',{token:uuid(),sourceId:po.id,sourceVersion:po.version,type:'pi',number:'PI-1',piId:''})).item;
let pending=(await ok('submit',{token:uuid(),id:pi.id,expectedVersion:pi.version,note:''},service)).item;
await fail('confirm',{token:uuid(),id:pi.id,expectedVersion:pending.version,note:''},403,admin);
await fail('confirm',{token:uuid(),id:pi.id,expectedVersion:pending.version,note:''},403,service);
put({id:'cw1',kind:'customer_workflow_state',customerId:'c1',primarySalesMemberId:sales.id});
await fail('confirm',{token:uuid(),id:pi.id,expectedVersion:pending.version,note:''},403,old);
const confirmed=(await ok('confirm',{token:uuid(),id:pi.id,expectedVersion:pending.version,note:'Checked source'})).item;assert.equal(confirmed.status,'checked');
const print=await ok('print?id='+pi.id+'&version='+confirmed.version);assert.ok(print.includes('CONTENTS CHECKED'));assert.ok(!print.includes('sourceSnapshots'));assert.ok(!print.includes(sourceFields.path));
assert.equal((await ok('history?id='+pi.id)).history.length,3);
console.log('PASS assigned current sales only; full source version checked; history and safe print');
const shipFields={date:'2026-10-05',shippingAddress:'Synthetic ship',shippingContact:'Synthetic recipient',shippingPhone:'000',courierAccount:'SYNTHETIC',cartonCount:'2',netWeight:'1',grossWeight:'2',cartonDimensions:'10x10x10',cartonDetails:'Synthetic cartons',path:'D:\\synthetic\\batch.pdf',confirmedBy:'Recorded signer',notes:'Synthetic actual list',piId:pi.id};
const shipment=(await ok('save',{...body,token:uuid(),type:'production_shipment',number:'BATCH-1',fields:shipFields,lines:[{...line,quantity:60,unitPrice:''}],sourceRefs:[]})).item;
const invoice=(await ok('generate',{token:uuid(),sourceId:shipment.id,sourceVersion:shipment.version,type:'invoice',number:'CI-1',piId:confirmed.id,piVersion:confirmed.version})).item;
assert.equal(invoice.lines[0].unitPrice,'12.34');pending=(await ok('submit',{token:uuid(),id:invoice.id,expectedVersion:invoice.version,note:''})).item;
await ok('confirm',{token:uuid(),id:invoice.id,expectedVersion:pending.version,note:''});
const invoice2=(await ok('generate',{token:uuid(),sourceId:shipment.id,sourceVersion:shipment.version,type:'invoice',number:'CI-2',piId:confirmed.id,piVersion:confirmed.version})).item;
pending=(await ok('submit',{token:uuid(),id:invoice2.id,expectedVersion:invoice2.version,note:''})).item;await fail('confirm',{token:uuid(),id:invoice2.id,expectedVersion:pending.version,note:''},400);
const packing=(await ok('generate',{token:uuid(),sourceId:shipment.id,sourceVersion:shipment.version,type:'packing',number:'PACK-1',piId:''})).item;
assert.equal(packing.lines[0].unitPrice,'');const packPrint=await ok('print?id='+packing.id);assert.ok(!packPrint.includes('Unit price'));assert.ok(!packPrint.includes('12.34'));
await fail('generate',{token:uuid(),sourceId:shipment.id,sourceVersion:shipment.version,type:'paymentrequest',number:'PAY-1',piId:''},400);
const oldBytes=JSON.stringify(find(pi.id).sourceSnapshots);await ok('save',{...body,token:uuid(),id:po.id,expectedVersion:1,fields:{...sourceFields,notes:'Changed source'}});assert.equal(JSON.stringify(find(pi.id).sourceSnapshots),oldBytes);assert.equal((await ok('data')).items.find(r=>r.id===pi.id).sourceChanged,true);
console.log('PASS invoice exact order-line prices and cumulative limit; packing omits prices; sources remain immutable');
const drawing=(await ok('save',{...body,token:uuid(),type:'engineering_drawing',number:'DRAW-1',fields:{style:'STYLE-1',versionLabel:'A',title:'Synthetic drawing',drawingNumber:'DW-1',date:'2026-10-06',linkedDrawingId:'',customerConfirmation:'Recorded evidence',productionAdoption:'',path:'D:\\synthetic\\drawing.pdf',confirmedBy:'Engineer',notes:'Synthetic'},lines:[],sourceRefs:[]})).item;
assert.equal((await ok('review-data',undefined,lead)).reviewerRole,'');await fail('adoption-sign',{token:uuid(),sourceId:drawing.id,expectedVersion:1,expectedPolicyVersion:1,decision:'confirm',note:'Checked'},403,admin);
await fail('review-policy',{token:uuid(),expectedVersion:0,drawingLeadMemberId:lead.id,engineeringSupervisorMemberId:lead.id},400,admin);
await ok('review-policy',{token:uuid(),expectedVersion:0,drawingLeadMemberId:lead.id,engineeringSupervisorMemberId:supervisor.id},admin);
const review=await ok('review-data',undefined,lead);assert.equal(review.drawings.length,1);assert.equal(review.drawings[0].customerId,undefined);assert.equal(review.drawings[0].fields,undefined);assert.equal(review.drawings[0].sourceSnapshots,undefined);
const sign={token:uuid(),sourceId:drawing.id,expectedVersion:1,expectedPolicyVersion:1,decision:'confirm',note:'Synthetic checked'};
await ok('adoption-sign',sign,lead);assert.equal((await ok('review-data',undefined,lead)).drawings[0].effective,false);assert.equal((await ok('adoption-sign',sign,lead)).idempotent,true);
await ok('adoption-sign',{...sign,token:uuid()},supervisor);assert.equal((await ok('review-data',undefined,lead)).drawings[0].effective,true);
await ok('save',{...body,token:uuid(),id:drawing.id,expectedVersion:1,type:'engineering_drawing',number:'DRAW-1',fields:{...find(drawing.id).fields,versionLabel:'B'},lines:[],sourceRefs:[]});assert.equal((await ok('review-data',undefined,lead)).drawings[0].effective,false);assert.equal(rows().filter(r=>r.kind==='handoff_business_adoption_signature').length,2);
console.log('PASS two distinct named roles, minimal evidence scope, no admin bypass, new versions require both signatures');
const communication={id:'comm1',customerId:'c1',projectId:'',orderId:'o1'};
assert.equal(api.communicationAccess(state(),sales,communication),true);
put({id:'channel1',kind:'framework_channel_account',channel:'email',active:true,ownerId:other.id,grants:[]});put({id:'binding1',kind:'framework_channel_binding',communicationId:'comm1',accountId:'channel1'});
assert.equal(api.communicationAccess(state(),sales,communication),false);assert.equal(api.canReviewCommunication(state(),old,communication),false);
const uploadToken=uuid();
function attachmentForm(){const form=new FormData();form.set('token',uploadToken);form.set('id',drawing.id);form.set('expectedVersion','2');form.set('note','Synthetic evidence');form.set('file',new File(['%PDF-synthetic-content'],'synthetic.pdf',{type:'application/pdf'}));return form;}
async function upload(){const r=await api.handoffBusinessPost('handoff-business-attachment',new Request('https://synthetic.invalid/api/workspace/handoff-business-attachment',{method:'POST',body:attachmentForm()}),state(),sales);return r.json();}
const uploaded=await upload();assert.equal(uploaded.item.version,3);assert.equal((await upload()).idempotent,true);assert.equal(syntheticFiles.size,1);
const attachment=rows().find(r=>r.kind==='handoff_business_attachment');assert.equal((await ok('data')).attachments[0].fileKey,undefined);assert.equal((await ok('file?id='+attachment.id)),'%PDF-synthetic-content');await fail('file?id='+attachment.id,undefined,403,other);assert.equal((await ok('file?id='+attachment.id,undefined,lead)),'%PDF-synthetic-content');
assert.equal(find(drawing.id).attachmentRefs[0].hash,attachment.hash);assert.equal((await ok('review-data',undefined,lead)).drawings[0].effective,false);
await fail('service-config',{token:uuid(),expectedVersion:0,drawingRoot:'D:\\synthetic\\drawings',quoteRoot:'',leadDays:0},400,admin);
await fail('service-config',{token:uuid(),expectedVersion:0,drawingRoot:'D:\\synthetic\\drawings',quoteRoot:'',leadDays:7},403,sales);
const config=await ok('service-config',{token:uuid(),expectedVersion:0,drawingRoot:'D:\\synthetic\\drawings',quoteRoot:'',leadDays:14},admin);assert.equal(config.serviceConfig.version,1);assert.equal((await ok('data')).serviceConfig.leadDays,14);
console.log('PASS immutable file upload/download, UUID replay, minimal reviewer file access and validated service settings');
assert.deepEqual(find('o1'),order);assert.deepEqual(find('c1'),customer);assert.equal(rows().some(r=>['project_receipt','project_charge','service_receipt'].includes(r.kind)),false);
console.log('PASS channel guard intersection and no mutation of original orders, customers or finance');

const gateOrder={...order,id:'gate-order',orderNo:'GATE-ORDER',customerPO:'GATE-PO',extra:{},notes:'',plannedDate:'',ledger:{columns:{AF:'',U:'',AB:''},sourceRow:1,issues:[]}};
const gateSource={...po,id:'gate-source',number:'GATE-PO',orderId:gateOrder.id,version:1,sourceRefs:[],originRefs:[],lines:[{...line,orderLineId:gateOrder.id}],fields:{...sourceFields,depositPercent:'30'}};
const gatePi={...gateSource,id:'gate-pi',kind:'handoff_business_document',type:'pi',number:'GATE-PI',status:'checked',sourceRefs:[{id:gateSource.id,version:1}]};
const gateDrawing={...find(drawing.id),id:'gate-drawing',orderId:gateOrder.id,version:1,sourceRefs:[],originRefs:[]};
const gateProduction={...gateSource,id:'gate-production',number:'GATE-PRODUCTION',type:'production_order',status:'pending_check',sourceRefs:[{id:gatePi.id,version:1},{id:gateDrawing.id,version:1}],fields:{materialState:'物料齐备',purchaseState:'采购完成',receivableId:'gate-receivable',depositPercent:'30'}};
const gateReceivable={id:'gate-receivable',kind:'service_record',type:'receivable',customerId:'c1',orderId:gateOrder.id,status:'open',version:1,details:{currency:'USD',amountCents:123400,invoiceNo:'Not inferred'}};
const gatePayment={id:'gate-payment',kind:'service_receipt',recordId:gateReceivable.id,entryType:'payment',amountCents:37020};
const gateFactory={id:'gate-factory',kind:'factory_order',lineId:gateOrder.id,version:1,status:'待下发工厂'};
for(const r of [gateOrder,gateSource,gatePi,gateDrawing,gateProduction,gateReceivable,gatePayment,gateFactory])put(r);
for(const [reviewerRole,actorId] of [['drawing_lead',lead.id],['engineering_supervisor',supervisor.id]])put({id:'gate-sign-'+reviewerRole,kind:'handoff_business_adoption_signature',sourceId:gateDrawing.id,sourceVersion:1,policyVersion:1,reviewerRole,actorId,decision:'confirm'});
assert.equal(api.handoffProductionGate(state(),admin,gateOrder).allowed,true);
function altered(id,patch){const v=state();v.records=v.records.map(r=>r.id===id?{...r,...patch}:r);return v;}
for(const [id,patch] of [[gatePi.id,{version:2}],[gateSource.id,{version:2}],[gateDrawing.id,{version:2}],[gateProduction.id,{fields:{...gateProduction.fields,materialState:'缺料'}}],[gateReceivable.id,{orderId:'o2'}],[gateReceivable.id,{details:{...gateReceivable.details,currency:'EUR'}}],[gateReceivable.id,{details:{...gateReceivable.details,amountCents:123401}}],[gatePayment.id,{amountCents:37019}]])assert.equal(api.handoffProductionGate(altered(id,patch),admin,gateOrder).allowed,false,JSON.stringify({id,patch}));
const reversed=state();reversed.records.push({id:'reversed',kind:'service_receipt',recordId:gateReceivable.id,entryType:'reversal',amountCents:1});assert.equal(api.handoffProductionGate(reversed,admin,gateOrder).allowed,false);
const staleOrigin=state();staleOrigin.records=staleOrigin.records.map(r=>r.id===gateDrawing.id?{...r,originRefs:[{id:'unavailable-original',kind:'engineering_drawing',version:1}]}:r);assert.equal(api.handoffProductionGate(staleOrigin,admin,gateOrder).allowed,false);
assert.equal(api.requiresProductionGate(gateOrder,{...gateOrder,stage:'生产中'}),true);assert.equal(api.requiresProductionGate(gateOrder,{...gateOrder,ledger:{...gateOrder.ledger,columns:{...gateOrder.ledger.columns,AF:'2026-10-13'}}}),true);
assert.equal(api.requiresProductionGate(gateOrder,{...gateOrder,productionStartDate:'2026-10-13',workflowStatus:'PMC已排期'}),false);
assert.equal(api.requiresProductionGate({...gateOrder,stage:'生产中'},{...gateOrder,stage:'装配中'}),false);assert.equal(api.requiresProductionGate({...gateOrder,ledger:{...gateOrder.ledger,columns:{AF:'2026-10-01'}}},{...gateOrder,stage:'生产中'}),false);
assert.equal(api.requiresProductionGate(gateOrder,{...gateOrder,ledger:{...gateOrder.ledger,columns:{AG:'1'}}}),true);
assert.equal(api.requiresProductionGate({...gateOrder,ledger:{...gateOrder.ledger,columns:{AG:'1'}}},{...gateOrder,ledger:{...gateOrder.ledger,columns:{AG:'2'}}}),false);
console.log('PASS shared gate: exact PI/payment binding, net receipt, currency/amount, current source/dual signatures, materials and planning distinction');
async function native(method,action,body){return api[method](action,new Request('https://synthetic.invalid/api/workspace/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),state(),admin);}
const release={lineId:gateOrder.id,sourceEnglish:'Synthetic source',chineseProcess:'Synthetic process',materialImageConfirmed:true,action:'release'};
put({...gatePayment,amountCents:1});
await assert.rejects(()=>native('collaborationPost','factory-order-save',release),e=>e.status===409&&e.message.includes('定金'));
await assert.rejects(()=>native('pmcPost','pmc-save',{changes:[{id:gateOrder.id,version:1,col:'AF',value:'2026-10-13'}]}),e=>e.status===409&&e.message.includes('定金'));
await assert.rejects(()=>native('operationPost','ledger-edit',{id:gateOrder.id,version:1,patch:{AF:'2026-10-13'},reason:'Synthetic actual start'}),e=>e.status===409&&e.message.includes('定金'));

const gateImport={id:'gate-import',kind:'import',actorId:admin.id,createdAt:new Date().toISOString(),status:'待确认',importType:'orders',filename:'synthetic.xlsx',rows:[{index:2,status:'update',expectedVersion:1,changes:['stage'],after:{...gateOrder,stage:'生产中'}}]};put(gateImport);
await assert.rejects(()=>api.commitImport({id:gateImport.id,selected:[2]},state(),admin),e=>e.status===409&&e.message.includes('定金'));
await assert.rejects(()=>native('operationPost','outsource-create',{token:uuid(),lineId:gateOrder.id,supplier:'Synthetic subcontractor',process:'welding',quantity:1,sentDate:'2026-10-01',dueDate:'2026-10-20',reference:'New manufacturing subcontract',note:''}),e=>e.status===409&&e.message.includes('定金'));
const external={...gateOrder,id:'external-gate-order',ledger:{...gateOrder.ledger,columns:{...gateOrder.ledger.columns,A:'Synthetic external factory',BF:'0'}}};put(external);put({id:'external-gate-supplier',kind:'supplier',name:'Synthetic external factory',active:true});
const task={lineId:external.id,supplierId:'external-gate-supplier',orderVersion:1,template:'custom',steps:[{id:'packing',label:'Packing'}],dueDate:'',baseline:{confirmed:false,cutoffDate:'2026-10-01',note:'Original baseline awaiting verification'},token:uuid()};
await assert.rejects(()=>native('finishedSupplierPost','finished-supplier-task-create',task),e=>e.status===409&&e.message.includes('原订单明细'));
put({...external,ledger:{...external.ledger,columns:{...external.ledger.columns,BF:'1'}}});assert.equal((await native('finishedSupplierPost','finished-supplier-task-create',task)).status,200);
console.log('PASS existing-order import and first manufacturing outsource cannot bypass gate; recorded historical external production can continue without resetting facts');
assert.equal(find(gateOrder.id).ledger.columns.AF,'');assert.equal(find(gateOrder.id).version,1);assert.equal(rows().filter(r=>r.kind==='factory_order'&&r.lineId===gateOrder.id).length,1);
put(gatePayment);assert.equal((await native('collaborationPost','factory-order-save',release)).status,200);
assert.equal((await native('pmcPost','pmc-save',{changes:[{id:gateOrder.id,version:1,col:'AF',value:'2026-10-13'}]})).status,200);
assert.equal(find(gateOrder.id).ledger.columns.AF,'2026-10-13');
console.log('PASS actual native factory release, PMC AF and ledger-edit endpoints reject incomplete gates atomically; complete gates permit release/start');

put({...gatePayment,amountCents:1});
const funding={token:uuid(),productionId:gateProduction.id,expectedVersion:1,piId:gatePi.id,expectedPiVersion:1,expectedDeclarationSequence:0,note:'Synthetic responsible sales accepts funding exception'};
await fail('payment-exception',funding,403,admin);await fail('payment-exception',funding,403,service);await fail('payment-exception',funding,403,old);
await fail('payment-exception',{...funding,unexpected:true},400);await fail('payment-exception',{...funding,expectedPiVersion:2},409);
put({...gateProduction,fields:{...gateProduction.fields,materialState:'缺料'}});await fail('payment-exception',funding,409);put(gateProduction);
const actualFinanceBefore=JSON.stringify(rows().filter(r=>r.kind==='service_receipt'||r.kind.startsWith('project_')||r.kind==='service_record'));
let result=await ok('payment-exception',funding);assert.equal(result.gate.allowed,true);assert.equal(result.gate.fundingReminder,true);assert.ok(result.gate.fundingMissing.length>0);assert.equal((await ok('payment-exception',funding)).idempotent,true);await fail('payment-exception',{...funding,note:'Changed retry'},409);
assert.equal(rows().filter(r=>r.kind==='handoff_business_funding_declaration').length,1);assert.equal((await ok('history?id='+gateProduction.id)).fundingHistory.length,1);
assert.equal(api.handoffProductionGate(altered(gateProduction.id,{fields:{...gateProduction.fields,purchaseState:'采购中'}}),admin,gateOrder).allowed,false);
assert.equal(api.handoffProductionGate(altered(gateDrawing.id,{version:2}),admin,gateOrder).allowed,false);
put({...gatePi,version:2});assert.equal(api.handoffProductionGate(state(),admin,gateOrder).allowed,false);assert.equal(api.handoffProductionGate(state(),admin,gateOrder).fundingReminder,true);await fail('deposit-declaration',{...funding,token:uuid(),expectedDeclarationSequence:1,note:'Deposit collection declaration'},409);put(gatePi);
put({id:'cw1',kind:'customer_workflow_state',customerId:'c1',primarySalesMemberId:old.id});assert.equal(api.handoffProductionGate(state(),admin,gateOrder).allowed,false);await fail('payment-exception',funding,403,sales);
const replacement={...funding,token:uuid(),expectedDeclarationSequence:1,note:'New responsible salesperson rechecks current basis'};result=await ok('payment-exception',replacement,old);assert.equal(result.gate.allowed,true);assert.equal(result.gate.declarationSequence,2);
await fail('deposit-declaration',{...replacement,token:uuid(),note:'Deposit now collected'},409,old);
const deposit={...replacement,token:uuid(),expectedDeclarationSequence:2,note:'Current responsible sales explicitly confirms agreed deposit collected'};result=await ok('deposit-declaration',deposit,old);assert.equal(result.gate.fundingReminder,false);assert.ok(result.gate.depositDeclaration);assert.ok(result.gate.fundingMissing.length>0);assert.equal((await ok('deposit-declaration',deposit,old)).idempotent,true);
assert.equal(JSON.stringify(rows().filter(r=>r.kind==='service_receipt'||r.kind.startsWith('project_')||r.kind==='service_record')),actualFinanceBefore);
assert.equal((await ok('history?id='+gateProduction.id,undefined,old)).fundingHistory.length,3);assert.equal(rows().filter(r=>r.kind==='handoff_business_funding_declaration').length,3);
console.log('PASS funding-only exception and deposit statement: current sales only, immutable sequence/UUID replay, hard gates cannot be waived, PI changes and responsibility transfer require recheck, actual finance unchanged');



// Full single-shipment payment requests use only an explicit original ledger, never sales statements.
put({id:'cw1',kind:'customer_workflow_state',customerId:'c1',primarySalesMemberId:sales.id});
const payOrder={...order,id:'pay-order',orderNo:'PAY-ORDER',customerPO:'PAY-PO'},payLine={...line,orderLineId:'pay-order'};
const payPo={...gateSource,id:'pay-po',orderId:payOrder.id,number:'PAY-PO',lines:[payLine]};
const payPi={...gatePi,id:'pay-pi',orderId:payOrder.id,number:'PAY-PI',lines:[payLine],sourceRefs:[{id:payPo.id,version:1}]};
const payShipment={...shipment,id:'pay-shipment',orderId:payOrder.id,number:'PAY-SHIP',status:'pending_check',lines:[{...payLine,unitPrice:''}],fields:{...shipFields,piId:payPi.id},sourceRefs:[]};
const payInvoice={...invoice,id:'pay-invoice',orderId:payOrder.id,number:'PAY-INVOICE',status:'checked',lines:[payLine],fields:{...invoice.fields,currency:'USD'},sourceRefs:[{id:payPi.id,version:1},{id:payShipment.id,version:1}]};
const payReceivable={...gateReceivable,id:'pay-receivable',orderId:payOrder.id};
const payReceipt={...gatePayment,id:'pay-receipt',recordId:payReceivable.id,currency:'USD'};
const payProduction={...gateProduction,id:'pay-production',orderId:payOrder.id,lines:[payLine],sourceRefs:[{id:payPi.id,version:1}],fields:{...gateProduction.fields,receivableId:payReceivable.id}};
for(const r of [payOrder,payPo,payPi,payShipment,payInvoice,payReceivable,payReceipt,payProduction])put(r);
const payInput={token:uuid(),sourceId:payInvoice.id,sourceVersion:1,type:'paymentrequest',number:'PAY-REQUEST',piId:''};
const financeBeforeRequest=JSON.stringify(rows().filter(r=>['service_record','service_receipt','project_receipt','project_charge'].includes(r.kind)));
const request=(await ok('generate',payInput)).item;
assert.equal(request.lines[0].unitPrice,'863.80');assert.equal(request.billingSummary.receivedCents,37020);assert.equal(request.billingSummary.totalCents,123400);assert.equal((await ok('generate',payInput)).idempotent,true);
await fail('generate',{...payInput,token:uuid(),number:'DUPLICATE-REQUEST'},409);
let payPending=(await ok('submit',{token:uuid(),id:request.id,expectedVersion:1,note:''})).item;
await fail('confirm',{token:uuid(),id:request.id,expectedVersion:payPending.version,note:''},403,service);
await ok('confirm',{token:uuid(),id:request.id,expectedVersion:payPending.version,note:''});
assert.ok((await ok('print?id='+request.id)).includes('Posted net receipts: 370.20'));
assert.equal(JSON.stringify(rows().filter(r=>['service_record','service_receipt','project_receipt','project_charge'].includes(r.kind))),financeBeforeRequest);
// A new real receipt invalidates the old balance; sales assertions alone do not enter this calculation.
put({...payReceivable,version:2});put({...payReceipt,id:'pay-receipt-2',amountCents:1000});
assert.equal((await ok('data')).items.find(r=>r.id===request.id).sourceChanged,true);
assert.ok((await ok('print?id='+request.id)).includes('SOURCE HAS CHANGED'));
const regenerate={...payInput,token:uuid(),targetId:request.id,expectedVersion:find(request.id).version};
const updatedRequest=(await ok('generate',regenerate)).item;assert.equal(updatedRequest.id,request.id);assert.equal(updatedRequest.version,4);assert.equal(updatedRequest.lines[0].unitPrice,'853.80');assert.equal(updatedRequest.status,'draft');assert.equal((await ok('generate',regenerate)).idempotent,true);
assert.equal((await ok('history?id='+request.id)).history.length,4);
for(const [id,patch] of [[payInvoice.id,{lines:[{...payLine,quantity:50}]}],[payProduction.id,{fields:{...payProduction.fields,receivableId:'gate-receivable'}}],[payReceivable.id,{details:{...payReceivable.details,currency:'EUR'}}]]){
 const before=find(id);put({...before,...patch});await fail('generate',{...payInput,token:uuid(),targetId:request.id,expectedVersion:4},400);put(before);
}
put({...payInvoice,id:'pay-extra-invoice',status:'draft'});assert.equal((await ok('data')).items.find(r=>r.id===request.id).sourceChanged,true);await fail('generate',{...payInput,token:uuid(),targetId:request.id,expectedVersion:4},400);db.prepare('DELETE FROM records WHERE id=?').run('pay-extra-invoice');
put({...payReceipt,id:'pay-reversal',entryType:'reversal',amountCents:1});await fail('generate',{...payInput,token:uuid(),targetId:request.id,expectedVersion:4},400);db.prepare('DELETE FROM records WHERE id=?').run('pay-reversal');
const requestSaved={token:uuid(),id:request.id,expectedVersion:4,kind:'document',type:'paymentrequest',customerId:'c1',projectId:'',orderId:payOrder.id,number:updatedRequest.number,fields:updatedRequest.fields,lines:[{...updatedRequest.lines[0],unitPrice:'1.00'}],sourceRefs:updatedRequest.sourceRefs,originRefs:updatedRequest.originRefs};
let alteredRequest=(await ok('save',requestSaved)).item;alteredRequest=(await ok('submit',{token:uuid(),id:request.id,expectedVersion:alteredRequest.version,note:''})).item;await fail('confirm',{token:uuid(),id:request.id,expectedVersion:alteredRequest.version,note:''},409);
console.log('PASS full single-shipment payment request: exact PI/invoice/ledger linkage, actual receipts only, duplicate prevention, immutable regeneration, balance freshness, partial/multiple/reversal rejection and amount tampering blocked');

// Existing quote/internal grants do not convert current customer-service responsibility into cost access.
const engineeringQuote={...gateSource,id:'restricted-engineering-quote',type:'engineering_quote',number:'INTERNAL-ENGINEERING',sourceRefs:[],fields:{currency:'USD',salesReferencePrice:'9.99',notes:'SYNTHETIC INTERNAL COST'},lines:[]};
put(engineeringQuote);put({id:'synthetic-quote-policy',kind:'customer_quote_access',memberIds:[sales.id,service.id],internalMemberIds:[service.id],aliasesByMember:{}});
put({id:'engineering-quote-history',kind:'handoff_business_history',recordId:engineeringQuote.id,customerId:'c1',version:1,snapshot:engineeringQuote});
put({id:'engineering-quote-attachment',kind:'handoff_business_attachment',recordId:engineeringQuote.id,customerId:'c1',filename:'internal.pdf',fileKey:'internal-synthetic'});syntheticFiles.set('internal-synthetic',new TextEncoder().encode('SYNTHETIC INTERNAL COST'));
assert.ok((await ok('data')).items.some(r=>r.id===engineeringQuote.id));assert.ok(!(await ok('data',undefined,service)).items.some(r=>r.id===engineeringQuote.id));
await fail('history?id='+engineeringQuote.id,undefined,403,service);await fail('file?id=engineering-quote-attachment',undefined,403,service);
const quoteSave={...body,token:uuid(),type:'engineering_quote',number:'SERVICE-COST-ATTEMPT',fields:engineeringQuote.fields,lines:[]};await fail('save',quoteSave,403,service);
put({id:'handoff_business_request_'+quoteSave.token,kind:'handoff_business_request',recordId:engineeringQuote.id,actorId:service.id,action:'handoff-business-save',fingerprint:'prior-response',snapshot:engineeringQuote});await fail('save',quoteSave,403,service);
put({...customer,serviceMemberIds:[],serviceName:''});assert.ok(!(await ok('data',undefined,service)).items.some(r=>r.id===engineeringQuote.id));
console.log('PASS engineering quotation scope: existing quote/internal grant pure service cannot read source/history/file/write/replay; original authorized sales retains access');

db.close();
