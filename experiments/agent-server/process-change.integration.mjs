// Real Studio + real middleware handlers, synthetic identity/storage/transport.
// Optional Playwright drives the human confirmation page; no production network.
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {Readable} from 'node:stream';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createStudio} from '../mastra-studio/server.mjs';
import {LibSQLStore} from '../mastra-studio/node_modules/@mastra/libsql/dist/index.js';
import {createProcessChangeClient,createProcessChangeSession} from './process-change-client.mjs';
import {createBusinessReader,createBusinessAccess,withBusinessAccess} from './business-api.mjs';

const root=process.argv[process.argv.indexOf('--middleware-root')+1];
assert(process.argv.includes('--middleware-root')&&root,'Provide --middleware-root <checkout> with the synthetic harness');
const {createProcessChangeHarness}=await import(pathToFileURL(path.resolve(root,'tests/helpers/process-change-harness.mjs')));
const h=await createProcessChangeHarness(path.resolve(root));
const base=path.resolve('test-output'),dir=path.resolve(base,'process-confirmation-'+randomUUID());assert(dir.startsWith(base+path.sep));await fs.mkdir(dir,{recursive:true});
const storage=new LibSQLStore({id:'SYN-confirmation',url:'file:'+path.join(dir,'studio.sqlite').replaceAll('\\','/')});
const user={username:'SYN-ADMIN',role:'admin',personnelType:'internal',mustChange:false,identity:{id:'SYN-ADMIN',name:'合成管理员'}},cookie='doon_employee_session='+'s'.repeat(43),actor={id:'SYN-ADMIN',name:'合成管理员',role:'admin'};
let revoked=false,loseNext='',confirmCalls=0,origin,studio,server,browser;
const authenticate=async supplied=>!revoked&&supplied===cookie?user:null;
const transport=(options,done)=>{
 assert.equal(options.hostname,'host.docker.internal');assert.equal(options.headers.Cookie,cookie);assert.equal(options.rejectUnauthorized,true);
 const request=new EventEmitter();request.destroy=()=>request.emit('error',Error('SYN connection loss'));
 request.end=bytes=>queueMicrotask(async()=>{
  try{
   const action=options.path.replace('/api/workspace/','');
   if(action==='process-change-confirm')confirmCalls++;
   const result=await h.request(action,bytes?JSON.parse(bytes):undefined,h.admin,options.headers.Origin||'https://synthetic.test');
   if(loseNext===action){loseNext='';request.emit('error',Error('SYN dropped response after commit'));return;}
   const response=new EventEmitter();response.statusCode=result.status;response.headers=Object.fromEntries(result.headers);response.destroy=()=>response.emit('error',Error('SYN response closed'));done(response);
   response.emit('data',Buffer.from(await result.arrayBuffer()));response.emit('end');
  }catch(error){request.emit('error',error);}
 });return request;
};
const client=createProcessChangeClient({publicOrigin:'https://synthetic.test',transport});
const changes=createProcessChangeSession({cookie,user,authenticate,client});
const access=createBusinessAccess({cookie,user,authenticate,read:createBusinessReader({publicOrigin:'https://synthetic.test',transport}),stageProcessDraft:draft=>changes.stage(draft)});
const basis={sources:[{field:'title',reference:'合成测试指令',location:'本轮用户消息'}],unknowns:[],conflicts:[]};
const prepare=async title=>withBusinessAccess(access,()=>studio.tools.departmentQuality.execute({operation:'prepare',action:'prepare-process-iqc',arguments:{mode:'create',fields:{title,orderId:'SYN-O'},basis}}));
const call=async(body,id)=>{const request=new Request(origin+'/studio/process-change/api'+(body?'':'?id='+id),{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const response=await studio.handle(request,{actor,processChanges:changes});return{status:response.status,body:await response.json()};};
try{
 studio=await createStudio({dataDir:dir,storage,cloud:true,liveReadOnly:true,scopeId:'SYN-confirmation',deepseekOptions:{env:{DOON_STUDIO_MODEL:'offline'}}});
 server=http.createServer(async(req,res)=>{
  // This is a loopback synthetic browser adapter, never a deployable auth path.
  if(req.headers.cookie!==cookie){res.writeHead(401);res.end();return;}
  const bytes=[];for await(const chunk of req)bytes.push(chunk);
  const request=new Request(origin+req.url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(bytes)}:{})});
  const response=await withBusinessAccess(access,()=>studio.handle(request,{actor,workflowAccess:access,processChanges:changes}));
  res.writeHead(response.status,Object.fromEntries(response.headers));if(response.body)Readable.fromWeb(response.body).pipe(res);else res.end();
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
 const pending=await prepare('合成流程确认测试');assert.equal(pending.status,'pending-confirmation');assert.equal(pending.saved,false);assert.equal(confirmCalls,0);
 assert.equal(h.rows().filter(row=>row.kind==='process_record').length,0);
 const loaded=await call(undefined,pending.proposalId);assert.equal(loaded.body.status,'pending');
 assert.equal((await call({operation:'confirm',id:pending.proposalId,digest:loaded.body.digest,approved:false})).status,400);
 const missing=await studio.handle(new Request(origin+'/studio/process-change/api?id='+pending.proposalId),{actor});assert.equal(missing.status,403);
 const forged=await studio.handle(new Request(origin+'/studio/process-change/api',{method:'POST',headers:{Origin:'https://forged.invalid'},body:JSON.stringify({operation:'confirm',id:pending.proposalId,digest:loaded.body.digest,approved:true})}),{actor,processChanges:changes});assert.equal(forged.status,403);
 const refused=await withBusinessAccess(access,()=>studio.tools.departmentQuality.execute({operation:'confirm',action:'prepare-process-iqc',arguments:{} }));
 assert.equal(refused.error,true);assert.equal(confirmCalls,0);assert.equal(access.confirm,undefined);assert.equal(access.handle,undefined);
 if(process.env.DOON_PLAYWRIGHT_MODULE){
  const {chromium}=await import(pathToFileURL(process.env.DOON_PLAYWRIGHT_MODULE));
  browser=await chromium.launch({headless:true,channel:'chrome',args:['--no-proxy-server']});
  const context=await browser.newContext();await context.addCookies([{name:'doon_employee_session',value:'s'.repeat(43),url:origin}]);
  const page=await context.newPage();await page.goto(origin+pending.previewUrl);await page.waitForSelector('#summary:not([hidden])');
  assert.equal(await page.locator('#confirm').isDisabled(),true);
  await page.locator('#approved').check();assert.equal(await page.locator('#confirm').isEnabled(),true);
  await page.screenshot({path:path.join(dir,'preview.png'),fullPage:true});
  loseNext='process-change-confirm';await page.locator('#confirm').click();await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('未取得执行回执'));
  assert.equal(await page.locator('#confirm').isDisabled(),true);assert.equal(confirmCalls,1);
  await page.locator('#refresh').click();await page.waitForFunction(()=>document.querySelector('#message').textContent.startsWith('已保存，并已回读'));
  assert.equal(confirmCalls,1);assert.equal(h.rows().filter(row=>row.kind==='process_record').length,1);
  await page.screenshot({path:path.join(dir,'confirmed.png'),fullPage:true});
  const second=await prepare('合成取消预览');await page.goto(origin+second.previewUrl);await page.waitForSelector('#summary:not([hidden])');await page.locator('#cancel').click();await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('已取消'));
  assert.equal(h.rows().filter(row=>row.kind==='process_record').length,1);
  await context.close();
 }else{
  loseNext='process-change-confirm';
  const uncertain=await call({operation:'confirm',id:pending.proposalId,digest:loaded.body.digest,approved:true});assert.equal(uncertain.status,202);assert.equal(uncertain.body.executed,null);
 }
 const outcome=await call(undefined,pending.proposalId);assert.equal(outcome.body.status,'confirmed');assert.equal(outcome.body.currentRecord.id,outcome.body.receipt.recordId);
 const repeat=await call({operation:'confirm',id:pending.proposalId,digest:loaded.body.digest,approved:true});assert.equal(repeat.body.readbackVerified,true);assert.equal(h.rows().filter(row=>row.kind==='process_record').length,1);
 loseNext='process-change-preview';const uncertainPreview=await prepare('合成预览响应丢失');assert.equal(uncertainPreview.status,'preview-uncertain');assert.equal((await call(undefined,uncertainPreview.proposalId)).body.status,'pending');
 revoked=true;assert.equal((await call(undefined,pending.proposalId)).status,403);await assert.rejects(prepare('合成撤权'),{status:403});
 console.log(JSON.stringify({passed:true,browser:!!browser,confirmationReplaySafe:true,screenshots:browser?dir:null}));
}finally{
 await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));await studio?.close();if(!studio)await storage.close();await h.close();
 // Keep synthetic screenshots and diagnostics under ignored test-output.
}
