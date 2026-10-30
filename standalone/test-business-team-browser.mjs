// Synthetic browser acceptance only. All credentials and records belong to this temporary database.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';
import {verifyCustomerPriceBuildEvidence} from '../scripts/customer-price-build-evidence.mjs';

const dist=path.resolve(process.env.DOON_BUILD_DIR||'test-output/business-team-build');
const evidence=await verifyCustomerPriceBuildEvidence(dist);
const dir=await fs.mkdtemp(path.resolve('test-output/business-team-browser-'));
assert(dir.startsWith(path.resolve('test-output')+path.sep));
const origin='http://127.0.0.1:18806';
const env={...Object.fromEntries(Object.entries(process.env).filter(([name])=>!/^DOON_KINGDEE_/i.test(name))),DOON_KINGDEE_SUPPLIER_SYNC_ENABLED:'0',DOON_KINGDEE_READONLY_ENABLED:'0',DOON_DATA_DIR:dir,DOON_HOST:'127.0.0.1',DOON_PORT:'18806',DOON_NO_AUTO_BACKUP:'1'};
execFileSync(process.execPath,[path.join(dist,'manage.mjs'),'init'],{env,stdio:'pipe',windowsHide:true});
const password=(await fs.readFile(path.join(dir,'管理员首次登录.txt'),'utf8')).match(/初始密码：([^\n]+)/)[1];
const server=spawn(process.execPath,[path.join(dist,'server.mjs')],{env,stdio:'pipe',windowsHide:true});
let logs='',cookie='',browser,page;
server.stdout.on('data',()=>{});server.stderr.on('data',value=>logs+=value);
const checks=[],errors=[],pass=name=>{checks.push(name);console.log('PASS '+name);};
const token=()=>crypto.randomUUID(),day=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');

