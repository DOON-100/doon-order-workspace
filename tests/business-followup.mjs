import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

// Isolated synthetic route regression. Never opens a production DB or attachment directory.
const output=path.resolve('test-output','business-followup-'+process.pid);
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
const identity=new AsyncLocalStorage(),bucketObjects=new Map();
globalThis.__businessFollowupIdentity=identity;
globalThis.__businessFollowupEnv={DB:{prepare:sql=>new Statement(sql),batch:async statements=>{
 db.exec('BEGIN');try{const result=statements.map(statement=>db.prepare(statement.sql).run(...statement.args));db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}
}},BUCKET:{
 put:async(key,bytes)=>{bucketObjects.set(key,typeof bytes==='string'?new TextEncoder().encode(bytes):new Uint8Array(bytes));},
 get:async key=>{const bytes=bucketObjects.get(key);return bytes?{arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),body:bytes}:null;},
 delete:async key=>{bucketObjects.delete(key);},
}};
const outfile=path.join(output,'api.mjs');
await build({entryPoints:['app/api/workspace/[action]/route.ts'],outfile,bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@':process.cwd()},plugins:[{name:'business-followup-test-bindings',setup(builder){
 builder.onResolve({filter:/^cloudflare:workers$/},()=>({path:'cloudflare',namespace:'business-followup-test'}));
 builder.onResolve({filter:/chatgpt-auth$/},()=>({path:'auth',namespace:'business-followup-test'}));
 builder.onLoad({filter:/.*/,namespace:'business-followup-test'},args=>({contents:args.path==='auth'?'export async function getChatGPTUser(){return globalThis.__businessFollowupIdentity.getStore()||null}':'export const env=globalThis.__businessFollowupEnv;'}));
}}]});
const api=await import(pathToFileURL(outfile).href);
const user=role=>({userId:'business_followup_'+role,email:'business-followup-'+role+'@test.invalid',displayName:'合成跟进'+role,fullName:'合成跟进'+role});
const admin=user('admin');
async function call(action,body,actor=admin,headers={}){
 const method=body===undefined?'GET':'POST',routeAction=action.split('?')[0];
 return identity.run(actor,()=>api[method](new Request('https://business-followup.test/api/workspace/'+action,{method,headers:{...(body instanceof FormData?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)}),{params:Promise.resolve({action:routeAction})}));
}
async function ok(action,body,actor=admin,headers={}){const response=await call(action,body,actor,headers),result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;}
const raw=()=>db.prepare('SELECT id,kind,data FROM records ORDER BY id').all();
const current=id=>JSON.parse(db.prepare('SELECT data FROM records WHERE id=?').get(id).data);
const records=kind=>raw().filter(row=>row.kind===kind).map(row=>JSON.parse(row.data));
const revision=()=>db.prepare("SELECT revision FROM workspace_revision WHERE id='main'").get().revision;
const insert=record=>db.prepare('INSERT INTO records(id,kind,data) VALUES(?,?,?)').run(record.id,record.kind,JSON.stringify(record));
const replace=record=>{db.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify(record),record.id);db.prepare("UPDATE workspace_revision SET revision=revision+1 WHERE id='main'").run();};
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const checks=[];
function pass(name){checks.push(name);console.log('PASS '+name);}
function bucketSnapshot(){return [...bucketObjects].map(([key,bytes])=>[key,sha256(bytes)]).sort(([a],[b])=>a.localeCompare(b));}
async function reject(action,body,actor,status,headers={}){
 const before=raw(),rev=revision(),files=bucketSnapshot(),response=await call(action,body,actor,headers);
 assert.equal(response.status,status,await response.text());assert.deepEqual(raw(),before,'Rejected action must not change records');assert.equal(revision(),rev,'Rejected action must not change revision');assert.deepEqual(bucketSnapshot(),files,'Rejected action must not change stored files');
}
const token=()=>crypto.randomUUID();
function form(target,values={},attachments=[]){
 const result=new FormData();for(const [key,value]of Object.entries({token:token(),...target,note:'',...values}))result.set(key,String(value));
 for(const attachment of attachments)result.append('files',new File([attachment.bytes],attachment.name,{type:attachment.type||'application/octet-stream'}));
 return result;
}
const query=(action,target)=>action+'?'+new URLSearchParams(target);

