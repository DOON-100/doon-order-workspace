// Isolated UI checks. No production data, accounts, ports or Kingdee network calls.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.DOON_PLAYWRIGHT_MODULE?pathToFileURL(process.env.DOON_PLAYWRIGHT_MODULE).href:'playwright');
const dist=path.resolve(process.env.DOON_BUILD_DIR||'test-output/kingdee-sales-build');
await fs.mkdir(path.resolve('test-output'),{recursive:true});
const dir=await fs.mkdtemp(path.resolve('test-output/kingdee-sales-ui-')),origin='http://127.0.0.1:18846';
const env={...Object.fromEntries(Object.entries(process.env).filter(([name])=>!/^DOON_KINGDEE_/i.test(name))),DOON_KINGDEE_SUPPLIER_SYNC_ENABLED:'0',DOON_KINGDEE_READONLY_ENABLED:'0',DOON_DATA_DIR:dir,DOON_HOST:'127.0.0.1',DOON_PORT:'18846',DOON_NO_AUTO_BACKUP:'1',DOON_KINGDEE_SALES_WRITE_ENABLED:'0'};
execFileSync(process.execPath,[path.join(dist,'manage.mjs'),'init'],{env,stdio:'pipe',windowsHide:true});
const password=(await fs.readFile(path.join(dir,'管理员首次登录.txt'),'utf8')).match(/初始密码：([^\n]+)/)[1];
const server=spawn(process.execPath,[path.join(dist,'server.mjs')],{env,stdio:'ignore',windowsHide:true});
let browser,cookie='';
async function api(route,body){const response=await fetch(origin+'/api/'+route,{method:body===undefined?'GET':'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];assert.equal(response.status,200);return response.json();}
const sourceLine={id:'synthetic_line',sourceRow:5,drawing:'SYN-D01',model:'SYN-M01',color:'C1',sku:'SOURCE-ONLY',quantity:20,unit:'副',sampleQuantity:2,unitPrice:'8.00',deliveryText:'2026-12-15',colorFields:[],rawFields:[],notes:[]};
const source={id:'synthetic_source',kind:'sales_order_source',version:1,status:'待核对',customer:'SYN-CUSTOMER',orderNo:'SYN-ORDER-001',source:{schemaVersion:1,customer:'SYN-CUSTOMER',orderNo:'SYN-ORDER-001',productType:'合成钛架',customerPO:'SYN-PO',documentType:'Sales Order Confirmation',source:{filename:'synthetic-only.xlsx',sha256:'a'.repeat(64),sheet:'中英文订单',detailRange:'A5:S5'},warnings:['合成样办数量单独核对'],lines:[sourceLine]},contentFingerprint:'b'.repeat(64),createdAt:'2026-01-01T00:00:00Z',createdById:'synthetic'};
const line={sourceLineId:sourceLine.id,categoryCode:'TI',drawing:'SYN-D01',customerModel:'SYN-M01',finishCode:'SYN-FINISH',color:'C1',quantity:'20',unitName:'副',unitPrice:'8.00',taxRate:'0',isFree:false,deliveryDate:'2026-12-15',remark:''};
let draft={id:'synthetic_draft',kind:'kingdee_sales_draft',version:1,sourceId:source.id,sourceHash:'b'.repeat(64),templateId:'synthetic_template',templateHash:'c'.repeat(64),ruleVersion:'synthetic-rule',customer:source.customer,orderNo:source.orderNo,inputs:{billDate:'2026-10-22',customerNumber:'SYN01',employeeName:'合成业务员',currencyName:'人民币',exchangeRate:'1',businessType:'赊销',taxMode:'exclusive',customerPO:'SYN-PO',remark:'',lines:[line]},status:'draft',validation:{valid:false,issues:[{field:'finishCode',sourceLineId:line.sourceLineId,message:'合成待核对颜色编码'}],warnings:[],codes:[],totalQuantity:'20.000000',netAmount:'160.00',taxAmount:'0.00',grossAmount:'160.00',checkedAt:'2026-10-22T01:00:00Z',remoteVerified:false},createdAt:'2026-10-22T01:00:00Z',updatedAt:'2026-10-22T01:00:00Z',createdById:'synthetic',updatedById:'synthetic',canPrepare:true,canConfirm:true,canUpload:false};
let exists=false,readError=false;const calls=[],errors=[];
const responseData=()=>({sources:[source],drafts:exists?[draft]:[],template:{id:'synthetic_template',filename:'合成金蝶模板.xlsx',headers:[]},connection:{configured:false,writeEnabled:false,readinessIssues:['业务类型映射待核定'],message:'合成连接：尚未开通销售订单直传，业务类型映射待核定。'},ruleVersion:'synthetic-rule',categories:['TI','AC']});
try{
 let healthy=false;for(let i=0;i<80;i++){try{if((await fetch(origin+'/health')).ok){healthy=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}assert(healthy);
 await api('auth/login',{username:'admin',password});await api('auth/password',{currentPassword:password,password:'Synthetic-Kingdee-UI-2026!'});
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-proxy-server']});
 const context=await browser.newContext({viewport:{width:1600,height:1060}}),separator=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,separator),value:cookie.slice(separator+1),url:origin}]);
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/api/workspace/kingdee-sales-*',async route=>{
  const request=route.request(),action=new URL(request.url()).pathname.split('/').at(-1);
  if(request.method()==='GET')return action==='kingdee-sales-data'?route.fulfill(readError?{status:403,json:{error:'合成授权失效'}}:{json:responseData()}):route.fulfill({status:400,json:{error:'合成导出未配置'}});
  const body=request.postDataJSON();calls.push({action,body});
  if(action==='kingdee-sales-prepare'){assert.equal(body.sourceId,source.id);exists=true;}
  else if(action==='kingdee-sales-save'){assert.equal(body.version,draft.version);draft={...draft,inputs:body.inputs,version:draft.version+1,status:'draft',confirmation:undefined,validation:{...draft.validation,valid:false}};}
  else if(action==='kingdee-sales-validate'){draft={...draft,version:draft.version+1,status:'validated',validation:{...draft.validation,valid:true,issues:[],netAmount:(Number(draft.inputs.lines[0].quantity)*Number(draft.inputs.lines[0].unitPrice)).toFixed(2),grossAmount:(Number(draft.inputs.lines[0].quantity)*Number(draft.inputs.lines[0].unitPrice)).toFixed(2)}};}
  else if(action==='kingdee-sales-confirm'){assert.equal(body.acknowledged,true);assert.equal(draft.status,'validated');draft={...draft,version:draft.version+1,status:'confirmed',confirmation:{actorId:'synthetic',actor:'合成客服',at:'2026-10-22T01:00:00Z',expiresAt:'2026-10-22T02:00:00Z',binding:'synthetic'}};}
  else throw Error('Unexpected UI write: '+action);
  return route.fulfill({json:{item:draft}});
 });
 await page.goto(origin+'/kingdee-sales');const panel=page.getByTestId('kingdee-sales-panel');await panel.getByRole('heading',{name:'选择中英文销售原单'}).waitFor();
 assert(await page.getByRole('button',{name:'金蝶销售订单 客服核对与上传'}).count() || await page.getByText('客服核对与上传',{exact:true}).count());
 await panel.getByRole('button',{name:'生成金蝶销售订单',exact:true}).click();await panel.getByRole('heading',{name:'SYN-ORDER-001',exact:true}).waitFor();
 assert(await panel.getByRole('button',{name:'客服确认无误',exact:true}).isDisabled());assert(await panel.getByRole('button',{name:'确认上传到金蝶',exact:true}).isDisabled());
 await panel.getByLabel('第1行单价',{exact:true}).fill('8.50');assert(await panel.getByRole('button',{name:'检查订单',exact:true}).isDisabled());assert(await panel.getByRole('button',{name:'下载金蝶模板订单',exact:true}).isDisabled());
 await panel.getByRole('button',{name:'保存草稿',exact:true}).click();await panel.getByRole('status').filter({hasText:'草稿已保存'}).waitFor();
 await panel.getByRole('button',{name:'检查订单',exact:true}).click();await panel.getByText('校验通过 · 待客服确认',{exact:true}).waitFor();
 assert(await panel.getByRole('button',{name:'客服确认无误',exact:true}).isDisabled());
 await panel.getByRole('checkbox',{name:'我已逐项核对整张销售订单，确认资料无误。'}).check();await panel.getByRole('button',{name:'客服确认无误',exact:true}).click();
 await panel.getByText('客服已确认 · 待上传',{exact:true}).waitFor();assert(await panel.getByRole('button',{name:'确认上传到金蝶',exact:true}).isDisabled());
 assert.match(await panel.innerText(),/业务类型映射待核定/);
 await page.evaluate(()=>{window.scrollTo(0,0);document.querySelector('.kingdee-sales-table')?.scrollTo(0,0);}); await page.screenshot({path:path.join(dir,'金蝶销售订单_合成验收.png'),fullPage:true});
 await panel.getByLabel('第1行单价',{exact:true}).fill('9.00');assert(await panel.getByRole('button',{name:'确认上传到金蝶',exact:true}).isDisabled());
 await panel.getByRole('button',{name:'保存草稿',exact:true}).click();await panel.getByText('待补充核对',{exact:true}).waitFor();assert.equal(await panel.getByText('客服确认：合成客服',{exact:false}).count(),0);
 readError=true;await panel.getByRole('button',{name:'刷新',exact:true}).click();await panel.getByRole('alert').filter({hasText:'合成授权失效'}).waitFor();assert.equal(await panel.getByLabel('第1行单价',{exact:true}).count(),0);
 assert(calls.every(call=>call.action!=='kingdee-sales-upload'));assert.equal(calls.filter(call=>call.action==='kingdee-sales-prepare').length,1);assert.deepEqual(errors,[]);
 console.log('PASS UI: 导航、整单草稿、缺项阻断、修改失效、客服勾选确认、直传阻断、读取失败隐藏原商业数据');console.log('SCREENSHOT '+path.join(dir,'金蝶销售订单_合成验收.png'));
}finally{if(browser)await browser.close();server.kill();}
