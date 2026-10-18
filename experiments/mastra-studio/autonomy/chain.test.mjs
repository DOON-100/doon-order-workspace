import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {DatabaseSync} from 'node:sqlite';
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createAgentPlatform} from '../../../standalone/agent-platform.mjs';
import {fingerprint} from './store.mjs';
import {PlatformClient} from './platform-client.mjs';

const root=fileURLToPath(new URL('../../../',import.meta.url)),dist=path.resolve(process.env.DOON_BUILD_DIR||path.join(root,'test-output','agent-chain-build'));
const {readAgentPurchase}=await import(pathToFileURL(path.join(dist,'agent-policy.mjs')).href);
const config={token:'synthetic-service-token-'.padEnd(43,'x'),serviceMemberId:'member-admin'};
const source={id:'SYN-PURCHASE-001',kind:'purchase',version:1,po:'SYN-PO-001',quantity:160,received:100,returnPending:0,balanceKnown:true,unit:'件',promisedDate:'2026-10-16',sourceAsOf:'2026-10-17',lifecycle:'active',auditStatus:'已审核',closeStatus:'未关闭'};
function fixture(){
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT,data TEXT)');let clock=Date.now();
 const write=row=>db.prepare('INSERT OR REPLACE INTO records VALUES(?,?,?)').run(row.id,row.kind,JSON.stringify(row));
 for(const row of [source,...['admin','buyer','other'].map(name=>({id:'member-'+name,kind:'member',userId:'user-'+name,name,role:name==='admin'?'admin':'pmc',active:true,customers:[],departments:[]}))])write(row);
 const records=()=>db.prepare('SELECT data FROM records').all().map(row=>JSON.parse(row.data));
 const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}};
 const api=createAgentPlatform({db,records,transaction,readPurchase:readAgentPurchase,config,now:()=>clock,scanMs:10,approvalMs:200});
 const current=name=>({member:records().find(row=>row.id==='member-'+name),account:{must_change:0}});
 api.setBinding(current('admin'),{sourceId:source.id,reviewerMemberId:'member-buyer',coordinatorMemberId:'member-admin',active:true,expectedVersion:0,requestId:'binding'});api.scan();
 const review=(taskId='proc-1',extra={})=>{const current=api.source(source.id);return api.requestReview({requestId:taskId,sourceId:source.id,sourceVersion:current.version,sourceFingerprint:current.fingerprint,bindingVersion:1,taskId,caseId:'case-1',taskRevision:0,category:'purchase-followup',reason:'合成采购核验',proposal:'合成内部方案',deadline:clock+50,...extra});};
 const decide=(human,action='approve',name='buyer')=>api.decide(current(name),{id:human.id,version:human.version,payloadHash:human.payloadHash,action,comment:'合成核验说明',requestId:human.id+':'+action});
 return{db,api,write,records,current,review,decide,advance:ms=>clock+=ms};
}

test('中台自动发现业务变化并去重；只新增协作记录、不改原采购及账号',()=>{
 const f=fixture();try{const original=()=>fingerprint(f.records().filter(row=>!row.kind.startsWith('agent_')).sort((a,b)=>a.id.localeCompare(b.id))),before=original();const first=f.api.poll({ack:[]});assert.equal(first.events.length,1);assert(first.events[0].risk);assert.equal(f.api.poll({ack:[first.events[0].id]}).events.length,0);
 f.write({...source,version:2,received:120});f.advance(11);const changed=f.api.poll({ack:[]});assert.equal(changed.events.length,1);assert.equal(changed.sources[0].remaining,40);f.api.scan();assert.equal(f.api.poll({ack:[]}).events.length,1);
 f.write(source);assert.equal(original(),before);
 }finally{f.api.close();f.db.close();}
});

