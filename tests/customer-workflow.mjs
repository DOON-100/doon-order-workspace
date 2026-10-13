import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {AsyncLocalStorage} from 'node:async_hooks';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

// Isolated, synthetic route regression: no production DB, files or account credentials.
const output=path.resolve('test-output','customer-workflow-'+process.pid);
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
for(const role of ['sales','clerk','finance','pmc','sales2','sales3','viewer']){await ok('member',{name:user(role).displayName,email:user(role).email,role:role.startsWith('sales')?'sales':role,customers:[],active:true});await ok('enroll',{},user(role));}
const members=raw().filter(row=>row.kind==='member').map(row=>JSON.parse(row.data));
const member=role=>members.find(m=>m.email===user(role).email),sales=member('sales'),clerk=member('clerk'),sales2=member('sales2'),sales3=member('sales3');
const stamp='2026-10-01T00:00:00.000Z';
insert({id:'cw_customer',kind:'customer_account',customer:'合成客户',customerCode:'TEST001',salesName:sales.name,serviceName:clerk.name,pmcName:'原PMC保持',salesMemberIds:[sales.id],serviceMemberIds:[clerk.id],quoteMemberIds:[],active:true,notes:'原始备注保持',directory:{country:'测试国家',grade:'AA',bucket:'现有合作'},version:1,createdAt:stamp,updatedAt:stamp,updatedBy:'合成原始作者'});
insert({id:'cw_project',kind:'customer_project',customerId:'cw_customer',code:'SYNTH-P1',title:'合成项目',description:'原需求原文不可改',status:'active',version:1,createdAt:stamp});
insert({id:'cw_unrelated',kind:'synthetic_unrelated',payload:'  保留\n原文 ',nested:{value:3}});
const customerId='cw_customer',workflow=()=>raw().filter(r=>r.kind==='customer_workflow_state').map(r=>JSON.parse(r.data)).find(r=>r.customerId===customerId),profile=()=>raw().filter(r=>r.kind==='customer_workflow_profile').map(r=>JSON.parse(r.data)).find(r=>r.customerId===customerId);
const token=()=>crypto.randomUUID(),common=()=>({token:token(),customerId,version:workflow()?.version||0,customerVersion:current(customerId).version});
async function reject(action,body,who,status){const before=raw(),rev=revision(),response=await call(action,body,who);assert.equal(response.status,status,await response.text());assert.deepEqual(raw(),before);assert.equal(revision(),rev);}
const original=raw();let response=await ok('customer-workflow-data?customerId='+customerId,undefined,user('sales'));assert.equal(response.profile.version,0);assert.deepEqual(raw(),original);pass('GET无默认迁移或写入，原客户/项目/无关记录原文不变');
await reject('customer-workflow-data?customerId='+customerId,undefined,user('sales2'),403);
await reject('customer-workflow-profile-save',{token:token(),customerId,version:0,patch:{legalName:'越权'}},user('sales2'),403);
await reject('customer-workflow-profile-save',{token:token(),customerId,version:0,patch:{bankPaymentInfo:'尚未确认银行规则'}},user('sales'),403);
await reject('customer-workflow-profile-save',{token:token(),customerId,version:0,patch:{lastOrderOn:'2026-02-30'}},user('sales'),400);
pass('未授权成员、仅有银行查看权不可写、无效日期拒绝且零记录变更');
const saveProfile={token:token(),customerId,version:0,patch:{legalName:'合成公司完整名称',contactPerson:'合成联系',whatsapp:'合成电话',wechat:'合成微信',email:'synthetic@example.invalid',website:'https://example.invalid',phone:'合成电话',contacts:'其他联系原记录',brandIntroduction:'合成品牌',type:'OEM',source:'主动开发',stage:'需求了解',orderHistory:'有历史订单',lastOrderOn:'2023-01-01'}};
await ok('customer-workflow-profile-save',saveProfile,user('clerk'));const afterProfile=raw();await ok('customer-workflow-profile-save',saveProfile,user('clerk'));assert.deepEqual(raw(),afterProfile);
await reject('customer-workflow-profile-save',{...saveProfile,token:token(),patch:{legalName:'过期'}},user('sales'),409);
assert.equal(profile().fields.whatsapp,'合成电话');assert.deepEqual(current(customerId),JSON.parse(original.find(r=>r.id===customerId).data));pass('负责客服可补资料，严格版本、幂等重放，主档及原授权不改变');
await ok('customer-workflow-profile-save',{token:token(),customerId,version:profile().version,patch:{bankPaymentInfo:'合成银行账号仅授权内部可见'}},admin);
for(const role of ['sales','clerk']){const bankView=await ok('customer-workflow-data?customerId='+customerId,undefined,user(role));assert.equal(bankView.profile.fields.bankPaymentInfo,'合成银行账号仅授权内部可见');assert.equal(bankView.capabilities.writeBank,false);}
await reject('customer-workflow-data?customerId='+customerId,undefined,user('finance'),403);
pass('银行资料授权内业务/客服可见，查看不授予写入，未负责财务不额外拓宽客户权限');
const follow={token:token(),customerId,version:0,at:'2026-10-12',channel:'电话',content:'最新正文仅授权可见',result:'客户已回复',disposition:'继续跟进',next:'安排后续',nextDate:'2026-10-15',evidence:'合成原始依据'};
await ok('customer-workflow-followup',follow,user('sales'));await ok('customer-workflow-followup',{...follow,token:token(),version:1,at:'2026-10-01',next:'补旧资料',nextDate:'2026-10-02'},user('clerk'));assert.equal(workflow().next,'安排后续');assert.equal(workflow().nextDate,'2026-10-15');
const followRow=raw().filter(r=>r.kind==='customer_workflow_followup').map(r=>JSON.parse(r.data));assert(followRow.some(r=>r.authorId===clerk.id));await reject('customer-workflow-followup',{...follow,token:token(),version:2,author:'冒名'},user('sales'),400);
await ok('customer-workflow-followup',{...follow,token:token(),version:2,at:'2026-10-13',disposition:'暂停跟进',next:'稍后核对',nextDate:'2026-10-15'},user('sales'));assert.equal(workflow().followState,'暂停');assert.equal(workflow().nextDate,'');pass('跟进日期/本人作者/暂停与旧日期补录不覆盖较新安排');
const generic=JSON.stringify(await ok('data',undefined,user('sales2')));for(const secret of ['最新正文仅授权可见','合成公司完整名称','其他联系原记录'])assert(!generic.includes(secret));pass('通用data与审计不泄露独立客户正文及联系方式');
await ok('customer-workflow-primary',{...common(),to:sales.id,reason:'管理员核实原销售责任'});
await reject('customer-workflow-primary',{...common(),to:sales2.id,reason:'不能绕过现名单授权'},admin,403);
await ok('customer-workflow-handoff',{...common(),to:sales2.id,reason:'合成业务交接'},user('sales'));
let handoff=raw().filter(r=>r.kind==='customer_workflow_handoff').map(r=>JSON.parse(r.data))[0];assert.equal(workflow().primarySalesMemberId,sales.id);
response=await ok('customer-workflow-transfers',undefined,user('sales2'));assert.equal(response.handoffs.length,1);await reject('customer-workflow-data?customerId='+customerId,undefined,user('sales2'),403);
const acceptance={...common(),id:handoff.id,requestVersion:handoff.version,note:'接收人本人已核对'};
await reject('customer-workflow-accept',acceptance,admin,403);await ok('customer-workflow-accept',acceptance,user('sales2'));assert.equal(workflow().primarySalesMemberId,sales2.id);assert.deepEqual(current(customerId).salesMemberIds,[sales.id,sales2.id]);assert.deepEqual(current(customerId).serviceMemberIds,[clerk.id]);assert.deepEqual(current(customerId).quoteMemberIds,[]);assert.equal(current(customerId).pmcName,'原PMC保持');pass('交接仅指定本人接收，admin不可代接，原销售/客服/PMC/报价授权保留');
await ok('customer-workflow-pool-request',{...common(),reason:'两年未下单',basis:'核实合成2023订单日期'},user('sales2'));
let poolRequest=raw().filter(r=>r.kind==='customer_workflow_pool_request').map(r=>JSON.parse(r.data))[0];await reject('customer-workflow-pool-approve',{...common(),id:poolRequest.id,requestVersion:1,note:'不能自批'},user('sales2'),403);await ok('customer-workflow-pool-approve',{...common(),id:poolRequest.id,requestVersion:1,note:'管理员核实入公海'});
response=await ok('customer-workflow-transfers',undefined,user('sales3'));assert.equal(response.pool.length,1);const poolText=JSON.stringify(response);for(const secret of ['最新正文仅授权可见','合成联系','合成品牌','2023-01-01'])assert(!poolText.includes(secret));await reject('customer-workflow-data?customerId='+customerId,undefined,user('sales3'),403);
await ok('customer-workflow-claim',{...common(),reason:'合成新销售申请',next:'客户初访',nextDate:'2026-10-20'},user('sales3'));await reject('customer-workflow-data?customerId='+customerId,undefined,user('sales3'),403);
let claim=raw().filter(r=>r.kind==='customer_workflow_claim').map(r=>JSON.parse(r.data))[0];await reject('customer-workflow-claim-approve',{...common(),id:claim.id,requestVersion:1,note:'不能自批'},user('sales3'),403);await ok('customer-workflow-claim-approve',{...common(),id:claim.id,requestVersion:1,note:'管理员确认领取'});await ok('customer-workflow-data?customerId='+customerId,undefined,user('sales3'));assert(current(customerId).salesMemberIds.includes(sales.id)&&current(customerId).salesMemberIds.includes(sales2.id)&&current(customerId).salesMemberIds.includes(sales3.id));pass('公海仅摘要、申请不授权，管理员批准后追加权限，原成员均保留');
const fileForm=()=>{const form=new FormData();for(const [k,v] of Object.entries({token:token(),customerId,projectId:'',category:'公司资料',title:'合成正式资料',fileVersion:'V1',status:'待确认',note:'原件版本测试'}))form.set(k,v);form.set('file',new File(['synthetic original bytes'], 'sample.txt',{type:'text/plain'}));return form;};
const form=fileForm();await ok('customer-workflow-file-upload',form,user('clerk'));const afterUpload=raw(),bucketCount=bucketObjects.size;await ok('customer-workflow-file-upload',form,user('clerk'));assert.deepEqual(raw(),afterUpload);assert.equal(bucketObjects.size,bucketCount);
const attachment=raw().filter(r=>r.kind==='customer_workflow_attachment').map(r=>JSON.parse(r.data))[0];assert(attachment.hash.length===64);await reject('customer-workflow-file?id='+attachment.id,undefined,user('viewer'),403);let download=await call('customer-workflow-file?id='+attachment.id,undefined,user('sales'));assert.equal(download.status,200);assert.equal(await download.text(),'synthetic original bytes');
const fileEdit={token:token(),customerId,projectId:'',category:'公司资料',title:attachment.title,fileVersion:attachment.fileVersion,status:'已归档',note:'归档但不删',reason:'合成过期保留',id:attachment.id,version:attachment.version};await ok('customer-workflow-file-save',fileEdit,user('clerk'));assert.equal(current(attachment.id).fileKey,attachment.fileKey);assert.equal(bucketObjects.size,bucketCount);await reject('customer-workflow-file-save',{...fileEdit,token:token(),status:'有效'},user('clerk'),409);pass('正式附件原件hash下载校验、权限、幂等、归档保留与过期版本拒绝');
await ok('customer-workflow-project-document-save',{token:token(),customerId,projectId:'cw_project',version:0,content:'# 合成项目资料\n原始版本',reason:'首次记录'},user('sales'));
await ok('customer-workflow-project-document-save',{token:token(),customerId,projectId:'cw_project',version:1,content:'# 合成项目资料\n第二版本',reason:'更新说明'},user('clerk'));
response=await ok('customer-workflow-project-document?customerId='+customerId+'&projectId=cw_project',undefined,user('sales'));assert.equal(response.revisions.length,2);assert.equal(response.revisions[0].content,'# 合成项目资料\n原始版本');assert.deepEqual(current('cw_project'),JSON.parse(original.find(r=>r.id==='cw_project').data));pass('独立项目Markdown版本全文保留，原项目全部字段未改写');
await ok('customer-workflow-project-save',{token:token(),customerId,projectId:'cw_project',version:0,stage:'需求了解',next:'合成需求评审',notes:'合成前期备注',reason:'登记开发阶段'},user('sales'));
await ok('customer-workflow-project-log',{token:token(),customerId,projectId:'cw_project',version:1,stage:'可行性',result:'完成需求核实',next:'工程可行性评估'},user('clerk'));
await reject('customer-workflow-project-save',{token:token(),customerId,projectId:'cw_project',version:1,stage:'报价',next:'过期操作',notes:'',reason:'不得覆盖'},user('sales'),409);
response=await ok('customer-workflow-project?customerId='+customerId+'&projectId=cw_project',undefined,user('sales'));assert.equal(response.project.stage,'可行性');assert.equal(response.logs.length,1);assert.equal(response.logs[0].createdBy,clerk.name);assert.equal(current('cw_project').description,'原需求原文不可改');pass('前期开发阶段/下一步及推进结果真实持久化，不改原项目描述与轮次');
const created=await ok('customer-save',{createOnly:true,customer:'原子合成新客户',customerCode:'ATOM001',workflow:{profile:{contactPerson:'新增联系人',email:'atomic@example.invalid',stage:'新建',orderHistory:'从未下单',firstListedOn:'2026-10-13'},next:'首次联系',nextDate:'2026-10-20'}});
response=await ok('customer-workflow-data?customerId='+created.item.id);assert.equal(response.profile.fields.contactPerson,'新增联系人');assert.equal(response.workflow.next,'首次联系');
await reject('customer-save',{...input(current(created.item.id)),notes:'不应部分保存',workflow:{profile:{legalName:'缺版本写入'}}},admin,409);
await reject('customer-save',{createOnly:true,customer:'不能部分创建',workflow:{profile:{orderHistory:'从未下单',lastOrderOn:'2026-01-01'}}},admin,400);pass('客户主档与新资料/跟进同事务原子保存，缺版本/矛盾资料无部分写入');
const legacy={id:'cw_legacy_profile',kind:'service_record',type:'customer_profile',customerId:created.item.id,details:{contactPerson:'不覆盖新统一字段',email:'legacy@example.invalid',phone:'旧电话可兼容',address:'旧混合地址不可猜拆'},version:1};insert(legacy);const beforeLegacy=raw();response=await ok('customer-workflow-data?customerId='+created.item.id);assert.equal(response.profile.fields.contactPerson,'新增联系人');assert.equal(response.profile.fields.phone,'旧电话可兼容');assert.equal(response.profile.fields.companyAddress,undefined);assert.deepEqual(raw(),beforeLegacy);pass('精确客户ID旧联系字段只读兼容，新字段优先，混合地址不猜拆且原记录不迁改');
const bytesBefore=bucketObjects.get(attachment.fileKey);bucketObjects.set(attachment.fileKey,new TextEncoder().encode('corrupted synthetic content'));await reject('customer-workflow-file?id='+attachment.id,undefined,user('sales'),409);bucketObjects.set(attachment.fileKey,bytesBefore);
const oldGet=globalThis.__directoryEnv.BUCKET.get,accountBefore=current(customerId);globalThis.__directoryEnv.BUCKET.get=async key=>{const stored=await oldGet(key);db.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify({...accountBefore,salesMemberIds:accountBefore.salesMemberIds.filter(id=>id!==sales.id)}),customerId);db.prepare("UPDATE workspace_revision SET revision=revision+1 WHERE id='main'").run();return stored;};
download=await call('customer-workflow-file?id='+attachment.id,undefined,user('sales'));assert.equal(download.status,403);globalThis.__directoryEnv.BUCKET.get=oldGet;db.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify(accountBefore),customerId);pass('附件hash损坏拒绝；等待存储期间撤销责任，下载前再授权拒绝');
for(const m of members)assert.deepEqual(current(m.id),m);assert.deepEqual(current('cw_unrelated'),JSON.parse(original.find(r=>r.id==='cw_unrelated').data));
const customerCount=raw().filter(r=>r.kind==='customer_account').length;
const projectInput={token:token(),customerId,code:'ATOMIC-PROJECT',title:'原子新建开发项目',description:'准确需求说明',salesMemberId:sales.id,serviceMemberIds:[clerk.id],development:{stage:'需求了解',next:'核对工程可行性',notes:'合成开发备注'}};
const createdProject=await ok('customer-project-save',projectInput,user('sales'));
response=await ok('customer-workflow-project?customerId='+customerId+'&projectId='+createdProject.item.id,undefined,user('clerk'));assert.equal(response.project.stage,'需求了解');assert.equal(response.project.next,'核对工程可行性');assert.equal(response.project.notes,'合成开发备注');assert(!('development' in createdProject.item));
const afterProject=raw();await ok('customer-project-save',projectInput,user('sales'));assert.deepEqual(raw(),afterProject);assert.equal(raw().filter(r=>r.kind==='customer_account').length,customerCount);
await reject('customer-project-save',{...projectInput,token:token(),development:{...projectInput.development,stage:'不存在阶段'}},user('sales'),400);
await reject('customer-project-save',{...projectInput,token:token(),customerId:'不存在客户'},user('sales'),403);
await reject('customer-project-save',{...projectInput,token:token(),id:createdProject.item.id,version:createdProject.item.version},user('sales'),409);
pass('新建前期项目与stage/next/notes同事务、重放幂等；非法阶段/未授权客户零写且不新建客户，已有项目不越版本覆盖');

