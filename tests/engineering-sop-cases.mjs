import assert from 'node:assert/strict';

export async function testEngineeringSop({ok,call,pass,rawRecords,rawInsert}){
 const token=()=>crypto.randomUUID(),today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}),users={},members={};
 for(const [name,role,departments] of [['upload','clerk',['engineering','engineering_review']],['review','clerk',['engineering_review']],['business','sales',[]],['outside','sales',[]],['pmc','pmc',[]]]){
  users[name]={userId:'sop_user_'+name,email:'sop_'+name+'@test.invalid',displayName:'SOP '+name,fullName:'SOP '+name};members[name]={id:'sop_member_'+name,kind:'member',userId:users[name].userId,email:users[name].email,name:users[name].displayName,role,departments,active:true,customers:[],createdAt:new Date().toISOString()};rawInsert(members[name]);
 }
 const customer={id:'sop_customer',kind:'customer_account',customer:'合成SOP客户',customerCode:'SYN-SOP',active:true,salesName:'SOP business',serviceName:'',pmcName:'',salesMemberIds:[members.business.id],serviceMemberIds:[],notes:'',version:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),updatedBy:'test'};rawInsert(customer);
 const other={...customer,id:'sop_other_customer',customer:'合成其他SOP客户',customerCode:'SYN-SOP-OTHER',salesMemberIds:[members.outside.id]};rawInsert(other);
 const demand={customerId:customer.id,customerCode:customer.customerCode,drawingType:'新款',requestedDate:today,newCount:1,revisionCount:null,requester:'合成需求者',requirement:'SOP测试需求',token:token()};
 let drawing=(await ok('drawing-save',demand,users.business)).record;
 const otherDrawing=(await ok('drawing-save',{...demand,token:token(),customerId:other.id,customerCode:other.customerCode},users.outside)).record;
 const denied=async(action,body,user,status=403)=>assert.equal((await call(action,body,user)).status,status,action+' should fail '+status);
 const latest=async(id,user=users.upload)=>(await ok('sop-data',undefined,user)).records.find(r=>r.id===id);
 const create={drawingRecordId:drawing.id,modelNo:'SYN-SOP-01',targetVersion:'V2',requirement:'客户要求改图，请同步新版本SOP',token:token()};
 let sop=(await ok('sop-change',create,users.business)).record;assert.equal(sop.status,'待更新SOP');assert.equal(sop.targetVersion,'V2');assert.equal((await ok('sop-change',create,users.business)).record.id,sop.id);
 await denied('sop-change',{...create,targetVersion:'V3'},users.business,409);await denied('sop-change',{...create,token:token()},users.outside);await denied('sop-change',{...create,token:token()},users.upload);
 for(const user of [users.outside,users.pmc]){assert(!(await ok('sop-data',undefined,user)).records.some(r=>r.id===sop.id));await denied('sop-history?id='+sop.id,undefined,user);}
 await denied('sop-data',undefined,null,401);
 pass('SOP改图指令按明确客户责任授权且token幂等，工程部门权限不能冒充业务发令');

 async function upload(id,purpose,user=users.upload,name='synthetic.pdf',bytes='%PDF-1.7\nSynthetic private fixture\n%%EOF'){
  const form=new FormData();form.set('sopId',id);form.set('purpose',purpose);form.set('file',new File([bytes],name));return ok('sop-attachment',form,user);
 }
 const firstRevision=structuredClone(rawRecords().find(r=>r.kind==='engineering_sop_revision'&&r.sopId===sop.id));
 const sopFile=(await upload(sop.id,'sop')).attachment;assert(!('fileKey' in sopFile));assert.equal((await latest(sop.id)).version,sop.version);assert.equal((await latest(sop.id)).status,'待更新SOP');
 assert.equal((await call('sop-file?id='+sopFile.id,undefined,users.business)).status,200);await denied('sop-file?id='+sopFile.id,undefined,users.outside);await denied('sop-file?id='+sopFile.id,undefined,users.pmc);
 const badForm=new FormData();badForm.set('sopId',sop.id);badForm.set('purpose','sop');badForm.set('file',new File(['<script>bad</script>'],'bad.pdf'));await denied('sop-attachment',badForm,users.upload,400);await denied('sop-attachment',badForm,users.business);
 await denied('sop-prepare',{id:sop.id,version:sop.version,fileId:sopFile.id,preparedVersion:'V1',note:''},users.upload,400);
 await denied('sop-confirm',{id:sop.id,version:sop.version,decision:'confirm',note:'只有附件不能确认MES'},users.review,400);
 sop=(await ok('sop-prepare',{id:sop.id,version:sop.version,fileId:sopFile.id,preparedVersion:'V2',note:'目标文件准备完成'},users.upload)).record;
 assert.equal(sop.status,'待上传MES');assert.equal(sop.latestUploadId,'');
 pass('SOP附件有真实文件格式校验和客户鉴权，本地存档不会被当成MES上传，准备版本须精确匹配');

 const evidence=(await upload(sop.id,'mes_evidence',users.upload,'proof.png',Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0]))).attachment;
 const submission={id:sop.id,version:sop.version,uploadedVersion:'V2',uploadedAt:today,mesReference:'SYN-MES-RECORD-2',mesUrl:'https://mes.test.invalid/sop/SYN-MES-RECORD-2',actualUploader:'合成实际上传人',proofFileId:evidence.id,note:'已在MES真实操作后登记'};
 const identicalEvidence=(await upload(sop.id,'mes_evidence')).attachment;
 await denied('sop-mes-upload',{...submission,proofFileId:identicalEvidence.id},users.upload,400);
 await denied('sop-mes-upload',{...submission,proofFileId:sopFile.id},users.upload,400);await denied('sop-mes-upload',{...submission,proofFileId:''},users.upload,400);await denied('sop-mes-upload',{...submission,uploadedVersion:'V1'},users.upload,400);
 await denied('sop-mes-upload',{...submission,mesReference:'',mesUrl:''},users.upload,400);await denied('sop-mes-upload',{...submission,mesUrl:'file:///private/passwords'},users.upload,400);await denied('sop-mes-upload',{...submission,mesUrl:'https://mes.test.invalid/sop?token=private'},users.upload,400);
 await denied('sop-mes-upload',submission,users.business);
 sop=(await ok('sop-mes-upload',submission,users.upload)).record;assert.equal(sop.status,'待确认');
 const uploadRecord=rawRecords().find(r=>r.id===sop.latestUploadId),immutableUpload=structuredClone(uploadRecord);assert.equal(uploadRecord.method,'manual_evidence');assert.equal(uploadRecord.actorId,members.upload.id);assert.equal(uploadRecord.proofHash,evidence.hash);
 await denied('sop-confirm',{id:sop.id,version:sop.version,decision:'confirm',note:'自己提交自己确认'},users.upload);
 await denied('sop-confirm',{id:sop.id,version:sop.version,decision:'confirm',note:'业务无审图权限'},users.business);
 const confirm={id:sop.id,version:sop.version,decision:'confirm',note:'独立核对MES记录、目标版本和凭证'};
 const race=await Promise.all([call('sop-confirm',confirm,users.review),call('sop-confirm',confirm,users.review)]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);sop=await latest(sop.id);assert.equal(sop.status,'已确认');assert.equal(sop.currentVersion,'V2');assert.equal(sop.confirmedBy,members.review.id);
 assert.deepEqual(rawRecords().find(r=>r.id===uploadRecord.id),immutableUpload);assert.deepEqual(rawRecords().find(r=>r.id===firstRevision.id),firstRevision);
 pass('MES上传登记必须有实际信息与独立凭证；上传人不得自确认，授权审图原子确认且历史凭证不可变');

 const confirmed=structuredClone(sop),second=(await ok('sop-change',{...create,targetVersion:'V3',token:token(),requirement:'再次改图，新SOP V3'},users.business)).record;
 assert.equal(second.currentVersion,'V2');assert.equal(second.status,'待更新SOP');assert.equal(second.sopFileId,'');assert.equal(second.latestUploadId,'');assert.equal(second.predecessorId,confirmed.id);
 const old=await latest(confirmed.id);assert.equal(old.isCurrent,false);assert.equal(old.status,'已确认');assert.equal(old.targetVersion,'V2');assert.equal(old.latestUploadId,confirmed.latestUploadId);
 rawInsert({...confirmed,id:'sop_synthetic_old_v1',version:1,targetVersion:'V1',currentVersion:'V1',isCurrent:false,confirmedAt:'2020-01-01T00:00:00Z'});
 await denied('sop-change',{...create,targetVersion:'V1',token:token()},users.business,409);
 await denied('sop-confirm',{id:old.id,version:old.version,decision:'confirm',note:'确认旧义务'},users.review,409);
 await denied('sop-prepare',{id:second.id,version:second.version,fileId:sopFile.id,preparedVersion:'V3',note:'复用旧义务附件'},users.upload,400);
 await denied('sop-target',{id:second.id,version:second.version,targetVersion:'V4',note:'改写已指定版本'},users.upload,409);
 const otherSop=(await ok('sop-create',{drawingRecordId:otherDrawing.id,modelNo:'SYN-OTHER',targetVersion:'V1',requirement:'独立MES任务',token:token()},users.upload)).record;
 const otherFile=(await upload(otherSop.id,'sop')).attachment;
 await denied('sop-prepare',{id:second.id,version:second.version,fileId:otherFile.id,preparedVersion:'V3',note:'跨客户附件'},users.upload,400);
 assert.equal((await latest(second.id)).status,'待更新SOP');
 pass('新改图另建版本义务并保留原确认；旧附件、旧MES凭证与其他客户文件不能复用完成新版本');

 let retry=(await ok('sop-create',{drawingRecordId:drawing.id,modelNo:'SYN-RETRY',targetVersion:'R1',requirement:'独立待上传任务',token:token()},users.upload)).record;
 const retryFile=(await upload(retry.id,'sop')).attachment,retryProof=(await upload(retry.id,'mes_evidence',users.upload,'retry-proof.pdf','%PDF-1.7\nDistinct MES upload evidence\n%%EOF')).attachment;
 retry=(await ok('sop-prepare',{id:retry.id,version:retry.version,fileId:retryFile.id,preparedVersion:'R1',note:''},users.upload)).record;
 const retryUpload=()=>({...submission,id:retry.id,version:retry.version,uploadedVersion:'R1',proofFileId:retryProof.id});
 retry=(await ok('sop-mes-upload',retryUpload(),users.upload)).record;const firstUploadId=retry.latestUploadId;
 retry=(await ok('sop-confirm',{id:retry.id,version:retry.version,decision:'return',note:'MES位置需要补充核对'},users.review)).record;assert.equal(retry.status,'待上传MES');
 retry=(await ok('sop-prepare',{id:retry.id,version:retry.version,fileId:retryFile.id,preparedVersion:'R1',note:'退回后重新准备'},users.upload)).record;assert.equal(retry.latestUploadId,'');
 retry=(await ok('sop-mes-upload',retryUpload(),users.upload)).record;assert.notEqual(retry.latestUploadId,firstUploadId);assert(rawRecords().some(r=>r.id===firstUploadId));
 const replacement=(await ok('sop-create',{drawingRecordId:drawing.id,modelNo:'SYN-RETRY',targetVersion:'R2',requirement:'新版本优先',token:token()},users.upload)).record;
 const stale=await latest(retry.id);assert.equal(stale.isCurrent,false);await denied('sop-confirm',{id:stale.id,version:stale.version,decision:'confirm',note:'不能确认已经替代的旧上传'},users.review,409);assert.equal(replacement.status,'待更新SOP');
 pass('退回与重传形成新上传凭证，已替代的待确认任务无法借旧上传完成新义务');

 const changeInput={...demand,token:token(),drawingType:'改图',requirement:'新建改图自动产生SOP义务'};
 const auto=(await ok('drawing-save',changeInput,users.business)).record;let automatic=rawRecords().filter(r=>r.kind==='engineering_sop'&&r.drawingRecordId===auto.id);assert.equal(automatic.length,1);assert.equal(automatic[0].targetVersion,'');assert.equal(automatic[0].status,'待更新SOP');
 await ok('drawing-save',changeInput,users.business);assert.equal(rawRecords().filter(r=>r.kind==='engineering_sop'&&r.drawingRecordId===auto.id).length,1);
 const autoFile=(await upload(automatic[0].id,'sop')).attachment;
 await denied('sop-prepare',{id:automatic[0].id,version:automatic[0].version,fileId:autoFile.id,preparedVersion:'V1',note:'未明确目标'},users.upload,400);
 let targeted=(await ok('sop-target',{id:automatic[0].id,version:automatic[0].version,modelNo:'SYN-AUTO',targetVersion:'V1',note:'业务补充目标版本'},users.business)).record;assert.equal(targeted.targetVersion,'V1');assert.equal(targeted.modelNo,'SYN-AUTO');assert.equal(targeted.targetNote,'业务补充目标版本');
 await ok('drawing-save',{id:auto.id,version:auto.version,modelNo:'SYN-AUTO'},users.upload);
 assert.equal(rawRecords().filter(r=>r.kind==='engineering_sop'&&r.drawingRecordId===auto.id).length,1);assert.equal((await latest(targeted.id)).isCurrent,true);assert.equal((await latest(targeted.id)).targetVersion,'V1');
 const mail={messageId:'<sop-change@test.invalid>',itemKey:'1',threadId:'sop-thread',sender:'source@test.invalid',subject:'合成改图',receivedAt:new Date().toISOString(),recordId:drawing.id,request:{customerId:customer.id,customerCode:customer.customerCode,drawingType:'改图',requestedDate:today,newCount:null,revisionCount:1,requester:'合成业务',upstreamDepartment:'业务部',priority:'普通',requirement:'已存在需求收到改图邮件'}};
 const beforeEmail=rawRecords().filter(r=>r.kind==='engineering_sop').length,pending=await ok('drawing-email-intake',mail,users.upload);assert.equal(rawRecords().filter(r=>r.kind==='engineering_sop').length,beforeEmail);
 drawing=(await ok('drawing-event-review',{recordId:drawing.id,version:pending.record.version,eventId:pending.event.id,decision:'accepted',note:'核对采纳邮件改图'},users.upload)).record;
 const fromMail=rawRecords().filter(r=>r.kind==='engineering_sop'&&r.sourceEventId===pending.event.id);assert.equal(fromMail.length,1);assert.equal(fromMail[0].targetVersion,'');
 const resolved=(await ok('sop-target',{id:fromMail[0].id,version:fromMail[0].version,modelNo:create.modelNo,targetVersion:'V4',note:'明确本次改图是既有款号的后续版本'},users.business)).record;
 assert.equal(resolved.predecessorId,second.id);assert.equal(resolved.currentVersion,'V2');assert.equal((await latest(second.id)).isCurrent,false);
 const beforeApply=rawRecords().filter(r=>r.kind==='engineering_sop'&&r.drawingRecordId===drawing.id).length;
 drawing=(await ok('drawing-save',{id:drawing.id,version:drawing.version,drawingType:mail.request.drawingType},users.upload)).record;
 drawing=(await ok('drawing-save',{id:drawing.id,version:drawing.version,requirement:mail.request.requirement},users.business)).record;
 assert.equal(rawRecords().filter(r=>r.kind==='engineering_sop'&&r.drawingRecordId===drawing.id).length,beforeApply);assert.equal((await latest(resolved.id)).isCurrent,true);assert.equal((await latest(resolved.id)).targetVersion,'V4');
 assert.equal(rawRecords().filter(r=>r.kind==='engineering_sop_application'&&r.eventId===pending.event.id).length,2);
 drawing=(await ok('drawing-save',{id:drawing.id,version:drawing.version,requirement:'之后独立提出的真实新改图要求'},users.business)).record;
 assert.equal(rawRecords().filter(r=>r.kind==='engineering_sop'&&r.drawingRecordId===drawing.id).length,beforeApply+1);
 await ok('drawing-email-intake',mail,users.upload);assert.equal(rawRecords().filter(r=>r.kind==='engineering_sop'&&r.sourceEventId===pending.event.id).length,1);
 const newMail={...mail,recordId:undefined,messageId:'<sop-new-mail@test.invalid>'},newMailResult=await ok('drawing-email-intake',newMail,users.upload);assert(rawRecords().some(r=>r.kind==='engineering_sop'&&r.drawingRecordId===newMailResult.record.id));
 const audits=(await ok('data',undefined,users.pmc)).audits;assert(!audits.some(a=>[a.before,a.after].some(v=>v?.kind?.startsWith('engineering_'))));
 pass('网页/新邮件改图及已采纳邮件变更自动建立SOP义务，未核对邮件不抢先生效，缺目标版本不能上传且通用审计无泄漏');
}
