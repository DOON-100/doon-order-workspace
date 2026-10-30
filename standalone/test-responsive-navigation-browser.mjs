import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

// 测试环境，不含正式业务数据；独立目录、端口和合成账号。
const dist=path.resolve(process.env.DOON_BUILD_DIR||'test-output/navigation-build');
const dir=await fs.mkdtemp(path.resolve('test-output/navigation-browser-'));
const origin='http://127.0.0.1:18941';
const env={...process.env,DOON_DATA_DIR:dir,DOON_HOST:'127.0.0.1',DOON_PORT:'18941',DOON_NO_AUTO_BACKUP:'1',DOON_SYNTHETIC_ONLY:'1',DOON_STUDIO_SCHEDULES_ENABLED:'0',DOON_IE_MAIL_ENABLED:'0',DOON_SERVER_MODE:'internal',DOON_TLS_CERT:'',DOON_TLS_KEY:''};
execFileSync(process.execPath,[path.join(dist,'manage.mjs'),'init'],{env,stdio:'pipe',windowsHide:true});
const password=(await fs.readFile(path.join(dir,'管理员首次登录.txt'),'utf8')).match(/初始密码：([^\n]+)/)[1];
const server=spawn(process.execPath,[path.join(dist,'server.mjs')],{env,stdio:'pipe',windowsHide:true});
const done=new Promise(resolve=>server.once('exit',resolve));let browser,cookie='';
async function api(route,body){const res=await fetch(origin+'/api/'+route,{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(body)});if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];assert.equal(res.status,200);}
try{
 for(let i=0;i<80;i++){try{if((await fetch(origin+'/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 await api('auth/login',{username:'admin',password});await api('auth/password',{currentPassword:password,password:'Synthetic-Navigation-Only-2026!'});
 const pw=await import(process.env.DOON_PLAYWRIGHT_MODULE?pathToFileURL(process.env.DOON_PLAYWRIGHT_MODULE).href:'playwright');
 browser=await pw.chromium.launch({headless:true,...(process.env.DOON_CHROMIUM_PATH?{executablePath:process.env.DOON_CHROMIUM_PATH}:{channel:'chrome'})});
 const context=await browser.newContext({viewport:{width:1440,height:900}});const split=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),url:origin,httpOnly:true,sameSite:'Strict'}]);
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(origin+'/customer-projects');const nav=page.locator('#workspace-navigation'),toggle=page.locator('#workspace-navigation-toggle');await page.getByRole('navigation',{name:'部门与工序导航'}).waitFor();
 assert.equal(await toggle.getAttribute('aria-expanded'),'true');assert(await nav.isVisible());
 await toggle.click();assert.equal(await toggle.getAttribute('aria-expanded'),'false');assert.equal(await nav.getAttribute('inert'),'');
 assert.equal(await page.locator('.main').evaluate(n=>Math.round(n.getBoundingClientRect().left)),0);
 await page.reload();await page.getByRole('button',{name:'展开导航栏'}).waitFor();assert.equal(await toggle.getAttribute('aria-expanded'),'false');
 await toggle.click();assert.equal(await toggle.getAttribute('aria-expanded'),'true');
 for(const width of [1920,1024]){await page.setViewportSize({width,height:900});assert(await nav.isVisible());assert(Math.round((await nav.boundingBox()).width)===228);assert.equal(await toggle.getAttribute('aria-expanded'),'true');}
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'展开导航栏'}).waitFor();await nav.waitFor({state:'hidden'});
 await toggle.click();await nav.waitFor({state:'visible'});assert.equal(await toggle.getAttribute('aria-expanded'),'true');await page.keyboard.press('Escape');assert.equal(await toggle.getAttribute('aria-expanded'),'false');assert(await toggle.evaluate(n=>document.activeElement===n));
 await toggle.click();await page.getByRole('button',{name:'关闭导航遮罩'}).click();assert.equal(await toggle.getAttribute('aria-expanded'),'false');
 await toggle.click();const link=nav.locator('[data-nav-view]').first();await link.click();assert.equal(await toggle.getAttribute('aria-expanded'),'false');
 await page.setViewportSize({width:1024,height:900});await page.getByRole('button',{name:'收起导航栏'}).waitFor();assert(await nav.isVisible(),'desktop preference survives mobile drawer');
 assert.deepEqual(errors,[]);console.log('PASS responsive navigation: persistent desktop toggle, fixed sidebar, mobile drawer, dismissal, focus and navigation');
}finally{await browser?.close();server.kill('SIGTERM');await done;}
