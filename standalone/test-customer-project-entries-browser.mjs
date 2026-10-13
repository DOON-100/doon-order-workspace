// All accounts and records are synthetic; this test uses a temporary database and port 18809.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';
import {verifyCustomerPriceBuildEvidence} from '../scripts/customer-price-build-evidence.mjs';

const dist=path.resolve(process.env.DOON_BUILD_DIR||'test-output/customer-project-build');
const evidence=await verifyCustomerPriceBuildEvidence(dist);
await fs.mkdir('test-output',{recursive:true});
const dir=await fs.mkdtemp(path.resolve('test-output/customer-project-entries-browser-'));
assert(dir.startsWith(path.resolve('test-output')+path.sep));
const origin='http://127.0.0.1:18809';
const env={...process.env,DOON_DATA_DIR:dir,DOON_HOST:'127.0.0.1',DOON_PORT:'18809',DOON_NO_AUTO_BACKUP:'1'};
execFileSync(process.execPath,[path.join(dist,'manage.mjs'),'init'],{env,stdio:'pipe',windowsHide:true});
const password=(await fs.readFile(path.join(dir,'管理员首次登录.txt'),'utf8')).match(/初始密码：([^\n]+)/)[1];
const server=spawn(process.execPath,[path.join(dist,'server.mjs')],{env,stdio:'pipe',windowsHide:true});
let logs='',cookie='',browser,page;
server.stdout.on('data',()=>{});
server.stderr.on('data',chunk=>{logs+=chunk;});
const checks=[],errors=[],pass=name=>{checks.push(name);console.log('PASS '+name);};
const token=()=>crypto.randomUUID();
async function api(route,body,expected=200){
 const response=await fetch(origin+'/api/'+route,{method:body===undefined?'GET':'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
 const data=await response.json();assert.equal(response.status,expected,route+' '+JSON.stringify(data));return data;
}
const workspace=(action,body,expected)=>api('workspace/'+action,body,expected);
function records(){const db=new DatabaseSync(path.join(dir,'workspace.sqlite'),{readOnly:true});try{return db.prepare('SELECT id,data FROM records ORDER BY id').all();}finally{db.close();}}

try{
 let healthy=false;
 for(let i=0;i<80;i++){try{if((await fetch(origin+'/health')).ok){healthy=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
 assert(healthy,'Isolated test server failed to start');
 await api('auth/login',{username:'admin',password});
 await api('auth/password',{currentPassword:password,password:'Synthetic-Entries-Admin-2026!'});
 const adminCookie=cookie;
 await api('auth/accounts',{username:'synthetic_entries_service',name:'合成独立登记客服',role:'sales',password:'Synthetic-Entries-Initial-2026!',customers:[]});
 await api('auth/login',{username:'synthetic_entries_service',password:'Synthetic-Entries-Initial-2026!'});
 await api('auth/password',{currentPassword:'Synthetic-Entries-Initial-2026!',password:'Synthetic-Entries-Personal-2026!'});
 const serviceCookie=cookie,service=(await workspace('data')).me;
 cookie=adminCookie;
 const customer=(await workspace('customer-save',{customer:'SYNTHETIC 独立登记客户',customerCode:'SYN-ENTRY',salesName:service.name,serviceName:service.name,pmcName:'',salesMemberIds:[service.id],serviceMemberIds:[service.id],quoteMemberIds:[],notes:'Synthetic browser fixture only',active:true})).item;
 cookie=serviceCookie;
 const project=(await workspace('customer-project-save',{token:token(),customerId:customer.id,code:'SYN-ENTRY-01',title:'合成独立新增修改项目',description:'Synthetic test without rounds or items',salesMemberId:service.id,serviceMemberIds:[service.id],status:'active'})).item;
 const originals=records();
 const initial=await workspace('customer-project-data');
 assert.equal(initial.rounds.filter(row=>row.projectId===project.id).length,0);
 assert.equal(initial.items.filter(row=>row.projectId===project.id).length,0);
 const playwright=await import(process.env.DOON_PLAYWRIGHT_MODULE?pathToFileURL(process.env.DOON_PLAYWRIGHT_MODULE).href:'playwright');
 browser=await playwright.chromium.launch({headless:true,...(process.env.DOON_CHROMIUM_PATH?{executablePath:process.env.DOON_CHROMIUM_PATH}:{channel:'chrome'}),args:['--no-proxy-server']});
 const context=await browser.newContext({viewport:{width:1536,height:1050}});
 const split=cookie.indexOf('=');
 await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),url:origin,httpOnly:true,sameSite:'Strict'}]);
 page=await context.newPage();page.setDefaultTimeout(15000);
 page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 async function openProject(){
  await page.goto(origin+'/customer-projects');
  const row=page.getByRole('row').filter({hasText:project.title});await row.waitFor();
  await row.getByRole('button',{name:'打开项目',exact:true}).click();
  await page.getByRole('button',{name:'维护项目',exact:true}).waitFor();
 }
 await openProject();
 const dialog=page.getByRole('dialog');
 async function save(){
  const responsePromise=page.waitForResponse(response=>response.url().includes('/api/workspace/')&&response.request().method()==='POST');
  await dialog.getByRole('button',{name:'保存记录',exact:true}).click();
  const response=await responsePromise;
  assert.equal(response.status(),200,response.url()+' '+await response.text());
  await dialog.waitFor({state:'hidden'});
 }

 const scenarios=[];
 const section=title=>page.locator('.cp-section').filter({has:page.getByRole('heading',{name:title,exact:true})});
 const markerFor=scenario=>'合成-'+scenario.key;
 async function entryScenario(scenario){
  await page.getByRole('button',{name:scenario.tab,exact:true}).click();
  const panel=section(scenario.section),marker=markerFor(scenario);
  await panel.getByRole('button',{name:scenario.add,exact:true}).click();
  await dialog.getByLabel(scenario.field,{exact:true}).fill(marker);
  for(const [label,value] of scenario.values||[])await dialog.getByLabel(label,{exact:true}).fill(value);
  for(const label of scenario.emptyFields||[])await dialog.getByLabel(label,{exact:true}).fill('');
  for(const [label,value] of scenario.selects||[])await dialog.getByLabel(label,{exact:true}).selectOption(value);
  for(const label of scenario.clearSelects||[])await dialog.getByLabel(label,{exact:true}).selectOption('');
  await save();
  const route=scenario.finance?'project-finance-data?projectId='+encodeURIComponent(project.id):'customer-project-data';
  const created=(await workspace(route))[scenario.collection].find(row=>row[scenario.property]===marker);
  assert(created,scenario.key+' not persisted');
  assert.equal(created.projectId,project.id);
  if(scenario.collection!=='items'&&scenario.collection!=='rounds')assert.equal(created.roundId||'','');
  const row=panel.locator(scenario.rowSelector||'tbody tr').filter({hasText:marker});await row.waitFor();
  await row.getByRole('button',{name:scenario.edit||'修改',exact:true}).click();
  assert.equal(await dialog.getByLabel(scenario.field,{exact:true}).inputValue(),marker);
  for(const label of scenario.clearSelects||[])assert.equal(await dialog.getByLabel(label,{exact:true}).inputValue(),'','Cleared optional field changed on edit: '+label);
  for(const label of scenario.emptyFields||[])assert.equal(await dialog.getByLabel(label,{exact:true}).inputValue(),'','Cleared optional field changed on edit: '+label);
  await dialog.getByLabel(scenario.field,{exact:true}).fill(marker+'-已修改');
  await save();
  const saved=(await workspace(route))[scenario.collection].find(row=>row.id===created.id);
  assert.equal(saved[scenario.property],marker+'-已修改');
  assert(saved.version>created.version,scenario.key+' version did not advance');
  scenarios.push({...scenario,id:saved.id});
  pass(scenario.key+'无需前置记录可新增、回显并独立修改');
 }

 // Test all downstream sections before adding the first item or development round.
 for(const scenario of [
  {key:'沟通',tab:'沟通与待办',section:'逐条沟通时间线',add:'登记沟通',field:'原始沟通内容 / 结论',collection:'communications',property:'content',rowSelector:'.cp-timeline article',values:[['下一步行动','仅说明下一步，不自动建立行动']]},
  {key:'行动',tab:'沟通与待办',section:'行动项',add:'新增行动',field:'行动标题',collection:'tasks',property:'title',clearSelects:['客服跟进人'],selects:[['行动状态','done']]},
  {key:'资料',tab:'图纸与客批',section:'项目资料与原件',add:'新增资料信息',field:'资料名称',collection:'attachments',property:'filename'},
  {key:'客批',tab:'图纸与客批',section:'客户图纸确认',add:'新增客批',field:'客户确认原文 / 依据',collection:'confirmations',property:'evidence'},
  {key:'图纸',tab:'图纸与客批',section:'图纸版本',add:'登记版本',field:'图号',collection:'drawings',property:'drawingNo'},
  {key:'报价',tab:'报价版本',section:'报价版本',add:'新增报价版本',field:'报价编号',collection:'quoteLinks',property:'quoteNo'},
  {key:'反馈',tab:'样办与寄样',section:'客户样办反馈',add:'新增反馈',field:'客户反馈原文',collection:'feedback',property:'evidence'},
  {key:'寄样',tab:'样办与寄样',section:'寄样与签收',add:'新增寄样',field:'运单号',collection:'dispatches',property:'trackingNo'},
  {key:'样办',tab:'样办与寄样',section:'样办记录',add:'新增样办',field:'样办单号',collection:'samples',property:'sampleNo'},
  {key:'大货交接',tab:'大货交接',section:'大货交接',add:'新增大货交接',field:'交接名称',collection:'handovers',property:'title'},
 ])await entryScenario(scenario);

 const beforeFinance=await workspace('customer-project-data');
 assert.equal(beforeFinance.rounds.length,0);assert.equal(beforeFinance.items.length,0);
 assert.equal(beforeFinance.tasks.filter(row=>row.projectId===project.id).length,1,'Communication must not create an unrelated task');
 assert.equal(beforeFinance.internalSamples?.length||0,0);
 assert.equal((await workspace('data')).orders.length,0,'Independent sample/handover must not create a formal order');
 pass('无款色无轮次的所有核心登记无正式转单或额外行动副作用');

 for(const scenario of [
  {key:'单据发送',tab:'PI / CI 单据',section:'单据发送记录',add:'登记发送',field:'邮件 / 发送依据',collection:'sends',property:'reference',emptyFields:['实际发送日']},
  {key:'对客单据',tab:'PI / CI 单据',section:'英文对客单据',add:'制作单据',field:'单据编号',collection:'documents',property:'documentNo',values:[['独立费用说明','Synthetic independent service'],['单据金额（独立部分）','123.45']],emptyFields:['单据日期','公司英文抬头']},
  {key:'售后成本',tab:'售后与额外费用',section:'售后额外成本',add:'新增费用',field:'费用说明',collection:'costs',property:'description',values:[['预算金额','25'],['实际费用','12.5']]},
  {key:'退款',tab:'售后与额外费用',section:'退款申请与实付',add:'新增退款记录',field:'说明 / 原因',collection:'refunds',property:'reason',values:[['金额','20']]},
  {key:'售后',tab:'售后与额外费用',section:'客户投诉与售后事项',add:'登记售后',field:'投诉 / 售后标题',collection:'cases',property:'title',clearSelects:['售后主办人']},
  {key:'到账',tab:'费用与收款',section:'客户实际到账与用途分配',add:'新增到账记录',field:'流水参考号',collection:'receipts',property:'reference',values:[['金额','500']]},
  {key:'分配',tab:'费用与收款',section:'收款用途分配',add:'新增分配记录',field:'说明 / 原因',collection:'allocations',property:'reason',values:[['金额','75']]},
  {key:'调整',tab:'费用与收款',section:'折让、豁免与追加应收',add:'新增调整记录',field:'说明 / 原因',collection:'adjustments',property:'reason',values:[['金额','15']]},
  {key:'抵扣',tab:'费用与收款',section:'样办费抵大货记录',add:'新增抵扣记录',field:'确认依据（可后补）',collection:'creditApplications',property:'evidence',values:[['金额','10']]},
  {key:'付款通知',tab:'费用与收款',section:'客户付款通知',add:'新增付款通知',field:'付款通知 / 水单编号',collection:'notices',property:'reference',values:[['客户通知金额','500']]},
  {key:'收费',tab:'费用与收款',section:'收费与应收',add:'新增收费项',field:'费用名称（对客单据建议英文）',collection:'charges',property:'title',values:[['应收总额','150']]},
 ])await entryScenario({...scenario,finance:true});
 const finance=await workspace('project-finance-data?projectId='+encodeURIComponent(project.id));
 assert.deepEqual(finance.totalsByCurrency,{});assert.deepEqual(finance.projectTotalsByCurrency,{});
 for(const type of ['receipts','allocations','adjustments','creditApplications','refunds']){
  const entry=finance[type].find(row=>row.projectId===project.id);assert.equal(entry.independent,true,type+' must remain an independent entry');
 }
 assert.equal(finance.documents[0].chargeIds.length,0);assert.equal(finance.costs[0].caseId,'');assert.equal(finance.sends[0].documentId,'');
 pass('无前置收费、单据、售后或到账时财务各区独立保存，不产生正式财务汇总');

 await entryScenario({key:'轮次',tab:'需求与款色',section:'开发轮次历史',add:'新建轮次',field:'轮次名称',collection:'rounds',property:'title'});
 await entryScenario({key:'款色',tab:'需求与款色',section:'项目款色子项',add:'增加款色',field:'内部款号',collection:'items',property:'model'});
 for(let i=0;i<2;i++){
  await section('项目款色子项').getByRole('button',{name:'增加款色',exact:true}).click();
  await dialog.getByLabel('内部款号',{exact:true}).fill('合成重复款号');
  await save();
 }
 const duplicateItems=(await workspace('customer-project-data')).items.filter(row=>row.projectId===project.id&&row.model==='合成重复款号');
 assert.equal(duplicateItems.length,2);assert.notEqual(duplicateItems[0].id,duplicateItems[1].id);
 await section('项目款色子项').getByRole('button',{name:'增加款色',exact:true}).click();
 await save();
 assert((await workspace('customer-project-data')).items.some(row=>row.projectId===project.id&&row.model==='未命名款色'));
 pass('相同款号可重复独立新增，空白款色可先保存再补充');

 await openProject();
 for(const tab of ['需求与款色','沟通与待办','图纸与客批','报价版本','样办与寄样','费用与收款','PI / CI 单据','大货交接','售后与额外费用']){
  await page.getByRole('button',{name:tab,exact:true}).click();
  for(const scenario of scenarios.filter(scenario=>scenario.tab===tab)){
   const panel=section(scenario.section);
   await panel.locator(scenario.rowSelector||'tbody tr').filter({hasText:markerFor(scenario)+'-已修改'}).waitFor();
  }
  await page.screenshot({path:path.join(dir,'tab-'+tab.replaceAll('/','-')+'.png'),fullPage:true});
 }
 pass('整页刷新后九个页签的修改全部保留，新增轮次后未关联轮次记录继续可见');

 assert.equal(errors.length,0,errors.join('\n'));
 const current=new Map(records().map(row=>[row.id,row.data]));
 for(const row of originals)assert.equal(current.get(row.id),row.data,'Fixture record changed: '+row.id);
 pass('所有独立登记浏览器操作无脚本错误且未改写既有记录');
 await page.screenshot({path:path.join(dir,'entries-final.png'),fullPage:true});
 const result={passed:checks.length,checks,errors,manifestSha256:evidence.manifestSha256,at:new Date().toISOString(),artifacts:dir};
 await fs.writeFile('test-output/customer-project-entries-browser-result.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify({passed:checks.length,artifacts:dir}));
}catch(error){
 await fs.writeFile(path.join(dir,'failure-log.txt'),logs);
 if(page){await page.screenshot({path:path.join(dir,'failure.png'),fullPage:true});await fs.writeFile(path.join(dir,'failure-ui.txt'),await page.locator('body').ariaSnapshot());}
 console.error('Browser artifacts:',dir);throw error;
}finally{if(browser)await browser.close();server.kill();}
