import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {AsyncLocalStorage} from 'node:async_hooks';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

// Isolated, synthetic route regression: no production DB, files or account credentials.
const output=path.resolve('test-output','customer-directory-'+process.pid);
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
 const method=body===undefined?'GET':'POST';
 return identity.run(actor,()=>api[method](new Request('https://directory.test/api/workspace/'+action,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),{params:Promise.resolve({action})}));
}
async function ok(action,body,actor=admin){const response=await call(action,body,actor),result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;}
const raw=()=>db.prepare('SELECT id,kind,data FROM records ORDER BY id').all();
const current=id=>JSON.parse(db.prepare('SELECT data FROM records WHERE id=?').get(id).data);
const revision=()=>db.prepare("SELECT revision FROM workspace_revision WHERE id='main'").get().revision;
const insert=record=>db.prepare('INSERT INTO records(id,kind,data) VALUES(?,?,?)').run(record.id,record.kind,JSON.stringify(record));
const checks=[];
function pass(name){checks.push(name);console.log('PASS '+name);}
function preserveOthers(before,exceptId){const after=new Map(raw().map(row=>[row.id,row]));for(const row of before)if(row.id!==exceptId)assert.deepEqual(after.get(row.id),row,'Unrelated record must remain byte-identical: '+row.id);}
async function denied(body,actor,status){const before=raw(),beforeRevision=revision(),response=await call('customer-save',body,actor);assert.equal(response.status,status,await response.text());assert.deepEqual(raw(),before);assert.equal(revision(),beforeRevision);}
const input=(record,extra={})=>({id:record.id,expectedVersion:record.version,customer:record.customer,customerCode:record.customerCode,salesName:record.salesName,serviceName:record.serviceName,pmcName:record.pmcName,notes:record.notes,active:record.active,...extra});

await ok('enroll',{});
for(const role of ['pmc','sales','clerk','finance','viewer','programmer','production']){await ok('member',{name:user(role).displayName,email:user(role).email,role,customers:[],active:true});await ok('enroll',{},user(role));}
const members=raw().filter(row=>row.kind==='member').map(row=>JSON.parse(row.data));
const sales=members.find(member=>member.role==='sales');
const stamp='2026-10-01T00:00:00.000Z';
const base={kind:'customer_account',customerCode:'',salesName:sales.name,serviceName:'',pmcName:'',salesMemberIds:[sales.id],serviceMemberIds:[],quoteMemberIds:[],active:true,notes:'合成原始备注，不可丢失',version:1,createdAt:stamp,updatedAt:stamp,updatedBy:'合成原始作者'};
insert({...base,id:'directory_existing',customer:'目录合成客户甲',directory:{country:'原国家',grade:'AA',qualityGrade:'原品质要求',productDifficulty:'原难度',bucket:'现有合作',focus:false,registeredOn:'2024-02-29',handoffOn:''}});
insert({...base,id:'directory_legacy',customer:'目录合成旧客户乙'});
insert({...base,id:'directory_inactive',customer:'目录合成停用客户丙',active:false});
insert({id:'directory_opaque',kind:'directory_fixture',text:'原始合成资料\n换行与空格保留  ',nested:{unrelated:true}});
const original=raw(),originalRevision=revision();
const data=await ok('data');assert(!('directory' in data.customerAccounts.find(row=>row.id==='directory_legacy')));assert.deepEqual(raw(),original);assert.equal(revision(),originalRevision);
pass('读取不会补默认目录字段、迁移或修改任一旧记录');

let record=current('directory_existing'),before=raw();
const oldDirectory=structuredClone(record.directory);
let result=await ok('customer-save',input(record,{expectedVersion:undefined,notes:record.notes+'；旧客户端追加备注'}));
assert.deepEqual(result.item.directory,oldDirectory);assert.deepEqual(result.item.salesMemberIds,record.salesMemberIds);assert.deepEqual(result.item.quoteMemberIds,record.quoteMemberIds);preserveOthers(before,record.id);
pass('旧客户端省略directory时完整保留现有目录、责任名单及其他原始记录');

record=current(record.id);before=raw();
result=await ok('customer-save',input(record,{directory:{country:'新国家',focus:null}}),user('pmc'));
assert.deepEqual(result.item.directory,{...oldDirectory,country:'新国家',focus:null});
for(const field of ['customer','customerCode','salesName','serviceName','pmcName','salesMemberIds','serviceMemberIds','quoteMemberIds','notes','active','createdAt'])assert.deepEqual(result.item[field],record[field]);
preserveOthers(before,record.id);
pass('PMC可维护目录局部字段，遗漏字段原样保留，业务资料及责任权限不变');

