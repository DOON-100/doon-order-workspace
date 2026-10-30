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
 const railWidth=async()=>Math.round((await nav.boundingBox()).width),mainLeft=async()=>page.locator('.main').evaluate(n=>Math.round(n.getBoundingClientRect().left));
 // The rail animates its width, so wait for the transition to settle before measuring.
 const settle=async(width,left)=>{await page.waitForFunction(target=>{const rail=document.querySelector('#workspace-navigation'),main=document.querySelector('.main');return Math.round(rail?.getBoundingClientRect().width||0)===target.w&&Math.round(main?.getBoundingClientRect().left||0)===target.l;},{w:width,l:left},{timeout:5000});};
 // Desktop expanded: the full 228px rail sits beside the content.
 assert.equal(await toggle.getAttribute('aria-expanded'),'true');await nav.waitFor({state:'visible'});
 await settle(228,228);assert.equal(await railWidth(),228);assert.equal(await mainLeft(),228);
 assert.equal(await nav.locator('.department-navigation-studio').isVisible(),false,'the expanded rail keeps the brand-logo entry instead of the extra launcher');
 // The header trigger folds the rail down to a 64px icon strip; labels go, icons stay.
 await toggle.click();assert.equal(await toggle.getAttribute('aria-expanded'),'false');await nav.waitFor({state:'visible'});
 await settle(64,64);assert.equal(await railWidth(),64);assert.equal(await mainLeft(),64);
 assert.equal(await nav.locator('.department-navigation-toggle>span').first().isVisible(),false,'labels are hidden in the icon strip');
 assert.equal(await nav.locator('.department-navigation-toggle>svg').first().isVisible(),true,'department icons stay reachable');
 // The brand logo is hidden in the icon strip, so Agent Studio gets its own launcher there,
 // above the department icons. It opens in a new tab and stays hidden in the expanded rail.
 const studio=nav.locator('.department-navigation-studio');
 assert.equal(await studio.count(),1,'the collapsed rail carries an Agent Studio launcher');
 assert.equal(await studio.isVisible(),true,'the Agent Studio launcher is visible in the icon strip');
 assert.equal(await studio.getAttribute('href'),'/studio/','the launcher points at the Agent Studio deployment');
 assert.equal(await studio.getAttribute('target'),'_blank','the launcher opens Agent Studio in a new tab');
 const studioBox=await studio.boundingBox(),firstDepartmentBox=await nav.locator('.department-navigation-toggle').first().boundingBox();
 assert.ok(studioBox.y+studioBox.height<=firstDepartmentBox.y,'the Agent Studio launcher sits above the department icons');
 // The icon strip reads better with larger icons and looser spacing.
 const iconSize=await nav.locator('.department-navigation-toggle>svg').first().evaluate(el=>Math.round(el.getBoundingClientRect().width));
 assert.ok(iconSize>=22,'the department icons are enlarged (got '+iconSize+')');
 const spacing=await nav.locator('.department-navigation-groups').evaluate(el=>getComputedStyle(el).rowGap);
 assert.ok(parseFloat(spacing)>=5,'the icon spacing is widened (got '+spacing+')');
 // The icon strip is a launcher: hovering a department opens its pages in a floating panel,
 // so a page switch never needs the full sidebar back.
 const departmentIcon=nav.locator('.department-navigation-toggle').first();
 await departmentIcon.hover();
 const flyout=page.locator('.department-navigation-flyout');await flyout.waitFor({state:'visible'});
 assert.equal(await railWidth(),64,'the rail stays collapsed while the panel is open');
 assert.ok(await flyout.locator('[data-nav-view]').count()>0,'the panel lists department pages');
 // The panel must read as a layer floating above the deep-green rail, not blend into it.
 const surface=await flyout.evaluate(el=>getComputedStyle(el));
 assert.notEqual(surface.backgroundColor,'rgb(18, 56, 47)','the panel is not the same colour as the rail');
 assert.ok(surface.boxShadow&&surface.boxShadow!=='none','the panel carries a shadow so it reads as floating');
 // The panel must sit flush against the rail, otherwise the pointer crosses a dead gap
 // where neither the icon nor the panel owns the hover and the panel vanishes mid-travel.
 const gap=await flyout.evaluate(el=>{const icon=document.querySelector('#workspace-navigation .department-navigation-toggle');const rail=document.querySelector('.handoff-shell .rail');return{toIcon:Math.round(el.getBoundingClientRect().left-icon.getBoundingClientRect().right),toRail:Math.round(el.getBoundingClientRect().left-rail.getBoundingClientRect().right)};});
 assert.ok(gap.toRail<=1,'the panel is flush against the rail, leaving no dead gap ('+JSON.stringify(gap)+')');
 // Travelling from the icon into the panel must not dismiss the panel on the way.
 const iconBox=await departmentIcon.boundingBox(),panelBox=await flyout.boundingBox();
 const travelY=Math.round((iconBox.y+iconBox.height/2));
 await page.mouse.move(iconBox.x+iconBox.width-6,travelY);
 for(let x=iconBox.x+iconBox.width-6;x<panelBox.x+60;x+=12){await page.mouse.move(x,travelY);await page.waitForTimeout(40);}
 assert.equal(await page.locator('.department-navigation-flyout').count(),1,'the panel survives the pointer travelling from the icon into it');
 await page.waitForTimeout(600);
 assert.equal(await page.locator('.department-navigation-flyout').count(),1,'the panel stays open once the pointer rests inside it');
 // Hovering another department swaps the panel instead of dropping it.
 const secondIcon=nav.locator('.department-navigation-toggle').nth(1);
 await secondIcon.hover();
 await page.waitForFunction(()=>document.querySelectorAll('.department-navigation-flyout').length===1,{timeout:5000});
 await page.waitForTimeout(500);
 assert.equal(await page.locator('.department-navigation-flyout').count(),1,'the panel stays open while switching departments');
 assert.equal(await railWidth(),64,'switching departments keeps the rail collapsed');
 const flyoutLink=flyout.locator('[data-nav-view]').first(),flyoutView=await flyoutLink.getAttribute('data-nav-view');
 await flyoutLink.click();await flyout.waitFor({state:'detached'});
 assert.equal(await railWidth(),64,'navigating from the panel keeps the rail collapsed');
 assert.equal(await toggle.getAttribute('aria-expanded'),'false');
 assert.ok(page.url().includes('/'+flyoutView),'the panel navigates to the selected page');
 // Moving the pointer away from the rail closes the panel again.
 await departmentIcon.hover();await flyout.waitFor({state:'visible'});
 await page.mouse.move(900,700);await flyout.waitFor({state:'detached',timeout:5000});
 // The collapsed choice is remembered across reloads and survives wide viewports.
 // The rail is still collapsed here, so the trigger now expands it again.
 await toggle.click();assert.equal(await toggle.getAttribute('aria-expanded'),'true');await settle(228,228);
 await toggle.click();assert.equal(await toggle.getAttribute('aria-expanded'),'false');await settle(64,64);
 await page.reload();await page.getByRole('button',{name:'展开导航栏'}).waitFor();assert.equal(await toggle.getAttribute('aria-expanded'),'false');
 await settle(64,64);assert.equal(await railWidth(),64);
 for(const width of [1920,1024]){await page.setViewportSize({width,height:900});await nav.waitFor({state:'visible'});await settle(64,64);assert.equal(await railWidth(),64);assert.equal(await toggle.getAttribute('aria-expanded'),'false');}
 // Narrow screens fall back to an overlay drawer.
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'展开导航栏'}).waitFor();await nav.waitFor({state:'hidden'});
 await toggle.click();await nav.waitFor({state:'visible'});assert.equal(await toggle.getAttribute('aria-expanded'),'true');await page.keyboard.press('Escape');assert.equal(await toggle.getAttribute('aria-expanded'),'false');assert(await toggle.evaluate(n=>document.activeElement===n));
 await toggle.click();await page.getByRole('button',{name:'关闭导航遮罩'}).click();assert.equal(await toggle.getAttribute('aria-expanded'),'false');
 await toggle.click();const link=nav.locator('[data-nav-view]').first();await link.click();assert.equal(await toggle.getAttribute('aria-expanded'),'false');
 await page.setViewportSize({width:1024,height:900});await page.getByRole('button',{name:'展开导航栏'}).waitFor();assert(await nav.isVisible(),'desktop icon strip survives the mobile drawer');
 assert.deepEqual(errors,[]);console.log('PASS responsive navigation: one trigger, desktop icon strip, mobile drawer, dismissal, focus and navigation');
}finally{await browser?.close();server.kill('SIGTERM');await done;}
