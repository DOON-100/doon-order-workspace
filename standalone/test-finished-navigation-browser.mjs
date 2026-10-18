// Browser regression using only a temporary synthetic database and isolated build.
// No production database, employee credentials, or production port is accessed.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import * as XLSX from 'xlsx';
import {verifyCustomerPriceBuildEvidence} from '../scripts/customer-price-build-evidence.mjs';

const testOutput=path.resolve('test-output');
const dist=path.resolve(process.env.DOON_BUILD_DIR||'test-output/finished-navigation-build');
assert(dist.startsWith(testOutput+path.sep),'Use an isolated build inside test-output.');
// A deliberately isolated release source can differ from an unrelated working tree.
// The same hash verification still checks every source/build file against its manifest.
const invocationDirectory=process.cwd(),sourceDirectory=path.resolve(process.env.DOON_TEST_SOURCE_DIR||'.');
let buildEvidence;
try{process.chdir(sourceDirectory);buildEvidence=await verifyCustomerPriceBuildEvidence(dist);}finally{process.chdir(invocationDirectory);}
await fs.mkdir(testOutput,{recursive:true});
const root=await fs.mkdtemp(path.join(testOutput,'finished-navigation-browser-'));
const port=18814,origin=`http://127.0.0.1:${port}`;
const env={...process.env,DOON_SERVER_MODE:'internal',DOON_REVIEW_MODE:'0',DOON_DATA_DIR:root,DOON_BUILD_DIR:dist,DOON_HOST:'127.0.0.1',DOON_PORT:String(port),DOON_NO_AUTO_BACKUP:'1',DOON_TLS_CERT:'',DOON_TLS_KEY:''};
execFileSync(process.execPath,[path.join(dist,'manage.mjs'),'init'],{env,stdio:'pipe',windowsHide:true});
// This credential was generated above in the fresh synthetic database.
const initial=(await fs.readFile(path.join(root,'管理员首次登录.txt'),'utf8')).match(/初始密码：([^\n]+)/)[1];
const firstPassword='Synthetic-Finished-Initial-2026!',personalPassword='Synthetic-Finished-Personal-2026!';
const date=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
const admin={cookie:''},sessions={},checks=[],errors=[],pass=text=>{checks.push(text);console.log('PASS '+text);};
let server,browser,page,logs='';

async function api(route,body,session=admin,expected=200){
 const response=await fetch(origin+'/api/'+route,{method:body===undefined?'GET':'POST',headers:{Origin:origin,...(session.cookie?{Cookie:session.cookie}:{}),...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});
 if(response.headers.get('set-cookie'))session.cookie=response.headers.get('set-cookie').split(';')[0];
 const result=await response.json();assert.equal(response.status,expected,route+' '+JSON.stringify(result));return result;
}
async function signedPage(session,viewport){
 const context=await browser.newContext({viewport}),split=session.cookie.indexOf('=');
 await context.addCookies([{name:session.cookie.slice(0,split),value:session.cookie.slice(split+1),url:origin,httpOnly:true,sameSite:'Strict'}]);
 const current=await context.newPage();current.on('pageerror',error=>errors.push(error.message));
 await current.goto(origin+'/workbench');await current.locator('.rail .account b').filter({hasText:session.name}).waitFor();
 return {context,page:current};
}
async function expandDepartment(current,department){
 const toggle=current.locator(`[data-department-id="${department}"] .department-navigation-toggle`);await toggle.waitFor();
 if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();
 assert.equal(await toggle.getAttribute('aria-expanded'),'true');
}
async function assertEntryReachable(current,department,id){
 await expandDepartment(current,department);
 const button=current.locator(`[data-department-id="${department}"] [data-nav-id="${id}"]`);await button.waitFor();await button.scrollIntoViewIfNeeded();
 const geometry=await button.evaluate(element=>{
  const r=element.getBoundingClientRect(),n=element.closest('nav').getBoundingClientRect();
  return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,navTop:n.top,navBottom:n.bottom,width:innerWidth,height:innerHeight};
 });
 assert(geometry.top>=Math.max(0,geometry.navTop)-1&&geometry.bottom<=Math.min(geometry.height,geometry.navBottom)+1&&geometry.left>=0&&geometry.right<=geometry.width,`${department}/${id} must be reachable after expanding its department: ${JSON.stringify(geometry)}`);
}

