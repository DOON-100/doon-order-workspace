// Temporary synthetic browser acceptance; never uses the live database or listener.
// Build into test-output/loss-build (or DOON_BUILD_DIR under test-output) first.
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {randomBytes,randomUUID} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import * as XLSX from 'xlsx';
import assert from 'node:assert/strict';

const args=process.argv.slice(2);
if(args.length===1&&args[0]==='--help'){
 console.log('node standalone/preview-losses.mjs [--duration-seconds 600]\n本机合成验收，默认 10 分钟后关闭并清理临时数据；最长 3600 秒。随机登录信息只保存在返回的 credentialsFile 中，不输出口令。DOON_BUILD_DIR 仅接受 test-output 内的独立构建。');
 process.exit(0);
}
if(args.length&&!(args.length===2&&args[0]==='--duration-seconds'&&/^\d+$/.test(args[1])))throw Error('用法：node standalone/preview-losses.mjs [--duration-seconds 600]');
const duration=Number(args[1]||600);
if(!Number.isInteger(duration)||duration<1||duration>3600)throw Error('验收时长须为 1 至 3600 秒。');
const output=path.resolve('test-output');
await fs.mkdir(output,{recursive:true});
const dist=await fs.realpath(path.resolve(process.env.DOON_BUILD_DIR||'test-output/loss-build'));
const outputReal=await fs.realpath(output),relativeBuild=path.relative(outputReal,dist);
if(!relativeBuild||relativeBuild.startsWith('..')||path.isAbsolute(relativeBuild))throw Error('验收构建必须位于 test-output 内，不得使用正式 lan-dist。');
for(const file of ['manage.mjs','server.mjs'])await fs.access(path.join(dist,file));
const port=await new Promise((resolve,reject)=>{
 const probe=net.createServer();probe.once('error',reject);
 probe.listen(0,'127.0.0.1',()=>{const selected=probe.address().port;probe.close(error=>error?reject(error):resolve(selected));});
});
assert(![8787,8797].includes(port),'Cannot use protected service ports');
const origin='http://127.0.0.1:'+port,root=await fs.mkdtemp(path.join(output,'loss-preview-'));
const statusFile=path.join(output,'loss-preview-status.json'),credentialsFile=path.join(root,'synthetic-credentials.json');
const env={...Object.fromEntries(Object.entries(process.env).filter(([name])=>!/^DOON_/i.test(name))),DOON_SYNTHETIC_ONLY:'1',DOON_KINGDEE_SUPPLIER_SYNC_ENABLED:'0',DOON_KINGDEE_READONLY_ENABLED:'0',DOON_DATA_DIR:root,DOON_HOST:'127.0.0.1',DOON_PORT:String(port),DOON_NO_AUTO_BACKUP:'1'};
const adminPassword=randomBytes(24).toString('base64url'),initialUserPassword=randomBytes(24).toString('base64url'),userPassword=randomBytes(24).toString('base64url');
const controller=new AbortController();
let server,exited,serverDone=false,serverError,deadline,forceStop,cookie='',stopped=false;
function stop(){
 stopped=true;controller.abort();
 if(server&&!serverDone){server.kill();if(!forceStop)forceStop=setTimeout(()=>{if(!serverDone)server.kill('SIGKILL');},2000);}
}
process.once('SIGINT',stop);process.once('SIGTERM',stop);
const request=(url,options={})=>fetch(url,{...options,signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});
async function api(route,body){
 const response=await request(origin+'/api/'+route,{method:body===undefined?'GET':'POST',headers:{Origin:origin,...(body instanceof FormData?{}:{'Content-Type':'application/json'}),Cookie:cookie},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});
 if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
 const data=await response.json();assert.equal(response.status,200,'Synthetic API failed: '+route);return data;
}
try{
 try{execFileSync(process.execPath,[path.join(dist,'manage.mjs'),'init'],{env,stdio:'pipe',windowsHide:true,timeout:30000});}
 catch{throw Error('临时合成环境初始化失败。');}
 controller.signal.throwIfAborted();
 const initial=(await fs.readFile(path.join(root,'管理员首次登录.txt'),'utf8')).match(/初始密码：([^\n]+)/)?.[1];
 assert(initial,'Synthetic initial credential was not created');
 server=spawn(process.execPath,[path.join(dist,'server.mjs')],{env,stdio:['ignore','ignore','pipe'],windowsHide:true});
 // Do not forward child output: synthetic credentials must never enter logs.
 server.stderr.resume();
 exited=new Promise(resolve=>{
  server.once('error',error=>{serverError=error;});
  server.once('close',(code,signal)=>{serverDone=true;if(!stopped&&!serverError)serverError=Error('Synthetic server exited: '+(signal||code));resolve();});
 });
 let ready=false;
 for(let i=0;i<100&&!stopped;i++){
  if(serverDone)throw serverError||Error('Synthetic server stopped before startup');
  try{
   const status=JSON.parse(await fs.readFile(path.join(root,'server-status.json'),'utf8'));
   // Check our child before making any request, even if the selected port was taken.
   if(status.pid===server.pid&&status.port===port&&(await request(origin+'/health')).ok){ready=true;break;}
  }catch(error){if(controller.signal.aborted)throw error;}
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert(ready,'Synthetic server did not become ready');
 await api('auth/login',{username:'admin',password:initial});
 await api('auth/password',{currentPassword:initial,password:adminPassword});
 await fs.rm(path.join(root,'管理员首次登录.txt'));
 await api('auth/accounts',{username:'lossqa',name:'胶架损耗验收',role:'clerk',departments:['plastic'],password:initialUserPassword,customers:[]});
 const sheet={I3:{t:'s',v:'订单号'},M3:{t:'s',v:'订单数量'},BF3:{t:'s',v:'包装入仓数量'}};
 for(let r=4;r<7;r++)for(const [column,value] of Object.entries({I:'LOSS-DEMO-'+(r-3),J:'DN-LOSS-'+r,C:'测试客户',H:'白片',L:'C1',M:200,N:220,AV:220,AX:210,BD:204,BF:0}))sheet[column+r]={t:typeof value==='number'?'n':'s',v:value};
 sheet['!ref']='A1:BF6';
 const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'动态表');
 const form=new FormData();form.set('file',new File([XLSX.write(book,{type:'buffer',bookType:'xlsx'})],'损耗验收测试.xlsx'));form.set('mode','active');
 const job=await api('workspace/ledger-preview',form);await api('workspace/ledger-commit',{id:job.id,offset:0});
 const data=await api('workspace/data'),order=data.orders[1],today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
 await api('workspace/loss-record',{lineId:order.id,version:order.version,process:'assembly',department:'plastic',input:210,wip:0,reportDate:today,reason:'验收测试：钉装破损六副',token:randomUUID()});
 const exported=await request(origin+'/api/workspace/loss-export?month='+today.slice(0,7),{headers:{Cookie:cookie}});
 assert.equal(exported.status,200);await fs.writeFile(path.join(root,'部门损耗验收月报.xlsx'),new Uint8Array(await exported.arrayBuffer()));
 cookie='';await api('auth/login',{username:'lossqa',password:initialUserPassword});await api('auth/password',{currentPassword:initialUserPassword,password:userPassword});
 const expiresAt=new Date(Date.now()+duration*1000).toISOString();
 await fs.writeFile(credentialsFile,JSON.stringify({syntheticOnly:true,origin,expiresAt,accounts:[{username:'admin',password:adminPassword},{username:'lossqa',password:userPassword}]},null,2),{mode:0o600,flag:'wx'});
 await fs.writeFile(statusFile,JSON.stringify({root,port,origin,pid:server.pid,syntheticOnly:true,credentialsFile,expiresAt}));
 console.log(JSON.stringify({root,origin,pid:server.pid,ready:true,syntheticOnly:true,credentialsFile,expiresAt}));
 deadline=setTimeout(stop,duration*1000);
 await exited;
 if(serverError)throw serverError;
}catch(error){if(!stopped)throw error;}
finally{
 clearTimeout(deadline);controller.abort();
 if(server&&!serverDone){server.kill();if(!forceStop)forceStop=setTimeout(()=>{if(!serverDone)server.kill('SIGKILL');},2000);await exited;}
 clearTimeout(forceStop);
 process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
 // Only remove this invocation's temporary directory and status, never a build or another run.
 const resolvedRoot=await fs.realpath(root);
 assert.equal(path.dirname(resolvedRoot),outputReal);assert(path.basename(resolvedRoot).startsWith('loss-preview-'));
 await fs.rm(resolvedRoot,{recursive:true,force:true,maxRetries:3,retryDelay:100});
 try{const status=JSON.parse(await fs.readFile(statusFile,'utf8'));if(status.root===root)await fs.rm(statusFile);}
 catch(error){if(error.code!=='ENOENT')throw error;}
}
