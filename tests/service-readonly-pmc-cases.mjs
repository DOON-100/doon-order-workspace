import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';

// Appended after other suites. All fixtures are synthetic; this test never opens
// a database, a LAN URL, a real account or an employee-supplied workbook.
export async function runServiceReadonlyPmcCases({ok,call,state,pass,rawRecords,rawInsert}){
 const clone=value=>structuredClone(value),before=clone(rawRecords());
 const user={userId:'synthetic_service_readonly_pmc',email:'synthetic_service_readonly_pmc@test.invalid',displayName:'合成客服PMC只读员',fullName:'合成客服PMC只读员'};
 const allDepartments=['pmc','titanium','outsourcing','plating','semifinished','plastic','finished'];
 await ok('member',{name:user.displayName,email:user.email,role:'sales',orderScope:'all',customers:['TEST-READONLY-PMC','TEST-READONLY-OTHER'],departments:allDepartments,active:true});
 await ok('enroll',{},user);
 const members=(await state()).members,member=members.find(m=>m.email===user.email);
 const policy=rawRecords().find(r=>r.kind==='customer_quote_access');
 const aliasEntry=Object.entries(policy.aliasesByMember).find(([id,aliases])=>aliases.length&&members.some(m=>m.id===id&&m.active&&m.role==='sales'&&m.orderScope==='all')&&policy.memberIds.includes(id));
 assert(aliasEntry,'The earlier quote suite must provide a synthetic sales/all alias identity.');
 const aliasMember=members.find(m=>m.id===aliasEntry[0]),alias=aliasEntry[1][0];
 const aliasUser={userId:aliasMember.userId,email:aliasMember.email,displayName:aliasMember.name,fullName:aliasMember.name};
 const customer=async(name,code,serviceName,pmcName='')=>(await ok('customer-save',{customer:name,customerCode:code,salesName:'',serviceName,pmcName,active:true})).item;
 const mine=await customer('合成只读PMC本人客户','TEST-READONLY-PMC',user.displayName,user.displayName);
 const other=await customer('合成只读PMC他人客户','TEST-READONLY-OTHER','合成其他客服',user.displayName);
 const aliasAccount=await customer('合成只读PMC别名客户','',alias,aliasMember.name);
 const partial=await customer('合成只读PMC部分别名客户','TEST-READONLY-PARTIAL',alias+' EXTRA',aliasMember.name);
 const template=rawRecords().find(r=>r.kind==='order'&&r.ledger&&r.lifecycle!=='archived');assert(template);
 const order=(suffix,account,ownerEmail,customerValue=account.customer)=>({
  ...clone(template),id:'synthetic_readonly_order_'+suffix,version:1,orderNo:'SYNTHETIC-READONLY-'+suffix,
  customer:customerValue,customerPO:'SYNTHETIC-PO',drawing:'SYNTHETIC-DRAWING',color:'TEST-COLOR',lens:'白片',
  batch:'',quantity:100,ownerEmail,productType:'钛架',requestedDate:'2026-10-20',plannedDate:'2026-10-18',shipDate:'2026-10-19',
  notes:'合成测试历史备注',workflowStatus:'客服待审核',lifecycle:'active',closedDate:'',archiveReason:'',
  ledger:{...clone(template.ledger),columns:{...clone(template.ledger.columns),A:'度昂',C:customerValue,I:'SYNTHETIC-READONLY-'+suffix,J:'SYNTHETIC-DRAWING',L:'TEST-COLOR',M:'100',U:'2026-10-18',W:'钛架',AB:'合成测试历史备注',AC:'2026-10-10',BF:'10',BH:''}},
 });
 const ownOrder=order('OWN',mine,user.email),otherOrder=order('OTHER',other,user.email),aliasOrder=order('ALIAS',aliasAccount,aliasMember.email,'TEST-REVIEWED-SERVICE-CODE'),partialOrder=order('PARTIAL',partial,aliasMember.email);
 for(const item of [ownOrder,otherOrder,aliasOrder,partialOrder])rawInsert(item);
 rawInsert({id:'synthetic_readonly_customer_profile',kind:'service_record',type:'customer_profile',version:1,customerId:aliasAccount.id,orderId:'',title:'合成已确认客户代号',description:'',status:'open',waitingFor:'none',dueDate:'',nextFollowUp:'',details:{},source:{confirmedCustomerCode:'TEST-REVIEWED-SERVICE-CODE'},createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),updatedBy:'合成测试'});
 const denied=async(action,body,status=403,actor=user)=>{
  const snapshot=clone(rawRecords()),res=await call(action,body,actor),text=await res.text();
  assert.equal(res.status,status,`${action}: ${text}`);assert.deepEqual(rawRecords(),snapshot,`${action} must not write on rejection.`);
 };
 const current=id=>rawRecords().find(r=>r.id===id);
 const main=await ok('data',undefined,user);
 assert.equal(main.me.role,'sales');assert.deepEqual(main.me.departments,allDepartments);
 assert(main.orders.some(o=>o.id===ownOrder.id)&&main.orders.some(o=>o.id===otherOrder.id));
 assert(main.collaborationAssignments.some(a=>a.customerId===mine.id&&a.service&&!a.pmc));
 assert(!main.collaborationAssignments.some(a=>a.customerId===other.id));
 assert(main.collaborationAssignments.every(a=>!a.pmc));
 const aliasProjection=(await ok('data',undefined,aliasUser)).collaborationAssignments;
 assert(aliasProjection.some(a=>a.customerId===aliasAccount.id&&a.service&&!a.pmc&&a.orderKeys.includes('TEST-REVIEWED-SERVICE-CODE')));
 assert(!aliasProjection.some(a=>a.customerId===partial.id));
 const exportResponse=await call('ledger-export?production=internal&mode=active',undefined,user);
 assert.equal(exportResponse.status,200);
 const exportBook=XLSX.read(await exportResponse.arrayBuffer());
 assert(XLSX.utils.sheet_to_json(exportBook.Sheets[exportBook.SheetNames[0]]).some(row=>row['订单号']===ownOrder.orderNo));
 pass('客服 sales + 全订单查询保留既有客户和全部部门设置，仍可查看及导出 PMC 总表');

 for(const col of ['U','AB','AC','AD','AE','AF'])await denied('pmc-save',{changes:[{id:ownOrder.id,version:1,col,value:col==='AB'?'禁止修改':'2026-10-21'}]});
 await denied('pmc-round',{token:crypto.randomUUID(),lineIds:[ownOrder.id],scope:'合成只读测试',productionScope:'internal'});
 await denied('pmc-review',{roundId:'synthetic-denied-round',lineId:ownOrder.id,version:1,status:'done'});
 for(const patch of [{AC:'2026-10-21'},{AF:'2026-10-21'},{BH:'2026-10-21'},{BF:'90'},{AL:'90'},{BD:'90'}])await denied('ledger-edit',{id:ownOrder.id,version:1,patch,reason:'合成拒绝测试'});
 for(const patch of [{plannedDate:'2026-10-21'},{shipDate:'2026-10-21'},{stage:'生产中'},{ownerEmail:'admin@test.invalid'}])await denied('edit-order',{id:ownOrder.id,version:1,patch});
 for(const mode of ['archived','active'])await denied('ledger-lifecycle',{id:ownOrder.id,version:1,mode,reason:'合成拒绝结单',closedDate:'2026-10-21'});
 await denied('ledger-assign',{ownerName:'合成跟单员',email:user.email});
 for(const action of ['accept-pmc','save-pmc'])await denied('workflow',{id:ownOrder.id,version:1,action,productionStartDate:'2026-10-12',productionFinishDate:'2026-10-21',promisedDate:'2026-10-22'});
 for(const action of ['pmc-confirm','release'])await denied('factory-order-save',{lineId:ownOrder.id,action,sourceEnglish:'Synthetic titanium frame',chineseProcess:'合成钛架',materialImageConfirmed:true});
 pass('即使本人是订单负责人、保留全部部门且客户 PMC 同名，也不能排期、结单、工序录入、接单或 PMC 确认下发');

 for(const action of ['ledger-preview','receipt-photo','purchase-preview'])await denied(action,new FormData());
 for(const action of ['ledger-commit','purchase-commit','purchase-save','purchase-receipt','purchase-archive','outsource-create','outsource-update','outsource-cancel','supplier-save','match','review','member'])await denied(action,{});
 await denied('loss-record',{lineId:ownOrder.id,version:1,process:'assembly',department:'plastic',input:100,wip:0,reportDate:'2026-10-08',reason:'合成工序写入拒绝',token:crypto.randomUUID(),patch:{BD:'100'}});
 // A historical receipt photo owned by this sales account must not reopen a
 // process-write route after its old role has been removed.
 const photo={id:'synthetic_readonly_photo',kind:'receipt_photo',actorId:member.id,filename:'synthetic.pdf'};
 const outsource={id:'synthetic_readonly_outsource',kind:'outsource',lineId:ownOrder.id,supplier:'合成供应商',process:'plating',approvalStatus:'已审批',quantity:100,received:0,version:1};
 rawInsert(photo);rawInsert(outsource);
 await denied('receipt-confirm',{photoId:photo.id,supplier:outsource.supplier,deliveryNo:'SYNTHETIC-DELIVERY',receivedDate:'2026-10-08',note:'',token:crypto.randomUUID(),lines:[{outsourceId:outsource.id,accepted:1,rejected:0}]});
 for(const importType of ['orders','mes']){
  const job={id:'synthetic_readonly_import_'+importType,kind:'import',importType,actorId:member.id,createdAt:new Date().toISOString(),status:'待确认',filename:'synthetic.xlsx',rows:[{index:2,status:'update',expectedVersion:1,before:clone(ownOrder),after:{...clone(ownOrder),plannedDate:'2026-11-01'},changes:['plannedDate']}]};
  rawInsert(job);await denied('commit-import',{id:job.id,selected:[2]});
 }
 const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.json_to_sheet([{'订单号':ownOrder.orderNo,'客户':ownOrder.customer,'图纸编号':ownOrder.drawing,'色号':ownOrder.color,'镜片类型':ownOrder.lens,'订单数量':100,'预计完工日':'2026-11-01'}]),'订单');
 const form=new FormData();form.set('file',new File([XLSX.write(book,{type:'buffer',bookType:'xlsx'})],'synthetic-standard.xlsx'));form.set('type','orders');
 const inspected=await ok('inspect',form,user);form.set('mapping',JSON.stringify(inspected.mapping));
 const preview=await ok('preview',form,user);assert.equal(preview.rows[0].status,'error');assert.match(preview.rows[0].reason,/预计完工|无权/);
 assert.deepEqual(current(ownOrder.id),ownOrder);
 pass('原表导入、工作表回传、MES、历史送货单消数、外发/采购、损耗和账号管理均不能绕过 PMC 只读限制');

 const servicePayload={type:'followup',customerId:mine.id,orderId:ownOrder.id,title:'合成客服责任工作',description:'',status:'open',waitingFor:'customer',dueDate:'',nextFollowUp:'',details:{category:'other'}};
 const record=(await ok('service-save',servicePayload,user)).record;assert(record.id);
 await denied('service-save',{...servicePayload,customerId:other.id,orderId:otherOrder.id});
 assert(!(await ok('service-data',undefined,user)).customers.some(a=>a.id===other.id));
 const aliasRecord=(await ok('service-save',{...servicePayload,customerId:aliasAccount.id,orderId:aliasOrder.id},aliasUser)).record;assert(aliasRecord.id);
 for(const action of ['return-business','submit-pmc']){
  const next=await ok('workflow',{id:aliasOrder.id,version:current(aliasOrder.id).version,action,note:'合成客服责任交接'},aliasUser);
  assert.equal(next.item.workflowStatus,action==='return-business'?'退回业务补充':'PMC待接单');
  await denied('workflow',{id:otherOrder.id,version:current(otherOrder.id).version,action,note:'不应越客交接'},403,aliasUser);
  await denied('workflow',{id:partialOrder.id,version:current(partialOrder.id).version,action,note:'别名不得部分匹配'},403,aliasUser);
 }
 for(const action of ['accept-pmc','save-pmc'])await denied('workflow',{id:aliasOrder.id,version:current(aliasOrder.id).version,action},403,aliasUser);
 for(const action of ['draft','service-confirm'])assert((await ok('factory-order-save',{lineId:aliasOrder.id,action,sourceEnglish:'Synthetic approved English',chineseProcess:'合成客服中文审核内容'},aliasUser)).item.id);
 // Existing internal-order drafting remains intentionally available; this suite
 // does not redefine its customer scope. Only its PMC stages must stay blocked.
 for(const action of ['pmc-confirm','release'])await denied('factory-order-save',{lineId:aliasOrder.id,action,sourceEnglish:'Synthetic approved English',chineseProcess:'合成客服中文审核内容',materialImageConfirmed:true},403,aliasUser);
 pass('客服仍可维护责任 CRM，并按管理员完整别名及已确认客户代号退回/提交 PMC；部分姓名与其他客户不可交接，内部订单客服审核保留');

 const quote={companyEn:'Synthetic Eyewear Ltd',companyZh:'合成测试公司',collectionEn:'Synthetic collection',collectionZh:'合成系列',customerCode:'',customerName:aliasAccount.customer,customerAccountId:aliasAccount.id,quoteNo:'SYNTHETIC-READONLY-QUOTE',quoteDate:'2026-10-08',validUntil:'2026-11-08',currency:'USD',lines:[{id:'synthetic-line',model:'SYNTHETIC-MODEL',descriptionZh:'合成材质',descriptionEn:'Synthetic material',quantity:300,unitPrice:10,toolingFee:0}],terms:[],reviewNotes:['仅合成测试']};
 let saved=(await ok('customer-quote-save',quote,aliasUser)).quote;
 saved=(await ok('customer-quote-save',{...quote,id:saved.id,version:saved.version,lines:[{...quote.lines[0],unitPrice:11}]},aliasUser)).quote;
 assert.equal(saved.lines[0].unitPrice,11);
 await denied('customer-quote-save',{...quote,quoteNo:'SYNTHETIC-CROSS-QUOTE',customerAccountId:other.id,customerCode:other.customerCode,customerName:other.customer},403,aliasUser);
 await denied('service-save',{...servicePayload,customerId:partial.id,orderId:partialOrder.id},403,aliasUser);
 const collision=await customer('合成已确认代号冲突客户','TEST-REVIEWED-SERVICE-CODE','合成其他客服');assert(collision.id);
 assert(!(await ok('data',undefined,aliasUser)).collaborationAssignments.some(a=>a.orderKeys.includes('TEST-REVIEWED-SERVICE-CODE')));
 await denied('workflow',{id:aliasOrder.id,version:current(aliasOrder.id).version,action:'submit-pmc'},403,aliasUser);
 await denied('service-save',{...servicePayload,customerId:aliasAccount.id,orderId:aliasOrder.id},400,aliasUser);
 pass('报价授权及责任别名继续生效且只维护本人客户；客户代号出现冲突时关闭订单关联与交接，不猜测匹配');

 const after=new Map(rawRecords().map(r=>[r.id,r]));
 for(const original of before)assert.deepEqual(after.get(original.id),original);
 for(const original of [ownOrder,otherOrder,partialOrder])assert.deepEqual(after.get(original.id),original);
 const aliasNow=current(aliasOrder.id);
 for(const field of ['ledger','quantity','plannedDate','shipDate','stage','lifecycle','closedDate','archiveReason'])assert.deepEqual(aliasNow[field],aliasOrder[field]);
 pass('客服权限回归只新增合成业务记录和交接留痕，不改任何既有账号、客户、报价或订单历史及 PMC 生产字段');
}
