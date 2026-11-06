// Synthetic data only. This suite never opens the persistent 8797 test copy or production storage.
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {verifyCustomerPriceBuildEvidence} from '../scripts/customer-price-build-evidence.mjs';
import {capturePreservation} from '../scripts/verify-code-update.mjs';

const dist=path.resolve(process.env.DOON_BUILD_DIR||'test-output/customer-project-build');
const evidence=await verifyCustomerPriceBuildEvidence(dist);
await fs.mkdir('test-output',{recursive:true});
const dir=await fs.realpath(await fs.mkdtemp(path.resolve('test-output/customer-project-responsibility-')));
const base=await fs.realpath('test-output');
assert(path.dirname(dir)===base,'Only a fresh synthetic test directory is allowed');
const reservation=net.createServer();
await new Promise((resolve,reject)=>{reservation.once('error',reject);reservation.listen(0,'127.0.0.1',resolve);});
const port=reservation.address().port;
await new Promise(resolve=>reservation.close(resolve));
assert(![8787,8797].includes(port));
const origin=`http://127.0.0.1:${port}`;
const env={...Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^DOON_/i.test(key))),DOON_DATA_DIR:dir,DOON_HOST:'127.0.0.1',DOON_PORT:String(port),DOON_NO_AUTO_BACKUP:'1',DOON_KINGDEE_READONLY_ENABLED:'0',DOON_KINGDEE_SUPPLIER_SYNC_ENABLED:'0',DOON_KINGDEE_PENDING_SYNC_ENABLED:'0',DOON_IE_MAIL_ENABLED:'0',DOON_STUDIO_SCHEDULES_ENABLED:'0'};
execFileSync(process.execPath,[path.join(dist,'manage.mjs'),'init'],{env,stdio:'pipe',windowsHide:true});
const password=(await fs.readFile(path.join(dir,'管理员首次登录.txt'),'utf8')).match(/初始密码：([^\n]+)/)[1];
const server=spawn(process.execPath,[path.join(dist,'server.mjs')],{env,stdio:['ignore','ignore','pipe'],windowsHide:true});
const serverDone=new Promise(resolve=>server.once('exit',resolve));
let logs='',cookie='',browser,page,recipientPage;
server.stderr.on('data',bytes=>logs+=bytes);
const checks=[],errors=[],pass=name=>{checks.push(name);console.log('PASS '+name);};
const token=()=>crypto.randomUUID();
async function eventually(check){let last;for(let attempt=0;attempt<120;attempt++){try{await check();return;}catch(error){last=error;await new Promise(resolve=>setTimeout(resolve,100));}}throw last;}
async function api(route,body){
 const response=await fetch(origin+'/api/'+route,{method:body===undefined?'GET':'POST',headers:{Origin:origin,Cookie:cookie,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});
 if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
 const result=await response.json();assert.equal(response.status,200,route+': '+JSON.stringify(result));return result;
}
const workspace=(action,body)=>api('workspace/'+action,body);
async function contextPage(actorCookie){
 const context=await browser.newContext({viewport:{width:1680,height:1050}}),split=actorCookie.indexOf('=');
 await context.addCookies([{name:actorCookie.slice(0,split),value:actorCookie.slice(split+1),url:origin,httpOnly:true,sameSite:'Strict'}]);
 const tab=await context.newPage();tab.setDefaultTimeout(20000);tab.on('pageerror',error=>errors.push(error.message));tab.on('dialog',dialog=>dialog.accept());return tab;
}
async function cell(row,header){const headers=await row.locator('xpath=ancestor::table').getByRole('columnheader').allTextContents();const index=headers.findIndex(text=>text.trim()===header);assert(index>=0,'Missing column '+header);return row.locator('td').nth(index).innerText();}

try{
 await eventually(async()=>assert((await fetch(origin+'/health')).ok));
 await api('auth/login',{username:'admin',password});
 await api('auth/password',{currentPassword:password,password:'Synthetic-Responsibility-Admin-2026!'});
 const admin=(await workspace('data')).me,adminCookie=cookie,sessions=[];
 for(const [key,name] of [['a','合成责任客服甲'],['b','合成责任客服乙']]){
  await api('auth/accounts',{username:'synthetic_responsibility_'+key,name,role:'clerk',personnelType:'internal',password:'Synthetic-Responsibility-Initial-2026!',customers:[]});
  await api('auth/login',{username:'synthetic_responsibility_'+key,password:'Synthetic-Responsibility-Initial-2026!'});
  await api('auth/password',{currentPassword:'Synthetic-Responsibility-Initial-2026!',password:'Synthetic-Responsibility-Personal-2026!'});
  sessions.push({cookie,member:(await workspace('data')).me});cookie=adminCookie;
 }
 const [serviceA,serviceB]=sessions.map(session=>session.member);
 await workspace('customer-save',{customer:'合成项目责任客户',customerCode:'SYN-RESP',salesName:admin.name,serviceName:'',pmcName:'',salesMemberIds:[admin.id],serviceMemberIds:[serviceA.id,serviceB.id],quoteMemberIds:[],notes:'Synthetic responsibility browser acceptance',active:true});
 const customer=(await workspace('data')).customerAccounts.find(row=>row.customerCode==='SYN-RESP');
 const team=(await workspace('customer-project-team-save',{token:token(),name:'合成项目责任组',leaderIds:[admin.id],salesMemberIds:[admin.id],serviceMemberIds:[serviceA.id,serviceB.id],customerIds:[customer.id],active:true})).item;
 const createProject=(code,title,serviceMemberIds)=>workspace('customer-project-save',{token:token(),customerId:customer.id,code,title,description:'Synthetic only',teamId:team.id,salesMemberId:admin.id,serviceMemberIds,dueDate:'',status:'active'});
 const single=(await createProject('SYN-RESP-ONE','合成单客服项目',[])).item;
 const multiple=(await createProject('SYN-RESP-MULTI','合成多客服项目',[serviceA.id,serviceB.id])).item;
 const originalBytes=Buffer.from('Synthetic original communication\r\n附件原件必须保持字节不变。\n');
 const form=new FormData();form.set('projectId',single.id);form.set('roundId','');form.set('category','original-communication');form.set('note','Synthetic original preservation');form.set('file',new File([originalBytes],'synthetic-responsibility-original.txt',{type:'text/plain'}));
 const attachment=(await workspace('customer-project-attachment',form)).item;
 const playwright=await import(process.env.DOON_PLAYWRIGHT_MODULE?pathToFileURL(process.env.DOON_PLAYWRIGHT_MODULE).href:'playwright');
 browser=await playwright.chromium.launch({headless:true,...(process.env.DOON_CHROMIUM_PATH?{executablePath:process.env.DOON_CHROMIUM_PATH}:{channel:'chrome'}),args:['--no-proxy-server']});
 page=await contextPage(adminCookie);
 await page.goto(origin+'/customer-projects');
 const board=page.locator('.scp-board'),singleRow=board.getByRole('row').filter({hasText:single.title}),multipleRow=board.getByRole('row').filter({hasText:multiple.title});
 await singleRow.getByRole('button',{name:'查看项目',exact:true}).click();
 await page.getByRole('button',{name:'修改项目',exact:true}).click();
 const dialog=page.getByRole('dialog');
 await dialog.getByRole('group',{name:'客服负责人（可多选）',exact:true}).getByRole('checkbox',{name:serviceA.name,exact:true}).check();
 await dialog.getByRole('button',{name:'保存记录',exact:true}).click();await dialog.waitFor({state:'hidden'});
 assert.deepEqual((await workspace('customer-project-data')).projects.find(row=>row.id===single.id).serviceMemberIds,[serviceA.id]);
 assert.equal((await workspace('project-collaboration-data?projectId='+single.id)).tasks.length,0);
 await page.getByRole('button',{name:'返回项目清单',exact:true}).click();
 await eventually(async()=>assert.equal(await cell(singleRow,'客服负责人'),serviceA.name));
 assert.equal(await cell(singleRow,'事项跟进人'),'尚未安排下一步');
 assert.equal(await cell(singleRow,'下一步事项'),'尚未安排下一步');
 assert.equal(await cell(singleRow,'项目状态'),'进行中');
 assert.equal(await cell(singleRow,'开发阶段'),'待建立开发轮次');
 pass('维护项目选择客服后清单显示项目责任人；没有任务准确显示尚未安排下一步，项目状态与开发阶段分开');

 recipientPage=await contextPage(sessions[0].cookie);
 await recipientPage.goto(origin+'/personal-tasks');
 const personalProjects=recipientPage.getByRole('region',{name:'我的项目跟进与负责项目',exact:true});
 await personalProjects.getByRole('button',{name:'打开负责项目 · '+single.title,exact:true}).waitFor();
 assert.equal(await recipientPage.getByRole('region',{name:'我的待办',exact:true}).getByRole('button',{name:/查看任务/}).count(),0);
 pass('项目客服登录后可找到我负责的项目，项目归属不会伪造具体待办');

 // Every preexisting record/file is protected from the assignment/completion workflow below.
 const before=await capturePreservation(dir);
 await multipleRow.getByRole('button',{name:'指派待办',exact:true}).click();
 const editor=page.getByRole('region',{name:'待办编辑',exact:true});
 await editor.waitFor();
 assert.equal(await editor.getByLabel('负责人',{exact:true}).inputValue(),'','Multiple project service owners require an explicit selection');
 const options=await editor.getByLabel('负责人',{exact:true}).locator('option').allTextContents();
 assert(options.some(label=>label.includes(serviceA.name))&&options.some(label=>label.includes(serviceB.name)));
 await editor.getByRole('button',{name:'放弃本次编辑',exact:true}).click();
 const discard=page.getByRole('button',{name:'放弃未保存输入并继续',exact:true});if(await discard.isVisible())await discard.click();
 await editor.waitFor({state:'hidden'});
 await page.getByRole('button',{name:'返回项目清单',exact:true}).click();
 await singleRow.getByRole('button',{name:'指派待办',exact:true}).click();
 await editor.waitFor();
 assert.equal(await editor.getByLabel('负责人',{exact:true}).inputValue(),serviceA.id);
 assert.equal(await editor.getByLabel('负责部门',{exact:true}).inputValue(),'service');
 pass('清单直接打开指派表单，唯一项目客服自动带入，多客服不随机选人');
 const taskTitle='合成确认样板资料';
 await editor.getByLabel('任务名称',{exact:true}).fill(taskTitle);
 await editor.getByLabel('任务说明',{exact:true}).fill('Synthetic work: verify sample material and return a result.');
 await editor.getByLabel('截止日期',{exact:true}).fill('2099-11-06');
 await editor.getByRole('button',{name:'保存待办',exact:true}).click();await editor.waitFor({state:'hidden'});
 const assigned=(await workspace('project-collaboration-data?projectId='+single.id)).tasks.find(row=>row.title===taskTitle);
 assert.equal(assigned?.ownerId,serviceA.id);assert.equal(assigned?.department,'service');
 await page.getByRole('button',{name:'返回项目清单',exact:true}).click();
 await eventually(async()=>assert.equal(await cell(singleRow,'事项跟进人'),serviceA.name));
 assert.equal(await cell(singleRow,'客服负责人'),serviceA.name);
 assert.equal(await cell(singleRow,'下一步事项'),taskTitle);
 await recipientPage.reload();
 const personalTasks=recipientPage.getByRole('region',{name:'我的待办',exact:true});
 await personalTasks.getByRole('button',{name:'查看任务 · '+taskTitle,exact:true}).click();
 await personalTasks.getByLabel('本次回复 / 完成备注',{exact:true}).fill('合成验收：资料已核对完成。');
 await personalTasks.getByRole('button',{name:'确认完成',exact:true}).click();
 await eventually(async()=>assert.equal((await workspace('project-collaboration-data?projectId='+single.id)).tasks.find(row=>row.id===assigned.id)?.status,'done'));
 pass('直接指派后清单与本人待办显示同一事项，指定人员可在我的待办提交完成结果');
 await page.reload();
 await eventually(async()=>assert.equal(await cell(singleRow,'事项跟进人'),'尚未安排下一步'));
 assert.equal(await cell(singleRow,'客服负责人'),serviceA.name);
 assert.equal(await cell(singleRow,'下一步事项'),'尚未安排下一步');
 assert(!/待指定/.test(await singleRow.innerText()));
 const completed=(await workspace('project-collaboration-data?projectId='+single.id)).tasks.find(row=>row.id===assigned.id);
 assert.equal(completed.result,'合成验收：资料已核对完成。');assert.equal(completed.history.at(-1).action,'complete');
 const after=await capturePreservation(dir);
 for(const [id,value] of Object.entries(before.records))assert.deepEqual(after.records[id],value,'Preexisting records must not be rewritten');
 assert.deepEqual(after.files,before.files);assert.equal(after.accountsHash,before.accountsHash);assert.equal(after.accountCount,before.accountCount);
 const download=await fetch(origin+'/api/workspace/customer-project-file?id='+encodeURIComponent(attachment.id),{headers:{Cookie:adminCookie}});
 assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),originalBytes);
 assert.deepEqual(errors,[]);
 pass('任务完成后项目客服仍保留，清单不误报待指定；原业务记录、账号元数据和附件原件保持完整');
 await page.screenshot({path:path.join(dir,'project-responsibility.png'),fullPage:true});
 await recipientPage.screenshot({path:path.join(dir,'personal-task-completed.png'),fullPage:true});
 const report={passed:checks.length,checks,errors,evidence,port,syntheticOnly:true,artifacts:dir};
 await fs.writeFile(path.join(dir,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){
 await fs.writeFile(path.join(dir,'failure-log.txt'),logs);
 for(const [name,tab] of [['admin',page],['recipient',recipientPage]])if(tab){await tab.screenshot({path:path.join(dir,'failure-'+name+'.png'),fullPage:true}).catch(()=>{});await fs.writeFile(path.join(dir,'failure-'+name+'-ui.txt'),await tab.locator('body').ariaSnapshot()).catch(()=>{});}
 console.error('Synthetic browser artifacts:',dir);throw error;
}finally{
 if(browser)await browser.close();
 if(server.exitCode===null)server.kill();
 await serverDone;
}
