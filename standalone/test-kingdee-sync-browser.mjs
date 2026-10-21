// UI acceptance against a temporary native server; all query results are synthetic.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.DOON_PLAYWRIGHT_MODULE?pathToFileURL(process.env.DOON_PLAYWRIGHT_MODULE).href:'playwright');
const dist=path.resolve(process.env.DOON_BUILD_DIR||'test-output/kingdee-sync-build');
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
 await context.addInitScript(()=>Object.defineProperty(globalThis.crypto,'randomUUID',{value:undefined}));
 const split=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),url:origin}]);
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const preparation=page.waitForResponse(response=>response.url().endsWith('/kingdee-sync-ready'));
 await page.goto(origin+'/supplier-pending');await preparation;
 assert.deepEqual(await api('workspace/data').then(({asOf,...rest})=>rest),(({asOf,...rest})=>rest)(before));
 await page.getByRole('button',{name:'更新金蝶总表',exact:true}).waitFor();
 await page.clock.install();
 const syncButton=page.getByRole('button',{name:'同步金蝶总表',exact:true}),toast=page.locator('.kingdee-sync-toast');
 const bounds=()=>syncButton.boundingBox(),baseline=await bounds();
 async function stationary(expected=baseline){const actual=await bounds();for(const key of ['x','y','width','height'])assert(Math.abs(actual[key]-expected[key])<.5,`Button ${key} changed`);assert.equal(await page.locator('.kingdee-sync-action p').count(),0);}
 async function topToast(){assert.equal(await toast.count(),1);const box=await toast.boundingBox(),view=page.viewportSize();assert(box.y>=0&&box.y<=24&&box.x>=0&&box.x+box.width<=view.width);assert.equal(await toast.evaluate(node=>node.parentElement===document.body),true);}
 async function expires(){await page.clock.fastForward(4000);assert(await toast.isVisible());await page.clock.fastForward(1100);assert.equal(await toast.count(),0);}
 await page.getByRole('button',{name:'同步金蝶总表',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'金蝶连接尚未配置'}).waitFor();
 await stationary();await topToast();await expires();assert.equal(await page.getByRole('dialog').count(),0);
 let mode='ok',runs=0,checks=0,release,keys=[];
 const receipt={inserted:1,skipped:29,held:0,selected:30,excludedComplete:0};
 await page.route('**/api/workspace/kingdee-sync-run',async route=>{
  runs++;assert.equal(route.request().method(),'POST');const body=route.request().postDataJSON();assert.deepEqual(Object.keys(body),['requestId']);keys.push(body.requestId);
  if(mode==='slow')await new Promise(resolve=>{release=resolve;});
  if(mode==='lost'||mode==='failure')return route.abort('failed');
  return route.fulfill({json:receipt});
 });
 await page.route('**/api/workspace/kingdee-sync-result?*',async route=>{checks++;return route.fulfill({json:mode==='lost'?{status:'complete',receipt}:{status:'not-completed'}});});
 mode='slow';await page.getByRole('button',{name:'同步金蝶总表',exact:true}).click();
 assert(await syncButton.isDisabled());assert.equal(await syncButton.getAttribute('aria-busy'),'true');await stationary();await topToast();
 for(let i=0;i<50&&!release;i++)await new Promise(r=>setTimeout(r,20));assert(release);release();
 await page.getByRole('status').filter({hasText:'本次新增 1 条，已有跳过 29 条，待核查 0 条'}).waitFor();assert.equal(runs,1);assert.equal(await page.getByRole('dialog').count(),0);assert.match(await page.getByRole('status').innerText(),/仅同步最新 30 条未上货明细，历史记录保留/);assert.doesNotMatch(await page.getByRole('status').innerText(),/下一页|继续|1263/);
 await stationary();await topToast();await page.screenshot({path:path.join(dir,'kingdee-sync-desktop.png'),fullPage:true});await expires();await stationary();
 mode='lost';await page.getByRole('button',{name:'同步金蝶总表',exact:true}).click();
 await page.getByRole('status').filter({hasText:'本次新增 1 条'}).waitFor();assert.equal(runs,2);assert(checks>=1);
 mode='failure';await page.getByRole('button',{name:'同步金蝶总表',exact:true}).click();await page.getByRole('alert').filter({hasText:'先核查本批结果'}).waitFor();assert.equal(runs,3);await topToast();await expires();await stationary();
 mode='ok';await page.getByRole('button',{name:'同步金蝶总表',exact:true}).click();await page.getByRole('status').filter({hasText:'本次新增 1 条'}).waitFor();assert.equal(runs,4);assert.equal(keys[2],keys[3]);assert.notEqual(keys[0],keys[1]);
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'同步金蝶总表',exact:true}).scrollIntoViewIfNeeded();
 const box=await page.locator('.kingdee-sync-action').boundingBox();assert(box&&box.width<=390&&box.x>=0&&box.x+box.width<=390);
 const mobileBaseline=await bounds();await syncButton.click();await toast.filter({hasText:'本次新增 1 条'}).waitFor();await stationary(mobileBaseline);await topToast();
 await page.screenshot({path:path.join(dir,'kingdee-sync-mobile.png')});await expires();await stationary(mobileBaseline);
 assert.deepEqual(await api('workspace/data').then(({asOf,...rest})=>rest),(({asOf,...rest})=>rest)(before));
 assert.deepEqual(errors,[]);console.log('PASS 一键无预览、桌面手机按钮位置尺寸不变、顶部 Toast 5 秒消失、运行中禁用、断线回执及提示消失后仍沿用批次重试');console.log('Synthetic screenshots: '+dir);
}finally{await browser?.close();server.kill();}
