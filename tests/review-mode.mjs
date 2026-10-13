// Synthetic temporary databases only. Never reads production data or credentials.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHash,scryptSync} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';

const root=process.cwd();
await fs.mkdir(path.resolve('test-output'),{recursive:true});
const testRoot=await fs.mkdtemp(path.resolve('test-output/review-mode-'));
const buildDir=path.join(testRoot,'build'),dataDir=path.join(testRoot,'data');
await fs.mkdir(buildDir,{recursive:true});
for(const name of ['runtime.mjs','auth.mjs','server.mjs','supplier-gateway.mjs'])await fs.copyFile(path.join(root,'standalone',name),path.join(buildDir,name));
await build({entryPoints:['app/api/workspace/[action]/route.ts'],outfile:path.join(buildDir,'workspace-api-real.mjs'),bundle:true,format:'esm',platform:'node',packages:'external',alias:{'@':root},plugins:[{name:'standalone-bindings',setup(b){b.onResolve({filter:/^cloudflare:workers$|chatgpt-auth$/},()=>({path:'./runtime.mjs',external:true}));}}]});
// Instrument the synthetic test server only: enroll must never dispatch to the API.
await fs.writeFile(path.join(buildDir,'workspace-api.mjs'),`import * as real from './workspace-api-real.mjs';
import {db,env} from './runtime.mjs';
export async function POST(req,ctx){if((await ctx.params).action==='enroll')throw new Error('ENROLL_API_MUST_NOT_RUN');return real.POST(req,ctx);}
export async function GET(req,ctx){if((await ctx.params).action==='review-guard-probe'){
 const checks=[];for(const sql of ["UPDATE records SET data=data", "DELETE FROM local_accounts", "UPDATE local_meta SET value='changed'", "UPDATE workspace_revision SET revision=revision+1", "INSERT INTO local_meta VALUES('new','changed')"]){try{db.exec(sql);checks.push(false);}catch(e){checks.push(String(e).includes('review_mode_read_only'));}}
 try{await env.BUCKET.put('synthetic-attempt','changed');checks.push(false);}catch(e){checks.push(e.status===403);}return Response.json({checks});}return real.GET(req,ctx);}
`);
const password='Synthetic-Review-Password-2026!',at='2026-10-13T06:00:48.000Z';
const productionToken='a'.repeat(43),productionDigest=createHash('sha256').update(productionToken).digest('hex');
async function seed(target){
 await fs.mkdir(path.join(target,'files'),{recursive:true});
 const db=new DatabaseSync(path.join(target,'workspace.sqlite'));
 db.exec(`CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,data TEXT NOT NULL);CREATE INDEX idx_records_kind ON records(kind);
 CREATE TABLE workspace_revision(id TEXT PRIMARY KEY,revision INTEGER NOT NULL DEFAULT 0);INSERT INTO workspace_revision VALUES('main',7);
 CREATE TABLE transaction_guards(id TEXT PRIMARY KEY,valid INTEGER NOT NULL,CONSTRAINT revision_must_match CHECK(valid=1));
 CREATE TABLE local_accounts(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,member_id TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,must_change INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
 CREATE TABLE local_sessions(token_hash TEXT PRIMARY KEY,account_id TEXT NOT NULL,expires_at INTEGER NOT NULL,last_seen INTEGER NOT NULL);
 CREATE TABLE login_attempts(key TEXT PRIMARY KEY,failures INTEGER NOT NULL,until_at INTEGER NOT NULL);
 CREATE TABLE local_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
 const salt='01020304050607080910111213141516',hash=`scrypt-v1$${salt}$${scryptSync(password,salt,64,{N:32768,r:8,p:3,maxmem:64*1024*1024}).toString('hex')}`;
 for(const [username,role,mustChange] of [['admin','admin',0],['viewer','viewer',0],['initial','sales',1]]){
  const member={id:'member-'+username,kind:'member',userId:'account-'+username,email:username+'@example.invalid',name:'合成'+username,role,orderScope:role==='admin'?'all':'assigned',customers:[],departments:[],active:true,createdAt:at};
  db.prepare('INSERT INTO records VALUES(?,?,?)').run(member.id,member.kind,JSON.stringify(member));
  db.prepare('INSERT INTO local_accounts VALUES(?,?,?,?,?,?)').run(member.userId,username,member.id,hash,mustChange,at);
 }
 const order={id:'order-1',kind:'order',version:1,orderNo:'SYN-ORDER',customer:'合成客户',drawing:'SYN-MODEL',quantity:1,ownerEmail:'admin@example.invalid',stage:'生产中',requestedDate:'',updatedAt:at};
 db.prepare('INSERT INTO records VALUES(?,?,?)').run(order.id,order.kind,JSON.stringify(order));
 db.prepare('INSERT INTO local_meta VALUES(?,?)').run('last_backup',JSON.stringify({at,integrity:'ok',folder:'synthetic-private-marker'}));
 db.prepare('INSERT INTO local_sessions VALUES(?,?,?,?)').run(productionDigest,'account-admin',Date.now()+3600000,Date.now());
 db.close();
 await fs.writeFile(path.join(target,'files','synthetic-original'),'synthetic immutable original');
}
function snapshot(target){const db=new DatabaseSync(path.join(target,'workspace.sqlite'),{readOnly:true});try{return Object.fromEntries(['records','workspace_revision','local_accounts','local_meta','transaction_guards','sqlite_master'].map(table=>[table,db.prepare('SELECT * FROM '+table+' ORDER BY 1').all()]));}finally{db.close();}}
async function freePort(){const server=net.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;await new Promise(r=>server.close(r));assert.notEqual(port,8787);return port;}
const baseEnv={...process.env,DOON_BUILD_DIR:buildDir,DOON_DATA_DIR:dataDir,DOON_HOST:'127.0.0.1',DOON_SERVER_MODE:'',DOON_PORT:String(await freePort()),DOON_REVIEW_MODE:'1',DOON_REVIEW_AS_OF:at,DOON_TLS_CERT:'',DOON_TLS_KEY:''};
// Do not suppress auto-backup through its normal option: review mode must disable it itself.
delete baseEnv.DOON_NO_AUTO_BACKUP;
let checks=0;const pass=name=>{checks++;console.log('PASS '+name);};
async function start(env){
 const child=spawn(process.execPath,[path.join(buildDir,'server.mjs')],{env,stdio:'pipe',windowsHide:true});let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
 const origin='http://127.0.0.1:'+env.DOON_PORT;
 for(let i=0;i<100;i++){if(child.exitCode!==null)throw new Error('Synthetic server startup failed: '+logs);try{if((await fetch(origin+'/health')).ok)return {child,origin};}catch{}await new Promise(r=>setTimeout(r,50));}
 child.kill();throw new Error('Synthetic server did not become ready.');
}
async function stop(child){if(child.exitCode!==null)return;const closed=once(child,'exit');child.kill();await closed;}
async function request(origin,route,body,cookie='',extra={}){return fetch(origin+route,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{Origin:origin,'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{}),...extra},body:body===undefined?undefined:JSON.stringify(body)});}
async function signIn(origin,username){const response=await request(origin,'/api/auth/login',{username,password});assert.equal(response.status,200);return {cookie:response.headers.get('set-cookie').split(';')[0],data:await response.json()};}

for(const config of [{DOON_HOST:'0.0.0.0'},{DOON_HOST:'192.168.1.2'},{DOON_PORT:'8787'},{DOON_PORT:'0'},{DOON_DATA_DIR:''}]){
 const missing=path.join(testRoot,'must-not-initialize-'+checks),env={...baseEnv,DOON_DATA_DIR:missing,...config};
 const child=spawn(process.execPath,[path.join(buildDir,'server.mjs')],{env,stdio:'pipe',windowsHide:true});child.stdout.resume();child.stderr.resume();const [code]=await once(child,'exit');assert.notEqual(code,0);assert.equal(await fs.stat(missing).then(()=>true,()=>false),false);checks++;
}
console.log('PASS unsafe listener or missing explicit snapshot is rejected before database initialization (5 cases)');
await seed(dataDir);const before=snapshot(dataDir),originalBytes=await fs.readFile(path.join(dataDir,'files','synthetic-original'));
const {child,origin}=await start(baseEnv);
try{
 const mode=await request(origin,'/api/review-mode');assert.deepEqual(await mode.json(),{readOnly:true,asOf:at});pass('review metadata is public, read-only and contains no private path');
 const inherited=await request(origin,'/api/auth/session',undefined,'doon_session='+productionToken);assert.equal((await inherited.json()).user,null);pass('review session cannot reuse the copied production cookie');
 assert.equal((await request(origin,'/api/workspace/enroll',{})).status,401);
 const signed=await signIn(origin,'admin');assert.match(signed.cookie,/^doon_review_session=/);const cookie=signed.cookie;
 assert.equal((await (await request(origin,'/api/auth/session',undefined,cookie)).json()).user.username,'admin');
 assert.equal((await request(origin,'/api/workspace/data',undefined,cookie)).status,200);
 assert.equal((await request(origin,'/api/auth/maintenance',undefined,cookie)).status,200);
 assert.equal((await request(origin,'/api/auth/accounts',undefined,cookie)).status,200);pass('existing login, session, authorized workspace reads and account maintenance reads work');
 const enrolled=await request(origin,'/api/workspace/enroll',{},cookie);assert.equal(enrolled.status,200);assert.deepEqual(await enrolled.json(),{ok:true,readOnly:true});pass('recognized enrollment returns success without calling the workspace enroll API');
 for(const route of ['/api/auth/password','/api/auth/reset','/api/auth/accounts','/api/auth/backup','/api/workspace/customer-save','/api/workspace/unified-communication-save','/api/workspace/unified-communication-complete-review','/api/workspace/member','/api/workspace/attachment','/api/workspace/export','/api/workspace/not-a-real-action','/api/review-mode','/health']){
  const response=await request(origin,route,{},cookie);assert.equal(response.status,403,route);assert.match((await response.json()).error,/验收副本只读/);
 }
 assert.equal((await request(origin,'/api/auth/backup',undefined,cookie)).status,403);pass('all write routes and backup operations are rejected before parsing or dispatch');
 const guard=await request(origin,'/api/workspace/review-guard-probe',undefined,cookie);assert.deepEqual((await guard.json()).checks,[true,true,true,true,true,true]);pass('database and object guards also reject accidental writes from a GET handler');
 const viewer=await signIn(origin,'viewer');assert.equal((await request(origin,'/api/auth/accounts',undefined,viewer.cookie)).status,403);assert.equal((await (await request(origin,'/api/workspace/data',undefined,viewer.cookie)).json()).orders.length,0);pass('read-only review does not expand existing member permissions');
 const initial=await signIn(origin,'initial');assert.equal(initial.data.user.mustChange,true);assert.equal((await request(origin,'/api/workspace/data',undefined,initial.cookie)).status,403);assert.equal((await request(origin,'/api/auth/password',{},initial.cookie)).status,403);pass('initial-password flags remain intact and cannot be changed in review');
 assert.deepEqual(snapshot(dataDir),before);assert.deepEqual(await fs.readFile(path.join(dataDir,'files','synthetic-original')),originalBytes);assert.equal(await fs.stat(path.join(dataDir,'backups')).then(()=>true,()=>false),false);assert.deepEqual(await fs.readdir(path.join(dataDir,'files')),['synthetic-original']);pass('records, revision, schema, accounts, metadata and original attachments remain unchanged; no automatic backup runs');
 for(const c of [cookie,viewer.cookie,initial.cookie])assert.equal((await request(origin,'/api/auth/logout',{},c)).status,200);
 assert.equal((await (await request(origin,'/api/auth/session',undefined,cookie)).json()).user,null);
 const verify=new DatabaseSync(path.join(dataDir,'workspace.sqlite'),{readOnly:true});assert.equal(verify.prepare('SELECT COUNT(*) n FROM local_sessions').get().n,1);assert.equal(verify.prepare('SELECT token_hash FROM local_sessions').get().token_hash,productionDigest);verify.close();pass('logout only clears review sessions and preserves the pre-existing production session');
}finally{await stop(child);}
const normalData=path.join(testRoot,'normal-data');await seed(normalData);
const normal=await start({...baseEnv,DOON_DATA_DIR:normalData,DOON_PORT:String(await freePort()),DOON_REVIEW_MODE:'',DOON_NO_AUTO_BACKUP:'1'});
try{
 assert.deepEqual(await (await request(normal.origin,'/api/review-mode')).json(),{readOnly:false,asOf:null});
 const signed=await signIn(normal.origin,'admin');assert.match(signed.cookie,/^doon_session=/);
 const changed=await request(normal.origin,'/api/auth/password',{currentPassword:password,password:'Synthetic-New-Password-2026!'},signed.cookie);assert.equal(changed.status,200);assert.notDeepEqual(snapshot(normalData).local_accounts,before.local_accounts);pass('normal mode retains the original cookie and permits its authorized write behavior');
}finally{await stop(normal.child);}
await fs.writeFile(path.join(testRoot,'results.json'),JSON.stringify({checks,at:new Date().toISOString(),syntheticOnly:true,productionAccess:false},null,2));
console.log('Review mode checks passed: '+checks);
