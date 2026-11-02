// Synthetic loopback publisher and isolated Windows installation; no employee state.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {root,temporary,session} from './helpers.mjs';
import {StateStore} from '../dist/state.js';
import {inventory} from '../scripts/package-windows.mjs';

test('legacy bootstrap discovers custom installs and authenticates with independent encrypted state', {skip:process.platform!=='win32',timeout:180000},async t=>{
 const dir=await temporary(),home=path.join(dir,'自定义 安装','CLI'),old=path.join(home,'programs/0.42.0-bbbbbbbbbbbb');
 const appdata=path.join(dir,'synthetic profile'),config=path.join(appdata,'Doon/CLI');
 const shell=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
 function run(args,overrides={}){return new Promise((resolve,reject)=>{
  const env={...process.env};
  for(const [key,value]of Object.entries({TEMP:dir,TMP:dir,LOCALAPPDATA:appdata,DOON_CLI_HOME:'',Path:path.join(home,'bin')+path.delimiter+(process.env.Path||process.env.PATH||''),...overrides})){
   for(const prior of Object.keys(env))if(prior.toLowerCase()===key.toLowerCase())delete env[prior];env[key]=value;
  }
  const child=spawn(shell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass',...args],{windowsHide:true,stdio:'pipe',env});
  let output='';const timer=setTimeout(()=>child.kill(),60000);
  child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);child.on('error',reject);child.on('close',code=>{clearTimeout(timer);resolve({code,output});});
 });}
 async function packageAt(folder,version,commit){
  await fs.mkdir(path.join(folder,'dist'),{recursive:true});
  await fs.copyFile(process.execPath,path.join(folder,'node.exe'));
  for(const name of ['state.js','errors.js'])await fs.copyFile(path.join(root,'cli/dist',name),path.join(folder,'dist',name));
  await fs.writeFile(path.join(folder,'package.json'),'{"type":"module"}');
  await fs.writeFile(path.join(folder,'doon.cmd'),'@echo '+version+'\r\n');
  await fs.copyFile(path.join(root,'cli/windows/install.ps1'),path.join(folder,'install.ps1'));
  await fs.writeFile(path.join(folder,'release.json'),JSON.stringify({format:'doon-cli-windows-v1',platform:'win32-x64',version,commit,sourceDirty:false,files:await inventory(folder)}));
 }
 await packageAt(old,'0.42.0','b'.repeat(40));await fs.mkdir(path.join(home,'bin'));
 const shim='@echo off\r\n@call "%~dp0..\\programs\\0.42.0-bbbbbbbbbbbb\\doon.cmd" %*\r\n';
 await fs.writeFile(path.join(home,'bin/doon.cmd'),shim);
 const next=path.join(dir,'package'),archive=path.join(dir,'package.zip');await packageAt(next,'0.43.1','a'.repeat(40));
 const zip=path.join(dir,'zip.ps1');await fs.writeFile(zip,"param([string]$Source,[string]$Archive)\n$ErrorActionPreference='Stop'\nAdd-Type -AssemblyName System.IO.Compression.FileSystem\n[IO.Compression.ZipFile]::CreateFromDirectory($Source,$Archive)\n");
 const packed=await run(['-File',zip,'-Source',next,'-Archive',archive]);assert.equal(packed.code,0,packed.output);
 const bytes=await fs.readFile(archive),release={format:'doon-cli-update-v1',version:'0.43.1',commit:'a'.repeat(40),sourceDirty:false,file:'doon-cli-0.43.1-aaaaaaaaaaaa-windows-x64.zip',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
 const requests=[];let mode='valid';
 const server=http.createServer((req,res)=>{
  requests.push({path:req.url,cookie:req.headers.cookie});
  if(mode==='unauthorized'){res.writeHead(401);res.end();return;}
  if(req.url==='/api/cli-update/latest'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({...release,...(mode==='bad-hash'?{sha256:'0'.repeat(64)}:{})}));}
  else if(req.url==='/api/cli-update/package'){res.writeHead(200);res.end(bytes);}
  else{res.writeHead(404);res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
 const origin='http://127.0.0.1:'+server.address().port,store=new StateStore(config);
 await store.setup(origin,true);await store.saveSession(session(origin));
 const preserved=Object.fromEntries(await Promise.all(['config.json','session.dpapi'].map(async name=>[name,await fs.readFile(path.join(config,name),'utf8')])));
 const script=path.join(root,'cli/windows/upgrade-legacy.ps1'),args=['-File',script,'-ExpectedOrigin',origin];
 const mismatch=await run([...args.slice(0,-1),'https://wrong.example']);assert.notEqual(mismatch.code,0);assert.equal(requests.length,0);
 for(const rejected of ['unauthorized','bad-hash']){
  mode=rejected;const result=await run(args);assert.notEqual(result.code,0,result.output);assert.equal(await fs.readFile(path.join(home,'bin/doon.cmd'),'utf8'),shim);
 }
 mode='valid';requests.length=0;
 const override=path.join(dir,'separate credentials'),overrideStore=new StateStore(override);
 await overrideStore.setup(origin,true);await overrideStore.saveSession({...session(origin),cookie:'doon_session='+'Y'.repeat(43)});
 const savedOverride=await fs.readFile(path.join(override,'session.dpapi'),'utf8');
 const overrideCheck=await run([...args,'-DownloadOnly'],{DOON_CLI_HOME:override});assert.equal(overrideCheck.code,0,overrideCheck.output);
 assert(requests.length===2&&requests.every(r=>r.cookie==='doon_session='+'Y'.repeat(43)));
 assert.equal(await fs.readFile(path.join(override,'session.dpapi'),'utf8'),savedOverride);requests.length=0;
 const download=await run([...args,'-DownloadOnly']);assert.equal(download.code,0,download.output);assert.equal(await fs.readFile(path.join(home,'bin/doon.cmd'),'utf8'),shim);
 assert.deepEqual(requests.map(r=>r.path),['/api/cli-update/latest','/api/cli-update/package']);requests.length=0;
 const upgraded=await run(args);assert.equal(upgraded.code,0,upgraded.output);assert.match(upgraded.output,/CLI upgraded to 0.43.1/);
 assert.deepEqual(requests.map(r=>r.path),['/api/cli-update/latest','/api/cli-update/package']);assert(requests.every(r=>r.cookie===session(origin).cookie));
 assert.match(await fs.readFile(path.join(home,'bin/doon.cmd'),'utf8'),/0\.43\.1-aaaaaaaaaaaa/);
 for(const [name,value]of Object.entries(preserved))assert.equal(await fs.readFile(path.join(config,name),'utf8'),value);
 assert.equal(await fs.stat(path.join(home,'config.json')).then(()=>true,()=>false),false);
 const repeat=await run(args);assert.equal(repeat.code,0,repeat.output);assert.match(repeat.output,/Already current/);
 // With no CLI on PATH, explicit roots and the normal per-user installation
 // both work. Default config already exists and must survive package placement.
 const systemPath=path.dirname(shell)+path.delimiter+path.join(process.env.SystemRoot,'System32');
 const explicit=await run([...args,'-InstallRoot',home],{Path:systemPath});assert.equal(explicit.code,0,explicit.output);
 await fs.mkdir(path.join(config,'programs'),{recursive:true});
 await fs.cp(path.join(home,'programs/0.43.1-aaaaaaaaaaaa'),path.join(config,'programs/0.43.1-aaaaaaaaaaaa'),{recursive:true});
 await fs.cp(path.join(home,'bin'),path.join(config,'bin'),{recursive:true});
 const fallback=await run(args,{Path:systemPath});assert.equal(fallback.code,0,fallback.output);assert.match(fallback.output,/Already current/);
 // A PATH entry that is not an installed CLI must never cause a silent update
 // of a different default installation or execute that unrelated command.
 const foreign=path.join(dir,'foreign');await fs.mkdir(foreign);await fs.writeFile(path.join(foreign,'doon.cmd'),'@echo should-never-run\r\n');requests.length=0;
 const unsupported=await run(args,{Path:foreign+path.delimiter+systemPath});assert.notEqual(unsupported.code,0);assert.match(unsupported.output,/not an installed bin entry/);assert.equal(requests.length,0);
 for(const [name,value]of Object.entries(preserved))assert.equal(await fs.readFile(path.join(config,name),'utf8'),value);
 assert.equal((await fs.readdir(dir)).filter(n=>n.startsWith('doon-cli-bootstrap-')).length,0);
});
