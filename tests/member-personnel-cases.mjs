import assert from 'node:assert/strict';

export async function testMemberPersonnel({ok,call,state,clerk,pass}){
 const input={name:'SYN外部协作者',email:'personnel@test.invalid',role:'viewer',personnelType:'external',customers:[],departments:[],orderScope:'assigned',active:true};
 await ok('member',input);
 let member=(await state()).members.find(m=>m.email===input.email);
 assert.equal(member.personnelType,'external');
 assert.equal((await call('member',{...member,personnelType:'internal'},clerk)).status,403);
 assert.equal((await call('member',{...member,personnelType:'invalid'})).status,400);
 await ok('member',{...member,personnelType:'internal'});
 const updated=(await state()).members.find(m=>m.id===member.id);
 assert.deepEqual({...updated,personnelType:'external'},member,'分类变更不得更改原业务角色、客户、部门、标识及状态');
 await ok('member',{...updated,personnelType:'external'});
 const {personnelType,...oldClient}=updated;await ok('member',{...oldClient,name:'SYN旧客户端保存'});
 member=(await state()).members.find(m=>m.id===member.id);assert.equal(member.personnelType,'external','未携带分类的旧请求不得把外部成员改回内部');
 pass('人员类型独立保存、限管理员修改、严格校验，旧请求保留外部分类和原业务权限');
}
