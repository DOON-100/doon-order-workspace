import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

// Entirely synthetic and isolated: no local account credentials or production data.
const output=path.resolve('test-output','customer-quote-write-grants-'+process.pid);
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
const identity=new AsyncLocalStorage(),files=new Map();
globalThis.__quoteWriteIdentity=identity;
globalThis.__quoteWriteEnv={DB:{prepare:sql=>new Statement(sql),batch:async statements=>{
 db.exec('BEGIN');try{const result=statements.map(statement=>db.prepare(statement.sql).run(...statement.args));db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}
}},BUCKET:{put:async(key,bytes)=>files.set(key,new Uint8Array(bytes)),get:async key=>{const bytes=files.get(key);return bytes?{arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),body:bytes}:null;}}};
const outfile=path.join(output,'api.mjs');
await build({entryPoints:['app/api/workspace/[action]/route.ts'],outfile,bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@':process.cwd()},plugins:[{name:'quote-write-test',setup(builder){
 builder.onResolve({filter:/^cloudflare:workers$/},()=>({path:'cloudflare',namespace:'quote-write-test'}));
 builder.onResolve({filter:/chatgpt-auth$/},()=>({path:'auth',namespace:'quote-write-test'}));
 builder.onLoad({filter:/.*/,namespace:'quote-write-test'},args=>({contents:args.path==='auth'?'export async function getChatGPTUser(){return globalThis.__quoteWriteIdentity.getStore()||null}':'export const env=globalThis.__quoteWriteEnv;'}));
}}]});
const api=await import(pathToFileURL(outfile).href);
const actor=role=>({userId:'write_'+role,email:'write_'+role+'@test.invalid',displayName:'合成写入'+role,fullName:'合成写入'+role}),admin=actor('admin');
async function call(action,body,user=admin){const method=body===undefined?'GET':'POST';return identity.run(user,()=>api[method](new Request('https://synthetic.test/api/workspace/'+action,{method,headers:body instanceof FormData?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)}),{params:Promise.resolve({action:action.split('?')[0]})}));}
async function ok(action,body,user=admin){const response=await call(action,body,user),result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;}
const raw=()=>db.prepare('SELECT id,kind,data FROM records ORDER BY id').all(),current=id=>JSON.parse(db.prepare('SELECT data FROM records WHERE id=?').get(id).data);
const insert=record=>db.prepare('INSERT INTO records(id,kind,data) VALUES(?,?,?)').run(record.id,record.kind,JSON.stringify(record));
const revision=()=>db.prepare("SELECT revision FROM workspace_revision WHERE id='main'").get().revision;
async function reject(action,body,user=actor('clerk'),status=403){const before=raw(),beforeRevision=revision(),beforeFiles=[...files].map(([k,v])=>[k,Buffer.from(v)]),response=await call(action,body,user);assert.equal(response.status,status,await response.text());assert.deepEqual(raw(),before);assert.equal(revision(),beforeRevision);assert.deepEqual([...files].map(([k,v])=>[k,Buffer.from(v)]),beforeFiles);}
const checks=[],pass=name=>{checks.push(name);console.log('PASS '+name);};
await ok('enroll',{});
for(const role of ['sales','clerk','pmc','viewer']){await ok('member',{name:actor(role).displayName,email:actor(role).email,role,customers:[],active:true});await ok('enroll',{},actor(role));}
const members=raw().filter(row=>row.kind==='member').map(row=>JSON.parse(row.data)),member=role=>members.find(row=>row.role===role);
const account={id:'synthetic_write_customer',kind:'customer_account',customer:'Synthetic Write Customer',customerCode:'WRITE-A',salesName:member('sales').name,serviceName:member('clerk').name,salesMemberIds:[member('sales').id],serviceMemberIds:[member('clerk').id,member('pmc').id],quoteMemberIds:[member('sales').id,member('clerk').id,member('pmc').id],active:true,version:1};
const foreign={...account,id:'synthetic_write_other_customer',customer:'Synthetic Other Customer',customerCode:'WRITE-B',serviceName:'',serviceMemberIds:[],quoteMemberIds:[member('sales').id]};insert(account);insert(foreign);
const policyId='synthetic_write_policy';insert({id:policyId,kind:'customer_quote_access',memberIds:[member('sales').id,member('clerk').id,member('pmc').id,member('viewer').id],aliasesByMember:{},internalMemberIds:[member('clerk').id]});
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort((a,b)=>a.localeCompare(b)).map(key=>[key,canonical(value[key])])):value;
const policyInput=extra=>{const policy=current(policyId);return {expectedPolicySha256:createHash('sha256').update(JSON.stringify(canonical(policy))).digest('hex'),memberIds:policy.memberIds,aliasesByMember:policy.aliasesByMember,...extra};};
const draft={companyEn:'Synthetic Company',companyZh:'合成公司',collectionEn:'Synthetic',collectionZh:'合成',customerAccountId:account.id,customerName:account.customer,customerCode:account.customerCode,quoteNo:'WRITE-TEST',quoteDate:'2026-10-15',validUntil:'2026-12-31',currency:'USD',lines:[{id:'line',model:'SYNTH-MODEL',quantity:300,unitPrice:12,toolingFee:0,descriptionZh:'合成',descriptionEn:'Synthetic',sourceFormula:'PRIVATE-SOURCE-FORMULA'}],terms:[{id:'term',labelZh:'条款',labelEn:'Terms',zh:'条款',en:'Reviewed terms',needsReview:false,reviewNote:'PRIVATE-TERM-REVIEW'}],reviewNotes:['PRIVATE-REVIEW-NOTES'],internalNotesZh:'PRIVATE-INTERNAL-NOTE',internalCosts:[{id:'cost',label:'PRIVATE-COST',rmb:5,notes:'private'}],exchangeRateCnyPerUsd:7};
const bodyOf=q=>Object.fromEntries(['id','version',...Object.keys(draft)].filter(key=>q[key]!==undefined).map(key=>[key,q[key]]));
const safe=value=>{for(const secret of ['PRIVATE-SOURCE-FORMULA','PRIVATE-TERM-REVIEW','PRIVATE-REVIEW-NOTES','PRIVATE-INTERNAL-NOTE','PRIVATE-COST'])assert(!JSON.stringify(value).includes(secret),'Leaked '+secret);};
let q=(await ok('customer-quote-save',draft)).quote;
const foreignQuote=(await ok('customer-quote-save',{...draft,quoteNo:'FOREIGN',customerAccountId:foreign.id,customerName:foreign.customer,customerCode:foreign.customerCode})).quote;
let feed=await ok('customer-quotes',undefined,actor('clerk'));safe(feed);assert.equal(feed.canCreate,false);assert.equal(feed.quotes[0].canEdit,false);
await reject('customer-quote-save',{...draft,id:q.id,version:q.version});
await reject('customer-quote-access-update',policyInput({writableMemberIds:[member('clerk').id]}));
await reject('customer-quote-access-update',policyInput({writableMemberIds:['not-in-quote-list']}),admin,400);
await reject('customer-quote-access-update',policyInput({writableMemberIds:[member('clerk').id,member('clerk').id]}),admin,400);
await reject('customer-quote-access-update',policyInput({writableMemberIds:[member('viewer').id]}),admin,400);
pass('原客服只读策略保持；非管理员、未知成员、重复成员和错误岗位不能授写入权，拒绝均无写入');

