// Isolated browser acceptance. All field names and customer profiles are synthetic.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.DOON_PLAYWRIGHT_MODULE?pathToFileURL(process.env.DOON_PLAYWRIGHT_MODULE).href:'playwright');
const dist=path.resolve(process.env.DOON_BUILD_DIR||'test-output/sales-color-fields-build');
await fs.mkdir(path.resolve('test-output'),{recursive:true});
const dir=await fs.mkdtemp(path.resolve('test-output/sales-color-fields-browser-')),origin='http://127.0.0.1:18843';
const env={...process.env,DOON_DATA_DIR:dir,DOON_HOST:'127.0.0.1',DOON_PORT:'18843',DOON_NO_AUTO_BACKUP:'1',DOON_KINGDEE_READONLY_ENABLED:'0'};
execFileSync(process.execPath,[path.join(dist,'manage.mjs'),'init'],{env,stdio:'pipe'});
const initial=(await fs.readFile(path.join(dir,'管理员首次登录.txt'),'utf8')).match(/初始密码：([^\n]+)/)[1];
const server=spawn(process.execPath,[path.join(dist,'server.mjs')],{env,stdio:'ignore',windowsHide:true});
let browser,cookie='';
async function api(route,body){
 const result=await fetch(origin+'/api/'+route,{method:body===undefined?'GET':'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 if(result.headers.get('set-cookie'))cookie=result.headers.get('set-cookie').split(';')[0];
 assert.equal(result.status,200);return result.json();
}
const fields=[
 {id:'demo_frame',labelZh:'测试框体色',labelEn:'Demo Frame Color',sourceRef:'Demo!B2:C2'},
 {id:'demo_screw',labelZh:'测试螺钉色',labelEn:'Demo Screw Color',sourceRef:'Demo!B3:C3'},
 ...Array.from({length:20},(_,i)=>({id:'demo_'+i,labelZh:`测试字段${i+1}`,labelEn:`Demo Field ${i+1}`,sourceRef:`Demo!B${i+4}:C${i+4}`})),
];
const slot=(id,sourceColumn,sourceLabel,fieldId,status,qualifier,candidateFieldIds=[])=>({id,sourceColumn,sourceLabel,fieldId,status,qualifier,candidateFieldIds});
const catalog={schemaVersion:1,title:'合成字段字典',dictionaryVersion:'demo-v1',sourceSha256:'a'.repeat(64),fields,profiles:[
 {id:'demo_profile_a',name:'合成模板甲',customer:'DEMO-A',productType:'Demo Type A',sourceSheet:'Demo sheet A',slots:[
  slot('demo_alias','A','demo alias\n测试框体别称','demo_frame','adopted','前部位置'),
  slot('demo_repeat','B','测试另一部位','demo_frame','adopted','后部位置'),
  slot('demo_pending','C','测试待定栏目',null,'pending','需区分两类部件',['demo_frame','demo_screw']),
  slot('demo_composite','D','测试框体加螺钉',null,'composite','原组合栏完整保留',['demo_frame','demo_screw']),
 ]},
 {id:'demo_profile_b',name:'合成模板乙',customer:'DEMO-B',productType:'Demo Type B',sourceSheet:'Demo sheet B',slots:[slot('demo_b','A','测试乙模板栏','demo_screw','adopted','乙模板独立位置')]},
]};
try{
 let healthy=false;
 for(let i=0;i<80;i++){try{if((await fetch(origin+'/health')).ok){healthy=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
 assert(healthy,'Temporary server did not start');
 await api('auth/login',{username:'admin',password:initial});await api('auth/password',{currentPassword:initial,password:'Synthetic-Color-Fields-2026!'});
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-proxy-server']});
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),split=cookie.indexOf('=');
 await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),url:origin}]);
 const page=await context.newPage(),errors=[],writes=[];let mode='empty',reads=0;
 page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{if(request.url().includes('/api/workspace/')&&request.method()!=='GET')writes.push(request.url());});
 await page.route('**/api/workspace/sales-color-fields-data',route=>{
  reads++;assert.equal(route.request().method(),'GET');
  if(mode==='error')return route.fulfill({status:403,json:{error:'合成范围读取失败'}});
  return route.fulfill({json:{catalog:mode==='empty'?null:catalog,version:mode==='empty'?0:1,canConfigure:true}});
 });
 const startupEnrollment=page.waitForResponse(response=>response.url()===origin+'/api/workspace/enroll'&&response.request().method()==='POST');
 await page.goto(origin+'/factory-orders');
 const enrolled=await startupEnrollment;assert.equal(enrolled.status(),200);await enrolled.finished();
 const panel=page.getByTestId('sales-color-fields-panel'),toggle=panel.locator('.sales-color-fields-toggle');
 await toggle.waitFor();assert.equal(await toggle.getAttribute('aria-expanded'),'false');assert.equal(reads,0);
 // The existing workspace enrolls once on startup. Verify that exact write and
 // establish the read-only baseline only after enrollment and initial rendering.
 assert.deepEqual(writes,[origin+'/api/workspace/enroll']);
 const before=await api('workspace/data');
 writes.length=0;
 await toggle.click();await panel.getByRole('heading',{name:'尚未配置销售颜色字段库'}).waitFor();
 mode='error';await panel.getByRole('button',{name:'重新读取字段库',exact:true}).click();await panel.getByRole('alert').filter({hasText:'合成范围读取失败'}).waitFor();
 mode='ready';await panel.getByRole('button',{name:'重新读取字段库',exact:true}).click();await panel.getByText('共 22 个字段',{exact:false}).waitFor();
 assert.equal(await panel.locator('tbody tr').count(),20);await panel.getByRole('button',{name:'下一页',exact:true}).click();assert.equal(await panel.locator('tbody tr').count(),2);
 const search=panel.getByRole('textbox',{name:'搜索销售颜色字段'}),profiles=panel.getByRole('combobox',{name:'销售颜色字段客户产品模板'});
 await search.fill('Demo Frme Color');await panel.getByRole('status').filter({hasText:'近似名称候选'}).waitFor();assert.equal(await panel.locator('tbody tr').count(),1);assert.match(await panel.locator('tbody').innerText(),/Demo Frame Color/);
 await search.fill('');await profiles.selectOption('demo_profile_a');await search.fill('测试框体别称');await panel.getByRole('status').filter({hasText:'名称已对应：测试框体色'}).waitFor();
 await search.fill('');assert.equal(await panel.locator('tr[data-status="adopted"]').count(),2);assert.equal(await panel.locator('tr[data-status="pending"]').count(),1);assert.equal(await panel.locator('tr[data-status="composite"]').count(),1);
 assert.match(await panel.locator('tbody').innerText(),/前部位置/);assert.match(await panel.locator('tbody').innerText(),/后部位置/);
 await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__demoCopied=text;}}}));
 await panel.getByRole('button',{name:'复制中英标题 测试框体色',exact:true}).first().click();await panel.getByRole('status').filter({hasText:'标题已复制。'}).waitFor();assert.equal(await page.evaluate(()=>window.__demoCopied),'测试框体色 / Demo Frame Color');
 await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined}));
 await panel.getByRole('button',{name:'复制英文标题 Demo Frame Color',exact:true}).first().click();await panel.getByRole('textbox',{name:'手动复制销售颜色字段标题'}).waitFor();assert.equal(await panel.getByRole('textbox',{name:'手动复制销售颜色字段标题'}).inputValue(),'Demo Frame Color');assert.equal(await panel.getByText('标题已复制。',{exact:true}).count(),0);
 await profiles.selectOption('demo_profile_b');assert.equal(await panel.locator('tbody tr').count(),1);assert.doesNotMatch(await panel.locator('tbody').innerText(),/前部位置/);assert.equal(await panel.getByRole('textbox',{name:'手动复制销售颜色字段标题'}).count(),0);
 await profiles.selectOption('demo_profile_a');await page.screenshot({path:path.join(dir,'sales-color-fields-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});await panel.scrollIntoViewIfNeeded();
 const box=await panel.boundingBox();assert(box&&box.x>=0&&box.width<=390&&box.x+box.width<=391,'Panel must fit a narrow viewport');
 const scrollArea=panel.locator('.sales-color-fields-table');assert(await scrollArea.evaluate(element=>element.scrollWidth>element.clientWidth),'Mapping table must scroll inside its own area');
 await page.screenshot({path:path.join(dir,'sales-color-fields-mobile.png'),fullPage:true});
 await toggle.click();assert.equal(await panel.locator('#sales-color-fields-content').count(),0);
 assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
 assert.deepEqual(await api('workspace/data').then(({asOf,...rest})=>rest),(({asOf,...rest})=>rest)(before));
 console.log('PASS 颜色字段库折叠、空配置、读取失败重试、分页、近似与别名搜索、候选/组合、模板隔离、复制成功/回退、手机布局及只读数据保全');
 console.log('Synthetic screenshots: '+dir);
}finally{await browser?.close();server.kill();}
