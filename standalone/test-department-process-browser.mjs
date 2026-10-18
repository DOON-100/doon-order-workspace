// Full browser checks against an isolated build and a fresh synthetic database only.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import * as XLSX from 'xlsx';

const output=path.resolve('test-output'),dist=path.resolve(process.env.DOON_BUILD_DIR||'test-output/department-process-build');
assert(dist.startsWith(output+path.sep),'Use a build inside test-output, never the production distribution.');
await fs.mkdir(output,{recursive:true});
const root=await fs.mkdtemp(path.join(output,'department-process-browser-'));
const port=18824,origin=`http://127.0.0.1:${port}`;
const env={...process.env,DOON_SERVER_MODE:'internal',DOON_REVIEW_MODE:'0',DOON_DATA_DIR:root,DOON_BUILD_DIR:dist,DOON_HOST:'127.0.0.1',DOON_PORT:String(port),DOON_NO_AUTO_BACKUP:'1',DOON_TLS_CERT:'',DOON_TLS_KEY:''};
execFileSync(process.execPath,[path.join(dist,'manage.mjs'),'init'],{env,stdio:'pipe',windowsHide:true});
const initial=(await fs.readFile(path.join(root,'管理员首次登录.txt'),'utf8')).match(/初始密码：([^\n]+)/)[1];
const admin={cookie:''},viewer={cookie:''},errors=[],checks=[];
let server,browser,page,logs='';
const pass=message=>{checks.push(message);console.log('PASS '+message);};
async function api(route,body,session=admin){
 const response=await fetch(origin+'/api/'+route,{method:body===undefined?'GET':'POST',headers:{Origin:origin,...(session.cookie?{Cookie:session.cookie}:{}),...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});
 if(response.headers.get('set-cookie'))session.cookie=response.headers.get('set-cookie').split(';')[0];
 const result=await response.json();assert.equal(response.status,200,route+' '+JSON.stringify(result));return result;
}
async function signedPage(session,viewport={width:1536,height:1000}){
 const context=await browser.newContext({viewport}),split=session.cookie.indexOf('=');
 await context.addCookies([{name:session.cookie.slice(0,split),value:session.cookie.slice(split+1),url:origin,httpOnly:true,sameSite:'Strict'}]);
 const p=await context.newPage();p.on('pageerror',error=>errors.push(error.message));return {context,page:p};
}
async function openNav(p,id){
 const item=p.locator(`[data-nav-id="${id}"]`),group=item.locator('xpath=ancestor::*[@data-department-id]'),toggle=group.locator('.department-navigation-toggle');
 if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();
 await item.click();
}
try{
 server=spawn(process.execPath,[path.join(dist,'server.mjs')],{env,stdio:'pipe',windowsHide:true});
 server.stdout.on('data',value=>logs+=value);server.stderr.on('data',value=>logs+=value);
 let ready=false;for(let i=0;i<100;i++){try{if((await fetch(origin+'/health')).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}assert(ready,'Synthetic server must start.');
 await api('auth/login',{username:'admin',password:initial});await api('auth/password',{currentPassword:initial,password:'Synthetic-Process-Admin-2026!'});
 await api('auth/accounts',{username:'process_viewer',name:'合成只读成员',role:'viewer',password:'Synthetic-Process-First-2026!',customers:[],orderScope:'all'});
 await api('auth/login',{username:'process_viewer',password:'Synthetic-Process-First-2026!'},viewer);await api('auth/password',{currentPassword:'Synthetic-Process-First-2026!',password:'Synthetic-Process-Viewer-2026!'},viewer);
 const sheet={};for(const [address,value] of Object.entries({A3:'生产厂',I3:'订单号',J3:'图纸编号',M3:'订单数量',BF3:'包装入仓数量',A4:'度昂',C4:'SYNTHETIC-PROCESS-CUSTOMER',I4:'SYNTHETIC-PROCESS-001',J4:'SYNTHETIC-FRAME',M4:100,BF4:0}))sheet[address]={t:typeof value==='number'?'n':'s',v:value};
 sheet['!ref']='A1:BK4';const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'动态表');
 const form=new FormData();form.set('file',new File([XLSX.write(book,{type:'buffer',bookType:'xlsx'})],'synthetic-process.xlsx'));form.set('mode','active');
 let job=await api('workspace/ledger-preview',form);while(job.status!=='已完成')job=await api('workspace/ledger-commit',{id:job.id,offset:job.offset});
 const before=await api('workspace/data'),order=before.orders.find(row=>row.orderNo==='SYNTHETIC-PROCESS-001');assert(order);
 const {chromium}=await import(process.env.DOON_PLAYWRIGHT_MODULE?pathToFileURL(process.env.DOON_PLAYWRIGHT_MODULE).href:'playwright');
 browser=await chromium.launch({headless:true,...(process.env.DOON_CHROMIUM_PATH?{executablePath:process.env.DOON_CHROMIUM_PATH}:{channel:'chrome'}),args:['--no-proxy-server']});
 const signed=await signedPage(admin);page=signed.page;
 await page.goto(origin+'/business-process');await page.locator('.process-overview').waitFor();
 assert.equal(await page.locator('[data-department-id]').count(),11);assert.equal(await page.locator('.process-stage').count(),13);assert.equal(await page.locator('.process-paths article').count(),4);
 assert.equal(await page.locator('.department-workspace-navigation [aria-current="page"]').count(),1);
 await page.screenshot({path:path.join(root,'business-process-desktop.png'),fullPage:true});
 pass('11 departments, 13 stages and four actual business paths render with one active menu.');
 const kinds=['rfq','sample','engineering-change','iqc','material-kit','warehouse','first-article','process-quality','outsourcing-quality','oqc','packaging','shipment-release','supplier-reconciliation','complaint'];
 for(const kind of kinds){await openNav(page,'process-'+kind);await page.locator('.process-list').waitFor();assert.equal(new URL(page.url()).searchParams.get('tab'),kind);assert.equal(await page.locator('.department-workspace-navigation [aria-current="page"]').getAttribute('data-nav-tab'),kind);}
 pass('All 14 process leaves open their own working list and preserve exact tab highlighting.');
 await openNav(page,'process-iqc');await page.getByRole('button',{name:'新增作业',exact:true}).click();
 let editor=page.getByRole('region',{name:'流程作业记录编辑'});
 await editor.getByLabel('作业名称 *',{exact:true}).fill('合成来料检验作业');
 await editor.getByLabel('关联订单 / 款色明细',{exact:true}).selectOption(order.id);
 await editor.getByLabel('检验数量',{exact:true}).fill('10');await editor.getByLabel('合格数量',{exact:true}).fill('9');await editor.getByLabel('不良数量',{exact:true}).fill('1');
 await editor.getByLabel('输入资料 / 执行依据',{exact:true}).fill('Synthetic inspection standard v1');
 await openNav(page,'process-first-article');assert.equal(new URL(page.url()).searchParams.get('tab'),'iqc');await page.getByRole('alert').filter({hasText:'当前页面还有未保存内容'}).waitFor();
 await editor.getByRole('button',{name:'保存作业记录',exact:true}).click();await page.getByRole('status').filter({hasText:'已保存作业记录 · 版本 1'}).waitFor();
 let records=(await api('workspace/process-data?type=iqc')).records;assert.equal(records.length,1);assert.equal(records[0].details.inspectedQuantity,10);assert.equal(records[0].details.rejectedQuantity,1);
 const id=records[0].id;
 await editor.getByLabel('补充说明 / 本次修改原因',{exact:true}).fill('Synthetic follow-up evidence');await editor.getByRole('button',{name:'保存作业记录',exact:true}).click();await page.getByRole('status').filter({hasText:'已保存作业记录 · 版本 2'}).waitFor();
 await editor.getByRole('button',{name:'查看历史版本',exact:true}).click();await page.locator('.process-history details').nth(1).waitFor();assert.equal(await page.locator('.process-history details').count(),2);
 assert.equal((await api('workspace/process-history?id='+id)).history.length,2);
 await page.goto(origin+'/process-workspace?tab=iqc&recordId='+id);await page.getByRole('region',{name:'流程作业记录编辑'}).waitFor();editor=page.getByRole('region',{name:'流程作业记录编辑'});assert.equal(await editor.getByLabel('检验数量',{exact:true}).inputValue(),'10');assert.equal(await editor.getByLabel('补充说明 / 本次修改原因',{exact:true}).inputValue(),'Synthetic follow-up evidence');
 await page.screenshot({path:path.join(root,'process-editor-desktop.png'),fullPage:true});
 pass('Numeric quantities save, versions survive reload, history is readable, and dirty navigation is blocked.');
 // A second writer advances the record. The first writer must keep its own draft and show the conflict.
 await editor.getByLabel('补充说明 / 本次修改原因',{exact:true}).fill('Unsaved local change');
 records=(await api('workspace/process-data?type=iqc')).records;const remote=records[0];
 const fields=['id','version','type','customerId','orderId','teamId','title','batch','ownerId','responsibleId','plannedDate','actualDate','status','inputBasis','inputVersion','outputEvidence','gateStatus','blocker','nextAction','nextOwnerId','nextDueDate','notes','details'];
 await api('workspace/process-save',{...Object.fromEntries(fields.map(key=>[key,remote[key]])),notes:'Synthetic second writer'});
 await editor.getByRole('button',{name:'保存作业记录',exact:true}).click();await page.getByRole('alert').filter({hasText:/已被更新|已由其他人更新/}).first().waitFor();assert.equal(await editor.getByLabel('补充说明 / 本次修改原因',{exact:true}).inputValue(),'Unsaved local change');
 assert.equal((await api('workspace/process-data?type=iqc')).records[0].notes,'Synthetic second writer');
 pass('A stale editor cannot overwrite another writer and retains its unsaved input.');
 await page.locator('.process-related').getByRole('button',{name:'供应商收货',exact:false}).click();
 await page.getByRole('button',{name:'保留输入',exact:true}).click();assert.equal(await editor.getByLabel('补充说明 / 本次修改原因',{exact:true}).inputValue(),'Unsaved local change');
 await page.locator('.process-related').getByRole('button',{name:'供应商收货',exact:false}).click();await page.getByRole('button',{name:'放弃本次输入并继续',exact:true}).click();
 assert.equal(new URL(page.url()).pathname,'/receiving');
 await page.goto(origin+'/process-workspace');await page.locator('.process-list').waitFor();assert.equal(await page.locator('.department-workspace-navigation [aria-current="page"]').getAttribute('data-nav-tab'),'rfq');
 await page.goto(origin+'/process-workspace?tab=unknown');await page.getByRole('heading',{name:'未找到这个流程作业类型',exact:true}).waitFor();assert.equal(await page.locator('.department-workspace-navigation [aria-current="page"]').count(),0);
 pass('Explicit discard works, an omitted tab highlights RFQ, and an invalid tab never opens a different process.');
 await signed.context.close();
 const readOnly=await signedPage(viewer);page=readOnly.page;await page.goto(origin+'/process-workspace?tab=iqc&recordId='+id);await page.getByRole('region',{name:'流程作业记录编辑'}).waitFor();assert(await page.getByRole('button',{name:'新增作业',exact:true}).isDisabled());assert(await page.getByRole('button',{name:'保存作业记录',exact:true}).isDisabled());assert(await page.getByLabel('作业名称 *',{exact:true}).isDisabled());await readOnly.context.close();
 pass('Existing read-only identity can inspect the permitted record but cannot create or edit.');
 const mobile=await signedPage(admin,{width:390,height:844});page=mobile.page;await page.goto(origin+'/business-process');await page.locator('.process-overview').waitFor();await openNav(page,'process-packaging');await page.locator('.process-list').waitFor();assert.equal(new URL(page.url()).searchParams.get('tab'),'packaging');await page.screenshot({path:path.join(root,'process-mobile.png'),fullPage:true});await mobile.context.close();
 pass('Two-level department navigation and process lists remain usable at phone width.');
 const after=await api('workspace/data');for(const key of ['orders','reports','members','comments','corrections','attachments','imports','exports','ledgerImports','outsource','receipts'])assert.deepEqual(after[key],before[key],key+' must remain unchanged');
 assert.equal(errors.length,0,JSON.stringify(errors));pass('All pre-existing orders, attachments, accounts and source lists remain unchanged; no browser runtime errors.');
 await fs.writeFile(path.join(root,'result.json'),JSON.stringify({checks,errors,at:new Date().toISOString()},null,2));console.log('Browser report: '+root);
}catch(error){if(page)await page.screenshot({path:path.join(root,'failure.png'),fullPage:true}).catch(()=>{});await fs.writeFile(path.join(root,'server.log'),logs);console.error('Failure artifacts: '+root);throw error;}finally{await browser?.close();server?.kill();}
