import assert from 'node:assert/strict';

export async function testEngineeringDrawings({ok,call,state,pass,rawRecords,rawInsert}){
 const token=()=>crypto.randomUUID(),users={},members={};
 for(const [name,role,departments] of [['engineer','clerk',['engineering']],['reviewer','clerk',['engineering_review']],['upstream','sales',[]],['outsider','sales',[]],['pmc','pmc',[]],['sameName','sales',[]],['viewer','viewer',[]]]){
  users[name]={userId:'drawing_user_'+name,email:'drawing_'+name+'@test.invalid',displayName:name,fullName:name};
  members[name]={id:'drawing_member_'+name,kind:'member',userId:users[name].userId,email:users[name].email,name:name==='sameName'?'upstream':name,role,customers:[],departments,active:true,createdAt:'2026-10-13T00:00:00Z'};
  rawInsert(members[name]);
 }
 const customer={id:'drawing_customer_a',kind:'customer_account',customer:'合成工程客户',customerCode:'SYN-DRAW-A',salesName:'upstream',serviceName:'',pmcName:'',salesMemberIds:[members.upstream.id],serviceMemberIds:[],active:true,notes:'',version:1,createdAt:'2026-10-13T00:00:00Z',updatedAt:'2026-10-13T00:00:00Z',updatedBy:'test'};
 rawInsert(customer);rawInsert({...customer,id:'drawing_customer_b',customer:'合成其他工程客户',customerCode:'SYN-DRAW-B',salesMemberIds:[members.outsider.id]});
 const payload={token:token(),customerId:customer.id,customerCode:customer.customerCode,drawingType:'新款',requestedDate:'2026-10-13',newCount:2,revisionCount:null,requester:'合成业务',upstreamDepartment:'业务部',priority:'普通',requirement:'两款钛架，合成测试，不含真实业务'};
 const save=async(fields,user=users.engineer)=>(await ok('drawing-save',fields,user)).record;
 const get=async(id,user=users.engineer)=>(await ok('drawing-data',undefined,user)).records.find(r=>r.id===id);
 const denied=async(action,body,user,status=403)=>assert.equal((await call(action,body,user)).status,status,`${action} should be ${status}`);
 await denied('drawing-data',undefined,null,401);
 let record=await save(payload,users.upstream);assert.equal(record.status,'待分配');assert.equal(record.revisionCount,null);
 assert.equal((await save(payload,users.upstream)).id,record.id);await denied('drawing-save',{...payload,newCount:3},users.upstream,409);
 assert(!(await ok('drawing-data',undefined,users.sameName)).records.some(r=>r.id===record.id));
 for(const name of ['outsider','pmc','viewer']){assert(!(await ok('drawing-data',undefined,users[name])).records.some(r=>r.id===record.id));await denied('drawing-history?id='+record.id,undefined,users[name]);}
 await denied('drawing-save',{...payload,token:token()},users.outsider);await denied('drawing-save',{...payload,token:token()},users.viewer);
 await denied('drawing-save',{id:record.id,version:record.version,status:'画图中'},users.upstream);
 await denied('drawing-review',{id:record.id,version:record.version,approval:'通过',note:'越权'},users.engineer);
 pass('工程需求按明确客户责任开放，上游和工程执行/审图隔离，名称与PMC总表权限不会扩权');

 const revisionOne=rawRecords().find(r=>r.kind==='engineering_drawing_revision'&&r.recordId===record.id&&r.version===1),beforeSnapshot=structuredClone(revisionOne);
 record=await save({id:record.id,version:record.version,status:'画图中',assigneeId:members.engineer.id,deadline:'2026-10-20'},users.engineer);
 assert.equal(record.assignee,'engineer');await denied('drawing-save',{id:record.id,version:1,requirement:'覆盖旧版'},users.upstream,409);
 const race=await Promise.all([call('drawing-save',{id:record.id,version:record.version,drawingNotes:'合成 A'},users.engineer),call('drawing-save',{id:record.id,version:record.version,drawingNotes:'合成 B'},users.engineer)]);
 assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);record=await get(record.id);
 assert.deepEqual(rawRecords().find(r=>r.id===revisionOne.id),beforeSnapshot);
 const currentFields=Object.fromEntries(['customerId','customerCode','drawingType','requestedDate','newCount','revisionCount','requester','modelNo','drawingNotes','assigneeId','assignee','deadline','completedDate','approval','status','upstreamDepartment','priority','requirement','downstream','deliveredDate','deliveryNote'].map(k=>[k,record[k]]));
 record=await save({...currentFields,id:record.id,version:record.version,requirement:'合成上游补充'},users.upstream);
 assert(record.drawingNotes.startsWith('合成'));assert.equal(record.status,'画图中');
 pass('工程记录严格版本防覆盖、并发原子提交与不可变历史；上游完整表单回传不会越权改写执行字段');

 await denied('drawing-save',{id:record.id,version:record.version,status:'待审核'},users.engineer,400);
 await denied('drawing-save',{id:record.id,version:record.version,status:'已完成',completedDate:'2026-10-14',modelNo:'SYN-DRAW-01'},users.engineer,400);
 record=await save({id:record.id,version:record.version,status:'待审核',completedDate:'2026-10-14',modelNo:'SYN-DRAW-01'},users.engineer);
 record=(await ok('drawing-review',{id:record.id,version:record.version,approval:'通过',note:'合成尺寸与需求审核通过'},users.reviewer)).record;
 assert.equal(record.status,'已完成');assert.equal(record.approvalBy,members.reviewer.id);
 await denied('drawing-save',{id:record.id,version:record.version,status:'已交接'},users.engineer,400);
 record=await save({id:record.id,version:record.version,status:'已交接',deliveredDate:'2026-10-15',downstream:'客服部',deliveryNote:'合成图纸 V1 交回客服'},users.engineer);
 assert.equal(record.status,'已交接');
 record=await save({id:record.id,version:record.version,drawingNotes:'设计变更，须重新审图'},users.engineer);assert.equal(record.approval,'待审核');assert.equal(record.status,'待审核');assert.equal(record.deliveredDate,'');
 pass('工程送审、完成与交接有独立校验；已审批内容变更自动重新送审并撤销旧交接日期');

 const mail={messageId:'<synthetic-001@test.invalid>',itemKey:'request-1',threadId:'synthetic-thread-a',sender:'sender@test.invalid',subject:'合成新画图需求',receivedAt:'2026-10-13T09:00:00+08:00',request:{...payload}};delete mail.request.token;
 const mailBefore=rawRecords().filter(r=>r.kind==='engineering_drawing').length;
 const first=await ok('drawing-email-intake',mail,users.engineer),again=await ok('drawing-email-intake',mail,users.engineer);assert.equal(first.record.id,again.record.id);assert(again.idempotent);
 assert.equal(rawRecords().filter(r=>r.kind==='engineering_drawing').length,mailBefore+1);
 await denied('drawing-email-intake',{...mail,subject:'同messageId不同内容'},users.engineer,409);
 await denied('drawing-email-intake',{...mail,messageId:'other'},users.upstream);
 await denied('drawing-email-intake',{...mail,messageId:'<bad-unknown@test.invalid>',request:{...mail.request,customerId:''}},users.engineer,400);
 const concurrentMail={...mail,messageId:'<race@test.invalid>'},concurrent=await Promise.all([call('drawing-email-intake',concurrentMail,users.engineer),call('drawing-email-intake',concurrentMail,users.engineer)]);
 assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);await ok('drawing-email-intake',concurrentMail,users.engineer);
 assert.equal(rawRecords().filter(r=>r.kind==='engineering_drawing_event'&&r.messageId===concurrentMail.messageId).length,1);
 let mailRecord=await save({id:first.record.id,version:first.record.version,status:'画图中',modelNo:'SYN-PRESERVE',drawingNotes:'人工备注保留',assigneeId:members.engineer.id},users.engineer);
 const change={...mail,messageId:'<synthetic-change@test.invalid>',recordId:mailRecord.id,request:{...mail.request,requirement:'客户在原线程提出第二版'}};
 const pending=await ok('drawing-email-intake',change,users.engineer);assert.equal(pending.event.status,'pending');assert.equal(pending.record.modelNo,'SYN-PRESERVE');assert.equal(pending.record.drawingNotes,'人工备注保留');assert.equal(pending.record.requirement,mailRecord.requirement);
 mailRecord=await save({id:mailRecord.id,version:pending.record.version,status:'待审核',completedDate:'2026-10-14'},users.engineer);
 await denied('drawing-review',{id:mailRecord.id,version:mailRecord.version,approval:'通过',note:'未处理变更'},users.reviewer,409);
 const decision={eventId:pending.event.id,recordId:mailRecord.id,version:mailRecord.version,decision:'accepted',note:'已核对待另行修改需求字段'};
 await denied('drawing-event-review',decision,users.upstream);
 mailRecord=(await ok('drawing-event-review',decision,users.engineer)).record;assert.equal(mailRecord.requirement,mail.request.requirement);assert.equal(mailRecord.status,'画图中');assert.equal(mailRecord.approval,'待审核');
 await denied('drawing-review',{id:mailRecord.id,version:mailRecord.version,approval:'通过',note:'采纳后未重新送审'},users.reviewer,400);
 assert.equal(rawRecords().filter(r=>r.kind==='engineering_drawing_event_decision'&&r.eventId===pending.event.id).length,1);
 await denied('drawing-event-review',{...decision,version:mailRecord.version},users.engineer,409);
 mailRecord=await save({id:mailRecord.id,version:mailRecord.version,status:'待审核'},users.engineer);
 mailRecord=(await ok('drawing-review',{id:mailRecord.id,version:mailRecord.version,approval:'通过',note:'重新送审核对完成'},users.reviewer)).record;
 const completedChange=await ok('drawing-email-intake',{...change,messageId:'<completed-change@test.invalid>'},users.engineer);
 mailRecord=(await ok('drawing-event-review',{eventId:completedChange.event.id,recordId:mailRecord.id,version:completedChange.record.version,decision:'accepted',note:'已完成后客人追加变更'},users.engineer)).record;
 assert.equal(mailRecord.status,'画图中');assert.equal(mailRecord.approval,'待审核');assert.equal(mailRecord.approvalBy,'');
 mailRecord=await save({id:mailRecord.id,version:mailRecord.version,status:'已取消'},users.engineer);
 const cancelledChange=await ok('drawing-email-intake',{...change,messageId:'<cancelled-change@test.invalid>'},users.engineer);
 await denied('drawing-event-review',{eventId:cancelledChange.event.id,recordId:mailRecord.id,version:cancelledChange.record.version,decision:'accepted',note:'已取消不得自动恢复'},users.engineer,409);
 // No implicit thread matching: a new item without an explicit record id is a new demand.
 const separate=await ok('drawing-email-intake',{...mail,messageId:'<same-thread-new@test.invalid>'},users.engineer);assert.notEqual(separate.record.id,first.record.id);
 pass('授权邮件接入按messageId与itemKey幂等；同键异文和并发冲突不写入；变更只入待核对事件且不覆盖人工内容');

 const detailRecord=await save({...payload,token:token()},users.upstream);
 let detailed=(await ok('drawing-detail-add',{recordId:detailRecord.id,version:detailRecord.version,modelNo:'SYN-DETAIL',requirement:'合成单款补充',note:'第二条明细'},users.upstream)).record;
 assert.equal((await ok('drawing-history?id='+detailed.id,undefined,users.upstream)).details.length,1);
 const rawColumns={'状态':'✅已完成','客户编号':'SYN-HISTORY','画图类型':'新款','需求发出时间':'2026-10-10','新款数量':'','改图数量':2,'需求者':'合成历史业务','款号':'','画图备注':'合成原备注','画图人员':'','截止日期':'2026-10-20','完成日期':'2026-10-12','老郑审批确认':'✅'};
 const imported={format:'doon-engineering-drawing-import-v1',source:{filename:'合成工程原表.xlsx',sheet:'合成历史',sha256:'d'.repeat(64)},rows:[{sourceRow:2,rawColumns,customerCode:'SYN-HISTORY',drawingType:'新款',requestedDate:'2026-10-10',requester:'合成历史业务',newCount:null,revisionCount:2,completedDate:'2026-10-12'},{sourceRow:3,rawColumns:{...rawColumns,状态:'🔋',老郑审批确认:''},customerCode:'SYN-HISTORY',drawingType:'新款',requestedDate:'2026-10-10',requester:'合成历史业务'}]};
 assert.equal((await ok('drawing-import',imported)).imported,2);assert.equal((await ok('drawing-import',imported)).skipped,2);
 const historyRecords=rawRecords().filter(r=>r.kind==='engineering_drawing'&&r.source?.hash==='d'.repeat(64));assert.equal(historyRecords.length,2);
 assert.equal(historyRecords[0].status,'已完成');assert.equal(historyRecords[0].approval,'通过');assert.equal(historyRecords[0].newCount,null);assert.equal(historyRecords[1].status,'历史待核对');assert.deepEqual(historyRecords[0].source.rawColumns,rawColumns);
 for(const name of ['upstream','reviewer','pmc'])assert(!(await ok('drawing-data',undefined,users[name])).records.some(r=>historyRecords.some(h=>h.id===r.id)));
 assert((await ok('drawing-data',undefined,users.engineer)).records.some(r=>r.id===historyRecords[0].id));
 await denied('drawing-import',imported,users.engineer);assert.equal((await call('drawing-delete',{id:record.id},users.engineer)).status,404);
 const engineerData=await ok('data',undefined,users.engineer);assert.equal(engineerData.orders.length,0);
 const pmcAudits=(await ok('data',undefined,users.pmc)).audits;assert(!pmcAudits.some(a=>[a.before,a.after].some(v=>v?.kind?.startsWith('engineering_drawing'))));
 pass('原表13列及空数量保留、历史来源行幂等；未知客户历史仅工程/管理员可见；部门授权与生产审计无信息泄漏');
}
