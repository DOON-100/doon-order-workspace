import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

export async function testIeQuoteNotifications({ok,call,pass,rawRecords}){
 const env=globalThis.__ieSuiteEnv||globalThis.__testEnv,oldTransport=env.IE_MAIL;
 const members=rawRecords().filter(r=>r.kind==='member'),engineer=members.find(m=>m.id==='ie_test_synthetic-engineer'),reviewer=members.find(m=>m.id==='ie_test_synthetic-reviewer'),manager=members.find(m=>m.id==='ie_test_synthetic-manager'),intruder=members.find(m=>m.id==='ie_test_synthetic-other');
 const user=m=>({userId:m.userId,email:m.email,displayName:m.name,fullName:m.name});
 const keys=['customerAccountId','quoteNo','quoteDate','validUntil','batchId','exchangeRateCnyPerUsd','exchangeRateDate','exchangeRateSource','notes','lines','tooling'],fields=q=>Object.fromEntries([...keys,'id','version'].filter(k=>q[k]!==undefined).map(k=>[k,structuredClone(q[k])]));
 let q=rawRecords().find(r=>r.kind==='ie_quote'&&r.quoteNo==='IE-TPL-1');const draft=fields(q);draft.lines[0].drawingRevision='R1';q=(await ok('ie-quote-save',draft,user(engineer))).quote;
 q=(await ok('ie-quote-submit',{id:q.id,version:q.version},user(engineer))).quote;
 const query=()=>`ie-quote-notification-preview?id=${q.id}&version=${q.version}`,push=p=>({quoteId:q.id,quoteVersion:q.version,fingerprint:p.fingerprint,idempotencyKey:crypto.randomUUID()});
 delete env.IE_MAIL;
 try{
  assert.equal((await call(query(),undefined,user(intruder))).status,403);
  const disabled=(await ok(query(),undefined,user(engineer))).preview;assert.equal(disabled.canPush,true);assert.equal(disabled.ready,false);assert.equal(disabled.attachmentMode,'engineering_xlsx');assert.equal(disabled.to[0].memberId,reviewer.id);assert.equal(disabled.to[0].email,'');assert(disabled.attachment.sha256);assert(disabled.blockers.some(b=>b.includes('真实邮件发送服务')));
  assert.equal((await call('ie-quote-notification-push',push(disabled),user(engineer))).status,409);assert(!rawRecords().some(r=>r.kind==='ie_quote_notification_delivery'&&r.quoteId===q.id));
  assert.equal((await call('ie-quote-notification-mailbox',{memberId:reviewer.id,email:'reviewer@doon.local',expectedVersion:0,confirmed:true})).status,400);
  assert.equal((await call('ie-quote-notification-mailbox',{memberId:reviewer.id,email:'reviewer@synthetic.example.com',expectedVersion:0,confirmed:true},user(engineer))).status,403);
  for(const m of [engineer,reviewer,manager])await ok('ie-quote-notification-mailbox',{memberId:m.id,email:m.id+'@synthetic.example.com',expectedVersion:0,confirmed:true});
  assert.equal(rawRecords().find(r=>r.id===engineer.id).email,engineer.email);
  const payloads=[],transport={configured:true,from:engineer.id+'@synthetic.example.com',workspaceBaseUrl:'https://synthetic-workspace.example.com',send:async payload=>{payloads.push(payload);return {status:'sent',providerMessageId:'synthetic-message-1'};}};env.IE_MAIL=transport;
  let preview=(await ok(query(),undefined,user(engineer))).preview;assert.equal(preview.ready,true,preview.blockers.join(';'));assert(preview.body.includes('?recordId='));
  const stale=push(preview);await ok('member-notification-mailbox',{memberId:reviewer.id,email:'reviewer-updated@synthetic.example.com',expectedVersion:1,confirmed:true});
  assert.equal((await call('ie-quote-notification-push',stale,user(engineer))).status,409);assert.equal(payloads.length,0);
  preview=(await ok(query(),undefined,user(engineer))).preview;const same=(await ok(query(),undefined,user(reviewer))).preview;assert.equal(preview.fingerprint,same.fingerprint);
  const request=push(preview),delivery=(await ok('ie-quote-notification-push',request,user(engineer))).delivery;assert.equal(delivery.status,'sent');assert.equal(payloads.length,1);assert.equal(payloads[0].to[0],'reviewer-updated@synthetic.example.com');assert.equal(payloads[0].attachments.length,1);assert.equal(payloads[0].attachments[0].sha256,preview.attachment.sha256);assert.equal(createHash('sha256').update(payloads[0].attachments[0].bytes).digest('hex'),preview.attachment.sha256);
  assert.equal((await ok('ie-quote-notification-push',request,user(engineer))).alreadyPresent,true);
  assert.equal((await ok('ie-quote-notification-push',{...request,idempotencyKey:crypto.randomUUID()},user(reviewer))).alreadyPresent,true);assert.equal(payloads.length,1);
  assert.equal((await call('ie-quote-notification-push',{...request,fingerprint:'a'.repeat(64)},user(engineer))).status,409);
  pass('邮件推送：明确固定复核收件人，独立真实邮箱绑定不改账号；无服务不记已发，预览锁定附件hash，邮箱变更失效且跨人换key也不能重复发');

  const policy=rawRecords().find(r=>r.kind==='customer_quote_access'),business=members.find(m=>m.active&&m.role!=='admin'&&policy.memberIds.includes(m.id));assert(business,'synthetic sales fixture required');
  const account=rawRecords().find(r=>r.id===q.customerAccountId);await ok('customer-save',{...account,expectedVersion:account.version,salesName:business.name,salesMemberIds:[business.id],serviceMemberIds:[],quoteMemberIds:[business.id]});
  await ok('ie-quote-notification-mailbox',{memberId:business.id,email:'responsible-sales@synthetic.example.com',expectedVersion:0,confirmed:true});
  q=(await ok('ie-quote-review',{id:q.id,version:q.version,decision:'approve',reason:''},user(reviewer))).quote;
  preview=(await ok(query(),undefined,user(engineer))).preview;assert.equal(preview.ready,true,preview.blockers.join(';'));assert.deepEqual(preview.to.map(m=>m.memberId),[business.id]);assert.deepEqual(preview.cc.map(m=>m.memberId).sort(),[engineer.id,reviewer.id].sort());
  env.IE_MAIL={...transport,send:async payload=>{payloads.push(payload);throw new Error('synthetic ambiguous network response');}};
  // Sender, URL, quote and file are unchanged; function identity is not part of
  // the human-reviewed preview and the fake never opens a network connection.
  const uncertain=push(preview),unknown=(await ok('ie-quote-notification-push',uncertain,user(engineer))).delivery;assert.equal(unknown.status,'unknown');assert.equal(payloads.length,2);
  assert.equal((await ok('ie-quote-notification-push',{...uncertain,idempotencyKey:crypto.randomUUID()},user(reviewer))).delivery.status,'unknown');assert.equal(payloads.length,2);
  const history=(await ok(query(),undefined,user(engineer))).history;assert(history.some(d=>d.id===unknown.id&&d.status==='unknown'));
  pass('发布邮件只发该客户负责业务并抄送工程主管/生产副总；发送结果未知保留历史且换key不自动重发，合成测试没有真实外发');

  env.IE_MAIL={...transport,send:async payload=>{payloads.push(payload);return {status:'sent',providerMessageId:'synthetic-sales-approval'};}};
  const customer=rawRecords().find(r=>r.id===q.customerAccountId),salesDraft={companyEn:'Synthetic Eyewear Ltd',companyZh:'合成眼镜公司',collectionEn:'Synthetic',collectionZh:'合成',customerAccountId:customer.id,customerCode:customer.customerCode,customerName:customer.customer,quoteNo:'IE-MAIL-SALES',quoteDate:'2026-10-01',validUntil:'2026-10-31',currency:'USD',lines:[{id:'mail-sales-line',model:q.lines[0].model,descriptionZh:'合成镜架',descriptionEn:'Synthetic frame',quantity:200,unitPrice:20,toolingFee:0}],terms:[{id:'mail-sales-term',labelZh:'条款',labelEn:'Terms',zh:'已复核条件',en:'Reviewed terms',needsReview:false}],reviewNotes:[]};
  let sales=(await ok('customer-quote-save',salesDraft,user(business))).quote;
  sales=(await ok('customer-quote-adopt-ie',{id:sales.id,version:sales.version,ieQuoteId:q.id,ieQuoteVersion:q.version,scopeAcknowledged:true,mappings:[{customerLineId:'mail-sales-line',ieLineId:q.lines[0].id}],toolingMappings:[]},user(business))).quote;
  const salesQuery=()=>`ie-quote-notification-preview?id=${sales.id}&version=${sales.version}&target=sales_approval`;
  const salesPreview=(await ok(salesQuery(),undefined,user(business))).preview;assert.equal(salesPreview.ready,true,salesPreview.blockers.join(';'));assert.equal(salesPreview.quoteId,sales.id);assert.equal(salesPreview.quoteVersion,sales.version);assert.equal(salesPreview.engineeringQuoteVersion,q.version);assert.deepEqual(salesPreview.to.map(v=>v.memberId),[manager.id]);assert.deepEqual(salesPreview.cc,[]);assert(salesPreview.body.includes('/customer-quotes?recordId='));
  assert.equal((await call(salesQuery(),undefined,user(intruder))).status,403);
  const salesPush={target:'sales_approval',quoteId:sales.id,quoteVersion:sales.version,fingerprint:salesPreview.fingerprint,idempotencyKey:crypto.randomUUID()},notice=await ok('ie-quote-notification-push',salesPush,user(business));assert.equal(notice.delivery.status,'sent');assert.equal(rawRecords().find(r=>r.id===sales.id).status,'draft');assert.equal(payloads.at(-1).to[0],manager.id+'@synthetic.example.com');assert.equal(payloads.at(-1).attachments[0].sha256,salesPreview.attachment.sha256);
  const customerEdit=Object.fromEntries([...Object.keys(salesDraft),'id','version'].map(k=>[k,structuredClone(sales[k])]));customerEdit.lines[0].descriptionZh='范围变更需重新采用';sales=(await ok('customer-quote-save',customerEdit,user(business))).quote;
  assert.equal((await call('ie-quote-notification-push',salesPush,user(business))).status,409);const outdated=(await ok(salesQuery(),undefined,user(business))).preview;assert.equal(outdated.ready,false);assert(outdated.blockers.some(v=>v.includes('重新核对并采用')));
  pass('销售待批通知绑定客价精确版本和已采用工程附件，只发总经理且发送不等于批准；越权和范围变更均不能沿用旧预览');
 }finally{if(oldTransport===undefined)delete env.IE_MAIL;else env.IE_MAIL=oldTransport;}
}
