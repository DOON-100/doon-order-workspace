// Synthetic HTTP integration only: never opens production data or uses real credentials.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createServer} from 'node:net';
import {createHash,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import * as XLSX from 'xlsx';

const dist=path.resolve(process.env.DOON_BUILD_DIR||'lan-dist');
const output=path.resolve('test-output');
await fs.mkdir(output,{recursive:true});
const dir=await fs.mkdtemp(path.join(output,'platform-admin-http-'));
assert(dir.startsWith(output+path.sep));
const probe=createServer();
const port=await new Promise((resolve,reject)=>{
 probe.once('error',reject);
 probe.listen(0,'127.0.0.1',()=>{const assigned=probe.address().port;probe.close(error=>error?reject(error):resolve(assigned));});
});
assert.notEqual(port,8787);
const origin='http://127.0.0.1:'+port;
const env={...process.env,DOON_DATA_DIR:dir,DOON_HOST:'127.0.0.1',DOON_PORT:String(port),DOON_NO_AUTO_BACKUP:'1',DOON_SYNTHETIC_ONLY:'1',DOON_EMPLOYEE_PUBLIC_ORIGIN:'',DOON_STUDIO_SCHEDULES_ENABLED:'0',DOON_REVIEW_MODE:'0',DOON_SERVER_MODE:'internal',DOON_TLS_CERT:'',DOON_TLS_KEY:''};
execFileSync(process.execPath,[path.join(dist,'manage.mjs'),'init'],{env,stdio:'pipe',windowsHide:true});
const initial=(await fs.readFile(path.join(dir,'管理员首次登录.txt'),'utf8')).match(/初始密码：([^\n]+)/)[1];
const server=spawn(process.execPath,[path.join(dist,'server.mjs')],{env,stdio:'pipe',windowsHide:true});
let logs='';
server.stdout.on('data',()=>{});
server.stderr.on('data',bytes=>logs+=bytes);
const checks=[];
const pass=name=>{checks.push(name);console.log('PASS '+name);};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const processKinds=['rfq','sample','engineering-change','iqc','material-kit','warehouse','first-article','process-quality','outsourcing-quality','oqc','packaging','shipment-release','supplier-reconciliation','complaint'];
async function request(route,body,cookie='',extra={}){
 return fetch(origin+route,{method:body===undefined?'GET':'POST',headers:{Origin:origin,...(body instanceof FormData?{}:{'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{}),...extra},...(body===undefined?{}:{body:body instanceof FormData?body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
}
async function ok(route,body,cookie){
 const response=await request(route,body,cookie),data=await response.json();
 assert.equal(response.status,200,route+': '+JSON.stringify(data));
 return {data,cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
const ws=async(action,body,cookie)=>(await ok('/api/workspace/'+action,body,cookie)).data;
const state=cookie=>ws('data',undefined,cookie);
function workbook(index){
 const book=XLSX.utils.book_new(),sheet={};
 for(const [address,value] of Object.entries({I3:'订单号',M3:'订单数量',BF3:'包装入仓数量',I4:'SYN-ADMIN-'+index,J4:'SYN-DRAW-'+index,C4:'SYN-ADMIN',M4:100,BF4:0,AL4:10}))sheet[address]={t:typeof value==='number'?'n':'s',v:value};
 sheet['!ref']='A1:BF4';XLSX.utils.book_append_sheet(book,sheet,'动态表');
 return XLSX.write(book,{type:'buffer',bookType:'xlsx'});
}
function upload(bytes,name,fields={}){
 const form=new FormData();for(const [key,value] of Object.entries(fields))form.set(key,value);
 form.set('file',new File([bytes],name));return form;
}
function identitySnapshot(){
 const db=new DatabaseSync(path.join(dir,'workspace.sqlite'),{readOnly:true});
 try{return {records:db.prepare('SELECT id,kind,data FROM records ORDER BY id').all(),accounts:db.prepare('SELECT id,username,member_id,must_change,created_at FROM local_accounts ORDER BY id').all()};}
 finally{db.close();}
}
try{
 let ready=false;
 for(let attempt=0;attempt<80;attempt++){try{if((await request('/health')).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
 assert(ready,'Isolated HTTP service did not start');
 let ownerCookie=(await ok('/api/auth/login',{username:'admin',password:initial})).cookie;
 ownerCookie=(await ok('/api/auth/password',{currentPassword:initial,password:'Synthetic-Platform-Owner-2026!'},ownerCookie)).cookie;
 const owner=(await state(ownerCookie)).me;
 async function createActor(username,role){
  await ok('/api/auth/accounts',{username,name:username,role,customers:[],departments:[],password:'Synthetic-Platform-Initial-2026!'},ownerCookie);
  const logged=(await ok('/api/auth/login',{username,password:'Synthetic-Platform-Initial-2026!'})).cookie;
  const cookie=(await ok('/api/auth/password',{currentPassword:'Synthetic-Platform-Initial-2026!',password:'Synthetic-Platform-Personal-2026!'},logged)).cookie;
  return {cookie,member:(await state(cookie)).me};
 }
 const reference=await createActor('synthetic_reference_admin','admin');
 assert.equal(reference.member.owner,false);
 const promoted=[];
 for(let index=1;index<=5;index++)promoted.push(await createActor('synthetic_promoted_'+index,'sales'));
 const restricted=await createActor('synthetic_restricted','viewer');
 const seedBytes=workbook('seed'),seedForm=upload(seedBytes,'synthetic-seed.xlsx',{mode:'active'});
 for(const actor of promoted){
  assert.equal((await request('/api/workspace/ledger-preview',seedForm,actor.cookie)).status,403);
  assert.equal((await request('/api/workspace/member',{...actor.member,role:'admin'},actor.cookie)).status,403);
 }
 pass('五个未授权业务账号不能上传工作表或自行提升管理员');
 const before=identitySnapshot(),promotedIds=new Set(promoted.map(actor=>actor.member.id));
 for(const actor of promoted)await ws('member',{...actor.member,role:'admin'},ownerCookie);
 const after=identitySnapshot(),afterRows=new Map(after.records.map(row=>[row.id,row])),beforeIds=new Set(before.records.map(row=>row.id));
 assert.deepEqual(after.accounts,before.accounts);
 for(const row of before.records){
  const current=afterRows.get(row.id);assert(current);
  if(promotedIds.has(row.id)){const expected=JSON.parse(row.data);expected.role='admin';assert.deepEqual(JSON.parse(current.data),expected);}
  else assert.deepEqual(current,row);
 }
 const added=after.records.filter(row=>!beforeIds.has(row.id));
 assert.equal(added.length,5);
 for(const row of added){const item=JSON.parse(row.data);assert.equal(row.kind,'audit');assert.equal(item.action,'更新成员权限');assert(promotedIds.has(item.targetId));}
 for(const actor of promoted){
  const live=(await state(actor.cookie)).me;
  assert.equal(live.role,'admin');assert.equal(live.owner,false);
  assert.equal(live.id,actor.member.id);assert.equal(live.userId,actor.member.userId);
  assert.equal((await ok('/api/auth/session',undefined,actor.cookie)).data.user.role,'admin');
  actor.member=live;
 }
 pass('提升仅改变五个 role 并新增对应审计；账号身份保留，原有登录会话立即取得 admin 权限');
 await ws('customer-save',{customer:'Synthetic administrator customer',customerCode:'SYN-ADMIN',salesName:owner.name,serviceName:'',pmcName:'',salesMemberIds:[owner.id],serviceMemberIds:[],quoteMemberIds:[],notes:'Synthetic HTTP parity fixture',active:true},ownerCookie);
 const customer=(await state(ownerCookie)).customerAccounts.find(row=>row.customerCode==='SYN-ADMIN');assert(customer);
 const project=(await ws('customer-project-save',{token:randomUUID(),customerId:customer.id,code:'SYN-ADMIN-PROJECT',title:'Synthetic admin parity project',salesMemberId:owner.id},ownerCookie)).item;
 const baselineProcess=await ws('process-data',undefined,reference.cookie);
 assert.deepEqual([...baselineProcess.allowedKinds].sort(),[...processKinds].sort());
 const baselineProject=await ws('customer-project-data',undefined,reference.cookie);
 assert.equal(baselineProject.canManageTeams,true);assert.equal(baselineProject.canWrite,true);
 const ownerAccount=(await ok('/api/auth/accounts',undefined,ownerCookie)).data.accounts.find(row=>row.member_id===owner.id);
 assert(ownerAccount);
 const sourceBytes=Buffer.from('Synthetic project original bytes\n');
 const initialAttachment=(await ws('customer-project-attachment',upload(sourceBytes,'synthetic-original.txt',{projectId:project.id,category:'original-communication',note:'Synthetic fixture'}),ownerCookie)).item;
 assert.equal((await request('/api/workspace/customer-project-file?id='+initialAttachment.id,undefined,restricted.cookie)).status,403);
 assert.equal((await request('/api/workspace/customer-project-attachment',upload(sourceBytes,'synthetic-denied.txt',{projectId:project.id,category:'original-communication'}),restricted.cookie)).status,403);
 for(const [index,actor] of [reference,...promoted].entries()){
  const prefix=index===0?'基准管理员':'提升账号 '+index;
  const feed=await ws('process-data',undefined,actor.cookie);
  assert.deepEqual(feed.allowedKinds,baselineProcess.allowedKinds);
  const projectFeed=await ws('customer-project-data',undefined,actor.cookie),visible=projectFeed.projects.find(row=>row.id===project.id);
  assert(visible?.canWrite&&visible.canManageAssignments&&visible.canManageTasks);
  assert.equal(projectFeed.canManageTeams,baselineProject.canManageTeams);
  await ok('/api/auth/accounts',undefined,actor.cookie);
  assert.equal((await request('/api/auth/reset',{id:ownerAccount.id,password:'Synthetic-Unapplied-Reset-2026!'},actor.cookie)).status,403,'Owner recovery boundary must remain identical');
  const bytes=workbook(index),form=upload(bytes,'synthetic-admin-'+index+'.xlsx',{mode:'active'});
  const preview=await ws('ledger-preview',form,actor.cookie);assert.equal(preview.total,1);
  const source=await request('/api/workspace/ledger-file?id='+preview.id,undefined,actor.cookie);
  assert.equal(source.status,200);assert.equal(sha(Buffer.from(await source.arrayBuffer())),sha(bytes));
  await ws('ledger-commit',{id:preview.id,offset:0},actor.cookie);
  await ws('ledger-commit',{id:preview.id,offset:0},actor.cookie);
  let order=(await state(actor.cookie)).orders.find(row=>row.orderNo==='SYN-ADMIN-'+index);assert(order);
  await ws('ledger-edit',{id:order.id,version:order.version,patch:{AG:'30',AL:'20'},reason:'Synthetic cross-department verification'},actor.cookie);
  order=(await state(actor.cookie)).orders.find(row=>row.id===order.id);
  assert.equal(order.ledger.columns.AG,'30');assert.equal(order.ledger.columns.AL,'20');
  const exported=await request('/api/workspace/ledger-export?mode=active',undefined,actor.cookie);
  assert.equal(exported.status,200);
  const exportedBook=XLSX.read(await exported.arrayBuffer());
  assert(XLSX.utils.sheet_to_json(exportedBook.Sheets[exportedBook.SheetNames[0]]).some(row=>row['订单号']===order.orderNo));
  const photoBytes=Uint8Array.from([255,216,255,224,83,89,78,index]);
  const photo=await ws('receipt-photo',upload(photoBytes,'synthetic-receipt-'+index+'.jpg'),actor.cookie);
  const outsourced=(await ws('outsource-create',{lineId:order.id,supplier:'Synthetic supplier',process:'plating',quantity:10,sentDate:'2026-10-01',dueDate:'2026-10-02',reference:'SYN-ADMIN-OUT-'+index,token:randomUUID()},actor.cookie)).item;
  const confirm={photoId:photo.id,supplier:'Synthetic supplier',deliveryNo:'SYN-ADMIN-DEL-'+index,receivedDate:'2026-10-02',note:'Synthetic receipt confirmation',token:randomUUID(),lines:[{outsourceId:outsourced.id,accepted:5,rejected:0}]};
  await ws('receipt-confirm',confirm,actor.cookie);
  await ws('receipt-confirm',confirm,actor.cookie);
  assert.equal((await state(actor.cookie)).outsource.find(row=>row.id===outsourced.id).received,5);
  for(const type of processKinds){
   const fields={type,customerId:customer.id,orderId:order.id,title:'Synthetic '+index+' '+type,ownerId:actor.member.id,responsibleId:actor.member.id,details:{}};
   const saved=(await ws('process-save',{...fields,token:randomUUID()},actor.cookie)).record;
   assert(saved.canEdit);
   if(type==='warehouse'){
    const completed=(await ws('process-save',{...fields,id:saved.id,version:saved.version,token:randomUUID(),status:'已完成',actualDate:'2026-10-02',outputEvidence:'Synthetic completion evidence',gateStatus:'通过'},actor.cookie)).record;
    assert.equal(completed.status,'已完成');assert.equal(completed.version,saved.version+1);
   }
  }
  const document=await request('/api/workspace/customer-project-file?id='+initialAttachment.id,undefined,actor.cookie);
  assert.equal(document.status,200);assert.equal(sha(Buffer.from(await document.arrayBuffer())),sha(sourceBytes));
  const projectBytes=Buffer.from('Synthetic '+index+' worksheet original');
  const file=(await ws('customer-project-attachment',upload(projectBytes,'synthetic-project-'+index+'.xlsx',{projectId:project.id,note:'Synthetic spreadsheet attachment'}),actor.cookie)).item;
  const download=await request('/api/workspace/customer-project-file?id='+file.id,undefined,actor.cookie);
  assert.equal(download.status,200);assert.equal(sha(Buffer.from(await download.arrayBuffer())),sha(projectBytes));
  pass(prefix+'：14 类部门流程保存、完成确认、工作表导入导出、跨部门工序、收货确认及项目附件读写均成功');
 }
 const finalState=await state(ownerCookie),firstOrder=finalState.orders[0];
 assert.equal(finalState.orders.length,6);
 assert.equal(finalState.receipts.length,6);
 assert.equal((await ws('process-data',undefined,ownerCookie)).records.length,84);
 assert.equal((await request('/api/workspace/ledger-preview',seedForm,restricted.cookie)).status,403);
 assert.equal((await request('/api/workspace/ledger-edit',{id:firstOrder.id,version:firstOrder.version,patch:{AG:'99'},reason:'Synthetic forbidden update'},restricted.cookie)).status,403);
 assert.equal((await request('/api/workspace/process-save',{type:'warehouse',orderId:firstOrder.id,title:'Synthetic forbidden process'},restricted.cookie)).status,403);
 assert.equal((await request('/api/workspace/member',{...restricted.member,role:'admin'},restricted.cookie)).status,403);
 assert.equal((await request('/api/workspace/customer-project-file?id='+initialAttachment.id)).status,401);
 assert.equal((await request('/api/workspace/ledger-commit',{id:'synthetic',offset:0},promoted[0].cookie,{Origin:'https://untrusted.invalid'})).status,403);
 pass('无关 viewer、匿名访问、自行提权和跨站提交仍被拒绝；重复确认与导入不生成重复记录');
 const report={passed:checks.length,checks,at:new Date().toISOString(),buildDir:dist,artifacts:dir,syntheticOnly:true,productionWrites:0,actors:6,departmentKinds:14,orders:6,receipts:6,processRecords:84,workspaceApiSha256:sha(await fs.readFile(path.join(dist,'workspace-api.mjs'))),serverSha256:sha(await fs.readFile(path.join(dist,'server.mjs')))};
 await fs.writeFile(path.join(dir,'results.json'),JSON.stringify(report,null,2));
 await fs.writeFile(path.join(output,'platform-admin-access-result.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({passed:checks.length,artifacts:dir,syntheticOnly:true,productionWrites:0}));
}catch(error){
 await fs.writeFile(path.join(dir,'failure-log.txt'),logs);
 console.error('Synthetic artifacts:',dir);
 throw error;
}finally{server.kill();}
