import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {AsyncLocalStorage} from 'node:async_hooks';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

// Isolated, synthetic route regression: no production DB, files or account credentials.
const output=path.resolve('test-output','customer-workflow-tasks-'+process.pid);
await fs.mkdir(output,{recursive:true});
const db=new DatabaseSync(':memory:');
for(const name of (await fs.readdir('drizzle')).filter(name=>name.endsWith('.sql')).sort())db.exec(await fs.readFile(path.join('drizzle',name),'utf8'));
class Statement{
 constructor(sql,args=[]){this.sql=sql;this.args=args;}
 bind(...args){return new Statement(this.sql,args);}
 async first(){return db.prepare(this.sql).get(...this.args)||null;}
 async all(){return {results:db.prepare(this.sql).all(...this.args)};}
 async run(){return db.prepare(this.sql).run(...this.args);}
}
const identity=new AsyncLocalStorage();
globalThis.__directoryIdentity=identity;
globalThis.__directoryEnv={DB:{prepare:sql=>new Statement(sql),batch:async statements=>{
 db.exec('BEGIN');try{const result=statements.map(statement=>db.prepare(statement.sql).run(...statement.args));db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}
}},BUCKET:{put:async()=>{throw new Error('Directory save must not write attachments');},get:async()=>{throw new Error('Directory save must not read attachments');}}};
const outfile=path.join(output,'api.mjs');
await build({entryPoints:['app/api/workspace/[action]/route.ts'],outfile,bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@':process.cwd()},plugins:[{name:'directory-test-bindings',setup(builder){
 builder.onResolve({filter:/^cloudflare:workers$/},()=>({path:'cloudflare',namespace:'directory-test'}));
 builder.onResolve({filter:/chatgpt-auth$/},()=>({path:'auth',namespace:'directory-test'}));
 builder.onLoad({filter:/.*/,namespace:'directory-test'},args=>({contents:args.path==='auth'?'export async function getChatGPTUser(){return globalThis.__directoryIdentity.getStore()||null}':'export const env=globalThis.__directoryEnv;'}));
}}]});
const api=await import(pathToFileURL(outfile).href);
const user=role=>({userId:'directory_'+role,email:'directory_'+role+'@test.invalid',displayName:'合成'+role,fullName:'合成'+role});
const admin=user('admin');
async function call(action,body,actor=admin){
 const method=body===undefined?'GET':'POST',routeAction=action.split('?')[0];
 return identity.run(actor,()=>api[method](new Request('https://directory.test/api/workspace/'+action,{method,headers:body instanceof FormData?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)}),{params:Promise.resolve({action:routeAction})}));
}
async function ok(action,body,actor=admin){const response=await call(action,body,actor),result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;}
const raw=()=>db.prepare('SELECT id,kind,data FROM records ORDER BY id').all();
const current=id=>JSON.parse(db.prepare('SELECT data FROM records WHERE id=?').get(id).data);
const revision=()=>db.prepare("SELECT revision FROM workspace_revision WHERE id='main'").get().revision;
const insert=record=>db.prepare('INSERT INTO records(id,kind,data) VALUES(?,?,?)').run(record.id,record.kind,JSON.stringify(record));
const checks=[];
const bucketObjects=new Map();
globalThis.__directoryEnv.BUCKET={put:async(key,bytes)=>{bucketObjects.set(key,new Uint8Array(bytes));},get:async key=>{const bytes=bucketObjects.get(key);return bytes?{arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),body:bytes}:null;}};
function pass(name){checks.push(name);console.log('PASS '+name);}
function preserveOthers(before,exceptId){const after=new Map(raw().map(row=>[row.id,row]));for(const row of before)if(row.id!==exceptId)assert.deepEqual(after.get(row.id),row,'Unrelated record must remain byte-identical: '+row.id);}
async function denied(body,actor,status){const before=raw(),beforeRevision=revision(),response=await call('customer-save',body,actor);assert.equal(response.status,status,await response.text());assert.deepEqual(raw(),before);assert.equal(revision(),beforeRevision);}
const input=(record,extra={})=>({id:record.id,expectedVersion:record.version,customer:record.customer,customerCode:record.customerCode,salesName:record.salesName,serviceName:record.serviceName,pmcName:record.pmcName,notes:record.notes,active:record.active,...extra});

