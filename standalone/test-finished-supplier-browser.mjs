// Real-browser regression against an isolated synthetic database and test build.
// This script never opens lan-data, production credentials, or port 8787.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import * as XLSX from 'xlsx';
import {verifyCustomerPriceBuildEvidence} from '../scripts/customer-price-build-evidence.mjs';

const {chromium}=await import(process.env.DOON_PLAYWRIGHT_MODULE?pathToFileURL(process.env.DOON_PLAYWRIGHT_MODULE).href:'playwright');
const dist=path.resolve(process.env.DOON_BUILD_DIR||'test-output/finished-supplier-build');
const testOutput=path.resolve('test-output');
assert(dist.startsWith(testOutput+path.sep),'Browser acceptance requires an isolated build in test-output.');
await fs.mkdir(testOutput,{recursive:true});
const root=await fs.mkdtemp(path.join(testOutput,'finished-supplier-browser-'));
const port=18808,origin=`http://127.0.0.1:${port}`;
const env={...process.env,DOON_SERVER_MODE:'internal',DOON_DATA_DIR:root,DOON_BUILD_DIR:dist,DOON_HOST:'127.0.0.1',DOON_PORT:String(port),DOON_NO_AUTO_BACKUP:'1',DOON_TLS_CERT:'',DOON_TLS_KEY:''};
const checks=[],errors=[],pass=text=>{checks.push(text);console.log('PASS '+text);};
const buildEvidence=await verifyCustomerPriceBuildEvidence(dist);
execFileSync(process.execPath,[path.join(dist,'manage.mjs'),'init'],{env,stdio:'pipe',windowsHide:true});
// Only a freshly generated credential in this temporary synthetic database.
const initial=(await fs.readFile(path.join(root,'管理员首次登录.txt'),'utf8')).match(/初始密码：([^\n]+)/)[1];
const admin={cookie:''},backup={cookie:''};
const personal='Synthetic-Jinbo-Personal-2026!',firstPassword='Synthetic-Jinbo-Initial-2026!';
let server,browser,logs='';
const date=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
const next=new Date(Date.now()+7*86400000).toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
async function api(route,body,session=admin){
 const response=await fetch(origin+'/api/'+route,{method:body===undefined?'GET':'POST',headers:{Origin:origin,...(session.cookie?{Cookie:session.cookie}:{}),...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});
 if(response.headers.get('set-cookie'))session.cookie=response.headers.get('set-cookie').split(';')[0];
 const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;
}
async function useCookie(context,cookie){const split=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),url:origin,httpOnly:true,sameSite:'Strict'}]);}
async function noOverflow(page){assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'The supplier portal must not overflow a 390px viewport.');}
async function supplierSave(page,action){
 const response=page.waitForResponse(r=>r.url().endsWith('/finished-supplier-'+action)&&r.request().method()==='POST');
 await page.getByRole('button',{name:'提交并保存到中台',exact:true}).click();
 const r=await response;assert.equal(r.status(),200,JSON.stringify(await r.json()));
 await page.locator('.sp-success').filter({hasText:'中台已保存'}).waitFor();
 await page.getByRole('button',{name:'提交并保存到中台',exact:true}).waitFor();
}
async function loginSupplier(page,username,password){await page.getByLabel('供应商登录账号',{exact:true}).fill(username);await page.getByLabel('供应商登录密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录并查看我的任务',exact:true}).click();}
async function chooseSupplierTask(page,orderNo){await page.locator('.sp-task-card').filter({hasText:orderNo}).click();await page.getByRole('heading',{name:'填写本次进度',exact:true}).waitFor();}
async function companyTask(page,panel,orderNo){
 await panel.getByRole('button',{name:'刷新',exact:true}).click();
 await panel.locator('.fs-table tbody tr').filter({hasText:orderNo}).first().getByRole('button',{name:'查看 / 验收',exact:true}).click();
 await panel.getByRole('heading',{name:'公司登记',exact:true}).waitFor();
}
async function companyOperation(page,panel,action,reference,values){
 await panel.getByLabel('成品公司登记类型',{exact:true}).selectOption(action);
 if(reference){const options=await panel.getByLabel('验收对应送货批次',{exact:true}).locator('option').evaluateAll(elements=>elements.map(e=>({value:e.value,label:e.textContent})));const option=options.find(o=>o.label.includes(reference));assert(option,'Missing shipment option '+reference);await panel.getByLabel('验收对应送货批次',{exact:true}).selectOption(option.value);}
 if(action==='qc'){await panel.getByLabel('本次QC合格数',{exact:true}).fill(String(values.accepted));await panel.getByLabel('本次QC不良数',{exact:true}).fill(String(values.rejected));}
 else if(action!=='close')await panel.getByLabel('公司操作本次数量',{exact:true}).fill(String(values.quantity));
 await panel.getByLabel('公司操作业务日期',{exact:true}).fill(date);
 await panel.getByLabel('公司操作说明',{exact:true}).fill(values.note||'合成浏览器测试核对');
 const response=page.waitForResponse(r=>r.url().endsWith('/finished-supplier-'+action)&&r.request().method()==='POST');
 await panel.getByRole('button',{name:'确认保存本次记录',exact:true}).click();
 const r=await response;assert.equal(r.status(),200,JSON.stringify(await r.json()));
 await panel.locator('.fs-success').filter({hasText:'中台已保存'}).waitFor();
 await page.waitForFunction(()=>!document.querySelector('.fs-operation fieldset')?.disabled);
}

