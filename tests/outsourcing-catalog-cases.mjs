import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

await fs.mkdir('test-output',{recursive:true});
const db=new DatabaseSync(':memory:');
for(const name of (await fs.readdir('drizzle')).filter(n=>n.endsWith('.sql')).sort())db.exec(await fs.readFile('drizzle/'+name,'utf8'));
class Statement{constructor(sql,args=[]){this.sql=sql;this.args=args;}bind(...args){return new Statement(this.sql,args);}async first(){return db.prepare(this.sql).get(...this.args)||null;}async all(){return {results:db.prepare(this.sql).all(...this.args)};}async run(){return db.prepare(this.sql).run(...this.args);}}
globalThis.__catalogTestEnv={DB:{prepare:sql=>new Statement(sql),batch:async statements=>{db.exec('BEGIN');try{for(const statement of statements)db.prepare(statement.sql).run(...statement.args);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}}};
await build({entryPoints:['lib/outsourcing-catalog-api.ts'],outfile:'test-output/outsourcing-catalog-api-test.mjs',bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@':process.cwd()},plugins:[{name:'catalog-test-bindings',setup(b){b.onResolve({filter:/^cloudflare:workers$|chatgpt-auth$/},()=>({path:'test',namespace:'bindings'}));b.onLoad({filter:/.*/,namespace:'bindings'},()=>({contents:'export const env=globalThis.__catalogTestEnv; export async function getChatGPTUser(){return null}'}));}}]});
const {outsourcingCatalogGet,outsourcingCatalogPost}=await import('../test-output/outsourcing-catalog-api-test.mjs');
const admin={id:'member_admin',kind:'member',role:'admin',name:'合成管理员',active:true},owner={id:'member_owner',kind:'member',role:'clerk',name:'合成钛架负责人',active:true},other={id:'member_other',kind:'member',role:'clerk',name:'合成胶架负责人',active:true},supplier={id:'member_supplier',kind:'member',role:'supplier',name:'合成供应商',active:true};
const externalClerk={...owner,id:'external-clerk',personnelType:'external'},externalAdmin={...admin,id:'external-admin',personnelType:'external'};
for(const member of [admin,owner,other,supplier,externalClerk,externalAdmin])db.prepare('INSERT INTO records VALUES(?,?,?)').run(member.id,member.kind,JSON.stringify(member));
db.prepare("INSERT OR IGNORE INTO workspace_revision VALUES('main',0)").run();
function state(){return {revision:db.prepare("SELECT revision FROM workspace_revision WHERE id='main'").get().revision,records:db.prepare('SELECT data FROM records').all().map(row=>JSON.parse(row.data))};}
async function call(action,body,user=admin,snapshot){const req=new Request('https://synthetic.invalid/api/workspace/'+action,{method:body===undefined?'GET':'POST',...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});try{return body===undefined?await outsourcingCatalogGet(action.split('?')[0],req,snapshot||state(),user):await outsourcingCatalogPost(action,req,snapshot||state(),user);}catch(e){return Response.json({error:e.message},{status:e.status||500});}}
async function ok(action,body,user=admin){const response=await call(action,body,user);assert.equal(response.status,200,await response.clone().text());return response.json();}
const changes=()=>db.prepare("SELECT id,data FROM records WHERE kind='member' ORDER BY id").all();const originalMembers=changes();
const input=(patch={})=>({category:'type',code:'TEST-TI',name:'合成钛架类型',ownerDepartment:'titanium',...patch});
let response=await call('outsourcing-catalog',undefined,supplier);assert.equal(response.status,403);
for(const external of [externalClerk,externalAdmin]){assert.equal((await call('outsourcing-catalog',undefined,external)).status,403);assert.equal((await call('outsourcing-catalog-save',{token:randomUUID(),version:0,entry:input(),reason:'外部账号写入'},external)).status,403);assert.equal((await call('outsourcing-catalog-grant',{token:randomUUID(),memberId:external.id,version:0,departments:['titanium'],entryIds:[],active:true,reason:'拒绝外部账号'})).status,400);}
assert((await ok('outsourcing-catalog')).members.every(member=>![externalClerk.id,externalAdmin.id].includes(member.id)));
assert.equal((await call('outsourcing-catalog-save',{token:randomUUID(),version:0,entry:input(),reason:'合成创建'},owner)).status,403);
const saved=await ok('outsourcing-catalog-save',{token:randomUUID(),version:0,entry:input(),reason:'建立类型'});assert.equal(saved.version,1);
assert.equal((await call('outsourcing-catalog-save',{token:randomUUID(),version:0,entry:input({code:'test-ti'}),reason:'重复'},admin)).status,409);
await ok('outsourcing-catalog-grant',{token:randomUUID(),memberId:owner.id,version:0,departments:['titanium'],entryIds:[],active:true,reason:'分配维护范围'});
await ok('outsourcing-catalog-grant',{token:randomUUID(),memberId:other.id,version:0,departments:['plastic'],entryIds:[],active:true,reason:'分配另一维护范围'});
let data=await ok('outsourcing-catalog',undefined,owner);assert.equal(data.members.length,0);assert.equal(data.grants.length,1);assert.equal(data.entries[0].canEdit,true);
const editBody={token:randomUUID(),id:saved.id,version:1,entry:input({name:'合成钛架类型（修订）'}),reason:'完善说明'};
await ok('outsourcing-catalog-save',editBody,owner);await ok('outsourcing-catalog-save',editBody,owner);
assert.equal((await call('outsourcing-catalog-save',{...editBody,token:randomUUID()},owner)).status,409);
assert.equal((await call('outsourcing-catalog-save',{...editBody,version:2,token:randomUUID()},other)).status,403);
assert.equal((await call('outsourcing-catalog-save',{...editBody,version:2,token:randomUUID(),entry:input({ownerDepartment:'plastic'})},owner)).status,403);
const history=await ok('outsourcing-catalog-history?id='+saved.id,undefined,owner);assert.equal(history.rows.length,2);assert.equal(history.rows[1].snapshot.name,'合成钛架类型');
const setting={token:randomUUID(),entryId:saved.id,department:'plastic',version:0,enabled:false,statDepartment:'合成统计部门',statProcess:'合成统计工序',includeCost:'否',reason:'本部门不采用'};
assert.equal((await call('outsourcing-catalog-department-setting',setting,owner)).status,403);await ok('outsourcing-catalog-department-setting',setting,other);
data=await ok('outsourcing-catalog');assert.equal(data.entries[0].active,true);assert.equal(data.settings[0].department,'plastic');
const source={filename:'synthetic.xlsx',sha256:'0'.repeat(64),sheet:'合成工序',row:3,raw:{B3:'合成切割',E3:'否',G3:'是'}};
const imports=[input({code:'TEST-AC',name:'合成胶架类型',ownerDepartment:'未分配',source}),{category:'process',name:'合成切割',ownerDepartment:'未分配',costHistory:{'2025-01-01':'是','2025-02-01':'否'},source}];
const beforePreview=state();const preview=await ok('outsourcing-catalog-import-preview',{token:randomUUID(),entries:imports});assert.equal(preview.newCount,2);assert.deepEqual(state(),beforePreview);
assert.equal((await call('outsourcing-catalog-import-commit',{token:randomUUID(),entries:imports,planHash:'f'.repeat(64)})).status,409);
const commitBody={token:randomUUID(),entries:imports,planHash:preview.planHash};const imported=await ok('outsourcing-catalog-import-commit',commitBody);assert.equal(imported.inserted,2);assert.deepEqual(await ok('outsourcing-catalog-import-commit',commitBody),imported);
const second=await ok('outsourcing-catalog-import-preview',{token:randomUUID(),entries:imports});assert.equal(second.newCount,0);assert.equal(second.existingCount,2);
const row=(await ok('outsourcing-catalog')).entries.find(e=>e.category==='process');assert.equal(row.mappingStatus,'pending');assert.deepEqual(row.source,source);assert.equal(row.costHistory['2025-01-01'],'是');
assert.equal((await call('outsourcing-catalog-save',{token:randomUUID(),id:row.id,version:row.version,entry:{category:'type',code:'ILLEGAL-CONVERSION',name:row.name,ownerDepartment:row.ownerDepartment,source},reason:'不得转换现有工序身份'})).status,400);
const mapped={category:'process',name:row.name,ownerDepartment:'未分配',costHistory:row.costHistory,source,productFamily:'TEST-TI',processingObject:'合成部件',actions:['切割','打磨']};
assert.equal((await call('outsourcing-catalog-save',{token:randomUUID(),id:row.id,version:row.version,entry:{...mapped,productFamily:'UNREGISTERED'},reason:'未知类型'})).status,400);
await ok('outsourcing-catalog-save',{token:randomUUID(),id:row.id,version:row.version,entry:mapped,reason:'确认加工分类'});
assert.equal((await call('outsourcing-catalog-save',{token:randomUUID(),id:row.id,version:2,entry:{...mapped,actions:['打磨','切割']},reason:'改变身份'})).status,400);
assert.equal((await call('outsourcing-catalog-save',{token:randomUUID(),id:row.id,version:2,entry:{...mapped,source:{...source,row:4}},reason:'篡改来源'})).status,400);
const stalePreview=await ok('outsourcing-catalog-import-preview',{token:randomUUID(),entries:[input({code:'TEST-RACE',name:'合成并发类型'})]});
await ok('outsourcing-catalog-save',{token:randomUUID(),version:0,entry:input({code:'TEST-RACE',name:'合成并发类型'}),reason:'另一用户先保存'});
assert.equal((await call('outsourcing-catalog-import-commit',{token:randomUUID(),entries:[input({code:'TEST-RACE',name:'合成并发类型'})],planHash:stalePreview.planHash})).status,409);
const conflicting=[input({code:'TEST-DUP',name:'合成重复A'}),input({code:'TEST-DUP',name:'合成重复B'})],conflictPreview=await ok('outsourcing-catalog-import-preview',{token:randomUUID(),entries:conflicting});assert.equal(conflictPreview.conflictCount,1);const beforeConflict=state();assert.equal((await call('outsourcing-catalog-import-commit',{token:randomUUID(),entries:conflicting,planHash:conflictPreview.planHash})).status,409);assert.deepEqual(state(),beforeConflict);
const staleState=state();await ok('outsourcing-catalog-save',{token:randomUUID(),version:0,entry:input({code:'TXN-A',name:'合成事务A'}),reason:'先提交'});const beforeRace=state();assert.equal((await call('outsourcing-catalog-save',{token:randomUUID(),version:0,entry:input({code:'TXN-B',name:'合成事务B'}),reason:'过期快照'},admin,staleState)).status,409);assert.deepEqual(state(),beforeRace);
await ok('outsourcing-catalog-grant',{token:randomUUID(),memberId:owner.id,version:1,departments:[],entryIds:[],active:false,reason:'撤销维护'});assert.equal((await call('outsourcing-catalog-save',{token:randomUUID(),version:0,entry:input({code:'AFTER-REVOKE'}),reason:'撤权后新增'},owner)).status,403);
assert.deepEqual(changes(),originalMembers);
console.log('PASS outsourcing catalog: shared reads, scoped grants, version history, department independence, immutable sources, import preview/hash/idempotency and conflict atomicity');
db.close();
