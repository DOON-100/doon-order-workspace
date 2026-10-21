// UI acceptance against a temporary native server; all query results are synthetic.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.DOON_PLAYWRIGHT_MODULE?pathToFileURL(process.env.DOON_PLAYWRIGHT_MODULE).href:'playwright');
const dist=path.resolve(process.env.DOON_BUILD_DIR||'test-output/kingdee-readonly-build');
const dir=await fs.mkdtemp(path.resolve('test-output/kingdee-browser-')),origin='http://127.0.0.1:18836';
const env={...process.env,DOON_DATA_DIR:dir,DOON_HOST:'127.0.0.1',DOON_PORT:'18836',DOON_NO_AUTO_BACKUP:'1',DOON_KINGDEE_READONLY_ENABLED:'0'};
execFileSync(process.execPath,[path.join(dist,'manage.mjs'),'init'],{env,stdio:'pipe'});
const initial=(await fs.readFile(path.join(dir,'管理员首次登录.txt'),'utf8')).match(/初始密码：([^\n]+)/)[1];
const server=spawn(process.execPath,[path.join(dist,'server.mjs')],{env,stdio:'ignore',windowsHide:true});
let browser,cookie='';
async function api(route,body){const res=await fetch(origin+'/api/'+route,{method:body===undefined?'GET':'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];assert.equal(res.status,200);return res.json();}
try{
 for(let i=0;i<80;i++){try{if((await fetch(origin+'/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 await api('auth/login',{username:'admin',password:initial});await api('auth/password',{currentPassword:initial,password:'Synthetic-Readonly-2026!'});
 const before=await api('workspace/data');
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-proxy-server']});
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 const split=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),url:origin}]);
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/supplier-pending');
 await page.getByRole('button',{name:'更新金蝶总表',exact:true}).waitFor();
 await page.getByRole('button',{name:'同步金蝶总表',exact:true}).click();
 await page.getByText('尚未配置金蝶只读连接',{exact:false}).waitFor();
 assert(await page.getByRole('button',{name:'只读查询金蝶',exact:true}).isDisabled());
 await page.getByRole('button',{name:'关闭',exact:true}).first().click();
 let mode='ok',queries=0;
 await page.route('**/api/workspace/kingdee-readonly-status',route=>route.fulfill({json:{configured:true,readOnly:true,message:'合成连接，仅用于界面验收'}}));
 await page.route('**/api/workspace/kingdee-readonly-query?*',async route=>{
  queries++;assert.equal(route.request().method(),'GET');
  if(mode==='failure')return route.fulfill({status:502,json:{error:'合成网络中断'}});
  const p=Number(new URL(route.request().url()).searchParams.get('page'));
  await route.fulfill({json:{readOnly:true,page:p,pages:2,count:7,orderIds:['SYN-'+p],rows:[{id:'SYN-'+p,uncertain:false,values:['SYN-PO-'+p,'2026-10-21','合成供应商','合成采购员','未关闭','MAT-SYN','合成镜架','合成规格','副','20','2026-10-28','部分入库','未关闭','仅用于界面验收','SYN-'+p,'LINE-'+p]}],unknown:0,excludedComplete:0,startedAt:'2026-10-21T06:00:00Z',finishedAt:'2026-10-21T06:00:02Z'}});
 });
 await page.getByRole('button',{name:'同步金蝶总表',exact:true}).click();
 await page.getByText('合成连接，仅用于界面验收').waitFor();
 await page.getByRole('button',{name:'只读查询金蝶',exact:true}).click();await page.getByRole('cell',{name:'SYN-PO-1',exact:true}).waitFor();
 const dialog=page.getByRole('dialog');assert.equal(await dialog.getByRole('button',{name:/确认|保存|写入/}).count(),0);
 await page.screenshot({path:path.join(dir,'kingdee-readonly-desktop.png'),fullPage:true});
 await dialog.getByRole('button',{name:'下一页',exact:true}).click();await page.getByRole('cell',{name:'SYN-PO-2',exact:true}).waitFor();assert.equal(queries,2);
 mode='failure';await dialog.getByRole('button',{name:'上一页',exact:true}).click();await page.getByRole('alert').filter({hasText:'合成网络中断'}).waitFor();assert.equal(await page.getByRole('cell',{name:'SYN-PO-2',exact:true}).count(),0);
 await dialog.getByRole('button',{name:'关闭',exact:true}).first().click();
 mode='ok';await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'同步金蝶总表',exact:true}).click();await page.getByText('合成连接，仅用于界面验收').waitFor();
 await page.getByRole('button',{name:'只读查询金蝶',exact:true}).click();await page.getByRole('cell',{name:'SYN-PO-1',exact:true}).waitFor();
 await dialog.getByRole('button',{name:'下一页',exact:true}).scrollIntoViewIfNeeded();
 const box=await dialog.boundingBox();assert(box&&box.width<=390&&box.height<=844);
 await page.screenshot({path:path.join(dir,'kingdee-readonly-mobile.png')});
 assert.deepEqual(await api('workspace/data').then(({asOf,...rest})=>rest),(({asOf,...rest})=>rest)(before));
 assert.deepEqual(errors,[]);console.log('PASS 只读入口、未配置提示、分页、失败清除旧结果、手机布局及业务记录保持不变');console.log('Synthetic screenshots: '+dir);
}finally{await browser?.close();server.kill();}
