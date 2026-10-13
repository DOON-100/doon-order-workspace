import assert from 'node:assert/strict';

// Synthetic records only: exercise persisted assignments and the real attachment API.
export async function runServiceTeamAssignmentCases({ok,call,state,pass,rawRecords,rawUpdate}){
 const users={};
 for(const [key,role] of [['follow','clerk'],['review','clerk'],['sales','sales'],['outsider','sales'],['finance','finance']]){
  const user={userId:'service_team_'+key,email:'service-team-'+key+'@test.invalid',displayName:'合成客服分组-'+key,fullName:'合成客服分组-'+key};
  await ok('member',{name:user.displayName,email:user.email,role,customers:[],active:true});
  await ok('enroll',{},user);users[key]=user;
 }
 const members=(await state()).members,mid=key=>members.find(m=>m.email===users[key].email).id;
 const customer=(await ok('customer-save',{customer:'合成客服分组客户',customerCode:'SYN-SERVICE-TEAM',salesName:users.sales.displayName,serviceName:users.follow.displayName,salesMemberIds:[mid('sales')],serviceMemberIds:[mid('follow'),mid('review'),mid('finance')],active:true})).item;
 const privateCustomer=(await ok('customer-save',{customer:'合成组内未授权客户',customerCode:'SYN-SERVICE-PRIVATE',salesName:users.outsider.displayName,serviceName:'',active:true})).item;
 const team=(await ok('customer-project-team-save',{token:crypto.randomUUID(),name:'合成客服协作一组',leaderIds:[mid('sales')],salesMemberIds:[mid('sales'),mid('outsider')],serviceMemberIds:[mid('follow'),mid('review'),mid('finance')],customerIds:[customer.id,privateCustomer.id],active:true})).item;
 const otherTeam=(await ok('customer-project-team-save',{token:crypto.randomUUID(),name:'合成客服协作二组',leaderIds:[mid('outsider')],salesMemberIds:[mid('outsider')],serviceMemberIds:[],customerIds:[privateCustomer.id],active:true})).item;
 const base={type:'followup',customerId:customer.id,orderId:'',title:'合成参考图跟进',description:'核对客户参考图片',status:'open',waitingFor:'none',dueDate:'',nextFollowUp:'2026-10-20',details:{category:'图纸'}};
 const assignment={teamId:team.id,ownerId:mid('follow'),serviceReviewerId:mid('review'),salesReviewerId:mid('sales')};
 const list=()=>ok('service-data',undefined,users.follow),current=id=>rawRecords().find(r=>r.id===id);
 const deny=async(action,body,user=users.follow)=>{
  const before=structuredClone(rawRecords()),response=await call(action,body,user);
  assert([400,403,409,415].includes(response.status),`${action} should reject: ${response.status} ${await response.text()}`);
  assert.deepEqual(rawRecords(),before,'Rejected writes must not change records');
 };
 const catalog=await list(),visibleTeam=catalog.teams.find(t=>t.id===team.id);
 assert(visibleTeam);assert.deepEqual(visibleTeam.customerIds,[customer.id]);
 assert(!catalog.teams.some(t=>t.id===otherTeam.id));
 const choices=catalog.assignmentOptions.find(v=>v.customerId===customer.id&&v.teamId===team.id);
 assert(choices.ownerIds.includes(mid('follow')));assert(choices.serviceReviewerIds.includes(mid('review')));assert(choices.salesReviewerIds.includes(mid('sales')));
 for(const ids of [choices.ownerIds,choices.serviceReviewerIds,choices.salesReviewerIds]){assert(!ids.includes(mid('outsider')));assert(!ids.includes(mid('finance')));}
 assert(!choices.ownerIds.includes(mid('sales')));assert(!choices.salesReviewerIds.includes(mid('follow')));
 pass('客服分组复用既有组，客户和人员按授权裁剪；客服跟进与业务审核候选遵守组内职责');

 let record=(await ok('service-save',{...base,...assignment},users.follow)).record;
 for(const [key,value] of Object.entries(assignment))assert.equal(record[key],value);
 assert((await list()).records.some(r=>r.id===record.id&&r.teamId===team.id));
 for(const patch of [{teamId:otherTeam.id},{ownerId:mid('outsider')},{ownerId:mid('sales')},{salesReviewerId:mid('review')},{serviceReviewerId:mid('follow')},{ownerId:mid('finance')}])await deny('service-save',{...base,...assignment,...patch});
 await deny('service-save',{...base,...assignment},users.outsider);
 await deny('service-save',{...base,...assignment,id:record.id,version:record.version+1});
 // Older clients omit all new fields; they must not erase previously saved routing.
 record=(await ok('service-save',{...base,id:record.id,version:record.version,description:'旧客户端修改说明'},users.follow)).record;
 for(const [key,value] of Object.entries(assignment))assert.equal(record[key],value);
 const history=(await ok('service-history?id='+record.id,undefined,users.follow)).history;
 assert(history.some(h=>h.snapshot.teamId===team.id&&h.snapshot.serviceReviewerId===mid('review')));
 const legacy=(await ok('service-save',{...base,title:'合成历史无组记录'},users.follow)).record;
 assert(!legacy.teamId&&!legacy.ownerId);
 pass('三类负责人保存及历史读取完整，拒绝错组、越权、自审和过期覆盖；旧客户端不会清空已分派人员');

 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
 const uploadForm=(name,bytes,category='reference-image')=>{const form=new FormData();form.set('recordId',record.id);form.set('version',String(current(record.id).version));form.set('category',category);form.set('file',new File([bytes],name));form.set('note','合成参考图');return form;};
 const uploaded=await ok('service-attachment',uploadForm('reference.png',png),users.follow);
 assert.equal(uploaded.attachment.category,'reference-image');assert.equal(uploaded.attachment.contentType,'image/png');
 const retry=await ok('service-attachment',uploadForm('reference.png',png),users.follow);assert.equal(retry.attachment.id,uploaded.attachment.id);
 const general=await ok('service-attachment',uploadForm('reference.png',png,'general'),users.follow);assert.notEqual(general.attachment.id,uploaded.attachment.id);
 const preview=await call('service-file?id='+uploaded.attachment.id+'&preview=1',undefined,users.follow);
 assert.equal(preview.status,200);assert.match(preview.headers.get('Content-Disposition'),/^inline/);assert.equal(preview.headers.get('Cache-Control'),'no-store');assert.equal(preview.headers.get('Content-Type'),'image/png');assert.deepEqual(Buffer.from(await preview.arrayBuffer()),png);
 const download=await call('service-file?id='+uploaded.attachment.id,undefined,users.follow);assert.match(download.headers.get('Content-Disposition'),/^attachment/);
 await deny('service-attachment',uploadForm('fake.png',Buffer.from('<html>fake image</html>')));
 await deny('service-attachment',uploadForm('mismatch.jpg',png));
 await deny('service-attachment',uploadForm('reference.pdf',Buffer.from('%PDF-1.4')));
 await deny('service-file?id='+uploaded.attachment.id+'&preview=1',undefined,users.outsider);
 const legacyFake=await ok('service-attachment',uploadForm('legacy.png',Buffer.from('legacy invalid image'),'general'),users.follow);
 const invalidPreview=await call('service-file?id='+legacyFake.attachment.id+'&preview=1',undefined,users.follow);assert.notEqual(invalidPreview.status,200);
 pass('参考图上传、分类幂等、鉴权预览及下载通过；伪图片和扩展名不符被拒绝，普通附件不能绕过图片校验');

 const reviewer=current(mid('review'));rawUpdate({...reviewer,active:false});
 const latest=current(record.id);
 record=(await ok('service-save',{...base,...assignment,id:latest.id,version:latest.version,description:'保留历史停用人员并继续跟进'},users.follow)).record;
 assert.equal(record.serviceReviewerId,mid('review'));
 await deny('service-save',{...base,...assignment,title:'不能新增分派停用人员'});
 rawUpdate(reviewer);
 const customerNow=current(customer.id);rawUpdate({...customerNow,serviceName:'',serviceMemberIds:[mid('review')],serviceOwnerId:''});
 assert(!(await list()).records.some(r=>r.id===record.id));
 await deny('service-file?id='+uploaded.attachment.id+'&preview=1',undefined,users.follow);
 rawUpdate(customerNow);
 pass('历史停用人员保留且禁止新增分派；收回客户责任后记录和参考图预览一并失去访问权');
}
