import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {AsyncLocalStorage} from 'node:async_hooks';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

// Isolated, synthetic route regression: no production DB, files or account credentials.
const output=path.resolve('test-output','customer-workflow-quote-files-'+process.pid);
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
for(const role of ['sales','clerk','pmc','viewer']){await ok('member',{name:user(role).displayName,email:user(role).email,role,customers:[],active:true});await ok('enroll',{},user(role));}
const members=raw().filter(r=>r.kind==='member').map(r=>JSON.parse(r.data)),member=role=>members.find(m=>m.role===role);
const account={id:'service_history_account',kind:'customer_account',customer:'Synthetic assigned customer',customerCode:'HIST-A',salesName:member('sales').name,serviceName:member('clerk').name,salesMemberIds:[member('sales').id],serviceMemberIds:[member('clerk').id],quoteMemberIds:[member('sales').id],active:true,version:1};
const foreign={...account,id:'service_history_foreign',customer:'Synthetic other customer',customerCode:'HIST-B',serviceName:'',serviceMemberIds:[]};insert(account);insert(foreign);
const policy={id:'synthetic_quote_readonly_policy',kind:'customer_quote_access',memberIds:[member('sales').id],internalMemberIds:[],aliasesByMember:{}};insert(policy);
const draft={companyEn:'Synthetic Company',companyZh:'合成公司',collectionEn:'Synthetic',collectionZh:'合成',customerAccountId:account.id,customerName:account.customer,customerCode:account.customerCode,quoteNo:'SERVICE-READ-ONLY',quoteDate:'2026-01-01',validUntil:'2026-12-31',currency:'USD',lines:[{id:'line',model:'SYNTH-MODEL',quantity:300,unitPrice:12,toolingFee:0,descriptionZh:'合成',descriptionEn:'Synthetic',sourceFormula:'PRIVATE-COST-FORMULA'}],terms:[{id:'term',labelZh:'条款',labelEn:'Terms',zh:'条款',en:'Reviewed terms',needsReview:false,reviewNote:'PRIVATE-TERM-REVIEW'}],reviewNotes:['PRIVATE-QUOTE-REVIEW'],internalNotesZh:'PRIVATE-INTERNAL-NOTE',internalCosts:[{id:'cost',label:'PRIVATE-INTERNAL-COST',rmb:5,notes:'private'}],exchangeRateCnyPerUsd:7};
let q=(await ok('customer-quote-save',draft)).quote;
await ok('customer-quote-save',{...draft,customerAccountId:foreign.id,customerName:foreign.customer,customerCode:foreign.customerCode,quoteNo:'FOREIGN-SECRET'});
const secrets=['PRIVATE-COST-FORMULA','PRIVATE-TERM-REVIEW','PRIVATE-QUOTE-REVIEW','PRIVATE-INTERNAL-NOTE','PRIVATE-INTERNAL-COST','FOREIGN-SECRET'];
function safe(value){for(const secret of secrets)assert(!JSON.stringify(value).includes(secret),'Leaked '+secret);}
async function reject(action,body,actor=user('clerk'),status=403){const before=raw(),beforeFiles=[...bucketObjects.entries()].map(([k,v])=>[k,Buffer.from(v)]),beforeRevision=revision();const response=await call(action,body,actor);assert.equal(response.status,status,await response.text());assert.deepEqual(raw(),before);assert.equal(revision(),beforeRevision);assert.deepEqual([...bucketObjects.entries()].map(([k,v])=>[k,Buffer.from(v)]),beforeFiles);}

const broader={...policy,memberIds:[...policy.memberIds,member('clerk').id],internalMemberIds:[member('clerk').id]};db.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify(broader),policy.id);
db.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify({...account,quoteMemberIds:[...account.quoteMemberIds,member('clerk').id]}),account.id);
insert({id:'file_project',kind:'customer_project',customerId:account.id,code:'SYNTH-P',title:'合成项目',active:true,version:1});
const form=folder=>{const f=new FormData();for(const [k,v] of Object.entries({token:crypto.randomUUID(),customerId:account.id,projectId:'file_project',folder,title:'合成'+folder,fileVersion:'V1',status:'待确认',note:'合成附件'}))f.set(k,v);f.set('file',new File([folder==='04_工程报价'?'PRIVATE-COST-FORMULA':'Synthetic public sales quote'],'synthetic.txt',{type:'text/plain'}));return f;};
await ok('customer-workflow-file-upload',form('04_工程报价'));await ok('customer-workflow-file-upload',form('05_销售报价'));
const files=raw().filter(r=>r.kind==='customer_workflow_attachment').map(r=>JSON.parse(r.data)),engineering=files.find(f=>f.folder==='04_工程报价'),salesFile=files.find(f=>f.folder==='05_销售报价');
let feed=await ok('customer-workflow-files?customerId='+account.id+'&projectId=file_project',undefined,user('clerk'));assert.deepEqual(feed.files.map(f=>f.id),[salesFile.id]);
let response=await call('customer-workflow-file?id='+salesFile.id,undefined,user('clerk'));assert.equal(response.status,200);assert.equal(await response.text(),'Synthetic public sales quote');
await reject('customer-workflow-file?id='+engineering.id,undefined);
await reject('customer-workflow-file-upload',form('04_工程报价'));await reject('customer-workflow-file-upload',form('05_销售报价'));
const edit={token:crypto.randomUUID(),customerId:account.id,projectId:'file_project',folder:'05_销售报价',title:'不能改价附件',fileVersion:'V2',status:'有效',note:'',reason:'尝试旧授权改附件',id:salesFile.id,version:salesFile.version};await reject('customer-workflow-file-save',edit);
pass('客服旧报价/内部成本授权不能读工程报价或改销售报价附件；许可范围内销售报价只读');
const nextFile=form('05_销售报价');nextFile.set('fileVersion','V2');await ok('customer-workflow-file-upload',nextFile,user('sales'));
pass('现有负责销售报价维护仍有效，管理员可维护工程报价');
db.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify({...account,serviceName:'',serviceMemberIds:[]}),account.id);
await reject('customer-workflow-file?id='+salesFile.id,undefined);await reject('customer-workflow-files?customerId='+account.id+'&projectId=file_project',undefined);
pass('客服客户权限撤销即时拒绝销售附件读取，旧文件及数据库拒绝时零变更');
await fs.writeFile(path.join(output,'result.json'),JSON.stringify({passed:checks.length,checks},null,2));console.log(JSON.stringify({passed:checks.length,report:path.join(output,'result.json')}));db.close();
