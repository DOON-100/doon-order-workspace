// Test environment, synthetic files only. Never uses the employee's CLI home or PATH.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import http from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import {root,temporary} from './helpers.mjs';
import {inventory} from '../scripts/package-windows.mjs';
import {version} from '../dist/catalog.js';

test('Windows updates serialize installs, survive inherited module paths and preserve state', {skip:process.platform!=='win32',timeout:120000}, async t=>{
 const directory=await temporary(),install=path.join(directory,'installed'),programs=path.join(install,'programs');
 const old=path.join(programs,version+'-'+ 'b'.repeat(12));
 await fs.mkdir(old,{recursive:true});
 await fs.copyFile(path.join(root,'cli/windows/update.ps1'),path.join(old,'update.ps1'));
 await fs.writeFile(path.join(old,'release.json'),'{}');
 const state={'config.json':'{"syntheticOnly":true}','session.dpapi':'synthetic encrypted-state sentinel, not a credential'};
 for(const [name,value]of Object.entries(state))await fs.writeFile(path.join(install,name),value);
 const shell=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
 const children=new Set();
 t.after(()=>{for(const child of children)child.kill();});
 function run(args){
  const child=spawn(shell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass',...args],{windowsHide:true,stdio:'pipe'});
  children.add(child);let output='',settled=false;
  const done=new Promise((resolve,reject)=>{
   child.stdout.on('data',bytes=>output+=bytes);child.stderr.on('data',bytes=>output+=bytes);
   child.on('error',reject);child.on('close',code=>{children.delete(child);settled=true;resolve({code,output});});
  });
  return {child,done,get settled(){return settled;}};
 }
 const zipScript=path.join(directory,'zip.ps1');
 await fs.writeFile(zipScript,"param([string]$Source,[string]$Zip)\n$ErrorActionPreference='Stop'\nAdd-Type -AssemblyName System.IO.Compression.FileSystem\n[IO.Compression.ZipFile]::CreateFromDirectory($Source,$Zip)\n");
 const launcher=path.join(directory,'launch.ps1');
 // Explicitly reproduce an Agent shell with unusable inherited modules.
 await fs.writeFile(launcher,"param([string]$Updater,[string]$Archive,[string]$Hash,[string]$Version,[string]$Commit)\n$ErrorActionPreference='Stop'\n$env:PSModulePath=''\n& $Updater -Archive $Archive -ExpectedHash $Hash -ExpectedVersion $Version -ExpectedCommit $Commit\n");
 async function pack(version){
  const source=path.join(directory,version);await fs.mkdir(source);
  await fs.copyFile(path.join(root,'cli/windows/install.ps1'),path.join(source,'install.ps1'));
  await fs.writeFile(path.join(source,'doon.cmd'),'@echo synthetic test only\r\n');
  for(let i=0;i<50;i++)await fs.writeFile(path.join(source,`synthetic-${i}.txt`),'test environment, no business data\n');
  const manifest={format:'doon-cli-windows-v1',platform:'win32-x64',version,commit:'a'.repeat(40),sourceDirty:false,files:await inventory(source)};
  await fs.writeFile(path.join(source,'release.json'),JSON.stringify(manifest));
  const archive=source+'.zip',zipped=await run(['-File',zipScript,'-Source',source,'-Zip',archive]).done;assert.equal(zipped.code,0,zipped.output);
  const hash=createHash('sha256').update(await fs.readFile(archive)).digest('hex');
  return {source,manifest,target:path.join(programs,version+'-'+manifest.commit.slice(0,12)),args:['-File',launcher,'-Updater',path.join(old,'update.ps1'),'-Archive',archive,'-Hash',hash,'-Version',version,'-Commit',manifest.commit]};
 }
 const next=await pack('0.44.0');
 const lockScript=path.join(directory,'hold-lock.ps1');
 await fs.writeFile(lockScript,"param([string]$Path)\n$ErrorActionPreference='Stop'\n$Lock=[IO.File]::Open($Path,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)\ntry{[Console]::WriteLine('LOCKED');[Console]::ReadLine()|Out-Null}finally{$Lock.Dispose()}\n");
 const holder=run(['-File',lockScript,'-Path',path.join(install,'.install.lock')]);
 await Promise.race([new Promise(resolve=>holder.child.stdout.once('data',resolve)),holder.done.then(result=>{throw Error('Lock holder exited: '+result.output);})]);
 const first=run(next.args),second=run(next.args);
 await delay(2000);
 assert.equal(first.settled,false);assert.equal(second.settled,false);
 assert.equal(await fs.stat(next.target).then(()=>true,()=>false),false);
 holder.child.stdin.end('\n');assert.equal((await holder.done).code,0);
 for(const result of await Promise.all([first.done,second.done]))assert.equal(result.code,0,result.output);
 assert.deepEqual(await inventory(next.target),next.manifest.files);
 assert.deepEqual((await fs.readdir(programs)).sort(),[path.basename(old),path.basename(next.target)].sort());
 const repeat=await run(next.args).done;assert.equal(repeat.code,0,repeat.output);
 const newer=await pack('0.45.0'),updated=await run(newer.args).done;assert.equal(updated.code,0,updated.output);
 const stale=await run(next.args).done;assert.notEqual(stale.code,0);assert.match(stale.output,/newer CLI was installed/);
 assert.match(await fs.readFile(path.join(install,'bin/doon.cmd'),'utf8'),/0\.45\.0-aaaaaaaaaaaa/);
 // An explicit manual rollback remains supported and uses the same install lock.
 const rollback=await run(['-File',path.join(next.source,'install.ps1'),'-InstallRoot',install,'-SkipPathUpdate']).done;
 assert.equal(rollback.code,0,rollback.output);
 assert.match(await fs.readFile(path.join(install,'bin/doon.cmd'),'utf8'),/0\.44\.0-aaaaaaaaaaaa/);
 for(const [name,value]of Object.entries(state))assert.equal(await fs.readFile(path.join(install,name),'utf8'),value);
 assert.deepEqual(await inventory(next.target),next.manifest.files);
 assert.deepEqual(await inventory(newer.target),newer.manifest.files);
 assert.deepEqual(await fs.readdir(path.join(install,'bin')),['doon.cmd']);

 // Exercise UpdateService itself over loopback while the installed CMD entry
 // is still running, including replacing that entry and clearing the download.
 await fs.cp(path.join(root,'cli/dist'),path.join(old,'dist'),{recursive:true});
 await fs.writeFile(path.join(old,'package.json'),'{"type":"module"}');
 await fs.writeFile(path.join(old,'doon.cmd'),'@echo off\r\n@"'+process.execPath+'" "%~dp0invoke-update.mjs" %*\r\n');
 await fs.writeFile(path.join(old,'invoke-update.mjs'),`import {UpdateService} from './dist/update.js';
const config={format:'doon-cli-config-v1',origin:process.argv[2],localHttp:true};
const state={async config(){return config;},async session(){return {origin:config.origin,cookie:'doon_session='+'X'.repeat(43),expiresAt:Date.now()+60000};}};
console.log(JSON.stringify(await new UpdateService(state).install()));
`);
 await fs.writeFile(path.join(old,'release.json'),JSON.stringify({format:'doon-cli-windows-v1',platform:'win32-x64',version,commit:'b'.repeat(40),sourceDirty:false,files:await inventory(old)}));
 await fs.writeFile(path.join(install,'bin/doon.cmd'),'@echo off\r\n@call "%~dp0..\\programs\\'+path.basename(old)+'\\doon.cmd" %*\r\n');
 const bytes=await fs.readFile(newer.source+'.zip'),release={format:'doon-cli-update-v1',version:newer.manifest.version,commit:newer.manifest.commit,file:'doon-cli-'+newer.manifest.version+'-aaaaaaaaaaaa-windows-x64.zip',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),sourceDirty:false};
 const requests=[];
 const server=http.createServer((request,response)=>{
  requests.push({path:request.url,cookie:request.headers.cookie});
  if(request.url==='/api/cli-update/latest'){response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify(release));}
  else if(request.url==='/api/cli-update/package'){response.writeHead(200,{'Content-Type':'application/octet-stream'});response.end(bytes);}
  else{response.writeHead(404);response.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const invoke=path.join(directory,'invoke-installed.ps1');
  await fs.writeFile(invoke,"param([string]$Entry,[string]$Origin)\n$ErrorActionPreference='Stop'\n$env:PSModulePath=''\n& $Entry $Origin\nexit $LASTEXITCODE\n");
  const result=await run(['-File',invoke,'-Entry',path.join(install,'bin/doon.cmd'),'-Origin','http://127.0.0.1:'+server.address().port]).done;
  assert.equal(result.code,0,result.output);
  assert.deepEqual(JSON.parse(result.output),{updated:true,previousVersion:version,installedVersion:release.version,commit:release.commit,restartRequired:true});
  assert.deepEqual(requests.map(r=>r.path),['/api/cli-update/latest','/api/cli-update/package']);
  assert(requests.every(r=>r.cookie==='doon_session='+'X'.repeat(43)));
  assert.match(await fs.readFile(path.join(install,'bin/doon.cmd'),'utf8'),/0\.45\.0-aaaaaaaaaaaa/);
  for(const [name,value]of Object.entries(state))assert.equal(await fs.readFile(path.join(install,name),'utf8'),value);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
