// Exercises the actual API handlers against SQLite, including atomic batch guards.
// Test identities are injected into this temporary bundle only, never into site code.
import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {AsyncLocalStorage} from 'node:async_hooks';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
await fs.mkdir('test-output',{recursive:true});
const db=new DatabaseSync(':memory:');
for(const name of (await fs.readdir('drizzle')).filter(n=>n.endsWith('.sql')).sort())db.exec(await fs.readFile('drizzle/'+name,'utf8'));
class Statement{constructor(sql,args=[]){this.sql=sql;this.args=args;}bind(...args){return new Statement(this.sql,args);}async first(){return db.prepare(this.sql).get(...this.args)||null;}async all(){return {results:db.prepare(this.sql).all(...this.args)};}async run(){return db.prepare(this.sql).run(...this.args);}}
const files=new Map(),identity=new AsyncLocalStorage();
globalThis.__testIdentity=identity;
globalThis.__testEnv={DB:{prepare:sql=>new Statement(sql),batch:async statements=>{db.exec('BEGIN');try{const results=[];for(const s of statements)results.push(db.prepare(s.sql).run(...s.args));db.exec('COMMIT');return results;}catch(e){db.exec('ROLLBACK');throw e;}}},BUCKET:{put:async(key,bytes)=>files.set(key,bytes),get:async key=>files.has(key)?{body:files.get(key),json:async()=>JSON.parse(files.get(key))}:null}};
await build({entryPoints:['app/api/workspace/[action]/route.ts'],outfile:'test-output/kingdee-sync-api.mjs',bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@':process.cwd()},plugins:[{name:'test-only-bindings',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'cloudflare',namespace:'test'}));b.onResolve({filter:/chatgpt-auth$/},()=>({path:'auth',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},args=>({contents:args.path==='auth'?'export async function getChatGPTUser(){return globalThis.__testIdentity.getStore()||null}':'export const env=globalThis.__testEnv;'}));}}]});
const api=await import('../test-output/kingdee-sync-api.mjs');
const admin={userId:'test_admin',email:'admin@test.invalid',displayName:'测试 PMC',fullName:'测试 PMC'},clerk={userId:'test_clerk',email:'clerk@test.invalid',displayName:'测试文员',fullName:'测试文员'},sales={userId:'test_sales',email:'sales@test.invalid',displayName:'测试客服',fullName:'测试客服'};
async function call(action,body,user=admin,method=body===undefined?'GET':'POST'){return identity.run(user,()=>api[method==='HEAD'?'GET':method](new Request('https://orders.test/api/workspace/'+action,{method,headers:body instanceof FormData?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)}),{params:Promise.resolve({action:action.split('?')[0]})}));}
async function ok(action,body,user=admin){const res=await call(action,body,user),result=await res.json();assert.equal(res.status,200,JSON.stringify(result));return result;}
function pass(name){console.log('PASS '+name);}
await ok('enroll',{});await ok('member',{name:'合成文员',email:clerk.email,role:'clerk',customers:[],active:true});await ok('enroll',{},clerk);
const {testKingdeeSync}=await import('./kingdee-sync-cases.mjs');await testKingdeeSync({ok,call,api,identity,admin,clerk,files,pass,rawRecords:()=>db.prepare('SELECT data FROM records ORDER BY rowid').all().map(r=>JSON.parse(r.data)),rawInsert:record=>db.prepare('INSERT INTO records (id,kind,data) VALUES (?,?,?)').run(record.id,record.kind,JSON.stringify(record))});
