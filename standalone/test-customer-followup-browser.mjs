// Synthetic fixtures only. Never connects to a production port or production data directory.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {verifyCustomerPriceBuildEvidence} from '../scripts/customer-price-build-evidence.mjs';

const dist=path.resolve(process.env.DOON_BUILD_DIR||'test-output/customer-followup-build');
const evidence=await verifyCustomerPriceBuildEvidence(dist);
await fs.mkdir(path.resolve('test-output'),{recursive:true});
const dir=await fs.mkdtemp(path.resolve('test-output/customer-followup-browser-'));
assert(dir.startsWith(path.resolve('test-output')+path.sep));
const origin='http://127.0.0.1:18796';
const env={...Object.fromEntries(Object.entries(process.env).filter(([name])=>!/^DOON_KINGDEE_/i.test(name))),DOON_KINGDEE_SUPPLIER_SYNC_ENABLED:'0',DOON_KINGDEE_READONLY_ENABLED:'0',DOON_DATA_DIR:dir,DOON_HOST:'127.0.0.1',DOON_PORT:'18796',DOON_NO_AUTO_BACKUP:'1'};
execFileSync(process.execPath,[path.join(dist,'manage.mjs'),'init'],{env,stdio:'pipe',windowsHide:true});
const password=(await fs.readFile(path.join(dir,'管理员首次登录.txt'),'utf8')).match(/初始密码：([^\n]+)/)[1];
const server=spawn(process.execPath,[path.join(dist,'server.mjs')],{env,stdio:'pipe',windowsHide:true});
let logs='',cookie='',browser,page;
server.stdout.on('data',()=>{});server.stderr.on('data',b=>logs+=b);
const checks=[],errors=[],pass=name=>{checks.push(name);console.log('PASS '+name);};
const token=()=>crypto.randomUUID();
const date='2026-11-23',sourceKey='synthetic-followup-browser-v1';
async function api(route,body,expected=200){
 const response=await fetch(origin+'/api/'+route,{method:body===undefined?'GET':'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
 const data=await response.json();assert.equal(response.status,expected,route+' '+JSON.stringify(data));return data;
}
const workspace=(action,body,expected)=>api('workspace/'+action,body,expected);
const followupData=()=>workspace('customer-project-followup-data');
async function actorContext(actorCookie){
 const context=await browser.newContext({viewport:{width:1536,height:1050},acceptDownloads:true});
 const at=actorCookie.indexOf('=');
 await context.addCookies([{name:actorCookie.slice(0,at),value:actorCookie.slice(at+1),url:origin,httpOnly:true,sameSite:'Strict'}]);
 const actorPage=await context.newPage();actorPage.on('pageerror',e=>errors.push(e.message));actorPage.on('dialog',d=>d.accept());
 return {context,page:actorPage};
}
async function openFollowups(p){
 await p.goto(origin+'/customer-projects');
 await p.getByTestId('customer-project-list-nav').waitFor();
 await p.getByRole('button',{name:'我的客户跟进',exact:true}).click();
 await p.getByTestId('customer-followup-panel').waitFor();
}
async function openCard(p,title){
 const card=p.getByTestId('followup-card').filter({hasText:title});
 await card.getByRole('button',{name:'查看 / 更新跟进',exact:true}).click();
 const dialog=p.getByRole('dialog',{name:'更新客户跟进',exact:true});await dialog.waitFor();return dialog;
}
async function saveDialog(dialog){
 await dialog.getByRole('button',{name:'保存跟进',exact:true}).click();await dialog.waitFor({state:'hidden'});
}

try{
 let healthy=false;
 for(let i=0;i<100;i++){try{if((await fetch(origin+'/health')).ok){healthy=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
 assert(healthy,'Isolated followup server did not start');
 await api('auth/login',{username:'admin',password});
 await api('auth/password',{currentPassword:password,password:'Synthetic-Followup-Admin-2026!'});
 const admin=(await workspace('data')).me,adminCookie=cookie,sessions=[];
 for(const [username,name] of [['synthetic_follow_owner','合成跟进负责人'],['synthetic_follow_peer','合成同组客服'],['synthetic_follow_other','合成无关业务']]){
  cookie=adminCookie;
  await api('auth/accounts',{username,name,role:'sales',password:'Synthetic-Followup-Initial-2026!',customers:[]});
  await api('auth/login',{username,password:'Synthetic-Followup-Initial-2026!'});
  await api('auth/password',{currentPassword:'Synthetic-Followup-Initial-2026!',password:'Synthetic-Followup-Personal-2026!'});
  sessions.push({cookie,member:(await workspace('data')).me});
 }
 cookie=adminCookie;
 const [owner,peer,other]=sessions;
 await workspace('customer-save',{customer:'合成跟进客户甲',customerCode:'SYNTH-FOLLOW-A',salesName:owner.member.name,serviceName:peer.member.name,pmcName:'',salesMemberIds:[owner.member.id],serviceMemberIds:[peer.member.id],quoteMemberIds:[],notes:'Synthetic browser fixture only',active:true});
 const customer=(await workspace('data')).customerAccounts.find(c=>c.customerCode==='SYNTH-FOLLOW-A');assert(customer);
 const team=(await workspace('customer-project-team-save',{token:token(),name:'合成跟进组',leaderIds:[admin.id],salesMemberIds:[owner.member.id],serviceMemberIds:[peer.member.id],customerIds:[customer.id],active:true})).item;
 const existingProject=(await workspace('customer-project-save',{token:token(),customerId:customer.id,code:'SYNTH-FOLLOW-EXISTING',title:'合成已有完整项目',description:'Synthetic existing project',teamId:team.id,salesMemberId:owner.member.id,serviceMemberIds:[peer.member.id],serviceReviewerId:'',salesReviewerId:'',dueDate:'',status:'active'})).item;
 const titles=['合成重要出货待跟进','合成待归属展会线索','合成三星订单跟进','合成工程改图跟进','合成可提升跟进'];
 const followups=Array.from({length:35},(_,i)=>({
  sourceId:'p'+i,title:titles[i]||'合成跟进记录 '+String(i+1).padStart(2,'0'),customerId:i===1?'':customer.id,projectId:'',
  category:['shipping','exhibition','order','engineering','other'][i%5],stars:i===0?0:i%4,status:'pending',followUpDate:'',notes:'',nextAction:'合成下一步 '+i,
  checklist:[{id:'check-'+i+'-a',text:'合成核实事项 '+i+' A',checked:false},{id:'check-'+i+'-b',text:'合成核实事项 '+i+' B',checked:false}],
  sourceTitle:'合成来源工作台',source:{id:'p'+i,name:titles[i]||'合成客户 '+i,category:i%4,stars:i%4,priority:i===0?3:i%4,items:['合成核实事项 '+i+' A','合成核实事项 '+i+' B'],next:'合成下一步 '+i,retainedExtra:'合成原字段 '+i}
 }));
 followups[2].stars=3;
 const sourceHtml='<!doctype html><meta charset="utf-8"><title>Synthetic source archive</title><script>window.__syntheticSourceExecuted=true</script><p>合成来源归档</p>';
 const importPayload={token:token(),format:'doon-customer-followup-v1',sourceKey,ownerId:owner.member.id,followups,mails:[
  {sourceId:'synthetic-mail-draft',followupSourceIds:['p0'],subject:'合成出货未发送草稿',from:'Synthetic Owner <owner@example.invalid>',to:'Synthetic Customer <customer@example.invalid>',sentAt:'2026-10-13T09:06:26+08:00',body:'<img src=x onerror="window.__syntheticMailExecuted=true"> 合成原邮件文本',summary:'合成邮件摘要，不代表已经发送',draftStatus:'draft',sourceUrl:'https://example.invalid/synthetic-mail/draft',links:[{label:'合成安全来源',url:'https://example.invalid/synthetic-source'}],source:{id:'synthetic-mail-draft',threadId:'synthetic-thread-draft',mailState:'draft',replyStatus:'未发送草稿',attachmentNote:'合成附件未读取',retainedExtra:'保留原字段'}},
  {sourceId:'synthetic-mail-unassigned',followupSourceIds:[],subject:'合成待归属收件',from:'Synthetic Sender <sender@example.invalid>',to:'owner@example.invalid',sentAt:'2026-10-12T10:00:00+08:00',body:'合成未归属邮件正文',summary:'合成未归属邮件摘要',draftStatus:'received',sourceUrl:'',links:[],source:{id:'synthetic-mail-unassigned',url:'javascript:window.__syntheticUnsafeLink=true'}},
  {sourceId:'synthetic-mail-shared',followupSourceIds:['p2'],subject:'合成已关联客户来信',from:'customer@example.invalid',to:'owner@example.invalid',sentAt:'2026-10-11T10:00:00+08:00',body:'合成客户来信正文',summary:'合成客户来信摘要',draftStatus:'received',sourceUrl:'https://example.invalid/synthetic-mail/received',links:[],source:{id:'synthetic-mail-shared'}}
 ],sourceFiles:[{sourceId:'synthetic-source-html',filename:'合成来源工作台.html',base64:Buffer.from(sourceHtml).toString('base64')}]};
 const imported=await workspace('customer-project-followup-import',importPayload);
 assert.equal(imported.created.followups,35);assert.equal(imported.created.mails,3);assert.equal(imported.created.sourceFiles,1);
 const baselineProjectData=await workspace('customer-project-data');assert.equal(baselineProjectData.projects.length,1);assert.equal(baselineProjectData.items.length,0);assert.equal(baselineProjectData.rounds.length,0);assert.equal(baselineProjectData.tasks.length,0);
 pass('35 条合成跟进与 3 条邮件导入，不生成开发轮次、数量、正式待办或订单');

 const playwright=await import(process.env.DOON_PLAYWRIGHT_MODULE?pathToFileURL(process.env.DOON_PLAYWRIGHT_MODULE).href:'playwright');
 browser=await playwright.chromium.launch({headless:true,...(process.env.DOON_CHROMIUM_PATH?{executablePath:process.env.DOON_CHROMIUM_PATH}:{channel:'chrome'}),args:['--no-proxy-server']});
 const ownerBrowser=await actorContext(owner.cookie);page=ownerBrowser.page;cookie=owner.cookie;
 await openFollowups(page);
 await page.getByTestId('followup-card').nth(34).waitFor();
 assert.equal(await page.getByTestId('followup-card').count(),35);
 assert.match(await page.getByTestId('followup-card').filter({hasText:titles[0]}).innerText(),/重要出货/);
 assert.match(await page.getByTestId('followup-card').filter({hasText:titles[2]}).innerText(),/★★★/);
 assert.match(await page.getByTestId('followup-card').filter({hasText:titles[1]}).innerText(),/客户待确认/);
 assert.match(await page.getByTestId('followup-link-summary').innerText(),/35 条跟进记录：0 条已关联 0 个项目，35 条未关联项目/);
 await page.getByRole('heading',{name:'尚未建立客户跟进的项目',exact:true}).waitFor();
 await page.getByRole('row').filter({hasText:'SYNTH-FOLLOW-EXISTING'}).getByRole('button',{name:'打开项目',exact:true}).waitFor();
 await page.screenshot({path:path.join(dir,'followup-owner-board.png'),fullPage:true});
 pass('负责人能在我的客户跟进入口看到 35 条，未归属、重要出货及三星标记明确');

 let dialog=await openCard(page,titles[0]);
 await dialog.getByRole('checkbox',{name:'合成核实事项 0 A',exact:true}).check();
 await dialog.getByLabel('共享备注',{exact:true}).fill('合成共享备注：已核实首项，仍待客户答复');
 await dialog.getByLabel('下一跟进日期',{exact:true}).fill(date);
 await dialog.getByLabel('跟进状态',{exact:true}).selectOption('waiting_customer');
 await saveDialog(dialog);
 await openFollowups(page);dialog=await openCard(page,titles[0]);
 assert(await dialog.getByRole('checkbox',{name:'合成核实事项 0 A',exact:true}).isChecked());
 assert.equal(await dialog.getByRole('checkbox',{name:'合成核实事项 0 B',exact:true}).isChecked(),false);
 assert.equal(await dialog.getByLabel('共享备注',{exact:true}).inputValue(),'合成共享备注：已核实首项，仍待客户答复');
 assert.equal(await dialog.getByLabel('下一跟进日期',{exact:true}).inputValue(),date);
 assert.equal(await dialog.getByLabel('跟进状态',{exact:true}).inputValue(),'waiting_customer');
 assert.match(await dialog.innerText(),/未发送草稿/);
 const sourceLink=dialog.locator('a[href="https://example.invalid/synthetic-mail/draft"]');assert.equal(await sourceLink.count(),1);
 assert.match(await sourceLink.getAttribute('rel')||'',/noopener|noreferrer/);
 assert.equal(await dialog.locator('a[href^="javascript:"]').count(),0);
 assert.equal(await page.evaluate(()=>Boolean(window.__syntheticMailExecuted||window.__syntheticUnsafeLink)),false);
 await page.screenshot({path:path.join(dir,'followup-saved-draft.png'),fullPage:true});
 await dialog.getByRole('button',{name:'关闭',exact:true}).click();await dialog.waitFor({state:'hidden'});
 pass('勾选、共享备注、日期和状态保存后刷新不丢失；邮件草稿及安全来源链接准确显示');

 dialog=await openCard(page,titles[2]);
 await dialog.getByLabel('关联完整项目',{exact:true}).selectOption(existingProject.id);
 await saveDialog(dialog);
 let ownerData=await followupData();
 assert.equal(ownerData.followups.find(f=>f.sourceId==='p2').projectId,existingProject.id);
 assert.equal((await workspace('customer-project-data')).projects.length,1);
 pass('已有客户跟进显式关联完整项目，不重复建立项目');

 // Stay within the SPA: the parent list must use the same linked entry immediately.
 await page.getByTestId('customer-project-list-nav').click();
 let linkedProjectRow=page.getByRole('row').filter({hasText:'SYNTH-FOLLOW-EXISTING'});
 await linkedProjectRow.getByText('合成下一步 2',{exact:true}).waitFor();
 await linkedProjectRow.getByRole('button',{name:'查看客户跟进',exact:true}).click();
 dialog=page.getByRole('dialog',{name:'更新客户跟进',exact:true});await dialog.waitFor();
 assert.equal(await dialog.getByLabel('跟进标题',{exact:true}).inputValue(),titles[2]);
 await dialog.getByLabel('下一步',{exact:true}).fill('合成关联后的最新下一步');
 await dialog.getByLabel('下一跟进日期',{exact:true}).fill('2026-11-25');
 await saveDialog(dialog);
 await page.getByTestId('customer-project-list-nav').click();
 linkedProjectRow=page.getByRole('row').filter({hasText:'SYNTH-FOLLOW-EXISTING'});
 await linkedProjectRow.getByText('合成关联后的最新下一步',{exact:true}).waitFor();
 assert.match(await linkedProjectRow.innerText(),/2026-11-25/);
 await page.screenshot({path:path.join(dir,'followup-project-same-action.png'),fullPage:true});
 await page.getByRole('button',{name:'我的客户跟进',exact:true}).click();
 await page.getByTestId('followup-card').filter({hasText:titles[4]}).waitFor();
 pass('无需整页刷新，项目清单显示同条客户跟进的下一步和日期，并可直接打开原跟进编辑');

 dialog=await openCard(page,titles[4]);
 await dialog.getByRole('button',{name:'创建并关联完整项目',exact:true}).click();
 const promoteDialog=page.getByRole('dialog',{name:'创建并关联完整项目',exact:true});
 await promoteDialog.getByLabel('确认所属客户',{exact:true}).selectOption(customer.id);
 await promoteDialog.getByLabel('完整项目名称',{exact:true}).fill('合成跟进提升的完整项目');
 await promoteDialog.getByLabel('项目编号（可留空）',{exact:true}).fill('SYNTH-FOLLOW-PROMOTED');
 await promoteDialog.getByRole('button',{name:'确认创建项目',exact:true}).click();await promoteDialog.waitFor({state:'hidden'});
 const promotedData=await workspace('customer-project-data');
 const promotedProject=promotedData.projects.find(p=>p.code==='SYNTH-FOLLOW-PROMOTED');assert(promotedProject);assert.equal(promotedProject.customerId,customer.id);
 assert.equal(promotedData.projects.length,2);assert.equal(promotedData.items.length,0);assert.equal(promotedData.rounds.length,0);assert.equal(promotedData.tasks.length,0);
 ownerData=await followupData();assert.equal(ownerData.followups.find(f=>f.sourceId==='p4').projectId,promotedProject.id);
 await openFollowups(page);dialog=await openCard(page,titles[4]);
 assert.equal(await dialog.getByRole('button',{name:'创建并关联完整项目',exact:true}).count(),0);
 await dialog.getByRole('button',{name:'打开完整项目',exact:true}).waitFor();
 await dialog.getByRole('button',{name:'关闭',exact:true}).click();await dialog.waitFor({state:'hidden'});
 pass('跟进提升为完整客户项目且保留关联，不自动建立款色、数量、轮次或审核待办');

 await page.getByRole('button',{name:'待归属收件区',exact:true}).click();
 await page.getByText('合成待归属收件',{exact:true}).waitFor();
 assert.equal(await page.locator('a[href^="javascript:"]').count(),0);
 await page.getByTestId('followup-mail').filter({hasText:'合成待归属收件'}).getByRole('button',{name:'确认归属',exact:true}).click();
 const mailDialog=page.getByRole('dialog',{name:'确认邮件归属',exact:true});
 await mailDialog.getByRole('checkbox',{name:'归属 '+titles[1],exact:true}).check();
 await mailDialog.getByRole('button',{name:'保存邮件归属',exact:true}).click();await mailDialog.waitFor({state:'hidden'});
 ownerData=await followupData();assert.deepEqual(ownerData.mails.find(m=>m.sourceId==='synthetic-mail-unassigned').followupIds,[ownerData.followups.find(f=>f.sourceId==='p1').id]);
 await page.getByText('合成待归属收件',{exact:true}).waitFor({state:'hidden'});
 pass('待归属邮件独立可见，经人工确认关联所选跟进，不执行原始不安全链接');

 await page.getByRole('button',{name:'来源与备份',exact:true}).click();
 const backup={format:'eyewear-france-workbench-v1',exportedAt:'2026-10-13T04:00:00Z',state:{p0:{status:'进行中',date:'2026-12-01',notes:'合成旧备份备注',checks:[1],updated:'2026/10/13 12:00:00'},p1:{status:'等内部',date:'2026-12-02',notes:'合成不选中的备注',checks:[0]},missingSyntheticId:{status:'待跟进',date:'',notes:'合成未匹配备份',checks:[]}}};
 const backupPath=path.join(dir,'synthetic-old-browser-backup.json');await fs.writeFile(backupPath,JSON.stringify(backup));
 await page.getByLabel('选择旧浏览器备份',{exact:true}).setInputFiles(backupPath);
 await page.getByLabel('备份归属范围',{exact:true}).selectOption(JSON.stringify([sourceKey,owner.member.id]));
 await page.getByRole('button',{name:'生成导入预览',exact:true}).click();
 const missingBackup=page.getByRole('checkbox',{name:'导入 missingSyntheticId',exact:true});await missingBackup.waitFor();assert(await missingBackup.isDisabled());
 ownerData=await followupData();assert.equal(ownerData.followups.find(f=>f.sourceId==='p0').notes,'合成共享备注：已核实首项，仍待客户答复');
 const importP0=page.getByRole('checkbox',{name:'导入 '+titles[0],exact:true});await importP0.check();
 const importP1=page.getByRole('checkbox',{name:'导入 '+titles[1],exact:true});await importP1.uncheck();
 await page.screenshot({path:path.join(dir,'followup-backup-preview.png'),fullPage:true});
 await page.getByRole('button',{name:'确认导入所选记录',exact:true}).click();
 await page.getByText(/已导入|导入完成/).first().waitFor();
 ownerData=await followupData();
 const restored=ownerData.followups.find(f=>f.sourceId==='p0'),notRestored=ownerData.followups.find(f=>f.sourceId==='p1');
 assert.equal(restored.notes,'合成旧备份备注');assert.equal(restored.status,'in_progress');assert.equal(restored.followUpDate,'2026-12-01');assert.deepEqual(restored.checklist.map(c=>c.checked),[false,true]);
 assert.equal(notRestored.notes,'');assert.equal(notRestored.status,'pending');
 pass('旧浏览器备份先预览、报告未匹配项，只导入勾选记录并准确恢复原勾选索引');

 const archive=ownerData.sourceBundles.find(b=>b.sourceId==='synthetic-source-html');assert(archive);
 const [download]=await Promise.all([page.waitForEvent('download'),page.locator('a[href*="customer-project-followup-source-file"]').click()]);
 assert.equal(download.suggestedFilename(),'合成来源工作台.html');
 const downloadedPath=path.join(dir,'downloaded-synthetic-source.html');await download.saveAs(downloadedPath);
 assert.equal(await fs.readFile(downloadedPath,'utf8'),sourceHtml);
 const archiveResponse=await fetch(origin+'/api/workspace/customer-project-followup-source-file?id='+encodeURIComponent(archive.id),{headers:{Cookie:owner.cookie}});
 assert.equal(archiveResponse.status,200);assert.match(archiveResponse.headers.get('content-type')||'',/application\/octet-stream/);
 assert.match(archiveResponse.headers.get('content-disposition')||'',/attachment/i);assert.equal(archiveResponse.headers.get('x-content-type-options'),'nosniff');assert.match(archiveResponse.headers.get('content-security-policy')||'',/sandbox/);
 assert.equal(await archiveResponse.text(),sourceHtml);
 assert.equal(await page.evaluate(()=>Boolean(window.__syntheticSourceExecuted)),false);
 pass('来源 HTML 原样安全下载，使用 attachment、octet-stream、nosniff 和 sandbox');

 const peerBrowser=await actorContext(peer.cookie);await openFollowups(peerBrowser.page);
 await peerBrowser.page.getByLabel('跟进负责人范围',{exact:true}).selectOption('');
 assert.equal(await peerBrowser.page.getByTestId('followup-card').filter({hasText:titles[1]}).count(),0);
 await peerBrowser.page.getByTestId('followup-card').filter({hasText:titles[0]}).waitFor();
 const outsiderBrowser=await actorContext(other.cookie);await openFollowups(outsiderBrowser.page);
 assert.equal(await outsiderBrowser.page.getByTestId('followup-card').count(),0);
 cookie=other.cookie;const outsiderData=await followupData();assert.equal(outsiderData.followups.length,0);assert.equal(outsiderData.mails.length,0);assert.equal(outsiderData.sourceBundles.length,0);cookie=owner.cookie;
 const privateSourceResponse=await fetch(origin+'/api/workspace/customer-project-followup-source-file?id='+encodeURIComponent(archive.id),{headers:{Cookie:peer.cookie}});
 assert([403,404].includes(privateSourceResponse.status));
 await peerBrowser.context.close();await outsiderBrowser.context.close();
 pass('同组可跟进已授权客户，未归属及源文件仅负责人可见，无关账号看不到记录');

 cookie=adminCookie;const repeated=await workspace('customer-project-followup-import',{...importPayload,token:token()});assert.equal(repeated.skipped.followups,35);
 cookie=owner.cookie;ownerData=await followupData();assert.equal(ownerData.followups.find(f=>f.sourceId==='p0').notes,'合成旧备份备注');assert.equal(ownerData.followups.find(f=>f.sourceId==='p2').projectId,existingProject.id);
 assert.equal(ownerData.followups.find(f=>f.sourceId==='p4').projectId,promotedProject.id);
 assert.deepEqual(ownerData.mails.find(m=>m.sourceId==='synthetic-mail-unassigned').followupIds,[ownerData.followups.find(f=>f.sourceId==='p1').id]);
 const finalProjectData=await workspace('customer-project-data');assert.equal(finalProjectData.projects.length,2);assert.equal(finalProjectData.items.length,0);assert.equal(finalProjectData.rounds.length,0);assert.equal(finalProjectData.tasks.length,0);assert.equal((await workspace('data')).orders.length,0);
 pass('重复导入不覆盖共享跟进或项目关联，正式任务审核及订单体系保持独立');
 await workspace('customer-project-entry-save',{token:token(),entryType:'task',projectId:existingProject.id,title:'合成关联项目待办',ownerId:owner.member.id,dueDate:'2026-11-20'});
 await openFollowups(page);
 await page.getByTestId('followup-card').filter({hasText:titles[2]}).getByText(/合成关联项目待办/).waitFor();
 dialog=await openCard(page,titles[2]);
 assert.match(await dialog.getByTestId('followup-project-tasks').innerText(),/合成关联项目待办/);
 assert.match(await dialog.getByTestId('followup-project-tasks').innerText(),/2026-11-20/);
 assert.equal(await dialog.getByLabel('下一跟进日期',{exact:true}).inputValue(),'2026-11-25');
 await page.screenshot({path:path.join(dir,'followup-linked-project-tasks.png'),fullPage:true});
 await dialog.getByRole('button',{name:'关闭',exact:true}).click();await dialog.waitFor({state:'hidden'});
 pass('同项目审核待办同步显示在客户跟进中，来源与日期分别展示，不覆盖客户跟进自身字段');
 assert.equal(errors.length,0,errors.join('\n'));pass('全部核心浏览器路径无 JavaScript 错误');
 await fs.writeFile('test-output/customer-followup-browser-result.json',JSON.stringify({passed:checks.length,checks,errors,manifestSha256:evidence.manifestSha256,at:new Date().toISOString(),artifacts:dir},null,2));
 console.log(JSON.stringify({passed:checks.length,artifacts:dir}));
}catch(error){
 await fs.writeFile(path.join(dir,'failure-log.txt'),logs);
 if(page){await page.screenshot({path:path.join(dir,'failure.png'),fullPage:true});await fs.writeFile(path.join(dir,'failure-ui.txt'),await page.locator('body').ariaSnapshot());}
 console.error('Browser artifacts:',dir);throw error;
}finally{if(browser)await browser.close();server.kill();}
