// Actual HTTP server and API, isolated synthetic data only. The comparison
// disables the optional native snapshot reader in a temporary baseline build;
// it does not alter the working tree, deployment build or any production data.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {performance} from 'node:perf_hooks';
import {build} from 'esbuild';

await fs.mkdir('test-output',{recursive:true});
for(const name of Object.keys(process.env))if(/^DOON_KINGDEE_/i.test(name))delete process.env[name];
const root=await fs.mkdtemp(path.resolve('test-output/snapshot-responsiveness-')),data=path.join(root,'data');
const env={...Object.fromEntries(Object.entries(process.env).filter(([name])=>!/^DOON_KINGDEE_/i.test(name))),DOON_DATA_DIR:data,DOON_HOST:'127.0.0.1',DOON_NO_AUTO_BACKUP:'1',DOON_STUDIO_SCHEDULES_ENABLED:'0',DOON_IE_MAIL_ENABLED:'0',DOON_KINGDEE_SUPPLIER_SYNC_ENABLED:'0',DOON_KINGDEE_READONLY_ENABLED:'0',DOON_EMPLOYEE_PUBLIC_ORIGIN:'',DOON_SERVER_MODE:'internal',DOON_REVIEW_MODE:'0',DOON_SYNTHETIC_ONLY:'1',DOON_TLS_CERT:'',DOON_TLS_KEY:''};
assert(root.startsWith(path.resolve('test-output')+path.sep));
const directories={};
for(const mode of ['cooperative','blocking']){
 const dist=path.join(root,mode);directories[mode]=dist;await fs.mkdir(path.join(dist,'client'),{recursive:true});
 for(const name of ['runtime.mjs','ie-mail.mjs','auth.mjs','personnel.mjs','server.mjs','supplier-gateway.mjs','employee-gateway.mjs','supplier-catalog-job.mjs','fixed-scheduler.mjs','fixed-schedule.mjs'])await fs.copyFile(path.join('standalone',name),path.join(dist,name));
 await fs.writeFile(path.join(dist,'client/index.html'),'<html>测试环境，不含正式业务数据</html>');
 await build({entryPoints:['standalone/agent-schedules.mjs'],outfile:path.join(dist,'agent-schedules.mjs'),bundle:true,platform:'node',format:'esm',packages:'external'});
 await build({entryPoints:['app/api/workspace/[action]/route.ts'],outfile:path.join(dist,'workspace-api.mjs'),bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@':process.cwd()},plugins:[{name:'native-bindings',setup(b){b.onResolve({filter:/^cloudflare:workers$|chatgpt-auth$/},()=>({path:'./runtime.mjs',external:true}));}}]});
 if(mode==='blocking'){
  const file=path.join(dist,'runtime.mjs'),source=await fs.readFile(file,'utf8');assert(source.includes(',readSnapshot,batch:'));
  await fs.writeFile(file,source.replace(',readSnapshot,batch:',',batch:'));
 }
}
process.env.DOON_DATA_DIR=data;
const runtime=await import(pathToFileURL(path.join(directories.cooperative,'runtime.mjs')).href),db=runtime.db;
const token=Buffer.alloc(32,7).toString('base64url'),cookie='doon_session='+token;
const member={id:'synthetic-member',kind:'member',userId:'synthetic-account',name:'Synthetic admin',email:'synthetic@example.invalid',role:'admin',active:true,owner:true,customers:[],departments:[],createdAt:'2026-01-01T00:00:00Z'};
const order={id:'synthetic-order',kind:'order',orderNo:'SYNTHETIC',customer:'Synthetic customer',drawing:'Synthetic',color:'Synthetic',lens:'Synthetic',quantity:1,ownerEmail:member.email,version:1,createdAt:'2026-01-01T00:00:00Z'};
const put=db.prepare('INSERT INTO records(id,kind,data) VALUES(?,?,?)'),insert=row=>put.run(row.id,row.kind,JSON.stringify(row));
db.exec('BEGIN');insert(member);insert(order);
const auditCount=15651,exportCount=17,padding='x'.repeat(Math.ceil((119*1024*1024-exportCount*1024*1024)/auditCount));
for(let i=0;i<auditCount;i++)insert({id:'synthetic-audit-'+i,kind:'audit',targetId:order.id,lineId:order.id,action:'Synthetic retained history',before:null,after:{...order,quantity:i},padding});
for(let i=0;i<exportCount;i++)insert({id:'synthetic-export-'+i,kind:'export',actorId:member.id,filename:'synthetic.xlsx',orderIds:[order.id],lines:[{padding:'x'.repeat(1024*1024)}]});
db.prepare('INSERT INTO local_accounts VALUES(?,?,?,?,0,?)').run('synthetic-account','synthetic',member.id,'synthetic-unused-hash','2026-01-01');
db.prepare('INSERT INTO local_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),'synthetic-account',Date.now()+3600000,Date.now());
db.exec('COMMIT');
const payload=db.prepare('SELECT sum(length(CAST(data AS BLOB))) bytes,max(length(CAST(data AS BLOB))) maxRowBytes,count(*) records FROM records').get();
assert(payload.bytes>=119*1024*1024);
function recordsHash(connection){const h=createHash('sha256');for(const row of connection.prepare('SELECT id,kind,data FROM records ORDER BY id').iterate())h.update(JSON.stringify(row));return h.digest('hex');}
const before=recordsHash(db),accountsBefore=JSON.stringify(db.prepare('SELECT * FROM local_accounts ORDER BY id').all());db.close();
const statistics={syntheticOnly:true,payload,rounds:{}};
const memoryMonitor=path.join(root,'synthetic-memory-monitor.mjs');
await fs.writeFile(memoryMonitor,"const sample=()=>process.send?.({syntheticMemory:process.memoryUsage()});sample();setInterval(sample,25).unref();");
async function launch(mode){
 const port=await new Promise((resolve,reject)=>{const socket=net.createServer();socket.on('error',reject);socket.listen(0,'127.0.0.1',()=>{const value=socket.address().port;socket.close(()=>resolve(value));});});assert.notEqual(port,8787);
 const origin='http://127.0.0.1:'+port,child=spawn(process.execPath,['--max-old-space-size=768','--import',pathToFileURL(memoryMonitor).href,path.join(directories[mode],'server.mjs')],{env:{...env,DOON_PORT:String(port)},stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
 const peak={rss:0,heapUsed:0,external:0};child.on('message',message=>{if(message.syntheticMemory)for(const key of Object.keys(peak))peak[key]=Math.max(peak[key],message.syntheticMemory[key]);});
 const exited=new Promise(resolve=>child.once('exit',resolve));let logs='';child.stdout.on('data',v=>logs+=v);child.stderr.on('data',v=>logs+=v);
 for(let i=0;i<150;i++){try{if((await fetch(origin+'/health')).ok)return {origin,child,exited,peak,logs:()=>logs};}catch{}await delay(50);}child.kill();await exited;throw Error('Synthetic server did not start: '+logs);
}
function percentile(values,p){return [...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))];}
for(const [round,mode,workspaceReads] of [['blocking','blocking',3],['cooperative','cooperative',3],['twentyReaders','cooperative',20]]){
 const server=await launch(mode);
 try{
  const url=server.origin,headers={Cookie:cookie,'Accept-Encoding':'identity'};
  const enrollment=await fetch(url+'/api/workspace/enroll',{method:'POST',headers:{...headers,Origin:url,'Content-Type':'application/json'},body:'{}'});assert.equal(enrollment.status,200);await enrollment.arrayBuffer();
  const timing=[];let completed=0;
  const start=performance.now();
  const reads=Array.from({length:workspaceReads},async()=>{const response=await fetch(url+'/api/workspace/data',{headers});assert.equal(response.status,200);const value=await response.json();assert.equal(value.audits.length,250);assert.equal(value.exports.length,exportCount);assert.equal(value.me.id,member.id);completed++;});
  for(const pending of reads)pending.catch(()=>{}); // Observe early failures; finally still stops the test server.
  await delay(15);
  const probes=[];
  let concurrentEnrollment;
  if(workspaceReads===20)probes.push((async()=>{const started=performance.now(),response=await fetch(url+'/api/workspace/enroll',{method:'POST',headers:{...headers,Origin:url,'Content-Type':'application/json'},body:'{}'});assert.equal(response.status,200);await response.arrayBuffer();concurrentEnrollment={milliseconds:Math.round(performance.now()-started),completedWorkspaceReads:completed};})());
  for(let i=0;i<20;i++){
   probes.push((async()=>{const started=performance.now(),response=await fetch(url+'/api/auth/session',{headers});assert.equal(response.status,200);const value=await response.json();assert.equal(value.user.username,'synthetic');timing.push({milliseconds:performance.now()-started,completedWorkspaceReads:completed});})());
   probes.at(-1).catch(()=>{});
   await delay(10);
  }
  await Promise.all([...reads,...probes]);
  const elapsed=performance.now()-start,latencies=timing.map(value=>value.milliseconds);
  statistics.rounds[round]={workspaceReads,sessionReads:timing.length,elapsedMs:Math.round(elapsed),sessionP95Ms:Math.round(percentile(latencies,.95)),sessionMaxMs:Math.round(Math.max(...latencies)),sessionsBeforeWorkspaceCompletion:timing.filter(value=>value.completedWorkspaceReads<workspaceReads).length,peakMemoryBytes:server.peak,...(concurrentEnrollment?{concurrentEnrollment}:{})};
  const source=new DatabaseSync(path.join(data,'workspace.sqlite'),{readOnly:true});try{assert.equal(recordsHash(source),before);assert.equal(JSON.stringify(source.prepare('SELECT * FROM local_accounts ORDER BY id').all()),accountsBefore);}finally{source.close();}
 }finally{server.child.kill();await server.exited;await fs.writeFile(path.join(root,round+'-server.log'),server.logs());}
}
const a=statistics.rounds.blocking,b=statistics.rounds.cooperative;
statistics.recordsAndAccountsPreserved=true;
await fs.writeFile(path.join(root,'result.json'),JSON.stringify(statistics,null,2));
console.log(JSON.stringify(statistics));
assert(b.sessionsBeforeWorkspaceCompletion>0,'Sessions must be served while large workspace reads are in progress');
assert(b.sessionP95Ms<2000,'Synthetic session p95 must stay below 2 seconds, well within the Studio 8-second deadline');
assert(b.sessionP95Ms<a.sessionP95Ms*.75,'Cooperative reads must materially improve measured session latency against the same blocking workload');
const c=statistics.rounds.twentyReaders;
assert(c.sessionP95Ms<2000&&c.sessionsBeforeWorkspaceCompletion===20,'Sessions must stay responsive under twenty queued full reads');
assert(c.concurrentEnrollment.milliseconds<2000&&c.concurrentEnrollment.completedWorkspaceReads<20,'Member-only enrollment must bypass the bulk reader queue');
assert(c.peakMemoryBytes.rss>0&&c.peakMemoryBytes.rss<1280*1024*1024,'Twenty readers must complete below 1.25 GiB RSS with a 768 MiB heap limit');
console.log('PASS 119 MiB retained-history HTTP workload, responsive authenticated sessions and unchanged original records/accounts. Report: '+path.join(root,'result.json'));
