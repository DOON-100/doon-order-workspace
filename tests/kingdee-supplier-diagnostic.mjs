import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {AsyncLocalStorage} from 'node:async_hooks';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
await fs.mkdir('test-output',{recursive:true});
const db=new DatabaseSync(':memory:');for(const name of (await fs.readdir('drizzle')).filter(n=>n.endsWith('.sql')).sort())db.exec(await fs.readFile('drizzle/'+name,'utf8'));
class Statement{constructor(sql,args=[]){this.sql=sql;this.args=args}bind(...args){return new Statement(this.sql,args)}async first(){return db.prepare(this.sql).get(...this.args)||null}async all(){return {results:db.prepare(this.sql).all(...this.args)}}async run(){return db.prepare(this.sql).run(...this.args)}}
const identity=new AsyncLocalStorage(),files=new Map();globalThis.__testIdentity=identity;globalThis.__testEnv={DB:{prepare:sql=>new Statement(sql),batch:async statements=>{db.exec('BEGIN');try{for(const st of statements)db.prepare(st.sql).run(...st.args);db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}}},BUCKET:{put:async(k,v)=>files.set(k,v)}};
await build({entryPoints:['app/api/workspace/[action]/route.ts'],outfile:'test-output/kingdee-supplier-diagnostic-api.mjs',bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@':process.cwd()},plugins:[{name:'test-bindings',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'cloudflare',namespace:'test'}));b.onResolve({filter:/chatgpt-auth$/},()=>({path:'auth',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},a=>({contents:a.path==='auth'?'export async function getChatGPTUser(){return globalThis.__testIdentity.getStore()||null}':'export const env=globalThis.__testEnv;'}))}}]});
const api=await import('../test-output/kingdee-supplier-diagnostic-api.mjs');
const admin={userId:'admin',email:'admin@test.invalid',displayName:'测试管理员'},clerk={userId:'clerk',email:'clerk@test.invalid',displayName:'测试文员'};
async function call(action,body,user=admin,headers={}){const method=body===undefined?'GET':'POST';return identity.run(user,()=>api[method](new Request('https://orders.test/api/workspace/'+action,{method,headers:body===undefined?headers:{'content-type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)}),{params:Promise.resolve({action:action.split('?')[0]})}));}
async function ok(action,body,user=admin){const r=await call(action,body,user),v=await r.json();assert.equal(r.status,200,JSON.stringify(v));return v}
await ok('enroll',{});await ok('member',{name:'测试文员',email:clerk.email,role:'clerk',customers:[],active:true});await ok('enroll',{},clerk);
const digest=()=>JSON.stringify(db.prepare('SELECT id,kind,data FROM records ORDER BY rowid').all());const baseline=digest();
assert.equal((await call('kingdee-supplier-diagnostic',undefined,null)).status,401);
assert.equal((await call('kingdee-supplier-diagnostic',undefined,clerk)).status,403);
assert.equal((await call('kingdee-supplier-diagnostic',undefined,admin,{'X-Workspace-Team':'test'})).status,403);
assert.equal((await call('kingdee-supplier-diagnostic?limit=100')).status,400);
assert.equal((await call('kingdee-supplier-diagnostic')).status,503);
Object.assign(globalThis.__testEnv,{DOON_KINGDEE_READONLY_ENABLED:'1',DOON_KINGDEE_CLIENT_ID:'synthetic-client',DOON_KINGDEE_CLIENT_SECRET:'synthetic-secret',DOON_KINGDEE_INSTANCE_ID:'synthetic-instance',DOON_KINGDEE_ACCOUNT_ID:'synthetic-account'});
let calls=[],mode='ok';const originalFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{const url=new URL(input);calls.push({path:url.pathname,method:init.method,query:Object.fromEntries(url.searchParams)});
 if(url.pathname.endsWith('push_app_authorize'))return Response.json({code:200,data:[{clientId:'synthetic-client',outerInstanceId:'synthetic-instance',accountId:'synthetic-account',status:1,appKey:'synthetic-key',appSecret:'synthetic-app-secret',domain:'https://tf.jdy.com'}]});
 if(url.pathname.endsWith('kingdee_auth_token'))return Response.json({errcode:0,data:{'app-token':'synthetic-token'}});
 if(url.pathname==='/jdy/v2/bd/supplier'){
  const row={id:'101',number:'S001',name:'合成供应商',enable:'1',bank_account:'private-bank',phone:'private-phone',bom_entity:[{bank_account:'private-bank'}]};
  return Response.json({errcode:0,data:{count:'1',page:1,page_size:10,current_page_size:mode==='invalid'?2:1,total_page:1,rows:[row]}});
 }
 throw Error('unexpected synthetic route');
};
try{
 const value=await ok('kingdee-supplier-diagnostic');assert.deepEqual(value.rows,[{id:'101',code:'S001',name:'合成供应商',status:'未知'}]);assert.equal(value.count,1);assert.equal(value.readOnly,true);
 assert.deepEqual(calls.at(-1),{path:'/jdy/v2/bd/supplier',method:'GET',query:{page:'1',page_size:'10',show_contact_detail:'false'}});
 const publicText=JSON.stringify(value);for(const secret of ['private-bank','private-phone','synthetic-secret','synthetic-token'])assert(!publicText.includes(secret));
 mode='invalid';assert.equal((await call('kingdee-supplier-diagnostic')).status,502);
 assert.equal(digest(),baseline);assert.equal(files.size,0);
 console.log('PASS Kingdee supplier diagnostic: fixed GET, access, pagination, redaction and no writes');
}finally{globalThis.fetch=originalFetch;db.close();}
