// Synthetic fixtures only. Uses an isolated database and a nonproduction port.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {verifyCustomerPriceBuildEvidence} from '../scripts/customer-price-build-evidence.mjs';
const dist=path.resolve(process.env.DOON_BUILD_DIR||'test-output/engineering-drawing-build');
await verifyCustomerPriceBuildEvidence(dist);
const dir=await fs.mkdtemp(path.resolve('test-output/engineering-browser-'));
const origin='http://127.0.0.1:18808',env={...Object.fromEntries(Object.entries(process.env).filter(([name])=>!/^DOON_KINGDEE_/i.test(name))),DOON_KINGDEE_SUPPLIER_SYNC_ENABLED:'0',DOON_KINGDEE_READONLY_ENABLED:'0',DOON_DATA_DIR:dir,DOON_HOST:'127.0.0.1',DOON_PORT:'18808',DOON_NO_AUTO_BACKUP:'1'};
execFileSync(process.execPath,[path.join(dist,'manage.mjs'),'init'],{env,stdio:'pipe',windowsHide:true});
const password=(await fs.readFile(path.join(dir,'管理员首次登录.txt'),'utf8')).match(/初始密码：([^\n]+)/)[1];
const server=spawn(process.execPath,[path.join(dist,'server.mjs')],{env,stdio:'pipe',windowsHide:true});
let cookie='',browser,logs='';server.stderr.on('data',b=>logs+=b);
const checks=[],errors=[];
function pass(name){checks.push(name);console.log('PASS '+name);}
async function api(route,body){const res=await fetch(origin+'/api/'+route,{method:body===undefined?'GET':'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];const value=await res.json();assert.equal(res.status,200,JSON.stringify(value));return value;}
try{
 for(let i=0;i<80;i++){try{if((await fetch(origin+'/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 await api('auth/login',{username:'admin',password});await api('auth/password',{currentPassword:password,password:'Synthetic-Engineering-2026!'});
 const admin=(await api('workspace/data')).me;
 await api('workspace/customer-save',{customer:'合成工程客户',customerCode:'SYN-DRAW',salesName:admin.name,serviceName:admin.name,pmcName:'',salesMemberIds:[admin.id],serviceMemberIds:[admin.id],quoteMemberIds:[],notes:'Synthetic fixture',active:true});
 const customer=(await api('workspace/data')).customerAccounts.find(c=>c.customerCode==='SYN-DRAW');
 const playwright=await import(process.env.DOON_PLAYWRIGHT_MODULE?pathToFileURL(process.env.DOON_PLAYWRIGHT_MODULE).href:'playwright');
 browser=await playwright.chromium.launch({headless:true,channel:'chrome',args:['--no-proxy-server']});
 const context=await browser.newContext({viewport:{width:1600,height:1100}});
 await context.addInitScript(()=>Object.defineProperty(Crypto.prototype,'randomUUID',{value:undefined,configurable:true}));
 const split=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),url:origin,httpOnly:true,sameSite:'Strict'}]);
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto(origin+'/engineering-drawings');await page.getByRole('button',{name:'画图跟进表',exact:true}).click();await page.getByRole('heading',{name:'工程画图跟进表',exact:true}).waitFor();
 await page.getByRole('button',{name:'新增画图需求',exact:true}).click();
 await page.getByLabel('关联客户档案',{exact:true}).selectOption(customer.id);
 await page.getByLabel('新款数量',{exact:true}).fill('2');
 await page.getByLabel('需求说明',{exact:true}).fill('合成测试工程需求：两款镜架正视图与侧视图。');
 await page.getByRole('button',{name:'保存跟进',exact:true}).click();
 await page.getByText('跟进已保存。',{exact:true}).waitFor();
 let state=await api('workspace/drawing-data');assert.equal(state.records.length,1);assert.equal(state.records[0].newCount,2);assert.equal(state.records[0].revisionCount,null);pass('浏览器新增需求入共享数据库，空数量保留为缺失');
 await page.getByLabel('分配中台成员',{exact:true}).selectOption(admin.id);
 await page.getByLabel('款号',{exact:true}).fill('SYN-MODEL-A / SYN-MODEL-B');
 await page.getByLabel('完成日期',{exact:true}).fill(new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}));
 await page.getByLabel('跟进状态',{exact:true}).selectOption('待审核');
 await page.getByRole('button',{name:'保存跟进',exact:true}).click();
 await page.getByText('当前版本已保存',{exact:false}).waitFor();
 await page.getByLabel('审核意见',{exact:true}).fill('合成审图：尺寸与结构资料齐全');
 await page.getByRole('button',{name:'审核通过',exact:true}).click();await page.getByText('审核已通过。',{exact:true}).waitFor();
 state=await api('workspace/drawing-data');assert.equal(state.records[0].status,'已完成');assert.equal(state.records[0].approvalBy,admin.id);pass('浏览器送审及审批记下实际审核账号');
 await page.getByLabel('下游接收部门',{exact:true}).fill('合成打样组');
 await page.getByLabel('交接日期',{exact:true}).fill(new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}));
 await page.getByLabel('交接说明与图纸存放位置',{exact:true}).fill('合成记录：由客服接收图纸用于打样。');
 await page.getByLabel('跟进状态',{exact:true}).selectOption('已交接');await page.getByRole('button',{name:'保存跟进',exact:true}).click();await page.getByText('跟进已保存。',{exact:true}).waitFor();
 state=await api('workspace/drawing-data');assert.equal(state.records[0].status,'已交接');pass('完成到下游交接的表单流程可用');
 await page.getByRole('button',{name:'查看修改历史',exact:true}).click();await page.getByText(/第 1 版 · 新建画图需求/).waitFor();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出当前列表',exact:true}).click();const file=await download;await file.saveAs(path.join(dir,'drawing-export.csv'));const csv=await fs.readFile(path.join(dir,'drawing-export.csv'),'utf8');assert.match(csv,/SYN-MODEL-A/);pass('可查看原版本并导出授权筛选列表');
 await page.getByRole('button',{name:'关闭画图详情',exact:true}).click();await page.screenshot({path:path.join(dir,'engineering-desktop.png'),fullPage:true});
 await page.setViewportSize({width:760,height:1050});await page.screenshot({path:path.join(dir,'engineering-narrow.png'),fullPage:true});
 assert.deepEqual(errors,[]);pass('工程页面无浏览器脚本错误，已生成桌面与窄屏截图');
 await fs.writeFile('test-output/engineering-browser-result.json',JSON.stringify({checks,passed:checks.length,screenshotDirectory:dir},null,2));
 console.log('SCREENSHOTS '+dir);
}finally{await browser?.close();server.kill();await new Promise(resolve=>server.once('exit',resolve));}
