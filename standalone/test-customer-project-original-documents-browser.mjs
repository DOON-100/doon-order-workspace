// Synthetic records, accounts and file bytes only; isolated DB and an ephemeral loopback port.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createServer} from 'node:net';
import {pathToFileURL} from 'node:url';
import {verifyCustomerPriceBuildEvidence} from '../scripts/customer-price-build-evidence.mjs';

const dist=path.resolve(process.env.DOON_BUILD_DIR||'test-output/customer-project-build');
const evidence=await verifyCustomerPriceBuildEvidence(dist);
await fs.mkdir(path.resolve('test-output'),{recursive:true});
const dir=await fs.mkdtemp(path.resolve('test-output/customer-project-original-documents-browser-'));
assert(dir.startsWith(path.resolve('test-output')+path.sep));
const probe=createServer();
const port=await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',()=>{const assigned=probe.address().port;probe.close(error=>error?reject(error):resolve(assigned));});});
const origin='http://127.0.0.1:'+port;
const env={...process.env,DOON_DATA_DIR:dir,DOON_HOST:'127.0.0.1',DOON_PORT:String(port),DOON_NO_AUTO_BACKUP:'1'};
execFileSync(process.execPath,[path.join(dist,'manage.mjs'),'init'],{env,stdio:'pipe',windowsHide:true});
const password=(await fs.readFile(path.join(dir,'管理员首次登录.txt'),'utf8')).match(/初始密码：([^\n]+)/)[1];
const server=spawn(process.execPath,[path.join(dist,'server.mjs')],{env,stdio:'pipe',windowsHide:true});
let logs='',cookie='',browser,page;
server.stdout.on('data',()=>{});server.stderr.on('data',bytes=>logs+=bytes);
const checks=[],errors=[],pass=name=>{checks.push(name);console.log('PASS '+name);};
const token=()=>crypto.randomUUID();
const fixtureFiles=[
 {name:'synthetic-original.txt',mimeType:'text/plain',buffer:Buffer.from('Synthetic customer communication\r\n合成原始需求：保留原文与换行。\n','utf8')},
 {name:'synthetic-original.unknownformat',mimeType:'application/octet-stream',buffer:Buffer.from([0,255,19,0,76,65,78,10,128,33,42,13,10])},
 {name:'synthetic-selected-round.pptx',mimeType:'application/vnd.openxmlformats-officedocument.presentationml.presentation',buffer:Buffer.from('Synthetic opaque presentation bytes; store without parsing.\n')},
];
const legacyFile={name:'synthetic-existing-drawing.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n% Synthetic legacy project document\n%%EOF\n')};
async function api(route,body,expected=200){
 const response=await fetch(origin+'/api/'+route,{method:body===undefined?'GET':'POST',headers:{Origin:origin,Cookie:cookie,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});
 if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
 const data=await response.json();assert.equal(response.status,expected,route+' '+JSON.stringify(data));return data;
}
const workspace=(action,body,expected)=>api('workspace/'+action,body,expected);
async function contextFor(actorCookie){
 const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
 const split=actorCookie.indexOf('=');
 await context.addCookies([{name:actorCookie.slice(0,split),value:actorCookie.slice(split+1),url:origin,httpOnly:true,sameSite:'Strict'}]);
 const actorPage=await context.newPage();actorPage.on('pageerror',error=>errors.push(error.message));actorPage.on('dialog',dialog=>dialog.accept());
 return {context,page:actorPage};
}
async function openProject(actorPage,title){
 await actorPage.goto(origin+'/customer-projects');
 await actorPage.getByRole('heading',{name:'客户项目开发',exact:true}).waitFor();
 const row=actorPage.getByRole('row').filter({hasText:title});await row.waitFor();
 await row.getByRole('button',{name:'打开项目',exact:true}).click();
 await actorPage.getByTestId('customer-project-original-communication').waitFor();
}
const originalSection=actorPage=>actorPage.getByTestId('customer-project-original-communication');
async function uploadOriginal(actorPage,file,note){
 await originalSection(actorPage).getByRole('button',{name:'上传原始文档',exact:true}).click();
 const dialog=actorPage.getByRole('dialog',{name:'上传原始沟通文档',exact:true});
 const input=dialog.getByLabel('选择原始文档',{exact:false});
 assert(['',null].includes(await input.getAttribute('accept')),'Original files must not be restricted to the old extension allowlist');
 await input.setInputFiles(file);await dialog.getByLabel('文档说明',{exact:true}).fill(note);
 await dialog.getByRole('button',{name:'上传原始文档',exact:true}).click();
 await dialog.waitFor({state:'hidden'});
 await originalSection(actorPage).getByRole('row').filter({hasText:file.name}).waitFor();
}
async function downloadOriginal(actorPage,file,suffix){
 const row=originalSection(actorPage).getByRole('row').filter({hasText:file.name});
 const pending=actorPage.waitForEvent('download');
 await row.getByRole('link',{name:'下载原始文档',exact:true}).click();
 const downloaded=await pending;assert.equal(downloaded.suggestedFilename(),file.name);
 const filename=path.join(dir,suffix+'-'+file.name);await downloaded.saveAs(filename);
 assert.deepEqual(await fs.readFile(filename),file.buffer,'Downloaded bytes changed');
}
try{
 let ready=false;
 for(let attempt=0;attempt<100;attempt++){try{if((await fetch(origin+'/health')).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
 assert(ready,'Isolated server did not start');
 await api('auth/login',{username:'admin',password});
 await api('auth/password',{currentPassword:password,password:'Synthetic-Original-Admin-2026!'});
 const admin=(await workspace('data')).me,adminCookie=cookie;
 await api('auth/accounts',{username:'synthetic_original_reader',name:'合成原件只读人员',role:'finance',password:'Synthetic-Original-Reader-Initial-2026!',customers:[]});
 await api('auth/login',{username:'synthetic_original_reader',password:'Synthetic-Original-Reader-Initial-2026!'});
 await api('auth/password',{currentPassword:'Synthetic-Original-Reader-Initial-2026!',password:'Synthetic-Original-Reader-Personal-2026!'});
 const reader=(await workspace('data')).me,readerCookie=cookie;cookie=adminCookie;
 for(const [code,name,serviceIds] of [['SYNTH-DOC-A','合成原件客户甲',[reader.id]],['SYNTH-DOC-B','合成原件客户乙',[]]])await workspace('customer-save',{customer:name,customerCode:code,salesName:admin.name,serviceName:'',pmcName:'',salesMemberIds:[admin.id],serviceMemberIds:serviceIds,quoteMemberIds:[],notes:'Synthetic original documents browser fixture',active:true});
 const customers=(await workspace('data')).customerAccounts;
 const projectA=(await workspace('customer-project-save',{token:token(),customerId:customers.find(row=>row.customerCode==='SYNTH-DOC-A').id,code:'SYNTH-DOC-A',title:'合成原始文档项目甲',salesMemberId:admin.id})).item;
 const projectB=(await workspace('customer-project-save',{token:token(),customerId:customers.find(row=>row.customerCode==='SYNTH-DOC-B').id,code:'SYNTH-DOC-B',title:'合成原始文档项目乙',salesMemberId:admin.id})).item;
 assert.equal((await workspace('customer-project-data')).rounds.length,0);
 const playwright=await import(process.env.DOON_PLAYWRIGHT_MODULE?pathToFileURL(process.env.DOON_PLAYWRIGHT_MODULE).href:'playwright');
 browser=await playwright.chromium.launch({headless:true,...(process.env.DOON_CHROMIUM_PATH?{executablePath:process.env.DOON_CHROMIUM_PATH}:{channel:'chrome'}),args:['--no-proxy-server']});
 const adminSession=await contextFor(adminCookie);page=adminSession.page;
 await openProject(page,projectA.title);
 const originalHeading=page.getByRole('heading',{name:'原始沟通文档',exact:true});
 const itemHeading=page.getByRole('heading',{name:'项目款色子项',exact:true});
 assert(await originalHeading.evaluate((heading,items)=>!!(heading.compareDocumentPosition(items)&Node.DOCUMENT_POSITION_FOLLOWING),await itemHeading.elementHandle()),'Original communication must appear before project items');
 assert.equal(await originalSection(page).getByRole('button',{name:'上传原始文档',exact:true}).isEnabled(),true);
 pass('需求页原始沟通文档位于款色子项之前，无轮次也可上传');

 await uploadOriginal(page,fixtureFiles[0],'合成文字来往原件');
 await uploadOriginal(page,fixtureFiles[1],'合成未知扩展名原件');
 const uploaded=(await workspace('customer-project-data')).attachments.filter(row=>row.projectId===projectA.id);
 assert.equal(uploaded.length,2);
 for(const item of uploaded){assert.equal(item.category,'original-communication');assert.equal(item.roundId,'');}
 for(const file of fixtureFiles.slice(0,2))await downloadOriginal(page,file,'initial');
 const unknownAttachment=uploaded.find(row=>row.filename===fixtureFiles[1].name);assert(unknownAttachment);
 const response=await fetch(origin+'/api/workspace/customer-project-file?id='+encodeURIComponent(unknownAttachment.id),{headers:{Cookie:adminCookie}});
 assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/^attachment;/i);assert.equal(response.headers.get('x-content-type-options'),'nosniff');
 assert.deepEqual(Buffer.from(await response.arrayBuffer()),fixtureFiles[1].buffer);
 pass('文字和未知格式通过真实表单上传为项目级原件，下载文件名与字节完全一致');

 await openProject(page,projectA.title);
 for(const file of fixtureFiles.slice(0,2))await originalSection(page).getByRole('row').filter({hasText:file.name}).waitFor();
 const item=(await workspace('customer-project-item-save',{token:token(),projectId:projectA.id,model:'SYNTH-DOC-MODEL',quantity:2})).item;
 const rounds=[];
 for(const title of ['合成文档轮次一','合成文档轮次二'])rounds.push((await workspace('customer-project-round-save',{token:token(),projectId:projectA.id,title,type:'development',scope:[{itemId:item.id,quantity:1}],stage:'requirements',requiredDrawingTypes:[],requireQuote:false,sampleGateStage:'not_required'})).item);
 await openProject(page,projectA.title);
 for(const round of rounds){
  await page.locator('.cp-round-bar select').selectOption(round.id);
  for(const file of fixtureFiles.slice(0,2))assert.equal(await originalSection(page).getByRole('row').filter({hasText:file.name}).count(),1);
 }
 await uploadOriginal(page,fixtureFiles[2],'选择轮次后仍按项目保存');
 const presentation=(await workspace('customer-project-data')).attachments.find(row=>row.filename===fixtureFiles[2].name);
 assert.equal(presentation.roundId,'');assert.equal(presentation.category,'original-communication');
 await page.locator('.cp-round-bar select').selectOption(rounds[0].id);
 for(const file of fixtureFiles)assert.equal(await originalSection(page).getByRole('row').filter({hasText:file.name}).count(),1);
 await page.screenshot({path:path.join(dir,'original-documents-desktop.png'),fullPage:true});
 pass('刷新及切换开发轮次保留项目原件，选中轮次后上传PPTX仍不绑定轮次');

 await openProject(page,projectB.title);
 for(const file of fixtureFiles)assert.equal(await originalSection(page).getByRole('row').filter({hasText:file.name}).count(),0);
 await openProject(page,projectA.title);
 for(const file of fixtureFiles)await originalSection(page).getByRole('row').filter({hasText:file.name}).waitFor();
 pass('切换到另一客户项目不显示原项目文档，切回后原件仍可见');

 await page.getByRole('button',{name:'图纸与客批',exact:true}).click();
 await page.getByRole('button',{name:'上传原件',exact:true}).click();
 const legacyDialog=page.getByRole('dialog',{name:'上传项目原件',exact:true});
 await legacyDialog.getByLabel('选择文件',{exact:false}).setInputFiles(legacyFile);
 await legacyDialog.getByLabel('附件说明',{exact:true}).fill('合成旧图纸资料原件');
 await legacyDialog.getByRole('button',{name:'保存记录',exact:true}).click();await legacyDialog.waitFor({state:'hidden'});
 const legacyRow=page.getByRole('row').filter({hasText:legacyFile.name});await legacyRow.waitFor();
 for(const file of fixtureFiles)assert.equal(await page.getByRole('row').filter({hasText:file.name}).count(),0,'Original communications must not clutter the drawing attachment list');
 const legacyDownload=page.waitForEvent('download');await legacyRow.getByRole('link',{name:/下载原件/}).click();
 const legacyResult=await legacyDownload;const legacyPath=path.join(dir,'downloaded-legacy.pdf');await legacyResult.saveAs(legacyPath);assert.deepEqual(await fs.readFile(legacyPath),legacyFile.buffer);
 await page.getByRole('button',{name:'需求与款色',exact:true}).click();
 assert.equal(await originalSection(page).getByRole('row').filter({hasText:legacyFile.name}).count(),0);
 pass('原图纸资料上传及下载继续可用，两类资料在各自区域显示');

 const readerSession=await contextFor(readerCookie);const readerPage=readerSession.page;
 await openProject(readerPage,projectA.title);
 const readerUpload=originalSection(readerPage).getByRole('button',{name:'上传原始文档',exact:true});
 assert((await readerUpload.count())===0||await readerUpload.isDisabled(),'Read-only account must not upload');
 const readerEdit=originalSection(readerPage).getByRole('button',{name:'修改说明',exact:true});
 for(let index=0;index<await readerEdit.count();index++)assert.equal(await readerEdit.nth(index).isDisabled(),true);
 await downloadOriginal(readerPage,fixtureFiles[0],'readonly');
 cookie=readerCookie;
 const readerData=await workspace('customer-project-data');assert.equal(readerData.projects.find(row=>row.id===projectA.id).canWrite,false);assert(!readerData.projects.some(row=>row.id===projectB.id));
 const forged=new FormData();forged.set('projectId',projectA.id);forged.set('roundId','');forged.set('category','original-communication');forged.set('file',new File([Buffer.from('Synthetic forbidden upload')],'forbidden.txt',{type:'text/plain'}));
 await workspace('customer-project-attachment',forged,403);cookie=adminCookie;
 assert.equal((await workspace('customer-project-data')).attachments.filter(row=>row.category==='original-communication').length,3);
 await readerPage.screenshot({path:path.join(dir,'original-documents-readonly.png'),fullPage:true});
 await readerSession.context.close();
 pass('只读客户责任人员可下载原件但无上传或修改入口能力，直接伪造上传也被拒绝');

 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(dir,'original-documents-mobile.png'),fullPage:true});
 assert.equal(errors.length,0,errors.join('\n'));pass('原件相关页面无浏览器脚本错误');
 const report={passed:checks.length,checks,errors,manifestSha256:evidence.manifestSha256,at:new Date().toISOString(),artifacts:dir};
 await fs.writeFile('test-output/customer-project-original-documents-browser-result.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({passed:checks.length,manifestSha256:evidence.manifestSha256,artifacts:dir}));
}catch(error){
 await fs.writeFile(path.join(dir,'failure-log.txt'),logs);
 if(page){await page.screenshot({path:path.join(dir,'failure.png'),fullPage:true}).catch(()=>{});await fs.writeFile(path.join(dir,'failure-ui.txt'),await page.locator('body').ariaSnapshot().catch(()=>''));}
 console.error('Browser artifacts:',dir);throw error;
}finally{if(browser)await browser.close();server.kill();}
