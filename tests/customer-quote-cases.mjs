import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {build} from 'esbuild';

// Synthetic fixtures only. No real identities, customer workbooks or production prices.
export async function testCustomerQuotes({ok,call,state,clerk,pass,rawRecords,rawInsert}){
 const identity=(id,name)=>({userId:id,email:id+'@test.invalid',displayName:name,fullName:name});
 const assigned=identity('quote_assigned','报价负责测试员'),other=identity('quote_other','报价另组测试员'),service=identity('quote_service','报价客服测试员'),empty=identity('quote_empty','报价待分配测试员');
 const allSales=identity('quote_all','报价全订单测试员'),finance=identity('quote_finance','报价财务测试员'),pmc=identity('quote_pmc','报价非名单PMC测试员');
 for(const [user,role,customers,orderScope] of [[assigned,'pmc',['TEST-Q-B'],'all'],[other,'pmc',[],'all'],[service,'sales',[],'all'],[empty,'sales',['TEST-Q-A'],'all'],[allSales,'sales',['TEST-Q-A'],'all'],[finance,'finance',[],'all'],[pmc,'pmc',[],'all']]){
  await ok('member',{name:user.displayName,email:user.email,role,customers,orderScope,active:true});await ok('enroll',{},user);
 }
 const members=(await state()).members,memberFor=user=>members.find(v=>v.email===user.email);
 const account=(await ok('customer-save',{customer:'报价合成客户甲',customerCode:'TEST-Q-A',salesName:assigned.displayName,serviceName:'TEST-SERVICE-ALIAS',pmcName:pmc.displayName,active:true})).item;
 const accountB=(await ok('customer-save',{customer:'报价合成客户乙',customerCode:'TEST-Q-B',salesName:other.displayName,serviceName:'',pmcName:assigned.displayName,active:true})).item;
 const pmcOnly=(await ok('customer-save',{customer:'报价仅PMC客户',customerCode:'TEST-Q-P',salesName:'无关合成人员',serviceName:'',pmcName:assigned.displayName,active:true})).item;
 let inactive=(await ok('customer-save',{customer:'报价停用合成客户',customerCode:'TEST-Q-I',salesName:assigned.displayName,active:true})).item;
 const draft={companyEn:'Synthetic Eyewear Ltd',companyZh:'合成眼镜测试公司',collectionEn:'Synthetic collection',collectionZh:'合成测试系列',customerCode:account.customerCode,customerName:account.customer,customerAccountId:account.id,quoteNo:'TEST-QUOTE-A',quoteDate:'2026-10-01',validUntil:'2026-11-01',currency:'USD',lines:[{id:'line-a',model:'TEST-MODEL-A',descriptionZh:'合成测试材质',descriptionEn:'Synthetic test material',quantity:8,unitPrice:12.5,toolingFee:0,sourceFormula:'=10-10'}],terms:[{id:'term-a',labelZh:'条款',labelEn:'Terms',zh:'待测试确认',en:'Pending test confirmation',needsReview:true,reviewNote:'测试待确认'}],reviewNotes:['合成测试，非客户正式报价']};
 const fields=q=>Object.fromEntries([...Object.keys(draft),'id','version'].filter(k=>q[k]!==undefined).map(k=>[k,q[k]]));
 const forAccount=(a,quoteNo)=>({...draft,customerAccountId:a.id,customerCode:a.customerCode,customerName:a.customer,quoteNo});
 assert.equal((await call('customer-quotes',undefined,assigned)).status,403);
 assert.equal((await call('customer-quote-save',draft,assigned)).status,403);
 const policy={id:'synthetic_customer_quote_access',kind:'customer_quote_access',internalMemberIds:[memberFor(assigned).id,memberFor(other).id],memberIds:[assigned,other,service,empty].map(user=>memberFor(user).id),aliasesByMember:{[memberFor(service).id]:['TEST-SERVICE-ALIAS']}};
 rawInsert(policy);
 for(const user of [allSales,finance,pmc,clerk]){
  assert.equal((await call('customer-quotes',undefined,user)).status,403);assert.equal((await call('customer-quote-save',draft,user)).status,403);
 }
 const noAssigned=await ok('customer-quotes',undefined,empty);assert.equal(noAssigned.canUse,true);assert.equal(noAssigned.canCreate,false);assert.deepEqual(noAssigned.quotes,[]);assert.deepEqual(noAssigned.customers,[]);
 assert.equal((await call('customer-quote-save',draft,empty)).status,403);
 assert.equal((await call('customer-quote-access',undefined,assigned)).status,403);
 pass('报价名单缺失时默认拒绝；全订单、财务、非名单PMC和旧客户编码授权不能绕过专属名单');

 // Isolated domain checks exercise bad configurations without mutating the API fixture policy.
 const policyModule=await build({entryPoints:['lib/customer-quote-access.ts'],bundle:true,platform:'node',format:'esm',write:false});
 const access=await import('data:text/javascript;base64,'+Buffer.from(policyModule.outputFiles[0].text).toString('base64'));
 const accessState={revision:1,records:rawRecords()},listed=memberFor(service),administrator=members.find(v=>v.role==='admin');
 for(const variants of [[],[{...policy,memberIds:'invalid'}],[policy,{...policy,id:'duplicate_policy'}],[{...policy,memberIds:[listed.id,listed.id]}]]){
  const invalid={...accessState,records:[...accessState.records.filter(v=>v.kind!=='customer_quote_access'),...variants]};
  assert.equal(access.canUseCustomerQuotes(invalid,listed),false);assert.equal(access.canUseCustomerQuotes(invalid,administrator),true);
 }
 assert.equal(access.canUseCustomerQuotes(accessState,{...listed,active:false}),false);
 assert.equal(access.assignedCustomerQuoteAccount(accessState,listed,{...account,serviceName:' test-service-alias '}),true);
 assert.equal(access.assignedCustomerQuoteAccount(accessState,listed,{...account,salesName:'TEST-SERVICE-ALIAS EXTRA',serviceName:''}),false);
 assert.equal(access.assignedCustomerQuoteAccount(accessState,listed,{...account,salesName:'',serviceName:'',pmcName:'TEST-SERVICE-ALIAS'}),false);
 pass('报价配置缺失、重复或格式损坏均封闭；别名只完整匹配，停用成员与仅PMC字段不授予客户报价权');

 // Only administrators can confirm responsibility changes; normal descriptive edits remain available.
 const allowedCustomerEdit=(await ok('customer-save',{...account,notes:'非责任资料的合成测试更新'},assigned)).item;
 assert.equal(allowedCustomerEdit.notes,'非责任资料的合成测试更新');
 for(const field of ['salesName','serviceName','pmcName'])assert.equal((await call('customer-save',{...allowedCustomerEdit,[field]:'未经管理员确认的责任人'},assigned)).status,403);
 assert.equal((await call('customer-save',{customer:'新建责任绕过测试',customerCode:'TEST-RESP-ESCAPE',salesName:assigned.displayName,active:true},assigned)).status,403);
 const customerImport=XLSX.utils.book_new();XLSX.utils.book_append_sheet(customerImport,XLSX.utils.aoa_to_sheet([
  ['客户','客户编码','业务员','客服','PMC','备注'],
  [account.customer,account.customerCode,account.salesName,account.serviceName,account.pmcName,'混合导入正常部分'],
  [accountB.customer,accountB.customerCode,assigned.displayName,accountB.serviceName,accountB.pmcName,'混合导入越权部分'],
 ]),'客户责任清单');
 const responsibilityForm=new FormData();responsibilityForm.set('file',new File([XLSX.write(customerImport,{type:'buffer',bookType:'xlsx'})],'synthetic-customers.xlsx'));
 const beforeDeniedImport=structuredClone(rawRecords());assert.equal((await call('customer-import',responsibilityForm,assigned)).status,403);assert.deepEqual(rawRecords(),beforeDeniedImport);
 pass('客户责任变更和新建责任仅管理员确认，非责任备注可编辑，混合导入越权时整批拒绝且不部分覆盖');

 const inactiveQuote=(await ok('customer-quote-save',forAccount(inactive,'TEST-QUOTE-INACTIVE'))).quote;
 inactive=(await ok('customer-save',{...inactive,active:false})).item;
 const unbound=(await ok('customer-quote-save',{...draft,customerAccountId:null,quoteNo:'TEST-QUOTE-UNBOUND'})).quote;
 const pmcOnlyQuote=(await ok('customer-quote-save',forAccount(pmcOnly,'TEST-QUOTE-PMC-ONLY'))).quote;
 const untouched=rawRecords().map(r=>structuredClone(r));
 let q=(await ok('customer-quote-save',draft,assigned)).quote;
 const qB=(await ok('customer-quote-save',forAccount(accountB,'TEST-QUOTE-B'),other)).quote;
 assert.equal(q.status,'draft');assert.equal(q.version,1);assert.equal(q.history.length,1);assert.equal(q.lines[0].toolingFee,0);assert.equal(q.hasSource,false);
 for(const user of [assigned,service]){
  const list=await ok('customer-quotes',undefined,user);assert.equal(list.quotes.find(v=>v.id===q.id).canEdit,true);
  assert.equal(list.quotes.some(v=>[qB.id,unbound.id,inactiveQuote.id,pmcOnlyQuote.id].includes(v.id)),false);assert.deepEqual(list.customers.map(v=>v.id),[account.id]);
 }
 const otherList=await ok('customer-quotes',undefined,other);assert.deepEqual(otherList.quotes.map(v=>v.id),[qB.id]);assert.deepEqual(otherList.customers.map(v=>v.id),[accountB.id]);
 assert.equal((await call('customer-quote-save',fields(q),other)).status,403);
 assert.equal((await call('customer-quote-save',forAccount(accountB,'TEST-CROSS-CREATE'),assigned)).status,403);
 assert.equal((await call('customer-quote-save',{...fields(q),customerCode:accountB.customerCode,customerName:accountB.customer,customerAccountId:accountB.id},assigned)).status,403);
 assert.equal((await call('customer-quote-save',{...draft,customerAccountId:null},assigned)).status,403);
 assert.equal((await call('customer-quote-save',{...draft,customerName:'不匹配的客户'},assigned)).status,400);
 assert.equal((await call('customer-quote-save',{...draft,customerCode:'MISMATCHED-CODE'},assigned)).status,400);
 for(const denied of [unbound,inactiveQuote,pmcOnlyQuote])assert.equal((await call('customer-quote-save',fields(denied),assigned)).status,403);
 for(const user of [assigned,other,service,empty,allSales,finance,pmc]){
  const audits=(await ok('data',undefined,user)).audits;assert(!audits.some(a=>[unbound.id,inactiveQuote.id,pmcOnlyQuote.id].includes(a.targetId)),user.userId+' must not see unbound/inactive/PMC-only quote audits');
  if(user!==assigned&&user!==service)assert(!audits.some(a=>a.targetId===q.id));if(user!==other)assert(!audits.some(a=>a.targetId===qB.id));
 }
 pass('指定成员只读写已绑定且启用的业务/客服责任客户，PMC角色和请求字段不能越权，通用审计同步隔离');

 const oldVersion=q.version,originalRevision=structuredClone(rawRecords().find(v=>v.kind==='customer_quote_revision'&&v.quoteId===q.id));
 q=(await ok('customer-quote-save',{...fields(q),lines:[{...q.lines[0],unitPrice:14,descriptionZh:'改后的合成材质'}]},service)).quote;
 assert.equal(q.version,oldVersion+1);assert.equal(q.history.length,2);assert.deepEqual(rawRecords().find(v=>v.id===originalRevision.id),originalRevision);
 assert.equal((await call('customer-quote-save',{...fields(q),version:oldVersion},assigned)).status,409);
 const race=await Promise.all([call('customer-quote-save',{...fields(q),reviewNotes:['并发测试甲']},assigned),call('customer-quote-save',{...fields(q),reviewNotes:['并发测试乙']},assigned)]);
 assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);q=(await ok('customer-quotes')).quotes.find(v=>v.id===q.id);
 assert.equal(q.version,3);assert.equal(rawRecords().filter(v=>v.kind==='customer_quote_revision'&&v.quoteId===q.id).length,3);
 pass('同客户业务与客服可协作，历史版本不可变，旧版本和并发提交返回409，不覆盖他人保存');

 for(const bad of [{...fields(q),quoteDate:'2026-02-30'},{...fields(q),validUntil:'2026-09-01'},{...fields(q),status:'approved'},{...fields(q),lines:[{...q.lines[0],quantity:1.5}]},{...fields(q),lines:[{...q.lines[0],quantity:0}]},{...fields(q),lines:[{...q.lines[0],unitPrice:''}]},{...fields(q),lines:[{...q.lines[0],quantity:''}]},{...fields(q),lines:[{...q.lines[0],toolingFee:''}]},{...fields(q),lines:[{...q.lines[0],toolingFee:-1}]},{...fields(q),lines:[q.lines[0],q.lines[0]]}])assert.equal((await call('customer-quote-save',bad)).status,400);
 assert.equal((await ok('customer-quotes')).quotes.find(v=>v.id===q.id).version,q.version);
 pass('数量、金额、有效日期和重复行严格校验，空字符串不变成零且不能伪造发布状态');

 const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Synthetic quotation'],['TEST',8,14,0]]),'Quotation');const bytes=XLSX.write(book,{type:'buffer',bookType:'xlsx'});
 const upload=(quote=q,data=bytes,name='synthetic-quotation.xlsx')=>{const f=new FormData();f.set('quoteId',quote.id);f.set('version',String(quote.version));f.set('file',new File([data],name));return f;};
 assert.equal((await call('customer-quote-upload',upload(),other)).status,403);assert.equal((await call('customer-quote-upload',upload(q,new Uint8Array([1,2,3]),'fake.xlsx'))).status,400);
 const beforeUpload=q.version;q=(await ok('customer-quote-upload',upload(),assigned)).quote;
 assert.equal(q.version,beforeUpload+1);assert.equal(q.hasSource,false);assert.equal(q.sourceHash.length,64);assert.equal(q.sourceFilename,'synthetic-quotation.xlsx');assert(!JSON.stringify(q).includes('sourceFileKey'));
 const res=await call('customer-quote-file?id='+q.id,undefined,assigned);assert.equal(res.status,403);const adminSource=await call('customer-quote-file?id='+q.id);assert.equal(adminSource.status,200);assert.deepEqual(Buffer.from(await adminSource.arrayBuffer()),bytes);
 for(const user of [other,empty,allSales,finance,pmc,clerk])assert.equal((await call('customer-quote-file?id='+q.id,undefined,user)).status,403);
 assert.equal((await call('customer-quote-upload',upload({...q,version:beforeUpload}))).status,409);
 const firstSourceRevision=structuredClone(rawRecords().find(v=>v.kind==='customer_quote_revision'&&v.quoteId===q.id&&v.version===q.version));
 const pdf=Buffer.from('%PDF-1.7\nSynthetic second attachment');q=(await ok('customer-quote-upload',upload(q,pdf,'synthetic-second.pdf'))).quote;
 assert.deepEqual(rawRecords().find(v=>v.id===firstSourceRevision.id),firstSourceRevision);assert.notEqual(rawRecords().find(v=>v.id===q.id).sourceFileKey,firstSourceRevision.snapshot.sourceFileKey);
 assert.equal(q.history.length,q.version);assert(!JSON.stringify((await state()).audits.filter(a=>a.targetId===q.id)).includes('sourceFileKey'));
 pass('原附件每次读取和上传都核验当前客户责任，上传递增版本保留旧附件且不泄漏存储键');

 // Transfer responsibility, not quotation data. The old creator must lose access immediately.
 const revisionsBeforeTransfer=rawRecords().filter(v=>v.kind==='customer_quote_revision'&&v.quoteId===q.id).map(v=>structuredClone(v));
 await ok('customer-save',{...account,salesName:other.displayName,serviceName:''});
 for(const user of [assigned,service]){
  assert.equal((await ok('customer-quotes',undefined,user)).quotes.some(v=>v.id===q.id),false);
  assert.equal((await call('customer-quote-save',fields(q),user)).status,403);assert.equal((await call('customer-quote-file?id='+q.id,undefined,user)).status,403);
  assert.equal((await call('customer-quote-upload',upload(),user)).status,403);assert.equal((await ok('data',undefined,user)).audits.some(a=>a.targetId===q.id),false);
 }
 const reassigned=(await ok('customer-quotes',undefined,other)).quotes.find(v=>v.id===q.id);assert.equal(reassigned.canEdit,true);assert.equal(reassigned.history.length,q.version);
 assert.equal((await call('customer-quote-file?id='+q.id,undefined,other)).status,403);assert.deepEqual(rawRecords().filter(v=>v.kind==='customer_quote_revision'&&v.quoteId===q.id),revisionsBeforeTransfer);
 pass('责任转移立即撤销原创建人及旧客服的报价、附件、历史和审计访问，不删除任何版本');

 assert.equal((await call('customer-quote-save',{...fields(q),customerCode:accountB.customerCode,customerName:accountB.customer,customerAccountId:accountB.id},other)).status,403);
 let moved=(await ok('customer-quote-save',{...draft,quoteNo:'TEST-QUOTE-REBIND'})).quote;
 moved=(await ok('customer-quote-upload',upload(moved,bytes,'old-account-only.xlsx'))).quote;
 const movedOld=structuredClone(rawRecords().find(v=>v.kind==='customer_quote_revision'&&v.quoteId===moved.id&&v.version===moved.version));
 moved=(await ok('customer-quote-save',{...fields(moved),customerCode:accountB.customerCode,customerName:accountB.customer,customerAccountId:accountB.id})).quote;
 assert.equal(moved.hasSource,false);assert.equal((await call('customer-quote-file?id='+moved.id,undefined,other)).status,403);assert.deepEqual(rawRecords().find(v=>v.id===movedOld.id),movedOld);assert.equal(moved.history.length,3);
 // Removing responsibility for A must also hide its old revisions and audit snapshots on a quote now at B.
 await ok('customer-save',{...account,salesName:'无关合成人员',serviceName:''});
 const movedPublic=(await ok('customer-quotes',undefined,other)).quotes.find(v=>v.id===moved.id);
 assert.deepEqual(movedPublic.history.map(v=>v.version),[3]);assert(!JSON.stringify(movedPublic).includes('old-account-only.xlsx'));
 assert(!(await ok('data',undefined,other)).audits.filter(v=>v.targetId===moved.id).some(v=>JSON.stringify(v).includes('old-account-only.xlsx')));
 pass('非管理员不能换客户；管理员更正绑定保留历史，不向新客户负责人暴露原客户附件、版本和审计');

 // A first, confirmed binding of an unbound draft keeps its original source, never overwrites it.
 let first=(await ok('customer-quote-save',{...draft,customerAccountId:null,quoteNo:'TEST-FIRST-BIND'})).quote;
 first=(await ok('customer-quote-upload',upload(first,bytes,'first-confirmed-source.xlsx'))).quote;
 const firstHash=first.sourceHash,firstRevision=structuredClone(rawRecords().find(v=>v.kind==='customer_quote_revision'&&v.quoteId===first.id&&v.version===first.version));
 first=(await ok('customer-quote-save',{...fields(first),customerAccountId:accountB.id,customerCode:accountB.customerCode,customerName:accountB.customer})).quote;
 assert.equal(first.hasSource,true);assert.equal(first.sourceHash,firstHash);assert.deepEqual(rawRecords().find(v=>v.id===firstRevision.id),firstRevision);
 assert.equal((await call('customer-quote-file?id='+first.id,undefined,other)).status,403);
 assert.deepEqual((await ok('customer-quotes',undefined,other)).quotes.find(v=>v.id===first.id).history.map(v=>v.version),[3]);
 pass('未绑定草稿由管理员首次确认归属后保留原附件，旧未绑定版本仅管理员可见');

 // Only the explicitly requested synthetic responsibility transfer changes an existing customer.
 const records=rawRecords(),byId=new Map(records.map(v=>[v.id,v]));for(const before of untouched)if(before.id!==account.id)assert.deepEqual(byId.get(before.id),before);
 const oldIds=new Set(untouched.map(v=>v.id));assert(records.filter(v=>!oldIds.has(v.id)).every(v=>['customer_quote','customer_quote_revision','audit'].includes(v.kind)));
 const quoteAudits=records.filter(v=>v.kind==='audit'&&v.targetId===q.id),versions=records.filter(v=>v.kind==='customer_quote_revision'&&v.quoteId===q.id);
 assert.equal(quoteAudits.length,q.version);assert.equal(versions.length,q.version);assert.equal(new Set(versions.map(v=>v.id)).size,versions.length);
 pass('报价权限与操作不覆盖既有客户、订单、账户、配置、历史附件或版本快照');
}