await ok('enroll',{});
for(const role of ['sales','clerk','pmc','outsider','viewer']){await ok('member',{name:user(role).displayName,email:user(role).email,role:role==='outsider'?'sales':role,customers:[],active:true});await ok('enroll',{},user(role));}
const members=records('member'),member=role=>members.find(row=>row.email===user(role).email),sales=member('sales'),clerk=member('clerk');
const stamp='2026-10-01T00:00:00.000Z';
const customer=(id,salesIds)=>({id,kind:'customer_account',customer:'合成客户 '+id,customerCode:'SYN-'+id,salesName:'',serviceName:'',pmcName:'原PMC',salesMemberIds:salesIds,serviceMemberIds:id==='bf_customer_a'?[clerk.id,member('pmc').id]:[],quoteMemberIds:id==='bf_customer_a'?[sales.id,clerk.id]:[],active:true,notes:'  原客户备注\n不改写 ',directory:{grade:'AA',country:'合成国家'},version:1,createdAt:stamp,updatedAt:stamp,updatedBy:'合成作者'});
const accountA=customer('bf_customer_a',[sales.id]),accountB=customer('bf_customer_b',[member('outsider').id]);
const team=(id,customerId)=>({id,kind:'customer_project_team',name:'合成组 '+id,active:true,customerIds:[customerId],leaderIds:[],salesMemberIds:[sales.id],serviceMemberIds:[clerk.id],version:1,createdAt:stamp,updatedAt:stamp});
const teamA=team('bf_team_a',accountA.id),teamB=team('bf_team_b',accountB.id);
teamB.customerIds.push(accountA.id);
const project=(id,account,teamId,status='active')=>({id,kind:'customer_project',customerId:account.id,teamId,code:'SYN-'+id,title:'合成项目 '+id,description:'原需求原文\n保留',salesMemberId:'',serviceMemberId:'',serviceMemberIds:[],dueDate:'',status,version:1,createdAt:stamp,updatedAt:stamp,createdBy:'合成作者',updatedBy:'合成作者'});
const projectA=project('bf_project_a',accountA,teamA.id),projectB=project('bf_project_b',accountB,teamB.id),projectOtherGroup=project('bf_project_other_group',accountA,teamB.id),archivedProject=project('bf_archived_project',accountA,teamA.id,'archived');
const quotePolicy={id:'bf_quote_policy',kind:'customer_quote_access',memberIds:[sales.id,clerk.id],aliasesByMember:{},internalMemberIds:[]};
const order=(id,account,owner)=>({id,kind:'order',version:1,customer:account.customerCode,orderNo:'SYN-'+id,customerPO:'SYN-PO',drawing:'SYN-DRAWING',color:'C1',lens:'白片',batch:'A',quantity:10,requestedDate:'',ownerEmail:owner.email,stage:'生产中',plannedDate:'',shipDate:'',promisedDate:'',promiseConfirmed:false,customerNote:'',arrangement:'',notes:'原订单内部备注',sourceStatus:'正式订单',extra:{},workflowStatus:'生产中',source:'synthetic',createdAt:stamp,updatedAt:stamp,updatedBy:'合成作者'});
const orderA=order('bf_order_a',accountA,user('sales')),orderB=order('bf_order_b',accountB,user('outsider'));
const service=(id,account,type)=>({id,kind:'service_record',type,customerId:account.id,teamId:account.id===accountA.id?teamA.id:teamB.id,orderId:'',title:'合成客服 '+id,description:'原客服正文',status:'open',waitingFor:'none',dueDate:'',nextFollowUp:'',details:{currency:'USD',amountCents:100},version:1,createdAt:stamp,updatedAt:stamp,updatedBy:'合成作者'});
const serviceA=service('bf_service_a',accountA,'followup'),shipmentA=service('bf_shipment_a',accountA,'shipment'),serviceB=service('bf_service_b',accountB,'followup');
const processA={id:'bf_process_a',kind:'process_record',type:'rfq',customerId:accountA.id,orderId:'',teamId:teamA.id,title:'合成需求评估',batch:'',ownerId:sales.id,responsibleId:'',plannedDate:'',actualDate:'',status:'待处理',inputBasis:'合成原始依据',inputVersion:'V1',outputEvidence:'',gateStatus:'待核实',blocker:'',nextAction:'原下一步',nextOwnerId:'',nextDueDate:'',notes:'原流程备注',details:{requirement:'合成需求'},version:1,createdAt:stamp,createdById:sales.id,updatedAt:stamp,updatedById:sales.id,updatedBy:sales.name};
const document=type=>({id:'bf_document_'+type,kind:'handoff_business_document',type,version:1,customerId:accountA.id,projectId:'',orderId:'',number:'SYN-'+type,status:'draft',fields:{},lines:[],sourceRefs:[],sourceSnapshots:[],createdAt:stamp,updatedAt:stamp,updatedBy:sales.name});
const invoice=document('invoice'),packing=document('packing');
const communication=channel=>({id:'bf_communication_'+channel,kind:'unified_communication',version:1,customerId:accountA.id,projectId:'',orderId:'',channel,title:'合成沟通 '+channel,sourceText:'合成原文',sourceReference:'synthetic',occurredAt:'2026-10-01',draftText:'原草稿',internalNote:'原内部备注',status:'draft',inputMode:'manual',sourceHash:'synthetic',sourceRevision:1,contentHash:'synthetic',requiresRecheck:false,lastSubmissionId:'',createdAt:stamp,createdBy:sales.name,createdById:sales.id,updatedAt:stamp,updatedBy:sales.name,updatedById:sales.id});
const email=communication('email'),whatsapp=communication('whatsapp');
for(const row of [accountA,accountB,teamA,teamB,projectA,projectB,projectOtherGroup,archivedProject,quotePolicy,orderA,orderB,serviceA,shipmentA,serviceB,processA,invoice,packing,email,whatsapp,{id:'bf_unrelated',kind:'synthetic_unrelated',payload:'  保留\n原文 ',nested:{value:3}}])insert(row);
const original=raw();

const projectTarget=(recordId=projectA.id,sectionKey='record')=>({module:'customer-projects',collection:'projects',recordId,sectionKey});
const target=projectTarget(),dataAction=(key=target)=>query('business-followup-data',key),teamHeader=id=>({'X-Workspace-Team':id});
const firstRead=raw();
await reject('business-followup-targets?module=customer-projects',undefined,null,401);
const catalog=await ok('business-followup-targets?module=customer-projects',undefined,user('sales'));
assert.equal(catalog.supported,true);assert(catalog.targets.some(row=>row.recordId===projectA.id&&row.canAppend));assert(!catalog.targets.some(row=>row.recordId===projectB.id));
assert(catalog.targets.every(row=>Object.keys(row).every(key=>['module','collection','recordId','label','sectionKey','sectionLabel','canAppend'].includes(key))));
const empty=await ok(dataAction(),undefined,user('sales'));assert.deepEqual(empty.entries,[]);assert.equal(empty.target.canAppend,true);assert.deepEqual(raw(),firstRead);
const unsupported=await ok('business-followup-targets?module=unknown-module',undefined,user('sales'));assert.equal(unsupported.supported,false);assert.deepEqual(unsupported.targets,[]);
await reject(dataAction({...target,module:'unknown-module'}),undefined,user('sales'),403);
await reject('business-followup-save',form({...target,module:'unknown-module'},{note:'不支持模块'}),user('sales'),403);
await reject('business-followup-save',form({...target,collection:'members'},{note:'伪造collection'}),user('sales'),403);
await reject(dataAction(projectTarget(projectB.id)),undefined,user('sales'),403);
await reject('business-followup-save',form(projectTarget(projectB.id),{note:'跨客户'}),user('sales'),403);
await reject(dataAction(),undefined,user('outsider'),403);
await reject(dataAction(),undefined,user('viewer'),403);
pass('目录只返回当前客户授权记录与安全字段；匿名、未知模块、伪造集合及跨客户访问不写数据');

const grouped=await ok('business-followup-targets?module=customer-projects',undefined,user('sales'),teamHeader(teamA.id));
assert(grouped.targets.some(row=>row.recordId===projectA.id));assert(!grouped.targets.some(row=>[projectB.id,projectOtherGroup.id].includes(row.recordId)));
await reject(dataAction(projectTarget(projectOtherGroup.id)),undefined,user('sales'),403,teamHeader(teamA.id));
await reject('business-followup-save',form(projectTarget(projectOtherGroup.id),{note:'跨组'}),user('sales'),403,teamHeader(teamA.id));
await reject(dataAction(),undefined,user('sales'),403,teamHeader('bf_unknown_team'));
await ok(dataAction(projectTarget(projectOtherGroup.id)),undefined,user('sales'),teamHeader(teamB.id));
await reject(dataAction(projectTarget(projectB.id)),undefined,user('sales'),403,teamHeader(teamB.id));
pass('同一客户跨组项目严格按请求组过滤；小组成员身份不增加客户权限');

