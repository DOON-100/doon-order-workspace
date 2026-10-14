import assert from 'node:assert/strict';

export async function testCustomerProjectFinanceEntries({ok,call,state,pass,rawRecords,rawInsert}){
 const token=()=>crypto.randomUUID(),at='2026-10-12T00:00:00.000Z';
 const sales={userId:'pfe_sales',email:'pfe_sales@test.invalid',displayName:'合成独立财务业务',fullName:'合成独立财务业务'};
 await ok('member',{name:sales.displayName,email:sales.email,role:'sales',customers:[],active:true,orderScope:'all'});await ok('enroll',{},sales);
 const customer=(await ok('customer-save',{customer:'独立财务合成客户',customerCode:'SYNTH-PFE',salesName:sales.displayName,serviceName:'',pmcName:'',active:true})).item;
 const other=(await ok('customer-save',{customer:'独立财务另一合成客户',customerCode:'SYNTH-PFE-OTHER',salesName:'',serviceName:'',pmcName:'',active:true})).item;
 const project={id:'pfe_empty_project',kind:'customer_project',customerId:customer.id,code:'SYNTH-PFE-P',title:'无轮次独立财务项目',description:'合成测试',status:'archived',version:1,createdAt:at};rawInsert(project);
 const data=()=>ok('project-finance-data?projectId='+project.id,undefined,sales);
 const base=()=>({token:token(),projectId:project.id,roundId:''});
 const beforeTotals=(await data()).totalsByCurrency;
 const payloads={
  receipts:{amount:'123.45',currency:'USD',date:'',reference:'独立到账参考',payer:'',account:'',note:'到账后补'},
  allocations:{receiptId:'',chargeId:'',amount:'25',currency:'USD',reason:'独立分配'},
  adjustments:{chargeId:'',caseId:'',type:'discount',amount:'8',currency:'USD',prepay:false,reason:'独立调整',evidence:''},
  creditApplications:{sourceChargeId:'',targetChargeId:'',amount:'9',currency:'USD',reason:'独立抵扣',evidence:''},
  refunds:{receiptId:'',caseId:'',amount:'7',currency:'USD',reason:'独立退款',date:'',reference:'',account:''},
 };
 for(const [entryType,fields] of Object.entries(payloads)){
  const created=(await ok('project-finance-entry-save',{...base(),entryType,data:fields},sales)).record;
  assert.equal(created.independent,true);assert.equal(created.roundId,'');
  const edited=(await ok('project-finance-entry-save',{...base(),entryType,id:created.id,version:created.version,data:{...fields,amount:'42'}},sales)).record;
  assert.equal(edited.id,created.id);assert.equal(edited.amountCents,4200);assert.equal(edited.version,2);
  assert.equal((await data())[entryType].find(r=>r.id===created.id).independent,true);
  const snapshot=structuredClone(rawRecords());const stale=await call('project-finance-entry-save',{...base(),entryType,id:created.id,version:created.version,data:fields},sales);assert.equal(stale.status,409);assert.deepEqual(rawRecords(),snapshot);
 }
 assert.deepEqual((await data()).totalsByCurrency,beforeTotals);
 const blankEntry=(await ok('project-finance-entry-save',{...base(),entryType:'adjustments',data:{amount:'',currency:'',type:''}},sales)).record;
 assert.equal(blankEntry.amountCents,0);assert.equal(blankEntry.currency,'USD');assert.equal(blankEntry.type,'discount');
 const privateDraft=(await ok('project-finance-entry-save',{...base(),entryType:'receipts',data:{amount:'1',account:'SYNTH-PRIVATE',payer:'SYNTH-PAYER'}})).record;
 const safeDraft=(await data()).receipts.find(r=>r.id===privateDraft.id);assert.equal(Object.hasOwn(safeDraft,'account'),false);assert.equal(Object.hasOwn(safeDraft,'payer'),false);
 const safeEdit=(await ok('project-finance-entry-save',{...base(),entryType:'receipts',id:privateDraft.id,version:privateDraft.version,data:{amount:'2',note:'补说明'}},sales)).record;
 assert.equal(Object.hasOwn(safeEdit,'account'),false);assert.equal(rawRecords().find(r=>r.id===privateDraft.id).account,'SYNTH-PRIVATE');
 const blankCost=(await ok('project-after-sale-cost',{...base(),currency:'',budget:'',actual:'',bearer:''},sales)).record;assert.equal(blankCost.actualCents,0);assert.equal(blankCost.bearer,'company');
 const crossReceipt={id:'pfe_other_receipt',kind:'project_receipt',customerId:other.id,amountCents:100,currency:'USD',date:'2026-10-12',reference:'SYNTH-PFE-OTHER',account:'SYNTH',createdAt:at};rawInsert(crossReceipt);
 const forbidden=await call('project-finance-entry-save',{...base(),entryType:'allocations',data:{...payloads.allocations,receiptId:crossReceipt.id}},sales);assert.equal(forbidden.status,403);
 pass('财务五类独立记录无轮次或前置来源即可新增修改，草稿不计汇总，版本与客户权限仍有效');

 let notice=(await ok('project-payment-notice',{...base(),amount:'0',currency:'USD',reference:'',note:'通知可后补'},sales)).record;
 notice=(await ok('project-payment-notice',{...base(),id:notice.id,version:notice.version,amount:'99',currency:'USD',reference:'补充通知',note:'已修改'},sales)).record;assert.equal(notice.amountCents,9900);
 const documentBody={...base(),customerId:customer.id,documentType:'PI',documentNo:'SYNTH-PFE-PI',chargeIds:[],adjustmentIds:[],currency:'USD',date:'',customerAddress:'',company:'DOON',terms:'',manualTitle:'独立单据说明',manualAmount:'25'};
 let document=(await ok('project-document-save',documentBody,sales)).record;assert.equal(document.lines[0].amountCents,2500);
 document=(await ok('project-document-confirm',{token:token(),id:document.id,version:document.version},sales)).record;
 const sameNumberDraft=(await ok('project-document-save',{...documentBody,token:token()},sales)).record;assert.equal(sameNumberDraft.status,'draft');
 const duplicateConfirm=await call('project-document-confirm',{token:token(),id:sameNumberDraft.id,version:sameNumberDraft.version},sales);assert.equal(duplicateConfirm.status,409);
 let sent=(await ok('project-document-sent',{...base(),documentId:document.id,date:'2026-10-12',recipient:'Synthetic',reference:'合成已发'},sales)).record;
 const otherProject={...project,id:'pfe_other_same_customer_project',title:'同客户另一项目'},otherRound={id:'pfe_other_same_customer_round',kind:'customer_project_round',customerId:customer.id,projectId:otherProject.id,title:'另一项目轮次',scope:[],status:'open',type:'development',parentRoundId:'',requiredDrawingTypes:[],requiredSampleIds:[]};rawInsert(otherProject);rawInsert(otherRound);
 const rejectRelation=async(action,body)=>{const before=structuredClone(rawRecords()),response=await call(action,body,sales);assert.equal(response.status,400,await response.text());assert.deepEqual(rawRecords(),before,'Wrong finance relationships must not write');};
 await rejectRelation('project-document-sent',{...base(),projectId:otherProject.id,documentId:document.id,date:'2026-10-12'});
 await rejectRelation('project-document-sent',{...base(),projectId:otherProject.id,sendId:sent.id,version:sent.version,documentId:'',date:'2026-10-12'});
 await rejectRelation('project-document-save',{...documentBody,token:token(),projectId:'',roundId:otherRound.id});
 const originalMultiDocument={...document,id:'pfe_multipoject_document',projectId:'',roundId:'',version:1,lines:[{projectId:project.id,roundId:'',title:'已发送的A项目',currency:'USD',amountCents:2500}],chargeIds:[]};
 rawInsert({...originalMultiDocument,version:2,lines:[{...originalMultiDocument.lines[0],projectId:otherProject.id,title:'修订后的B项目'}]});
 const historicalSend={...sent,id:'pfe_historical_document_send',documentId:originalMultiDocument.id,documentVersion:1,documentSnapshot:originalMultiDocument};rawInsert(historicalSend);
 const maintainedSend=(await ok('project-document-sent',{...base(),sendId:historicalSend.id,version:historicalSend.version,documentId:originalMultiDocument.id,date:'2026-10-12',recipient:'Historical recipient corrected'},sales)).record;
 assert.equal(maintainedSend.recipient,'Historical recipient corrected');assert.deepEqual(maintainedSend.documentSnapshot,originalMultiDocument);assert.equal(maintainedSend.documentVersion,1);
 pass('单据轮次必须携带所属项目，发送不能错绑同客户无关项目或改换既有项目归属');
 const sentSnapshot=structuredClone(sent.documentSnapshot),sentVersion=sent.documentVersion;
 const revised=(await ok('project-document-save',{...documentBody,token:token(),id:document.id,version:document.version,manualTitle:'修改独立单据',manualAmount:'50'},sales)).record;
 assert.equal(revised.status,'draft');assert.equal(revised.version,document.version+1);
 sent=(await ok('project-document-sent',{...base(),sendId:sent.id,version:sent.version,documentId:document.id,date:'2026-10-12',recipient:'Synthetic updated',reference:'修改发送说明'},sales)).record;
 assert.equal(sent.documentVersion,sentVersion);assert.deepEqual(sent.documentSnapshot,sentSnapshot);
 const print=await call('project-document-print?id='+document.id+'&version='+sentVersion,undefined,sales);assert.equal(print.status,200);assert((await print.text()).includes('25.00'));
 let standaloneSend=(await ok('project-document-sent',{...base(),documentId:'',date:'',recipient:'',reference:'独立发送记录'},sales)).record;
 standaloneSend=(await ok('project-document-sent',{...base(),sendId:standaloneSend.id,version:standaloneSend.version,documentId:'',date:'',recipient:'后补收件人',reference:'修改独立发送'},sales)).record;assert.equal(standaloneSend.recipient,'后补收件人');
 assert((await data()).documents.some(d=>d.id===document.id&&d.projectId===project.id));
 assert.deepEqual((await data()).totalsByCurrency,beforeTotals);
 pass('无收费可制作及修改单据，无单据可登记发送，既有发送版本与快照不随改单变化');

 let cost=(await ok('project-after-sale-cost',{...base(),caseId:'',category:'repair',description:'独立售后成本',currency:'USD',budget:'0',actual:'0',bearer:'company',supplierReference:''},sales)).record;
 cost=(await ok('project-after-sale-cost',{...base(),id:cost.id,version:cost.version,caseId:'',category:'repair',description:'修改独立成本',currency:'USD',budget:'10',actual:'8',bearer:'company',supplierReference:''},sales)).record;assert.equal(cost.actualCents,800);
 const caseBody={...base(),orderId:'',shipmentReference:'',title:'直接登记已结案事项',description:'',quantity:0,resolution:'pending',status:'closed',ownerMemberId:'',dueDate:'',customerEvidence:'',executionNote:'',returnedQuantity:0,completedQuantity:0,resentQuantity:0,trackingNo:'',customerAccepted:false};
 let sale=(await ok('project-after-sale-save',caseBody,sales)).record;
 const blankSale=(await ok('project-after-sale-save',{...caseBody,token:token(),quantity:'',returnedQuantity:'',completedQuantity:'',resentQuantity:'',resolution:'',status:''},sales)).record;assert.equal(blankSale.quantity,0);assert.equal(blankSale.status,'open');
 rawInsert({id:'pfe_unlinked_order',kind:'order',customer:customer.customerCode,orderNo:'SYNTH-PFE-ORDER',drawing:'SYNTH',color:'SYNTH',quantity:1,createdAt:at});
 const unlinkedSale=(await ok('project-after-sale-save',{...caseBody,token:token(),orderId:'pfe_unlinked_order',quantity:10000001,returnedQuantity:10000002,completedQuantity:0,resentQuantity:3},sales)).record;assert.equal(unlinkedSale.orderId,'pfe_unlinked_order');assert.equal(unlinkedSale.returnedQuantity,10000002);
 rawInsert({id:'pfe_other_order',kind:'order',customer:other.customerCode,orderNo:'SYNTH-PFE-OTHER-ORDER',drawing:'SYNTH',color:'SYNTH',quantity:1,createdAt:at});
 const wrongOrder=await call('project-after-sale-save',{...caseBody,token:token(),orderId:'pfe_other_order'},sales);assert.equal(wrongOrder.status,403);
 sale=(await ok('project-after-sale-save',{...caseBody,token:token(),id:sale.id,version:sale.version,title:'已结案也可补充说明'},sales)).record;assert.equal(sale.status,'closed');
 assert((await data()).costs.some(c=>c.id===cost.id&&c.projectId===project.id));
 pass('售后事项与额外成本分别独立新增修改，无负责人、轮次或先结案流程阻挡');

 let charge=(await ok('project-charge-save',{...base(),title:'核实应收',category:'sample',currency:'USD',amount:'100',prepayAmount:'0',dueDate:'',note:''},sales)).record;
 const incompleteCharge=(await ok('project-charge-save',{...base(),title:'资料后补收费',category:'sample',currency:'USD',amount:'',prepayAmount:'5',dueDate:'',note:'',plan:Array.from({length:51},()=>({title:'',amount:'',dueDate:''}))},sales)).record;
 assert.equal(incompleteCharge.plan.length,51);assert.equal(incompleteCharge.status,'draft');const invalidConfirm=await call('project-charge-confirm',{token:token(),id:incompleteCharge.id,version:incompleteCharge.version});assert.equal(invalidConfirm.status,400);
 charge=(await ok('project-charge-confirm',{token:token(),id:charge.id,version:charge.version})).record;
 charge=(await ok('project-charge-save',{...base(),id:charge.id,version:charge.version,title:'已核实应收可改说明',category:'sample',currency:'USD',amount:'100',prepayAmount:'0',dueDate:'',note:'维护说明'},sales)).record;assert.equal(charge.status,'confirmed');
 let receipt=(await ok('project-receipt-verify',{token:token(),customerId:customer.id,amount:'100',currency:'USD',date:'2026-10-12',reference:'SYNTH-PFE-REAL',payer:'',account:'SYNTH',note:''})).record;
 await ok('project-allocation',{token:token(),receiptId:receipt.id,chargeId:charge.id,amount:'80'});
 const originalAllocations=structuredClone(rawRecords().filter(r=>r.kind==='project_allocation'&&r.chargeId===charge.id));
 const actualFields={amount:'100',currency:'USD',date:'2026-10-12',reference:'SYNTH-PFE-REAL',payer:'',account:'SYNTH',note:'核实到账补充说明'};
 let denied=await call('project-finance-entry-save',{...base(),entryType:'receipts',id:receipt.id,version:1,data:actualFields},sales);assert.equal(denied.status,403);
 receipt=(await ok('project-finance-entry-save',{...base(),entryType:'receipts',id:receipt.id,version:1,data:actualFields})).record;
 denied=await call('project-finance-entry-save',{...base(),entryType:'receipts',id:receipt.id,version:receipt.version,data:{...actualFields,amount:'79'}});assert.equal(denied.status,400);
 denied=await call('project-finance-entry-save',{...base(),entryType:'receipts',id:receipt.id,version:receipt.version,data:{...actualFields,date:''}});assert.equal(denied.status,400);
 const realRefund=(reference,id)=>({id,kind:'project_refund',customerId:customer.id,projectId:project.id,roundId:'',receiptId:receipt.id,caseId:'',amountCents:100,currency:'USD',reason:'合成实退',status:'executed',version:1,date:'2026-10-12',account:'SYNTH',reference,createdAt:at});
 rawInsert(realRefund('SYNTH-PFE-REFUND-A','pfe_refund_a'));rawInsert(realRefund('SYNTH-PFE-REFUND-B','pfe_refund_b'));
 const refundData={amount:'1',currency:'USD',receiptId:receipt.id,caseId:'',date:'2026-10-12',account:'SYNTH',reference:'SYNTH-PFE-REFUND-A',reason:'修改实退'};
 denied=await call('project-finance-entry-save',{...base(),entryType:'refunds',id:'pfe_refund_b',version:1,data:refundData});assert.equal(denied.status,409);
 denied=await call('project-finance-entry-save',{...base(),entryType:'refunds',id:'pfe_refund_b',version:1,data:{...refundData,reference:'SYNTH-PFE-REFUND-B',account:''}});assert.equal(denied.status,400);
 assert.deepEqual(rawRecords().filter(r=>r.kind==='project_allocation'&&r.chargeId===charge.id),originalAllocations);
 pass('已核实收费可维护说明，真实到账更正保留核实权限与核销余额校验，不自动改写原分配');
}