test('审批属于当前员工，绑定原文/版本/来源/有效期；源变化和撤权拒绝，过期待办保留',()=>{
 const f=fixture();try{const human=f.review();assert.equal(f.api.inbox(f.current('other')).length,0);assert.throws(()=>f.decide(human,'approve','other'),/本人/);f.write({...source,version:2,received:120});assert.throws(()=>f.decide(human),/来源/);assert.equal(f.api.inbox(f.current('buyer'))[0].status,'pending');
 const newer=f.review('proc-1',{requestId:'revision-2'});assert.equal(newer.id,human.id);assert.equal(newer.version,2);f.advance(201);assert.throws(()=>f.decide(newer),/过期/);assert.equal(f.api.inbox(f.current('buyer'))[0].status,'pending');
 const expired=f.api.poll({ack:[]}).events.filter(row=>row.type==='review_expired');assert.equal(expired.length,1);f.api.scan();assert.equal(f.api.poll({ack:[]}).events.filter(row=>row.type==='review_expired').length,1);
 f.write({...f.current('buyer').member,active:false});assert.throws(()=>f.review('new-task'),/权限/);
 }finally{f.api.close();f.db.close();}
});

test('协调批准不能冒充采购批准；执行必须回中台核验并保存持久回执',()=>{
 const f=fixture();try{const human=f.review(),decision=f.decide(human);assert.equal(f.decide(human).decisionId,decision.decisionId);assert.equal(f.api.source(source.id).received,100);
 const input={humanId:human.id,decisionId:decision.decisionId,payloadHash:human.payloadHash,taskId:human.taskId,purpose:'complete'};assert.throws(()=>f.api.validateDecision(input),/齐货/);
 f.write({...source,version:2,received:160});const receipt=f.api.validateDecision(input);assert.equal(receipt.source.remaining,0);assert.equal(f.api.validateDecision(input).id,receipt.id);assert.equal(receipt.businessWrite,false);
 const coordination=f.review('sup-1',{category:'coordination',targetTaskId:'proc-1',targetRole:'procurement',targetRevision:0,goal:'重新核验'}),accepted=f.decide(coordination,'approve','admin');assert.throws(()=>f.api.validateDecision({humanId:coordination.id,decisionId:accepted.decisionId,payloadHash:coordination.payloadHash,taskId:'sup-1',purpose:'complete'}),/齐货/);
 f.write({...source,version:3,received:150});assert.throws(()=>f.api.validateDecision({humanId:coordination.id,decisionId:accepted.decisionId,payloadHash:coordination.payloadHash,taskId:'sup-1',purpose:'resume'}),/来源/);
 const manual=f.review('sup-cap',{category:'coordination',targetTaskId:'proc-1',targetRole:'procurement',targetRevision:3,goal:'人工接管'}),manualDecision=f.decide(manual,'approve','admin');assert.equal(manual.payload.manualOnly,true);assert.throws(()=>f.api.validateDecision({humanId:manual.id,decisionId:manualDecision.decisionId,payloadHash:manual.payloadHash,taskId:manual.taskId,purpose:'resume'}),/人工接管/);
 }finally{f.api.close();f.db.close();}
});

test('执行时重新检查批准人权限及有效期；过期或来源变化的旧方案仍可由本人拒绝',()=>{
 const f=fixture();try{
  const human=f.review(),decision=f.decide(human),input={humanId:human.id,decisionId:decision.decisionId,payloadHash:human.payloadHash,taskId:human.taskId,purpose:'complete'};
  f.write({...source,version:2,received:160});f.write({...f.current('buyer').member,active:false});assert.throws(()=>f.api.validateDecision(input),/权限/);
  f.write({...f.current('buyer').member,active:true});f.advance(201);assert.throws(()=>f.api.validateDecision(input),/过期/);
  const pending=f.review('second-task');f.advance(201);assert.equal(f.decide(pending,'reject').status,'rejected');assert.equal(f.api.source(source.id).received,160);
 }finally{f.api.close();f.db.close();}
});

