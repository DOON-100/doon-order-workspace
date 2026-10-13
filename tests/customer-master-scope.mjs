import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {AsyncLocalStorage} from 'node:async_hooks';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

// Isolated, synthetic route regression: no production DB, files or account credentials.
const output=path.resolve('test-output','customer-master-scope-'+process.pid);
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
for(const role of ['sales','clerk','pmc','finance','viewer']){await ok('member',{name:user(role).displayName,email:user(role).email,role,customers:[],active:true});await ok('enroll',{},user(role));}
const members=raw().filter(r=>r.kind==='member').map(r=>JSON.parse(r.data)),sales=members.find(m=>m.role==='sales'),clerk=members.find(m=>m.role==='clerk');
const second={id:'scope_other_sales',kind:'member',userId:'scope_other',email:'scope_other@test.invalid',name:'合成第二业务',role:'sales',customers:[],active:true};insert(second);
const make=(id,extra={})=>({id,kind:'customer_account',customer:'合成客户'+id,customerCode:'SCOPE-'+id,salesName:sales.name,serviceName:clerk.name,pmcName:'',salesMemberIds:[sales.id],serviceMemberIds:[clerk.id],quoteMemberIds:[sales.id],active:true,notes:'保留原始备注',directory:{grade:'A',country:'原国家'},version:1,createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-01T00:00:00Z',...extra});
insert(make('own'));insert(make('other',{salesName:second.name,serviceName:'',salesMemberIds:[second.id],serviceMemberIds:[]}));insert(make('inactive',{active:false}));insert({id:'unrelated',kind:'preserve_test',text:'原始\n内容  '});
const originalMembers=raw().filter(r=>r.kind==='member'),unrelated=current('unrelated');
let before=raw();let rights=await ok('customer-master-capabilities',undefined,user('sales'));assert(rights.create);assert(rights.customers.find(c=>c.id==='own')?.master);assert(!rights.customers.some(c=>c.id==='other'));assert.deepEqual(raw(),before);
for(const role of ['finance','viewer'])assert.equal((await ok('customer-master-capabilities',undefined,user(role))).create,false);
pass('只读 capabilities 仅返回已负责客户维护权限；财务/查看角色不因可读而获写入');
let mine=current('own');let saved=(await ok('customer-save',input(mine,{customer:'合成新客户名称',customerCode:'NEW-SCOPE'}),user('sales'))).item;
assert(raw().some(r=>r.kind==='customer_workflow_identity'));assert.deepEqual(saved.salesMemberIds,mine.salesMemberIds);assert.deepEqual(saved.serviceMemberIds,mine.serviceMemberIds);assert.deepEqual(saved.quoteMemberIds,mine.quoteMemberIds);
await denied(input(current('other'),{salesName:sales.name,salesMemberIds:[sales.id]}),user('sales'),403);
await denied(input(current('inactive')),user('sales'),403);
await denied(input(saved,{expectedVersion:undefined}),user('sales'),409);await denied(input(saved,{expectedVersion:saved.version-1}),user('clerk'),409);
pass('本人客户改名改编号留身份历史；他人/停用客户及缺版本或旧版本全部拒绝零写');
let after=(await ok('customer-save',input(saved,{salesName:second.name,salesMemberIds:[second.id],serviceMemberIds:[]}),user('clerk'))).item;
assert(after.salesMemberIds.includes(sales.id)&&after.salesMemberIds.includes(second.id));assert.deepEqual(after.serviceMemberIds,[clerk.id]);assert.deepEqual(after.quoteMemberIds,[sales.id]);
await denied(input(after,{quoteMemberIds:[clerk.id]}),user('clerk'),403);await denied(input(after,{active:false}),user('sales'),403);await denied(input(after,{directory:{grade:'AAA'}}),user('clerk'),403);await denied(input(after,{serviceName:'未确认同名员工'}),user('sales'),409);
pass('业务客服责任调整追加并保留既有协作；不得授报价专权/停用/改评级/猜测责任人');
const created=(await ok('customer-save',{createOnly:true,customer:'合成本人新客',customerCode:'SELF-NEW',salesName:sales.name,salesMemberIds:[sales.id],serviceName:'',pmcName:'',workflow:{profile:{contactPerson:'合成联系人'},next:'联系本人客户',nextDate:'2026-10-20'}},user('sales'))).item;
assert.deepEqual(created.salesMemberIds,[sales.id]);assert.deepEqual(created.serviceMemberIds,[]);assert(raw().some(r=>r.kind==='customer_workflow_profile'&&JSON.parse(r.data).customerId===created.id));
const createdService=(await ok('customer-save',{createOnly:true,customer:'合成客服本人新客',serviceName:clerk.name,serviceMemberIds:[clerk.id]},user('clerk'))).item;assert.deepEqual(createdService.serviceMemberIds,[clerk.id]);
await denied({createOnly:true,customer:'不能替他人建客',salesName:second.name},user('sales'),403);await denied({createOnly:true,customer:'不能额外授权',salesName:sales.name,salesMemberIds:[sales.id,second.id]},user('sales'),403);await denied({createOnly:true,customer:'不能报价扩权',salesName:sales.name,quoteMemberIds:[second.id]},user('sales'),403);await denied({createOnly:true,customer:'PMC不能新建'},user('pmc'),403);
pass('新建业务/客服客户仅本人责任，补充资料同事务；不能替他人创建或新增无关授权');
const xlsx=await import('xlsx');const workbook=rows=>{const b=xlsx.utils.book_new();xlsx.utils.book_append_sheet(b,xlsx.utils.aoa_to_sheet([['客户','客户编码','业务员','客服','PMC','备注','当前版本'],...rows]),'合成导入');const f=new FormData();f.set('file',new File([xlsx.write(b,{type:'array',bookType:'xlsx'})],'synthetic-scope.xlsx'));return f;};
async function reject(action,body,actor,status){const b=raw(),rev=revision(),r=await call(action,body,actor);assert.equal(r.status,status,await r.text());assert.deepEqual(raw(),b);assert.equal(revision(),rev);}
mine=current('own');await reject('customer-import',workbook([[mine.customer,mine.customerCode,mine.salesName,mine.serviceName,'','可改',mine.version],['合成客户other','SCOPE-other',sales.name,'','','抢客',1]]),user('clerk'),403);
await reject('customer-import',workbook([[mine.customer,mine.customerCode,mine.salesName,mine.serviceName,'','缺版本','']]),user('clerk'),409);
await ok('customer-import',workbook([[mine.customer,'IMPORT-SCOPE',mine.salesName,mine.serviceName,'','合成导入修改',mine.version]]),user('clerk'));assert.equal(current('own').customerCode,'IMPORT-SCOPE');assert(current('own').salesMemberIds.includes(sales.id));
pass('客户导入逐行校验本人范围及版本，越权混合批次或缺版本整批零写，合法导入保留历史身份');
await reject('kingdee-template',new FormData(),user('sales'),403);await reject('kingdee-template',new FormData(),user('clerk'),403);
assert.deepEqual(raw().filter(r=>r.kind==='member'),originalMembers);assert.deepEqual(current('unrelated'),unrelated);
pass('客户维护不改变账号或其他记录，业务客服不能因主档权限获得金蝶模板上传权');
await fs.writeFile(path.join(output,'result.json'),JSON.stringify({passed:checks.length,checks},null,2));console.log(JSON.stringify({passed:checks.length,report:path.join(output,'result.json')}));db.close();
