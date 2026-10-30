// Only synthetic accounts in a fresh temporary database; never uses port 8787.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const dist=path.resolve(process.env.DOON_BUILD_DIR||'test-output/password-reset-build');
assert(dist.startsWith(path.resolve('test-output')+path.sep),'Use an isolated test-output build.');
const dir=await fs.mkdtemp(path.resolve('test-output/reset-password-browser-'));
const origin='http://127.0.0.1:18816';
const env={...Object.fromEntries(Object.entries(process.env).filter(([name])=>!/^DOON_KINGDEE_/i.test(name))),DOON_KINGDEE_SUPPLIER_SYNC_ENABLED:'0',DOON_KINGDEE_READONLY_ENABLED:'0',DOON_DATA_DIR:dir,DOON_HOST:'127.0.0.1',DOON_PORT:'18816',DOON_NO_AUTO_BACKUP:'1',DOON_EMPLOYEE_PUBLIC_ORIGIN:'',DOON_SERVER_MODE:'internal',DOON_REVIEW_MODE:'0',DOON_SYNTHETIC_ONLY:'0',DOON_TLS_CERT:'',DOON_TLS_KEY:''};
execFileSync(process.execPath,[path.join(dist,'manage.mjs'),'init'],{env,stdio:'pipe',windowsHide:true});
const initial=(await fs.readFile(path.join(dir,'管理员首次登录.txt'),'utf8')).match(/初始密码：([^\n]+)/)[1];
const server=spawn(process.execPath,[path.join(dist,'server.mjs')],{env,stdio:'pipe',windowsHide:true});
let browser,logs='';server.stdout.on('data',()=>{});server.stderr.on('data',b=>logs+=b);
const checks=[],pass=message=>{checks.push(message);console.log('PASS '+message);};
try{
 for(let i=0;i<80;i++){try{if((await fetch(origin+'/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 const {chromium}=await import(process.env.DOON_PLAYWRIGHT_MODULE?pathToFileURL(process.env.DOON_PLAYWRIGHT_MODULE).href:'playwright');
 browser=await chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1050}}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin);
 await page.getByLabel('登录账号',{exact:true}).fill('admin');await page.getByLabel('登录密码',{exact:true}).fill(initial);await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.getByLabel('当前密码',{exact:true}).fill(initial);await page.getByLabel('新密码',{exact:true}).fill('Synthetic-Admin-Reset-2026!');await page.getByLabel('确认新密码',{exact:true}).fill('Synthetic-Admin-Reset-2026!');await page.getByRole('button',{name:'保存密码并进入',exact:true}).click();
 await page.getByRole('button',{name:'成员与权限',exact:true}).waitFor();
 for(const [username,name] of [['reset_a','合成成员甲'],['reset_b','合成成员乙']]){
  const response=await context.request.post(origin+'/api/auth/accounts',{headers:{Origin:origin},data:{username,name,password:'Synthetic-Initial-2026!',role:'clerk',departments:['plating'],customers:[]}});assert.equal(response.status(),200);
 }
 const employee=await browser.newContext();assert.equal((await employee.request.post(origin+'/api/auth/login',{headers:{Origin:origin},data:{username:'reset_b',password:'Synthetic-Initial-2026!'}})).status(),200);
 await page.reload();
 await page.getByRole('button',{name:'成员与权限',exact:true}).click();
 const row=username=>page.getByRole('row').filter({has:page.getByRole('cell',{name:username,exact:true})});
 let calls=0;page.on('request',r=>{if(r.url()===origin+'/api/auth/reset')calls++;});
 await row('reset_a').getByRole('button',{name:'重置密码',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'重置成员密码'}),first=dialog.getByLabel('新的初始密码',{exact:true}),second=dialog.getByLabel('再次输入初始密码',{exact:true});
 assert.match(await dialog.innerText(),/合成成员甲（reset_a）/);assert.equal(await page.locator('.lan-reset').count(),0);
 await first.fill('Synthetic-Cancelled-2026!');await dialog.getByRole('button',{name:'取消',exact:true}).click();await dialog.waitFor({state:'hidden'});assert.equal(calls,0);
 await row('reset_b').getByRole('button',{name:'重置密码',exact:true}).click();assert.match(await dialog.innerText(),/合成成员乙（reset_b）/);assert.equal(await first.inputValue(),'');assert.equal(await second.inputValue(),'');
 pass('每个成员打开对应弹窗；取消不提交，切换成员清空密码，底部旧表单已移除');
 await first.fill('Synthetic-Reset-New-2026!');await second.fill('Synthetic-Reset-Wrong-2026!');assert.equal(await second.getAttribute('aria-invalid'),'true');assert.match(await dialog.getByRole('alert').innerText(),/不一致/);assert.equal(await dialog.getByRole('button',{name:'确认重置',exact:true}).isDisabled(),true);assert.equal(calls,0);
 await second.fill('Synthetic-Reset-New-2026!');assert.equal(await dialog.getByRole('alert').count(),0);
 pass('两次密码不一致立即提示并阻止提交，改为一致后解除提示');
 const fail=route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'合成测试：暂时无法重置，请重试。'})});
 await page.route('**/api/auth/reset',fail);await dialog.getByRole('button',{name:'确认重置',exact:true}).click();await dialog.getByRole('alert').filter({hasText:'暂时无法重置'}).waitFor();assert.equal(await dialog.isVisible(),true);assert.equal(await page.getByRole('status').filter({hasText:'密码重置完成'}).count(),0);await page.unroute('**/api/auth/reset',fail);
 pass('接口失败保留弹窗并展示错误，允许重试且不显示成功');
 let release;const blocked=new Promise(r=>release=r);
 await page.route('**/api/auth/reset',async route=>{await blocked;await route.continue();});
 const before=calls;await dialog.getByRole('button',{name:'确认重置',exact:true}).click();await dialog.getByRole('button',{name:'正在重置…',exact:true}).waitFor();assert.equal(await first.isDisabled(),true);assert.equal(await dialog.getByRole('button',{name:'取消',exact:true}).isDisabled(),true);await page.keyboard.press('Escape');assert.equal(await dialog.isVisible(),true);release();
 await dialog.waitFor({state:'hidden'});assert.equal(calls,before+1);await page.getByRole('status').filter({hasText:'合成成员乙（reset_b）密码重置完成'}).waitFor();
 const noticeBox=await page.getByRole('status').filter({hasText:'密码重置完成'}).boundingBox();assert(noticeBox.y>=0&&noticeBox.y<1050,'Success notice must be in the visible viewport.');
 await page.screenshot({path:path.join(dir,'reset-complete.png'),fullPage:true,animations:'disabled'});
 assert.equal((await employee.request.get(origin+'/api/workspace/data')).status(),401);
 const login=await employee.request.post(origin+'/api/auth/login',{headers:{Origin:origin},data:{username:'reset_b',password:'Synthetic-Reset-New-2026!'}});assert.equal(login.status(),200);assert.equal((await login.json()).user.mustChange,true);
 const other=await browser.newContext();assert.equal((await other.request.post(origin+'/api/auth/login',{headers:{Origin:origin},data:{username:'reset_a',password:'Synthetic-Initial-2026!'}})).status(),200);
 pass('提交中阻止重复与关闭；成功自动关闭、明确提示，仅目标成员改密且旧会话失效');
 await row('reset_a').getByRole('button',{name:'重置密码',exact:true}).click();await page.setViewportSize({width:390,height:844});await dialog.waitFor();assert.equal(await first.inputValue(),'');const box=await dialog.boundingBox();assert(box.x>=0&&box.x+box.width<=390);await page.screenshot({path:path.join(dir,'reset-mobile.png'),animations:'disabled'});await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert.deepEqual(errors,[]);
 pass('手机宽度弹窗不溢出，重新打开不保留密码，Escape可取消');
 await page.setViewportSize({width:1440,height:1050});
 const loginHistory=page.getByRole('region',{name:'账号登录历史'});
 await loginHistory.getByRole('button',{name:'刷新登录历史',exact:true}).click();
 await loginHistory.getByRole('status').filter({hasText:/已显示/}).waitFor();
 await loginHistory.getByRole('combobox',{name:'筛选登录账号'}).click();await page.getByRole('option',{name:'reset_b',exact:true}).click();
 await loginHistory.getByRole('status').filter({hasText:'已显示 2 条记录'}).waitFor();
 assert.equal(await loginHistory.getByRole('cell',{name:'reset_b',exact:true}).count(),2);
 assert.equal(await loginHistory.getByRole('cell',{name:'登录成功',exact:true}).count(),2);
 assert.equal(await loginHistory.getByRole('cell',{name:'admin',exact:true}).count(),0);
 await loginHistory.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(dir,'login-history-desktop.png'),animations:'disabled'});
 await page.setViewportSize({width:390,height:844});await loginHistory.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(dir,'login-history-mobile.png'),animations:'disabled'});
 assert.deepEqual(errors,[]);pass('管理员可查看并刷新登录历史，账号筛选显示对应事件，桌面和手机均可访问');
 await fs.writeFile(path.join(dir,'results.json'),JSON.stringify({checks},null,2));console.log('Evidence: '+dir);
}finally{if(browser)await browser.close();server.kill();if(logs.includes('Error'))console.error(logs.slice(-1500));}
