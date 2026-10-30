// Synthetic UI integration only. Requires an explicit test-output build and a free
// loopback test port; never starts, queries or updates the production service.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {createHash,randomBytes,scryptSync} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath,pathToFileURL} from 'node:url';
import * as XLSX from 'xlsx';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
assert(process.env.DOON_BUILD_DIR,'DOON_BUILD_DIR must explicitly name an isolated build below test-output.');
const output=path.join(repo,'test-output');await fs.mkdir(output,{recursive:true});
const realOutput=await fs.realpath(output),dist=await fs.realpath(path.resolve(process.env.DOON_BUILD_DIR));
const relative=path.relative(realOutput,dist);
assert(relative&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative),'The resolved build must be inside this repository test-output.');
for(const filename of ['server.mjs','runtime.mjs','workspace-api.mjs'])await fs.access(path.join(dist,filename));
const port=18799,origin=`http://127.0.0.1:${port}`;
await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(port,'127.0.0.1',()=>probe.close(error=>error?reject(error):resolve()));});
const root=await fs.mkdtemp(path.join(output,'fixed-data-tools-browser-'));
const dataDir=path.join(root,'data');await fs.mkdir(path.join(dataDir,'files'),{recursive:true});
const env={...Object.fromEntries(Object.entries(process.env).filter(([name])=>!/^DOON_KINGDEE_/i.test(name))),DOON_KINGDEE_SUPPLIER_SYNC_ENABLED:'0',DOON_KINGDEE_READONLY_ENABLED:'0',DOON_DATA_DIR:dataDir,DOON_HOST:'127.0.0.1',DOON_PORT:String(port),DOON_NO_AUTO_BACKUP:'1',DOON_SERVER_MODE:'',DOON_EMPLOYEE_PUBLIC_ORIGIN:'',DOON_SUPPLIER_PUBLIC_ORIGIN:'',DOON_REVIEW_MODE:'',DOON_TLS_CERT:'',DOON_TLS_KEY:'',DOON_STUDIO_ENABLED:'0'};
const modulePath=process.env.DOON_PLAYWRIGHT_MODULE;
const {chromium}=await import(modulePath?pathToFileURL(path.resolve(modulePath)).href:'playwright');
const at=new Date().toISOString(),password='Synthetic-Fixed-Tools-2026!';
const owner={id:'fixed_browser_owner',kind:'member',name:'合成工具管理员',email:'fixed-owner@test.invalid',userId:'local_fixed_browser_owner',role:'admin',active:true,owner:false,customers:[],createdAt:at};
const staff={id:'fixed_browser_staff',kind:'member',name:'合成业务员',email:'fixed-staff@test.invalid',userId:'local_fixed_browser_staff',role:'sales',active:true,owner:false,customers:[],createdAt:at};
const customer={id:'fixed_browser_customer',kind:'customer_account',customer:'合成客户甲',customerCode:'FIXED-A',active:true,version:1,salesMemberIds:[staff.id],serviceMemberIds:[],quoteMemberIds:[staff.id],salesName:staff.name,serviceName:''};
const otherCustomer={...customer,id:'fixed_browser_other_customer',customer:'合成客户乙',customerCode:'FIXED-B',salesMemberIds:[],quoteMemberIds:[],salesName:''};
const quote={id:'fixed_browser_quote',kind:'customer_quote',status:'draft',version:1,companyEn:'Synthetic Company',companyZh:'合成测试公司',collectionEn:'',collectionZh:'',customerAccountId:customer.id,customerName:customer.customer,customerCode:customer.customerCode,quoteNo:'SYNTH-FIXED-01',quoteDate:'2026-10-17',validUntil:'',currency:'USD',createdAt:at,createdBy:owner.name,createdById:owner.id,updatedAt:at,updatedBy:owner.name,updatedById:owner.id,
 lines:[{id:'fixed_line_a',model:'SYNTH-SAME-MODEL',descriptionZh:'合成甲左件',descriptionEn:'Synthetic left item',quantity:20,unitPrice:15,toolingFee:null,sourceFormula:'HIDDEN-FIXED-SOURCE'},{id:'fixed_line_b',model:'SYNTH-SAME-MODEL',descriptionZh:'合成乙右件',descriptionEn:'Synthetic right item',quantity:30,unitPrice:25,toolingFee:4}],
 customerCharges:[{id:'fixed_charge_a',labelZh:'合成附加费',labelEn:'Synthetic fee',amount:10,basisZh:'固定依据',basisEn:'Fixed basis',conditional:true,needsReview:false}],
 terms:[{id:'fixed_term',labelZh:'条款',labelEn:'Terms',zh:'固定条款',en:'Fixed terms',needsReview:false,reviewNote:'HIDDEN-FIXED-TERM'}],reviewNotes:['HIDDEN-FIXED-REVIEW'],internalCosts:[{id:'fixed_cost',label:'HIDDEN-FIXED-COST',rmb:7,notes:'HIDDEN-FIXED-NOTE'}],internalNotesZh:'HIDDEN-FIXED-INTERNAL',exchangeRateCnyPerUsd:7,mediaIds:[]};
