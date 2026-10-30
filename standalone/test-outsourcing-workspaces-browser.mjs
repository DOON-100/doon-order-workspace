// Browser regression on an isolated test build and synthetic records only.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import * as XLSX from 'xlsx';

const output=path.resolve('test-output'),dist=path.resolve(process.env.DOON_BUILD_DIR||'test-output/outsourcing-departments-build');
assert(dist.startsWith(output+path.sep),'Only a build inside test-output may be used.');
await fs.mkdir(output,{recursive:true});
const root=await fs.mkdtemp(path.join(output,'outsourcing-workspaces-browser-'));
const origin='http://127.0.0.1:18825';
const env={...Object.fromEntries(Object.entries(process.env).filter(([name])=>!/^DOON_KINGDEE_/i.test(name))),DOON_KINGDEE_SUPPLIER_SYNC_ENABLED:'0',DOON_KINGDEE_READONLY_ENABLED:'0',DOON_SERVER_MODE:'internal',DOON_REVIEW_MODE:'0',DOON_DATA_DIR:root,DOON_BUILD_DIR:dist,DOON_HOST:'127.0.0.1',DOON_PORT:'18825',DOON_NO_AUTO_BACKUP:'1',DOON_TLS_CERT:'',DOON_TLS_KEY:'',DOON_EMPLOYEE_PUBLIC_ORIGIN:'',DOON_SUPPLIER_PUBLIC_ORIGIN:'',DOON_STUDIO_SCHEDULES_ENABLED:'0',DOON_IE_MAIL_ENABLED:'0',DOON_KINGDEE_SALES_WRITE_ENABLED:'0'};
execFileSync(process.execPath,[path.join(dist,'manage.mjs'),'init'],{env,stdio:'pipe',windowsHide:true});
const initial=(await fs.readFile(path.join(root,'管理员首次登录.txt'),'utf8')).match(/初始密码：([^\n]+)/)[1];
const session={cookie:''},errors=[],checks=[];
let server,browser,page,logs='',exportCount=0;
const pass=message=>{checks.push(message);console.log('PASS '+message);};
async function request(route,body){
 const response=await fetch(origin+'/api/'+route,{method:body===undefined?'GET':'POST',headers:{Origin:origin,...(session.cookie?{Cookie:session.cookie}:{}),...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});
 if(response.headers.get('set-cookie'))session.cookie=response.headers.get('set-cookie').split(';')[0];
 return response;
}
async function api(route,body){const response=await request(route,body),value=await response.json();assert.equal(response.status,200,route+' '+JSON.stringify(value));return value;}
async function openNav(id){
 const item=page.locator(`[data-nav-id="${id}"]`),group=item.locator('xpath=ancestor::*[@data-department-id]'),toggle=group.locator('.department-navigation-toggle');
 if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();
 const view=await item.getAttribute('data-nav-view'),tab=await item.getAttribute('data-nav-tab');
 await item.click();await page.waitForURL(url=>url.pathname==='/'+view&&(!tab||url.searchParams.get('tab')===tab));
  await page.locator(view==='process-workspace'?'.process-list':view==='outsourcing-workbooks'?'.owb-panel':'.supplier-workspace').waitFor();
}
async function displayedReferences(expected){
 const text=await page.locator('.supplier-workspace').innerText();
 for(const reference of ['SYNTHETIC-SEMI-OUT','SYNTHETIC-PLASTIC-OUT','SYNTHETIC-PLATE-OUT'])assert.equal(text.includes(reference),expected.includes(reference),reference+' matches the selected scope');
}
async function exportRows(){
 const [download,response]=await Promise.all([page.waitForEvent('download'),page.waitForResponse(response=>new URL(response.url()).pathname==='/api/workspace/supplier-export'),page.getByRole('button',{name:'按上方条件导出交期表',exact:true}).click()]);
 assert.equal(response.status(),200);
 const filename=path.join(root,'export-'+(++exportCount)+'.xlsx');await download.saveAs(filename);
 const bytes=await fs.readFile(filename);assert(bytes.byteLength>0,'Downloaded export must contain an XLSX workbook.');
 const book=XLSX.read(bytes,{type:'buffer'});return XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]]);
}
try{
 server=spawn(process.execPath,[path.join(dist,'server.mjs')],{env,stdio:'pipe',windowsHide:true});
 server.stdout.on('data',chunk=>logs+=chunk);server.stderr.on('data',chunk=>logs+=chunk);
 let ready=false;for(let i=0;i<100;i++){try{if((await fetch(origin+'/health')).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}assert(ready,'Isolated server must start.');
 await api('auth/login',{username:'admin',password:initial});await api('auth/password',{currentPassword:initial,password:'Synthetic-Outsourcing-Admin-2026!'});
 const sheet={};for(const [cell,value] of Object.entries({A3:'生产厂',I3:'订单号',J3:'图纸编号',M3:'订单数量',BF3:'包装入仓数量',A4:'度昂',C4:'SYNTHETIC-CUSTOMER',I4:'SYNTHETIC-OUTSOURCING-001',J4:'SYNTHETIC-FRAME',M4:100,AG4:1,BF4:0}))sheet[cell]={t:typeof value==='number'?'n':'s',v:value};
 sheet['!ref']='A1:BK4';const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,sheet,'动态表');
 const form=new FormData();form.set('file',new File([XLSX.write(workbook,{type:'buffer',bookType:'xlsx'})],'synthetic-outsourcing.xlsx'));form.set('mode','active');
 let job=await api('workspace/ledger-preview',form);while(job.status!=='已完成')job=await api('workspace/ledger-commit',{id:job.id,offset:job.offset});
 const order=(await api('workspace/data')).orders.find(row=>row.orderNo==='SYNTHETIC-OUTSOURCING-001');assert(order);
 for(const [process,reference] of [['welding','SYNTHETIC-SEMI-OUT'],['temple','SYNTHETIC-PLASTIC-OUT'],['plating','SYNTHETIC-PLATE-OUT']])await api('workspace/outsource-create',{lineId:order.id,supplier:'SYNTHETIC-SUPPLIER',process,quantity:10,sentDate:'2026-10-30',dueDate:'2099-12-31',reference,token:crypto.randomUUID()});
 const seeded=await api('workspace/data');
 const photoForm=new FormData();photoForm.set('file',new File([Uint8Array.from([0xff,0xd8,0xff,0xe0,1,2,3,4])],'synthetic-delivery.jpg'));
 const photo=await api('workspace/receipt-photo',photoForm);
 await api('workspace/receipt-confirm',{photoId:photo.id,supplier:'SYNTHETIC-SUPPLIER',deliveryNo:'SYNTHETIC-MIXED-RECEIPT',receivedDate:'2026-10-30',note:'测试环境，不含正式业务数据',token:crypto.randomUUID(),lines:seeded.outsource.map(row=>({outsourceId:row.id,accepted:row.process==='plating'?2:row.process==='temple'?4:3,rejected:0}))});
 const before=await api('workspace/data');
 const {chromium}=await import(process.env.DOON_PLAYWRIGHT_MODULE?pathToFileURL(process.env.DOON_PLAYWRIGHT_MODULE).href:'playwright');
 browser=await chromium.launch({headless:true,...(process.env.DOON_CHROMIUM_PATH?{executablePath:process.env.DOON_CHROMIUM_PATH}:{channel:'chrome'}),args:['--no-proxy-server']});
 const context=await browser.newContext({viewport:{width:1536,height:1000}}),split=session.cookie.indexOf('=');
 await context.addCookies([{name:session.cookie.slice(0,split),value:session.cookie.slice(split+1),url:origin,httpOnly:true,sameSite:'Strict'}]);
 await context.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>{const banner=document.createElement('div');banner.textContent='测试环境，不含正式业务数据';banner.style.cssText='position:fixed;bottom:0;right:0;z-index:999999;background:#fff7cd;color:#7a5000;padding:5px 12px;font:12px sans-serif';document.body.append(banner);}));
 page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.goto(origin+'/supplier-semifinished');await page.locator('.supplier-workspace').waitFor();
 const names=[['purchasing','采购'],['semifinished-outsourcing','半成品外发'],['plating-outsourcing','电镀外发']];
 for(const [id,label] of names)assert.equal(await page.locator(`[data-department-id="${id}"] .department-navigation-toggle > span`).innerText(),label);
 assert.equal(await page.locator('[data-department-id]').count(),13);
 assert.equal(await page.locator('[data-department-id="purchasing"] [data-nav-id="supplier-semifinished"]').count(),0);
 assert.equal(await page.locator('[data-department-id="production"] [data-nav-id="finished-outsourcing"]').count(),1);
 const departmentalItems=page.locator('[data-department-id="semifinished-outsourcing"] [data-nav-id]');
  assert.deepEqual(await departmentalItems.evaluateAll(items=>items.map(item=>({id:item.getAttribute('data-nav-id'),label:item.querySelector('span')?.textContent}))),[{id:'supplier-semifinished',label:'钛架部'},{id:'supplier-semifinished-plastic',label:'胶架部'},{id:'process-packaging',label:'包装部'},{id:'outsourcing-catalog',label:'外发基础资料'},{id:'outsourcing-workbooks',label:'外发原表与字段查询'}]);
 assert.equal(await page.locator('[data-department-id="warehouse"] [data-nav-id="process-packaging"]').count(),0);
 assert.equal(await page.getByRole('button',{name:'展开外发电镀',exact:true}).count(),0);
 pass('半成品外发下钛架部、胶架部、包装部按顺序独立列出，电镀外发名称已统一。');
 for(const [view,label,reference,defaultName,allowedCount,receiptAmount] of [
  ['supplier-semifinished','钛架部','SYNTHETIC-SEMI-OUT','钛焊',3,'3 / 0'],
  ['supplier-semifinished-plastic','胶架部','SYNTHETIC-PLASTIC-OUT','脾加工',4,'4 / 0'],
  ['supplier-plating','电镀外发','SYNTHETIC-PLATE-OUT','电镀回货',1,'2 / 0'],
 ]){
  if(new URL(page.url()).pathname!=='/'+view)await openNav(view);
  assert((await page.locator('.production-planning-breadcrumb').innerText()).includes(label));
  assert.equal(await page.locator('.department-workspace-navigation [aria-current="page"]').getAttribute('data-nav-id'),view);
  await displayedReferences([reference]);
  const [followupResponse]=await Promise.all([page.waitForResponse(response=>['/api/workspace/business-followup-targets','/api/workspace/business-followup-data'].includes(new URL(response.url()).pathname)),page.locator('.supplier-workspace').getByRole('button',{name:'查看记录',exact:true}).first().click()]);
  assert.equal(followupResponse.status(),200);const followup=await followupResponse.json(),record=before.outsource.find(row=>row.reference===reference);
  if(followup.targets)assert.deepEqual([...new Set(followup.targets.map(target=>target.recordId))],[record.id]);else assert.equal(followup.target.recordId,record.id);
  await page.getByRole('button',{name:'关闭附件与沟通',exact:true}).click();
  const rows=await exportRows();assert.deepEqual(rows.map(row=>row['外发单号']),[reference]);
  await page.locator('.supplier-hero').getByRole('button',{name:'登记外发',exact:true}).click();
  const control=page.getByRole('combobox',{name:'采购外发工序',exact:true});assert.equal(await control.innerText(),defaultName);
  await control.click();assert.equal(await page.getByRole('option').count(),allowedCount);
  if(view!=='supplier-plating')assert.equal(await page.getByRole('option',{name:'电镀回货',exact:true}).count(),0);
  if(view==='supplier-semifinished')assert.equal(await page.getByRole('option',{name:'脾加工',exact:true}).count(),0);
  if(view==='supplier-semifinished-plastic')assert.equal(await page.getByRole('option',{name:'钛焊',exact:true}).count(),0);
  await page.keyboard.press('Escape');await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('tab',{name:'送货单与收货',exact:true}).click();await page.getByRole('button',{name:'送货单档案',exact:true}).click();
  const history=await page.locator('.supplier-workspace').innerText();assert(history.includes('SYNTHETIC-MIXED-RECEIPT'));assert(history.includes(receiptAmount));
  assert.equal(history.includes('电镀回货'),view==='supplier-plating');
  assert.equal(history.includes('钛焊'),view==='supplier-semifinished');
  assert.equal(history.includes('脾加工'),view==='supplier-semifinished-plastic');
  const original=await page.getByRole('link',{name:'查看送货单',exact:true}).getAttribute('href');assert(original.includes(photo.id),'All scope views preserve the original mixed receipt attachment.');
  await page.getByRole('tab',{name:'交期与催交',exact:true}).click();
  await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
  await page.screenshot({path:path.join(root,view+'.png'),fullPage:true});
 }
 pass('钛架、胶架和电镀的列表、实际下载、附件沟通、默认工序与创建选项分别限定范围，混合凭证按范围显示且共用原件。');
 await openNav('process-packaging');
 assert.equal(new URL(page.url()).searchParams.get('tab'),'packaging');
 assert.equal(await page.locator('.department-workspace-navigation [aria-current="page"]').getAttribute('data-nav-id'),'process-packaging');
 assert((await page.locator('.production-planning-breadcrumb').innerText()).includes('半成品外发'));
 assert((await page.locator('.production-planning-breadcrumb').innerText()).includes('包装部'));
 await page.screenshot({path:path.join(root,'packaging-department.png'),fullPage:true});
 await page.reload();await page.locator('.process-list').waitFor();assert.equal(new URL(page.url()).searchParams.get('tab'),'packaging');
 pass('包装部沿用原包装核对作业入口、记录与权限，直接刷新仍匹配半成品外发目录。');
  await openNav('outsourcing-workbooks');await page.locator('.owb-panel').waitFor();
  await page.reload();await page.locator('.owb-panel').waitFor();
  pass('外发原工作簿页面按需加载，导航与直接刷新均可进入。');
 await openNav('supplier-outsourcing');await displayedReferences(['SYNTHETIC-SEMI-OUT','SYNTHETIC-PLASTIC-OUT','SYNTHETIC-PLATE-OUT']);
 const legacyRows=await exportRows();assert.equal(legacyRows.length,3);
 await page.reload();await page.locator('.supplier-workspace').waitFor();await displayedReferences(['SYNTHETIC-SEMI-OUT','SYNTHETIC-PLASTIC-OUT','SYNTHETIC-PLATE-OUT']);
 pass('旧全工序链接和未传范围的导出继续覆盖原有记录，刷新页面可直接进入。');
 const after=await api('workspace/data');for(const key of ['orders','reports','members','comments','corrections','attachments','imports','exports','ledgerImports','outsource','receipts'])assert.deepEqual(after[key],before[key],key+' is unchanged by navigation and scoped reads');
 assert.deepEqual(errors,[]);pass('浏览与范围导出没有改写原记录、工序数量、账号或附件，无浏览器运行错误。');
 await fs.writeFile(path.join(root,'result.json'),JSON.stringify({checks,errors,scope:'测试环境，不含正式业务数据',at:new Date().toISOString()},null,2));console.log('Browser report: '+root);
}catch(error){if(page)await page.screenshot({path:path.join(root,'failure.png'),fullPage:true}).catch(()=>{});await fs.writeFile(path.join(root,'server.log'),logs);console.error('Failure artifacts: '+root);throw error;}finally{await browser?.close();server?.kill();}
