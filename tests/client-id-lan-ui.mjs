// Real browser + real HTTP requests, using an isolated synthetic origin and fixtures.
// This origin deliberately is not localhost: randomUUID is unavailable over HTTP.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import * as XLSX from 'xlsx';

const correctedPanels=['ar-invoice-ledger-panel','ar-customer-profile-panel','ar-workspace-panel','customer-workflow-files','customer-workflow-panel','handoff-business-panel','framework-offboarding-panel','framework-finance-task-panel','handoff-workbench-panel','handoff-framework-panel','payment-terms-panel','planning-control-panel'];
for(const name of correctedPanels){
 const source=await fs.readFile(`app/${name}.tsx`,'utf8');
 assert.doesNotMatch(source,/\bcrypto\.randomUUID\s*\(/,name+' must support HTTP LAN browsers');
 assert.match(source,/import \{clientId\} from '@\/lib\/client-id'/,name);
}
const bundle=await build({stdin:{contents:`
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {useWorkflowMutation} from './app/customer-workflow-panel';
import {CustomerWorkflowFiles} from './app/customer-workflow-files';
import {PaymentTermsPanel} from './app/payment-terms-panel';
import {clientId} from './lib/client-id';
globalThis.syntheticIds=Array.from({length:256},()=>clientId());
const data={me:{id:'synthetic-admin',name:'Synthetic admin',role:'admin',active:true},revision:1};
const cache=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
function Test(){const [saved,setSaved]=useState(0);const mutation=useWorkflowMutation(async()=>setSaved(n=>n+1));return <><button disabled={mutation.busy||!!mutation.pending} onClick={()=>mutation.run('customer-workflow-profile-save',{customerId:'synthetic-customer',version:1,patch:{note:'Synthetic LAN edit'}})}>Save synthetic workflow</button><output aria-label="workflow saved">{saved}</output>{mutation.feedback}<CustomerWorkflowFiles data={data} customerId="synthetic-customer"/><PaymentTermsPanel data={data}/></>}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={cache}><Test/></QueryClientProvider>);
`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,platform:'browser',format:'esm',write:false,alias:{'@':process.cwd()},loader:{'.css':'empty'},jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
const javascript=bundle.outputFiles.find(file=>file.path.endsWith('.js'))?.text||bundle.outputFiles[0].text;
const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.json_to_sheet([{item:'SYNTHETIC-LAN',quantity:7}]),'Synthetic');
const workbook=XLSX.write(book,{type:'buffer',bookType:'xlsx'});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const profileAttempts=[],uploadAttempts=[],termActions=[],serverErrors=[],browserErrors=[],files=[],terms=[];
const json=(res,body,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
const server=http.createServer(async(req,res)=>{
 try{
  const route=new URL(req.url,'http://synthetic-lan.test').pathname;
  if(route==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end('<!doctype html><div id="root"></div><script type="module" src="/test.js"></script>');return;}
  if(route==='/test.js'){res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8'});res.end(javascript);return;}
  if(route==='/favicon.ico'){res.writeHead(204);res.end();return;}
  if(route==='/api/workspace/customer-workflow-files'){json(res,{files,canWrite:true});return;}
  if(route==='/api/workspace/payment-terms-data'){json(res,{terms,capabilities:{create:true,configure:true,authorize:true,readOnly:false},authorizerMemberIds:['synthetic-admin'],authorityVersion:1,members:[]});return;}
  if(route==='/api/workspace/customer-workflow-file'){res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="synthetic-lan.xlsx"'});res.end(workbook);return;}
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const bytes=Buffer.concat(chunks);
  if(route==='/api/workspace/customer-workflow-file-upload'){
   const body=await new Request('http://synthetic-lan.test'+route,{method:'POST',headers:req.headers,body:bytes}).formData();
   assert.match(body.get('token'),uuid);assert.equal(body.get('customerId'),'synthetic-customer');assert.equal(body.get('file').name,'synthetic-lan.xlsx');assert.deepEqual(Buffer.from(await body.get('file').arrayBuffer()),workbook);
   uploadAttempts.push({token:body.get('token'),name:body.get('file').name});
   files.push({id:'synthetic-file',filename:'synthetic-lan.xlsx',title:body.get('title'),fileVersion:body.get('fileVersion'),category:body.get('category'),status:'待确认',size:workbook.length,contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',createdAt:'2026-10-20T01:00:00Z',createdBy:'Synthetic admin',version:1});
   json(res,{ok:true});return;
  }
  const body=bytes.length?JSON.parse(bytes):{};
  assert.match(body.token,uuid);
  if(route==='/api/workspace/customer-workflow-profile-save'){
   profileAttempts.push(body);json(res,profileAttempts.length===1?{error:'Synthetic uncertain response'}:{ok:true},profileAttempts.length===1?503:200);return;
  }
  if(route==='/api/workspace/payment-terms-save'){
   termActions.push({route,body});terms.push({...body,id:'synthetic-term',version:1,termVersion:1,status:'draft',createdById:'synthetic-admin'});json(res,{ok:true});return;
  }
  if(route==='/api/workspace/payment-terms-authorize'){
   termActions.push({route,body});terms[0].status='active';terms[0].version=2;json(res,{ok:true});return;
  }
  throw Error('Unexpected synthetic route '+route);
 }catch(error){serverErrors.push(error.message);json(res,{error:error.message},500);}
});
let browser;
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://synthetic-lan.test:${server.address().port}`;
 const playwright=await import(process.env.DOON_PLAYWRIGHT_MODULE?pathToFileURL(process.env.DOON_PLAYWRIGHT_MODULE).href:'playwright');
 browser=await playwright.chromium.launch({headless:true,...(process.env.DOON_CHROMIUM_PATH?{executablePath:process.env.DOON_CHROMIUM_PATH}:{channel:'chrome'}),args:['--no-proxy-server','--host-resolver-rules=MAP synthetic-lan.test 127.0.0.1']});
 const page=await browser.newPage({acceptDownloads:true});
 page.on('pageerror',error=>browserErrors.push(error.message));
 await page.goto(origin);
 await page.getByRole('button',{name:'Save synthetic workflow'}).waitFor();
 const environment=await page.evaluate(()=>({secure:globalThis.isSecureContext,randomUUID:typeof crypto.randomUUID,ids:globalThis.syntheticIds}));
 assert.equal(environment.secure,false);assert.equal(environment.randomUUID,'undefined');assert.equal(new Set(environment.ids).size,256);for(const id of environment.ids)assert.match(id,uuid);
 console.log('PASS actual insecure HTTP origin creates unique RFC 4122 UUIDs without crypto.randomUUID');
 await page.getByRole('button',{name:'Save synthetic workflow'}).click();
 await page.getByRole('button',{name:'核实并重试同一请求'}).click();
 await page.getByLabel('workflow saved').filter({hasText:'1'}).waitFor();
 assert.equal(profileAttempts.length,2);assert.deepEqual(profileAttempts[0],profileAttempts[1]);
 console.log('PASS workflow save reaches HTTP API and uncertain-response retry preserves the identical token and body');
 await page.getByRole('button',{name:'上传正式附件',exact:true}).click();
 await page.getByLabel('版本 *',{exact:true}).fill('SYN-V1');
 await page.getByLabel('原始文件 *',{exact:true}).setInputFiles({name:'synthetic-lan.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:workbook});
 await page.getByRole('button',{name:'保存',exact:true}).click();
 await page.getByRole('link',{name:'下载原件',exact:true}).waitFor();
 const downloading=page.waitForEvent('download');await page.getByRole('link',{name:'下载原件',exact:true}).click();
 const download=await downloading;assert.equal(download.suggestedFilename(),'synthetic-lan.xlsx');assert.deepEqual(await fs.readFile(await download.path()),workbook);assert.equal(uploadAttempts.length,1);
 console.log('PASS customer attachment uploads and downloads the same XLSX bytes over insecure HTTP');
 await page.getByRole('button',{name:'新增付款条件草稿',exact:true}).click();
 await page.getByLabel('付款条件名称',{exact:true}).fill('Synthetic LAN terms');
 await page.getByLabel('付款条件适用范围及依据',{exact:true}).fill('Synthetic test only');
 await page.getByRole('button',{name:'保存待授权草稿',exact:true}).click();
 await page.getByRole('button',{name:'审核条款并授权',exact:true}).click();
 await page.getByLabel('付款条件授权或停用依据',{exact:true}).fill('Synthetic confirmation');
 await page.getByRole('button',{name:'确认授权',exact:true}).click();
 await page.getByRole('button',{name:'停用',exact:true}).waitFor();
 assert.equal(termActions.length,2);assert.equal(termActions[1].body.id,'synthetic-term');assert.equal(termActions[1].body.version,1);assert.notEqual(termActions[0].body.token,termActions[1].body.token);
 console.log('PASS draft save and versioned confirmation reach the HTTP API with independent safe tokens');
 assert.deepEqual(serverErrors,[]);assert.deepEqual(browserErrors,[]);
 console.log(`PASS ${correctedPanels.length} corrected panels use the shared LAN-safe ID helper; no browser errors`);
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
