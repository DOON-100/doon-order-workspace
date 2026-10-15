import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

const output=path.resolve('test-output','payment-terms-'+process.pid);await fs.mkdir(output,{recursive:true});
const db=new DatabaseSync(':memory:');for(const name of (await fs.readdir('drizzle')).filter(n=>n.endsWith('.sql')).sort())db.exec(await fs.readFile(path.join('drizzle',name),'utf8'));
class Statement{constructor(sql,args=[]){this.sql=sql;this.args=args;}bind(...args){return new Statement(this.sql,args);}async first(){return db.prepare(this.sql).get(...this.args)||null;}async all(){return {results:db.prepare(this.sql).all(...this.args)};}async run(){return db.prepare(this.sql).run(...this.args);}}
globalThis.__termsEnv={DB:{prepare:sql=>new Statement(sql),batch:async statements=>{db.exec('BEGIN');try{const result=statements.map(x=>db.prepare(x.sql).run(...x.args));db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}},BUCKET:{put:async()=>{throw Error('No attachments in payment term tests');},get:async()=>{throw Error('No attachments in payment term tests');}}};
const outfile=path.join(output,'api.mjs');
await build({stdin:{contents:"export * from './lib/payment-terms-api';export * from './lib/payment-terms';export {snapshot} from './lib/store';export {collaborationPost} from './lib/collaboration-api';",resolveDir:process.cwd(),loader:'ts'},outfile,bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@':process.cwd()},plugins:[{name:'payment-term-bindings',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'terms'}));b.onResolve({filter:/chatgpt-auth$/},()=>({path:'auth',namespace:'terms'}));b.onLoad({filter:/.*/,namespace:'terms'},args=>({contents:args.path==='env'?'export const env=globalThis.__termsEnv':'export const getChatGPTUser=async()=>null'}));}}]});
const api=await import(pathToFileURL(outfile).href),at='2026-10-15T00:00:00.000Z';
const member=(id,role,name=id)=>({id,kind:'member',role,name,email:id+'@test.invalid',customers:[],active:true,userId:id,createdAt:at});
const admin=member('admin','admin'),sales=member('sales','sales','同名业务'),impostor=member('impostor','sales','同名业务'),li=member('readonly','admin'),clerk=member('clerk','clerk');
const insert=r=>db.prepare('INSERT INTO records(id,kind,data) VALUES(?,?,?)').run(r.id,r.kind,JSON.stringify(r));
[admin,sales,impostor,li,clerk].forEach(insert);insert({id:'read-only-grant',kind:'ar_access_grant',memberId:li.id,active:true,readOnly:true,scopeType:'company',teamIds:[],capabilities:['read','export'],version:1});
const originalCustomer={id:'customer-synthetic',kind:'customer_account',customer:'合成付款条件测试客户',customerCode:'SYN-TERM',salesName:sales.name,serviceName:'',pmcName:'',salesMemberIds:[sales.id],serviceMemberIds:[],active:true,notes:'保留原始备注',version:1,createdAt:at,updatedAt:at,updatedBy:'合成来源'};insert(originalCustomer);
const raw=()=>db.prepare('SELECT id,kind,data FROM records ORDER BY id').all(),row=id=>JSON.parse(db.prepare('SELECT data FROM records WHERE id=?').get(id).data);
async function post(action,input,actor=sales){const s=await api.snapshot();return api.paymentTermsPost('payment-terms-'+action,new Request('https://terms.test/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}),s,actor);}
async function ok(action,input,actor=sales){return (await post(action,input,actor)).json();}
async function denied(fn,status){const before=raw();await assert.rejects(fn,e=>e.status===status);assert.deepEqual(raw(),before);}
const checks=[];function pass(s){checks.push(s);console.log('PASS '+s);}
const one=[{id:'one',label:'全额',percent:100,trigger:'issue',days:0}],content={name:'合成业务条款',bulk:[{id:'deposit',label:'订金',percent:30,trigger:'issue',days:7},{id:'pre',label:'发货前款',percent:60,trigger:'before_shipment',days:5},{id:'balance',label:'尾款',percent:10,trigger:'after_shipment',days:30}],sample:one,mold:one,note:'仅用于隔离测试的条款依据'};
let s=await api.snapshot(),before=raw();assert.deepEqual((await api.paymentTermsGet('payment-terms-data',new Request('https://terms.test'),s,admin).json()).terms,[]);assert.equal(row(originalCustomer.id).directory,undefined);assert.deepEqual(raw(),before);pass('读取不生成模板、不授权、不回填旧客户');
const saveInput={...content,version:0,token:crypto.randomUUID()};let result=await ok('save',saveInput),term=result.item;assert.equal(term.status,'draft');assert.equal(api.activePaymentTerm(await api.snapshot(),term.id),undefined);let replay=await ok('save',saveInput);assert.equal(replay.item.id,term.id);assert.equal(replay.idempotent,true);pass('保存三阶段草稿，重试同token幂等且未授权不可选');
await denied(()=>post('authorize',{id:term.id,version:term.version,reason:'不能默认审批',token:crypto.randomUUID()},admin),403);await denied(()=>post('save',{...content,version:0,token:crypto.randomUUID()},li),403);pass('管理员不自动具有条件审批权，只读账号优先于管理员角色拦写');
await ok('authorizers-save',{version:0,authorizerMemberIds:[sales.id],reason:'隔离测试明确指定成员ID',token:crypto.randomUUID()},admin);
await denied(()=>post('authorize',{id:term.id,version:term.version,reason:'同名冒用',token:crypto.randomUUID()},impostor),403);
await denied(()=>post('authorizers-save',{version:1,authorizerMemberIds:[li.id],reason:'不允许只读人员',token:crypto.randomUUID()},admin),403);pass('条件授权按独立成员ID名单，同名和只读成员不能获权');
term=(await ok('authorize',{id:term.id,version:term.version,reason:'合成条款已核对',token:crypto.randomUUID()})).item;assert.equal(api.activePaymentTerm(await api.snapshot(),term.id).id,term.id);const snap=api.paymentTermSnapshot(term);term.bulk[0].percent=20;assert.equal(snap.bulk[0].percent,30);term=row(term.id);pass('授权后方可选择，条件快照深复制');
await denied(()=>post('save',{...content,id:term.id,version:term.version,token:crypto.randomUUID()}),409);
for(const bad of [{bulk:[{...one[0],percent:99}]},{sample:[{...one[0],percent:101}]},{mold:[{...one[0],percent:0}]},{bulk:[{...one[0],percent:50},{...one[0],percent:50}]}])await denied(()=>post('save',{...content,...bad,version:0,token:crypto.randomUUID()}),400);
pass('已授权版本不可覆盖，各收费分期均校验100%、正比例及唯一阶段ID');
let v2=(await ok('save',{...content,name:'合成业务条款新版本',version:0,sourceId:term.id,sourceVersion:term.version,token:crypto.randomUUID()})).item;assert.equal(v2.termVersion,2);assert.equal(v2.familyId,term.familyId);assert.equal(v2.status,'draft');assert.equal(row(term.id).status,'active');pass('新版本仍待授权，既有版本和快照不变');
const customerBody=c=>({id:c.id,expectedVersion:c.version,customer:c.customer,customerCode:c.customerCode,salesName:c.salesName,serviceName:c.serviceName,pmcName:c.pmcName,active:c.active,notes:c.notes});
async function saveCustomer(body,m=admin){return api.collaborationPost('customer-save',new Request('https://terms.test/customer-save',{method:'POST',body:JSON.stringify(body),headers:{'Content-Type':'application/json'}}),await api.snapshot(),m);}
await denied(()=>saveCustomer({...customerBody(row(originalCustomer.id)),directory:{defaultPaymentTermId:v2.id}}),409);await denied(()=>saveCustomer({...customerBody(row(originalCustomer.id)),directory:{defaultPaymentTermId:term.id}},li),403);
let saved=await (await saveCustomer({...customerBody(row(originalCustomer.id)),directory:{defaultPaymentTermId:term.id}})).json();assert.equal(saved.item.directory.defaultPaymentTermId,term.id);assert.equal(saved.item.notes,originalCustomer.notes);pass('客户默认条件仅可选授权版本，取数账号不能改客户');
await ok('disable',{id:term.id,version:term.version,reason:'测试停用',token:crypto.randomUUID()});assert.equal(api.activePaymentTerm(await api.snapshot(),term.id),undefined);
saved=await (await saveCustomer({...customerBody(row(originalCustomer.id)),directory:{defaultPaymentTermId:term.id,country:'合成地区'}})).json();assert.equal(saved.item.directory.defaultPaymentTermId,term.id);assert.equal(snap.status,'active');pass('停用不清空历史客户选择或历史快照，未变更条款的普通维护仍可保存');
await denied(()=>post('authorizers-save',{version:0,authorizerMemberIds:[],reason:'过期名单不能写',token:crypto.randomUUID()},admin),409);pass('授权名单与条件记录具备乐观锁，失败无部分写入');
await fs.writeFile(path.join(output,'result.json'),JSON.stringify({passed:checks.length,checks,scope:'synthetic isolated in-memory only'},null,2));db.close();console.log(JSON.stringify({passed:checks.length,report:path.join(output,'result.json')}));
