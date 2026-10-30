// Quote request handoff acceptance. Test environment, synthetic records only.
// Build into test-output and provide DOON_PLAYWRIGHT_MODULE when not installed locally.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {spawn,execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const output=path.resolve('test-output'),dist=path.resolve(process.env.DOON_BUILD_DIR||'test-output/quote-request-build');
assert(dist.startsWith(output+path.sep),'Use a build inside test-output; never production lan-dist.');
await fs.mkdir(output,{recursive:true});
const root=await fs.mkdtemp(path.join(output,'quote-request-browser-'));
const listener=createServer();await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(0,'127.0.0.1',resolve);});
const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));assert.notEqual(port,8787);
const origin=`http://127.0.0.1:${port}`;
const env={...process.env,DOON_DATA_DIR:root,DOON_BUILD_DIR:dist,DOON_HOST:'127.0.0.1',DOON_PORT:String(port),DOON_SERVER_MODE:'internal',DOON_REVIEW_MODE:'0',DOON_NO_AUTO_BACKUP:'1',DOON_TLS_CERT:'',DOON_TLS_KEY:'',DOON_EMPLOYEE_PUBLIC_ORIGIN:'',DOON_STUDIO_SCHEDULES_ENABLED:'0',DOON_IE_MAIL_ENABLED:'0'};
execFileSync(process.execPath,[path.join(dist,'manage.mjs'),'init'],{env,stdio:'pipe',windowsHide:true});
const initial=(await fs.readFile(path.join(root,'管理员首次登录.txt'),'utf8')).match(/初始密码：([^\n]+)/)[1];
const password='Synthetic-Rfq-Personal-2026!',firstPassword='Synthetic-Rfq-Initial-2026!';
const sessions={admin:{cookie:''},sales:{cookie:''},engineer:{cookie:''},other:{cookie:''}};
const errors=[],checks=[],pass=message=>{checks.push(message);console.log('PASS '+message);};
let server,browser,logs='';
async function request(route,body,session=sessions.admin){
 const response=await fetch(origin+'/api/'+route,{method:body===undefined?'GET':'POST',headers:{Origin:origin,...(session.cookie?{Cookie:session.cookie}:{}),...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});
 if(response.headers.get('set-cookie'))session.cookie=response.headers.get('set-cookie').split(';')[0];return response;
}
async function api(route,body,session){const response=await request(route,body,session),result=await response.json();assert.equal(response.status,200,route+': '+JSON.stringify(result));return result;}
async function postResponse(page,action,click){const pending=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/workspace/'+action&&response.request().method()==='POST');await click();const response=await pending,result=await response.json();assert.equal(response.status(),200,action+': '+JSON.stringify(result));return result;}
async function loginPage(username){
 const context=await browser.newContext({viewport:{width:1510,height:1080},acceptDownloads:true}),page=await context.newPage();
 page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 await page.goto(origin);await page.getByLabel('登录账号',{exact:true}).fill(username);await page.getByLabel('登录密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await page.waitForURL('**/personal-tasks');await page.locator('.workspace').waitFor();return page;
}
try{
 server=spawn(process.execPath,[path.join(dist,'server.mjs')],{env,stdio:'pipe',windowsHide:true});server.stdout.on('data',value=>logs+=value);server.stderr.on('data',value=>logs+=value);
 let ready=false;for(let i=0;i<100;i++){if(server.exitCode!==null)break;try{if((await fetch(origin+'/health')).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}assert(ready,'Synthetic test server did not start.');
 await api('auth/login',{username:'admin',password:initial});await api('auth/password',{currentPassword:initial,password});
 const actors={};
 for(const [key,name,role] of [['sales','合成业务员','sales'],['engineer','合成 IE 工程师','production'],['reviewer','合成生产复核','production'],['other','合成无关工程师','production']]){
  actors[key]=await api('auth/accounts',{username:'rfq_'+key,name,role,password:firstPassword,customers:[],departments:[]});
  if(sessions[key]){await api('auth/login',{username:'rfq_'+key,password:firstPassword},sessions[key]);await api('auth/password',{currentPassword:firstPassword,password},sessions[key]);}
 }
 const adminMember=(await api('workspace/data')).me;
 const account=(await api('workspace/customer-save',{customer:'SYNTHETIC RFQ CUSTOMER',customerCode:'SYN-RFQ',salesName:'合成业务员',serviceName:'',salesMemberIds:[actors.sales.memberId],quoteMemberIds:[actors.sales.memberId],active:true})).item;
 await api('workspace/customer-quote-access-update',{expectedPolicySha256:null,memberIds:[actors.sales.memberId],aliasesByMember:{},customerMemberIds:{[account.id]:[actors.sales.memberId]},token:crypto.randomUUID()});
 await api('workspace/ie-quote-policy',{version:0,engineerMemberId:actors.engineer.memberId,reviewerMemberId:actors.reviewer.memberId,finalApproverMemberId:adminMember.id,token:crypto.randomUUID()});
 const legacy=(await api('workspace/process-save',{type:'rfq',customerId:account.id,title:'Synthetic legacy RFQ record',token:crypto.randomUUID()})).record;
 assert(legacy?.id);
 const {chromium}=await import(process.env.DOON_PLAYWRIGHT_MODULE?pathToFileURL(process.env.DOON_PLAYWRIGHT_MODULE).href:'playwright');
 browser=await chromium.launch({headless:true,...(process.env.DOON_CHROMIUM_PATH?{executablePath:process.env.DOON_CHROMIUM_PATH}:{channel:'chrome'}),args:['--no-proxy-server']});
 const sales=await loginPage('rfq_sales');await sales.goto(origin+'/process-workspace?tab=rfq');
 await sales.getByRole('button',{name:'新增报价需求',exact:true}).click();
 await sales.getByLabel('需求名称',{exact:true}).fill('合成眼镜报价需求');
 await sales.getByLabel('关联客户',{exact:true}).selectOption(account.id);
 await sales.getByLabel('报价截止日',{exact:true}).fill('2027-01-31');
 const sourceText='测试环境，不含正式业务数据。\n客户原文：请核算合成钛架及电镀，不含包装。\n量产交期与模具费用请单列。';
 await sales.getByLabel('客户需求原文',{exact:true}).fill(sourceText);
 await sales.getByLabel('款号 · 第 1 行',{exact:true}).fill('SYN-RFQ-FRAME');
 await sales.getByLabel('数量 · 第 1 行',{exact:true}).fill('300');
 let saved=await postResponse(sales,'quote-request-save',()=>sales.getByRole('button',{name:'保存草稿',exact:true}).click());
 let record=saved.request;assert.equal(record.requirementText,sourceText);assert.equal(record.lines[0].model,'SYN-RFQ-FRAME');assert.equal(record.lines[0].quantity,300);
 const sourceBytes=Buffer.from('Synthetic quotation attachment. Test environment only.\nModel SYN-RFQ-FRAME; quantity 300.\n');
 saved=await postResponse(sales,'quote-request-upload',()=>sales.getByLabel('报价需求附件',{exact:true}).setInputFiles({name:'synthetic-rfq-requirements.txt',mimeType:'text/plain',buffer:sourceBytes}));record=saved.request;assert.equal(record.attachments.length,1);
 const originalVersion=record.version;
 saved=await postResponse(sales,'quote-request-submit',()=>sales.getByRole('button',{name:'发送给 IE 工程师',exact:true}).click());record=saved.request;assert.equal(record.status,'submitted');assert(record.version>originalVersion);
 await sales.screenshot({path:path.join(root,'01-business-submitted.png'),fullPage:true});
 pass('业务在需求表填写款号、数量、原文并上传 TXT 原件后提交给已绑定 IE 工程师。');
 assert.equal((await api('workspace/quote-request-data?mine=1',undefined,sessions.other)).requests.length,0);
 const denied=await request('workspace/quote-request-detail?id='+encodeURIComponent(record.id),undefined,sessions.other);assert.equal(denied.status,403);
 const engineer=await loginPage('rfq_engineer');
 const todo=engineer.getByRole('region',{name:'报价需求待办'});await todo.getByText(record.title,{exact:true}).waitFor();
 await engineer.screenshot({path:path.join(root,'02-ie-personal-todo.png'),fullPage:true});
 pass('工程师真实登录后落在我的待办并看见需求；无关工程账号没有任务和详情权限。');
 await todo.getByRole('button',{name:'查看需求',exact:true}).click();
 await engineer.getByLabel('客户需求原文',{exact:true}).waitFor();assert.equal(await engineer.getByLabel('客户需求原文',{exact:true}).inputValue(),sourceText);
 const download=engineer.waitForEvent('download');await engineer.getByRole('link',{name:/synthetic-rfq-requirements\.txt/}).click();const downloaded=await download,filename=path.join(root,'downloaded-source.txt');await downloaded.saveAs(filename);assert.deepEqual(await fs.readFile(filename),sourceBytes);
 saved=await postResponse(engineer,'quote-request-start',()=>engineer.getByRole('button',{name:'开始报价',exact:true}).click());record=saved.request;assert(record.ieQuoteId);assert.equal(record.status,'quoting');
 await engineer.waitForURL('**/ie-quotes*');await engineer.locator('.ieq-product-tabs').getByRole('button').filter({hasText:'SYN-RFQ-FRAME'}).waitFor();
 const detail=(await api('workspace/ie-quote?id='+encodeURIComponent(record.ieQuoteId),undefined,sessions.engineer)).quote;assert.equal(detail.customerAccountId,account.id);assert.equal(detail.lines[0].model,'SYN-RFQ-FRAME');assert.equal(detail.lines[0].quantityMin,300);
 await engineer.screenshot({path:path.join(root,'03-engineering-quote.png'),fullPage:true});
 pass('工程师从待办查看需求和附件原件，开始报价后进入带出客户、款号、数量的工程报价草稿。');
 const repeated=await api('workspace/quote-request-start',{id:record.id,version:record.version,token:crypto.randomUUID()},sessions.engineer);assert.equal(repeated.request.ieQuoteId,record.ieQuoteId);
 const quotes=(await api('workspace/ie-quotes',undefined,sessions.engineer)).quotes;assert.equal(quotes.length,1);
 const finalRecord=(await api('workspace/quote-request-detail?id='+encodeURIComponent(record.id),undefined,sessions.sales)).request;assert.equal(finalRecord.ieQuoteId,record.ieQuoteId);assert.equal(finalRecord.requirementText,sourceText);assert.equal(finalRecord.attachments.length,1);
 const original=(await api('workspace/process-data?type=rfq')).records.find(row=>row.id===legacy.id);assert.equal(original.version,legacy.version);assert.equal(original.title,legacy.title);
 await sales.getByRole('button',{name:'原询价评估记录',exact:true}).click();await sales.locator('.process-list').getByText(legacy.title,{exact:true}).waitFor();
 assert.deepEqual(errors,[]);pass('重复开始不重复建报价，业务端关联同一报价，原需求附件和旧询价评估记录保持完整，页面无运行错误。');
 const result={environment:'测试环境，不含正式业务数据',passed:checks.length,checks,root,port,at:new Date().toISOString()};await fs.writeFile(path.join(root,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({passed:checks.length,root}));
}catch(error){
 for(const [index,context] of (browser?.contexts()||[]).entries()){const page=context.pages()[0];if(page){await page.screenshot({path:path.join(root,`failure-${index}.png`),fullPage:true}).catch(()=>{});await fs.writeFile(path.join(root,`failure-${index}.txt`),await page.locator('body').innerText().catch(()=>''));}}
 await fs.writeFile(path.join(root,'server.log'),logs);console.error('Synthetic evidence: '+root);throw error;
}finally{await browser?.close();if(server&&server.exitCode===null){server.kill();await new Promise(resolve=>{server.once('exit',resolve);setTimeout(resolve,3000).unref();});}}
