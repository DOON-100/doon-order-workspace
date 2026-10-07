// Synthetic, isolated logo regression. Never reads production data or credentials.
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {randomBytes,createHash} from 'node:crypto';

const {chromium}=await import(process.env.DOON_PLAYWRIGHT_MODULE?pathToFileURL(process.env.DOON_PLAYWRIGHT_MODULE).href:'playwright');
const dist=path.resolve(process.env.DOON_BUILD_DIR||'test-output/quote-review-build');
await fs.mkdir(path.resolve('test-output'),{recursive:true});
const root=await fs.mkdtemp(path.resolve('test-output/company-logo-browser-'));
const port=await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(0,'127.0.0.1',()=>{const value=probe.address().port;probe.close(error=>error?reject(error):resolve(value));});});
const origin=`http://127.0.0.1:${port}`;
const env={...process.env,DOON_DATA_DIR:root,DOON_HOST:'127.0.0.1',DOON_PORT:String(port),DOON_NO_AUTO_BACKUP:'1'};
const asset='/brand/doon-eyewear-manufacturing.jpg';
const logoSelector=`img[src="${asset}"]`;
const sourceBytes=await fs.readFile(path.resolve('public'+asset));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const checks=[],errors=[],logoEvidence=[];
const pass=label=>{checks.push(label);console.log('PASS '+label);};
// manage init is run only after DOON_DATA_DIR points to this newly-created directory.
execFileSync(process.execPath,[path.join(dist,'manage.mjs'),'init'],{env,stdio:'pipe',windowsHide:true});
const initial=(await fs.readFile(path.join(root,'管理员首次登录.txt'),'utf8')).match(/初始密码：([^\n]+)/)[1].trim();
const personalPassword='Logo-Synthetic-'+randomBytes(18).toString('hex');
const server=spawn(process.execPath,[path.join(dist,'server.mjs')],{env,stdio:'pipe',windowsHide:true});
let browser,serverErrors='';
server.stderr.on('data',b=>serverErrors+=b);server.stdout.on('data',()=>{});

