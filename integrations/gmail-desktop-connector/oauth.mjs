import http from 'node:http';
import {spawn} from 'node:child_process';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {OAuth2Client} from 'google-auth-library';

export const scopes=['https://www.googleapis.com/auth/gmail.modify'];
export async function loadDesktopConfig(filename){
 const json=JSON.parse(await readFile(filename,'utf8')),c=json.installed;
 if(!c||!c.client_id?.endsWith('.apps.googleusercontent.com')||!c.client_secret||c.auth_uri!=='https://accounts.google.com/o/oauth2/auth'||c.token_uri!=='https://oauth2.googleapis.com/token')throw Error('请选择 Google 下载的“桌面应用”客户端 JSON。');
 return {clientId:c.client_id,clientSecret:c.client_secret};
}
export function clientFor(config){
 const auth=new OAuth2Client({clientId:config.oauth.clientId,clientSecret:config.oauth.clientSecret,transporterOptions:{timeout:30000,retry:false}});
 if(config.tokens)auth.setCredentials(config.tokens);
 return auth;
}
export function openBrowser(url){
 if(!/^https:\/\/accounts\.google\.com\//.test(url))throw Error('授权网址无效。');
 // The authorization URL contains no refresh token or client secret.
 const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command','$u=[Console]::In.ReadToEnd();Start-Process $u'],{windowsHide:true,stdio:['pipe','ignore','ignore']});
 child.stdin.on('error',()=>{});child.stdin.end(url);child.on('error',()=>{});
}
export async function authorize(oauth,{launch=openBrowser,timeout=300000,onReady=()=>{}}={}){
 const state=randomBytes(32).toString('base64url');let redirect;
 const auth=new OAuth2Client({clientId:oauth.clientId,clientSecret:oauth.clientSecret,transporterOptions:{timeout:30000,retry:false}});
 const {codeVerifier,codeChallenge}=await auth.generateCodeVerifierAsync();
 let complete,reject;const completion=new Promise((a,b)=>{complete=a;reject=b;});
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,redirect);
  if(req.headers.host!==new URL(redirect).host||url.pathname!=='/oauth/callback'){res.writeHead(404);return res.end();}
  const received=url.searchParams.get('state')||'';
  if(received.length!==state.length||!timingSafeEqual(Buffer.from(received),Buffer.from(state))){res.writeHead(400);return res.end('Invalid OAuth state');}
  res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
  if(url.searchParams.has('error')){res.end('授权未完成。可以关闭此窗口，在连接器重新授权。');return reject(Error('Google 授权被取消。'));}
  const code=url.searchParams.get('code');if(!code){res.writeHead(400);return res.end('Missing code');}
  res.end('已收到 Google 授权，连接器正在验证。可以关闭此窗口。');
  try{const {tokens}=await auth.getToken({code,codeVerifier,redirect_uri:redirect});if(!tokens.refresh_token)throw Error('没有获得离线授权，请重新授权。');complete(tokens);}catch{reject(Error('Google 授权兑换失败，请检查电脑到 Google 的网络后重试。'));}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 redirect=`http://127.0.0.1:${server.address().port}/oauth/callback`;
 const timer=setTimeout(()=>reject(Error('授权等待超时，请重试。')),timeout);
 try{const url=auth.generateAuthUrl({redirect_uri:redirect,scope:scopes,access_type:'offline',prompt:'consent',state,code_challenge:codeChallenge,code_challenge_method:'S256'});onReady();launch(url);return await completion;}
 finally{clearTimeout(timer);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
