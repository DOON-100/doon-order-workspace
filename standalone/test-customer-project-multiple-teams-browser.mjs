// Synthetic shared-customer fixtures only; no production database or service is used.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {verifyCustomerPriceBuildEvidence} from '../scripts/customer-price-build-evidence.mjs';

const dist=path.resolve(process.env.DOON_BUILD_DIR||'test-output/customer-project-build');
const evidence=await verifyCustomerPriceBuildEvidence(dist);
await fs.mkdir(path.resolve('test-output'),{recursive:true});
const dir=await fs.mkdtemp(path.resolve('test-output/customer-project-multiple-teams-browser-'));
assert(dir.startsWith(path.resolve('test-output')+path.sep));
const origin='http://127.0.0.1:18795',env={...process.env,DOON_DATA_DIR:dir,DOON_HOST:'127.0.0.1',DOON_PORT:'18795',DOON_NO_AUTO_BACKUP:'1'};
execFileSync(process.execPath,[path.join(dist,'manage.mjs'),'init'],{env,stdio:'pipe',windowsHide:true});
const password=(await fs.readFile(path.join(dir,'管理员首次登录.txt'),'utf8')).match(/初始密码：([^\n]+)/)[1];
const server=spawn(process.execPath,[path.join(dist,'server.mjs')],{env,stdio:'pipe',windowsHide:true});
let logs='',cookie='',browser,page;
server.stderr.on('data',b=>logs+=b);server.stdout.on('data',()=>{});
const checks=[],errors=[],pass=name=>{checks.push(name);console.log('PASS '+name);};
const token=()=>crypto.randomUUID();
async function api(route,body,expected=200){
 const response=await fetch(origin+'/api/'+route,{method:body===undefined?'GET':'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
 const data=await response.json();assert.equal(response.status,expected,route+' '+JSON.stringify(data));return data;
}
const workspace=(action,body,expected)=>api('workspace/'+action,body,expected);
const optionValues=async select=>select.locator('option').evaluateAll(rows=>rows.map(row=>row.value).filter(Boolean));
async function openFollowups(){await page.goto(origin+'/customer-projects');await page.getByTestId('customer-project-list-nav').waitFor();await page.getByRole('button',{name:'我的客户跟进',exact:true}).click();await page.getByTestId('customer-followup-panel').waitFor();}
async function openCard(title){await page.getByTestId('followup-card').filter({hasText:title}).getByRole('button',{name:'查看 / 更新跟进',exact:true}).click();const dialog=page.getByRole('dialog',{name:'更新客户跟进',exact:true});await dialog.waitFor();return dialog;}

try{
 let healthy=false;for(let i=0;i<100;i++){try{if((await fetch(origin+'/health')).ok){healthy=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert(healthy,'Synthetic server did not start');
 await api('auth/login',{username:'admin',password});await api('auth/password',{currentPassword:password,password:'Synthetic-Multiple-Teams-Admin-2026!'});
 const admin=(await workspace('data')).me,adminCookie=cookie,sessions=[];
 for(const [username,name] of [['synthetic_custom_sales','合成定制业务'],['synthetic_stock_sales','合成现货业务'],['synthetic_custom_service','合成定制客服']]){
  cookie=adminCookie;await api('auth/accounts',{username,name,role:'sales',password:'Synthetic-Multiple-Teams-Initial-2026!',customers:[]});
  await api('auth/login',{username,password:'Synthetic-Multiple-Teams-Initial-2026!'});await api('auth/password',{currentPassword:'Synthetic-Multiple-Teams-Initial-2026!',password:'Synthetic-Multiple-Teams-Personal-2026!'});
  sessions.push({cookie,member:(await workspace('data')).me});
 }
 cookie=adminCookie;const [customSales,stockSales,customService]=sessions;
 await workspace('customer-save',{customer:'合成跨组同一客户',customerCode:'SYNTH-SHARED',salesName:customSales.member.name,serviceName:customService.member.name,pmcName:'',salesMemberIds:[admin.id,customSales.member.id,stockSales.member.id],serviceMemberIds:[customService.member.id,admin.id],quoteMemberIds:[],notes:'Synthetic shared customer only',active:true});
 await workspace('customer-save',{customer:'合成其他客户',customerCode:'SYNTH-OTHER',salesName:admin.name,serviceName:admin.name,pmcName:'',salesMemberIds:[admin.id],serviceMemberIds:[admin.id],quoteMemberIds:[],notes:'Synthetic unrelated customer only',active:true});
 const customers=(await workspace('data')).customerAccounts,customer=customers.find(row=>row.customerCode==='SYNTH-SHARED'),other=customers.find(row=>row.customerCode==='SYNTH-OTHER');assert(customer&&other);
 const customTeam=(await workspace('customer-project-team-save',{token:token(),name:'合成定制开发组',leaderIds:[admin.id],salesMemberIds:[customSales.member.id],serviceMemberIds:[customService.member.id],customerIds:[customer.id],active:true})).item;
 const stockTeam=(await workspace('customer-project-team-save',{token:token(),name:'合成C00现货组',leaderIds:[admin.id],salesMemberIds:[stockSales.member.id],serviceMemberIds:[admin.id],customerIds:[customer.id],active:true})).item;
 const otherTeam=(await workspace('customer-project-team-save',{token:token(),name:'合成其他客户组',leaderIds:[admin.id],salesMemberIds:[admin.id],serviceMemberIds:[admin.id],customerIds:[other.id],active:true})).item;
 const playwright=await import(process.env.DOON_PLAYWRIGHT_MODULE?pathToFileURL(process.env.DOON_PLAYWRIGHT_MODULE).href:'playwright');
 browser=await playwright.chromium.launch({headless:true,...(process.env.DOON_CHROMIUM_PATH?{executablePath:process.env.DOON_CHROMIUM_PATH}:{channel:'chrome'}),args:['--no-proxy-server']});
 const context=await browser.newContext({viewport:{width:1536,height:1050}}),split=cookie.indexOf('=');
 await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),url:origin,httpOnly:true,sameSite:'Strict'}]);
 page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto(origin+'/customer-projects');await page.getByTestId('customer-project-list-nav').waitFor();await page.getByLabel('统一工作组',{exact:true}).selectOption(customTeam.id);await page.getByTestId('customer-project-list-nav').waitFor();await page.getByRole('button',{name:'新建项目',exact:true}).click();
 let dialog=page.getByRole('dialog');await dialog.getByRole('combobox',{name:'所属客户',exact:true}).fill('SYNTH-SHARED');await page.getByRole('option',{name:/SYNTH-SHARED/}).click();
 const teamSelect=dialog.getByLabel('业务客服组',{exact:true}),salesSelect=dialog.getByLabel('业务主负责人',{exact:false});
 assert.deepEqual(new Set(await optionValues(teamSelect)),new Set([customTeam.id,stockTeam.id]));assert(!(await optionValues(teamSelect)).includes(otherTeam.id));
 await teamSelect.selectOption(customTeam.id);assert((await optionValues(salesSelect)).includes(customSales.member.id));assert(!(await optionValues(salesSelect)).includes(stockSales.member.id));
 await salesSelect.selectOption(customSales.member.id);await dialog.getByRole('group',{name:'客服负责人（可多选）',exact:true}).getByRole('checkbox',{name:customService.member.name,exact:true}).check();
 await dialog.getByLabel('默认客服审核人',{exact:false}).selectOption(customService.member.id);await dialog.getByLabel('默认业务审核人',{exact:false}).selectOption(customSales.member.id);
 await teamSelect.selectOption(stockTeam.id);assert.equal(await salesSelect.inputValue(),'');assert.equal(await dialog.getByLabel('默认客服审核人',{exact:false}).inputValue(),'');assert.equal(await dialog.getByLabel('默认业务审核人',{exact:false}).inputValue(),'');
 assert(!(await optionValues(salesSelect)).includes(customSales.member.id));assert((await optionValues(salesSelect)).includes(stockSales.member.id));
 const serviceGroup=dialog.getByRole('group',{name:'客服负责人（可多选）',exact:true});assert.equal(await serviceGroup.getByRole('checkbox',{name:customService.member.name,exact:true}).count(),0);assert.equal(await serviceGroup.getByRole('checkbox',{name:admin.name,exact:true}).isChecked(),false);
 await salesSelect.selectOption(stockSales.member.id);await serviceGroup.getByRole('checkbox',{name:admin.name,exact:true}).check();
 await dialog.getByLabel('项目编号',{exact:false}).fill('SYNTH-STOCK-PROJECT');await dialog.getByLabel('项目名称',{exact:false}).fill('合成同客C00现货项目');
 await page.screenshot({path:path.join(dir,'shared-customer-stock-form.png'),fullPage:true});
 await dialog.getByRole('button',{name:'保存记录',exact:true}).click();await dialog.waitFor({state:'hidden'});
 const stockProject=(await workspace('customer-project-data')).projects.find(row=>row.code==='SYNTH-STOCK-PROJECT');assert(stockProject);assert.equal(stockProject.teamId,stockTeam.id);assert.equal(stockProject.salesMemberId,stockSales.member.id);assert.deepEqual(stockProject.serviceMemberIds,[admin.id]);
 pass('同客户只显示已授权业务组；切组同步业务、客服与默认审核候选并清除不兼容选择');
 await page.getByRole('heading',{name:'合成同客C00现货项目',exact:true}).waitFor();assert.equal(await page.getByLabel('统一工作组',{exact:true}).inputValue(),stockTeam.id);assert.equal(new URL(page.url()).searchParams.get('projectId'),stockProject.id);assert.equal(await page.getByRole('alert').filter({hasText:'项目当前不可见'}).count(),0);await page.reload();await page.getByRole('heading',{name:'合成同客C00现货项目',exact:true}).waitFor();await page.screenshot({path:path.join(dir,'cross-group-created-project.png'),fullPage:true});pass('当前A组新建B组项目后自动切到B并打开正确项目，刷新仍保留同一项目');await page.getByLabel('统一工作组',{exact:true}).selectOption('');await page.getByTestId('customer-project-list-nav').waitFor();

 const customProject=(await workspace('customer-project-save',{token:token(),customerId:customer.id,teamId:customTeam.id,salesMemberId:customSales.member.id,serviceMemberIds:[customService.member.id],code:'SYNTH-CUSTOM-PROJECT',title:'合成同客定制开发项目',status:'active'})).item;
 const followup=async(title,ownerId)=>workspace('customer-project-followup-save',{token:token(),ownerId,customerId:customer.id,projectId:'',title,category:'other',stars:0,status:'pending',followUpDate:'',nextAction:'合成待客户确认',notes:'',checklist:[]});
 await followup('合成跨组关联跟进',admin.id);await followup('合成多组待提升',admin.id);await followup('合成单组待提升',customSales.member.id);
 await openFollowups();dialog=await openCard('合成跨组关联跟进');
 const projectSelect=dialog.getByLabel('关联完整项目',{exact:true}),labels=await projectSelect.locator('option').allTextContents();
 assert(labels.some(label=>label.includes('SYNTH-CUSTOM-PROJECT')&&label.includes(customTeam.name)&&label.includes(customSales.member.name)));
 assert(labels.some(label=>label.includes('SYNTH-STOCK-PROJECT')&&label.includes(stockTeam.name)&&label.includes(stockSales.member.name)));
 await projectSelect.selectOption(stockProject.id);await page.screenshot({path:path.join(dir,'shared-customer-project-association.png'),fullPage:true});
 await dialog.getByRole('button',{name:'保存跟进',exact:true}).click();await dialog.waitFor({state:'hidden'});
 assert.equal((await workspace('customer-project-followup-data')).followups.find(row=>row.title==='合成跨组关联跟进').projectId,stockProject.id);
 pass('同一客户的定制与现货项目分别标明业务组和负责人，关联保存到准确项目');

 await page.getByLabel('统一工作组',{exact:true}).selectOption(customTeam.id);await openFollowups();dialog=await openCard('合成多组待提升');await dialog.getByRole('button',{name:'创建并关联完整项目',exact:true}).click();dialog=page.getByRole('dialog',{name:'创建并关联完整项目',exact:true});
 const promoteTeams=dialog.getByLabel('本项目业务客服组',{exact:true});assert.equal(await promoteTeams.inputValue(),'');assert.deepEqual(new Set(await optionValues(promoteTeams)),new Set([customTeam.id,stockTeam.id]));
 const beforePromote=(await workspace('customer-project-data')).projects.length;await dialog.getByRole('button',{name:'确认创建项目',exact:true}).click();assert.equal(await promoteTeams.evaluate(select=>select.validity.valid),false);assert.equal((await workspace('customer-project-data')).projects.length,beforePromote);
 await promoteTeams.selectOption(stockTeam.id);await dialog.getByLabel('项目编号（可留空）',{exact:true}).fill('SYNTH-PROMOTE-STOCK');await page.screenshot({path:path.join(dir,'shared-customer-explicit-promotion.png'),fullPage:true});
 await dialog.getByRole('button',{name:'确认创建项目',exact:true}).click();await dialog.waitFor({state:'hidden'});
 let promoted=(await workspace('customer-project-data')).projects.find(row=>row.code==='SYNTH-PROMOTE-STOCK');assert(promoted);assert.equal(promoted.teamId,stockTeam.id);assert.equal(promoted.salesMemberId,admin.id);assert.deepEqual(promoted.serviceMemberIds,[admin.id]);
 pass('负责人有多个可用业务组时必须明确选择；创建项目准确保留所选组与组内客服');
 await page.getByRole('heading',{name:'合成多组待提升',exact:true}).waitFor();assert.equal(await page.getByLabel('统一工作组',{exact:true}).inputValue(),stockTeam.id);assert.equal(new URL(page.url()).searchParams.get('projectId'),promoted.id);assert.equal(await page.getByRole('alert').filter({hasText:'项目当前不可见'}).count(),0);await page.screenshot({path:path.join(dir,'cross-group-promoted-project.png'),fullPage:true});pass('当前A组跟进提升到B组后自动切组并打开新项目，未落入不可见空清单');

 await openFollowups();dialog=await openCard('合成单组待提升');await dialog.getByRole('button',{name:'创建并关联完整项目',exact:true}).click();dialog=page.getByRole('dialog',{name:'创建并关联完整项目',exact:true});
 assert.equal(await dialog.getByLabel('本项目业务客服组',{exact:true}).inputValue(),customTeam.id);assert.deepEqual(await optionValues(dialog.getByLabel('本项目业务客服组',{exact:true})),[customTeam.id]);
 await dialog.getByLabel('项目编号（可留空）',{exact:true}).fill('SYNTH-PROMOTE-CUSTOM');await dialog.getByRole('button',{name:'确认创建项目',exact:true}).click();await dialog.waitFor({state:'hidden'});
 promoted=(await workspace('customer-project-data')).projects.find(row=>row.code==='SYNTH-PROMOTE-CUSTOM');assert(promoted);assert.equal(promoted.teamId,customTeam.id);assert.equal(promoted.salesMemberId,customSales.member.id);assert.deepEqual(promoted.serviceMemberIds,[customService.member.id]);
 await page.getByRole('heading',{name:'合成单组待提升',exact:true}).waitFor();assert.equal(await page.getByLabel('统一工作组',{exact:true}).inputValue(),customTeam.id);assert.equal(new URL(page.url()).searchParams.get('projectId'),promoted.id);pass('跟进负责人只有一个匹配业务组时自动选择该组，项目业务与客服归属正确');
 for(const session of [customSales,stockSales]){cookie=session.cookie;const data=await workspace('customer-project-data');assert(data.projects.some(row=>row.id===customProject.id));assert(data.projects.some(row=>row.id===stockProject.id));}
 cookie=adminCookie;assert.equal((await workspace('data')).orders.length,0);assert.equal(errors.length,0,errors.join('\n'));
 pass('双方沿用客户多责任授权访问项目；测试不生成正式订单，浏览器无 JavaScript 错误');
 await fs.writeFile('test-output/customer-project-multiple-teams-browser-result.json',JSON.stringify({passed:checks.length,checks,errors,manifestSha256:evidence.manifestSha256,at:new Date().toISOString(),artifacts:dir},null,2));
 console.log(JSON.stringify({passed:checks.length,artifacts:dir}));
}catch(error){await fs.writeFile(path.join(dir,'failure-log.txt'),logs);if(page){await page.screenshot({path:path.join(dir,'failure.png'),fullPage:true});await fs.writeFile(path.join(dir,'failure-ui.txt'),await page.locator('body').ariaSnapshot());}console.error('Browser artifacts:',dir);throw error;}
finally{if(browser)await browser.close();server.kill();}
