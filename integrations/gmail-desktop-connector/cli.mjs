import {readFile,open,unlink} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Store} from './store.mjs';
import {authorize,loadDesktopConfig,clientFor} from './oauth.mjs';
import {Gmail,Bridge} from './clients.mjs';
import {SyncEngine} from './sync.mjs';

const options=Object.fromEntries(process.argv.slice(3).reduce((a,v,i,all)=>v.startsWith('--')?[...a,[v.slice(2),all[i+1]]]:a,[]));
const command=process.argv[2]||'help';
async function proxy(){
 if(process.env.HTTPS_PROXY||process.env.https_proxy)return;
 if(process.platform!=='win32')return;
 try{
  const r=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-Command',String.raw`$p=Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings';@{enabled=$p.ProxyEnable;server=$p.ProxyServer}|ConvertTo-Json -Compress`],{windowsHide:true});
  const p=JSON.parse(r.stdout);if(!p.enabled||!p.server)return;
  const address=p.server.includes('=')?p.server.split(';').map(v=>v.split('=')).find(([k])=>k==='https')?.[1]:p.server;
  if(address&&/^(?:https?:\/\/)?[^\s/@]+:\d+$/.test(address))process.env.HTTPS_PROXY=/^https?:/.test(address)?address:'http://'+address;
 }catch{ /* An explicit HTTPS_PROXY remains available when a PAC is used. */ }
}
async function lock(store){
 const filename=path.join(store.directory,'run.lock');
 try{const file=await open(filename,'wx',0o600);await file.writeFile(String(process.pid));await file.close();}
 catch(e){
  if(e.code!=='EEXIST')throw e;
  const pid=Number(await readFile(filename,'utf8'));let live=true;try{process.kill(pid,0);}catch{live=false;}
  if(live)throw Error('本机连接器已经运行，请不要重复启动。');
  await unlink(filename);return lock(store);
 }
 return ()=>unlink(filename).catch(()=>{});
}
async function authenticated(store,config){
 if(!config.oauth)throw Error('请先导入桌面 OAuth JSON。');
 console.log('请在打开的 Google 网页中选择你的 Gmail，并确认邮件授权。');
 config.tokens=await authorize(config.oauth,{onReady:()=>console.log('Google 授权窗口已准备好，等待本人确认（5 分钟内）。')});
 const gmail=new Gmail(clientFor(config)),profile=await gmail.profile();
 if(config.gmailEmail&&config.gmailEmail.toLowerCase()!==profile.emailAddress.toLowerCase())throw Error('授权邮箱与原邮箱不一致，未替换原授权。');
 const granted=new Set((config.tokens.scope||'').split(' '));
 if(!granted.has('https://www.googleapis.com/auth/gmail.modify'))throw Error('尚未获得 gmail.modify 权限，请检查 Google 权限配置并重新授权。');
 config.gmailEmail=profile.emailAddress;await store.saveConfig(config);console.log('Gmail 授权已加密保存在本机。');return config;
}
async function main(){
 if(command==='help'){console.log('独立 Gmail 本机连接器（Node 24 / Windows）\nauth --oauth <桌面 JSON 路径> 首次授权，或 auth 重新授权\nsetup --bridge <私有连接配置路径> 绑定 Chatwoot\nrun 持续同步，Ctrl+C 结束\nstatus 查看同步状态（不显示凭据和邮件内容）');return;}
 await proxy();const store=await new Store().open();let release;
 try{
  let config=await store.config()||{};
  if(command==='status'){console.log(JSON.stringify({configured:!!config.bridge,authorized:!!config.tokens,proxy:!!process.env.HTTPS_PROXY,phase:store.get('scan')?'initial-sync':store.get('historyId')?'incremental':'not-started',lastSync:store.get('lastSync'),messages:store.db.prepare('SELECT count(*) AS n FROM messages').get().n,state:store.get('state')||'not-started'},null,2));return;}
  release=await lock(store);
  if(command==='setup'){
   if(!options.bridge)throw Error('setup 需要 --bridge 私有配置文件路径。');
   const bridge=JSON.parse(await readFile(options.bridge,'utf8'));new Bridge(bridge);
   if(config.bridge&&JSON.stringify(config.bridge)!==JSON.stringify(bridge))throw Error('已绑定其他连接配置，未覆盖原配置。');
   config.bridge=bridge;if(options.oauth&&!config.oauth)config.oauth=await loadDesktopConfig(options.oauth);
   await store.saveConfig(config);
   if(!store.get('initialAfter'))store.set('initialAfter',Math.floor(Date.now()/1000)-30*86400);
   if(!config.tokens)config=await authenticated(store,config);
   const registered=await new Bridge(config.bridge).request('register',{email:config.gmailEmail});
   store.set('inboxId',registered.inbox_id);store.set('state','ready');console.log('专用 Gmail 收件箱已建立，可以运行 run 开始同步最近 30 天。');return;
  }
  if(command==='auth'){
   if(options.oauth){const oauth=await loadDesktopConfig(options.oauth);if(config.oauth&&config.oauth.clientId!==oauth.clientId)throw Error('OAuth 客户端与原配置不一致，未覆盖。');config.oauth=oauth;await store.saveConfig(config);}
   await authenticated(store,config);return;
  }
  if(command!=='run')throw Error('未知命令，运行 help 查看用法。');
  if(!config.tokens||!config.bridge)throw Error('请先完成 setup。');
  const auth=clientFor(config);let pendingSave=Promise.resolve();
  auth.on('tokens',tokens=>{config.tokens={...config.tokens,...Object.fromEntries(Object.entries(tokens).filter(([,v])=>v!==undefined))};pendingSave=pendingSave.then(()=>store.saveConfig(config));pendingSave.catch(()=>{});});
  const engine=new SyncEngine({store,gmail:new Gmail(auth),bridge:new Bridge(config.bridge)});
  let stopping=false,retry=2000,wake;const stop=()=>{stopping=true;wake?.();};process.once('SIGINT',stop);process.once('SIGTERM',stop);
  console.log('本机 Gmail 连接器已启动。电脑在线时同步，离线期间的消息会在重连后补回。');
  while(!stopping){
   try{await engine.tick();await pendingSave;store.set('lastSync',new Date().toISOString());if(store.get('state')!=='online')console.log('已连接 Gmail 和 Chatwoot。');store.set('state','online');retry=2000;}
   catch(e){
    const code=e?.response?.data?.error||e?.code||e?.status;
    const reauth=code==='invalid_grant'||e?.response?.status===401;
    store.set('state',reauth?'reauthorization-required':'reconnecting');
    console.log(reauth?'Gmail 授权已失效，请运行 auth 重新授权。':'连接暂时不可用，保留同步位置和待处理作业，稍后重连。');
    if(reauth)break;retry=Math.min(retry*2,60000);
   }
   await new Promise(resolve=>{const timer=setTimeout(resolve,store.get('state')==='online'?10000:retry);wake=()=>{clearTimeout(timer);resolve();};});wake=null;
  }
  await pendingSave;console.log('连接器已停止，同步位置已保留。');
 }finally{await release?.();store.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e?.response?'Google 请求未完成，请检查网络或重新授权。':e.message);process.exitCode=1;});
