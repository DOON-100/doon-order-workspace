// Test environment, synthetic data only; no real ERP credentials or network requests.
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp} from 'node:fs/promises';
import {createServer} from 'node:net';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';

const dist=path.resolve(process.env.DOON_BUILD_DIR||'lan-dist'),dir=await mkdtemp(path.resolve('test-output/supplier-scheduler-server-'));
const probe=createServer();await new Promise((resolve,reject)=>probe.once('error',reject).listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
const env=Object.fromEntries(Object.entries(process.env).filter(([name])=>!/^DOON_/i.test(name)));
Object.assign(env,{DOON_DATA_DIR:dir,DOON_HOST:'127.0.0.1',DOON_PORT:String(port),DOON_NO_AUTO_BACKUP:'1',DOON_SYNTHETIC_ONLY:'1',DOON_KINGDEE_READONLY_ENABLED:'0'});
async function start(extra={},headers={}){
 const child=spawn(process.execPath,[path.join(dist,'server.mjs')],{env:{...env,...extra},stdio:'pipe',windowsHide:true});let exited=false,output='',lastStatus='unreachable';const done=new Promise(resolve=>child.once('exit',code=>{exited=true;resolve(code)}));child.stdout.on('data',chunk=>{output+=chunk});child.stderr.on('data',chunk=>{output+=chunk});
 for(let i=0;i<100&&!exited;i++){try{const status=await new Promise((resolve,reject)=>http.get({hostname:'127.0.0.1',port,path:'/health',headers},res=>{res.resume();resolve(res.statusCode)}).on('error',reject));lastStatus=String(status);if(status===200)return {child,done,getOutput:()=>output}}catch{}await new Promise(resolve=>setTimeout(resolve,50));}
 if(!exited)child.kill();await done;throw Error('Synthetic server did not start ('+lastStatus+'): '+output.slice(0,1000));
}
async function stop(server){server.child.kill();await server.done;}
async function expectOutput(server,message){for(let i=0;i<40;i++){if(server.getOutput().includes(message))return;await new Promise(resolve=>setTimeout(resolve,25));}assert(server.getOutput().includes(message));}
async function expectFailedAttempt(){for(let i=0;i<100;i++){const db=new DatabaseSync(path.join(dir,'workspace.sqlite'),{readOnly:true});let row;try{row=db.prepare("SELECT last_result,last_attempt_at FROM kingdee_supplier_catalog_schedule_status WHERE id='scheduler'").get();}finally{db.close();}if(row?.last_result==='failed')return row;await new Promise(resolve=>setTimeout(resolve,50));}throw Error('Synthetic first attempt was not recorded');}
let server=await start();await stop(server);
let db=new DatabaseSync(path.join(dir,'workspace.sqlite'),{readOnly:true});assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='kingdee_supplier_catalog_lease'").get().n,0);db.close();
server=await start({DOON_KINGDEE_SUPPLIER_SYNC_ENABLED:'1'});const initialAttempt=await expectFailedAttempt();await stop(server);
db=new DatabaseSync(path.join(dir,'workspace.sqlite'),{readOnly:true});assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('kingdee_supplier_catalog_lease','kingdee_supplier_catalog_schedule_status')").get().n,2);assert.equal(db.prepare('SELECT count(*) AS n FROM kingdee_supplier_catalog_schedule_status').get().n,1);assert.equal(db.prepare("SELECT count(*) AS n FROM records WHERE kind='kingdee_supplier_catalog'").get().n,0);db.close();
server=await start({DOON_KINGDEE_SUPPLIER_SYNC_ENABLED:'1'});await new Promise(resolve=>setTimeout(resolve,1500));await stop(server);
db=new DatabaseSync(path.join(dir,'workspace.sqlite'),{readOnly:true});assert.equal(db.prepare("SELECT last_attempt_at FROM kingdee_supplier_catalog_schedule_status WHERE id='scheduler'").get().last_attempt_at,initialAttempt.last_attempt_at);db.close();
server=await start({DOON_REVIEW_MODE:'1',DOON_KINGDEE_SUPPLIER_SYNC_ENABLED:'1'});await expectOutput(server,'当前入口未启动金蝶供应商定时同步');await stop(server);
server=await start({DOON_SERVER_MODE:'supplier',DOON_SUPPLIER_PUBLIC_ORIGIN:'https://example.test',DOON_KINGDEE_SUPPLIER_SYNC_ENABLED:'1'},{Host:'example.test','X-Forwarded-Proto':'https'});await expectOutput(server,'当前入口未启动金蝶供应商定时同步');await stop(server);
server=await start({DOON_KINGDEE_SUPPLIER_SYNC_ENABLED:'1',DOON_KINGDEE_SUPPLIER_SYNC_INTERVAL_SECONDS:'invalid'});await expectOutput(server,'金蝶供应商定时同步未启动');await stop(server);
db=new DatabaseSync(path.join(dir,'workspace.sqlite'),{readOnly:true});assert.equal(db.prepare('SELECT count(*) AS n FROM kingdee_supplier_catalog_schedule_status').get().n,1);assert.equal(db.prepare("SELECT last_attempt_at FROM kingdee_supplier_catalog_schedule_status WHERE id='scheduler'").get().last_attempt_at,initialAttempt.last_attempt_at);assert.equal(db.prepare("SELECT count(*) AS n FROM records WHERE kind='kingdee_supplier_catalog'").get().n,0);db.close();
console.log('PASS supplier scheduler startup: default off, immediate first attempt, restart retains daily schedule, review/supplier/invalid configuration keep service available without sync');