const untouched=raw(),oldRevision=raw().filter(row=>row.kind==='customer_quote_revision');
await ok('customer-quote-access-update',policyInput({writableMemberIds:[member('clerk').id]}));
for(const row of untouched)if(row.id!==policyId)assert.deepEqual(raw().find(value=>value.id===row.id),row);
assert.deepEqual(current(policyId).internalMemberIds,[member('clerk').id]);assert.equal(Object.hasOwn(current(policyId),'administratorMemberIds'),false);assert.equal(Object.hasOwn(current(policyId),'customerMemberIds'),false);
feed=await ok('customer-quotes',undefined,actor('clerk'));safe(feed);assert.equal(feed.canCreate,true);assert.equal(feed.canUseUnbound,false);assert.equal(feed.customers.length,1);assert.equal(feed.customers[0].canWrite,true);assert.equal(feed.customers[0].canSeeInternal,false);assert.equal(feed.customers[0].canSeeReviewDetails,false);
q=feed.quotes.find(row=>row.id===q.id);assert.equal(q.canEdit,true);assert.equal(q.canConfirm,false);assert.equal(q.canSeeInternal,false);assert.equal(q.canSeeReviewDetails,false);
const update=bodyOf(q);update.lines[0].unitPrice=15;
q=(await ok('customer-quote-save',update,actor('clerk'))).quote;safe(q);assert.equal(q.lines[0].unitPrice,15);
const stored=current(q.id);assert.equal(stored.lines[0].sourceFormula,draft.lines[0].sourceFormula);assert.equal(stored.terms[0].reviewNote,draft.terms[0].reviewNote);assert.deepEqual(stored.reviewNotes,draft.reviewNotes);assert.equal(stored.internalNotesZh,draft.internalNotesZh);assert.deepEqual(stored.internalCosts,draft.internalCosts);assert.equal(stored.exchangeRateCnyPerUsd,draft.exchangeRateCnyPerUsd);
for(const row of oldRevision)assert.deepEqual(raw().find(value=>value.id===row.id),row);
const create=bodyOf(q);delete create.id;delete create.version;create.quoteNo='SERVICE-CREATED';const created=(await ok('customer-quote-save',create,actor('clerk'))).quote;assert.equal(created.version,1);safe(created);
pass('显式授权客服可修改本人报价及新建草稿；旧版本不变，不可见内部字段按行标识保留且不泄露');

