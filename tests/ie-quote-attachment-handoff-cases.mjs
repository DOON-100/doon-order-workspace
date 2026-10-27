import assert from 'node:assert/strict';

// Original bytes, identities and customer scopes are synthetic. This suite uses
// the real SQLite/CAS API harness; raw writes only create/change fixture state.
export async function testIeAttachmentsAndHandoff({ok,call,pass,rawRecords,rawInsert,rawUpdate,files}){
 const member=id=>rawRecords().find(r=>r.kind==='member'&&r.id==='ie_test_'+id),user=m=>({userId:m.userId,email:m.email,displayName:m.name,fullName:m.name});
 const engineer=user(member('synthetic-engineer')),reviewer=user(member('synthetic-reviewer')),manager=user(member('synthetic-manager')),intruder=user(member('synthetic-other'));
 const policy=rawRecords().find(r=>r.kind==='customer_quote_access'),salesMember=rawRecords().find(r=>r.kind==='member'&&r.active&&r.userId&&r.role!=='admin'&&policy.memberIds.includes(r.id));assert(salesMember);
 const business=user(salesMember),at='2026-10-01T00:00:00.000Z';
 const namedAdmin={id:'ie_files_named_admin',kind:'member',userId:'ie_files_named_admin',email:'ie-files-admin@test.invalid',name:'合成明确负责报价管理员',role:'admin',customers:[],active:true,createdAt:at};rawInsert(namedAdmin);const businessAdmin=user(namedAdmin);
 let account={...rawRecords().find(r=>r.id==='ie_test_account'),id:'ie_files_customer',customer:'附件下推合成客户',customerCode:'IE-FILES',quoteMemberIds:[salesMember.id,namedAdmin.id,member('synthetic-engineer').id,member('synthetic-reviewer').id,member('synthetic-manager').id],salesMemberIds:[salesMember.id],serviceMemberIds:[]};rawInsert(account);
 const keys=['customerAccountId','quoteNo','quoteDate','validUntil','batchId','exchangeRateCnyPerUsd','exchangeRateDate','exchangeRateSource','notes','lines','tooling'];
 const fields=q=>Object.fromEntries([...keys,'id','version'].filter(k=>q[k]!==undefined).map(k=>[k,structuredClone(q[k])]));
 const seed=fields(rawRecords().find(r=>r.kind==='ie_quote'&&r.quoteNo==='IE-SYNTHETIC-01'));delete seed.id;delete seed.version;Object.assign(seed,{quoteNo:'IE-FILES-HANDOFF',customerAccountId:account.id,batchId:'FILES-HANDOFF'});
 seed.lines[0].materials[0].unit='';seed.lines[0].processes[0].standardSeconds=null;
 let q=(await ok('ie-quote-save',seed,engineer)).quote;assert.deepEqual(q.issues,[],'材料单位和自由工序秒工时非原Excel计价项，允许空');
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=','base64');
 const pdf=Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\nstartxref\n9\n%%EOF\n');
 const webp=Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA','base64');
 const jpeg=Buffer.from([255,216,255,192,0,11,8,0,1,0,1,1,1,17,0,255,218,0,8,1,1,0,0,63,0,0,255,217]);
 const form=(quote,bytes=png,name='合成图纸.png',type='image/png',extra={})=>{const f=new FormData();f.set('quoteId',quote.id);f.set('version',String(quote.version));f.set('lineId',quote.lines[0].id);f.set('file',new File([bytes],name,{type}));for(const [k,v]of Object.entries(extra))f.set(k,v);return f;};
 const getFile=(quote,a,who=engineer)=>call(`ie-quote-attachment?id=${quote.id}&version=${quote.version}&attachmentId=${a.id}`,undefined,who);
 assert.equal((await call('ie-quote-attachment-upload',form(q),intruder)).status,403);
 assert.equal((await call('ie-quote-attachment-upload',form(q),business)).status,403);
 assert.equal((await call('ie-quote-attachment-upload',form(q,Buffer.from('<svg onload="bad"/>'),'fake.png'),engineer)).status,400);
 assert.equal((await call('ie-quote-attachment-upload',form(q,Buffer.from('<html>fake</html>'),'fake.pdf','application/pdf'),engineer)).status,400);
 assert.equal((await call('ie-quote-attachment-upload',form(q,png,'fake.pdf','application/pdf'),engineer)).status,400);
 assert.equal((await call('ie-quote-attachment-upload',form(q,png,'real.png','text/html'),engineer)).status,400);
 assert.equal((await call('ie-quote-attachment-upload',form(q,Buffer.alloc(12*1024*1024+1),'large.png'),engineer)).status,400);
 assert.equal((await call('ie-quote-attachment-upload',form(q,png,'bad\r\nX-Header.png'),engineer)).status,400);
 assert.equal((await call('ie-quote-attachment-upload',form(q,png,'目录／图纸.png'),engineer)).status,400);
 assert.equal((await call('ie-quote-attachment-upload',form(q,png,'目录＼图纸.png'),engineer)).status,400);
 for(const token of ['JavaScript','OpenAction','Launch','EmbeddedFiles','RichMedia','J#53']){const active=Buffer.from(pdf.toString().replace('/Catalog','/Catalog /'+token+' 2 0 R'));assert.equal((await call('ie-quote-attachment-upload',form(q,active,'active.pdf','application/pdf'),engineer)).status,400);}
 const duplicate=form(q);duplicate.append('version',String(q.version));assert.equal((await call('ie-quote-attachment-upload',duplicate,engineer)).status,400);
 pass('IE附件拒绝非工程写入、HTML/SVG伪装、类型不符、超限、头注入、重复参数与明显主动PDF内容');
 const q0=structuredClone(q);q=(await ok('ie-quote-attachment-upload',form(q),engineer)).quote;const first=q.attachments[0],originalVersion=q.version;assert.equal(q.version,q0.version+1);assert.equal(first.matchesDrawingRevision,true);assert(!JSON.stringify(first).includes('fileKey'));
 assert.equal((await call('ie-quote-attachment-upload',form(q0),engineer)).status,409);
 let download=await getFile(q,first,business);assert.equal(download.status,200);assert.equal(download.headers.get('Content-Type'),'image/png');assert.equal(download.headers.get('X-Content-Type-Options'),'nosniff');assert.match(download.headers.get('Content-Security-Policy'),/sandbox/);assert.deepEqual(Buffer.from(await download.arrayBuffer()),png);
 assert.equal((await getFile(q,first,intruder)).status,403);assert.equal((await getFile(q0,first)).status,403);assert.equal((await call(`ie-quote-attachment?id=${q.id}&attachmentId=${first.id}`,undefined,engineer)).status,400);
 const originalRecord=rawRecords().find(r=>r.id===first.id),stored=files.get(originalRecord.fileKey);files.set(originalRecord.fileKey,Buffer.from('tampered'));assert.equal((await getFile(q,first)).status,409);files.set(originalRecord.fileKey,stored);
 for(const [bytes,name,type]of [[pdf,'diagram.pdf','application/pdf'],[jpeg,'photo.jpg','image/jpeg'],[webp,'preview.webp','image/webp']])q=(await ok('ie-quote-attachment-upload',form(q,bytes,name,type),engineer)).quote;
 const replaced=(await ok('ie-quote-attachment-upload',form(q,png,'替换图.png','image/png',{replaceAttachmentId:first.id}),engineer)).quote;q=replaced;assert(!q.attachments.some(a=>a.id===first.id));assert(rawRecords().some(r=>r.id===first.id));assert(files.has(originalRecord.fileKey));
 const historical=(await ok(`ie-quote?id=${q.id}&version=${originalVersion}`,undefined,engineer)).quote;assert.equal((await getFile(historical,first,business)).status,200);assert.equal((await getFile(q,first)).status,403);
 pass('IE附件原件私有保存并校验哈希，上传替换均递增报价快照；历史版本仍可授权下载原件');
 const changed=fields(q);changed.lines[0].drawingRevision='R2';q=(await ok('ie-quote-save',changed,engineer)).quote;assert(q.issues.some(i=>i.includes('旧图纸版本')));assert.equal((await call('ie-quote-submit',{id:q.id,version:q.version},engineer)).status,400);
 assert.equal((await call('ie-quote-save',{...fields(q),attachmentRefs:[]},engineer)).status,400);
 for(const a of q.attachments){const payload={id:q.id,version:q.version,lineId:a.lineId,attachmentId:a.id};assert.equal((await call('ie-quote-attachment-bind',payload,engineer)).status,400);q=(await ok('ie-quote-attachment-bind',{...payload,acknowledgeDrawingRevision:true},engineer)).quote;}
 assert.deepEqual(q.issues,[]);const remove=q.attachments[0],beforeRemove=structuredClone(q);q=(await ok('ie-quote-attachment-remove',{id:q.id,version:q.version,lineId:remove.lineId,attachmentId:remove.id},engineer)).quote;assert(rawRecords().some(r=>r.id===remove.id));assert.equal((await getFile(beforeRemove,remove)).status,200);assert.equal((await getFile(q,remove)).status,403);
 let other=(await ok('ie-quote-save',{...seed,quoteNo:'IE-FILES-OTHER'},engineer)).quote;assert.equal((await call('ie-quote-attachment-bind',{id:other.id,version:other.version,lineId:other.lines[0].id,attachmentId:remove.id,acknowledgeDrawingRevision:true},engineer)).status,403);
 const race=await Promise.all([call('ie-quote-attachment-upload',form(other,png,'race-a.png'),engineer),call('ie-quote-attachment-upload',form(other,png,'race-b.png'),engineer)]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);other=(await ok('ie-quote?id='+other.id,undefined,engineer)).quote;assert.equal(other.attachments.length,1);
 const lostScope={...account,quoteMemberIds:[namedAdmin.id],salesMemberIds:[]};rawUpdate(lostScope);assert.equal((await getFile(historical,first,business)).status,403);rawUpdate(account);
 pass('图纸版次变化须逐附件明确重新绑定，客户端不能伪造引用；删除保留历史、跨报价绑定与并发旧版本被阻断，收权立即生效');
 q=(await ok('ie-quote-submit',{id:q.id,version:q.version},engineer)).quote;
 assert.equal((await call('ie-quote-attachment-upload',form(q),reviewer)).status,409);assert.equal((await call('ie-quote-handoff',{id:q.id,version:q.version,recipientMemberIds:[salesMember.id]},engineer)).status,403);
 q=(await ok('ie-quote-review',{id:q.id,version:q.version,decision:'approve',reason:'附件及核价已复核'},reviewer)).quote;const released=structuredClone(q);
 assert.equal(q.canPushToBusiness,true);assert.deepEqual(q.handoffCandidates.map(c=>c.memberId).sort(),[salesMember.id,namedAdmin.id].sort());assert.equal((await ok('ie-quote?id='+q.id)).quote.canPushToBusiness,false);
 const push={id:q.id,version:q.version,recipientMemberIds:[salesMember.id,namedAdmin.id]};assert.equal((await call('ie-quote-handoff',push)).status,403);assert.equal((await call('ie-quote-handoff',push,business)).status,403);assert.equal((await call('ie-quote-handoff',{...push,recipientMemberIds:[member('synthetic-other').id]},engineer)).status,403);assert.equal((await call('ie-quote-handoff',{...push,recipientMemberIds:[]},engineer)).status,400);
 const beforeSales=rawRecords().filter(r=>['customer_quote','ie_quote_notification_delivery'].includes(r.kind)).map(r=>JSON.stringify(r));
 let handoff=(await ok('ie-quote-handoff',push,reviewer)).handoff;assert.equal(handoff.quoteVersion,q.version);assert.equal(handoff.quoteNo,q.quoteNo);assert.equal(handoff.customerCode,account.customerCode);assert.deepEqual(handoff.models,q.lines.map(l=>l.model));assert.equal((await ok('ie-quote-handoff',push,engineer)).handoff.id,handoff.id);
 assert.equal((await call('ie-quote-handoff',{...push,recipientMemberIds:[salesMember.id]},engineer)).status,409);
 assert.equal(rawRecords().filter(r=>r.kind==='ie_quote_sales_handoff'&&r.quoteId===q.id).length,1);assert.deepEqual(rawRecords().filter(r=>['customer_quote','ie_quote_notification_delivery'].includes(r.kind)).map(r=>JSON.stringify(r)),beforeSales);
 const sourceStored=rawRecords().find(r=>r.id===handoff.id).sourceSnapshot,releaseStored=rawRecords().find(r=>r.kind==='ie_quote_revision'&&r.quoteId===q.id&&r.version===q.version).snapshot;assert.deepEqual(sourceStored,releaseStored);
 assert.equal((await ok('ie-quote-handoffs',undefined,business)).handoffs.find(h=>h.id===handoff.id).canAccept,true);assert.equal((await call('ie-quote-handoff?id='+handoff.id,undefined,intruder)).status,403);assert(!(await ok('ie-quote-handoffs')).handoffs.some(h=>h.id===handoff.id),'global admin alone is not a responsible recipient');
 assert.equal((await ok('ie-quote-handoff?id='+handoff.id,undefined,businessAdmin)).quote.costs.lines[0].material,q.costs.lines[0].material);
 pass('已复核下推只选既有负责报价/业务人员，显式负责管理员可接收；全局管理员不自动成为候选，重复下推保留唯一完整快照且不动客价或邮件');
 assert.equal((await call('ie-quote-handoff-accept',{id:handoff.id,version:handoff.version},engineer)).status,403);
 rawUpdate(lostScope);assert.equal((await call('ie-quote-handoff-accept',{id:handoff.id,version:handoff.version},business)).status,403);rawUpdate(account);
 q=(await ok('ie-quote-revise',{id:q.id,version:q.version},engineer)).quote;assert.equal((await ok('ie-quote-handoff?id='+handoff.id,undefined,business)).handoff.stale,false);
 handoff=(await ok('ie-quote-handoff-accept',{id:handoff.id,version:handoff.version},business)).handoff;assert.equal(handoff.acceptedBy.length,1);assert.equal((await ok('ie-quote-handoff-accept',{id:handoff.id,version:1},business)).handoff.version,handoff.version);
 assert.equal((await call('ie-quote-handoff-accept',{id:handoff.id,version:1},businessAdmin)).status,409);
 q=(await ok('ie-quote-submit',{id:q.id,version:q.version},engineer)).quote;q=(await ok('ie-quote-review',{id:q.id,version:q.version,decision:'approve',reason:'发布新版本'},reviewer)).quote;
 assert.equal((await ok('ie-quote-handoff?id='+handoff.id,undefined,businessAdmin)).handoff.stale,true);assert.equal((await call('ie-quote-handoff-accept',{id:handoff.id,version:handoff.version},businessAdmin)).status,409);assert.equal((await call('ie-quote-handoff',push,engineer)).status,403);
 const next=(await ok('ie-quote-handoff',{id:q.id,version:q.version,recipientMemberIds:[salesMember.id]},engineer)).handoff;assert.notEqual(next.id,handoff.id);
 assert.deepEqual(rawRecords().find(r=>r.id===handoff.id).sourceSnapshot,releaseStored);assert.equal((await ok('ie-quote?id='+released.id+'&version='+released.version,undefined,engineer)).quote.attachments.length,released.attachments.length);
 pass('业务接收按当前责任重验并留痕，重复接收幂等；新草稿不影响已发布依据，新发布使旧下推过期但原快照保留');
 const twoLines=structuredClone(seed);twoLines.quoteNo='IE-FILES-DELETED-LINE';twoLines.lines.push({...structuredClone(twoLines.lines[0]),id:'other-line',model:'OTHER-LINE'});let deleted=(await ok('ie-quote-save',twoLines,engineer)).quote;deleted=(await ok('ie-quote-attachment-upload',form(deleted),engineer)).quote;const beforeDelete=structuredClone(deleted),del=fields(deleted);del.lines.shift();del.tooling=[];deleted=(await ok('ie-quote-save',del,engineer)).quote;assert.deepEqual(deleted.attachments,[]);assert.equal((await getFile(beforeDelete,beforeDelete.attachments[0])).status,200);
 const substitute=(await ok('ie-quote-attachment-upload',form(other),reviewer)).quote;let pending=(await ok('ie-quote-submit',{id:substitute.id,version:substitute.version},engineer)).quote;assert.equal(pending.requiredReviewMemberId,member('synthetic-manager').id);assert.equal((await call('ie-quote-review',{id:pending.id,version:pending.version,decision:'approve',reason:''},reviewer)).status,403);await ok('ie-quote-review',{id:pending.id,version:pending.version,decision:'approve',reason:'替补附件参与须独立复核'},manager);
 const audit=(await ok('data',undefined,intruder)).audit||[];assert(!JSON.stringify(audit).includes('ie_quote_attachment_file'));assert(!audit.some(a=>a.targetId===handoff.id||a.targetId===first.id));
 pass('删除款式仅移除当前引用；替补上传附件计入实际填报参与人并转总经理复核，附件及下推审计不经普通总览泄漏');
 // Model a pre-existing v2 draft, including its immutable earlier revision.
 const legacy={...structuredClone(rawRecords().find(r=>r.id===other.id)),id:'ie_files_legacy_v2',quoteNo:'IE-LEGACY-V2',version:1,status:'draft',attachmentRefs:[],costs:{...other.costs,formulaVersion:'ie-cost-v2-line-loss'}};legacy.lines[0].materials[0].basePrice=.123456;legacy.lines[0].materials[0].usage=1;legacy.lines[0].materials[0].coefficient=1;rawInsert(legacy);const legacyRev={id:'ie_files_legacy_v2_rev',kind:'ie_quote_revision',quoteId:legacy.id,version:1,revision:legacy.revision,action:'合成历史v2',updatedAt:at,updatedBy:'synthetic',snapshot:structuredClone(legacy)};rawInsert(legacyRev);
 const initialLegacy=JSON.stringify(legacyRev);let view=(await ok('ie-quote?id='+legacy.id,undefined,engineer)).quote;assert.equal(view.costs.lines[0].material,.123456);view=(await ok('ie-quote-attachment-upload',form(view),engineer)).quote;assert.equal(view.costs.formulaVersion,'ie-cost-v2-line-loss');assert.equal(view.costs.lines[0].material,.123456);
 view=(await ok('ie-quote-save',fields(view),engineer)).quote;assert.equal(view.costs.formulaVersion,'ie-cost-v3-excel');assert.equal(view.costs.lines[0].material,.12);const old=(await ok('ie-quote?id='+legacy.id+'&version=1',undefined,engineer)).quote;assert.equal(old.costs.formulaVersion,'ie-cost-v2-line-loss');assert.equal(old.costs.lines[0].material,.123456);assert.equal(JSON.stringify(rawRecords().find(r=>r.id===legacyRev.id)),initialLegacy);
 pass('旧v2附件操作不升级计算；普通保存新v3按分位计价，历史v2快照及六位金额完全保持');
}
