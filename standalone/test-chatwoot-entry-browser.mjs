// Browser verification of the compiled email entry, using only synthetic local data.
// The destination is explicitly synthetic; this is not live Chatwoot acceptance.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {spawn,execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
const require=createRequire(import.meta.url),{chromium}=require(process.env.DOON_PLAYWRIGHT_MODULE||'playwright');
const build=path.resolve(process.env.DOON_BUILD_DIR||'test-output/chatwoot-build-realpath'),dir=await fs.mkdtemp(path.resolve('test-output/chatwoot-entry-browser-'));
const socket=net.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));const origin='http://127.0.0.1:'+port;
const env={...Object.fromEntries(Object.entries(process.env).filter(([name])=>!/^DOON_KINGDEE_/i.test(name))),DOON_DATA_DIR:dir,DOON_PORT:String(port),DOON_HOST:'127.0.0.1',DOON_NO_AUTO_BACKUP:'1',DOON_KINGDEE_SUPPLIER_SYNC_ENABLED:'0',DOON_KINGDEE_READONLY_ENABLED:'0',DOON_KINGDEE_PENDING_SYNC_ENABLED:'0',DOON_SYNTHETIC_ONLY:'1'};
execFileSync(process.execPath,[path.join(build,'manage.mjs'),'init'],{env,stdio:'pipe',windowsHide:true});
const initial=(await fs.readFile(path.join(dir,'管理员首次登录.txt'),'utf8')).match(/初始密码：([^\n]+)/)[1];
const server=spawn(process.execPath,[path.join(build,'server.mjs')],{env,windowsHide:true,stdio:'pipe'}),done=new Promise(resolve=>server.once('exit',resolve));let browser,logs='';server.stdout.on('data',bytes=>logs+=bytes);server.stderr.on('data',bytes=>logs+=bytes);
try{
 for(let i=0;i<80;i++){try{if((await fetch(origin+'/health')).ok)break;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
 browser=await chromium.launch({headless:true,...(process.env.DOON_BROWSER_EXECUTABLE?{executablePath:process.env.DOON_BROWSER_EXECUTABLE}:{})});
 const context=await browser.newContext(),page=await context.newPage();let enabled=true;
 await context.route('**/chatwoot/status',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({enabled})}));
 await context.route('**/chatwoot/enter',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Synthetic destination</title><p>Synthetic Chatwoot destination only</p>'}));
 for(const [action,body] of [['login',{username:'admin',password:initial}],['password',{currentPassword:initial,password:'Synthetic-Chatwoot-Only-2026!'}]]){const response=await context.request.post(origin+'/api/auth/'+action,{data:body,headers:{Origin:origin}});assert.equal(response.status(),200);}
 const db=new DatabaseSync(path.join(dir,'workspace.sqlite'),{readOnly:true});const before=db.prepare('SELECT id,kind,data FROM records ORDER BY id').all();db.close();
 await page.goto(origin+'/mail');const link=page.getByRole('link',{name:'进入 Chatwoot（新标签页）'});await link.waitFor({state:'visible'});
 assert.equal(await link.getAttribute('href'),'/chatwoot/enter');assert.equal(await page.locator('#workspace-navigation [data-chatwoot-entry]').count(),0);
 const popupPromise=page.waitForEvent('popup');await link.click();const popup=await popupPromise;await popup.waitForLoadState('domcontentloaded');assert.equal(popup.url(),origin+'/chatwoot/enter');assert.match(await popup.locator('body').innerText(),/Synthetic Chatwoot destination only/);await popup.close();
 await page.goto(origin+'/whatsapp');await page.locator('[data-handoff-channel="whatsapp"]').waitFor();assert.equal(await page.locator('[data-chatwoot-entry]').count(),0);
 enabled=false;await page.goto(origin+'/mail');await page.locator('[data-handoff-channel="email"]').waitFor();await page.waitForTimeout(300);assert.equal(await page.locator('[data-chatwoot-entry]').count(),0);
 const checked=new DatabaseSync(path.join(dir,'workspace.sqlite'),{readOnly:true});assert.deepEqual(checked.prepare('SELECT id,kind,data FROM records ORDER BY id').all(),before);checked.close();
 console.log('PASS compiled email button clicked in a new tab; absent from navigation/WhatsApp; unavailable entry hidden; synthetic records unchanged. Destination was synthetic, not live Chatwoot.');
}catch(error){console.error(logs.slice(-1800));throw error;}finally{await browser?.close();server.kill();await done;}
