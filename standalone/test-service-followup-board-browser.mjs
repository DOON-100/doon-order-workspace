import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';

// 测试环境，不含正式业务数据；独立目录、端口及合成客户。
const dist=path.resolve(process.env.DOON_BUILD_DIR||'test-output/service-customer-search-build');
const dir=await fs.mkdtemp(path.resolve('test-output/service-customer-search-'));
const origin='http://127.0.0.1:18829';
const env={...process.env,DOON_DATA_DIR:dir,DOON_HOST:'127.0.0.1',DOON_PORT:'18829',DOON_NO_AUTO_BACKUP:'1',DOON_SYNTHETIC_ONLY:'1',DOON_STUDIO_SCHEDULES_ENABLED:'0',DOON_IE_MAIL_ENABLED:'0',DOON_EMPLOYEE_PUBLIC_ORIGIN:'',DOON_SERVER_MODE:'internal',DOON_REVIEW_MODE:'0',DOON_TLS_CERT:'',DOON_TLS_KEY:''};
execFileSync(process.execPath,[path.join(dist,'manage.mjs'),'init'],{env,stdio:'pipe',windowsHide:true});
const password=(await fs.readFile(path.join(dir,'管理员首次登录.txt'),'utf8')).match(/初始密码：([^\n]+)/)[1];
const server=spawn(process.execPath,[path.join(dist,'server.mjs')],{env,stdio:'pipe',windowsHide:true});
const done=new Promise(resolve=>server.once('exit',resolve));
let cookie='',browser,logs='';const errors=[];
server.stdout.on('data',()=>{});server.stderr.on('data',b=>logs+=b);
async function api(route,body){
 const res=await fetch(origin+'/api/'+route,{method:body===undefined?'GET':'POST',headers:{Origin:origin,Cookie:cookie,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:body instanceof FormData?body:JSON.stringify(body)})});
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


 const day='2026-11-02',base={type:'followup',customerId:alpha.id,title:'开发样办 · 客户确认与寄样',teamId:team.id,ownerId:admin.id,nextFollowUp:day,dueDate:'2026-11-06',details:{category:'开发跟进'}};
 let record=(await api('workspace/service-save',{...base,description:'已登记客户需求，准备整理图纸。',waitingFor:'none'})).record;
 for(const [status,waitingFor,description] of [
  ['open','customer','图纸已发客户，等待客户确认镜框尺寸与颜色。'],
  ['open','factory','客户已确认图纸，工厂准备开发样办并回复计划。'],
  ['open','none','样办已完成并安排寄出，整理寄样资料。'],
  ['done','none','客户确认收到样办，本轮跟进已完成。'],
  ['open','jennifer','客户追加配色需求，等待业务核对报价后安排下一轮。'],
 ])record=(await api('workspace/service-save',{...base,id:record.id,version:record.version,status,waitingFor,description})).record;
 const form=new FormData();form.set('recordId',record.id);form.set('version',String(record.version));form.set('file',new File(['%PDF-1.4\nSynthetic customer requirements only\n%%EOF'],'合成客户需求.pdf',{type:'application/pdf'}));form.set('note','合成需求摘要，供样办核对');
 record=(await api('workspace/service-attachment',form)).record;
 const second=(await api('workspace/service-save',{...base,title:'出货单据 · 核对装箱资料',description:'等待客户确认收货信息。',waitingFor:'customer'})).record;
 // Synthetic dates make the seven-version visual chronology easy to inspect.
 const fixtureDb=new DatabaseSync(path.join(dir,'workspace.sqlite'));
 for(const row of fixtureDb.prepare("SELECT id,data FROM records WHERE kind='service_revision'").all()){
  const value=JSON.parse(row.data);if(value.recordId!==record.id)continue;
  value.createdAt='2026-10-'+String(22+value.version).padStart(2,'0')+'T01:30:00.000Z';
  value.snapshot.createdAt='2026-10-23T01:30:00.000Z';value.snapshot.updatedAt=value.createdAt;
  fixtureDb.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify(value),row.id);
 }
 const fixtureRecord=JSON.parse(fixtureDb.prepare('SELECT data FROM records WHERE id=?').get(record.id).data);
 fixtureRecord.createdAt='2026-10-23T01:30:00.000Z';fixtureRecord.updatedAt='2026-10-29T01:30:00.000Z';
 fixtureDb.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify(fixtureRecord),record.id);fixtureDb.close();
 const rows=()=>{const db=new DatabaseSync(path.join(dir,'workspace.sqlite'),{readOnly:true});try{return db.prepare('SELECT id,data FROM records ORDER BY id').all();}finally{db.close();}};
 const before=rows();
 await page.goto(origin+'/service-workspace');
 await page.getByRole('button',{name:'全部跟进',exact:true}).click();
 await page.getByRole('button',{name:record.title,exact:true}).waitFor();
 let posts=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/api/workspace/service-'))posts++;});
 const board=page.getByRole('dialog'),editor=page.getByRole('region',{name:'客服业务编辑'});
 async function open(title){await page.getByRole('button',{name:title,exact:true}).click();await board.getByRole('heading',{name:title,exact:true}).waitFor();}
 await open(record.title);
 assert.equal(await editor.count(),0);assert.equal(await board.locator('input,textarea,select').count(),0,'The board contains no editing form');
 assert.equal(await board.locator('.sfb-metric').count(),4);assert.equal(await board.locator('.sfb-progress li').count(),5);
 assert.equal(await board.locator('.sfb-timeline>li').count(),7);assert.equal(await board.getByRole('link',{name:/合成客户需求/}).count(),1);
 // Refresh must reload attachments as well as history from the server.
 await page.route('**/api/workspace/service-data',async route=>{const response=await route.fetch(),data=await response.json();await route.fulfill({response,json:{...data,attachments:[...data.attachments,{id:'synthetic-refresh-file',recordId:record.id,filename:'合成刷新附件.pdf',createdAt:new Date().toISOString()}]}});},{times:1});
 await board.getByRole('button',{name:'刷新跟进详情'}).click();
 await board.getByRole('link',{name:/合成刷新附件/}).waitFor();
 const first=board.locator('.sfb-timeline>li').filter({has:page.locator('.sfb-version',{hasText:/^V1$/})});
 await first.locator('summary').click();await first.getByText('已登记客户需求，准备整理图纸。',{exact:true}).waitFor();
 await board.locator('.sfb-body').evaluate(n=>{n.scrollTop=0;});
 await page.screenshot({path:'test-output/service-followup-board-desktop.png',fullPage:false});
 assert.equal(posts,0,'Viewing and expanding history never writes business data');assert.deepEqual(rows(),before);
 await board.press('Escape');await board.waitFor({state:'hidden'});
 await open(record.title);await page.mouse.click(5,500);await board.waitFor({state:'hidden'});
 await page.getByRole('row').filter({hasText:second.title}).getByRole('button',{name:'查看进度',exact:true}).click();
 await board.getByRole('heading',{name:second.title,exact:true}).waitFor();await board.getByRole('button',{name:'编辑跟进',exact:true}).click();
 await editor.waitFor();assert.equal(await board.count(),0);assert.equal(await editor.getByPlaceholder(/一句话说明需推进的事项/).inputValue(),second.title);assert.equal(posts,0);
 await editor.getByRole('button',{name:'关闭客服业务编辑',exact:true}).click();
 // Do not open the editor after the user closes a board while its fresh-read is pending.
 await open(record.title);
 let release;const held=new Promise(resolve=>{release=resolve;});let seen;const started=new Promise(resolve=>{seen=resolve;});
 await page.route('**/api/workspace/service-data',async route=>{const response=await route.fetch(),body=await response.body();seen();await held;await route.fulfill({response,body}).catch(()=>{});},{times:1});
 await board.getByRole('button',{name:'编辑跟进',exact:true}).click();await started;
 const cancelled=page.waitForEvent('requestfailed',r=>r.url().endsWith('/service-data'));
 await board.getByRole('button',{name:'关闭跟进看板',exact:true}).click();
 assert(await page.getByRole('button',{name:'新增跟进',exact:true}).isEnabled(),'Closing a pending edit read unlocks the workspace immediately');
 release();await cancelled;await page.waitForTimeout(100);
 assert.equal(await editor.count(),0);assert.equal(await board.count(),0);
 // Access failures hide business details and the edit action instead of showing cached history.
 await page.route('**/api/workspace/service-history?id='+record.id,route=>route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:'Synthetic access revoked'})}),{times:1});
 await page.getByRole('button',{name:record.title,exact:true}).click();await board.getByRole('alert').waitFor();
 assert.equal(await board.getByRole('heading',{name:record.title,exact:true}).count(),0);assert.equal(await board.getByRole('button',{name:'编辑跟进',exact:true}).count(),0);
 await board.getByRole('button',{name:'返回列表',exact:true}).click();
 // A history response from a closed board cannot overwrite the next record.
 let releaseHistory,seenHistory;const historyHeld=new Promise(resolve=>{releaseHistory=resolve;}),historyStarted=new Promise(resolve=>{seenHistory=resolve;});
 await page.route('**/api/workspace/service-history?id='+record.id,async route=>{const response=await route.fetch(),body=await response.body();seenHistory();await historyHeld;await route.fulfill({response,body}).catch(()=>{});},{times:1});
 await page.getByRole('button',{name:record.title,exact:true}).click();await historyStarted;
 await board.getByRole('button',{name:'关闭跟进看板',exact:true}).click();
 await open(second.title);releaseHistory();await page.waitForTimeout(100);assert.equal(await board.getByRole('heading',{name:second.title,exact:true}).count(),1);
 await board.getByRole('button',{name:'返回列表',exact:true}).click();
 await page.setViewportSize({width:390,height:844});await open(record.title);
 const bounds=await board.boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=391);assert(await board.locator('.sfb-body').evaluate(n=>n.scrollWidth<=n.clientWidth+1));
 await page.screenshot({path:'test-output/service-followup-board-mobile.png',fullPage:false});
 await board.getByRole('button',{name:'返回列表',exact:true}).click();
 await page.route('**/api/workspace/service-data',async route=>{const response=await route.fetch(),data=await response.json();await route.fulfill({response,json:{...data,canWrite:false}});},{times:1});
 await page.reload();await page.getByRole('button',{name:'全部跟进',exact:true}).click();await open(record.title);
 assert.equal(await board.getByRole('button',{name:'编辑跟进',exact:true}).count(),0,'Read-only viewers have no edit action');
 await board.getByRole('button',{name:'返回列表',exact:true}).click();assert.deepEqual(rows(),before);assert.deepEqual(errors,[]);assert.equal(posts,0);
 console.log('PASS floating read-only progress board: actual seven-version history and transitions, explicit edit, close/cancel race, access failure concealment, stale response isolation, mobile bounds, zero business writes and unchanged original rows');
}catch(error){
 if(browser){const pages=browser.contexts()[0].pages();await pages[0]?.screenshot({path:'test-output/service-search-failure.png',fullPage:true});console.error((await pages[0]?.locator('body').innerText())?.slice(-2400));}throw error;
}finally{
 await browser?.close();server.kill('SIGTERM');await done;
 if(errors.length)console.error(errors);
 if(process.exitCode)console.error(logs);
}