try{
 server=spawn(process.execPath,[path.join(dist,'server.mjs')],{env,stdio:'pipe',windowsHide:true});
 server.stdout.on('data',value=>logs+=value);server.stderr.on('data',value=>logs+=value);
 let ready=false;for(let attempt=0;attempt<100;attempt++){try{if((await fetch(origin+'/health')).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
 assert(ready,'Isolated navigation test server did not start.');
 await api('auth/login',{username:'admin',password:initial});await api('auth/password',{currentPassword:initial,password:'Synthetic-Finished-Admin-2026!'});
 for(const entry of [{username:'synthetic_finished',name:'合成成品文员',role:'clerk',departments:['finished','outsourcing']},{username:'synthetic_other_clerk',name:'合成胶架文员',role:'clerk',departments:['plastic']},{username:'synthetic_sales',name:'合成业务人员',role:'sales',departments:[]}]){
  await api('auth/accounts',{...entry,password:firstPassword,orderScope:'all',customers:[]});
  const session={cookie:'',name:entry.name};await api('auth/login',{username:entry.username,password:firstPassword},session);await api('auth/password',{currentPassword:firstPassword,password:personalPassword},session);sessions[entry.username]=session;
 }
 const sheet={};
 for(const [address,value] of Object.entries({A3:'生产厂',I3:'订单号',J3:'图纸编号',M3:'订单数量',BF3:'包装入仓数量',A4:'合成外发工厂',B4:'合成跟单',C4:'SYNTHETIC-NAV-CUSTOMER',I4:'SYNTHETIC-FINISHED-NAV-001',J4:'SYNTHETIC-NAV-FRAME',L4:'C1',H4:'合成镜片',M4:100,N4:100,W4:'合成金属架',T4:date,U4:date,BF4:0,A5:'度昂',B5:'合成跟单',C5:'SYNTHETIC-NAV-CUSTOMER',I5:'SYNTHETIC-INTERNAL-NAV-002',J5:'SYNTHETIC-INTERNAL-FRAME',L5:'C2',H5:'合成镜片',M5:30,N5:30,W5:'合成胶架',T5:date,U5:date,BF5:0}))sheet[address]={t:typeof value==='number'?'n':'s',v:value};
 sheet['!ref']='A1:BK5';const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'动态表');
 const form=new FormData();form.set('file',new File([XLSX.write(book,{type:'buffer',bookType:'xlsx'})],'synthetic-finished-navigation.xlsx'));form.set('mode','active');
 let job=await api('workspace/ledger-preview',form);while(job.status!=='已完成')job=await api('workspace/ledger-commit',{id:job.id,offset:job.offset});
 const order=(await api('workspace/data')).orders.find(item=>item.orderNo==='SYNTHETIC-FINISHED-NAV-001');assert(order,'Synthetic external order was imported.');
 const {chromium}=await import(process.env.DOON_PLAYWRIGHT_MODULE?pathToFileURL(process.env.DOON_PLAYWRIGHT_MODULE).href:'playwright');
 browser=await chromium.launch({headless:true,...(process.env.DOON_CHROMIUM_PATH?{executablePath:process.env.DOON_CHROMIUM_PATH}:{channel:'chrome'}),args:['--no-proxy-server']});
 for(const username of ['synthetic_sales','synthetic_other_clerk']){
  const signed=await signedPage(sessions[username],{width:1536,height:900});page=signed.page;
  const ids=await page.locator('[data-nav-id]').evaluateAll(elements=>elements.map(element=>element.dataset.navId));
  const departments=await page.locator('[data-department-id]').evaluateAll(elements=>elements.map(element=>element.dataset.departmentId));
  assert.deepEqual(departments,['overview','sales','service','engineering','planning','purchasing','warehouse','production','quality','finance','aftersales','management'],'Internal roles use the same department and process order.');
  assert.equal(await page.locator('[data-department-id="purchasing"] [data-nav-id="finished-outsourcing"]').count(),1);
  assert.equal(await page.locator('[data-department-id="production"] [data-nav-id="department"]').count(),1);
  assert(ids.indexOf('customer-projects')<ids.indexOf('sales'));assert(ids.indexOf('pmc')<ids.indexOf('finished-outsourcing'));
  assert(ids.includes('department'));await signed.context.close();
 }
 pass('Sales and other-department clerks share the department hierarchy, with every original manufacturing entry retained.');
 for(const viewport of [{width:1536,height:900},{width:1280,height:600}]){
  const signed=await signedPage(sessions.synthetic_finished,viewport);page=signed.page;
  const ids=await page.locator('[data-nav-id]').evaluateAll(elements=>elements.map(element=>element.dataset.navId));
  assert.deepEqual(ids.slice(0,3),['workbench','business-process','personal-tasks']);
  assert.equal(ids.filter(id=>id==='finished-outsourcing').length,1);assert.equal(ids.filter(id=>id==='department').length,1);
  await assertEntryReachable(page,'purchasing','finished-outsourcing');await assertEntryReachable(page,'production','department');
  await page.screenshot({path:path.join(root,`finished-entry-${viewport.width}x${viewport.height}.png`)});
  await page.locator('[data-nav-id="department"]').click();
  const finishedTab=page.getByRole('button',{name:'成品文员',exact:true});await finishedTab.waitFor();await finishedTab.click();
  const internalRow=page.getByRole('row').filter({hasText:'SYNTHETIC-INTERNAL-NAV-002'});await internalRow.waitFor();
  assert.equal(await page.getByRole('row').filter({hasText:'SYNTHETIC-FINISHED-NAV-001'}).count(),0,'The department workbench preserves the existing internal-production scope.');
  await internalRow.getByRole('button',{name:'录入本部门',exact:true}).click();
  const departmentDialog=page.getByRole('dialog');await departmentDialog.waitFor();
  for(const label of ['BF 包装入仓数量','BG 包装入仓日期','BI 成品备注'])assert(await departmentDialog.getByRole('textbox',{name:label,exact:true}).isEnabled());
  await page.screenshot({path:path.join(root,`department-finished-${viewport.width}x${viewport.height}.png`)});
  await page.keyboard.press('Escape');await departmentDialog.waitFor({state:'hidden'});
  await assertEntryReachable(page,'purchasing','finished-outsourcing');await page.locator('[data-nav-id="finished-outsourcing"]').click();
  const row=page.locator('.pmc-sheet tr[data-line-id]').filter({hasText:'SYNTHETIC-FINISHED-NAV-001'});await row.waitFor();
  assert.equal(new URL(page.url()).pathname,'/finished-outsourcing');
  assert(await row.getByRole('button',{name:/^原表4行 PMC排期/}).isDisabled());
  assert(await row.getByRole('button',{name:/^原表4行 状态备注/}).isDisabled());
  assert.equal(await page.getByRole('button',{name:'开始核对',exact:true}).count(),0);
  await row.getByRole('button',{name:'SYNTHETIC-FINISHED-NAV-001',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.waitFor();
  for(const label of ['BF 包装入仓数量','BG 包装入仓日期','BI 成品备注'])assert(await dialog.getByRole('textbox',{name:label,exact:true}).isEnabled(),label+' must be editable for the finished clerk.');
  assert.equal(await dialog.getByRole('textbox',{name:'U PMC排期',exact:true}).count(),0);
  assert.equal(await dialog.getByRole('textbox',{name:'AK 焊磨备注',exact:true}).count(),0);
  if(viewport.height===900){
   await dialog.getByRole('textbox',{name:'BF 包装入仓数量',exact:true}).fill('10');
   await dialog.getByRole('textbox',{name:'BG 包装入仓日期',exact:true}).fill(date);
   await dialog.getByRole('textbox',{name:'BI 成品备注',exact:true}).fill('合成测试已核对入仓');
   await dialog.getByRole('textbox',{name:'工序修改依据',exact:true}).fill('合成送货单 NAV-001');
   await page.screenshot({path:path.join(root,'finished-department-fields.png')});
   const saved=page.waitForResponse(response=>response.url().includes('/api/workspace/ledger-edit')&&response.request().method()==='POST');
   await dialog.getByRole('button',{name:'保存本部门字段',exact:true}).click();const response=await saved;assert.equal(response.status(),200,JSON.stringify(await response.json()));
   await dialog.waitFor({state:'hidden'});
   const updated=(await api('workspace/data',undefined,sessions.synthetic_finished)).orders.find(item=>item.id===order.id);
   assert.equal(updated.ledger.columns.BF,'10');assert.equal(updated.ledger.columns.BG,date);assert.equal(updated.ledger.columns.BI,'合成测试已核对入仓');
   assert.equal(updated.plannedDate,order.plannedDate);
   await api('workspace/pmc-save',{changes:[{id:updated.id,version:updated.version,col:'U',value:date}]},sessions.synthetic_finished,403);
   pass('Finished clerk saves BF/BG/BI; PMC fields remain disabled and the PMC mutation API denies access.');
  }
  pass(`Finished and department entries are reachable in their department groups at ${viewport.width}×${viewport.height}; 成品文员 internal form and external table form both open.`);
  await signed.context.close();
 }
 assert.deepEqual(errors,[],'No browser runtime errors.');
 await fs.writeFile(path.join(root,'result.json'),JSON.stringify({passed:checks.length,checks,buildEvidence,at:new Date().toISOString()},null,2));
 console.log(JSON.stringify({root,passed:checks.length}));
}catch(error){
 if(page&&!page.isClosed()){await page.screenshot({path:path.join(root,'failure.png'),fullPage:true}).catch(()=>{});await fs.writeFile(path.join(root,'failure.txt'),await page.locator('body').innerText()).catch(()=>{});}
 console.error(logs);console.error('Synthetic evidence: '+root);throw error;
}finally{await browser?.close();if(server&&!server.killed)server.kill();}
