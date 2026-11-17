// Isolated synthetic accounts and database only; never points at the production service.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import net from 'node:net';
import {spawn,execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const dist=path.resolve(process.env.DOON_BUILD_DIR||'test-output/drawing-assignment-build');
const dir=await fs.mkdtemp(path.resolve('test-output/assignment-roster-'));
const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const origin=`http://127.0.0.1:${port}`;
const env={...Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('DOON_'))),DOON_DATA_DIR:dir,DOON_HOST:'127.0.0.1',DOON_PORT:String(port),DOON_NO_AUTO_BACKUP:'1',DOON_KINGDEE_SUPPLIER_SYNC_ENABLED:'0',DOON_KINGDEE_READONLY_ENABLED:'0'};
execFileSync(process.execPath,[path.join(dist,'manage.mjs'),'init'],{env,stdio:'pipe',windowsHide:true});
const initial=(await fs.readFile(path.join(dir,'管理员首次登录.txt'),'utf8')).match(/初始密码：([^\n]+)/)[1];
const server=spawn(process.execPath,[path.join(dist,'server.mjs')],{env,stdio:'pipe',windowsHide:true});
let browser,logs='';server.stderr.on('data',b=>logs+=b);const checks=[];
const pass=name=>{checks.push(name);console.log('PASS '+name);};
async function call(client,route,body,status=200){const res=await fetch(origin+'/api/'+route,{method:body===undefined?'GET':'POST',headers:{Origin:origin,Cookie:client.cookie||'','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const cookie=res.headers.get('set-cookie');if(cookie)client.cookie=cookie.split(';')[0];const value=await res.json();assert.equal(res.status,status,JSON.stringify(value));return value;}
const admin={},deng={},other={},spoof={};const password='Synthetic-Assignment-2026!';
async function login(client,username){await call(client,'auth/login',{username,password});await call(client,'auth/password',{currentPassword:password,password:password+'Changed'});}
try{
 for(let i=0;i<100;i++){try{if((await fetch(origin+'/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 await call(admin,'auth/login',{username:'admin',password:initial});await call(admin,'auth/password',{currentPassword:initial,password});
 const members={};
 for(const [username,name,role,departments,personnelType] of [
  ['dengkai','邓铠','clerk',['engineering'],'internal'],['other_engineer','杨林峰','clerk',['engineering'],'internal'],['drawing_huang','黄智翔','clerk',['engineering'],'internal'],
  ['wf_synthetic','王芳','sales',[],'internal'],['lm_synthetic','李明','production',[],'internal'],['cj_synthetic','陈静','finance',[],'internal'],['zw_synthetic','张伟','pmc',[],'internal'],
  ['disabled_person','已停用示例','viewer',[],'internal'],['external_person','外部人员示例','viewer',[],'external'],['pretend_dengkai','邓铠','clerk',['engineering'],'internal']
 ])members[username]=(await call(admin,'auth/accounts',{username,name,role,departments,personnelType,password})).memberId;
 const allMembers=(await call(admin,'workspace/data')).members;
 await call(admin,'workspace/member',{...allMembers.find(m=>m.id===members.disabled_person),active:false});
 await login(deng,'dengkai');await login(other,'other_engineer');await login(spoof,'pretend_dengkai');
 let work=await call(deng,'workspace/drawing-data');
 assert(work.assignmentMembers.some(m=>m.id===members.wf_synthetic&&m.name==='王芳'));
 assert(work.assignmentMembers.some(m=>m.id===members.lm_synthetic));assert(!work.assignmentMembers.some(m=>[members.disabled_person,members.external_person].includes(m.id)));
 assert(!work.assignmentMembers.some(m=>m.name==='wf_synthetic'));
 assert.equal((await call(other,'workspace/drawing-data')).assignmentMembers,undefined);
 assert.equal((await call(spoof,'workspace/drawing-data')).assignmentMembers,undefined);
 pass('仅真实 dengkai 登录身份获得有效内部成员中文姓名名单；同名账号、其他工程账号无扩权，停用和外部人员不列入');
 let record=(await call(deng,'workspace/drawing-save',{token:crypto.randomUUID(),tableEntry:true,customerCode:'示例客户 A',drawingType:'新款画图',requestedDate:'2026-11-17',requester:'dengkai',modelNo:'DEMO-1001',drawingNotes:'合成测试：从系统人员姓名中指定画图负责人'})).record;
 const due=record.deadline;
 record=(await call(deng,'workspace/drawing-save',{id:record.id,version:record.version,assigneeId:members.wf_synthetic,assignee:'王芳'})).record;
 assert.equal(record.assigneeId,members.wf_synthetic);assert.equal(record.assignee,'王芳');assert.equal(record.deadline,due);
 await call(other,'workspace/drawing-save',{id:record.id,version:record.version,assigneeId:members.lm_synthetic,assignee:'李明'},400);
 await call(deng,'workspace/drawing-save',{id:record.id,version:record.version,assigneeId:members.lm_synthetic,assignee:'lm_synthetic'},409);
 await call(deng,'workspace/drawing-save',{id:record.id,version:record.version,assigneeId:members.disabled_person,assignee:'已停用示例'},400);
 await call(deng,'workspace/drawing-save',{id:record.id,version:record.version,assigneeId:members.external_person,assignee:'外部人员示例'},400);
 const current=(await call(deng,'workspace/drawing-data')).records.find(r=>r.id===record.id);assert.deepEqual(current,record);
 pass('邓铠可分配非工程成员并保存成员ID；其他工程账号、英文账号名冒充姓名、停用或外部目标均被服务端拒绝，日期不变');
 record=(await call(deng,'workspace/drawing-save',{id:record.id,version:record.version,assigneeId:'',assignee:''})).record;
 await call(deng,'workspace/drawing-save',{token:crypto.randomUUID(),tableEntry:true,customerCode:'示例客户 B',drawingType:'改图',requestedDate:'2026-11-17',requester:'dengkai',modelNo:'DEMO-1002',drawingNotes:'合成测试：已有负责人保持不变',assigneeId:members.drawing_huang,assignee:'黄智翔'});
 // Deactivation after the roster has been read must be rejected on save.
 await call(admin,'workspace/member',{...allMembers.find(m=>m.id===members.zw_synthetic),active:false});
 await call(deng,'workspace/drawing-save',{id:record.id,version:record.version,assigneeId:members.zw_synthetic,assignee:'张伟'},400);
 assert(!(await call(deng,'workspace/drawing-data')).assignmentMembers.some(m=>m.id===members.zw_synthetic));
 pass('打开名单后目标被停用，提交时再次校验并拒绝');
 // Show unique fixture names in screenshots while preserving the spoof-account check above.
 await call(admin,'workspace/member',{...allMembers.find(m=>m.id===members.pretend_dengkai),active:false});
 const playwright=await import(process.env.DOON_PLAYWRIGHT_MODULE?pathToFileURL(path.resolve(process.env.DOON_PLAYWRIGHT_MODULE)).href:'playwright');
 browser=await playwright.chromium.launch({headless:true,channel:'chrome',args:['--no-proxy-server']});
 const context=await browser.newContext({viewport:{width:1800,height:1050},deviceScaleFactor:1});
 const split=deng.cookie.indexOf('=');await context.addCookies([{name:deng.cookie.slice(0,split),value:deng.cookie.slice(split+1),url:origin,httpOnly:true,sameSite:'Strict'}]);
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/engineering-drawings');await page.getByRole('button',{name:'画图跟进表',exact:true}).click();await page.locator('.ed-table').waitFor();
 await page.locator('.ed-table-wrap').evaluate(el=>{el.scrollIntoView({block:'center'});el.scrollLeft=Math.min(450,el.scrollWidth-el.clientWidth);});
 const picker=page.getByRole('button',{name:'画图人员 示例客户 A',exact:true});await picker.click();
 await page.getByRole('listbox',{name:'画图人员姓名',exact:true}).waitFor();
 const names=await page.getByRole('listbox',{name:'画图人员姓名',exact:true}).getByRole('option').allTextContents();
 assert(names.includes('王芳')&&names.includes('李明')&&names.includes('陈静')&&names.includes('邓铠'));assert(!names.includes('wf_synthetic'));
 await page.screenshot({path:path.join(dir,'01-中文姓名选择列表.png'),fullPage:false,animations:'disabled'});
 await page.getByRole('searchbox',{name:'搜索画图人员姓名',exact:true}).fill('王芳');
 await page.screenshot({path:path.join(dir,'02-按中文姓名搜索.png'),fullPage:false,animations:'disabled'});
 const saved=page.waitForResponse(r=>r.url().endsWith('/drawing-save')&&r.request().method()==='POST');
 await page.getByRole('option',{name:'王芳',exact:true}).click();assert.equal((await saved).status(),200);
 await page.getByRole('button',{name:'画图人员 示例客户 A',exact:true}).filter({hasText:'王芳'}).waitFor();
 const fromApi=(await call(deng,'workspace/drawing-data')).records.find(r=>r.id===record.id);assert.equal(fromApi.assigneeId,members.wf_synthetic);assert.equal(fromApi.deadline,due);
 await page.reload();await page.getByRole('button',{name:'画图跟进表',exact:true}).click();await page.getByRole('button',{name:'画图人员 示例客户 A',exact:true}).filter({hasText:'王芳'}).waitFor();
 await page.locator('.ed-table-wrap').evaluate(el=>{el.scrollIntoView({block:'center'});el.scrollLeft=Math.min(450,el.scrollWidth-el.clientWidth);});await page.screenshot({path:path.join(dir,'03-保存后负责人.png'),fullPage:false,animations:'disabled'});
 assert.deepEqual(errors,[]);pass('浏览器实际点击中文人员列表、搜索、选择保存及刷新回读成功');
 const result={passed:checks.length,checks,screenshotDirectory:dir,syntheticOnly:true};await fs.writeFile('test-output/drawing-assignment-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){console.error(logs.slice(-3000));throw error;}finally{await browser?.close();if(server.exitCode===null){server.kill();await new Promise(resolve=>server.once('exit',resolve));}}
