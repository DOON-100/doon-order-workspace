import assert from 'node:assert/strict';

// Run after testIeQuotes; these fixtures are deliberately separate from customer
// historical-template fixtures and never touch production identities or prices.
export async function testCustomerQuoteIe({ok,call,pass,rawRecords,rawInsert}){
 const member=id=>rawRecords().find(r=>r.kind==='member'&&r.id==='ie_test_'+id),user=m=>({userId:m.userId,email:m.email,displayName:m.name,fullName:m.name});
 const engineer=user(member('synthetic-engineer')),reviewer=user(member('synthetic-reviewer')),manager=user(member('synthetic-manager')),intruder=user(member('synthetic-other'));
 const account=rawRecords().find(r=>r.id==='ie_test_account'),accountB=rawRecords().find(r=>r.id==='ie_test_account_b');
 const original=rawRecords().find(r=>r.kind==='ie_quote'&&r.quoteNo==='IE-SYNTHETIC-01');
 const ieKeys=['customerAccountId','quoteNo','quoteDate','validUntil','batchId','exchangeRateCnyPerUsd','exchangeRateDate','exchangeRateSource','notes','lines','tooling'];
 const ieFields=q=>Object.fromEntries([...ieKeys,'id','version'].filter(k=>q[k]!==undefined).map(k=>[k,structuredClone(q[k])]));
 const seed=ieFields(original);delete seed.id;delete seed.version;seed.quoteNo='IE-SALES-LINK';seed.batchId='IE-SALES-LINK';
 let ie=(await ok('ie-quote-save',seed,engineer)).quote;
 const draftVersion=ie.version;
 ie=(await ok('ie-quote-submit',{id:ie.id,version:ie.version},engineer)).quote;
 ie=(await ok('ie-quote-review',{id:ie.id,version:ie.version,decision:'approve',reason:''},reviewer)).quote;
 const salesDraft={companyEn:'Synthetic Eyewear Ltd',companyZh:'合成眼镜公司',collectionEn:'Synthetic',collectionZh:'合成',customerCode:account.customerCode,customerName:account.customer,customerAccountId:account.id,quoteNo:'CUSTOMER-IE-LINK',quoteDate:'2026-10-01',validUntil:'2026-10-31',currency:'USD',lines:[{id:'sales-line',model:ie.lines[0].model,descriptionZh:'合成完整镜架',descriptionEn:'Synthetic complete frame',quantity:200,unitPrice:99,toolingFee:0}],terms:[{id:'sales-term',labelZh:'条款',labelEn:'Terms',zh:'合成条件已复核',en:'Synthetic terms reviewed',needsReview:false}],reviewNotes:[]};
 const salesFields=q=>Object.fromEntries([...Object.keys(salesDraft),'customerCharges','id','version'].filter(k=>q[k]!==undefined).map(k=>[k,structuredClone(q[k])]));
 const adopt=(q,source=ie,toolingMappings=[])=>({id:q.id,version:q.version,ieQuoteId:source.id,ieQuoteVersion:source.version,scopeAcknowledged:true,mappings:[{customerLineId:'sales-line',ieLineId:source.lines[0].id}],toolingMappings});
 const confirm=q=>({id:q.id,version:q.version,acknowledgeEnglish:true});
 let sales=(await ok('customer-quote-save',salesDraft)).quote;
 assert.equal((await call('customer-quote-adopt-ie',adopt(sales,{...ie,version:draftVersion}))).status,403);
 assert.equal((await call('customer-quote-adopt-ie',adopt(sales),intruder)).status,403);
 assert.equal((await call('customer-quote-save',{...salesFields(sales),ieSource:{quoteId:ie.id,version:ie.version}})).status,400);
 sales=(await ok('customer-quote-adopt-ie',adopt(sales))).quote;assert.equal(sales.lines[0].unitPrice,99);assert.equal(sales.ieSource.version,ie.version);
 assert.equal((await call('customer-quote-confirm',confirm(sales))).status,403);
 assert.equal((await call('customer-quote-confirm',confirm(sales),engineer)).status,403);
 assert.equal((await call('customer-quote-confirm',confirm(sales),reviewer)).status,403);
 const managerList=await ok('customer-quotes',undefined,manager);assert(managerList.quotes.some(q=>q.id===sales.id&&q.canConfirm&&q.canSeeInternal&&q.canReadTemplates===false));
 assert(managerList.customers.some(a=>a.id===account.id&&!a.canWrite));assert(!managerList.customers.some(a=>a.id===accountB.id));
 assert(managerList.quotes.every(q=>q.ieSource));assert.equal((await ok('data',undefined,manager)).customerQuoteAccess,true);
 sales=(await ok('customer-quote-confirm',confirm(sales),manager)).quote;assert.equal(sales.status,'confirmed');assert.equal(sales.lines[0].unitPrice,99);assert.equal(sales.confirmedBy,manager.displayName);
 pass('工程源须显式采用已发布同客户版本，客价由业务独立设置并仅绑定总经理批准，工程填报/复核人和普通管理员不能代批');

 let mismatch=(await ok('customer-quote-save',{...salesDraft,customerAccountId:accountB.id,customerCode:accountB.customerCode,customerName:accountB.customer,quoteNo:'IE-SALES-WRONG-CUSTOMER'})).quote;
 assert.equal((await call('customer-quote-adopt-ie',adopt(mismatch))).status,403);
 for(const [field,value] of [['model','WRONG-MODEL'],['quantity',999999]]){const body=structuredClone(salesDraft);body.quoteNo='IE-SALES-WRONG-'+field;body.lines[0][field]=value;mismatch=(await ok('customer-quote-save',body)).quote;assert.equal((await call('customer-quote-adopt-ie',adopt(mismatch))).status,400);}
 sales=(await ok('customer-quote-revise',{id:sales.id,version:sales.version})).quote;
 const changed=salesFields(sales);changed.lines[0].descriptionZh='更新供货范围';sales=(await ok('customer-quote-save',changed)).quote;
 assert.equal((await call('customer-quote-confirm',confirm(sales),manager)).status,409);
 sales=(await ok('customer-quote-adopt-ie',adopt(sales))).quote;
 const oldReleased=structuredClone(ie);ie=(await ok('ie-quote-revise',{id:ie.id,version:ie.version},engineer)).quote;
 // Draft edits do not invalidate the last released source used for customer pricing.
 sales=(await ok('customer-quote-confirm',confirm(sales),manager)).quote;assert.equal(sales.ieSource.version,oldReleased.version);
 sales=(await ok('customer-quote-revise',{id:sales.id,version:sales.version})).quote;
 ie=(await ok('ie-quote-submit',{id:ie.id,version:ie.version},engineer)).quote;ie=(await ok('ie-quote-review',{id:ie.id,version:ie.version,decision:'approve',reason:''},reviewer)).quote;
 assert.equal((await call('customer-quote-confirm',confirm(sales),manager)).status,409);
 sales=(await ok('customer-quote-adopt-ie',adopt(sales))).quote;sales=(await ok('customer-quote-confirm',confirm(sales),manager)).quote;
 pass('型号、客户、数量范围和采用后供货范围变更均校验；新的工程草稿不阻断，新的复核发布版本要求重新采用');

 // Synthetic actor provenance verifies the GM cannot approve a price revision
 // she herself edited even if another editor later saves the same draft.
 const stored=rawRecords().find(r=>r.id===sales.id),self={...structuredClone(stored),id:'ie_test_self_sales',status:'draft',version:1,updatedById:member('synthetic-manager').id,updatedBy:manager.displayName};delete self.confirmedAt;delete self.confirmedBy;delete self.confirmedById;
 rawInsert(self);rawInsert({id:'ie_test_self_sales_revision',kind:'customer_quote_revision',quoteId:self.id,version:1,action:'synthetic',updatedAt:self.updatedAt,updatedBy:self.updatedBy,snapshot:structuredClone(self)});
 assert.equal((await call('customer-quote-confirm',confirm(self),manager)).status,403);
 const ordinaryUpdate={...salesFields(self),quoteNo:'SELF-CANNOT-WASH'};const afterOther=(await ok('customer-quote-save',ordinaryUpdate)).quote;
 assert.equal((await call('customer-quote-confirm',confirm(afterOther),manager)).status,403);
 pass('最终客价审批绑定保存的版本与真实填报历史，其他人补存不能洗掉总经理本人编辑后自审的事实');

 const t=(await ok('ie-quote-tooling-register',{customerAccountId:account.id,name:'客价共模合成',reference:'IE-SALES-TOOL-01',chargeStatus:'uncollected',evidence:''},engineer)).tooling;
 const toolingSeed={...seed,quoteNo:'IE-SALES-TOOL',batchId:'IE-SALES-TOOL',tooling:[{id:'ie-sales-tool',toolingId:t.id,name:t.name,lineIds:[seed.lines[0].id],amount:500,chargeMode:'charge',evidence:'合成一次性费',notes:''}]};
 let source=(await ok('ie-quote-save',toolingSeed,engineer)).quote;source=(await ok('ie-quote-submit',{id:source.id,version:source.version},engineer)).quote;source=(await ok('ie-quote-review',{id:source.id,version:source.version,decision:'approve',reason:''},reviewer)).quote;
 const charge={id:'sales-charge',labelZh:'合成模具费',labelEn:'Synthetic tooling',amount:120,basisZh:'一次收费',basisEn:'One time charge',conditional:false,needsReview:false};
 let a=(await ok('customer-quote-save',{...salesDraft,quoteNo:'IE-SALES-TOOL-A',customerCharges:[charge]})).quote;
 const tm=[{toolingId:t.id,customerChargeId:charge.id}];a=(await ok('customer-quote-adopt-ie',adopt(a,source,tm))).quote;a=(await ok('customer-quote-confirm',confirm(a),manager)).quote;
 await ok('customer-quote-revise',{id:a.id,version:a.version});
 let b=(await ok('customer-quote-save',{...salesDraft,quoteNo:'IE-SALES-TOOL-B',customerCharges:[charge]})).quote;b=(await ok('customer-quote-adopt-ie',adopt(b,source,tm))).quote;
 assert.equal((await call('customer-quote-confirm',confirm(b),manager)).status,409);
 // A historical released source from another batch cannot bypass final customer
 // charging uniqueness while the first approved quotation remains unpaid.
 const otherBatch={...structuredClone(rawRecords().find(r=>r.id===source.id)),id:'ie_test_tool_other_batch_source',quoteNo:'IE-SALES-TOOL-OTHER-BATCH',batchId:'DIFFERENT-BATCH'};
 rawInsert(otherBatch);rawInsert({id:'ie_test_tool_other_batch_revision',kind:'ie_quote_revision',quoteId:otherBatch.id,version:otherBatch.version,action:'synthetic-history',snapshot:structuredClone(otherBatch)});
 b=(await ok('customer-quote-adopt-ie',adopt(b,otherBatch,tm))).quote;
 assert.equal((await call('customer-quote-confirm',confirm(b),manager)).status,409);
 await ok('ie-quote-tooling-register',{id:t.id,version:t.version,customerAccountId:account.id,name:t.name,reference:t.reference,chargeStatus:'collected',evidence:'合成实际收费凭证'},reviewer);
 assert.equal((await call('customer-quote-confirm',confirm(b),manager)).status,409);
 pass('一次性费用单独对应且业务可独立定价；客价修订及不同批次仍防共模二次列费，已收费后旧工程依据不能再次收取');
}