async function api(route,body,expected=200){
 const response=await fetch(origin+'/api/'+route,{method:body===undefined?'GET':'POST',headers:{Origin:origin,Cookie:cookie,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});
 if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
 const data=await response.json();assert.equal(response.status,expected,route+' '+JSON.stringify(data));return data;
}
const workspace=(action,body,expected)=>api('workspace/'+action,body,expected);
function sourceRecords(){
 const db=new DatabaseSync(path.join(dir,'workspace.sqlite'),{readOnly:true});
 try{return db.prepare("SELECT id,data FROM records WHERE kind IN ('member','customer_account','customer_project_team') ORDER BY id").all();}finally{db.close();}
}

try{
 let ready=false;
 for(let i=0;i<100;i++){try{if((await fetch(origin+'/health')).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
 assert(ready,'Isolated test server did not start');
 await api('auth/login',{username:'admin',password});
 await api('auth/password',{currentPassword:password,password:'Synthetic-Team-Admin-2026!'});
 const admin=(await workspace('data')).me,adminCookie=cookie,groups=[];
 for(const [index,suffix] of ['甲','乙','丙'].entries()){
  const members=[];
  for(const [roleIndex,roleName] of ['跟进','客服审核'].entries()){
   const username=`synthetic_team_${index}_${roleIndex}`,name=`合成${suffix}组${roleName}`;
   await api('auth/accounts',{username,name,role:'sales',password:'Synthetic-Team-Initial-2026!',customers:[]});
   await api('auth/login',{username,password:'Synthetic-Team-Initial-2026!'});
   await api('auth/password',{currentPassword:'Synthetic-Team-Initial-2026!',password:'Synthetic-Team-Personal-2026!'});
   members.push((await workspace('data')).me);cookie=adminCookie;
  }
  const customer=(await workspace('customer-save',{customer:`SYNTHETIC-TEAM-${index+1} 合成客户${suffix}`,customerCode:`SYNTH-T${index+1}`,salesName:admin.name,serviceName:members[0].name,pmcName:'',salesMemberIds:[admin.id],serviceMemberIds:members.map(member=>member.id),quoteMemberIds:[],notes:'Synthetic group browser fixture',active:true})).item;
  const team=(await workspace('customer-project-team-save',{token:token(),name:`合成业务客服${suffix}组`,leaderIds:[admin.id],salesMemberIds:[admin.id],serviceMemberIds:members.map(member=>member.id),customerIds:[customer.id],active:true})).item;
  const title=`合成${suffix}组专属跟进`,legacyTitle=`合成${suffix}组历史未指定组跟进`,projectTitle=`合成${suffix}组开发项目`;
  const fields={type:'followup',customerId:customer.id,title,description:'Synthetic group isolation record',status:'open',waitingFor:'none',dueDate:'',nextFollowUp:day,orderId:'',details:{category:'合成验收'}};
  await workspace('service-save',{...fields,teamId:team.id,ownerId:members[0].id,serviceReviewerId:members[1].id,salesReviewerId:admin.id});
  await workspace('service-save',{...fields,title:legacyTitle});
  await workspace('customer-project-save',{token:token(),customerId:customer.id,code:`SYNTH-P${index+1}`,title:projectTitle,description:'Synthetic group project',teamId:team.id,salesMemberId:admin.id,serviceMemberIds:members.map(member=>member.id),status:'active'});
  groups.push({team,customer,members,title,legacyTitle,projectTitle});
 }
 const foundations=sourceRecords();
 const playwright=await import(process.env.DOON_PLAYWRIGHT_MODULE?pathToFileURL(process.env.DOON_PLAYWRIGHT_MODULE).href:'playwright');
 browser=await playwright.chromium.launch({headless:true,...(process.env.DOON_CHROMIUM_PATH?{executablePath:process.env.DOON_CHROMIUM_PATH}:{channel:'chrome'}),args:['--no-proxy-server']});
 const context=await browser.newContext({viewport:{width:1536,height:1050}}),split=cookie.indexOf('=');
 await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),url:origin,httpOnly:true,sameSite:'Strict'}]);
 page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 await page.goto(origin+'/service-followups');
 const selector=page.getByRole('combobox',{name:'统一工作组',exact:true});
 await selector.waitFor();
 await page.getByRole('button',{name:groups[2].title,exact:true}).waitFor();
 assert.equal(await selector.locator('option').count(),5,'All three groups plus all and ungrouped must be listed');
 for(const group of groups){
  assert.equal(await selector.locator('option').filter({hasText:group.team.name}).count(),1);
  assert((await page.locator('.business-team-roster').innerText()).includes(group.members[0].name));
 }
 assert.equal(await page.locator('.sw-team-section').count(),0,'The shared group bar must replace duplicate local group selectors');
 await page.screenshot({path:path.join(dir,'three-groups.png'),fullPage:true});
 pass('统一组栏显示既有三组合成配置及业务客服人员，客服页不重复建立分组入口');

 const selected=groups[1];
 await selector.selectOption(selected.team.id);
 await page.getByRole('button',{name:selected.title,exact:true}).waitFor();
 await page.getByRole('button',{name:selected.legacyTitle,exact:true}).waitFor();
 for(const group of [groups[0],groups[2]])assert.equal(await page.getByRole('button',{name:group.title,exact:true}).count(),0);
 assert.equal(await page.getByRole('combobox',{name:'筛选客户',exact:true}).locator('option').count(),2);
 assert.match(await page.locator('.sw-metrics').innerText(),/今日待办\s*2/);
 pass('选中乙组只显示乙组记录、客户和统计，同时保留按客户归属的历史未指定组记录');

 await page.locator('[data-nav-id="customers"]').click();
 await page.getByRole('row').filter({hasText:selected.customer.customerCode}).waitFor();
 assert.equal(await selector.inputValue(),selected.team.id);
 for(const group of [groups[0],groups[2]])assert.equal(await page.getByRole('row').filter({hasText:group.customer.customerCode}).count(),0);
 await page.locator('[data-nav-id="customer-projects"]').click();
 await page.getByRole('row').filter({hasText:selected.projectTitle}).waitFor();
 assert.equal(await selector.inputValue(),selected.team.id);
 for(const group of [groups[0],groups[2]])assert.equal(await page.getByRole('row').filter({hasText:group.projectTitle}).count(),0);
 await page.reload();await page.getByRole('row').filter({hasText:selected.projectTitle}).waitFor();
 assert.equal(await selector.inputValue(),selected.team.id);
 await page.getByRole('row').filter({hasText:selected.projectTitle}).getByRole('button',{name:'打开项目'}).click();
 await page.getByTestId('customer-project-list-nav').click();
 await page.getByRole('row').filter({hasText:selected.projectTitle}).waitFor();
 assert.equal(await selector.inputValue(),selected.team.id);
 for(const group of [groups[0],groups[2]])assert.equal(await page.getByRole('row').filter({hasText:group.projectTitle}).count(),0);
 await page.screenshot({path:path.join(dir,'shared-group-projects.png'),fullPage:true});
 pass('客服事项→客户清单→前期开发共用同一工作组，刷新和返回项目清单后保持且各页面不混入其他组');

 await page.goto(origin+'/service-followups');
 await page.getByRole('button',{name:selected.title,exact:true}).waitFor();
 await page.getByRole('button',{name:'新增跟进',exact:true}).click();
 const editor=page.getByRole('region',{name:'客服业务编辑',exact:true});
 await editor.waitFor();
 assert.equal(await editor.getByRole('combobox',{name:'记录所属业务组',exact:true}).inputValue(),selected.team.id);
 await editor.getByRole('textbox',{name:'跟进标题',exact:true}).fill('合成未保存草稿');
 await selector.selectOption(groups[0].team.id);
 await page.getByRole('alert').filter({hasText:'请完成后再切换工作组'}).waitFor();
 assert.equal(await selector.inputValue(),selected.team.id);
 assert.equal(await editor.getByRole('textbox',{name:'跟进标题',exact:true}).inputValue(),'合成未保存草稿');
 assert.equal(await page.getByRole('button',{name:groups[0].title,exact:true}).count(),0);
 pass('未保存客服草稿阻止全局切组，原组选择与输入均保留');

 await editor.getByRole('combobox',{name:'记录所属客户',exact:true}).selectOption(selected.customer.id);
 const follower=editor.getByRole('combobox',{name:'客服跟进人',exact:true}),serviceReviewer=editor.getByRole('combobox',{name:'客服审核人',exact:true}),salesReviewer=editor.getByRole('combobox',{name:'业务审核人',exact:true});
 assert.deepEqual(await follower.locator('option').evaluateAll(rows=>rows.map(row=>row.value).filter(Boolean)),selected.members.map(member=>member.id));
 await follower.selectOption(selected.members[0].id);
 assert.equal(await serviceReviewer.locator(`option[value="${selected.members[0].id}"]`).count(),0);
 await serviceReviewer.selectOption(selected.members[1].id);
 await salesReviewer.selectOption(admin.id);
 const savedTitle='合成浏览器分组与参考图跟进';
 await editor.getByRole('textbox',{name:'跟进标题',exact:true}).fill(savedTitle);
 await editor.getByRole('button',{name:'确认保存',exact:true}).click();
 await page.getByRole('status').filter({hasText:'已保存，历史版本'}).waitFor();
 let saved=(await workspace('service-data')).records.find(record=>record.title===savedTitle);assert(saved);
 assert.equal(saved.teamId,selected.team.id);assert.equal(saved.ownerId,selected.members[0].id);assert.equal(saved.serviceReviewerId,selected.members[1].id);assert.equal(saved.salesReviewerId,admin.id);
 const row=page.getByRole('row').filter({hasText:savedTitle});
 for(const name of [selected.team.name,selected.members[0].name,selected.members[1].name])assert((await row.innerText()).includes(name));
 pass('客服记录默认当前组，候选按组限制并排除自审，三个角色从浏览器保存后正确回显');

 await editor.getByLabel('上传参考图片',{exact:true}).setInputFiles({name:'synthetic-reference.png',mimeType:'image/png',buffer:png});
 await editor.locator('.sw-pending-image img').waitFor();
 await page.waitForFunction(()=>document.querySelector('.sw-pending-image img')?.naturalWidth>0);
 assert.equal(await editor.getByRole('button',{name:'确认保存',exact:true}).isDisabled(),true);
 await page.screenshot({path:path.join(dir,'reference-image-pending.png'),fullPage:true});
 await editor.locator('button').filter({hasText:/^上传参考图片$/}).click();
 await page.getByRole('status').filter({hasText:'参考图片已保存'}).waitFor();
 const thumbnail=editor.locator('.sw-reference-gallery img');await thumbnail.waitFor();
 await page.waitForFunction(()=>document.querySelector('.sw-reference-gallery img')?.naturalWidth>0);
 assert.equal(await editor.locator('.sw-pending-image').count(),0);
 const feed=await workspace('service-data'),attachment=feed.attachments.find(item=>item.recordId===saved.id&&item.category==='reference-image');
 assert(attachment);assert.equal(attachment.contentType,'image/png');assert.equal(attachment.size,png.length);
 saved=feed.records.find(record=>record.id===saved.id);assert.equal(saved.version,2);
 const previewUrl=await thumbnail.locator('..').getAttribute('href');
 const previewResponse=await context.request.get(origin+previewUrl);assert.equal(previewResponse.status(),200);assert.match(previewResponse.headers()['content-type'],/^image\/png/);assert.match(previewResponse.headers()['content-disposition'],/^inline/);assert.deepEqual(await previewResponse.body(),png);
 const [preview]=await Promise.all([page.waitForEvent('popup'),thumbnail.click()]);
 await preview.waitForLoadState('domcontentloaded');assert(preview.url().includes('&preview=1'));await preview.close();
 await page.screenshot({path:path.join(dir,'reference-image-saved.png'),fullPage:true});
 pass('参考图选择后先预览，上传后显示可用缩略图与鉴权原图；点击能打开原图，记录版本正确递增');

 await editor.getByRole('button',{name:'关闭客服业务编辑',exact:true}).click();
 await selector.selectOption(groups[2].team.id);
 await page.getByRole('button',{name:groups[2].title,exact:true}).waitFor();
 assert.equal(await page.getByRole('row').filter({hasText:savedTitle}).count(),0);
 await selector.selectOption(selected.team.id);
 await page.getByRole('button',{name:savedTitle,exact:true}).waitFor();
 await page.getByRole('button',{name:savedTitle,exact:true}).click();
 await editor.locator('.sw-reference-gallery img').waitFor();
 assert.equal(await follower.inputValue(),selected.members[0].id);assert.equal(await serviceReviewer.inputValue(),selected.members[1].id);assert.equal(await salesReviewer.inputValue(),admin.id);
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:path.join(dir,'service-mobile.png'),fullPage:true});
 assert.deepEqual(sourceRecords(),foundations,'Browser filtering and service edits must not rewrite members, customers or group definitions');
 assert.equal(errors.length,0,errors.join('\n'));
 pass('切组后新记录与图片随原组保留，重新打开角色一致，无脚本错误且未改写原组和客户关系');
 await fs.writeFile('test-output/business-team-browser-result.json',JSON.stringify({passed:checks.length,checks,errors,manifestSha256:evidence.manifestSha256,at:new Date().toISOString(),artifacts:dir},null,2));
 console.log(JSON.stringify({passed:checks.length,artifacts:dir}));
}catch(error){
 await fs.writeFile(path.join(dir,'failure-log.txt'),logs);
 if(page){await page.screenshot({path:path.join(dir,'failure.png'),fullPage:true});await fs.writeFile(path.join(dir,'failure-ui.txt'),await page.locator('body').ariaSnapshot());}
 console.error('Browser artifacts:',dir);throw error;
}finally{if(browser)await browser.close();server.kill();}
