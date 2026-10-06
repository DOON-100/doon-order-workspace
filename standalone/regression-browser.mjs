// End-to-end regression on a real HTTP LAN origin, using an isolated database/accounts.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const {chromium}=await import(process.env.DOON_PLAYWRIGHT_MODULE?pathToFileURL(process.env.DOON_PLAYWRIGHT_MODULE).href:'playwright');
const root=await fs.mkdtemp(path.resolve('test-output/browser-fixes-')),port=18788;
const lan=Object.values(os.networkInterfaces()).flat().find(a=>a?.family==='IPv4'&&!a.internal&&a.address.startsWith('192.168.'))?.address;
assert(lan,'A LAN IP is required to reproduce insecure-context behavior');
const origin=`http://${lan}:${port}`,env={...process.env,DOON_DATA_DIR:root,DOON_HOST:'0.0.0.0',DOON_PORT:String(port),DOON_NO_AUTO_BACKUP:'1'};
execFileSync(process.execPath,['lan-dist/manage.mjs','init'],{env,stdio:'pipe'});
const initial=(await fs.readFile(path.join(root,'管理员首次登录.txt'),'utf8')).match(/初始密码：([^\n]+)/)[1];
const server=spawn(process.execPath,['lan-dist/server.mjs'],{env,stdio:'pipe'});let logs='';server.stderr.on('data',b=>logs+=b);server.stdout.on('data',()=>{});
let browser;const checks=[];const pass=name=>{checks.push(name);console.log('PASS '+name);};
async function signed(context,name,password,changeTo){
 const page=await context.newPage();await page.goto(origin);
 await page.getByLabel('登录账号',{exact:true}).fill(name);await page.getByLabel('登录密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();
 if(changeTo){await page.getByLabel('当前密码',{exact:true}).fill(password);await page.getByLabel('新密码',{exact:true}).fill(changeTo);await page.getByLabel('确认新密码',{exact:true}).fill(changeTo);await page.getByRole('button',{name:'保存密码并进入',exact:true}).click();}
 await page.getByRole('heading',{name:'动态订单总表',exact:true}).waitFor();return page;
}
try{
 for(let i=0;i<50;i++){try{if((await fetch(origin+'/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-proxy-server']});
 const adminContext=await browser.newContext({viewport:{width:1440,height:1100}}),admin=await signed(adminContext,'admin',initial,'Test-LAN-Admin-2026!');
 const errors=[];admin.on('pageerror',e=>errors.push(e.message));
 const capability=await admin.evaluate(()=>({secure:isSecureContext,uuid:typeof crypto.randomUUID}));assert.equal(capability.secure,false);assert.equal(capability.uuid,'undefined');
 await admin.getByRole('button',{name:'供应商收货',exact:true}).click();await admin.getByRole('heading',{name:'供应商交期与收货'}).waitFor();assert.deepEqual(errors,[]);
 await admin.getByRole('button',{name:'登记外发',exact:true}).click();await admin.getByRole('dialog').waitFor();await admin.keyboard.press('Escape');pass('LAN HTTP 页面在 randomUUID 不可用时仍正常打开并登记外发');
 await admin.getByRole('button',{name:'上传订单表',exact:true}).click();
 const original=process.env.DOON_TEST_ORIGINAL_WORKBOOK,expectedRows=Number(process.env.DOON_TEST_EXPECTED_ROWS),expectedQuantity=Number(process.env.DOON_TEST_EXPECTED_QUANTITY);assert(original&&Number.isSafeInteger(expectedRows)&&expectedRows>0&&Number.isFinite(expectedQuantity),'需要另行提供测试工作簿及预期行数、数量');
 await admin.getByLabel('上传工作表',{exact:true}).setInputFiles(original);
 const importButton=admin.getByRole('button',{name:'确认导入此工作簿',exact:true});await importButton.waitFor({timeout:60000});
 assert.match(await admin.locator('#ledger-import').innerText(),new RegExp(expectedRows.toLocaleString('en-US')));assert.match(await admin.locator('#ledger-import').innerText(),new RegExp(expectedQuantity.toLocaleString('en-US')));
 await admin.screenshot({path:path.join(root,'01-original-upload.png'),fullPage:true});
 await importButton.click();await admin.getByRole('button',{name:'已完成导入',exact:true}).waitFor({timeout:120000});
 let response=await adminContext.request.get(origin+'/api/workspace/data'),data=await response.json();assert.equal(data.orders.length,expectedRows);assert.equal(data.orders.reduce((n,o)=>n+o.quantity,0),expectedQuantity);
 pass('通过普通 Excel 入口上传真实原表，自动识别并分批导入 预期行数与数量');
 // Re-select the same file after completion; the native input was reset.
 await admin.getByLabel('上传工作表',{exact:true}).setInputFiles(original);await admin.getByRole('button',{name:'已完成导入',exact:true}).waitFor({timeout:60000});
 data=await (await adminContext.request.get(origin+'/api/workspace/data')).json();assert.equal(data.orders.length,expectedRows);pass('同一原表再次选择正常响应，已完成批次不产生重复订单');
 async function api(action,body){const r=await adminContext.request.post(origin+'/api/'+action,{data:body,headers:{Origin:origin}});assert.equal(r.status(),200,await r.text());return r.json();}
 await api('auth/accounts',{username:'alice_test',name:'Alice 测试',role:'sales',password:'Test-Alice-Initial!',customers:[]});
 await api('auth/accounts',{username:'clerk_test',name:'电镀测试',role:'clerk',departments:['plating'],customers:[],password:'Test-Clerk-Initial!'});
 const salesContext=await browser.newContext({viewport:{width:1440,height:1050}}),sales=await signed(salesContext,'alice_test','Test-Alice-Initial!','Test-Alice-Personal!');
 const salesErrors=[];sales.on('pageerror',e=>salesErrors.push(e.message));
 let salesData=await (await salesContext.request.get(origin+'/api/workspace/data')).json();assert.equal(salesData.orders.length,expectedRows);
 await sales.getByRole('button',{name:'供应商收货',exact:true}).click();await sales.getByRole('heading',{name:'交期维护权限 · 仅可查看',exact:true}).waitFor();assert((await Promise.all((await sales.getByRole('button',{name:'登记外发',exact:true}).all()).map(b=>b.isDisabled()))).every(Boolean));
 await sales.screenshot({path:path.join(root,'02-alice-permission.png'),fullPage:true});assert.deepEqual(salesErrors,[]);
 for(const [action,body] of [['edit-order',{id:data.orders[0].id,version:1,patch:{notes:'forbidden'}}],['receipt-photo',{}],['ledger-edit',{id:data.orders[0].id,version:1,patch:{AL:'999'},reason:'forbidden'}]]){const r=await salesContext.request.post(origin+'/api/workspace/'+action,{data:body,headers:{Origin:origin}});assert.equal(r.status(),403,action);}
 await sales.getByRole('button',{name:'上传与更新',exact:true}).click();await sales.getByRole('heading',{name:'权限受限',exact:true}).waitFor();pass('销售独立账号看到完整授权范围；供应商和上传入口显示彩色权限说明，越权写入仍被拒绝');
 const clerkContext=await browser.newContext(),clerk=await signed(clerkContext,'clerk_test','Test-Clerk-Initial!','Test-Clerk-Personal!');
 const clerkData=await (await clerkContext.request.get(origin+'/api/workspace/data')).json();assert.equal(clerkData.orders.length,expectedRows);
 const line=clerkData.orders[0];let r=await clerkContext.request.post(origin+'/api/workspace/ledger-edit',{data:{id:line.id,version:line.version,patch:{AL:'20'},reason:'回归测试本部门'},headers:{Origin:origin}});assert.equal(r.status(),200,await r.text());
 r=await clerkContext.request.post(origin+'/api/workspace/ledger-edit',{data:{id:line.id,version:line.version+1,patch:{AG:'20'},reason:'回归测试跨部门'},headers:{Origin:origin}});assert.equal(r.status(),403);
 pass('文员独立账号共享原始总表，可写本部门并拒绝跨部门修改');
 const members=(await (await adminContext.request.get(origin+'/api/workspace/data')).json()).members,member=members.find(m=>m.email==='alice_test@doon.local');
 await api('workspace/member',{...member,orderScope:'assigned'});
 await sales.getByRole('button',{name:/动态订单总表/}).click();await sales.getByRole('button',{name:'刷新订单',exact:true}).click();await sales.getByRole('heading',{name:'暂无可查看的在制订单',exact:true}).waitFor();assert.match(await sales.getByText('当前账号按客户或负责人限制查看。',{exact:false}).innerText(),/无需重复上传/);
 await sales.screenshot({path:path.join(root,'03-scoped-empty.png'),fullPage:true});pass('管理员收紧查看范围后立即生效，空表解释权限原因且不引导重复导入');
 // Binding must show the total already assigned, including after a partial batch or a repeated request.
 await api('auth/accounts',{username:'candy_binding',name:'Candy 绑定测试',role:'pmc',password:'Test-Candy-Initial!',customers:[]});
 const assignment={ownerName:'CANDY',email:'candy_binding@doon.local'};
 const firstBatch=await api('workspace/ledger-assign',assignment);assert.deepEqual(firstBatch,{ok:true,count:30,total:614,bound:30,remaining:584});
 await admin.getByRole('button',{name:'成员与权限',exact:true}).click();await admin.reload();
 await admin.getByRole('combobox',{name:'原表跟单员绑定',exact:true}).click();await admin.getByRole('option',{name:'CANDY',exact:true}).click();
 await admin.getByRole('combobox',{name:'绑定登录账号',exact:true}).click();await admin.getByRole('option',{name:'Candy 绑定测试 · candy_binding@doon.local',exact:true}).click();
 const assignmentPanel=admin.locator('section').filter({has:admin.getByRole('heading',{name:'把原表跟单员绑定到登录账号',exact:true})});
 assert.match(await assignmentPanel.locator('[aria-label="跟单绑定统计"]').innerText(),/原表在制明细\s*614[\s\S]*已绑定该账号\s*30[\s\S]*待绑定 \/ 调整\s*584/);
 await admin.getByRole('button',{name:'绑定 584 条明细',exact:true}).click();await admin.getByRole('button',{name:'已全部绑定',exact:true}).waitFor({timeout:60000});
 assert.equal(await admin.getByRole('button',{name:'已全部绑定',exact:true}).isDisabled(),true);
 assert.match(await assignmentPanel.innerText(),/CANDY 的 614 条在制明细已全部绑定到 Candy 绑定测试/);
 assert.match(await assignmentPanel.innerText(),/本次绑定 584 条/);
 await assignmentPanel.screenshot({path:path.join(root,'04-binding-complete.png')});
 const beforeRepeat=await (await adminContext.request.get(origin+'/api/workspace/data')).json();
 assert.equal(beforeRepeat.orders.filter(o=>o.ownerEmail===assignment.email).length,614);
 assert.equal(beforeRepeat.orders.filter(o=>o.ledger?.ownerName==='TINA'&&o.ownerEmail===assignment.email).length,0);
 assert.deepEqual(await api('workspace/ledger-assign',assignment),{ok:true,count:0,total:614,bound:614,remaining:0});
 const afterRepeat=await (await adminContext.request.get(origin+'/api/workspace/data')).json();assert.equal(afterRepeat.revision,beforeRepeat.revision);assert.deepEqual(afterRepeat.orders,beforeRepeat.orders);
 const denied=await salesContext.request.post(origin+'/api/workspace/ledger-assign',{data:assignment,headers:{Origin:origin}});assert.equal(denied.status(),403);
 pass('绑定按批完成 614 条，显示已绑定总数与待绑定数；重复提交不改订单或版本，销售不能越权绑定');
 const candyContext=await browser.newContext(),candyPage=await signed(candyContext,'candy_binding','Test-Candy-Initial!','Test-Candy-Personal!');
 await candyPage.getByRole('button',{name:'我的订单',exact:true}).click();await candyPage.getByText('共 614 条明细',{exact:false}).waitFor();
 pass('员工以独立账号登录后，“我的订单”显示所绑定的 614 条明细');
 // Also test the cryptographic fallback directly without browser-specific mocking of app code.
 await build({entryPoints:['lib/client-id.ts'],outfile:path.join(root,'client-id.mjs'),bundle:true,platform:'node',format:'esm'});
 const {clientId}=await import(pathToFileURL(path.join(root,'client-id.mjs')).href);
 const ids=new Set(Array.from({length:1000},()=>clientId({getRandomValues:globalThis.crypto.getRandomValues.bind(globalThis.crypto)})));assert.equal(ids.size,1000);assert([...ids].every(x=>/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(x)));
 pass('内网兼容标识符合 UUID v4，连续生成无重复');
 await fs.writeFile(path.join(root,'results.json'),JSON.stringify({origin,capability,checks,at:new Date().toISOString()},null,2));console.log('Evidence: '+root);
}finally{if(browser)await browser.close();server.kill();if(logs.trim())console.log(logs.slice(-2000));}
