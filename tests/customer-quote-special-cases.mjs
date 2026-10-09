import assert from 'node:assert/strict';

// Only synthetic quotations and identities belong in these fixtures.
// Invoke from the normal test harness after the customer-quote access cases.
export async function testCustomerQuoteSpecial({ok,call,pass,rawRecords,rawInsert}){
 const account=(await ok('customer-save',{customer:'合成备件模板测试客户',customerCode:'TEST-PART-TEMPLATE',salesName:'',serviceName:'',pmcName:'',active:true})).item;
 const base={companyEn:'Synthetic Parts Ltd',companyZh:'合成备件测试公司',collectionEn:'Synthetic collection',collectionZh:'合成系列',customerCode:account.customerCode,customerName:account.customer,customerAccountId:account.id,contactName:'Synthetic Contact',quoteNo:'TEST-PART-TEMPLATE-LEGACY',quoteDate:'2026-10-01',validUntil:'2026-11-01',currency:'USD',internalNotesZh:'SYNTHETIC PRIVATE COST NOTE',internalCosts:[{id:'special-cost',label:'Synthetic private costing',rmb:100,notes:''}],lines:[{id:'special-line',model:'SYNTHETIC-FRAME',descriptionZh:'合成整副成品',descriptionEn:'Synthetic complete frame',quantity:10,unitPrice:5,toolingFee:0}],terms:[{id:'special-term',labelZh:'报价条款',labelEn:'Quotation terms',zh:'合成报价条件已确认',en:'Synthetic quotation conditions reviewed',needsReview:false}],reviewNotes:[]};
 const confirmation=q=>({id:q.id,version:q.version,acknowledgeEnglish:true});
 const complete=async payload=>{
  const draft=(await ok('customer-quote-save',payload)).quote;
  const confirmed=(await ok('customer-quote-confirm',confirmation(draft))).quote;
  const rows=(await ok('customer-quote-completed')).rows.filter(row=>row.quoteId===confirmed.id&&row.quoteVersion===confirmed.version);
  assert.equal(rows.length,payload.lines.length);
  return {quote:confirmed,rows};
 };
 const legacy=(await ok('customer-quote-save',base)).quote;
 const legacyStored=structuredClone(rawRecords().find(row=>row.id===legacy.id));
 assert.equal(legacy.quoteMode,'order');assert.equal(legacy.businessType,'frame');assert.equal(legacy.pricingBasis,'row_item');
 assert.equal(legacy.lines[0].unit,'pair');assert.equal(legacy.lines[0].productType,'frame');assert.equal(legacy.lines[0].supplyStage,'finished');assert.equal(legacy.lines[0].scopeReviewed,true);
 for(const key of ['quoteMode','businessType','pricingBasis','brand','currencyReviewed'])assert.equal(Object.hasOwn(legacyStored,key),false);
 for(const key of ['unit','productType','supplyStage','scopeReviewed'])assert.equal(Object.hasOwn(legacyStored.lines[0],key),false);
 await ok('customer-quotes');assert.deepEqual(rawRecords().find(row=>row.id===legacy.id),legacyStored);
 const legacyConfirmed=(await ok('customer-quote-confirm',confirmation(legacy))).quote;
 const legacyRow=(await ok('customer-quote-completed')).rows.find(row=>row.quoteId===legacyConfirmed.id);
 assert.equal(legacyRow.unit,'pair');assert.equal(legacyRow.unitPrice,5);assert.equal(legacyRow.unitPriceUsd,5);assert.equal(legacyRow.currency,'USD');assert.equal(legacyRow.quantity,10);
 pass('旧报价省略新字段时保留成品／副／指定数量默认，仅补响应、不回写原草稿');

 const part={...base.lines[0],model:'SYNTHETIC-PART',factoryModel:'SYNTHETIC-PARENT',customerModel:'CUSTOMER-SYNTHETIC',materialNumber:'SYNTHETIC-PART-LEFT',productType:'spare_part',component:'Synthetic left temple',side:'left',supplyStage:'semi_finished',unit:'piece',scopeReviewed:true,scopeNotesZh:'单支合成左镜腿，不含整架及包装',scopeNotesEn:'One synthetic left temple; excludes complete frame and packaging',descriptionZh:'合成左镜腿半成品',descriptionEn:'Synthetic left semi-finished temple',quantity:12,unitPrice:2.75,quantityBasisZh:'每物料编号12件，左镜腿',quantityBasisEn:'12 pieces per material number, left temple'};
 const special={...base,brand:'Synthetic Brand',businessType:'spare_parts',quoteMode:'order',pricingBasis:'row_item',currencyReviewed:true,currency:'CNY',lines:[part],quoteNo:'TEST-PART-TEMPLATE-CNY'};
 const cny=await complete(special),cnyRow=cny.rows[0];
 assert.equal(cnyRow.currency,'CNY');assert.equal(cnyRow.unitPrice,2.75);assert.equal(cnyRow.unitPriceUsd,null);assert.equal(cnyRow.toolingFee,0);assert.equal(cnyRow.toolingFeeUsd,null);assert.equal(cnyRow.quantity,12);
 for(const key of ['factoryModel','customerModel','materialNumber','productType','component','side','supplyStage','unit','scopeReviewed','scopeNotesZh','scopeNotesEn'])assert.deepEqual(cnyRow[key],part[key]);
 assert.equal(cnyRow.brand,special.brand);assert.equal(cnyRow.businessType,'spare_parts');assert.equal(cnyRow.quoteMode,'order');assert.equal(cnyRow.pricingBasis,'row_item');assert.equal(cnyRow.currencyReviewed,true);
 assert.equal(cnyRow.quotedCustomer,'');
 assert(!JSON.stringify(cny.rows).includes(base.internalNotesZh));assert(!JSON.stringify(cny.rows).includes('internalCosts'));
 pass('备件原币种与件数原样归档，非USD的美元兼容字段为null，不换算、不泄露内部核价');

 const list={...special,quoteMode:'price_list',currency:'EUR',quoteNo:'TEST-PART-TEMPLATE-PRICE-LIST',lines:[{...part,quantity:null,unit:'pair',side:'none',materialNumber:'SYNTHETIC-TEMPLE-PAIR',component:'Synthetic temple pair',quantityBasisZh:'仅报每对单价，订单数量另行确认',quantityBasisEn:'Unit price per pair only; order quantity to be confirmed separately'}]};
 const priceList=await complete(list),listRow=priceList.rows[0];
 assert.equal(listRow.quoteMode,'price_list');assert.equal(listRow.quantity,null);assert.equal(listRow.currency,'EUR');assert.equal(listRow.unit,'pair');assert.equal(listRow.unitPrice,2.75);assert.equal(listRow.unitPriceUsd,null);
 assert.equal(listRow.quantityBasisZh,list.lines[0].quantityBasisZh);assert.equal(listRow.quantityBasisEn,list.lines[0].quantityBasisEn);
 assert(!Object.hasOwn(listRow,'totalAmount'));
 for(const unit of ['piece','pair','set']){
  const result=await complete({...list,quoteNo:'TEST-PART-TEMPLATE-UNIT-'+unit,lines:[{...list.lines[0],unit,component:'Synthetic '+unit+' supply',materialNumber:'SYNTHETIC-UNIT-'+unit}]});
  assert.equal(result.rows[0].unit,unit);assert.equal(result.rows[0].unitPrice,2.75);assert.equal(result.rows[0].quantity,null);
 }
 const whole=await complete({...list,quoteNo:'TEST-PART-TEMPLATE-WHOLE-MODEL',pricingBasis:'whole_model',lines:[{...list.lines[0],unit:'set',component:'Synthetic complete parts set'}]});
 assert.equal(whole.rows[0].pricingBasis,'whole_model');assert.equal(whole.rows[0].unit,'set');assert.equal(whole.rows[0].unitPrice,2.75);
 pass('价目表数量为空仍可确认，数量适用条件完整归档，件／对／套保持原单位，整款计价保留明确依据');

 const invalid=[
  {quoteMode:'order',lines:[{...part,quantity:null}]},
  {currencyReviewed:false},
  {currencyReviewed:undefined},
  {pricingBasis:'pending'},
  {pricingBasis:undefined},
  {businessType:'frame'},
  {businessType:undefined},
  {lines:[{...part,unit:'unknown'}]},
  {lines:[{...part,productType:'unknown'}]},
  {lines:[{...part,supplyStage:'unknown'}]},
  {lines:[{...part,scopeReviewed:false}]},
  {lines:[{...part,scopeReviewed:undefined}]},
  {lines:[{...part,scopeNotesZh:''}]},
  {lines:[{...part,scopeNotesEn:''}]},
  {lines:[{...part,component:'',materialNumber:''}]},
  {lines:[{...part,quantityBasisZh:''}]},
  {lines:[{...part,quantityBasisEn:''}]},
  {quoteMode:'order',businessType:'frame',lines:[{...base.lines[0]}]},
 ];
 for(const [index,patch] of invalid.entries()){
  const draft=(await ok('customer-quote-save',{...list,...patch,quoteNo:'TEST-PART-TEMPLATE-INVALID-'+index})).quote;
  const before=structuredClone(rawRecords());
  assert.equal((await call('customer-quote-confirm',confirmation(draft))).status,400);
  assert.deepEqual(rawRecords(),before);
  assert(!(await ok('customer-quote-completed')).rows.some(row=>row.quoteId===draft.id));
 }
 for(const value of ['pcs','PAIR','set/pair'])assert.equal((await call('customer-quote-save',{...special,quoteNo:'TEST-PART-TEMPLATE-BAD-UNIT-'+value,lines:[{...part,unit:value}]})).status,400);
 for(const quantity of [0,1.5,''])assert.equal((await call('customer-quote-save',{...special,quoteNo:'TEST-PART-TEMPLATE-BAD-QUANTITY',lines:[{...part,quantity}]})).status,400);
 pass('备件币种、单位、产品类型、计价依据、供货范围和价目表数量条件未确认时阻止确认且无部分归档');

 // Explicit public allowlists also protect malformed historical input, without
 // pretending that such data can pass normal save/confirmation validation.
 const privateFixture={...legacyStored,id:'synthetic_special_private_quote',quoteNo:'TEST-PART-TEMPLATE-PRIVATE',lines:[{...legacyStored.lines[0],privateCostNote:'SYNTHETIC-LINE-SECRET',fileKey:'SYNTHETIC-INTERNAL-FILE'}]};
 rawInsert(privateFixture);
 const exposed=(await ok('customer-quotes')).quotes.find(row=>row.id===privateFixture.id);
 assert(exposed);assert(!JSON.stringify(exposed.lines).includes('SYNTHETIC-LINE-SECRET'));assert(!JSON.stringify(exposed.lines).includes('SYNTHETIC-INTERNAL-FILE'));
 assert.deepEqual(rawRecords().find(row=>row.id===privateFixture.id),privateFixture);
 pass('报价行公开字段采用明确allowlist，隐藏历史异常附加字段而不修改原记录');
}