record=current(record.id);
for(const directory of [{registeredOn:'2099-01-01'},{handoffOn:'2099-01-01'},{gradeStatus:'auto-verified'},{registeredOn:'2026-02-30'},{handoffOn:'2026/10/13'},{registeredOn:'2025-02-29'},{grade:'D'},{bucket:'陌生分组'},{focus:'true'},{country:'字'.repeat(161)},{qualityGrade:'字'.repeat(81)},{productDifficulty:'字'.repeat(81)},{contactEmail:'forbidden@test.invalid'},null])await denied(input(record,{directory}),admin,400);
pass('无效日期、枚举、类型、超长字段及目录未知键均拒绝，失败无任何写入');

for(const role of ['sales','clerk','finance','viewer','programmer','production'])await denied(input(record,{directory:{grade:'AAA'}}),user(role),403);
await denied(input(record,{directory:{grade:'AAA'}}),null,401);
pass('非管理员/PMC及匿名请求不能维护目录');

await denied(input(record,{directory:{country:'不能提交'},salesName:'尝试改负责人'}),user('pmc'),403);
await denied(input(record,{directory:{country:'不能提交'},salesMemberIds:[]}),user('pmc'),403);
await denied(input(current('directory_inactive'),{directory:{country:'不能提交'},active:true}),user('pmc'),403);
pass('目录维护未放开PMC修改责任人、责任名单或重新启用权限');

await denied(input(record,{expectedVersion:record.version-1,directory:{country:'过期值'}}),admin,409);
pass('目录编辑仍拒绝旧版本，冲突无部分写入');

await denied(input(record,{expectedVersion:undefined,directory:{country:'无版本值'}}),admin,409);
await denied(input(record,{expectedVersion:undefined,directory:{}}),user('pmc'),409);
await denied(input(current('directory_legacy'),{expectedVersion:undefined,directory:{grade:'待核查'}}),admin,409);
pass('所有既有客户显式维护directory必须带expectedVersion，空对象及首次补目录也不得绕过');

before=raw();record=current('directory_legacy');
result=await ok('customer-save',input(record,{notes:record.notes+'；仍无目录'}));
assert(!('directory' in result.item));preserveOthers(before,record.id);
pass('旧数据在普通保存后也不凭空增加目录默认值');

record=current('directory_existing');before=raw();
result=await ok('customer-save',input(record,{directory:{country:'',registeredOn:'',handoffOn:'2024-02-29',focus:true}}));
assert.equal(result.item.directory.country,'');assert.equal(result.item.directory.registeredOn,'');assert.equal(result.item.directory.handoffOn,'2024-02-29');assert.equal(result.item.directory.grade,'AA');preserveOthers(before,record.id);
pass('显式留空和有效闰日可保存，未提供字段仍保留');

before=raw();
result=await ok('customer-save',{createOnly:true,customer:'目录合成新增客户',directory:{country:'测试国家',grade:'待核查',bucket:'潜力／在谈',focus:null,registeredOn:'2026-10-13'}});
assert.equal(result.item.directory.grade,'待核查');for(const field of ['salesMemberIds','serviceMemberIds','quoteMemberIds'])assert.deepEqual(result.item[field]||[],[]);preserveOthers(before,result.item.id);
await denied({createOnly:true,customer:'目录合成新增客户',directory:{grade:'AAA'}},admin,409);
pass('新增目录遵循createOnly和原审计路径，不创建责任授权且不覆盖重名客户');

for(const member of members)assert.deepEqual(current(member.id),member);
assert.deepEqual(current('directory_opaque'),JSON.parse(original.find(row=>row.id==='directory_opaque').data));
await build({entryPoints:['lib/customer-directory.ts'],outfile:path.join(output,'directory-helper.mjs'),bundle:true,platform:'node',format:'esm',packages:'external'});
const {customerDirectorySourceCode}=await import(pathToFileURL(path.join(output,'directory-helper.mjs')).href);
assert.equal(customerDirectorySourceCode('合成备注 [20261231交接核查:SYN-A_10] 待核查'),'SYN-A_10');
assert.equal(customerDirectorySourceCode('[20000101交接核查:C000]'),'C000');
for(const value of ['SYN-A_10','[2026123交接核查:SYN-A_10]','[20261231交接核查:../secret]','[20261231交接核查:bad name]','[20261231交接核查:'+('A'.repeat(41))+']','[20261231交接核查:<script>]'])assert.equal(customerDirectorySourceCode(value),'');
pass('来源编号只读取通用八位日期显式备注标记，安全编码字符且长度受限，不含任何真实客户特例或名称推断');

const report={passed:checks.length,checks,at:new Date().toISOString(),scope:'synthetic in-memory database only; no production access',output,memberRecordsUnchanged:members.length,attachmentsTouched:0};
await fs.writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2));
db.close();console.log(JSON.stringify({passed:checks.length,report:path.join(output,'result.json')}));