try{
 server=spawn(process.execPath,[path.join(dist,'server.mjs')],{env,stdio:'pipe',windowsHide:true});server.stdout.on('data',b=>logs+=b);server.stderr.on('data',b=>logs+=b);
 let ready=false;for(let i=0;i<60;i++){try{if((await fetch(origin+'/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert(ready,'Temporary server failed to start.');
 await api('auth/login',{username:'admin',password:initial});await api('auth/password',{currentPassword:initial,password:'Synthetic-Admin-Personal-2026!'});
 const meiluo=await api('workspace/supplier-save',{name:'美洛',contact:'合成测试联系人',phone:'',notes:'仅用于待核成品付单位测试',active:true});
 const master=await api('workspace/supplier-save',{name:'金博',contact:'合成试点联系人',phone:'',notes:'仅测试，不用于生产',active:true});
 const book=XLSX.utils.book_new(),sheet={};
 for(const [address,value] of Object.entries({A3:'生产厂',I3:'订单号',J3:'图纸编号',M3:'订单数量',W3:'产品类型',BF3:'包装入仓数量',A4:'金博',I4:'SYN-JB-UI-1',J4:'SYN-FRAME-1',L4:'C1',C4:'INTERNAL-CUSTOMER-SYNTHETIC',M4:10,BF4:0,W4:'合成金属架',T4:next,U4:next,AB4:'INTERNAL-NOTE-DO-NOT-EXPOSE',A5:'金博',I5:'SYN-JB-UI-2',J5:'SYN-FRAME-2',L5:'C2',C5:'INTERNAL-CUSTOMER-SYNTHETIC',M5:5,BF5:0,W5:'合成金属架',T5:next,U5:next,A6:'美洛',I6:'SYN-ML-UI-80',J6:'SYN-ML-FRAME-80',L6:'ML1',C6:'INTERNAL-ML-CUSTOMER',M6:80,W6:'配件',A7:'美洛',I7:'SYN-ML-UI-120',J7:'SYN-ML-FRAME-120',L7:'ML2',C7:'INTERNAL-ML-CUSTOMER',M7:120,W7:'配件'}))sheet[address]={t:typeof value==='number'?'n':'s',v:value};
 sheet['!ref']='A1:BK7';XLSX.utils.book_append_sheet(book,sheet,'动态表');
 const form=new FormData();form.set('file',new File([XLSX.write(book,{type:'buffer',bookType:'xlsx'})],'synthetic-jinbo.xlsx'));form.set('mode','active');let job=await api('workspace/ledger-preview',form);while(job.status!=='已完成')job=await api('workspace/ledger-commit',{id:job.id,offset:job.offset});
 await api('auth/accounts',{username:'jinbo_primary',name:'金博合成主填报',password:firstPassword,role:'supplier',supplierId:master.id});
 await api('auth/accounts',{username:'jinbo_backup',name:'金博合成替补',password:firstPassword,role:'supplier',supplierId:master.id});
 await api('auth/login',{username:'jinbo_backup',password:firstPassword},backup);await api('auth/password',{currentPassword:firstPassword,password:personal},backup);
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-proxy-server']});
 const companyContext=await browser.newContext({viewport:{width:1510,height:1050}});await useCookie(companyContext,admin.cookie);
 const company=await companyContext.newPage();company.on('pageerror',e=>errors.push(e.message));await company.goto(origin+'/finished-outsourcing');
 const panel=company.locator('.finished-supplier-panel');await panel.getByRole('heading',{name:'成品外发供应商协作',exact:true}).waitFor();
 assert.equal(await company.locator('.pmc-sheet-panel').count(),1);pass('The supplier panel coexists with the existing external PMC scheduling table.');
 await panel.getByRole('button',{name:'下发任务与核定基线',exact:true}).click();
 await panel.getByLabel('任务供应商',{exact:true}).selectOption(master.id);
 const orders=(await api('workspace/data')).orders;const order=orders.find(o=>o.orderNo==='SYN-JB-UI-1'),secondOrder=orders.find(o=>o.orderNo==='SYN-JB-UI-2');assert(order&&secondOrder);
 await panel.getByLabel('下发成品外发订单',{exact:true}).selectOption(order.id);
 await panel.getByLabel('实际工艺模板',{exact:true}).selectOption('metal');
 const template=(await api('workspace/finished-supplier-data')).templates.find(t=>t.id==='metal');
 for(const step of template.steps)await panel.getByLabel(step.label+'期初完成量',{exact:true}).fill(step.id==='packing'?'2':'0');
 await panel.getByLabel('任务要求交货日期',{exact:true}).fill(next);await panel.getByLabel('切换基线日期',{exact:true}).fill(date);
 await panel.locator('.fs-baseline').filter({hasText:'期初已发在途'}).getByRole('button',{name:'添加记录',exact:true}).click();
 await panel.getByLabel('期初已发在途1单号',{exact:true}).fill('SYN-BASE-TRANSIT-2');await panel.getByLabel('期初已发在途1数量',{exact:true}).fill('2');await panel.getByLabel('期初已发在途1日期',{exact:true}).fill(date);
 for(const label of ['期初已发在途','期初已到待检','期初待返工'])await panel.getByRole('checkbox',{name:'已核对'+label+'；没有记录表示已核实为0',exact:true}).check();
 await panel.getByLabel('基线核对说明',{exact:true}).fill('合成试点基线已逐笔核对');
 const creation=company.waitForResponse(r=>r.url().endsWith('/finished-supplier-task-create')&&r.request().method()==='POST');await panel.getByRole('button',{name:'确认基线并下发任务',exact:true}).click();const created=await creation;assert.equal(created.status(),200,JSON.stringify(await created.json()));
 await panel.locator('.fs-success').waitFor();let records=await api('workspace/finished-supplier-data'),main=records.tasks.find(t=>t.lineId===order.id);assert(main);assert.equal(records.shipments.find(s=>s.taskId===main.id).source,'baseline-transit');assert.equal(records.shipments.find(s=>s.taskId===main.id).quantity,2);pass('Real company UI publishes a task with an explicit non-empty initial-transit array accepted by the strict API.');
 await api('workspace/finished-supplier-task-create',{lineId:secondOrder.id,supplierId:master.id,orderVersion:secondOrder.version,template:'metal',steps:[{id:'packing',label:'包装'}],dueDate:next,baseline:{cutoffDate:date,confirmed:true,stepCompleted:{packing:0},inTransit:[],pendingInspection:[],reworks:[],note:'合成第二任务用于草稿隔离'},token:crypto.randomUUID()});
 // Synthetic Meiluo orders begin with an incorrect imported product type and
 // unknown BF. Business clarification and pending release never infer zero.
 let meiluoOrders=(await api('workspace/data')).orders.filter(o=>o.orderNo.startsWith('SYN-ML-UI-'));
 assert.equal(meiluoOrders.length,2);
 for(const o of meiluoOrders)await api('workspace/finished-supplier-order-confirm',{lineId:o.id,orderVersion:o.version,productType:'成品',businessType:'finished_full_outsource',unit:'付',note:'合成用户确认：成品送货，单位付，成品整单外发',token:crypto.randomUUID()});
 await api('auth/accounts',{username:'meiluo_primary',name:'美洛合成填报人',password:firstPassword,role:'supplier',supplierId:meiluo.id});
 const meiluoSession={cookie:''};await api('auth/login',{username:'meiluo_primary',password:firstPassword},meiluoSession);await api('auth/password',{currentPassword:firstPassword,password:personal},meiluoSession);
 meiluoOrders=(await api('workspace/data')).orders.filter(o=>o.orderNo.startsWith('SYN-ML-UI-'));
 const meiluoOrder=meiluoOrders.find(o=>o.orderNo==='SYN-ML-UI-80'),meiluoSecond=meiluoOrders.find(o=>o.orderNo==='SYN-ML-UI-120');
 await company.reload();await panel.getByRole('heading',{name:'成品外发供应商协作',exact:true}).waitFor();
 await panel.getByRole('button',{name:'下发任务与核定基线',exact:true}).click();
 await panel.getByLabel('任务下发方式',{exact:true}).selectOption('pending');
 await panel.getByLabel('任务供应商',{exact:true}).selectOption(meiluo.id);
 await panel.getByLabel('下发成品外发订单',{exact:true}).selectOption(meiluoOrder.id);
 await panel.getByLabel('实际工艺模板',{exact:true}).selectOption('custom');
 const custom=(await api('workspace/finished-supplier-data')).templates.find(t=>t.id==='custom');
 for(const step of custom.steps)if(!['inspection','packing'].includes(step.id))await panel.getByRole('checkbox',{name:step.label,exact:true}).uncheck();
 await panel.getByLabel('任务要求交货日期',{exact:true}).fill('');await panel.getByLabel('切换基线日期',{exact:true}).fill(date);await panel.getByLabel('基线核对说明',{exact:true}).fill('合成美洛全量成品订单先下发，所有历史期初待公司核对');
 assert.equal(await panel.getByRole('checkbox',{name:/已核对期初/}).count(),0);
 const pendingCreation=company.waitForResponse(r=>r.url().endsWith('/finished-supplier-task-create')&&r.request().method()==='POST');
 await panel.getByRole('button',{name:'下发待公司核定任务',exact:true}).click();const pendingResponse=await pendingCreation;assert.equal(pendingResponse.status(),200,JSON.stringify(await pendingResponse.json()));
 assert.deepEqual(Object.keys(pendingResponse.request().postDataJSON().baseline).sort(),['confirmed','cutoffDate','note']);
 await panel.getByRole('heading',{name:'公司核定完整期初',exact:true}).waitFor();
 records=await api('workspace/finished-supplier-data');const pendingMain=records.tasks.find(t=>t.lineId===meiluoOrder.id);assert(pendingMain);assert.equal(pendingMain.unit,'付');assert.equal(pendingMain.baselineStatus,'pending');for(const key of ['baselineStock','stocked','remaining','normalDispatched'])assert.equal(pendingMain[key],null,key+' must remain unknown');
 assert.equal(await panel.getByLabel('成品公司登记类型',{exact:true}).count(),0);pass('Meiluo 80-pair task is released by company UI with explicit pending quantities, no zero defaults and no company numeric actions.');
 const pendingSteps=custom.steps.filter(s=>['inspection','packing'].includes(s.id));
 await api('workspace/finished-supplier-task-create',{lineId:meiluoSecond.id,supplierId:meiluo.id,orderVersion:meiluoSecond.version,template:'custom',steps:pendingSteps,dueDate:'',baseline:{confirmed:false,cutoffDate:date,note:'合成美洛120付订单先下发，历史期初未知'},token:crypto.randomUUID()});
 const meiluoPhoneContext=await browser.newContext({viewport:{width:390,height:844}});await useCookie(meiluoPhoneContext,meiluoSession.cookie);
 const meiluoPhone=await meiluoPhoneContext.newPage();meiluoPhone.on('pageerror',e=>errors.push(e.message));await meiluoPhone.goto(origin+'/supplier-portal');
 await meiluoPhone.locator('.sp-task-card').filter({hasText:'SYN-ML-UI-80'}).waitFor();const pendingCards=await meiluoPhone.locator('.sp-task-card').allInnerTexts();assert.equal(pendingCards.length,2);assert(pendingCards.some(t=>t.includes('80付')));assert(pendingCards.some(t=>t.includes('120付')));assert(pendingCards.every(t=>t.includes('待核付')&&!t.includes('副')));await noOverflow(meiluoPhone);
 await chooseSupplierTask(meiluoPhone,'SYN-ML-UI-80');await meiluoPhone.getByLabel('供应商本次说明',{exact:true}).fill('美洛合成任务已接收，期初数量需要公司核对');await supplierSave(meiluoPhone,'accept');
 let pendingModes=await meiluoPhone.getByLabel('供应商本次操作',{exact:true}).locator('option').evaluateAll(elements=>elements.map(e=>e.value));assert.deepEqual(pendingModes,['promise','exception']);assert.equal(await meiluoPhone.getByLabel('本次新增有效完成数',{exact:true}).count(),0);assert.equal(await meiluoPhone.getByLabel('本批发货数量',{exact:true}).count(),0);
 await meiluoPhone.getByLabel('供应商承诺交货日期',{exact:true}).fill(next);await meiluoPhone.getByLabel('供应商本次说明',{exact:true}).fill('合成美洛回复交期，要求交期仍待确认');await supplierSave(meiluoPhone,'promise');
 await meiluoPhone.getByLabel('供应商本次操作',{exact:true}).selectOption('exception');await meiluoPhone.getByLabel('供应商本次说明',{exact:true}).fill('合成历史在途凭证需双方核对');await supplierSave(meiluoPhone,'exception');
 await meiluoPhone.getByLabel('上传任务凭证',{exact:true}).setInputFiles({name:'synthetic-pending-note.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRXYAAAAASUVORK5CYII=','base64')});
 const pendingUpload=meiluoPhone.waitForResponse(r=>r.url().endsWith('/finished-supplier-attachment')&&r.request().method()==='POST');await meiluoPhone.getByRole('button',{name:'上传凭证',exact:true}).click();assert.equal((await pendingUpload).status(),200);await meiluoPhone.getByText('任务凭证已保存到中台。',{exact:true}).waitFor();await meiluoPhone.screenshot({path:path.join(root,'meiluo-pending-mobile.png'),fullPage:true});
 records=await api('workspace/finished-supplier-data');assert.equal(records.tasks.find(t=>t.id===pendingMain.id).stocked,null);assert.equal(records.shipments.filter(s=>s.taskId===pendingMain.id).length,0);assert.deepEqual(records.events.filter(e=>e.taskId===pendingMain.id).map(e=>e.action).filter(a=>a!=='attachment'),['task-create','accept','promise','exception']);pass('Meiluo phone displays 80 and 120 in 付, accepts a pending task, saves promise/exception/attachment and offers no progress or shipping quantities.');
 await panel.getByRole('button',{name:'刷新',exact:true}).click();
 await panel.getByLabel('确认期初BF入仓量',{exact:true}).fill('0');await panel.getByLabel('核定截止日期',{exact:true}).fill(date);await panel.getByLabel('供应商终检核定期初完成量',{exact:true}).fill('2');await panel.getByLabel('包装核定期初完成量',{exact:true}).fill('2');await panel.getByLabel('完整期初核定依据',{exact:true}).fill('合成公司凭证确认期初在途2付，BF0付，待检返工均为0');
 assert(await panel.getByRole('button',{name:'确认完整期初并开放数量协作',exact:true}).isDisabled());
 await panel.locator('.fs-baseline-confirm .fs-baseline').filter({hasText:'期初已发在途'}).getByRole('button',{name:'添加记录',exact:true}).click();
 await panel.getByLabel('期初已发在途1单号',{exact:true}).fill('SYN-ML-BASE-2');await panel.getByLabel('期初已发在途1数量',{exact:true}).fill('2');await panel.getByLabel('期初已发在途1日期',{exact:true}).fill(date);
 for(const label of ['期初已发在途','期初已到待检','期初待返工'])await panel.getByRole('checkbox',{name:'已核对'+label+'；没有记录表示已核实为0',exact:true}).check();
 const baselineConfirmation=company.waitForResponse(r=>r.url().endsWith('/finished-supplier-baseline-confirm')&&r.request().method()==='POST');await panel.getByRole('button',{name:'确认完整期初并开放数量协作',exact:true}).click();const baselineConfirmed=await baselineConfirmation;assert.equal(baselineConfirmed.status(),200,JSON.stringify(await baselineConfirmed.json()));await panel.getByRole('heading',{name:'公司登记',exact:true}).waitFor();
 records=await api('workspace/finished-supplier-data');const confirmedMeiluo=records.tasks.find(t=>t.id===pendingMain.id);assert.equal(confirmedMeiluo.baselineStatus,'confirmed');assert.equal(confirmedMeiluo.stocked,0);assert.equal(confirmedMeiluo.remaining,80);assert(confirmedMeiluo.acceptedAt);assert.equal(confirmedMeiluo.promisedDate,next);assert.equal(records.shipments.find(s=>s.taskId===pendingMain.id).quantity,2);
 await meiluoPhone.getByRole('button',{name:'刷新我的任务',exact:true}).click();await meiluoPhone.getByLabel('供应商本次操作',{exact:true}).locator('option[value=progress]').waitFor({state:'attached'});pendingModes=await meiluoPhone.getByLabel('供应商本次操作',{exact:true}).locator('option').evaluateAll(elements=>elements.map(e=>e.value));assert(pendingModes.includes('progress')&&pendingModes.includes('shipment'));await meiluoPhone.screenshot({path:path.join(root,'meiluo-confirmed-mobile.png'),fullPage:true});pass('Company confirms all Meiluo baseline categories explicitly; original acceptance/promise/exception survive and numeric collaboration opens only after confirmation.');
 await meiluoPhoneContext.close();
 const phoneContext=await browser.newContext({viewport:{width:390,height:844}});await phoneContext.addInitScript(()=>Object.defineProperty(Crypto.prototype,'randomUUID',{value:undefined,configurable:true}));
 const phone=await phoneContext.newPage(),phoneRequests=[];phone.on('pageerror',e=>errors.push(e.message));phone.on('request',r=>{if(r.url().includes('/api/workspace/'))phoneRequests.push(new URL(r.url()).pathname);});await phone.goto(origin+'/supplier-portal');
 await loginSupplier(phone,'jinbo_primary',firstPassword);await phone.getByRole('heading',{name:'先设置个人密码',exact:true}).waitFor();
 await phone.getByLabel('当前初始密码',{exact:true}).fill(firstPassword);await phone.getByLabel('新密码',{exact:true}).fill(personal);await phone.getByLabel('再次输入新密码',{exact:true}).fill(personal);await phone.getByRole('button',{name:'保存密码并进入任务',exact:true}).click();
 await phone.locator('.sp-task-card').filter({hasText:'SYN-JB-UI-1'}).waitFor();assert.equal(await phone.locator('.rail').count(),0);assert.doesNotMatch(await phone.locator('body').innerText(),/INTERNAL-CUSTOMER|INTERNAL-NOTE|PMC 排期总表|成员与权限/);await noOverflow(phone);pass('Phone login enforces initial password change, exposes only the supplier portal and has no 390px horizontal overflow.');
 await chooseSupplierTask(phone,'SYN-JB-UI-1');await phone.getByLabel('供应商本次操作',{exact:true}).selectOption('accept');await phone.getByLabel('供应商本次说明',{exact:true}).fill('已收到合成任务和技术资料');await supplierSave(phone,'accept');records=await api('workspace/finished-supplier-data');assert(records.tasks.find(t=>t.id===main.id).acceptedAt);pass('Supplier accepts the released task through the phone UI.');
 await phone.getByLabel('供应商本次操作',{exact:true}).selectOption('progress');await phone.getByLabel('本次报工工序',{exact:true}).selectOption('packing');await phone.getByLabel('本次新增有效完成数',{exact:true}).fill('6');await phone.getByLabel('供应商本次说明',{exact:true}).fill('包装新增6副，模拟回执丢失');
 // The server commits successfully, but the browser loses the response.
 const lostRoute='**/api/workspace/finished-supplier-progress';let submittedToken='';
 await phone.route(lostRoute,async route=>{submittedToken=route.request().postDataJSON().token;const response=await route.fetch();assert.equal(response.status(),200);await route.abort('failed');});
 await phone.getByRole('button',{name:'提交并保存到中台',exact:true}).click();await phone.getByText('提交结果待确认',{exact:true}).waitFor();records=await api('workspace/finished-supplier-data');assert.equal(records.tasks.find(t=>t.id===main.id).stages.find(s=>s.id==='packing').completed,8);
 assert(await phone.evaluate(token=>Object.values(localStorage).some(value=>value.includes(token)),submittedToken));
 await phone.unroute(lostRoute);const retry=phone.waitForResponse(r=>r.url().endsWith('/finished-supplier-progress')&&r.request().method()==='POST');await phone.getByRole('button',{name:'重试原提交并核对结果',exact:true}).click();assert.equal((await retry).status(),200);await phone.locator('.sp-success').filter({hasText:'中台已保存'}).waitFor();
 records=await api('workspace/finished-supplier-data');assert.equal(records.tasks.find(t=>t.id===main.id).stages.find(s=>s.id==='packing').completed,8);assert.equal(records.events.filter(e=>e.taskId===main.id&&e.action==='progress').length,1);pass('A committed progress response lost in transit is retried with the original token and is counted exactly once.');
 await phone.getByLabel('供应商本次操作',{exact:true}).selectOption('shipment');await phone.getByLabel('供应商送货单号',{exact:true}).fill('SYN-JB-SHIP-6');await phone.getByLabel('本批发货数量',{exact:true}).fill('6');await phone.getByLabel('预计到货日期',{exact:true}).fill(date);await phone.getByLabel('供应商本次说明',{exact:true}).fill('合成分批送货6副');
 await phone.getByLabel('上传送货凭证',{exact:true}).setInputFiles({name:'synthetic-delivery.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRXYAAAAASUVORK5CYII=','base64')});
 const uploaded=phone.waitForResponse(r=>r.url().endsWith('/finished-supplier-attachment')&&r.request().method()==='POST');await phone.getByRole('button',{name:'上传凭证',exact:true}).click();assert.equal((await uploaded).status(),200);await phone.getByText(/本次已关联1份凭证/).waitFor();await supplierSave(phone,'shipment');
 records=await api('workspace/finished-supplier-data');assert.equal(records.shipments.find(s=>s.reference==='SYN-JB-SHIP-6').attachmentIds.length,1);await noOverflow(phone);await phone.screenshot({path:path.join(root,'supplier-mobile.png'),fullPage:true});pass('The phone submits a partial shipment with a stored, task-bound delivery attachment without secure-context randomUUID.');
 await companyTask(company,panel,'SYN-JB-UI-1');
 await companyOperation(company,panel,'receive','SYN-BASE-TRANSIT-2',{quantity:2});await companyOperation(company,panel,'qc','SYN-BASE-TRANSIT-2',{accepted:2,rejected:0});await companyOperation(company,panel,'stock','SYN-BASE-TRANSIT-2',{quantity:2});
 await companyOperation(company,panel,'receive','SYN-JB-SHIP-6',{quantity:6});await companyOperation(company,panel,'qc','SYN-JB-SHIP-6',{accepted:5,rejected:1,note:'合成测试1副QC不良返工'});await companyOperation(company,panel,'stock','SYN-JB-SHIP-6',{quantity:5});
 records=await api('workspace/finished-supplier-data');let source=(await api('workspace/data')).orders.find(o=>o.id===order.id);assert.equal(source.ledger.columns.BF,'7');assert.equal(records.tasks.find(t=>t.id===main.id).stocked,7);assert.equal(records.reworks.filter(r=>r.taskId===main.id).length,1);pass('Company UI handles initial transit and a partial shipment through actual receipt, QC and stock; BF and the confirmed ledger both equal 7.');
 await phone.getByRole('button',{name:'刷新我的任务',exact:true}).click();await phone.getByLabel('供应商本次操作',{exact:true}).selectOption('rework-confirm');const rework=records.reworks.find(r=>r.taskId===main.id);await phone.getByLabel('供应商待确认返工单',{exact:true}).selectOption(rework.id);await phone.getByLabel('供应商本次说明',{exact:true}).fill('已确认返工并安排复送');await supplierSave(phone,'rework-confirm');
 await phone.getByLabel('供应商本次操作',{exact:true}).selectOption('shipment');await phone.getByLabel('分批交货类型',{exact:true}).selectOption(rework.id);await phone.getByLabel('供应商送货单号',{exact:true}).fill('SYN-JB-REWORK-1');await phone.getByLabel('本批发货数量',{exact:true}).fill('1');await phone.getByLabel('预计到货日期',{exact:true}).fill(date);await phone.getByLabel('供应商本次说明',{exact:true}).fill('合成返工复送1副');await supplierSave(phone,'shipment');
 await companyTask(company,panel,'SYN-JB-UI-1');await companyOperation(company,panel,'receive','SYN-JB-REWORK-1',{quantity:1});await companyOperation(company,panel,'qc','SYN-JB-REWORK-1',{accepted:1,rejected:0});await companyOperation(company,panel,'stock','SYN-JB-REWORK-1',{quantity:1});
 records=await api('workspace/finished-supplier-data');source=(await api('workspace/data')).orders.find(o=>o.id===order.id);assert.equal(source.ledger.columns.BF,'8');assert.equal(records.tasks.find(t=>t.id===main.id).stocked,8);assert.equal(records.tasks.find(t=>t.id===main.id).stages.find(s=>s.id==='packing').completed,8);assert.equal(records.reworks.find(r=>r.id===rework.id).status,'已关闭');pass('QC rejection, phone rework confirmation and reshipment complete one rework round without counting the original process quantity twice.');
 await company.screenshot({path:path.join(root,'company-receiving.png'),fullPage:true});
 // Task isolation and account isolation use one browser origin, as on a shared phone.
 await phone.getByRole('button',{name:'刷新我的任务',exact:true}).click();await phone.getByLabel('供应商本次说明',{exact:true}).fill('草稿-A-任务1');await phone.getByRole('button',{name:'我的任务',exact:true}).click();await chooseSupplierTask(phone,'SYN-JB-UI-2');await phone.getByLabel('供应商本次说明',{exact:true}).fill('草稿-A-任务2');await phone.getByRole('button',{name:'我的任务',exact:true}).click();await chooseSupplierTask(phone,'SYN-JB-UI-1');assert.equal(await phone.getByLabel('供应商本次说明',{exact:true}).inputValue(),'草稿-A-任务1');
 await phone.waitForFunction(()=>Object.keys(localStorage).filter(k=>k.startsWith('doon-finished-supplier-draft:jinbo_primary:')).length===2);const primaryCookies=await phoneContext.cookies(origin);pass('Unsubmitted drafts stay separate for two different tasks in the same supplier account.');
 await useCookie(phoneContext,backup.cookie);await phone.reload();await phone.locator('.sp-task-card').filter({hasText:'SYN-JB-UI-1'}).waitFor();await chooseSupplierTask(phone,'SYN-JB-UI-1');assert.equal(await phone.getByLabel('供应商本次说明',{exact:true}).inputValue(),'');await phone.getByLabel('供应商本次说明',{exact:true}).fill('草稿-B-任务1');await phone.waitForFunction(()=>Object.keys(localStorage).some(k=>k.startsWith('doon-finished-supplier-draft:jinbo_backup:')));
 await phone.getByRole('button',{name:'退出',exact:true}).click();await phone.getByRole('heading',{name:'供应商手机工作台',exact:true}).waitFor();assert.equal(await phone.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('doon-finished-supplier-draft:jinbo_backup:')).length),0);assert.equal(await phone.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('doon-finished-supplier-draft:jinbo_primary:')).length),2);pass('A second personal account cannot read the first account drafts; logout removes only the second account personal drafts.');
 await phoneContext.addCookies(primaryCookies);await phone.reload();await phone.locator('.sp-task-card').filter({hasText:'SYN-JB-UI-1'}).waitFor();await chooseSupplierTask(phone,'SYN-JB-UI-1');assert.equal(await phone.getByLabel('供应商本次说明',{exact:true}).inputValue(),'草稿-A-任务1');await phone.getByRole('button',{name:'退出',exact:true}).click();await phone.getByRole('heading',{name:'供应商手机工作台',exact:true}).waitFor();assert.equal(await phone.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('doon-finished-supplier-draft:jinbo_primary:')).length),0);pass('Returning to the first account restores its own task draft and explicit logout clears every personal task draft.');
 assert(phoneRequests.length>0);assert(phoneRequests.every(url=>url.startsWith('/api/workspace/finished-supplier-')));assert.deepEqual(errors,[]);pass('The supplier phone never requests the general workspace data API and all tested pages have no browser runtime errors.');
 await fs.writeFile(path.join(testOutput,'finished-supplier-browser-result.json'),JSON.stringify({passed:checks.length,checks,root,buildDir:dist,buildEvidence,at:new Date().toISOString()},null,2));console.log(JSON.stringify({root,passed:checks.length,manifestSha256:buildEvidence.manifestSha256}));
}catch(e){
 console.error(logs);for(const context of browser?.contexts()||[])for(const page of context.pages()){const prefix=page.viewportSize()?.width===390?'phone':'company';await page.screenshot({path:path.join(root,prefix+'-failure.png'),fullPage:true}).catch(()=>{});await fs.writeFile(path.join(root,prefix+'-failure.txt'),await page.locator('body').innerText()).catch(()=>{});}console.error('Synthetic browser evidence: '+root);throw e;
}finally{await browser?.close();if(server){server.kill();await new Promise(resolve=>{if(server.exitCode!==null)resolve();else{server.once('exit',resolve);setTimeout(resolve,3000);}});}}
