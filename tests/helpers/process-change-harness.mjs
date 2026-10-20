import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {AsyncLocalStorage} from 'node:async_hooks';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';

// Isolated synthetic API harness, also used by the Agent cross-checkout tests.
export async function createProcessChangeHarness(root=process.cwd()){
 const testRoot=path.resolve(root,'test-output'),directory=path.resolve(testRoot,'process-change-'+randomUUID());
 if(!directory.startsWith(testRoot+path.sep))throw Error('Invalid synthetic test directory');
 await fs.mkdir(directory,{recursive:true});
 const db=new DatabaseSync(':memory:'),identity=new AsyncLocalStorage(),key=randomUUID();let fault=false;
 for(const file of (await fs.readdir(path.join(root,'drizzle'))).filter(f=>f.endsWith('.sql')).sort())db.exec(await fs.readFile(path.join(root,'drizzle',file),'utf8'));
 db.exec("INSERT OR IGNORE INTO workspace_revision (id,revision) VALUES ('main',0)");
 class Statement{constructor(sql,args=[]){this.sql=sql;this.args=args;}bind(...args){return new Statement(this.sql,args);}async first(){return db.prepare(this.sql).get(...this.args)||null;}async all(){return{results:db.prepare(this.sql).all(...this.args)};}async run(){return db.prepare(this.sql).run(...this.args);}}
 const files=new Map([['SYN-ORIGINAL',new Uint8Array([1,2,3])]]);
 const env={DB:{prepare:sql=>new Statement(sql),batch:async statements=>{db.exec('BEGIN');try{const results=[];for(let i=0;i<statements.length;i++){results.push(db.prepare(statements[i].sql).run(...statements[i].args));if(fault&&i===2){fault=false;throw Error('SYN injected transaction failure');}}db.exec('COMMIT');return results;}catch(error){db.exec('ROLLBACK');throw error;}}},BUCKET:{get:async key=>files.has(key)?{body:files.get(key)}:null,put:async(key,value)=>files.set(key,value)}};
 globalThis.__processChangeHarnesses??=new Map();globalThis.__processChangeHarnesses.set(key,{env,identity});
 const file=path.join(directory,'api.mjs');
 await build({entryPoints:[path.join(root,'app/api/workspace/[action]/route.ts')],outfile:file,bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@':root},plugins:[{name:'synthetic-only-bindings',setup(b){
  b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'synthetic'}));b.onResolve({filter:/chatgpt-auth$/},()=>({path:'auth',namespace:'synthetic'}));
  b.onLoad({filter:/.*/,namespace:'synthetic'},args=>({contents:args.path==='env'?`export const env=globalThis.__processChangeHarnesses.get(${JSON.stringify(key)}).env`:`export async function getChatGPTUser(){return globalThis.__processChangeHarnesses.get(${JSON.stringify(key)}).identity.getStore()||null}`}));
 }}]});
 const api=await import(pathToFileURL(file).href),at='2026-10-20T00:00:00Z';
 const member=(id,role)=>({id,kind:'member',userId:id,email:id+'@example.invalid',name:id,role,active:true,customers:[],createdAt:at});
 const admin=member('SYN-ADMIN','admin'),other=member('SYN-OTHER','admin'),viewer=member('SYN-VIEWER','viewer');
 const customer={id:'SYN-C',kind:'customer_account',customer:'SYN Customer',customerCode:'SYN-CODE',active:true,version:1,createdAt:at};
 const order={id:'SYN-O',kind:'order',version:1,customer:'SYN-CODE',orderNo:'SYN-ORDER',drawing:'SYN-DRAWING',ownerEmail:admin.email,quantity:10,extra:{},createdAt:at};
 const put=row=>db.prepare('INSERT INTO records (id,kind,data) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,kind=excluded.kind').run(row.id,row.kind,JSON.stringify(row));
 for(const row of [admin,other,viewer,customer,order,{id:'SYN-ATTACHMENT',kind:'attachment',lineId:order.id,fileKey:'SYN-ORIGINAL'}])put(row);
 const rows=()=>db.prepare('SELECT data FROM records ORDER BY id').all().map(row=>JSON.parse(row.data));
 async function request(action,body,user=admin,origin='https://synthetic.test'){
  return identity.run(user?{userId:user.userId,email:user.email,displayName:user.name}:null,()=>api[body===undefined?'GET':'POST'](new Request('https://synthetic.test/api/workspace/'+action,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(origin?{Origin:origin}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),{params:Promise.resolve({action:action.split('?')[0]})}));
 }
 return{request,rows,put,admin,other,viewer,files,failTransaction(){fault=true;},async close(){db.close();globalThis.__processChangeHarnesses.delete(key);await fs.rm(directory,{recursive:true,force:true});}};
}
