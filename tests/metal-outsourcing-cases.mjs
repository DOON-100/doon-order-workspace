// Independent acceptance tests: actual workspace handlers, synthetic data and
// in-memory SQLite only. Never import standalone/runtime or a production DB.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {AsyncLocalStorage} from 'node:async_hooks';
import {build} from 'esbuild';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
await fs.mkdir(path.join(root,'test-output'),{recursive:true});
const output=await fs.mkdtemp(path.join(root,'test-output','metal-outsourcing-'));
const db=new DatabaseSync(':memory:');
for(const name of (await fs.readdir(path.join(root,'drizzle'))).filter(n=>n.endsWith('.sql')).sort())db.exec(await fs.readFile(path.join(root,'drizzle',name),'utf8'));
db.prepare("INSERT INTO workspace_revision(id,revision) VALUES('main',0)").run();
class Statement{
 constructor(sql,args=[]){this.sql=sql;this.args=args;}
 bind(...args){return new Statement(this.sql,args);}
 async first(){return db.prepare(this.sql).get(...this.args)||null;}
 async all(){return {results:db.prepare(this.sql).all(...this.args)};}
 async run(){return db.prepare(this.sql).run(...this.args);}
}
const identity=new AsyncLocalStorage(),files=new Map();
globalThis.__metalTestIdentity=identity;
globalThis.__metalTestEnv={DB:{prepare:sql=>new Statement(sql),batch:async statements=>{
 db.exec('BEGIN');try{const result=statements.map(s=>db.prepare(s.sql).run(...s.args));db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}
}},BUCKET:{put:async(key,bytes)=>files.set(key,bytes),get:async key=>files.has(key)?{body:files.get(key)}:null}};
const outfile=path.join(output,'api.mjs');
await build({entryPoints:[path.join(root,'app/api/workspace/[action]/route.ts')],outfile,bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@':root},plugins:[{name:'metal-test-only-bindings',setup(b){
 b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'metal-test'}));
 b.onResolve({filter:/chatgpt-auth$/},()=>({path:'auth',namespace:'metal-test'}));
 b.onLoad({filter:/.*/,namespace:'metal-test'},args=>({contents:args.path==='env'?'export const env=globalThis.__metalTestEnv':'export async function getChatGPTUser(){return globalThis.__metalTestIdentity.getStore()||null}'}));
}}]});
const api=await import(pathToFileURL(outfile));
const moneyFile=path.join(output,'money.mjs');
await build({entryPoints:[path.join(root,'lib/metal-outsourcing-money.ts')],outfile:moneyFile,bundle:true,platform:'node',format:'esm'});
const moneyApi=await import(pathToFileURL(moneyFile));
const at='2026-01-01T00:00:00.000Z',day='2026-11-01',due='2026-11-20';
const member=(id,role='clerk',extra={})=>({id:'metal_test_'+id,kind:'member',userId:'metal_user_'+id,email:id+'@test.invalid',name:'Synthetic '+id,role,active:true,customers:[],orderScope:'assigned',createdAt:at,...extra});
const admin=member('admin','admin'),pmc=member('pmc','pmc'),production=member('production','production'),finance=member('finance','finance');
const operator=member('operator','clerk',{departments:['titanium'],customers:['METAL-A']}),viewer=member('viewer','viewer',{customers:['METAL-A']}),outsider=member('outsider','clerk',{departments:['titanium'],customers:['METAL-B']});
const priceReader=member('price_reader','sales',{customers:['METAL-A']});
const disabled=member('disabled','admin',{active:false}),external=member('external','admin',{personnelType:'external'}),supplierUser=member('supplier','supplier');
const partial=member('partial','clerk',{departments:['titanium']});
const customer=(code)=>({id:'metal_customer_'+code,kind:'customer_account',customer:'Synthetic '+code,customerCode:code,salesName:'',serviceName:'',pmcName:'',active:true,version:1,notes:'',createdAt:at,updatedAt:at,updatedBy:'test'});
const ca=customer('METAL-A'),cb=customer('METAL-B');
const teamA={id:'metal_team_A',kind:'customer_project_team',name:'Synthetic metal group A',active:true,customerIds:[ca.id],leaderIds:[],salesMemberIds:[],serviceMemberIds:[]};
const teamB={...teamA,id:'metal_team_B',name:'Synthetic metal group B',customerIds:[cb.id]};
const sourceOrder=(id,style,color,quantity,extra={})=>({id:'metal_order_'+id,kind:'order',version:1,createdAt:at,updatedAt:at,updatedBy:'synthetic',source:'synthetic-test',orderNo:'METAL-S001',customer:'METAL-A',customerPO:'',drawing:style,color,lens:'',batch:'BATCH-'+id,quantity,requestedDate:due,ownerEmail:operator.email,stage:'生产中',plannedDate:due,shipDate:'',promisedDate:'',promiseConfirmed:false,customerNote:'',arrangement:'',notes:'ORIGINAL_SYNTHETIC_SOURCE_'+id,sourceStatus:'正式订单',extra:{keep:'unchanged'},lifecycle:'active',ledger:{columns:{A:'DOON',I:'METAL-S001',J:style,K:'CLIENT-'+style,L:color,M:String(quantity),U:String(quantity),W:'钛架',AG:'7',AL:'9',BF:'0'},stages:{}},...extra});
const sourceA=[sourceOrder('A1','STYLE-A','C1',100,{ownerEmail:partial.email}),sourceOrder('A2','STYLE-A','C2',200),sourceOrder('A3','STYLE-A','C3',300)];
const sourceB=[sourceOrder('B1','STYLE-B','C1',150),sourceOrder('B2','STYLE-B','C2',250)];
const other=sourceOrder('OTHER','STYLE-A','C1',77,{customer:'METAL-B',ownerEmail:outsider.email}),secondOrder=sourceOrder('SECOND','STYLE-C','C1',50,{orderNo:'METAL-S002'});
const archived=sourceOrder('ARCHIVED','ARCHIVED','C1',900,{lifecycle:'archived'}),cancelled=sourceOrder('CANCELLED','CANCELLED','C1',900,{sourceStatus:'已取消'}),factoryExternal=sourceOrder('FACTORY_EXTERNAL','FACTORY_EXTERNAL','C1',900,{ledger:{columns:{A:'SYNTHETIC OTHER FACTORY'},stages:{}}});
const process={id:'metal_catalog_process',kind:'outsourcing_catalog_entry',category:'process',code:'TEST-WELD-POLISH',name:'Synthetic weld and polish',actions:['焊接','打磨'],ownerDepartment:'titanium',productFamily:'金属架',processingObject:'中梁',statProcess:'焊接',includeCost:'是',active:true,version:1};
const process2={...process,id:'metal_catalog_process2',code:'TEST-POLISH',name:'Synthetic polish',actions:['打磨']};
const supplier={id:'metal_supplier',kind:'supplier',name:'Synthetic Metal Supplier',active:true,status:'正常',version:1};
const supplier2={...supplier,id:'metal_supplier_2',name:'Synthetic Other Supplier'};
const stockEvidence={id:'metal_stock_evidence',kind:'attachment',lineId:sourceA[0].id,filename:'synthetic-production-transfer.txt',fileKey:'synthetic/production-transfer.txt',createdAt:at};
const stockEvidenceC={...stockEvidence,id:'metal_stock_evidence_C',lineId:secondOrder.id,fileKey:'synthetic/production-transfer-C.txt'};
files.set(stockEvidence.fileKey,new TextEncoder().encode('Synthetic production transfer evidence; not a real stock receipt.'));
files.set(stockEvidenceC.fileKey,new TextEncoder().encode('Synthetic second-order production transfer evidence.'));
const rawPut=r=>db.prepare('INSERT INTO records(id,kind,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,data=excluded.data').run(r.id,r.kind,JSON.stringify(r));
const syntheticSourceChange=r=>{rawPut(r);db.prepare("UPDATE workspace_revision SET revision=revision+1 WHERE id='main'").run();};
for(const r of [admin,pmc,production,finance,operator,viewer,outsider,priceReader,disabled,external,supplierUser,partial,ca,cb,teamA,teamB,...sourceA,...sourceB,other,secondOrder,archived,cancelled,factoryExternal,process,process2,supplier,supplier2,stockEvidence,stockEvidenceC])rawPut(r);
const raw=()=>db.prepare('SELECT data FROM records ORDER BY id').all().map(r=>JSON.parse(r.data));
const row=id=>raw().find(r=>r.id===id);
const originalRows=new Map(db.prepare('SELECT id,data FROM records ORDER BY id').all().map(r=>[r.id,r.data]));
const revision=()=>db.prepare("SELECT revision FROM workspace_revision WHERE id='main'").get().revision;
const serialized=()=>JSON.stringify(db.prepare('SELECT id,kind,data FROM records ORDER BY id').all());
const token=()=>crypto.randomUUID();
let checks=0;const pass=name=>{checks++;console.log('PASS '+name);};
async function call(action,body,who=admin,teamId=''){
 const method=body===undefined?'GET':'POST';
 return identity.run(who,()=>api[method](new Request('https://metal.test/api/workspace/'+action,{method,headers:{'Content-Type':'application/json',...(teamId?{'X-Workspace-Team':teamId}:{})},body:body===undefined?undefined:JSON.stringify(body)}),{params:Promise.resolve({action:action.split('?')[0]})}));
}
async function ok(action,body,who=admin,teamId=''){
 const res=await call(action,body,who,teamId),data=await res.json();assert.equal(res.status,200,action+': '+JSON.stringify(data));return data;
}
const read=(who=admin,teamId='')=>ok('metal-outsourcing',undefined,who,teamId);
async function write(action,body,who=admin,teamId=''){return ok(action,{...body,token:body.token||token()},who,teamId);}
async function rejected(action,body,who=admin,teamId='',statuses=[400,403,404,409]){
 const before=serialized(),rev=revision(),res=await call(action,body===undefined?undefined:{...body,token:body.token||token()},who,teamId);
 const detail=await res.text();assert(statuses.includes(res.status),action+' expected rejection, got '+res.status+': '+detail);
 assert.equal(serialized(),before,action+' must validate before changing any record');assert.equal(revision(),rev,action+' rejection must not bump revision');return res.status;
}
function preserveSources(){for(const [id,data] of originalRows)assert.equal(db.prepare('SELECT data FROM records WHERE id=?').get(id)?.data,data,'original source changed: '+id);}
const fresh=id=>({id,version:row(id).version});
const balance=async id=>(await read()).balances.find(b=>b.demandId===id);

