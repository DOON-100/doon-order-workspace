import assert from 'node:assert/strict';
import {build} from 'esbuild';

// This suite is appended after the existing business suites. Every new identity,
// customer, order and document here is synthetic; no production files are read.
export async function runServiceWorkspaceCases({ok,call,state,pass,rawRecords,rawInsert}){
 const identity=(id,name)=>({userId:id,email:id+'@test.invalid',displayName:name,fullName:name});
 const assigned=identity('service_case_assigned','CRM合成负责员');
 const other=identity('service_case_other','CRM合成另一负责员');
 const broadSales=identity('service_case_broad','CRM合成全订单员');
 const unknown=identity('service_case_unknown','CRM合成未授权员');
 const pmc=identity('service_case_pmc','CRM合成PMC兼任客服');
 const otherPmc=identity('service_case_other_pmc','CRM合成其他PMC');
 const clone=value=>structuredClone(value);
 const before=clone(rawRecords());
 const clerk=identity('service_case_clerk','CRM合成客服文员');
 const writeRoles=['production','finance','programmer','viewer'];
 const deniedRoles=[];
 for(const [user,role] of [[assigned,'sales'],[other,'sales'],[broadSales,'sales'],[clerk,'clerk'],[pmc,'pmc'],[otherPmc,'pmc'],...writeRoles.map(role=>[identity('service_case_'+role,'CRM合成'+role),role])]){
  await ok('member',{name:user.displayName,email:user.email,role,customers:['TEST-CRM-A','CRM合成客户甲'],orderScope:'all',active:true});
  await ok('enroll',{},user);
  if(!['sales','clerk','pmc'].includes(role))deniedRoles.push(user);
 }
 const memberList=(await state()).members;
 const memberFor=user=>memberList.find(member=>member.email===user.email);
 const account=(await ok('customer-save',{customer:'CRM合成客户甲',customerCode:'TEST-CRM-A',salesName:'',serviceName:assigned.displayName,pmcName:'',active:true})).item;
 const accountB=(await ok('customer-save',{customer:'CRM合成客户乙',customerCode:'TEST-CRM-B',salesName:other.displayName,serviceName:'',pmcName:'',active:true})).item;
 const pmcOnly=(await ok('customer-save',{customer:'CRM合成仅PMC客户',customerCode:'TEST-CRM-P',salesName:'',serviceName:'',pmcName:assigned.displayName,active:true})).item;
 const partial=(await ok('customer-save',{customer:'CRM合成部分姓名客户',customerCode:'TEST-CRM-PART',salesName:assigned.displayName+'额外文字',serviceName:'',pmcName:'',active:true})).item;
 const inactive=(await ok('customer-save',{customer:'CRM合成停用客户',customerCode:'TEST-CRM-I',salesName:assigned.displayName,serviceName:'',pmcName:'',active:false})).item;
 const deny=async(action,body,status,user=assigned)=>{const old=clone(rawRecords());const response=await call(action,body,user);assert.equal(response.status,status,`${action}: ${await response.text()}`);assert.deepEqual(rawRecords(),old,`${action}: a rejected request must not mutate records.`);};
 const list=user=>ok('service-data',undefined,user);
 const recordById=async(id,user=assigned)=>(await list(user)).records.find(record=>record.id===id);
 const base={type:'followup',customerId:account.id,orderId:'',title:'合成客服事项',description:'仅用于隔离测试',status:'open',waitingFor:'customer',dueDate:'2026-10-20',nextFollowUp:'2026-10-12',details:{category:'other'}};
 const draftFor=(customer,patch={})=>({...base,customerId:customer.id,...patch});
 const save=(payload,user=assigned)=>ok('service-save',payload,user);

 await deny('service-data',undefined,401,null);
 await deny('service-save',base,401,null);
 await deny('service-data',undefined,403,unknown);
 await deny('service-save',base,403,unknown);
 const visible=await list(assigned);
 assert.equal(visible.canWrite,true);
 assert(visible.customers.some(customer=>customer.id===account.id));
 for(const forbidden of [accountB,pmcOnly,partial,inactive]){
  assert(!visible.customers.some(customer=>customer.id===forbidden.id));
  await deny('service-save',draftFor(forbidden),403);
 }
 assert(!((await list(broadSales)).customers||[]).some(customer=>customer.id===account.id));
 await deny('service-save',base,403,broadSales);
 const roleAccounts=new Map();
 for(const user of deniedRoles){
  const owned=(await ok('customer-save',{customer:'CRM合成只读角色客户 '+user.userId,customerCode:'TEST-CRM-ROLE-'+user.userId,salesName:'',serviceName:user.displayName,pmcName:'',active:true})).item;
  roleAccounts.set(user.userId,owned);
  await deny('service-save',draftFor(owned),403,user);
  assert.equal((await list(user)).canWrite,false);
 }
 const quotePolicy=rawRecords().find(record=>record.kind==='customer_quote_access');
 assert(!quotePolicy?.memberIds?.includes(memberFor(assigned).id));
 pass('客服CRM按启用客户责任姓名完整匹配；未登录和非客服写入被拒绝，全订单及旧客户编码权限不能扩大CRM范围');

 // Reuse only an existing synthetic alias from earlier suites, without altering
 // the established authorization policy or another suite's member records.
 const aliasEntry=Object.entries(quotePolicy?.aliasesByMember||{}).find(([id,names])=>names.length&&memberList.some(member=>member.id===id&&member.role==='sales'&&member.active));
 assert(aliasEntry,'A synthetic configured sales alias is required from the preceding quotation suite.');
 const aliasMember=memberList.find(member=>member.id===aliasEntry[0]);
 const aliasUser={userId:aliasMember.userId,email:aliasMember.email,displayName:aliasMember.name,fullName:aliasMember.name};
 const aliasAccount=(await ok('customer-save',{customer:'CRM合成别名客户',customerCode:'TEST-CRM-ALIAS',salesName:'',serviceName:aliasEntry[1][0],pmcName:'',active:true})).item;
 assert((await list(aliasUser)).customers.some(customer=>customer.id===aliasAccount.id));
 const aliasRecord=(await save(draftFor(aliasAccount,{title:'合成别名客服跟进'}),aliasUser)).record;
 assert(aliasRecord?.id);
 assert(!(await list(assigned)).records.some(record=>record.id===aliasRecord.id));
 pass('管理员配置的客服别名可精确关联客户，新的客服账号不依赖报价名单授权即可跟进本人客户');

 // Historical PMC role labels must not block a person who is explicitly the
 // sales/service owner. Alias variation is tested in a cloned state only: the
 // already-configured policy and previous suites' members remain untouched.
 const pmcCustomer=(await ok('customer-save',{customer:'CRM合成PMC兼任客服客户',customerCode:'TEST-CRM-PMC-SERVICE',salesName:'',serviceName:pmc.displayName,pmcName:'',active:true})).item;
 const pmcOnlyCustomer=(await ok('customer-save',{customer:'CRM合成仅PMC跟单客户',customerCode:'TEST-CRM-PMC-ONLY',salesName:'',serviceName:'',pmcName:pmc.displayName,active:true})).item;
 const pmcFollowup=(await save(draftFor(pmcCustomer,{title:'合成PMC兼任客服跟进'}),pmc)).record;
 assert((await list(pmc)).records.some(record=>record.id===pmcFollowup.id));
 assert(!(await list(otherPmc)).records.some(record=>record.id===pmcFollowup.id));
 assert(!(await list(pmc)).customers.some(customer=>customer.id===pmcOnlyCustomer.id));
 await deny('service-save',draftFor(pmcOnlyCustomer),403,pmc);
 await deny('service-save',draftFor(pmcCustomer),403,otherPmc);
 await deny('service-save',base,403,pmc);
 const permissionBundle=await build({entryPoints:['lib/service-workspace.ts'],bundle:true,platform:'node',format:'esm',write:false});
 const permissions=await import('data:text/javascript;base64,'+Buffer.from(permissionBundle.outputFiles[0].text).toString('base64'));
 const pmcMember=memberFor(pmc),aliasPolicy=clone(quotePolicy),syntheticPmcAlias='SYNTHETIC-PMC-SERVICE-ALIAS';
 aliasPolicy.aliasesByMember={...aliasPolicy.aliasesByMember,[pmcMember.id]:[syntheticPmcAlias]};
 const permissionState={revision:1,records:clone(rawRecords()).map(record=>record.id===aliasPolicy.id?aliasPolicy:record)};
 assert.equal(aliasPolicy.memberIds.includes(pmcMember.id),false,'CRM alias ownership does not require a quotation grant.');
 assert.equal(permissions.canWriteServiceWorkspace(permissionState,pmcMember),true);
 assert.equal(permissions.canWriteServiceWorkspace(permissionState,memberFor(otherPmc)),false);
 assert.equal(permissions.assignedServiceCustomer(permissionState,pmcMember,{...pmcCustomer,serviceName:' synthetic-pmc-service-alias '}),true);
 assert.equal(permissions.assignedServiceCustomer(permissionState,pmcMember,{...pmcCustomer,serviceName:syntheticPmcAlias+' EXTRA'}),false);
 assert.equal(permissions.assignedServiceCustomer(permissionState,pmcMember,{...pmcCustomer,serviceName:'',pmcName:syntheticPmcAlias}),false);
 assert.equal(permissions.assignedServiceCustomer(permissionState,memberFor(otherPmc),{...pmcCustomer,serviceName:syntheticPmcAlias}),false);
 assert.equal(permissions.assignedServiceCustomer(permissionState,{...pmcMember,active:false},{...pmcCustomer,serviceName:syntheticPmcAlias}),false);
 assert.deepEqual(rawRecords().find(record=>record.id===quotePolicy.id),quotePolicy);
 pass('历史PMC角色仅凭明确业务/客服责任或管理员别名可维护本人CRM；其他PMC、仅PMC跟单字段及全订单范围均不扩大权限');

 const clerkAccount=(await ok('customer-save',{customer:'CRM合成客服文员客户',customerCode:'TEST-CRM-CLERK',salesName:'',serviceName:clerk.displayName,pmcName:'',active:true})).item;
 assert((await save(draftFor(clerkAccount,{title:'文员本人客户跟进'}),clerk)).record.id);
 await deny('service-save',base,403,clerk);

 const orderTemplate=rawRecords().find(record=>record.kind==='order');assert(orderTemplate);
 const orderFor=(id,customer)=>({...clone(orderTemplate),id,customer:customer.customer,orderNo:'SYNTHETIC-CRM-'+id,customerPO:'SYNTHETIC-PO',version:1,lifecycle:'active',ledger:undefined,ownerEmail:assigned.email});
 const orderA=orderFor('service_synthetic_order_a',account),orderB=orderFor('service_synthetic_order_b',accountB);
 rawInsert(orderA);rawInsert(orderB);
 const protectedOrders=clone(rawRecords().filter(record=>record.kind==='order'));
 const protectedCustomers=clone(rawRecords().filter(record=>record.kind==='customer_account'));
 const samples={
  customer_profile:{contactPerson:'Synthetic Contact',email:'crm-contact@test.invalid',phone:'TEST-PHONE',address:'Synthetic test address'},
  followup:{category:'询价跟进'},
  project:{model:'SYNTHETIC-PROJECT',drawing:'SYNTHETIC-DRAWING',stage:'合成开发阶段'},
  sample:{model:'SYNTHETIC-SAMPLE',drawing:'SYNTHETIC-DRAWING',sampleType:'合成确认样',approvalCustomer:'pending',approvalColor:'approved',approvalEngraving:'rejected',approvalAccessory:'not_required',trackingNo:'SYNTHETIC-SAMPLE-TRACK'},
  shipment:{invoiceNo:'SYNTHETIC-SHIP-INVOICE',quantity:25,shipDate:'2026-10-10',carrier:'Synthetic carrier',trackingNo:'SYNTHETIC-SHIP-TRACK',packingNote:'合成包装说明'},
  receivable:{invoiceNo:'SYNTHETIC-INVOICE-01',currency:'USD',amount:'100.01',terms:'合成付款条件'},
 };
 const fields=record=>{
  const payload=Object.fromEntries(['id','version','type','customerId','orderId','title','description','status','waitingFor','dueDate','nextFollowUp','details'].map(key=>[key,clone(record[key])]));
  if(payload.type==='receivable')delete payload.details.amountCents;
  return payload;
 };
 const currentRecords={};
 for(const [type,details] of Object.entries(samples)){
  const created=(await save({...base,type,title:'合成 '+type,orderId:type==='customer_profile'?'':orderA.id,details})).record;
  assert.equal(created.type,type);assert.equal(created.version,1);assert.equal(created.customerId,account.id);
  const firstRevision=clone(rawRecords().find(row=>row.kind==='service_revision'&&row.recordId===created.id));assert(firstRevision);
  const updated=(await save({...fields(created),description:'合成更新 '+type,waitingFor:'factory'})).record;
  assert.equal(updated.version,2);assert.equal(updated.description,'合成更新 '+type);
  assert.deepEqual(rawRecords().find(row=>row.id===firstRevision.id),firstRevision);
  const history=(await ok('service-history?id='+encodeURIComponent(created.id),undefined,assigned)).history;
  assert.deepEqual(history.map(row=>row.version),[2,1]);assert.equal(history[1].snapshot.description,base.description);
  assert.equal(history[0].snapshot.description,'合成更新 '+type);
  assert.equal(rawRecords().filter(row=>row.kind==='audit'&&row.targetId===created.id).length,2);
  await deny('service-save',{...fields(updated),version:1,description:'过期覆盖'},409);
  await deny('service-save',{...fields(updated),customerId:accountB.id},400);
  await deny('service-save',fields(updated),403,other);
  currentRecords[type]=updated;
 }
 await deny('service-save',{...base,type:'customer_profile',details:{...samples.customer_profile,email:'not-an-email'}},400);
 await deny('service-save',{...base,type:'customer_profile',details:samples.customer_profile},409);
 await deny('service-save',{...base,orderId:orderB.id},400);
 await deny('service-save',{...base,orderId:'service_nonexistent_order'},400);
 await deny('service-save',{...base,dueDate:'2026-02-30'},400);
 await deny('service-save',{...base,nextFollowUp:'not-a-date'},400);
 await deny('service-save',{...base,type:'sample',details:{...samples.sample,approvalColor:'guessed'}},400);
 await deny('service-save',{...base,type:'shipment',details:{...samples.shipment,quantity:0}},400);
 await deny('service-save',{...fields(currentRecords.project),type:'followup',details:samples.followup},400);
 pass('客户资料及跟进、开发、样品、出货、应收六类记录均可新增和更新；版本、审计及快照留痕，跨客户订单和过期覆盖均拒绝');

 const raceBase=currentRecords.followup;
 const race=await Promise.all([call('service-save',{...fields(raceBase),description:'并发甲'},assigned),call('service-save',{...fields(raceBase),description:'并发乙'},assigned)]);
 assert.deepEqual(race.map(response=>response.status).sort(),[200,409]);
 currentRecords.followup=await recordById(raceBase.id);assert.equal(currentRecords.followup.version,3);
 pass('同一客服记录并发保存仅一个成功，另一个返回冲突，不发生静默覆盖');

 let invoice=currentRecords.receivable;
 const euro=(await save({...base,type:'receivable',title:'合成欧元应收',details:{...samples.receivable,currency:'EUR',amount:'200.02'}})).record;
 const cny=(await save({...base,type:'receivable',title:'合成人民币应收',details:{...samples.receivable,currency:'CNY',amount:0.3}})).record;
 const otherInvoice=(await save({...base,customerId:accountB.id,type:'receivable',title:'另一客户合成应收',details:{...samples.receivable,amount:'55.55'}},other)).record;
 const euroFirst=clone(rawRecords().find(row=>row.id===euro.id)),cnyFirst=clone(rawRecords().find(row=>row.id===cny.id));
 let totals=(await list(assigned)).totalsByCurrency;
 assert.deepEqual(totals,{USD:{amountCents:10001,receivedCents:0,balanceCents:10001},EUR:{amountCents:20002,receivedCents:0,balanceCents:20002},CNY:{amountCents:30,receivedCents:0,balanceCents:30}});
 assert.deepEqual((await list(other)).totalsByCurrency,{USD:{amountCents:5555,receivedCents:0,balanceCents:5555}});
 await deny('service-save',{...base,type:'receivable',details:samples.receivable},409);
 for(const amount of ['',-1,'1.005','1e2','1000000001.00'])await deny('service-save',{...base,type:'receivable',details:{...samples.receivable,invoiceNo:'SYNTHETIC-INVALID',amount}},400);
 await deny('service-save',{...fields(invoice),status:'done'},400);
 pass('应收金额按整数分精确存储且按客户权限及币种分别汇总；重复发票、超精度、空值和非法金额不能入账');

 const finance=deniedRoles.find(user=>user.userId.endsWith('finance'));
 const financeAccount=roleAccounts.get(finance.userId);
 const financeInvoice=(await ok('service-save',{...base,customerId:financeAccount.id,type:'receivable',title:'合成财务只读应收',details:{...samples.receivable,amount:'12.34'}})).record;
 const financeView=await list(finance);assert.equal(financeView.canWrite,false);assert(financeView.records.some(record=>record.id===financeInvoice.id));assert(!financeView.records.some(record=>record.id===invoice.id));
 assert.deepEqual(financeView.totalsByCurrency,{USD:{amountCents:1234,receivedCents:0,balanceCents:1234}});
 await deny('service-save',fields(financeInvoice),403,finance);
 await deny('service-receipt',{recordId:financeInvoice.id,version:financeInvoice.version,amount:'1.00',date:'2026-10-08',reference:'SYNTHETIC-FINANCE',note:'只读角色不能核销',token:crypto.randomUUID()},403,finance);
 pass('财务仅可读取本人责任客户的应收，不能因全订单权限读取其他CRM或执行到账核销');

 const payment={recordId:invoice.id,version:invoice.version,amount:'35.25',date:'2026-10-08',reference:'SYNTHETIC-PAYMENT-01',note:'合成到账凭证',token:crypto.randomUUID()};
 await deny('service-receipt',{...payment,recordId:otherInvoice.id,version:otherInvoice.version},403);
 await deny('service-receipt',{...payment,recordId:currentRecords.project.id,version:currentRecords.project.version},400);
 for(const amount of ['0','-1','1.001'])await deny('service-receipt',{...payment,amount},400);
 const paid=await ok('service-receipt',payment,assigned);invoice=paid.record;
 assert.equal(paid.receipt.entryType,'payment');assert.equal(paid.receipt.amountCents,3525);assert.equal(invoice.receivedCents,3525);assert.equal(invoice.balanceCents,6476);
 assert.equal(Object.hasOwn(paid.receipt,'requestFingerprint'),false);
 const paymentStored=clone(rawRecords().find(row=>row.id===paid.receipt.id));
 const afterPayment=clone(rawRecords());const duplicate=await ok('service-receipt',payment,assigned);
 assert.equal(duplicate.idempotent,true);assert.equal(duplicate.receipt.id,paid.receipt.id);assert.deepEqual(rawRecords(),afterPayment);
 await deny('service-receipt',{...payment,amount:'35.26'},409);
 await deny('service-receipt',{...payment,version:invoice.version},409);
 await deny('service-receipt',{...payment,version:invoice.version,amount:'64.77',token:crypto.randomUUID()},400);
 await deny('service-receipt',{...payment,amount:'1.00',token:crypto.randomUUID()},409);
 await deny('service-save',{...fields(invoice),details:{...fields(invoice).details,amount:'35.24'}},400);
 await deny('service-save',{...fields(invoice),details:{...fields(invoice).details,currency:'EUR'}},400);
 await deny('service-save',{...fields(invoice),details:{...fields(invoice).details,invoiceNo:'ALTERED-INVOICE'}},400);
 await deny('service-save',{...fields(invoice),receivedCents:0},400);
 await deny('service-save',{...fields(invoice),status:'cancelled'},400);
 const paymentRace=await Promise.all([1,2].map(index=>call('service-receipt',{...payment,version:invoice.version,amount:'10.00',reference:'SYNTHETIC-RACE-'+index,token:crypto.randomUUID()},assigned)));
 assert.deepEqual(paymentRace.map(response=>response.status).sort(),[200,409]);invoice=await recordById(invoice.id);
 assert.equal(invoice.receivedCents,4525);assert.equal(invoice.balanceCents,5476);
 assert.deepEqual(rawRecords().find(row=>row.id===paymentStored.id),paymentStored);
 pass('到账确认精确消减应收，重复请求幂等、令牌不同内容冲突、旧版本和超收拒绝，并发不能重复核销');

 const originalSnapshots=clone(rawRecords().filter(row=>row.kind==='service_revision'&&row.recordId===invoice.id));
 const reverse={receiptId:paid.receipt.id,version:invoice.version,reason:'合成到账识别错误，保留原凭证冲销',token:crypto.randomUUID()};
 const reversed=await ok('service-receipt-reverse',reverse,assigned);invoice=reversed.record;
 assert.equal(reversed.receipt.entryType,'reversal');assert.equal(reversed.receipt.amountCents,3525);assert.equal(reversed.receipt.reversesId,paid.receipt.id);
 assert.equal(invoice.receivedCents,1000);assert.equal(invoice.balanceCents,9001);
 assert.deepEqual(rawRecords().find(row=>row.id===paymentStored.id),paymentStored);
 const reversalStored=clone(rawRecords().find(row=>row.id===reversed.receipt.id)),afterReverse=clone(rawRecords());
 assert.equal((await ok('service-receipt-reverse',reverse,assigned)).idempotent,true);assert.deepEqual(rawRecords(),afterReverse);
 await deny('service-receipt-reverse',{...reverse,reason:'变更冲销理由'},409);
 await deny('service-receipt-reverse',{...reverse,version:invoice.version,token:crypto.randomUUID()},409);
 await deny('service-receipt-reverse',{receiptId:reversed.receipt.id,version:invoice.version,reason:'不能冲销冲销凭证',token:crypto.randomUUID()},404);
 const settled=await ok('service-receipt',{...payment,version:invoice.version,amount:'90.01',reference:'SYNTHETIC-BALANCE',token:crypto.randomUUID()},assigned);invoice=settled.record;
 invoice=(await save({...fields(invoice),status:'done'})).record;assert.equal(invoice.balanceCents,0);assert.equal(invoice.status,'done');
 invoice=(await ok('service-receipt-reverse',{receiptId:settled.receipt.id,version:invoice.version,reason:'合成结清到账退回重新跟进',token:crypto.randomUUID()},assigned)).record;
 assert.equal(invoice.status,'open');assert.equal(invoice.balanceCents,9001);
 for(const snapshot of [paymentStored,reversalStored,...originalSnapshots])assert.deepEqual(rawRecords().find(row=>row.id===snapshot.id),snapshot);
 totals=(await list(assigned)).totalsByCurrency;assert.deepEqual(totals.USD,{amountCents:10001,receivedCents:1000,balanceCents:9001});
 assert.deepEqual(rawRecords().find(row=>row.id===euro.id),euroFirst);assert.deepEqual(rawRecords().find(row=>row.id===cny.id),cnyFirst);
 pass('冲销追加不可变凭证而不删除原到账及历史快照；重复冲销被阻止，结清后冲销会恢复待跟进余额');

 const pdfA=Buffer.from('%PDF-1.7\nSynthetic service attachment A'),pdfB=Buffer.from('%PDF-1.7\nSynthetic service attachment B');
 const upload=(record,bytes=pdfA,filename='synthetic-service.pdf')=>{const form=new FormData();form.set('recordId',record.id);form.set('version',String(record.version));form.set('file',new File([bytes],filename,{type:'application/pdf'}));form.set('note','仅供隔离测试');return form;};
 let project=currentRecords.project;
 await deny('service-attachment',upload(project),403,other);
 const firstUpload=await ok('service-attachment',upload(project),assigned);project=firstUpload.record;
 assert.equal(project.version,currentRecords.project.version+1);assert.equal(Object.hasOwn(firstUpload.attachment,'fileKey'),false);
 const firstAttachment=clone(rawRecords().find(row=>row.id===firstUpload.attachment.id));
 const loaded=await call('service-file?id='+encodeURIComponent(firstUpload.attachment.id),undefined,assigned);
 assert.equal(loaded.status,200);assert.deepEqual(Buffer.from(await loaded.arrayBuffer()),pdfA);assert.match(loaded.headers.get('content-disposition'),/^attachment;/);assert.equal(loaded.headers.get('x-content-type-options'),'nosniff');
 await deny('service-file?id='+encodeURIComponent(firstUpload.attachment.id),undefined,403,other);
 await deny('service-file?id='+encodeURIComponent(firstUpload.attachment.id),undefined,403,broadSales);
 await deny('service-file?id=service_attachment_guessed',undefined,403);
 await deny('service-file?id='+encodeURIComponent(firstAttachment.fileKey),undefined,403);
 await deny('service-history?id='+encodeURIComponent(project.id),undefined,403,other);
 await deny('service-history?id=service_record_guessed',undefined,403);
 await deny('service-attachment',upload({...project,version:project.version-1},pdfB),409);
 const beforeReupload=clone(rawRecords()),repeatUpload=await ok('service-attachment',upload(project),assigned);
 assert.equal(repeatUpload.idempotent,true);assert.equal(repeatUpload.attachment.id,firstUpload.attachment.id);assert.deepEqual(rawRecords(),beforeReupload);
 const secondUpload=await ok('service-attachment',upload(project,pdfB),assigned);project=secondUpload.record;
 assert.notEqual(secondUpload.attachment.id,firstUpload.attachment.id);assert.deepEqual(rawRecords().find(row=>row.id===firstAttachment.id),firstAttachment);
 assert.deepEqual(Buffer.from(await (await call('service-file?id='+encodeURIComponent(firstUpload.attachment.id),undefined,assigned)).arrayBuffer()),pdfA);
 assert.deepEqual(Buffer.from(await (await call('service-file?id='+encodeURIComponent(secondUpload.attachment.id),undefined,assigned)).arrayBuffer()),pdfB);
 assert(!(await list(other)).attachments.some(attachment=>attachment.id===firstUpload.attachment.id));
 const serviceTargets=new Set(rawRecords().filter(row=>row.kind.startsWith('service_')&&row.customerId===account.id).map(row=>row.id));
 for(const user of [other,broadSales,pmc,otherPmc,...deniedRoles.filter(user=>!user.userId.endsWith('finance'))])assert(!(await ok('data',undefined,user)).audits.some(audit=>serviceTargets.has(audit.targetId)));
 pass('客服附件逐版保存且原字节不变，重复上传幂等；文件、历史、数据列表及通用审计都按客户权限过滤，猜测ID不可读取');

 // Removing a responsibility immediately revokes record, receipt, file and
 // history access; only this suite's synthetic customer is intentionally edited.
 const protectedService=clone(rawRecords().filter(row=>row.kind.startsWith('service_')));
 await ok('customer-save',{...account,serviceName:other.displayName});
 const revoked=await list(assigned);
 assert(!revoked.records.some(row=>row.customerId===account.id));assert(!revoked.receipts.some(row=>row.customerId===account.id));assert(!revoked.attachments.some(row=>row.customerId===account.id));
 await deny('service-history?id='+encodeURIComponent(project.id),undefined,403);
 await deny('service-file?id='+encodeURIComponent(firstUpload.attachment.id),undefined,403);
 await deny('service-receipt',{...payment,version:invoice.version,amount:'1.00',token:crypto.randomUUID()},403);
 assert((await list(other)).records.some(row=>row.id===project.id));
 assert(!(await ok('data',undefined,assigned)).audits.some(audit=>serviceTargets.has(audit.targetId)));
 for(const row of protectedService)assert.deepEqual(rawRecords().find(record=>record.id===row.id),row);
 await ok('customer-save',{...(await state()).customerAccounts.find(row=>row.id===account.id),serviceName:assigned.displayName});
 pass('客户责任转移立即收回原客服的业务、到账、附件和历史权限，业务历史本身不改写');

 const activeAccount=(await state()).customerAccounts.find(row=>row.id===account.id);
 await ok('customer-save',{...activeAccount,active:false});
 assert(!(await list(assigned)).records.some(row=>row.customerId===account.id));
 await deny('service-file?id='+encodeURIComponent(firstUpload.attachment.id),undefined,403);
 await deny('service-save',fields(project),403);
 assert((await list()).records.some(row=>row.id===project.id),'Administrators retain read-only access to a disabled customer history.');
 await ok('customer-save',{...(await state()).customerAccounts.find(row=>row.id===account.id),active:true});
 const activeMember=(await state()).members.find(row=>row.id===memberFor(assigned).id);
 await ok('member',{...activeMember,active:false});
 await deny('service-data',undefined,403);
 await deny('service-file?id='+encodeURIComponent(firstUpload.attachment.id),undefined,403);
 await ok('member',{...activeMember,active:true});
 for(const row of protectedService)assert.deepEqual(rawRecords().find(record=>record.id===row.id),row);
 pass('停用客户或账号即时禁止业务和附件访问，管理员仍可查历史，不删除任何客服记录');

 const finalRows=new Map(rawRecords().map(row=>[row.id,row]));
 for(const row of before)assert.deepEqual(finalRows.get(row.id),row);
 for(const row of protectedOrders)assert.deepEqual(finalRows.get(row.id),row);
 for(const row of protectedCustomers)if(row.id!==account.id)assert.deepEqual(finalRows.get(row.id),row);
 pass('新增客服业务不改写此前的订单、客户清单、报价、账号或历史记录；范围内责任转移有单独审计');
}
