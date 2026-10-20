// Synthetic HTTP integration only. No existing database or production port.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {personnelTypeOf} from './personnel.mjs';

const dist=path.resolve(process.env.DOON_BUILD_DIR||'test-output/personnel-build'),dir=await fs.mkdtemp(path.resolve('test-output/personnel-http-')),origin='http://127.0.0.1:19918';
const env={...process.env,DOON_DATA_DIR:dir,DOON_HOST:'127.0.0.1',DOON_PORT:'19918',DOON_NO_AUTO_BACKUP:'1',DOON_EMPLOYEE_PUBLIC_ORIGIN:'',DOON_STUDIO_SCHEDULES_ENABLED:'0',DOON_REVIEW_MODE:'0',DOON_SERVER_MODE:'internal'};
execFileSync(process.execPath,[path.join(dist,'manage.mjs'),'init'],{env,stdio:'pipe',windowsHide:true});
const initial=(await fs.readFile(path.join(dir,'管理员首次登录.txt'),'utf8')).match(/初始密码：([^\n]+)/)[1];
const db=new DatabaseSync(path.join(dir,'workspace.sqlite')),server=spawn(process.execPath,[path.join(dist,'server.mjs')],{env,stdio:'ignore',windowsHide:true});
let cookie='';
async function call(route,body,auth=cookie){const r=await fetch(origin+route,{method:body===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json',...(auth?{Cookie:auth}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await r.json();return{status:r.status,data,cookie:r.headers.get('set-cookie')?.split(';')[0]};}
async function ok(route,body,auth){const r=await call(route,body,auth);assert.equal(r.status,200,JSON.stringify(r.data));return r;}
try{
 for(let n=0;n<80;n++){try{if((await fetch(origin+'/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 cookie=(await ok('/api/auth/login',{username:'admin',password:initial})).cookie;
 cookie=(await ok('/api/auth/password',{currentPassword:initial,password:'SYN-Personnel-Admin-2026!'})).cookie;
 const session=await ok('/api/auth/session');assert.equal(session.data.user.personnelType,'internal');
 const original=JSON.parse(db.prepare("SELECT data FROM records WHERE kind='member'").get().data),legacy={...original};delete legacy.personnelType;
 db.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify(legacy),legacy.id);
 assert.equal((await ok('/api/auth/session')).data.user.personnelType,'internal');
 assert.deepEqual(JSON.parse(db.prepare('SELECT data FROM records WHERE id=?').get(legacy.id).data),legacy,'读取旧成员不得重写历史记录');
 await ok('/api/auth/accounts',{username:'syn_external',name:'SYN外部程序员',role:'programmer',personnelType:'external',password:'SYN-External-2026!'});
 let external=(await ok('/api/auth/login',{username:'syn_external',password:'SYN-External-2026!'}));assert.equal(external.data.user.personnelType,'external');
 const externalCookie=(await ok('/api/auth/password',{currentPassword:'SYN-External-2026!',password:'SYN-External-Changed-2026!'},external.cookie)).cookie;
 let member=(await ok('/api/workspace/data')).data.members.find(m=>m.name==='SYN外部程序员');
 const protectedBefore=db.prepare('SELECT id,password_hash,must_change FROM local_accounts WHERE member_id=?').get(member.id);
 await ok('/api/workspace/member',{...member,personnelType:'internal'});
 assert.equal((await ok('/api/auth/session',undefined,externalCookie)).data.user.personnelType,'internal','既有会话逐次读取最新类型');
 await ok('/api/workspace/member',{...member,personnelType:'external'});
 assert.equal((await ok('/api/auth/session',undefined,externalCookie)).data.user.personnelType,'external');
 assert.equal((await ok('/api/workspace/data',undefined,externalCookie)).data.members.find(m=>m.id===member.id).personnelType,'external','成员显示不能把已标注外部的账号当成旧内部成员');
 assert.deepEqual(db.prepare('SELECT id,password_hash,must_change FROM local_accounts WHERE member_id=?').get(member.id),protectedBefore);
 assert.equal((await call('/api/workspace/member',{...member,personnelType:'internal'},externalCookie)).status,403);
 assert.equal((await call('/api/auth/accounts',{username:'syn_bad',name:'SYN',role:'viewer',personnelType:'unknown',password:'SYN-Invalid-2026!'})).status,400);
 assert.equal(personnelTypeOf({role:'supplier',personnelType:'internal'}),'external');
 assert.equal(personnelTypeOf({role:'viewer'}),'internal');
 assert.equal(personnelTypeOf({role:'admin',personnelType:'invalid'}),'external');
 console.log('PASS 人员类型默认兼容旧账号且不重写记录；创建/编辑严格校验，当前会话立即反映分类，账号密码和原业务授权保持');
}finally{server.kill();await new Promise(resolve=>server.exitCode!==null?resolve():server.once('exit',resolve));db.close();await fs.rm(dir,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