test('来源数量异常与退货待补不能当作齐货，服务凭据和事件确认不能越过当前范围',async()=>{
 const f=fixture();try{
  f.write({...source,received:200});assert.equal(f.api.source(source.id).full,false);assert.equal(f.api.source(source.id).balanceKnown,false);
  f.write({...source,received:150,returnPending:10});assert.equal(f.api.source(source.id).full,false);
  const invalid=new Request('http://127.0.0.1:19999/api/agent-platform/service/poll',{method:'POST',headers:{Authorization:'Bearer invalid','Content-Type':'application/json'},body:'{"ack":[]}'});await assert.rejects(()=>f.api.handle(invalid,f.current('admin')),error=>error.status===401);
  const event=f.api.poll({ack:[]}).events[0];f.api.setBinding(f.current('admin'),{sourceId:source.id,reviewerMemberId:'member-buyer',coordinatorMemberId:'member-admin',active:false,expectedVersion:1,requestId:'disable'});assert.throws(()=>f.api.poll({ack:[event.id]}),/范围/);
 }finally{f.api.close();f.db.close();}
});

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('撤回范围中的缓存事件不阻塞其他授权业务，恢复授权后可继续消费',()=>{
 const client=new PlatformClient(':memory:',{origin:'http://127.0.0.1:19999',token:config.token});try{
  client.store.put('binding',{id:'revoked',authorised:false});client.store.put('binding',{id:'allowed',authorised:true});client.store.put('remote-event',{id:'old',sourceId:'revoked'});client.store.put('remote-event',{id:'new',sourceId:'allowed'});assert.deepEqual(client.pendingEvents().map(row=>row.id),['new']);client.store.put('binding',{id:'revoked',authorised:true});assert.equal(client.pendingEvents().length,2);
 }finally{client.close();}
});
async function until(check,timeout=30000){const end=Date.now()+timeout;while(Date.now()<end){const value=await check();if(value)return value;await sleep(100);}throw Error('业务链路等待超时');}
async function freePort(){const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const {port}=server.address();await new Promise(resolve=>server.close(resolve));return port;}

