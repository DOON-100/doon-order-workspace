import assert from 'node:assert/strict';

// Synthetic end-to-end API tests only; original bytes and child records must survive recycling.
export async function testCustomerProjectRecycle({ok,call,state,pass,rawRecords,rawInsert,rawUpdate,admin}){
 const token=()=>crypto.randomUUID(),current=id=>rawRecords().find(row=>row.id===id),users={};
 for(const [key,role] of [['owner','sales'],['leader','sales'],['service','clerk'],['outsider','sales'],['pmc','pmc']]){
  const user={userId:'recycle_synthetic_'+key,email:'recycle-synthetic-'+key+'@test.invalid',displayName:'回收站合成-'+key,fullName:'回收站合成-'+key};
  await ok('member',{name:user.displayName,email:user.email,role,orderScope:'all',customers:[],active:true});await ok('enroll',{},user);users[key]=user;
 }
 const members=(await state()).members,mid=key=>members.find(member=>member.email===users[key].email).id;
 const customer=(await ok('customer-save',{customer:'回收站合成客户',customerCode:'SYN-RECYCLE-CUSTOMER',salesName:users.owner.displayName,serviceName:users.service.displayName,pmcName:'',salesMemberIds:[mid('owner'),mid('leader')],serviceMemberIds:[mid('service')],active:true})).item;
 const team=(await ok('customer-project-team-save',{token:token(),name:'回收站合成小组',leaderIds:[mid('leader'),mid('outsider')],salesMemberIds:[mid('owner')],serviceMemberIds:[mid('service')],customerIds:[customer.id],active:true})).item;
 const projectBody={token:token(),customerId:customer.id,code:'SYN-RECYCLE-PROJECT',title:'误建项目合成测试',description:'SYN-RECYCLE-PRIVATE-DESCRIPTION',teamId:team.id,salesMemberId:mid('owner'),serviceMemberIds:[mid('service')],status:'active'};
 let project=(await ok('customer-project-save',projectBody,users.owner)).item;
 const editBody=()=>({...projectBody,id:project.id,version:current(project.id).version,token:token()});
 const entry=(entryType,values={})=>({token:token(),projectId:project.id,entryType,...values});
 const children={};
 for(const entryType of ['item','round','communication','task','drawing','confirmation','quote','sample','dispatch','feedback','handover']){
  children[entryType]=(await ok('customer-project-entry-save',entry(entryType,entryType==='sample'?{ownerId:mid('pmc')}:{}),users.service)).item;
 }
 const originalBytes=Uint8Array.from([137,80,78,71,13,10,26,10,83,89,78,84,72,69,84,73,67]);
 const uploadBody=()=>{const form=new FormData();form.set('projectId',project.id);form.set('file',new File([originalBytes],'synthetic-recycle.png',{type:'image/png'}));return form;};
 const attachment=(await ok('customer-project-attachment',uploadBody(),users.service)).item;
 const attachmentBefore=structuredClone(current(attachment.id));
 const projectChildren=()=>rawRecords().filter(row=>row.projectId===project.id&&!['customer_project_request','audit'].includes(row.kind));
 const childrenBefore=structuredClone(projectChildren()),beforeProject=structuredClone(current(project.id));
 const denied=async(action,body,user=users.owner,status=409,pattern)=>{const before=structuredClone(rawRecords()),response=await call(action,body,user),message=await response.text();assert.equal(response.status,status,message);if(pattern)assert.match(message,pattern);assert.deepEqual(rawRecords(),before,'Rejected recycle operation must not write');};
 const trash=()=>({id:project.id,version:current(project.id).version,token:token(),reason:'误建项目，移入回收站'});
 const restore=()=>({id:project.id,version:current(project.id).version,token:token()});
 for(const actor of [users.service,users.outsider,users.pmc])await denied('customer-project-trash',trash(),actor,403);
 await denied('customer-project-trash',{...trash(),reason:''},users.owner,400);
 await denied('customer-project-trash',{...trash(),version:99});
 await denied('customer-project-restore',restore());
 await denied('customer-project-save',{...editBody(),trashedAt:'forged'},users.owner,400);
 const trashBody=trash();project=(await ok('customer-project-trash',trashBody,users.owner)).item;
 assert(project.trashedAt);assert.equal(project.trashedById,mid('owner'));assert.equal(project.trashReason,trashBody.reason);assert.equal(project.status,beforeProject.status);assert.equal(project.version,beforeProject.version+1);
 assert.deepEqual(projectChildren(),childrenBefore);assert.deepEqual(current(attachment.id),attachmentBefore);assert.deepEqual(current(customer.id),customer);
 const afterTrash=structuredClone(rawRecords());assert.equal((await ok('customer-project-trash',trashBody,users.owner)).idempotent,true);assert.deepEqual(rawRecords(),afterTrash);
 await denied('customer-project-trash',{...trashBody,reason:'重复请求号改内容'});await denied('customer-project-trash',trashBody,users.leader);await denied('customer-project-trash',trash());
 const dto=await ok('customer-project-data',undefined,users.owner),trashed=dto.trashedProjects.find(row=>row.id===project.id);
 assert(trashed?.canManageRecycle);assert.equal(trashed.canWrite,false);assert.equal(Object.hasOwn(trashed,'description'),false);assert(!dto.projects.some(row=>row.id===project.id));
 for(const key of ['items','rounds','communications','tasks','drawings','confirmations','quoteLinks','samples','dispatches','feedback','handovers','attachments'])assert(!dto[key].some(row=>row.projectId===project.id),key+' excludes recycled project');
 assert((await ok('customer-project-data',undefined,users.leader)).trashedProjects.some(row=>row.id===project.id));
 for(const actor of [users.service,users.outsider,users.pmc])assert(!(await ok('customer-project-data',undefined,actor)).trashedProjects.some(row=>row.id===project.id));
 assert(!(await ok('customer-project-data',undefined,users.pmc)).samples.some(row=>row.projectId===project.id));
 pass('项目回收严格校验客户和管理权限、原因、版本与幂等；误建项目含草稿子记录可回收，普通目录和内部样办队列排除且不扩大权限');

 await denied('customer-project-save',editBody());await denied('customer-project-save',projectBody);
 await denied('customer-project-item-save',{token:token(),projectId:project.id,model:'绕过回收',quantity:1});
 for(const entryType of ['item','round','communication','task','drawing','confirmation','quote','sample','dispatch','feedback','handover','attachment'])await denied('customer-project-entry-save',entry(entryType),users.service);
 await denied('customer-project-attachment',uploadBody(),users.service);
 await denied('customer-project-sample-update',{id:children.sample.id,version:children.sample.version,status:'accepted',plannedDate:'',note:''},users.pmc);
 await denied('customer-project-sample-promise',{id:children.sample.id,version:children.sample.version,promisedDate:'2026-11-01',promiseNote:'合成复期说明'},users.service);
 await denied('customer-project-drawing-withdraw',{id:children.drawing.id,version:children.drawing.version,reason:'合成撤回测试'},users.service);
 await denied('customer-project-dispatch-receive',{id:children.dispatch.id,version:children.dispatch.version,receivedDate:'2026-11-01'},users.service);
 const download=await call('customer-project-file?id='+attachment.id,undefined,users.service);assert.equal(download.status,200);assert.deepEqual(new Uint8Array(await download.arrayBuffer()),originalBytes);
 const preview=await call('customer-project-file?id='+attachment.id+'&preview=1',undefined,users.service);assert.equal(preview.status,200);assert.deepEqual(new Uint8Array(await preview.arrayBuffer()),originalBytes);
 await denied('customer-project-file?id='+attachment.id,undefined,users.outsider,403);
 const history=(await ok('customer-project-history?projectId='+project.id,undefined,users.owner)).history;
 assert(history.some(row=>row.action.includes('customer-project-trash')&&row.before.id===project.id&&row.after.trashedAt));
 pass('回收期间旧主档表单、创建重放、独立登记、上传、样办更新等写入口全部阻止；附件按原权限保留下载、预览与完整字节');

 await denied('customer-project-restore',restore(),users.service,403);await denied('customer-project-restore',restore(),users.outsider,403);
 await denied('customer-project-restore',{...restore(),version:beforeProject.version});
 rawUpdate({...customer,active:false});await denied('customer-project-trash',trashBody,users.owner,403);await denied('customer-project-restore',restore(),users.owner,403);rawUpdate(customer);
 const originalOwner=structuredClone(current(mid('owner')));rawUpdate({...originalOwner,active:false});await denied('customer-project-trash',trashBody,users.owner,403);rawUpdate(originalOwner);
 const restoreBody=restore();project=(await ok('customer-project-restore',restoreBody,users.leader)).item;
 assert.equal(project.id,beforeProject.id);assert.equal(project.status,beforeProject.status);for(const key of ['trashedAt','trashedBy','trashedById','trashReason'])assert.equal(Object.hasOwn(project,key),false);
 assert.deepEqual(projectChildren(),childrenBefore);assert.deepEqual(current(attachment.id),attachmentBefore);
 const afterRestore=structuredClone(rawRecords());assert.equal((await ok('customer-project-restore',restoreBody,users.leader)).idempotent,true);assert.deepEqual(rawRecords(),afterRestore);
 assert((await ok('customer-project-data',undefined,users.service)).projects.some(row=>row.id===project.id));
 assert(!(await ok('customer-project-data',undefined,users.owner)).trashedProjects.some(row=>row.id===project.id));
 const restoredFile=await call('customer-project-file?id='+attachment.id,undefined,users.service);assert.deepEqual(new Uint8Array(await restoredFile.arrayBuffer()),originalBytes);
 assert((await ok('customer-project-history?projectId='+project.id,undefined,users.owner)).history.some(row=>row.action.includes('customer-project-restore')&&row.before.trashedAt&&!row.after.trashedAt));
 await ok('customer-project-entry-save',entry('communication',{content:'恢复后可继续维护'}),users.service);
 pass('恢复仍需当前权限与版本，重复请求零写；原项目编号、状态、子记录及附件引用完整恢复并记录审计');

 for(const status of ['paused','cancelled','archived']){
  const fixture={...beforeProject,id:'recycle_synthetic_'+status,status,code:'SYN-RECYCLE-'+status};rawInsert(fixture);
  const removed=(await ok('customer-project-trash',{id:fixture.id,version:fixture.version,token:token(),reason:'合成状态保留测试'})).item;
  assert.equal(removed.status,status);const restored=(await ok('customer-project-restore',{id:fixture.id,version:removed.version,token:token()})).item;assert.equal(restored.status,status);assert.equal(restored.id,fixture.id);
 }
 pass('暂停、取消和归档项目移入及恢复均保留原业务状态，管理员可处理但不会隐式重新开启项目');

 const releasedSample={...current(children.sample.id),id:'recycle_synthetic_released_sample',independentEntry:false,status:'making'};
 const handover={...current(children.handover.id),id:'recycle_synthetic_official_handover',independentEntry:false,type:'sample',sampleId:releasedSample.id,orderLinks:[]};rawInsert(releasedSample);rawInsert(handover);
 await denied('customer-project-trash',trash(),users.owner,409,/内部样办/);rawUpdate({...releasedSample,status:'closed'});
 const order={id:'recycle_synthetic_official_order',kind:'order',version:1,customer:customer.customerCode,orderNo:'SYN-RECYCLE-ORDER',quantity:1,lifecycle:'active',workflowStatus:'PMC待接单',sourceStatus:'正式订单'};rawInsert(order);
 rawUpdate({...handover,type:'bulk',sampleId:'',orderLinks:[{orderId:order.id,itemId:children.item.id,quantity:1,orderVersion:1}]});
 await denied('customer-project-trash',trash(),users.owner,409,/大货交接订单/);rawUpdate({...order,workflowStatus:'已完成'});
 const charge={id:'recycle_synthetic_charge',kind:'project_charge',projectId:project.id,customerId:customer.id,roundId:'',title:'合成未结费用',status:'draft',currency:'USD',amountCents:100,prepayCents:0,version:1};rawInsert(charge);
 await denied('customer-project-trash',trash(),users.owner,409,/未结财务/);rawUpdate({...charge,status:'confirmed',amountCents:0});
 const settledChildren=structuredClone(projectChildren()),settledOrder=structuredClone(current(order.id));
 project=(await ok('customer-project-trash',trash(),users.owner)).item;assert.deepEqual(projectChildren(),settledChildren);assert.deepEqual(current(order.id),settledOrder);
 project=(await ok('customer-project-restore',restore())).item;assert.deepEqual(projectChildren(),settledChildren);assert.deepEqual(current(order.id),settledOrder);
 pass('真实未关闭样办、未完成正式订单交接和未结财务阻止回收；完结历史可回收且所有执行记录保持原值');

 const otherProject=(await ok('customer-project-save',{token:token(),customerId:customer.id,title:'同客户仍在跟进的项目',salesMemberId:mid('owner')},users.owner)).item;
 rawUpdate({...current(charge.id),amountCents:2500,status:'confirmed',plan:[{title:'合成已结款',amountCents:2500,dueDate:'',beforeOrder:false}]});
 const noticeBody={token:token(),projectId:project.id,amount:'25',currency:'USD',reference:'SYN-RECYCLE-NOTICE',note:'合成付款通知'};
 const notice=(await ok('project-payment-notice',noticeBody,users.owner)).record;
 const receipt=(await ok('project-receipt-verify',{token:token(),customerId:customer.id,amount:'25',currency:'USD',date:'2026-10-12',reference:'SYN-RECYCLE-RECEIPT',account:'SYN-RECYCLE-ACCOUNT',noticeIds:[notice.id]})).record;
 const allocation=(await ok('project-allocation',{token:token(),receiptId:receipt.id,chargeId:charge.id,amount:'25'})).record;
 const otherCharge=(await ok('project-charge-save',{token:token(),projectId:otherProject.id,title:'另一项目未结费用',amount:'10',currency:'USD'},users.owner)).record;
 const documentBody={token:token(),customerId:customer.id,documentType:'PI',documentNo:'SYN-RECYCLE-MIXED-PI',chargeIds:[charge.id,otherCharge.id],currency:'USD',date:'2026-10-12'};
 const document=(await ok('project-document-save',documentBody,users.owner)).record;
 const financialBefore=structuredClone(rawRecords().filter(row=>['project_charge','project_receipt','project_allocation','project_payment_notice','project_billing_document'].includes(row.kind)&&row.customerId===customer.id));
 const totalsBefore=(await ok('project-finance-data?customerId='+customer.id,undefined,users.owner)).totalsByCurrency;
 project=(await ok('customer-project-trash',trash(),users.owner)).item;
 const financeData=await ok('project-finance-data?projectId='+project.id,undefined,users.owner);
 assert.deepEqual(financeData.totalsByCurrency,totalsBefore);assert.equal(financeData.projectTotalsByCurrency.USD.allocatedCents,2500);assert.equal(financeData.projectTotalsByCurrency.USD.balanceCents,0);
 assert(financeData.charges.some(row=>row.id===charge.id));assert(financeData.receipts.some(row=>row.id===receipt.id));assert(!financeData.projects.some(row=>row.id===project.id));assert(financeData.projects.some(row=>row.id===otherProject.id));assert.equal(financeData.canWrite,false);
 const denyFinance=(action,body,actor=users.owner)=>denied(action,body,actor,409,/回收站/);
 await denyFinance('project-charge-save',{token:token(),projectId:project.id,title:'绕过回收站',amount:'0'});
 await denyFinance('project-charge-confirm',{token:token(),id:charge.id,version:current(charge.id).version},admin);
 await denyFinance('project-payment-notice',{...noticeBody,token:token(),id:notice.id,version:notice.version});
 await denyFinance('project-payment-notice',noticeBody);
 await denyFinance('project-document-save',{...documentBody,token:token(),id:document.id,version:document.version,chargeIds:[otherCharge.id]});
 await denyFinance('project-document-save',{...documentBody,token:token(),projectId:otherProject.id});
 await denyFinance('project-document-confirm',{token:token(),id:document.id,version:document.version});
 await denyFinance('project-document-sent',{token:token(),projectId:otherProject.id,documentId:document.id,date:'2026-10-12',recipient:'合成接收人'});
 await denyFinance('project-allocation-release',{token:token(),allocationId:allocation.id,amount:'1',reason:'合成释放尝试'},admin);
 await denyFinance('project-receipt-reverse',{token:token(),receiptId:receipt.id,reason:'合成冲销尝试'},admin);
 await denyFinance('project-receipt-verify',{token:token(),customerId:customer.id,amount:'1',currency:'USD',date:'2026-10-12',reference:'SYN-RECYCLE-SECOND',account:'SYN-RECYCLE-ACCOUNT',noticeIds:[notice.id]},admin);
 for(const [entryType,data] of [
  ['allocations',{chargeId:charge.id,receiptId:receipt.id,amount:'1'}],
  ['adjustments',{chargeId:charge.id,amount:'1'}],
  ['creditApplications',{sourceChargeId:charge.id,targetChargeId:otherCharge.id,amount:'1'}],
  ['creditApplications',{sourceChargeId:otherCharge.id,targetChargeId:charge.id,amount:'1'}],
  ['refunds',{receiptId:receipt.id,amount:'1'}],
 ])await denyFinance('project-finance-entry-save',{token:token(),projectId:otherProject.id,entryType,data});
 assert.deepEqual(rawRecords().filter(row=>['project_charge','project_receipt','project_allocation','project_payment_notice','project_billing_document'].includes(row.kind)&&row.customerId===customer.id),financialBefore);
 const printed=await call('project-document-print?id='+document.id,undefined,users.owner);assert.equal(printed.status,200);assert((await printed.text()).includes('25.00'));
 project=(await ok('customer-project-restore',restore(),users.owner)).item;
 await ok('project-payment-notice',{...noticeBody,token:token(),id:notice.id,version:notice.version,note:'恢复后继续维护'},users.owner);
 await ok('project-document-save',{...documentBody,token:token(),id:document.id,version:document.version},users.owner);
 await ok('project-finance-entry-save',{token:token(),projectId:otherProject.id,entryType:'adjustments',data:{chargeId:charge.id,amount:'1'}},users.owner);
 assert.deepEqual((await ok('project-finance-data?customerId='+customer.id,undefined,users.owner)).totalsByCurrency,totalsBefore);
 pass('回收保留已结财务金额与历史单据，项目目录隐藏；新旧财务记录、跨项目单据、通知到账和独立录入关联回收项目均零写拒绝，恢复后可继续维护');
}
