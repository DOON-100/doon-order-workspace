import http from 'node:http';
import https from 'node:https';
import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const digest=value=>createHash('sha256').update(value).digest('hex');
const bindingName='doon_chatwoot_binding';
const credentialName='cw_d_session_info';
const fail=(status,message)=>Object.assign(new Error(message),{status});
function cookies(header=''){return Object.fromEntries(header.split(';').map(value=>value.trim().split(/=(.*)/s).slice(0,2)).filter(([key,value])=>key&&value!==undefined));}
const internalUser=user=>user?.identity?.id&&user.identity.name&&user.personnelType==='internal'&&user.role&&user.role!=='supplier'&&!user.mustChange;

export async function createGateway(config){
 const origin=new URL(config.publicOrigin),middle=new URL(config.middleSessionUrl),upstream=new URL(config.chatwootOrigin);
 if(origin.protocol!=='https:'&&!config.testOnly)throw Error('Public origin must use HTTPS');
 if(middle.protocol!=='https:'&&!config.testOnly)throw Error('Middle platform session check must use HTTPS');
 if(!/^[a-z][a-z0-9_]{1,63}$/.test(config.sessionCookieName||'doon_session'))throw Error('Invalid session cookie name');
 if(!config.platformToken||!config.bindingKey||!Number.isSafeInteger(config.accountId)||config.accountId<1)throw Error('Missing private gateway configuration');
 const statePath=path.join(config.stateDir,'identities.json');
 await mkdir(config.stateDir,{recursive:true,mode:0o700});
 let identities={};
 try{identities=JSON.parse(await readFile(statePath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 const sessionCookieName=config.sessionCookieName||'doon_session';
 const inFlight=new Map();
 let serial=Promise.resolve();
 const lock=fn=>{const operation=serial.then(fn);serial=operation.catch(()=>{});return operation;};
 async function persist(){const temp=statePath+'.'+randomBytes(8).toString('hex');await writeFile(temp,JSON.stringify(identities),{mode:0o600,flag:'wx'});await rename(temp,statePath);}
 async function api(endpoint,method='GET',body){
  const response=await fetch(new URL(endpoint,upstream),{method,headers:{api_access_token:config.platformToken,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000),redirect:'error'});
  if(!response.ok)throw fail(503,'Chatwoot 身份服务暂时不可用，请稍后重试。');
  return response.status===204?null:response.json();
 }
 async function authenticate(req){
  const raw=cookies(req.headers.cookie)[sessionCookieName];
  if(!raw||!/^[-\w]{43}$/.test(raw))throw fail(401,'请先登录中台。');
  // Only merge in-flight checks. Never cache successful authorization.
  const key=digest(raw);
  let check=inFlight.get(key);
  if(!check){
   if(inFlight.size>=32)throw fail(429,'登录验证繁忙，请稍后重试。');
   check=(async()=>{const response=await fetch(middle,{headers:{Cookie:sessionCookieName+'='+raw},signal:AbortSignal.timeout(8000),redirect:'error'});if(!response.ok)throw fail(503,'暂时无法验证中台登录，请稍后重试。');return (await response.json()).user;})();
   inFlight.set(key,check);check.finally(()=>{if(inFlight.get(key)===check)inFlight.delete(key);}).catch(()=>{});
  }
  const user=await check;
  if(!user)throw fail(401,'中台登录已失效。');
  if(!internalUser(user))throw fail(403,'当前账号无权进入 Chatwoot，或需要先在中台完成密码更新。');
  return {user,key};
 }
 async function provision(user){return lock(async()=>{
  const id=String(user.identity.id),email='doon-'+digest(id).slice(0,40)+'@identity.invalid';
  const profile={name:user.identity.name,display_name:user.identity.name,custom_attributes:{doon_user_id:id,doon_username:user.username||'',doon_email:user.identity.email||''}};
  let identity=identities[id];
  if(!identity){
   const created=await api('/platform/api/v1/users','POST',{...profile,email,password:randomBytes(32).toString('base64url')+'aA1!'});
   if(!Number.isSafeInteger(created.id)||created.custom_attributes?.doon_user_id!==id||created.email!==email||Object.values(identities).some(value=>value.id===created.id))throw fail(503,'Chatwoot 身份对应校验失败。');
   identity={id:created.id,email};identities[id]=identity;await persist();
  }
  if(identity.email!==email)throw fail(503,'Chatwoot 身份对应校验失败。');
  await api('/platform/api/v1/users/'+identity.id,'PATCH',profile);
  await api('/platform/api/v1/accounts/'+config.accountId+'/account_users','POST',{user_id:identity.id,role:user.role==='admin'?'administrator':'agent'});
  return identity;
 });}
 function sign(value){const encoded=Buffer.from(JSON.stringify(value)).toString('base64url');return encoded+'.'+createHmac('sha256',config.bindingKey).update(encoded).digest('base64url');}
 function bound(req,auth){
  const value=cookies(req.headers.cookie)[bindingName]||'',parts=value.split('.');
  if(parts.length!==2)return null;
  const expected=createHmac('sha256',config.bindingKey).update(parts[0]).digest('base64url');
  if(parts[1].length!==expected.length||!timingSafeEqual(Buffer.from(parts[1]),Buffer.from(expected)))return null;
  try{const binding=JSON.parse(Buffer.from(parts[0],'base64url'));const identity=identities[String(auth.user.identity.id)];return binding.session===auth.key&&binding.member===String(auth.user.identity.id)&&binding.role===auth.user.role&&binding.id===identity?.id&&binding.account===config.accountId&&binding.expires>Date.now()?{...binding,email:identity.email}:null;}catch{return null;}
 }
 function cookie(name,value,httpOnly=false,maxAge=43200){return name+'='+encodeURIComponent(value)+'; Path=/; SameSite=Strict; Max-Age='+maxAge+(origin.protocol==='https:'?'; Secure':'')+(httpOnly?'; HttpOnly':'');}
 function headers(res){res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');}
 function redirect(res,target){headers(res);res.writeHead(302,{Location:target});res.end();}
 function errorResponse(req,res,error){
  headers(res);const status=error.status||503;
  if(status===401){res.setHeader('Set-Cookie',[cookie(bindingName,'',true,0),cookie(credentialName,'',false,0)]);if(req.method==='GET'&&String(req.headers.accept||'').includes('text/html'))return redirect(res,'/login?returnTo=%2Fmail');}
  res.writeHead(status,{'Content-Type':'text/plain; charset=utf-8'});res.end(error.status?error.message:'Chatwoot 暂时不可用，请返回邮箱页面稍后重试。');
 }
 async function enter(req,res,auth){
  const identity=await provision(auth.user);
  const link=await api('/platform/api/v1/users/'+identity.id+'/login');
  const url=new URL(link.url);
  if(url.origin!==origin.origin||url.pathname!=='/app/login'||url.searchParams.get('email')!==identity.email||!url.searchParams.get('sso_auth_token'))throw fail(503,'Chatwoot 登录响应校验失败。');
  // Consume the one-use SSO token on the server. It never appears in browser URLs.
  const login=await fetch(new URL('/auth/sign_in',upstream),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:identity.email,sso_auth_token:url.searchParams.get('sso_auth_token')}),signal:AbortSignal.timeout(15000),redirect:'error'});
  if(!login.ok)throw fail(503,'Chatwoot 身份衔接失败，请返回邮箱页面重试。');
  const payload=await login.json(),credentials=Object.fromEntries(['access-token','token-type','client','expiry','uid'].map(key=>[key,login.headers.get(key)]));
  if(payload.data?.id!==identity.id||credentials.uid!==identity.email||!credentials['access-token']||!credentials.client||!/^\d+$/.test(credentials.expiry||''))throw fail(503,'Chatwoot 登录身份校验失败。');
  const pubsub=payload.data.pubsub_token;
  if(typeof pubsub!=='string'||!pubsub)throw fail(503,'Chatwoot 实时会话校验失败。');
  const binding=sign({member:String(auth.user.identity.id),role:auth.user.role,id:identity.id,account:config.accountId,session:auth.key,pubsub,expires:Date.now()+12*3600000});
  res.setHeader('Set-Cookie',[cookie(bindingName,binding,true),cookie(credentialName,JSON.stringify(credentials))]);
  redirect(res,'/app/accounts/'+config.accountId+'/dashboard');
 }
 function checkScope(req,url,binding){
  if(req.headers.uid&&req.headers.uid!==binding.email)throw fail(403,'Chatwoot 身份与当前中台账号不一致。');
  const account=url.pathname.match(/^\/(?:api\/v[12]|app)\/accounts\/([^/]+)/)?.[1];
  if(account&&account!==String(config.accountId))throw fail(403,'无权访问该 Chatwoot 工作区。');
  if(url.pathname==='/cable'&&url.searchParams.get('pubsub_token')!==binding.pubsub)throw fail(403,'实时会话身份不一致。');
 }
 function allowed(url){return /^\/(?:app(?:\/|$)|vite(?:\/|$)|packs(?:\/|$)|brand-assets(?:\/|$)|assets(?:\/|$)|api\/v[12](?:\/|$)|rails\/active_storage(?:\/|$)|cable$|auth\/(?:validate_token|sign_out)$)/.test(url.pathname);}
 function proxy(req,res){
  const options={hostname:upstream.hostname,port:upstream.port||80,path:req.url,method:req.method,headers:{...req.headers,host:origin.host,'x-forwarded-host':origin.host,'x-forwarded-proto':origin.protocol.slice(0,-1),cookie:(req.headers.cookie||'').split(';').filter(value=>!value.trim().startsWith(sessionCookieName+'=')&&!value.trim().startsWith(bindingName+'=')).join(';')}};
  delete options.headers['api_access_token'];delete options.headers.authorization;
  const target=(upstream.protocol==='https:'?https:http).request(options,response=>{
   const output={...response.headers,'cache-control':'no-store','referrer-policy':'no-referrer'};
   if(output['set-cookie'])output['set-cookie']=output['set-cookie'].filter(value=>!value.startsWith(sessionCookieName+'=')&&!value.startsWith(bindingName+'='));
   if(output.location){try{const location=new URL(output.location,origin);if(location.origin!==origin.origin||location.pathname==='/app/login'||location.pathname==='/')output.location='/chatwoot/enter';}catch{output.location='/chatwoot/enter';}}
   res.writeHead(response.statusCode,output);response.pipe(res);
  });target.on('error',()=>{if(!res.headersSent)errorResponse(req,res,fail(503,'Chatwoot 暂时不可用。'));else res.destroy();});target.setTimeout(30000,()=>target.destroy());req.pipe(target);res.on('close',()=>target.destroy());
 }
 const server=http.createServer(async(req,res)=>{try{
  headers(res);
  const url=new URL(req.url,origin);
  if(/%2f|%5c|%2e|\\/i.test(req.url.split('?')[0])||/(?:^|\/)\.{1,2}(?:\/|$)/.test(req.url.split('?')[0]))throw fail(400,'请求路径不正确。');
  if(req.headers.host!==origin.host)throw fail(400,'访问地址不正确。');
  if(req.method==='GET'&&url.pathname==='/chatwoot/health'){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({ok:true,service:'doon-chatwoot-gateway'}));}
  const auth=await authenticate(req);
  if(req.method==='GET'&&url.pathname==='/chatwoot/status'){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({enabled:true}));}
  if(req.method==='GET'&&(['/chatwoot','/chatwoot/','/chatwoot/enter'].includes(url.pathname)||/^\/app\/(?:login(?:\/|$)|auth(?:\/|$))/.test(url.pathname)))return await enter(req,res,auth);
  const binding=bound(req,auth);
  if(!binding){if(req.method==='GET'&&url.pathname.startsWith('/app'))return redirect(res,'/chatwoot/enter');throw fail(401,'请从邮箱页面重新进入 Chatwoot。');}
  if(req.method==='GET'&&url.pathname==='/chatwoot/session'){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({ok:true}));}
  if(!allowed(url))throw fail(403,'该 Chatwoot 入口未开放。');
  if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.headers.origin!==origin.origin)throw fail(403,'请求来源不正确。');
  checkScope(req,url,binding);proxy(req,res);
 }catch(error){errorResponse(req,res,error);}});
 server.on('upgrade',async(req,socket,head)=>{try{
  if(req.headers.host!==origin.host||req.headers.origin!==origin.origin)throw fail(403,'Invalid origin');
  const url=new URL(req.url,origin);if(url.pathname!=='/cable')throw fail(403,'Invalid websocket path');
  const auth=await authenticate(req),binding=bound(req,auth);if(!binding)throw fail(401,'Session missing');checkScope(req,url,binding);
  const target=http.request({hostname:upstream.hostname,port:upstream.port||80,path:req.url,headers:{...req.headers,host:origin.host,cookie:''}});
  target.on('upgrade',(_,remote,remoteHead)=>{socket.write('HTTP/1.1 101 Switching Protocols\r\n'+Object.entries(_.headers).map(([key,value])=>key+': '+value).join('\r\n')+'\r\n\r\n');if(remoteHead.length)socket.write(remoteHead);if(head.length)remote.write(head);socket.pipe(remote).pipe(socket);let checking=false;const timer=setInterval(async()=>{if(checking)return;checking=true;try{const current=await authenticate(req);if(!bound(req,current))throw Error('Revoked');}catch{socket.destroy();remote.destroy();}finally{checking=false;}},config.websocketRecheckMs||15000);timer.unref();socket.on('close',()=>{clearInterval(timer);remote.destroy();});remote.on('close',()=>{clearInterval(timer);socket.destroy();});remote.on('error',()=>socket.destroy());socket.on('error',()=>remote.destroy());});
  target.on('error',()=>socket.destroy());target.on('response',response=>{response.resume();socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');});target.end();
 }catch{socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');}});
 return server;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const config=JSON.parse(await readFile(process.env.DOON_CHATWOOT_GATEWAY_CONFIG||'/private/gateway.json','utf8'));
 const server=await createGateway(config);server.listen(Number(process.env.PORT||8080),'0.0.0.0',()=>console.log('Chatwoot gateway listening'));
}
