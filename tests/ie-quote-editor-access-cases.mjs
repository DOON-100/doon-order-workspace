import assert from 'node:assert/strict';

// Only synthetic records from testIeQuotes are used; no production services.
export async function testIeAdditionalEditors({ok,call,pass,rawRecords,rawInsert,rawUpdate}){
 const member=name=>rawRecords().find(r=>r.id==='ie_test_synthetic-'+name);
 const user=m=>({userId:m.userId,email:m.email,displayName:m.name,fullName:m.name});
 const engineer=member('engineer'),reviewer=member('reviewer'),manager=member('manager');
 const e=user(engineer),r=user(reviewer),g=user(manager);
 const source=rawRecords().find(q=>q.kind==='ie_quote'&&q.quoteNo==='IE-CATALOG');
 const keys=['customerAccountId','quoteNo','quoteDate','validUntil','batchId','exchangeRateCnyPerUsd','exchangeRateDate','exchangeRateSource','notes','lines','tooling','manualAdjustments'];
 const fields=q=>Object.fromEntries([...keys,'id','version'].filter(k=>q[k]!==undefined).map(k=>[k,structuredClone(q[k])]));
 const fresh=name=>{const input=fields(source);delete input.id;delete input.version;input.quoteNo=name;return input;};
 const decision=(q,kind='approve')=>({id:q.id,version:q.version,decision:kind,reason:'合成独立审核验证'});
 const revisionSnapshot=q=>JSON.stringify(rawRecords().find(s=>s.kind==='ie_quote_revision'&&s.quoteId===q.id&&s.version===q.version));

 let adminQuote=(await ok('ie-quote-save',fresh('IE-ADMIN-EDITOR'))).quote;
 const adminId=adminQuote.createdById;
 assert(adminQuote.canEdit&&adminQuote.canSubmit);assert.deepEqual(adminQuote.preparedByIds,[adminId]);
 assert.equal(adminQuote.updatedById,adminId);assert.equal((await ok('ie-quotes')).capabilities.canCreate,true);
 const v1=revisionSnapshot(adminQuote);
 adminQuote=(await ok('ie-quote-save',{...fields(adminQuote),notes:'管理员实际保存留痕'})).quote;
 assert.equal((await call('ie-quote-save',{...fields(adminQuote),version:adminQuote.version-1})).status,409);
 adminQuote=(await ok('ie-quote-submit',{id:adminQuote.id,version:adminQuote.version})).quote;
 assert.equal(adminQuote.requiredReviewMemberId,reviewer.id);
 assert.equal((await call('ie-quote-review',decision(adminQuote))).status,403);
 adminQuote=(await ok('ie-quote-review',decision(adminQuote),r)).quote;
 assert.equal(adminQuote.canReview,false);
 const released=revisionSnapshot(adminQuote),releasedVersion=adminQuote.version;
 adminQuote=(await ok('ie-quote-revise',{id:adminQuote.id,version:adminQuote.version})).quote;
 assert(adminQuote.canEdit&&adminQuote.preparedByIds.includes(adminId));
 assert.equal(revisionSnapshot({...adminQuote,version:1}),v1);
 assert.equal(revisionSnapshot({...adminQuote,version:releasedVersion}),released);
 pass('管理员可创建、编辑、修订工程草稿并留真实身份；提交仍由杨独立审核，管理员不能自批或覆盖旧版本');

 let returned=(await ok('ie-quote-save',fresh('IE-RETURNED-REVIEW-ROUTING'),e)).quote;
 returned=(await ok('ie-quote-submit',{id:returned.id,version:returned.version},e)).quote;
 returned=(await ok('ie-quote-review',decision(returned,'return'),r)).quote;
 assert.equal(returned.requiredReviewMemberId,reviewer.id);assert.equal(returned.nextReviewMemberId,manager.id);
 returned=(await ok('ie-quote-submit',{id:returned.id,version:returned.version},r)).quote;
 assert.equal(returned.requiredReviewMemberId,manager.id);assert.equal(returned.nextReviewMemberId,'');
 pass('退回报价按实际提交人显示下一复核人，已提交快照仍保留原指定审核字段');

 let gm=(await ok('ie-quote-save',fresh('IE-MANAGER-EDITOR'),g)).quote;
 assert(gm.canEdit&&gm.canSubmit);assert.deepEqual(gm.preparedByIds,[manager.id]);
 assert.equal((await ok('ie-quotes',undefined,g)).capabilities.canCreate,true);
 gm=(await ok('ie-quote-submit',{id:gm.id,version:gm.version},g)).quote;
 assert.equal(gm.requiredReviewMemberId,reviewer.id);
 assert.equal((await call('ie-quote-review',decision(gm),g)).status,403);
 gm=(await ok('ie-quote-review',decision(gm),r)).quote;
 const managerReleased=revisionSnapshot(gm);
 gm=(await ok('ie-quote-revise',{id:gm.id,version:gm.version},g)).quote;
 assert(gm.canEdit&&gm.preparedByIds.includes(manager.id));
 gm=(await ok('ie-quote-save',{...fields(gm),notes:'生产副总参与同笔修订'},r)).quote;
 assert(gm.preparedByIds.includes(reviewer.id)&&gm.preparedByIds.includes(manager.id));
 assert.equal(gm.canSubmit,false);assert.match(gm.submissionBlockReason,/独立复核/);
 let denied=await call('ie-quote-submit',{id:gm.id,version:gm.version},e);
 assert.equal(denied.status,409);assert.match((await denied.json()).error,/独立复核/);
 assert.equal((await ok('ie-quote?id='+gm.id,undefined,g)).quote.version,gm.version);
 assert.equal(revisionSnapshot({...gm,version:gm.version-2}),managerReleased);
 pass('曲艳红可填报并由杨审核；杨与曲均参与同笔报价后阻止提交，修订不清空参与者');

 let fallback=(await ok('ie-quote-save',fresh('IE-SUBMITTER-PARTICIPATION'),e)).quote;
 fallback=(await ok('ie-quote-submit',{id:fallback.id,version:fallback.version},r)).quote;
 assert(fallback.preparedByIds.includes(reviewer.id));assert.equal(fallback.requiredReviewMemberId,manager.id);
 assert.equal((await call('ie-quote-review',decision(fallback),r)).status,403);
 fallback=(await ok('ie-quote-review',decision(fallback),g)).quote;
 fallback=(await ok('ie-quote-revise',{id:fallback.id,version:fallback.version},e)).quote;
 // Simulate a legacy revision which reset this field. Earlier immutable snapshots must still protect review.
 rawUpdate({...rawRecords().find(q=>q.id===fallback.id),preparedByIds:[engineer.id]});
 assert.equal((await ok('ie-quote?id='+fallback.id,undefined,e)).quote.nextReviewMemberId,manager.id);
 fallback=(await ok('ie-quote-submit',{id:fallback.id,version:fallback.version},e)).quote;
 assert(fallback.preparedByIds.includes(reviewer.id));assert.equal(fallback.requiredReviewMemberId,manager.id);
 assert.equal((await call('ie-quote-review',decision(fallback),r)).status,403);
 fallback=(await ok('ie-quote-review',decision(fallback),g)).quote;
 pass('提交人计入填报参与者；旧修订曾重置人员时仍从历史快照恢复，不能借修订规避独立审核');

 // Current active roles are rechecked by the real handlers, even with an old page open.
 let revoke=(await ok('ie-quote-save',fresh('IE-REVOKED-EDITOR'),g)).quote;
 rawUpdate({...manager,active:false});
 assert.equal((await call('ie-quote-save',fields(revoke),g)).status,403);
 const blocked=(await ok('ie-quote?id='+revoke.id,undefined,e)).quote;
 assert.equal(blocked.canSubmit,false);assert.match(blocked.submissionBlockReason,/停用/);
 rawUpdate(manager);
 revoke=(await ok('ie-quote-submit',{id:revoke.id,version:revoke.version},g)).quote;
 rawUpdate({...reviewer,active:false});
 assert.equal((await call('ie-quote-review',decision(revoke),r)).status,403);
 rawUpdate(reviewer);
 revoke=(await ok('ie-quote-review',decision(revoke),r)).quote;
 const tempAdmin={id:'ie_additional_admin',kind:'member',userId:'ie_additional_admin',email:'ie_additional_admin@test.invalid',name:'合成临时管理员',role:'admin',customers:[],active:true,createdAt:'2026-10-01'};
 rawInsert(tempAdmin);const a=user(tempAdmin);
 let temp=(await ok('ie-quote-save',fresh('IE-REVOKED-ADMIN'),a)).quote;
 rawUpdate({...tempAdmin,role:'production'});
 assert.equal((await call('ie-quote-save',fields(temp),a)).status,403);
 rawUpdate(tempAdmin);
 const catalog={category:'material',name:'合成新增填报人目录',specification:'',unit:'件',basePrice:1,standardSeconds:null,priceSource:'合成核价依据',effectiveDate:'2026-10-01',active:true};
 assert.equal((await ok('ie-quote-catalog-save',catalog)).catalog.version,1);
 assert.equal((await ok('ie-quote-catalog-save',{...catalog,name:'合成总经理目录'},g)).catalog.version,1);
 pass('管理员与总经理目录维护可用；停用填报人、停用指定审核人及撤回管理员权限均由服务端拦截');

 let drawings=(await ok('ie-quote-save',fresh('IE-ADDITIONAL-EDITOR-DRAWINGS'),e)).quote;
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=','base64');
 const form=q=>{const f=new FormData();f.set('quoteId',q.id);f.set('version',String(q.version));f.set('lineId',q.lines[0].id);f.set('file',new File([png],'synthetic-editor.png',{type:'image/png'}));return f;};
 drawings=(await ok('ie-quote-attachment-upload',form(drawings))).quote;
 assert(drawings.preparedByIds.includes(adminId));
 drawings=(await ok('ie-quote-attachment-upload',form(drawings),g)).quote;
 assert(drawings.preparedByIds.includes(manager.id));
 drawings=(await ok('ie-quote-submit',{id:drawings.id,version:drawings.version},e)).quote;
 assert.equal(drawings.requiredReviewMemberId,reviewer.id);
 drawings=(await ok('ie-quote-review',decision(drawings),r)).quote;
 pass('管理员与总经理可上传图纸，附件操作同样记作参与填报并保留独立审核');
}
