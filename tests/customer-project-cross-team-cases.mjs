// Two explicitly authorized teams may work on different projects for one customer.
// All records and workbook contents below are synthetic.
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';

export async function testCustomerProjectCrossTeam({api,put,state,one,records,ok,denied,followup,uuid,admin}){
 const customerId='cross-customer',customerName='Synthetic shared customer';
 const salesA={id:'cross-sales-a',kind:'member',name:'Synthetic group A sales',email:'a@example.invalid',role:'sales',active:true,customers:[customerName]};
 const salesB={...salesA,id:'cross-sales-b',name:'Synthetic group B sales',email:'b@example.invalid'};
 const serviceA={...salesA,id:'cross-service-a',name:'Synthetic group A service',email:'sa@example.invalid'};
 const serviceB={...salesA,id:'cross-service-b',name:'Synthetic group B service',email:'sb@example.invalid'};
 const outsider={...salesA,id:'cross-outsider',name:'Synthetic unauthorized teammate',email:'none@example.invalid',customers:[]};
 const customer={id:customerId,kind:'customer_account',customer:customerName,customerCode:'SYN-CROSS',salesName:salesA.name,serviceName:serviceA.name,salesMemberIds:[salesA.id,salesB.id],serviceMemberIds:[serviceA.id,serviceB.id],active:true,version:1};
 const teamA={id:'cross-team-a',kind:'customer_project_team',name:'Synthetic A',active:true,customerIds:[customerId],salesMemberIds:[salesA.id,outsider.id],leaderIds:[],serviceMemberIds:[serviceA.id]};
 const teamB={...teamA,id:'cross-team-b',name:'Synthetic B',salesMemberIds:[salesB.id],serviceMemberIds:[serviceB.id]};
 for(const r of [salesA,salesB,serviceA,serviceB,outsider,customer,teamA,teamB])put(r);
 const post=async(handler,action,input,actor=admin)=>{
  try{const result=await handler(action,new Request('https://synthetic.invalid/api/'+action,{method:'POST',body:input instanceof FormData?input:JSON.stringify(input)}),state(),actor);return {status:result.status,data:await result.json()};}catch(e){return {status:e.status||500,error:e.message};}
 };
 const success=async(...args)=>{const result=await post(...args);assert.equal(result.status,200,JSON.stringify(result));return result.data;};
 const projectInput={token:uuid(),customerId,title:'Shared customer project A',teamId:teamA.id,salesMemberId:salesA.id,serviceMemberIds:[serviceA.id]};
 const projectA=(await success(api.customerProjectPost,'customer-project-save',projectInput,salesA)).item;
 const projectB=(await success(api.customerProjectPost,'customer-project-save',{...projectInput,token:uuid(),title:'Shared customer project B',teamId:teamB.id,salesMemberId:salesB.id,serviceMemberIds:[serviceB.id]},salesB)).item;
 assert.equal(projectA.teamId,teamA.id);assert.equal(projectB.teamId,teamB.id);
 const sameTeamReviewer=await success(api.customerProjectPost,'customer-project-save',{...projectInput,token:uuid(),title:'Same team sales may review service work',serviceReviewerId:salesA.id},salesA);assert.equal(sameTeamReviewer.item.serviceReviewerId,salesA.id);
 assert.equal((await post(api.customerProjectPost,'customer-project-save',{...projectInput,token:uuid(),salesMemberId:salesB.id},salesA)).status,400);
 assert.equal((await post(api.customerProjectPost,'customer-project-save',{...projectInput,token:uuid(),salesReviewerId:salesB.id},salesA)).status,400);
 assert.equal((await post(api.customerProjectPost,'customer-project-save',{...projectInput,token:uuid(),serviceReviewerId:serviceB.id},salesA)).status,400);
 assert.equal((await post(api.customerProjectPost,'customer-project-save',{...projectInput,token:uuid(),salesMemberId:outsider.id},outsider)).status,403);
 // An unchanged historical assignment remains editable; moving teams requires a current valid assignment.
 put({...projectA,salesMemberId:salesB.id});
 await success(api.customerProjectPost,'customer-project-save',{...projectInput,token:uuid(),id:projectA.id,version:projectA.version,salesMemberId:salesB.id},admin);
 const newFollowup=async(owner)=> (await ok('save',{token:uuid(),...followup({ownerId:owner.id,customerId,title:'Shared customer daily followup'})},owner)).item;
 const fB=await newFollowup(salesB),promotion={token:uuid(),id:fB.id,version:fB.version,customerId,title:'Shared promotion B'};
 const promoted=await ok('promote',promotion,salesB);
 assert.equal(promoted.project.teamId,teamB.id);assert.deepEqual(promoted.project.serviceMemberIds,[serviceB.id]);
 const overlap={...teamB,id:'cross-team-overlap',serviceMemberIds:[serviceA.id,outsider.id]};put(overlap);
 const ambiguous=await newFollowup(salesB),ambiguousInput={token:uuid(),id:ambiguous.id,version:ambiguous.version,customerId,title:'Choose explicit team'};
 await denied('promote',ambiguousInput,salesB,400);
 await denied('promote',{...ambiguousInput,token:uuid(),teamId:teamA.id},salesB,400);
 const selected=await ok('promote',{...ambiguousInput,token:uuid(),teamId:overlap.id},salesB);
 assert.equal(selected.project.teamId,overlap.id);assert.deepEqual(selected.project.serviceMemberIds,[serviceA.id]);
 const data=await ok('data',undefined,salesB);assert.equal(data.projects.find(p=>p.id===selected.project.id).teamId,overlap.id);assert.equal(data.teams.find(t=>t.id===teamB.id).name,teamB.name);
 const unauthorized=await ok('data',undefined,outsider);assert.equal(unauthorized.customers.some(c=>c.id===customerId),false);assert.equal(unauthorized.teams.some(t=>t.id===teamA.id),false);
 assert.deepEqual(one(customerId),customer,'Project assignments must not rewrite customer responsibilities');
 console.log('PASS same customer cross-team projects, promotion ambiguity, team-specific responsibility and no implicit customer grants');

 const importRow={...followup({customerId,ownerId:salesA.id}),sourceId:'cross-source-row',source:{unchanged:'original'},sourceTitle:'Synthetic source'};delete importRow.ownerId;
 const payload={token:uuid(),format:'doon-customer-followup-v1',sourceKey:'cross-source',ownerId:salesA.id,followups:[importRow],mails:[{sourceId:'cross-source-mail',followupSourceIds:[importRow.sourceId],source:{body:'original'},subject:'Original shared mail'}],sourceFiles:[]};
 const imported=await ok('import',payload,admin),fid=imported.followups[0].id,mid=imported.mails[0].id;
 const legacy={...one(fid)};delete legacy.sourceOwnerId;put(legacy);
 const source=JSON.stringify(one(fid).source),sourceHash=one(fid).sourceHash;
 await ok('save',{token:uuid(),id:fid,version:1,...followup({ownerId:salesB.id,customerId,notes:'Transferred current work'})},admin);
 assert.equal(one(fid).sourceOwnerId,salesA.id);assert.equal(one(fid).ownerId,salesB.id);
 await ok('mail-classify',{token:uuid(),id:mid,version:1,followupIds:[fid]},admin);
 const reimport=await ok('import',{...payload,token:uuid()},admin);
 assert.deepEqual(reimport.created,{followups:0,mails:0,sourceFiles:0});assert.deepEqual(reimport.skipped,{followups:1,mails:1,sourceFiles:0});
 assert.equal(reimport.followups[0].id,fid);assert.equal(reimport.mails[0].id,mid);assert.equal(one(fid).ownerId,salesB.id);assert.equal(one(fid).notes,'Transferred current work');assert.equal(JSON.stringify(one(fid).source),source);assert.equal(one(fid).sourceHash,sourceHash);
 assert.equal((await ok('data',undefined,salesB)).mails.some(m=>m.id===mid),true);
 put({...customer,salesMemberIds:[salesB.id]});assert.equal((await ok('data',undefined,salesA)).mails.some(m=>m.id===mid),false);
 assert.equal((await ok('import',{...payload,token:uuid()},admin)).created.followups,0);put(customer);
 await denied('save',{token:uuid(),id:fid,version:one(fid).version,...followup({ownerId:salesB.id,customerId}),sourceOwnerId:salesB.id},admin,400);
 console.log('PASS legacy followup transfer preserves immutable source identity, mail links and reimport idempotency without widening access');

 // Exercise the actual workbook preview/commit, handoff and factory release handlers.
 for(const actor of [salesA,salesB]){
  const book=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet(Array.from({length:19},()=>[]).concat([['件号#','图纸编号','款号','色号','系列','材质','Front','中文前框','Insert','中文角花','Pad','中文叶子','Temple','中文金脾','House','中文底座','Cover','中文盖','Manchon / tip','胶脾','主架镜片','销售办数量','大货数量','单位','要求交货期','备注'],[1,'SYN-'+actor.id,'MODEL','BLACK','METAL','TI','Black','黑色','','','','','','','','','','','','','白片','',10,'副','2026-12-01','']]));
  XLSX.utils.book_append_sheet(book,sheet,'Synthetic order');
  const form=new FormData();form.set('file',new File([XLSX.write(book,{type:'array',bookType:'xlsx'})],'synthetic.xlsx'));form.set('customer',customerName);form.set('orderNo','SYN-'+actor.id);form.set('customerPO','PO-'+actor.id);
  const preview=await success(api.collaborationPost,'factory-order-table-preview',form,actor);await success(api.collaborationPost,'factory-order-table-commit',{id:preview.id},actor);
  let order=records().find(r=>r.kind==='order'&&r.orderNo==='SYN-'+actor.id);assert.equal(order.ownerEmail,actor.email);assert.equal(order.salesName,actor.name);
  order=(await success(api.collaborationPost,'workflow',{id:order.id,version:order.version,action:'submit-service'},actor)).item;assert.equal(order.salesName,actor.name);
  const service=actor===salesA?serviceA:serviceB;
  // Sales submission must leave service blank until the actual service handler takes over.
  assert.equal(order.serviceName,'');order=(await success(api.collaborationPost,'workflow',{id:order.id,version:order.version,action:'submit-pmc'},service)).item;assert.equal(order.serviceName,service.name);
  const factory={lineId:order.id,sourceEnglish:'Synthetic metal frame',chineseProcess:'合成工艺',action:'service-confirm'};
  await success(api.collaborationPost,'factory-order-save',factory,actor);
  assert.equal((await post(api.collaborationPost,'factory-order-save',{...factory,action:'release'},actor)).status,403);
  await success(api.collaborationPost,'factory-order-save',{...factory,action:'pmc-confirm'},admin);
  assert.equal((await post(api.collaborationPost,'factory-order-save',{...factory,action:'release'},admin)).status,409);
  const project=actor===salesA?projectA:projectB,prefix='release-'+actor.id,base={customerId,projectId:project.id,orderId:order.id,version:1,status:'checked',sourceRefs:[],lines:[{orderLineId:order.id,quantity:10,unitPrice:'10'}]};
  const pi={...base,id:prefix+'-pi',kind:'handoff_business_document',type:'pi',fields:{depositPercent:'30',currency:'USD'}};
  const drawing={...base,id:prefix+'-drawing',kind:'handoff_business_source',type:'engineering_drawing',fields:{}};
  const production={...base,id:prefix+'-production',kind:'handoff_business_source',type:'production_order',fields:{materialState:'物料齐备',purchaseState:'无需采购',receivableId:prefix+'-receivable'},sourceRefs:[{id:pi.id,version:1},{id:drawing.id,version:1}]};
  for(const row of [pi,drawing,production,{id:'handoff_business_production_review_policy',kind:'handoff_business_policy',version:1,drawingLeadMemberId:salesA.id,engineeringSupervisorMemberId:salesB.id},{id:prefix+'-lead',kind:'handoff_business_adoption_signature',sourceId:drawing.id,sourceVersion:1,policyVersion:1,reviewerRole:'drawing_lead',actorId:salesA.id,decision:'confirm'},{id:prefix+'-supervisor',kind:'handoff_business_adoption_signature',sourceId:drawing.id,sourceVersion:1,policyVersion:1,reviewerRole:'engineering_supervisor',actorId:salesB.id,decision:'confirm'},{id:prefix+'-receivable',kind:'service_record',type:'receivable',status:'active',customerId,orderId:order.id,details:{currency:'USD',amountCents:10000}},{id:prefix+'-receipt',kind:'service_receipt',recordId:prefix+'-receivable',entryType:'receipt',amountCents:3000,currency:'USD'}])put(row);
  const released=await success(api.collaborationPost,'factory-order-save',{...factory,action:'release'},admin);assert.equal(released.item.status,'已下发工厂');assert.equal(one(order.id).salesName,actor.name);assert.equal(one(order.id).serviceName,service.name);
 }
 const legacyOrder=records().find(r=>r.kind==='order'&&r.ownerEmail===salesB.email);
 put({...legacyOrder,salesName:'',serviceName:''});
 const named=(await success(api.collaborationPost,'workflow',{id:legacyOrder.id,version:legacyOrder.version,action:'submit-service'},salesB)).item;assert.equal(named.salesName,salesB.name);
 const retained=(await success(api.collaborationPost,'workflow',{id:named.id,version:named.version,action:'submit-service'},salesA)).item;assert.equal(retained.salesName,salesB.name,'An existing order responsibility must not be rewritten');
 console.log('PASS two teams create and issue actual internal orders with own responsibility; release still requires PMC and complete production evidence');
}
