import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {assignments,orderNo} from './multi-user.fixture.mjs';
import {PlatformClient} from './platform-client.mjs';
import {createAutonomyRuntime} from './runtime.mjs';
import {createDeepSeekStatus} from '../deepseek.mjs';
import {fingerprint} from './store.mjs';

const root=fileURLToPath(new URL('../../../',import.meta.url)),dist=path.resolve(process.env.DOON_BUILD_DIR||path.join(root,'test-output/agent-chain-build'));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function freePort(){const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
async function until(check,timeout=120000){const end=Date.now()+timeout;while(Date.now()<end){const value=await check();if(value)return value;await sleep(100);}throw Error('多员工验证等待超时');}

test('六订单八采购风险：按账号准确投递、多员工并发审批、冲突与回执隔离',{timeout:600000},async()=>{
 const live=process.env.DOON_MULTI_USER_LIVE==='1',directory=await fs.mkdtemp(path.join(root,'test-output',live?'agent-multi-live-':'agent-multi-test-')),port=await freePort(),origin=`http://127.0.0.1:${port}`,cookies={},checks=[];
 await fs.writeFile(path.join(directory,'multi-user-sandbox.json'),JSON.stringify({kind:'doon-multi-user-synthetic-v1'}));
 const env={...process.env,DOON_BUILD_DIR:dist,DOON_DATA_DIR:directory,DOON_HOST:'127.0.0.1',DOON_PORT:String(port),DOON_SYNTHETIC_ONLY:'1',DOON_NO_AUTO_BACKUP:'1',DOON_SERVER_MODE:'internal',DOON_REVIEW_MODE:'0',DOON_STUDIO_ENABLED:'0',DOON_EMPLOYEE_PUBLIC_ORIGIN:'',DOON_SUPPLIER_PUBLIC_ORIGIN:'',DOON_TLS_CERT:'',DOON_TLS_KEY:''};
 let server,runtime,client,db,accounts,succeeded=false;
 const pass=(name,details={})=>{checks.push({name,...details});console.log('PASS '+name);};
 async function call(route,body,who='admin'){
  const response=await fetch(origin+route,{method:body===undefined?'GET':'POST',headers:{...(cookies[who]?{Cookie:cookies[who]}:{}),...(body===undefined?{}:{Origin:origin,'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  return{status:response.status,data:await response.json(),response};
 }
 async function ok(route,body,who){const result=await call(route,body,who);assert.equal(result.status,200,JSON.stringify(result.data));return result.data;}
 const inbox=async who=>(await ok('/api/agent-platform/inbox',undefined,who)).items;
 const account=alias=>accounts.find(row=>row.alias===alias);
 const decisions=()=>db.prepare("SELECT data FROM records WHERE kind='agent_decision'").all().map(row=>JSON.parse(row.data));
 const events=()=>db.prepare("SELECT data FROM records WHERE kind='agent_event'").all().map(row=>JSON.parse(row.data));
 const input=(row,action,requestId=randomUUID())=>({id:row.id,version:row.version,payloadHash:row.payloadHash,action,comment:'合成并发验收 '+row.sourceId+' '+action,requestId});
 try{
  await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[fileURLToPath(new URL('./multi-user.fixture.mjs',import.meta.url))],{cwd:root,env,stdio:['ignore','ignore','pipe'],windowsHide:true});child.stderr.on('data',()=>{});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('多员工合成夹具初始化失败')));});
  accounts=JSON.parse(await fs.readFile(path.join(directory,'synthetic-accounts.json'),'utf8'));
  const token=randomBytes(32).toString('base64url'),secretFile=path.join(directory,'agent-service-secret.json');await fs.writeFile(secretFile,JSON.stringify({token,serviceMemberId:account('admin').memberId}),{mode:0o600});
  Object.assign(env,{DOON_AGENT_PLATFORM_ENABLED:'1',DOON_AGENT_PLATFORM_SECRET_FILE:secretFile});
  server=spawn(process.execPath,[path.join(dist,'server.mjs')],{cwd:root,env,stdio:['ignore','ignore','pipe'],windowsHide:true});server.stderr.on('data',()=>{});
  await until(async()=>{try{return(await fetch(origin+'/health',{signal:AbortSignal.timeout(500)})).ok;}catch{return false;}},20000);
  for(const row of accounts){const result=await call('/api/auth/login',{username:row.username,password:row.password},'anonymous');assert.equal(result.status,200);cookies[row.alias]=result.response.headers.get('set-cookie').split(';')[0];}
  const another=await call('/api/auth/login',{username:account('a').username,password:account('a').password},'anonymous');assert.equal(another.status,200);cookies.a2=another.response.headers.get('set-cookie').split(';')[0];assert.notEqual(cookies.a,cookies.a2);
  db=new DatabaseSync(path.join(directory,'workspace.sqlite'),{readOnly:true});
  const originalRows=()=>db.prepare("SELECT id,data FROM records WHERE kind IN ('purchase','order','member') ORDER BY id").all(),before=originalRows(),beforeHash=fingerprint(before);
  for(const row of assignments)await ok('/api/agent-platform/bindings',{sourceId:row.id,reviewerMemberId:account(row.owner).memberId,coordinatorMemberId:account('admin').memberId,active:true,expectedVersion:0,requestId:'multi-binding:'+row.id});
  client=new PlatformClient(path.join(directory,'platform-cache.sqlite'),{origin,token});await client.refresh();
  const model=live?await createDeepSeekStatus({env:{...process.env,DOON_STUDIO_MODEL:'deepseek-flash'}}).model():undefined;
  runtime=await createAutonomyRuntime({dataDir:path.join(directory,'agent'),platform:client,liveModel:model,engineOptions:{humanTimeoutMs:600000,followupMs:600000}});runtime.engine.start(25);
  await until(async()=>{const rows=await Promise.all(['a','b','c'].map(inbox));return rows.flat().filter(row=>row.status==='pending'&&row.category==='purchase-followup').length===8;},live?240000:120000);
  const delivered=Object.fromEntries(await Promise.all(accounts.map(async row=>[row.alias,await inbox(row.alias)])));
  for(const who of ['a','b','c','peer','idle','admin']){
   const expected=assignments.filter(row=>row.owner===who).map(row=>row.id).sort(),actual=delivered[who].map(row=>row.sourceId).sort();assert.deepEqual(actual,expected);
   for(const human of delivered[who]){const expected=assignments.find(row=>row.id===human.sourceId);assert.equal(human.recipientMemberId,account(who).memberId);assert.equal(human.recipient,account(who).userId);assert.equal(human.payload.evidence.customerOrder,orderNo(expected.order));assert.equal(human.payload.evidence.itemCode,'SYN-MAT-'+expected.order+'-'+expected.line);assert.equal(human.payload.evidence.po,'SYN-SHARED-PO');assert.equal(runtime.engine.case(human.caseId).sourceId,human.sourceId);assert.equal(runtime.engine.task(human.taskId).caseId,human.caseId);const text=human.payload.reason+' '+human.payload.proposal;for(const other of assignments.filter(item=>item.id!==human.sourceId)){assert(!text.includes(other.id),'方案引用了其他采购记录');assert(!text.includes('SYN-MAT-'+other.order+'-'+other.line),'方案引用了其他物料');if(other.order!==expected.order)assert(!text.includes(orderNo(other.order)),'方案引用了其他订单');}}
  }
  for(const human of Object.values(delivered).flat()){const text=human.payload.reason+' '+human.payload.proposal;assert(!/客户(?:交期|承诺|约定|要求)[^。；\n]{0,20}2026-10-16/.test(text),'把采购供应商日期误称为客户交期');}
  assert.equal(new Set(Object.values(delivered).flat().map(row=>row.id)).size,8);assert.equal(runtime.engine.store.list('case').length,8);
  pass('六订单八采购行投递准确，同名员工按账号ID隔离，A4/B2/C2，其余账号0',{counts:{a:4,b:2,c:2,peer:0,idle:0,admin:0}});
  if(process.env.DOON_MULTI_USER_UI_GATE==='1'){
   await fs.writeFile(path.join(root,'test-output/agent-multi-ui-ready.json'),JSON.stringify({directory,origin,port,live,stage:'initial-delivery'}));
   await until(async()=>{try{await fs.access(path.join(directory,'continue-validation'));return true;}catch{return false;}},240000);
  }
  const humans=Object.fromEntries(Object.values(delivered).flat().map(row=>[row.sourceId,row])),row=n=>humans['SYN-MULTI-P'+String(n).padStart(2,'0')];
  // Reproduce the API-commit / worker-ledger-commit interruption while keeping
  // all canonical humans and native HTTP decisions intact. The native event ID
  // is deliberately distinct from its decision ID (unlike the local adapter).
  runtime.engine.stop();await until(()=>!runtime.engine.busy);const interrupted=runtime.engine.task(row(8).taskId);runtime.engine.store.put('task',{...interrupted,humanId:null,state:'queued',runId:null,attempts:0});
  const attackResults=await Promise.all(assignments.flatMap(item=>['a','b','c','peer','idle','admin'].filter(who=>who!==item.owner).map(who=>call('/api/agent-platform/decide',input(humans[item.id],'approve'),who))));
  assert(attackResults.every(result=>result.status===403));assert.equal(decisions().length,0);pass('四十个跨账号抢处理请求全部拒绝，包含可读全部业务的PMC和管理员',{requests:attackResults.length});
  const actions=[{n:1,who:'a',action:'approve'},{n:2,who:'a',action:'approve'},{n:4,who:'a',action:'reject'},{n:5,who:'c',action:'return'},{n:6,who:'c',action:'approve'}],duplicate=input(row(8),'approve','same-retry-token');
  const approve=input(row(3),'approve','same-retry-token'),reject=input(row(3),'reject','conflicting-rejection');
  const batch=await Promise.all([...actions.map(item=>call('/api/agent-platform/decide',input(row(item.n),item.action,'shared-across-humans:'+item.n),item.who)),...Array.from({length:12},(_,i)=>call('/api/agent-platform/decide',duplicate,i%2?'a2':'a')),call('/api/agent-platform/decide',approve,'b'),call('/api/agent-platform/decide',reject,'b')]);
  assert(batch.slice(0,actions.length).every(result=>result.status===200));const repeated=batch.slice(actions.length,actions.length+12);assert(repeated.every(result=>result.status===200));assert.equal(new Set(repeated.map(result=>result.data.decisionId)).size,1);assert.deepEqual(batch.slice(-2).map(result=>result.status).sort(),[200,409]);
  const conflictWinner=batch.at(-2).status===200?'approve':'reject',expected=new Map(actions.map(item=>[row(item.n).sourceId,item.action]));expected.set(row(8).sourceId,'approve');expected.set(row(3).sourceId,conflictWinner);
  assert.equal(decisions().length,7);assert.equal(events().filter(item=>item.type==='human_decision').length,7);
  const nativeEvent=events().find(item=>item.type==='human_decision'&&item.taskId===row(8).taskId);assert.notEqual(nativeEvent.id,nativeEvent.decision.id);
  for(const decision of decisions()){const assigned=assignments.find(item=>item.id===decision.sourceId);assert.equal(decision.actorMemberId,account(assigned.owner).memberId);assert.equal(decision.actorId,account(assigned.owner).userId);assert.equal(decision.action,expected.get(decision.sourceId));assert.equal(decision.humanId,humans[decision.sourceId].id);assert.equal(decision.taskId,humans[decision.sourceId].taskId);}
  assert.equal(fingerprint(originalRows()),beforeHash);pass('十九个同时发出的处理请求：不同待办独立、双会话十二次重试只记一次、相反决定仅一个生效',{requests:batch.length,decisions:7,duplicateRequests:12,conflictingStatuses:batch.slice(-2).map(item=>item.status)});
  runtime.engine.start(25);
  await until(()=>[...expected].every(([id,action])=>runtime.engine.task(humans[id].taskId).state===(action==='approve'?'waiting_time':'waiting_coordination')),live?240000:120000);
  const escalated=[...expected].filter(([,action])=>action!=='approve').map(([id])=>id);
  await until(async()=>(await inbox('admin')).filter(item=>item.category==='coordination'&&item.status==='pending').length===escalated.length,live?180000:120000);
  for(const [id,action]of expected){const task=runtime.engine.task(humans[id].taskId);assert.equal(task.decision.actorId,account(assignments.find(item=>item.id===id).owner).userId);assert.equal(task.decision.action,action);}
  assert.deepEqual((await inbox('admin')).filter(item=>item.status==='pending').map(item=>item.sourceId).sort(),escalated.sort());
  assert.equal(runtime.engine.task(row(8).taskId).humanId,row(8).id);pass('回执只唤醒对应采购任务，原生审批已落库但任务未关联时也能恢复，拒绝/退回准确进入对应总管协调');
  const approvedSource=[...expected].find(([id,action])=>action==='approve'&&id!==row(8).sourceId)[0],sourceRecord=JSON.parse(db.prepare('SELECT data FROM records WHERE id=?').get(approvedSource).data),prior=runtime.engine.store.list('case').map(item=>({id:item.id,sourceId:item.sourceId,state:item.state}));
  await ok('/api/workspace/purchase-receipt',{id:approvedSource,version:sourceRecord.version,type:'receipt',quantity:60,date:'2026-10-18',reference:'SYN-MULTI-RECEIPT',note:'合成多员工验收，仅完成这一条采购',token:randomUUID()});
  await until(()=>runtime.engine.case(humans[approvedSource].caseId).state==='completed',live?120000:60000);
  for(const item of prior)assert.equal(runtime.engine.case(item.id).state,item.sourceId===approvedSource?'completed':'open');
  assert.equal(runtime.engine.store.list('case').filter(item=>item.state==='completed').length,1);pass('只对一条采购登记收货，只完成对应事项，其余七条不受影响');
  const waiting=row(7),waitingSource=JSON.parse(db.prepare('SELECT data FROM records WHERE id=?').get(waiting.sourceId).data);
  await ok('/api/workspace/purchase-receipt',{id:waiting.sourceId,version:waitingSource.version,type:'receipt',quantity:10,date:'2026-10-18',reference:'SYN-MULTI-PARTIAL',note:'合成旧页面并发核验',token:randomUUID()});
  assert.equal((await call('/api/agent-platform/decide',input(waiting,'approve'),'b')).status,409);
  await until(async()=>(await inbox('b')).some(item=>item.id===waiting.id&&item.version>waiting.version),live?120000:60000);
  assert.equal((await inbox('b')).find(item=>item.id===waiting.id).status,'pending');assert.equal((await inbox('a')).filter(item=>item.status==='pending').length,0);assert.equal((await inbox('c')).filter(item=>item.status==='pending').length,0);pass('B账号旧页面遇到来源更新返回冲突，只更新B的原待办版本');
  const aSame=row(8),bReplay=await call('/api/agent-platform/decide',approve,'b');assert.equal(bReplay.status,conflictWinner==='approve'?200:409);if(bReplay.status===200)assert.notEqual(bReplay.data.decisionId,repeated[0].data.decisionId);assert.equal(decisions().find(item=>item.humanId===aSame.id).actorId,account('a').userId);
  const after=originalRows(),allowedChanged=new Set([approvedSource,waiting.sourceId]);for(const item of before)if(!allowedChanged.has(item.id))assert.equal(after.find(row=>row.id===item.id).data,item.data);pass('请求去重不串账号，除两次明确合成收货外，订单/人员/其他采购字节保持一致');
  const report={ok:true,checkedAt:new Date().toISOString(),modelLive:live,orders:6,purchaseRisks:8,employeeAccounts:3,checks,scope:'已配置采购行与员工账号映射；单worker消费，原生中台HTTP并发请求；合成业务数据',directory};
  await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(report,null,2));await fs.writeFile(path.join(root,'test-output',live?'agent-multi-live-result.json':'agent-multi-result.json'),JSON.stringify(report,null,2));
  succeeded=true;
 }catch(error){await fs.writeFile(path.join(directory,'failure.json'),JSON.stringify({message:error.message,checks},null,2));throw error;}
 finally{
  if(runtime)await runtime.close();client?.close();db?.close();if(server){const exited=new Promise(resolve=>server.once('exit',resolve));server.kill();await exited;}
  // Retain failed/live evidence. Successful offline fixtures are disposable.
  if(!live&&succeeded)await fs.rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100}).catch(error=>{if(error.code!=='EBUSY')throw error;});
 }
});
