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
async function filterProjects(page,board,values){
 await board.getByRole('button',{name:'筛选项目',exact:true}).click();
 const popup=page.locator('.excel-filter-popover').filter({visible:true});
 await popup.getByRole('button',{name:'全不选',exact:true}).click();
 for(const value of values)await popup.getByRole('checkbox',{name:value,exact:true}).check();
 await popup.getByRole('button',{name:'确定',exact:true}).click();
}
async function assertBoardRemains(board){assert.equal(await board.count(),1,'The project list must remain mounted behind every project dialog');}
async function columnHandle(wrapper,header){
 const headers=await wrapper.locator('thead tr').first().getByRole('columnheader').allTextContents();
 const index=headers.findIndex(text=>text.trim()===header);assert(index>=0,'Missing resizable column '+header);
 return wrapper.getByRole('separator').nth(index);
}
async function columnWidth(wrapper,header){return Number(await (await columnHandle(wrapper,header)).getAttribute('aria-valuenow'));}
async function reachableColumnHandle(wrapper,header){
 await wrapper.scrollIntoViewIfNeeded();
 await wrapper.locator(':scope > .cp-table-scroll').evaluate(node=>node.scrollTop=0);
 const handle=await columnHandle(wrapper,header);
 if(!await handle.evaluate(node=>getComputedStyle(node.closest('th')).position==='sticky'))await handle.scrollIntoViewIfNeeded();
 assert(await handle.evaluate(node=>{const r=node.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===node;}),'Resize handle must remain reachable, including on frozen columns');
 return handle;
}
async function gridGeometry(wrapper){return wrapper.locator('table').evaluate(table=>{
 const rect=cell=>{const r=cell.getBoundingClientRect();return {x:r.x,right:r.right,width:r.width};};
 const header=Array.from(table.tHead.rows[0].cells).map(rect);
 const row=Array.from(table.querySelectorAll('tbody:not([data-excel-ui]) tr')).find(row=>row.cells.length===header.length&&getComputedStyle(row).display!=='none');
 return {header,cells:row?Array.from(row.cells).map(rect):[]};
});}
async function assertGridAligned(wrapper){
 const geometry=await gridGeometry(wrapper);assert.equal(geometry.cells.length,geometry.header.length);
 for(let i=0;i<geometry.header.length;i++)for(const edge of ['x','right','width'])assert(Math.abs(geometry.header[i][edge]-geometry.cells[i][edge])<=1,`Table header/body column ${i+1} ${edge} must align`);
 return geometry;
}
async function dragColumn(page,wrapper,header,distance=90){
 const handle=await reachableColumnHandle(wrapper,header);
 const before=Number(await handle.getAttribute('aria-valuenow')),box=await handle.boundingBox();assert(box);
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+distance,box.y+box.height/2,{steps:8});await page.mouse.up();
 await eventually(async()=>assert((await columnWidth(wrapper,header))>=before+distance-3,'Dragging must increase the actual saved column width'));
 await assertGridAligned(wrapper);
 return {before,after:await columnWidth(wrapper,header)};
}
async function restoreColumn(wrapper,header,expected){
 const handle=await reachableColumnHandle(wrapper,header);await handle.dblclick();
 await eventually(async()=>assert(Math.abs(await columnWidth(wrapper,header)-expected)<3,'Double-click must restore the default column width'));
}

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
 const secondTeam=(await workspace('customer-project-team-save',{token:token(),name:'合成目标业务组',leaderIds:[admin.id],salesMemberIds:[admin.id],serviceMemberIds:[serviceB.id],customerIds:[customer.id],active:true})).item;
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
 await singleRow.getByRole('button',{name:'修改项目 · '+single.title,exact:true}).click();
 const dialog=page.getByRole('dialog');
 await assertBoardRemains(board);
 await dialog.getByRole('group',{name:'客服负责人（可多选）',exact:true}).getByRole('checkbox',{name:serviceA.name,exact:true}).check();
 await dialog.getByRole('button',{name:'保存记录',exact:true}).click();await dialog.waitFor({state:'hidden'});
 assert.deepEqual((await workspace('customer-project-data')).projects.find(row=>row.id===single.id).serviceMemberIds,[serviceA.id]);
 assert.equal((await workspace('project-collaboration-data?projectId='+single.id)).tasks.length,0);
 await eventually(async()=>assert.equal(await cell(singleRow,'客服负责人'),serviceA.name));
 assert.equal(await page.locator('.cp-project-dialog').count(),0,'Maintenance save must return to the same list without opening a full project page');
 assert.equal(await cell(singleRow,'事项跟进人'),'尚未安排下一步');
 assert.equal(await cell(singleRow,'下一步事项'),'尚未安排下一步');
 const listHeaders=(await board.getByRole('columnheader').allTextContents()).map(text=>text.trim());
 assert(!listHeaders.includes('负责部门'),'Department is maintained in the task editor, not repeated in the project list');
 assert(!listHeaders.includes('项目状态'),'Project status is maintained in the project form, not repeated in the project list');
 assert.equal((await workspace('customer-project-data')).projects.find(row=>row.id===single.id).status,'active','Hiding the list status column must preserve the stored project status');
 assert.equal(await cell(singleRow,'开发阶段'),'待建立开发轮次');
 pass('维护项目选择客服后清单显示项目责任人；无任务显示尚未安排下一步，清单隐藏负责部门与项目状态但保留原状态');

 const originalScope=await capturePreservation(dir);
 const listWidths=board.locator('.customer-project-table-scroll');
 let listColumn=await dragColumn(page,listWidths,'项目');
 await filterProjects(page,board,[single.title+' '+single.code]);
 await eventually(async()=>assert.equal(await multipleRow.count(),0));
 assert.equal(await columnWidth(listWidths,'项目'),listColumn.after,'Filtering must not reset the resized project column');
 await listWidths.locator(':scope > .cp-table-scroll').evaluate(node=>node.scrollLeft=0);
 const beforeHorizontal=await assertGridAligned(listWidths);
 const right=board.getByRole('button',{name:'项目清单向右移动',exact:true});
 for(let move=0;move<30;move++){
  const remaining=await listWidths.locator(':scope > .cp-table-scroll').evaluate(node=>node.scrollWidth-node.clientWidth-node.scrollLeft);
  if(remaining<=1)break;
  // The prior click may disable this button between observing and dispatching the next click.
  await right.evaluate(button=>{if(!button.disabled)button.click();});
 }
 await eventually(async()=>assert.equal(await right.isEnabled(),false,'Horizontal controls must reach the final columns'));
 const actionBox=await singleRow.getByRole('button',{name:'指派待办',exact:true}).boundingBox(),listBox=await listWidths.boundingBox();
 assert(actionBox&&listBox&&actionBox.x>=listBox.x&&actionBox.x+actionBox.width<=listBox.x+listBox.width+1,'The top horizontal controls must reveal the rightmost assignment action');
 const rail=listWidths.locator('.cp-project-scroll-rail'),viewport=listWidths.locator(':scope > .cp-table-scroll');
 assert(Math.abs(await rail.evaluate(node=>node.scrollLeft)-await viewport.evaluate(node=>node.scrollLeft))<2,'Top and table horizontal offsets must remain synchronized');
 const afterHorizontal=await assertGridAligned(listWidths),horizontalOffset=await viewport.evaluate(node=>node.scrollLeft);assert(horizontalOffset>0);
 for(let i=0;i<afterHorizontal.header.length;i++)for(const section of ['header','cells'])assert(Math.abs(afterHorizontal[section][i].x-beforeHorizontal[section][i].x+(i<2?0:horizontalOffset))<=1,`Horizontal scrolling must freeze customer/project and move column ${i+1}`);
 await page.screenshot({path:path.join(dir,'project-frozen-columns.png'),fullPage:true});
 await singleRow.getByRole('button',{name:'记录进展',exact:true}).click();
 const progressForm=page.getByRole('dialog',{name:'记录项目进展',exact:true});
 await assertBoardRemains(board);
 await progressForm.getByRole('button',{name:'取消',exact:true}).click();await progressForm.waitFor({state:'hidden'});
 assert.equal(await multipleRow.count(),0,'Cancelling the progress dialog must retain the column filter');
 const cancelledScope=await capturePreservation(dir);assert.deepEqual(cancelledScope.records,originalScope.records);assert.deepEqual(cancelledScope.files,originalScope.files);
 await singleRow.getByRole('button',{name:'记录进展',exact:true}).click();
 await progressForm.getByLabel('项目进展记录',{exact:false}).fill('合成进展：客户样板资料已经收到，等待核对。');
 await progressForm.getByRole('button',{name:'保存进展',exact:true}).click();await progressForm.waitFor({state:'hidden'});
 await eventually(async()=>assert.match(await cell(singleRow,'最新记录 / 日期与进展'),/合成进展/));
 assert.equal(await multipleRow.count(),0,'Saving progress must retain the same list and column filter');
 assert.equal(await page.locator('.cp-project-dialog').count(),0);
 assert.equal(await columnWidth(listWidths,'项目'),listColumn.after,'Opening and closing forms must retain the project column width');
 await board.getByRole('button',{name:'清除全部筛选',exact:true}).click();await multipleRow.waitFor();
 pass('进展直接在弹窗登记；取消不写记录，保存只更新当前行，关闭和保存均保留列表筛选');

 recipientPage=await contextPage(sessions[0].cookie);
 await recipientPage.goto(origin+'/personal-tasks');
 const personalProjects=recipientPage.getByRole('region',{name:'我的项目跟进与负责项目',exact:true});
 await personalProjects.getByRole('button',{name:'打开负责项目 · '+single.title,exact:true}).waitFor();
 assert.equal(await recipientPage.getByRole('region',{name:'我的待办',exact:true}).getByRole('button',{name:/查看任务/}).count(),0);
 pass('项目客服登录后可找到我负责的项目，项目归属不会伪造具体待办');

 // Every preexisting record/file is protected from the assignment/completion workflow below.
 const before=await capturePreservation(dir);
 await multipleRow.getByRole('button',{name:'指派待办',exact:true}).click();
 const multipleTaskDialog=page.getByRole('dialog',{name:'项目待办 · '+multiple.title,exact:true});
 await multipleTaskDialog.waitFor();await assertBoardRemains(board);
 const editor=page.getByRole('region',{name:'待办编辑',exact:true});
 await editor.waitFor();
 assert.equal(await editor.getByLabel('负责人',{exact:true}).inputValue(),'','Multiple project service owners require an explicit selection');
 const options=await editor.getByLabel('负责人',{exact:true}).locator('option').allTextContents();
 assert(options.some(label=>label.includes(serviceA.name))&&options.some(label=>label.includes(serviceB.name)));
 await editor.getByRole('button',{name:'放弃本次编辑',exact:true}).click();
 const discard=page.getByRole('button',{name:'放弃未保存输入并继续',exact:true});if(await discard.isVisible())await discard.click();
 await editor.waitFor({state:'hidden'});
 await multipleTaskDialog.getByRole('button',{name:'关闭项目窗口',exact:true}).click();await multipleTaskDialog.waitFor({state:'hidden'});
 await page.getByRole('button',{name:'刷新',exact:true}).click();
 await eventually(async()=>assert.equal(await singleRow.getByRole('button',{name:'指派待办',exact:true}).isEnabled(),true));
 assert.equal(await page.locator('.cp-project-dialog').count(),0,'Cancelling assignment must not reopen it on a data refresh');
 assert.equal((await workspace('project-collaboration-data?projectId='+multiple.id)).tasks.length,0,'Cancelling assignment must not create a task');
 await filterProjects(page,board,[single.title+' '+single.code]);
 await singleRow.getByRole('button',{name:'指派待办',exact:true}).click();
 const singleTaskDialog=page.getByRole('dialog',{name:'项目待办 · '+single.title,exact:true});
 await singleTaskDialog.waitFor();await assertBoardRemains(board);
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
 assert.equal(await singleTaskDialog.isVisible(),true,'Successful assignment stays in the task list dialog');
 await singleTaskDialog.getByRole('button',{name:'查看任务 · '+taskTitle,exact:true}).waitFor();
 await singleTaskDialog.getByRole('button',{name:'关闭项目窗口',exact:true}).click();await singleTaskDialog.waitFor({state:'hidden'});
 assert.equal(await multipleRow.count(),0,'Closing the task dialog must retain the original project filter');
 await eventually(async()=>assert.equal(await cell(singleRow,'事项跟进人'),serviceA.name));
 assert.equal(await cell(singleRow,'客服负责人'),serviceA.name);
 assert.equal(await cell(singleRow,'下一步事项'),taskTitle);
 await singleRow.getByRole('button',{name:'查看待办',exact:true}).click();await singleTaskDialog.waitFor();
 assert.equal(await editor.count(),0,'View tasks must not reopen the cancelled or saved assignment editor');
 await singleTaskDialog.getByRole('button',{name:'关闭项目窗口',exact:true}).click();await singleTaskDialog.waitFor({state:'hidden'});
 await page.reload();await singleRow.waitFor();
 assert.equal(await page.locator('.cp-project-dialog').count(),0,'A browser reload must not replay the assignment intent');
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
 assert.equal(await columnWidth(listWidths,'项目'),listColumn.after,'A browser reload must retain the saved project-column width');
 // A reload may calculate a new natural default after progress text changes. Restore and
 // record that default on this mount before checking later cross-table isolation/reset.
 const reloadedListHandle=await reachableColumnHandle(listWidths,'项目');await reloadedListHandle.dblclick();
 listColumn=await dragColumn(page,listWidths,'项目');
 const completed=(await workspace('project-collaboration-data?projectId='+single.id)).tasks.find(row=>row.id===assigned.id);
 assert.equal(completed.result,'合成验收：资料已核对完成。');assert.equal(completed.history.at(-1).action,'complete');
 const after=await capturePreservation(dir);
 for(const [id,value] of Object.entries(before.records))assert.deepEqual(after.records[id],value,'Preexisting records must not be rewritten');
 assert.deepEqual(after.files,before.files);assert.equal(after.accountsHash,before.accountsHash);assert.equal(after.accountCount,before.accountCount);
 const download=await fetch(origin+'/api/workspace/customer-project-file?id='+encodeURIComponent(attachment.id),{headers:{Cookie:adminCookie}});
 assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),originalBytes);
 await singleRow.getByRole('button',{name:'历史记录',exact:true}).click();
 const history=page.locator('.cp-project-dialog');
 await history.waitFor();assert.equal(await history.getAttribute('aria-label'),'进展记录 · '+single.title);await assertBoardRemains(board);
 await history.getByRole('row').filter({hasText:'合成进展：客户样板资料已经收到'}).waitFor();
 assert.equal(await history.getByRole('region',{name:'项目环节协作',exact:true}).count(),0,'Progress history must not embed a second task workspace');
 const progressSection=history.getByRole('heading',{name:'项目进展记录',exact:true}).locator('xpath=ancestor::section[1]');
 const progressWidths=progressSection.locator('.customer-project-table-scroll');
 const sectionBox=await progressSection.boundingBox(),tableBox=await progressWidths.boundingBox();
 assert(sectionBox&&tableBox&&tableBox.x-sectionBox.x>=12&&sectionBox.x+sectionBox.width-tableBox.x-tableBox.width>=12,'Progress table must retain visible left and right space inside its section');
 const progressColumn=await dragColumn(page,progressWidths,'项目进展记录');
 assert.equal(await columnWidth(listWidths,'项目'),listColumn.after,'Progress resizing must not alter the project list preference');
 await page.screenshot({path:path.join(dir,'project-progress-dialog.png'),fullPage:true});
 await history.getByRole('button',{name:'关闭项目窗口',exact:true}).click();await history.waitFor({state:'hidden'});
 await singleRow.getByRole('button',{name:'历史记录',exact:true}).click();await history.waitFor();
 assert.equal(await columnWidth(progressWidths,'项目进展记录'),progressColumn.after,'Progress column width must survive closing and reopening its dialog');
 await restoreColumn(progressWidths,'项目进展记录',progressColumn.before);
 assert.equal(await columnWidth(listWidths,'项目'),listColumn.after);
 await history.getByRole('button',{name:'关闭项目窗口',exact:true}).click();await history.waitFor({state:'hidden'});
 const legacyTitle='合成历史双审事项';
 await workspace('customer-project-entry-save',{token:token(),entryType:'task',projectId:single.id,roundId:'',title:legacyTitle,ownerId:serviceA.id,serviceReviewerId:serviceB.id,salesReviewerId:admin.id,dueDate:'2099-12-01',status:'open'});
 await workspace('customer-project-followup-save',{token:token(),ownerId:serviceA.id,customerId:customer.id,projectId:single.id,title:'合成关联客户跟进',category:'other',stars:0,status:'pending',followUpDate:'2099-12-02',notes:'Synthetic table-width check',nextAction:'合成关联待核查',checklist:[]});
 await page.getByRole('button',{name:'刷新',exact:true}).click();
 await eventually(async()=>assert.match(await singleRow.innerText(),new RegExp(legacyTitle)));
 await singleRow.getByRole('button',{name:'历史记录',exact:true}).click();await history.waitFor();
 await history.getByLabel('更多项目资料',{exact:true}).selectOption('communication');
 await history.getByRole('row').filter({hasText:legacyTitle}).waitFor();
 assert.equal(await history.getByRole('row').filter({hasText:legacyTitle}).count(),1,'Legacy communication view must display each original task exactly once');
 assert.equal(await history.getByRole('region',{name:'项目环节协作',exact:true}).count(),0);
 const related=history.getByRole('heading',{name:'关联客户跟进',exact:true}).locator('xpath=ancestor::section[1]').locator('.customer-project-table-scroll');
 const relatedColumn=await dragColumn(page,related,'跟进事项 / 下一步');
 assert.equal(await columnWidth(listWidths,'项目'),listColumn.after);
 await history.getByLabel('更多项目资料',{exact:true}).selectOption('progress');
 assert.equal(await columnWidth(progressWidths,'项目进展记录'),progressColumn.before,'Related-followup resizing must not change progress column widths');
 await history.getByLabel('更多项目资料',{exact:true}).selectOption('communication');
 assert.equal(await columnWidth(related,'跟进事项 / 下一步'),relatedColumn.after);
 await restoreColumn(related,'跟进事项 / 下一步',relatedColumn.before);
 await history.getByRole('button',{name:'关闭项目窗口',exact:true}).click();await history.waitFor({state:'hidden'});
 await restoreColumn(listWidths,'项目',listColumn.before);
 pass('三表表头内容框线对齐，可独立拖宽、记忆和恢复；清单横滚冻结客户与项目，末列可达，筛选后宽度保持');
 pass('项目历史仅在弹窗展示；进展表左右留白，历史沟通入口保留原双审事项且无重复待办');

 await page.goto(origin+'/customer-projects?projectId='+single.id+'&customerId='+customer.id+'&tab=progress');await history.waitFor();
 await history.getByRole('button',{name:'关闭项目窗口',exact:true}).click();await history.waitFor({state:'hidden'});
 assert(!/projectId|customerId|recordId|tab=/.test(new URL(page.url()).search),'Closing a linked record must not reapply an old customer scope on the next list selection');
 await singleRow.waitFor();await multipleRow.waitFor();
 await page.getByRole('combobox',{name:'统一工作组',exact:true}).selectOption(team.id);
 await singleRow.getByRole('button',{name:'修改项目 · '+single.title,exact:true}).click();
 await dialog.getByLabel('业务客服组',{exact:true}).selectOption(secondTeam.id);
 await dialog.getByRole('group',{name:'客服负责人（可多选）',exact:true}).getByRole('checkbox',{name:serviceB.name,exact:true}).check();
 await dialog.getByRole('checkbox',{name:/保存后安排下一步/}).check();
 await dialog.getByRole('button',{name:'保存记录',exact:true}).click();
 await singleTaskDialog.waitFor();await editor.waitFor();
 assert.equal(await page.getByRole('combobox',{name:'统一工作组',exact:true}).inputValue(),secondTeam.id);
 assert.equal(await editor.getByLabel('负责人',{exact:true}).inputValue(),serviceB.id,'Cross-team save must carry the intent and use the new service owner');
 assert(!/assign-task|recordId|assignRequest|assignmentRequest/.test(new URL(page.url()).search),'One-time assignment intent must not be persisted in the address');
 await editor.getByRole('button',{name:'放弃本次编辑',exact:true}).click();if(await discard.isVisible())await discard.click();await editor.waitFor({state:'hidden'});
 await singleTaskDialog.getByRole('button',{name:'关闭项目窗口',exact:true}).click();await singleTaskDialog.waitFor({state:'hidden'});
 await page.reload();await singleRow.waitFor();
 assert.equal(await page.locator('.cp-project-dialog').count(),0,'Reload after cancelling a cross-team assignment must not reopen the one-time editor');
 pass('跨组维护后仅打开一次新组指派弹窗，默认新客服；地址不含临时意图，取消再刷新不重开');
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
