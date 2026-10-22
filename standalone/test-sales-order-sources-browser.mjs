// Isolated UI acceptance: temporary database, generated credentials, synthetic sources only.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import * as XLSX from 'xlsx';
const {chromium}=await import(process.env.DOON_PLAYWRIGHT_MODULE?pathToFileURL(process.env.DOON_PLAYWRIGHT_MODULE).href:'playwright');
const dist=path.resolve(process.env.DOON_BUILD_DIR||'test-output/sales-order-sources-build');
await fs.mkdir(path.resolve('test-output'),{recursive:true});
const dir=await fs.mkdtemp(path.resolve('test-output/sales-order-sources-browser-')),origin='http://127.0.0.1:18844';
const env={...process.env,DOON_DATA_DIR:dir,DOON_HOST:'127.0.0.1',DOON_PORT:'18844',DOON_NO_AUTO_BACKUP:'1',DOON_KINGDEE_READONLY_ENABLED:'0'};
execFileSync(process.execPath,[path.join(dist,'manage.mjs'),'init'],{env,stdio:'pipe'});
const initial=(await fs.readFile(path.join(dir,'管理员首次登录.txt'),'utf8')).match(/初始密码：([^\n]+)/)[1];
const server=spawn(process.execPath,[path.join(dist,'server.mjs')],{env,stdio:'ignore',windowsHide:true});
let browser,cookie='';
async function api(route,body){
 const response=await fetch(origin+'/api/'+route,{method:body===undefined?'GET':'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
 assert.equal(response.status,200);return response.json();
}
function syntheticLine(index,second=false){
 const suffix=String(index+1).padStart(3,'0'),sourceRow=index+10;
 return {
  id:`demo_${second?'b':'a'}_${suffix}`,sourceRow,drawing:`DEMO-${second?'OTHER':'DRAWING'}-${suffix}`,model:`DEMO-MODEL-${suffix}`,color:suffix,sku:`SKU-${suffix}`,quantity:second?10:index+1,unit:second?'副':'PCS',sampleQuantity:second?3:index===0?null:2,unitPrice:'0.00',deliveryText:second?'':'交期原文待核对',
  colorFields:[
   {sourceColumn:'J',sourceLabel:'合成前部原栏',sourceCell:`J${sourceRow}`,value:'/',status:'adopted',standardZh:'合成部件色',standardEn:'Synthetic Part Color',qualifier:'前部位置独立保留',candidates:[]},
   {sourceColumn:'K',sourceLabel:'合成后部原栏',sourceCell:`K${sourceRow}`,value:'001-RAW',status:'adopted',standardZh:'合成部件色',standardEn:'Synthetic Part Color',qualifier:'后部位置独立保留',candidates:[]},
   {sourceColumn:'L',sourceLabel:'合成未定原栏',sourceCell:`L${sourceRow}`,value:null,status:'pending',standardZh:'',standardEn:'',qualifier:'保留未选定候选',candidates:['合成候选甲','合成候选乙']},
   {sourceColumn:'M',sourceLabel:'合成组合原栏',sourceCell:`M${sourceRow}`,value:'甲 / 乙组合原文',status:'composite',standardZh:'',standardEn:'',qualifier:'未拆值的组合',candidates:['合成部件色','合成附件色']},
  ],
  rawFields:[
   ...(index===4?[{column:'Y',label:'Amount',cell:`Y${sourceRow}`,value:'7.00'}]:[]),
   {column:'Z',label:index===5?'合成非金额原栏':'Item Net',cell:`Z${sourceRow}`,value:index===1?'0':index===2?null:'=B9*2',sourceAnchor:'Z9',sourceRange:'Z9:Z30',formula:index===1||index===2?null:'=B9*2',cachedValue:index===3?null:'12.50',hidden:true},
   {column:'J',label:'合成斜杠原栏',cell:`J${sourceRow}`,value:'/'},
   {column:'L',label:'合成空白原栏',cell:`L${sourceRow}`,value:null},
  ],notes:['合成逐行核对说明'],
 };
}
function item(second=false){
 const orderNo=second?'DEMO-ORDER-B':'DEMO-ORDER-A',source={schemaVersion:1,orderNo,customer:second?'DEMO-B':'DEMO-A',productType:'合成产品',customerPO:'DEMO-PO',documentType:'Sales Order Confirmation',source:{filename:'synthetic-order.xlsx',sha256:(second?'b':'a').repeat(64),sheet:second?'Demo B':'Demo A',detailRange:second?'A10:Z10':'A10:Z30'},dictionaryVersion:'synthetic-v1',dictionarySha256:'c'.repeat(64),warnings:['合成数量口径待核对；导入资料不触发生产。'],lines:second?[syntheticLine(0,true)]:Array.from({length:21},(_,index)=>syntheticLine(index))};
 return {id:second?'demo_source_b':'demo_source_a',kind:'sales_order_source',version:1,status:'待核对',customer:source.customer,orderNo,source,contentFingerprint:(second?'d':'e').repeat(64),createdAt:'2026-01-01T00:00:00Z',createdById:'synthetic_admin'};
}
const items=[item(),item(true)];
items[0].source.lines[20].colorFields.push({sourceColumn:'N',sourceLabel:'合成原始保留栏',sourceCell:'N30',value:'raw-prototype-name',status:'adopted',standardZh:'constructor',standardEn:'Original Constructor Label',qualifier:'不得误读对象原型',candidates:[]});
items[1].source.lines[0].colorFields.push({sourceColumn:'N',sourceLabel:'合成同名颜色栏',sourceCell:'N10',value:'raw-reserved-name',status:'adopted',standardZh:'quantity',standardEn:'Original Color Quantity Label',qualifier:'不得误读基础字段命名空间',candidates:[]});
const fieldLabels={orderNo:{zh:'单据编号',en:'Document No.'},customer:{zh:'客户.编码',en:'Customer Code',notes:'合成名称对应，不代表编码已验证'},customerPO:{zh:'客户订单号',en:'Customer PO'},quantity:{zh:'数量',en:'Quantity'},unit:{zh:'单位.名称',en:'Unit Name'},unitPrice:{zh:'单价',en:'Unit Price'},合成部件色:{zh:'合成标准部件颜色',en:'Synthetic Standard Part Color'}};
try{
 let healthy=false;for(let i=0;i<80;i++){try{if((await fetch(origin+'/health')).ok){healthy=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
 assert(healthy,'Temporary server did not start');
 await api('auth/login',{username:'admin',password:initial});await api('auth/password',{currentPassword:initial,password:'Synthetic-Source-Only-2026!'});
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-proxy-server']});
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),split=cookie.indexOf('=');
 await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),url:origin}]);
 const page=await context.newPage(),errors=[],writes=[],downloadRequests=[],downloads=[];let mode='empty',reads=0,downloadMode='ready';
 page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{if(request.url().includes('/api/workspace/')&&request.method()!=='GET')writes.push(request.url());});
 page.on('download',download=>downloads.push(download));
 await page.route('**/api/workspace/sales-order-sources-export?**',route=>{
  const request=route.request(),url=new URL(request.url());assert.equal(request.method(),'GET');assert.deepEqual([...url.searchParams.keys()],['id']);
  const selected=items.find(item=>item.id===url.searchParams.get('id'));assert(selected);downloadRequests.push(selected.id);
  if(downloadMode==='error')return route.fulfill({status:403,json:{error:'合成导出权限已失效'}});
  if(downloadMode==='wrong-type')return route.fulfill({contentType:'text/html',body:'<p>Synthetic login required</p>'});
  const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([['原表行','图纸','数量'],...selected.source.lines.map(line=>[line.sourceRow,line.drawing,line.quantity])]),'Synthetic Export');
  return route.fulfill({headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent('合成-'+selected.orderNo+'.xlsx')}`},body:Buffer.from(XLSX.write(workbook,{type:'array',bookType:'xlsx'}))});
 });
 await page.route('**/api/workspace/sales-order-sources-data',route=>{
  reads++;assert.equal(route.request().method(),'GET');
  if(mode==='error')return route.fulfill({status:403,json:{error:'合成原单范围读取失败'}});
  return route.fulfill({json:{items:mode==='empty'?[]:items,canImport:true,fieldLabels,fieldLabelsVersion:'synthetic-current-v2'}});
 });
 const startupEnrollment=page.waitForResponse(response=>response.url()===origin+'/api/workspace/enroll'&&response.request().method()==='POST');
 await page.goto(origin+'/factory-orders');
 const enrolled=await startupEnrollment;assert.equal(enrolled.status(),200);await enrolled.finished();
 const panel=page.getByTestId('sales-order-sources-panel');
 await panel.getByRole('heading',{name:'当前范围暂无已导入销售原单'}).waitFor();assert.equal(reads,1);
 assert(await panel.getByRole('button',{name:'导出 Excel',exact:true}).isDisabled());
 assert.equal(await panel.getAttribute('id'),'sales-order-sources');
 await page.goto(origin+'/factory-orders#sales-order-sources');
 await page.waitForFunction(()=>{const panel=document.getElementById('sales-order-sources');return panel&&panel.getBoundingClientRect().top>=-1&&panel.getBoundingClientRect().top<120;});
 assert.deepEqual(writes,[origin+'/api/workspace/enroll']);const before=await api('workspace/data');writes.length=0;
 mode='error';await panel.getByRole('button',{name:'刷新已导入销售原单',exact:true}).click();await panel.getByRole('alert').filter({hasText:'合成原单范围读取失败'}).waitFor();
 mode='ready';await panel.getByRole('button',{name:'重新读取销售原单',exact:true}).click();await panel.getByRole('button',{name:'查看销售原单 DEMO-ORDER-A',exact:true}).waitFor();
 assert.equal(await panel.getByRole('button',{name:'查看销售原单 DEMO-ORDER-A',exact:true}).getAttribute('aria-pressed'),'true');
 assert.match(await panel.innerText(),/231 PCS/);assert.match(await panel.innerText(),/10 副/);assert.match(await panel.innerText(),/40 PCS（1 行未填写）/);assert.doesNotMatch(await panel.innerText(),/241 PCS|271 PCS/);
 const tableRows=panel.locator('.sales-source-lines-table > table > tbody > tr[data-source-line-id]');
 const sheet=panel.locator('.sales-source-lines-table'),headers=sheet.locator('.sales-source-column-header');
 assert.equal(await tableRows.count(),21);assert.equal(await panel.getByRole('button',{name:'下一页',exact:true}).count(),0);
 assert.equal(await headers.locator('[data-color-column]').count(),5);assert.equal(await headers.locator('[data-color-column]').filter({hasText:'合成标准部件颜色'}).count(),2);
 assert.match(await headers.locator('[data-color-column="N"]').innerText(),/constructor/);
 assert.match(await headers.locator('[data-field-key="orderNo"]').innerText(),/单据编号/);assert.match(await headers.locator('[data-field-key="customer"]').innerText(),/客户\.编码/);
 assert.match(await headers.locator('[data-field-key="customerPO"]').innerText(),/客户订单号/);assert.match(await headers.locator('[data-field-key="unit"]').innerText(),/单位\.名称/);
 assert.match(await headers.locator('[data-field-key="unitPrice"]').innerText(),/单价/);assert.doesNotMatch(await headers.locator('[data-field-key="sku"]').innerText(),/商品/);
 assert.equal(await panel.locator('.sales-source-warnings').getAttribute('open'),null);assert.match(await panel.innerText(),/synthetic-current-v2/);
 assert.equal(await tableRows.nth(0).locator('[data-color-column="J"]').innerText(),'/');assert.match(await tableRows.nth(0).locator('[data-color-column="J"]').getAttribute('title'),/原文斜杠/);
 assert.equal(await tableRows.nth(0).locator('[data-color-column="K"]').innerText(),'001-RAW');assert.equal(await tableRows.nth(0).locator('[data-color-column="L"]').innerText(),'—');assert.match(await tableRows.nth(0).locator('[data-color-column="L"]').getAttribute('title'),/源表未填写/);
 assert.equal(await tableRows.nth(0).locator('[data-color-column="M"]').innerText(),'甲 / 乙组合原文');assert.equal(await tableRows.nth(0).locator('[data-color-column="N"]').innerText(),'本行无此栏目');
 assert.deepEqual(await tableRows.locator('[data-field-key="sourceAmount"]').allInnerTexts().then(values=>values.slice(0,6)),['12.50','0','—','公式缓存未提供','多个金额栏待核对','原表未提供']);
 assert.equal(await panel.getByTestId('sales-order-source-line-details').count(),0);assert.equal(await sheet.locator('tbody tr').count(),21);
 const beforeScroll=await tableRows.first().locator('.sales-source-freeze-2').boundingBox();
 await panel.getByRole('button',{name:'颜色信息（5 列）',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.sales-source-lines-table').scrollLeft>500);
 const afterScroll=await tableRows.first().locator('.sales-source-freeze-2').boundingBox();assert(Math.abs(beforeScroll.x-afterScroll.x)<1,'Drawing column remains frozen during horizontal scrolling');
 await sheet.evaluate(element=>{element.scrollTop=250;});
 const headerBox=await headers.locator('[data-field-key="drawing"]').boundingBox(),sheetBox=await sheet.boundingBox();assert(Math.abs(headerBox.y-sheetBox.y-35)<3,'Column headers remain below the frozen group header');
 await sheet.evaluate(element=>{element.scrollTop=0;});
 await panel.getByRole('checkbox',{name:'显示原字段标题'}).check();assert.match(await headers.locator('[data-color-column="J"]').innerText(),/原：合成前部原栏/);
 await panel.getByRole('button',{name:'专注表格',exact:true}).click();assert.match(await panel.getAttribute('class'),/sales-source-focus/);assert.equal(await tableRows.count(),21);assert.equal(await panel.getAttribute('role'),'dialog');assert.equal(await panel.getAttribute('aria-modal'),'true');
 await panel.getByRole('button',{name:'退出专注',exact:true}).focus();await page.keyboard.press('Shift+Tab');assert(await panel.evaluate(element=>element.contains(document.activeElement)),'Focus remains in the focused sheet');
 await page.screenshot({path:path.join(dir,'sales-order-sources-focus.png'),fullPage:false});await page.keyboard.press('Escape');assert.doesNotMatch(await panel.getAttribute('class'),/sales-source-focus/);assert(await panel.getByRole('button',{name:'专注表格',exact:true}).evaluate(element=>element===document.activeElement),'Exiting focus mode restores the trigger');
 const search=panel.getByRole('textbox',{name:'搜索销售原单款号色号SKU'});
 await search.fill('SKU-001');assert.equal(await tableRows.count(),1);assert.equal(await tableRows.locator('td').nth(2).innerText(),'001');assert.match(await tableRows.innerText(),/未填写/);assert.match(await tableRows.innerText(),/0\.00/);assert.equal(await headers.locator('[data-color-column]').count(),5);
 const firstDownload=page.waitForEvent('download');await panel.getByRole('button',{name:'导出 Excel',exact:true}).click();const exported=await firstDownload;
 assert.equal(exported.suggestedFilename(),'合成-DEMO-ORDER-A.xlsx');assert.equal(await exported.failure(),null);
 const exportedBook=XLSX.read(await fs.readFile(await exported.path()));assert.equal(XLSX.utils.sheet_to_json(exportedBook.Sheets['Synthetic Export']).length,21,'Search showing one row must still download the selected complete order.');
 await panel.getByRole('status').filter({hasText:'DEMO-ORDER-A 已生成，已发起下载（21 条明细）'}).waitFor();assert.deepEqual(downloadRequests,['demo_source_a']);assert.equal(await tableRows.count(),1);
 downloadMode='error';await panel.getByRole('button',{name:'导出 Excel',exact:true}).click();await panel.getByRole('alert').filter({hasText:'合成导出权限已失效'}).waitFor();assert.equal(downloads.length,1);assert(await panel.getByRole('button',{name:'导出 Excel',exact:true}).isEnabled());
 downloadMode='wrong-type';await panel.getByRole('button',{name:'导出 Excel',exact:true}).click();await panel.getByRole('alert').filter({hasText:'服务器未返回 Excel 文件'}).waitFor();assert.equal(downloads.length,1);downloadMode='ready';
 await panel.getByRole('button',{name:'查看原单第 10 行来源',exact:true}).click();
 const detail=panel.getByTestId('sales-order-source-line-details');await detail.waitFor();
 assert.equal(await detail.locator('tr[data-mapping-status="adopted"]').count(),2);assert.equal(await detail.locator('tr[data-mapping-status="pending"]').count(),1);assert.equal(await detail.locator('tr[data-mapping-status="composite"]').count(),1);
 assert.match(await detail.innerText(),/空白（源表未填写）/);assert.match(await detail.innerText(),/原文斜杠，保持原样/);assert.match(await detail.innerText(),/001-RAW/);assert.match(await detail.innerText(),/前部位置独立保留/);assert.match(await detail.innerText(),/后部位置独立保留/);assert.match(await detail.innerText(),/甲 \/ 乙组合原文/);
 await detail.locator('summary').click();assert.match(await detail.innerText(),/取值锚点：Z9/);assert.match(await detail.innerText(),/来源范围：Z9:Z30/);assert.match(await detail.innerText(),/原公式：=B9\*2/);assert.match(await detail.innerText(),/缓存值：12.50/);assert.match(await detail.innerText(),/原表隐藏栏目/);
 assert.equal(await sheet.locator('tbody tr').count(),1,'Source details must never add expandable rows to the order sheet');
 await panel.getByRole('button',{name:'关闭原单来源核对',exact:true}).click();assert.equal(await panel.getByTestId('sales-order-source-line-details').count(),0);
 await search.fill('001-RAW');assert.equal(await tableRows.count(),21);await search.fill('');
 await panel.locator('.sales-source-lines-table').evaluate(element=>{element.scrollLeft=0;});
 await panel.screenshot({path:path.join(dir,'sales-order-sources-desktop.png')});
 await panel.getByRole('button',{name:'查看销售原单 DEMO-ORDER-B',exact:true}).click();assert.equal(await search.inputValue(),'');assert.equal(await panel.getByTestId('sales-order-source-line-details').count(),0);assert.equal(await tableRows.count(),1);assert.match(await tableRows.innerText(),/DEMO-OTHER-001/);assert.doesNotMatch(await tableRows.innerText(),/DEMO-DRAWING/);assert.equal(await tableRows.locator('[data-field-key="quantity"]').innerText(),'10');assert.equal(await tableRows.locator('[data-field-key="unit"]').innerText(),'副');
 assert.equal(await panel.getByRole('alert').filter({hasText:'服务器未返回 Excel 文件'}).count(),0,'Download error belongs only to the order that failed.');
 const secondDownload=page.waitForEvent('download');await panel.getByRole('button',{name:'导出 Excel',exact:true}).click();const exportedB=await secondDownload;
 assert.equal(exportedB.suggestedFilename(),'合成-DEMO-ORDER-B.xlsx');assert.equal(await exportedB.failure(),null);assert.equal(XLSX.utils.sheet_to_json(XLSX.read(await fs.readFile(await exportedB.path())).Sheets['Synthetic Export']).length,1);assert.deepEqual(downloadRequests,['demo_source_a','demo_source_a','demo_source_a','demo_source_b']);
 assert.equal(await headers.locator('[data-color-column="N"] > strong').innerText(),'quantity','A color named like a basic field must retain its original title');
 assert.equal(await tableRows.locator('.sales-source-delivery').innerText(),'有效交期待确认');
 await page.setViewportSize({width:390,height:844});await panel.scrollIntoViewIfNeeded();
 const box=await panel.boundingBox();assert(box&&box.x>=0&&box.width<=390&&box.x+box.width<=391,'Source panel must fit narrow viewport');
 assert(await panel.locator('.sales-source-lines-table').evaluate(element=>element.scrollWidth>element.clientWidth),'Source line table must scroll inside panel');
 await panel.locator('.sales-source-lines-table').evaluate(element=>{element.scrollLeft=0;});
 await page.screenshot({path:path.join(dir,'sales-order-sources-mobile.png'),fullPage:true});
 assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);assert(reads>=3);
 assert.deepEqual(await api('workspace/data').then(({asOf,...rest})=>rest),(({asOf,...rest})=>rest)(before));
 console.log('PASS 全部行连续表格、颜色平铺不合并、双语最新字段名、冻结列/表头、专注/Esc、金额缓存/零/空白/歧义、搜索、前导零、颜色候选/组合、来源侧栏、整单Excel下载不受搜索影响、下载权限/错误类型拒绝和换单重试、切换无残留、手机布局、空/错误/重试、零业务写入');
 console.log('Synthetic screenshots: '+dir);
}finally{await browser?.close();server.kill();}
