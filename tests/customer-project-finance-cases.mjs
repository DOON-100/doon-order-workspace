import assert from 'node:assert/strict';

// Only synthetic records are created. Existing customer/service finance records
// are compared byte-for-byte at the end of the suite.
export async function testCustomerProjectFinance({ok,call,state,pass,rawRecords,rawInsert}){
 const original=structuredClone(rawRecords()),token=()=>crypto.randomUUID();
 const user=(suffix,name)=>({userId:'pf_'+suffix,email:'pf_'+suffix+'@test.invalid',displayName:name,fullName:name});
 const sales=user('sales','项目财务合成业务'),finance=user('finance','项目财务合成财务'),other=user('other','项目财务无范围财务');
 for(const [u,role] of [[sales,'sales'],[finance,'finance'],[other,'finance']]){await ok('member',{name:u.displayName,email:u.email,role,customers:[],active:true,orderScope:'all'});await ok('enroll',{},u);}
 const members=(await state()).members,member=u=>members.find(m=>m.email===u.email);
 const a=(await ok('customer-save',{customer:'项目财务合成客户甲',customerCode:'SYNTH-PF-A',salesName:sales.displayName,serviceName:'',pmcName:'',active:true})).item;
 const b=(await ok('customer-save',{customer:'项目财务合成客户乙',customerCode:'SYNTH-PF-B',salesName:'',serviceName:'',pmcName:'',active:true})).item;
 const at='2026-10-12T00:00:00.000Z';
 const p={id:'pf_synthetic_project',kind:'customer_project',customerId:a.id,code:'SYNTH-PF-P',title:'合成开发项目',description:'合成',teamId:'',salesMemberId:member(sales).id,serviceMemberId:member(sales).id,dueDate:'',status:'active',version:1,createdAt:at,updatedAt:at,createdBy:'synthetic',updatedBy:'synthetic'};
 const p2={...p,id:'pf_synthetic_project_2',code:'SYNTH-PF-P2',title:'同客户第二项目'};
 const p3={...p,id:'pf_synthetic_project_other',customerId:b.id,code:'SYNTH-PF-P3'};
 const r={id:'pf_synthetic_round',kind:'customer_project_round',projectId:p.id,customerId:a.id,title:'合成样办轮次',type:'development',scope:[],status:'open',version:1};
 const r2={...r,id:'pf_synthetic_round_2',projectId:p2.id},r3={...r,id:'pf_synthetic_round_other',projectId:p3.id,customerId:b.id};
 for(const record of [p,p2,p3,r,r2,r3])rawInsert(record);
 const data=(u=finance,projectId=p.id)=>ok('project-finance-data?projectId='+projectId,undefined,u);
 const deny=async(action,body,status,u=sales)=>{const before=structuredClone(rawRecords()),response=await call(action,body,u);assert.equal(response.status,status,await response.text());assert.deepEqual(rawRecords(),before,'Rejected finance request mutated data');};
 await deny('project-finance-data?projectId='+p.id,undefined,403,finance);
 await deny('project-finance-data?projectId='+p.id,undefined,403,other);
 const grant=(await ok('project-finance-grant-save',{token:token(),memberId:member(finance).id,customerIds:[a.id],active:true})).record;
 assert.equal((await data()).canVerify,true);assert.equal((await data(sales)).canVerify,false);
 await deny('project-finance-data?projectId='+p3.id,undefined,403,finance);
 assert.equal((await data()).gates.find(x=>x.roundId===r.id).allowed,false);
 const freeRound={...r,id:'pf_synthetic_free_round',projectId:p2.id};rawInsert(freeRound);
 await deny('project-payment-requirement',{token:token(),projectId:p2.id,roundId:freeRound.id,mode:'free',reason:'合成免费批准',version:0},403,sales);
 await ok('project-payment-requirement',{token:token(),projectId:p2.id,roundId:freeRound.id,mode:'free',reason:'合成免费批准',version:0},finance);
 assert.equal((await data(finance,p2.id)).gates.find(g=>g.roundId===freeRound.id).allowed,true);
 pass('项目财务仅按明确客户授权读取；全订单范围不授予核款，未配置收费默认阻止转单');

 const charge=async(round,amount,category='sample')=>{
  let c=(await ok('project-charge-save',{token:token(),projectId:round.projectId,roundId:round.id,title:'合成'+category,category,currency:'USD',amount,prepayAmount:amount,dueDate:'2026-10-12',note:'synthetic'},sales)).record;
  await deny('project-charge-confirm',{token:token(),id:c.id,version:c.version},403);
  c=(await ok('project-charge-confirm',{token:token(),id:c.id,version:c.version},finance)).record;return c;
 };
 const sample=await charge(r,'500'),tooling=await charge(r,'1500','tooling'),extra=await charge(r2,'100');
 await ok('project-payment-requirement',{token:token(),projectId:p.id,roundId:r.id,mode:'charges',reason:'合成明确预收约定',version:0},finance);
 await deny('project-payment-requirement',{token:token(),projectId:p.id,roundId:r.id,mode:'free',reason:'不能绕过原费用',version:1},400,finance);
 const notice=(await ok('project-payment-notice',{token:token(),projectId:p.id,roundId:r.id,amount:'2100',currency:'USD',reference:'SYNTH-PAYMENT-ADVICE',note:'客户付款截图'},sales)).record;
 assert.equal((await data()).receipts.length,0);assert.equal((await data()).gates[0].allowed,false);
 const receiptBody={token:token(),customerId:a.id,amount:'2100',currency:'USD',date:'2026-10-12',reference:'SYNTH-BANK-1',account:'SYNTH-USD',payer:'Synthetic',note:'合成核实',noticeIds:[notice.id]};
 await deny('project-receipt-verify',receiptBody,403);
 const receipt=(await ok('project-receipt-verify',receiptBody,finance)).record;
 assert.equal((await ok('project-receipt-verify',receiptBody,finance)).idempotent,true);
 await deny('project-receipt-verify',{...receiptBody,token:token(),noticeIds:[]},409,finance);
 assert.equal(Object.hasOwn((await data(sales)).receipts[0],'account'),false);
 const receiptHistory=(await ok('project-finance-history?id='+receipt.id,undefined,sales)).history;assert(receiptHistory.length);assert.equal(Object.hasOwn(receiptHistory[0].after,'account'),false);assert.equal(Object.hasOwn(receiptHistory[0].after,'payer'),false);
 await ok('project-allocation',{token:token(),receiptId:receipt.id,chargeId:sample.id,amount:'500'},finance);
 assert.equal((await data()).gates[0].allowed,false);
 await ok('project-allocation',{token:token(),receiptId:receipt.id,chargeId:tooling.id,amount:'1500'},finance);
 await ok('project-allocation',{token:token(),receiptId:receipt.id,chargeId:extra.id,amount:'100'},finance);
 const afterPay=await data();assert.equal(afterPay.gates[0].allowed,true);assert.equal(afterPay.receipts[0].availableCents,0);assert.equal(afterPay.totalsByCurrency.USD.receivedCents,210000);assert.equal(afterPay.totalsByCurrency.USD.balanceCents,0);
 await deny('project-allocation',{token:token(),receiptId:receipt.id,chargeId:sample.id,amount:'0.01'},400,finance);
 pass('付款通知不算实收；样办和模具逐项核实后放行，一笔实收可跨同客户项目分配且不重复统计');

 let pi=(await ok('project-document-save',{token:token(),customerId:a.id,documentType:'PI',documentNo:'SYNTH-PI-1',chargeIds:[sample.id,tooling.id],currency:'USD',date:'2026-10-12',customerAddress:'<script>unsafe</script>',company:'DOON',terms:'Synthetic terms'},sales)).record;
 pi=(await ok('project-document-confirm',{token:token(),id:pi.id,version:pi.version},sales)).record;
 await ok('project-document-save',{token:token(),customerId:a.id,documentType:'CI',documentNo:'SYNTH-CI-1',chargeIds:[sample.id,tooling.id],currency:'USD',date:'2026-10-12',customerAddress:'',company:'DOON',terms:''},sales);
 assert.equal((await data()).totalsByCurrency.USD.receivableCents,210000);
 const print=await call('project-document-print?id='+pi.id,undefined,sales),printed=await print.text();assert.equal(print.status,200);assert(printed.includes('&lt;script&gt;unsafe&lt;/script&gt;'));assert(!printed.includes('<script>'));
 await deny('project-document-print?id='+pi.id,undefined,403,other);
 await deny('project-document-save',{token:token(),id:pi.id,version:pi.version,customerId:a.id,documentType:'PI',documentNo:'SYNTH-PI-1',chargeIds:[sample.id],currency:'USD',date:'2026-10-12',customerAddress:'',company:'',terms:''},409,sales);
 pass('PI与CI引用同一收费且不复制应收；单据核对锁定、受权限控制打印并转义输入');

 let bulk=(await ok('project-charge-save',{token:token(),projectId:p2.id,roundId:r2.id,title:'合成大货',category:'bulk',currency:'USD',amount:'10000',prepayAmount:'3000',dueDate:'',note:'',plan:[{title:'订金',amount:'3000',beforeOrder:true,dueDate:''},{title:'尾款',amount:'7000',beforeOrder:false,dueDate:''}]},sales)).record;
 bulk=(await ok('project-charge-confirm',{token:token(),id:bulk.id,version:bulk.version},finance)).record;
 assert.equal((await data()).totalsByCurrency.USD.receivableCents,1210000);
 await deny('project-charge-save',{token:token(),projectId:p2.id,roundId:r2.id,title:'错误分期',category:'bulk',currency:'USD',amount:'10000',prepayAmount:'3000',dueDate:'',note:'',plan:[{title:'订金',amount:'3000',beforeOrder:true,dueDate:''},{title:'错误全额尾款',amount:'10000',beforeOrder:false,dueDate:''}]},400,sales);
 await ok('project-credit-apply',{token:token(),sourceChargeId:extra.id,targetChargeId:bulk.id,amount:'100',reason:'合成样办费抵大货',evidence:'合成协议'},finance);
 await deny('project-credit-apply',{token:token(),sourceChargeId:extra.id,targetChargeId:bulk.id,amount:'0.01',reason:'不得重复抵扣',evidence:'合成'},400,finance);
 assert.equal((await data()).totalsByCurrency.USD.receivableCents,1200000);assert.equal((await data()).totalsByCurrency.USD.receivedCents,210000);
 pass('大货订金与尾款只作为总额分期，付款计划超出全额在后端拒绝');

 const caseBody={token:token(),projectId:p.id,roundId:r.id,orderId:'',shipmentReference:'SYNTH-SHIP',title:'合成售后',description:'合成折让',quantity:1,resolution:'discount',status:'open',ownerMemberId:member(sales).id,dueDate:'',customerEvidence:'',executionNote:'',returnedQuantity:0,completedQuantity:0,resentQuantity:0,trackingNo:'',customerAccepted:false};
 const caseRecord=(await ok('project-after-sale-save',caseBody,sales)).record;
 await ok('project-after-sale-cost',{token:token(),caseId:caseRecord.id,category:'repair',description:'合成免费返修成本',currency:'USD',budget:'250',actual:'220',bearer:'company',supplierReference:''},sales);
 assert.equal((await data()).totalsByCurrency.USD.receivableCents,1200000);
 await deny('project-adjustment',{token:token(),chargeId:sample.id,caseId:caseRecord.id,type:'discount',amount:'300',prepay:false,reason:'合成折让',evidence:'客户确认'},403,sales);
 const credit=(await ok('project-adjustment',{token:token(),chargeId:sample.id,caseId:caseRecord.id,type:'discount',amount:'300',prepay:false,reason:'合成折让',evidence:'客户确认'},finance)).record;
 const afterCredit=await data();assert.equal(afterCredit.totalsByCurrency.USD.receivableCents,1170000);assert.equal(afterCredit.receipts[0].availableCents,30000);assert.equal(afterCredit.charges.find(c=>c.id===sample.id).net.balanceCents,0);
 const refund=(await ok('project-refund-request',{token:token(),projectId:p.id,roundId:r.id,receiptId:receipt.id,caseId:caseRecord.id,amount:'300',reason:'客户已付款后同意折让'},sales)).record;
 const executed=(await ok('project-refund-execute',{token:token(),id:refund.id,version:refund.version,date:'2026-10-12',reference:'SYNTH-REFUND-1',account:'SYNTH-USD'},finance)).record;
 assert.equal(executed.status,'executed');const afterRefund=await data();assert.equal(afterRefund.receipts[0].availableCents,0);assert.equal(afterRefund.totalsByCurrency.USD.receivedCents,180000);assert.equal(afterRefund.charges.find(c=>c.id===sample.id).net.balanceCents,0);
 assert.equal(Object.hasOwn((await data(sales)).refunds.find(f=>f.id===refund.id),'account'),false);
 await deny('project-receipt-reverse',{token:token(),receiptId:receipt.id,reason:'不能把真实退款当误录'},400,finance);
 assert.equal(credit.amountCents,30000);
 pass('售后内部成本不增加应收；已结清折让释放原核销，真实退款不让客户重新欠钱且不能冒用误录冲销');

 const spare=(await ok('project-receipt-verify',{token:token(),customerId:a.id,amount:'10',currency:'USD',date:'2026-10-12',reference:'SYNTH-BANK-SPARE',account:'SYNTH-USD',payer:'',note:''},finance)).record;
 const reverseBody={token:token(),receiptId:spare.id,reason:'合成误录保留原流水'};await ok('project-receipt-reverse',reverseBody,finance);assert.equal((await ok('project-receipt-reverse',reverseBody,finance)).idempotent,true);
 await deny('project-receipt-reverse',{...reverseBody,token:token()},409,finance);
 const salesGrant=(await ok('project-finance-grant-save',{token:token(),memberId:member(sales).id,customerIds:[a.id],active:true})).record;
 const delegatedReceiptBody={token:token(),customerId:a.id,amount:'1',currency:'USD',date:'2026-10-12',reference:'SYNTH-DELEGATED',account:'SYNTH-PRIVATE-ACCOUNT',payer:'SYNTH-PRIVATE-PAYER',note:''};
 await ok('project-receipt-verify',delegatedReceiptBody,sales);
 await ok('project-finance-grant-save',{token:token(),id:salesGrant.id,version:salesGrant.version,memberId:member(sales).id,customerIds:[a.id],active:false});
 assert.equal((await data(sales)).canWrite,true);await deny('project-receipt-verify',delegatedReceiptBody,403,sales);
 await ok('project-finance-grant-save',{token:token(),id:grant.id,version:grant.version,memberId:member(finance).id,customerIds:[a.id],active:false});
 await deny('project-finance-data?projectId='+p.id,undefined,403,finance);
 await deny('project-receipt-reverse',reverseBody,403,finance);
 const after=rawRecords();for(const record of original)assert.deepEqual(after.find(r=>r.id===record.id),record,'Existing record changed: '+record.id);
 pass('误录冲销留痕幂等，撤销核款授权立即生效，所有既有订单、客户和旧service款项均保持原样');
}