test('实际中台API自动事件→采购拒绝→总管协调审批→恢复原任务→重新审核→原业务收货API→回传PMC',{timeout:150000},async()=>{
 const directory=await fs.mkdtemp(path.join(root,'test-output','chain-http-'));await fs.writeFile(path.join(directory,'autonomy-sandbox.json'),JSON.stringify({kind:'doon-autonomy-synthetic-v1'}));const port=await freePort(),backendPort=await freePort(),origin=`http://127.0.0.1:${port}`,back=`http://127.0.0.1:${backendPort}`;let child,backendPid;const cookies={};
 async function launch(){child=spawn(process.execPath,[fileURLToPath(new URL('./start.mjs',import.meta.url))],{cwd:root,env:{...process.env,DOON_AUTONOMY_DIR:directory,DOON_AUTONOMY_PORT:String(port),DOON_AUTONOMY_BACKEND_PORT:String(backendPort),DOON_AUTONOMY_PLATFORM:'api',DOON_STUDIO_MODEL:'offline',DOON_BUILD_DIR:dist},stdio:['ignore','ignore','pipe'],windowsHide:true});child.stderr.on('data',()=>{});await until(async()=>{try{return(await fetch(origin+'/health',{signal:AbortSignal.timeout(500)})).ok;}catch{return false;}});backendPid=await until(async()=>{try{const row=JSON.parse(await fs.readFile(path.join(directory,'validation-status.json'),'utf8'));return row.pid===child.pid?row.backendPid:false;}catch{return false;}});}
 async function stop(){if(child){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;child=null;}if(backendPid){try{process.kill(backendPid);}catch(error){if(error.code!=='ESRCH')throw error;}backendPid=null;}await sleep(250);}
 async function request(route,body,who='admin',extra={},base=origin){const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{...(cookies[who]?{Cookie:cookies[who]}:{}),...(body===undefined?{}:{Origin:base,'Content-Type':'application/json'}),...extra},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});return{status:response.status,data:await response.json(),response};}
 async function ok(route,body,who){const row=await request(route,body,who);assert.equal(row.status,200,JSON.stringify(row.data));return row.data;}
 const state=()=>ok('/api/agent-validation/status'),inbox=who=>ok('/api/agent-inbox',undefined,who);
 async function decide(row,action,who){return ok('/api/agent-inbox/decide',{id:row.id,version:row.version,payloadHash:row.payloadHash,action,comment:'合成验证明确处理结果',requestId:crypto.randomUUID()},who);}
 try{
  await launch();const accounts=JSON.parse(await fs.readFile(path.join(directory,'synthetic-accounts.json'),'utf8'));
  const nativePage=await(await fetch(back+'/personal-tasks')).text(),previewPage=await(await fetch(origin+'/personal-tasks')).text();assert(nativePage.includes('/agent-workbench-inbox.js?platform=native'));assert.equal((previewPage.match(/<script[^>]+agent-[^>]+/g)||[]).length,1);assert.equal((await fetch(back+'/agent-workbench-inbox.js?platform=native')).status,200);
  for(const [who,name]of Object.entries({admin:'validation_admin',buyer:'validation_buyer',other:'validation_other'})){const account=accounts.find(row=>row.username===name),result=await request('/api/auth/login',{username:name,password:account.password},'anonymous');assert.equal(result.status,200);cookies[who]=result.response.headers.get('set-cookie').split(';')[0];}
  assert.equal((await request('/api/agent-platform/service/poll',{ack:[]},'anonymous',{},back)).status,401);
  assert.equal((await request('/api/agent-platform/bindings',{actorId:'forged'},'buyer')).status,400);
  assert.equal((await request('/api/agent-inbox/decide',{},'buyer',{Origin:'https://example.invalid'})).status,403);
  const first=await until(async()=>{const data=await inbox('buyer');return data.items.find(row=>row.status==='pending'&&row.category==='purchase-followup');});
  assert.equal((await state()).cases.length,1);assert.equal((await state()).automaticBusinessEvents,true);assert.equal((await request('/api/agent-validation/start',{requestId:'manual-not-needed'})).status,400);
  await decide(first,'reject','buyer');
  const coordination=await until(async()=>{const data=await inbox('admin');return data.items.find(row=>row.status==='pending'&&row.category==='coordination');});
  assert.equal((await inbox('buyer')).items.find(row=>row.id===first.id).status,'rejected');assert.equal((await state()).tasks.find(row=>row.role==='procurement').state,'waiting_coordination');
  const input={id:coordination.id,version:coordination.version,payloadHash:coordination.payloadHash,action:'approve',comment:'合成协调批准',requestId:'coordination-approval'};
  assert.equal((await request('/api/agent-inbox/decide',input,'buyer')).status,403);
  await stop();await launch();assert.equal((await inbox('admin')).items.find(row=>row.id===coordination.id).status,'pending');
  const approval=await ok('/api/agent-inbox/decide',input);assert.equal((await ok('/api/agent-inbox/decide',input)).decisionId,approval.decisionId);
  const second=await until(async()=>{const data=await inbox('buyer');return data.items.find(row=>row.status==='pending'&&row.id!==first.id);});
  assert.equal(second.taskId,first.taskId);assert.equal(second.payload.taskRevision,1);let data=await state();assert.equal(data.tasks.filter(row=>row.role==='procurement').length,1);assert.equal(data.source.received,100);assert.equal(data.cases[0].state,'open');
  await decide(second,'approve','buyer');await until(async()=>{const data=await state();return data.tasks.some(row=>row.role==='procurement'&&row.state==='waiting_time');});
  data=await state();await ok('/api/agent-validation/receipt',{received:160,expectedVersion:data.source.version});await until(async()=>{const data=await state();return data.cases[0].state==='completed';});
  data=await state();assert(data.tasks.find(row=>row.role==='procurement').result.verificationId);assert(data.tasks.find(row=>row.role==='pmc').result.verificationId);assert(data.events.some(row=>row.type==='task_resumed'));
  const db=new DatabaseSync(path.join(directory,'workspace.sqlite'),{readOnly:true});try{assert(db.prepare("SELECT COUNT(*) n FROM records WHERE kind='agent_execution_receipt'").get().n>=2);assert.equal(JSON.parse(db.prepare('SELECT data FROM records WHERE id=?').get(source.id).data).received,160);assert.equal(db.prepare("SELECT COUNT(*) n FROM records WHERE kind='purchase_event'").get().n,1);}finally{db.close();}
 }finally{if(child)await stop();await fs.rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100}).catch(error=>{if(error.code!=='EBUSY')throw error;});}
});