await ok('customer-workflow-pool-request',{...common(),reason:'多轮跟进未成功',basis:'合成申请待管理员复核'});
const rejectedRequest=raw().filter(r=>r.kind==='customer_workflow_pool_request').map(r=>JSON.parse(r.data)).find(r=>r.status==='pending'),customerBeforeReject=current(customerId),poolBeforeReject=workflow().inPool;
await reject('customer-workflow-pool-reject',{...common(),id:rejectedRequest.id,requestVersion:rejectedRequest.version,note:'不能本人自审'},user('sales3'),403);
await ok('customer-workflow-pool-reject',{...common(),id:rejectedRequest.id,requestVersion:rejectedRequest.version,note:'依据不足，继续跟进'});
assert.equal(current(rejectedRequest.id).status,'rejected');assert.equal(current(rejectedRequest.id).note,'依据不足，继续跟进');assert.deepEqual(current(customerId),customerBeforeReject);assert.equal(workflow().inPool,poolBeforeReject);
pass('公海申请管理员可驳回留依据；普通成员不能自审，驳回不改客户或授权');
const previewBefore=raw(),preview=await call('customer-workflow-file?id='+attachment.id+'&preview=1',undefined,user('sales'));assert.equal(preview.status,200);assert.match(preview.headers.get('content-type'),/^text\/plain/);assert.match(preview.headers.get('content-disposition'),/^inline/);assert.match(preview.headers.get('content-security-policy'),/sandbox/);assert.equal(await preview.text(),'synthetic original bytes');
await reject('customer-workflow-file?id='+attachment.id+'&preview=1',undefined,user('viewer'),403);assert.deepEqual(raw(),previewBefore);
const exported=await ok('customer-workflow-export');assert.equal(exported.attachmentBytesIncluded,false);assert(exported.records.some(r=>r.kind==='customer_account'));assert(exported.records.some(r=>r.kind==='customer_workflow_document_revision'));assert(!exported.records.some(r=>r.kind==='member'||r.kind==='customer_workflow_request'));assert(!JSON.stringify(exported).includes('fileKey'));await reject('customer-workflow-export',undefined,user('sales'),403);assert.deepEqual(raw(),previewBefore);
pass('预览复用即时权限/hash并仅以安全纯文本呈现；管理员JSON导出资料及版本，不含原件/账号/存储键且零写');
await fs.writeFile(path.join(output,'result.json'),JSON.stringify({passed:checks.length,checks,at:new Date().toISOString(),scope:'isolated synthetic in-memory DB; no production access',memberRecordsUnchanged:members.length,fileObjects:bucketObjects.size},null,2));db.close();console.log(JSON.stringify({passed:checks.length,report:path.join(output,'result.json')}));