for(const [module,collection,recordId]of [['orders','orders',orderA.id],['service-workspace','records',serviceA.id],['shipment-followups','records',shipmentA.id],['process-workspace','records',processA.id]]){
 const key={module,collection,recordId,sectionKey:'record'},list=await ok(query('business-followup-targets',{module}),undefined,user('sales'));
 assert(list.targets.some(row=>row.recordId===recordId&&row.canAppend),module+' uses real source permission');
 const result=await ok('business-followup-save',form(key,{note:'合成独立跟进 '+module}),user('sales'));assert.equal(result.entry.note,'合成独立跟进 '+module);
 await reject(dataAction(key),undefined,user('outsider'),403);
}
await reject(dataAction({module:'orders',collection:'orders',recordId:orderB.id,sectionKey:'record'}),undefined,user('sales'),403);
await reject(dataAction({module:'shipment-followups',collection:'records',recordId:serviceA.id,sectionKey:'record'}),undefined,user('sales'),403);
await reject(dataAction({module:'orders',collection:'orders',recordId:projectA.id,sectionKey:'record'}),undefined,user('sales'),403);
const orderReadonly={module:'orders',collection:'orders',recordId:orderA.id,sectionKey:'record'};
replace({...member('viewer'),customers:[accountA.customerCode]});
assert.equal((await ok(dataAction(orderReadonly),undefined,user('viewer'))).target.canAppend,false);
await reject('business-followup-save',form(orderReadonly,{note:'只读订单禁止跟进写入'}),user('viewer'),403);replace(member('viewer'));
pass('订单、客服、发运和流程模块复用原记录权限及类型筛选；只读订单成员不能借跟进入口写入');

for(const [module,canonical,collection,recordId,sectionKey]of [
 ['pmc','orders','orders',orderA.id,'record'],['sales','orders','orders',orderA.id,'record'],
 ['shipment-followups','service-workspace','records',shipmentA.id,'record'],
 ['customer-projects','project-finance','projects',projectA.id,'tab:finance'],
 ['logistics-waybills','documents','items',invoice.id,'record'],['logistics-waybills','documents','items',packing.id,'record'],
 ['mail','communications','items',email.id,'record'],['whatsapp','communications','items',whatsapp.id,'record'],
]){
 const alias={module,collection,recordId,sectionKey},canonicalTarget={...alias,module:canonical},requestToken=token(),values={token:requestToken,note:'跨入口共享 '+module+' '+recordId};
 const written=await ok('business-followup-save',form(alias,values),user('sales'));assert.equal(written.target.module,canonical);
 const visible=await ok(dataAction(canonicalTarget),undefined,user('sales'));assert(visible.entries.some(row=>row.id===written.entry.id),'Canonical entry shares alias history');
 const before=raw(),objects=bucketSnapshot(),replayed=await ok('business-followup-save',form(canonicalTarget,values),user('sales'));assert.equal(replayed.entry.id,written.entry.id);assert.equal(replayed.idempotent,true);assert.deepEqual(raw(),before);assert.deepEqual(bucketSnapshot(),objects);
 assert.equal(current(written.entry.id).module,canonical);
}
await reject(dataAction({module:'whatsapp',collection:'items',recordId:email.id,sectionKey:'record'}),undefined,user('sales'),403);
await reject(dataAction({module:'order-confirmations',collection:'items',recordId:invoice.id,sectionKey:'record'}),undefined,user('sales'),403);
pass('订单、客服、项目财务、业务单据和沟通入口共享同一规范目标及token；别名仍遵守原栏目类型范围');

