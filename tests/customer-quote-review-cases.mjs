import assert from 'node:assert/strict';

// These fixtures are synthetic and must not be replaced by customer documents.
export async function testCustomerQuoteReview({ok,call,state,pass,rawRecords,rawInsert}){
 const identity=(id,name)=>({userId:id,email:id+'@test.invalid',displayName:name,fullName:name});
 const assigned=identity('quote_assigned','报价负责测试员'),other=identity('quote_other','报价另组测试员');
 const allSales=identity('quote_all','报价全订单测试员');
 const account=(await ok('customer-save',{customer:'无码报价合成客户',customerCode:'',salesName:assigned.displayName,serviceName:'',pmcName:'',active:true})).item;
 const accountB=(await ok('customer-save',{customer:'另一报价确认合成客户',customerCode:'TEST-REVIEW-B',salesName:other.displayName,serviceName:'',pmcName:'',active:true})).item;
 const draft={companyEn:'Example Synthetic Ltd',companyZh:'合成报价测试公司',collectionEn:'Synthetic review collection',collectionZh:'合成确认系列',customerCode:'',customerName:account.customer,customerAccountId:account.id,contactName:'Synthetic Contact',quoteNo:'TEST-REVIEW-NO-CODE',quoteDate:'2026-10-02',validUntil:'2026-11-02',currency:'USD',internalNotesZh:'仅供内部核价的合成保密说明',exchangeRateCnyPerUsd:5,internalCosts:[{id:'cost-a',label:'合成内部核价',rmb:60,notes:'仅供测试'}],lines:[{id:'review-line-a',model:'TEST-REVIEW-MODEL',descriptionZh:'合成材质与结构',descriptionEn:'Synthetic material and construction',quantity:null,unitPrice:null,toolingFee:null}],terms:[{id:'review-term-a',labelZh:'交付条款',labelEn:'Delivery terms',zh:'待核对',en:'Pending review',needsReview:true,reviewNote:'合成待确认项目'}],reviewNotes:['此测试草稿缺少数量，不是已发报价']};
 const fields=q=>Object.fromEntries([...Object.keys(draft),'customerCharges','id','version'].filter(k=>q[k]!==undefined).map(k=>[k,q[k]]));
 const before=rawRecords().map(record=>structuredClone(record));
 let q=(await ok('customer-quote-save',draft,assigned)).quote;
 assert.equal(q.customerCode,'');assert.equal(q.customerAccountId,account.id);assert.equal(q.status,'draft');assert.equal(q.canEdit,true);
 for(const field of ['quantity','unitPrice','toolingFee'])assert.equal(q.lines[0][field],null);
 assert.equal(q.internalNotesZh,draft.internalNotesZh);assert.equal(q.exchangeRateCnyPerUsd,5);assert.deepEqual(q.internalCosts,draft.internalCosts);
 const unbound=(await ok('customer-quote-save',{...draft,quoteNo:'TEST-REVIEW-UNBOUND',customerAccountId:null,customerName:'未建档合成询价客户'})).quote;
 assert.equal(unbound.customerCode,'');assert.equal(unbound.customerAccountId,null);assert.equal(unbound.lines[0].quantity,null);
 assert(!(await ok('customer-quotes',undefined,assigned)).quotes.some(item=>item.id===unbound.id));
 for(const field of ['quantity','unitPrice','toolingFee']){
  assert.equal((await call('customer-quote-save',{...fields(q),lines:[{...q.lines[0],[field]:''}]},assigned)).status,400);
  assert.equal((await call('customer-quote-save',{...fields(q),lines:[{...q.lines[0],[field]:-1}]},assigned)).status,400);
 }
 assert.equal((await ok('customer-quotes')).quotes.find(item=>item.id===q.id).version,q.version);
 pass('无码新客及未建档询价可保存草稿，数量和价格待定保留 null，空字符串不静默转换为零');

 // An old record without the additive fields remains byte-for-byte intact.
 const legacy=structuredClone(rawRecords().find(item=>item.id===q.id));
 legacy.id='synthetic_legacy_quote_review';legacy.quoteNo='TEST-LEGACY-REVIEW';
 for(const field of ['contactName','internalNotesZh','exchangeRateCnyPerUsd','internalCosts','customerCharges'])delete legacy[field];
 rawInsert(legacy);
 const legacySnapshot={id:'synthetic_legacy_quote_review_snapshot',kind:'customer_quote_revision',quoteId:legacy.id,version:legacy.version,action:'旧版合成记录',updatedAt:legacy.updatedAt,updatedBy:legacy.updatedBy,snapshot:structuredClone(legacy)};
 rawInsert(legacySnapshot);
 const legacyPublic=(await ok('customer-quotes',undefined,assigned)).quotes.find(item=>item.id===legacy.id);
 assert.equal(legacyPublic.contactName,'');assert.equal(legacyPublic.internalNotesZh,'');assert.equal(legacyPublic.exchangeRateCnyPerUsd,null);assert.deepEqual(legacyPublic.internalCosts,[]);
 assert.deepEqual(rawRecords().find(item=>item.id===legacy.id),legacy);assert.deepEqual(rawRecords().find(item=>item.id===legacySnapshot.id),legacySnapshot);
 pass('历史报价缺少新增字段时只补响应默认值，不回写旧记录或旧版本');

 const confirmation=quote=>({id:quote.id,version:quote.version,acknowledgeEnglish:true});
 const denyWithoutMutation=async(action,body,status,user)=>{const snapshot=structuredClone(rawRecords());assert.equal((await call(action,body,user)).status,status);assert.deepEqual(rawRecords(),snapshot);};
 assert.equal((await call('customer-quote-completed',undefined,allSales)).status,403);
 await denyWithoutMutation('customer-quote-confirm',confirmation(q),403,assigned);
 await denyWithoutMutation('customer-quote-confirm',confirmation(q),403,other);
 await denyWithoutMutation('customer-quote-confirm',{id:q.id,version:q.version},400);
 await denyWithoutMutation('customer-quote-confirm',{...confirmation(q),acknowledgeEnglish:false},400);
 await denyWithoutMutation('customer-quote-confirm',confirmation(q),400);
 assert(!(await ok('customer-quote-completed')).rows.some(item=>[q.id,unbound.id].includes(item.quoteId)));
 pass('确认须由管理员明确审核英文当前版本；缺确认勾选、缺数量或价格均拒绝且不生成已完成清单');

 const charge={id:'review-charge-a',labelZh:'合成开发费',labelEn:'Synthetic development charge',amount:24,basisZh:'每套一次，非产品单价',basisEn:'Once per set, separately from unit price',conditional:false,needsReview:false};
 const complete={...draft,lines:[{...draft.lines[0],quantity:120,quantityBasisZh:'每色／尺寸',quantityBasisEn:'per colour / size',unitPrice:12,toolingFee:0}],customerCharges:[charge],terms:[{...draft.terms[0],zh:'合成交付条件已核对',en:'Synthetic delivery conditions reviewed',needsReview:false,reviewNote:''}],reviewNotes:[]};
 const additiveFields=['contactName','internalNotesZh','exchangeRateCnyPerUsd','internalCosts','customerCharges'];
 const oldClientPayload=quote=>{const payload=fields(quote);for(const field of additiveFields)delete payload[field];return payload;};
 const oldCreate=oldClientPayload({...complete,quoteNo:'TEST-OLD-CLIENT-CREATE'});
 let oldClient=(await ok('customer-quote-save',oldCreate,assigned)).quote;
 const oldClientOriginal=structuredClone(rawRecords().find(item=>item.id===oldClient.id));
 for(const field of additiveFields)assert.equal(Object.hasOwn(oldClientOriginal,field),false);
 const oldClientSnapshot=structuredClone(rawRecords().find(item=>item.kind==='customer_quote_revision'&&item.quoteId===oldClient.id&&item.version===oldClient.version));
 oldClient=(await ok('customer-quote-save',{...oldClientPayload(oldClient),quoteNo:'TEST-OLD-CLIENT-EDIT'},assigned)).quote;
 const oldClientSaved=rawRecords().find(item=>item.id===oldClient.id);
 assert.equal(oldClientSaved.version,oldClientOriginal.version+1);
 for(const field of additiveFields)assert.equal(Object.hasOwn(oldClientSaved,field),false);
 const oldClientLatestSnapshot=rawRecords().find(item=>item.kind==='customer_quote_revision'&&item.quoteId===oldClient.id&&item.version===oldClient.version);
 for(const field of additiveFields)assert.equal(Object.hasOwn(oldClientLatestSnapshot.snapshot,field),false);
 assert.deepEqual(rawRecords().find(item=>item.id===oldClientSnapshot.id),oldClientSnapshot);
 let modern=(await ok('customer-quote-save',{...complete,quoteNo:'TEST-OMITTED-NEW-FIELDS'},assigned)).quote;
 const modernOriginal=structuredClone(rawRecords().find(item=>item.id===modern.id));
 const modernSnapshot=structuredClone(rawRecords().find(item=>item.kind==='customer_quote_revision'&&item.quoteId===modern.id&&item.version===modern.version));
 modern=(await ok('customer-quote-save',{...oldClientPayload(modern),quoteNo:'TEST-OMITTED-NEW-FIELDS-EDIT'},assigned)).quote;
 const modernSaved=rawRecords().find(item=>item.id===modern.id);
 for(const field of additiveFields)assert.deepEqual(modernSaved[field],modernOriginal[field]);
 assert.deepEqual(rawRecords().find(item=>item.id===modernSnapshot.id),modernSnapshot);
 pass('旧客户端新建及保存不落盘新增默认字段；更新时省略新字段保留已有值和旧版本');
 const invalidDrafts=[
  {lines:[{...complete.lines[0],quantity:null}]},
  {lines:[{...complete.lines[0],unitPrice:null}]},
  {lines:[{...complete.lines[0],descriptionEn:''}]},
  {lines:[{...complete.lines[0],quantityBasisEn:''}]},
  {lines:[{...complete.lines[0],toolingFee:null}],customerCharges:[]},
  {validUntil:''},
  {terms:[]},
  {terms:[{...complete.terms[0],needsReview:true}]},
  {terms:[{...complete.terms[0],en:''}]},
  {terms:[{...complete.terms[0],zh:''}]},
  {reviewNotes:['仍待确认的合成项目']},
  {customerCharges:[{...charge,amount:null}]},
  {customerCharges:[{...charge,needsReview:true}]},
  {customerCharges:[{...charge,basisEn:''}]},
  {customerCharges:[{...charge,basisZh:''}]},
 ];
 for(const [index,patch] of invalidDrafts.entries()){
  const incomplete=(await ok('customer-quote-save',{...complete,...patch,quoteNo:'TEST-INCOMPLETE-'+index},assigned)).quote;
  await denyWithoutMutation('customer-quote-confirm',confirmation(incomplete),400);
 }
 for(const amount of ['',-1])await denyWithoutMutation('customer-quote-save',{...complete,customerCharges:[{...charge,amount}]},400,assigned);
 await denyWithoutMutation('customer-quote-save',{...complete,customerCharges:[charge,charge]},400,assigned);
 for(const exchangeRateCnyPerUsd of [0,-1,''])await denyWithoutMutation('customer-quote-save',{...complete,exchangeRateCnyPerUsd},400,assigned);
 pass('确认逐项核验英文、数量基准、有效期、条款和附加费；待审核和未填值不生成正式记录');

 q=(await ok('customer-quote-save',{...fields(q),...complete,id:q.id,version:q.version,lines:[{...complete.lines[0],toolingFee:null},{...complete.lines[0],id:'review-line-b',model:'TEST-REVIEW-MODEL-B',quantity:60,unitPrice:0,toolingFee:0}],customerCharges:[charge,{...charge,id:'review-charge-conditional',labelZh:'合成条件费',labelEn:'Synthetic conditional charge',amount:3,conditional:true,basisZh:'仅低于合成条件时每色收取',basisEn:'Per colour only below the synthetic threshold'}]},assigned)).quote;
 const draftVersion=q.version,priorSnapshots=rawRecords().filter(item=>item.kind==='customer_quote_revision'&&item.quoteId===q.id).map(item=>structuredClone(item));
 await denyWithoutMutation('customer-quote-confirm',{...confirmation(q),version:q.version-1},409);
 const concurrent=await Promise.all([call('customer-quote-confirm',confirmation(q)),call('customer-quote-confirm',confirmation(q))]);
 assert.deepEqual(concurrent.map(result=>result.status).sort(),[200,409]);
 q=(await ok('customer-quotes')).quotes.find(item=>item.id===q.id);
 assert.equal(q.version,draftVersion+1);assert.equal(q.status,'confirmed');assert.equal(q.canEdit,false);assert.equal(q.canConfirm,false);assert.equal(q.canRevise,true);
 const completed=(await ok('customer-quote-completed',undefined,assigned)).rows.filter(item=>item.quoteId===q.id);
 assert.equal(completed.length,2);assert(completed.every(item=>item.quoteVersion===q.version&&item.quotedCustomer===''&&item.currency==='USD'&&item.customerCode===''));
 const rowA=completed.find(item=>item.lineId==='review-line-a'),rowB=completed.find(item=>item.lineId==='review-line-b');
 assert.equal(rowA.unitPriceUsd,12);assert.equal(rowA.quantity,120);assert.equal(rowA.toolingFeeUsd,null);assert.equal(rowA.quantityBasisEn,'per colour / size');
 assert.equal(rowB.unitPriceUsd,0);assert.equal(rowB.toolingFeeUsd,0);assert.deepEqual(rowA.customerCharges,q.customerCharges);
 assert.equal(rowA.customerCharges[1].conditional,true);
 for(const forbidden of ['internalNotesZh','internalCosts','exchangeRateCnyPerUsd','sourceFileKey'])assert(!JSON.stringify(completed).includes(forbidden));
 assert(!JSON.stringify(completed).includes(draft.internalNotesZh));assert(!JSON.stringify(completed).includes(draft.internalCosts[0].label));
 assert(!(await ok('customer-quote-completed',undefined,other)).rows.some(item=>item.quoteId===q.id));
 for(const snapshot of priorSnapshots)assert.deepEqual(rawRecords().find(item=>item.id===snapshot.id),snapshot);
 const completedRecords=rawRecords().filter(item=>item.kind==='customer_quote_completed'&&item.quoteId===q.id).map(item=>structuredClone(item));
 assert.equal(completedRecords.length,2);assert.equal(new Set(completedRecords.map(item=>item.id)).size,2);
 await denyWithoutMutation('customer-quote-confirm',confirmation(q),409);
 pass('并发确认仅成功一次，原子生成逐款不可变总表；明确零价保留、单列费用不并入单价，确认不会自动标 Y');

 const upload=(quote)=>{const form=new FormData();form.set('quoteId',quote.id);form.set('version',String(quote.version));form.set('file',new File([Buffer.from('%PDF-1.7\nSynthetic immutable quote attachment')],'synthetic-reviewed.pdf'));return form;};
 await denyWithoutMutation('customer-quote-save',fields(q),409);
 await denyWithoutMutation('customer-quote-save',fields(q),409,assigned);
 await denyWithoutMutation('customer-quote-upload',upload(q),409);
 await denyWithoutMutation('customer-quote-upload',upload(q),409,assigned);
 await denyWithoutMutation('customer-quote-revise',{id:q.id,version:q.version},403,other);
 await denyWithoutMutation('customer-quote-revise',{id:q.id,version:q.version-1},409,assigned);
 const confirmedVersion=q.version,confirmedSnapshot=structuredClone(rawRecords().find(item=>item.kind==='customer_quote_revision'&&item.quoteId===q.id&&item.version===q.version));
 q=(await ok('customer-quote-revise',{id:q.id,version:q.version},assigned)).quote;
 assert.equal(q.version,confirmedVersion+1);assert.equal(q.status,'draft');assert.equal(q.canEdit,true);assert.equal(q.canRevise,false);assert.equal(q.confirmedAt,'');
 await denyWithoutMutation('customer-quote-revise',{id:q.id,version:q.version},409,assigned);
 q=(await ok('customer-quote-save',{...fields(q),lines:q.lines.map(line=>line.id==='review-line-a'?{...line,unitPrice:15}:line)},assigned)).quote;
 assert.deepEqual(rawRecords().find(item=>item.id===confirmedSnapshot.id),confirmedSnapshot);
 for(const record of completedRecords)assert.deepEqual(rawRecords().find(item=>item.id===record.id),record);
 assert.equal((await ok('customer-quote-completed',undefined,assigned)).rows.filter(item=>item.quoteId===q.id).length,2);
 q=(await ok('customer-quote-confirm',confirmation(q))).quote;
 const allCompleted=(await ok('customer-quote-completed',undefined,assigned)).rows.filter(item=>item.quoteId===q.id);
 assert.equal(allCompleted.length,4);assert.equal(allCompleted.find(item=>item.lineId==='review-line-a'&&item.quoteVersion===confirmedVersion).unitPriceUsd,12);assert.equal(allCompleted.find(item=>item.lineId==='review-line-a'&&item.quoteVersion===q.version).unitPriceUsd,15);
 for(const record of completedRecords)assert.deepEqual(rawRecords().find(item=>item.id===record.id),record);
 pass('已确认报价禁止保存或换附件；修订另建草稿版本，新确认追加总表，旧报价及旧总表金额保持不变');

 const authorizedSnapshots=rawRecords().filter(item=>['customer_quote_revision','customer_quote_completed'].includes(item.kind)&&item.quoteId===q.id).map(item=>structuredClone(item));
 await ok('customer-save',{...account,salesName:other.displayName});
 assert(!(await ok('customer-quotes',undefined,assigned)).quotes.some(item=>item.id===q.id));
 assert(!(await ok('customer-quote-completed',undefined,assigned)).rows.some(item=>item.quoteId===q.id));
 assert.equal((await ok('customer-quote-completed',undefined,other)).rows.filter(item=>item.quoteId===q.id).length,4);
 const quotedAuditIds=new Set([q.id,...authorizedSnapshots.map(item=>item.id)]);
 assert(!(await ok('data',undefined,assigned)).audits.some(item=>quotedAuditIds.has(item.targetId)));
 for(const record of authorizedSnapshots)assert.deepEqual(rawRecords().find(item=>item.id===record.id),record);
 pass('客户责任转移同时切换报价、已完成总表和审计权限，原制作人失去访问而历史记录不删除');

 q=(await ok('customer-quote-revise',{id:q.id,version:q.version},other)).quote;
 q=(await ok('customer-quote-save',{...fields(q),customerAccountId:accountB.id,customerName:accountB.customer,customerCode:accountB.customerCode})).quote;
 await ok('customer-save',{...account,salesName:assigned.displayName});
 assert((await ok('customer-quotes',undefined,other)).quotes.some(item=>item.id===q.id));
 assert(!(await ok('customer-quote-completed',undefined,other)).rows.some(item=>item.quoteId===q.id));
 assert(!(await ok('customer-quote-completed',undefined,assigned)).rows.some(item=>item.quoteId===q.id));
 assert.equal((await ok('customer-quote-completed')).rows.filter(item=>item.quoteId===q.id).length,4);
 const movedPublic=(await ok('customer-quotes',undefined,other)).quotes.find(item=>item.id===q.id);
 assert(movedPublic.history.every(item=>item.version===q.version));
 for(const user of [assigned,other,allSales])assert(!(await ok('data',undefined,user)).audits.some(item=>authorizedSnapshots.some(snapshot=>snapshot.kind==='customer_quote_completed'&&snapshot.id===item.targetId)));
 for(const record of authorizedSnapshots)assert.deepEqual(rawRecords().find(item=>item.id===record.id),record);
 assert.deepEqual(rawRecords().find(item=>item.id===legacy.id),legacy);assert.deepEqual(rawRecords().find(item=>item.id===legacySnapshot.id),legacySnapshot);
 pass('跨客户改绑时同时核验当前和历史客户，不能通过已完成总表、版本或审计读取原客户报价');
 const byId=new Map(rawRecords().map(record=>[record.id,record]));
 for(const record of before)if(record.id!==account.id)assert.deepEqual(byId.get(record.id),record);
 pass('新增测试询价不改写已有报价、版本、客户责任或生产订单');
}
