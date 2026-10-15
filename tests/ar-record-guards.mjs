import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

const output=path.resolve('test-output','ar-record-guards-'+process.pid);await fs.mkdir(output,{recursive:true});
const db=new DatabaseSync(':memory:');for(const name of (await fs.readdir('drizzle')).filter(n=>n.endsWith('.sql')).sort())db.exec(await fs.readFile(path.join('drizzle',name),'utf8'));
class Statement{constructor(sql,args=[]){this.sql=sql;this.args=args;}bind(...args){return new Statement(this.sql,args);}async first(){return db.prepare(this.sql).get(...this.args)||null;}async all(){return {results:db.prepare(this.sql).all(...this.args)};}async run(){return db.prepare(this.sql).run(...this.args);}}
globalThis.__arGuardEnv={DB:{prepare:sql=>new Statement(sql),batch:async statements=>{db.exec('BEGIN');try{const out=statements.map(x=>db.prepare(x.sql).run(...x.args));db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}}},BUCKET:{put:async()=>{throw Error('Guard tests must not touch attachments');},get:async()=>{throw Error('Guard tests must not touch attachments');}}};
const outfile=path.join(output,'api.mjs');await build({stdin:{contents:"export * from './lib/customer-project-finance-api';export {canVerifyProjectFinance,canReadProjectFinance} from './lib/customer-project-finance';export * from './lib/service-workspace-api';export {canWriteServiceWorkspace} from './lib/service-workspace';export {snapshot} from './lib/store';",resolveDir:process.cwd(),loader:'ts'},outfile,bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@':process.cwd()},plugins:[{name:'ar-record-guard-bindings',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'ar-guards'}));b.onResolve({filter:/chatgpt-auth$/},()=>({path:'auth',namespace:'ar-guards'}));b.onLoad({filter:/.*/,namespace:'ar-guards'},args=>({contents:args.path==='env'?'export const env=globalThis.__arGuardEnv':'export const getChatGPTUser=async()=>null'}));}}]});
const api=await import(pathToFileURL(outfile).href),stamp='2026-10-01T00:00:00.000Z';
const member=(id,role)=>({id,kind:'member',role,name:'合成'+id,email:id+'@test.invalid',customers:['C-guard'],userId:id,active:true,createdAt:stamp});
const admin=member('admin','admin'),roAdmin=member('readonly-admin','admin'),roFinance=member('readonly-finance','finance'),sales=member('sales','sales');
const insert=r=>db.prepare('INSERT INTO records(id,kind,data) VALUES(?,?,?)').run(r.id,r.kind,JSON.stringify(r)),raw=()=>db.prepare('SELECT id,kind,data FROM records ORDER BY id').all(),record=id=>JSON.parse(db.prepare('SELECT data FROM records WHERE id=?').get(id).data);
[admin,roAdmin,roFinance,sales].forEach(insert);for(const m of [roAdmin,roFinance])insert({id:'grant-'+m.id,kind:'ar_access_grant',memberId:m.id,active:true,readOnly:true,scopeType:'company',teamIds:[],capabilities:['read','export'],version:1});
insert({id:'C-guard',kind:'customer_account',customer:'合成守卫客户',customerCode:'SYN-GUARD',active:true,salesMemberIds:[sales.id],serviceMemberIds:[],salesName:sales.name,serviceName:'',pmcName:'',notes:'',version:1,createdAt:stamp});
insert({id:'P-guard',kind:'customer_project',customerId:'C-guard',status:'active',salesMemberId:sales.id,serviceMemberIds:[],version:1,title:'合成项目',createdAt:stamp});
const charge={id:'CH-guard',kind:'project_charge',customerId:'C-guard',projectId:'P-guard',roundId:'',title:'原签发收费',category:'bulk',currency:'USD',amountCents:10000,prepayCents:3000,dueDate:'',note:'原备注',status:'confirmed',version:1,sourceDocumentId:'PI-guard',attributionTeamId:'TEAM-original',paymentTermSnapshot:{id:'TERM-original',version:1},arCanonicalKey:'pi:PI-guard:line:0',plan:[{id:'p1',title:'订金',amountCents:3000,dueDate:'2026-10-01',beforeOrder:true,trigger:'issue',offsetDays:0},{id:'p2',title:'尾款',amountCents:7000,dueDate:'',beforeOrder:false,trigger:'after_shipment',offsetDays:30}],createdAt:stamp,createdBy:'合成作者',createdById:admin.id};insert(charge);
const document={id:'PI-guard',kind:'project_billing_document',customerId:'C-guard',projectId:'P-guard',roundId:'',documentType:'PI',documentNo:'SYN-PI-guard',currency:'USD',date:'2026-10-01',status:'draft',version:1,chargeIds:[charge.id],lines:[{chargeId:charge.id,projectId:'P-guard',title:charge.title,amountCents:10000,plan:charge.plan}],createdAt:stamp};insert(document);
insert({id:'ISSUE-guard',kind:'ar_document_issue',sourceKind:document.kind,sourceId:document.id,sourceVersion:1,chargeIds:[charge.id],sourceSnapshot:document,createdAt:stamp});
const req=body=>new Request('https://guards.test/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
async function finance(action,body,m=admin){return api.customerProjectFinancePost(action,req(body),await api.snapshot(),m);}
async function denied(fn,status){const before=raw();await assert.rejects(fn,e=>e.status===status);assert.deepEqual(raw(),before);}
const checks=[];function pass(s){checks.push(s);console.log('PASS '+s);}
for(const action of Object.keys(api.projectFinanceSchemas))await denied(()=>finance(action,{},roAdmin),403);
for(const action of ['service-save','service-receipt','service-receipt-reverse','service-attachment'])await denied(async()=>api.serviceWorkspacePost(action,req({}),await api.snapshot(),roAdmin),403);
pass('只读成员即使具有管理员角色，也在所有项目财务/客服写入口解析与幂等重试前被拒绝，数据库无变化');
let s=await api.snapshot();for(const m of [roAdmin,roFinance]){assert.equal(api.canVerifyProjectFinance(s,m,'C-guard'),false);assert.equal(api.canReadProjectFinance(s,m,'C-guard'),true);assert.equal(api.canWriteServiceWorkspace(s,m),false);}
assert.equal(api.canVerifyProjectFinance(s,admin,'C-guard'),true);assert.equal(api.canWriteServiceWorkspace(s,sales),true);
const feed=await (await api.customerProjectFinanceGet('project-finance-data',new Request('https://guards.test/api?customerId=C-guard'),s,roFinance)).json();assert.equal(feed.canVerify,false);assert.equal(feed.canWrite,false);assert.equal(feed.customers.length,1);
pass('只读账号仍可读取原获授权财务范围，write/verify能力为false，其他现有角色权限不变');
const saveDocument={id:document.id,version:1,token:crypto.randomUUID(),customerId:'C-guard',projectId:'P-guard',documentType:'PI',documentNo:'SYN-PI-new',currency:'USD',chargeIds:[charge.id],date:'2026-10-01'};
await denied(()=>finance('project-document-save',saveDocument),409);for(const action of ['project-document-confirm','project-document-revise'])await denied(()=>finance(action,{id:document.id,version:1,reason:'合成修订原因',token:crypto.randomUUID()}),action==='project-document-confirm'?400:409);
await denied(()=>finance('project-document-confirm',{id:document.id,version:1,token:crypto.randomUUID()}),409);
pass('已签发原PI禁止保存、修订和旧确认流程重写，原合同保留');
const input=()=>({id:charge.id,version:record(charge.id).version,token:crypto.randomUUID(),projectId:'P-guard',roundId:'',title:charge.title,category:charge.category,currency:charge.currency,amount:'100',prepayAmount:'30',dueDate:'',note:charge.note,plan:charge.plan.map(p=>({title:p.title,amount:(p.amountCents/100).toFixed(2),dueDate:p.dueDate,beforeOrder:p.beforeOrder}))});
for(const patch of [{amount:'110'},{currency:'CNY'},{prepayAmount:'40'},{dueDate:'2026-10-02'},{plan:[{title:'一次付清',amount:'100',dueDate:'2026-10-01',beforeOrder:true}]}])await denied(()=>finance('project-charge-save',{...input(),...patch}),409);
const note=(await (await finance('project-charge-save',{...input(),note:'补充不改合同的说明'})).json()).record;for(const key of ['sourceDocumentId','attributionTeamId','paymentTermSnapshot','arCanonicalKey','plan'])assert.deepEqual(note[key],charge[key]);assert.equal(note.note,'补充不改合同的说明');
pass('签发收费禁止金额/币种/日期/分期改写；仅备注维护保留来源、归属、条款快照和阶段触发字段');
const adjustment=await (await finance('project-adjustment',{chargeId:charge.id,type:'discount',amount:'1',prepay:false,reason:'合成折让依据',evidence:'合成批准凭据',token:crypto.randomUUID()})).json();assert.equal(adjustment.record.kind,'project_adjustment');assert.equal(record(charge.id).amountCents,10000);
pass('有原权限的核实人员仍可独立登记账务调整，原合同金额不变');
insert({...document,id:'PI-unissued',documentNo:'SYN-PI-unissued',chargeIds:[],lines:[]});let pending=await (await finance('project-document-save',{...saveDocument,id:'PI-unissued',chargeIds:[],manualTitle:'合成新收费',manualAmount:'2',token:crypto.randomUUID()})).json();assert.equal(pending.record.version,2);pass('未签发PI仍按原业务权限正常维护');
await fs.writeFile(path.join(output,'result.json'),JSON.stringify({passed:checks.length,checks,scope:'synthetic in-memory; no production data'},null,2));db.close();console.log(JSON.stringify({passed:checks.length,report:path.join(output,'result.json')}));
