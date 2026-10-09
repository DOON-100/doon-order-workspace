import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

// Synthetic fixtures only. Run through the actual API and in-memory bucket.
export async function testCustomerQuoteArchive({ok,call,state,pass,admin,rawRecords,rawPut}){
 const identity=id=>({userId:id,email:id+'@test.invalid',displayName:id,fullName:id});
 const assigned=identity('sent_archive_sales'),service=identity('sent_archive_service'),other=identity('sent_archive_other');
 for(const user of [assigned,service,other]){
  await ok('member',{name:user.displayName,email:user.email,role:'sales',customers:[],orderScope:'all',active:true});
  await ok('enroll',{},user);
 }
 const members=(await state()).members,member=user=>members.find(value=>value.email===user.email);
 const priorPolicy=structuredClone(rawRecords().find(record=>record.kind==='customer_quote_access'));
 assert(priorPolicy,'The preceding quote fixtures must install their synthetic access policy.');
 let policy={...priorPolicy,memberIds:[...new Set([...priorPolicy.memberIds,...[assigned,service,other].map(user=>member(user).id)])]};
 rawPut(policy);
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=','base64');
 const pdf=Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
 let account=(await ok('customer-save',{customer:'SYNTHETIC SENT ARCHIVE A',customerCode:'SYNTH-SENT-A',salesName:assigned.displayName,serviceName:service.displayName,pmcName:'',salesMemberIds:[member(assigned).id],serviceMemberIds:[member(service).id],quoteMemberIds:[member(assigned).id,member(service).id],active:true})).item;
 const accountB=(await ok('customer-save',{customer:'SYNTHETIC SENT ARCHIVE B',customerCode:'SYNTH-SENT-B',salesName:other.displayName,serviceName:'',quoteMemberIds:[member(other).id],active:true})).item;
 const draft={companyEn:'Synthetic Quotation Company',companyZh:'合成测试报价公司',collectionEn:'Synthetic collection',collectionZh:'合成测试系列',customerAccountId:account.id,customerName:account.customer,customerCode:account.customerCode,contactName:'Synthetic Contact',quoteNo:'SYNTH-ARCHIVE-TEST',quoteDate:'2026-01-01',validUntil:'2026-12-31',currency:'USD',internalNotesZh:'INTERNAL-ARCHIVE-COST-NOT-PUBLIC',exchangeRateCnyPerUsd:7,internalCosts:[{id:'synthetic-cost',label:'SECRET-SYNTHETIC-SUPPLIER',rmb:49,notes:'Internal only'}],lines:[{id:'synthetic-style-a',model:'SYNTH-MODEL-A',descriptionZh:'合成产品说明',descriptionEn:'Synthetic product description',quantity:300,quantityBasisZh:'每色每尺寸',quantityBasisEn:'per colour / size',unitPrice:11.11,toolingFee:0},{id:'synthetic-style-b',model:'SYNTH-MODEL-B',descriptionZh:'第二款合成产品说明',descriptionEn:'Second synthetic product description',quantity:300,unitPrice:22.22,toolingFee:0}],terms:[{id:'synthetic-term',labelZh:'测试条款',labelEn:'Synthetic terms',zh:'合成条款已核对',en:'Synthetic conditions reviewed',needsReview:false}],reviewNotes:[]};
 const fields=q=>Object.fromEntries([...Object.keys(draft),'customerCharges','id','version'].filter(key=>q[key]!==undefined).map(key=>[key,q[key]]));
 const version=(q,v=q.version,user=assigned)=>ok(`customer-quote-version?quoteId=${q.id}&quoteVersion=${v}`,undefined,user);
 const upload=(q,{quoteVersion=q.version,lineId=q.lines[0].id,category='image',bytes=png,filename='synthetic-style.png',title='',drawingNo=''}={})=>{
  const form=new FormData();form.set('quoteId',q.id);form.set('quoteVersion',String(quoteVersion));
  if(lineId!==undefined&&lineId!==null)form.set('lineId',lineId);
  form.set('category',category);form.set('title',title);form.set('drawingNo',drawingNo);form.set('file',new File([bytes],filename));return form;
 };
 const send=(q,patch={})=>({quoteId:q.id,quoteVersion:q.version,sentDate:new Date().toISOString().slice(0,10),recipient:'recipient@test.invalid',channel:'email',mediaIds:[],idempotencyKey:randomUUID(),...patch});
 const deny=async(action,payload,status,user=assigned)=>{
  const snapshot=structuredClone(rawRecords()),response=await call(action,payload,user);
  assert.equal(response.status,status,`${action}: ${await response.text()}`);assert.deepEqual(rawRecords(),snapshot,'Rejected requests must not mutate stored business records.');
 };
 const assertNoSecrets=value=>{
  const text=JSON.stringify(value);for(const needle of ['sourceFileKey','fileKey','INTERNAL-ARCHIVE-COST-NOT-PUBLIC','SECRET-SYNTHETIC-SUPPLIER','INTERNAL SOURCE BODY'])assert(!text.includes(needle),`Public response leaked ${needle}`);
 };
 try{
  let q=(await ok('customer-quote-save',draft)).quote;
  await deny('customer-quote-record-sent',send(q),409);
  await deny('customer-quote-media-upload',upload(q,{category:'sent_quote',lineId:null,bytes:pdf,filename:'draft-must-not-be-sent.pdf'}),409);
  await deny('customer-quote-media-upload',upload(q,{lineId:'not-a-style'}),400);
  await deny('customer-quote-media-upload',upload(q),403,other);
  pass('报价发送登记只接受已确认版本；草稿不能冒充已发报价，图片必须关联该版款式且执行客户权限');

  const privateSource=new FormData();privateSource.set('quoteId',q.id);privateSource.set('version',String(q.version));privateSource.set('file',new File([Buffer.from('%PDF-1.4\nINTERNAL SOURCE BODY')],'synthetic-internal-cost.pdf'));
  q=(await ok('customer-quote-upload',privateSource)).quote;
  const sourceVersion=q.version;
  assert.deepEqual((await version(q)).media,[],'Internal source must not become a customer-facing style attachment.');
  assert.equal((await call('customer-quote-file?id='+q.id,undefined,assigned)).status,403);
  const publicQuote=(await version(q)).quote;assertNoSecrets(publicQuote);
  pass('新增款式附件与原始内部成本附件分离，普通业务用户不能从版本接口或原附件下载接口取得内部核价');

  for(const bad of [
   {bytes:Buffer.from('<script>alert(1)</script>'),filename:'fake.png'},
   {bytes:png,filename:'style.svg'},
   {bytes:pdf,filename:'pdf-disguised.png'},
   {bytes:png,filename:'image-disguised.pdf',category:'drawing'},
   {bytes:pdf,filename:'image.pdf',category:'image'},
   {bytes:Buffer.alloc(0),filename:'empty.png'},
   {bytes:Buffer.alloc(10*1024*1024+1,0),filename:'oversized.png'},
  ])await deny('customer-quote-media-upload',upload(q,bad),400);
  q=(await ok('customer-quote-media-upload',upload(q,{filename:'first-style.png'}),assigned)).quote;
  const firstMediaVersion=q.version,firstView=await version(q),first=firstView.media.find(item=>item.filename==='first-style.png');
  assert(first);assert.equal(q.version,sourceVersion+1);assert.equal(first.category,'image');assert.equal(first.lineId,q.lines[0].id);assertNoSecrets(firstView);
  const firstSnapshot=structuredClone(rawRecords().find(item=>item.kind==='customer_quote_revision'&&item.quoteId===q.id&&item.version===q.version));
  const beforeDuplicateUpload=structuredClone(rawRecords()),duplicateUpload=await ok('customer-quote-media-upload',upload(q,{filename:'first-style.png'}),assigned);
  assert.equal(duplicateUpload.alreadyPresent,true);assert.equal(duplicateUpload.quote.version,q.version);assert.deepEqual(rawRecords(),beforeDuplicateUpload);
  q=(await ok('customer-quote-save',{...fields(q),quoteNo:'SYNTH-ARCHIVE-TEST-EDIT'},assigned)).quote;
  assert((await version(q)).media.some(item=>item.id===first.id),'Ordinary draft save must preserve attached style media.');
  q=(await ok('customer-quote-media-upload',upload(q,{lineId:q.lines[1].id,filename:'second-style.png'}),service)).quote;
  const second=(await version(q)).media.find(item=>item.filename==='second-style.png');assert(second);
  assert.deepEqual(rawRecords().find(item=>item.id===firstSnapshot.id),firstSnapshot);
  assert.deepEqual((await version(q,firstMediaVersion)).media.map(item=>item.id),[first.id]);
  await deny('customer-quote-media-upload',upload(q,{quoteVersion:firstMediaVersion}),409);
  pass('款式图片/PDF 校验实际签名、类型和 10MB 限制；草稿上传创建新版，保存沿用附件，旧版不混入后补图片');

  const imageResponse=await call('customer-quote-media-file?id='+first.id,undefined,service);
  assert.equal(imageResponse.status,200);assert.equal(imageResponse.headers.get('Content-Type'),'image/png');assert.equal(imageResponse.headers.get('X-Content-Type-Options'),'nosniff');assert.match(imageResponse.headers.get('Cache-Control')||'',/no-store/);assert.match(imageResponse.headers.get('Content-Security-Policy')||'',/sandbox/);assert.match(imageResponse.headers.get('Content-Disposition')||'',/^inline/);assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()),png);
  const download=await call('customer-quote-media-file?id='+first.id+'&download=1',undefined,assigned);assert.equal(download.status,200);assert.match(download.headers.get('Content-Disposition')||'',/^attachment/);
  assert.equal((await call('customer-quote-media-file?id='+first.id,undefined,other)).status,403);
  pass('授权业务/客服可查看图片并下载，响应强制正确 MIME、nosniff、no-store 和 sandbox，非负责客户返回403');

  q=(await ok('customer-quote-confirm',{id:q.id,version:q.version,acknowledgeEnglish:true})).quote;
  const confirmedVersion=q.version,confirmedQuote=structuredClone(rawRecords().find(item=>item.id===q.id)),confirmedSnapshot=structuredClone(rawRecords().find(item=>item.kind==='customer_quote_revision'&&item.quoteId===q.id&&item.version===confirmedVersion));
  const confirmedRows=structuredClone(rawRecords().filter(item=>item.kind==='customer_quote_completed'&&item.quoteId===q.id));
  const confirmedView=await version(q);assert.deepEqual(confirmedView.media.map(item=>item.id).sort(),[first.id,second.id].sort());
  let completed=(await ok('customer-quote-completed',undefined,service)).rows.filter(item=>item.quoteId===q.id);
  assert.equal(completed.length,2);assert(completed.every(item=>item.quotedCustomer===''));
  assert(completed.find(item=>item.lineId===q.lines[0].id).media.some(item=>item.id===first.id));
  assert(!completed.find(item=>item.lineId===q.lines[1].id).media.some(item=>item.id===first.id),'A style row must not show another style image.');
  await deny('customer-quote-save',{...fields(q),lines:q.lines.map(line=>({...line,unitPrice:999}))},409);
  await ok('customer-quote-media-upload',upload(q,{category:'drawing',bytes:pdf,filename:'reviewed-drawing.pdf',title:'Synthetic reviewed drawing',drawingNo:'SYNTH-PDF-001'}),service);
  const drawing=(await version(q)).media.find(item=>item.filename==='reviewed-drawing.pdf');assert(drawing);assert.equal(drawing.supplement,true);
  assert.equal(drawing.title,'Synthetic reviewed drawing');assert.equal(drawing.drawingNo,'SYNTH-PDF-001');
  assert.deepEqual(rawRecords().find(item=>item.id===q.id),confirmedQuote);assert.deepEqual(rawRecords().find(item=>item.id===confirmedSnapshot.id),confirmedSnapshot);
  const pdfResponse=await call('customer-quote-media-file?id='+drawing.id,undefined,assigned);assert.equal(pdfResponse.status,200);assert.equal(pdfResponse.headers.get('Content-Type'),'application/pdf');assert.match(pdfResponse.headers.get('Content-Security-Policy')||'',/sandbox/);
  pass('确认后按款显示图片和图纸；补充图纸单独绑定确认版本，不改已确认价格、版本、快照或逐款归档记录');

  await ok('customer-quote-media-upload',upload(q,{category:'sent_quote',lineId:null,bytes:pdf,filename:'sent-quotation.pdf'}),assigned);
  await ok('customer-quote-media-upload',upload(q,{category:'evidence',lineId:null,filename:'email-evidence.png'}),assigned);
  const sendView=await version(q),sentPdf=sendView.media.find(item=>item.category==='sent_quote'),evidence=sendView.media.find(item=>item.category==='evidence');assert(sentPdf&&evidence);
  for(const sentDate of ['2026-02-30','not-a-date','2999-01-01'])await deny('customer-quote-record-sent',send(q,{sentDate}),400);
  await deny('customer-quote-record-sent',send(q,{quoteVersion:confirmedVersion-1}),409);
  await deny('customer-quote-record-sent',send(q,{mediaIds:['does-not-exist']}),403);
  await deny('customer-quote-record-sent',send(q),403,other);
  const sendRequest=send(q,{mediaIds:[sentPdf.id,evidence.id]}),concurrent=await Promise.all([call('customer-quote-record-sent',sendRequest,assigned),call('customer-quote-record-sent',sendRequest,assigned)]);
  assert(concurrent.some(response=>response.status===200));assert(concurrent.every(response=>[200,409].includes(response.status)));
  const sentResponse=await concurrent.find(response=>response.status===200).json();assert.equal(sentResponse.alreadyPresent,false);
  const afterSend=structuredClone(rawRecords());const retry=await ok('customer-quote-record-sent',sendRequest,assigned);assert.equal(retry.alreadyPresent,true);assert.deepEqual(rawRecords(),afterSend);
  const duplicateWithNewKey=await ok('customer-quote-record-sent',{...sendRequest,idempotencyKey:randomUUID()},assigned);assert.equal(duplicateWithNewKey.alreadyPresent,true);assert.deepEqual(rawRecords(),afterSend);
  await deny('customer-quote-record-sent',{...sendRequest,recipient:'different@test.invalid'},409);
  const sentHistory=(await version(q)).sentHistory;assert.equal(sentHistory.length,1);assert.equal(sentHistory[0].sentDate,sendRequest.sentDate);assert.equal(sentHistory[0].recipient,sendRequest.recipient);assert.equal(sentHistory[0].channel,sendRequest.channel);
  completed=(await ok('customer-quote-completed',undefined,assigned)).rows.filter(item=>item.quoteId===q.id);
  assert(completed.every(item=>item.quotedCustomer==='Y'&&item.sentHistory.length===1));assertNoSecrets(completed);
  assert.deepEqual(rawRecords().find(item=>item.id===q.id),confirmedQuote);assert.deepEqual(rawRecords().find(item=>item.id===confirmedSnapshot.id),confirmedSnapshot);
  for(const row of confirmedRows)assert.deepEqual(rawRecords().find(item=>item.id===row.id),row);
  pass('登记发送严格校验实际日期、确认版与证据；同一请求重试幂等、同键不同内容409，Y按发送事件派生且不覆盖历史总表');

  q=(await ok('customer-quote-revise',{id:q.id,version:q.version},assigned)).quote;
  q=(await ok('customer-quote-save',{...fields(q),lines:q.lines.map(line=>({...line,unitPrice:line.unitPrice+1}))},assigned)).quote;
  const alternatePng=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
  q=(await ok('customer-quote-media-upload',upload(q,{filename:'revision-only-style.png',bytes:alternatePng}),assigned)).quote;
  const revisionOnly=(await version(q)).media.find(item=>item.filename==='revision-only-style.png');assert(revisionOnly);
  assert(!(await version(q,confirmedVersion)).media.some(item=>item.id===revisionOnly.id));
  const oldVersionSend=send(q,{quoteVersion:confirmedVersion,recipient:'second-recipient@test.invalid',mediaIds:[sentPdf.id]});
  await ok('customer-quote-record-sent',oldVersionSend,assigned);
  assert.equal((await version(q,confirmedVersion)).sentHistory.length,2,'A historical confirmed version can be registered while its replacement is still a draft.');
  assert.equal((await version(q)).sentHistory.length,0,'Sending an old version must not mark the new draft as sent.');
  q=(await ok('customer-quote-confirm',{id:q.id,version:q.version,acknowledgeEnglish:true})).quote;
  await deny('customer-quote-record-sent',send(q,{mediaIds:[sentPdf.id]}),403);
  completed=(await ok('customer-quote-completed',undefined,assigned)).rows.filter(item=>item.quoteId===q.id);
  assert.equal(completed.length,4);assert(completed.filter(item=>item.quoteVersion===confirmedVersion).every(item=>item.quotedCustomer==='Y'));assert(completed.filter(item=>item.quoteVersion===q.version).every(item=>item.quotedCustomer===''));
  assert.equal(completed.find(item=>item.quoteVersion===confirmedVersion&&item.lineId===q.lines[0].id).unitPriceUsd,11.11);
  assert.equal(completed.find(item=>item.quoteVersion===q.version&&item.lineId===q.lines[0].id).unitPriceUsd,12.11);
  for(const row of confirmedRows)assert.deepEqual(rawRecords().find(item=>item.id===row.id),row);
  pass('可明确登记历史确认版本；修订价、图片、发出状态各按版本隔离，不误标新草稿，不借用其他版本发送凭证');

  const relevantIds=new Set(rawRecords().filter(item=>item.id===q.id||item.quoteId===q.id).map(item=>item.id));
  for(const user of [assigned,service,other]){
   const data=await ok('data',undefined,user);assertNoSecrets(data.audits.filter(item=>relevantIds.has(item.targetId)));
   assert(!JSON.stringify(data).includes('"kind":"customer_quote_media"'));assert(!JSON.stringify(data).includes('"kind":"customer_quote_send"'));
   if(user===other)assert(!data.audits.some(item=>relevantIds.has(item.targetId)));
  }
  const quoteRecords=structuredClone(rawRecords().filter(item=>item.id===q.id||item.quoteId===q.id));
  account=(await ok('customer-save',{...account,salesName:other.displayName,serviceName:'',salesMemberIds:[member(other).id],serviceMemberIds:[],quoteMemberIds:[member(other).id]})).item;
  for(const user of [assigned,service]){
   assert.equal((await call(`customer-quote-version?quoteId=${q.id}&quoteVersion=${confirmedVersion}`,undefined,user)).status,403);
   assert.equal((await call('customer-quote-media-file?id='+first.id,undefined,user)).status,403);
   assert(!(await ok('customer-quote-completed',undefined,user)).rows.some(item=>item.quoteId===q.id));
   assert(!(await ok('data',undefined,user)).audits.some(item=>relevantIds.has(item.targetId)));
  }
  assert.equal((await call('customer-quote-media-file?id='+first.id,undefined,other)).status,200);
  assert.equal((await version(q,confirmedVersion,other)).sentHistory.length,2);
  for(const record of quoteRecords)assert.deepEqual(rawRecords().find(item=>item.id===record.id),record);
  policy={...policy,memberIds:policy.memberIds.filter(id=>id!==member(other).id)};rawPut(policy);
  assert.equal((await call('customer-quote-media-file?id='+first.id,undefined,other)).status,403);
  assert.equal((await call(`customer-quote-version?quoteId=${q.id}&quoteVersion=${confirmedVersion}`,undefined,other)).status,403);
  assert(!(await ok('data',undefined,other)).audits.some(item=>relevantIds.has(item.targetId)));
  pass('通用 data/audit 不泄露新附件和发送记录；客户责任移交及模块权限撤销立即封堵旧链接并保留所有历史');

  rawPut({...policy,memberIds:[...policy.memberIds,member(other).id]});
  let unbound=(await ok('customer-quote-save',{...draft,customerAccountId:null,customerName:'UNBOUND SYNTHETIC ENQUIRY',customerCode:'',quoteNo:'SYNTH-UNBOUND-ARCHIVE'})).quote;
  unbound=(await ok('customer-quote-media-upload',upload(unbound,{filename:'unbound-style.png'}))).quote;
  unbound=(await ok('customer-quote-confirm',{id:unbound.id,version:unbound.version,acknowledgeEnglish:true})).quote;
  const unboundView=await version(unbound,unbound.version,admin),unboundMedia=unboundView.media[0];assert(unboundMedia);
  assert.equal((await call('customer-quote-media-file?id='+unboundMedia.id)).status,200);
  for(const user of [assigned,service,other])assert.equal((await call('customer-quote-media-file?id='+unboundMedia.id,undefined,user)).status,403);
  await ok('customer-quote-record-sent',send(unbound));
  assert.equal((await version(unbound,unbound.version,admin)).sentHistory.length,1);

  q=(await ok('customer-quote-revise',{id:q.id,version:q.version})).quote;
  q=(await ok('customer-quote-save',{...fields(q),customerAccountId:accountB.id,customerName:accountB.customer,customerCode:accountB.customerCode})).quote;
  assert(!(await version(q,q.version,other)).media.some(item=>item.id===first.id),'Administrator reassociation must not carry another customer media forward.');
  assert.equal((await call(`customer-quote-version?quoteId=${q.id}&quoteVersion=${confirmedVersion}`,undefined,other)).status,403,'Even responsibility for both customers cannot expose a previous customer version after reassociation.');
  assert.equal((await call('customer-quote-media-file?id='+first.id,undefined,other)).status,403);
  assert.equal((await call('customer-quote-media-file?id='+first.id)).status,200,'Administrator retains access to preserved original bytes.');
  pass('无码未绑定客户附件与发送登记仅报价管理员可见；改绑客户不传递原客户图片，管理员仍可追溯旧文件');
 }finally{
  rawPut(priorPolicy);
 }
}
