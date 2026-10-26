import assert from 'node:assert/strict';

export async function testMemberNotificationMailboxes({ok,call,pass,rawRecords,rawInsert}){
 const prefix='mailbox_scope_',make=(id,role='viewer',active=true)=>({id:prefix+id,kind:'member',userId:prefix+id,email:id+'@doon.local',name:'合成通知成员 '+id,role,active,customers:[],departments:[],orderScope:role==='production'?'all':'assigned',createdAt:'2026-10-01'});
 const a=make('a'),b=make('b','production'),inactive=make('inactive','viewer',false),supplier=make('supplier','supplier'),legacy=make('legacy');
 for(const member of [a,b,inactive,supplier,legacy])rawInsert(member);
 const originalMembers=rawRecords().filter(r=>r.kind==='member'),user=m=>({userId:m.userId,email:m.email,displayName:m.name,fullName:m.name}),body=(memberId,email,expectedVersion)=>({memberId,email,expectedVersion,confirmed:true});
 assert.equal((await call('member-notification-mailboxes',undefined,user(a))).status,403);
 assert.equal((await call('member-notification-mailbox',body(a.id,'a@synthetic.example.com',0),user(a))).status,403);
 let list=await ok('member-notification-mailboxes');assert.equal(list.canConfigure,true);assert(list.mailboxes.some(v=>v.memberId===inactive.id&&v.email===''&&v.version===0));assert(!list.mailboxes.some(v=>v.memberId===supplier.id));
 assert.equal((await call('member-notification-mailbox',body(supplier.id,'supplier@synthetic.example.com',0))).status,400);
 assert.equal((await call('member-notification-mailbox',body('missing-member','a@synthetic.example.com',0))).status,400);
 for(const email of ['bad','a@doon.local','a@invalid','a@x.invalid','a@localhost','a@x.test','a@synthetic.example.com\r\nBcc: other@synthetic.example.com'])assert.equal((await call('member-notification-mailbox',body(a.id,email,0))).status,400);
 assert.equal((await call('member-notification-mailbox',{...body(a.id,'a@synthetic.example.com',0),role:'admin'})).status,400);
 let mailbox=(await ok('member-notification-mailbox',body(a.id,'  A@Synthetic.Example.Com  ',0))).mailbox;assert.equal(mailbox.email,'a@synthetic.example.com');assert.equal(mailbox.version,1);assert.equal(mailbox.confirmed,true);
 assert.equal((await call('member-notification-mailbox',body(b.id,'A@SYNTHETIC.EXAMPLE.COM',0))).status,409);
 assert.equal((await call('member-notification-mailbox',body(a.id,'stale@synthetic.example.com',0))).status,409);
 mailbox=(await ok('ie-quote-notification-mailbox',body(a.id,'alias@synthetic.example.com',1))).mailbox;assert.equal(mailbox.version,2);
 list=await ok('member-notification-mailboxes');assert.equal(list.mailboxes.find(v=>v.memberId===a.id).email,mailbox.email);
 assert.equal(rawRecords().filter(r=>['member_notification_mailbox','ie_quote_notification_mailbox'].includes(r.kind)&&r.memberId===a.id).length,1);
 mailbox=(await ok('member-notification-mailbox',body(a.id,'',2))).mailbox;assert.equal(mailbox.email,'');assert.equal(mailbox.confirmed,false);assert.equal(mailbox.version,3);
 const race=await Promise.all([call('member-notification-mailbox',body(a.id,'race-one@synthetic.example.com',3)),call('member-notification-mailbox',body(a.id,'race-two@synthetic.example.com',3))]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
 await ok('member-notification-mailbox',body(inactive.id,'inactive@synthetic.example.com',0));
 assert.deepEqual(rawRecords().filter(r=>r.kind==='member'),originalMembers,'通知邮箱不得改变登录邮箱、密码关联、身份或业务权限');
 const productionView=await ok('data',undefined,user(b));assert(!JSON.stringify(productionView.audits).includes('synthetic.example.com'));assert(!productionView.members.some(v=>'notificationEmail' in v));
 pass('成员通知邮箱由管理员按稳定成员ID维护，可清空且并发版本冲突受控；校验真实地址与唯一对应，不改变登录身份或权限，也不泄露到普通审计');
 const legacyRecord={id:prefix+'legacy_mailbox',kind:'ie_quote_notification_mailbox',memberId:legacy.id,email:'legacy@synthetic.example.com',version:2,confirmed:true,updatedAt:'2026-10-01',updatedBy:'合成旧记录'};rawInsert(legacyRecord);
 assert.equal((await ok('member-notification-mailboxes')).mailboxes.find(v=>v.memberId===legacy.id).version,2);
 await ok('member-notification-mailbox',body(legacy.id,'legacy-updated@synthetic.example.com',2));
 const legacyRows=rawRecords().filter(r=>['member_notification_mailbox','ie_quote_notification_mailbox'].includes(r.kind)&&r.memberId===legacy.id);assert.equal(legacyRows.length,1);assert.equal(legacyRows[0].id,legacyRecord.id);assert.equal(legacyRows[0].kind,legacyRecord.kind);assert.equal(legacyRows[0].version,3);
 rawInsert({...legacyRecord,id:prefix+'corrupt_duplicate',kind:'member_notification_mailbox'});assert.equal((await call('member-notification-mailbox',body(legacy.id,'blocked@synthetic.example.com',3))).status,409);
 pass('成员与权限和IE邮箱入口共用一个解析与保存来源；既有IE邮箱原ID保留、不复制，不明确的重复记录阻止覆盖');
}
