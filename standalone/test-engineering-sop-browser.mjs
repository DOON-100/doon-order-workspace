// Synthetic SOP/MES closure regression against a staging build, never production.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {verifyCustomerPriceBuildEvidence} from '../scripts/customer-price-build-evidence.mjs';

const dist=path.resolve(process.env.DOON_BUILD_DIR||'test-output/engineering-drawing-build');
await verifyCustomerPriceBuildEvidence(dist);
await fs.mkdir(path.resolve('test-output'),{recursive:true});
const dir=await fs.mkdtemp(path.resolve('test-output/engineering-sop-browser-'));
const origin='http://127.0.0.1:18809',env={...Object.fromEntries(Object.entries(process.env).filter(([name])=>!/^DOON_KINGDEE_/i.test(name))),DOON_KINGDEE_SUPPLIER_SYNC_ENABLED:'0',DOON_KINGDEE_READONLY_ENABLED:'0',DOON_DATA_DIR:dir,DOON_HOST:'127.0.0.1',DOON_PORT:'18809',DOON_NO_AUTO_BACKUP:'1'};
execFileSync(process.execPath,[path.join(dist,'manage.mjs'),'init'],{env,stdio:'pipe',windowsHide:true});
const initialPassword=(await fs.readFile(path.join(dir,'管理员首次登录.txt'),'utf8')).match(/初始密码：([^\n]+)/)[1];
const server=spawn(process.execPath,[path.join(dist,'server.mjs')],{env,stdio:'pipe',windowsHide:true});
let browser,logs='';server.stdout.on('data',()=>{});server.stderr.on('data',bytes=>logs+=bytes);
const checks=[],errors=[],pass=name=>{checks.push(name);console.log('PASS '+name);};
const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
async function api(route,body,session,expected=200){
 const response=await fetch(origin+'/api/'+route,{method:body===undefined?'GET':'POST',headers:{Origin:origin,...(session?.cookie?{Cookie:session.cookie}:{}),...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});
 if(session&&response.headers.get('set-cookie'))session.cookie=response.headers.get('set-cookie').split(';')[0];
 const value=await response.json();if(Array.isArray(expected))assert(expected.includes(response.status),route+' '+response.status+' '+JSON.stringify(value));else assert.equal(response.status,expected,route+' '+JSON.stringify(value));return value;
}
const workspace=(action,body,session,expected)=>api('workspace/'+action,body,session,expected);
async function clickMutation(page,action,button){
 const waiting=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/workspace/'+action&&response.request().method()==='POST');
 await button.click();const response=await waiting,value=await response.json();assert.equal(response.status(),200,action+' '+JSON.stringify(value));return value;
}
async function browserSession(session){
 const context=await browser.newContext({viewport:{width:1600,height:1100}}),split=session.cookie.indexOf('=');
 await context.addInitScript(()=>Object.defineProperty(Crypto.prototype,'randomUUID',{value:undefined,configurable:true}));
 await context.addCookies([{name:session.cookie.slice(0,split),value:session.cookie.slice(split+1),url:origin,httpOnly:true,sameSite:'Strict'}]);
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 await page.goto(origin+'/engineering-drawings');return {context,page};
}
function pdfBytes(label){
 const stream=`BT /F1 14 Tf 40 120 Td (${label.replace(/[()\\]/g,'')}) Tj ET`;
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
 let output='%PDF-1.4\n',offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(output));output+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
 const xref=Buffer.byteLength(output);output+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;return Buffer.from(output);
}

