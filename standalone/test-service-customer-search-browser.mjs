import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';

// 测试环境，不含正式业务数据；独立目录、端口及合成客户。
const dist=path.resolve(process.env.DOON_BUILD_DIR||'test-output/service-customer-search-build');
const dir=await fs.mkdtemp(path.resolve('test-output/service-customer-search-'));
const origin='http://127.0.0.1:18826';
const env={...process.env,DOON_DATA_DIR:dir,DOON_HOST:'127.0.0.1',DOON_PORT:'18826',DOON_NO_AUTO_BACKUP:'1',DOON_SYNTHETIC_ONLY:'1',DOON_STUDIO_SCHEDULES_ENABLED:'0',DOON_IE_MAIL_ENABLED:'0',DOON_EMPLOYEE_PUBLIC_ORIGIN:'',DOON_SERVER_MODE:'internal',DOON_REVIEW_MODE:'0',DOON_TLS_CERT:'',DOON_TLS_KEY:''};
execFileSync(process.execPath,[path.join(dist,'manage.mjs'),'init'],{env,stdio:'pipe',windowsHide:true});
const password=(await fs.readFile(path.join(dir,'管理员首次登录.txt'),'utf8')).match(/初始密码：([^\n]+)/)[1];
const server=spawn(process.execPath,[path.join(dist,'server.mjs')],{env,stdio:'pipe',windowsHide:true});
const done=new Promise(resolve=>server.once('exit',resolve));
let cookie='',browser,logs='';const errors=[];
server.stdout.on('data',()=>{});server.stderr.on('data',b=>logs+=b);
async function api(route,body){
 const res=await fetch(origin+'/api/'+route,{method:body===undefined?'GET':'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];
 const value=await res.json();assert.equal(res.status,200,JSON.stringify(value));return value;
}
try{
 for(let i=0;i<80;i++){try{if((await fetch(origin+'/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 await api('auth/login',{username:'admin',password});
 await api('auth/password',{currentPassword:password,password:'Synthetic-Search-Only-2026!'});
 const admin=(await api('workspace/data')).me;
 const alpha=(await api('workspace/customer-save',{customer:'合成远航眼镜 Alpha',customerCode:'SYN-A17',salesName:'',serviceName:'',pmcName:'',active:true})).item;
 const beta=(await api('workspace/customer-save',{customer:'合成星河 Beta',customerCode:'SYN-B82',salesName:'',serviceName:'',pmcName:'',active:true})).item;
 await api('workspace/customer-save',{customer:'合成停用客户',customerCode:'SYN-INACTIVE',salesName:'',serviceName:'',pmcName:'',active:false});
 const db=new DatabaseSync(path.join(dir,'workspace.sqlite'));
 const insert=db.prepare('INSERT INTO records VALUES(?,?,?)');
 const team={id:'synthetic-search-team',kind:'customer_project_team',name:'合成客服一组',active:true,customerIds:[alpha.id,beta.id],leaderIds:[admin.id],salesMemberIds:[admin.id],serviceMemberIds:[admin.id],version:1};insert.run(team.id,team.kind,JSON.stringify(team));
 for(let i=0;i<220;i++){const c={...alpha,id:'synthetic-search-'+i,customer:'合成普通客户 '+i,customerCode:'SYN-FILL-'+i};insert.run(c.id,c.kind,JSON.stringify(c));}
 db.prepare("UPDATE workspace_revision SET revision=revision+1 WHERE id='main'").run();
 const originals=db.prepare("SELECT id,data FROM records WHERE kind='customer_account' ORDER BY id").all();db.close();
 const pw=await import(process.env.DOON_PLAYWRIGHT_MODULE?pathToFileURL(process.env.DOON_PLAYWRIGHT_MODULE).href:'playwright');
 browser=await pw.chromium.launch({headless:true,...(process.env.DOON_CHROMIUM_PATH?{executablePath:process.env.DOON_CHROMIUM_PATH}:{channel:'chrome'})});
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 const split=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),url:origin,httpOnly:true,sameSite:'Strict'}]);
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/service-workspace');
 await page.getByRole('button',{name:'新增跟进',exact:true}).click();
 const editor=page.getByRole('region',{name:'客服业务编辑'}),input=editor.getByRole('combobox',{name:'记录所属客户'});

 const empty=()=>page.getByText('没有匹配的选项，请更换关键词；不支持自定义。',{exact:true});
 async function choose(label,query,option){const control=editor.getByRole('combobox',{name:label,exact:true});await control.fill(query);await page.getByRole('option',{name:option,exact:true}).click();assert.equal(await control.inputValue(),option);}
 await editor.getByPlaceholder(/一句话说明需推进的事项/).fill('合成模糊查询验证');
 let saves=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/service-save'))saves++;});
 await input.fill('不存在的合成客户');await empty().waitFor();await input.press('Escape');
 await editor.getByRole('button',{name:'确认保存',exact:true}).click();assert.equal(saves,0,'An unselected required customer cannot be saved');
 await input.fill('远航');await page.getByRole('option',{name:'SYN-A17 · 合成远航眼镜 Alpha',exact:true}).waitFor();await page.screenshot({path:'test-output/service-customer-search-options.png',fullPage:true});
 await page.getByRole('option',{name:'SYN-A17 · 合成远航眼镜 Alpha',exact:true}).click();
 await input.fill('b82');await page.getByRole('option',{name:'SYN-B82 · 合成星河 Beta',exact:true}).waitFor();await input.press('ArrowDown');await input.press('Enter');
 assert.equal(await input.inputValue(),'SYN-B82 · 合成星河 Beta');
 await choose('记录所属客户','ALPHA 远航','SYN-A17 · 合成远航眼镜 Alpha');
 await choose('业务类型','样办','样办 / 确认');
 for(const label of ['客批确认','颜色确认','字印确认','配件确认'])await choose(label,'已确','已确认');
 await choose('业务类型','应收','应收 / 核销');await choose('币种','eur','EUR');
 await choose('业务类型','日常','日常跟进');
 await choose('关联订单 / PO（可不关联）','独立','暂无订单 / 独立跟进');
 await choose('记录所属业务组','客服一','合成客服一组');
 await choose('客服审核人',admin.name,admin.name);await choose('业务审核人',admin.name,admin.name);
 await choose('客服跟进人',admin.name,admin.name);
 assert.equal(await editor.getByRole('combobox',{name:'客服审核人',exact:true}).inputValue(),'未指定','Same person cannot remain their own reviewer');
 assert.equal(await editor.getByRole('combobox',{name:'业务审核人',exact:true}).inputValue(),'未指定');
 await choose('等待谁回复','业务','等待业务');await choose('处理状态','进行','进行中');
 // Arbitrary filter text never replaces any stored option, including optional fields.
 for(const label of await editor.getByRole('combobox').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label')))){
  const control=editor.getByRole('combobox',{name:label,exact:true});console.log('Checking no custom:',label);
  if(await control.isDisabled())continue;const before=await control.inputValue();
  await control.fill('绝不自定义xyz');await empty().waitFor();await control.press('Escape');assert.equal(await control.inputValue(),before);
 }
 // A slow post-save read must not hold the editing lock or overwrite a later save.
 let heldRead,releaseRead,holdRead=true,failRead=false;
 const readHeld=new Promise(resolve=>{heldRead=resolve;});
 await page.route('**/api/workspace/service-data',async route=>{
  if(failRead){failRead=false;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic readback unavailable'})});return;}
  const response=await route.fetch(),body=await response.body();
  if(holdRead){holdRead=false;await new Promise(resolve=>{releaseRead=resolve;heldRead();});}
  await route.fulfill({response,body});
 });
 const response=page.waitForResponse(r=>r.url().endsWith('/service-save')&&r.request().method()==='POST');
 await editor.getByRole('button',{name:'确认保存',exact:true}).click();
 const saved=await (await response).json();assert.equal(saved.record.customerId,alpha.id);assert.equal(saved.record.waitingFor,'jennifer','Existing stored status remains compatible');
 await editor.waitFor({state:'hidden'});assert.equal(await editor.count(),0,'Successful save closes the editor');
 await readHeld;
 const toast=page.getByTestId('service-save-toast');await toast.waitFor();assert.equal(await toast.innerText(),'保存成功');
 const box=await toast.boundingBox();assert(Math.abs(box.x+box.width/2-720)<2&&box.y<=30,'Toast is at the top center of the viewport');
 const toastAt=Date.now();await page.screenshot({path:'test-output/service-save-toast.png',fullPage:true});await toast.waitFor({state:'hidden',timeout:3500});
 assert(Date.now()-toastAt>=1200,'The success toast remains visible before its two-second dismissal');

 await page.getByRole('button',{name:'合成模糊查询验证',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'编辑跟进',exact:true}).click();
 assert(await editor.getByRole('combobox',{name:'记录所属客户',exact:true}).isDisabled(),'Saved customer remains locked when reopened');
 const title=editor.getByPlaceholder(/一句话说明需推进的事项/);
 await title.waitFor();assert(await title.isEnabled(),'The saved record can be reopened while readback is pending');
 await title.fill('合成第二次快速保存');
 const secondResponse=page.waitForResponse(r=>r.url().endsWith('/service-save')&&r.request().method()==='POST');
 await editor.getByRole('button',{name:'确认保存',exact:true}).click();
 const second=await (await secondResponse).json();assert.equal(second.record.version,2);
 await editor.waitFor({state:'hidden'});
 releaseRead();
 await page.waitForResponse(r=>r.url().endsWith('/service-data')&&r.request().method()==='GET');
 await page.getByRole('button',{name:'合成第二次快速保存',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'编辑跟进',exact:true}).click();
 assert.equal(await title.inputValue(),'合成第二次快速保存','A stale read cannot replace the newer record');
 failRead=true;await title.fill('合成刷新失败后仍已保存');
 const thirdResponse=page.waitForResponse(r=>r.url().endsWith('/service-save')&&r.request().method()==='POST');
 await editor.getByRole('button',{name:'确认保存',exact:true}).click();
 const third=await (await thirdResponse).json();assert.equal(third.record.version,3);
 await page.getByRole('alert').filter({hasText:'本次操作已保存，但列表刷新失败'}).waitFor();
 await editor.waitFor({state:'hidden'});assert.equal(saves,3,'A failed readback must not repeat the write');
 const persisted=(await api('workspace/service-data')).records.find(r=>r.id===saved.record.id);
 assert.equal(persisted.title,'合成刷新失败后仍已保存');assert.equal(persisted.version,3);
 await page.unroute('**/api/workspace/service-data');
 // A rejected write must retain input and never display a success toast.
 await page.getByRole('button',{name:'合成刷新失败后仍已保存',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'编辑跟进',exact:true}).click();
 await title.fill('合成写入被拒绝');
 await page.route('**/api/workspace/service-save',route=>route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'Synthetic version conflict'})}),{times:1});
 await editor.getByRole('button',{name:'确认保存',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'Synthetic version conflict'}).waitFor();
 assert.equal(await page.getByTestId('service-save-toast').count(),0);assert.equal(await title.inputValue(),'合成写入被拒绝');
 assert.equal((await api('workspace/service-data')).records.find(r=>r.id===saved.record.id).version,3);


 const check=new DatabaseSync(path.join(dir,'workspace.sqlite'),{readOnly:true});
 assert.deepEqual(check.prepare("SELECT id,data FROM records WHERE kind='customer_account' ORDER BY id").all(),originals);check.close();
 assert.deepEqual(errors,[]);
 await page.screenshot({path:'test-output/service-customer-search.png',fullPage:true});
 page.once('dialog',dialog=>dialog.accept());
 await page.getByRole('button',{name:'新增跟进',exact:true}).click();
 assert.equal(await editor.getByRole('combobox',{name:'记录所属客户'}).inputValue(),'请选择客户','New draft clears the previous customer');
 await page.getByRole('button',{name:'等待业务',exact:true}).click();
 await page.getByRole('cell',{name:'等待业务',exact:false}).waitFor();
 assert.equal(await page.getByText('等待曲艳红',{exact:true}).count(),0);
 console.log('PASS all service dropdowns use existing options only; approval/currency/assignment/status search; 223 synthetic customers: name/code partial matching, case-insensitive multi-keywords, keyboard selection, unmatched save blocked, saved customer locked, original accounts unchanged, fresh draft cleared, waiting-for-business label with legacy stored status; slow/stale/failed background refresh cannot block or repeat saves; successful save closes editor and top-center toast dismisses after two seconds; rejected writes retain input without success toast');
}catch(error){
 if(browser){const pages=browser.contexts()[0].pages();await pages[0]?.screenshot({path:'test-output/service-search-failure.png',fullPage:true});console.error((await pages[0]?.locator('body').innerText())?.slice(-2400));}throw error;
}finally{
 await browser?.close();server.kill('SIGTERM');await done;
 if(errors.length)console.error(errors);
 if(process.exitCode)console.error(logs);
}
