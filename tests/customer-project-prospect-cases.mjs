import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
export async function testCustomerProjectProspects({ok,call,rawInsert,rawRecords,pass}){
 const stamp=randomUUID(),at=new Date().toISOString(),user={userId:'prospect-'+stamp,email:stamp+'@test.invalid',displayName:'合成潜客业务',fullName:'合成潜客业务'};
 const owner={id:'prospect-member-'+stamp,kind:'member',userId:user.userId,email:user.email,name:user.displayName,role:'sales',personnelType:'internal',active:true,customers:[],createdAt:at};
 const outside={...owner,id:'prospect-external-'+stamp,userId:'external-'+stamp,email:'external-'+stamp+'@test.invalid',personnelType:'external'};
 const team={id:'prospect-team-'+stamp,kind:'customer_project_team',name:'合成潜客组',leaderIds:[],salesMemberIds:[owner.id],serviceMemberIds:[],customerIds:[],active:true,version:1};
 rawInsert(owner);rawInsert(outside);rawInsert(team);
 const originals=rawRecords().filter(r=>r.id!==team.id),body={token:randomUUID(),customerName:'无编号合成潜客-'+stamp,title:'合成开发项目',teamId:team.id,description:'先确认图纸'};
 const result=await ok('customer-project-prospect-create',body,user),project=result.item;
 assert.equal(project.code,'');assert.equal(project.salesMemberId,owner.id);
 const customer=rawRecords().find(r=>r.id===project.customerId);assert.equal(customer.customerCode,'');assert.equal(customer.customer,body.customerName);assert.deepEqual(customer.salesMemberIds,[owner.id]);
 assert(rawRecords().find(r=>r.id===team.id).customerIds.includes(customer.id));
 assert.equal((await ok('customer-project-prospect-create',body,user)).item.id,project.id);
 const duplicate=await call('customer-project-prospect-create',{...body,token:randomUUID()},user);assert.equal(duplicate.status,409);
 const extUser={userId:outside.userId,email:outside.email,displayName:outside.name};assert.equal((await call('customer-project-prospect-create',{...body,token:randomUUID(),customerName:'外部不应建档'},extUser)).status,403);
 const unknown=await call('customer-project-prospect-create',{...body,token:randomUUID(),teamId:'other-team'},user);assert.equal(unknown.status,403);
 const feed=await ok('customer-project-data',undefined,user);assert(feed.projects.some(r=>r.id===project.id));
 const workers=await ok('project-collaboration-data?projectId='+encodeURIComponent(project.id),undefined,user);assert(!workers.members.some(r=>r.id===outside.id));assert(workers.members.some(r=>r.id===owner.id));
 const task={token:randomUUID(),version:0,projectId:project.id,roundId:'',stepKey:'directory',department:'other',ownerId:outside.id,title:'合成具体要求',description:'',dueDate:'',reason:''};
 assert.equal((await call('project-collaboration-save',task,user)).status,403);
 const assigned=await ok('project-collaboration-save',{...task,token:randomUUID(),ownerId:owner.id},user);assert.equal(assigned.item.ownerId,owner.id);assert.equal(assigned.item.title,task.title);
 const finalRecords=new Map(rawRecords().map(r=>[r.id,r]));for(const old of originals)assert.deepEqual(finalRecords.get(old.id),old);
 pass('无编号潜客与项目原子建档、组归属及主责明确；重复提交不重复建档，同名冲突与跨组/外部写入拒绝，旧记录不变且指派排除外部成员');
}
