import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {AsyncLocalStorage} from 'node:async_hooks';
import * as XLSX from 'xlsx';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
await fs.mkdir('test-output',{recursive:true});
const db=new DatabaseSync(':memory:');for(const name of (await fs.readdir('drizzle')).filter(n=>n.endsWith('.sql')).sort())db.exec(await fs.readFile('drizzle/'+name,'utf8'));
class Statement{constructor(sql,args=[]){this.sql=sql;this.args=args}bind(...args){return new Statement(this.sql,args)}async first(){return db.prepare(this.sql).get(...this.args)||null}async all(){return {results:db.prepare(this.sql).all(...this.args)}}async run(){return db.prepare(this.sql).run(...this.args)}}
const files=new Map(),identity=new AsyncLocalStorage();globalThis.__testIdentity=identity;globalThis.__testEnv={DB:{prepare:sql=>new Statement(sql),batch:async statements=>{db.exec('BEGIN');try{for(const st of statements)db.prepare(st.sql).run(...st.args);db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}}},BUCKET:{put:async(key,value)=>files.set(key,value)}};
await build({entryPoints:['app/api/workspace/[action]/route.ts'],outfile:'test-output/supplier-import-api-test.mjs',bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@':process.cwd()},plugins:[{name:'test-bindings',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'cloudflare',namespace:'test'}));b.onResolve({filter:/chatgpt-auth$/},()=>({path:'auth',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},a=>({contents:a.path==='auth'?'export async function getChatGPTUser(){return globalThis.__testIdentity.getStore()||null}':'export const env=globalThis.__testEnv;'}))}}]});
const api=await import('../test-output/supplier-import-api-test.mjs'),admin={userId:'admin',email:'admin@test.invalid',displayName:'测试管理员'},clerk={userId:'clerk',email:'clerk@test.invalid',displayName:'测试文员'};
async function call(action,body,user=admin,headers={}){const method=body===undefined?'GET':'POST';return identity.run(user,()=>api[method](new Request('https://orders.test/api/workspace/'+action,{method,headers:body instanceof FormData?headers:{'content-type':'application/json',...headers},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)}),{params:Promise.resolve({action:action.split('?')[0]})}))}
async function ok(action,body,user=admin){const r=await call(action,body,user),v=await r.json();assert.equal(r.status,200,JSON.stringify(v));return v}
const columns=['供应商编码','供应商名称','供应商分类','增值税税率（%）','结算期限','部门','采购员','银行账号','公司地址','采购入库时自动抵扣预付款','联系人','手机','性别','EMail','创建人','创建时间','发票类型','Email','银行户名','开票地址'];
function form(data){const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([columns,...data]),'sheet1（名称勿改）');const bytes=XLSX.write(book,{type:'buffer',bookType:'xlsx'}),f=new FormData();f.set('file',new File([bytes],'供应商.xlsx'));return f}
await ok('enroll',{});await ok('member',{name:'测试文员',email:clerk.email,role:'clerk',customers:[],active:true});await ok('enroll',{},clerk);
await ok('supplier-save',{name:'已有名称'});
const rows=[['S1','新供应商','','13','','','','123456789','','','联系人','13800000000','','contact@test.invalid','','','','invoice@test.invalid'],['S2','同名'],['S3','同名'],['S4','已有名称']];
const preview=await ok('supplier-import-preview',form(rows));assert.equal(preview.total,4);assert.equal(preview.candidateCount,1);assert.equal(preview.conflicts.length,3);
assert.equal((await call('supplier-import-preview',form(rows),clerk)).status,403);
assert.equal((await call('supplier-import-commit',{previewId:preview.previewId},clerk)).status,403);
assert.equal((await call('supplier-import-commit',{previewId:preview.previewId},admin,{'X-Workspace-Team':'team'})).status,403);
const committed=await ok('supplier-import-commit',{previewId:preview.previewId});assert.deepEqual(committed,{inserted:1,skipped:0,held:3});assert.deepEqual(await ok('supplier-import-commit',{previewId:preview.previewId}),committed);
const sources=await ok('supplier-import-sources');assert.equal(sources.sources.length,4);assert.equal((await call('supplier-import-sources',undefined,clerk)).status,403);const detail=await ok('supplier-import-source?id='+sources.sources[0].id);assert.equal(detail.source.fields[7].value,'123456789');assert.equal(detail.source.fields[13].value,'contact@test.invalid');assert.equal(detail.source.fields[17].value,'invoice@test.invalid');
const data=await ok('data');assert(!JSON.stringify(data).includes('123456789'));assert(!JSON.stringify(data).includes('invoice@test.invalid'));
const again=await ok('supplier-import-preview',form(rows));assert.equal(again.existingCount,1);assert.equal(again.candidateCount,0);assert.equal(again.conflicts.length,3);
const stale=await ok('supplier-import-preview',form([['S5','另一名称']]));await ok('supplier-save',{name:'另一名称'});assert.equal((await call('supplier-import-commit',{previewId:stale.previewId})).status,409);
const duplicate=await ok('supplier-import-preview',form([['S6','甲'],['S6','乙']]));assert.equal(duplicate.candidateCount,0);assert.equal(duplicate.conflicts.length,2);
const first=await ok('supplier-import-preview',form([['S7','竞争供应商']])),second=await ok('supplier-import-preview',form([['S7','竞争供应商']]));await ok('supplier-import-commit',{previewId:first.previewId});assert.equal((await call('supplier-import-commit',{previewId:second.previewId})).status,409);
console.log('PASS supplier import: permissions, source fields, collisions, stale preview and idempotency');