await ok('enroll',{});
for(const role of ['sales','clerk','finance','pmc','sales2','sales3','viewer']){await ok('member',{name:user(role).displayName,email:user(role).email,role:role.startsWith('sales')?'sales':role,customers:[],active:true});await ok('enroll',{},user(role));}
const members=raw().filter(row=>row.kind==='member').map(row=>JSON.parse(row.data));
const member=role=>members.find(m=>m.email===user(role).email),sales=member('sales'),clerk=member('clerk'),sales2=member('sales2'),sales3=member('sales3');
const stamp='2026-10-01T00:00:00.000Z';
insert({id:'cw_customer',kind:'customer_account',customer:'合成客户',customerCode:'TEST001',salesName:sales.name,serviceName:clerk.name,pmcName:'原PMC保持',salesMemberIds:[sales.id],serviceMemberIds:[clerk.id],quoteMemberIds:[],active:true,notes:'原始备注保持',directory:{country:'测试国家',grade:'AA',bucket:'现有合作'},version:1,createdAt:stamp,updatedAt:stamp,updatedBy:'合成原始作者'});
insert({id:'cw_project',kind:'customer_project',customerId:'cw_customer',code:'SYNTH-P1',title:'合成项目',description:'原需求原文不可改',status:'active',version:1,createdAt:stamp});
insert({id:'cw_unrelated',kind:'synthetic_unrelated',payload:'  保留\n原文 ',nested:{value:3}});
const customerId='cw_customer',workflow=()=>raw().filter(r=>r.kind==='customer_workflow_state').map(r=>JSON.parse(r.data)).find(r=>r.customerId===customerId),profile=()=>raw().filter(r=>r.kind==='customer_workflow_profile').map(r=>JSON.parse(r.data)).find(r=>r.customerId===customerId);
const token=()=>crypto.randomUUID(),common=()=>({token:token(),customerId,version:workflow()?.version||0,customerVersion:current(customerId).version});
async function reject(action,body,who,status){const before=raw(),rev=revision(),response=await call(action,body,who);assert.equal(response.status,status,await response.text());assert.deepEqual(raw(),before);assert.equal(revision(),rev);}

