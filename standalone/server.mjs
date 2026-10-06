import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {db,context,makeBackup,dataDir} from './runtime.mjs';
import {session,publicSession,login,logout,changePassword,createAccount,resetPassword} from './auth.mjs';
import * as api from './workspace-api.mjs';

const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'client');
const port=Number(process.env.DOON_PORT||8787),host=process.env.DOON_HOST||'0.0.0.0';
const secure=!!(process.env.DOON_TLS_CERT&&process.env.DOON_TLS_KEY),protocol=secure?'https':'http';
const addresses=Object.values(os.networkInterfaces()).flat().filter(a=>a?.family==='IPv4'&&!a.internal&&/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)).map(a=>a.address);
const hosts=new Set(['localhost','127.0.0.1',os.hostname().toLowerCase(),...addresses].map(h=>h+':'+port));
const security={'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"};
const rates=new Map();
function fail(message,status=400){throw Object.assign(new Error(message),{status});}
const reply=(body,status=200,headers={})=>Response.json(body,{status,headers});
function localIP(ip){return /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip.replace(/^::ffff:/,''))||ip==='::1';}
function throttle(ip){const now=Date.now();for(const [key,r] of rates)if(r.until<now)rates.delete(key);const r=rates.get(ip)||{until:now+60000,count:0};r.count++;rates.set(ip,r);if(r.count>60)fail('操作过于频繁，请稍后再试。',429);}
async function handle(req,res){
 try{
  if(!localIP(req.socket.remoteAddress||''))fail('此站点仅供公司内网访问。',403);
  const hostHeader=String(req.headers.host||'').toLowerCase();if(!hosts.has(hostHeader))fail('访问地址未获授权，请使用主机显示的内网地址。',403);
  const url=new URL(req.url,protocol+'://'+hostHeader);if(!['GET','POST','HEAD'].includes(req.method))fail('不支持的请求方法。',405);
  if(req.method==='POST'&&req.headers.origin!==url.origin)fail('不允许跨站提交，请刷新登录页面。',403);
  const parts=[];let size=0;for await(const part of req){size+=part.length;if(size>11*1024*1024)fail('文件不能超过 10 MB。',413);parts.push(part);}
  const request=new Request(url,{method:req.method,headers:req.headers,body:req.method==='POST'?Buffer.concat(parts):undefined});
  let response;
  if(url.pathname==='/health')response=reply({ok:true,service:'度昂订单协作中台·内网版'});
  else if(url.pathname.startsWith('/api/')){
   const current=session(request);
   if(url.pathname.startsWith('/api/auth/')){
    throttle(req.socket.remoteAddress);
    const action=url.pathname.slice('/api/auth/'.length);
    if(action==='session'&&req.method==='GET')response=reply({user:publicSession(current)});
    else if(action==='login'&&req.method==='POST'){const result=await login(await request.json(),req.socket.remoteAddress,secure);response=reply({user:result.user},200,{'Set-Cookie':result.cookie});}
    else if(action==='logout'&&req.method==='POST')response=reply({ok:true},200,{'Set-Cookie':logout(current,secure)});
    else {
     if(!current)fail('请先登录。',401);
     if(action==='password'&&req.method==='POST')response=reply({ok:true},200,{'Set-Cookie':await changePassword(current,await request.json(),secure)});
     else{
      if(current.account.must_change)fail('请先修改初始密码。',403);
      if(action==='maintenance'&&req.method==='GET'){
       if(!['admin','programmer'].includes(current.member.role))fail('需要管理员或程序员权限。',403);
       const saved=JSON.parse(db.prepare("SELECT value FROM local_meta WHERE key='last_backup'").get()?.value||'null');
       response=reply({service:'度昂订单协作中台 · 内网版',serverTime:new Date().toISOString(),uptimeSeconds:Math.floor(process.uptime()),runtime:process.versions.node,database:'SQLite WAL',databaseReady:!!db.prepare('SELECT 1 ok').get().ok,revision:db.prepare("SELECT revision FROM workspace_revision WHERE id='main'").get().revision,backup:saved?{at:saved.at,integrity:saved.integrity}:null});
      }else {
      if(current.member.role!=='admin')fail('需要管理员权限。',403);
      if(action==='accounts'&&req.method==='GET')response=reply({accounts:db.prepare('SELECT id,username,member_id,must_change,created_at FROM local_accounts').all()});
      else if(action==='accounts'&&req.method==='POST')response=reply(await createAccount(await request.json(),current.member));
      else if(action==='reset'&&req.method==='POST'){await resetPassword(current,await request.json());response=reply({ok:true});}
      else if(action==='backup'&&req.method==='POST')response=reply(await makeBackup());
      else if(action==='backup'&&req.method==='GET')response=reply({last:JSON.parse(db.prepare("SELECT value FROM local_meta WHERE key='last_backup'").get()?.value||'null')});
      else fail('接口不存在。',404);
      }
     }
    }
   }else if(url.pathname.startsWith('/api/workspace/')){
    if(!current)fail('请先登录。',401);if(current.account.must_change)fail('请先修改初始密码。',403);
    const action=url.pathname.slice('/api/workspace/'.length);if(!/^[a-z-]+$/.test(action))fail('接口不存在。',404);
    if(action==='member'&&req.method==='POST'){if(current.member.role!=='admin')fail('需要管理员权限。',403);const b=await request.clone().json();if(!b.id)fail('请通过“创建员工账号”新增成员。');}
    response=await context.run(current,()=>api[req.method==='POST'?'POST':'GET'](request,{params:Promise.resolve({action})}));
    if(action==='member'&&req.method==='POST'&&response.ok)db.prepare("DELETE FROM local_sessions WHERE account_id IN (SELECT a.id FROM local_accounts a JOIN records r ON r.id=a.member_id WHERE json_extract(r.data,'$.active')=0)").run();
   }else fail('接口不存在。',404);
  }else{
   let relative=decodeURIComponent(url.pathname).replace(/^\//,'');
   if(!relative||!path.extname(relative))relative='index.html';
   const target=path.resolve(root,relative);if(!target.startsWith(root+path.sep)||relative.split(/[\\/]/).some(p=>p.startsWith('.')))fail('文件不存在。',404);
   const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'}[path.extname(target)];if(!mime)fail('文件不存在。',404);
   try{response=new Response(req.method==='HEAD'?null:await fs.readFile(target),{headers:{'Content-Type':mime}});}catch(e){if(e.code==='ENOENT')fail('文件不存在。',404);throw e;}
  }
  res.writeHead(response.status,{...security,...Object.fromEntries(response.headers)});res.end(Buffer.from(await response.arrayBuffer()));
 }catch(e){const status=e.status||500;if(status===500)console.error('请求失败',e.message);res.writeHead(status,{...security,'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:status===500?'服务暂不可用，请稍后重试。':e.message}));}
}
const server=secure?https.createServer({cert:await fs.readFile(process.env.DOON_TLS_CERT),key:await fs.readFile(process.env.DOON_TLS_KEY)},handle):http.createServer(handle);
server.requestTimeout=30000;server.headersTimeout=15000;server.maxHeadersCount=60;
server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'网站已在运行，或端口被占用。':e.message);process.exitCode=1;});
server.listen(port,host,async()=>{
 const status={pid:process.pid,port,startedAt:new Date().toISOString(),localUrl:`${protocol}://127.0.0.1:${port}`,lanUrls:addresses.map(a=>`${protocol}://${a}:${port}`)};
 await fs.writeFile(path.join(dataDir,'server-status.json'),JSON.stringify(status,null,2));console.log(JSON.stringify(status));
 if(process.env.DOON_NO_AUTO_BACKUP!=='1')makeBackup().catch(e=>console.error('启动备份失败',e.message));
});
const timer=setInterval(()=>makeBackup().catch(e=>console.error('自动备份失败',e.message)),24*3600000);timer.unref();
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{db.close();process.exit(0);}));