const secret='合成私有跟进正文，仅授权当前目标可见';
const files=[{name:'中文订单 #1%.txt',bytes:new TextEncoder().encode('synthetic original A\n')},{name:'CON.html',bytes:new TextEncoder().encode('<script>synthetic-only</script>'),type:'text/html'}];
const beforeFileEntries=records('business_followup').length,beforeFileRequests=records('business_followup_request').length;
const saveToken=token(),submission=form(target,{token:saveToken,note:secret},files),created=await ok('business-followup-save',submission,user('sales'));
assert.equal(created.entry.note,secret);assert.equal(created.entry.createdByName,sales.name);assert.equal(created.entry.attachments.length,2);assert.equal(records('business_followup').length,beforeFileEntries+1);assert.equal(records('business_followup_request').length,beforeFileRequests+1);assert.equal(records('business_followup_attachment').length,2);
const storedFiles=records('business_followup_attachment');
for(let index=0;index<files.length;index++){
 const metadata=created.entry.attachments[index],stored=current(metadata.id);assert.equal(metadata.sha256,sha256(files[index].bytes));assert.equal(metadata.size,files[index].bytes.length);assert.deepEqual(bucketObjects.get(stored.fileKey),files[index].bytes);
 assert(!Object.hasOwn(metadata,'fileKey'));assert(!/[\\/:*?"<>|\u0000-\u001f\u007f]/.test(metadata.originalName));assert(!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(metadata.originalName));
 const response=await call('business-followup-download?id='+metadata.id,undefined,user('clerk'));assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/octet-stream');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.match(response.headers.get('content-security-policy'),/sandbox/);assert.match(response.headers.get('content-disposition'),/^attachment;/);assert.equal(decodeURIComponent(response.headers.get('content-disposition').split("UTF-8''")[1]),metadata.originalName);assert.equal(sha256(Buffer.from(await response.arrayBuffer())),metadata.sha256);
}
assert.deepEqual((await ok(dataAction(),undefined,user('clerk'))).entries.map(row=>row.id),[created.entry.id]);
assert.deepEqual((await ok(dataAction(projectTarget(projectA.id,'tab:communication')),undefined,user('sales'))).entries,[]);
const uploadState=raw(),uploadRevision=revision(),uploadObjects=bucketSnapshot();
const replay=await ok('business-followup-save',submission,user('sales'));assert.equal(replay.idempotent,true);assert.equal(replay.entry.id,created.entry.id);assert.deepEqual(raw(),uploadState);assert.equal(revision(),uploadRevision);assert.deepEqual(bucketSnapshot(),uploadObjects);
await reject('business-followup-save',form(target,{token:saveToken,note:secret+' changed'},files),user('sales'),409);
await reject('business-followup-save',form(target,{token:saveToken,note:secret},[{...files[0],bytes:new TextEncoder().encode('changed bytes')},files[1]]),user('sales'),409);
await reject('business-followup-save',form(target,{token:saveToken,note:secret},[files[1],files[0]]),user('sales'),409);
await reject('business-followup-save',form(target,{token:saveToken,note:secret},files),user('clerk'),409);
await reject('business-followup-save',form(projectTarget(projectOtherGroup.id),{token:saveToken,note:secret},files),user('sales'),409);
pass('一次跟进持久化两个原件和sha256；下载强制安全附件，重放不重复写，token绑定正文、文件、顺序、目标与身份');

await reject('business-followup-save',form(target),user('sales'),400);
await reject('business-followup-save',form(target,{token:'not-a-uuid',note:'无效请求编号'}),user('sales'),400);
const duplicateField=form(target,{note:'重复正文字段'});duplicateField.append('note','第二份正文');await reject('business-followup-save',duplicateField,user('sales'),400);
await reject('business-followup-save',form(target,{note:'超长'.repeat(6001)}),user('sales'),400);
await reject('business-followup-save',form(target,{note:'假作者',createdByName:'冒名'}),user('sales'),400);
await reject('business-followup-save',form(target,{note:'空附件'},[{name:'empty.txt',bytes:new Uint8Array()}]),user('sales'),400);
await reject('business-followup-save',form(target,{note:'过量附件'},Array.from({length:11},(_,index)=>({name:'synthetic-'+index+'.txt',bytes:new Uint8Array([1])}))),user('sales'),400);
await reject('business-followup-save',form({...target,sectionKey:'tab:unknown'},{note:'伪造栏目'}),user('sales'),400);
await reject('business-followup-save',form({...target,sectionKey:'directory:不存在目录'},{note:'伪造目录'}),user('sales'),400);
await reject('business-followup-save',{...target,token:token(),note:'错误content-type'},user('sales'),400);
const noteOnly=await ok('business-followup-save',form(projectTarget(projectA.id,'tab:communication'),{note:'单独沟通'}),user('clerk'));assert.deepEqual(noteOnly.entry.attachments,[]);
const fileOnly=await ok('business-followup-save',form(projectTarget(projectA.id,'directory:01_询单'),{},[{name:'source.txt',bytes:new Uint8Array([7,8,9])}]),user('clerk'));assert.equal(fileOnly.entry.note,'');assert.equal(fileOnly.entry.attachments.length,1);
pass('正文或附件可独立保存；空内容、冒名、无效栏目、空文件、过量附件与错误表单均零变更拒绝');

const directory=folder=>projectTarget(projectA.id,'directory:'+folder);
await reject(dataAction(directory('04_工程报价')),undefined,user('sales'),403);
await reject('business-followup-save',form(directory('04_工程报价'),{note:'普通项目权限不能读取工程成本'}),user('sales'),403);
const salesQuoteDirectory=await ok(dataAction(directory('05_销售报价')),undefined,user('clerk'));assert.equal(salesQuoteDirectory.target.canAppend,false);
await reject('business-followup-save',form(directory('05_销售报价'),{note:'客服只读不可写报价'}),user('clerk'),403);
await reject('business-followup-save',form(projectTarget(projectA.id,'tab:quotes'),{note:'页签不绕过报价权'}),user('clerk'),403);
await reject(dataAction(directory('07_付款')),undefined,user('pmc'),403);
await reject('business-followup-save',form(directory('07_付款'),{note:'PMC不可使用付款目录'}),user('pmc'),403);
replace({...quotePolicy,internalMemberIds:[sales.id,clerk.id]});
const engineeringSubmission=form(directory('04_工程报价'),{note:'合成工程成本专权正文'},[{name:'internal-cost.txt',bytes:new TextEncoder().encode('synthetic restricted costing')}]);
const engineering=await ok('business-followup-save',engineeringSubmission,user('sales'));
await reject(dataAction(directory('04_工程报价')),undefined,user('clerk'),403);
await reject('business-followup-download?id='+engineering.entry.attachments[0].id,undefined,user('clerk'),403);
const quote=await ok('business-followup-save',form(directory('05_销售报价'),{note:'合成授权销售报价'}),user('sales'));assert.equal(quote.entry.note,'合成授权销售报价');
await ok('business-followup-save',form(directory('07_付款'),{note:'合成付款沟通，未修改到账状态'}),user('clerk'));
replace(quotePolicy);
await reject('business-followup-save',engineeringSubmission,user('sales'),403);
await reject('business-followup-download?id='+engineering.entry.attachments[0].id,undefined,user('sales'),403);
pass('项目04工程报价、05销售报价、07付款目录沿用独立权限；普通项目权、客服内部名单及页签不扩大敏感资料权限');

const archived=await ok(dataAction(projectTarget(archivedProject.id)),undefined,user('sales'));assert.equal(archived.target.canAppend,false);
await reject('business-followup-save',form(projectTarget(archivedProject.id),{note:'归档不可追加'}),user('sales'),403);
replace({...projectA,status:'archived'});await reject('business-followup-save',submission,user('sales'),403);replace(projectA);
replace({...projectA,trashedAt:stamp,trashedBy:'合成管理员'});await reject('business-followup-save',submission,user('sales'),403);replace(projectA);
replace({...sales,active:false});await reject(dataAction(),undefined,user('sales'),403);await reject('business-followup-save',submission,user('sales'),403);await reject('business-followup-download?id='+storedFiles[0].id,undefined,user('sales'),403);replace(sales);
replace({...accountA,active:false});await reject(dataAction(),undefined,user('sales'),403);await reject('business-followup-save',submission,user('sales'),403);replace(accountA);
replace({...accountA,salesMemberIds:[]});await reject(dataAction(),undefined,user('sales'),403);await reject('business-followup-save',submission,user('sales'),403);await reject('business-followup-download?id='+storedFiles[0].id,undefined,user('sales'),403);replace(accountA);
await reject('business-followup-download?id='+storedFiles[0].id,undefined,user('outsider'),403);
await reject('business-followup-download?id='+storedFiles[0].id,undefined,user('sales'),403,teamHeader(teamB.id));
pass('归档、回收站、停用成员、停用客户及撤销责任即时生效，历史token与附件下载不能绕过当前权限');

const originalBytes=bucketObjects.get(storedFiles[0].fileKey);bucketObjects.set(storedFiles[0].fileKey,new TextEncoder().encode('corrupted synthetic bytes'));
await reject('business-followup-download?id='+storedFiles[0].id,undefined,user('sales'),409);bucketObjects.set(storedFiles[0].fileKey,originalBytes);
const beforeDownload=raw(),oldGet=globalThis.__businessFollowupEnv.BUCKET.get;
globalThis.__businessFollowupEnv.BUCKET.get=async key=>{const object=await oldGet(key);replace({...accountA,salesMemberIds:[]});return object;};
const revokedWhileDownloading=await call('business-followup-download?id='+storedFiles[0].id,undefined,user('sales'));assert.equal(revokedWhileDownloading.status,403);globalThis.__businessFollowupEnv.BUCKET.get=oldGet;replace(accountA);
assert.deepEqual(raw(),beforeDownload);
pass('损坏原件按hash拒绝，等待存储期间撤销权限也会在返回字节前重新拒绝');

const retrySubmission=form(target,{note:'合成多文件故障重试'},[{name:'retry-a.txt',bytes:new Uint8Array([4,5,6])},{name:'retry-b.txt',bytes:new Uint8Array([9,10,11])}]);
const beforeFault=raw(),faultRevision=revision(),filesBeforeFault=bucketObjects.size,oldPut=globalThis.__businessFollowupEnv.BUCKET.put;let putCount=0;
globalThis.__businessFollowupEnv.BUCKET.put=async(key,bytes)=>{if(++putCount===2)throw Error('Synthetic second object write failure');return oldPut(key,bytes);};
const failedUpload=await call('business-followup-save',retrySubmission,user('sales'));assert.equal(failedUpload.status,500);await failedUpload.text();globalThis.__businessFollowupEnv.BUCKET.put=oldPut;
assert.deepEqual(raw(),beforeFault);assert.equal(revision(),faultRevision);assert.equal(bucketObjects.size,filesBeforeFault+1);
const retried=await ok('business-followup-save',retrySubmission,user('sales'));assert.equal(retried.entry.attachments.length,2);assert.equal(bucketObjects.size,filesBeforeFault+2,'Retry reuses the first immutable object key instead of multiplying orphan bytes');
for(const attachment of retried.entry.attachments){const response=await call('business-followup-download?id='+attachment.id,undefined,user('sales'));assert.equal(response.status,200);assert.equal(sha256(Buffer.from(await response.arrayBuffer())),attachment.sha256);}
pass('多文件中途失败不产生业务记录，原token重试复用已写原件并完整提交两个附件');

// Virtual views have their own authorization. Source IDs are not grants to raw records.
const keyOf=({module,collection,recordId,sectionKey})=>({module,collection,recordId,sectionKey});
const catalogOf=async(module,actor=admin,headers={})=>(await ok(query('business-followup-targets',{module}),undefined,actor,headers)).targets;
const evidence=[{name:'synthetic-evidence.txt',bytes:new TextEncoder().encode('Synthetic scoped evidence')}];
const arSource={...service('bf_ar_source_b',accountB,'receivable'),dueDate:'2026-10-30',details:{currency:'USD',amountCents:12000}};
const arGrant={id:'bf_ar_reader_grant',kind:'ar_access_grant',memberId:member('viewer').id,active:true,readOnly:true,scopeType:'company',teamIds:[],capabilities:['read'],version:1};
const arBinding={id:'bf_ar_source_binding',kind:'ar_source_binding',sourceKind:'service_record',sourceId:arSource.id,customerId:accountB.id,teamId:teamB.id,canonicalKey:'bf_ar_source_b',active:true};
const purchase={id:'bf_purchase_a',kind:'purchase',version:1,sourceVersion:1,po:'SYN-PURCHASE-A',supplier:'合成供应商',buyer:'合成采购',itemCode:'SYN-MAT',itemName:'合成材料',unit:'件',quantity:20,orderDate:'2026-10-01',dueDate:'2026-11-01',customerOrder:orderA.orderNo,auditStatus:'已审核',closeStatus:'未关闭',sourceNote:'原始合成采购备注',sourceRow:4,sourceAsOf:'2026-10-01',sourceHash:'synthetic',sourceFile:'synthetic.xlsx',sourceSheet:'Synthetic',sourceFilter:'synthetic',raw:{},promisedDate:'',expectedDate:'',nextFollowupDate:'',followupNote:'',balanceKnown:false,received:0,returnPending:0,lifecycle:'active'};
const pendingHeaders=['单据编号','单据日期','供应商','业务员','单据状态','关闭状态','预计交货日期','商品编码','商品名称','单位','数量','商品行备注','剩余备货天数','客户订单编号'];
function pendingSnapshot(version,createdAt){
 const rows=[orderA,orderB].map((order,index)=>{const values=['SYN-SNAPSHOT-'+index,'2026-10-01','合成供应商 '+index,'合成采购','已审核','未关闭','2026-11-01','SYN-MAT-'+index,'合成材料 '+index,'件',10,'合成版本 '+version,5,order.orderNo];return {sourceRow:index+4,rowType:'data',values,displayValues:values.map(String)};});
 const text=JSON.stringify(rows),id='kingdee_pending_snapshot_bf_v'+version,rowsKey=id+'_rows';bucketObjects.set(rowsKey,new TextEncoder().encode(text));bucketObjects.set(id+'_file',new TextEncoder().encode('Synthetic original version '+version));
 return {id,kind:'kingdee_pending_snapshot',headers:pendingHeaders,hash:sha256('synthetic-snapshot-'+version),rowsHash:sha256(text),rowsKey,fileKey:id+'_file',createdAt,committedRevision:version,actorId:member('admin').id,metadata:{filename:'synthetic-v'+version+'.xlsx',hash:sha256('synthetic-snapshot-'+version),sourceAsOf:createdAt.slice(0,10),sourceFilter:'synthetic',sourceAccount:'synthetic',sourceSheet:'Synthetic',headerRow:3,importedAt:createdAt,importedBy:'Synthetic',rowCount:2,sourceRowCount:2,orderCount:2,supplierCount:2,quantityMeaning:'合成来源数量'}};
}
const snapshot1=pendingSnapshot(1,'2026-10-03T00:00:00Z'),snapshot2=pendingSnapshot(2,'2026-10-02T00:00:00Z');
const apiRow={id:'bf_kingdee_api_row',kind:'kingdee_pending_api_row',accountId:'SYN-ACCOUNT',instanceId:'SYN-INSTANCE',clientId:'SYN-CLIENT',row:{values:['SYN-API-PO','2026-10-01','合成API供应商','合成采购','未关闭','SYN-API-MAT','合成API材料','规格','件','12','2026-11-01','未入库','未关闭','合成API备注','SYN-DOC-ID','SYN-LINE-ID'],uncertain:false},sourceHash:'synthetic',createdAt:stamp,actorId:member('admin').id,batchId:'synthetic'};
const priceProduct={id:'bf_product',factoryModel:'SYN-MODEL',customerModel:'SYN-CLIENT',productName:'合成产品',productType:'frame',sku:'SYN-SKU-C1',frameColor:'C1',lens:'clear',material:'acetate',size:'50',specVersion:'R1',activity:'ordered',sourceRefs:[{fileId:'source',sheet:'Original',cell:'H12',page:null}]};
const price={id:'bf_invoice_price',productId:priceProduct.id,scope:'sku',documentType:'invoice',documentNo:'SYN-INVOICE',version:'1',documentDate:'2026-10-01',currency:'USD',unit:'pair',quantity:100,quantityMin:null,quantityMax:null,quantityBasis:'per SKU',unitPrice:9,toolingFee:null,otherCharges:null,terms:'Synthetic',reviewStatus:'verified',sentStatus:'unknown',sourceRefs:priceProduct.sourceRefs,notes:'Synthetic private source note'};
const priceArchive={id:'bf_price_archive',kind:'customer_price_archive',customerAccountId:accountA.id,dataset:{schemaVersion:1,customer:{code:accountA.customerCode,name:accountA.customer},files:[{id:'source',relativePath:'synthetic.pdf',sha256:sha256('synthetic'),category:'invoice',status:'included'}],products:[priceProduct],prices:[price],issues:[],excluded:[]},files:{}};
const virtualFixtures=[arSource,arGrant,arBinding,purchase,snapshot1,snapshot2,apiRow,priceArchive];for(const row of virtualFixtures)insert(row);original.push(...raw().filter(row=>virtualFixtures.some(fixture=>fixture.id===row.id)));

const arTarget=keyOf((await catalogOf('ar-workspace')).find(row=>row.label.includes(arSource.title)));assert(arTarget.recordId.startsWith('ar_'));
const arSubmission=form(arTarget,{note:'合成AR独立投影历史'},evidence),arSaved=await ok('business-followup-save',arSubmission);
assert.equal((await ok(dataAction(arTarget),undefined,user('viewer'))).target.canAppend,false);
assert((await ok(dataAction(arTarget),undefined,user('viewer'))).entries.some(row=>row.id===arSaved.entry.id));
await reject('business-followup-save',form(arTarget,{note:'AR只读不可追加'}),user('viewer'),403);
await reject(dataAction({module:'service-workspace',collection:'records',recordId:arSource.id,sectionKey:'record'}),undefined,user('viewer'),403);
await reject(dataAction({...arTarget,recordId:arSource.id}),undefined,user('viewer'),403);
const arAttachment=arSaved.entry.attachments[0].id;assert.equal((await call('business-followup-download?id='+arAttachment,undefined,user('viewer'))).status,200);
replace({...arSource,status:'done',dueDate:'2026-11-30',details:{currency:'USD',amountCents:23000}});
assert((await ok(dataAction(arTarget))).entries.some(row=>row.id===arSaved.entry.id),'Amount, due date and status changes must retain AR followup history');
assert.equal((await ok('business-followup-save',arSubmission)).entry.id,arSaved.entry.id);
replace({...arSource,details:{currency:'USD',amountCents:null}});assert((await ok(dataAction(arTarget))).entries.some(row=>row.id===arSaved.entry.id),'The same source in the pending queue shares its established AR history');replace(arSource);
replace({...arGrant,scopeType:'team',teamIds:[teamA.id]});await reject(dataAction(arTarget),undefined,user('viewer'),403);await reject('business-followup-download?id='+arAttachment,undefined,user('viewer'),403);replace(arGrant);
await reject(dataAction(arTarget),undefined,user('viewer'),403,teamHeader(teamA.id));
replace({...arGrant,active:false});await reject(dataAction(arTarget),undefined,user('viewer'),403);await reject('business-followup-download?id='+arAttachment,undefined,user('viewer'),403);replace(arGrant);
replace({...arBinding,teamId:teamA.id});assert.deepEqual((await ok(dataAction(arTarget))).entries,[]);await reject('business-followup-download?id='+arAttachment,undefined,admin,403);await reject('business-followup-save',arSubmission,admin,409);replace(arBinding);
replace({...arSource,customerId:accountA.id});assert.deepEqual((await ok(dataAction(arTarget))).entries,[]);await reject('business-followup-download?id='+arAttachment,undefined,admin,403);replace(arSource);
assert((await ok(dataAction(arTarget))).entries.some(row=>row.id===arSaved.entry.id));
pass('AR投影仅继承AR范围与只读授权，不提升源客服记录权限；金额/交期/状态更新保留历史，撤权与客户/组重绑隔离原内容');

const splitCharge=(id,projectId,teamId,amountCents)=>({id,kind:'project_charge',customerId:accountA.id,projectId,teamId,title:'合成分组收费',currency:'USD',amountCents,prepayCents:0,dueDate:'2026-11-01',status:'confirmed',version:1,plan:[],createdAt:stamp});
const splitCharges=[splitCharge('bf_split_charge_a',projectA.id,teamA.id,10000),splitCharge('bf_split_charge_b',projectOtherGroup.id,teamB.id,20000)];
const splitReceipt={id:'bf_split_receipt',kind:'project_receipt',customerId:accountA.id,currency:'USD',amountCents:30000,date:'2026-10-15',reference:'SYN-SPLIT-RECEIPT',account:'SYNTHETIC PRIVATE BANK',payer:'SYNTHETIC PRIVATE PAYER'};
const splitAllocations=splitCharges.map(charge=>({id:'bf_allocation_'+charge.id,kind:'project_allocation',customerId:accountA.id,projectId:charge.projectId,teamId:charge.teamId,receiptId:splitReceipt.id,chargeId:charge.id,amountCents:charge.amountCents,entryType:'allocate'}));
const splitFixtures=[...splitCharges,splitReceipt,...splitAllocations];for(const row of splitFixtures)insert(row);original.push(...raw().filter(row=>splitFixtures.some(fixture=>fixture.id===row.id)));
const splitA=keyOf((await catalogOf('ar-workspace',admin,teamHeader(teamA.id))).find(row=>row.label.includes('实际到账'))),splitB=keyOf((await catalogOf('ar-workspace',admin,teamHeader(teamB.id))).find(row=>row.label.includes('实际到账')));
assert.notEqual(splitA.recordId,splitB.recordId,'One source receipt allocated to two teams must have two independently authorized targets');
const splitSavedA=await ok('business-followup-save',form(splitA,{note:'合成同到账甲组专属'},evidence)),splitSavedB=await ok('business-followup-save',form(splitB,{note:'合成同到账乙组专属'},evidence));
assert.deepEqual((await ok(dataAction(splitA))).entries.map(row=>row.id),[splitSavedA.entry.id]);assert.deepEqual((await ok(dataAction(splitB))).entries.map(row=>row.id),[splitSavedB.entry.id]);
replace({...arGrant,scopeType:'team',teamIds:[teamA.id]});assert((await ok(dataAction(splitA),undefined,user('viewer'))).entries.some(row=>row.id===splitSavedA.entry.id));await reject(dataAction(splitB),undefined,user('viewer'),403);await reject('business-followup-download?id='+splitSavedB.entry.attachments[0].id,undefined,user('viewer'),403);
await reject(dataAction({module:'project-finance',collection:'receipts',recordId:splitReceipt.id,sectionKey:'record'}),undefined,user('viewer'),403);replace(arGrant);
replace({...splitReceipt,amountCents:31000,date:'2026-10-20'});assert((await ok(dataAction(splitA))).entries.some(row=>row.id===splitSavedA.entry.id));assert((await ok(dataAction(splitB))).entries.some(row=>row.id===splitSavedB.entry.id));replace(splitReceipt);
pass('同一到账按组分拆成独立AR目标，组授权不能读取其他分片或原始收款资料，金额日期变更不丢各组历史');

const oldSnapshotTarget={module:'supplier-pending',collection:'rows',recordId:snapshot1.id+':4',sectionKey:'record'},otherSnapshotTarget={...oldSnapshotTarget,recordId:snapshot1.id+':5'};
const pendingSubmission=form(oldSnapshotTarget,{note:'合成采购快照第一版历史'},evidence),pendingSaved=await ok('business-followup-save',pendingSubmission);
assert((await ok(dataAction(oldSnapshotTarget),undefined,user('sales'))).entries.some(row=>row.id===pendingSaved.entry.id));
await reject('business-followup-save',form(oldSnapshotTarget,{note:'采购只读不可追加'}),user('sales'),403);
await reject(dataAction(otherSnapshotTarget),undefined,user('sales'),403);
await reject(dataAction(otherSnapshotTarget),undefined,admin,403,teamHeader(teamA.id));
await reject('kingdee-pending-file?id='+snapshot1.id,undefined,user('sales'),403);
await reject('kingdee-pending-file?id='+snapshot1.id,undefined,admin,403,teamHeader(teamA.id));
for(const alias of ['supplier-workspace','supplier-followup','supplier-kit','supplier-risk','supplier-samples','supplier-reconciliation'])assert((await ok(dataAction({...oldSnapshotTarget,module:alias}))).entries.some(row=>row.id===pendingSaved.entry.id),'Supplier alias shares exact source history: '+alias);
replace({...snapshot2,createdAt:'2026-10-04T00:00:00Z',committedRevision:100});
assert((await catalogOf('supplier-pending')).some(row=>row.recordId===snapshot2.id+':4'));assert(!(await catalogOf('supplier-pending')).some(row=>row.recordId===oldSnapshotTarget.recordId));
assert.deepEqual((await ok(dataAction({...oldSnapshotTarget,recordId:snapshot2.id+':4'}))).entries,[],'A new immutable source snapshot has its own version history');
assert((await ok(dataAction(oldSnapshotTarget))).entries.some(row=>row.id===pendingSaved.entry.id),'Old exact snapshot remains addressable after a new import');replace(snapshot2);
const purchaseTarget={module:'purchase',collection:'rows',recordId:purchase.id,sectionKey:'record'},purchaseSubmission=form(purchaseTarget,{note:'合成采购原订单归属'},evidence),purchaseSaved=await ok('business-followup-save',purchaseSubmission);
replace({...purchase,quantity:30,dueDate:'2026-12-01',closeStatus:'已关闭',followupNote:'后续状态正常更新'});assert((await ok(dataAction(purchaseTarget))).entries.some(row=>row.id===purchaseSaved.entry.id));replace(purchase);
replace({...orderA,customer:accountB.customerCode});
for(const [key,saved]of [[oldSnapshotTarget,pendingSaved],[purchaseTarget,purchaseSaved]]){assert.deepEqual((await ok(dataAction(key))).entries,[]);await reject('business-followup-download?id='+saved.entry.attachments[0].id,undefined,admin,403);}
await reject('business-followup-save',pendingSubmission,admin,409);await reject('business-followup-save',purchaseSubmission,admin,409);replace(orderA);
for(const [key,saved]of [[oldSnapshotTarget,pendingSaved],[purchaseTarget,purchaseSaved]])assert((await ok(dataAction(key))).entries.some(row=>row.id===saved.entry.id));
const apiTarget=keyOf((await catalogOf('supplier-pending')).find(row=>row.recordId.startsWith('api:'))),apiSaved=await ok('business-followup-save',form(apiTarget,{note:'合成API稳定来源历史'},evidence));
const updatedValues=[...apiRow.row.values];updatedValues[9]='35';updatedValues[10]='2026-12-20';updatedValues[11]='部分入库';replace({...apiRow,row:{...apiRow.row,values:updatedValues}});
assert((await ok(dataAction(apiTarget))).entries.some(row=>row.id===apiSaved.entry.id),'API quantity, delivery date and receipt status updates must not erase history');replace(apiRow);
await reject(dataAction(apiTarget),undefined,user('sales'),403);
pass('采购快照依原订单与小组过滤，原件权限不扩张；新快照独立版本并可追溯旧历史，采购/API正常状态保留历史，底层订单改客户禁止原附件');

const priceTargets=await catalogOf('customer-price-archive'),priceTarget=keyOf(priceTargets.find(row=>row.collection==='sku'));
assert(priceTarget.recordId.startsWith('price_'));assert.equal((await catalogOf('customer-price-archive',user('sales'))).length,0);
await reject(dataAction(priceTarget),undefined,user('sales'),403);await reject('customer-price-archive-file?archiveId='+priceArchive.id+'&fileId=source',undefined,user('sales'),403);
const priceSubmission=form(priceTarget,{note:'合成报价管理员专用历史'},evidence),priceSaved=await ok('business-followup-save',priceSubmission);
replace({...priceArchive,dataset:{...priceArchive.dataset,prices:[{...price,unitPrice:15,documentDate:'2026-10-20',reviewStatus:'needs_review',sentStatus:'sent'}]}});
assert((await ok(dataAction(priceTarget))).entries.some(row=>row.id===priceSaved.entry.id),'Price amount, document date and review status changes retain stable product history');replace(priceArchive);
replace({...priceArchive,customerAccountId:accountB.id});await reject(dataAction(priceTarget),undefined,admin,403);await reject('business-followup-download?id='+priceSaved.entry.attachments[0].id,undefined,admin,403);
assert.equal((await catalogOf('customer-price-archive',admin,teamHeader(teamA.id))).length,0);replace(priceArchive);
replace({...quotePolicy,administratorMemberIds:[sales.id]});
const delegatedPrice=form(priceTarget,{note:'合成独立报价管理员授权期'},evidence),delegatedSaved=await ok('business-followup-save',delegatedPrice,user('sales'));replace(quotePolicy);
await reject('business-followup-save',delegatedPrice,user('sales'),403);await reject('business-followup-download?id='+delegatedSaved.entry.attachments[0].id,undefined,user('sales'),403);
assert((await ok(dataAction(priceTarget))).entries.some(row=>row.id===priceSaved.entry.id));
pass('历史报价投影沿用报价管理员原件权限，价格与核对状态更新保留历史，跨组/客户改绑和撤销管理员权限不能重放或下载');

const projectFollowup=(id,projectId)=>({id,kind:'customer_project_followup',version:1,ownerId:sales.id,customerId:accountA.id,projectId,title:'合成双入口跟进 '+id,category:'order',stars:1,status:'pending',followUpDate:'2026-11-01',notes:'原合成跟进正文',nextAction:'合成下一步',checklist:[],sourceKey:'',sourceId:'',source:{},createdAt:stamp,updatedAt:stamp});
const linkedFollowup=projectFollowup('bf_linked_followup',projectA.id),archivedFollowup=projectFollowup('bf_archived_followup',archivedProject.id);
for(const row of [linkedFollowup,archivedFollowup])insert(row);original.push(...raw().filter(row=>[linkedFollowup.id,archivedFollowup.id].includes(row.id)));
const projectFollowupKey={module:'customer-projects',collection:'followups',recordId:linkedFollowup.id,sectionKey:'record'},personalFollowupKey={...projectFollowupKey,module:'customer-followups'};
for(const [saveKey,replayKey] of [[projectFollowupKey,personalFollowupKey],[personalFollowupKey,projectFollowupKey]]){
 const values={token:token(),note:'合成双入口共享正文 '+saveKey.module},saved=await ok('business-followup-save',form(saveKey,values,evidence),user('sales'));
 assert.equal(saved.target.module,'customer-followups');assert.equal(current(saved.entry.id).module,'customer-followups');
 for(const key of [projectFollowupKey,personalFollowupKey])assert((await ok(dataAction(key),undefined,user('sales'))).entries.some(row=>row.id===saved.entry.id));
 const before=raw(),beforeRevision=revision(),objects=bucketSnapshot(),replayed=await ok('business-followup-save',form(replayKey,values,evidence),user('sales'));
 assert.equal(replayed.entry.id,saved.entry.id);assert.equal(replayed.idempotent,true);assert.deepEqual(raw(),before);assert.equal(revision(),beforeRevision);assert.deepEqual(bucketSnapshot(),objects);
}
assert.equal((await ok('customer-project-data',undefined,user('sales'))).projects.find(row=>row.id===archivedProject.id).canWrite,true,'Fixture deliberately has a writable parent DTO');
assert.equal((await ok('customer-project-followup-data',undefined,user('sales'))).followups.find(row=>row.id===archivedFollowup.id).canWrite,false,'The followup itself is currently read-only');
for(const module of ['customer-projects','customer-followups']){
 const key={...projectFollowupKey,module,recordId:archivedFollowup.id};assert.equal((await ok(dataAction(key),undefined,user('sales'))).target.canAppend,false);
 await reject('business-followup-save',form(key,{note:'父项目可写不能扩大本跟进权限'}),user('sales'),403);
}
pass('客户项目与我的跟进共享同一canonical历史，双向token重放零重复写；父项目canWrite不能扩大跟进自身只读权限');

for(const actor of [admin,user('sales'),user('outsider')]){
 const generic=await ok('data',undefined,actor),text=JSON.stringify(generic);
 for(const value of [...records('business_followup').map(row=>row.note).filter(Boolean),'synthetic restricted costing',...records('business_followup_attachment').map(row=>row.fileKey)])assert(!text.includes(value),'Public data/audit leaked business followup content');
 assert(!(generic.audits||[]).some(row=>[row.before?.kind,row.after?.kind].some(kind=>typeof kind==='string'&&kind.startsWith('business_followup'))));
}
for(const before of original)assert.deepEqual(raw().find(row=>row.id===before.id),before,'Original record changed: '+before.id);
assert(records('business_followup').every(row=>row.createdById&&row.createdByName&&row.createdAt));
pass('所有新增记录独立留存，原客户/项目/成员/报价权限和无关记录字节不变，通用data及audit不泄漏正文或存储键');
await fs.writeFile(path.join(output,'result.json'),JSON.stringify({passed:checks.length,checks,scope:'isolated synthetic in-memory DB; no production access',originalRecordsPreserved:original.length,fileObjects:bucketObjects.size},null,2));
db.close();console.log(JSON.stringify({passed:checks.length,report:path.join(output,'result.json')}));