const save=(extra={})=>({token:token(),version:0,customerId,title:'合成独立任务',ownerId:sales.id,due:'2026-10-20',status:'待接手',result:'',notes:'合成客户任务私密正文',...extra});
const baseline=raw(),oldCustomers=raw().filter(r=>r.kind==='customer_account'),oldMembers=raw().filter(r=>r.kind==='member');
let feed=await ok('customer-workflow-tasks',undefined,user('sales'));assert.equal(feed.tasks.length,0);assert.deepEqual(raw(),baseline);
await reject('customer-workflow-tasks?customerId='+customerId,undefined,user('sales2'),403);
await reject('customer-workflow-task-save',save({ownerId:sales2.id}),user('sales'),403);
await reject('customer-workflow-task-save',save({ownerId:sales2.id}),admin,403);
await reject('customer-workflow-task-save',save({due:'2026-02-30'}),user('sales'),400);
await reject('customer-workflow-task-save',save({status:'完成'}),user('sales'),400);
pass('读取无写入；未授权客户/任务分配/无效日期/无依据完成全部拒绝且零写');
const first=save();let item=(await ok('customer-workflow-task-save',first,user('sales'))).item;const firstRows=raw();await ok('customer-workflow-task-save',first,user('sales'));assert.deepEqual(raw(),firstRows);assert.equal(item.ownerId,sales.id);assert.equal(item.owner,sales.name);
assert.equal((await ok('customer-workflow-tasks',undefined,user('clerk'))).tasks.length,0);
const privateText='合成客服任务仅负责销售可协作';let serviceTask=(await ok('customer-workflow-task-save',save({title:'合成客服任务',ownerId:clerk.id,notes:privateText}),user('clerk'))).item;
assert.equal((await ok('customer-workflow-tasks',undefined,user('sales'))).tasks.length,2);assert.equal((await ok('customer-workflow-tasks',undefined,user('clerk'))).tasks.length,1);
await reject('customer-workflow-task-save',save({id:item.id,version:item.version,title:'越权客服改销售'}),user('clerk'),403);
await reject('customer-workflow-task-save',save({id:serviceTask.id,version:serviceTask.version,ownerId:sales.id}),user('sales'),403);
await reject('customer-workflow-task-save',save({id:serviceTask.id,version:serviceTask.version,ownerId:clerk.id,customerId:''}),user('clerk'),403);
pass('本人创建/负责人固定；负责销售协作客户任务，客服仅本人；不能改关联客户绕权限');
serviceTask=(await ok('customer-workflow-task-save',save({id:serviceTask.id,version:1,ownerId:clerk.id,title:serviceTask.title,status:'完成',result:'合成完成依据',notes:privateText}),user('sales'))).item;
await reject('customer-workflow-task-save',save({id:serviceTask.id,version:1,ownerId:clerk.id}),user('sales'),409);
const history=await ok('customer-workflow-task-history?id='+serviceTask.id,undefined,user('clerk'));assert.deepEqual(history.revisions.map(r=>r.version),[2,1]);assert.equal(history.revisions[1].snapshot.status,'待接手');assert.equal(history.revisions[0].snapshot.result,'合成完成依据');
assert.deepEqual(raw().filter(r=>r.kind==='customer_account'),oldCustomers);assert.deepEqual(raw().filter(r=>r.kind==='member'),oldMembers);
const generic=JSON.stringify(await ok('data',undefined,user('sales2')));assert(!generic.includes(privateText));assert(!generic.includes('合成客户任务私密正文'));
pass('严格版本拒绝覆盖、持久化完成依据、每版原文历史；旧客户/成员不变、通用data不泄正文');
const unlinked=(await ok('customer-workflow-task-save',save({customerId:'',ownerId:sales2.id,title:'未关联的本人任务'}),user('sales2'))).item;
assert.equal((await ok('customer-workflow-tasks',undefined,user('sales'))).tasks.some(t=>t.id===unlinked.id),false);
await reject('customer-workflow-task-history?id='+unlinked.id,undefined,user('sales'),403);
pass('未关联客户任务仍真实保存，只有本人和管理员可见');
await ok('customer-workflow-primary',{...common(),to:sales.id,reason:'合成确认责任'});
await ok('customer-workflow-handoff',{...common(),to:sales2.id,reason:'合成移交未完任务'},user('sales'));
const handoff=raw().filter(r=>r.kind==='customer_workflow_handoff').map(r=>JSON.parse(r.data))[0];
await ok('customer-workflow-accept',{...common(),id:handoff.id,requestVersion:1,note:'本人接收'},user('sales2'));
assert.equal(current(item.id).ownerId,sales2.id);assert.equal(current(item.id).version,2);assert.equal(current(serviceTask.id).ownerId,clerk.id);assert.equal(current(serviceTask.id).status,'完成');
assert.equal((await ok('customer-workflow-transfers',undefined,user('sales2'))).tasks.some(t=>t.id===item.id),true);
assert.equal((await ok('customer-workflow-task-history?id='+item.id,undefined,user('sales2'))).revisions.find(r=>r.version===1).snapshot.ownerId,sales.id);
pass('指定接收人接受客户时同事务转未完原负责人任务；完成项与其他协作人任务不变');
const linked=current(customerId);db.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify({...linked,salesMemberIds:linked.salesMemberIds.filter(id=>id!==sales2.id),salesName:sales.name}),customerId);
await reject('customer-workflow-tasks?customerId='+customerId,undefined,user('sales2'),403);
await reject('customer-workflow-task-history?id='+item.id,undefined,user('sales2'),403);
await reject('customer-workflow-task-save',save({id:item.id,version:2,ownerId:sales2.id}),user('sales2'),403);
assert.equal((await ok('customer-workflow-tasks',undefined,user('sales2'))).tasks.some(t=>t.id===item.id),false);
pass('责任撤销立即隐藏任务及历史；任务owner不能保留已撤销客户权限');
// Admin rebinding is versioned and cannot expose a former customer's snapshot.
insert({id:'other_customer',kind:'customer_account',customer:'合成另一客户',customerCode:'OTHER',salesName:sales2.name,salesMemberIds:[sales2.id],serviceMemberIds:[],quoteMemberIds:[],active:true,version:1});
item=(await ok('customer-workflow-task-save',save({id:item.id,version:2,customerId:'other_customer',ownerId:sales2.id,notes:'新客户独立说明'}))).item;
const rebound=await ok('customer-workflow-task-history?id='+item.id,undefined,user('sales2'));assert.deepEqual(rebound.revisions.map(r=>r.version),[3]);
assert.equal((await ok('customer-workflow-task-history?id='+item.id)).revisions.length,3);
pass('管理员改关联客户保留全历史，新的客户范围不泄漏此前客户版本');
// Inject a write error inside the actual database transaction, not a mock success.
const beforeFail=raw(),revFail=revision();db.exec("CREATE TRIGGER task_test_abort BEFORE INSERT ON records WHEN NEW.kind='customer_workflow_task_revision' BEGIN SELECT RAISE(ABORT,'synthetic task atomic failure'); END;");
const failed=await call('customer-workflow-task-save',save({title:'事务必须回滚'}),user('sales'));assert.equal(failed.status,500);assert.deepEqual(raw(),beforeFail);assert.equal(revision(),revFail);db.exec('DROP TRIGGER task_test_abort');
pass('任务/版本快照/审计同事务；数据库中途失败无部分任务和revision写入');
await fs.writeFile(path.join(output,'result.json'),JSON.stringify({passed:checks.length,checks},null,2));console.log(JSON.stringify({passed:checks.length,report:path.join(output,'result.json')}));db.close();
