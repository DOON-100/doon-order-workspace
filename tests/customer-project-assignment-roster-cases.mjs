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
 assert.deepEqual(dto.taskOwnerMemberIds,serviceIds);assert.deepEqual(dto.taskServiceReviewerMemberIds,serviceIds);assert.deepEqual(dto.taskSalesReviewerMemberIds,salesIds);
 assert(!dto.taskOwnerMemberIds.includes(mid('marketing')));assert(!dto.taskSalesReviewerMemberIds.includes(mid('marketing')));
 assert(dto.assignableMemberIds.includes(mid('marketing')),'Workflow roster must not change the existing administrator role');
 const retained=(await ok('customer-project-task-save',{...legacyBody,token:token(),id:legacyTask.id,version:legacyTask.version,dueDate:'2026-12-02'},users.sales_a)).item;
 assert.equal(retained.ownerId,legacyTask.ownerId);assert.equal(retained.salesReviewerId,legacyTask.salesReviewerId);
 pass('客服跟进和业务审核按独立配置排序，管理员及营销人员不自动混入，名单仅管理员可维护');

 const taskBody=()=>({token:token(),projectId:project.id,roundId:'',title:'合成按职责指派',description:'Synthetic only',ownerId:serviceIds[0],serviceReviewerId:serviceIds[1],salesReviewerId:salesIds[0],waitingFor:'self',dueDate:'2026-12-01',status:'open'});
 const firstTaskBody=taskBody(),task=(await ok('customer-project-task-save',firstTaskBody,users.sales_a)).item;
 for(const change of [{ownerId:mid('sales_a')},{ownerId:mid('marketing')},{serviceReviewerId:mid('sales_b')},{salesReviewerId:mid('marketing')},{salesReviewerId:serviceIds[2]}])await denied('customer-project-task-save',{...taskBody(),...change},users.sales_a,403);
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

 rawInsert({...roster,id:'synthetic-duplicate-roster'});
 dto=await candidates();assert.deepEqual(dto.taskOwnerMemberIds,[]);assert.deepEqual(dto.taskSalesReviewerMemberIds,[]);
 await denied('customer-project-task-save',taskBody(),users.sales_a,409);
 pass('重复或非法名单配置不得回退成全员候选');
}
