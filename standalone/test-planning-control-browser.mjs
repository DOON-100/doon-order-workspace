// Browser acceptance uses a fresh synthetic account/database and an isolated port only.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {verifyCustomerPriceBuildEvidence} from '../scripts/customer-price-build-evidence.mjs';

const output=path.resolve('test-output'),dist=path.resolve(process.env.DOON_BUILD_DIR||'test-output/planning-control-build');
assert(dist.startsWith(output+path.sep),'Only an isolated test-output build is permitted.');
const buildEvidence=await verifyCustomerPriceBuildEvidence(dist);
const root=await fs.mkdtemp(path.join(output,'planning-control-browser-'));
const port=18836,origin=`http://127.0.0.1:${port}`;
const env={...Object.fromEntries(Object.entries(process.env).filter(([name])=>!/^DOON_KINGDEE_/i.test(name))),DOON_KINGDEE_SUPPLIER_SYNC_ENABLED:'0',DOON_KINGDEE_READONLY_ENABLED:'0',DOON_SERVER_MODE:'internal',DOON_REVIEW_MODE:'0',DOON_DATA_DIR:root,DOON_BUILD_DIR:dist,DOON_HOST:'127.0.0.1',DOON_PORT:String(port),DOON_NO_AUTO_BACKUP:'1',DOON_TLS_CERT:'',DOON_TLS_KEY:''};
execFileSync(process.execPath,[path.join(dist,'manage.mjs'),'init'],{env,stdio:'pipe',windowsHide:true});
const initial=(await fs.readFile(path.join(root,'管理员首次登录.txt'),'utf8')).match(/初始密码：([^\n]+)/)[1];
const admin={cookie:'',name:'管理员'},sessions={},checks=[],errors=[];
const pass=message=>{checks.push(message);console.log('PASS '+message);};
let server,browser,logs='';
async function api(route,body,session=admin){
 const response=await fetch(origin+'/api/'+route,{method:body===undefined?'GET':'POST',headers:{Origin:origin,...(session.cookie?{Cookie:session.cookie}:{}),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 if(response.headers.get('set-cookie'))session.cookie=response.headers.get('set-cookie').split(';')[0];
 const result=await response.json();assert.equal(response.status,200,route+' '+JSON.stringify(result));return result;
}
async function signedPage(session,viewport={width:1536,height:1000},route='/planning-control'){
 const context=await browser.newContext({viewport}),split=session.cookie.indexOf('=');
 await context.addCookies([{name:session.cookie.slice(0,split),value:session.cookie.slice(split+1),url:origin,httpOnly:true,sameSite:'Strict'}]);
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
 await page.goto(origin+route);await page.locator('[data-planning-control]').waitFor();return {page,context};
}
async function noOverflow(page){
 const sizes=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth}));
 assert(sizes.document<=sizes.viewport+1&&sizes.body<=sizes.viewport+1,'Page must fit the viewport: '+JSON.stringify(sizes));
}
try{
 server=spawn(process.execPath,[path.join(dist,'server.mjs')],{env,stdio:'pipe',windowsHide:true});
 server.stdout.on('data',value=>logs+=value);server.stderr.on('data',value=>logs+=value);
 let ready=false;for(let i=0;i<100;i++){assert.equal(server.exitCode,null);try{if((await fetch(origin+'/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert(ready);
 await api('auth/login',{username:'admin',password:initial});
 await api('auth/password',{currentPassword:initial,password:'Synthetic-PlanningControl-Admin-2026!'});
 for(const [key,role] of [['owner','clerk'],['reviewer','production'],['outsider','viewer']]){
  const password='Synthetic-PlanningControl-Initial-2026!';
  await api('auth/accounts',{username:'synthetic_planning_'+key,name:'合成计划'+key,password,role,orderScope:'assigned',customers:[],departments:[]});
  const session={cookie:'',name:'合成计划'+key};
  await api('auth/login',{username:'synthetic_planning_'+key,password},session);
  await api('auth/password',{currentPassword:password,password:'Synthetic-PlanningControl-Personal-2026!'},session);
  sessions[key]=session;
 }
 const data=await api('workspace/data'),adminId=data.me.id,memberId=key=>data.members.find(m=>m.name==='合成计划'+key).id;
 // Explicit synthetic fixtures in this test's isolated database, never the live store.
 const fixtureDb=new DatabaseSync(path.join(root,'workspace.sqlite'));
 const at=new Date().toISOString();
 fixtureDb.exec('BEGIN');
 for(const suffix of ['A','B']){
  const record={id:'synthetic_planning_order_'+suffix,kind:'order',version:1,createdAt:at,updatedAt:at,updatedBy:'合成测试',source:'synthetic-browser-fixture',orderNo:'SYN-PLAN-'+suffix,customer:'合成计划客户',customerPO:'SYN-PO-'+suffix,drawing:'SYN-DRAW-'+suffix,color:'C1',lens:'白片',batch:'A',quantity:100,unit:'副',requestedDate:'2026-11-30',ownerEmail:data.members.find(m=>m.id===memberId('owner')).email,stage:'生产中',plannedDate:'2026-11-20',shipDate:'',promisedDate:'',promiseConfirmed:false,customerNote:'',arrangement:'',notes:'原始测试记录必须保持字节一致',sourceStatus:'有效',extra:{}};
  fixtureDb.prepare('INSERT INTO records(id,kind,data) VALUES(?,?,?)').run(record.id,record.kind,JSON.stringify(record));
 }
 fixtureDb.prepare("UPDATE workspace_revision SET revision=revision+1 WHERE id='main'").run();fixtureDb.exec('COMMIT');fixtureDb.close();
 const originalDb=new DatabaseSync(path.join(root,'workspace.sqlite'),{readOnly:true});
 const originalRecords=originalDb.prepare('SELECT id,kind,data FROM records ORDER BY id').all();originalDb.close();
 const {chromium}=await import(process.env.DOON_PLAYWRIGHT_MODULE?pathToFileURL(process.env.DOON_PLAYWRIGHT_MODULE).href:'playwright');
 browser=await chromium.launch({headless:true,...(process.env.DOON_CHROMIUM_PATH?{executablePath:process.env.DOON_CHROMIUM_PATH}:{channel:'chrome'}),args:['--no-proxy-server']});
 // Acceptance flow is kept below, separate from account setup and preservation checks.
 const desktop=await signedPage(admin),page=desktop.page;
 await page.getByRole('heading',{name:'计划分析与协调',level:1,exact:true}).waitFor();
 assert.equal((await api('workspace/planning-control-data')).records.length,0,'No demonstration records are inserted.');
 await noOverflow(page);
 pass('Direct planning control route loads with an empty authorized workspace and no demo records.');

 await page.getByRole('tab',{name:'订单排产',exact:true}).click();
 await page.getByRole('tab',{name:'订单需求确认',exact:true}).click();
 await page.getByRole('button',{name:'新增订单需求确认',exact:true}).click();
 let dialog=page.getByRole('dialog');
 await dialog.getByLabel('产品订单需求',{exact:true}).fill('合成需求核对');
 await dialog.getByLabel('需求计划员',{exact:true}).selectOption(memberId('owner'));
 await dialog.getByLabel('关联原订单（可选，只读引用）',{exact:true}).selectOption('synthetic_planning_order_A');
 await dialog.getByLabel('本单登记需求件数（件）',{exact:true}).fill('50');
 await dialog.getByLabel('有确认依据需求件数（件）',{exact:true}).fill('20');
 await dialog.getByLabel('客户订单参考',{exact:true}).fill('SYN-PLAN-A');
 await dialog.getByLabel('产品编号',{exact:true}).fill('SYN-PRODUCT');
 await dialog.getByLabel('业务说明与核对范围',{exact:true}).fill('=1+1');
 await dialog.getByLabel('阶段依据',{exact:true}).fill('合成依据，仅核对测试数量');
 await dialog.getByRole('button',{name:'保存',exact:true}).click();await dialog.waitFor({state:'hidden'});
 const row=()=>page.getByRole('row').filter({hasText:'合成需求核对'});
 await row().waitFor();
 const saved=(await api('workspace/planning-control-data')).records.find(r=>r.title==='合成需求核对');assert(saved);
 const advance=async()=>{await row().getByRole('button',{name:'推进阶段',exact:true}).click();const modal=page.getByRole('dialog');await modal.getByLabel('本阶段核对依据（必填）',{exact:true}).fill('合成阶段核验依据');await modal.getByRole('button',{name:'确认办理',exact:true}).click();await modal.waitFor({state:'hidden'});};
 await advance();
 const owner=await signedPage(sessions.owner);await owner.page.getByRole('tab',{name:'订单排产',exact:true}).click();await owner.page.getByRole('tab',{name:'订单需求确认',exact:true}).click();
 await owner.page.getByRole('row').filter({hasText:'合成需求核对'}).getByRole('button',{name:'登记进展',exact:true}).click();
 const ownerDialog=owner.page.getByRole('dialog');
 assert(await ownerDialog.getByLabel('本单登记需求件数（件）',{exact:true}).isDisabled(),'Assignee cannot change planned quantity.');
 await ownerDialog.getByLabel('有确认依据需求件数（件）',{exact:true}).fill('50');
 await ownerDialog.getByLabel('阶段依据',{exact:true}).fill('合成完整确认依据');
 await ownerDialog.getByRole('button',{name:'保存',exact:true}).click();await ownerDialog.waitFor({state:'hidden'});await owner.context.close();
 await page.reload();await page.getByRole('tab',{name:'订单排产',exact:true}).click();await page.getByRole('tab',{name:'订单需求确认',exact:true}).click();await advance();await advance();
 const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'导出当前清单',exact:true}).click();const download=await downloadPromise;
 const csv=path.join(root,'synthetic-planning-export.csv');await download.saveAs(csv);assert((await fs.readFile(csv,'utf8')).includes("'=1+1"),'CSV formula content must be neutralized.');
 await row().getByRole('button',{name:'归档',exact:true}).click();dialog=page.getByRole('dialog');await dialog.getByLabel('更正或归档依据（必填）',{exact:true}).fill('合成归档核验');await dialog.getByRole('button',{name:'确认办理',exact:true}).click();await dialog.waitFor({state:'hidden'});
 await page.getByRole('tab',{name:'归档记录',exact:true}).click();await row().waitFor();
 await row().getByRole('button',{name:'恢复',exact:true}).click();dialog=page.getByRole('dialog');await dialog.getByLabel('更正或归档依据（必填）',{exact:true}).fill('合成恢复核验');await dialog.getByRole('button',{name:'确认办理',exact:true}).click();await dialog.waitFor({state:'hidden'});
 const history=await api('workspace/planning-control-history?id='+encodeURIComponent(saved.id));assert(history.history.length>=7,'Each state change must retain history.');
 const hidden=await api('workspace/planning-control-data',undefined,sessions.outsider);assert.equal(hidden.records.length,0);assert.equal(hidden.canCreate,false);
 pass('The UI creates source-linked records, limits assignees to progress, completes the four stages, archives/restores with history, and exports protected CSV.');

 await page.getByRole('tab',{name:'独立测算',exact:true}).click();await page.getByRole('button',{name:'新增容量与负荷推演',exact:true}).click();dialog=page.getByRole('dialog');
 await dialog.getByLabel('测算名称',{exact:true}).fill('合成零产能测算');
 for(const [label,value] of [['窗口可排工时（小时）','0'],['已占用工时（小时）','0'],['新增需求工时（小时）','10']])await dialog.getByLabel(label,{exact:true}).fill(value);
 assert((await dialog.innerText()).includes('—'),'Zero capacity has no fabricated percentage.');
 await dialog.getByRole('button',{name:'保存',exact:true}).click();await dialog.waitFor({state:'hidden'});
 const calculation=(await api('workspace/planning-control-data')).calculations.find(r=>r.title==='合成零产能测算');assert.equal(calculation.result.loadPercent,null);assert.equal(calculation.result.gapHours,10);
 pass('Capacity calculations persist independently and represent zero denominators as unknown ratios.');

 await page.getByRole('tab',{name:'产能排程',exact:true}).click();
 await page.getByRole('button',{name:'新增产能窗口',exact:true}).click();dialog=page.getByRole('dialog');
 assert.equal(await dialog.getByLabel('可用产能（分钟）',{exact:true}).inputValue(),'','No assumed capacity is seeded.');
 await dialog.getByLabel('资源 / 产能窗口名称',{exact:true}).fill('合成装配早班');
 await dialog.getByLabel('窗口日期',{exact:true}).fill('2026-11-01');
 await dialog.getByLabel('可用产能（分钟）',{exact:true}).fill('120');
 await dialog.getByRole('button',{name:'保存',exact:true}).click();await dialog.waitFor({state:'hidden'});
 await page.locator('[data-capacity-window]').filter({hasText:'合成装配早班'}).waitFor();
 const capacity=(await api('workspace/planning-control-data')).windows.find(w=>w.name==='合成装配早班');assert(capacity);
 const fillAllocation=async(order,quantity)=>{
  await page.getByRole('button',{name:'分配订单',exact:true}).click();const modal=page.getByRole('dialog');
  await modal.getByLabel('目标产能窗口',{exact:true}).selectOption(capacity.id);
  await modal.getByLabel('关联原订单',{exact:true}).selectOption(order);
  await modal.getByLabel('计划分配数量（副）',{exact:true}).fill(String(quantity));
  await modal.getByLabel('单位工时（分钟 / 副）',{exact:true}).fill('2');
  await modal.getByLabel('分配核对依据',{exact:true}).fill('合成工时与订单范围核对依据');
  return modal;
 };
 dialog=await fillAllocation('synthetic_planning_order_A',50);
 await dialog.getByRole('button',{name:'保存',exact:true}).click();await dialog.waitFor({state:'hidden'});
 let capacityFeed=await api('workspace/planning-control-data');const allocation=capacityFeed.allocations.find(a=>a.sourceOrderId==='synthetic_planning_order_A');assert(allocation);assert.equal(capacityFeed.windows[0].occupiedMinutes,100);
 const allocationRow=()=>page.locator('[data-capacity-allocation="'+allocation.id+'"]');await allocationRow().waitFor();
 dialog=await fillAllocation('synthetic_planning_order_B',20);
 await dialog.getByRole('alert').filter({hasText:'本次计划占用超出窗口剩余容量'}).waitFor();
 assert(await dialog.getByRole('button',{name:'保存',exact:true}).isDisabled(),'Over-capacity proposal must not be submitted.');
 await dialog.getByRole('button',{name:'取消',exact:true}).click();
 const discard=page.getByRole('dialog',{name:'保留或放弃未保存输入'});await discard.getByRole('button',{name:'继续编辑',exact:true}).click();
 assert.equal(await dialog.getByLabel('计划分配数量（副）',{exact:true}).inputValue(),'20','Declining discard retains inputs.');
 await dialog.getByRole('button',{name:'取消',exact:true}).click();await discard.getByRole('button',{name:'放弃输入并继续',exact:true}).click();await dialog.waitFor({state:'hidden'});
 assert.equal((await api('workspace/planning-control-data')).allocations.length,1,'Rejected and discarded proposals never become records.');
 await allocationRow().getByRole('button',{name:'确认方案',exact:true}).click();dialog=page.getByRole('dialog');
 await dialog.getByLabel('方案办理依据',{exact:true}).fill('合成方案确认依据');await dialog.getByRole('button',{name:'确认办理',exact:true}).click();await dialog.waitFor({state:'hidden'});
 await allocationRow().getByText('已确认方案',{exact:true}).waitFor();
 assert.equal((await api('workspace/planning-control-data')).allocations[0].status,'confirmed');
 await allocationRow().getByRole('button',{name:'取消分配',exact:true}).click();dialog=page.getByRole('dialog');
 await dialog.getByLabel('方案办理依据',{exact:true}).fill('合成取消原因，验证容量释放');await dialog.getByRole('button',{name:'确认办理',exact:true}).click();await dialog.waitFor({state:'hidden'});
 capacityFeed=await api('workspace/planning-control-data');assert.equal(capacityFeed.allocations[0].status,'cancelled');assert.equal(capacityFeed.windows[0].remainingMinutes,120);
 await page.getByLabel('显示已取消分配',{exact:true}).check();await allocationRow().getByText('已取消',{exact:true}).waitFor();
 pass('Finite-capacity UI uses original units, blocks excess capacity, preserves unfinished inputs, confirms independent proposals, and releases cancelled capacity.');

 await page.getByRole('button',{name:'新增产能窗口',exact:true}).click();dialog=page.getByRole('dialog');
 await dialog.getByLabel('资源 / 产能窗口名称',{exact:true}).fill('合成精度窗口');
 await dialog.getByLabel('窗口日期',{exact:true}).fill('2026-11-02');
 await dialog.getByLabel('可用产能（分钟）',{exact:true}).fill('0.3');
 await page.route('**/api/workspace/planning-capacity-window-save',async route=>{const response=await route.fetch();assert.equal(response.status(),200);await route.fulfill({response,body:'{}'});},{times:1});
 await dialog.getByRole('button',{name:'保存',exact:true}).click();await dialog.getByRole('button',{name:'重试原请求',exact:true}).waitFor();
 assert.equal((await api('workspace/planning-control-data')).windows.filter(w=>w.name==='合成精度窗口').length,1,'First request committed despite ambiguous response.');
 await dialog.getByRole('button',{name:'重试原请求',exact:true}).click();await dialog.waitFor({state:'hidden'});
 await page.locator('[data-capacity-window]').filter({hasText:'合成精度窗口'}).waitFor();
 const precisionWindows=(await api('workspace/planning-control-data')).windows.filter(w=>w.name==='合成精度窗口');assert.equal(precisionWindows.length,1,'Retry reuses token and cannot create duplicate window.');
 await page.getByRole('button',{name:'分配订单',exact:true}).click();dialog=page.getByRole('dialog');
 await dialog.getByLabel('目标产能窗口',{exact:true}).selectOption(precisionWindows[0].id);
 await dialog.getByLabel('关联原订单',{exact:true}).selectOption('synthetic_planning_order_B');
 await dialog.getByLabel('计划分配数量（副）',{exact:true}).fill('3');
 await dialog.getByLabel('单位工时（分钟 / 副）',{exact:true}).fill('0.1');
 await dialog.getByLabel('分配核对依据',{exact:true}).fill('合成千分分钟精度检查');
 assert(await dialog.getByRole('button',{name:'保存',exact:true}).isEnabled(),'3 × 0.1 must fit 0.3 without floating-point overflow.');
 await dialog.getByRole('button',{name:'保存',exact:true}).click();await dialog.waitFor({state:'hidden'});
 assert.equal((await api('workspace/planning-control-data')).windows.find(w=>w.id===precisionWindows[0].id).remainingMinutes,0);
 pass('An ambiguous response retries the same request without duplication, and decimal-minute allocations match exact available capacity.');

 await page.screenshot({path:path.join(root,'planning-control-desktop.png'),fullPage:true});
 await desktop.context.close();
 const mobile=await signedPage(admin,{width:390,height:844});await noOverflow(mobile.page);
 await mobile.page.screenshot({path:path.join(root,'planning-control-mobile.png'),fullPage:true});await mobile.context.close();
 assert.deepEqual(errors,[],'Browser must have no uncaught runtime errors.');
 const afterDb=new DatabaseSync(path.join(root,'workspace.sqlite'),{readOnly:true});
 const current=new Map(afterDb.prepare('SELECT id,kind,data FROM records').all().map(r=>[r.id,r]));
 for(const row of originalRecords)assert.deepEqual(current.get(row.id),row,'Original account/business record remains byte-identical.');
 assert.equal(Object.values(afterDb.prepare('PRAGMA integrity_check').get())[0],'ok');afterDb.close();
 pass('Desktop/mobile rendering has no overflow or runtime errors, and every original record is unchanged.');
 await fs.writeFile(path.join(root,'result.json'),JSON.stringify({passed:checks.length,checks,buildEvidence,scope:'synthetic database only'},null,2));
 console.log(JSON.stringify({passed:checks.length,root,buildEvidence}));
}finally{
 await browser?.close();if(server&&server.exitCode===null){server.kill();await new Promise(resolve=>server.once('exit',resolve));}
 await fs.writeFile(path.join(root,'server.log'),logs);
}
