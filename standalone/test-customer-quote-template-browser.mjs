// Isolated template/UI regression: synthetic records, temporary DB and port 18796 only.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import * as XLSX from 'xlsx';
import {unzipSync,strFromU8} from 'fflate';
import {verifyCustomerPriceBuildEvidence} from '../scripts/customer-price-build-evidence.mjs';

const {chromium}=await import(process.env.DOON_PLAYWRIGHT_MODULE?pathToFileURL(process.env.DOON_PLAYWRIGHT_MODULE).href:'playwright');
await fs.mkdir('test-output',{recursive:true});
const root=await fs.mkdtemp(path.resolve('test-output/customer-quote-template-browser-'));
const dist=path.resolve(process.env.DOON_BUILD_DIR||'test-output/customer-quote-template-build');
const origin='http://127.0.0.1:18796';
const env={...process.env,DOON_DATA_DIR:root,DOON_HOST:'127.0.0.1',DOON_PORT:'18796',DOON_NO_AUTO_BACKUP:'1',DOON_TLS_CERT:'',DOON_TLS_KEY:''};
const checks=[],pageErrors=[],httpErrors=[],pass=name=>{checks.push(name);console.log('PASS '+name);};
const buildEvidence=await verifyCustomerPriceBuildEvidence(dist);
execFileSync(process.execPath,[path.join(dist,'manage.mjs'),'init'],{env,stdio:'pipe',windowsHide:true});
const initial=(await fs.readFile(path.join(root,'管理员首次登录.txt'),'utf8')).match(/初始密码：([^\n]+)/)[1];
const password='Synthetic-Template-Browser-2026!';
let cookie='',browser,server,logs='';
async function request(action,body){
 const response=await fetch(origin+'/api/'+action,{method:body===undefined?'GET':'POST',headers:{Origin:origin,Cookie:cookie,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});
 if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return response;
}
async function api(action,body){const response=await request(action,body),value=await response.json();assert.equal(response.status,200,action+': '+JSON.stringify(value));return value;}
const today=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
const fixture=()=>{
 const sheet=XLSX.utils.aoa_to_sheet([
  ['Synthetic parts only'],[],['Model Name','Material Number','Material Description','Unit Price Whole Model','Notes'],
  ['SYN-MODEL-A','SYN-RAW','FRAME RAW SIZE 50-20',null,'Synthetic raw frame'],
  [null,'SYN-TIP-L','TEMPLE TIP LEFT BLACK',null,'Synthetic left tip'],
  ['SYN-MODEL-B','SYN-TIP-L','TEMPLE TIP LEFT BLACK',null,'Synthetic shared tip'],
 ]);
 sheet['!merges']=[XLSX.utils.decode_range('A4:A5')];
 const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'Synthetic parts');return XLSX.write(book,{type:'buffer',bookType:'xlsx'});
};
async function download(page,locator,name){const pending=page.waitForEvent('download');await locator.click();const result=await pending,file=path.join(root,name);await result.saveAs(file);return {filename:result.suggestedFilename(),file,bytes:await fs.readFile(file)};}
async function completed(id){return (await api('workspace/customer-quote-completed')).rows.filter(row=>row.quoteId===id);}
try{
 server=spawn(process.execPath,[path.join(dist,'server.mjs')],{env,stdio:'pipe',windowsHide:true});server.stderr.on('data',bytes=>logs+=bytes);server.stdout.on('data',bytes=>logs+=bytes);
 let ready=false;for(let i=0;i<60;i++){try{if((await fetch(origin+'/health')).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}assert(ready,'Isolated test service did not become healthy');
 await api('auth/login',{username:'admin',password:initial});await api('auth/password',{currentPassword:initial,password});
 const account=(await api('workspace/customer-save',{customer:'SYNTHETIC TEMPLATE BROWSER CUSTOMER',customerCode:'SYN-T-BROWSER',salesName:'',serviceName:'',quoteMemberIds:[],active:true})).item;
 const base={companyZh:'合成测试公司',companyEn:'Synthetic Company',customerAccountId:account.id,customerName:account.customer,customerCode:account.customerCode,contactName:'Synthetic Contact',quoteNo:'SYN-TEMPLATE-BROWSER-01',quoteDate:today(),validUntil:'2027-12-31',currency:'EUR',brand:'Synthetic QA brand',businessType:'spare_parts',internalNotesZh:'INTERNAL-SECRET-SYNTHETIC-ONLY',internalCosts:[{id:'synthetic-cost',label:'INTERNAL-SECRET-SYNTHETIC-SUPPLIER',rmb:20,notes:'INTERNAL-SECRET-SYNTHETIC-NOTE'}],lines:[{id:'placeholder',model:'Synthetic placeholder',descriptionZh:'合成草稿',descriptionEn:'Synthetic placeholder',quantity:null,unitPrice:null,toolingFee:null}],terms:[{id:'synthetic-term',labelZh:'供货条件',labelEn:'Supply conditions',zh:'合成物料按行单独计价，不用于生产或交易。',en:'Synthetic materials are priced per listed item; test only.',needsReview:false}],reviewNotes:[]};
 let quote=(await api('workspace/customer-quote-save',base)).quote;
 const form=new FormData();for(const [key,value] of Object.entries({customerAccountId:account.id,brand:base.brand,businessType:base.businessType,title:'Synthetic browser template'}))form.set(key,value);form.set('file',new File([fixture()],'synthetic-template.xlsx'));
 const registered=(await api('workspace/customer-quote-template-register',form)).template;assert.equal(registered.rowCount,3);assert.equal(registered.itemCount,2);
 quote=(await api('workspace/customer-quote-template-apply',{quoteId:quote.id,version:quote.version,templateId:registered.id})).quote;
 assert.equal(quote.lines.length,2);assert(quote.lines.every(line=>line.quantity===null&&line.unit==='unknown'&&!line.scopeReviewed));assert.equal(quote.currencyReviewed,false);assert.equal(quote.pricingBasis,'pending');
 const blocked=await request('workspace/customer-quote-confirm',{id:quote.id,version:quote.version,acknowledgeEnglish:true});assert.equal(blocked.status,400);assert.equal((await completed(quote.id)).length,0);
 pass('HTTP template registration maps three original positions to two pending canonical items and blocks premature confirmation.');
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-proxy-server']});
 const context=await browser.newContext({viewport:{width:1510,height:1050},acceptDownloads:true});
 await context.addInitScript(()=>Object.defineProperty(Crypto.prototype,'randomUUID',{value:undefined,configurable:true}));
 const page=await context.newPage();page.on('pageerror',error=>pageErrors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 page.on('response',response=>{if(response.url().startsWith(origin+'/api/workspace/')&&response.status()>=400)httpErrors.push({url:new URL(response.url()).pathname,status:response.status()});});
 await page.goto(origin);await page.getByLabel('登录账号',{exact:true}).fill('admin');await page.getByLabel('登录密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await page.getByRole('heading',{name:'动态订单总表',exact:true}).waitFor();
 await page.goto(origin+'/customer-quotes');await page.getByRole('heading',{name:'客户报价',exact:true}).waitFor();await page.getByLabel('报价列表').getByRole('button').filter({hasText:base.quoteNo}).click();
 assert.match(await page.locator('.cq-template-binding').innerText(),/Synthetic browser template[\s\S]*3 行/);
 await page.getByRole('tab',{name:'English',exact:true}).click();
 assert.match(await page.locator('.cq-document').innerText(),/Currency pending review:[\s\S]*EUR/);assert.match(await page.locator('.cq-document').innerText(),/unit pending/);assert.match(await page.locator('.cq-document').innerText(),/Supply scope pending review/);
 assert.equal(await page.getByRole('button',{name:'确认英文报价',exact:true}).isEnabled(),false);assert.match(await page.locator('.customer-quote-panel').innerText(),/配件、原坯或半成品需要明确中英文供货范围/);
 await page.screenshot({path:path.join(root,'01-template-pending.png'),fullPage:true});
 pass('Browser login displays template binding, unreviewed currency, unknown units and explicit supply-scope confirmation blockers.');
 await page.getByRole('button',{name:'修改全部内容',exact:true}).click();
 await page.getByLabel('币种',{exact:true}).fill('GBP');await page.getByLabel('计价方式',{exact:true}).selectOption('row_item');await page.getByLabel('已核对报价币种',{exact:true}).check();
 const scopes=['Synthetic raw frame only; excludes finishing and assembly.','Synthetic left temple tip only; excludes right tip and fitting.'];
 for(let index=1;index<=2;index++){
  await page.getByLabel(`计价单位 · 第 ${index} 项`,{exact:true}).selectOption('piece');
  await page.getByLabel(`供货阶段 · 第 ${index} 项`,{exact:true}).selectOption(index===1?'raw':'finished');
  await page.getByLabel(`供货范围／包含排除项 · 中文 · 第 ${index} 项`,{exact:true}).fill(index===1?'仅合成原坯镜架；不含表面处理与装配。':'仅合成左脚套；不含右件与安装。');
  await page.getByLabel(`Supply scope / included and excluded · English · 第 ${index} 项`,{exact:true}).fill(scopes[index-1]);
  await page.getByLabel(`数量基准 · 中文 · 第 ${index} 项`,{exact:true}).fill('合成价目，数量按订单另行确认');
  await page.getByLabel(`Quantity basis · English · 第 ${index} 项`,{exact:true}).fill('Synthetic price list; order quantity confirmed separately');
  await page.getByLabel(`对客单价 (GBP/件) · 第 ${index} 项`,{exact:true}).fill(index===1?'5.5':'1.25');
  await page.getByLabel(`模具费 (GBP/款) · 第 ${index} 项`,{exact:true}).fill('0');
  await page.getByLabel(`已核对供货范围 · 第 ${index} 项`,{exact:true}).check();
 }
 for(const checkbox of await page.getByLabel('该条款仍需确认',{exact:true}).all())await checkbox.uncheck();
 await page.getByLabel('内部待确认事项（每行一项，不打印）',{exact:true}).fill('');
 const saved=page.waitForResponse(response=>response.url().endsWith('/api/workspace/customer-quote-save')&&response.request().method()==='POST');await page.getByRole('button',{name:'确认保存全部修改',exact:true}).click();assert.equal((await saved).status(),200);await page.getByText(/已保存到协作中台 · 第/).waitFor();
 await page.getByRole('tab',{name:'English',exact:true}).click();const english=await page.locator('.cq-document').innerText();for(const scope of scopes)assert(english.includes(scope));assert.match(english,/GBP \/ piece/);assert.doesNotMatch(await page.locator('.customer-quote-panel').innerText(),/INTERNAL-SECRET/);
 assert.equal(await page.getByRole('button',{name:'确认英文报价',exact:true}).isEnabled(),true);
 await page.screenshot({path:path.join(root,'02-english-reviewed.png'),fullPage:true});
 const confirmation=page.waitForResponse(response=>response.url().endsWith('/api/workspace/customer-quote-confirm'));await page.getByRole('button',{name:'确认英文报价',exact:true}).click();assert.equal((await confirmation).status(),200);await page.getByText(/英文报价已确认并锁定，已完成清单已生成/).waitFor();
 quote=(await api('workspace/customer-quotes')).quotes.find(item=>item.id===quote.id);assert.equal(quote.status,'confirmed');assert.equal(quote.currency,'GBP');assert(quote.lines.every(line=>line.quantity===null&&line.scopeReviewed&&line.unit==='piece'&&line.toolingFee===0));
 let rows=await completed(quote.id);assert.equal(rows.length,2);assert(rows.every(row=>row.currency==='GBP'&&row.unit==='piece'&&row.quotedCustomer===''));
 pass('UI edits explicitly establish units, supply scope, basis, zero tooling and GBP; English confirmation creates unsent completed rows.');
 const output=await download(page,page.getByRole('link',{name:'下载客户格式 Excel',exact:true}),'synthetic-customer-output.xlsx');
 const outputBook=XLSX.read(output.bytes),customerSheet=outputBook.Sheets['Synthetic parts'];assert.equal(customerSheet.D4.v,5.5);assert.equal(customerSheet.D5.v,1.25);assert.equal(customerSheet.D6.v,1.25);assert(outputBook.Sheets.Terms);
 const publicXml=Object.values(unzipSync(output.bytes)).map(bytes=>strFromU8(bytes)).join('\n');assert.doesNotMatch(publicXml,/INTERNAL-SECRET/);for(const scope of scopes)assert(publicXml.includes(scope));
 const total=await download(page,page.locator('a[href^="/api/workspace/customer-quote-completed-export"]').first(),'synthetic-completed-table.xlsx');
 const totalBook=XLSX.read(total.bytes),totalRows=XLSX.utils.sheet_to_json(totalBook.Sheets[totalBook.SheetNames[0]]).filter(row=>row['报价单号']===base.quoteNo);assert.equal(totalRows.length,2);assert(totalRows.every(row=>row['币种']==='GBP'&&row['单位']==='piece'));assert.doesNotMatch(JSON.stringify(totalRows),/INTERNAL-SECRET/);
 assert.doesNotMatch(await page.locator('.cq-completed').innerText(),/单价（美元\/副）/);await page.screenshot({path:path.join(root,'03-confirmed-downloads.png'),fullPage:true});
 pass('Customer-format download repeats the shared item price correctly, and completed-table download preserves GBP/piece without internal costs.');
 await page.locator('.cq-completed').getByRole('button',{name:'查看此版本',exact:true}).first().click();const archive=page.getByRole('region',{name:'报价版本档案',exact:true});await archive.waitFor();
 const upload=archive.getByLabel('上传已发报价文件',{exact:true});assert((await upload.getAttribute('accept')).includes('.xlsx'),'Bound confirmed template must permit validated sent XLSX uploads');
 const mediaResponse=page.waitForResponse(response=>response.url().endsWith('/api/workspace/customer-quote-media-upload'));await upload.setInputFiles(output.file);assert.equal((await mediaResponse).status(),200);await archive.getByText('synthetic-customer-output.xlsx',{exact:true}).first().waitFor();
 rows=await completed(quote.id);assert(rows.every(row=>row.quotedCustomer===''));assert.equal(await page.locator('.cq-sent-label').count(),0);
 const media=(await api(`workspace/customer-quote-version?quoteId=${quote.id}&quoteVersion=${quote.version}`)).media.find(item=>item.filename==='synthetic-customer-output.xlsx');assert(media&&media.category==='sent_quote');
 await page.screenshot({path:path.join(root,'04-actual-xlsx-unsent.png'),fullPage:true});
 pass('Historical archive accepts the verified actual sent XLSX while leaving the completed ledger unmarked as sent.');
 await archive.getByRole('button',{name:'登记已发送',exact:true}).click();await archive.getByLabel('收件人／邮箱',{exact:true}).fill('synthetic-recipient@test.invalid');await archive.getByLabel('发送渠道',{exact:false}).selectOption('email');
 await archive.locator('.cq-evidence-options').first().getByLabel('synthetic-customer-output.xlsx',{exact:false}).check();
 await archive.locator('.cq-evidence-options.cq-archive-warning input[type="checkbox"]').check();
 const sent=page.waitForResponse(response=>response.url().endsWith('/api/workspace/customer-quote-record-sent'));await archive.getByRole('button',{name:'确认登记已发送',exact:true}).click();assert.equal((await sent).status(),200);await page.getByText(/已登记实际发送，总表“已报价客户”已标记为 Y/).waitFor();
 rows=await completed(quote.id);assert(rows.every(row=>row.quotedCustomer==='Y'&&row.sentHistory.length===1&&row.sentHistory[0].mediaIds.includes(media.id)));assert.equal(await page.locator('.cq-sent-label').count(),2);await page.screenshot({path:path.join(root,'05-sending-recorded.png'),fullPage:true});
 pass('Only explicit actual-send registration marks both canonical completed rows Y and links the verified sent Excel.');
 assert.deepEqual(pageErrors,[]);assert.deepEqual(httpErrors,[]);pass('Template editing, confirmation, downloads and archive actions run without page errors or unexpected failing HTTP responses.');
 const result={passed:checks.length,checks,root,buildDir:dist,buildEvidence,pageErrors,httpErrors,at:new Date().toISOString()};await fs.writeFile(path.join(root,'result.json'),JSON.stringify(result,null,2));await fs.writeFile('test-output/customer-quote-template-browser-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify({root,passed:checks.length}));
}catch(error){
 for(const context of browser?.contexts()||[]){const page=context.pages()[0];if(page){await page.screenshot({path:path.join(root,'failure.png'),fullPage:true}).catch(()=>{});await fs.writeFile(path.join(root,'failure.txt'),await page.locator('body').innerText()).catch(()=>{});}}
 await fs.writeFile(path.join(root,'failure-metadata.json'),JSON.stringify({pageErrors,httpErrors,checks,logs},null,2));console.error('Evidence: '+root);throw error;
}finally{await browser?.close();server?.kill();}
