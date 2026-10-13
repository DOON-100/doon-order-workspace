import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {AsyncLocalStorage} from 'node:async_hooks';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

// Isolated, synthetic route regression: no production DB, files or account credentials.
const output=path.resolve('test-output','customer-identity-'+process.pid);
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
const stamp='2026-10-01T00:00:00.000Z',customerId='identity_customer';
const account={id:customerId,kind:'customer_account',customer:'合成历史客户名称',customerCode:'OLD-001',salesName:'',serviceName:'',pmcName:'',salesMemberIds:[],serviceMemberIds:[],quoteMemberIds:[],active:true,notes:'原始备注不可因缺列表头丢失',directory:{country:'原国家',bucket:'现有合作'},version:1,createdAt:stamp,updatedAt:stamp,updatedBy:'原作者'};
insert(account);
insert({id:'identity_order',kind:'order',customer:account.customer,orderNo:'SYNTH-ORDER',customerPO:'PO-TEST',drawing:'DRAW-TEST',color:'合成颜色',lens:'合成镜片',quantity:10,notes:'原订单全文不得改',version:1,createdAt:stamp,updatedAt:stamp,updatedBy:'原订单作者'});
insert({id:'identity_service',kind:'service_record',type:'followup',customerId,orderId:'identity_order',title:'原客服跟进',description:'原联系记录',details:{category:'订单沟通'},status:'open',version:1,createdAt:stamp,updatedAt:stamp});
insert({id:'identity_attachment',kind:'service_attachment',customerId,recordId:'identity_service',filename:'原附件.txt',fileKey:'identity_file',contentType:'text/plain',size:17,hash:'original-synthetic-hash',createdAt:stamp});
bucketObjects.set('identity_file',new TextEncoder().encode('retained original'));
const originalOrder=current('identity_order'),originalAttachment=current('identity_attachment'),originalService=current('identity_service');
async function reject(action,body,status=409){const before=raw(),rev=revision(),response=await call(action,body);assert.equal(response.status,status,await response.text());assert.deepEqual(raw(),before);assert.equal(revision(),rev);}
const renamed=await ok('customer-save',input(account,{customer:'合成更名后的客户',customerCode:'NEW-002'}));
assert.deepEqual(current('identity_order'),originalOrder);assert.deepEqual(current('identity_attachment'),originalAttachment);assert.deepEqual(current('identity_service'),originalService);
let service=await ok('service-data'),mapped=service.customers.find(c=>c.id===customerId);assert(mapped.orderKeys.includes(account.customer)&&mapped.orderKeys.includes('OLD-001')&&mapped.orderKeys.includes('NEW-002'));assert(service.attachments.some(a=>a.id==='identity_attachment'));
let file=await call('service-file?id=identity_attachment');assert.equal(file.status,200);assert.equal(await file.text(),'retained original');
await ok('service-save',{customerId,orderId:'identity_order',type:'followup',title:'更名后仍关联原订单',description:'合成验证',details:{category:'关联检查'}});
pass('客户更名及改编号保存历史身份，原订单/客服记录/附件逐字段不变并仍可关联下载');
await reject('customer-save',{createOnly:true,customer:account.customer,customerCode:'OTHER-A'});
await reject('customer-save',{createOnly:true,customer:'其他合成客户',customerCode:'OLD-001'});
await reject('customer-save',{createOnly:true,customer:'OLD-001',customerCode:'OTHER-B'});
pass('其他客户不能抢占历史名称、历史编号或把旧编号用作名称');
const xlsx=await import('xlsx');
function workbook(rows,headers=['客户','客户编码','业务员','客服','PMC','备注']){const sheet=xlsx.utils.aoa_to_sheet([headers,...rows]),book=xlsx.utils.book_new();xlsx.utils.book_append_sheet(book,sheet,'客户责任清单');const bytes=xlsx.write(book,{type:'array',bookType:'xlsx'}),form=new FormData();form.set('file',new File([bytes],'synthetic-customers.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));return form;}
await ok('customer-import',workbook([['合成更名后的客户','IMPORT-003','','','','新备注']]));
service=await ok('service-data');mapped=service.customers.find(c=>c.id===customerId);for(const key of [account.customer,'OLD-001','NEW-002','IMPORT-003'])assert(mapped.orderKeys.includes(key));
assert.equal(raw().filter(r=>r.kind==='customer_workflow_identity').length,2);assert.deepEqual(current('identity_order'),originalOrder);assert.deepEqual(current('identity_attachment'),originalAttachment);pass('Excel改编号也保留每次旧身份，历史订单与附件继续对应同客户ID');
await reject('customer-import',workbook([['新客户甲','SAME-CODE','','','',''],['新客户乙','SAME-CODE','','','','']]));
await reject('customer-import',workbook([['新客户丙','CROSS-CODE','','','',''],['CROSS-CODE','OTHER-CODE','','','','']]));
await reject('customer-import',workbook([['新客户丁','OLD-001','','','','']]));
await reject('customer-import',workbook([['合成更名后的客户','IMPORT-004','','','',''],['新客户戊','IMPORT-003','','','','']]));
pass('同批重复编号、名称编号交叉、历史编号抢占及先改后抢旧码全部原子拒绝');
const beforeMissing=current(customerId);await ok('customer-import',workbook([['合成更名后的客户','','','']],['客户','业务员','客服','PMC']));assert.equal(current(customerId).customerCode,beforeMissing.customerCode);assert.equal(current(customerId).notes,beforeMissing.notes);assert.deepEqual(current(customerId).directory,beforeMissing.directory);pass('导入缺客户编码/备注列时保留原字段，目录及责任元数据继续保留');
await reject('customer-save',input(current(customerId),{directory:{bucket:'搁置与公海'}}));
await reject('customer-save',{createOnly:true,customer:'非法直接公海新客户',directory:{bucket:'搁置与公海'}});
const pool={...current(customerId),directory:{...current(customerId).directory,bucket:'搁置与公海'}};db.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify(pool),customerId);
await reject('customer-save',input(pool,{directory:{bucket:'现有合作'}}));await ok('customer-save',input(pool,{directory:{country:'只改国家'}}));assert.equal(current(customerId).directory.bucket,'搁置与公海');pass('普通主档不能绕过审批入/出公海，非流转元数据仍可维护');
assert.deepEqual(current('identity_order'),originalOrder);assert.deepEqual(current('identity_attachment'),originalAttachment);assert.deepEqual(current('identity_service'),originalService);assert.equal(bucketObjects.size,1);
await fs.writeFile(path.join(output,'result.json'),JSON.stringify({passed:checks.length,checks,at:new Date().toISOString(),scope:'synthetic in-memory DB only; no production access',originalOrderAndAttachmentUnchanged:true,attachmentObjects:1},null,2));db.close();console.log(JSON.stringify({passed:checks.length,report:path.join(output,'result.json')}));

