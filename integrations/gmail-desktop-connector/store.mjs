import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,rename,lstat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

export const defaultDirectory=()=>process.env.DOON_GMAIL_HOME||path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'Doon','GmailConnector');
export async function dpapi(value,decrypt=false){
 if(process.platform!=='win32')throw Error('凭据加密目前仅支持 Windows。');
 const operation=decrypt?'Unprotect':'Protect';
 const script=`$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;$b=[Convert]::FromBase64String([Console]::In.ReadToEnd());$r=[Security.Cryptography.ProtectedData]::${operation}($b,[Text.Encoding]::UTF8.GetBytes('doon-gmail-v1'),[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($r))`;
 const output=await new Promise((resolve,reject)=>{
  const child=spawn(path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,stdio:['pipe','pipe','ignore']});
  let result='';const timer=setTimeout(()=>child.kill(),15000);
  child.stdout.on('data',b=>{result+=b;if(result.length>131072)child.kill();});
  child.stdin.on('error',()=>{});child.on('error',reject);
  child.on('close',code=>{clearTimeout(timer);code===0&&/^[\w+/]+=*$/.test(result)?resolve(result):reject(Error('Windows 凭据解密失败，请使用原 Windows 账号。'));});
  child.stdin.end(decrypt?value:Buffer.from(value).toString('base64'));
 });
 return decrypt?Buffer.from(output,'base64').toString('utf8'):output;
}
export class Store{
 constructor(directory=defaultDirectory(),codec=dpapi){this.directory=directory;this.codec=codec;}
 async open(){
  if(!path.isAbsolute(this.directory))throw Error('配置目录必须是绝对路径。');
  await mkdir(this.directory,{recursive:true,mode:0o700});
  const stat=await lstat(this.directory);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('配置目录不安全。');
  this.db=new DatabaseSync(path.join(this.directory,'sync.sqlite'));
  this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,scan TEXT,labels TEXT NOT NULL); CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY,state TEXT NOT NULL,result TEXT);');
  return this;
 }
 async config(){try{return JSON.parse(await this.codec(await readFile(path.join(this.directory,'credentials.dpapi'),'utf8'),true));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
 async saveConfig(value){
  const filename=path.join(this.directory,'credentials.dpapi'),temp=filename+'.'+randomUUID();
  await writeFile(temp,await this.codec(JSON.stringify(value)),{mode:0o600,flag:'wx'});await rename(temp,filename);
 }
 get(key){const r=this.db.prepare('SELECT value FROM meta WHERE key=?').get(key);return r?JSON.parse(r.value):null;}
 set(key,value){this.db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));}
 message(id){return this.db.prepare('SELECT * FROM messages WHERE id=?').get(id);}
 remember(id,labels,scan=null){this.db.prepare('INSERT INTO messages(id,labels,scan) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET labels=excluded.labels,scan=COALESCE(excluded.scan,messages.scan)').run(id,JSON.stringify(labels),scan);}
 missing(scan){return this.db.prepare('SELECT id FROM messages WHERE scan IS NULL OR scan<>?').all(scan).map(r=>r.id);}
 attempt(id){const r=this.db.prepare('SELECT * FROM attempts WHERE id=?').get(id);return r?{...r,result:JSON.parse(r.result||'null')}:null;}
 recordAttempt(id,state,result=null){this.db.prepare('INSERT INTO attempts(id,state,result) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,result=excluded.result').run(id,state,JSON.stringify(result));}
 close(){this.db?.close();}
}
