// Isolated synthetic server only. Never reads production passwords or sessions.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
const output=path.resolve('test-output'),dist=path.resolve(process.env.DOON_BUILD_DIR||'test-output/page-priority-build');
assert(dist.startsWith(output+path.sep));
const dir=await fs.mkdtemp(path.join(output,'page-priority-browser-')),port=18826,origin=`http://127.0.0.1:${port}`;
const env={...Object.fromEntries(Object.entries(process.env).filter(([name])=>!/^DOON_KINGDEE_/i.test(name))),DOON_KINGDEE_SUPPLIER_SYNC_ENABLED:'0',DOON_KINGDEE_READONLY_ENABLED:'0',DOON_DATA_DIR:dir,DOON_HOST:'127.0.0.1',DOON_PORT:String(port),DOON_NO_AUTO_BACKUP:'1',DOON_SERVER_MODE:'internal',DOON_REVIEW_MODE:'0',DOON_EMPLOYEE_PUBLIC_ORIGIN:'',DOON_TLS_CERT:'',DOON_TLS_KEY:''};
execFileSync(process.execPath,[path.join(dist,'manage.mjs'),'init'],{env,stdio:'pipe',windowsHide:true});
const initial=(await fs.readFile(path.join(dir,'管理员首次登录.txt'),'utf8')).match(/初始密码：([^\n]+)/)[1];
let server,browser,page,logs='',cookie='';const errors=[],events=[];
const pass=message=>console.log('PASS '+message);
async function api(route,body){const r=await fetch(origin+'/api/'+route,{method:body?'POST':'GET',headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];assert.equal(r.status,200);return r.json();}
function recordHash(){const db=new DatabaseSync(path.join(dir,'workspace.sqlite'),{readOnly:true});try{return createHash('sha256').update(JSON.stringify(db.prepare('SELECT id,kind,data FROM records ORDER BY id').all())).digest('hex');}finally{db.close();}}
async function openNav(id){const item=page.locator(`[data-nav-id="${id}"]`),toggle=item.locator('xpath=ancestor::*[@data-department-id]').locator('.department-navigation-toggle');if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();await item.click();}
try{
 server=spawn(process.execPath,[path.join(dist,'server.mjs')],{env,stdio:'pipe',windowsHide:true});server.stdout.on('data',v=>logs+=v);server.stderr.on('data',v=>logs+=v);
 let ready=false;for(let i=0;i<100;i++){try{if((await fetch(origin+'/health')).ok){ready=true;break;}}catch{}await delay(100);}assert(ready);
 await api('auth/login',{username:'admin',password:initial});await api('auth/password',{currentPassword:initial,password:'Synthetic-Priority-Admin-2026!'});
 const before=recordHash();
 const {chromium}=await import(process.env.DOON_PLAYWRIGHT_MODULE?pathToFileURL(process.env.DOON_PLAYWRIGHT_MODULE).href:'playwright');
 browser=await chromium.launch({headless:true,...(process.env.DOON_CHROMIUM_PATH?{executablePath:process.env.DOON_CHROMIUM_PATH}:{channel:'chrome'}),args:['--no-proxy-server']});
 const context=await browser.newContext({viewport:{width:1536,height:1000}}),split=cookie.indexOf('=');
 await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),url:origin,httpOnly:true,sameSite:'Strict'}]);
 page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 let hold=false,held='',release;
 const gate=new Promise(resolve=>release=resolve);
 await page.route('**/api/workspace/**',async route=>{
  const request=route.request(),action=new URL(request.url()).pathname.split('/').at(-1);
  const event={action,method:request.method(),at:Date.now(),done:0};events.push(event);
  try{
   if(hold&&!held&&request.method()==='GET'&&!['data','business-team-data','project-collaboration-data'].includes(action)){held=action;await gate;}
   const result=await route.fetch();await delay(80);await route.fulfill({response:result});event.done=Date.now();
  }catch{/* Navigation intentionally aborts speculative requests. */}
 });
 await page.goto(origin+'/personal-tasks');
 await page.waitForResponse(r=>r.url().includes('/api/workspace/project-collaboration-data')&&r.ok());
 await page.getByRole('heading',{name:'我的待办',exact:true,level:2}).waitFor();
 const task=events.find(e=>e.action==='project-collaboration-data');assert(task);
 const extra=events.filter(e=>!['data','business-team-data','enroll','project-collaboration-data'].includes(e.action));assert.equal(extra.length,0,'other pages must not compete with initial tasks');
 pass('Direct entry loads current personal tasks before speculative sources.');
 hold=true;
 await page.waitForFunction(()=>true);
 for(let i=0;i<100&&!held;i++)await delay(100);assert(held,'Idle background prefetch should start');
 const heldEvent=events.find(e=>e.action===held&&e.at>task.at);assert(heldEvent.at-task.at>=2500,'Background must wait for an idle interval');
 const clickAt=Date.now();
 const requested=page.waitForRequest(r=>new URL(r.url()).pathname==='/api/workspace/drawing-data');
 await openNav('engineering-drawings');await requested;
 const drawing=events.find(e=>e.action==='drawing-data'&&e.at>=clickAt);assert(drawing&&drawing.at-clickAt<2500,'Current page must preempt the blocked background source');
 release();await page.waitForResponse(r=>new URL(r.url()).pathname==='/api/workspace/drawing-data'&&r.ok());
 pass('Navigating to engineering preempts an unfinished background read.');
 const enrollmentCount=events.filter(e=>e.action==='enroll').length;
 const warmed=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/workspace/customer-project-data'&&r.ok());
 await openNav('personal-tasks');await warmed;await delay(150);
 const projectReads=events.filter(e=>e.action==='customer-project-data').length;
 const validated=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/workspace/read-version'&&r.ok());
 await openNav('customer-projects');await validated;await delay(400);
 assert.equal(events.filter(e=>e.action==='customer-project-data').length,projectReads,'A validated preload must avoid downloading the same page data again');
 pass('A later page reuses its background data after checking current membership and revision.');
 await openNav('workbench');
 await page.locator('[data-handoff-workbench]').waitFor();await delay(1600);
 assert.equal(events.filter(e=>e.action==='enroll').length,enrollmentCount,'Navigation must not repeatedly enroll');
 await page.screenshot({path:path.join(dir,'workbench.png'),fullPage:true});
 pass('Switching pages preserves the workspace and avoids repeated enrollment.');
 assert.equal(recordHash(),before,'Scheduling and prefetch must not edit any business records');assert.deepEqual(errors,[]);
 await fs.writeFile(path.join(dir,'result.json'),JSON.stringify({events,errors,before,after:recordHash()},null,2));
 pass('No browser runtime errors; record hashes remain identical.');console.log('Browser report: '+dir);
}catch(error){if(page)await page.screenshot({path:path.join(dir,'failure.png'),fullPage:true}).catch(()=>{});await fs.writeFile(path.join(dir,'server.log'),logs);throw error;}
finally{await browser?.close();server?.kill();}
