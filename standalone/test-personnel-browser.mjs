import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const dist=path.resolve(process.env.DOON_BUILD_DIR||'test-output/personnel-build');
assert(dist.startsWith(path.resolve('test-output')+path.sep));
const dir=await fs.mkdtemp(path.resolve('test-output/personnel-browser-')),origin='http://127.0.0.1:19919';
const env={...Object.fromEntries(Object.entries(process.env).filter(([name])=>!/^DOON_KINGDEE_/i.test(name))),DOON_KINGDEE_SUPPLIER_SYNC_ENABLED:'0',DOON_KINGDEE_READONLY_ENABLED:'0',DOON_DATA_DIR:dir,DOON_HOST:'127.0.0.1',DOON_PORT:'19919',DOON_NO_AUTO_BACKUP:'1',DOON_EMPLOYEE_PUBLIC_ORIGIN:'',DOON_SERVER_MODE:'internal',DOON_REVIEW_MODE:'0',DOON_SYNTHETIC_ONLY:'1',DOON_STUDIO_SCHEDULES_ENABLED:'0'};
execFileSync(process.execPath,[path.join(dist,'manage.mjs'),'init'],{env,stdio:'pipe',windowsHide:true});
const initial=(await fs.readFile(path.join(dir,'管理员首次登录.txt'),'utf8')).match(/初始密码：([^\n]+)/)[1];
const server=spawn(process.execPath,[path.join(dist,'server.mjs')],{env,stdio:'ignore',windowsHide:true});let browser;
try{
 for(let n=0;n<80;n++){try{if((await fetch(origin+'/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 const {chromium}=await import(process.env.DOON_PLAYWRIGHT_MODULE?pathToFileURL(process.env.DOON_PLAYWRIGHT_MODULE).href:'playwright');
 browser=await chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext({viewport:{width:1600,height:1100}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin);
 await page.getByLabel('登录账号',{exact:true}).fill('admin');await page.getByLabel('登录密码',{exact:true}).fill(initial);await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.getByLabel('当前密码',{exact:true}).fill(initial);await page.getByLabel('新密码',{exact:true}).fill('SYN-Personnel-Browser-2026!');await page.getByLabel('确认新密码',{exact:true}).fill('SYN-Personnel-Browser-2026!');await page.getByRole('button',{name:'保存密码并进入',exact:true}).click();
 await page.getByRole('button',{name:'退出登录',exact:true}).waitFor();
 await page.goto(origin+'/members');
 const table=page.locator('table').filter({has:page.getByRole('columnheader',{name:'密码状态',exact:true})});
 await table.waitFor({state:'visible'});
 assert.deepEqual(await table.getByRole('columnheader').allTextContents(),['账号','姓名','人员类型','密码状态','操作']);
 await page.getByLabel('新员工登录账号',{exact:true}).fill('syn_external');await page.getByLabel('新员工姓名',{exact:true}).fill('SYN外部协作者');
 await page.getByRole('combobox',{name:'新账号人员类型',exact:true}).click();await page.getByRole('option',{name:'外部人员',exact:true}).click();await page.getByLabel('员工初始密码',{exact:true}).fill('SYN-External-Browser-2026!');await page.getByRole('button',{name:'创建账号',exact:true}).click();
 const row=table.getByRole('row').filter({hasText:'syn_external'});await row.getByText('外部人员',{exact:true}).waitFor();
 const memberRow=page.getByRole('row').filter({hasText:'SYN外部协作者'}).filter({has:page.getByRole('button',{name:'编辑权限',exact:true})});
 await memberRow.getByRole('button',{name:'编辑权限',exact:true}).click();const dialog=page.getByRole('dialog');
 assert.match(await dialog.getByRole('combobox',{name:'成员人员类型',exact:true}).innerText(),/外部人员/);
 await dialog.getByRole('combobox',{name:'成员人员类型',exact:true}).click();await page.getByRole('option',{name:'内部员工',exact:true}).click();await dialog.getByRole('button',{name:'保存成员权限',exact:true}).click();await dialog.waitFor({state:'hidden'});
 await row.getByText('内部员工',{exact:true}).waitFor();
 await page.reload();await row.getByText('内部员工',{exact:true}).waitFor();
 await table.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(dir,'personnel-desktop.png'),fullPage:true,animations:'disabled'});
 await page.setViewportSize({width:390,height:844});await row.getByText('内部员工',{exact:true}).waitFor();assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,columnBesideName:true,externalCreationAndInternalEdit:true,persistsAfterReload:true,mobileRendered:true,screenshot:path.join(dir,'personnel-desktop.png')}));
}catch(error){
 for(const context of browser?.contexts()||[])for(const page of context.pages()){console.log('SYNTHETIC_UI_STATE',await page.locator('body').innerText());await page.screenshot({path:path.join(dir,'personnel-error.png'),fullPage:true}).catch(()=>{});}
 throw error;
}finally{await browser?.close();server.kill();await new Promise(resolve=>server.exitCode!==null?resolve():server.once('exit',resolve));}
