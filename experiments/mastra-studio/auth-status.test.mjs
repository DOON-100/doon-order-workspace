import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

test('browser preserves drafts and responses, distinguishes auth states and never replays submissions',async()=>{
 const {chromium}=await import(process.env.DOON_PLAYWRIGHT_MODULE?pathToFileURL(process.env.DOON_PLAYWRIGHT_MODULE).href:'playwright');
 const script=await fs.readFile(new URL('./auth-status.js',import.meta.url),'utf8');
 const requests=[];
 const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end('<html><head><script>'+script+'</script></head><body><textarea id="draft"></textarea></body></html>');}
  requests.push({path:url.pathname,method:req.method});
  const state=url.searchParams.get('state'),status=state==='temporary'?503:state==='expired'?401:state==='forbidden'?403:200;
  setTimeout(()=>{res.writeHead(status,{'Content-Type':'application/json','X-Doon-Auth-Status':state||'verified'});res.end(JSON.stringify({untouched:'SYN-response',state}));},Number(url.searchParams.get('delay'))||0);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 try{
  browser=await chromium.launch({headless:true,channel:'chrome',args:['--no-proxy-server']});
  const page=await browser.newPage(),origin='http://127.0.0.1:'+server.address().port;
  await page.goto(origin);await page.locator('#draft').fill('SYN-unsaved draft');
  const call=state=>page.evaluate(async state=>{const r=await fetch('/studio/api/save?state='+state,{method:'POST',body:'SYN-payload'});return{status:r.status,body:await r.json()};},state);
  assert.deepEqual(await call('temporary'),{status:503,body:{untouched:'SYN-response',state:'temporary'}});
  assert.match(await page.locator('#doon-auth-status').innerText(),/尚未确认登录失效/);assert.equal(await page.locator('#doon-auth-status a').count(),0);
  assert.equal(await page.locator('#draft').inputValue(),'SYN-unsaved draft');assert.equal(page.url(),origin+'/');
  assert.equal(requests.filter(r=>r.path==='/studio/api/save').length,1);
  await call('expired');assert.match(await page.locator('#doon-auth-status').innerText(),/登录已失效/);
  assert.equal(await page.locator('#doon-auth-status a').getAttribute('target'),'_blank');assert.equal(await page.locator('#doon-auth-status a').getAttribute('href'),'/login');
  await call('forbidden');assert.match(await page.locator('#doon-auth-status').innerText(),/无权访问/);assert.equal(await page.locator('#doon-auth-status a').count(),0);
  await call('verified');assert.equal(await page.locator('#doon-auth-status').count(),0);
  await page.evaluate(()=>fetch('/unrelated?state=temporary'));assert.equal(await page.locator('#doon-auth-status').count(),0);
  await page.evaluate(()=>Promise.all([fetch('/studio/api/slow?state=temporary&delay=80'),fetch('/studio/api/new?state=verified')]));
  assert.equal(await page.locator('#doon-auth-status').count(),0,'older failure must not overwrite later verified response');
  await page.evaluate(()=>Promise.all([fetch('/studio/api/slow?state=verified&delay=80'),fetch('/studio/api/new?state=temporary')]));
  assert.match(await page.locator('#doon-auth-status').innerText(),/尚未确认登录失效/);
  await page.locator('#doon-auth-status button').click();assert.equal(await page.locator('#doon-auth-status').count(),0);
  assert.equal(await page.locator('#draft').inputValue(),'SYN-unsaved draft');assert.equal(requests.filter(r=>r.method==='POST').length,4);
  const result=await page.evaluate(async()=>{document.createElement=()=>{throw new Error('synthetic DOM failure');};return(await fetch('/studio/api/notice?state=expired')).json();});
  assert.equal(result.untouched,'SYN-response','notification errors do not reject successful fetch transport');
 }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
