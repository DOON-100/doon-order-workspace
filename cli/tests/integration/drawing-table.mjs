// Real native HTTP + CLI commands. Isolated synthetic accounts/data; no production requests.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {spawn,execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {temporary,root,testCodec} from '../helpers.mjs';
import {StateStore} from '../../dist/state.js';
import {FoundationService} from '../../dist/service.js';
import {main} from '../../dist/program.js';

if(!process.env.DOON_BUILD_DIR)throw Error('Set DOON_BUILD_DIR to an isolated current native build below test-output.');
const dist=await fs.realpath(path.resolve(process.env.DOON_BUILD_DIR)),testRoot=await fs.realpath(path.join(root,'test-output'));
assert(dist.startsWith(testRoot+path.sep),'Use an isolated build, never production lan-dist.');
const dir=await temporary(),dataDir=path.join(dir,'data'),inputFile=path.join(dir,'input.json');
const env={...Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^DOON_/i.test(key))),DOON_DATA_DIR:dataDir,DOON_HOST:'127.0.0.1',DOON_NO_AUTO_BACKUP:'1',DOON_KINGDEE_SUPPLIER_SYNC_ENABLED:'0',DOON_KINGDEE_READONLY_ENABLED:'0'};
const seed=path.join(dir,'seed.mjs');
await fs.writeFile(seed,`
import fs from 'node:fs/promises';import path from 'node:path';
import {db,saveRecords} from ${JSON.stringify(pathToFileURL(path.join(dist,'runtime.mjs')).href)};
import {createAccount} from ${JSON.stringify(pathToFileURL(path.join(dist,'auth.mjs')).href)};
for(const [username,name,role,departments] of [
 ['admin_test','dengkai','admin',[]],['dengkai','Synthetic Drawing User','clerk',['engineering']],
 ['zhengzw','Synthetic Approval User','clerk',['engineering']],['other_engineer','Synthetic Engineer','clerk',['engineering']],
 ['unassigned','Synthetic Other Sales','sales',[]]
])await createAccount({username,name,role,departments,password:'Synthetic-Only-2026!'},null);
for(const username of ['external_requester','disabled_requester','unbound_requester']){
 await createAccount({username,name:'Synthetic '+username,role:'viewer',personnelType:username==='external_requester'?'external':'internal',password:'Synthetic-Only-2026!'},null);
 const account=db.prepare('SELECT member_id FROM local_accounts WHERE username=?').get(username);
 const member=JSON.parse(db.prepare('SELECT data FROM records WHERE id=?').get(account.member_id).data);
 if(username==='disabled_requester')member.active=false;
 if(username==='unbound_requester')member.userId='synthetic-wrong-binding';
 saveRecords([member]);
}
db.prepare('UPDATE local_accounts SET must_change=0').run();
saveRecords([{id:'synthetic-preserved',kind:'synthetic_fixture',value:'UNCHANGED ORIGINAL'}]);
await fs.mkdir(path.join(process.env.DOON_DATA_DIR,'files'),{recursive:true});
await fs.writeFile(path.join(process.env.DOON_DATA_DIR,'files','synthetic-original.bin'),'SYNTHETIC ORIGINAL BYTES');db.close();
`);
execFileSync(process.execPath,[seed],{env,windowsHide:true,stdio:'pipe'});
const port=await new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
assert(![8787,8797,18809].includes(port));const origin=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,[path.join(dist,'server.mjs')],{env:{...env,DOON_PORT:String(port)},windowsHide:true,stdio:['ignore','ignore','pipe']});
let exited=false;const done=new Promise(resolve=>child.once('exit',()=>{exited=true;resolve();}));child.stderr.on('data',()=>{});
const checks=[],services={};const pass=name=>{checks.push(name);console.log('PASS '+name);};
const input=async value=>{await fs.writeFile(inputFile,JSON.stringify(value));return inputFile;};
async function run(args,username='other_engineer',expectedError){let output='';const original=process.stdout.write;process.stdout.write=chunk=>{output+=String(chunk);return true;};try{const code=await main(['engineering','drawings',...args,'--json'],services[username].foundation),result=JSON.parse(output);if(expectedError){assert.notEqual(code,0);assert.equal(result.error.code,expectedError);return result;}assert.equal(code,0,output);assert.equal(result.ok,true);return result.data;}finally{process.stdout.write=original;}}
async function webRows(){const state=services.other_engineer.state,session=await state.session(await state.config()),response=await fetch(origin+'/api/workspace/drawing-data',{headers:{Cookie:session.cookie}});assert.equal(response.status,200);return (await response.json()).records;}
try{
 let ready=false;for(let i=0;i<80;i++){try{if((await fetch(origin+'/health')).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}assert(ready);
 for(const username of ['admin_test','dengkai','zhengzw','other_engineer','unassigned']){const state=new StateStore(path.join(dir,username),testCodec());await state.setup(origin,true);const foundation=new FoundationService(state);await foundation.login(async()=>({username,password:'Synthetic-Only-2026!'}));services[username]={state,foundation};}
 const schema=await run(['schema']);assert.equal(schema.fields.tableEntry.type,'boolean');assert.equal(schema.tableColumns.length,13);
 const refs=await run(['references']);assert.deepEqual(refs.requesters,['admin_test','dengkai','other_engineer','unassigned','zhengzw']);assert(refs.requestersAvailable);assert.deepEqual(refs.assignees,['邓铠','杨林峰','黄智翔']);assert.equal(refs.canToggleApproval,false);
 assert.equal((await run(['references'],'dengkai')).canToggleApproval,true);pass('CLI表格字段、登录账号候选及审批能力与网页一致');

 const token=randomUUID(),partial={tableEntry:true,customerCode:'SYN-CLI-001'};
 let created=await run(['save','--input',await input(partial),'--version','0','--request-id',token]);const id=created.record.id;
 assert.equal(created.record.requestedDate,'');assert.equal(created.record.tableEntry,true);assert.equal(created.record.customerCode,partial.customerCode);
 assert.equal(created.record.deadline,'');
 assert.equal((await webRows()).find(row=>row.id===id).deadline,'');
 assert.equal((await webRows()).find(row=>row.id===id).customerCode,partial.customerCode);
 assert.equal((await run(['save','--input',inputFile,'--version','0','--request-id',token])).record.id,id);assert.equal((await webRows()).length,1);
 await run(['save','--input',await input({...partial,customerCode:'DIFFERENT'}),'--version','0','--request-id',token],'other_engineer','CONFLICT');
 await run(['save','--input',await input({tableEntry:true}),'--version','0','--request-id',randomUUID()],'other_engineer','REQUEST_REJECTED');
 await run(['save','--input',await input(partial),'--version','0','--request-id',randomUUID()],'unassigned','FORBIDDEN');
 assert.equal((await webRows()).length,1);pass('CLI只填一格即可新增到网页同表，空行拒绝且重复提交只生成一条');

 const snapshot=()=>{const db=new DatabaseSync(path.join(dataDir,'workspace.sqlite'),{readOnly:true});try{return {records:db.prepare('SELECT id,kind,data FROM records ORDER BY id').all(),revision:db.prepare("SELECT revision FROM workspace_revision WHERE id='main'").get()};}finally{db.close();}};
 const untouched=snapshot();
 for(const requester of ['missing_login','Synthetic Drawing User','DENGKAI','external_requester','disabled_requester','unbound_requester']){
  const rejected=await run(['save','--input',await input({tableEntry:true,requester}),'--version','0','--request-id',randomUUID()],'other_engineer','REQUEST_REJECTED');
  assert.equal(rejected.error.status,400);
  await run(['save','--input',await input({id,requester}),'--version','1'],'other_engineer','REQUEST_REJECTED');
 }
 const requesterSession=await services.other_engineer.state.session(await services.other_engineer.state.config());
 const rejectedHttp=await fetch(origin+'/api/workspace/drawing-save',{method:'POST',headers:{Cookie:requesterSession.cookie,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({tableEntry:true,requester:'missing_login',token:randomUUID()})});
 assert.equal(rejectedHttp.status,400);assert.match(JSON.stringify(await rejectedHttp.json()),/需求者账号无效/);
 assert.deepEqual(snapshot(),untouched);
 pass('真实服务端拒绝未知账号、姓名、大小写冒充、外部/停用/绑定异常账号，新增和修改失败均不产生记录、版本或审计');

 const patch={id,drawingType:'新款画图',requestedDate:'2026-11-01',newCount:0,revisionCount:null,requester:'dengkai',modelNo:'SYN-MODEL',drawingNotes:'Synthetic CLI table edit',assignee:'邓铠',deadline:'2026-11-05',completedDate:'2026-11-03',sheetStatus:'❗❗'};
 let updated=await run(['save','--input',await input(patch),'--version','1']);assert.equal(updated.record.version,2);
 for(const [key,value] of Object.entries(patch))assert.deepEqual(updated.record[key],value);
 assert.equal(updated.record.customerCode,'SYN-CLI-001');assert.equal(updated.record.displayStatus,'❗❗');
 await run(['save','--input',await input({id,drawingNotes:'stale'}),'--version','1'],'other_engineer','CONFLICT');
 await run(['save','--input',await input({id,tableEntry:true}),'--version','2'],'other_engineer','INVALID_INPUT');
 await run(['save','--input',await input({id,completedDate:'2026-02-30'}),'--version','2'],'other_engineer','REQUEST_REJECTED');
 await run(['save','--input',await input({id,drawingNotes:'out of scope'}),'--version','2'],'unassigned','FORBIDDEN');
 const list=await run(['list','--search','SYN-CLI-001']);assert.equal(list.page.total,1);assert.equal(list.page.rows[0].displayStatus,'❗❗');
 const web=(await webRows()).find(row=>row.id===id);for(const [key,value] of Object.entries(patch))assert.deepEqual(web[key],value);pass('CLI可补填全部表格业务字段；空值、零、日期、旧版本和越权校验有效');

 const approval=await input({id,checked:true});
 for(const username of ['admin_test','other_engineer','unassigned'])await run(['action','--type','approval-toggle','--input',approval,'--version','2'],username,'FORBIDDEN');
 const approved=await run(['action','--type','approval-toggle','--input',approval,'--version','2'],'dengkai');assert.equal(approved.record.displayStatus,'✅已完成');
 const unchecked=await run(['action','--type','approval-toggle','--input',await input({id,checked:false,sheetStatus:'⌛️'}),'--version','3'],'zhengzw');assert.equal(unchecked.record.displayStatus,'⌛️');assert.equal(unchecked.record.approval,'待审核');
 await run(['action','--type','approval-toggle','--input',await input({id,checked:true}),'--version','3'],'dengkai','CONFLICT');
 assert.equal((await run(['history',id])).page.total,4);pass('勾选与取消仅允许dengkai/zhengzw，姓名冒充、越权和旧版本均被服务器拒绝');

 const numeric=await run(['save','--input',await input({tableEntry:true,newCount:0}),'--version','0','--request-id',randomUUID()]);assert.equal(numeric.record.newCount,0);assert.equal(numeric.record.customerCode,'');
 const before=(await webRows()).find(row=>row.id===id);await run(['save','--input',await input({id,drawingNotes:''}),'--version',String(before.version)]);
 assert.equal((await webRows()).find(row=>row.id===id).modelNo,'SYN-MODEL');assert.equal((await webRows()).length,2);
 const db=new DatabaseSync(path.join(dataDir,'workspace.sqlite'),{readOnly:true});try{assert.deepEqual(JSON.parse(db.prepare('SELECT data FROM records WHERE id=?').get('synthetic-preserved').data),{id:'synthetic-preserved',kind:'synthetic_fixture',value:'UNCHANGED ORIGINAL'});}finally{db.close();}
 assert.equal(await fs.readFile(path.join(dataDir,'files','synthetic-original.bin'),'utf8'),'SYNTHETIC ORIGINAL BYTES');pass('零值可作为第一项新增，修改只变更指定字段并保留其他记录与原件');
 if(process.platform==='win32'){
  const processHome=path.join(dir,'process-cli'),processState=new StateStore(processHome);
  await processState.setup(origin,true);await new FoundationService(processState).login(async()=>({username:'other_engineer',password:'Synthetic-Only-2026!'}));
  const processInput=await input({tableEntry:true,customerCode:'SYN-CLI-PROCESS',drawingNotes:'Actual CLI process'}),processToken=randomUUID();
  const args=[path.join(root,'cli','dist','index.js'),'engineering','drawings','save','--input',processInput,'--version','0','--request-id',processToken,'--json'];
  const execute=()=>JSON.parse(execFileSync(process.execPath,args,{env:{...env,DOON_CLI_HOME:processHome},windowsHide:true,encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']}));
  const result=execute();assert.equal(result.ok,true);assert.equal(result.data.record.customerCode,'SYN-CLI-PROCESS');
  assert.equal(execute().data.record.id,result.data.record.id);
  assert.equal((await webRows()).filter(row=>row.customerCode==='SYN-CLI-PROCESS').length,1);
  pass('实际CLI进程使用隔离加密登录会话新增到网页同表，重复执行不会重复新增');
 }
 const adminState=services.admin_test.state,adminSession=await adminState.session(await adminState.config());
 async function adminApi(action,body){const response=await fetch(origin+'/api/workspace/'+action,{method:body?'POST':'GET',headers:{Cookie:adminSession.cookie,Origin:origin,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});assert.equal(response.status,200);return response.json();}
 const me=(await adminApi('data')).me;
 await adminApi('customer-save',{customer:'Synthetic CLI ordering',customerCode:'SYN-ORDERING',salesName:me.name,serviceName:me.name,pmcName:'',salesMemberIds:[me.id],serviceMemberIds:[me.id],quoteMemberIds:[],notes:'Synthetic only',active:true});
 const ordered=[];
 for(const typeFirst of [true,false]){
  let row=(await run(['save','--input',await input({tableEntry:true,...(typeFirst?{drawingType:'改图'}:{customerCode:'SYN-ORDERING'})}),'--version','0','--request-id',randomUUID()])).record;
  row=(await run(['save','--input',await input({id:row.id,...(typeFirst?{customerCode:'SYN-ORDERING'}:{drawingType:'改图'})}),'--version',String(row.version)])).record;
  assert(row.customerId);row=(await run(['save','--input',await input({id:row.id,customerCode:'SYN-ORDERING'}),'--version',String(row.version)])).record;ordered.push(row);
 }
 assert.equal(ordered[0].customerId,ordered[1].customerId);const sops=(await adminApi('sop-data')).records;
 for(const row of ordered)assert.equal(sops.filter(s=>s.drawingRecordId===row.id).length,1);
 assert.equal((await webRows()).filter(row=>ordered.some(o=>o.id===row.id)&&row.customerId===ordered[0].customerId).length,2);
 pass('CLI分步新增的填写顺序不影响客户关联及SOP，重复填写不会重复建立义务');
 // A candidate fetched earlier must not authorize a later write after disabling.
 const syntheticDb=new DatabaseSync(path.join(dataDir,'workspace.sqlite'));
 try{
  const row=syntheticDb.prepare("SELECT r.id,r.data FROM records r JOIN local_accounts a ON a.member_id=r.id WHERE a.username='dengkai'").get();
  const member={...JSON.parse(row.data),active:false};
  syntheticDb.exec('BEGIN IMMEDIATE');
  syntheticDb.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify(member),row.id);
  syntheticDb.prepare("UPDATE workspace_revision SET revision=revision+1 WHERE id='main'").run();
  syntheticDb.exec('COMMIT');
 }finally{syntheticDb.close();}
 assert(!(await run(['references'])).requesters.includes('dengkai'));
 const afterDisable=snapshot();
 await run(['save','--input',await input({tableEntry:true,requester:'dengkai'}),'--version','0','--request-id',randomUUID()],'other_engineer','REQUEST_REJECTED');
 const emptyRequester=(await webRows()).find(row=>row.id===ordered[0].id);
 await run(['save','--input',await input({id:emptyRequester.id,requester:'dengkai'}),'--version',String(emptyRequester.version)],'other_engineer','REQUEST_REJECTED');
 assert.deepEqual(snapshot(),afterDisable);
 pass('账号停用后候选和写入校验立即生效，不能利用先前读取的名单继续填写');
 console.log(JSON.stringify({passed:checks.length,syntheticOnly:true,productionRequests:0,commandExecution:process.platform==='win32'?'cli-process-and-commander-with-real-native-http':'commander-with-real-native-http'}));
}finally{if(!exited)child.kill();await done;}