async function checkLogo(page,container,label){
 const logo=page.locator(container).locator(logoSelector);
 assert.equal(await logo.count(),1,`${label}: one shared logo is required.`);
 await logo.waitFor({state:'visible'});
 await logo.evaluate(async node=>{if(!node.complete)await node.decode();});
 const value=await logo.evaluate(node=>{const box=node.getBoundingClientRect(),style=getComputedStyle(node);return{src:node.getAttribute('src'),alt:node.alt,naturalWidth:node.naturalWidth,naturalHeight:node.naturalHeight,width:box.width,height:box.height,left:box.left,right:box.right,objectFit:style.objectFit,transform:style.transform};});
 assert.equal(value.src,asset);assert(value.alt.trim(),`${label}: accessible company description required.`);
 assert(value.naturalWidth>0&&value.naturalHeight>0,`${label}: image must load.`);
 assert(value.width>0&&value.height>0,`${label}: displayed dimensions must be nonzero.`);
 assert(Math.abs(value.width/value.height-value.naturalWidth/value.naturalHeight)<0.03,`${label}: logo must retain its original aspect ratio.`);
 assert(value.left>=-1&&value.right<=page.viewportSize().width+1,`${label}: image must not overflow viewport.`);
 assert.equal(value.transform,'none',`${label}: the original mark must not be transformed.`);
 if(container==='.cq-document-header'){
  assert(value.width<=240,`${label}: quotation logo must stay compact, not expand across the header.`);
  const layout=await page.locator(container).evaluate(header=>{
   const rect=node=>{const box=node.getBoundingClientRect();return{left:box.left,top:box.top,right:box.right,bottom:box.bottom,width:box.width,height:box.height};};
   return{header:rect(header),logo:rect(header.querySelector('img')),company:rect(header.querySelector('.cq-company')),stamp:rect(header.querySelector('.cq-draft-stamp'))};
  });
  for(const key of ['company','stamp']){
   const box=layout[key],tolerance=key==='stamp'?4:1; // The existing draft stamp has a small decorative rotation.
   assert(box.width>0&&box.height>0,`${label}: ${key} must remain visible.`);
   assert(box.left>=layout.header.left-tolerance&&box.right<=layout.header.right+tolerance,`${label}: ${key} must not be pushed outside the header.`);
   assert(box.top>=layout.header.top-tolerance&&box.bottom<=layout.header.bottom+tolerance,`${label}: ${key} must fit within the header.`);
   const overlapX=Math.min(box.right,layout.logo.right)-Math.max(box.left,layout.logo.left),overlapY=Math.min(box.bottom,layout.logo.bottom)-Math.max(box.top,layout.logo.top);
   assert(overlapX<=1||overlapY<=1,`${label}: logo must not overlap ${key}.`);
  }
 }
 logoEvidence.push({label,...value});
}
async function noHorizontalOverflow(page,label){assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${label}: document must not overflow horizontally.`);}
async function api(context,route,body){
 const response=body===undefined?await context.request.get(origin+'/api/'+route):await context.request.post(origin+'/api/'+route,{headers:{Origin:origin},data:body});
 const result=await response.json();assert.equal(response.status(),200,JSON.stringify(result));return result;
}

try{
 let ready=false;for(let i=0;i<70;i++){try{if((await fetch(origin+'/health')).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}assert(ready,'Isolated server failed to start.');
 const imageResponse=await fetch(origin+asset);assert.equal(imageResponse.status,200);assert.match(imageResponse.headers.get('content-type')||'',/^image\/jpeg(?:;|$)/i);assert.equal(digest(Buffer.from(await imageResponse.arrayBuffer())),digest(sourceBytes));
 pass('The static server delivers the original JPEG byte-for-byte with image/jpeg MIME.');
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-proxy-server']});
 const context=await browser.newContext({viewport:{width:1510,height:1000}}),page=await context.newPage();
 page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
 await page.goto(origin+'/customer-quotes');await page.getByRole('heading',{name:'登录订单协作中台',exact:true}).waitFor();
 await checkLogo(page,'.lan-login-intro','desktop login');
 assert.doesNotMatch(await page.locator('.lan-login-intro').innerText(),/DOON\s*\/\s*度昂/);
 const iconHref=await page.locator('link[rel="icon"]').getAttribute('href');
 if(iconHref===asset){assert.equal(iconHref,asset);}else{const icon=await fetch(new URL(iconHref,origin));assert(icon.ok);const body=await icon.text();assert(body.includes(asset)||body.includes(sourceBytes.toString('base64')),'Favicon must use the same uploaded mark, not the old D icon.');}
 await page.screenshot({path:path.join(root,'login-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});await checkLogo(page,'.lan-login-intro','mobile login');await noHorizontalOverflow(page,'mobile login');await page.screenshot({path:path.join(root,'login-mobile.png'),fullPage:true});
 pass('Desktop/mobile login and favicon use the uploaded company mark without distortion or horizontal overflow.');
 await page.setViewportSize({width:1510,height:1000});
 await page.getByLabel('登录账号',{exact:true}).fill('admin');await page.getByLabel('登录密码',{exact:true}).fill(initial);await page.getByRole('button',{name:'登录',exact:true}).click();
 await page.getByRole('heading',{name:'设置你的个人密码',exact:true}).waitFor();await checkLogo(page,'.lan-login-intro','first-login password change');
 await page.getByLabel('当前密码',{exact:true}).fill(initial);await page.getByLabel('新密码',{exact:true}).fill(personalPassword);await page.getByLabel('确认新密码',{exact:true}).fill(personalPassword);await page.getByRole('button',{name:'保存密码并进入',exact:true}).click();
 await page.getByRole('heading',{name:'客户报价',exact:true}).waitFor();await checkLogo(page,'.rail .brand','desktop sidebar');
 assert.equal(await page.locator('.brand-mark').count(),0,'Old glasses-symbol brand must be removed.');
 assert.doesNotMatch(await page.locator('.rail .brand').innerText(),/DOON/,'Old text-built wordmark must not remain.');
 await page.locator('.rail').screenshot({path:path.join(root,'sidebar-desktop.png')});
 pass('A fresh synthetic admin can change its initial password and the shared workspace sidebar uses the same mark.');
 const draft={customerAccountId:null,companyZh:'合成测试公司',companyEn:'Synthetic Test Company',customerCode:'TEST-LOGO',customerName:'Synthetic Logo Customer',contactName:'Synthetic Contact',quoteNo:'SYNTHETIC-LOGO-01',quoteDate:'2026-10-01',validUntil:'2026-10-31',currency:'USD',lines:[{id:'synthetic-logo-line',model:'SYNTHETIC-FRAME',descriptionZh:'合成测试镜架',descriptionEn:'Synthetic test frame',quantity:300,unitPrice:10,toolingFee:0}],terms:[],reviewNotes:['仅用于LOGO测试，不用于生产报价']};
 const saved=await api(context,'workspace/customer-quote-save',draft);assert.equal(saved.quote.status,'draft');
 await page.reload();await page.getByText('SYNTHETIC-FRAME',{exact:true}).first().waitFor();
 for(const [tab,file] of [['中文内部版','quote-zh'],['English','quote-en'],['中英对照（内部）','quote-bilingual']]){
  await page.getByRole('tab',{name:tab,exact:true}).click();await checkLogo(page,'.cq-document-header',`${tab} quotation`);
  assert.equal((await page.locator('.cq-document-header').innerText()).includes('DOON'),false,'No text-built logo should remain in the quotation header.');
  await page.locator('.cq-document-header').screenshot({path:path.join(root,file+'-header.png')});
  await page.emulateMedia({media:'print'});await checkLogo(page,'.cq-document-header',`${tab} print`);assert.equal(await page.locator('.rail').isVisible(),false);await page.locator('.cq-document-header').screenshot({path:path.join(root,file+'-print-header.png')});await page.emulateMedia({media:'screen'});
 }
 pass('Chinese, English and bilingual quotation previews and print headers all use the identical image instead of a text logo.');
 await page.getByRole('tab',{name:'English',exact:true}).click();await page.setViewportSize({width:390,height:844});await checkLogo(page,'.rail .brand','mobile sidebar');await checkLogo(page,'.cq-document-header','mobile English quotation');await noHorizontalOverflow(page,'mobile quotation');await page.screenshot({path:path.join(root,'quote-mobile.png'),fullPage:true});
 pass('Mobile sidebar and quotation retain the original logo ratio without clipping or page overflow.');
 assert.deepEqual(errors,[]);assert.equal((await api(context,'workspace/customer-quote-completed')).rows.length,0);const after=(await api(context,'workspace/customer-quotes')).quotes;assert.equal(after.length,1);assert.equal(after[0].version,1);assert.equal(after[0].status,'draft');
 pass('Logo navigation and print checks produce no browser errors and never confirm or mutate the synthetic quotation.');
 const result={passed:checks.length,checks,root,asset,sha256:digest(sourceBytes),logoEvidence,at:new Date().toISOString()};
 await fs.writeFile(path.resolve('test-output/company-logo-browser-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({root,passed:checks.length}));
}catch(error){
 if(serverErrors)console.error(serverErrors);
 for(const context of browser?.contexts()||[]){for(const page of context.pages()){await page.screenshot({path:path.join(root,'failure.png'),fullPage:true}).catch(()=>{});}}
 console.error('Evidence: '+root);throw error;
}finally{await browser?.close();server.kill();}
