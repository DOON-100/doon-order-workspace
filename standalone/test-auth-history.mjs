// Every account, database and listener in this test is synthetic and isolated.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {spawn,execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';

await fs.mkdir('test-output',{recursive:true});
const root=await fs.mkdtemp(path.resolve('test-output/auth-history-')),build=path.join(root,'build'),data=path.join(root,'data');
await fs.mkdir(path.join(build,'client'),{recursive:true});
for(const name of ['runtime.mjs','auth.mjs','personnel.mjs','server.mjs','employee-gateway.mjs','supplier-gateway.mjs'])await fs.copyFile(path.join('standalone',name),path.join(build,name));
await fs.writeFile(path.join(build,'client','index.html'),'<html>Synthetic authentication test</html>');
await fs.writeFile(path.join(build,'workspace-api.mjs'),`export async function GET(){return Response.json({ok:true});}export async function POST(){return Response.json({ok:true});}`);
const password='Synthetic-Auth-History-2026!';
await fs.writeFile(path.join(build,'seed.mjs'),`import {db,saveRecords} from './runtime.mjs';import {createAccount} from './auth.mjs';
saveRecords([{id:'synthetic-order',kind:'order',quantity:17},{id:'synthetic-supplier',kind:'supplier',active:true,name:'Synthetic Supplier'}]);
for(const [username,role] of [['admin','admin'],['alice','sales'],['locked','viewer'],['supplier','supplier']])await createAccount({username,name:'Synthetic '+username,role,password:${JSON.stringify(password)},supplierId:role==='supplier'?'synthetic-supplier':undefined},null);
db.prepare('UPDATE local_accounts SET must_change=0').run();db.close();`);
const env={...process.env,DOON_DATA_DIR:data,DOON_HOST:'127.0.0.1',DOON_NO_AUTO_BACKUP:'1',DOON_EMPLOYEE_PUBLIC_ORIGIN:'',DOON_SERVER_MODE:'internal',DOON_REVIEW_MODE:'0',DOON_SYNTHETIC_ONLY:'1',DOON_TLS_CERT:'',DOON_TLS_KEY:''};
execFileSync(process.execPath,[path.join(build,'seed.mjs')],{env,stdio:'pipe',windowsHide:true});
const db=new DatabaseSync(path.join(data,'workspace.sqlite'));
const original=db.prepare('SELECT id,kind,data FROM records ORDER BY id').all(),accounts=db.prepare('SELECT * FROM local_accounts ORDER BY id').all();
const children=[];
async function launch(review=false){
 const port=await new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
 const origin='http://127.0.0.1:'+port;
 const child=spawn(process.execPath,[path.join(build,'server.mjs')],{env:{...env,DOON_PORT:String(port),DOON_REVIEW_MODE:review?'1':'0'},windowsHide:true,stdio:'ignore'}),exited=new Promise(resolve=>child.once('exit',resolve));children.push({child,exited});
 for(let i=0;i<80;i++){try{if((await fetch(origin+'/health')).ok)return origin;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('Synthetic server did not start');
}
async function request(origin,route,body,cookie='',extra={}){return fetch(origin+route,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{Origin:origin,'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{}),...extra},body:body===undefined?undefined:JSON.stringify(body)});}
const cookieOf=response=>response.headers.get('set-cookie').split(';')[0];
const stored=()=>db.prepare("SELECT data FROM records WHERE kind='auth_event' ORDER BY rowid").all().map(r=>JSON.parse(r.data));
try{
 const origin=await launch();
 assert.equal((await request(origin,'/api/auth/history')).status,401);
 let signed=await request(origin,'/api/auth/login',{username:'admin',password});assert.equal(signed.status,200);let admin=cookieOf(signed);
 signed=await request(origin,'/api/auth/login',{username:' ALICE ',password},'',{'X-Forwarded-For':'203.0.113.99'});assert.equal(signed.status,200);const alice=cookieOf(signed);
 assert.equal((await request(origin,'/api/auth/history',undefined,alice)).status,403);
 assert.equal((await request(origin,'/api/auth/history?username=alice',undefined,admin)).status,200);
 assert.equal((await request(origin,'/api/auth/login',{username:'alice',password:'Synthetic-Wrong-Password!'})).status,401);
 assert.equal((await request(origin,'/api/auth/login',{username:'unknown',password:'Synthetic-Unknown-Password!'})).status,401);
 assert.equal((await request(origin,'/api/auth/login',{username:'alice',password:'x'.repeat(129)})).status,401);
 const beforeCsrf=stored().length;
 assert.equal((await request(origin,'/api/auth/login',{username:'alice',password},'',{Origin:'https://attacker.test'})).status,403);assert.equal(stored().length,beforeCsrf);
 assert.equal((await request(origin,'/api/auth/logout',{},alice)).status,200);
 const beforeAnonymous=stored().length;assert.equal((await request(origin,'/api/auth/logout',{})).status,200);assert.equal(stored().length,beforeAnonymous);
 const history=await (await request(origin,'/api/auth/history?username=alice',undefined,admin)).json();
 assert.deepEqual(history.events.map(e=>e.event),['logout','login_failure','login_failure','login_success']);
 assert(history.events.every(e=>e.username==='alice'&&e.ip==='127.0.0.1'));
 assert(history.events.filter(e=>e.event==='login_failure').every(e=>e.actor==='未认证访问者'));
 assert(stored().filter(e=>e.event==='login_failure').every(e=>e.actorId===''));
 console.log('PASS Login success, failure and explicit logout are persisted; failures are not attributed to an authenticated member and local spoofed forwarding headers are ignored.');
 const first=await (await request(origin,'/api/auth/history?username=alice&limit=2',undefined,admin)).json();assert.equal(first.events.length,2);assert(first.nextBefore);
 const second=await (await request(origin,'/api/auth/history?username=alice&limit=2&before='+first.nextBefore,undefined,admin)).json();assert.equal(second.events.length,2);assert.equal(second.nextBefore,null);assert.equal(new Set([...first.events,...second.events].map(e=>e.id)).size,4);
 for(const query of ['limit=0','limit=201','limit=1.5','before=0','before=abc','username=%27%20OR%201%3D1'])assert.equal((await request(origin,'/api/auth/history?'+query,undefined,admin)).status,400);
 signed=await request(origin,'/api/auth/login',{username:'supplier',password});const supplier=cookieOf(signed);assert.equal((await request(origin,'/api/auth/history',undefined,supplier)).status,403);
 console.log('PASS History is administrator-only, filtered by exact account, validated and paginated without duplicates.');
 for(let i=0;i<8;i++)assert.equal((await request(origin,'/api/auth/login',{username:'locked',password:'Synthetic-Wrong-Password!'})).status,401);
 assert.equal((await request(origin,'/api/auth/login',{username:'locked',password})).status,429);assert.equal(stored().at(-1).reason,'rate_limited');
 const historyText=JSON.stringify(stored());for(const secret of [password,'Synthetic-Wrong-Password!','Synthetic-Unknown-Password!',...accounts.map(a=>a.password_hash),...db.prepare('SELECT token_hash FROM local_sessions').all().map(s=>s.token_hash)])assert(!historyText.includes(secret));
 assert(!/password_hash|token_hash|cookie|session_token/i.test(historyText));
 console.log('PASS Rate-limited attempts are recorded and events contain no passwords, password hashes or session credentials.');
 const sessionCount=db.prepare('SELECT count(*) n FROM local_sessions').get().n,eventCount=stored().length;
 db.exec("CREATE TRIGGER synthetic_auth_failure BEFORE INSERT ON records WHEN NEW.kind='auth_event' AND json_extract(NEW.data,'$.event')='login_success' BEGIN SELECT RAISE(ABORT,'synthetic_auth_failure'); END");
 const rejected=await request(origin,'/api/auth/login',{username:'alice',password});assert.equal(rejected.status,500);assert.equal(rejected.headers.get('set-cookie'),null);assert.equal(db.prepare('SELECT count(*) n FROM local_sessions').get().n,sessionCount);assert.equal(stored().length,eventCount);db.exec('DROP TRIGGER synthetic_auth_failure');
 console.log('PASS Session issuance rolls back if the matching successful-login history cannot be saved.');
 const beforeReview=db.prepare('SELECT id,kind,data FROM records ORDER BY id').all(),reviewOrigin=await launch(true);
 signed=await request(reviewOrigin,'/api/auth/login',{username:'admin',password});assert.equal(signed.status,200);const reviewCookie=cookieOf(signed);
 assert.equal((await request(reviewOrigin,'/api/auth/history',undefined,reviewCookie)).status,200);
 assert.equal((await request(reviewOrigin,'/api/auth/login',{username:'alice',password:'Synthetic-Wrong-Password!'})).status,401);
 assert.equal((await request(reviewOrigin,'/api/auth/logout',{},reviewCookie)).status,200);
 assert.deepEqual(db.prepare('SELECT id,kind,data FROM records ORDER BY id').all(),beforeReview);
 assert.deepEqual(db.prepare('SELECT id,kind,data FROM records WHERE kind<>? ORDER BY id').all('auth_event'),original);
 assert.deepEqual(db.prepare('SELECT * FROM local_accounts ORDER BY id').all(),accounts);
 console.log('PASS Read-only review login/logout creates no history writes; all preexisting business records and account credentials remain unchanged.');
 console.log(JSON.stringify({passed:6,root}));
}finally{for(const {child} of children)child.kill('SIGTERM');await Promise.all(children.map(c=>c.exited));db.close();}
