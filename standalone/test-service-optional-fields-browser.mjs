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
 const editor=page.getByRole('region',{name:'客服业务编辑'}),labels={customer_profile:'客户联系档案',followup:'日常跟进',project:'新款 / 项目',sample:'样办 / 确认',shipment:'出货 / 单据',receivable:'应收 / 核销'};
 async function choose(label,query,option){const control=editor.getByRole('combobox',{name:label,exact:true});if(await control.inputValue()===option)return;await control.fill(query);await page.getByRole('option',{name:option,exact:true}).click();}
 async function save(expected=200){
  const response=page.waitForResponse(r=>r.url().endsWith('/service-save')&&r.request().method()==='POST');
  await editor.getByRole('button',{name:'确认保存',exact:true}).click();const res=await response,body=await res.json();assert.equal(res.status(),expected,JSON.stringify(body));
  if(expected===200)await editor.waitFor({state:'hidden'});else{await editor.waitFor();assert.equal(await page.getByTestId('service-save-toast').count(),0);}
  return body.record;
 }
 const records={};
 for(const [type,label] of Object.entries(labels)){
  await page.getByRole('button',{name:'新增跟进',exact:true}).click();
  await choose('业务类型',label,label);
  await choose('记录所属客户','ALPHA','SYN-A17 · 合成远航眼镜 Alpha');
  assert.equal(await editor.locator('input[required]').count(),1,'Only the customer selection is required for a new followup');
  records[type]=await save();assert(records[type].title.includes(alpha.customer));assert.equal(records[type].type,type);
 }
 const pending=records.receivable;assert.equal(pending.details.amount,'');assert.equal(pending.balanceCents,null);assert.equal(pending.details.invoiceNo,'');assert.equal(pending.details.currency,'USD');assert(!Object.hasOwn(pending.details,'amountCents'));
 await page.getByRole('button',{name:pending.title,exact:true}).click();
 const amount=editor.getByRole('spinbutton',{name:'应收金额',exact:true});assert.equal(await amount.inputValue(),'');assert(!(await amount.evaluate(n=>n.required)));
 assert(await editor.getByRole('button',{name:'登记已确认到账',exact:true}).isDisabled());
 await amount.fill('25.50');const confirmed=await save();assert.equal(confirmed.details.amountCents,2550);assert.equal(confirmed.balanceCents,2550);
 await page.getByRole('button',{name:pending.title,exact:true}).click();assert.equal(await amount.inputValue(),'25.50');
 assert(await editor.getByRole('button',{name:'登记已确认到账',exact:true}).isEnabled());
 await editor.getByRole('button',{name:'关闭客服业务编辑',exact:true}).click();
 const shipment=records.shipment;assert(!Object.hasOwn(shipment.details,'quantity'));
 await page.getByRole('button',{name:shipment.title,exact:true}).click();await choose('处理状态','已完','已完成');await save(400);
 await editor.getByLabel('出货数量（副）',{exact:true}).fill('1');await editor.getByLabel('出货日期',{exact:true}).fill('2026-10-10');
 assert.equal((await save()).status,'done');
 const check=new DatabaseSync(path.join(dir,'workspace.sqlite'),{readOnly:true});assert.deepEqual(check.prepare("SELECT id,data FROM records WHERE kind='customer_account' ORDER BY id").all(),originals);check.close();assert.deepEqual(errors,[]);
 await page.screenshot({path:'test-output/service-optional-fields.png',fullPage:true});
 console.log('PASS six record types save with only customer/type; generated titles, blank invoice/amount/quantity, unknown not zero, supplement retained, financial and shipment completion gates, original customer records unchanged');
}catch(error){
 if(browser){const pages=browser.contexts()[0].pages();await pages[0]?.screenshot({path:'test-output/service-search-failure.png',fullPage:true});console.error((await pages[0]?.locator('body').innerText())?.slice(-2400));}throw error;
}finally{
 await browser?.close();server.kill('SIGTERM');await done;
 if(errors.length)console.error(errors);
 if(process.exitCode)console.error(logs);
}
