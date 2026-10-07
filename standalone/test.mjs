import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import * as XLSX from 'xlsx';
const dist=path.resolve(process.env.DOON_BUILD_DIR||'lan-dist'),dir=await fs.mkdtemp(path.resolve('test-output/lan-test-')),port=18787,origin=`http://127.0.0.1:${port}`;
const env={...process.env,DOON_DATA_DIR:dir,DOON_HOST:'127.0.0.1',DOON_PORT:String(port),DOON_NO_AUTO_BACKUP:'1'};
execFileSync(process.execPath,[path.join(dist,'manage.mjs'),'init'],{env,stdio:'pipe'});
const text=await fs.readFile(path.join(dir,'管理员首次登录.txt'),'utf8'),initial=text.match(/初始密码：([^\n]+)/)[1];
const server=spawn(process.execPath,[path.join(dist,'server.mjs')],{env,stdio:'pipe',windowsHide:true});let logs='';server.stdout.on('data',b=>logs+=b);server.stderr.on('data',b=>logs+=b);
const checks=[];function pass(s){checks.push(s);console.log('PASS '+s);}
let adminCookie='',clerkCookie='';
async function request(route,body,cookie='',extra={}){return fetch(origin+route,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{Origin:origin}),...(body instanceof FormData?{}:{'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{}),...extra},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});}
async function ok(route,body,cookie){const res=await request(route,body,cookie);const data=await res.json();assert.equal(res.status,200,JSON.stringify(data));return {res,data};}
try{
 for(let i=0;i<40;i++){try{if((await fetch(origin+'/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 assert.equal((await request('/api/workspace/data')).status,401);
 assert.equal((await request('/api/workspace/data',undefined,'',{'oai-authenticated-user-id':'spoof','oai-authenticated-user-email':'admin@doon.local'})).status,401);
 assert.equal((await request('/api/auth/login',{username:'admin',password:initial},'',{Origin:'https://evil.example'})).status,403);pass('匿名、伪造身份头及跨站登录均无法进入');
 const login=await ok('/api/auth/login',{username:'admin',password:initial});adminCookie=login.res.headers.get('set-cookie').split(';')[0];assert(login.data.user.mustChange);assert.match(login.res.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);assert.equal((await request('/api/workspace/data',undefined,adminCookie)).status,403);
 const changed=await ok('/api/auth/password',{currentPassword:initial,password:'Test-Only-Admin-2026!'},adminCookie);const old=adminCookie;adminCookie=changed.res.headers.get('set-cookie').split(';')[0];assert.equal((await request('/api/workspace/data',undefined,old)).status,401);pass('首次改密后才可操作，旧会话失效');
 await ok('/api/auth/accounts',{username:'clerk',name:'电镀测试',password:'Test-Clerk-Initial!',role:'clerk',departments:['plating'],customers:[]},adminCookie);
 const cl=await ok('/api/auth/login',{username:'clerk',password:'Test-Clerk-Initial!'});clerkCookie=cl.res.headers.get('set-cookie').split(';')[0];const cc=await ok('/api/auth/password',{currentPassword:'Test-Clerk-Initial!',password:'Test-Clerk-Personal!'},clerkCookie);clerkCookie=cc.res.headers.get('set-cookie').split(';')[0];
 assert.equal((await request('/api/auth/accounts',{username:'attack',name:'提升',password:'No-Permissions-12345!',role:'admin'},clerkCookie)).status,403);pass('文员不能创建账号或提升自身权限');
 const book=XLSX.utils.book_new(),sheet={};for(const [address,v] of Object.entries({I3:'订单号',M3:'订单数量',BF3:'包装入仓数量',I4:'LAN-TEST',J4:'DN-TEST',C4:'TEST',M4:100,BF4:0,AL4:10}))sheet[address]={t:typeof v==='number'?'n':'s',v};sheet['!ref']='A1:BF4';XLSX.utils.book_append_sheet(book,sheet,'动态表');const bytes=XLSX.write(book,{type:'buffer',bookType:'xlsx'});const form=new FormData();form.set('file',new File([bytes],'test.xlsx'));form.set('mode','active');let job=(await ok('/api/workspace/ledger-preview',form,adminCookie)).data;await ok('/api/workspace/ledger-commit',{id:job.id,offset:0},adminCookie);await ok('/api/workspace/ledger-commit',{id:job.id,offset:0},adminCookie);
 let state=(await ok('/api/workspace/data',undefined,clerkCookie)).data;assert.equal(state.orders.length,1);let order=state.orders[0];
 await ok('/api/workspace/ledger-edit',{id:order.id,version:order.version,patch:{AL:'20'},reason:'本部门核对'},clerkCookie);
 assert.equal((await request('/api/workspace/ledger-edit',{id:order.id,version:2,patch:{AG:'90'},reason:'跨部门'},clerkCookie)).status,403);
 assert.equal((await request('/api/workspace/ledger-edit',{id:order.id,version:1,patch:{AL:'30'},reason:'旧版本'},clerkCookie)).status,409);
 state=(await ok('/api/workspace/data',undefined,adminCookie)).data;assert.equal(state.orders[0].ledger.columns.AL,'20');pass('独立账号共享总表，工序越权与旧版本覆盖被拒绝');
 const clash=await Promise.all([request('/api/workspace/ledger-edit',{id:order.id,version:2,patch:{AL:'21'},reason:'并发甲'},clerkCookie),request('/api/workspace/ledger-edit',{id:order.id,version:2,patch:{AL:'22'},reason:'并发乙'},adminCookie)]);assert.deepEqual(clash.map(r=>r.status).sort(),[200,409]);pass('真实 HTTP 并发提交仅一个成功');
 const saved=await ok('/api/auth/backup',{},adminCookie),bdir=saved.data.folder;const check=new DatabaseSync(path.join(bdir,'workspace.sqlite'),{readOnly:true});assert.equal(Object.values(check.prepare('PRAGMA integrity_check').get())[0],'ok');assert.equal(check.prepare("SELECT COUNT(*) n FROM records WHERE kind='order'").get().n,1);check.close();assert((await fs.readdir(path.join(bdir,'files'))).length>=2);pass('完整备份包含可读取数据库和源文件');

 async function roleUser(username,role){await ok('/api/auth/accounts',{username,name:username,password:'Role-Initial-2026!',role,customers:[],departments:[]},adminCookie);const signed=await ok('/api/auth/login',{username,password:'Role-Initial-2026!'});const c=signed.res.headers.get('set-cookie').split(';')[0];return (await ok('/api/auth/password',{currentPassword:'Role-Initial-2026!',password:'Role-Personal-2026!'},c)).res.headers.get('set-cookie').split(';')[0];}
 const productionCookie=await roleUser('production','production'),financeCookie=await roleUser('finance','finance');
 let productionState=(await ok('/api/workspace/data',undefined,productionCookie)).data;
 assert.equal(productionState.orders.length,1);assert.equal(productionState.me.role,'production');
 let po=productionState.orders[0];await ok('/api/workspace/ledger-edit',{id:po.id,version:po.version,patch:{AG:'35',AL:'25'},reason:'生产管理核对'},productionCookie);
 po=(await ok('/api/workspace/data',undefined,productionCookie)).data.orders[0];await ok('/api/workspace/edit-order',{id:po.id,version:po.version,patch:{stage:'装配中',notes:'生产管理跟进'}},productionCookie);
 po=(await ok('/api/workspace/data',undefined,productionCookie)).data.orders[0];
 for(const patch of [{quantity:999},{ownerEmail:'clerk@doon.local'},{promisedDate:'2026-10-01'}])assert.equal((await request('/api/workspace/edit-order',{id:po.id,version:po.version,patch},productionCookie)).status,403);
 assert.equal((await request('/api/workspace/ledger-lifecycle',{id:po.id,version:po.version,mode:'archived',reason:'生产管理尝试结单',closedDate:'2026-09-14'},productionCookie)).status,403);
 assert.equal((await request('/api/workspace/ledger-preview',form,productionCookie)).status,403);
 assert.equal((await request('/api/auth/accounts',undefined,productionCookie)).status,403);
 await ok('/api/workspace/outsource-create',{lineId:po.id,supplier:'角色测试供应商',process:'plating',quantity:10,sentDate:'2026-09-14',dueDate:'2026-09-16',reference:'ROLE-OUT-1',token:crypto.randomUUID()},adminCookie);
 assert.equal((await request('/api/workspace/outsource-create',{},productionCookie)).status,403);
 const photoForm=new FormData();photoForm.set('file',new File([Uint8Array.from([255,216,255,224,1,2,3,4])],'role-receipt.jpg'));const photo=(await ok('/api/workspace/receipt-photo',photoForm,productionCookie)).data;
 const out=(await ok('/api/workspace/data',undefined,productionCookie)).data.outsource[0];await ok('/api/workspace/receipt-confirm',{photoId:photo.id,supplier:'角色测试供应商',deliveryNo:'ROLE-DEL-1',receivedDate:'2026-09-14',note:'角色收货测试',token:crypto.randomUUID(),lines:[{outsourceId:out.id,accepted:5,rejected:0}]},productionCookie);
 pass('生产管理可查看全部订单、维护跨部门工序和收货，不能改源单、归档或管理账号');
 const financialState=(await ok('/api/workspace/data',undefined,financeCookie)).data;assert.equal(financialState.orders.length,1);assert.equal(financialState.receipts.length,1);assert.equal(financialState.outsource[0].received,5);assert.equal(financialState.orders[0].ledger.columns.AL,'30');
 assert.equal((await request('/api/workspace/ledger-file?id='+photo.id,undefined,financeCookie)).status,200);
 for(const action of ['ledger-edit','edit-order','ledger-preview','ledger-commit','outsource-create','receipt-photo','receipt-confirm','comment','member','ledger-lifecycle','correction','review','commit-import','attachment'])assert.equal((await request('/api/workspace/'+action,{},financeCookie)).status,403,action);
 assert.equal((await request('/api/workspace/export',{type:'working',filters:{}},financeCookie)).status,403);
 const financialExport=await request('/api/workspace/export',{type:'summary',filters:{}},financeCookie);assert.equal(financialExport.status,200);const finBook=XLSX.read(await financialExport.arrayBuffer());assert.equal(XLSX.utils.sheet_to_json(finBook.Sheets[finBook.SheetNames[0]]).length,1);
 assert.equal((await request('/api/workspace/ledger-export?mode=active',undefined,financeCookie)).status,200);
 assert.equal((await request('/api/auth/accounts',undefined,financeCookie)).status,403);pass('财务无需客户分配即可查询订单及收货凭证、导出报表，所有业务写入被后台拒绝');
 const prodMember=(await ok('/api/workspace/data',undefined,adminCookie)).data.members.find(m=>m.role==='production');
 await ok('/api/workspace/member',{...prodMember,role:'finance',departments:['plating']},adminCookie);
 assert.equal((await ok('/api/workspace/data',undefined,productionCookie)).data.me.role,'finance');
 assert.equal((await request('/api/workspace/ledger-edit',{id:po.id,version:financialState.orders[0].version,patch:{AL:'999'},reason:'旧身份越权'},productionCookie)).status,403);
 await ok('/api/workspace/member',{...prodMember,role:'production'},adminCookie);pass('编辑成员支持两个新角色，角色变更立即作用于已有登录会话');

 const programmerCookie=await roleUser('programmer','programmer');
 const maintenance=(await ok('/api/auth/maintenance',undefined,programmerCookie)).data;assert(maintenance.databaseReady);assert(maintenance.backup.integrity==='ok');assert(!JSON.stringify(maintenance).includes('folder'));assert.equal((await request('/api/auth/maintenance',undefined,clerkCookie)).status,403);
 assert.equal((await ok('/api/workspace/data',undefined,programmerCookie)).data.orders.length,0);
 const programmer=(await ok('/api/workspace/data',undefined,adminCookie)).data.members.find(m=>m.role==='programmer');await ok('/api/workspace/member',{...programmer,customers:['TEST'],departments:['plating']},adminCookie);
 assert.equal((await ok('/api/workspace/data',undefined,programmerCookie)).data.orders.length,1);
 assert.equal((await request('/api/workspace/ledger-edit',{},programmerCookie)).status,403);assert.equal((await request('/api/auth/accounts',undefined,programmerCookie)).status,403);assert.equal((await request('/api/auth/backup',{},programmerCookie)).status,403);
 assert.equal((await request('/api/workspace/export',{type:'working',filters:{}},programmerCookie)).status,403);assert.equal((await request('/api/workspace/export',{type:'summary',filters:{}},programmerCookie)).status,200);
 pass('程序员可查看维护状态，订单需另行授权，不能改业务、管理账号或操作备份');
 const adminState=(await ok('/api/workspace/data',undefined,adminCookie)).data;const member=adminState.members.find(m=>m.name==='电镀测试');await ok('/api/workspace/member',{...member,active:false},adminCookie);assert.equal((await request('/api/workspace/data',undefined,clerkCookie)).status,401);await ok('/api/workspace/member',{...member,active:true},adminCookie);assert.equal((await request('/api/workspace/data',undefined,clerkCookie)).status,401);pass('停用账号立即撤销会话，重新启用后旧会话仍失效');
 const list=(await ok('/api/auth/accounts',undefined,adminCookie)).data;assert(!JSON.stringify(list).includes('password_hash'));const acct=list.accounts.find(a=>a.username==='clerk');await ok('/api/auth/reset',{id:acct.id,password:'Reset-Clerk-Initial!'},adminCookie);const resetLogin=await ok('/api/auth/login',{username:'clerk',password:'Reset-Clerk-Initial!'});assert(resetLogin.data.user.mustChange);pass('密码摘要不出现在 API，重置后强制改密');
 for(let i=0;i<8;i++)assert.equal((await request('/api/auth/login',{username:'nobody',password:'wrong'})).status,401);assert.equal((await request('/api/auth/login',{username:'nobody',password:'wrong'})).status,429);pass('错误登录次数限制生效');
 assert.equal((await request('/lan-data/workspace.sqlite')).status,404);assert.equal((await request('/api/auth/backup',undefined,clerkCookie)).status,401);await ok('/api/auth/logout',{},adminCookie);assert.equal((await request('/api/workspace/data',undefined,adminCookie)).status,401);pass('数据文件不静态公开，退出后不可继续操作');
 await fs.writeFile(path.join(dir,'results.json'),JSON.stringify({checks,at:new Date().toISOString()},null,2));console.log(`完成 ${checks.length} 项内网 HTTP 测试`);
}finally{server.kill();}
