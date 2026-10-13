import assert from 'node:assert/strict';

// Synthetic identities only. A workflow roster narrows candidates without granting customer access.
export async function testCustomerProjectAssignmentRoster({ok,call,state,pass,rawRecords,rawInsert,admin}){
 const originals=structuredClone(rawRecords()),token=()=>crypto.randomUUID(),users={};
 for(const key of ['service_a','service_b','service_c','sales_a','sales_b','marketing']){
  const user={userId:'synthetic_roster_'+key,email:'roster-'+key+'@test.invalid',displayName:'合成名单-'+key,fullName:'合成名单-'+key};
  await ok('member',{name:user.displayName,email:user.email,role:key==='marketing'?'admin':'sales',customers:[],active:true});
  await ok('enroll',{},user);users[key]=user;
 }
 const members=(await state()).members,mid=key=>members.find(m=>m.email===users[key].email).id;
 const serviceIds=['service_c','service_a','service_b'].map(mid),salesIds=['sales_b','sales_a'].map(mid);
 const customerBody={customer:'合成职责名单客户',customerCode:'SYN-ROSTER',salesName:'',serviceName:'',salesMemberIds:salesIds,serviceMemberIds:serviceIds,active:true};
 const customer=(await ok('customer-save',customerBody)).item;
 const projectBody={customerId:customer.id,code:'SYN-ROSTER-P',title:'合成职责名单项目',description:'Synthetic roster only',teamId:'',salesMemberId:mid('sales_a'),serviceMemberIds:serviceIds,status:'active'};
 const project=(await ok('customer-project-save',{...projectBody,token:token()})).item;
 const legacyBody={token:token(),projectId:project.id,roundId:'',title:'合成旧业务跟进事项',description:'Original assignment',ownerId:mid('sales_a'),serviceReviewerId:mid('sales_b'),salesReviewerId:mid('marketing'),waitingFor:'self',dueDate:'2026-12-01',status:'open'};
 const legacyTask=(await ok('customer-project-task-save',legacyBody,users.sales_a)).item;
 const legacyCrossReviewBody={...legacyBody,token:token(),ownerId:mid('service_a'),serviceReviewerId:mid('marketing'),salesReviewerId:mid('sales_a')};
 let legacyCrossReview=(await ok('customer-project-task-save',legacyCrossReviewBody,users.sales_a)).item;
 legacyCrossReview=(await ok('customer-project-task-submit',{token:token(),projectId:project.id,id:legacyCrossReview.id,version:legacyCrossReview.version,result:'合成旧事项已提交'},users.service_a)).item;
 const legacyInScopeBody={...legacyBody,token:token(),serviceReviewerId:mid('service_a'),salesReviewerId:mid('service_b')};
 const legacyInScope=(await ok('customer-project-task-save',legacyInScopeBody,users.sales_a)).item;
 const candidates=async()=> (await ok('customer-project-data',undefined,users.sales_a)).projects.find(p=>p.id===project.id);
 const legacyCandidates=await candidates();
 for(const key of ['taskOwnerMemberIds','taskServiceReviewerMemberIds','taskSalesReviewerMemberIds'])assert.deepEqual(legacyCandidates[key],legacyCandidates.assignableMemberIds);
 const denied=async(action,body,actor=users.sales_a,status=403)=>{const before=structuredClone(rawRecords()),res=await call(action,body,actor);assert.equal(res.status,status,await res.text());assert.deepEqual(rawRecords(),before);};
 const rosterBody={token:token(),serviceFollowerIds:serviceIds,salesReviewerIds:salesIds};
 await denied('customer-project-assignment-roster-save',rosterBody);
 await denied('customer-project-assignment-roster-save',{...rosterBody,serviceFollowerIds:[serviceIds[0],serviceIds[0]]},admin,400);
 await denied('customer-project-assignment-roster-save',{...rosterBody,serviceFollowerIds:['missing-member']},admin,400);
 let roster=(await ok('customer-project-assignment-roster-save',rosterBody)).item;
 const created=structuredClone(rawRecords());await ok('customer-project-assignment-roster-save',rosterBody);assert.deepEqual(rawRecords(),created);
 let dto=await candidates();
 assert.deepEqual(dto.taskOwnerMemberIds,serviceIds);assert.deepEqual([...dto.taskServiceReviewerMemberIds].sort(),[...serviceIds,...salesIds].sort());assert.deepEqual(dto.taskSalesReviewerMemberIds,salesIds);
 assert(!dto.taskOwnerMemberIds.includes(mid('marketing')));assert(!dto.taskSalesReviewerMemberIds.includes(mid('marketing')));
 assert(dto.assignableMemberIds.includes(mid('marketing')),'Workflow roster must not change the existing administrator role');
 const retained=(await ok('customer-project-task-save',{...legacyBody,token:token(),id:legacyTask.id,version:legacyTask.version,dueDate:'2026-12-02'},users.sales_a)).item;
 assert.equal(retained.ownerId,legacyTask.ownerId);assert.equal(retained.salesReviewerId,legacyTask.salesReviewerId);
 const taskDto=async(id,actor)=>(await ok('customer-project-data',undefined,actor)).tasks.find(task=>task.id===id);
 assert.equal((await taskDto(legacyTask.id,users.sales_a)).reviewConfigurationValid,false);
 await denied('customer-project-task-submit',{token:token(),projectId:project.id,id:retained.id,version:retained.version,result:'不得跨客户职责执行'},users.sales_a);
 assert.equal((await taskDto(legacyCrossReview.id,users.marketing)).canReviewService,false);
 await denied('customer-project-task-review',{token:token(),projectId:project.id,id:legacyCrossReview.id,version:legacyCrossReview.version,stage:'service',decision:'approve',comment:'不得借管理员权限跨范围审核'},users.marketing);
 assert.equal((await taskDto(legacyInScope.id,users.sales_a)).reviewConfigurationValid,true);
 await ok('customer-project-task-submit',{token:token(),projectId:project.id,id:legacyInScope.id,version:legacyInScope.version,result:'原职责角色保留且仍在客户范围内'},users.sales_a);
 pass('客服跟进和业务审核按独立配置排序，管理员及营销人员不自动混入，名单仅管理员可维护');
 pass('旧人员配置可保留改期，范围内遗留角色仍可执行，跨范围旧审核须明确改派且记录不被拒绝操作改写');

 const taskBody=()=>({token:token(),projectId:project.id,roundId:'',title:'合成按职责指派',description:'Synthetic only',ownerId:serviceIds[0],serviceReviewerId:serviceIds[1],salesReviewerId:salesIds[0],waitingFor:'self',dueDate:'2026-12-01',status:'open'});
 const firstTaskBody=taskBody(),task=(await ok('customer-project-task-save',firstTaskBody,users.sales_a)).item;
 for(const change of [{ownerId:mid('sales_a')},{ownerId:mid('marketing')},{serviceReviewerId:mid('marketing')},{salesReviewerId:mid('marketing')},{salesReviewerId:serviceIds[2]}])await denied('customer-project-task-save',{...taskBody(),...change},users.sales_a,403);
 await ok('customer-project-task-save',{...taskBody(),serviceReviewerId:mid('sales_b')},users.sales_a);
 await denied('customer-project-task-save',{...taskBody(),serviceReviewerId:serviceIds[0]},users.sales_a,400);
 assert.equal(task.ownerId,serviceIds[0]);
 roster=(await ok('customer-project-assignment-roster-save',{...rosterBody,token:token(),id:roster.id,version:roster.version,serviceFollowerIds:serviceIds.slice(1)})).item;
 await denied('customer-project-task-save',firstTaskBody,users.sales_a,403);
 roster=(await ok('customer-project-assignment-roster-save',{...rosterBody,token:token(),id:roster.id,version:roster.version})).item;
 pass('后台按职责名单校验跟进和两级审核，隐藏选项无法经直接请求越过，仍拒绝同人自审');

 await ok('customer-save',{...customerBody,id:customer.id,serviceMemberIds:serviceIds.slice(0,2)});
 dto=await candidates();assert.deepEqual(dto.taskOwnerMemberIds,serviceIds.slice(0,2));
 await denied('customer-project-task-save',{...taskBody(),ownerId:serviceIds[2]},users.sales_a,403);
 assert.equal((await ok('customer-project-data',undefined,users.service_b)).projects.some(p=>p.id===project.id),false);
 await ok('customer-save',{...customerBody,id:customer.id});
 const serviceRecord=rawRecords().find(r=>r.id===serviceIds[2]);await ok('member',{...serviceRecord,active:false});
 assert.deepEqual((await candidates()).taskOwnerMemberIds,serviceIds.slice(0,2));
 await denied('customer-project-task-save',{...taskBody(),ownerId:serviceIds[2]},users.sales_a,403);
 await ok('member',{...serviceRecord,active:true});
 pass('名单配置不授予客户访问，客户撤权和人员停用立即移除候选并阻止指派');

 const update={...rosterBody,token:token(),id:roster.id,version:roster.version,serviceFollowerIds:[...serviceIds].reverse()};
 roster=(await ok('customer-project-assignment-roster-save',update)).item;
 await denied('customer-project-assignment-roster-save',{...update,token:token()},admin,409);
 assert.deepEqual((await candidates()).taskOwnerMemberIds,[...serviceIds].reverse());
 assert.equal(rawRecords().find(r=>r.id===task.id).version,task.version,'Changing candidate lists must not rewrite existing tasks');
 const after=new Map(rawRecords().map(r=>[r.id,r]));for(const original of originals)assert.deepEqual(after.get(original.id),original);
 pass('名单更新支持版本冲突保护，保留已有任务、人员角色、客户和其他原始业务记录');

 // Two groups can share a customer's authorization without sharing workflow assignments.
 roster=(await ok('customer-project-assignment-roster-save',{...rosterBody,token:token(),id:roster.id,version:roster.version,salesReviewerIds:[...salesIds,mid('marketing')]})).item;
 const teamBody={name:'合成负责甲组',leaderIds:[mid('sales_a')],salesMemberIds:[mid('sales_a')],serviceMemberIds:[serviceIds[0]],customerIds:[customer.id],active:true};
 let team=(await ok('customer-project-team-save',{...teamBody,token:token()})).item;
 await ok('customer-project-team-save',{token:token(),name:'合成负责乙组',leaderIds:[mid('marketing')],salesMemberIds:[mid('sales_b'),mid('marketing')],serviceMemberIds:serviceIds.slice(1),customerIds:[customer.id],active:true});
 const grouped=(await ok('customer-project-save',{...projectBody,token:token(),code:'SYN-ROSTER-GROUP',teamId:team.id,serviceMemberIds:[serviceIds[0]]})).item;
 const groupedDto=async()=>(await ok('customer-project-data',undefined,users.sales_a)).projects.find(p=>p.id===grouped.id);
 let groupDto=await groupedDto();
 assert.deepEqual(groupDto.taskOwnerMemberIds,[serviceIds[0]]);
 assert.deepEqual(groupDto.taskServiceReviewerMemberIds,[serviceIds[0],mid('sales_a')]);
 assert.deepEqual(groupDto.taskSalesReviewerMemberIds,[mid('sales_a')]);
 assert(groupDto.assignableMemberIds.includes(mid('marketing'))&&groupDto.assignableMemberIds.includes(mid('sales_b')),'Both outsiders still retain their original customer write permission');
 const groupedTaskBody={...taskBody(),projectId:grouped.id,serviceReviewerId:mid('sales_a'),salesReviewerId:mid('sales_a')};
 for(const changed of [{ownerId:serviceIds[1]},{serviceReviewerId:mid('sales_b')},{salesReviewerId:mid('sales_b')},{serviceReviewerId:mid('marketing')},{salesReviewerId:mid('marketing')}])await denied('customer-project-task-save',{...groupedTaskBody,token:token(),...changed});
 let groupedTask=(await ok('customer-project-task-save',groupedTaskBody,users.sales_a)).item;
 const submittedBody={token:token(),projectId:grouped.id,id:groupedTask.id,version:groupedTask.version,result:'组内单客服完成跟进'};
 groupedTask=(await ok('customer-project-task-submit',submittedBody,users.service_c)).item;
 const serviceReviewBody={token:token(),projectId:grouped.id,id:groupedTask.id,version:groupedTask.version,stage:'service',decision:'approve',comment:'组内业务核实客服结果'};
 groupedTask=(await ok('customer-project-task-review',serviceReviewBody,users.sales_a)).item;
 groupedTask=(await ok('customer-project-task-review',{...serviceReviewBody,token:token(),version:groupedTask.version,stage:'sales',comment:'组内业务最终审核'},users.sales_a)).item;
 assert.equal(groupedTask.status,'done');
 pass('同客户授权仍按各自负责组指派，管理员不能跨组；单客服组可由组内业务完成两级审核且不得自审');

 // A legacy pending review can be retained, but cannot execute through an out-of-group administrator.
 const oldCrossGroup={...legacyCrossReview,id:'synthetic-roster-old-cross-group',projectId:grouped.id,ownerId:serviceIds[0],serviceReviewerId:mid('marketing'),salesReviewerId:mid('sales_a')};rawInsert(oldCrossGroup);
 assert.equal((await taskDto(oldCrossGroup.id,users.marketing)).reviewConfigurationValid,false);
 await denied('customer-project-task-review',{token:token(),projectId:grouped.id,id:oldCrossGroup.id,version:oldCrossGroup.version,stage:'service',decision:'approve',comment:'旧跨组审核仍需改派'},users.marketing);
 const pendingGroupBody={...groupedTaskBody,token:token()},pendingGroup=(await ok('customer-project-task-save',pendingGroupBody,users.sales_a)).item;
 team=(await ok('customer-project-team-save',{...teamBody,token:token(),id:team.id,version:team.version,active:false})).item;
 for(const key of ['taskOwnerMemberIds','taskServiceReviewerMemberIds','taskSalesReviewerMemberIds'])assert.deepEqual((await groupedDto())[key],[]);
 assert.equal((await taskDto(pendingGroup.id,users.service_c)).canSubmit,false);
 await denied('customer-project-task-save',pendingGroupBody);
 await denied('customer-project-task-submit',{token:token(),projectId:grouped.id,id:pendingGroup.id,version:pendingGroup.version,result:'停用组不得继续提交'},users.service_c);
 await denied('customer-project-task-submit',submittedBody,users.service_c);
 await denied('customer-project-task-review',serviceReviewBody,users.sales_a);
 team=(await ok('customer-project-team-save',{...teamBody,token:token(),id:team.id,version:team.version,customerIds:[]})).item;
 assert.deepEqual((await groupedDto()).taskOwnerMemberIds,[]);
 await denied('customer-project-task-save',{...groupedTaskBody,token:token()});
 team=(await ok('customer-project-team-save',{...teamBody,token:token(),id:team.id,version:team.version})).item;
 assert.deepEqual((await groupedDto()).taskOwnerMemberIds,[serviceIds[0]]);
 pass('组停用或移除客户立即撤回候选及执行权限，旧提交和审核token重放不得绕过当前组范围');

 // An ungrouped legacy customer uses exact responsibility names; an administrator is not a fallback owner.
 const namedCustomer={...customer,id:'synthetic-roster-name-customer',customer:'合成无组姓名责任客户',customerCode:'SYN-NAME',salesName:users.sales_a.displayName,serviceName:users.service_a.displayName};
 delete namedCustomer.salesMemberIds;delete namedCustomer.serviceMemberIds;rawInsert(namedCustomer);
 const namedProject=(await ok('customer-project-save',{...projectBody,token:token(),customerId:namedCustomer.id,code:'SYN-NAME-P',serviceMemberIds:[mid('service_a')]})).item;
 const namedDto=(await ok('customer-project-data',undefined,users.sales_a)).projects.find(p=>p.id===namedProject.id);
 assert.deepEqual(namedDto.taskOwnerMemberIds,[mid('service_a')]);assert.deepEqual(namedDto.taskSalesReviewerMemberIds,[mid('sales_a')]);assert(!namedDto.taskServiceReviewerMemberIds.includes(mid('marketing')));
 pass('无组旧项目按客户明确责任或原精确姓名匹配候选，不把管理员全权当作业务职责');

 rawInsert({...roster,id:'synthetic-duplicate-roster'});
 dto=await candidates();assert.deepEqual(dto.taskOwnerMemberIds,[]);assert.deepEqual(dto.taskSalesReviewerMemberIds,[]);
 await denied('customer-project-task-save',taskBody(),users.sales_a,409);
 pass('重复或非法名单配置不得回退成全员候选');
}
