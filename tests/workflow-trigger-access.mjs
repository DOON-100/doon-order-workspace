// Actual API and SQLite, synthetic identities/data only. No server or production DB.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {AsyncLocalStorage} from 'node:async_hooks';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {defaultTrigger} from '../experiments/mastra-studio/workflow-triggers.mjs';

test('全模块触发字段 API：真实权限投影、原子 outbox、回滚、并发、撤权与时间匹配',async()=>{
 await fs.mkdir('test-output',{recursive:true});const dir=await fs.mkdtemp(path.resolve('test-output/workflow-trigger-api-')),db=new DatabaseSync(':memory:'),identity=new AsyncLocalStorage();
 for(const name of (await fs.readdir('drizzle')).filter(n=>n.endsWith('.sql')).sort())db.exec(await fs.readFile('drizzle/'+name,'utf8'));
 class Statement{constructor(sql,args=[]){this.sql=sql;this.args=args;}bind(...args){return new Statement(this.sql,args);}async first(){return db.prepare(this.sql).get(...this.args)||null;}async all(){return{results:db.prepare(this.sql).all(...this.args)};}async run(){return db.prepare(this.sql).run(...this.args);}}
 globalThis.__workflowIdentity=identity;globalThis.__workflowEnv={WORKFLOW_EVENTS_ENABLED:'1',DB:{prepare:sql=>new Statement(sql),batch:async statements=>{db.exec('BEGIN');try{const out=statements.map(s=>db.prepare(s.sql).run(...s.args));db.exec('COMMIT');return out;}catch(error){db.exec('ROLLBACK');throw error;}}},BUCKET:{get:async()=>null}};
 const file=path.join(dir,'api.mjs');await build({stdin:{contents:"export * from './app/api/workspace/[action]/route';export {commit} from './lib/store';",resolveDir:process.cwd(),loader:'ts'},outfile:file,bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@':process.cwd()},plugins:[{name:'synthetic-workflow-bindings',setup(b){b.onResolve({filter:/^cloudflare:workers$|chatgpt-auth$/},args=>({path:args.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='cloudflare:workers'?'export const env=globalThis.__workflowEnv':'export async function getChatGPTUser(){return globalThis.__workflowIdentity.getStore()}'}));}}]});
 const api=await import(pathToFileURL(file).href),at='2026-10-18T00:00:00Z';
 const member=(id,role,customers=[])=>({id,kind:'member',name:id,email:id+'@example.invalid',userId:id,role,customers,active:true,orderScope:'assigned',createdAt:at});
 const admin=member('SYN-ADMIN','admin'),sales=member('SYN-SALES','sales',['合成甲']),outsider=member('SYN-OTHER','viewer',['合成乙']);
 const order=(id,customer,email)=>({id,kind:'order',version:1,createdAt:at,updatedAt:at,updatedBy:'SYN',source:'synthetic',orderNo:id,customer,customerPO:'',drawing:'SYN-D',color:'',lens:'',batch:'',quantity:10,requestedDate:'2026-10-25',ownerEmail:email,stage:'生产中',plannedDate:'',shipDate:'',promisedDate:'',promiseConfirmed:false,customerNote:'',arrangement:'',notes:'SYN original',sourceStatus:'',extra:{},ledger:{columns:{W:'合成产品',BF:'0'},sourceRow:1,sheet:'合成',filename:'synthetic.xlsx',sourceHash:'SYN',issues:[],ownerName:'SYN',originalOutstanding:'10'}});
 const a=order('SYN-A','合成甲',sales.email),b=order('SYN-B','合成乙',outsider.email);
 const insert=r=>db.prepare('INSERT INTO records VALUES(?,?,?)').run(r.id,r.kind,JSON.stringify(r));for(const r of [admin,sales,outsider,a,b])insert(r);
 const account={id:'SYN-CUSTOMER-A',kind:'customer_account',customer:'合成甲',customerCode:'SYN-A',salesName:sales.name,serviceName:'',pmcName:'',quoteMemberIds:[sales.id],active:true,notes:'',version:1,createdAt:at,updatedAt:at,updatedBy:'SYN'};
 const quote={id:'SYN-QUOTE',kind:'customer_quote',customerAccountId:account.id,customerName:'合成甲',customerCode:'SYN-A',version:1,status:'draft',quoteNo:'SYN-Q',quoteDate:'2026-10-18',validUntil:'2026-11-18',currency:'USD',lines:[],terms:[],reviewNotes:[],internalNotesZh:'SYN-PRIVATE-COST',internalCosts:[],createdAt:at,updatedAt:at};
 for(const r of [account,quote,{id:'SYN-QUOTE-POLICY',kind:'customer_quote_access',memberIds:[sales.id],aliasesByMember:{},internalMemberIds:[],customerMemberIds:{[account.id]:[sales.id]}}])insert(r);
 const call=(action,body,actor=sales)=>identity.run({userId:actor.userId,email:actor.email,displayName:actor.name},async()=>{const url='http://127.0.0.1:19911/api/workspace/'+action,response=await api[body?'POST':'GET'](new Request(url,{method:body?'POST':'GET',headers:{Origin:'http://127.0.0.1:19911','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),{params:Promise.resolve({action:action.split('?')[0]})});return{status:response.status,body:await response.json()};});
 try{
  const catalog=await call('workflow-field-catalog?source=data');assert.equal(catalog.status,200,JSON.stringify(catalog.body));const fields=catalog.body.datasets.find(d=>d.path==='/orders').fields;
  assert.ok(fields.some(f=>f.path==='/notes'));assert.ok(fields.some(f=>f.path==='/ledger/columns/W'));assert.ok(!JSON.stringify(catalog.body).includes('SYN-B'));
  const salesQuote=await call('workflow-field-catalog?source=customer-quotes'),adminQuote=await call('workflow-field-catalog?source=customer-quotes',undefined,admin);assert.equal(salesQuote.status,200);assert.equal(adminQuote.status,200);
  assert.ok(!salesQuote.body.datasets.find(d=>d.path==='/quotes').fields.some(f=>f.path==='/internalNotesZh'),'可看报价不等于可看内部成本');assert.ok(adminQuote.body.datasets.find(d=>d.path==='/quotes').fields.some(f=>f.path==='/internalNotesZh'));
  const nextA={...a,version:2,notes:'SYN matched'},nextB={...b,version:2,notes:'SYN-PRIVATE-B'};await api.commit(0,[nextA,nextB]);
  assert.equal(db.prepare('SELECT count(*) n FROM workflow_event_outbox').get().n,1);
  await assert.rejects(()=>api.commit(0,[{...a,notes:'stale'}]),/其他成员/);assert.equal(db.prepare('SELECT count(*) n FROM workflow_event_outbox').get().n,1,'失败事务不留下事件');
  const trigger={...defaultTrigger(),mode:'change',source:'data',dataset:'/orders',watchFields:['/notes'],conditions:{mode:'all',items:[{field:'/notes',operator:'eq',compare:'literal',value:'SYN matched'}]}};
  const page=await call('workflow-trigger-events',{trigger,cursor:0});assert.equal(page.status,200,JSON.stringify(page.body));assert.equal(page.body.events.length,1);assert.equal(page.body.events[0].recordId,a.id);assert.equal(page.body.events[0].matched,true);assert.ok(!JSON.stringify(page.body).includes('SYN-PRIVATE-B'));
  const again=await call('workflow-trigger-events',{trigger,cursor:page.body.cursor});assert.equal(again.body.events.length,0);
  const weekday=new Date(Date.now()+8*3600000).getUTCDay()||7;
  const scheduled={...trigger,mode:'schedule',schedule:{time:'00:00',timezone:'Asia/Shanghai',frequency:'weekly',weekdays:[weekday%7+1]}};
  const notToday=await call('workflow-trigger-schedule',{trigger:scheduled});assert.equal(notToday.status,200);assert.equal(notToday.body.events.length,0,'非计划星期不扫描执行事件');
  const today=await call('workflow-trigger-schedule',{trigger:{...scheduled,schedule:{...scheduled.schedule,weekdays:[weekday]}}});assert.equal(today.status,200);assert(today.body.events.length>0);assert(today.body.events.every(e=>e.recordId===a.id),'定时数据仍受当前账号范围限制');
  const bad=await call('workflow-trigger-events',{trigger:{...trigger,watchFields:['/privateField']},cursor:0});assert.equal(bad.status,403);
  const verified=await call('workflow-trigger-verify',{trigger,event:page.body.events[0]});assert.equal(verified.body.valid,true);
  const results=await Promise.allSettled([api.commit(1,[{...nextA,version:3,notes:'SYN concurrent A'}]),api.commit(1,[{...nextB,version:3,notes:'SYN concurrent B'}])]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(db.prepare('SELECT count(*) n FROM workflow_event_outbox').get().n,2);
  assert.equal((await call('workflow-trigger-verify',{trigger,event:page.body.events[0]})).body.valid,false,'来源版本改变后原执行载荷失效');
  const currentA=JSON.parse(db.prepare('SELECT data FROM records WHERE id=?').get(a.id).data);await api.commit(2,[{...sales,customers:[]},{...currentA,ownerEmail:outsider.email,version:currentA.version+1}]);assert.equal((await call('workflow-trigger-events',{trigger,cursor:0})).status,403,'撤去客户与本人订单范围后，历史日志也不能用于读取旧记录');
  globalThis.__workflowEnv.WORKFLOW_EVENTS_ENABLED='0';const disabled=await call('workflow-trigger-events',{trigger,cursor:0},admin);assert.equal(disabled.body.enabled,false,'默认关闭时不声称已监听');
 }finally{db.close();if(!dir.startsWith(path.resolve('test-output')+path.sep))throw Error('Unexpected test path');await fs.rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
