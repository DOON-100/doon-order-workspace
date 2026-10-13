import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {AsyncLocalStorage} from 'node:async_hooks';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

// Isolated, synthetic route regression: no production DB, files or account credentials.
const output=path.resolve('test-output','customer-service-quote-readonly-'+process.pid);
await fs.mkdir(output,{recursive:true});
const db=new DatabaseSync(':memory:');
for(const name of (await fs.readdir('drizzle')).filter(name=>name.endsWith('.sql')).sort())db.exec(await fs.readFile(path.join('drizzle',name),'utf8'));
class Statement{
 constructor(sql,args=[]){this.sql=sql;this.args=args;}
 bind(...args){return new Statement(this.sql,args);}
 async first(){return db.prepare(this.sql).get(...this.args)||null;}
 async all(){return {results:db.prepare(this.sql).all(...this.args)};}
 async run(){return db.prepare(this.sql).run(...this.args);}
}
const identity=new AsyncLocalStorage();
globalThis.__directoryIdentity=identity;
globalThis.__directoryEnv={DB:{prepare:sql=>new Statement(sql),batch:async statements=>{
 db.exec('BEGIN');try{const result=statements.map(statement=>db.prepare(statement.sql).run(...statement.args));db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}
}},BUCKET:{put:async()=>{throw new Error('Directory save must not write attachments');},get:async()=>{throw new Error('Directory save must not read attachments');}}};
const outfile=path.join(output,'api.mjs');
await build({entryPoints:['app/api/workspace/[action]/route.ts'],outfile,bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@':process.cwd()},plugins:[{name:'directory-test-bindings',setup(builder){
 builder.onResolve({filter:/^cloudflare:workers$/},()=>({path:'cloudflare',namespace:'directory-test'}));
 builder.onResolve({filter:/chatgpt-auth$/},()=>({path:'auth',namespace:'directory-test'}));
 builder.onLoad({filter:/.*/,namespace:'directory-test'},args=>({contents:args.path==='auth'?'export async function getChatGPTUser(){return globalThis.__directoryIdentity.getStore()||null}':'export const env=globalThis.__directoryEnv;'}));
}}]});
const api=await import(pathToFileURL(outfile).href);
const user=role=>({userId:'directory_'+role,email:'directory_'+role+'@test.invalid',displayName:'合成'+role,fullName:'合成'+role});
const admin=user('admin');
async function call(action,body,actor=admin){
 const method=body===undefined?'GET':'POST',routeAction=action.split('?')[0];
 return identity.run(actor,()=>api[method](new Request('https://directory.test/api/workspace/'+action,{method,headers:body instanceof FormData?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)}),{params:Promise.resolve({action:routeAction})}));
}
async function ok(action,body,actor=admin){const response=await call(action,body,actor),result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;}
const raw=()=>db.prepare('SELECT id,kind,data FROM records ORDER BY id').all();
const current=id=>JSON.parse(db.prepare('SELECT data FROM records WHERE id=?').get(id).data);
const revision=()=>db.prepare("SELECT revision FROM workspace_revision WHERE id='main'").get().revision;
const insert=record=>db.prepare('INSERT INTO records(id,kind,data) VALUES(?,?,?)').run(record.id,record.kind,JSON.stringify(record));
const checks=[];
const bucketObjects=new Map();
globalThis.__directoryEnv.BUCKET={put:async(key,bytes)=>{bucketObjects.set(key,new Uint8Array(bytes));},get:async key=>{const bytes=bucketObjects.get(key);return bytes?{arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),body:bytes}:null;}};
function pass(name){checks.push(name);console.log('PASS '+name);}
function preserveOthers(before,exceptId){const after=new Map(raw().map(row=>[row.id,row]));for(const row of before)if(row.id!==exceptId)assert.deepEqual(after.get(row.id),row,'Unrelated record must remain byte-identical: '+row.id);}
async function denied(body,actor,status){const before=raw(),beforeRevision=revision(),response=await call('customer-save',body,actor);assert.equal(response.status,status,await response.text());assert.deepEqual(raw(),before);assert.equal(revision(),beforeRevision);}
const input=(record,extra={})=>({id:record.id,expectedVersion:record.version,customer:record.customer,customerCode:record.customerCode,salesName:record.salesName,serviceName:record.serviceName,pmcName:record.pmcName,notes:record.notes,active:record.active,...extra});

