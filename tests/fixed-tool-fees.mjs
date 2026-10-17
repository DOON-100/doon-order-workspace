import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

// Synthetic, in-memory database only. No runtime, production paths or HTTP server.
const output=path.resolve('test-output','fixed-tool-fees-'+process.pid);
await fs.mkdir(output,{recursive:true});
const db=new DatabaseSync(':memory:');
for(const file of (await fs.readdir('drizzle')).filter(file=>file.endsWith('.sql')).sort())db.exec(await fs.readFile(path.join('drizzle',file),'utf8'));
class Statement{
 constructor(sql,args=[]){this.sql=sql;this.args=args;}
 bind(...args){return new Statement(this.sql,args);}
 async first(){return db.prepare(this.sql).get(...this.args)||null;}
 async all(){return {results:db.prepare(this.sql).all(...this.args)};}
 async run(){return db.prepare(this.sql).run(...this.args);}
}
let batches=0,failAfterQuote=false;
globalThis.__fixedFeesTestEnv={DB:{prepare:sql=>new Statement(sql),batch:async statements=>{
 batches++;db.exec('BEGIN');
 try{
  const results=[];
  for(const statement of statements){results.push(db.prepare(statement.sql).run(...statement.args));if(failAfterQuote&&statement.args[1]==='customer_quote'){failAfterQuote=false;throw new Error('Synthetic interruption after quote write');}}
  db.exec('COMMIT');return results;
 }catch(error){db.exec('ROLLBACK');throw error;}
}},BUCKET:{put:async()=>{throw new Error('Fee tools must not write attachments');},get:async()=>{throw new Error('Fee tools must not read attachments');}}};
const outfile=path.join(output,'fees.mjs');
await build({stdin:{contents:"export * from './lib/fixed-tool-fees'; export {snapshot} from './lib/store';",resolveDir:process.cwd(),sourcefile:'synthetic-fees-test.ts'},outfile,bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@':process.cwd()},plugins:[{name:'fixed-fees-test',setup(builder){
 builder.onResolve({filter:/^cloudflare:workers$/},()=>({path:'cloudflare',namespace:'fixed-fees-test'}));
 builder.onResolve({filter:/chatgpt-auth$/},()=>({path:'auth',namespace:'fixed-fees-test'}));
 builder.onLoad({filter:/.*/,namespace:'fixed-fees-test'},args=>({contents:args.path==='auth'?'export async function getChatGPTUser(){return null}':'export const env=globalThis.__fixedFeesTestEnv;'}));
}}]});
const api=await import(pathToFileURL(outfile).href);
const at='2026-10-17T00:00:00.000Z';
const owner={id:'synthetic_fee_owner',kind:'member',name:'Synthetic Owner',email:'fees@test.invalid',userId:'synthetic_fee_user',role:'admin',owner:true,active:true,customers:[],createdAt:at};
const customer={id:'synthetic_fee_customer',kind:'customer_account',customer:'Synthetic Customer',customerCode:'FEE-TEST',active:true,version:1};
const baseQuote={id:'synthetic_fee_quote',kind:'customer_quote',status:'draft',version:1,companyEn:'Synthetic Company',companyZh:'合成公司',collectionEn:'',collectionZh:'',customerAccountId:customer.id,customerCode:customer.customerCode,customerName:customer.customer,quoteNo:'SYNTHETIC-FEES',quoteDate:'2026-10-17',validUntil:'',currency:'USD',createdAt:at,createdBy:owner.name,createdById:owner.id,updatedAt:at,updatedBy:owner.name,updatedById:owner.id,
 lines:[{id:'line_a',model:'SYNTH-A',descriptionZh:'合成甲',descriptionEn:'Synthetic A',quantity:20,unitPrice:15,toolingFee:null,sourceFormula:'HIDDEN-SOURCE-FORMULA'},{id:'line_b',model:'SYNTH-B',descriptionZh:'合成乙',descriptionEn:'Synthetic B',quantity:30,unitPrice:25,toolingFee:4}],
 customerCharges:[{id:'charge_a',labelZh:'合成费',labelEn:'Synthetic fee',amount:10,basisZh:'固定依据',basisEn:'Fixed basis',conditional:true,needsReview:false}],
 terms:[{id:'term_a',labelZh:'条款',labelEn:'Terms',zh:'固定条款',en:'Fixed terms',needsReview:false,reviewNote:'HIDDEN-TERM-NOTE'}],reviewNotes:['HIDDEN-REVIEW'],internalCosts:[{id:'cost_a',label:'HIDDEN-COST',rmb:7,notes:''}],internalNotesZh:'HIDDEN-INTERNAL',exchangeRateCnyPerUsd:7,
 sourceFileKey:'HIDDEN-ORIGINAL-KEY',sourceHash:'a'.repeat(64),sourceFilename:'synthetic-original.xlsx',sourceContentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',mediaIds:['synthetic_media'],templateBinding:{id:'synthetic_template'},templateMapping:{synthetic:true},templateFileKey:'HIDDEN-TEMPLATE-KEY',customPreserved:{sourceVersion:12}};
const put=record=>db.prepare('INSERT INTO records(id,kind,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,data=excluded.data').run(record.id,record.kind,JSON.stringify(record));
const get=id=>{const row=db.prepare('SELECT data FROM records WHERE id=?').get(id);return row?JSON.parse(row.data):null;};
const raw=()=>db.prepare('SELECT id,kind,data FROM records ORDER BY id').all();
const revision=()=>db.prepare("SELECT revision FROM workspace_revision WHERE id='main'").get().revision;
put(owner);put(customer);put(baseQuote);put({id:'synthetic_media',kind:'customer_quote_media',quoteId:baseQuote.id,fileKey:'HIDDEN-MEDIA-KEY'});put({id:'synthetic_unrelated',kind:'synthetic_preserved',nested:{value:1}});
await api.snapshot();
const checks=[],pass=label=>{checks.push(label);console.log('PASS '+label);};
const payload=(requestKey,quote=get(baseQuote.id))=>({requestKey,quoteId:quote.id,version:quote.version,lines:quote.lines.map((line,index)=>({id:line.id,toolingFee:index?line.toolingFee:12})),customerCharges:(quote.customerCharges||[]).map(charge=>({id:charge.id,amount:0}))});
const request=(action,body)=>new Request('https://synthetic.test/api/workspace/'+action,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
async function call(action,body,actor=owner,state){try{
 const s=state||await api.snapshot(),response=await (body===undefined?api.fixedToolFeesGet(action.split('?')[0],request(action),s,actor):api.fixedToolFeesPost(action,request(action,body),s,actor));
 return {status:response.status,body:await response.json()};
}catch(error){return {status:error.status||500,body:{error:error.message}};}}
async function ok(action,body,actor=owner,state){const result=await call(action,body,actor,state);assert.equal(result.status,200,JSON.stringify(result.body));return result.body;}
async function rejected(action,body,status,actor=owner,state){const before=raw(),oldRevision=revision(),result=await call(action,body,actor,state);assert.equal(result.status,status,JSON.stringify(result.body));assert.deepEqual(raw(),before);assert.equal(revision(),oldRevision);}
const decide=(job,decision='approve')=>({id:job.id,previewHash:job.previewHash,decision});
const safe=value=>{assert(!JSON.stringify(value).includes('HIDDEN-'));for(const key of ['unitPrice','quantity','internalCosts','exchangeRateCnyPerUsd','sourceFileKey','proposal','beforeHash'])assert(!JSON.stringify(value).includes('"'+key+'"'));};

const view=await ok('fixed-tool-quote?id='+baseQuote.id);safe(view);assert.equal(view.quote.lines[0].toolingFee,null);assert.equal(view.quote.customerCharges[0].amount,10);
for(const actor of [{...owner,active:false},{...owner,owner:false},{...owner,role:'sales'}]){await rejected('fixed-tool-quote?id='+baseQuote.id,undefined,403,actor);await rejected('fixed-tool-fees-preview',payload('denied_preview'),403,actor);}
put({...customer,active:false});await rejected('fixed-tool-quote?id='+baseQuote.id,undefined,403);put(customer);
put({...baseQuote,customerAccountId:null});await rejected('fixed-tool-fees-preview',payload('unbound_quote'),409);put(baseQuote);
put({...baseQuote,status:'confirmed'});await rejected('fixed-tool-quote?id='+baseQuote.id,undefined,409);put(baseQuote);
pass('仅活跃owner管理员和有效关联客户可读写；DTO不泄露成本、内部依据或附件key，null不转零');

for(const bad of [
 {...payload('bad_extra_key'),internalNotesZh:'tamper'},
 {...payload('bad_line_field'),lines:[{id:'line_a',toolingFee:12,unitPrice:999},{id:'line_b',toolingFee:4}]},
 {...payload('bad_numeric_type'),lines:[{id:'line_a',toolingFee:'12'},{id:'line_b',toolingFee:4}]},
 {...payload('bad_negative_fee'),lines:[{id:'line_a',toolingFee:-1},{id:'line_b',toolingFee:4}]},
 {...payload('bad_charge_field'),customerCharges:[{id:'charge_a',amount:0,labelEn:'tamper'}]},
])await rejected('fixed-tool-fees-preview',bad,400);
for(const bad of [
 {...payload('bad_reorder_rows'),lines:[{id:'line_b',toolingFee:12},{id:'line_a',toolingFee:4}]},
 {...payload('bad_delete_rows'),lines:[{id:'line_a',toolingFee:12}]},
 {...payload('bad_duplicate_id'),lines:[{id:'line_a',toolingFee:12},{id:'line_a',toolingFee:4}]},
 {...payload('bad_add_charge'),customerCharges:[{id:'charge_a',amount:0},{id:'new_charge',amount:2}]},
 {...payload('bad_stale_version'),version:2},
])await rejected('fixed-tool-fees-preview',bad,409);
const unchanged={...payload('no_change_preview'),lines:baseQuote.lines.map(({id,toolingFee})=>({id,toolingFee})),customerCharges:baseQuote.customerCharges.map(({id,amount})=>({id,amount}))};
await rejected('fixed-tool-fees-preview',unchanged,400);
await rejected('fixed-tool-fees-preview',{...payload('too_large_payload'),padding:'x'.repeat(70*1024)},413);
pass('严格金额白名单拒绝非金额字段、类型强转、增删重排行、过期版本和超限请求');

const originalRows=raw(),pending=(await ok('fixed-tool-fees-preview',payload('successful_fee_job'))).job;
safe(pending);assert.equal(pending.status,'pending');assert.equal(pending.preview.changes,2);assert.equal(pending.preview.lines[0].before,null);assert.equal(pending.preview.customerCharges[0].after,0);
for(const row of originalRows)assert.deepEqual(raw().find(item=>item.id===row.id),row);
assert.equal(raw().length,originalRows.length+1);assert.equal(Date.parse(pending.expiresAt)-Date.parse(pending.createdAt),30*60*1000);
const beforeReplay=raw(),replayed=(await ok('fixed-tool-fees-preview',payload('successful_fee_job'))).job;assert.equal(replayed.id,pending.id);assert.deepEqual(raw(),beforeReplay);
await rejected('fixed-tool-fees-preview',{...payload('successful_fee_job'),customerCharges:[{id:'charge_a',amount:1}]},409);
await rejected('fixed-tool-fees-decision',{...decide(pending),previewHash:'0'.repeat(64)},409);
await rejected('fixed-tool-fees-decision',decide(pending),403,{...owner,id:'another_synthetic_owner'});
pass('预览只新增任务且30分钟到期；请求键绑定载荷，重复预览不写入，异载荷和他人确认拒绝');

for(const decision of ['reject','defer']){
 const job=(await ok('fixed-tool-fees-preview',payload('decision_'+decision))).job,quoteBefore=get(baseQuote.id),result=await ok('fixed-tool-fees-decision',decide(job,decision));
 assert.equal(result.job.status,decision==='reject'?'rejected':'deferred');assert.deepEqual(get(baseQuote.id),quoteBefore);
 await rejected('fixed-tool-fees-decision',decide(job),409);
}
const expired=(await ok('fixed-tool-fees-preview',payload('expired_fee_job'))).job,originalNow=Date.now;
try{Date.now=()=>originalNow()+31*60*1000;await rejected('fixed-tool-fees-decision',decide(expired),409);}finally{Date.now=originalNow;}
assert.equal(get(expired.id).status,'pending');assert.deepEqual(get(baseQuote.id),baseQuote);
pass('拒绝、暂缓和过期均无业务执行；暂缓不能直接转批准，未决定任务不自动执行');

const drift=(await ok('fixed-tool-fees-preview',payload('full_hash_drift'))).job;
put({...baseQuote,internalNotesZh:'HIDDEN-CHANGED-WITHOUT-VERSION'});await rejected('fixed-tool-fees-decision',decide(drift),409);put(baseQuote);
put({...baseQuote,version:2});await rejected('fixed-tool-fees-decision',decide(drift),409);put(baseQuote);
put({...customer,active:false});await rejected('fixed-tool-fees-decision',decide(drift),403);put(customer);
const staleState=await api.snapshot();db.prepare("UPDATE workspace_revision SET revision=revision+1 WHERE id='main'").run();await rejected('fixed-tool-fees-decision',decide(drift),409,owner,staleState);
failAfterQuote=true;await rejected('fixed-tool-fees-decision',decide(drift),500);assert.equal(get(drift.id).status,'pending');assert.deepEqual(get(baseQuote.id),baseQuote);
pass('批准时重验完整原报价、版本和当前客户授权；乐观锁及事务中断不留半张报价或完成回执');

const beforeApprove=raw(),batchBefore=batches,result=await ok('fixed-tool-fees-decision',decide(pending)),saved=get(baseQuote.id);
assert.equal(batches,batchBefore+1);assert.equal(result.job.status,'completed');assert.equal(result.receipt.verified,true);assert.equal(result.receipt.version,2);assert.equal(saved.version,2);safe(result);
const expected=structuredClone(baseQuote);expected.lines[0].toolingFee=12;expected.customerCharges[0].amount=0;expected.version=2;expected.updatedAt=saved.updatedAt;expected.updatedBy=owner.name;expected.updatedById=owner.id;assert.deepEqual(saved,expected);
for(const row of beforeApprove.filter(row=>![baseQuote.id,pending.id].includes(row.id)))assert.deepEqual(raw().find(item=>item.id===row.id),row);
const additions=raw().filter(row=>!beforeApprove.some(old=>old.id===row.id));assert.deepEqual(additions.map(row=>row.kind).sort(),['audit','customer_quote_revision']);
assert.deepEqual(get(result.receipt.revisionId).snapshot,saved);await api.verifyFixedToolFeeReceipt(await api.snapshot(),get(pending.id));
const committedRows=raw(),second=await ok('fixed-tool-fees-decision',decide(pending));assert.equal(second.replayed,true);assert.deepEqual(second.receipt,result.receipt);assert.deepEqual(raw(),committedRows);
pass('报价、不可变revision、audit及完成回执单次原子提交；仅指定金额和正常元数据变化，附件/模板/所有其他字段保全');

put({...saved,version:3,updatedAt:'2026-10-18T00:00:00.000Z'});
const historical=await ok('fixed-tool-fees-decision',decide(pending));assert.equal(historical.receipt.version,2);assert.equal(get(baseQuote.id).version,3);
const historicalRevision=get(result.receipt.revisionId);put({...historicalRevision,snapshot:{...historicalRevision.snapshot,currency:'EUR'}});
await rejected('fixed-tool-fees-decision',decide(pending),409);put(historicalRevision);
await rejected('fixed-tool-fees-decision',decide(pending,'reject'),409);
pass('丢失响应后按原任务恢复原receipt；后续报价更新不重复改费，历史快照被破坏时拒绝宣告成功');

console.log(`${checks.length} fixed fee checks passed.`);
db.close();
