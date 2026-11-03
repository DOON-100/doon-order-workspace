import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {deploymentPaths,pythonCommand,reserveReleaseProgram,snapshotProgram,writeDropinProgram,effectiveReleaseProgram,verifyReleaseProgram} from './safety.mjs';
import {loadConfig,validateConfig} from './config.mjs';

async function python(program,cfg){
 const command=pythonCommand(program,cfg),source=Buffer.from(command.split(' ')[1],'base64').toString();
 return new Promise((resolve,reject)=>{const child=spawn('python',['-c',source],{windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);child.on('exit',code=>resolve({code,out,err}));});
}
async function fixture(t){const base=path.resolve('test-output');await fs.mkdir(base,{recursive:true});const dir=await fs.mkdtemp(path.join(base,'deployment-safety-'));t.after(async()=>{assert.equal(path.dirname(dir),base);await fs.rm(dir,{recursive:true,force:true});});return dir;}
test('private target configuration is explicit and rejects unsafe or missing values',async t=>{
 const dir=await fixture(t),missing=loadConfig(path.join(dir,'missing.json'),{});assert.equal(missing.instance,undefined);assert.throws(()=>validateConfig(missing));
 const config={...JSON.parse(await fs.readFile(new URL('./config.example.json',import.meta.url),'utf8')),instance:'i-synthetic',region:'synthetic-region'};assert.equal(validateConfig(config),config);
 for(const patch of [{releasesDir:'/tmp/../live'},{releasesDir:'/releases'},{nodeBin:'/usr/bin/node;exit'},{healthHost:'host\nINJECTED'}])assert.throws(()=>validateConfig({...config,...patch}));
 const filename=path.join(dir,'private.json');await fs.writeFile(filename,JSON.stringify(config));assert.equal(loadConfig(filename,{WORKBENCH:'synthetic-workbench'}).workbench,'synthetic-workbench');
 assert.throws(()=>deploymentPaths('a'.repeat(40),'/tmp/../live'));assert(deploymentPaths('a'.repeat(40),'/custom/releases').releaseDir.startsWith('/custom/releases/'));
});
test('online backup includes committed WAL, excludes uncommitted writes, and never overwrites a snapshot',async t=>{
 const dir=await fixture(t),source=path.join(dir,'source.sqlite'),target=path.join(dir,'backup.sqlite');const db=new DatabaseSync(source);
 try{db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE synthetic(value TEXT); INSERT INTO synthetic VALUES('committed'); BEGIN IMMEDIATE; INSERT INTO synthetic VALUES('uncommitted');");
 const result=await python(snapshotProgram,{source,target});assert.equal(result.code,0,result.err);const report=JSON.parse(result.out);assert.equal(report.snapshot,'verified');const bytes=await fs.readFile(target);assert.equal(report.sha256,createHash('sha256').update(bytes).digest('hex'));
 const backup=new DatabaseSync(target,{readOnly:true});try{assert.deepEqual(backup.prepare('SELECT value FROM synthetic').all().map(r=>r.value),['committed']);}finally{backup.close();}
 assert.notEqual((await python(snapshotProgram,{source,target})).code,0);assert.deepEqual(await fs.readFile(target),bytes);db.exec('ROLLBACK');assert.equal(db.prepare('SELECT count(*) AS n FROM synthetic').get().n,1);
 }finally{db.close();}
});
test('every deployment has a fresh directory; existing releases and rollback points are preserved',async t=>{
 const dir=await fixture(t),target=path.join(dir,'release');await fs.mkdir(target);await fs.writeFile(path.join(target,'sentinel'),'KEEP');
 const result=await python(reserveReleaseProgram,{root:dir,target});assert.notEqual(result.code,0);assert.equal(await fs.readFile(path.join(target,'sentinel'),'utf8'),'KEEP');
 assert.equal((await python(reserveReleaseProgram,{root:dir,target:path.join(dir,'fresh')})).code,0);
 assert.notEqual((await python(reserveReleaseProgram,{root:target,target:dir})).code,0);
 const attempts=Array.from({length:100},()=>deploymentPaths('a'.repeat(40)));assert.equal(new Set(attempts.map(a=>a.releaseDir)).size,100);assert(attempts.every(a=>a.releaseDir.startsWith('/opt/app/releases/')));
 const deployment=await fs.readFile(new URL('./deploy.mjs',import.meta.url),'utf8');assert(!deployment.includes('rm -rf '));assert(!deployment.includes("'cp ' + DATA_DIR"));
});
test('new service config sorts last and preserves all previous config files',async t=>{
 const dir=await fixture(t),prior='zzzzzzzzz-20991231-main-fffffff.conf';await fs.writeFile(path.join(dir,prior),'OLD');
 const result=await python(writeDropinProgram,{directory:dir,stamp:'synthetic',content:'NEW'});assert.equal(result.code,0,result.err);const target=JSON.parse(result.out).dropin;assert(path.basename(target)>prior);assert.equal(await fs.readFile(path.join(dir,prior),'utf8'),'OLD');assert.equal(await fs.readFile(target,'utf8'),'NEW');
 let previous=path.basename(target);for(let index=0;index<5;index++){const next=await python(writeDropinProgram,{directory:dir,stamp:'synthetic-'+index,content:'NEXT'});assert.equal(next.code,0,next.err);const name=path.basename(JSON.parse(next.out).dropin);assert(name>previous);assert(name.length<100);previous=name;}assert.equal(await fs.readFile(target,'utf8'),'NEW');
 const mismatch=`import subprocess\nsubprocess.check_output=lambda *a,**k: ${JSON.stringify(dir.replaceAll('\\','/'))}\n`+effectiveReleaseProgram;
 const other=path.join(dir,'other');await fs.mkdir(other);assert.notEqual((await python(mismatch,{service:'synthetic.service',releaseDir:other})).code,0);
});
test('HTTP checks reject 403, 500, redirects, and unhealthy JSON; require both endpoints',async t=>{
 let status=200,healthy=true,rootStatus=200;const server=createServer((req,res)=>{res.statusCode=req.url==='/health'?status:rootStatus;if(res.statusCode===302)res.setHeader('Location','/health');res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:healthy}));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const origin='http://127.0.0.1:'+server.address().port,config={origin,host:'127.0.0.1:'+server.address().port,attempts:1};
 const program='import urllib.request,time\n'+verifyReleaseProgram.slice(verifyReleaseProgram.indexOf('opener='));
 assert.equal((await python(program,config)).code,0);
 for(const code of [403,500]){status=code;assert.notEqual((await python(program,config)).code,0);}
 status=200;healthy=false;assert.notEqual((await python(program,config)).code,0);healthy=true;
 for(const code of [500,302]){rootStatus=code;assert.notEqual((await python(program,config)).code,0);}
});
test('running PID, working directory, command line and manifest must match the target release',async t=>{
 const dir=await fixture(t),other=path.join(dir,'other');await fs.mkdir(other);await fs.writeFile(path.join(dir,'release.json'),JSON.stringify({commit:'a'.repeat(40)}));
 const prefix=String.raw`import subprocess
from pathlib import Path
original_resolve=Path.resolve
def resolve(self,*a,**kw):
 if str(self).replace(chr(92),'/')=='/proc/123/cwd': return original_resolve(Path(cfg['actual']),strict=True)
 return original_resolve(self,*a,**kw)
Path.resolve=resolve
Path.read_bytes=lambda self: (cfg['entry']+chr(0)).encode()
subprocess.check_output=lambda args,**kw: '123' if '--property=MainPID' in args else cfg['releaseDir']
`;
 const program=prefix+verifyReleaseProgram.slice(0,verifyReleaseProgram.indexOf('opener=')),config={service:'synthetic',releaseDir:dir,commit:'a'.repeat(40),actual:dir,entry:path.join(dir,'lan-dist','server.mjs')};
 assert.equal((await python(program,config)).code,0);
 for(const patch of [{actual:other},{entry:'wrong-entry'},{commit:'b'.repeat(40)}])assert.notEqual((await python(program,{...config,...patch})).code,0);
});

test('HTTPS gateway health probes preserve trusted loopback proxy headers',async t=>{
 const server=createServer((req,res)=>{const ok=req.headers.host==='gateway.test.invalid'&&req.headers['x-forwarded-host']==='gateway.test.invalid'&&req.headers['x-forwarded-proto']==='https'&&req.headers['x-forwarded-for']==='127.0.0.1';res.statusCode=ok?200:403;res.end(JSON.stringify({ok}));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const config={origin:'http://127.0.0.1:'+server.address().port,host:'gateway.test.invalid',attempts:1};const program='import urllib.request,time\n'+verifyReleaseProgram.slice(verifyReleaseProgram.indexOf('opener='));
 assert.notEqual((await python(program,config)).code,0);assert.equal((await python(program,{...config,proxyHttps:true})).code,0);
});
