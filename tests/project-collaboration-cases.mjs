import assert from 'node:assert/strict';

// Actual API handlers, synthetic identities and the caller's isolated SQLite only.
// This suite does not open production files, use credentials, or change the old review workflow.
// tests/run.mjs supplies its projectHarness plus api/identity for the real team-header check.
export async function testProjectCollaboration({ok,call,pass,rawRecords,rawInsert,rawUpdate,admin,api,identity}){
 const original=structuredClone(rawRecords()),prefix='synthetic_project_collaboration_',at='2026-11-01T00:00:00.000Z';
 const id=name=>prefix+name,token=()=>crypto.randomUUID(),current=key=>rawRecords().find(r=>r.id===key),users={},members={};
 for(const [key,role] of [['sales_manager','sales'],['service_manager','sales'],['clerk_manager','clerk'],['leader','sales'],['ordinary_service','clerk'],['outsider','clerk'],...['sales','clerk','pmc','production','finance','programmer','viewer','supplier'].map(role=>['worker_'+role,role]),['disabled','clerk']]){
  const user={userId:id('user_'+key),email:'project-collaboration-'+key+'@test.invalid',displayName:'合成协作-'+key,fullName:'合成协作-'+key};
  const member={id:id('member_'+key),kind:'member',userId:user.userId,email:user.email,name:user.displayName,role,customers:[],departments:[],orderScope:'assigned',active:key!=='disabled',createdAt:at,...(role==='supplier'?{supplierId:id('supplier')}: {})};
  users[key]=user;members[key]=member;rawInsert(member);
 }
 const mid=key=>members[key].id;
 const customer={id:id('customer'),kind:'customer_account',customer:'合成跨部门客户',customerCode:'SYN-COLLAB',salesName:'',serviceName:'',pmcName:'',salesMemberIds:[mid('sales_manager'),mid('leader')],serviceMemberIds:[mid('service_manager'),mid('clerk_manager'),mid('ordinary_service')],quoteMemberIds:[],active:true,notes:'SYNTHETIC_PRIVATE_CUSTOMER_NOTES',version:1,createdAt:at,updatedAt:at,updatedBy:'synthetic'};
 const team={id:id('team'),kind:'customer_project_team',name:'合成项目责任组',leaderIds:[mid('leader')],salesMemberIds:customer.salesMemberIds,serviceMemberIds:customer.serviceMemberIds,customerIds:[customer.id],active:true,version:1};
 const otherTeam={...team,id:id('other_team'),name:'合成其他组',customerIds:[],leaderIds:[],salesMemberIds:[],serviceMemberIds:[]};
 const project={id:id('project'),kind:'customer_project',customerId:customer.id,code:'SYN-COLLAB-P',title:'合成跨部门项目',description:'SYNTHETIC_PRIVATE_PROJECT_DESCRIPTION',teamId:team.id,salesMemberId:mid('sales_manager'),serviceMemberId:mid('service_manager'),serviceMemberIds:[mid('service_manager'),mid('clerk_manager')],serviceReviewerId:mid('clerk_manager'),salesReviewerId:mid('sales_manager'),dueDate:'',status:'active',version:1,createdAt:at,createdBy:'synthetic',updatedAt:at,updatedBy:'synthetic'};
 const otherProject={...project,id:id('other_project'),code:'SYN-COLLAB-OTHER',title:'合成其他项目'};
 const round={id:id('round'),kind:'customer_project_round',projectId:project.id,customerId:customer.id,title:'合成开发轮次',type:'development',scope:[],stage:'图纸',requiredDrawingTypes:[],requireQuote:false,requiredSampleIds:[],sampleGateStage:'not_required',status:'open',version:1};
 const otherRound={...round,id:id('other_round'),projectId:otherProject.id};
 const attachment={id:id('attachment'),kind:'customer_project_attachment',projectId:project.id,customerId:customer.id,roundId:round.id,category:'general',filename:'synthetic-private-original.pdf',contentType:'application/pdf',size:10,fileKey:id('private_file_key'),note:'SYNTHETIC_PRIVATE_ATTACHMENT_NOTE',version:1};
 const quote={id:id('quote'),kind:'customer_quote',customerAccountId:customer.id,customerName:customer.customer,customerCode:customer.customerCode,quoteNo:'SYN-PRIVATE-QUOTE',quoteDate:'2026-11-01',currency:'USD',status:'confirmed',version:1,lines:[{id:id('quote_line'),model:'SYN',unitPrice:9182.77,internalNote:'SYNTHETIC_PRIVATE_QUOTE_COST'}],createdAt:at,updatedAt:at,createdBy:'synthetic',createdById:'synthetic',updatedBy:'synthetic',updatedById:'synthetic'};
 const receipt={id:id('receipt'),kind:'project_receipt',customerId:customer.id,amountCents:12345,currency:'USD',date:'2026-11-01',reference:'SYN-PRIVATE-RECEIPT',payer:'SYNTHETIC_PRIVATE_PAYER',account:'SYNTHETIC_PRIVATE_BANK_ACCOUNT',note:'',version:1,createdAt:at,updatedAt:at,updatedBy:'synthetic'};
 const oldTask={id:id('old_review_task'),kind:'customer_project_task',projectId:project.id,customerId:customer.id,roundId:'',title:'合成旧双审历史',description:'Original review workflow',ownerId:mid('clerk_manager'),serviceReviewerId:mid('service_manager'),salesReviewerId:mid('sales_manager'),waitingFor:'',dueDate:'',status:'sales_review',result:'原处理结果不得改写',reviewCycle:1,reviewHistory:[{action:'submit',stage:'followup',actorId:mid('clerk_manager'),actor:'synthetic',at,comment:'原处理结果不得改写',cycle:1}],version:3};
 const protectedFixtures=[customer,team,otherTeam,project,otherProject,round,otherRound,attachment,quote,receipt,oldTask];
 protectedFixtures.forEach(rawInsert);
 const rejected=async(action,body,actor,status=403,pattern)=>{const before=structuredClone(rawRecords()),response=await call(action,body,actor),message=await response.text();assert((Array.isArray(status)?status:[status]).includes(response.status),`${action}: expected ${status}, got ${response.status}: ${message}`);if(pattern)assert.match(message,pattern);assert.deepEqual(rawRecords(),before,'Rejected request must not write: '+action);};
 const data=(actor,query='')=>ok('project-collaboration-data'+query,undefined,actor);
 const taskDto=async(taskId,actor)=>(await data(actor,'?taskId='+encodeURIComponent(taskId))).tasks.find(t=>t.id===taskId);
 const create=(owner='worker_production',patch={})=>({token:token(),version:0,projectId:project.id,roundId:'',stepKey:'drawings',department:'engineering',ownerId:mid(owner),title:'合成图纸协作',description:'核对指定尺寸并回传结果；仅此任务说明',dueDate:'2026-11-30',...patch});
 const actionBody=(taskId,comment='合成跟进意见')=>({token:token(),id:taskId,version:current(taskId).version,comment});
 const save=(body,actor=users.sales_manager)=>ok('project-collaboration-save',body,actor);

 for(const actor of [admin,users.sales_manager,users.service_manager,users.clerk_manager]){const d=await data(actor,'?projectId='+project.id);assert.equal(d.canAssign,true);assert(d.members.some(m=>m.id===mid('worker_production')));assert(!d.members.some(m=>[mid('worker_supplier'),mid('disabled')].includes(m.id)));}
 for(const key of ['leader','ordinary_service']){const d=await data(users[key],'?projectId='+project.id);assert.equal(d.canAssign,false);assert.equal(d.members.length,0);await rejected('project-collaboration-save',create(),users[key]);}
 await rejected('project-collaboration-data?projectId='+project.id,undefined,users.outsider);
 await rejected('project-collaboration-save',create(),users.outsider);
 pass('项目协作派单仅管理员、当前项目业务及指定客服负责；组长和其他客户协作人不自动获得派单权');

 const workerTasks=new Map();
 for(const role of ['sales','clerk','pmc','production','finance','programmer','viewer']){
  const key='worker_'+role,body=create(key,{title:'合成跨部门-'+role}),task=(await save(body)).item;workerTasks.set(role,task);
  const dto=await taskDto(task.id,users[key]);assert(dto);assert.equal(dto.ownerId,mid(key));assert.equal(dto.canOpenProject,false);assert.equal(dto.canComplete,true);assert.equal(dto.canReply,true);assert.equal(dto.canAssign,false);
  assert((await data(users[key])).tasks.some(t=>t.id===task.id));assert.equal((await data(users[key])).members.length,0);
  for(const hidden of ['SYNTHETIC_PRIVATE_CUSTOMER_NOTES','SYNTHETIC_PRIVATE_PROJECT_DESCRIPTION','SYNTHETIC_PRIVATE_ATTACHMENT_NOTE','SYNTHETIC_PRIVATE_QUOTE_COST','SYNTHETIC_PRIVATE_BANK_ACCOUNT','SYNTHETIC_PRIVATE_PAYER',attachment.fileKey])assert(!JSON.stringify(dto).includes(hidden));
  for(const field of ['customer','quote','quotes','bank','account','paymentSnapshot','sourceSnapshot','fileKey','attachments','members'])assert(!Object.hasOwn(dto,field),'Task projection must not expose '+field);
  const p=await ok('customer-project-data',undefined,users[key]);assert(!p.projects.some(r=>r.id===project.id));assert(!p.attachments.some(r=>r.id===attachment.id));assert(!p.quotes.some(r=>r.id===quote.id));
  const quoteResponse=await call('customer-quotes',undefined,users[key]),q=await quoteResponse.json();assert([200,403].includes(quoteResponse.status),JSON.stringify(q));if(quoteResponse.status===200)assert(!q.quotes.some(r=>r.id===quote.id));
  const financeResponse=await call('project-finance-data',undefined,users[key]),f=await financeResponse.json();assert([200,403].includes(financeResponse.status),JSON.stringify(f));assert(!JSON.stringify(f).includes(receipt.account));assert(!JSON.stringify(f).includes(receipt.id));
  await rejected('customer-project-file?id='+attachment.id,undefined,users[key]);await rejected('customer-project-file?id='+attachment.id+'&preview=1',undefined,users[key]);
  await rejected('customer-quote-version?quoteId='+quote.id+'&quoteVersion=1',undefined,users[key],[403,404]);
 }
 const productionTask=workerTasks.get('production');
 await rejected('project-collaboration-data?taskId='+productionTask.id,undefined,users.outsider);
 await rejected('project-collaboration-data?taskId='+productionTask.id,undefined,users.worker_finance);
 await rejected('project-collaboration-data',undefined,users.worker_supplier);
 await rejected('project-collaboration-complete',actionBody(productionTask.id),users.sales_manager);
 await rejected('project-collaboration-complete',actionBody(productionTask.id),admin);
 pass('七类内部人员仅凭精确指派收到最小任务正文，不扩大项目、报价、财务、原件权限；未指派者及供应商无任务访问且管理人不可代完成');

 for(const patch of [{ownerId:mid('worker_supplier')},{ownerId:mid('disabled')},{ownerId:id('missing_member')}])await rejected('project-collaboration-save',create('worker_production',patch),users.sales_manager,403);
 for(const patch of [{roundId:otherRound.id},{stepKey:'unknown_step'},{department:'unknown_department'},{status:'done'}])await rejected('project-collaboration-save',create('worker_production',patch),users.sales_manager,400);
 for(const action of ['project-collaboration-followup','project-collaboration-complete','project-collaboration-cancel'])await rejected(action,actionBody(productionTask.id,'  \n '),action.endsWith('cancel')?users.sales_manager:users.worker_production,400);
 await rejected('project-collaboration-followup',{...actionBody(productionTask.id),status:'done'},users.worker_production,400);
 await rejected('project-collaboration-complete',{...actionBody(productionTask.id),ownerId:mid('worker_finance')},users.worker_production,400);
 await rejected('customer-project-entry-save',{token:token(),projectId:project.id,entryType:'collaboration',status:'done'},users.sales_manager,400);
 await rejected('customer-project-entry-save',{token:token(),projectId:project.id,entryType:'task',id:productionTask.id,version:productionTask.version,status:'done'},users.sales_manager,403);
 pass('协作字段严格校验：空完成/跟进/取消备注、停用或供应商接收人、跨项目轮次、非法环节和状态注入被拒；独立资料入口不能写新任务');

 const ownerReply={...actionBody(productionTask.id,'已检查尺寸，正在处理'),status:'in_progress'};
 let item=(await ok('project-collaboration-followup',ownerReply,users.worker_production)).item;assert.equal(item.status,'in_progress');
 const replayBefore=structuredClone(rawRecords());assert.equal((await ok('project-collaboration-followup',ownerReply,users.worker_production)).idempotent,true);assert.deepEqual(rawRecords(),replayBefore);
 await rejected('project-collaboration-followup',{...ownerReply,comment:'同令牌不同内容'},users.worker_production,409);
 await rejected('project-collaboration-followup',{...actionBody(item.id),version:1},users.worker_production,409);
 await rejected('project-collaboration-followup',{...actionBody(item.id),status:'blocked'},users.sales_manager,[400,403]);
 item=(await ok('project-collaboration-followup',actionBody(item.id,'项目负责人补充说明'),users.service_manager)).item;assert.equal(item.status,'in_progress');
 item=(await ok('project-collaboration-followup',{...actionBody(item.id,'等待指定尺寸资料'),status:'blocked'},users.worker_production)).item;assert.equal(item.status,'blocked');
 assert(item.history.some(h=>h.comment==='已检查尺寸，正在处理'));assert(item.history.some(h=>h.comment==='项目负责人补充说明'));
 await rejected('project-collaboration-followup',actionBody(item.id),users.outsider);
 pass('负责人可跟进并标处理中或受阻，项目主责只能回复而不代改执行状态；跟进留痕、版本冲突和令牌内容冲突受保护');

 const completion=actionBody(item.id,'已核对全部指定尺寸，结果见任务说明，项目负责人可继续推进');
 item=(await ok('project-collaboration-complete',completion,users.worker_production)).item;assert.equal(item.status,'done');assert.equal(item.result,completion.comment);
 const doneBefore=structuredClone(rawRecords());assert.equal((await ok('project-collaboration-complete',completion,users.worker_production)).idempotent,true);assert.deepEqual(rawRecords(),doneBefore);
 await rejected('project-collaboration-complete',{...completion,comment:'尝试重放不同结果'},users.worker_production,409);
 await rejected('project-collaboration-complete',actionBody(item.id,'新令牌不能重新完成'),users.worker_production,409);
 for(const actor of [users.sales_manager,users.service_manager,users.clerk_manager]){const feedback=(await data(actor)).tasks.find(t=>t.id===item.id);assert(feedback?.canAcknowledge);assert.equal(feedback.result,completion.comment);}
 assert((await data(users.sales_manager,'?projectId='+project.id)).tasks.some(t=>t.id===item.id&&t.result===completion.comment));
 await rejected('project-collaboration-acknowledge',actionBody(item.id),users.worker_production);
 await rejected('project-collaboration-acknowledge',actionBody(item.id),users.leader);
 const acknowledgement=actionBody(item.id,'已阅结果，继续安排下一步'),oldResult=item.result;
 item=(await ok('project-collaboration-acknowledge',acknowledgement,users.sales_manager)).item;assert.equal(item.status,'done');assert.equal(item.result,oldResult);assert(item.history.some(h=>h.action==='acknowledge'));
 assert(!(await data(users.service_manager)).tasks.some(t=>t.id===item.id));assert((await data(users.worker_production)).tasks.some(t=>t.id===item.id));
 const ackBefore=structuredClone(rawRecords());await ok('project-collaboration-acknowledge',acknowledgement,users.sales_manager);assert.deepEqual(rawRecords(),ackBefore);
 pass('本人直接完成须填写结果并原样回写项目反馈；项目主责个人待推进可阅反馈，确认收阅不改完成结果，重复请求不重复写入');

 const reassignBody=create('worker_viewer',{title:'合成改派历史'});let assigned=(await save(reassignBody,users.service_manager)).item;
 const oldReply={...actionBody(assigned.id,'原跟进人保留的历史意见'),status:'blocked'};await ok('project-collaboration-followup',oldReply,users.worker_viewer);
 const oldHistory=structuredClone(current(assigned.id).history),change={...reassignBody,token:token(),id:assigned.id,version:current(assigned.id).version,ownerId:mid('worker_finance')};
 await rejected('project-collaboration-save',change,users.sales_manager,400);
 assigned=(await save({...change,reason:'转交财务核实本任务必要内容'})).item;
 assert.equal(assigned.ownerId,mid('worker_finance'));assert.equal(assigned.status,'open');assert.deepEqual(assigned.history.slice(0,oldHistory.length),oldHistory);
 assert(assigned.history.at(-1).changes.some(c=>c.field==='status'&&c.before==='blocked'&&c.after==='open'));
 assert((await data(users.worker_finance)).tasks.some(t=>t.id===assigned.id));assert(!(await data(users.worker_viewer)).tasks.some(t=>t.id===assigned.id));
 await rejected('project-collaboration-data?taskId='+assigned.id,undefined,users.worker_viewer);
 await rejected('project-collaboration-followup',oldReply,users.worker_viewer);
 await rejected('project-collaboration-complete',actionBody(assigned.id),users.worker_viewer);
 await rejected('project-collaboration-save',{...change,version:current(assigned.id).version,reason:'同项目以外改绑',projectId:otherProject.id},users.sales_manager,[400,403,409]);
 pass('改派须理由并保留原跟进历史；旧负责人即时撤销当前详情、列表和重放权限，新负责人仅获得该任务');

 assert(api&&identity,'The team-header regression requires the real API and identity context');
 for(const teamId of [team.id,otherTeam.id,'__ungrouped']){
  const response=await identity.run(users.worker_finance,()=>api.GET(new Request('https://orders.test/api/workspace/project-collaboration-data',{headers:{'X-Workspace-Team':teamId}}),{params:Promise.resolve({action:'project-collaboration-data'})}));
  const dto=await response.json();assert.equal(response.status,200,JSON.stringify(dto));assert(dto.tasks.some(t=>t.id===assigned.id),'A selected business team must not hide personal collaboration assignments');
 }
 pass('真实路由携带其他工作组或未分组筛选时，本人跨组协作任务仍完整可见且不附带客户读取权');

 const owner=structuredClone(current(mid('worker_finance'))),projectBefore=structuredClone(current(project.id)),customerBefore=structuredClone(current(customer.id));
 try{
  rawUpdate({...owner,active:false});await rejected('project-collaboration-data',undefined,users.worker_finance);await rejected('project-collaboration-complete',actionBody(assigned.id),users.worker_finance);rawUpdate(owner);
  for(const patch of [{status:'paused'},{status:'archived'},{status:'cancelled'},{trashedAt:at,trashedBy:'synthetic',trashReason:'合成历史回收状态'}]){
   rawUpdate({...projectBefore,...patch});const dto=await taskDto(assigned.id,users.worker_finance);assert(dto);assert.equal(dto.canReply,false);assert.equal(dto.canComplete,false);
   await rejected('project-collaboration-complete',actionBody(assigned.id),users.worker_finance,[403,409]);await rejected('project-collaboration-followup',actionBody(assigned.id),users.worker_finance,[403,409]);
   rawUpdate(projectBefore);
  }
  rawUpdate({...customerBefore,active:false});const dto=await taskDto(assigned.id,users.worker_finance);assert(dto);assert.equal(dto.canComplete,false);await rejected('project-collaboration-complete',actionBody(assigned.id),users.worker_finance,[403,409]);
 }finally{rawUpdate(owner);rawUpdate(projectBefore);rawUpdate(customerBefore);}
 await rejected('member',{...owner,active:false},admin,409);
 pass('停用成员即时失权；暂停、归档、取消或回收的项目及停用客户保留任务历史但拒绝执行；有未完协作的成员不能直接停用');

 const lifecycle={...project,id:id('lifecycle_project'),code:'SYN-COLLAB-LIFECYCLE',title:'合成生命周期门禁'};rawInsert(lifecycle);
 const activeTask=(await save(create('worker_programmer',{projectId:lifecycle.id}))).item;
 const projectInput={token:token(),id:lifecycle.id,version:lifecycle.version,customerId:customer.id,code:lifecycle.code,title:lifecycle.title,description:lifecycle.description,teamId:team.id,salesMemberId:mid('sales_manager'),serviceMemberIds:project.serviceMemberIds,serviceReviewerId:project.serviceReviewerId,salesReviewerId:project.salesReviewerId,dueDate:''};
 for(const status of ['archived','cancelled'])await rejected('customer-project-save',{...projectInput,token:token(),status},users.sales_manager,[400,409],/协作|待办|事项/);
 await rejected('customer-project-trash',{token:token(),id:lifecycle.id,version:lifecycle.version,reason:'合成回收检查'},users.sales_manager,[400,409],/协作|待办|事项/);
 await rejected('project-collaboration-cancel',actionBody(activeTask.id),users.worker_programmer);
 const cancellation=actionBody(activeTask.id,'项目负责人确认取消本次协作');const cancelled=(await ok('project-collaboration-cancel',cancellation,users.service_manager)).item;assert.equal(cancelled.status,'cancelled');assert(cancelled.history.some(h=>h.action==='cancel'));
 const cancelBefore=structuredClone(rawRecords());await ok('project-collaboration-cancel',cancellation,users.service_manager);assert.deepEqual(rawRecords(),cancelBefore);
 await rejected('project-collaboration-complete',actionBody(activeTask.id),users.worker_programmer,409);
 await ok('customer-project-trash',{token:token(),id:lifecycle.id,version:current(lifecycle.id).version,reason:'所有协作已取消后回收'},users.sales_manager);
 assert.equal(current(activeTask.id).status,'cancelled');
 pass('未完跨部门协作阻止项目提前取消、归档或回收；项目主责取消须备注且保留历史，取消后可正常回收');

 // These two employees have no customer responsibility, old project duties, or grants.
 // A collaboration assignment alone must be enough to transfer this duty, never the customer.
 const departureUser={userId:id('departing_user'),email:'project-collaboration-departing@test.invalid',displayName:'合成离岗协作人',fullName:'合成离岗协作人'};
 const recipientUser={userId:id('receiving_user'),email:'project-collaboration-receiving@test.invalid',displayName:'合成协作接收人',fullName:'合成协作接收人'};
 const employee=(user,key,role)=>({id:id(key),kind:'member',userId:user.userId,email:user.email,name:user.displayName,role,customers:[],departments:[],orderScope:'assigned',active:true,createdAt:at});
 const departure=employee(departureUser,'departing_member','production'),recipient=employee(recipientUser,'receiving_member','viewer');rawInsert(departure);rawInsert(recipient);
 const transferTask=(await save(create('worker_production',{ownerId:departure.id,title:'合成仅协作责任离岗交接'}))).item;
 await ok('project-collaboration-followup',{...actionBody(transferTask.id,'离岗前已核对尺寸，仍等待新图纸'),status:'blocked'},departureUser);
 const originalTransfer=structuredClone(current(transferTask.id)),beforeHandover=structuredClone(rawRecords());
 await rejected('member',{...departure,active:false},admin,409);
 const inventory=(await ok('framework-offboarding?memberId='+departure.id,undefined,admin)).items;
 assert.equal(inventory.length,1);assert.equal(inventory[0].recordId,transferTask.id);assert.equal(inventory[0].kind,'customer_project_collaboration_task');assert.equal(inventory[0].field,'ownerId');assert(inventory[0].candidateIds.includes(recipient.id));
 const draft={token:token(),expectedVersion:0,memberId:departure.id,reason:'合成协作负责人离岗',assignments:[{key:inventory[0].key,recipientId:recipient.id}]};
 await rejected('framework-offboarding-draft',draft,users.sales_manager);
 const plan=await ok('framework-offboarding-draft',draft,admin),acceptance={token:token(),id:plan.id,expectedVersion:plan.version,keys:[inventory[0].key],note:'本人已核对原回复并接收未完协作'};
 assert.equal(current(plan.id).items[0].recipientId,recipient.id);assert.equal(current(plan.id).items[0].acceptedBy,'');
 await rejected('framework-offboarding-finalize',{token:token(),id:plan.id,expectedVersion:plan.version,reason:'接收之前不得停用'},admin,409);
 for(const actor of [admin,departureUser,users.outsider])await rejected('framework-offboarding-accept',acceptance,actor);
 assert((await ok('framework-offboarding-incoming',undefined,recipientUser)).plans.some(p=>p.id===plan.id&&p.items.some(i=>i.recordId===transferTask.id)));
 assert(!(await ok('framework-offboarding-incoming',undefined,users.outsider)).plans.some(p=>p.id===plan.id));
 const accepted=await ok('framework-offboarding-accept',acceptance,recipientUser);
 assert.equal(current(plan.id).items[0].acceptedBy,recipient.id);assert.equal(current(plan.id).items[0].acceptanceNote,acceptance.note);
 assert.deepEqual(current(transferTask.id),originalTransfer,'Receiving acknowledges the plan; task ownership changes only at finalization');assert.equal(current(departure.id).active,true);
 const finalize={token:token(),id:plan.id,expectedVersion:accepted.version,reason:'接收人确认后管理员最终停用'};
 await rejected('framework-offboarding-finalize',finalize,recipientUser);
 await ok('framework-offboarding-finalize',finalize,admin);
 const transferred=current(transferTask.id);assert.equal(current(departure.id).active,false);assert.equal(current(departure.id).offboardingPlanId,plan.id);assert.equal(current(plan.id).status,'completed');
 assert.equal(transferred.ownerId,recipient.id);assert.equal(transferred.status,'open');assert.equal(transferred.version,originalTransfer.version+1);assert.equal(transferred.result,originalTransfer.result);
 assert.deepEqual(transferred.history.slice(0,originalTransfer.history.length),originalTransfer.history);const transferEvent=transferred.history.at(-1);assert.equal(transferEvent.action,'transfer');assert(transferEvent.changes.some(c=>c.field==='ownerId'&&c.before===departure.id&&c.after===recipient.id));assert(transferEvent.changes.some(c=>c.field==='status'&&c.before==='blocked'&&c.after==='open'));
 const receivedTask=await taskDto(transferTask.id,recipientUser);assert(receivedTask.canComplete);assert.equal(receivedTask.canOpenProject,false);assert((await data(recipientUser)).tasks.some(t=>t.id===transferTask.id));
 await rejected('project-collaboration-data?taskId='+transferTask.id,undefined,departureUser);await rejected('project-collaboration-complete',actionBody(transferTask.id),departureUser);
 const recipientProjects=await ok('customer-project-data',undefined,recipientUser);assert(!recipientProjects.projects.some(p=>p.id===project.id));assert.deepEqual(current(recipient.id),recipient);assert.deepEqual(current(customer.id),customer);
 const afterFinalization=new Map(rawRecords().map(r=>[r.id,r]));for(const row of beforeHandover)if(![departure.id,transferTask.id].includes(row.id))assert.deepEqual(afterFinalization.get(row.id),row,'Offboarding must preserve every other record, including historical audits: '+row.id);
 const repeatedFinalization=structuredClone(rawRecords());assert.equal((await ok('framework-offboarding-finalize',finalize,admin)).idempotent,true);assert.deepEqual(rawRecords(),repeatedFinalization);
 pass('仅有协作任务的离岗员工须本人接收后管理员最终停用；交接重置待接手且保留旧回复，接收人无新增客户权限，其他业务及旧审计逐条不变');

 // Administrative continuity is allowed while work is paused. It must neither
 // resume the project nor let its new executor perform business actions early.
 const pausedDepartureUser={userId:id('paused_departing_user'),email:'paused-collaboration-departing@test.invalid',displayName:'合成暂停项目离岗人',fullName:'合成暂停项目离岗人'};
 const pausedRecipientUser={userId:id('paused_receiving_user'),email:'paused-collaboration-receiving@test.invalid',displayName:'合成暂停项目接收人',fullName:'合成暂停项目接收人'};
 const pausedDeparture=employee(pausedDepartureUser,'paused_departing_member','production'),pausedRecipient=employee(pausedRecipientUser,'paused_receiving_member','viewer');rawInsert(pausedDeparture);rawInsert(pausedRecipient);
 const pausedProject={...project,id:id('paused_handover_project'),code:'SYN-COLLAB-PAUSED',title:'合成暂停项目行政交接'};rawInsert(pausedProject);
 const pausedTask=(await save(create('worker_production',{projectId:pausedProject.id,ownerId:pausedDeparture.id,title:'合成暂停项目未完协作'}))).item;
 await ok('project-collaboration-followup',{...actionBody(pausedTask.id,'项目暂停前已核对资料，等待恢复'),status:'blocked'},pausedDepartureUser);
 const pausedProjectInput={...projectInput,id:pausedProject.id,code:pausedProject.code,title:pausedProject.title};
 await ok('customer-project-save',{...pausedProjectInput,token:token(),version:current(pausedProject.id).version,status:'paused'},users.sales_manager);
 const frozenProject=structuredClone(current(pausedProject.id)),frozenTask=structuredClone(current(pausedTask.id));
 assert.equal(frozenProject.status,'paused');assert.equal((await taskDto(pausedTask.id,pausedDepartureUser)).canComplete,false);
 await rejected('member',{...pausedDeparture,active:false},admin,409);
 const pausedInventory=(await ok('framework-offboarding?memberId='+pausedDeparture.id,undefined,admin)).items;
 assert.equal(pausedInventory.length,1);assert.equal(pausedInventory[0].recordId,pausedTask.id);assert(pausedInventory[0].candidateIds.includes(pausedRecipient.id));
 const pausedPlan=await ok('framework-offboarding-draft',{token:token(),expectedVersion:0,memberId:pausedDeparture.id,reason:'暂停期间仅移交未完责任，不恢复业务',assignments:[{key:pausedInventory[0].key,recipientId:pausedRecipient.id}]},admin);
 const pausedAcceptance=await ok('framework-offboarding-accept',{token:token(),id:pausedPlan.id,expectedVersion:pausedPlan.version,keys:[pausedInventory[0].key],note:'本人接收责任，等待项目恢复后执行'},pausedRecipientUser);
 assert.deepEqual(current(pausedTask.id),frozenTask);
 await ok('framework-offboarding-finalize',{token:token(),id:pausedPlan.id,expectedVersion:pausedAcceptance.version,reason:'本人确认后完成行政交接，保留暂停状态'},admin);
 assert.deepEqual(current(pausedProject.id),frozenProject,'Administrative handover must preserve the paused project verbatim');
 assert.equal(current(pausedDeparture.id).active,false);assert.deepEqual(current(pausedRecipient.id),pausedRecipient);
 const pausedTransferred=structuredClone(current(pausedTask.id));assert.equal(pausedTransferred.ownerId,pausedRecipient.id);assert.equal(pausedTransferred.status,'open');assert.equal(pausedTransferred.version,frozenTask.version+1);assert.deepEqual(pausedTransferred.history.slice(0,frozenTask.history.length),frozenTask.history);assert.equal(pausedTransferred.history.at(-1).action,'transfer');
 const pausedReceived=await taskDto(pausedTask.id,pausedRecipientUser);assert.equal(pausedReceived.canComplete,false);assert.equal(pausedReceived.canReply,false);assert.equal(pausedReceived.canOpenProject,false);
 await rejected('project-collaboration-complete',actionBody(pausedTask.id,'暂停期间不能提前完成'),pausedRecipientUser,409);
 await rejected('project-collaboration-followup',{...actionBody(pausedTask.id,'暂停期间不能推进'),status:'in_progress'},pausedRecipientUser,409);
 await rejected('project-collaboration-data?projectId='+pausedProject.id,undefined,pausedRecipientUser);
 await rejected('project-collaboration-data?taskId='+pausedTask.id,undefined,pausedDepartureUser);
 assert.deepEqual(current(pausedProject.id),frozenProject);assert.deepEqual(current(pausedTask.id),pausedTransferred);
 await ok('customer-project-save',{...pausedProjectInput,token:token(),version:frozenProject.version,status:'active'},users.sales_manager);
 assert.equal(current(pausedProject.id).status,'active');assert.deepEqual(current(pausedTask.id),pausedTransferred,'Resuming the project must not rewrite task history');
 assert.equal((await taskDto(pausedTask.id,pausedRecipientUser)).canComplete,true);
 const resumedResult='项目正式恢复后本人完成指定协作';const resumedDone=(await ok('project-collaboration-complete',actionBody(pausedTask.id,resumedResult),pausedRecipientUser)).item;
 assert.equal(resumedDone.status,'done');assert.equal(resumedDone.result,resumedResult);assert.equal(resumedDone.history.at(-1).actorId,pausedRecipient.id);assert.deepEqual(current(customer.id),customer);
 pass('暂停项目允许既有本人接收和管理员离岗交接，但项目原文仍暂停、接收人不能回复或完成；明确恢复项目后才可本人执行');

 const after=new Map(rawRecords().map(r=>[r.id,r]));
 for(const record of [...original,...protectedFixtures])assert.deepEqual(after.get(record.id),record,'Unrelated or old review record must remain unchanged: '+record.id);
 assert.equal(current(oldTask.id).status,'sales_review');assert.equal(current(oldTask.id).reviewCycle,1);
 pass('新增协作使用专用记录类型，不迁移或改写旧双审与原业务记录；所有前序记录及受保护原件、报价、款项逐条保持一致');
}
