import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import {spawn,execFileSync} from 'node:child_process';
import {supplierGatewayConfig,supplierEndpoint} from './supplier-gateway.mjs';

const dir=await fs.mkdtemp(path.resolve('test-output/supplier-gateway-'));
const build=path.join(dir,'build'),dataDir=path.join(dir,'data'),publicOrigin='https://supplier.test';
await fs.mkdir(build,{recursive:true});await fs.mkdir(path.join(build,'client','assets'),{recursive:true});
for(const file of ['runtime.mjs','auth.mjs','server.mjs','supplier-gateway.mjs'])await fs.copyFile(path.resolve('standalone',file),path.join(build,file));
await fs.writeFile(path.join(build,'client','index.html'),'<html><body>synthetic supplier portal</body></html>');
await fs.writeFile(path.join(build,'client','assets','test.js'),'/* synthetic asset */');
// Transport tests use a deliberately tiny synthetic API; business ACL and attachment
// namespaces are verified separately by the finished-supplier API test suite.
await fs.writeFile(path.join(build,'workspace-api.mjs'),`import {context,db,saveRecords} from './runtime.mjs';
export async function GET(req,ctx){const {action}=await ctx.params;const current=context.getStore();if(action==='data'||action==='finished-supplier-data')return Response.json({role:current.member.role,supplierId:current.member.supplierId||null});return Response.json({error:'synthetic handler not found'}, {status:404});}
export async function POST(req,ctx){const {action}=await ctx.params;const body=await req.json();if(action==='member'||action==='supplier-save'){const row=db.prepare('SELECT data FROM records WHERE id=?').get(body.id);if(!row)return Response.json({error:'missing'}, {status:404});saveRecords([{...JSON.parse(row.data),active:body.active}]);return Response.json({ok:true});}return Response.json({error:'synthetic handler not found'}, {status:404});}
`);
await fs.writeFile(path.join(build,'seed.mjs'),`import {db,saveRecords,memberFor} from './runtime.mjs';import {createAccount} from './auth.mjs';
saveRecords([{id:'supplier_alpha',kind:'supplier',name:'Synthetic Alpha',active:true},{id:'supplier_inactive',kind:'supplier',name:'Synthetic Inactive',active:false}]);
const admin=await createAccount({username:'admin',name:'Synthetic Admin',role:'admin',password:'Synthetic-Admin-2026!'},null,{owner:true});db.prepare('UPDATE local_accounts SET must_change=0 WHERE member_id=?').run(admin.memberId);console.log(JSON.stringify(admin));db.close();`);
const baseEnv={...process.env,DOON_DATA_DIR:dataDir,DOON_NO_AUTO_BACKUP:'1'};
delete baseEnv.DOON_TLS_CERT;delete baseEnv.DOON_TLS_KEY;delete baseEnv.DOON_SERVER_MODE;delete baseEnv.DOON_SUPPLIER_PUBLIC_ORIGIN;
const seeded=JSON.parse(execFileSync(process.execPath,[path.join(build,'seed.mjs')],{env:baseEnv,encoding:'utf8',stdio:['ignore','pipe','pipe']}));
async function freePort(){return new Promise((resolve,reject)=>{const server=net.createServer();server.on('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});}
const internalPort=await freePort(),publicPort=await freePort(),internalOrigin=`http://127.0.0.1:${internalPort}`,publicSocket=`http://127.0.0.1:${publicPort}`;
const children=[];let logs='';const checks=[];function pass(label){checks.push(label);console.log('PASS '+label);}
function launch(env){const child=spawn(process.execPath,[path.join(build,'server.mjs')],{env:{...baseEnv,...env},windowsHide:true,stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);children.push(child);return child;}
async function request(publicMode,route,body,cookie='',extra={},method=body===undefined?'GET':'POST'){return new Promise((resolve,reject)=>{const req=http.request((publicMode?publicSocket:internalOrigin)+route,{method,headers:{...(publicMode?{Host:'supplier.test','X-Forwarded-Proto':'https','X-Forwarded-Host':'supplier.test','X-Forwarded-For':'198.51.100.10'}:{}),...(body===undefined?{}:{Origin:publicMode?publicOrigin:internalOrigin,'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{}),...extra}},res=>{const parts=[];res.on('data',part=>parts.push(part));res.on('end',()=>{const headers=new Headers();for(const [name,value] of Object.entries(res.headers))if(value!==undefined)for(const item of Array.isArray(value)?value:[value])headers.append(name,item);resolve(new Response(Buffer.concat(parts),{status:res.statusCode,headers}));});});req.on('error',reject);if(body!==undefined)req.write(JSON.stringify(body));req.end();});}
async function ok(publicMode,route,body,cookie='',extra={}){const res=await request(publicMode,route,body,cookie,extra),value=await res.json();assert.equal(res.status,200,JSON.stringify(value));return {res,value};}
function cookieOf(res){return res.headers.get('set-cookie').split(';')[0];}
async function ready(publicMode){let last='';for(let i=0;i<60;i++){try{const response=await request(publicMode,'/health');if(response.ok)return;last=response.status+' '+await response.text();}catch(e){last=e.message;}await new Promise(resolve=>setTimeout(resolve,100));}throw new Error('Synthetic gateway did not start: '+last+' '+logs);}

try{
 const config=supplierGatewayConfig({DOON_SUPPLIER_PUBLIC_ORIGIN:publicOrigin});
 assert.equal(config.host,'127.0.0.1');assert.equal(config.port,8788);
 for(const origin of ['', 'http://supplier.test','https://user:password@supplier.test','https://supplier.test/path','https://supplier.test?x=1'])assert.throws(()=>supplierGatewayConfig({DOON_SUPPLIER_PUBLIC_ORIGIN:origin}));
 assert.throws(()=>supplierGatewayConfig({DOON_SUPPLIER_PUBLIC_ORIGIN:publicOrigin,DOON_HOST:'0.0.0.0'}));
 assert.throws(()=>supplierEndpoint(config,'203.0.113.20',{host:'supplier.test','x-forwarded-proto':'https'}));
 pass('HTTPS origin is required and untrusted network peers cannot spoof the local proxy');
 launch({DOON_HOST:'127.0.0.1',DOON_PORT:String(internalPort)});
 launch({DOON_SERVER_MODE:'supplier',DOON_HOST:'127.0.0.1',DOON_PORT:String(publicPort),DOON_SUPPLIER_PUBLIC_ORIGIN:publicOrigin});
 await ready(false);await ready(true);
 for(const method of ['GET','HEAD'])for(const route of ['/','/login','/index.html']){const response=await request(true,route,undefined,'',{},method);assert.equal(response.status,302);assert.equal(response.headers.get('location'),'/supplier-portal');assert.equal(await response.text(),'');}
 assert.equal((await request(true,'/',undefined,'',{Host:'attacker.test'})).status,403);
 assert.equal((await request(true,'/health')).status,200);assert.equal((await request(true,'/api/auth/session')).status,200);assert.equal((await request(false,'/login')).status,200);
 pass('Public GET/HEAD entry aliases redirect to the supplier portal only after gateway validation; health/API and internal login remain unchanged');
 assert.equal((await request(true,'/health',undefined,'',{Host:'attacker.test'})).status,403);
 assert.equal((await request(true,'/health',undefined,'',{'X-Forwarded-Host':'attacker.test'})).status,403);
 assert.equal((await request(true,'/health',undefined,'',{'X-Forwarded-Proto':'http'})).status,403);
 assert.equal((await request(true,'/health',undefined,'',{'X-Forwarded-Proto':'https,http'})).status,403);
 assert.equal((await request(true,'/health',undefined,'',{Forwarded:'proto=https;host=supplier.test'})).status,403);
 assert.equal((await request(true,'/health',undefined,'',{'X-Forwarded-For':'198.51.100.1,203.0.113.1'})).status,403);
 assert.equal((await request(false,'/health',undefined,'',{Host:'supplier.test','X-Forwarded-Proto':'https'})).status,403);
 pass('Host, proxy protocol and forwarding headers are exact; internal host protection remains enabled');
 const admin=await ok(false,'/api/auth/login',{username:'admin',password:'Synthetic-Admin-2026!'}),adminCookie=cookieOf(admin.res);
 assert.match(admin.res.headers.get('set-cookie'),/^doon_session=/);assert.equal(admin.value.user.role,'admin');
 assert.equal((await request(true,'/api/auth/login',{username:'admin',password:'Synthetic-Admin-2026!'})).status,401);
 assert.equal((await request(true,'/api/auth/login',{username:'admin',password:'Synthetic-Admin-2026!'},'',{Origin:'https://attacker.test'})).status,403);
 assert.equal((await request(true,'/api/auth/session',undefined,adminCookie)).status,200);
 assert.equal((await ok(true,'/api/auth/session',undefined,adminCookie)).value.user,null);
 pass('Public login refuses employees and cross-site requests; internal identity cannot become a supplier session');
 for(const supplierId of ['missing','supplier_inactive'])assert.equal((await request(false,'/api/auth/accounts',{username:'bad'+supplierId.replace('_',''),name:'Synthetic Invalid',password:'Synthetic-Supplier-2026!',role:'supplier',supplierId},adminCookie)).status,400);
 const created=await ok(false,'/api/auth/accounts',{username:'alpha',name:'Synthetic Supplier',password:'Synthetic-Supplier-2026!',role:'supplier',supplierId:'supplier_alpha',orderScope:'all',customers:['SHOULD-BE-REMOVED'],departments:['finished']},adminCookie);
 await fs.writeFile(path.join(build,'inspect-member.mjs'),`import {db} from './runtime.mjs';const row=db.prepare("SELECT data FROM records WHERE id=? AND kind='member'").get(process.argv[2]);const {role,supplierId,orderScope,customers,departments}=JSON.parse(row.data);console.log(JSON.stringify({role,supplierId,orderScope,customers,departments}));db.close();`);
 const member=JSON.parse(execFileSync(process.execPath,[path.join(build,'inspect-member.mjs'),created.value.memberId],{env:baseEnv,encoding:'utf8',stdio:['ignore','pipe','pipe']}));
 assert.deepEqual(member,{role:'supplier',supplierId:'supplier_alpha',orderScope:'assigned',customers:[],departments:[]});
 pass('Supplier accounts require an active master and cannot inherit internal customer, department or all-order scope');
 const signed=await ok(true,'/api/auth/login',{username:'alpha',password:'Synthetic-Supplier-2026!'});let publicCookie=cookieOf(signed.res);
 assert.equal(signed.value.user.role,'supplier');assert.equal(signed.value.user.supplierId,'supplier_alpha');assert(signed.value.user.mustChange);
 assert.match(signed.res.headers.get('set-cookie'),/^doon_supplier_session=.*HttpOnly; SameSite=Strict.*Secure/);
 assert.equal((await request(true,'/api/workspace/finished-supplier-data',undefined,publicCookie)).status,403);
 const changed=await ok(true,'/api/auth/password',{currentPassword:'Synthetic-Supplier-2026!',password:'Synthetic-Supplier-Personal!'},publicCookie);const previousCookie=publicCookie;publicCookie=cookieOf(changed.res);
 assert.equal((await ok(true,'/api/auth/session',undefined,previousCookie)).value.user,null);
 assert.equal((await ok(true,'/api/auth/session',undefined,publicCookie)).value.user.mustChange,false);
 assert.equal((await ok(true,'/api/workspace/finished-supplier-data',undefined,publicCookie)).value.supplierId,'supplier_alpha');
 assert.equal((await ok(false,'/api/auth/session',undefined,publicCookie.replace('doon_supplier_session','doon_session'))).value.user,null);
 assert.equal((await ok(true,'/api/auth/session',undefined,adminCookie.replace('doon_session','doon_supplier_session'))).value.user,null);
 pass('Public cookie is Secure and namespaced; first-password change rotates sessions and swapped cookie names fail');
 const localSigned=await ok(false,'/api/auth/login',{username:'alpha',password:'Synthetic-Supplier-Personal!'}),localCookie=cookieOf(localSigned.res);
 for(const action of ['data','file','template','backup','enroll','member','ledger-edit','finished-supplier-admin-data']){
  assert.equal((await request(true,'/api/workspace/'+action,undefined,publicCookie)).status,403,action+' public GET');
  if(action!=='finished-supplier-admin-data')assert.equal((await request(false,'/api/workspace/'+action,{},localCookie)).status,403,action+' internal POST');
 }
 for(const action of ['accounts','maintenance','backup','reset']){assert.equal((await request(true,'/api/auth/'+action,undefined,publicCookie)).status,403);assert.equal((await request(false,'/api/auth/'+action,undefined,localCookie)).status,403);}
 assert.equal((await request(true,'/finished-outsourcing')).status,403);assert.equal((await request(true,'/members')).status,403);assert.equal((await request(true,'/lan-data/workspace.sqlite')).status,403);
 assert.equal((await request(true,'/supplier-portal')).status,200);assert.equal((await request(true,'/assets/test.js')).status,200);
 pass('Both listeners reject supplier access to internal auth/API; public static pages are narrowly scoped');
 await ok(false,'/api/workspace/member',{id:created.value.memberId,active:false},adminCookie);
 assert.equal((await ok(true,'/api/auth/session',undefined,publicCookie)).value.user,null);
 await ok(false,'/api/workspace/member',{id:created.value.memberId,active:true},adminCookie);
 assert.equal((await ok(true,'/api/auth/session',undefined,publicCookie)).value.user,null);
 assert.equal((await ok(false,'/api/auth/session',undefined,localCookie)).value.user,null);
 let resumed=await ok(true,'/api/auth/login',{username:'alpha',password:'Synthetic-Supplier-Personal!'});publicCookie=cookieOf(resumed.res);
 await ok(false,'/api/workspace/supplier-save',{id:'supplier_alpha',active:false},adminCookie);
 assert.equal((await ok(true,'/api/auth/session',undefined,publicCookie)).value.user,null);
 assert.equal((await request(true,'/api/auth/login',{username:'alpha',password:'Synthetic-Supplier-Personal!'})).status,401);
 await ok(false,'/api/workspace/supplier-save',{id:'supplier_alpha',active:true},adminCookie);
 assert.equal((await ok(true,'/api/auth/session',undefined,publicCookie)).value.user,null);
 pass('Disabling an account or supplier revokes sessions permanently even after reactivation');
 const state=JSON.parse(await fs.readFile(path.join(dataDir,'supplier-server-status.json'),'utf8')),internalState=JSON.parse(await fs.readFile(path.join(dataDir,'server-status.json'),'utf8'));
 assert.equal(state.port,publicPort);assert.equal(state.publicOrigin,publicOrigin);assert.equal(internalState.port,internalPort);
 await assert.rejects(fs.stat(path.join(dataDir,'backups')));
 pass('Supplier listener has separate status and never starts a competing database backup');
 const result={passed:checks.length,checks,at:new Date().toISOString()};await fs.writeFile(path.join(dir,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{
 await Promise.all(children.map(child=>new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);child.kill();setTimeout(resolve,3000).unref();})));
}
