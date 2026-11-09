import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {AsyncLocalStorage} from 'node:async_hooks';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {testIePriceImports} from './ie-price-import-cases.mjs';

// Dedicated API regression using an isolated in-memory store and synthetic data.
const db=new DatabaseSync(':memory:');
for(const name of (await fs.readdir('drizzle')).filter(n=>n.endsWith('.sql')).sort())db.exec(await fs.readFile('drizzle/'+name,'utf8'));
class Statement{constructor(sql,args=[]){this.sql=sql;this.args=args;}bind(...args){return new Statement(this.sql,args);}async first(){return db.prepare(this.sql).get(...this.args)||null;}async all(){return {results:db.prepare(this.sql).all(...this.args)};}async run(){return db.prepare(this.sql).run(...this.args);}}
const files=new Map(),identity=new AsyncLocalStorage();
globalThis.__iePriceIdentity=identity;
globalThis.__iePriceEnv={DB:{prepare:sql=>new Statement(sql),batch:async statements=>{db.exec('BEGIN');try{const result=[];for(const s of statements)result.push(db.prepare(s.sql).run(...s.args));db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}},BUCKET:{put:async(k,v)=>files.set(k,v),get:async k=>files.has(k)?{body:files.get(k)}:null}};
await fs.mkdir('test-output',{recursive:true});
await build({entryPoints:['app/api/workspace/[action]/route.ts'],outfile:'test-output/ie-price-api.mjs',bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@':process.cwd()},plugins:[{name:'synthetic-price-store',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'cloudflare',namespace:'test'}));b.onResolve({filter:/chatgpt-auth$/},()=>({path:'auth',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},args=>({contents:args.path==='auth'?'export async function getChatGPTUser(){return globalThis.__iePriceIdentity.getStore()||null}':'export const env=globalThis.__iePriceEnv;'}));}}]});
const api=await import('../test-output/ie-price-api.mjs');
const admin={userId:'synthetic-price-admin',email:'synthetic-price-admin@test.invalid',displayName:'合成价格管理员'};
async function call(action,body,user=admin){const method=body===undefined?'GET':'POST';return identity.run(user,()=>api[method](new Request('https://synthetic.test/api/workspace/'+action,{method,headers:body instanceof FormData?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)}),{params:Promise.resolve({action:action.split('?')[0]})}));}
async function ok(action,body,user=admin){const response=await call(action,body,user),result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;}
const rawInsert=record=>db.prepare('INSERT INTO records (id,kind,data) VALUES (?,?,?)').run(record.id,record.kind,JSON.stringify(record));
await ok('enroll',{});
for(const id of ['synthetic-price-engineer','synthetic-price-reviewer','synthetic-price-manager'])rawInsert({id,kind:'member',userId:id,email:id+'@test.invalid',name:id,role:'production',active:true,customers:[],createdAt:'2026-10-01T00:00:00.000Z'});
await ok('ie-quote-policy',{version:0,engineerMemberId:'synthetic-price-engineer',reviewerMemberId:'synthetic-price-reviewer',finalApproverMemberId:'synthetic-price-manager'});
await testIePriceImports({ok,call,rawInsert,pass:name=>console.log('PASS '+name),rawRecords:()=>db.prepare('SELECT data FROM records ORDER BY rowid').all().map(r=>JSON.parse(r.data))});
db.close();console.log('IE supplier price import API checks passed.');