const preserved={id:'fixed_browser_preserved',kind:'synthetic_preserved',value:'Synthetic unchanged record'};
const workbook=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet([['型号','数量','金额'],['<img src=x onerror="window.fixedToolInjected=1">',2,4],['SYNTH-B',3,null]]);
sheet.C3={t:'n',f:'B3*2'};XLSX.utils.book_append_sheet(workbook,sheet,'Synthetic');
const workbookBytes=XLSX.write(workbook,{bookType:'xlsx',type:'buffer'}),workbookPath=path.join(root,'synthetic-input.xlsx');await fs.writeFile(workbookPath,workbookBytes);
const sha=value=>createHash('sha256').update(value).digest('hex');
quote.sourceFileKey='synthetic_fixed_original';quote.sourceHash=sha(workbookBytes);quote.sourceFilename='synthetic-original.xlsx';quote.sourceContentType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const originalObject=path.join(dataDir,'files',sha(quote.sourceFileKey));await fs.writeFile(originalObject,workbookBytes);
const database=path.join(dataDir,'workspace.sqlite'),seed=new DatabaseSync(database);
seed.exec("CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,data TEXT NOT NULL); CREATE TABLE workspace_revision(id TEXT PRIMARY KEY,revision INTEGER NOT NULL); INSERT INTO workspace_revision VALUES('main',1); CREATE TABLE local_accounts(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,member_id TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,must_change INTEGER NOT NULL,created_at TEXT NOT NULL)");
for(const value of [owner,staff,customer,otherCustomer,quote,preserved])seed.prepare('INSERT INTO records VALUES(?,?,?)').run(value.id,value.kind,JSON.stringify(value));
for(const [member,username] of [[owner,'synthetic_owner'],[staff,'synthetic_staff']]){const salt=randomBytes(16).toString('hex'),hash=scryptSync(password,salt,64,{N:32768,r:8,p:3,maxmem:64*1024*1024}).toString('hex');seed.prepare('INSERT INTO local_accounts VALUES(?,?,?,?,?,?)').run(member.userId,username,member.id,`scrypt-v1$${salt}$${hash}`,0,at);}
seed.close();
const readRecord=id=>{const db=new DatabaseSync(database,{readOnly:true});try{const row=db.prepare('SELECT data FROM records WHERE id=?').get(id);return row?JSON.parse(row.data):null;}finally{db.close();}};
const checks=[],pageErrors=[],httpErrors=[];let browser,server,page,logs='';
const pass=label=>{checks.push(label);console.log('PASS '+label);};
const actionResponse=(action,method='POST')=>page.waitForResponse(response=>new URL(response.url()).pathname==='/api/workspace/'+action&&response.request().method()===method);
async function clickAction(action,locator){const waiting=actionResponse(action);await locator.click();const response=await waiting,result=await response.json();assert.equal(response.status(),200,action+': '+JSON.stringify(result));return result;}
async function download(panel,button,name){const waiting=page.waitForEvent('download');await panel.getByRole('button',{name:button,exact:true}).click();const result=await waiting,filename=path.join(root,name);await result.saveAs(filename);return fs.readFile(filename);}
async function login(context,username){const current=await context.newPage();await current.goto(origin);await current.getByLabel('登录账号',{exact:true}).fill(username);await current.getByLabel('登录密码',{exact:true}).fill(password);await current.getByRole('button',{name:'登录',exact:true}).click();await current.locator('.workspace').waitFor();return current;}
try{
 server=spawn(process.execPath,[path.join(dist,'server.mjs')],{cwd:repo,env,stdio:'pipe',windowsHide:true});server.stdout.on('data',bytes=>logs+=bytes);server.stderr.on('data',bytes=>logs+=bytes);
 let ready=false;for(let attempt=0;attempt<100;attempt++){assert(server.exitCode===null,'The isolated service exited before startup.');try{if((await fetch(origin+'/health')).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}assert(ready,'The isolated test service did not become healthy.');
 browser=await chromium.launch({channel:process.env.DOON_BROWSER_CHANNEL||'chrome',headless:true,args:['--no-proxy-server']});
 const context=await browser.newContext({viewport:{width:1440,height:1050},acceptDownloads:true});
 await context.addInitScript(()=>Object.defineProperty(Crypto.prototype,'randomUUID',{value:undefined,configurable:true}));
 page=await login(context,'synthetic_owner');page.on('pageerror',error=>pageErrors.push(error.message));
 page.on('response',response=>{if(response.url().startsWith(origin+'/api/workspace/fixed-')&&response.status()>=400)httpErrors.push({path:new URL(response.url()).pathname,status:response.status()});});
 await page.goto(origin+'/business-tools');const panel=page.locator('.fixed-tools');await panel.waitFor();await panel.getByRole('button',{name:'检查工作簿',exact:true}).waitFor();
 await panel.getByLabel('选择工作簿',{exact:false}).setInputFiles(workbookPath);
 const inspected=await clickAction('fixed-tool-workbook',panel.getByRole('button',{name:'检查工作簿',exact:true}));assert.equal(inspected.job.operation,'workbook-inspect');assert.equal(inspected.job.status,'completed');
 await panel.locator('.fixed-tools-job-id').filter({hasText:inspected.job.id}).waitFor();assert.match(await panel.innerText(),/Synthetic/);
 const source=await download(panel,'下载原始文件','downloaded-source.xlsx');assert.equal(sha(source),sha(workbookBytes));
 const inspectResult=JSON.parse(await download(panel,'下载处理结果','inspect-result.json'));assert.equal(inspectResult.result.operation,'inspect');
 await page.screenshot({path:path.join(root,'01-workbook-inspect.png'),fullPage:true});pass('Owner opens the fixed tools UI and inspects XLSX; downloaded source matches the original bytes.');

 // These native selects are nested in labels; their label text also contains
 // option text. Match the visible label prefix while retaining the control role.
 await panel.getByRole('combobox',{name:/^处理方式/}).selectOption('rows');await panel.getByLabel('工作表名称（必填）',{exact:true}).fill('Synthetic');await panel.getByLabel('单元格范围（必填）',{exact:true}).fill('A1:C3');
 const extracted=await clickAction('fixed-tool-workbook',panel.getByRole('button',{name:'生成范围提取结果',exact:true}));assert.equal(extracted.job.operation,'workbook-rows');
 await panel.locator('.fixed-tools-job-id').filter({hasText:extracted.job.id}).waitFor();assert.match(await panel.innerText(),/<img src=x onerror=/);assert.equal(await page.evaluate(()=>window.fixedToolInjected),undefined);assert.equal(await panel.locator('.fixed-tools-preview img,.fixed-tools-preview script').count(),0);
 const rowsResult=JSON.parse(await download(panel,'下载处理结果','rows-result.json'));assert.equal(rowsResult.result.selection.sheet,'Synthetic');assert.equal(rowsResult.result.selection.range,'A1:C3');assert.equal(rowsResult.result.formulaCachesRecalculated,false);
 await page.screenshot({path:path.join(root,'02-workbook-rows.png'),fullPage:true});pass('Bounded row extraction renders source strings as text, preserves unknown formula results, and downloads the complete result.');

 await panel.getByRole('tab',{name:'2. 客户归属导出',exact:true}).click();await panel.locator('label').filter({hasText:customer.customer}).getByRole('checkbox').check();
 const ownership=await clickAction('fixed-tool-ownership',panel.getByRole('button',{name:'生成客户归属导出',exact:true}));assert.equal(ownership.job.preview.customerCount,1);assert.deepEqual(ownership.job.preview.customers.map(item=>item.id),[customer.id]);
 await panel.locator('.fixed-tools-job-id').filter({hasText:ownership.job.id}).waitFor();assert.equal(ownership.job.preview.customers[0].serviceStatus,'explicit');assert.deepEqual(ownership.job.preview.customers[0].serviceMembers,[]);assert.match(await panel.locator('.fixed-tools-job').innerText(),/合成业务员/);assert.match(await panel.locator('.fixed-tools-job').innerText(),/未分配/);assert.doesNotMatch(await panel.locator('.fixed-tools-job').innerText(),/合成客户乙|@test.invalid/);
 const ownershipResult=JSON.parse(await download(panel,'下载处理结果','ownership-result.json'));assert(!JSON.stringify(ownershipResult).includes('HIDDEN-FIXED'));
 await page.screenshot({path:path.join(root,'03-customer-ownership.png'),fullPage:true});pass('Customer ownership export requires explicit selection and excludes unselected customers and internal fields.');

 await panel.getByRole('tab',{name:'3. 草稿费用维护',exact:true}).click();await panel.getByRole('combobox',{name:/^选择一张既有草稿/}).selectOption(quote.id);await panel.getByRole('spinbutton',{name:/fixed_line_a/}).waitFor();
 assert.equal(await panel.getByRole('spinbutton',{name:/fixed_line_a/}).inputValue(),'');assert.equal(await panel.getByRole('spinbutton',{name:/fixed_charge_a/}).inputValue(),'10');assert.doesNotMatch(await panel.innerText(),/HIDDEN-FIXED/);for(const label of ['fixed_line_a','fixed_line_b','合成甲左件','合成乙右件'])assert((await panel.innerText()).includes(label));
 await panel.getByRole('spinbutton',{name:/fixed_line_a/}).fill('12');await panel.getByRole('spinbutton',{name:/fixed_line_b/}).fill('8');await panel.getByRole('spinbutton',{name:/fixed_charge_a/}).fill('0');
 const proposed=await clickAction('fixed-tool-fees-preview',panel.getByRole('button',{name:'生成费用差异预览',exact:true}));assert.equal(proposed.job.status,'pending');assert.equal(proposed.job.preview.changes,3);assert.deepEqual(readRecord(quote.id),quote);
 await panel.locator('.fixed-tools-job-id').filter({hasText:proposed.job.id}).waitFor();for(const label of ['fixed_line_a','fixed_line_b','合成甲左件','合成乙右件'])assert((await panel.locator('.fixed-tools-job').innerText()).includes(label));assert.equal(await panel.getByRole('button',{name:'确认并执行这份变更',exact:true}).isEnabled(),false);await page.screenshot({path:path.join(root,'04-fees-await-confirmation.png'),fullPage:true});
 await panel.getByLabel('我已核对客户、报价版本和上方金额变化，同意执行这份变更。',{exact:true}).check();
 // Simulate a response lost after the commit: the UI must refresh this job,
 // not generate another proposal or blindly send the decision again.
 let decisionCount=0;await page.route('**/api/workspace/fixed-tool-fees-decision',async route=>{decisionCount++;const response=await route.fetch();assert.equal(response.status(),200);await route.abort('failed');});
 await panel.getByRole('button',{name:'确认并执行这份变更',exact:true}).click();await panel.getByRole('alert').filter({hasText:'请先刷新下方原任务'}).waitFor();assert.equal(decisionCount,1);assert.equal(await panel.getByRole('button',{name:'确认并执行这份变更',exact:true}).isEnabled(),false);
 await page.unroute('**/api/workspace/fixed-tool-fees-decision');await panel.getByRole('button',{name:'刷新原任务',exact:true}).click();await panel.getByText('执行结果已回读核验。',{exact:true}).waitFor();await panel.getByText('原费用任务已完成，旧版本编辑已清除。继续修改时请选择最新草稿。',{exact:true}).waitFor();assert.equal(await panel.getByRole('button',{name:'生成费用差异预览',exact:true}).count(),0);assert.equal(await panel.getByRole('combobox',{name:/^选择一张既有草稿/}).inputValue(),'');
 const saved=readRecord(quote.id);assert.equal(saved.version,2);assert.equal(saved.lines[0].toolingFee,12);assert.equal(saved.lines[1].toolingFee,8);assert.equal(saved.customerCharges[0].amount,0);
 const expected=structuredClone(quote);expected.version=2;expected.lines[0].toolingFee=12;expected.lines[1].toolingFee=8;expected.customerCharges[0].amount=0;expected.updatedAt=saved.updatedAt;expected.updatedBy=owner.name;expected.updatedById=owner.id;assert.deepEqual(saved,expected);assert.deepEqual(readRecord(preserved.id),preserved);assert.equal(sha(await fs.readFile(originalObject)),sha(workbookBytes));assert.equal(decisionCount,1);
 await page.screenshot({path:path.join(root,'05-fees-recovered-receipt.png'),fullPage:true});pass('Fee preview preserves null, requires human confirmation, and recovers a committed result after response loss without repeating the write.');

 await page.reload();await page.locator('.fixed-tools-history').getByRole('button',{name:'查看任务',exact:true}).first().click();await page.locator('.fixed-tools-job').waitFor();assert.match(await page.locator('.fixed-tools-job').innerText(),/保存版本：2/);pass('Task history survives page reload and reopens the verified fee receipt.');
 const staffContext=await browser.newContext({viewport:{width:1200,height:800}}),staffPage=await login(staffContext,'synthetic_staff');await staffPage.goto(origin+'/business-tools');await staffPage.locator('.workspace').waitFor();assert.equal(await staffPage.locator('.fixed-tools').count(),0);assert.equal((await staffContext.request.get(origin+'/api/workspace/fixed-data-tools')).status(),403);await staffContext.close();pass('Non-administrator employees cannot see the fixed-tool panel or access its catalog API.');
 assert.deepEqual(pageErrors,[]);assert.deepEqual(httpErrors,[]);
 await fs.writeFile(path.join(root,'result.json'),JSON.stringify({passed:checks.length,checks,buildDir:dist,port,root,pageErrors,httpErrors,at:new Date().toISOString()},null,2));console.log(JSON.stringify({passed:checks.length,root}));
}catch(error){if(page){await page.screenshot({path:path.join(root,'failure.png'),fullPage:true}).catch(()=>{});await fs.writeFile(path.join(root,'failure.txt'),await page.locator('body').innerText()).catch(()=>{});}await fs.writeFile(path.join(root,'failure-metadata.json'),JSON.stringify({checks,pageErrors,httpErrors,logs},null,2));console.error('Synthetic browser evidence: '+root);throw error;
}finally{await browser?.close();if(server&&server.exitCode===null){server.kill();await new Promise(resolve=>{const timer=setTimeout(resolve,3000);server.once('exit',()=>{clearTimeout(timer);resolve();});});}}
