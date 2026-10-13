// All records, accounts and files are synthetic, in an isolated temporary database.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';
import {verifyCustomerPriceBuildEvidence} from '../scripts/customer-price-build-evidence.mjs';
const dist=path.resolve(process.env.DOON_BUILD_DIR||'test-output/customer-project-build');
const evidence=await verifyCustomerPriceBuildEvidence(dist);
const dir=await fs.mkdtemp(path.resolve('test-output/customer-project-browser-'));
assert(dir.startsWith(path.resolve('test-output')+path.sep));
const origin='http://127.0.0.1:18798',env={...process.env,DOON_DATA_DIR:dir,DOON_HOST:'127.0.0.1',DOON_PORT:'18798',DOON_NO_AUTO_BACKUP:'1'};
execFileSync(process.execPath,[path.join(dist,'manage.mjs'),'init'],{env,stdio:'pipe',windowsHide:true});
const password=(await fs.readFile(path.join(dir,'管理员首次登录.txt'),'utf8')).match(/初始密码：([^\n]+)/)[1];
const server=spawn(process.execPath,[path.join(dist,'server.mjs')],{env,stdio:'pipe',windowsHide:true});
let logs='',cookie='',browser,page;server.stdout.on('data',()=>{});server.stderr.on('data',b=>logs+=b);
const checks=[],errors=[],pass=name=>{checks.push(name);console.log('PASS '+name);};
const token=()=>crypto.randomUUID(),day=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
async function api(route,body,expected=200){
 const response=await fetch(origin+'/api/'+route,{method:body===undefined?'GET':'POST',headers:{Origin:origin,Cookie:cookie,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});
 if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
 const data=await response.json();assert.equal(response.status,expected,route+' '+JSON.stringify(data));return data;
}
const workspace=(action,body,expected)=>api('workspace/'+action,body,expected);
function originalRows(){const db=new DatabaseSync(path.join(dir,'workspace.sqlite'),{readOnly:true});try{return db.prepare('SELECT id,data FROM records ORDER BY id').all();}finally{db.close();}}
try{
 for(let i=0;i<80;i++){try{if((await fetch(origin+'/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 await api('auth/login',{username:'admin',password});
 await api('auth/password',{currentPassword:password,password:'Synthetic-Project-Only-2026!'});
 const admin=(await workspace('data')).me,adminCookie=cookie,serviceSessions=[];
 for(const [username,name] of [['synthetic_service_a','合成客服甲'],['synthetic_service_b','合成客服乙'],['synthetic_other','合成无关客服']]){
  await api('auth/accounts',{username,name,role:'sales',password:'Synthetic-Service-Initial-2026!',customers:[]});
  await api('auth/login',{username,password:'Synthetic-Service-Initial-2026!'});
  await api('auth/password',{currentPassword:'Synthetic-Service-Initial-2026!',password:'Synthetic-Service-Personal-2026!'});
  serviceSessions.push({name,cookie,member:(await workspace('data')).me});cookie=adminCookie;
 }
 const serviceMembers=serviceSessions.slice(0,2).map(session=>session.member);
 await workspace('customer-save',{customer:'SYNTHETIC-CUSTOMER-A 合成客户甲',customerCode:'QA-A',salesName:admin.name,serviceName:admin.name,pmcName:'',salesMemberIds:[admin.id],serviceMemberIds:serviceMembers.map(member=>member.id),quoteMemberIds:[],notes:'Synthetic browser fixture',active:true});
 await workspace('customer-save',{customer:'SYNTHETIC-CUSTOMER-B 合成客户乙',customerCode:'QB-B',salesName:admin.name,serviceName:admin.name,pmcName:'',salesMemberIds:[admin.id],serviceMemberIds:[admin.id],quoteMemberIds:[],notes:'Synthetic search alternative',active:true});
 const customer=(await workspace('data')).customerAccounts.find(c=>c.customerCode==='QA-A');
 const team=(await workspace('customer-project-team-save',{token:token(),name:'合成双客服组',leaderIds:[admin.id],salesMemberIds:[admin.id],serviceMemberIds:serviceMembers.map(member=>member.id),customerIds:[customer.id],active:true})).item;
 const originals=originalRows();
 await workspace('customer-project-data');await workspace('project-finance-data');
 assert.deepEqual(originalRows(),originals);pass('首次打开项目和财务查询不创建或改写任何记录');
 const playwright=await import(process.env.DOON_PLAYWRIGHT_MODULE?pathToFileURL(process.env.DOON_PLAYWRIGHT_MODULE).href:'playwright');
 browser=await playwright.chromium.launch({headless:true,...(process.env.DOON_CHROMIUM_PATH?{executablePath:process.env.DOON_CHROMIUM_PATH}:{channel:'chrome'}),args:['--no-proxy-server']});
 const context=await browser.newContext({viewport:{width:1536,height:1050}});
 await context.addInitScript(()=>Object.defineProperty(Crypto.prototype,'randomUUID',{value:undefined,configurable:true}));
 const split=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),url:origin,httpOnly:true,sameSite:'Strict'}]);
 page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto(origin+'/customer-projects');
 await page.getByRole('heading',{name:'客户项目开发',exact:true}).waitFor();
 await page.getByRole('button',{name:'新建项目',exact:true}).click();
 const dialog=page.getByRole('dialog');
 await dialog.getByLabel('项目编号',{exact:false}).fill('SYNTH-PROJECT-01');
 await dialog.getByLabel('项目名称',{exact:false}).fill('合成测试客户项目');
 await dialog.getByLabel('业务主负责人',{exact:false}).selectOption(admin.id);
 await dialog.getByLabel('业务客服组',{exact:true}).selectOption(team.id);
 const serviceChoices=dialog.getByRole('group',{name:'客服负责人（可多选）',exact:true});
 for(const member of serviceMembers)await serviceChoices.getByRole('checkbox',{name:member.name,exact:true}).check();
 const customerInput=dialog.getByRole('combobox',{name:'所属客户',exact:true});
 await customerInput.fill('qa-a');
 await page.getByRole('option',{name:/QA-A/}).click();
 assert.match(await customerInput.inputValue(),/QA-A.*合成客户甲/);
 await customerInput.fill('没有这个客户');
 await page.getByText('没有匹配的客户，请更换编码或名称。',{exact:true}).waitFor();
 await customerInput.press('Escape');
 await dialog.getByRole('button',{name:'保存记录',exact:true}).click();
 assert.equal(await customerInput.evaluate(input=>input.validity.valid),false);
 assert.equal((await workspace('customer-project-data')).projects.length,0,'Changing search text must clear the old customer ID');
 await customerInput.fill('客户甲');
 await page.getByRole('option',{name:/QA-A/}).waitFor();
 assert.equal(await page.getByRole('option',{name:/QB-B/}).count(),0);
 await page.screenshot({path:path.join(dir,'customer-search.png'),fullPage:true});
 await customerInput.press('Enter');
 assert.match(await customerInput.inputValue(),/QA-A.*合成客户甲/);
 pass('客户选择支持编码忽略大小写和中文片段查询；改搜索词清空旧客户，未选中不得保存');
 await dialog.getByRole('button',{name:'保存记录',exact:true}).click();
 await dialog.waitFor({state:'hidden'});
 let project=(await workspace('customer-project-data')).projects.find(p=>p.code==='SYNTH-PROJECT-01');assert(project);assert.equal(project.customerId,customer.id);
 assert.deepEqual(project.serviceMemberIds,serviceMembers.map(member=>member.id));
 assert.match(await page.locator('.cp-project-meta').innerText(),/客服：合成客服甲、合成客服乙/);
 await page.getByRole('button',{name:'维护项目',exact:true}).click();
 assert.equal(await dialog.getByRole('combobox',{name:'所属客户',exact:true}).isDisabled(),true);
 for(const member of serviceMembers)assert.equal(await serviceChoices.getByRole('checkbox',{name:member.name,exact:true}).isChecked(),true);
 await page.screenshot({path:path.join(dir,'project-multiple-service.png'),fullPage:true});
 await serviceChoices.getByRole('checkbox',{name:serviceMembers[1].name,exact:true}).uncheck();
 await dialog.getByRole('button',{name:'保存记录',exact:true}).click();await dialog.waitFor({state:'hidden'});
 project=(await workspace('customer-project-data')).projects.find(p=>p.id===project.id);assert.deepEqual(project.serviceMemberIds,[serviceMembers[0].id]);
 await page.getByRole('button',{name:'维护项目',exact:true}).click();
 assert.equal(await serviceChoices.getByRole('checkbox',{name:serviceMembers[0].name,exact:true}).isChecked(),true);
 assert.equal(await serviceChoices.getByRole('checkbox',{name:serviceMembers[1].name,exact:true}).isChecked(),false);
 await serviceChoices.getByRole('checkbox',{name:serviceMembers[1].name,exact:true}).check();
 await dialog.getByRole('button',{name:'保存记录',exact:true}).click();await dialog.waitFor({state:'hidden'});
 pass('客服负责人支持多人保存和编辑回显，取消勾选准确移除该负责人');
 for(const [index,session] of serviceSessions.entries()){
  const serviceContext=await browser.newContext({viewport:{width:1536,height:1050}}),at=session.cookie.indexOf('=');
  await serviceContext.addCookies([{name:session.cookie.slice(0,at),value:session.cookie.slice(at+1),url:origin,httpOnly:true,sameSite:'Strict'}]);
  const servicePage=await serviceContext.newPage();servicePage.on('pageerror',e=>errors.push(e.message));
  await servicePage.goto(origin+'/customer-projects');await servicePage.getByRole('heading',{name:'客户项目开发',exact:true}).waitFor();
  if(index<2){
   const row=servicePage.getByRole('row').filter({hasText:'合成测试客户项目'});await row.waitFor();assert.match(await row.innerText(),/合成客服甲、合成客服乙/);
   await row.getByRole('button',{name:'打开项目'}).click();await servicePage.getByRole('button',{name:'维护项目',exact:true}).waitFor();
   await servicePage.screenshot({path:path.join(dir,'project-service-'+(index+1)+'.png'),fullPage:true});
  }else{
   await servicePage.getByText('当前范围没有新项目。点击“新建项目”开始跟进；旧订单仍在原中台。',{exact:true}).waitFor();
   assert.equal(await servicePage.getByRole('row').filter({hasText:'合成测试客户项目'}).count(),0);
  }
  await serviceContext.close();
 }
 pass('两位客服分别登录均能看到和跟进同一项目，无关账号看不到项目');
 await page.screenshot({path:path.join(dir,'project-created.png'),fullPage:true});pass('浏览器新建客户项目成功，真实保存到隔离数据库');
 const taskTitle='合成两级审核跟进事项';
 await page.getByRole('button',{name:'沟通与待办',exact:true}).click();
 await page.getByRole('button',{name:'新增行动',exact:true}).click();
 await dialog.getByLabel('行动标题',{exact:false}).fill(taskTitle);
 await dialog.getByLabel('客服跟进人',{exact:false}).selectOption(serviceMembers[0].id);
 await dialog.getByLabel('客服审核人',{exact:false}).selectOption(serviceMembers[1].id);
 await dialog.getByLabel('业务审核人',{exact:false}).selectOption(admin.id);
 await dialog.getByLabel('下次跟进 / 完成日',{exact:false}).fill(day);
 await dialog.getByLabel('行动内容',{exact:false}).fill('合成跟进及两级意见验证');
 await dialog.getByRole('button',{name:'保存记录',exact:true}).click();await dialog.waitFor({state:'hidden'});
 assert.equal((await workspace('customer-project-data')).tasks.find(t=>t.title===taskTitle).roundId,'');
 await page.getByRole('button',{name:'需求与款色',exact:true}).click();
 await page.getByRole('button',{name:'增加款色',exact:true}).click();
 for(const [label,value] of [['内部款号','MODEL-X'],['客户款号','CLIENT-X'],['图纸编号','DRAW-X'],['色号','C1'],['镜片','RX'],['材质','Synthetic'],['开发目标数量（副）','10'],['该款色要求','Fixture only']])await dialog.getByLabel(label,{exact:false}).fill(value);
 await dialog.getByRole('button',{name:'保存记录',exact:true}).click();await dialog.waitFor({state:'hidden'});
 const item=(await workspace('customer-project-data')).items.find(i=>i.projectId===project.id&&i.model==='MODEL-X');assert(item);
 await page.getByRole('button',{name:'新建轮次',exact:true}).first().click();
 await dialog.getByLabel('轮次名称',{exact:false}).fill('R1 合成样办');
 await dialog.getByLabel('当前前期阶段',{exact:false}).selectOption('payment');
 await dialog.locator('input[type="number"]').fill('2');
 await dialog.getByRole('checkbox',{name:'2D 工程图',exact:true}).uncheck();
 await dialog.getByRole('checkbox',{name:/必须关联已接受报价/}).uncheck();
 await dialog.getByLabel('样办确认门槛',{exact:false}).selectOption('not_required');
 await dialog.getByLabel('本轮目标日',{exact:false}).fill(day);
 await dialog.getByLabel('开发 / 修改原因',{exact:false}).fill('Synthetic fixture');
 await dialog.getByRole('button',{name:'保存记录',exact:true}).click();await dialog.waitFor({state:'hidden'});
 const round=(await workspace('customer-project-data')).rounds.find(r=>r.projectId===project.id);assert(round);assert.equal(round.scope[0].quantity,2);
 pass('浏览器款色与开发轮次表单保存成功，数量和适用门槛准确');
 const release={token:token(),projectId:project.id,roundId:round.id,roundVersion:round.version,purpose:'development',scope:[{itemId:item.id,quantity:2}],drawingIds:[],quoteLinkId:'',ownerId:admin.id,requiredDate:day,note:'Synthetic sample'};
 await workspace('customer-project-sample-release',release,400);pass('未核定收费条件不能直接下样办单');
 const charges=[];
 for(const [title,category,amount] of [['Sample fee','sample','500'],['Tooling fee','tooling','1500']]){
  const charge=(await workspace('project-charge-save',{token:token(),projectId:project.id,roundId:round.id,title,category,currency:'USD',amount,prepayAmount:amount,dueDate:day,note:'Synthetic charge'})).record;
  charges.push((await workspace('project-charge-confirm',{token:token(),id:charge.id,version:charge.version})).record);
 }
 await workspace('project-payment-requirement',{token:token(),projectId:project.id,roundId:round.id,mode:'charges',reason:'Synthetic agreed sample and tooling fees',version:0});
 const receipt=(await workspace('project-receipt-verify',{token:token(),customerId:customer.id,amount:'2000',currency:'USD',date:day,reference:'SYNTHETIC-BANK-01',account:'SYNTHETIC-USD',payer:'Synthetic Customer',note:'Test only'})).record;
 for(const charge of charges)await workspace('project-allocation',{token:token(),receiptId:receipt.id,chargeId:charge.id,amount:(charge.amountCents/100).toFixed(2)});
 const doc=(await workspace('project-document-save',{token:token(),customerId:customer.id,documentType:'PI',documentNo:'SYNTHETIC-PI-01',chargeIds:charges.map(c=>c.id),currency:'USD',date:day,customerAddress:'Synthetic address',company:'DOON',terms:'Synthetic quotation only'})).record;
 await workspace('project-document-confirm',{token:token(),id:doc.id,version:doc.version});
 const print=await context.newPage();await print.goto(origin+'/api/workspace/project-document-print?id='+encodeURIComponent(doc.id));
 const printed=await print.locator('body').innerText();assert.match(printed,/2,?000\.00/);assert.match(printed,/Prepayment before order/);assert.doesNotMatch(printed,/下单前预收|尾款 \/ 账期/);await print.screenshot({path:path.join(dir,'sample-pi.png'),fullPage:true});await print.close();
 pass('样办和模具收费独立核实分配，PI通过真实打印页面核验');
 const sampleResult=await workspace('customer-project-sample-release',release);
 const repeated=await workspace('customer-project-sample-release',release);assert(repeated.idempotent);
 const state=await workspace('customer-project-data');assert.equal(state.rounds.find(r=>r.id===round.id).status,'transferred');assert.equal(state.samples.length,1);
 assert.equal((await workspace('data')).orders.length,0);pass('样办正式下达关闭本轮，重试不重复，旧大货订单总表不新增样办');
 await workspace('customer-project-communication',{token:token(),projectId:project.id,roundId:round.id,channel:'email',contact:'Synthetic Contact',occurredAt:day,content:'客户需要核对合成样办交期',nextAction:'回复预计寄样日期',ownerId:admin.id,dueDate:day,visibility:'customer',attachmentIds:[]});
 await page.reload();await page.getByRole('heading',{name:'客户项目开发',exact:true}).waitFor();
 await page.getByRole('row').filter({hasText:'合成测试客户项目'}).waitFor();
 await page.getByRole('row').filter({hasText:'合成测试客户项目'}).getByRole('button',{name:'打开项目'}).click();
 await page.screenshot({path:path.join(dir,'project-transferred.png'),fullPage:true});
 for(const label of ['需求与款色','沟通与待办','图纸与客批','报价版本','样办与寄样','费用与收款','PI / CI 单据','大货交接','售后与额外费用']){
  const tab=page.getByRole('button',{name:label,exact:true});await tab.click();await page.waitForTimeout(150);
 }
 await page.getByRole('button',{name:'沟通与待办',exact:true}).click();
 await page.getByRole('button',{name:'登记沟通',exact:true}).click();
 await dialog.getByLabel('客户联系人 / 对方姓名',{exact:false}).fill('Synthetic browser contact');
 await dialog.getByLabel('原始沟通内容 / 结论',{exact:false}).fill('浏览器登记客户确认寄样地址');
 await dialog.getByLabel('下一步行动',{exact:false}).fill('浏览器待办核对运单');
 await dialog.getByLabel('下一跟进日',{exact:false}).fill(day);
 await dialog.getByRole('button',{name:'保存记录',exact:true}).click();await dialog.waitFor({state:'hidden'});
 const communicated=await workspace('customer-project-data');assert(communicated.communications.some(c=>c.content==='浏览器登记客户确认寄样地址'));assert(communicated.tasks.some(t=>t.title==='浏览器待办核对运单'));
 pass('浏览器沟通表单成功生成对应行动项');
 await page.getByRole('row').filter({hasText:'浏览器待办核对运单'}).getByRole('button',{name:'取消行动',exact:true}).click();
 await dialog.getByLabel('取消原因',{exact:false}).fill('合成取消测试：缺审核配置也可正常取消');
 await dialog.getByRole('button',{name:'确认取消行动',exact:true}).click();await dialog.waitFor({state:'hidden'});
 assert.equal((await workspace('customer-project-data')).tasks.find(t=>t.title==='浏览器待办核对运单').status,'cancelled');
 const taskContexts=[];
 async function taskPage(session){
  const ctx=await browser.newContext({viewport:{width:1536,height:1050}}),at=session.cookie.indexOf('=');taskContexts.push(ctx);
  await ctx.addCookies([{name:session.cookie.slice(0,at),value:session.cookie.slice(at+1),url:origin,httpOnly:true,sameSite:'Strict'}]);
  const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());await p.goto(origin+'/customer-projects');return p;
 }
 async function openQueue(p,label){
  await p.reload();await p.getByRole('heading',{name:'客户项目开发',exact:true}).waitFor();
  await p.getByRole('button',{name:'跟进与审核',exact:true}).click();
  await p.locator('.cp-task-queues').getByRole('button',{name:new RegExp('^'+label)}).click();
  await p.getByRole('textbox',{name:'搜索跟进与审核事项',exact:true}).fill(taskTitle);
  return p.getByRole('row').filter({hasText:taskTitle});
 }
 async function submitResult(p,result){
  const row=await openQueue(p,'本人待跟进事项');await row.getByRole('button',{name:'已完成，提交审核',exact:true}).click();
  const modal=p.getByRole('dialog');await modal.getByLabel('完成结果 / 处理说明',{exact:false}).fill(result);
  await modal.getByRole('button',{name:'已完成，提交审核',exact:true}).click();await modal.waitFor({state:'hidden'});
  await row.waitFor({state:'hidden'});
 }
 async function reviewResult(p,stage,decision,comment){
  const row=await openQueue(p,stage==='service'?'待我客服审核':'待我业务审核');
  await row.getByRole('button',{name:stage==='service'?'客服审核':'业务审核',exact:true}).click();
  const modal=p.getByRole('dialog');assert.match(await modal.getByLabel('提交的完成结果',{exact:false}).inputValue(),/合成完成结果/);
  await modal.getByLabel('审核结论',{exact:false}).selectOption(decision);
  await modal.getByLabel('审核意见',{exact:true}).fill(comment);
  await modal.getByRole('button',{name:'提交审核意见',exact:true}).click();await modal.waitFor({state:'hidden'});
  await row.waitFor({state:'hidden'});
 }
 const followPage=await taskPage(serviceSessions[0]),reviewPage=await taskPage(serviceSessions[1]);
 await submitResult(followPage,'合成完成结果V1：核对客户要求');
 await reviewResult(reviewPage,'service','return','合成客服意见：请补充图纸版本');
 const returnedRow=await openQueue(followPage,'本人待跟进事项');await returnedRow.waitFor();assert.match(await returnedRow.innerText(),/请补充图纸版本/);
 await followPage.screenshot({path:path.join(dir,'task-returned-followup.png'),fullPage:true});
 await submitResult(followPage,'合成完成结果V2：已补图纸版本');
 await reviewResult(reviewPage,'service','approve','合成客服复核意见：已补充且通过');
 pass('指定跟进人登录可筛选本人事项并提交，指定客服可退回写意见，补充后再次通过进入业务审核');
 const salesRow=await openQueue(page,'待我业务审核');await salesRow.waitFor();assert.match(await salesRow.innerText(),/待业务审核/);
 await page.screenshot({path:path.join(dir,'task-sales-review.png'),fullPage:true});
 await reviewResult(page,'sales','approve','合成业务意见：同意完成');
 const doneRow=await openQueue(page,'已完成');await doneRow.waitFor();await doneRow.locator('summary').click();
 for(const opinion of ['合成客服意见：请补充图纸版本','合成客服复核意见：已补充且通过','合成业务意见：同意完成'])assert((await doneRow.innerText()).includes(opinion));
 const reviewed=(await workspace('customer-project-data')).tasks.find(t=>t.title===taskTitle);assert.equal(reviewed.status,'done');assert.equal(reviewed.reviewCycle,2);assert.equal(reviewed.reviewHistory.length,5);
 await page.screenshot({path:path.join(dir,'task-completed-history.png'),fullPage:true});
 for(const ctx of taskContexts)await ctx.close();
 pass('业务审核人独立队列通过后最终完成；完整保留跟进结果、退回与两级审核意见');
 assert.equal(errors.length,0,errors.join('\n'));pass('已转内部项目、沟通、费用与售后页面加载无脚本错误');
 await page.setViewportSize({width:1280,height:900});await page.screenshot({path:path.join(dir,'project-desktop.png'),fullPage:true});
 const current=new Map(originalRows().map(r=>[r.id,r.data]));for(const row of originals)assert.equal(current.get(row.id),row.data,'Existing record changed: '+row.id);
 pass('完整新项目流程未改写任何既有客户、账号或其他原记录');
 await fs.writeFile('test-output/customer-project-browser-result.json',JSON.stringify({passed:checks.length,checks,errors,manifestSha256:evidence.manifestSha256,at:new Date().toISOString(),artifacts:dir},null,2));
 console.log(JSON.stringify({passed:checks.length,artifacts:dir}));
}catch(e){await fs.writeFile(path.join(dir,'failure-log.txt'),logs);if(page){await page.screenshot({path:path.join(dir,'failure.png'),fullPage:true});await fs.writeFile(path.join(dir,'failure-ui.txt'),await page.locator('body').ariaSnapshot());}console.error('Browser artifacts:',dir);throw e;}
finally{if(browser)await browser.close();server.kill();}
