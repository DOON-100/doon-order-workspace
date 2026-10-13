import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {AsyncLocalStorage} from 'node:async_hooks';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

// Isolated, synthetic route regression: no production DB, files or account credentials.
const output=path.resolve('test-output','customer-workflow-json-'+process.pid);
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

const jsonForm=(bytes,title='合成JSON附件')=>{const f=new FormData();for(const [k,v] of Object.entries({token:token(),customerId,projectId:'',category:'公司资料',title,fileVersion:'V1',status:'有效',note:'JSON原件不可变验证'}))f.set(k,v);f.set('file',new File([bytes],'synthetic.json',{type:'application/json'}));return f;};
const bytes='{"markup":"<script>globalThis.executed=true</script>","number":123}';
await ok('customer-workflow-file-upload',jsonForm(bytes),user('clerk'));let file=raw().filter(r=>r.kind==='customer_workflow_attachment').map(r=>JSON.parse(r.data)).find(r=>r.filename==='synthetic.json');assert.equal(file.contentType,'text/plain');assert(file.createdAt&&file.createdBy===clerk.name);
let response=await call('customer-workflow-file?id='+file.id+'&preview=1',undefined,user('sales'));assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/^text\/plain/);assert.match(response.headers.get('content-security-policy'),/sandbox/);assert.equal(await response.text(),bytes);const oldFileKey=file.fileKey,oldHash=file.hash;
await ok('customer-workflow-file-save',{token:token(),customerId,projectId:'',category:'公司资料',title:file.title,fileVersion:'V1',status:'已归档',note:file.note,reason:'旧版归档原件保持',id:file.id,version:1},user('clerk'));
await ok('customer-workflow-file-save',{token:token(),customerId,projectId:'',category:'公司资料',title:file.title,fileVersion:'V1',status:'待确认',note:file.note,reason:'恢复待确认',id:file.id,version:2},user('clerk'));
file=current(file.id);assert.equal(file.fileKey,oldFileKey);assert.equal(file.hash,oldHash);response=await call('customer-workflow-file?id='+file.id,undefined,user('sales'));assert.equal(await response.text(),bytes);pass('JSON上传及原件/归档恢复保持hash；预览强制纯文本+sandbox，脚本内容不会作为HTML执行');
const large='x'.repeat(2*1024*1024+1);await ok('customer-workflow-file-upload',jsonForm(large,'大JSON'),user('clerk'));const big=raw().filter(r=>r.kind==='customer_workflow_attachment').map(r=>JSON.parse(r.data)).find(r=>r.title==='大JSON');await reject('customer-workflow-file?id='+big.id+'&preview=1',undefined,user('sales'),400);response=await call('customer-workflow-file?id='+big.id,undefined,user('sales'));assert.equal(response.status,200);assert.equal((await response.arrayBuffer()).byteLength,large.length);pass('超过2MiB不内嵌预览，但授权下载保留完整字节');
const filesBefore=bucketObjects.size;await reject('customer-workflow-file-upload',jsonForm('x'.repeat(20*1024*1024+1),'超限JSON'),user('clerk'),400);assert.equal(bucketObjects.size,filesBefore);await reject('customer-workflow-file?id='+file.id+'&preview=1',undefined,user('viewer'),403);pass('JSON沿用20MiB上限、权限与拒绝零写，未扩大文件访问范围');
await fs.writeFile(path.join(output,'result.json'),JSON.stringify({passed:checks.length,checks},null,2));console.log(JSON.stringify({passed:checks.length,report:path.join(output,'result.json')}));db.close();
