import assert from 'node:assert/strict';

// Runs only in tests/run.mjs's in-memory database and injected identity context.
export async function testProcessWorkspace({api,identity,admin,rawInsert,rawRecords,pass}){
 const prefix='synthetic_process_',id=name=>prefix+name,at='2026-10-18T00:00:00.000Z';
 const user=(name,role,extra={})=>({id:id(name),kind:'member',userId:id(name+'_user'),email:name+'@process.test.invalid',name:'Synthetic '+name,role,customers:[],active:true,createdAt:at,...extra});
 const sales=user('sales','sales'),other=user('other','sales'),broadSales=user('broad_sales','sales',{orderScope:'all'}),viewer=user('viewer','viewer'),programmer=user('programmer','programmer'),production=user('production','production'),pmc=user('pmc','pmc'),finance=user('finance','finance'),supplier=user('supplier','supplier'),finished=user('finished','clerk',{departments:['finished'],orderScope:'assigned'}),engineering=user('engineering','clerk',{departments:['engineering'],orderScope:'assigned'}),readonly=user('readonly','admin');
 const person=member=>({userId:member.userId,email:member.email,displayName:member.name,fullName:member.name});
 const customer=name=>({id:id('customer_'+name),kind:'customer_account',customer:'Synthetic process '+name,customerCode:'PROCESS-'+name,salesName:'',serviceName:'',pmcName:'',active:true,version:1,notes:'',createdAt:at,updatedAt:at,updatedBy:'test'});
 const a={...customer('A'),serviceMemberIds:[sales.id]},b={...customer('B'),serviceMemberIds:[other.id]},shared={...customer('Shared'),serviceMemberIds:[sales.id]},inactive={...customer('Inactive'),active:false};
 const singleOrderClerk=user('single_order_clerk','clerk',{departments:['finished'],orderScope:'assigned'});
 const baseOrder=rawRecords().find(row=>row.kind==='order');assert(baseOrder,'Earlier synthetic order fixture is required');
 const order=(name,account)=>({...baseOrder,id:id('order_'+name),orderNo:'PROCESS-'+name,customer:account.customerCode,ownerEmail:'',version:1});
 const oa=order('A',a),ob=order('B',b),os=order('Shared',shared),loose={...order('Loose',a),customer:'PROCESS-UNRESOLVED'};
 const ownedOrder={...oa,id:id('single_owned_order'),orderNo:'PROCESS-SINGLE-OWNED',ownerEmail:singleOrderClerk.email};
 for(const member of [sales,viewer,programmer,finished])member.customers=[a.customerCode,shared.customerCode];
 const t1={id:id('team_1'),kind:'customer_project_team',name:'Synthetic process team one',active:true,customerIds:[a.id,shared.id],leaderIds:[],salesMemberIds:[sales.id],serviceMemberIds:[]};
 const t2={...t1,id:id('team_2'),name:'Synthetic process team two',customerIds:[b.id,shared.id],salesMemberIds:[other.id]};
 const t3={...t2,id:id('team_3'),name:'Synthetic invisible team',customerIds:[b.id]};
 const oldAttachment={id:id('attachment'),kind:'attachment',lineId:oa.id,filename:'synthetic-preservation.txt',fileKey:id('original_attachment'),hash:'fixture-hash',createdAt:at};
 for(const row of [sales,other,broadSales,viewer,programmer,production,pmc,finance,supplier,finished,engineering,readonly,singleOrderClerk,a,b,shared,inactive,oa,ob,os,loose,ownedOrder,t1,t2,t3,oldAttachment,{id:id('read_only_grant'),kind:'ar_access_grant',active:true,memberId:readonly.id,readOnly:true}])rawInsert(row);
 const attachmentBytes=new Uint8Array([68,79,79,78]);
 await globalThis.__testEnv.BUCKET.put(oldAttachment.fileKey,attachmentBytes);
 const preserved=structuredClone(rawRecords()),preservedIds=new Set(preserved.map(row=>row.id));
 const request=(action,body,who=sales,teamId='')=>identity.run(who?.kind==='member'?person(who):who,()=>api[body===undefined?'GET':'POST'](new Request('https://orders.test/api/workspace/'+action,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(teamId?{'X-Workspace-Team':teamId}:{})},body:body===undefined?undefined:JSON.stringify(body)}),{params:Promise.resolve({action:action.split('?')[0]})}));
 const read=async(action,who=sales,teamId='')=>{const response=await request(action,undefined,who,teamId),result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;};
 const save=async(body,who=sales,teamId='')=>{const response=await request('process-save',body,who,teamId),result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;};
 const deny=async(action,body,status,who=sales,teamId='')=>{const before=structuredClone(rawRecords()),response=await request(action,body,who,teamId);assert.equal(response.status,status,`${action}: ${await response.text()}`);assert.deepEqual(rawRecords(),before,'Rejected requests must be completely atomic');};
 const draft={type:'rfq',customerId:a.id,orderId:oa.id,teamId:t1.id,title:'Synthetic process request',batch:'B1',status:'待处理',inputBasis:'Synthetic requirement',inputVersion:'V1',details:{requirement:'Synthetic specification',quantity:10}};
 const mutable=record=>{const {id:recordId,version,type,customerId,orderId,teamId,title,batch,ownerId,responsibleId,plannedDate,actualDate,status,inputBasis,inputVersion,outputEvidence,gateStatus,blocker,nextAction,nextOwnerId,nextDueDate,notes,details}=record;return {id:recordId,version,type,customerId,orderId,teamId,title,batch,ownerId,responsibleId,plannedDate,actualDate,status,inputBasis,inputVersion,outputEvidence,gateStatus,blocker,nextAction,nextOwnerId,nextDueDate,notes,details};};

 await deny('process-data',undefined,401,null);
 await deny('process-save',draft,401,null);
 await deny('process-data',undefined,403,supplier);
 await deny('process-save',draft,403,supplier);
 await deny('process-data',undefined,403,sales,t3.id);
 await deny('process-data',undefined,403,admin,id('missing_team'));
 const token=crypto.randomUUID(),created=await save({...draft,token},sales,t1.id),record=created.record;
 assert.equal(record.kind,'process_record');assert.equal(record.type,'rfq');assert.equal(record.version,1);assert.equal(record.canEdit,true);
 const afterFirst=structuredClone(rawRecords()),repeat=await save({...draft,token},sales,t1.id);
 assert.equal(repeat.idempotent,true);assert.equal(repeat.record.id,record.id);assert.deepEqual(rawRecords(),afterFirst);
 await deny('process-save',{...draft,title:'Changed payload',token},409,sales,t1.id);
 const list=await read('process-data?type=rfq',sales,t1.id);
 assert(list.records.some(row=>row.id===record.id));assert(!list.orders.some(row=>row.id===ob.id));assert(list.customers.find(row=>row.id===a.id).orderKeys.includes(a.customerCode));
 assert(list.members.every(row=>Object.keys(row).every(key=>['id','name'].includes(key))));
 await deny('process-save',{...draft,customerId:b.id,orderId:ob.id,teamId:t2.id},403);
 await deny('process-history?id='+record.id,undefined,403,other);
 await deny('process-save',mutable(record),403,other);
 await deny('process-save',draft,403,broadSales);
 assert(!(await read('process-data',broadSales)).records.some(row=>row.id===record.id));
 for(const member of [production,pmc]){
  assert(!(await read('process-data',member)).records.some(row=>row.id===record.id));
  await deny('process-history?id='+record.id,undefined,403,member);
 }
 pass('流程记录按原客户和订单范围授权；负责人不扩权，全订单只读业务账号不能维护他人客户，幂等重试不重复创建');

 for(const member of [viewer,programmer,readonly]){
  const dto=await read('process-data',member);
  assert.equal(dto.canCreate,false);assert.deepEqual(dto.allowedKinds,[]);
  if(member.role==='admin')assert.equal(dto.records.find(row=>row.id===record.id).canEdit,false);
  else assert(!dto.records.some(row=>row.id===record.id));
  await deny('process-save',draft,403,member);
 }
 await deny('process-save',{...draft,type:'iqc',details:{}},403,sales);
 await deny('process-save',{...draft,type:'engineering-change',details:{}},403,pmc);
 await deny('process-save',{...draft,type:'warehouse',details:{}},403,finance);
 await deny('process-save',{...draft,type:'iqc',details:{}},403,finished);
 const packaging=(await save({...draft,type:'packaging',details:{quantity:10,cartons:1,packingSpec:'V1'}},finished)).record;
 assert.equal(packaging.type,'packaging');
 const change=(await save({...draft,type:'engineering-change',orderId:'',details:{previousVersion:'V1',newVersion:'V2',changeReason:'Synthetic revision'}},engineering)).record;
 assert.equal(change.type,'engineering-change');
 const reconciliation=(await save({...draft,type:'supplier-reconciliation',details:{supplierName:'Synthetic supplier',amount:12.34,currency:'CNY'}},finance)).record;
 assert.equal(reconciliation.type,'supplier-reconciliation');
 assert(!(await read('process-data',production)).records.some(row=>row.id===reconciliation.id));
 await deny('process-history?id='+reconciliation.id,undefined,403,production);
 for(const member of [viewer,programmer])assert.equal((await read('process-data',member)).records.find(row=>row.id===packaging.id).canEdit,false);
 const customerPackaging=(await save({...draft,type:'packaging',orderId:'',details:{}},admin)).record;
 assert(!(await read('process-data',singleOrderClerk)).records.some(row=>row.id===customerPackaging.id));
 await deny('process-history?id='+customerPackaging.id,undefined,403,singleOrderClerk);
 await deny('process-save',mutable(customerPackaging),403,singleOrderClerk);
 await deny('process-save',{...draft,type:'packaging',orderId:'',details:{}},403,singleOrderClerk);
 await deny('process-save',{...draft,type:'packaging',details:{}},403,singleOrderClerk);
 const ownPackaging=(await save({...draft,type:'packaging',orderId:ownedOrder.id,details:{}},singleOrderClerk)).record;
 assert.equal(ownPackaging.canEdit,true);
 pass('单笔订单访问不会升级为整个客户范围：客户级作业和同客户其他订单仍拒绝，仅可维护本人具体订单');
 pass('流程种类按现有角色和部门写入；只读成员、程序员及显式只读授权全部拒绝写入，工程与财务范围独立验证');

 // Two records for one customer are still distinct when explicitly linked to different teams.
 const sharedOne=(await save({...draft,customerId:shared.id,orderId:os.id},admin,t1.id)).record;
 const sharedTwo=(await save({...draft,customerId:shared.id,orderId:os.id,teamId:t2.id},admin,t2.id)).record;
 const grouped=await read('process-data',admin,t1.id);
 assert(grouped.records.some(row=>row.id===sharedOne.id));assert(!grouped.records.some(row=>row.id===sharedTwo.id));
 await deny('process-history?id='+sharedTwo.id,undefined,403,admin,t1.id);
 await deny('process-save',mutable(sharedTwo),403,admin,t1.id);
 await deny('process-save',{...draft,teamId:t2.id},403,admin,t1.id);
 await deny('process-save',{...draft,customerId:b.id},403,admin);
 await deny('process-save',{...draft,orderId:ob.id},403,admin);
 await deny('process-save',{...draft,customerId:inactive.id,orderId:'',teamId:''},403,admin);
 await deny('process-save',{...draft,customerId:'',orderId:''},400,admin);
 const ungrouped=(await save({...draft,type:'warehouse',customerId:'',orderId:loose.id,teamId:'',details:{}},pmc,'__ungrouped')).record;
 assert((await read('process-data',pmc,'__ungrouped')).records.some(row=>row.id===ungrouped.id));
 assert(!(await read('process-data',pmc,t1.id)).records.some(row=>row.id===ungrouped.id));
 pass('流程列表、历史和写入共同限制当前业务组；共享客户的两组记录不串组，未归组订单保留独立关联');

 await deny('process-save',{...draft,role:'admin'},400);
 await deny('process-save',{...draft,details:{unknown:'arbitrary'}},400);
 await deny('process-save',{...draft,details:{quantity:'10'}},400);
 await deny('process-save',{...draft,details:{quantity:-1}},400);
 await deny('process-save',{...draft,plannedDate:'2026-02-30'},400);
 await deny('process-save',{...draft,ownerId:other.id},400);
 await deny('process-save',{...draft,responsibleId:supplier.id},400);
 await deny('process-save',{...draft,nextOwnerId:id('missing')},400);
 await deny('process-save',{...draft,status:'受阻'},400);
 await deny('process-save',{...draft,gateStatus:'不适用'},400);
 await deny('process-save',{...mutable(record),orderId:'',token:crypto.randomUUID()},400);
 await deny('process-save',{...mutable(record),version:record.version+1},409);
 await deny('process-save',{...draft,status:'已完成'},400);
 const completion={...mutable(record),status:'已完成',actualDate:'2026-10-18',ownerId:sales.id,responsibleId:sales.id,outputEvidence:'Synthetic review reference',gateStatus:'待检'};
 await deny('process-save',completion,400);
 await deny('process-save',{...completion,gateStatus:'通过',blocker:'Still waiting'},400);
 const done=(await save({...completion,gateStatus:'不适用',details:{...record.details,gateReason:'Inquiry review does not require a physical QC inspection'}})).record;
 assert.equal(done.status,'已完成');assert.equal(done.version,2);
 await deny('process-save',completion,409);
 const history=await read('process-history?id='+record.id);
 assert.deepEqual(history.history.map(row=>row.version),[2,1]);assert.equal(history.history[1].snapshot.status,'待处理');
 assert(history.history.every(row=>row.kind==='process_record_revision'&&!('requestToken'in row)&&!('requestFingerprint'in row)));
 pass('严格字段白名单、真实日期及负责人原权限校验生效；完成门槛、不可改换关联与只增历史保护旧记录');

 const qualityDraft={...draft,type:'iqc',details:{inspectedQuantity:10,acceptedQuantity:8,rejectedQuantity:1}};
 await deny('process-save',qualityDraft,400,production);
 const quality=(await save({...qualityDraft,details:{inspectedQuantity:10,acceptedQuantity:10,rejectedQuantity:0}},production)).record;
 const qualityDone={...mutable(quality),status:'已完成',actualDate:'2026-10-18',ownerId:production.id,responsibleId:pmc.id,outputEvidence:'Synthetic IQC evidence',gateStatus:'通过'};
 await deny('process-save',{...qualityDone,details:{inspectedQuantity:10}},400,production);
 await save(qualityDone,production);
 await deny('process-save',{...qualityDone,id:undefined,version:undefined,type:'material-kit',details:{requiredQuantity:10,readyQuantity:9}},400,pmc);
 const doneBase={...draft,id:undefined,version:undefined,status:'已完成',actualDate:'2026-10-18',ownerId:sales.id,responsibleId:sales.id,outputEvidence:'Synthetic evidence',gateStatus:'通过'};
 for(const [type,details,who] of [
  ['sample',{sampleVersion:'V1',signoffRef:'Synthetic signoff'},sales],
  ['engineering-change',{newVersion:'V2',approvalRef:'Synthetic approval',impactScope:'Synthetic affected batch'},admin],
  ['shipment-release',{releaseRef:'Synthetic actual release document'},pmc],
  ['complaint',{cause:'Synthetic cause',correction:'Synthetic correction',verification:'Synthetic verification'},sales],
 ]){
  await deny('process-save',{...doneBase,type,details:{}},400,who);
  await save({...doneBase,type,details},who);
 }
 const race=await Promise.all([request('process-save',{...mutable(packaging),notes:'Synthetic concurrent A'},finished),request('process-save',{...mutable(packaging),notes:'Synthetic concurrent B'},finished)]);
 assert.deepEqual(race.map(response=>response.status).sort(),[200,409]);
 const packagingHistory=await read('process-history?id='+packaging.id,finished);assert.equal(packagingHistory.history.length,2);
 pass('检验数量与齐套数量不能误判完成；并发写入只有一个原子提交，冲突请求不留下半条记录或历史');

 const finalRecords=rawRecords();
 for(const previous of preserved)assert.deepEqual(finalRecords.find(row=>row.id===previous.id),previous,`Existing ${previous.kind}/${previous.id} must remain byte-equivalent`);
 const additions=finalRecords.filter(row=>!preservedIds.has(row.id));
 assert(additions.every(row=>['process_record','process_record_revision','audit'].includes(row.kind)));
 assert(additions.filter(row=>row.kind==='audit').every(row=>additions.some(target=>target.kind==='process_record'&&target.id===row.targetId)));
 const original=await globalThis.__testEnv.BUCKET.get(oldAttachment.fileKey);
 assert.deepEqual(new Uint8Array(await new Response(original.body).arrayBuffer()),attachmentBytes);
 const general=await read('data',admin);
 assert(!general.audits.some(row=>row.after?.kind==='process_record'),'Process audits must not bypass their authorization in general workspace audit feed');
 pass('端到端数据保全：所有既有类型、主键、关联、账号授权、历史及附件原件完整不变，仅增加独立流程记录、版本与审计');
}
