// Exercises the actual API handlers against SQLite, including atomic batch guards.
// Test identities are injected into this temporary bundle only, never into site code.
import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {AsyncLocalStorage} from 'node:async_hooks';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
await fs.mkdir('test-output',{recursive:true});
const db=new DatabaseSync(':memory:');
for(const name of (await fs.readdir('drizzle')).filter(n=>n.endsWith('.sql')).sort())db.exec(await fs.readFile('drizzle/'+name,'utf8'));
class Statement{constructor(sql,args=[]){this.sql=sql;this.args=args;}bind(...args){return new Statement(this.sql,args);}async first(){return db.prepare(this.sql).get(...this.args)||null;}async all(){return {results:db.prepare(this.sql).all(...this.args)};}async run(){return db.prepare(this.sql).run(...this.args);}}
const files=new Map(),identity=new AsyncLocalStorage();
globalThis.__testIdentity=identity;
globalThis.__testEnv={DB:{prepare:sql=>new Statement(sql),batch:async statements=>{db.exec('BEGIN');try{const results=[];for(const s of statements)results.push(db.prepare(s.sql).run(...s.args));db.exec('COMMIT');return results;}catch(e){db.exec('ROLLBACK');throw e;}}},BUCKET:{put:async(key,bytes)=>files.set(key,bytes),get:async key=>files.has(key)?{body:files.get(key)}:null}};
await build({entryPoints:['app/api/workspace/[action]/route.ts'],outfile:'test-output/api.mjs',bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@':process.cwd()},plugins:[{name:'test-only-bindings',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'cloudflare',namespace:'test'}));b.onResolve({filter:/chatgpt-auth$/},()=>({path:'auth',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},args=>({contents:args.path==='auth'?'export async function getChatGPTUser(){return globalThis.__testIdentity.getStore()||null}':'export const env=globalThis.__testEnv;'}));}}]});
const api=await import('../test-output/api.mjs');
const admin={userId:'test_admin',email:'admin@test.invalid',displayName:'测试 PMC',fullName:'测试 PMC'},clerk={userId:'test_clerk',email:'clerk@test.invalid',displayName:'测试文员',fullName:'测试文员'},sales={userId:'test_sales',email:'sales@test.invalid',displayName:'测试客服',fullName:'测试客服'};
async function call(action,body,user=admin,method=body===undefined?'GET':'POST'){return identity.run(user,()=>api[method](new Request('https://orders.test/api/workspace/'+action,{method,headers:body instanceof FormData?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)}),{params:Promise.resolve({action:action.split('?')[0]})}));}
async function ok(action,body,user=admin){const res=await call(action,body,user),result=await res.json();assert.equal(res.status,200,JSON.stringify(result));return result;}
const state=()=>ok('data');
const checks=[];function pass(name){checks.push(name);console.log('PASS '+name);}
function workbook(rows){const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.json_to_sheet(rows),'订单');return XLSX.write(book,{type:'buffer',bookType:'xlsx'});}
async function preview(rows,type='orders',user=admin,bytes){const f=new FormData();f.set('file',new File([bytes||workbook(rows)],type+'.xlsx'));f.set('type',type);const inspect=await ok('inspect',f,user);f.set('mapping',JSON.stringify(inspect.mapping));return ok('preview',f,user);}
assert.equal((await call('data',undefined,null)).status,401);await ok('enroll',{});assert.equal((await call('data',undefined,clerk)).status,403);pass('匿名及未授权账号无法读取订单');
await ok('member',{name:'测试文员',email:clerk.email,role:'clerk',customers:[],active:true});await ok('enroll',{},clerk);
await ok('member',{name:'测试客服',email:sales.email,role:'sales',customers:['测试客户甲'],active:true});await ok('enroll',{},sales);
const initial=[{'订单号':'TEST-001','客户':'测试客户甲','客户 PO':'PO-A','图纸编号':'DN-TEST-A','圈色':'C1','镜片类型':'白片','交货批次':'A','订单数量':100,'负责人邮箱':clerk.email,'客户要求交期':'2026-10-10','内部跟进备注':'内部信息不得对客导出'},{'订单号':'TEST-002','客户':'测试客户乙','图纸编号':'DN-TEST-B','圈色':'C2','镜片类型':'太阳片','订单数量':50,'客户要求交期':'2026-10-12'}];
const job=await preview(initial);assert.equal(job.rows.filter(r=>r.status==='new').length,2);await ok('commit-import',{id:job.id,selected:[2,3]});
await ok('commit-import',{id:job.id,selected:[2,3]});assert.equal((await state()).orders.length,2);const again=await preview(initial);assert(again.rows.every(r=>r.status==='skip'));pass('订单导入、重复提交与重复文件均不新增重复行');
assert.equal((await ok('data',undefined,clerk)).orders.length,1);assert.equal((await ok('data',undefined,sales)).orders.length,1);let [lineA,lineB]=(await state()).orders;
assert.equal((await call('edit-order',{id:lineB.id,version:lineB.version,patch:{notes:'越权'}},clerk)).status,403);assert.equal((await call('edit-order',{id:lineA.id,version:lineA.version,patch:{quantity:999}},clerk)).status,403);pass('文员订单范围与生产/源单字段权限在服务端生效');
await ok('edit-order',{id:lineA.id,version:lineA.version,patch:{plannedDate:'2026-10-06'}},admin);await ok('edit-order',{id:lineA.id,version:lineA.version,patch:{notes:'文员的跟进'}},clerk);
lineA=(await state()).orders.find(o=>o.id===lineA.id);assert.equal(lineA.plannedDate,'2026-10-06');assert.equal(lineA.notes,'文员的跟进');pass('两人从同一版本修改不同字段均保留');
assert.equal((await call('edit-order',{id:lineA.id,version:1,patch:{notes:'旧版本回退'}},clerk)).status,409);pass('同字段旧版本修改被阻止');
const race=await Promise.all([call('edit-order',{id:lineA.id,version:lineA.version,patch:{plannedDate:'2026-10-07'}}),call('edit-order',{id:lineA.id,version:lineA.version,patch:{plannedDate:'2026-10-08'}})]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);pass('并发批次只有一个原子提交，另一请求返回冲突');
const exportRes=await call('export',{type:'working',filters:{}},clerk);assert.equal(exportRes.status,200);const exportBytes=await exportRes.arrayBuffer();
lineA=(await state()).orders.find(o=>o.id===lineA.id);await ok('edit-order',{id:lineA.id,version:lineA.version,patch:{promisedDate:'2026-10-11',promiseConfirmed:true}},admin);
const book=XLSX.read(exportBytes,{type:'array'}),rows=XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]]);rows[0]['内部跟进备注']='从工作表跟进';const updated=await preview(rows,'orders',clerk);assert.equal(updated.rows[0].status,'update');await ok('commit-import',{id:updated.id,selected:[2]},clerk);lineA=(await state()).orders.find(o=>o.id===lineA.id);assert.equal(lineA.promisedDate,'2026-10-11');assert.equal(lineA.promiseConfirmed,true);assert.equal(lineA.notes,'从工作表跟进');pass('带服务端基线的旧工作表合并保留最新交期');
const unversioned=await preview([{...initial[0],'客户要求交期':'2026-10-01'}]);assert.equal(unversioned.rows[0].status,'conflict');assert.equal((await call('commit-import',{id:unversioned.id,selected:[2]})).status,400);pass('无基线的修改必须核对并填写依据');
const beforePreview=await preview([{...initial[0],'客户要求交期':'2026-10-13'}]);lineA=(await state()).orders.find(o=>o.id===lineA.id);await ok('edit-order',{id:lineA.id,version:lineA.version,patch:{notes:'预览后更新'}});assert.equal((await call('commit-import',{id:beforePreview.id,selected:[2],reason:'已核对'})).status,409);pass('预览后数据更新会阻止过期提交');
const duplicates=await preview([initial[1],initial[1]]);assert(duplicates.rows.every(r=>r.status==='error'));const invalid=await preview([{...initial[1],'客户要求交期':'2026-02-30'}]);assert.equal(invalid.rows[0].status,'error');pass('重复业务键与非法日期进入错误列表');
const mesRows=[{'报工编号':'MES-TEST-001','订单号':'TEST-001','图纸编号':'DN-TEST-A','圈色':'C1','镜片类型':'白片','良品数':30,'报工时间':'2026-09-14 08:30:00','审批状态':'已审批','工单号':'WO-TEST-A'}];
let mes=await preview(mesRows,'mes');await ok('commit-import',{id:mes.id,selected:[2]});mes=await preview(mesRows,'mes');assert.equal(mes.rows[0].status,'skip');assert.equal((await state()).reports.reduce((n,r)=>n+r.quantity,0),30);pass('包装报工幂等，部分完成不会当作足量');
const report=(await state()).reports[0];await ok('correction',{reportId:report.id,quantity:25,reason:'测试更正依据'},clerk);let correction=(await state()).corrections[0];await ok('review',{id:correction.id,decision:'approve',note:'已核对原始报工'});assert.equal((await call('review',{id:correction.id,decision:'verify',note:'尝试提前核验'})).status,400);
mes=await preview([{...mesRows[0],'良品数':25}],'mes');assert.equal(mes.rows[0].status,'conflict');await ok('commit-import',{id:mes.id,selected:[2],reason:'MES人工更正后新导出'});await ok('review',{id:correction.id,decision:'verify',note:'重新导入数量一致'});pass('MES 更正不虚报回写成功，必须导入新版本才能核验');
mes=await preview([{...mesRows[0],'良品数':25,'审批状态':'已撤销'}],'mes');await ok('commit-import',{id:mes.id,selected:[2],reason:'撤销记录导入'});const completion=await call('export',{type:'completion',filters:{}});const completeBook=XLSX.read(await completion.arrayBuffer());assert.equal(XLSX.utils.sheet_to_json(completeBook.Sheets[completeBook.SheetNames[0]]).length,0);pass('撤销报工从正式包装完成报表中排除');
const customerRes=await call('export',{type:'customer',filters:{}},sales);const customerBook=XLSX.read(await customerRes.arrayBuffer());const customerRows=XLSX.utils.sheet_to_json(customerBook.Sheets[customerBook.SheetNames[0]]);assert.equal(customerRows.length,1);assert.equal(customerRows[0]['客户'],'测试客户甲');assert(!Object.keys(customerRows[0]).some(k=>k.includes('内部')));assert.equal(customerRows[0]['已确认回复交期'],'2026-10-11');pass('客户报表执行客户权限，排除内部备注并使用已确认交期');
const archived=(await ok('data',undefined,sales)).exports[0],salesMember=(await state()).members.find(m=>m.email===sales.email);await ok('member',{...salesMember,customers:[]});assert.equal((await call('file?id='+archived.id,undefined,sales)).status,403);pass('收回客户权限后不能下载历史导出绕过权限');
await fs.writeFile('test-output/result.json',JSON.stringify({passed:checks.length,checks,at:new Date().toISOString()},null,2));
console.log(`\n${checks.length} business checks passed.`);
const parallelRow={...initial[1],'订单号':'TEST-PARALLEL'};const pendingA=await preview([parallelRow]),pendingB=await preview([parallelRow]);await ok('commit-import',{id:pendingA.id,selected:[2]});assert.equal((await call('commit-import',{id:pendingB.id,selected:[2]})).status,409);pass('两个待提交预览不能各自创建同一业务明细');
await fs.writeFile('test-output/result.json',JSON.stringify({passed:checks.length,checks,at:new Date().toISOString()},null,2));
