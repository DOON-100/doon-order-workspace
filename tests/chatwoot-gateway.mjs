import assert from 'node:assert/strict';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createGateway} from '../integrations/chatwoot/gateway.mjs';

const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve('http://127.0.0.1:'+server.address().port)));
const close=server=>new Promise(resolve=>{server.closeAllConnections?.();server.close(resolve);});
const root=await mkdtemp(path.join(os.tmpdir(),'doon-chatwoot-synthetic-'));
const tokenA='a'.repeat(43),tokenB='b'.repeat(43);
const user=id=>({username:'synthetic-'+id,personnelType:'internal',role:'sales',mustChange:false,identity:{id,name:'Synthetic '+id,email:id+'@test.invalid'}});
const sessions=new Map([[tokenA,user('a')],[tokenB,user('b')]]),users=new Map(),sso=new Map();
let sessionReads=0,upstreamFailed=false,middleFailed=false,publicOrigin,proxied,websocketCount=0;
const middle=http.createServer((req,res)=>{sessionReads++;res.setHeader('Content-Type','application/json');res.statusCode=middleFailed?503:200;res.end(JSON.stringify({user:sessions.get((req.headers.cookie||'').split('=')[1])||null}));});
const app=http.createServer(async(req,res)=>{
 let body='';for await(const chunk of req)body+=chunk;
 const data=body?JSON.parse(body):null;
 res.setHeader('Content-Type','application/json');
 if(upstreamFailed){res.statusCode=503;return res.end('{}');}
 if(req.url.startsWith('/platform/'))assert.equal(req.headers.api_access_token,'synthetic-platform-token');
 if(req.url==='/platform/api/v1/users'&&req.method==='POST'){
  assert.notEqual(data.password,'synthetic-middle-password');
  const existing=[...users.values()].find(u=>u.email===data.email),record=existing||{...data,id:users.size+1};users.set(record.id,record);return res.end(JSON.stringify(record));
 }
 const match=req.url.match(/^\/platform\/api\/v1\/users\/(\d+)(\/login)?$/);
 if(match){const record=users.get(Number(match[1]));if(match[2]){const secret='synthetic-sso-'+record.id;sso.set(secret,record);return res.end(JSON.stringify({url:publicOrigin+'/app/login?email='+encodeURIComponent(record.email)+'&sso_auth_token='+secret}));}Object.assign(record,data);return res.end(JSON.stringify(record));}
 if(req.url==='/platform/api/v1/accounts/17/account_users')return res.end(JSON.stringify(data));
 if(req.url==='/auth/sign_in'){
  const record=sso.get(data.sso_auth_token);sso.delete(data.sso_auth_token);assert.equal(record.email,data.email);
  for(const [name,value] of Object.entries({'access-token':'synthetic-native-'+record.id,client:'synthetic-client',expiry:String(Math.floor(Date.now()/1000)+3600),uid:record.email,'token-type':'Bearer'}))res.setHeader(name,value);
  return res.end(JSON.stringify({data:{id:record.id,pubsub_token:'synthetic-pubsub-'+record.id}}));
 }
 proxied={path:req.url,headers:req.headers};res.end(JSON.stringify({ok:true}));
});
app.on('upgrade',(req,socket)=>{websocketCount++;const accept=createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');socket.on('error',()=>{});socket.on('end',()=>socket.end());});
let gateway,passed=0;
try{
 const middleOrigin=await listen(middle),appOrigin=await listen(app),reserved=http.createServer();publicOrigin=await listen(reserved);await close(reserved);
 const config={publicOrigin,middleSessionUrl:middleOrigin+'/api/auth/session',chatwootOrigin:appOrigin,platformToken:'synthetic-platform-token',bindingKey:'synthetic-binding-key-not-production',accountId:17,stateDir:root,testOnly:true,websocketRecheckMs:25};
 gateway=await createGateway(config);await new Promise(resolve=>gateway.listen(Number(new URL(publicOrigin).port),'127.0.0.1',resolve));
 const request=(url,options={})=>fetch(publicOrigin+url,{redirect:'manual',...options,headers:{Cookie:'doon_session='+tokenA,...options.headers}});
 assert.equal((await request('/chatwoot/enter',{headers:{Cookie:''}})).status,401);passed++;
 sessions.set(tokenA,{...user('a'),personnelType:'external'});assert.equal((await request('/chatwoot/enter')).status,403);passed++;
 sessions.set(tokenA,{...user('a'),mustChange:true});assert.equal((await request('/chatwoot/enter')).status,403);passed++;
 sessions.set(tokenA,user('a'));
 const status=await request('/chatwoot/status');assert.deepEqual(await status.json(),{enabled:true});assert.equal(users.size,0);passed++;
 const enter=await request('/chatwoot/enter');assert.equal(enter.status,302);assert.equal(enter.headers.get('location'),'/app/accounts/17/dashboard');assert.ok(!enter.headers.get('location').includes('token'));assert.equal(await enter.text(),'');passed++;
 const cwCookies=enter.headers.getSetCookie().map(value=>value.split(';')[0]).join('; '),headers={Cookie:'doon_session='+tokenA+'; '+cwCookies};
 const creds=JSON.parse(decodeURIComponent(cwCookies.match(/cw_d_session_info=([^;]+)/)[1]));assert.equal(creds.uid,[...users.values()][0].email);passed++;
 assert.equal((await request('/app/accounts/17/dashboard',{headers})).status,200);assert.ok(!proxied.headers.cookie.includes('doon_session='));assert.ok(!proxied.headers.cookie.includes('doon_chatwoot_binding='));assert.equal(proxied.headers.api_access_token,undefined);passed++;
 assert.equal((await request('/auth/sign_in',{method:'POST',headers:{...headers,Origin:publicOrigin}})).status,403);passed++;
 assert.equal((await request('/auth/password',{method:'POST',headers:{...headers,Origin:publicOrigin}})).status,403);passed++;
 assert.equal((await request('/api/v1/profile',{headers:{...headers,uid:'another@test.invalid'}})).status,403);passed++;
 assert.equal((await request('/api/v1/accounts/18/conversations',{headers})).status,403);passed++;
 assert.equal((await request('/api/v1/accounts/17/conversations',{method:'POST',headers:{...headers,Origin:'https://evil.test.invalid'}})).status,403);passed++;
 assert.equal((await request('/api/v1/profile',{headers:{Cookie:'doon_session='+tokenB+'; '+cwCookies}})).status,401);passed++;
 middleFailed=true;assert.equal((await request('/api/v1/profile',{headers})).status,503);middleFailed=false;passed++;
 const before=sessionReads;assert.equal((await request('/api/v1/profile',{headers})).status,200);assert.equal((await request('/api/v1/profile',{headers})).status,200);assert.equal(sessionReads,before+2);passed++;
 sessions.set(tokenA,{...user('a'),role:'viewer'});assert.equal((await request('/api/v1/profile',{headers})).status,401);sessions.set(tokenA,user('a'));passed++;
 const other=await request('/chatwoot/enter',{headers:{Cookie:'doon_session='+tokenB}});assert.equal(other.status,302);assert.equal(users.size,2);passed++;
 const socket=await new Promise((resolve,reject)=>{const req=http.request(publicOrigin+'/cable?pubsub_token=synthetic-pubsub-1',{headers:{...headers,Origin:publicOrigin,Connection:'Upgrade',Upgrade:'websocket','Sec-WebSocket-Key':Buffer.alloc(16,1).toString('base64'),'Sec-WebSocket-Version':'13'}});req.on('upgrade',(_,value)=>resolve(value));req.on('response',response=>reject(Error('Upgrade rejected '+response.statusCode)));req.on('error',reject);req.end();});
 const disconnected=new Promise(resolve=>socket.on('close',resolve));socket.on('error',()=>{});sessions.delete(tokenA);await Promise.race([disconnected,new Promise((_,reject)=>setTimeout(()=>reject(Error('Revoked websocket stayed connected')),1500).unref())]);assert.equal(websocketCount,1);passed++;
 assert.equal((await request('/api/v1/profile',{headers})).status,401);passed++;
 sessions.set(tokenA,user('a'));await close(gateway);gateway=await createGateway(config);await new Promise(resolve=>gateway.listen(Number(new URL(publicOrigin).port),'127.0.0.1',resolve));assert.equal((await request('/chatwoot/enter')).status,302);assert.equal(users.size,2);assert.equal(Object.keys(JSON.parse(await readFile(path.join(root,'identities.json'),'utf8'))).length,2);passed++;
 upstreamFailed=true;assert.equal((await request('/chatwoot/enter')).status,503);passed++;
 upstreamFailed=false;await close(gateway);gateway=await createGateway({...config,sessionCookieName:'doon_employee_session'});await new Promise(resolve=>gateway.listen(Number(new URL(publicOrigin).port),'127.0.0.1',resolve));
 assert.equal((await request('/chatwoot/enter')).status,401);passed++;
 assert.equal((await request('/chatwoot/enter',{headers:{Cookie:'doon_employee_session='+tokenA}})).status,302);passed++;
 assert.equal((await request('/chatwoot/enter',{headers:{Cookie:'doon_employee_cli_session='+tokenA}})).status,401);passed++;
 console.log('Chatwoot gateway: '+passed+' synthetic checks passed');
}finally{if(gateway)await close(gateway);await close(app);await close(middle);await rm(root,{recursive:true,force:true});}
