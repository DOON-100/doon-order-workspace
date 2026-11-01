import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ApiClient} from './client.js';
import {version} from './catalog.js';
import {CliError} from './errors.js';
import {StateStore} from './state.js';

type Release = {format:string;version:string;commit:string;file:string;bytes:number;sha256:string;sourceDirty:boolean};
const components=(value:string)=>value.split('.').map(Number);
function newer(next:string,current:string){const a=components(next),b=components(current);return a.some((part,index)=>part>b[index]&&a.slice(0,index).every((prior,i)=>prior===b[i]));}
function validate(value:any):Release {
 if(value?.format!=='doon-cli-update-v1'||!/^\d+\.\d+\.\d+$/.test(value.version)||!(/^[a-f0-9]{40}$/.test(value.commit))||value.file!==`doon-cli-${value.version}-${value.commit.slice(0,12)}-windows-x64.zip`||!Number.isInteger(value.bytes)||value.bytes<1||value.bytes>128*1024*1024||!(/^[a-f0-9]{64}$/.test(value.sha256))||value.sourceDirty!==false)throw new CliError('INVALID_RELEASE','服务器发布清单无效。',5);
 return value;
}
export class UpdateService {
 constructor(private store=new StateStore(),private transport:typeof fetch=fetch){}
 private async release(){const config=await this.store.config(),session=await this.store.session(config);if(!session)throw new CliError('AUTH_REQUIRED','请先由员工本人运行 doon login。',4);const client=new ApiClient(config,this.transport,30000);return {release:validate((await client.request('/api/cli-update/latest',session)).data),client,session};}
 async check(){const {release}=await this.release();return {installedVersion:version,latestVersion:release.version,updateAvailable:newer(release.version,version),commit:release.commit};}
 async install(){
  if(process.platform!=='win32'||process.arch!=='x64')throw new CliError('UNSUPPORTED_PLATFORM','自动升级仅支持 Windows x64 安装包。',2);
  const packageRoot=fileURLToPath(new URL('../',import.meta.url));let installed:any;
  try{installed=JSON.parse(await fs.readFile(path.join(packageRoot,'release.json'),'utf8'));}catch{throw new CliError('NOT_INSTALLED','请从已安装的 Doon CLI 运行升级。',2);}
  if(installed?.platform!=='win32-x64'||installed?.version!==version||installed?.sourceDirty!==false||path.basename(path.dirname(packageRoot))!=='programs')throw new CliError('NOT_INSTALLED','请从正式安装的 Doon CLI 运行升级。',2);
  const {release,client,session}=await this.release();if(!newer(release.version,version))return {updated:false,installedVersion:version,latestVersion:release.version};
  const bytes=(await client.request('/api/cli-update/package',session)).data as Buffer;
  if(bytes.length!==release.bytes||createHash('sha256').update(bytes).digest('hex')!==release.sha256)throw new CliError('INVALID_RELEASE','安装包大小或摘要与发布清单不符。',5);
  const stage=await fs.mkdtemp(path.join(os.tmpdir(),'doon-cli-download-')),archive=path.join(stage,release.file);
  try{
   await fs.writeFile(archive,bytes,{flag:'wx'});
   const powershell=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
   const script=path.join(packageRoot,'update.ps1');
   const code=await new Promise<number>((resolve,reject)=>{const child=spawn(powershell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-Archive',archive,'-ExpectedHash',release.sha256,'-ExpectedVersion',release.version,'-ExpectedCommit',release.commit],{windowsHide:true,stdio:['ignore','ignore','ignore']});child.on('error',reject);child.on('close',value=>resolve(value??1));});
   if(code!==0)throw new CliError('INSTALL_FAILED','安装未完成，原客户端仍可使用；请联系管理员核对安装包。',5);
   return {updated:true,previousVersion:version,installedVersion:release.version,commit:release.commit,restartRequired:true};
  }finally{
   const target=path.resolve(stage),base=path.resolve(os.tmpdir()),stat=await fs.lstat(target);
   if(path.dirname(target)!==base||!path.basename(target).startsWith('doon-cli-download-')||stat.isSymbolicLink()||!stat.isDirectory())throw new CliError('UNSAFE_TEMP','下载临时目录状态异常，停止自动清理。',5);
   await fs.rm(target,{recursive:true,force:true});
  }
 }
}
