// Full UI/API acceptance with synthetic records and an isolated random port only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {spawn,execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require(process.env.DOON_PLAYWRIGHT_MODULE||'playwright');
const build=path.resolve(process.env.DOON_BUILD_DIR||'test-output/acetate-release-build'),dir=await fs.mkdtemp(path.resolve('test-output/acetate-browser-'));
const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));const origin='http://127.0.0.1:'+port;
const env={...process.env,DOON_DATA_DIR:dir,DOON_PORT:String(port),DOON_HOST:'127.0.0.1',DOON_NO_AUTO_BACKUP:'1',DOON_KINGDEE_SUPPLIER_SYNC_ENABLED:'0',DOON_KINGDEE_READONLY_ENABLED:'0'};
execFileSync(process.execPath,[path.join(build,'manage.mjs'),'init'],{env,stdio:'pipe'});const initial=(await fs.readFile(path.join(dir,'管理员首次登录.txt'),'utf8')).match(/初始密码：([^\n]+)/)[1];
const db=new DatabaseSync(path.join(dir,'workspace.sqlite')),owner=JSON.parse(db.prepare("SELECT data FROM records WHERE kind='member' AND json_extract(data,'$.owner')=1").get().data),add=r=>db.prepare('INSERT INTO records(id,kind,data) VALUES(?,?,?)').run(r.id,r.kind,JSON.stringify(r));
for(const [id,role] of [['test-engineer','production'],['test-reviewer','production'],['test-manager','production']])add({id,kind:'member',name:id,role,email:id+'@test.invalid',userId:id,active:true,customers:[]});
add({id:'test-policy',kind:'ie_quote_policy',version:1,engineerMemberId:'test-engineer',reviewerMemberId:'test-reviewer',finalApproverMemberId:'test-manager'});add({id:'synthetic-customer',kind:'customer_account',customer:'Synthetic customer',customerCode:'SYN',active:true});
const before=db.prepare('SELECT id,data FROM records ORDER BY id').all();db.close();
const server=spawn(process.execPath,[path.join(build,'server.mjs')],{env,windowsHide:true,stdio:'pipe'}),done=new Promise(r=>server.once('exit',r));let logs='';server.stdout.on('data',s=>logs+=s);server.stderr.on('data',s=>logs+=s);let browser;
try{
 for(let i=0;i<60;i++){try{if((await fetch(origin+'/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({headless:true,...(process.env.DOON_BROWSER_EXECUTABLE?{executablePath:process.env.DOON_BROWSER_EXECUTABLE}:{})});const ctx=await browser.newContext({viewport:{width:1440,height:1000}}),page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const post=async(action,body)=>{const r=await ctx.request.post(origin+'/api/'+action,{data:body,headers:{Origin:origin}});assert.equal(r.status(),200,await r.text());return r.json();};
 await post('auth/login',{username:'admin',password:initial});await post('auth/password',{currentPassword:initial,password:'Synthetic-Only-Browser-2026!'});
 await page.goto(origin+'/ie-quotes');await page.getByRole('button',{name:'板材整副BOM',exact:true}).click();await page.getByLabel('BOM客户').selectOption('synthetic-customer');await page.getByLabel('BOM款号').fill('SYN-AC-01');await page.getByLabel('BOM图纸版本').fill('A');
 const common=async()=>{for(const [label,value] of [['厚度 mm','4'],['供应商','Synthetic supplier'],['色号','TEST-01'],['ERP物料编码（可待补）','TEST-AC'],['采购板长 mm','1000'],['采购板宽 mm','200'],['总扣长 mm','0'],['总扣宽 mm','0'],['毛坯独立切缝 mm','0'],['原板重量 kg/条','1'],['价格 元/kg','10']])await page.getByLabel(label,{exact:true}).fill(value);};
 await common();await page.getByLabel('零件长 mm',{exact:true}).fill('90');await page.getByLabel('最高 / 最宽 mm',{exact:true}).fill('34');
 await page.locator('.acbom aside').getByRole('button',{name:/左右脾料/}).click();await common();await page.getByLabel('零件长 mm',{exact:true}).fill('90');await page.getByLabel('最高 / 最宽 mm',{exact:true}).fill('6');
 await page.getByRole('button',{name:'＋庄头拼料层',exact:true}).click();await common();await page.getByLabel('尺寸口径',{exact:true}).selectOption('blank');await page.getByLabel('零件长 mm',{exact:true}).fill('20');await page.getByLabel('最高 / 最宽 mm',{exact:true}).fill('10');await page.getByLabel('每副件数',{exact:true}).fill('4');
 await page.getByRole('button',{name:'整副BOM汇总',exact:true}).click();assert.match(await page.locator('.acbom').innerText(),/0\.034/);assert.match(await page.locator('.acbom').innerText(),/0\.34元/);
 await page.getByRole('button',{name:/保存BOM草稿/}).click();await page.getByRole('status').filter({hasText:'整副板材BOM已保存为v1'}).waitFor();
 const index=await (await ctx.request.get(origin+'/api/workspace/acetate-boms')).json();assert.equal(index.records.length,1);const record=await (await ctx.request.get(origin+'/api/workspace/acetate-boms?id='+index.records[0].id)).json();assert.equal(record.record.fields.components.length,3);assert(Math.abs(record.record.result.totalKg-.034)<1e-10);assert.equal(record.history.length,1);
 await page.getByRole('button',{name:'已保存版本',exact:true}).click();await page.getByRole('button',{name:'查看详情',exact:true}).click();await page.getByRole('dialog',{name:'板材BOM详情'}).waitFor();assert.match(await page.getByRole('dialog').innerText(),/SYN-AC-01/);await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
 await page.getByRole('button',{name:'查看详情',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'v1',exact:true}).click();assert.equal(await page.getByRole('dialog').getByRole('button',{name:'编辑当前BOM',exact:true}).count(),0);await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'整副BOM汇总',exact:true}).click();const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出BOM复核CSV'}).click();const file=await download;assert.match(file.suggestedFilename(),/BOM复核\.csv$/);
 const afterDb=new DatabaseSync(path.join(dir,'workspace.sqlite'),{readOnly:true});for(const r of before)assert.equal(afterDb.prepare('SELECT data FROM records WHERE id=?').get(r.id).data,r.data);afterDb.close();assert.deepEqual(errors,[]);
 await page.screenshot({path:path.join(dir,'whole-bom.png'),fullPage:true});await fs.writeFile(path.join(dir,'acceptance.json'),JSON.stringify({syntheticOnly:true,passed:true,checks:['whole-frame-temple-endpiece','same-stock-merge','server-recalculation','save-and-readback','readonly-details-and-history','csv-download','existing-records-unchanged','no-browser-errors']}));console.log('PASS real browser: circle + temples + four endpieces = .034 kg/pair, save/version/details/history/export; all prior records unchanged.');
}catch(e){console.error(logs.slice(-1000));throw e;}finally{if(browser)await browser.close();server.kill();await done;}