await ok('enroll',{});
for(const role of ['sales','clerk','pmc','viewer']){await ok('member',{name:user(role).displayName,email:user(role).email,role,customers:[],active:true});await ok('enroll',{},user(role));}
const members=raw().filter(r=>r.kind==='member').map(r=>JSON.parse(r.data)),member=role=>members.find(m=>m.role===role);
const account={id:'service_history_account',kind:'customer_account',customer:'Synthetic assigned customer',customerCode:'HIST-A',salesName:member('sales').name,serviceName:member('clerk').name,salesMemberIds:[member('sales').id],serviceMemberIds:[member('clerk').id],quoteMemberIds:[member('sales').id],active:true,version:1};
const foreign={...account,id:'service_history_foreign',customer:'Synthetic other customer',customerCode:'HIST-B',serviceName:'',serviceMemberIds:[]};insert(account);insert(foreign);
const policy={id:'synthetic_quote_readonly_policy',kind:'customer_quote_access',memberIds:[member('sales').id],internalMemberIds:[],aliasesByMember:{}};insert(policy);
const draft={companyEn:'Synthetic Company',companyZh:'合成公司',collectionEn:'Synthetic',collectionZh:'合成',customerAccountId:account.id,customerName:account.customer,customerCode:account.customerCode,quoteNo:'SERVICE-READ-ONLY',quoteDate:'2026-01-01',validUntil:'2026-12-31',currency:'USD',lines:[{id:'line',model:'SYNTH-MODEL',quantity:300,unitPrice:12,toolingFee:0,descriptionZh:'合成',descriptionEn:'Synthetic',sourceFormula:'PRIVATE-COST-FORMULA'}],terms:[{id:'term',labelZh:'条款',labelEn:'Terms',zh:'条款',en:'Reviewed terms',needsReview:false,reviewNote:'PRIVATE-TERM-REVIEW'}],reviewNotes:['PRIVATE-QUOTE-REVIEW'],internalNotesZh:'PRIVATE-INTERNAL-NOTE',internalCosts:[{id:'cost',label:'PRIVATE-INTERNAL-COST',rmb:5,notes:'private'}],exchangeRateCnyPerUsd:7};
let q=(await ok('customer-quote-save',draft)).quote;
await ok('customer-quote-save',{...draft,customerAccountId:foreign.id,customerName:foreign.customer,customerCode:foreign.customerCode,quoteNo:'FOREIGN-SECRET'});
const secrets=['PRIVATE-COST-FORMULA','PRIVATE-TERM-REVIEW','PRIVATE-QUOTE-REVIEW','PRIVATE-INTERNAL-NOTE','PRIVATE-INTERNAL-COST','FOREIGN-SECRET'];
function safe(value){for(const secret of secrets)assert(!JSON.stringify(value).includes(secret),'Leaked '+secret);}
async function reject(action,body,actor=user('clerk'),status=403){const before=raw(),beforeFiles=[...bucketObjects.entries()].map(([k,v])=>[k,Buffer.from(v)]),beforeRevision=revision();const response=await call(action,body,actor);assert.equal(response.status,status,await response.text());assert.deepEqual(raw(),before);assert.equal(revision(),beforeRevision);assert.deepEqual([...bucketObjects.entries()].map(([k,v])=>[k,Buffer.from(v)]),beforeFiles);}
let result=await ok('customer-quotes',undefined,user('clerk'));safe(result);assert.equal(result.canCreate,false);assert.equal(result.quotes.length,1);assert.equal(result.quotes[0].lines[0].unitPrice,12);assert.equal(result.quotes[0].canEdit,false);assert.equal(result.quotes[0].canSeeInternal,false);
assert.equal((await call('customer-quotes',undefined,user('viewer'))).status,403);assert.equal((await call('customer-quotes',undefined,user('pmc'))).status,403);
pass('未授报价编辑专权的本人客服可读对客历史；无关查看员/PMC无权限，成本公式及内部评注不可见');
for(const action of ['customer-quote-save','customer-quote-revise','customer-quote-confirm','customer-quote-upload','customer-quote-media-upload','customer-quote-record-sent','customer-quote-template-apply','customer-quote-template-register','customer-quote-template-archive','customer-price-archive-import','customer-price-archive-file-upload','customer-price-selection-save'])await reject(action,{id:q.id,version:q.version});
safe((await ok('data',undefined,user('clerk'))).audits);await reject('customer-quote-file?id='+q.id,undefined);
pass('仅新增只读历史入口，不授任何报价变更/附件归档/审批/历史价导入权限；拒绝时数据库和附件零写');
// A retained older quote/internal grant must not override the newly confirmed service policy.
const broader={...policy,memberIds:[...policy.memberIds,member('clerk').id],internalMemberIds:[member('clerk').id]};db.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify(broader),policy.id);
const oldBinding={...account,quoteMemberIds:[...account.quoteMemberIds,member('clerk').id]};db.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify(oldBinding),account.id);
result=await ok('customer-quotes',undefined,user('clerk'));safe(result);assert.equal(result.quotes[0].canSeeInternal,false);assert.equal(result.quotes[0].canEdit,false);
await reject('customer-quote-save',{...draft,id:q.id,version:q.version});
await reject('customer-quote-template-apply',{quoteId:q.id,version:q.version,templateId:'missing-template'});
const form=new FormData();for(const [key,value] of Object.entries({quoteId:q.id,quoteVersion:String(q.version),lineId:'line',category:'image',title:'',drawingNo:''}))form.set(key,value);
await reject('customer-quote-media-upload',form);
q=(await ok('customer-quote-save',{...draft,id:q.id,version:q.version,reviewNotes:[]})).quote;
q=(await ok('customer-quote-confirm',{id:q.id,version:q.version,acknowledgeEnglish:true})).quote;
await reject('customer-quote-revise',{id:q.id,version:q.version});
await reject('customer-quote-record-sent',{quoteId:q.id,quoteVersion:q.version,sentDate:'2026-01-01',recipient:'recipient@test.invalid',channel:'email',mediaIds:[],idempotencyKey:crypto.randomUUID()});
const completed=await ok('customer-quote-completed',undefined,user('clerk'));safe(completed);assert.equal(completed.rows.length,1);assert(completed.rows.every(r=>!r.canRegisterSent&&!r.canSupplementArchive));
const version=await ok('customer-quote-version?quoteId='+q.id+'&quoteVersion='+q.version,undefined,user('clerk'));safe(version);assert.equal(version.quote.lines[0].unitPrice,12);
safe((await ok('data',undefined,user('clerk'))).audits);
pass('历史报价/成本授权不推翻当前客服只读；已确认列表、历史版本和审计同步脱敏，销售编辑与管理员确认保留');
const ref=[{fileId:'source',sheet:'synthetic',cell:'A1',page:null}],product={id:'product',factoryModel:'SYNTH',customerModel:'SYNTH',productName:'Synthetic',productType:'frame',sku:'SYNTH-SKU',frameColor:'C1',lens:'clear',material:'synthetic',size:'50',specVersion:'1',activity:'ordered',sourceRefs:ref};
const price=(id,type,unitPrice)=>({id,productId:product.id,scope:'sku',documentType:type,documentNo:'DOC-'+id,version:'1',documentDate:'2026-01-01',currency:'USD',unit:'pair',lensVariant:'RX',quantity:300,quantityMin:null,quantityMax:null,quantityBasis:'per SKU',unitPrice,toolingFee:0,otherCharges:null,terms:'FOB',reviewStatus:'verified',sentStatus:'unknown',sourceRefs:ref,notes:'PRIVATE-INTERNAL-NOTE'});
insert({id:'synthetic_readonly_archive',kind:'customer_price_archive',customerAccountId:account.id,dataset:{schemaVersion:1,customer:{code:account.customerCode,name:account.customer},files:[{id:'source',relativePath:'synthetic.pdf',category:'quote',status:'included'}],products:[product],prices:[price('old-quote','quote',10),price('new-invoice','invoice',12),price('internal-cost','internal',1)],issues:[],excluded:[]},files:{}});
result=await ok('customer-price-archive?view=history&customerId='+account.id,undefined,user('clerk'));safe(result);assert.deepEqual(new Set(result.rows[0].history.map(p=>p.documentType)),new Set(['invoice','quote']));assert.equal(result.rows[0].history.find(p=>p.documentType==='quote').unitPrice,10);
await reject('customer-price-archive?view=history&customerId='+foreign.id,undefined);
await reject('customer-price-archive-file?archiveId=synthetic_readonly_archive&fileId=source',undefined);
const exportResult=await call('customer-price-archive-export?view=history&customerId='+account.id,undefined,user('clerk'));assert.equal(exportResult.status,200);const XLSX=await import('xlsx'),book=XLSX.read(await exportResult.arrayBuffer());safe(XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]]));
pass('历史价保留全部对客报价/发票和原币金额，内部成本、原始多客户文件及他客历史隔离，导出同范围');
const beforeQuote=raw().filter(r=>r.kind.startsWith('customer_quote')||r.kind==='customer_price_archive');
db.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify({...oldBinding,serviceName:'',serviceMemberIds:[],quoteMemberIds:account.quoteMemberIds}),account.id);
assert.equal((await ok('customer-quotes',undefined,user('clerk'))).quotes.length,0);assert.equal((await ok('customer-quote-completed',undefined,user('clerk'))).rows.length,0);
await reject('customer-quote-version?quoteId='+q.id+'&quoteVersion='+q.version,undefined);await reject('customer-price-archive?view=history&customerId='+account.id,undefined);
assert.deepEqual(raw().filter(r=>r.kind.startsWith('customer_quote')||r.kind==='customer_price_archive'),beforeQuote);
pass('客服责任撤销立即失去当前、历史和导出权限；所有原报价、快照及价格档案原样保留');
await fs.writeFile(path.join(output,'result.json'),JSON.stringify({passed:checks.length,checks},null,2));console.log(JSON.stringify({passed:checks.length,report:path.join(output,'result.json')}));db.close();
