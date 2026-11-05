// All accounts, customers and tasks are synthetic. Never points at an existing data directory.
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';
import {verifyCustomerPriceBuildEvidence} from '../scripts/customer-price-build-evidence.mjs';

const dist=path.resolve(process.env.DOON_BUILD_DIR||'test-output/customer-project-build');
await verifyCustomerPriceBuildEvidence(dist);
await fs.mkdir('test-output',{recursive:true});
const dir=await fs.mkdtemp(path.resolve('test-output/customer-project-assignee-'));
const reservation=net.createServer();
await new Promise((resolve,reject)=>{reservation.once('error',reject);reservation.listen(0,'127.0.0.1',resolve);});
const port=reservation.address().port;
await new Promise(resolve=>reservation.close(resolve));
assert(![8787,8797].includes(port));
const origin=`http://127.0.0.1:${port}`;
const env={...Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^DOON_/i.test(key))),DOON_DATA_DIR:dir,DOON_HOST:'127.0.0.1',DOON_PORT:String(port),DOON_NO_AUTO_BACKUP:'1',DOON_KINGDEE_READONLY_ENABLED:'0',DOON_KINGDEE_SUPPLIER_SYNC_ENABLED:'0',DOON_KINGDEE_PENDING_SYNC_ENABLED:'0'};
execFileSync(process.execPath,[path.join(dist,'manage.mjs'),'init'],{env,stdio:'pipe',windowsHide:true});
const initialPassword=(await fs.readFile(path.join(dir,'管理员首次登录.txt'),'utf8')).match(/初始密码：([^\n]+)/)[1];
const server=spawn(process.execPath,[path.join(dist,'server.mjs')],{env,stdio:['ignore','ignore','pipe'],windowsHide:true});
const serverDone=new Promise(resolve=>server.once('exit',resolve));
let logs='',cookie='',browser,page;
server.stderr.on('data',bytes=>logs+=bytes);
const checks=[],errors=[],pass=name=>{checks.push(name);console.log('PASS '+name);};
const token=()=>crypto.randomUUID();
async function eventually(check){let last;for(let i=0;i<100;i++){try{await check();return;}catch(error){last=error;await new Promise(resolve=>setTimeout(resolve,100));}}throw last;}
async function api(route,body){
 const response=await fetch(origin+'/api/'+route,{method:body===undefined?'GET':'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
 const result=await response.json();assert.equal(response.status,200,route+': '+JSON.stringify(result));return result;
}
const workspace=(action,body)=>api('workspace/'+action,body);
function records(){const db=new DatabaseSync(path.join(dir,'workspace.sqlite'),{readOnly:true});try{return db.prepare('SELECT id,data FROM records ORDER BY id').all();}finally{db.close();}}
try{
 await eventually(async()=>assert((await fetch(origin+'/health')).ok));
 await api('auth/login',{username:'admin',password:initialPassword});
 await api('auth/password',{currentPassword:initialPassword,password:'Synthetic-Assignee-Admin-2026!'});
 const admin=(await workspace('data')).me,members={};
 for(const [key,name,role,personnelType] of [['a','合成跟进甲','sales','internal'],['b','合成跟进乙','admin','internal'],['c','合成跟进丙','clerk','internal'],['external','合成外部人员','viewer','external']]){
  const created=await api('auth/accounts',{username:'synthetic_assignee_'+key,name,role,personnelType,password:'Synthetic-Assignee-Only-2026!',customers:[]});
  members[key]={id:created.memberId,name};
 }
 await workspace('customer-save',{customer:'合成跟进筛选客户',customerCode:'SYN-ASSIGNEE',salesName:admin.name,serviceName:'',pmcName:'',salesMemberIds:[admin.id],serviceMemberIds:[members.a.id],quoteMemberIds:[],notes:'Synthetic browser acceptance',active:true});
 const customer=(await workspace('data')).customerAccounts.find(row=>row.customerCode==='SYN-ASSIGNEE');
 const team=(await workspace('customer-project-team-save',{token:token(),name:'合成跟进组',leaderIds:[admin.id],salesMemberIds:[admin.id],serviceMemberIds:[members.a.id],customerIds:[customer.id],active:true})).item;
 const projects=[];
 for(const [code,title] of [['SYN-A','合成多跟进项目'],['SYN-B','合成单跟进项目']])projects.push((await workspace('customer-project-save',{token:token(),customerId:customer.id,code,title,description:'Synthetic only',teamId:team.id,salesMemberId:admin.id,serviceMemberIds:[members.a.id],dueDate:'',status:'active'})).item);
 for(const project of projects)await workspace('project-collaboration-save',{token:token(),version:0,projectId:project.id,roundId:'',stepKey:'directory',department:'service',ownerId:members.a.id,title:'合成较早待办',description:'Synthetic earlier task',dueDate:'2000-01-01'});
 const playwright=await import(process.env.DOON_PLAYWRIGHT_MODULE?pathToFileURL(process.env.DOON_PLAYWRIGHT_MODULE).href:'playwright');
 browser=await playwright.chromium.launch({headless:true,...(process.env.DOON_CHROMIUM_PATH?{executablePath:process.env.DOON_CHROMIUM_PATH}:{channel:'chrome'}),args:['--no-proxy-server']});
 const context=await browser.newContext({viewport:{width:1536,height:1050}}),split=cookie.indexOf('=');
 await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),url:origin,httpOnly:true,sameSite:'Strict'}]);
 page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
 await page.goto(origin+'/customer-projects');
 const board=page.locator('.scp-board'),rowA=board.getByRole('row').filter({hasText:projects[0].title});
 await rowA.getByRole('button',{name:'记录 / 指派',exact:true}).click();
 await page.getByRole('button',{name:'新增待办',exact:true}).click();
 const editor=page.getByRole('region',{name:'待办编辑'}),owner=editor.getByLabel('负责人',{exact:true});
 await eventually(async()=>assert((await owner.locator('option').allTextContents()).includes(members.b.name)));
 assert(!(await owner.locator('option').allTextContents()).includes(members.external.name));
 await editor.getByLabel('任务名称',{exact:true}).fill('合成较晚管理员待办');
 await editor.getByLabel('负责部门',{exact:true}).selectOption('service');
 await owner.selectOption(members.b.id);
 await editor.getByLabel('截止日期',{exact:true}).fill('2099-01-01');
 await editor.getByLabel('任务说明',{exact:true}).fill('Synthetic later assignment entered through the browser');
 await editor.getByRole('button',{name:'保存待办',exact:true}).click();
 await editor.waitFor({state:'hidden'});
 const saved=(await workspace('project-collaboration-data?projectId='+projects[0].id)).tasks.find(task=>task.title==='合成较晚管理员待办');
 assert.equal(saved?.ownerId,members.b.id);
 pass('新增待办可以选择并保存内部管理员型跟进人，外部人员不在候选中');
 await page.getByRole('button',{name:'返回项目清单',exact:true}).click();
 await eventually(async()=>assert.match(await rowA.innerText(),new RegExp(members.b.name)));
 assert.match(await rowA.locator('td').nth(3).innerText(),/合成较早待办/);
 assert.match(await rowA.locator('td').nth(5).innerText(),new RegExp(members.a.name));
 assert.match(await rowA.locator('td').nth(5).innerText(),new RegExp(members.b.name));
 const beforeFilters=records();
 const visibleCodes=()=>board.locator('.scp-project-link small').allTextContents();
 async function selectFilter(label,names){
  await board.getByRole('button',{name:'筛选'+label,exact:true}).click();
  const popup=page.locator('.excel-filter-popover').filter({visible:true});
  await popup.getByRole('button',{name:'全不选',exact:true}).click();
  for(const name of names)await popup.getByRole('checkbox',{name,exact:true}).check();
  await popup.getByRole('button',{name:'确定',exact:true}).click();
 }
 async function expectCodes(codes){await eventually(async()=>assert.deepEqual((await visibleCodes()).sort(),[...codes].sort()));}
 await selectFilter('指定跟进人',[members.b.name]);await expectCodes(['SYN-A']);
 assert.match(await board.locator('.excel-filter-status').innerText(),/已筛选 1 \/ 2 条/);
 pass('非最早到期事项的跟进人仍可逐人筛到，清单显示全部未完成跟进人');
 await selectFilter('指定跟进人',[members.c.name]);await expectCodes([]);
 assert.match(await board.locator('.excel-filter-status').innerText(),/没有匹配记录.*已筛选 0 \/ 2 条/s);
 await board.getByRole('button',{name:'筛选指定跟进人',exact:true}).click();
 const popup=page.locator('.excel-filter-popover').filter({visible:true});
 assert.equal(await popup.getByRole('checkbox',{name:members.external.name,exact:true}).count(),0);
 await popup.getByRole('button',{name:'取消',exact:true}).click();
 pass('暂无待办的内部成员仍可选择并明确显示零条结果，外部人员不进入筛选候选');
 await selectFilter('指定跟进人',[members.b.name,members.a.name]);await expectCodes(['SYN-A','SYN-B']);
 await selectFilter('项目',[projects[1].title+' '+projects[1].code]);await expectCodes(['SYN-B']);
 assert.match(await board.locator('.excel-filter-status').innerText(),/已筛选 1 \/ 2 条/);
 await selectFilter('指定跟进人',[members.b.name]);await expectCodes([]);
 await board.getByRole('button',{name:'清除全部筛选',exact:true}).click();await expectCodes(['SYN-A','SYN-B']);
 assert.deepEqual(records(),beforeFilters,'Read-only filters must not mutate source records');
 assert.deepEqual(errors,[]);
 pass('同列多人为或、跨列为且，清除恢复完整清单，筛选不改任何业务记录');
 await page.screenshot({path:path.join(dir,'assignee-filter-success.png'),fullPage:true});
 const report={passed:checks.length,checks,errors,artifacts:dir};
 await fs.writeFile(path.join(dir,'result.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
}catch(error){
 await fs.writeFile(path.join(dir,'failure-log.txt'),logs);
 if(page){await page.screenshot({path:path.join(dir,'failure.png'),fullPage:true}).catch(()=>{});await fs.writeFile(path.join(dir,'failure-ui.txt'),await page.locator('body').ariaSnapshot()).catch(()=>{});}
 console.error('Synthetic browser artifacts:',dir);throw error;
}finally{
 if(browser)await browser.close();
 if(server.exitCode===null)server.kill();
 await serverDone;
}
