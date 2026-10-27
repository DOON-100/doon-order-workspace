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
const reviewer=await createAccount({username:'reviewer',name:'Synthetic Reviewer',role:'sales',password:'Synthetic-Only-2026!'},null);
await createAccount({username:'broad',name:'Synthetic Broad Reader',role:'viewer',orderScope:'all',password:'Synthetic-Only-2026!'},null);await createAccount({username:'unassigned',name:'Synthetic Unassigned',role:'sales',orderScope:'assigned',password:'Synthetic-Only-2026!'},null);const pmc=await createAccount({username:'pmc_test',name:'Synthetic PMC',role:'pmc',password:'Synthetic-Only-2026!'},null);db.prepare('UPDATE local_accounts SET must_change=0').run();await createAccount({username:'initial',name:'Synthetic Initial',role:'sales',password:'Synthetic-Only-2026!'},null);
const customer=(id,name,memberIds)=>({id,kind:'customer_account',customer:name,customerCode:id.toUpperCase(),salesName:'',serviceName:'',pmcName:'',salesMemberIds:memberIds,serviceMemberIds:[],quoteMemberIds:memberIds,active:true,notes:'',version:1,createdAt:at,updatedAt:at});
const quote=(id,cid)=>({id,kind:'customer_quote',version:2,status:'draft',customerAccountId:cid,customerName:cid,customerCode:cid.toUpperCase(),companyEn:'Synthetic Co',companyZh:'合成公司',collectionEn:'Frames',collectionZh:'镜架',quoteNo:'TEST-'+id,quoteDate:'2026-10-20',validUntil:'2026-12-31',currency:'EUR',contactName:'Synthetic',businessType:'frame',quoteMode:'order',pricingBasis:'row_item',currencyReviewed:true,lines:[{id:'line_'+id,model:'SYNTH-'+id,descriptionZh:'合成产品',descriptionEn:'Synthetic product',quantity:10,unitPrice:0,toolingFee:0,unit:'pair',supplyStage:'finished',productType:'frame',scopeReviewed:true,sourceFormula:'SYNTHETIC_INTERNAL_FORMULA'}],terms:[{id:'term_'+id,labelZh:'条款',labelEn:'Terms',zh:'待核查',en:'Check',needsReview:true}],reviewNotes:['待核查'],internalNotesZh:'SYNTHETIC_INTERNAL_COST',internalCosts:[],customerCharges:[],createdAt:at,createdBy:'Synthetic',updatedAt:at,updatedBy:'Synthetic'});
const q1=quote('q1','c1'),q2=quote('q2','c2'),snap=q=>({...q,version:1,status:'confirmed',terms:q.terms.map(t=>({...t,needsReview:false})),reviewNotes:[],confirmedAt:at,confirmedBy:'Synthetic',confirmedById:a.memberId});
const project=(id,cid,team)=>({id,kind:'customer_project',customerId:cid,teamId:team,title:'Synthetic '+id,code:id,description:'Test only',salesMemberId:a.memberId,serviceMemberId:'',serviceMemberIds:[],dueDate:'2026-11-01',status:'active',version:1,createdAt:at,updatedAt:at,createdBy:'Synthetic',updatedBy:'Synthetic'});
const rfq=(id,cid,team)=>({id,kind:'process_record',type:'rfq',customerId:cid,orderId:'',teamId:team,title:'Synthetic RFQ '+id,ownerId:a.memberId,responsibleId:'',status:'待核实',gateStatus:'待核实',details:{quantity:null,requirement:'待确认',currency:'EUR'},version:1,createdAt:at,updatedAt:at,updatedBy:'Synthetic'});
const p1=project('p1','c1','t1'),p2=project('p2','c2','t2'),r1=rfq('r1','c1','t1'),r2=rfq('r2','c2','t2');
saveRecords([customer('c1','Synthetic Alpha',[a.memberId,reviewer.memberId]),customer('c2','Synthetic Beta',[a.memberId,b.memberId]),
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
saveRecords([{id:'round1',kind:'pmc_round',actorId:pmc.memberId,actor:'Synthetic PMC',lineIds:['o1'],lastLineId:'o1',productionScope:'internal',scope:'synthetic',createdAt:at},
{id:'round2',kind:'pmc_round',actorId:pmc.memberId,actor:'Synthetic PMC',lineIds:['o1'],lastLineId:'o1',productionScope:'external',scope:'synthetic',createdAt:at},
{id:'review1',kind:'pmc_review',roundId:'round1',lineId:'o1',orderVersion:1,status:'pending',note:'待核对',actor:'Synthetic PMC',updatedAt:at},
{id:'purchase1',kind:'purchase',version:1,sourceVersion:1,po:'PO-1',supplier:'Synthetic Supplier',buyer:'Synthetic',itemCode:'ITEM-1',itemName:'Material',unit:'pcs',quantity:10,orderDate:'2026-10-20',dueDate:'2026-11-01',customerOrder:'SO-o1',auditStatus:'已审核',closeStatus:'未关闭',sourceNote:'',sourceRow:2,sourceAsOf:'2026-10-20',sourceHash:'a'.repeat(64),sourceFile:'synthetic.xlsx',sourceSheet:'Sheet',sourceFilter:'',raw:{secret:'SYNTHETIC_RAW_PRIVATE'},promisedDate:'',expectedDate:'',nextFollowupDate:'',followupNote:'',balanceKnown:false,received:0,returnPending:0,lifecycle:'active'},
{id:'purchase-event1',kind:'purchase_event',purchaseId:'purchase1',version:1,type:'opening',quantity:0,returnPending:0,date:'2026-10-20',reference:'SYN',note:'synthetic',actor:'Synthetic',createdAt:at,event:'核对初始数量'},
{id:'outs1',kind:'outsource',version:1,lineId:'o1',supplier:'Synthetic Supplier',process:'电镀',quantity:10,sentDate:'2026-10-20',dueDate:'2026-11-01',reference:'OUT-1',note:'synthetic',received:0,approvalStatus:'待主管审批',actor:'Synthetic',createdAt:at},
{id:'factory1',kind:'factory_order',version:1,lineId:'o1',priorId:'',sourceEnglish:'Synthetic source',chineseProcess:'合成工艺',materialSpec:'',platingSpec:'',lensSpec:'',materialImageConfirmed:false,status:'待客服确认',createdAt:at,createdBy:'Synthetic'}]);
const op=(id,type)=>({id,kind:'process_record',type,version:1,customerId:'c1',orderId:'o1',teamId:'t1',title:'Synthetic '+type,status:'待核实',gateStatus:'待检',details:{inspectedQuantity:null,acceptedQuantity:0,rejectedQuantity:0,quantity:0,releaseRef:'待核对'},createdAt:at,updatedAt:at,updatedBy:'Synthetic'});
const quality=op('quality1','iqc'),additionalQuality=['first-article','process-quality','outsourcing-quality','oqc'].map(type=>op('quality-'+type,type)),packaging=op('packaging1','packaging'),release=op('release1','shipment-release');
const ship={id:'ship1',kind:'service_record',type:'shipment',version:1,customerId:'c1',orderId:'o1',title:'Synthetic shipment',description:'',status:'open',waitingFor:'none',dueDate:'',nextFollowUp:'',details:{invoiceNo:'INV-1',quantity:1,shipDate:'',carrier:'',trackingNo:'',packingNote:''},createdAt:at,updatedAt:at,updatedBy:'Synthetic'};
saveRecords([{id:'followup1',kind:'customer_project_followup',version:1,ownerId:a.memberId,customerId:'c1',projectId:'p1',title:'Synthetic followup',category:'other',stars:0,status:'pending',followUpDate:'',notes:'',nextAction:'',checklist:[]}]);
saveRecords([quality,...additionalQuality,packaging,release,...[quality,...additionalQuality,packaging,release].map(row=>({id:'history-'+row.id,kind:'process_record_revision',recordId:row.id,customerId:'c1',orderId:'o1',teamId:'t1',version:1,action:'创建',actor:'Synthetic',createdAt:at,snapshot:row})),ship,
{id:'ship-history',kind:'service_revision',recordId:'ship1',customerId:'c1',version:1,action:'创建',actor:'Synthetic',createdAt:at,snapshot:ship},
{id:'report1',kind:'report',version:1,lineId:'o1',orderNo:'SO-o1',drawing:'DRAW',color:'Black',lens:'Clear',workOrder:'W1',task:'T1',process:'包装',batch:'B1',startedAt:at,reportedAt:at,quantity:0,approval:'待核对',nativeId:'R1',identityType:'MES',source:'synthetic.xlsx',updatedAt:at,updatedBy:'Synthetic'},
{id:'finished1',kind:'finished_supplier_task',version:1,lineId:'o1',supplierId:'sup1',supplierName:'Synthetic Supplier',orderNo:'SO-o1',drawing:'DRAW',color:'Black',lens:'Clear',productType:'frame',quantity:10,baselineStatus:'pending',template:'metal',stages:[{id:'packing',label:'包装',baseline:null,completed:null}],dueDate:'',promisedDate:'',baselineStock:null,baselineStockReturned:0,baselineRework:0,baseline:{cutoffDate:'2026-10-20',note:'synthetic'},acceptedAt:'',acceptedDate:'',closedAt:'',lastException:null,createdAt:at,updatedAt:at},
{id:'finished-ship1',kind:'finished_supplier_shipment',taskId:'finished1',reference:'IN-1',quantity:2,date:'2026-10-20',expectedDate:'',note:'',reworkId:'',source:'supplier',received:0,accepted:0,rejected:0,stocked:0,returned:0,attachmentIds:[],createdAt:at,updatedAt:at},
{id:'finished-event1',kind:'finished_supplier_event',taskId:'finished1',action:'task-create',actorId:a.memberId,actor:'Synthetic',actorType:'employee',date:'2026-10-20',note:'',data:{},createdAt:at}]);
const charge={id:'charge1',kind:'project_charge',version:1,customerId:'c1',projectId:'p1',roundId:'',title:'Synthetic charge',category:'sample',currency:'USD',amountCents:10000,prepayCents:2000,dueDate:'',note:'synthetic',status:'draft',plan:[],createdAt:at,updatedAt:at,updatedBy:'Synthetic'};
const receipt={id:'receipt1',kind:'project_receipt',customerId:'c1',amountCents:1000,currency:'USD',date:'2026-10-20',reference:'RCPT-1',payer:'SYNTHETIC_PAYER_PRIVATE',account:'SYNTHETIC_BANK_PRIVATE',note:'synthetic',createdAt:at};
const receivable={id:'receivable1',kind:'service_record',type:'receivable',version:1,customerId:'c1',orderId:'o1',title:'Synthetic receivable',description:'',status:'open',waitingFor:'none',dueDate:'',nextFollowUp:'',details:{invoiceNo:'INV-1',currency:'USD',amountCents:1000,terms:'TBD'},createdAt:at,updatedAt:at,updatedBy:'Synthetic'};
const recon={...op('recon1','supplier-reconciliation'),details:{supplierName:'Synthetic Supplier',statementRef:'S-1',invoiceRef:'I-1',currency:'USD',amount:0}},complaint={...op('complaint1','complaint'),details:{complaintRef:'C-1',cause:'待核对',correction:'',verification:'',customerConfirmation:''}};
saveRecords([{id:'finance-grant',kind:'project_finance_grant',memberId:a.memberId,customerIds:['c1'],active:true,version:1},charge,receipt,receivable,recon,complaint,
{id:'charge-history',kind:'project_finance_history',targetId:'charge1',customerId:'c1',projectId:'p1',action:'创建',actor:'Synthetic',createdAt:at,before:null,after:charge},
{id:'receivable-history',kind:'service_revision',recordId:'receivable1',customerId:'c1',version:1,action:'创建',actor:'Synthetic',createdAt:at,snapshot:receivable},
...[recon,complaint].map(row=>({id:'history-'+row.id,kind:'process_record_revision',recordId:row.id,customerId:'c1',orderId:'o1',teamId:'t1',version:1,action:'创建',actor:'Synthetic',createdAt:at,snapshot:row}))]);
const otherFinanceKinds={allocations:'project_allocation',adjustments:'project_adjustment',creditApplications:'project_credit_application',documents:'project_billing_document',notices:'project_payment_notice',cases:'project_after_sale',costs:'project_after_sale_cost',refunds:'project_refund',requirements:'project_payment_requirement',sends:'project_document_send',reversals:'project_receipt_reversal'};
const otherFinance=Object.entries(otherFinanceKinds).map(([category,kind])=>({id:'finance-'+category,kind,version:1,customerId:'c1',projectId:'p1',roundId:'',title:'Synthetic '+category,currency:'USD',amountCents:0,prepayCents:0,budgetCents:0,actualCents:0,quantity:0,resolution:'pending',customerAccepted:false,status:'draft',receiptId:'receipt1',chargeId:'charge1',sourceChargeId:'charge1',targetChargeId:'charge1',entryType:'allocate',type:'credit',originalId:'',reason:'synthetic',chargeIds:[],adjustmentIds:[],lines:[],createdAt:at,updatedAt:at,updatedBy:'Synthetic'}));
saveRecords([...otherFinance,...otherFinance.map(row=>({id:'history-'+row.id,kind:'project_finance_history',targetId:row.id,customerId:'c1',projectId:'p1',action:'创建',actor:'Synthetic',createdAt:at,before:null,after:row}))]);
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
  for(const username of ['sales_a','sales_b','broad','unassigned','pmc_test','initial']){
    const state=new StateStore(path.join(dir,username),testCodec());await state.setup(origin,true);const f=new FoundationService(state);await f.login(async()=>({username,password:'Synthetic-Only-2026!'}));services[username]={foundation:f,sales:f.sales(),state};
  }
  // Authentication audit may advance the workspace revision; establish all test sessions before the read-only baseline.
  let processState,pmcProcessState;
  if(process.platform==='win32'){
    processState=new StateStore(path.join(dir,'process-client'),windowsCodec);await processState.setup(origin,true);await new FoundationService(processState).login(async()=>({username:'sales_a',password:'Synthetic-Only-2026!'}));
    pmcProcessState=new StateStore(path.join(dir,'process-pmc'),windowsCodec);await pmcProcessState.setup(origin,true);await new FoundationService(pmcProcessState).login(async()=>({username:'pmc_test',password:'Synthetic-Only-2026!'}));
  }
  const before=snapshot(),original=await fs.readFile(path.join(env.DOON_DATA_DIR,'files/synthetic-original.bin'));
  const a=services.sales_a.sales,b=services.sales_b.sales;
  const fin=services.sales_a.foundation.finance(),otherFin=services.sales_b.foundation.finance();
  const chargeView=await fin.execute('records','show',{kind:'charges',team:'t1'},'charge1');assert.equal(chargeView.record.amountCents,10000);assert.equal(chargeView.record.status,'draft');assert.equal((await fin.execute('records','history',{kind:'charges',team:'t1'},'charge1')).page.total,1);assert.equal((await otherFin.execute('records','list',{kind:'charges'})).page.total,0);pass();
  const receiptView=await fin.execute('records','show',{kind:'receipts'},'receipt1');assert.equal(receiptView.record.amountCents,1000);assert(!JSON.stringify(receiptView).includes('SYNTHETIC_BANK_PRIVATE'));assert(!JSON.stringify(receiptView).includes('SYNTHETIC_PAYER_PRIVATE'));pass();
  for(const kind of ['allocations','adjustments','creditApplications','documents','notices','cases','costs','refunds','requirements','sends','reversals']){const id='finance-'+kind,opts={kind,team:'t1'};assert.equal((await fin.execute('records','show',opts,id)).record.customerId,'c1');assert.equal((await fin.execute('records','history',opts,id)).page.total,1);}assert.equal((await fin.execute('records','show',{kind:'cases'},'finance-cases')).record.customerAccepted,false);pass();
  for(const [resource,id] of [['receivables','receivable1'],['reconciliations','recon1'],['complaints','complaint1']]){assert.equal((await fin.execute(resource,'list',{team:'t1'})).page.total,1);assert.equal((await fin.execute(resource,'show',{team:'t1'},id)).record.customerId,'c1');assert.equal((await fin.execute(resource,'history',{team:'t1'},id)).page.total,1);await assert.rejects(otherFin.execute(resource,'show',{},id),{code:'NOT_IN_SCOPE'});pass();}
  const ops=services.sales_a.foundation.operations(),otherOps=services.sales_b.foundation.operations();
  assert.equal((await ops.execute('reports','list',{team:'t1'})).page.total,1);assert.equal((await ops.execute('reports','show',{},'report1')).record.quantity,0);pass();
  const task=await ops.execute('finished','show',{team:'t1'},'finished1');assert.equal(task.record.stocked,null);assert.equal(task.shipments.rows[0].received,0);assert.equal((await ops.execute('finished','history',{team:'t1'},'finished1')).page.total,1);await assert.rejects(otherOps.execute('finished','show',{},'finished1'),{code:'NOT_IN_SCOPE'});pass();
  for(const [resource,id,type] of [['quality','quality1','iqc'],['packaging','packaging1',undefined],['releases','release1',undefined],['shipments','ship1',undefined]]){
   const options={team:'t1',...(type?{type}:{})};assert.equal((await ops.execute(resource,'list',options)).page.total,1);assert.equal((await ops.execute(resource,'show',options,id)).record.customerId,'c1');assert.equal((await ops.execute(resource,'history',options,id)).page.total,1);pass();
  }
  for(const type of ['first-article','process-quality','outsourcing-quality','oqc']){const id='quality-'+type,opts={team:'t1',type};assert.equal((await ops.execute('quality','show',opts,id)).record.type,type);assert.equal((await ops.execute('quality','history',opts,id)).page.total,1);}await assert.rejects(otherOps.execute('quality','show',{type:'iqc'},'quality1'),{code:'NOT_IN_SCOPE'});pass();
  const plan=services.pmc_test.foundation.planning(),purchase=services.sales_a.foundation.planning(),limited=services.sales_b.foundation.planning();
  assert.equal((await plan.execute('rounds','list',{team:'t1'})).page.total,1);assert.equal((await plan.execute('rounds','show',{team:'t1'},'round1')).reviews.rows[0].status,'pending');assert.equal((await plan.execute('rounds','list',{team:'t1',scope:'external'})).page.rows[0].id,'round2');await assert.rejects(purchase.execute('rounds','list'),{code:'FORBIDDEN'});pass();
  assert.equal((await purchase.execute('purchases','list',{team:'t1'})).page.total,1);const purchaseDetail=await purchase.execute('purchases','show',{team:'t1'},'purchase1');assert.equal(purchaseDetail.record.received,null);assert.equal(purchaseDetail.record.balanceKnown,false);assert(!JSON.stringify(purchaseDetail).includes('SYNTHETIC_RAW_PRIVATE'));assert.equal((await purchase.execute('purchases','history',{team:'t1'},'purchase1')).events.total,1);await assert.rejects(limited.execute('purchases','show',{},'purchase1'),{code:'NOT_IN_SCOPE'});pass();
  for(const [resource,id] of [['outsource','outs1'],['factory-orders','factory1']]){assert.equal((await purchase.execute(resource,'list',{team:'t1'})).page.total,1);assert.equal((await purchase.execute(resource,'show',{team:'t1'},id)).record.lineId,'o1');await assert.rejects(limited.execute(resource,'show',{},id),{code:'NOT_IN_SCOPE'});pass();}
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
  if(processState&&!process.argv.includes('--skip-command-sweep')){
    // The server is another process, so synchronous child CLI calls cannot deadlock it.
    const flag=process.argv.indexOf('--cli-root'),cliRoot=flag<0?path.join(root,'cli'):path.resolve(process.argv[flag+1]);
    const nodeBinary=flag<0?process.execPath:path.join(cliRoot,'node.exe');
    const argumentsFor={setup:['--server',origin,'--allow-local-http'],login:[],logout:[],whoami:[],doctor:[],commands:[],modules:[]};
    const ids={followups:'followup1',customers:'c1',projects:'p1',inquiries:'r1',quotes:'q1',orders:'o1',sources:'source1',pi:'pi1',documents:'invoice1','production-orders':'production1',drawings:'drawing1',sops:'sop1',samples:'sample1','ie-quotes':'ie1',rounds:'round1',purchases:'purchase1',outsource:'outs1','factory-orders':'factory1',reports:'report1',finished:'finished1',quality:'quality1',packaging:'packaging1',releases:'release1',shipments:'ship1',records:'charge1',receivables:'receivable1',reconciliations:'recon1',complaints:'complaint1'};
    // Run every command from the actual catalog, rather than maintaining an unrelated fixed command count.
    for(const spec of [...commands.filter(c=>c.name!=='logout'&&c.effect!=='business-write'),commands.find(c=>c.name==='logout')]){
      const parts=spec.name.split(' ');let args=[...parts];
      if(parts.length===1)args.push(...argumentsFor[spec.name]);
      else{
        const [,resource,action]=parts;
        if(!['list','export-completed'].includes(action))args.push(ids[resource]);
        if(action==='version')args.push('1');
        if(resource==='quality')args.push('--type','iqc');
        if(parts[0]==='finance'&&resource==='records')args.push('--kind','charges');
        if(action==='export'||action==='export-completed')args.push('--output',path.join(dir,'command-'+testedCommands.length+'.xlsx'));
        if(!['ie-quotes','followups'].includes(resource))args.push('--team','t1');
      }
      const value=JSON.parse(execFileSync(nodeBinary,[path.join(cliRoot,'dist/index.js'),...args,'--json'],{env:{...env,DOON_CLI_HOME:parts[0]==='planning'?pmcProcessState.directory:processState.directory},windowsHide:true,encoding:'utf8',maxBuffer:1024*1024}));
      assert.equal(value.ok,true,spec.name);assert.equal(value.command,spec.name);testedCommands.push(spec.name);
      if(spec.name==='commands')assert.deepEqual(value.data.map(c=>c.name),commands.map(c=>c.name));
      if(spec.name==='logout')assert.equal(value.data.serverRevoked,true);
      else assert.deepEqual(snapshot(),before,'Business calls must preserve records and revision: '+spec.name);
    }
    assert.equal(testedCommands.length,commands.filter(c=>c.effect!=='business-write').length);assert.equal(await processState.hasSession(),false);await pmcProcessState.clearSession();pass();
  }
  assert.deepEqual(snapshot().records,before.records);assert.deepEqual(await fs.readFile(path.join(env.DOON_DATA_DIR,'files/synthetic-original.bin')),original);
  // W0 contract: run the shared write framework against the real process handler,
  // with a synthetic route registered only inside this isolated test process.
  {
    const {ApiClient}=await import('../../dist/client.js'),{routes}=await import('../../dist/routes.js');
    const {executeWrite}=await import('../../dist/write-operation.js');
    const route='/api/workspace/process-save',inputFile=path.join(dir,'synthetic-write.json'),originalRoute=routes[route];
    const beforeWrite=snapshot(),config=await services.sales_a.state.config();
    const sessionA=await services.sales_a.state.session(config),sessionB=await services.sales_b.state.session(config);
    const client=new ApiClient(config),token='00000000-0000-4000-8000-000000000001';
    await fs.writeFile(inputFile,JSON.stringify({type:'rfq',customerId:'c1',title:'Synthetic W0'}));
    routes[route]={method:'POST',business:true,write:true};
    try{
      const schema={type:{type:'string',required:true,enum:['rfq']},customerId:{type:'string',required:true},title:{type:'string',required:true}};
      const adapter={schema,tokenField:'token',
        async send(payload){return (await client.request(route,sessionA,payload)).data;},
        async readBack(response){const data=(await client.request('/api/workspace/process-data',sessionA,undefined,{query:{type:'rfq'}})).data;const record=data.records.find(r=>r.id===response.record.id);assert(record);return record;}};
      const forbidden={...adapter,async send(payload){return (await client.request(route,sessionB,payload)).data;}};
      await assert.rejects(executeWrite(forbidden,{file:inputFile,token:'00000000-0000-4000-8000-000000000002'}),{code:'FORBIDDEN'});
      assert.deepEqual(snapshot(),beforeWrite);
      const result=await executeWrite(adapter,{file:inputFile,token});
      assert.equal(result.customerId,'c1');assert.equal(result.type,'rfq');assert.equal(result.title,'Synthetic W0');assert.equal(result.version,1);
      const afterFirst=snapshot();assert.equal(afterFirst.revision,beforeWrite.revision+1);
      assert.deepEqual(await executeWrite(adapter,{file:inputFile,token}),result);
      assert.deepEqual(snapshot(),afterFirst);
      const originals=new Map(afterFirst.records.map(row=>[row.id,row.data]));
      for(const old of beforeWrite.records)assert.equal(originals.get(old.id),old.data,'Original record must not be changed');
      assert.deepEqual(await fs.readFile(path.join(env.DOON_DATA_DIR,'files/synthetic-original.bin')),original);
      pass();
    }finally{if(originalRoute)routes[route]=originalRoute;else delete routes[route];}
  }
  // W1: current user, other customer denied, idempotent replay, and preserved private fields.
  {
    const writeA=services.sales_a.foundation.salesWrite(),writeB=services.sales_b.foundation.salesWrite(),childA=services.sales_a.foundation.projectChildWrite(),childB=services.sales_b.foundation.projectChildWrite();
    const profileInput=path.join(dir,'profile-input.json'),scheduleInput=path.join(dir,'schedule-input.json'),projectInput=path.join(dir,'project-input.json'),inquiryInput=path.join(dir,'inquiry-input.json'),itemInput=path.join(dir,'item-input.json'),communicationInput=path.join(dir,'communication-input.json'),roundInput=path.join(dir,'round-input.json');
    const profileToken='11111111-1111-4111-8111-111111111111',scheduleToken='22222222-2222-4222-8222-222222222222',projectToken='55555555-5555-4555-8555-555555555555',inquiryToken='66666666-6666-4666-8666-666666666666';
    await fs.writeFile(profileInput,JSON.stringify({customerId:'c1',patch:{legalName:'Synthetic Updated'}}));
    await fs.writeFile(scheduleInput,JSON.stringify({customerId:'c1',next:'Synthetic follow-up',nextDate:'2026-12-01'}));
    await fs.writeFile(projectInput,JSON.stringify({customerId:'c1',title:'Synthetic project'}));
    await fs.writeFile(inquiryInput,JSON.stringify({customerId:'c1',title:'Synthetic inquiry',details:{requirement:'Synthetic',quantity:0}}));
    await fs.writeFile(itemInput,JSON.stringify({projectId:'p1',model:'Synthetic Model',quantity:5}));
    await fs.writeFile(communicationInput,JSON.stringify({projectId:'p1',occurredAt:'2026-10-20',content:'Synthetic communication',nextAction:'Synthetic next action'}));
    await fs.writeFile(roundInput,JSON.stringify({projectId:'p1',title:'Synthetic round',type:'development',scope:[{itemId:'not-visible',quantity:3}]}));
    const identityId=(await services.sales_a.foundation.whoami()).identity.id,ownerId=snapshot().records.filter(row=>row.kind==='member').map(row=>JSON.parse(row.data)).find(row=>row.userId===identityId)?.id;assert(ownerId);
    const reviewerId=snapshot().records.filter(row=>row.kind==='member').map(row=>JSON.parse(row.data)).find(row=>row.name==='Synthetic Reviewer')?.id;assert(reviewerId);
    const followupInput=path.join(dir,'followup-input.json');await fs.writeFile(followupInput,JSON.stringify({ownerId,customerId:'c1',projectId:'p1',title:'Synthetic new followup',checklist:[{id:'check1',text:'Synthetic check',checked:false}]}));
    const beforeChanges=snapshot();
    const unsafeInput=path.join(dir,'unsafe-input.json');await fs.writeFile(unsafeInput,JSON.stringify({customerId:'c1',patch:{bankPaymentInfo:'SYNTHETIC_FORBIDDEN'}}));
    await assert.rejects(writeA.execute('profile-update',unsafeInput,'1','44444444-4444-4444-8444-444444444444'),{code:'INVALID_INPUT'});
    await assert.rejects(writeB.execute('profile-update',profileInput,'1','33333333-3333-4333-8333-333333333333'),{code:'FORBIDDEN'});
    await assert.rejects(writeB.execute('project-create',projectInput,'','88888888-8888-4888-8888-888888888888'),{code:'FORBIDDEN'});
    await assert.rejects(childB.execute('item-add',itemInput,'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),{code:'FORBIDDEN'});
    await assert.rejects(childB.execute('communication-add',communicationInput,'12121212-1212-4212-8212-121212121212'),{code:'FORBIDDEN'});
    await assert.rejects(childB.execute('round-add',roundInput,'14141414-1414-4414-8414-141414141414'),{code:'FORBIDDEN'});
    await assert.rejects(writeB.execute('followup-create',followupInput,'','16161616-1616-4616-8616-161616161616'),{code:'FORBIDDEN'});
    assert.deepEqual(snapshot(),beforeChanges);
    const followup=await writeA.execute('followup-create',followupInput,'','17171717-1717-4717-8717-171717171717');assert.equal(followup.record.title,'Synthetic new followup');assert.deepEqual(await writeA.execute('followup-create',followupInput,'','17171717-1717-4717-8717-171717171717'),followup);assert.equal((await a.execute('followups','show',{},followup.record.id)).record.title,'Synthetic new followup');await assert.rejects(b.execute('followups','show',{},followup.record.id),{code:'NOT_IN_SCOPE'});
    const followupUpdateInput=path.join(dir,'followup-update.json');const followupUpdate={id:followup.record.id,ownerId,customerId:'c1',projectId:'p1',title:'Synthetic new followup',category:'other',stars:0,status:'in_progress',followUpDate:'',notes:'',nextAction:'Synthetic update',checklist:[{id:'check1',text:'Synthetic check',checked:false}]};await fs.writeFile(followupUpdateInput,JSON.stringify(followupUpdate));
    await assert.rejects(writeB.execute('followup-update',followupUpdateInput,'1','25252525-2525-4525-8525-252525252525'),{code:'FORBIDDEN'});const followupChanged=await writeA.execute('followup-update',followupUpdateInput,'1','26262626-2626-4626-8626-262626262626');assert.equal(followupChanged.record.version,2);assert.equal(followupChanged.record.nextAction,'Synthetic update');await assert.rejects(writeA.execute('followup-update',followupUpdateInput,'1','27272727-2727-4727-8727-272727272727'),{code:'CONFLICT'});
    const taskCreateInput=path.join(dir,'task-create.json');await fs.writeFile(taskCreateInput,JSON.stringify({projectId:'p1',title:'Synthetic task',ownerId,serviceReviewerId:reviewerId,salesReviewerId:reviewerId}));
    const taskService=services.sales_a.foundation.projectTaskWrite();await assert.rejects(services.sales_b.foundation.projectTaskWrite().execute('create',taskCreateInput,'','19191919-1919-4919-8919-191919191919'),{code:'FORBIDDEN'});
    const task=await taskService.execute('create',taskCreateInput,'','20202020-2020-4020-8020-202020202020');assert.equal(task.record.status,'open');
    const taskSubmitInput=path.join(dir,'task-submit.json');await fs.writeFile(taskSubmitInput,JSON.stringify({projectId:'p1',id:task.record.id,result:'Synthetic result'}));const submitted=await taskService.execute('submit',taskSubmitInput,'1','21212121-2121-4121-8121-212121212121');assert.equal(submitted.record.status,'service_review');
    const updated=await writeA.execute('profile-update',profileInput,'1',profileToken);
    assert.equal(updated.record.profile.version,2);assert.equal(updated.record.profile.fields.legalName,'Synthetic Updated');
    assert(!JSON.stringify(updated).includes('SYNTHETIC_BANK_PRIVATE'));
    assert.deepEqual(await writeA.execute('profile-update',profileInput,'1',profileToken),updated);
    const conflicting=path.join(dir,'conflicting-input.json');await fs.writeFile(conflicting,JSON.stringify({customerId:'c1',patch:{legalName:'Conflicting'}}));
    await assert.rejects(writeA.execute('profile-update',conflicting,'1',profileToken),{code:'CONFLICT'});
    await assert.rejects(writeA.execute('profile-update',profileInput,'1','dddddddd-dddd-4ddd-8ddd-dddddddddddd'),{code:'CONFLICT'});
    const scheduled=await writeA.execute('schedule-set',scheduleInput,'0',scheduleToken);
    assert.equal(scheduled.record.workflow.version,1);assert.equal(scheduled.record.workflow.next,'Synthetic follow-up');
    assert.deepEqual(await writeA.execute('schedule-set',scheduleInput,'0',scheduleToken),scheduled);
    const project=await writeA.execute('project-create',projectInput,'',projectToken);assert.equal(project.record.customerId,'c1');assert.equal(project.record.title,'Synthetic project');
    assert.deepEqual(await writeA.execute('project-create',projectInput,'',projectToken),project);
    const projectUpdateInput=path.join(dir,'project-update.json'),projectUpdate={id:project.record.id,customerId:'c1',title:'Synthetic project updated',code:'',description:'',teamId:'',salesMemberId:'',serviceMemberIds:[],serviceReviewerId:'',salesReviewerId:'',dueDate:'',status:'active'};await fs.writeFile(projectUpdateInput,JSON.stringify(projectUpdate));await assert.rejects(writeB.execute('project-update',projectUpdateInput,'1','29292929-2929-4929-8929-292929292929'),{code:'FORBIDDEN'});const changedProject=await writeA.execute('project-update',projectUpdateInput,'1','30303030-3030-4030-8030-303030303030');assert.equal(changedProject.record.title,'Synthetic project updated');await assert.rejects(writeA.execute('project-update',projectUpdateInput,'1','31313131-3131-4131-8131-313131313131'),{code:'CONFLICT'});
    const conflictingProject=path.join(dir,'conflicting-project.json');await fs.writeFile(conflictingProject,JSON.stringify({customerId:'c1',title:'Different project'}));
    await assert.rejects(writeA.execute('project-create',conflictingProject,'',projectToken),{code:'CONFLICT'});
    await assert.rejects(writeB.execute('inquiry-create',inquiryInput,'','77777777-7777-4777-8777-777777777777'),{code:'FORBIDDEN'});
    const inquiry=await writeA.execute('inquiry-create',inquiryInput,'',inquiryToken);assert.equal(inquiry.record.type,'rfq');assert.equal(inquiry.record.details.quantity,0);
    assert.deepEqual(await writeA.execute('inquiry-create',inquiryInput,'',inquiryToken),inquiry);
    const inquiryUpdateInput=path.join(dir,'inquiry-update.json'),inquiryUpdate={id:inquiry.record.id,customerId:'c1',orderId:'',teamId:'',title:'Synthetic inquiry',batch:'',ownerId:'',responsibleId:'',plannedDate:'',actualDate:'',status:'待处理',inputBasis:'',inputVersion:'',outputEvidence:'',gateStatus:'待核实',blocker:'',nextAction:'',nextOwnerId:'',nextDueDate:'',notes:'',details:{gateReason:'',documentRef:'',requirement:'Updated requirement',targetDelivery:'',quantity:null,currency:'',quoteRef:''}};await fs.writeFile(inquiryUpdateInput,JSON.stringify(inquiryUpdate));await assert.rejects(writeB.execute('inquiry-update',inquiryUpdateInput,'1','33333333-4444-4444-8444-444444444444'),{code:'FORBIDDEN'});const changedInquiry=await writeA.execute('inquiry-update',inquiryUpdateInput,'1','34343434-3434-4434-8434-343434343434');assert.equal(changedInquiry.record.details.requirement,'Updated requirement');assert.equal(changedInquiry.record.details.quantity??null,null);await assert.rejects(writeA.execute('inquiry-update',inquiryUpdateInput,'1','35353535-3535-4535-8535-353535353535'),{code:'CONFLICT'});
    const itemToken='ffffffff-ffff-4fff-8fff-ffffffffffff',communicationToken='12345678-1234-4234-8234-123456789abc';
    const item=await childA.execute('item-add',itemInput,itemToken);assert.equal(item.record.model,'Synthetic Model');assert.equal(item.record.quantity,5);
    assert.deepEqual(await childA.execute('item-add',itemInput,itemToken),item);
    await fs.writeFile(roundInput,JSON.stringify({projectId:'p1',title:'Synthetic round',type:'development',scope:[{itemId:item.record.id,quantity:3}],requiredDrawingTypes:[],requireQuote:false,sampleGateStage:'not_required'}));
    const roundToken='15151515-1515-4515-8515-151515151515';
    const round=await childA.execute('round-add',roundInput,roundToken);assert.equal(round.record.title,'Synthetic round');assert.deepEqual(round.record.scope,[{itemId:item.record.id,quantity:3}]);
    assert.deepEqual(await childA.execute('round-add',roundInput,roundToken),round);
    const roundConflict=path.join(dir,'round-conflict.json');await fs.writeFile(roundConflict,JSON.stringify({projectId:'p1',title:'Changed round',type:'development',scope:[{itemId:item.record.id,quantity:3}]}));
    await assert.rejects(childA.execute('round-add',roundConflict,roundToken),{code:'CONFLICT'});
    const conflictingItem=path.join(dir,'conflicting-item.json');await fs.writeFile(conflictingItem,JSON.stringify({projectId:'p1',model:'Different model',quantity:5}));
    await assert.rejects(childA.execute('item-add',conflictingItem,itemToken),{code:'CONFLICT'});
    const communication=await childA.execute('communication-add',communicationInput,communicationToken);assert.equal(communication.record.content,'Synthetic communication');
    assert.deepEqual(await childA.execute('communication-add',communicationInput,communicationToken),communication);
    const noTaskFile=path.join(dir,'no-task.json');await fs.writeFile(noTaskFile,JSON.stringify({projectId:'p1',occurredAt:'2026-10-20',content:'Synthetic no task'}));
    const noTask=await childA.execute('communication-add',noTaskFile,'13131313-1313-4313-8313-131313131313');
    assert(!snapshot().records.some(row=>row.kind==='customer_project_task'&&JSON.parse(row.data).communicationId===noTask.record.id));
    const finalState=snapshot(),oldById=new Map(beforeChanges.records.map(row=>[row.id,row.data]));
    const finalById=new Map(finalState.records.map(row=>[row.id,row.data]));
    for(const [id,data] of oldById)if(id!=='profile1')assert.equal(finalById.get(id),data,'Unrelated record changed or removed');
    const profile=JSON.parse(finalById.get('profile1')),oldProfile=JSON.parse(oldById.get('profile1'));
    assert.deepEqual({...profile.fields,legalName:oldProfile.fields.legalName},oldProfile.fields);
    assert.equal(profile.fields.bankPaymentInfo,'SYNTHETIC_BANK_PRIVATE');
    assert.deepEqual(await fs.readFile(path.join(env.DOON_DATA_DIR,'files/synthetic-original.bin')),original);
    if(processState){
      await new FoundationService(processState).login(async()=>({username:'sales_a',password:'Synthetic-Only-2026!'}));
      const flag=process.argv.indexOf('--cli-root'),cliRoot=flag<0?path.join(root,'cli'):path.resolve(process.argv[flag+1]);
      const nodeBinary=flag<0?process.execPath:path.join(cliRoot,'node.exe');
      for(const [action,file,version,token] of [['profile-update',profileInput,'2','99999999-9999-4999-8999-999999999999'],['schedule-set',scheduleInput,'1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']]){
        const args=['sales','customers',action,'--input',file,'--version',version,'--request-id',token,'--json'];
        const result=JSON.parse(execFileSync(nodeBinary,[path.join(cliRoot,'dist/index.js'),...args],{env:{...env,DOON_CLI_HOME:processState.directory},windowsHide:true,encoding:'utf8',maxBuffer:1024*1024}));
        assert.equal(result.ok,true);testedCommands.push('sales customers '+action);
      }
      {const args=['sales','projects','create','--input',projectInput,'--request-id','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','--json'];const result=JSON.parse(execFileSync(nodeBinary,[path.join(cliRoot,'dist/index.js'),...args],{env:{...env,DOON_CLI_HOME:processState.directory},windowsHide:true,encoding:'utf8',maxBuffer:1024*1024}));assert.equal(result.ok,true);testedCommands.push('sales projects create');const updateFile=path.join(dir,'project-cli-update.json');await fs.writeFile(updateFile,JSON.stringify({...projectUpdate,id:result.data.record.id}));const changed=JSON.parse(execFileSync(nodeBinary,[path.join(cliRoot,'dist/index.js'),'sales','projects','update','--input',updateFile,'--version','1','--request-id','32323232-3232-4232-8232-323232323232','--json'],{env:{...env,DOON_CLI_HOME:processState.directory},windowsHide:true,encoding:'utf8',maxBuffer:1024*1024}));assert.equal(changed.ok,true);testedCommands.push('sales projects update');}
      {const args=['sales','inquiries','create','--input',inquiryInput,'--request-id','cccccccc-cccc-4ccc-8ccc-cccccccccccc','--json'];const result=JSON.parse(execFileSync(nodeBinary,[path.join(cliRoot,'dist/index.js'),...args],{env:{...env,DOON_CLI_HOME:processState.directory},windowsHide:true,encoding:'utf8',maxBuffer:1024*1024}));assert.equal(result.ok,true);testedCommands.push('sales inquiries create');const updateFile=path.join(dir,'inquiry-cli-update.json');await fs.writeFile(updateFile,JSON.stringify({...inquiryUpdate,id:result.data.record.id}));const changed=JSON.parse(execFileSync(nodeBinary,[path.join(cliRoot,'dist/index.js'),'sales','inquiries','update','--input',updateFile,'--version','1','--request-id','36363636-3636-4636-8636-363636363636','--json'],{env:{...env,DOON_CLI_HOME:processState.directory},windowsHide:true,encoding:'utf8',maxBuffer:1024*1024}));assert.equal(changed.ok,true);testedCommands.push('sales inquiries update');}
      for(const [action,file,token] of [['item-add',itemInput,'12345678-1234-4234-8234-123456789abd'],['communication-add',communicationInput,'12345678-1234-4234-8234-123456789abe'],['round-add',roundInput,'12345678-1234-4234-8234-123456789abf']]){const args=['sales','projects',action,'--input',file,'--request-id',token,'--json'];const result=JSON.parse(execFileSync(nodeBinary,[path.join(cliRoot,'dist/index.js'),...args],{env:{...env,DOON_CLI_HOME:processState.directory},windowsHide:true,encoding:'utf8',maxBuffer:1024*1024}));assert.equal(result.ok,true);testedCommands.push('sales projects '+action);}
      {const args=['sales','followups','create','--input',followupInput,'--request-id','18181818-1818-4818-8818-181818181818','--json'];const result=JSON.parse(execFileSync(nodeBinary,[path.join(cliRoot,'dist/index.js'),...args],{env:{...env,DOON_CLI_HOME:processState.directory},windowsHide:true,encoding:'utf8',maxBuffer:1024*1024}));assert.equal(result.ok,true);testedCommands.push('sales followups create');const updateFile=path.join(dir,'followup-cli-update.json');await fs.writeFile(updateFile,JSON.stringify({...followupUpdate,id:result.data.record.id}));const updatedFollowup=JSON.parse(execFileSync(nodeBinary,[path.join(cliRoot,'dist/index.js'),'sales','followups','update','--input',updateFile,'--version','1','--request-id','28282828-2828-4828-8828-282828282828','--json'],{env:{...env,DOON_CLI_HOME:processState.directory},windowsHide:true,encoding:'utf8',maxBuffer:1024*1024}));assert.equal(updatedFollowup.ok,true);testedCommands.push('sales followups update');}
      {const args=['sales','projects','task-create','--input',taskCreateInput,'--request-id','22222222-3333-4333-8333-333333333333','--json'];const result=JSON.parse(execFileSync(nodeBinary,[path.join(cliRoot,'dist/index.js'),...args],{env:{...env,DOON_CLI_HOME:processState.directory},windowsHide:true,encoding:'utf8',maxBuffer:1024*1024}));assert.equal(result.ok,true);testedCommands.push('sales projects task-create');
       const submitFile=path.join(dir,'task-cli-submit.json');await fs.writeFile(submitFile,JSON.stringify({projectId:'p1',id:result.data.record.id,result:'CLI result'}));
       const submit=JSON.parse(execFileSync(nodeBinary,[path.join(cliRoot,'dist/index.js'),'sales','projects','task-submit','--input',submitFile,'--version','1','--request-id','23232323-2323-4323-8323-232323232323','--json'],{env:{...env,DOON_CLI_HOME:processState.directory},windowsHide:true,encoding:'utf8',maxBuffer:1024*1024}));assert.equal(submit.ok,true);testedCommands.push('sales projects task-submit');
       const reviewerState=new StateStore(path.join(dir,'process-reviewer'),windowsCodec);await reviewerState.setup(origin,true);await new FoundationService(reviewerState).login(async()=>({username:'reviewer',password:'Synthetic-Only-2026!'}));const reviewFile=path.join(dir,'task-cli-review.json');await fs.writeFile(reviewFile,JSON.stringify({projectId:'p1',id:result.data.record.id,stage:'service',decision:'approve'}));
       const review=JSON.parse(execFileSync(nodeBinary,[path.join(cliRoot,'dist/index.js'),'sales','projects','task-review','--input',reviewFile,'--version','2','--request-id','24242424-2424-4424-8424-242424242424','--json'],{env:{...env,DOON_CLI_HOME:reviewerState.directory},windowsHide:true,encoding:'utf8',maxBuffer:1024*1024}));assert.equal(review.ok,true);testedCommands.push('sales projects task-review');await new FoundationService(reviewerState).logout();}
      if(!process.argv.includes('--skip-command-sweep'))assert.equal(testedCommands.length,commands.length);
      const afterCli=snapshot(),afterCliById=new Map(afterCli.records.map(row=>[row.id,row.data]));
      for(const [id,data] of oldById)if(id!=='profile1')assert.equal(afterCliById.get(id),data,'Unrelated record changed or removed by CLI');
      assert.equal(JSON.parse(afterCliById.get('profile1')).fields.bankPaymentInfo,'SYNTHETIC_BANK_PRIVATE');
      assert.deepEqual(await fs.readFile(path.join(env.DOON_DATA_DIR,'files/synthetic-original.bin')),original);
      await new FoundationService(processState).logout();
    }
    pass();
  }
  await fs.writeFile(path.join(runtime,'disable.mjs'),`import {db} from './runtime.mjs';const a=db.prepare("SELECT member_id FROM local_accounts WHERE username='sales_b'").get(),row=JSON.parse(db.prepare('SELECT data FROM records WHERE id=?').get(a.member_id).data);db.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify({...row,active:false}),a.member_id);db.close();`);
  execFileSync(process.execPath,[path.join(runtime,'disable.mjs')],{env,windowsHide:true,stdio:'pipe'});await assert.rejects(b.execute('projects','list'),{code:'AUTH_REQUIRED'});assert.equal(await services.sales_b.state.hasSession(),false);pass();
}catch(error){console.error(logs.slice(-2000));throw error;}finally{
  if(!exited)child.kill();await done;
  const base=path.resolve(root,'test-output'),target=path.resolve(dir);
  if(path.dirname(target)!==base||!path.basename(target).startsWith('cli-test-'))throw Error('Refusing cleanup outside the generated test directory');
  await fs.rm(target,{recursive:true,force:true});assert.equal(await fs.stat(target).then(()=>true,()=>false),false);
}
console.log(JSON.stringify({passed:checks,syntheticOnly:true,productionRequests:0,unrelatedBusinessRecordsAndOriginalBytesPreserved:true,testDirectoryRemoved:true,testedCommands}));