for(const extra of [{internalNotesZh:'tamper'},{internalCosts:[{id:'x',label:'tamper',rmb:1,notes:''}]},{exchangeRateCnyPerUsd:8},{reviewNotes:['tamper']},{lines:q.lines.map(line=>({...line,sourceFormula:'tamper'}))},{terms:q.terms.map(term=>({...term,reviewNote:'tamper'}))}]){
 await reject('customer-quote-save',{...bodyOf(q),...extra});
 await reject('customer-quote-save',{...create,...extra});
}
await reject('customer-quote-save',{...bodyOf(q),customerAccountId:foreign.id,customerName:foreign.customer,customerCode:foreign.customerCode});
await reject('customer-quote-save',{...bodyOf(foreignQuote),lines:foreignQuote.lines.map(line=>({...line,unitPrice:18}))});
await reject('customer-quote-save',{...create,customerAccountId:null});
await reject('customer-quote-confirm',{id:q.id,version:q.version,acknowledgeEnglish:true});
await reject('customer-quote-file?id='+q.id,undefined);
const ungranted=await ok('customer-quotes',undefined,actor('pmc'));assert.equal(ungranted.canCreate,false);assert.equal(ungranted.quotes[0].canEdit,false);await reject('customer-quote-save',bodyOf(q),actor('pmc'));
safe((await ok('data',undefined,actor('clerk'))).audits);
pass('授权不跨客户、不授确认或原件特权；未授权客服仍只读，内部成本与公式的新增和修改全部拒绝');

const upload=new FormData();for(const [key,value] of Object.entries({quoteId:q.id,quoteVersion:String(q.version),lineId:'line',category:'image'}))upload.set(key,value);
upload.set('file',new File([Uint8Array.from([137,80,78,71,13,10,26,10,0])],'synthetic.png',{type:'image/png'}));
q=(await ok('customer-quote-media-upload',upload,actor('clerk'))).quote;safe(q);assert.equal(q.media.length,1);assert.equal(current(q.id).lines[0].sourceFormula,draft.lines[0].sourceFormula);
q=(await ok('customer-quote-save',{...bodyOf(current(q.id)),reviewNotes:[]})).quote;
q=(await ok('customer-quote-confirm',{id:q.id,version:q.version,acknowledgeEnglish:true})).quote;
const confirmedVersion=q.version,confirmedSnapshot=raw().find(row=>row.kind==='customer_quote_revision'&&JSON.parse(row.data).quoteId===q.id&&JSON.parse(row.data).version===confirmedVersion);
const confirmedFeed=(await ok('customer-quotes',undefined,actor('clerk'))).quotes.find(row=>row.id===q.id);safe(confirmedFeed);assert.equal(confirmedFeed.canRevise,true);assert.equal(confirmedFeed.canRegisterSent,true);assert.equal(confirmedFeed.canEdit,false);
const send={quoteId:q.id,quoteVersion:confirmedVersion,sentDate:'2026-01-01',recipient:'synthetic@test.invalid',channel:'email',mediaIds:[],idempotencyKey:'synthetic-service-record-only'};
assert.equal((await ok('customer-quote-record-sent',send,actor('clerk'))).sentHistory.length,1);
q=(await ok('customer-quote-revise',{id:q.id,version:confirmedVersion},actor('clerk'))).quote;safe(q);assert.equal(q.status,'draft');assert.equal(q.version,confirmedVersion+1);assert.equal(current(q.id).internalNotesZh,draft.internalNotesZh);assert.deepEqual(raw().find(row=>row.id===confirmedSnapshot.id),confirmedSnapshot);
pass('授权客服可上传款式附件、登记已发记录并建立修订草稿；确认权不变，原确认快照和内部字段保留');

const preserved=policyInput({aliasesByMember:{[member('clerk').id]:['Synthetic Service Alias']}});await ok('customer-quote-access-update',preserved);assert.deepEqual(current(policyId).writableMemberIds,[member('clerk').id]);
await reject('customer-quote-access-update',preserved,admin,409);
const noChange=await ok('customer-quote-access-update',policyInput({}));assert.equal(noChange.alreadyPresent,true);assert.deepEqual(current(policyId).writableMemberIds,[member('clerk').id]);
await ok('customer-quote-access-update',policyInput({writableMemberIds:[]}));
feed=await ok('customer-quotes',undefined,actor('clerk'));assert.equal(feed.canCreate,false);assert.equal(feed.quotes.find(row=>row.id===q.id).canEdit,false);await reject('customer-quote-save',bodyOf(q));
pass('旧客户端省略字段保留显式写入授权；重复更新幂等，过期哈希拒绝，明确撤销后立即只读');

await ok('customer-quote-access-update',policyInput({writableMemberIds:[member('clerk').id]}));
db.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify({...account,serviceMemberIds:[],serviceName:'',quoteMemberIds:[member('sales').id,member('pmc').id]}),account.id);
assert.equal((await ok('customer-quotes',undefined,actor('clerk'))).quotes.length,0);await reject('customer-quote-save',bodyOf(q));
pass('撤销当前客户责任及报价绑定后写入授权不能单独扩大客户范围');
await fs.writeFile(path.join(output,'result.json'),JSON.stringify({passed:checks.length,checks},null,2));console.log(JSON.stringify({passed:checks.length,report:path.join(output,'result.json')}));db.close();
