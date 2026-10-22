// Isolated UI acceptance: temporary database, generated credentials, synthetic sources only.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
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
   {column:'Z',label:'合成金额原栏',cell:`Z${sourceRow}`,value:'12.50',sourceAnchor:'Z9',sourceRange:'Z9:Z30',formula:'=B9*2',cachedValue:'12.50',hidden:true},
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
try{
 let healthy=false;for(let i=0;i<80;i++){try{if((await fetch(origin+'/health')).ok){healthy=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
 assert(healthy,'Temporary server did not start');
 await api('auth/login',{username:'admin',password:initial});await api('auth/password',{currentPassword:initial,password:'Synthetic-Source-Only-2026!'});
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-proxy-server']});
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),split=cookie.indexOf('=');
 await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),url:origin}]);
 const page=await context.newPage(),errors=[],writes=[];let mode='empty',reads=0;
 page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{if(request.url().includes('/api/workspace/')&&request.method()!=='GET')writes.push(request.url());});
 await page.route('**/api/workspace/sales-order-sources-data',route=>{
  reads++;assert.equal(route.request().method(),'GET');
  if(mode==='error')return route.fulfill({status:403,json:{error:'合成原单范围读取失败'}});
  return route.fulfill({json:{items:mode==='empty'?[]:items,canImport:true}});
 });
 const startupEnrollment=page.waitForResponse(response=>response.url()===origin+'/api/workspace/enroll'&&response.request().method()==='POST');
 await page.goto(origin+'/factory-orders');
 const enrolled=await startupEnrollment;assert.equal(enrolled.status(),200);await enrolled.finished();
 const panel=page.getByTestId('sales-order-sources-panel');
 await panel.getByRole('heading',{name:'当前范围暂无已导入销售原单'}).waitFor();assert.equal(reads,1);
 assert.equal(await panel.getAttribute('id'),'sales-order-sources');
 await page.goto(origin+'/factory-orders#sales-order-sources');
 await page.waitForFunction(()=>{const panel=document.getElementById('sales-order-sources');return panel&&panel.getBoundingClientRect().top>=-1&&panel.getBoundingClientRect().top<120;});
 assert.deepEqual(writes,[origin+'/api/workspace/enroll']);const before=await api('workspace/data');writes.length=0;
 mode='error';await panel.getByRole('button',{name:'刷新已导入销售原单',exact:true}).click();await panel.getByRole('alert').filter({hasText:'合成原单范围读取失败'}).waitFor();
 mode='ready';await panel.getByRole('button',{name:'重新读取销售原单',exact:true}).click();await panel.getByRole('button',{name:'查看销售原单 DEMO-ORDER-A',exact:true}).waitFor();
 assert.equal(await panel.getByRole('button',{name:'查看销售原单 DEMO-ORDER-A',exact:true}).getAttribute('aria-pressed'),'true');
 assert.match(await panel.innerText(),/231 PCS/);assert.match(await panel.innerText(),/10 副/);assert.match(await panel.innerText(),/40 PCS（1 行未填写）/);assert.doesNotMatch(await panel.innerText(),/241 PCS|271 PCS/);
 const tableRows=panel.locator('.sales-source-lines-table > table > tbody > tr[data-source-line-id]');
 assert.equal(await tableRows.count(),20);await panel.getByRole('button',{name:'下一页',exact:true}).click();assert.equal(await tableRows.count(),1);assert.match(await tableRows.innerText(),/DEMO-DRAWING-021/);
 const search=panel.getByRole('textbox',{name:'搜索销售原单款号色号SKU'});
 await search.fill('SKU-001');assert.equal(await tableRows.count(),1);assert.equal(await tableRows.locator('td').nth(4).innerText(),'001');assert.match(await tableRows.innerText(),/未填写/);assert.match(await tableRows.innerText(),/0\.00/);
 await panel.getByRole('button',{name:'查看原单第 10 行颜色与来源',exact:true}).click();
 const detail=panel.getByTestId('sales-order-source-line-details');await detail.waitFor();
 assert.equal(await detail.locator('tr[data-mapping-status="adopted"]').count(),2);assert.equal(await detail.locator('tr[data-mapping-status="pending"]').count(),1);assert.equal(await detail.locator('tr[data-mapping-status="composite"]').count(),1);
 assert.match(await detail.innerText(),/空白（源表未填写）/);assert.match(await detail.innerText(),/原文斜杠，保持原样/);assert.match(await detail.innerText(),/001-RAW/);assert.match(await detail.innerText(),/前部位置独立保留/);assert.match(await detail.innerText(),/后部位置独立保留/);assert.match(await detail.innerText(),/甲 \/ 乙组合原文/);
 await detail.locator('summary').click();assert.match(await detail.innerText(),/取值锚点：Z9/);assert.match(await detail.innerText(),/来源范围：Z9:Z30/);assert.match(await detail.innerText(),/原公式：=B9\*2/);assert.match(await detail.innerText(),/缓存值：12.50/);assert.match(await detail.innerText(),/原表隐藏栏目/);
 await panel.locator('.sales-source-lines-table').evaluate(element=>{element.scrollLeft=0;});
 await page.screenshot({path:path.join(dir,'sales-order-sources-desktop.png'),fullPage:true});
 await panel.getByRole('button',{name:'查看销售原单 DEMO-ORDER-B',exact:true}).click();assert.equal(await search.inputValue(),'');assert.equal(await panel.getByTestId('sales-order-source-line-details').count(),0);assert.equal(await tableRows.count(),1);assert.match(await tableRows.innerText(),/DEMO-OTHER-001/);assert.doesNotMatch(await tableRows.innerText(),/DEMO-DRAWING/);assert.match(await tableRows.innerText(),/10 副/);
 await page.setViewportSize({width:390,height:844});await panel.scrollIntoViewIfNeeded();
 const box=await panel.boundingBox();assert(box&&box.x>=0&&box.width<=390&&box.x+box.width<=391,'Source panel must fit narrow viewport');
 assert(await panel.locator('.sales-source-lines-table').evaluate(element=>element.scrollWidth>element.clientWidth),'Source line table must scroll inside panel');
 await panel.locator('.sales-source-lines-table').evaluate(element=>{element.scrollLeft=0;});
 await page.screenshot({path:path.join(dir,'sales-order-sources-mobile.png'),fullPage:true});
 assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);assert(reads>=3);
 assert.deepEqual(await api('workspace/data').then(({asOf,...rest})=>rest),(({asOf,...rest})=>rest)(before));
 console.log('PASS 原单默认展开、空/错误/重试、按原单位数量/样办、分页搜索、前导零、颜色/候选/组合、空白与斜杠、来源合并/公式、切换无残留、手机布局、零业务写入');
 console.log('Synthetic screenshots: '+dir);
}finally{await browser?.close();server.kill();}
