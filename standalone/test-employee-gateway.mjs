import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import {spawn,execFileSync} from 'node:child_process';
import {employeeGatewayConfig,employeeEndpoint} from './employee-gateway.mjs';
const origin='https://employee.test',headers={host:'employee.test','x-forwarded-host':'employee.test','x-forwarded-proto':'https','x-forwarded-for':'198.51.100.9'};
const config=employeeGatewayConfig({DOON_EMPLOYEE_PUBLIC_ORIGIN:origin});
assert.equal(employeeGatewayConfig({}),null);assert.equal(config.host,'127.0.0.1');
for(const value of ['http://employee.test','https://user:pass@employee.test','https://employee.test/path','https://employee.test?x=1'])assert.throws(()=>employeeGatewayConfig({DOON_EMPLOYEE_PUBLIC_ORIGIN:value}));
for(const values of [{DOON_HOST:'0.0.0.0'},{DOON_PORT:'0'},{DOON_TLS_CERT:'cert'},{DOON_SERVER_MODE:'supplier'}])assert.throws(()=>employeeGatewayConfig({DOON_EMPLOYEE_PUBLIC_ORIGIN:origin,...values}));
assert.deepEqual(employeeEndpoint(config,'127.0.0.1',headers),{origin,ip:'198.51.100.9'});
assert.throws(()=>employeeEndpoint(config,'198.51.100.1',headers));
for(const changed of [{host:'attacker.test'},{'x-forwarded-host':'attacker.test'},{'x-forwarded-proto':'http'},{'x-forwarded-for':'198.51.100.9, 127.0.0.1'},{'x-forwarded-for':''},{forwarded:'for=127.0.0.1'}])assert.throws(()=>employeeEndpoint(config,'127.0.0.1',{...headers,...changed}));
console.log('PASS gateway requires loopback, exact HTTPS origin and one valid forwarded client IP');
await fs.mkdir('test-output',{recursive:true});const dir=await fs.mkdtemp(path.resolve('test-output/employee-test-')),build=path.join(dir,'build');await fs.mkdir(build,{recursive:true});await fs.mkdir(path.join(build,'client'));
for(const file of ['runtime.mjs','auth.mjs','server.mjs','supplier-gateway.mjs','employee-gateway.mjs'])await fs.copyFile(path.join('standalone',file),path.join(build,file));
await fs.writeFile(path.join(build,'client','index.html'),'<html>synthetic employee test</html>');
await fs.writeFile(path.join(build,'workspace-api.mjs'),`export async function GET(){return Response.json({ok:true});}export async function POST(){return Response.json({ok:true});}`);
await fs.writeFile(path.join(build,'seed.mjs'),`import {db,saveRecords} from './runtime.mjs';import {createAccount} from './auth.mjs';const a=await createAccount({username:'admin',name:'Synthetic Admin',role:'admin',password:'Synthetic-Employee-2026!'},null,{owner:true});db.prepare('UPDATE local_accounts SET must_change=0').run();saveRecords([{id:'synthetic_supplier',kind:'supplier',name:'Synthetic Supplier',active:true}]);await createAccount({username:'supplier',name:'Synthetic Supplier',role:'supplier',supplierId:'synthetic_supplier',password:'Synthetic-Supplier-2026!'},null);db.close();`);
const env={...process.env,DOON_DATA_DIR:path.join(dir,'data'),DOON_HOST:'127.0.0.1',DOON_NO_AUTO_BACKUP:'1',DOON_SERVER_MODE:'internal',DOON_REVIEW_MODE:'0',DOON_TLS_CERT:'',DOON_TLS_KEY:'',DOON_SYNTHETIC_ONLY:'1'};delete env.DOON_EMPLOYEE_PUBLIC_ORIGIN;
execFileSync(process.execPath,[path.join(build,'seed.mjs')],{env,stdio:'pipe'});
const port=await new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const child=spawn(process.execPath,[path.join(build,'server.mjs')],{env:{...env,DOON_PORT:String(port),DOON_EMPLOYEE_PUBLIC_ORIGIN:origin},windowsHide:true,stdio:'ignore'});
const exited=new Promise(resolve=>child.once('exit',resolve));
function request(route,body,extra={}){return new Promise((resolve,reject)=>{const req=http.request(`http://127.0.0.1:${port}${route}`,{method:body===undefined?'GET':'POST',headers:{...headers,...(body===undefined?{}:{Origin:origin,'Content-Type':'application/json'}),...extra}},res=>{const bytes=[];res.on('data',b=>bytes.push(b));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(bytes).toString()}));});req.on('error',reject);if(body!==undefined)req.write(JSON.stringify(body));req.end();});}
try{
 let ready=false;for(let i=0;i<80;i++){try{if((await request('/health')).status===200){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert(ready);
 assert.equal((await request('/health',undefined,{'x-forwarded-proto':'http'})).status,403);
 assert.equal((await request('/api/workspace/data')).status,401);
 assert.equal((await request('/api/auth/login',{username:'admin',password:'Synthetic-Employee-2026!'},{Origin:'https://attacker.test'})).status,403);
 assert.equal((await request('/api/auth/login',{username:'supplier',password:'Synthetic-Supplier-2026!'})).status,401);
 const signed=await request('/api/auth/login',{username:'admin',password:'Synthetic-Employee-2026!'});assert.equal(signed.status,200);const cookie=signed.headers['set-cookie'][0];assert.match(cookie,/^doon_employee_session=.*HttpOnly; SameSite=Strict.*Secure/);const token=cookie.split(';')[0];
 assert.equal((await request('/api/workspace/data',undefined,{Cookie:token})).status,200);
 const loginHistory=await request('/api/auth/history',undefined,{Cookie:token});assert.equal(loginHistory.status,200);
 const events=JSON.parse(loginHistory.body).events;assert(events.some(e=>e.username==='admin'&&e.event==='login_success'&&e.ip==='198.51.100.9'&&e.source==='员工 HTTPS 入口'));
 assert(events.some(e=>e.username==='supplier'&&e.event==='login_failure'&&e.actor==='未认证访问者'));
 assert.equal(JSON.parse((await request('/api/auth/session',undefined,{Cookie:token.replace('doon_employee_session','doon_session')})).body).user,null);
 assert.equal(JSON.parse((await request('/api/review-mode')).body).syntheticOnly,true);
 // Separate clients behind the same proxy must not share login throttling buckets.
 for(let i=0;i<61;i++)await request('/api/auth/session',undefined,{'x-forwarded-for':'198.51.100.20'});
 assert.equal((await request('/api/auth/session',undefined,{'x-forwarded-for':'198.51.100.20'})).status,429);
 assert.equal((await request('/api/auth/session',undefined,{'x-forwarded-for':'198.51.100.21'})).status,200);
 console.log('PASS secure employee login, supplier exclusion, CSRF, cookie namespace, client throttling and synthetic mode');
}finally{child.kill('SIGTERM');await exited;}
