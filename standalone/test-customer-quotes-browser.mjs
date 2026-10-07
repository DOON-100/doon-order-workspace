// Isolated integration/UI coverage; never touches the production database or accounts.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import * as XLSX from 'xlsx';
const {chromium}=await import(process.env.DOON_PLAYWRIGHT_MODULE?pathToFileURL(process.env.DOON_PLAYWRIGHT_MODULE).href:'playwright');
const root=await fs.mkdtemp(path.resolve('test-output/customer-quote-browser-')),dist=path.resolve(process.env.DOON_BUILD_DIR||'test-output/customer-quote-build');
const origin='http://127.0.0.1:18797',env={...process.env,DOON_DATA_DIR:root,DOON_HOST:'127.0.0.1',DOON_PORT:'18797',DOON_NO_AUTO_BACKUP:'1'};
const checks=[],errors=[],pass=s=>{checks.push(s);console.log('PASS '+s);};
execFileSync(process.execPath,[path.join(dist,'manage.mjs'),'init'],{env,stdio:'pipe',windowsHide:true});
const initial=(await fs.readFile(path.join(root,'管理员首次登录.txt'),'utf8')).match(/初始密码：([^\n]+)/)[1];
const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Synthetic quotation'],['MODEL-TEST',200,10,5]]),'Quotation');
const bytes=XLSX.write(book,{type:'buffer',bookType:'xlsx'}),source=path.join(root,'synthetic.xlsx'),draftPath=path.join(root,'draft.json');
await fs.writeFile(source,bytes);
const draft={companyZh:'测试公司',companyEn:'Test Company',customerCode:'TEST-QA',customerName:'Synthetic customer',quoteNo:'SYNTHETIC-QUOTE-01',quoteDate:'2026-10-01',validUntil:'2026-10-31',currency:'USD',sourceSha256:createHash('sha256').update(bytes).digest('hex'),lines:[{id:'test-line',model:'MODEL-TEST',descriptionZh:'合成测试镜架',descriptionEn:'Synthetic test frame',quantity:200,unitPrice:10,toolingFee:5}],terms:[{id:'test-term',labelZh:'价格条件',labelEn:'Price basis',zh:'测试价格，不用于生产。',en:'Test only, not a production quotation.',needsReview:true,reviewNote:'Test review'}],reviewNotes:['合成测试待核对']};
await fs.writeFile(draftPath,JSON.stringify(draft));
const seed=()=>JSON.parse(execFileSync(process.execPath,['standalone/import-customer-quote.mjs','--build-dir',dist,'--draft',draftPath,'--source',source],{env,encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true}));
assert(seed().preserved);const second=seed();assert(second.alreadyPresent);assert.equal(second.added,0);pass('Local draft import preserves every existing record and is idempotent.');
let browser,cookie='',server=spawn(process.execPath,[path.join(dist,'server.mjs')],{env,stdio:'pipe',windowsHide:true}),logs='';server.stderr.on('data',b=>logs+=b);server.stdout.on('data',()=>{});
async function api(route,body){const r=await fetch(origin+'/api/'+route,{method:body===undefined?'GET':'POST',headers:{Origin:origin,Cookie:cookie,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];const value=await r.json();assert.equal(r.status,200,JSON.stringify(value));return value;}
try{
 for(let i=0;i<50;i++){try{if((await fetch(origin+'/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 await api('auth/login',{username:'admin',password:initial});await api('auth/password',{currentPassword:initial,password:'Quote-Synthetic-Personal-2026!'});
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-proxy-server']});
 const context=await browser.newContext({viewport:{width:1510,height:1000}});await context.addInitScript(()=>Object.defineProperty(Crypto.prototype,'randomUUID',{value:undefined,configurable:true}));const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 const split=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),url:origin,httpOnly:true,sameSite:'Strict'}]);
 await page.goto(origin+'/customer-quotes');await page.getByRole('heading',{name:'客户报价',exact:true}).waitFor();
 await page.getByText('MODEL-TEST',{exact:true}).first().waitFor();
 assert.equal(await page.locator('.rail').count(),1);assert.match(await page.locator('.customer-quote-panel').innerText(),/待确认/);pass('Quotation lives inside the existing workspace with one sidebar and draft status.');
 await page.screenshot({path:path.join(root,'quote-zh.png'),fullPage:true});
 await page.getByRole('tab',{name:'English',exact:true}).click();assert.match(await page.locator('.cq-document').innerText(),/Synthetic test frame/);await page.screenshot({path:path.join(root,'quote-en.png'),fullPage:true});
 await page.getByRole('tab',{name:'编辑草稿',exact:true}).click();
 await page.getByLabel('订单数量 · 第 1 项',{exact:true}).fill('240');await page.getByLabel('单价 (USD/件) · 第 1 项',{exact:true}).fill('12');await page.getByLabel('模具费 (USD/款) · 第 1 项',{exact:true}).fill('0');
 await page.getByRole('tab',{name:'English',exact:true}).click();assert.match(await page.locator('.cq-products tbody').innerText(),/240/);assert.match(await page.locator('.cq-products tbody').innerText(),/12.00/);assert.match(await page.locator('.cq-products tbody').innerText(),/0.00/);
 await page.locator('nav').getByRole('button',{name:'业务工作台',exact:true}).click();assert.match(await page.locator('body').innerText(),/当前页面还有未保存内容/);assert(page.url().endsWith('/customer-quotes'));
 await page.getByRole('button',{name:'保存到中台',exact:true}).click();await page.getByText(/已保存到协作中台 · 第 3 版/).waitFor();await page.reload();await page.getByText('MODEL-TEST',{exact:true}).first().waitFor();assert.match(await page.locator('.cq-products tbody').innerText(),/240/);pass('Shared quantity/prices/tooling save to the backend; navigation cannot silently discard edits.');
 const secondPage=await context.newPage();secondPage.on('dialog',d=>d.accept());secondPage.on('pageerror',e=>errors.push(e.message));await secondPage.goto(origin+'/customer-quotes');await secondPage.getByText('MODEL-TEST',{exact:true}).first().waitFor();
 await page.getByRole('tab',{name:'编辑草稿',exact:true}).click();await page.getByLabel('单价 (USD/件) · 第 1 项',{exact:true}).fill('13');await page.getByRole('button',{name:'保存到中台',exact:true}).click();await page.getByText(/已保存到协作中台 · 第 4 版/).waitFor();
 await secondPage.getByRole('tab',{name:'编辑草稿',exact:true}).click();await secondPage.getByLabel('单价 (USD/件) · 第 1 项',{exact:true}).fill('14');await secondPage.getByRole('button',{name:'保存到中台',exact:true}).click();await secondPage.getByRole('alert').filter({hasText:'此报价已被其他同事更新'}).waitFor();assert.equal(await secondPage.getByLabel('单价 (USD/件) · 第 1 项',{exact:true}).inputValue(),'14');assert.equal((await api('workspace/customer-quotes')).quotes[0].lines[0].unitPrice,13);pass('Two tabs cannot overwrite a newer version; the conflicting tab keeps its input.');
 await page.getByLabel('单价 (USD/件) · 第 1 项',{exact:true}).fill('');await page.getByRole('button',{name:'保存到中台',exact:true}).click();await page.getByRole('alert').filter({hasText:'免收请明确填写 0'}).waitFor();assert.equal((await api('workspace/customer-quotes')).quotes[0].version,4);await page.getByRole('button',{name:'读取服务器版本',exact:true}).click();await page.getByRole('tab',{name:'中英对照',exact:true}).click();assert.match(await page.locator('.cq-products tbody').innerText(),/合成测试镜架/);assert.match(await page.locator('.cq-products tbody').innerText(),/Synthetic test frame/);pass('Blank prices cannot silently become zero, and bilingual text remains paired.');
 await page.emulateMedia({media:'print'});assert.equal(await page.locator('.rail').isVisible(),false);assert.equal(await page.locator('.lan-account-actions').isVisible(),false);assert.equal(await page.locator('.cq-draft-stamp').isVisible(),true);await page.emulateMedia({media:'screen'});pass('Print includes the draft quotation only, not navigation or account controls.');
 await page.getByRole('button',{name:'新建报价草稿',exact:true}).click();await page.getByLabel('客户编号',{exact:true}).fill('TEST-NEW');await page.getByLabel('客户名称',{exact:true}).fill('Synthetic new customer');await page.getByLabel('报价单号',{exact:true}).fill('SYNTHETIC-QUOTE-02');await page.getByLabel('公司名称 · 中文',{exact:true}).fill('测试公司');await page.getByLabel('Company name · English',{exact:true}).fill('Test Company');await page.getByLabel('有效期至',{exact:true}).fill('2027-10-31');await page.getByLabel('型号 · 第 1 项',{exact:true}).fill('TEST-NEW');await page.getByLabel('订单数量 · 第 1 项',{exact:true}).fill('20');await page.getByLabel('单价 (USD/件) · 第 1 项',{exact:true}).fill('2');await page.getByLabel('模具费 (USD/款) · 第 1 项',{exact:true}).fill('0');await page.getByRole('button',{name:'保存到中台',exact:true}).click();await page.getByText(/已保存到协作中台 · 第 1 版/).waitFor();assert.equal((await api('workspace/customer-quotes')).quotes.length,2);pass('New quote creation persists without changing the existing quotation.');
 await page.getByLabel('报价列表').getByRole('button').filter({hasText:'SYNTHETIC-QUOTE-01'}).click();await page.getByRole('tab',{name:'中文版',exact:true}).click();
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(root,'quote-mobile.png'),fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));pass('Quotation remains usable at phone width and creation works without secure-context randomUUID.');
 assert.deepEqual(errors,[]);pass('Chinese/English quotation renders without browser runtime errors.');
 const q=(await api('workspace/customer-quotes')).quotes.find(q=>q.quoteNo===draft.quoteNo);assert.equal(q.sourceHash,draft.sourceSha256);assert.equal(q.history.length,4);
 const download=await fetch(origin+'/api/workspace/customer-quote-file?id='+encodeURIComponent(q.id),{headers:{Cookie:cookie}});assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes);pass('Authenticated original attachment downloads byte-identically.');
 await fs.writeFile('test-output/customer-quote-browser-result.json',JSON.stringify({passed:checks.length,checks,root,at:new Date().toISOString()},null,2));console.log(JSON.stringify({root,passed:checks.length}));
}catch(e){console.error(logs);for(const c of browser?.contexts()||[]){const p=c.pages()[0];if(p){await p.screenshot({path:path.join(root,'failure.png'),fullPage:true}).catch(()=>{});await fs.writeFile(path.join(root,'failure.txt'),await p.locator('body').innerText());}}console.error('Evidence: '+root);throw e;}finally{await browser?.close();server.kill();}