try{
 let healthy=false;for(let i=0;i<80;i++){try{if((await fetch(origin+'/health')).ok){healthy=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
 assert(healthy,'Isolated SOP server did not start: '+logs);
 const admin={cookie:''};await api('auth/login',{username:'admin',password:initialPassword},admin);await api('auth/password',{currentPassword:initialPassword,password:'Synthetic-SOP-Admin-2026!'},admin);admin.member=(await workspace('data',undefined,admin)).me;
 const engineer={cookie:''},reviewer={cookie:''};
 for(const [session,username,name,departments] of [[engineer,'synthetic_sop_engineer','合成工程上传员',['engineering','engineering_review']],[reviewer,'synthetic_sop_reviewer','合成独立审图员',['engineering_review']]]){
  await api('auth/accounts',{username,name,role:'clerk',departments,orderScope:'assigned',customers:[],password:'Synthetic-SOP-Initial-2026!'},admin);
  await api('auth/login',{username,password:'Synthetic-SOP-Initial-2026!'},session);await api('auth/password',{currentPassword:'Synthetic-SOP-Initial-2026!',password:'Synthetic-SOP-Personal-2026!'},session);session.member=(await workspace('data',undefined,session)).me;
 }
 await workspace('customer-save',{customer:'合成 SOP 客户',customerCode:'SYN-SOP',salesName:admin.member.name,serviceName:admin.member.name,pmcName:'',salesMemberIds:[admin.member.id],serviceMemberIds:[admin.member.id],quoteMemberIds:[],notes:'Synthetic SOP fixture only',active:true},admin);
 const customer=(await workspace('data',undefined,admin)).customerAccounts.find(item=>item.customerCode==='SYN-SOP');
 const drawing=(await workspace('drawing-save',{token:crypto.randomUUID(),customerId:customer.id,customerCode:customer.customerCode,drawingType:'新款画图',requestedDate:today,newCount:1,revisionCount:null,requester:'合成业务需求者',requirement:'Synthetic baseline drawing before a revision instruction.'},admin)).record;
 const sopFile=path.join(dir,'synthetic-sop-v2.pdf'),evidenceFile=path.join(dir,'synthetic-mes-upload-evidence.pdf');
 await fs.writeFile(sopFile,pdfBytes('SYNTHETIC SOP MODEL-SOP V2'));await fs.writeFile(evidenceFile,pdfBytes('SYNTHETIC MES upload record MES-QA-002 version V2'));
 const playwright=await import(process.env.DOON_PLAYWRIGHT_MODULE?pathToFileURL(process.env.DOON_PLAYWRIGHT_MODULE).href:'playwright');
 browser=await playwright.chromium.launch({headless:true,...(process.env.DOON_CHROMIUM_PATH?{executablePath:process.env.DOON_CHROMIUM_PATH}:{channel:'chrome'}),args:['--no-proxy-server']});

 const adminUi=await browserSession(admin),adminPage=adminUi.page;
 await adminPage.getByRole('button',{name:'MES 待上传 SOP',exact:true}).click();
 const createChange=async(targetVersion,requirement)=>{
  await adminPage.getByRole('button',{name:'发出改图指令',exact:true}).click();
  await adminPage.getByLabel('关联画图需求',{exact:true}).selectOption(drawing.id);
  await adminPage.getByLabel('适用款号',{exact:true}).fill('MODEL-SOP');
  await adminPage.getByLabel('SOP 目标版本',{exact:true}).fill(targetVersion);
  await adminPage.getByLabel('改图或 SOP 要求',{exact:true}).fill(requirement);
  await clickMutation(adminPage,'sop-change',adminPage.getByRole('button',{name:'保存改图指令',exact:true}));
  const result=await workspace('sop-data',undefined,admin);return result.records.find(row=>row.isCurrent&&row.targetVersion===targetVersion&&row.modelNo==='MODEL-SOP');
 };
 let sop=await createChange('V2','Synthetic revision instruction: update the operating instructions for MODEL-SOP.');
 assert(sop,'New revision instruction must create an SOP obligation');assert.equal(sop.status,'待更新SOP');
 pass('业务从浏览器发出改图指令，立即生成待更新 SOP 义务');

 const engineerUi=await browserSession(engineer),engineerPage=engineerUi.page;
 await engineerPage.getByRole('button',{name:'MES 待上传 SOP',exact:true}).click();
 await engineerPage.getByRole('button',{name:'查看 SOP 任务 V2 MODEL-SOP',exact:true}).click();
 await engineerPage.getByRole('heading',{name:'SOP 任务详情',exact:true}).waitFor();
 await engineerPage.getByLabel('新版本 SOP 文件',{exact:true}).setInputFiles(sopFile);
 await engineerPage.getByLabel('准备的 SOP 版本',{exact:true}).fill('V2');
 await engineerPage.getByLabel('SOP 更新说明',{exact:true}).fill('合成测试：工艺步骤已按改图指令修订为 V2。');
 await clickMutation(engineerPage,'sop-prepare',engineerPage.getByRole('button',{name:'上传并登记新 SOP',exact:true}));
 let state=await workspace('sop-data',undefined,engineer);sop=state.records.find(row=>row.id===sop.id);assert.equal(sop.status,'待上传MES');
 const preparedAttachment=state.attachments.find(file=>file.filename===path.basename(sopFile));assert(preparedAttachment,'Uploaded SOP must be retained as an attachment');
 pass('工程在浏览器上传本地新版本 SOP，准备记录与原文件保存后进入待上传 MES');

 const uploadFields={id:sop.id,version:sop.version,uploadedVersion:'V2',uploadedAt:today,mesReference:'MES-QA-002',mesUrl:'https://mes.example.invalid/sop/MODEL-SOP/V2',actualUploader:'合成 MES 上传人员',proofFileId:'',note:'Synthetic manual MES upload registration'};
 const baseline=JSON.stringify(state);
 await workspace('sop-mes-upload',uploadFields,engineer,400);
 await workspace('sop-mes-upload',{...uploadFields,proofFileId:preparedAttachment.id},engineer,400);
 await workspace('sop-confirm',{id:sop.id,version:sop.version,decision:'confirm',note:'不能凭本地 SOP 文件推断已上传 MES'},reviewer,400);
 assert.equal(JSON.stringify(await workspace('sop-data',undefined,engineer)),baseline);
 pass('缺少 MES 凭证、把 SOP 文件充当上传凭证、尚未实际登记即确认均被拒绝，记录保持不变');

 // A valid proof attachment still cannot authorize a mismatched SOP version.
 const proofForm=new FormData();proofForm.set('sopId',sop.id);proofForm.set('purpose','mes_evidence');proofForm.set('file',new File([await fs.readFile(evidenceFile)],path.basename(evidenceFile),{type:'application/pdf'}));
 await workspace('sop-attachment',proofForm,engineer);
 state=await workspace('sop-data',undefined,engineer);const proof=state.attachments.find(file=>file.filename===path.basename(evidenceFile));assert(proof);
 const beforeWrong=JSON.stringify(state);
 await workspace('sop-mes-upload',{...uploadFields,uploadedVersion:'V1',proofFileId:proof.id},engineer,400);
 assert.equal(JSON.stringify(await workspace('sop-data',undefined,engineer)),beforeWrong);
 pass('即使上传凭证存在，MES 登记版本与目标 V2 不一致仍无法提交');

 await engineerPage.getByLabel('MES 上传版本',{exact:true}).fill('V2');
 await engineerPage.getByLabel('实际上传日期',{exact:true}).fill(today);
 await engineerPage.getByLabel('MES 记录编号或位置',{exact:true}).fill('MES-QA-002');
 await engineerPage.getByLabel('MES 页面链接',{exact:true}).fill('https://mes.example.invalid/sop/MODEL-SOP/V2');
 await engineerPage.getByLabel('实际上传人员',{exact:true}).fill('合成 MES 上传人员');
 await engineerPage.getByLabel('MES 上传凭证',{exact:true}).setInputFiles(evidenceFile);
 await engineerPage.getByLabel('MES 上传说明',{exact:true}).fill('合成验收：已在测试 MES 界面人工上传 V2，记录上传回执用于独立核对。');
 await engineerPage.getByRole('checkbox',{name:'我已在 MES 实际上传该版本，并已核对所附凭证',exact:true}).check();
 await clickMutation(engineerPage,'sop-mes-upload',engineerPage.getByRole('button',{name:'登记实际 MES 上传',exact:true}));
 state=await workspace('sop-data',undefined,engineer);sop=state.records.find(row=>row.id===sop.id);assert.equal(sop.status,'待确认');assert.equal(state.uploads.length,1);
 const uploadSnapshot=structuredClone(state.uploads[0]);
 await workspace('sop-confirm',{id:sop.id,version:sop.version,decision:'confirm',note:'上传登记人不能确认本人登记'},engineer,403);
 assert.equal((await workspace('sop-data',undefined,engineer)).records.find(row=>row.id===sop.id).status,'待确认');
 pass('浏览器登记实际 MES 版本、人员、位置及凭证；即使兼有审图权限，上传登记人也不能自确认');

 const reviewerUi=await browserSession(reviewer),reviewerPage=reviewerUi.page;
 await reviewerPage.getByRole('button',{name:'MES 待上传 SOP',exact:true}).click();
 await reviewerPage.getByRole('button',{name:'查看 SOP 任务 V2 MODEL-SOP',exact:true}).click();
 await reviewerPage.getByRole('heading',{name:'SOP 任务详情',exact:true}).waitFor();
 await reviewerPage.getByLabel('MES 上传核对意见',{exact:true}).fill('合成独立核对：MES 页面版本为 V2，与 SOP 文件和上传凭证一致。');
 await clickMutation(reviewerPage,'sop-confirm',reviewerPage.getByRole('button',{name:'确认新版本已上传 MES',exact:true}));
 state=await workspace('sop-data',undefined,admin);sop=state.records.find(row=>row.id===sop.id);assert.equal(sop.status,'已确认');
 assert.deepEqual(state.uploads[0],uploadSnapshot);const retainedAttachments=structuredClone(state.attachments),retainedUploads=structuredClone(state.uploads);
 const retainedHistory=(await workspace('sop-history?id='+encodeURIComponent(sop.id),undefined,admin)).history;
 pass('独立审图人员在浏览器确认当前新版本已上传 MES，闭环后原上传事实保持不变');

 await adminPage.reload();await adminPage.getByRole('button',{name:'MES 待上传 SOP',exact:true}).click();
 const next=await createChange('V3','Synthetic second instruction: a new drawing revision requires a fresh SOP and MES upload.');
 assert(next&&next.id!==sop.id);assert.equal(next.status,'待更新SOP');
 state=await workspace('sop-data',undefined,admin);const old=state.records.find(row=>row.id===sop.id);assert.equal(old.isCurrent,false);assert.equal(old.status,'已确认');assert.deepEqual(state.uploads,retainedUploads);
 for(const file of retainedAttachments)assert.deepEqual(state.attachments.find(item=>item.id===file.id),file);
 const afterHistory=(await workspace('sop-history?id='+encodeURIComponent(sop.id),undefined,admin)).history;
 for(const revision of retainedHistory)assert.deepEqual(afterHistory.find(item=>item.id===revision.id),revision);
 const download=await fetch(origin+'/api/workspace/sop-file?id='+encodeURIComponent(preparedAttachment.id),{headers:{Cookie:admin.cookie}});assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),await fs.readFile(sopFile));
 await workspace('sop-prepare',{id:next.id,version:next.version,fileId:preparedAttachment.id,preparedVersion:'V3',note:'不能复用上一义务的 SOP 原件冒充新版本'},engineer,400);
 await workspace('sop-confirm',{id:old.id,version:old.version,decision:'confirm',note:'旧版本确认不能消除当前 V3 义务'},reviewer,409);
 assert.equal((await workspace('sop-data',undefined,admin)).records.find(row=>row.id===next.id).status,'待更新SOP');
 pass('再次改图创建新的 V3 义务；旧版本、原件和上传证据保留，旧确认无法关闭新义务');

 // The board uses the same record, rather than a separate unlinked summary.
 await adminPage.getByRole('button',{name:'工程管理看板',exact:true}).click();
 const board=adminPage.getByRole('region',{name:'工程任务看板',exact:true});
 await board.getByLabel('搜索工程任务',{exact:true}).fill('MODEL-SOP');
 await board.locator('.etb-card').filter({hasText:'待更新SOP'}).filter({hasText:'MODEL-SOP'}).click();
 await adminPage.getByRole('heading',{name:'SOP 任务详情',exact:true}).waitFor();
 assert.equal(await adminPage.getByLabel('准备的 SOP 版本',{exact:true}).inputValue(),'V3');
 pass('工程管理看板点击未完成 SOP 任务可打开对应当前版本详情');
 await adminPage.screenshot({path:path.join(dir,'sop-current-obligation.png'),fullPage:true});
 await reviewerPage.screenshot({path:path.join(dir,'sop-mes-confirmed.png'),fullPage:true});
 assert.deepEqual(errors,[]);pass('完整多角色 SOP/MES 浏览器流程无脚本错误');
 await fs.writeFile('test-output/engineering-sop-browser-result.json',JSON.stringify({passed:checks.length,checks,screenshotDirectory:dir},null,2));
 console.log('SCREENSHOTS '+dir);
}finally{
 await browser?.close();
 if(server.exitCode===null){server.kill();await new Promise(resolve=>{const timer=setTimeout(resolve,5000);server.once('exit',()=>{clearTimeout(timer);resolve();});});}
}