try{
 assert.equal(moneyApi.metalChargeAmount(1,1.005),1.01);
 assert.equal(moneyApi.metalChargeAmount(300,1234.5,0.001),370.35);
 assert.equal(moneyApi.metalNetAmount(-1.01,0.13),-0.89);
 assert.throws(()=>moneyApi.metalChargeAmount(1e-9,1),RangeError);
 pass('shared server/print decimal calculator rounds half cents correctly, preserves pricing conversion and handles signed tax adjustments without floating-point drift');
 assert.equal((await call('metal-outsourcing',undefined,null)).status,401);
 for(const user of [disabled,external,supplierUser])await rejected('metal-outsourcing',undefined,user,'',[403]);
 pass('anonymous, disabled, external and supplier identities cannot use internal metal operations');

 const initial=await read(),groupA=initial.sourceGroups.find(g=>g.orderNo==='METAL-S001'&&g.customer==='METAL-A'&&g.style==='STYLE-A'),groupB=initial.sourceGroups.find(g=>g.orderNo==='METAL-S001'&&g.customer==='METAL-A'&&g.style==='STYLE-B');
 assert(groupA&&groupB,'all active internal source groups are exposed');assert.equal(groupA.quantity,600);assert.equal(groupA.lines.length,3);assert.equal(groupB.quantity,400);assert.equal(groupB.lines.length,2);
 assert.deepEqual(new Set(groupA.lines.map(l=>l.lineId)),new Set(sourceA.map(l=>l.id)));
 for(const excluded of [archived,cancelled,factoryExternal])assert(!initial.sourceGroups.some(g=>g.lines.some(l=>l.lineId===excluded.id)),excluded.id+' must not become new metal demand');
 assert.equal((await read(operator,teamA.id)).sourceGroups.length,3);
 await rejected('metal-outsourcing',undefined,operator,teamB.id,[403]);
 assert(!(await read(outsider)).sourceGroups.some(g=>g.customer==='METAL-A'));
 const partialRead=await read(partial);assert(!JSON.stringify(partialRead).includes(sourceA[1].id));assert(!JSON.stringify(partialRead).includes(sourceA[2].id));
 pass('source groups sum every same-order/style SKU without a color choice and retain customer, lifecycle and team boundaries');

 const partInput={code:'SYN-P001',name:'Synthetic bridge',specification:'18mm titanium',material:'titanium',side:'center',unit:'粒',revision:'A',active:true,note:'approved synthetic component identity'};
 const part=(await write('metal-part-save',{version:0,part:partInput})).id;
 const partOther=(await write('metal-part-save',{version:0,part:{...partInput,code:'SYN-P002',specification:'20mm titanium'}})).id;
 await rejected('metal-part-save',{id:part,version:0,part:{...partInput,name:'stale name'}});
 const bomLine=(partId,unitsPerProduct=1,processId=process.id)=>({partId,partVersion:row(partId).version,processId,processVersion:1,unitsPerProduct,requirements:'Synthetic acceptance requirements'});
 async function bom(group,lines,approve=true){const id=(await write('metal-bom-create',{groupKey:group.key,revision:'BOM-A',reference:'Synthetic engineering-approved BOM document',lines})).id;if(approve)await write('metal-bom-approve',fresh(id));return row(id);}
 const draft=await bom(groupA,[bomLine(part)],false);
 const versions=g=>g.lines.map(({lineId,version})=>({lineId,version}));
 const planInput=(b,g,quantity)=>({bomId:b.id,bomVersion:b.version,sourceVersions:versions(g),quantity,dueDate:due,note:'Synthetic PMC-approved batch'});
 await rejected('metal-plan-create',planInput(draft,groupA,600));
 await write('metal-bom-approve',fresh(draft.id));
 const bomA=row(draft.id),bomB=await bom(groupB,[bomLine(part,2),bomLine(partOther,1)]);
 await rejected('metal-plan-create',{...planInput(bomA,groupA,600),sourceVersions:versions(groupA).slice(0,1)});
 await rejected('metal-plan-create',{...planInput(bomA,groupA,600),sourceVersions:versions(groupA).map((r,i)=>({...r,version:i? r.version:0}))});
 await rejected('metal-plan-create',planInput(bomA,groupA,601));
 const planA=(await write('metal-plan-create',planInput(bomA,groupA,600))).id,planB=(await write('metal-plan-create',planInput(bomB,groupB,400))).id;
 const groupC=initial.sourceGroups.find(g=>g.orderNo==='METAL-S002'),bomC=await bom(groupC,[bomLine(part)]),planC=(await write('metal-plan-create',planInput(bomC,groupC,50))).id;
 await rejected('metal-plan-create',planInput(bomA,groupA,1));
 pass('approved BOM and all source versions gate PMC plans; units per product are explicit and plans cannot re-reserve source quantities');

 const contribution=(planId,bomLineId,quantity)=>({planId,planVersion:row(planId).version,bomLineId,quantity});
 const sa=contribution(planA,bomA.lines[0].id,600),sb=contribution(planB,bomB.lines[0].id,800);
 await rejected('metal-demand-create',{sources:[sa,contribution(planC,bomC.lines[0].id,50)],dueDate:due,note:'cross-order aggregation must remain separate'});
 await rejected('metal-demand-create',{sources:[sa,contribution(planB,bomB.lines[1].id,400)],dueDate:due,note:''});
 await rejected('metal-demand-create',{sources:[sa,{...sa,quantity:1}],dueDate:due,note:''});
 await rejected('metal-demand-create',{sources:[{...sb,quantity:801}],dueDate:due,note:''});
 const demand=(await write('metal-demand-create',{sources:[sa,sb],dueDate:due,note:'Same-order shared component across two styles'})).id;
 assert.equal(row(demand).quantity,1400);assert.equal(row(demand).unit,'粒');assert.equal(row(demand).sources.length,2);assert.equal(row(demand).sourceLineIds.length,5);
 assert.deepEqual(row(demand).sources.map(s=>s.quantity).sort((a,b)=>a-b),[600,800]);
 await rejected('metal-demand-create',{sources:[{...sa,quantity:1}],dueDate:due,note:''});
 await rejected('metal-plan-cancel',{...fresh(planA),reason:'cannot cancel consumed plan'});
 pass('same-order cross-style shared components retain 600/800 allocations, distinguish same-name parts and prevent repeated demand reservations');

 const quoteInput={supplierId:supplier.id,partId:part,partVersion:row(part).version,processId:process.id,processVersion:1,requirements:'Synthetic acceptance requirements',pricingUnit:'千粒',pricingFactor:0.001,priceIncTax:1234.5,taxRate:0.13,currency:'CNY',validFrom:'2026-01-01',validTo:'2027-12-31',qtyFrom:1,qtyTo:2000,freeReason:'',reference:'Synthetic approved thousand-piece quotation'};
 await rejected('metal-quote-create',{...quoteInput,priceIncTax:null});
 await rejected('metal-quote-create',{...quoteInput,priceIncTax:0,freeReason:''});
 await rejected('metal-quote-create',{...quoteInput,pricingFactor:1e-9});
 const quote=(await write('metal-quote-create',quoteInput)).id;
 const jobInput=(quoteId=quote,quantity=1400)=>({date:day,lines:[{demandId:demand,demandVersion:row(demand).version,quantity,quoteId,quoteVersion:row(quoteId).version}],note:'Synthetic combined component job'});
 await rejected('metal-job-create',jobInput());
 await rejected('metal-quote-approve',fresh(quote),operator,'',[403]);
 await write('metal-quote-approve',fresh(quote));
 const wrongQuote=(await write('metal-quote-create',{...quoteInput,processId:process2.id})).id;
 await write('metal-quote-approve',fresh(wrongQuote));
 await rejected('metal-job-create',jobInput(wrongQuote));
 const expired=(await write('metal-quote-create',{...quoteInput,validFrom:'2025-01-01',validTo:'2025-12-31'})).id;
 await write('metal-quote-approve',fresh(expired));
 await rejected('metal-job-create',jobInput(expired));
 await rejected('metal-job-create',{...jobInput(quote,100),lines:[...jobInput(quote,100).lines,{...jobInput(quote,100).lines[0],demandId:'synthetic-missing-demand'}]});
 const cancelledJob=(await write('metal-job-create',jobInput(quote,100))).id;
 await write('metal-job-cancel',{...fresh(cancelledJob),reason:'Synthetic unexecuted reservation release'});
 const jobToken=token(),jobBody={...jobInput(),token:jobToken};
 const jobResult=await write('metal-job-create',jobBody),job=jobResult.id;
 const afterJob=serialized();assert.deepEqual(await write('metal-job-create',jobBody),jobResult);assert.equal(serialized(),afterJob,'identical retry must not create another job or audit');
 await rejected('metal-job-create',{...jobBody,note:'same token, different business payload'});
 await rejected('metal-job-create',jobBody,outsider,'',[403,409]);
 await rejected('metal-job-create',jobBody,admin,teamB.id,[409]);
 await rejected('metal-job-create',jobInput(quote,1));
 const newer=(await write('metal-quote-create',{...quoteInput,priceIncTax:9999,reference:'Synthetic later-price version'})).id;
 await write('metal-quote-approve',fresh(newer));
 assert.equal(row(job).lines[0].quote.priceIncTax,1234.5);assert.equal(row(job).lines[0].quote.pricingFactor,0.001);
 pass('pre-approved matching price is mandatory; blank/unsupported zero, expired and wrong-process prices fail, while retries and later prices preserve the adopted snapshot');

 // A draft or printed delivery never changes dispatched totals. Physical stock
 // uses an existing source attachment, not the sales quantity as stock proof.
 const stockInput={demandId:demand,demandVersion:row(demand).version,quantity:1400,date:day,reference:'SYN-TRANSFER-LINE-1',evidenceAttachmentId:stockEvidence.id,note:'Synthetic production transfer'};
 await rejected('metal-stock-add',{...stockInput,evidenceAttachmentId:'synthetic-missing-evidence'});
 const stock=(await write('metal-stock-add',stockInput)).id;
 assert.equal(row(stock).status,'draft');assert.equal((await balance(demand)).stockAvailable,0);
 await rejected('metal-stock-add',stockInput);
 const deliveryInput=(quantity)=>({date:day,dueDate:due,lines:[{jobId:job,jobVersion:row(job).version,jobLineId:row(job).lines[0].id,quantity}],reference:'SYN-DELIVERY-'+quantity,note:'Synthetic supplier signature copy'});
 const delivery=(await write('metal-delivery-create',deliveryInput(500))).id;
 assert.equal((await balance(demand)).dispatched,0);
 const beforePrint=serialized();await read();await read();assert.equal(serialized(),beforePrint,'GET/printing must never count as dispatch');
 await rejected('metal-delivery-dispatch',{id:delivery,version:0});
 await rejected('metal-delivery-dispatch',fresh(delivery));
 await write('metal-stock-confirm',fresh(stock));
 const dispatchVersion=fresh(delivery),simultaneous=await Promise.all([call('metal-delivery-dispatch',{...dispatchVersion,token:token()}),call('metal-delivery-dispatch',{...dispatchVersion,token:token()})]);
 assert.deepEqual(simultaneous.map(r=>r.status).sort(),[200,409],'concurrent dispatch must publish once');
 assert.equal((await balance(demand)).dispatched,500);
 await rejected('metal-delivery-dispatch',fresh(delivery));
 await rejected('metal-delivery-create',deliveryInput(901));
 const delivery2=(await write('metal-delivery-create',deliveryInput(900))).id;
 // Simulate edits made by another workflow in this in-memory source database.
 // Ordinary notes/progress revisions must not invalidate a frozen quantity plan;
 // real source quantity/SKU changes must still fail before any metal write.
 const notedSource={...sourceA[0],version:2,notes:'Synthetic unrelated note update',ledger:{...sourceA[0].ledger,columns:{...sourceA[0].ledger.columns,AG:'8'}}};
 syntheticSourceChange({...notedSource,version:3,quantity:101});
 await rejected('metal-delivery-dispatch',fresh(delivery2),admin,'',[409]);
 syntheticSourceChange(notedSource);
 const newSku=sourceOrder('NEW_SKU','STYLE-A','C4',10);syntheticSourceChange(newSku);
 await rejected('metal-delivery-dispatch',fresh(delivery2),admin,'',[409]);
 db.prepare('DELETE FROM records WHERE id=?').run(newSku.id);db.prepare("UPDATE workspace_revision SET revision=revision+1 WHERE id='main'").run();
 await write('metal-delivery-dispatch',fresh(delivery2));
 assert.deepEqual(row(notedSource.id),notedSource,'dispatch must not edit the source notes or progress either');
 syntheticSourceChange(sourceA[0]);
 assert.equal((await balance(demand)).dispatched,1400);
 await rejected('metal-demand-cancel',{...fresh(demand),reason:'cannot erase already dispatched demand'});
 await rejected('metal-job-cancel',{...fresh(job),reason:'cannot erase physical history'});
 await write('metal-delivery-sign',{...fresh(delivery),signedAt:day,signedBy:'Synthetic supplier receiver',reference:'SYN-SIGNATURE-1'});
 assert.equal((await balance(demand)).dispatched,1400);
 pass('production stock supports partial deliveries; unrelated note/progress versions remain usable, changed quantities or SKU sets block dispatch, and drafts/reads/signatures cannot double-count physical facts');

 const receiptInput=(quantity,reference)=>({deliveryId:delivery,deliveryVersion:row(delivery).version,deliveryLineId:row(delivery).lines[0].id,quantity,date:day,reference,note:'Synthetic physical receipt'});
 await rejected('metal-receipt-create',{...receiptInput(1,'SYN-EARLY-RECEIPT'),date:'2026-10-31'});
 const receipt=(await write('metal-receipt-create',receiptInput(350,'SYN-RECEIPT-1'))).id;
 let balances=await balance(demand);assert.equal(balances.received,350);assert.equal(balances.pendingQc,350);assert.equal(balances.availableGood,0);
 await rejected('metal-receipt-create',receiptInput(151,'SYN-OVER-RECEIPT'));
 const qcInput=(receiptId,billableGood,freeGood,bad)=>({receiptId,receiptVersion:row(receiptId).version,date:day,billableGood,freeGood,bad,note:'Synthetic independent quality classification'});
 await rejected('metal-quality-create',qcInput(receipt,351,0,0));
 const qc=(await write('metal-quality-create',qcInput(receipt,300,20,30))).id;
 assert.equal(row(qc).amountIncTax,370.35);assert.equal(row(qc).amountExTax,327.74);
 await rejected('metal-quality-create',qcInput(receipt,300,20,30));
 const following=[];
 for(let n=2;n<=6;n++){
  const id=(await write('metal-receipt-create',receiptInput(30,'SYN-RECEIPT-'+n))).id;
  following.push((await write('metal-quality-create',qcInput(id,30,0,0))).id);
 }
 assert.equal(raw().filter(r=>r.kind==='metal_receipt'&&r.deliveryId===delivery).length,6);
 balances=await balance(demand);assert.equal(balances.received,500);assert.equal(balances.pendingQc,0);assert.equal(balances.billableGood,450);assert.equal(balances.freeGood,20);assert.equal(balances.availableGood,470);assert.equal(balances.inTransit,900);
 await rejected('metal-receipt-create',receiptInput(1,'SYN-OVER-RECEIPT-AFTER-SIX'));
 preserveSources();
 pass('six separate receipts survive; physical receipts include bad goods while QC, billable good, free good and remaining transit are distinct and source production stays unchanged');

 const rework=(await write('metal-rework-create',{qcId:qc,qcVersion:row(qc).version,quantity:30,date:day,dueDate:due,freeReason:'Supplier-responsible free rework',reference:'SYN-REWORK-1',note:'No new sales demand'})).id;
 if(row(rework).status==='draft')await write('metal-delivery-dispatch',fresh(rework));
 await rejected('metal-rework-create',{qcId:qc,qcVersion:row(qc).version,quantity:1,date:day,dueDate:due,freeReason:'Already allocated bad quantity',reference:'SYN-REWORK-OVER',note:''});
 const reworkReceipt=(await write('metal-receipt-create',{deliveryId:rework,deliveryVersion:row(rework).version,deliveryLineId:row(rework).lines[0].id,quantity:30,date:day,reference:'SYN-REWORK-RETURN',note:''})).id;
 await rejected('metal-quality-create',qcInput(reworkReceipt,31,0,0));
 const reworkQc=(await write('metal-quality-create',qcInput(reworkReceipt,30,0,0))).id;
 assert.equal(row(reworkQc).originalAmountIncTax,37.04);assert.equal(row(reworkQc).reworkAmountIncTax,0);assert.equal(row(reworkQc).amountIncTax,37.04);
 assert.equal(raw().filter(r=>r.kind==='metal_demand').length,1);
 balances=await balance(demand);assert.equal(balances.availableGood,500);assert.equal(balances.inTransit,900);
 pass('free rework uses a separate physical leg and charges the original process once only when goods pass, with no additional rework fee or duplicated sales demand');

 const issueInput=(quantity,planId=planA,qcId=qc)=>({qcId,qcVersion:row(qcId).version,planId,planVersion:row(planId).version,quantity,date:day,reference:'SYN-ISSUE-'+planId+'-'+quantity,note:'Actual component issue, not finished production'});
 const issueToken=token(),issueBody={...issueInput(200),token:issueToken},issueA=await write('metal-issue-create',issueBody);
 const afterIssue=serialized();assert.deepEqual(await write('metal-issue-create',issueBody),issueA);assert.equal(serialized(),afterIssue);
 const issueB=(await write('metal-issue-create',issueInput(120,planB))).id;
 await rejected('metal-issue-create',issueInput(1));
 assert.equal(row(issueA.id).quantity+row(issueB).quantity,320);assert.equal(Math.round((row(issueA.id).amountIncTax+row(issueB).amountIncTax)*100),37035);
 assert.equal((await balance(demand)).availableGood,180);assert.equal((await balance(demand)).issued,320);
 preserveSources();
 pass('actual issues share one qualified pool, retry once only, prevent double allocation and distribute the component cost once to the two styles');

 const allQc=[qc,...following,reworkQc];
 const settlement=(await write('metal-settlement-create',{qcIds:allQc,period:'2026-11',reference:'SYN-RECONCILIATION',note:'Synthetic supplier reconciliation'})).id;
 assert.equal(row(settlement).amountIncTax,592.59);assert.equal(row(settlement).amountExTax,524.42);
 await rejected('metal-settlement-create',{qcIds:[qc],period:'2026-11',reference:'SYN-DUPLICATE-RECONCILIATION',note:''});
 await rejected('metal-payment-create',{settlementId:settlement,settlementVersion:row(settlement).version,amount:1,date:day,reference:'SYN-EARLY-PAY',note:''});
 await write('metal-settlement-confirm',fresh(settlement));
 await rejected('metal-settlement-create',{qcIds:[qc],period:'2026-12',reference:'SYN-LATER-DUPLICATE',note:''});
 const paid=(await write('metal-payment-create',{settlementId:settlement,settlementVersion:row(settlement).version,amount:200,date:day,reference:'SYN-PAY-1',note:''})).id;
 assert.equal(row(paid).amount,200);
 await rejected('metal-payment-create',{settlementId:settlement,settlementVersion:row(settlement).version,amount:392.60,date:day,reference:'SYN-OVER-PAY',note:''});
 await write('metal-payment-create',{settlementId:settlement,settlementVersion:row(settlement).version,amount:392.59,date:day,reference:'SYN-PAY-2',note:''});
 await rejected('metal-payment-create',{settlementId:settlement,settlementVersion:row(settlement).version,amount:0.01,date:day,reference:'SYN-EXTRA-PAY',note:''});
 pass('line-level rounding survives monthly totals; QC charges cannot settle twice and payments require confirmed debt and cannot exceed it');

 // A later physical batch exercises paid rework, a second failed round, and bad
 // goods disposition without modifying the already-confirmed first statement.
 const lateReceipt=(await write('metal-receipt-create',{deliveryId:delivery2,deliveryVersion:row(delivery2).version,deliveryLineId:row(delivery2).lines[0].id,quantity:100,date:day,reference:'SYN-LATER-BAD-RECEIPT',note:''})).id;
 const lateBad=(await write('metal-quality-create',qcInput(lateReceipt,0,0,100))).id;
 assert.equal(row(lateBad).amountIncTax,0);
 const paidQuote=(await write('metal-quote-create',{...quoteInput,priceIncTax:200,reference:'Synthetic additional rework price'})).id;
 await write('metal-quote-approve',fresh(paidQuote));
 const paidRework=(await write('metal-rework-create',{qcId:lateBad,qcVersion:row(lateBad).version,quantity:40,date:day,dueDate:due,quoteId:paidQuote,quoteVersion:row(paidQuote).version,freeReason:'',reference:'SYN-PAID-REWORK',note:''})).id;
 await write('metal-delivery-dispatch',fresh(paidRework));
 const receiveRework=async(id,quantity,reference)=>(await write('metal-receipt-create',{deliveryId:id,deliveryVersion:row(id).version,deliveryLineId:row(id).lines[0].id,quantity,date:day,reference,note:''})).id;
 const paidReceipt=await receiveRework(paidRework,40,'SYN-PAID-REWORK-RETURN'),paidQc=(await write('metal-quality-create',qcInput(paidReceipt,30,0,10))).id;
 assert.equal(row(paidQc).originalAmountIncTax,37.04);assert.equal(row(paidQc).reworkAmountIncTax,6);assert.equal(row(paidQc).amountIncTax,43.04);
 const secondRework=(await write('metal-rework-create',{qcId:paidQc,qcVersion:row(paidQc).version,quantity:10,date:day,dueDate:due,freeReason:'Supplier-responsible second rework',reference:'SYN-SECOND-REWORK',note:''})).id;
 await write('metal-delivery-dispatch',fresh(secondRework));
 const secondReceipt=await receiveRework(secondRework,10,'SYN-SECOND-REWORK-RETURN'),secondQc=(await write('metal-quality-create',qcInput(secondReceipt,10,0,0))).id;
 assert.equal(row(secondQc).originalAmountIncTax,12.35);assert.equal(row(secondQc).reworkAmountIncTax,0);assert.equal(row(secondQc).amountIncTax,12.35);
 const disposition=(await write('metal-disposition-create',{qcId:lateBad,qcVersion:row(lateBad).version,quantity:60,date:day,type:'scrap',reason:'Synthetic approved bad-goods disposition',reference:'SYN-SCRAP-60'})).id;
 assert.equal(row(disposition).quantity,60);
 await rejected('metal-disposition-create',{qcId:lateBad,qcVersion:row(lateBad).version,quantity:1,date:day,type:'scrap',reason:'Already disposed',reference:'SYN-SCRAP-OVER'});
 await rejected('metal-rework-create',{qcId:lateBad,qcVersion:row(lateBad).version,quantity:1,date:day,dueDate:due,freeReason:'already disposed',reference:'SYN-REWORK-AFTER-SCRAP',note:''});
 assert.equal(row(settlement).amountIncTax,592.59);assert.equal((await balance(demand)).dispatched,1400);assert.equal((await balance(demand)).bad,0);
 preserveSources();
 pass('paid and repeated rework preserve original charge identity; only passing quantities incur each adopted fee, bad disposition cannot be reused and closed statements remain fixed');

 const adjustment=(await write('metal-adjustment-create',{qcId:paidQc,qcVersion:row(paidQc).version,amountIncTax:-1.01,reason:'Synthetic agreed quality deduction',reference:'SYN-DEDUCTION'})).id;
 const adjustedStatement={qcIds:[paidQc,secondQc],adjustmentIds:[adjustment],period:'2026-11',reference:'SYN-ADJUSTED-RECONCILIATION',note:''};
 await rejected('metal-settlement-create',adjustedStatement);
 await rejected('metal-adjustment-approve',fresh(adjustment),viewer,'',[403]);
 await write('metal-adjustment-approve',fresh(adjustment));
 const laterSettlement=(await write('metal-settlement-create',adjustedStatement)).id;
 assert.equal(row(laterSettlement).amountIncTax,54.38);assert.equal(row(laterSettlement).amountExTax,48.13);
 await write('metal-settlement-confirm',fresh(laterSettlement));
 await rejected('metal-settlement-create',adjustedStatement);
 await rejected('metal-correction',{targetId:qc,targetVersion:row(qc).version,reason:'Cannot erase invoiced and issued QC',reference:'SYN-BLOCKED-CORRECTION'});
 const receiptBeforeCorrection=(await balance(demand)).received;
 const correctableReceipt=(await write('metal-receipt-create',{deliveryId:delivery2,deliveryVersion:row(delivery2).version,deliveryLineId:row(delivery2).lines[0].id,quantity:5,date:day,reference:'SYN-CORRECTABLE-RECEIPT',note:''})).id;
 await write('metal-correction',{targetId:correctableReceipt,targetVersion:row(correctableReceipt).version,reason:'Synthetic mistaken receipt with no downstream facts',reference:'SYN-RECEIPT-REVERSAL'});
 assert.equal(row(correctableReceipt).voided,true);assert.equal((await balance(demand)).received,receiptBeforeCorrection);
 assert(raw().some(r=>r.kind==='metal_correction'&&r.targetId===correctableReceipt));
 preserveSources();
 pass('deductions require approval and settle once; corrections retain the original fact and reversal evidence while refusing downstream-dependent QC removal');

 const demandC=(await write('metal-demand-create',{sources:[contribution(planC,bomC.lines[0].id,50)],dueDate:due,note:'Synthetic release and repricing test'})).id;
 const cJobInput=(quantity,quoteId=quote)=>({date:day,lines:[{demandId:demandC,demandVersion:row(demandC).version,quantity,quoteId,quoteVersion:row(quoteId).version}],note:''});
 const jobC=(await write('metal-job-create',cJobInput(50))).id;
 const stockC=(await write('metal-stock-add',{demandId:demandC,demandVersion:row(demandC).version,quantity:50,date:day,reference:'SYN-TRANSFER-C',evidenceAttachmentId:stockEvidenceC.id,note:''})).id;
 await write('metal-stock-confirm',fresh(stockC));
 const cDeliveryInput=(jobId,quantity)=>({date:day,dueDate:due,lines:[{jobId,jobVersion:row(jobId).version,jobLineId:row(jobId).lines[0].id,quantity}],reference:'SYN-C-DELIVERY-'+quantity,note:''});
 const deliveryC=(await write('metal-delivery-create',cDeliveryInput(jobC,20))).id;
 await write('metal-delivery-dispatch',fresh(deliveryC));
 const receiptC=(await write('metal-receipt-create',{deliveryId:deliveryC,deliveryVersion:row(deliveryC).version,deliveryLineId:row(deliveryC).lines[0].id,quantity:5,date:day,reference:'SYN-C-RECEIPT',note:''})).id;
 const qcC=(await write('metal-quality-create',qcInput(receiptC,5,0,0))).id;
 const draftC=(await write('metal-delivery-create',cDeliveryInput(jobC,5))).id;
 const oldFacts=new Map([jobC,deliveryC,receiptC,qcC].map(id=>[id,JSON.stringify(row(id))]));
 const releaseInput={jobId:jobC,jobVersion:row(jobC).version,jobLineId:row(jobC).lines[0].id,quantity:25,reason:'Synthetic remaining quantity changes supplier and price',reference:'SYN-JOB-RELEASE-C'};
 await rejected('metal-job-release',{...releaseInput,quantity:26});
 const releaseBodies=[{...releaseInput,token:token()},{...releaseInput,token:token()}],releaseResponses=await Promise.all(releaseBodies.map(body=>call('metal-job-release',body)));
 assert.deepEqual(releaseResponses.map(r=>r.status).sort(),[200,409]);
 const winningIndex=releaseResponses.findIndex(r=>r.status===200),released=await releaseResponses[winningIndex].json();
 const afterRelease=serialized();assert.deepEqual(await write('metal-job-release',releaseBodies[winningIndex]),released);assert.equal(serialized(),afterRelease);
 assert.equal((await balance(demandC)).reserved,25);
 await rejected('metal-job-release',{...releaseInput,quantity:1,reference:'SYN-RELEASE-OVER'});
 await rejected('metal-delivery-create',cDeliveryInput(jobC,1));
 const replacementQuote=(await write('metal-quote-create',{...quoteInput,supplierId:supplier2.id,priceIncTax:2000,reference:'Synthetic replacement supplier and price'})).id;
 await write('metal-quote-approve',fresh(replacementQuote));
 const replacementJob=(await write('metal-job-create',cJobInput(25,replacementQuote))).id;
 await rejected('metal-job-create',cJobInput(1,replacementQuote));
 const replacementDelivery=(await write('metal-delivery-create',cDeliveryInput(replacementJob,25))).id;
 await write('metal-delivery-dispatch',fresh(replacementDelivery));
 await write('metal-delivery-dispatch',fresh(draftC));
 assert.equal((await balance(demandC)).dispatched,50);assert.equal((await balance(demandC)).reserved,50);
 for(const [id,before] of oldFacts)assert.equal(JSON.stringify(row(id)),before,'releasing unused quantity must not rewrite sent, receipt, quality or price history');
 assert.equal(raw().filter(r=>r.kind==='metal_job_release'&&r.jobId===jobC).length,1);
 preserveSources();
 pass('unused job quantity releases once under concurrency, excludes draft shipments, permits a replacement supplier/price without exceeding demand and preserves all previously executed facts');

 const tierDemand=(await write('metal-demand-create',{sources:[contribution(planB,bomB.lines[1].id,400)],dueDate:due,note:'Synthetic minimum-price tier'})).id;
 const tierQuote=(await write('metal-quote-create',{...quoteInput,partId:partOther,partVersion:row(partOther).version,qtyFrom:300,reference:'Synthetic 300-piece minimum price'})).id;
 await write('metal-quote-approve',fresh(tierQuote));
 const tierJob=(await write('metal-job-create',{date:day,lines:[{demandId:tierDemand,demandVersion:row(tierDemand).version,quantity:400,quoteId:tierQuote,quoteVersion:row(tierQuote).version}],note:''})).id;
 const frozenTierJob=JSON.stringify(row(tierJob)),tierRelease={jobId:tierJob,jobVersion:row(tierJob).version,jobLineId:row(tierJob).lines[0].id,quantity:101,reason:'Synthetic tier guard',reference:'SYN-TIER-RELEASE'};
 await rejected('metal-job-release',tierRelease,admin,'',[409]);
 assert.equal(JSON.stringify(row(tierJob)),frozenTierJob);
 await write('metal-job-release',{...tierRelease,quantity:100});
 assert.equal((await balance(tierDemand)).reserved,300);assert.equal(JSON.stringify(row(tierJob)),frozenTierJob);
 await rejected('metal-job-release',{...tierRelease,quantity:1,reference:'SYN-TIER-RELEASE-BELOW-MINIMUM'},admin,'',[409]);
 pass('quantity release may reach but never cross the adopted price minimum; frozen prices and prior job facts are never repriced');

 const privateQuote=(await write('metal-quote-create',{...quoteInput,reference:'SYN-TEAM-B-PRIVATE-QUOTE'},admin,teamB.id)).id;
 const priceReaderData=await read(priceReader);assert.equal(priceReaderData.permissions.price,true);assert(!priceReaderData.quotes.some(q=>q.id===privateQuote),'unselected team must not expose another visible-price-role customer team quote');
 assert(!(await read(priceReader,teamA.id)).quotes.some(q=>q.id===privateQuote));
 assert((await read(admin,teamB.id)).quotes.some(q=>q.id===privateQuote));
 const publicData=await read(viewer),outsiderData=await read(outsider),otherTeamData=await read(admin,teamB.id);
 assert(!JSON.stringify(outsiderData).includes(demand));assert(!JSON.stringify(otherTeamData).includes(demand));
 for(const key of ['priceIncTax','taxRate','amountIncTax','amountExTax','originalAmountIncTax','originalAmountExTax','reworkAmountIncTax','reworkAmountExTax','pricingFactor'])assert(!JSON.stringify(publicData).includes('"'+key+'"'),'price-blind reader leaked '+key);
 const forbiddenInputs={
  'metal-part-save':{version:0,part:{...partInput,code:'SYN-FORBIDDEN'}},
  'metal-bom-create':{groupKey:groupA.key,revision:'SYN-FORBIDDEN',reference:'Synthetic evidence',lines:[bomLine(part)]},
  'metal-plan-create':planInput(bomA,groupA,1),
  'metal-demand-create':{sources:[{...sa,quantity:1}],dueDate:due,note:''},
  'metal-quote-create':quoteInput,'metal-job-create':jobInput(quote,1),
  'metal-stock-add':stockInput,'metal-delivery-create':deliveryInput(1),
  'metal-receipt-create':receiptInput(1,'SYN-FORBIDDEN'),
  'metal-quality-create':qcInput(receipt,300,20,30),
  'metal-rework-create':{qcId:qc,qcVersion:row(qc).version,quantity:1,date:day,dueDate:due,freeReason:'Synthetic reason',reference:'SYN-FORBIDDEN',note:''},
  'metal-issue-create':issueInput(1),
  'metal-settlement-create':{qcIds:[qc],period:'2026-11',reference:'SYN-FORBIDDEN',note:''},
  'metal-payment-create':{settlementId:settlement,settlementVersion:row(settlement).version,amount:1,date:day,reference:'SYN-FORBIDDEN',note:''}
 };
 for(const [action,input] of Object.entries(forbiddenInputs))await rejected(action,input,viewer,'',[403]);
 await rejected('metal-delivery-sign',{...fresh(delivery),signedAt:day,signedBy:'Cross-team',reference:'SYN-UNAUTHORIZED'},outsider,'',[403]);
 await rejected('metal-delivery-sign',{...fresh(delivery),signedAt:day,signedBy:'Wrong selected team',reference:'SYN-WRONG-TEAM'},admin,teamB.id,[403]);
 const auditSecrets=['metal_quote','metal_qc','metal_settlement'].map((kind,i)=>({id:'synthetic_metal_audit_'+i,kind:'audit',targetId:'synthetic_missing_metal_'+i,lineId:sourceA[0].id,before:{id:'synthetic_metal_private_'+i,kind,secret:'METAL_PRIVATE_AUDIT_SENTINEL'},after:null,createdAt:at}));
 auditSecrets.forEach(rawPut);
 for(const who of [admin,operator,viewer])assert(!JSON.stringify(await ok('data',undefined,who)).includes('METAL_PRIVATE_AUDIT_SENTINEL'));
 preserveSources();
 assert(raw().filter(r=>!originalRows.has(r.id)&&!auditSecrets.some(a=>a.id===r.id)).every(r=>r.kind.startsWith('metal_')||r.kind==='audit'&&r.after?.kind?.startsWith('metal_')&&r.targetId===r.after.id),'metal writes may only add independent metal facts and their bounded audit records');
 pass('prices are removed from nested DTOs, all mutations enforce roles/customer/team scope, generic audit cannot leak metal facts and every legacy source remains byte-identical');

 preserveSources();
}finally{
 db.close();delete globalThis.__metalTestIdentity;delete globalThis.__metalTestEnv;
}
console.log(JSON.stringify({ok:true,checks,syntheticOnly:true,productionTouched:false}));
