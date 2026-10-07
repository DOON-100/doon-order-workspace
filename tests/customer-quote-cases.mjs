import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';

// Synthetic quotation fixtures only. No customer workbook or production prices belong here.
export async function testCustomerQuotes({ok,call,state,admin,clerk,pass,rawRecords}){
 const identity=(id,name)=>({userId:id,email:id+'@test.invalid',displayName:name,fullName:name});
 const assigned=identity('quote_assigned','报价负责测试员'),other=identity('quote_other','报价其他测试员'),allSales=identity('quote_all','报价总表测试员'),finance=identity('quote_finance','报价财务测试员'),pmc=identity('quote_pmc','报价PMC测试员');
 for(const [user,role,customers,orderScope] of [[assigned,'sales',[],'assigned'],[other,'sales',[],'assigned'],[allSales,'sales',[],'all'],[finance,'finance',[],'assigned'],[pmc,'pmc',[],'assigned']]){await ok('member',{name:user.displayName,email:user.email,role,customers,orderScope,active:true});await ok('enroll',{},user);}
 const account=(await ok('customer-save',{customer:'报价合成客户甲',customerCode:'TEST-Q-A',salesName:assigned.displayName,serviceName:'',pmcName:pmc.displayName,active:true})).item;
 const untouched=rawRecords().map(r=>structuredClone(r));
 const draft={companyEn:'Synthetic Eyewear Ltd',companyZh:'合成眼镜测试公司',collectionEn:'Synthetic collection',collectionZh:'合成测试系列',customerCode:account.customerCode,customerName:account.customer,customerAccountId:account.id,quoteNo:'TEST-QUOTE-A',quoteDate:'2026-10-01',validUntil:'2026-11-01',currency:'USD',lines:[{id:'line-a',model:'TEST-MODEL-A',descriptionZh:'合成测试材质',descriptionEn:'Synthetic test material',quantity:8,unitPrice:12.5,toolingFee:0,sourceFormula:'=10-10'}],terms:[{id:'term-a',labelZh:'条款',labelEn:'Terms',zh:'待测试确认',en:'Pending test confirmation',needsReview:true,reviewNote:'测试待确认'}],reviewNotes:['合成测试，非客户正式报价']};
 const fields=q=>Object.fromEntries([...Object.keys(draft),'id','version'].filter(k=>q[k]!==undefined).map(k=>[k,q[k]]));
 let q=(await ok('customer-quote-save',draft)).quote;
 assert.equal(q.status,'draft');assert.equal(q.version,1);assert.equal(q.history.length,1);assert.equal(q.lines[0].toolingFee,0);assert.equal(q.hasSource,false);
 assert.equal((await ok('customer-quotes',undefined,assigned)).quotes.find(v=>v.id===q.id).canEdit,true);
 assert.equal((await ok('customer-quotes',undefined,other)).quotes.some(v=>v.id===q.id),false);
 assert.equal((await ok('customer-quotes',undefined,allSales)).quotes.find(v=>v.id===q.id).canEdit,false);
 assert.equal((await ok('customer-quotes',undefined,finance)).canCreate,false);
 assert.equal((await ok('customer-quotes',undefined,pmc)).quotes.find(v=>v.id===q.id).canEdit,true);
 assert.equal((await call('customer-quotes',undefined,clerk)).status,403);
 assert.equal((await call('customer-quote-save',fields(q),allSales)).status,403);
 assert.equal((await call('customer-quote-save',draft,finance)).status,403);
 assert.equal((await call('customer-quote-save',{...fields(q),customerCode:'TEST-FOREIGN',customerName:'不负责的合成客户',customerAccountId:null},assigned)).status,403);
 assert.equal((await call('customer-quote-save',{...draft,customerName:'不匹配的客户'},assigned)).status,400);
 pass('客户报价按责任人与角色鉴权；全订单可见只扩展读取，不授予编辑或跨客户变更');

 const member=(await state()).members.find(v=>v.email===other.email);
 // Assigned customer codes work without a confirmed customer-account link.
 await ok('member',{...member,customers:['TEST-Q-B']});
 const own=(await ok('customer-quote-save',{...draft,customerAccountId:null,customerCode:'TEST-Q-OWN',customerName:'报价创建人合成客户',quoteNo:'TEST-QUOTE-OWN'},other)).quote;
 assert.equal(own.canEdit,true);
 const codeQuote=(await ok('customer-quote-save',{...draft,customerAccountId:null,customerCode:'TEST-Q-B',customerName:'报价编码合成客户',quoteNo:'TEST-QUOTE-B'})).quote;
 assert.equal((await ok('customer-quotes',undefined,other)).quotes.find(v=>v.id===codeQuote.id).canEdit,true);
 assert.equal((await call('customer-quote-save',{...fields(own),customerName:account.customer,customerCode:account.customerCode,customerAccountId:account.id},other)).status,403);
 pass('客户编码授权与创建人草稿可维护，不能凭创建人身份把报价转给未授权客户');

 const oldVersion=q.version,originalRevision=structuredClone(rawRecords().find(v=>v.kind==='customer_quote_revision'&&v.quoteId===q.id));
 q=(await ok('customer-quote-save',{...fields(q),lines:[{...q.lines[0],unitPrice:14,descriptionZh:'改后的合成材质'}]},assigned)).quote;
 assert.equal(q.version,oldVersion+1);assert.equal(q.history.length,2);
 assert.deepEqual(rawRecords().find(v=>v.id===originalRevision.id),originalRevision);
 const conflict=await call('customer-quote-save',{...fields(q),version:oldVersion},assigned);assert.equal(conflict.status,409);
 const race=await Promise.all([call('customer-quote-save',{...fields(q),reviewNotes:['并发测试甲']},assigned),call('customer-quote-save',{...fields(q),reviewNotes:['并发测试乙']},assigned)]);
 assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
 q=(await ok('customer-quotes')).quotes.find(v=>v.id===q.id);
 assert.equal(q.version,3);assert.equal(rawRecords().filter(v=>v.kind==='customer_quote_revision'&&v.quoteId===q.id).length,3);
 pass('客户报价保留不可变版本快照，旧版本和并发提交返回409，不覆盖他人保存');

 for(const bad of [{...fields(q),quoteDate:'2026-02-30'},{...fields(q),validUntil:'2026-09-01'},{...fields(q),status:'approved'},{...fields(q),lines:[{...q.lines[0],quantity:1.5}]},{...fields(q),lines:[{...q.lines[0],quantity:0}]},{...fields(q),lines:[{...q.lines[0],unitPrice:''}]},{...fields(q),lines:[{...q.lines[0],unitPrice:null}]},{...fields(q),lines:[{...q.lines[0],toolingFee:-1}]},{...fields(q),lines:[q.lines[0],q.lines[0]]}])assert.equal((await call('customer-quote-save',bad)).status,400);
 assert.equal((await ok('customer-quotes')).quotes.find(v=>v.id===q.id).version,q.version);
 pass('客户报价数量、金额、有效日期和重复行严格校验，空价格不变成零且不能伪造发布状态');

 const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Synthetic quotation'],['TEST',8,14,0]]),'Quotation');const bytes=XLSX.write(book,{type:'buffer',bookType:'xlsx'});
 const upload=(quote=q,data=bytes,name='synthetic-quotation.xlsx')=>{const f=new FormData();f.set('quoteId',quote.id);f.set('version',String(quote.version));f.set('file',new File([data],name));return f;};
 assert.equal((await call('customer-quote-upload',upload(),other)).status,403);
 assert.equal((await call('customer-quote-upload',upload(q,new Uint8Array([1,2,3]),'fake.xlsx'))).status,400);
 const beforeUpload=q.version;q=(await ok('customer-quote-upload',upload(),assigned)).quote;
 assert.equal(q.version,beforeUpload+1);assert.equal(q.hasSource,true);assert.equal(q.sourceHash.length,64);assert.equal(q.sourceFilename,'synthetic-quotation.xlsx');assert(!JSON.stringify(q).includes('sourceFileKey'));
 const res=await call('customer-quote-file?id='+q.id,undefined,assigned);assert.equal(res.status,200);assert.deepEqual(Buffer.from(await res.arrayBuffer()),bytes);
 assert.equal((await call('customer-quote-file?id='+q.id,undefined,other)).status,403);
 assert.equal((await call('customer-quote-file?id='+q.id,undefined,finance)).status,200);
 assert.equal((await call('customer-quote-file?id='+q.id,undefined,clerk)).status,403);
 assert.equal((await call('customer-quote-upload',upload({...q,version:beforeUpload}))).status,409);
 const firstSourceRevision=structuredClone(rawRecords().find(v=>v.kind==='customer_quote_revision'&&v.quoteId===q.id&&v.version===q.version));
 const pdf=Buffer.from('%PDF-1.7\nSynthetic second attachment');q=(await ok('customer-quote-upload',upload(q,pdf,'synthetic-second.pdf'))).quote;
 assert.deepEqual(rawRecords().find(v=>v.id===firstSourceRevision.id),firstSourceRevision);assert.notEqual(rawRecords().find(v=>v.id===q.id).sourceFileKey,firstSourceRevision.snapshot.sourceFileKey);
 assert.equal(q.history.length,q.version);assert(!JSON.stringify((await state()).audits.filter(a=>a.targetId===q.id)).includes('sourceFileKey'));
 pass('原报价附件逐次鉴权下载，上传递增版本保留历史附件，不向页面或审计响应泄漏存储键');

 // No existing order, customer or other business record may change as a side effect.
 // Exclude the intentional synthetic member-assignment change above.
 const records=rawRecords(),byId=new Map(records.map(v=>[v.id,v]));
 for(const before of untouched)if(before.id!==member.id)assert.deepEqual(byId.get(before.id),before);
 const oldIds=new Set(untouched.map(v=>v.id));assert(records.filter(v=>!oldIds.has(v.id)).every(v=>['customer_quote','customer_quote_revision','audit'].includes(v.kind)));
 const quoteAudits=records.filter(v=>v.kind==='audit'&&v.targetId===q.id),versions=records.filter(v=>v.kind==='customer_quote_revision'&&v.quoteId===q.id);
 assert.equal(quoteAudits.length,q.version);assert.equal(versions.length,q.version);assert.equal(new Set(versions.map(v=>v.id)).size,versions.length);
 pass('报价操作只写报价、全量历史快照与审计，不改任何既有客户、订单或其他业务数据');
}
