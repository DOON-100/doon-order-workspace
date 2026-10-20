// Real Studio and native API route; synthetic records, identity and transport only.
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {Readable} from 'node:stream';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createStudio} from '../mastra-studio/server.mjs';
import {executeDepartment} from '../mastra-studio/department-executor.mjs';
import {LibSQLStore} from '../mastra-studio/node_modules/@mastra/libsql/dist/index.js';
import {createProcessChangeClient,createProcessChangeSession} from './process-change-client.mjs';
import {createBusinessReader,createBusinessAccess,withBusinessAccess} from './business-api.mjs';
assert(process.argv.includes('--middleware-root'),'Provide --middleware-root <native checkout>');
const root=path.resolve(process.argv[process.argv.indexOf('--middleware-root')+1]);
const {createProcessChangeHarness}=await import(pathToFileURL(path.join(root,'tests/helpers/process-change-harness.mjs')));
const {seedPurchase}=await import(pathToFileURL(path.join(root,'tests/helpers/purchase-change-fixture.mjs')));
const h=await createProcessChangeHarness(root),original=seedPurchase(h);
const base=path.resolve('test-output'),dir=path.resolve(base,'purchase-confirmation-'+randomUUID());assert(dir.startsWith(base+path.sep));await fs.mkdir(dir,{recursive:true});
const storage=new LibSQLStore({id:'SYN-purchase-confirmation',url:'file:'+path.join(dir,'studio.sqlite').replaceAll('\\','/')});
const user={username:'SYN-ADMIN',role:'admin',personnelType:'internal',mustChange:false,identity:{id:'SYN-ADMIN',name:'合成管理员'}},cookie='doon_employee_session='+'s'.repeat(43),actor={id:'SYN-ADMIN',name:'合成管理员',role:'admin'};
let revoked=false,loseNext='',confirmCalls=0,studio,server,browser,origin;
const authenticate=async value=>!revoked&&value===cookie?user:null;
const transport=(options,done)=>{
 assert.equal(options.hostname,'host.docker.internal');assert.equal(options.headers.Cookie,cookie);assert.equal(options.rejectUnauthorized,true);
 const request=new EventEmitter();request.destroy=()=>request.emit('error',Error('SYN loss'));
 request.end=bytes=>queueMicrotask(async()=>{
  try{
   const action=options.path.replace('/api/workspace/','');if(action==='purchase-change-confirm')confirmCalls++;
   const result=await h.request(action,bytes?JSON.parse(bytes):undefined,h.admin,options.headers.Origin||'https://synthetic.test');
   if(loseNext===action){loseNext='';request.emit('error',Error('SYN dropped after commit'));return;}
   const response=new EventEmitter();response.statusCode=result.status;response.headers=Object.fromEntries(result.headers);response.destroy=()=>response.emit('error',Error('SYN closed'));done(response);response.emit('data',Buffer.from(await result.arrayBuffer()));response.emit('end');
  }catch(error){request.emit('error',error);}
 });return request;
};
const client=createProcessChangeClient({publicOrigin:'https://synthetic.test',transport,domain:'purchase'});
const changes=createProcessChangeSession({cookie,user,authenticate,client,domain:'purchase'});
const access=createBusinessAccess({cookie,user,authenticate,read:createBusinessReader({publicOrigin:'https://synthetic.test',transport}),stagePurchaseDraft:draft=>changes.stage(draft)});
const basis={sources:[{field:'quantity',reference:'合成送货单',location:'合成单据第 4 行'}],unknowns:[],conflicts:[]};
const current=()=>h.rows().find(row=>row.id===original.id);
const args=(operation,extra={})=>({id:original.id,expectedVersion:current().version,basis,...(operation==='followup'?{fields:{expectedDate:'2026-10-28',followupNote:'合成采购跟进'}}:operation==='archive'?{date:'2026-10-20',note:'合成已齐货核对'}:{quantity:10,date:'2026-10-20',reference:'SYN-'+randomUUID(),note:'合成实际单据'}),...extra});
const request=(operation,extra={})=>({operation:'prepare',action:'prepare-purchase-'+operation,arguments:args(operation,extra)});
const prepare=(operation,extra={})=>withBusinessAccess(access,()=>studio.tools.departmentPurchasing.execute(request(operation,extra)));
const call=async(body,id)=>{
 const req=new Request(origin+'/studio/purchase-change/api'+(body?'':'?id='+id),{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const response=await studio.handle(req,{actor,purchaseChanges:changes});return{status:response.status,body:await response.json()};
};
try{
 studio=await createStudio({dataDir:dir,storage,cloud:true,liveReadOnly:true,scopeId:'SYN-purchase',deepseekOptions:{env:{DOON_STUDIO_MODEL:'offline'}}});
 server=http.createServer(async(req,res)=>{
  // Loopback synthetic browser adapter. This is not a deployable authentication path.
  if(req.headers.cookie!==cookie){res.writeHead(401);res.end();return;}
  const chunks=[];for await(const c of req)chunks.push(c);
  const request=new Request(origin+req.url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
  const response=await withBusinessAccess(access,()=>studio.handle(request,{actor,workflowAccess:access,purchaseChanges:changes}));
  res.writeHead(response.status,Object.fromEntries(response.headers));if(response.body)Readable.fromWeb(response.body).pipe(res);else res.end();
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
 const catalog=await executeDepartment('purchasing',{operation:'list'},access);assert.equal(catalog.actions.filter(row=>row.kind==='purchase-draft').length,5);
 for(const operation of ['followup','receipt','return','replacement','archive']){
  const contract=await executeDepartment('purchasing',{operation:'inspect',action:'prepare-purchase-'+operation,arguments:{}},access);assert(contract.arguments.properties.expectedVersion);
 }
 for(const extra of [{token:randomUUID()},{actorId:'SYN-OTHER'},{quantity:0},{date:'2026-02-30'},{returnPending:0}]){
  await assert.rejects(executeDepartment('purchasing',request('receipt',extra),access));
 }
 await assert.rejects(executeDepartment('finance',request('receipt'),access),/当前部门/);
 await assert.rejects(executeDepartment('purchasing',{...request('receipt'),operation:'confirm'},access));
 await assert.rejects(access.withEvent({},()=>executeDepartment('purchasing',request('receipt'),accessForEvent())),/后台事件/);
 const withoutStage={...access,stagePurchaseDraft:undefined};const local=await executeDepartment('purchasing',request('receipt'),withoutStage);assert.equal(local.status,'draft-only');
 const first=await prepare('followup');assert.equal(first.status,'pending-confirmation');assert.equal(first.saved,false);assert.deepEqual(current(),original);
 assert.equal((await studio.handle(new Request(origin+'/studio/purchase-change/api?id='+first.proposalId),{actor})).status,403);
 const loaded=await call(undefined,first.proposalId);
 const forged=await studio.handle(new Request(origin+'/studio/purchase-change/api',{method:'POST',headers:{Origin:'https://cross.invalid'},body:JSON.stringify({operation:'confirm',id:first.proposalId,digest:loaded.body.digest,approved:true})}),{actor,purchaseChanges:changes});assert.equal(forged.status,403);
 let page;
 if(process.env.DOON_PLAYWRIGHT_MODULE){
  const {chromium}=await import(pathToFileURL(process.env.DOON_PLAYWRIGHT_MODULE));browser=await chromium.launch({headless:true,channel:'chrome',args:['--no-proxy-server']});
  const context=await browser.newContext();await context.addCookies([{name:'doon_employee_session',value:'s'.repeat(43),url:origin}]);page=await context.newPage();
 }
 const finish=async(draft,{lost=false,screenshot}={})=>{
  const loaded=await call(undefined,draft.proposalId),input={operation:'confirm',id:draft.proposalId,digest:loaded.body.digest,approved:true};
  const prior=confirmCalls;if(lost)loseNext='purchase-change-confirm';
  if(page){
   await page.goto(origin+draft.previewUrl);await page.waitForSelector('#summary:not([hidden])');assert(await page.locator('#confirm').isDisabled());
   assert((await page.locator('#fields').innerText()).includes('SYN-PO-001'));assert((await page.locator('#fields').innerText()).includes('合成镜片'));
   if(screenshot)await page.screenshot({path:path.join(dir,screenshot+'-preview.png'),fullPage:true});
   await page.locator('#approved').check();await page.locator('#confirm').click();
   if(lost){await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('未取得执行回执'));assert(await page.locator('#confirm').isDisabled());await page.locator('#refresh').click();}
   await page.waitForFunction(()=>document.querySelector('#message').textContent.startsWith('已保存，并已回读'));
   if(screenshot)await page.screenshot({path:path.join(dir,screenshot+'-saved.png'),fullPage:true});
  }else{const result=await call(input);assert.equal(result.status,lost?202:200);}
  assert.equal(confirmCalls,prior+1);const after=await call(undefined,draft.proposalId);assert.equal(after.body.status,'confirmed');assert.equal(after.body.currentRecord.id,original.id);return input;
 };
 await finish(first,{screenshot:'followup'});assert.equal(current().expectedDate,'2026-10-28');
 const receipt=await prepare('receipt',{quantity:20});const repeat=await finish(receipt,{lost:true,screenshot:'receipt'});assert.equal(current().received,40);
 const beforeReplay=h.rows();await call(repeat);assert.deepEqual(h.rows(),beforeReplay);
 await finish(await prepare('return'));assert.equal(current().received,30);assert.equal(current().returnPending,10);
 await finish(await prepare('replacement'));assert.equal(current().received,40);assert.equal(current().returnPending,0);
 await finish(await prepare('receipt',{quantity:60}));assert.equal(current().received,100);
 await finish(await prepare('archive'),{screenshot:'archive'});assert.equal(current().lifecycle,'archived');
 await finish(await prepare('return',{quantity:5}));assert.equal(current().lifecycle,'active');
 const cancel=await prepare('followup'),cancelBody=(await call(undefined,cancel.proposalId)).body;const beforeCancel=current();await call({operation:'cancel',id:cancel.proposalId,digest:cancelBody.digest});assert.deepEqual(current(),beforeCancel);
 loseNext='purchase-change-preview';const uncertain=await prepare('followup');assert.equal(uncertain.status,'preview-uncertain');assert.equal((await call(undefined,uncertain.proposalId)).body.status,'pending');
 revoked=true;assert.equal((await call(undefined,receipt.proposalId)).status,403);await assert.rejects(prepare('followup'),{status:403});
 for(const key of ['raw','sourceHash','sourceFile','sourceVersion','quantity','supplier','itemCode','customerOrder'])assert.deepEqual(current()[key],original[key]);
 console.log(JSON.stringify({passed:true,actions:5,browser:!!browser,screenshots:browser?dir:null}));
}finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));await studio?.close();if(!studio)await storage.close();await h.close();}
// Resolve the actual event-scoped context, never the unrestricted parent object.
import {currentBusinessAccess as accessForEvent} from './business-api.mjs';
