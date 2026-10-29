// Browser acceptance uses only synthetic files, a temporary database and loopback.
// No production service, account, document or real model API is used.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {Readable} from 'node:stream';
import {pathToFileURL} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {LibSQLStore} from '@mastra/libsql';
import sharp from 'sharp';
import {createStudio} from './server.mjs';
import {createLocalDocumentStore} from './document-store.mjs';
import {createDocuments} from './documents.mjs';
import {withModelAccess} from './model-scheduler.mjs';
import {createAgentServer} from '../agent-server/http-server.mjs';

const digest=value=>createHash('sha256').update(value).digest('hex');
const actor={id:'SYN-browser-owner',role:'admin',name:'合成浏览器用户'};
const user={username:actor.id,role:actor.role,personnelType:'internal',mustChange:false,identity:actor};
const cookie='doon_employee_session='+'s'.repeat(43);
const access={owner:actor.id,authorize:async()=>{}};
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const close=async server=>{if(!server)return;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));};

test('pinned Studio browser uploads Markdown and image, sends both and downloads its generated document',{timeout:120000},async()=>{
 const {chromium}=await import(process.env.DOON_PLAYWRIGHT_MODULE?pathToFileURL(process.env.DOON_PLAYWRIGHT_MODULE).href:'playwright');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'doon-doc-ui-synthetic-'));
 const storage=new LibSQLStore({id:'SYN-ui-'+randomUUID(),url:'file:'+path.join(dir,'memory.sqlite').replaceAll('\\','/')});
 const backing=await createLocalDocumentStore(dir),saved=[],calls=[],requests=[],pageErrors=[];
 const documents={...backing,async put(owner,value){const row=await backing.put(owner,value);saved.push({owner,...row});return row;}};
 let studio,server,browser,origin;
 const modelFetch=async(url,init)=>{
  const endpoint=String(url);calls.push(endpoint);
  if(endpoint==='https://api.deepseek.com/user/balance')return Response.json({is_available:true,balance_infos:[{currency:'CNY',total_balance:'1',granted_balance:'0',topped_up_balance:'1'}]});
  if(endpoint==='https://api.deepseek.com/files'){
   assert.equal(init.body.get('purpose'),'user_data');const now=Math.floor(Date.now()/1000);
   return Response.json({id:'file-api-SYN-browser',object:'file',bytes:init.body.get('file').size,purpose:'user_data',created_at:now,expires_at:now+86400});
  }
  assert.equal(endpoint,'https://api.deepseek.com/chat/completions','No other model destination is allowed');
  const body=JSON.parse(init.body);assert.equal(body.stream,true);assert.match(JSON.stringify(body.messages),/合成来源正文/);
  assert(body.messages.some(message=>Array.isArray(message.content)&&message.content.some(part=>part.type==='file'&&part.file_id==='file-api-SYN-browser')));
  const tool=body.messages.findLast(message=>message.role==='tool');
  return new Response(new ReadableStream({start(controller){
   const chunk=(delta,finish=null)=>controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify({id:'SYN-ui-model',object:'chat.completion.chunk',created:1,model:'deepseek-flash',choices:[{index:0,delta,finish_reason:finish}]})+'\n\n'));
   chunk({role:'assistant'});
   if(!tool){chunk({tool_calls:[{index:0,id:'SYN-ui-tool',type:'function',function:{name:'createDocument',arguments:JSON.stringify({format:'md',title:'合成浏览器成果',blocks:[{type:'heading',text:'合成验收结果',level:1},{type:'paragraph',text:'合成来源正文和图片；测试环境，不含正式业务数据。'}]})}}]});chunk({},'tool_calls');}
   else{chunk({content:'已生成：[合成浏览器成果.md]('+JSON.parse(tool.content).downloadUrl+')'});chunk({},'stop');}
   controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));controller.close();
  }}),{headers:{'Content-Type':'text/event-stream'}});
 };
 try{
  studio=await createStudio({dataDir:dir,storage,documentStore:documents,cloud:true,liveReadOnly:true,scopeId:'SYN-browser-scope',deepseekOptions:{env:{DOON_STUDIO_MODEL:'deepseek-flash',DEEPSEEK_API_KEY:'synthetic-browser-key'},fetchImpl:modelFetch}});
  server=http.createServer(async(req,res)=>{
   // Synthetic HTTP adapter for the real Studio; never a deployable auth path.
   if(req.headers.cookie!==cookie){res.writeHead(401);return res.end();}
   try{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const bytes=Buffer.concat(chunks);requests.push({method:req.method,path:req.url,bytes:bytes.length});
    const request=new Request(origin+req.url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:bytes}:{})});
    const response=await withModelAccess(access,()=>studio.handle(request,{actor}));
    res.writeHead(response.status,Object.fromEntries(response.headers));if(response.body)Readable.fromWeb(response.body).pipe(res);else res.end();
   }catch{res.writeHead(503);res.end('Synthetic test adapter failed');}
  });await listen(server);assert.notEqual(server.address().port,8787);origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,channel:'chrome',args:['--no-proxy-server']});
  const context=await browser.newContext({acceptDownloads:true});await context.addCookies([{name:'doon_employee_session',value:'s'.repeat(43),url:origin}]);
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort('blockedbyclient'));
  const page=await context.newPage();page.on('pageerror',error=>pageErrors.push(error.message));
  await page.goto(origin+'/studio/agents/supervisor/chat');await page.getByPlaceholder('输入消息…').waitFor();
  const markdown=Buffer.from('# 合成来源正文\n测试环境，不含正式业务数据。\n');
  const png=await sharp({create:{width:8,height:8,channels:3,background:'#336699'}}).png().toBuffer();
  await page.getByRole('button',{name:'添加附件',exact:true}).click();
  const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'添加本地文件',exact:true}).click();
  await(await chooser).setFiles([{name:'合成来源.md',mimeType:'text/markdown',buffer:markdown},{name:'合成图片.png',mimeType:'image/png',buffer:png}]);
  await page.getByText('合成来源.md',{exact:true}).first().waitFor();
  await page.getByPlaceholder('输入消息…').fill('请阅读两个附件，并生成 Markdown 报告。');
  await page.getByRole('button',{name:'发送',exact:true}).click();
  const link=page.getByRole('link',{name:'合成浏览器成果.md',exact:true});
  try{await link.waitFor({timeout:30000});}catch(error){console.log(JSON.stringify({failure:await page.locator('body').innerText(),requests,calls,pageErrors}));throw error;}
  const ready=page.waitForEvent('download');await link.click();const downloaded=await ready;
  assert.equal(downloaded.suggestedFilename(),'合成浏览器成果.md');const downloadedBytes=await fs.readFile(await downloaded.path());
  assert.match(downloadedBytes.toString(),/合成验收结果/);
  assert.equal(saved.filter(row=>row.kind==='input').length,2);assert.equal(saved.filter(row=>row.kind==='output').length,1);
  assert.equal(saved.find(row=>row.filename==='合成来源.md').sha256,digest(markdown));assert.equal(saved.find(row=>row.filename==='合成图片.png').sha256,digest(png));
  assert.equal(digest(downloadedBytes),saved.find(row=>row.kind==='output').sha256);
  assert.equal(requests.filter(row=>row.path==='/studio/documents/upload').length,2);
  assert.equal(requests.filter(row=>row.method==='POST'&&row.path.endsWith('/send-message')).length,1);
  assert.equal(calls.filter(url=>url.endsWith('/files')).length,1);assert.equal(calls.filter(url=>url.endsWith('/chat/completions')).length,2);
  assert.deepEqual(pageErrors,[]);
  const beforeRejectedUploads=requests.filter(row=>row.path==='/studio/documents/upload').length;
  const beforeRejectedSends=requests.filter(row=>row.method==='POST'&&row.path.endsWith('/send-message')).length;
  await page.getByRole('button',{name:'添加附件',exact:true}).click();
  const oversizeChooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'添加本地文件',exact:true}).click();
  await(await oversizeChooser).setFiles([{name:'合成超限.md',mimeType:'text/markdown',buffer:Buffer.alloc(10*1024*1024+1,65)}]);
  await page.getByText('合成超限.md',{exact:true}).first().waitFor();
  const draft='合成超限失败后必须保留的草稿';await page.getByPlaceholder('输入消息…').fill(draft);
  await page.getByRole('button',{name:'发送',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'10 MiB'}).waitFor();
  assert.equal(await page.getByPlaceholder('输入消息…').inputValue(),draft);
  assert.equal(requests.filter(row=>row.path==='/studio/documents/upload').length,beforeRejectedUploads);
  assert.equal(requests.filter(row=>row.method==='POST'&&row.path.endsWith('/send-message')).length,beforeRejectedSends);
  assert.equal(saved.filter(row=>row.kind==='output').length,1);
 }finally{await browser?.close();await close(server);await studio?.close();if(!studio)await storage.close();await backing.close();assert(path.basename(dir).startsWith('doon-doc-ui-synthetic-'));await fs.rm(dir,{recursive:true,force:true,maxRetries:5});}
});

test('real Agent HTTP gateway accepts a 10 MiB image with multipart overhead and rejects larger documents',{timeout:60000},async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'doon-doc-http-synthetic-')),store=await createLocalDocumentStore(dir);
 const documents=createDocuments({store,owner:'SYN-http-owner',model:'deepseek-flash'});let handled=0,holdUploads=false,releaseUploads;
 const uploadGate=new Promise(resolve=>{releaseUploads=resolve;});
 const server=createAgentServer({publicOrigin:'https://synthetic.test',authenticate:async value=>value===cookie?user:null,studio:{async handle(request){handled++;if(holdUploads&&new URL(request.url).pathname==='/studio/documents/upload')await uploadGate;return await documents.handle(request)||new Response(null,{status:404});}}});
 const call=async(request)=>{
  const bytes=request.body?Buffer.from(await request.arrayBuffer()):null;
  return new Promise((resolve,reject)=>{
   const outbound=http.request({hostname:'127.0.0.1',port:server.address().port,path:new URL(request.url).pathname,method:request.method,headers:{...Object.fromEntries(request.headers),Host:'synthetic.test',Cookie:cookie,...(bytes?{'Content-Length':bytes.length}:{})}},response=>{
    const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,bytes:Buffer.concat(chunks)}));response.on('error',reject);
   });outbound.on('error',reject);outbound.end(bytes);
  });
 };
 const upload=bytes=>{const form=new FormData();form.set('file',new File([bytes],'合成边界.png',{type:'image/png'}));return call(new Request('https://synthetic.test/studio/documents/upload',{method:'POST',headers:{Origin:'https://synthetic.test'},body:form}));};
 try{
  await listen(server);assert.notEqual(server.address().port,8787);
  const small=await sharp({create:{width:8,height:8,channels:3,background:'#336699'}}).png().toBuffer();
  // PNG remains decodable with trailing padding; this tests transport byte size,
  // actual image validation and persistence without a large decompression cost.
  const maximum=Buffer.concat([small,Buffer.alloc(10*1024*1024-small.length)]);
  const accepted=await upload(maximum);assert.equal(accepted.status,201,accepted.bytes.toString());
  const row=JSON.parse(accepted.bytes);assert.equal(row.size,maximum.length);assert.equal(row.sha256,digest(maximum));
  const download=await call(new Request('https://synthetic.test'+row.downloadUrl));assert.equal(download.status,200);assert.equal(digest(download.bytes),digest(maximum));
  const rejected=await upload(Buffer.concat([maximum,Buffer.from([0])]));assert.equal(rejected.status,413);assert.match(rejected.bytes.toString(),/10 MiB/);
  const beforeGatewayRejection=handled;
  const tooMuch=await upload(Buffer.alloc(11*1024*1024));assert.equal(tooMuch.status,413);assert.equal(handled,beforeGatewayRejection,'overlarge multipart never reaches Studio');
  const chat=await call(new Request('https://synthetic.test/studio/api/agents/supervisor/send-message',{method:'POST',headers:{Origin:'https://synthetic.test','Content-Type':'application/json'},body:' '.repeat(512*1024+1)}));
  assert.equal(chat.status,413);assert.equal(handled,beforeGatewayRejection,'normal API retains the smaller body limit');
  assert.equal((await store.get('SYN-http-owner',row.id)).sha256,digest(maximum));
  holdUploads=true;const beforeConcurrent=handled,inflight=Array.from({length:4},()=>upload(small));
  for(let attempt=0;handled<beforeConcurrent+4&&attempt<100;attempt++)await delay(20);
  assert.equal(handled,beforeConcurrent+4,'four uploads must reach the document handler');
  assert.equal((await upload(small)).status,429,'fifth active upload is refused');
  assert.equal((await upload(small)).status,429,'a rejected request must not decrement another upload slot');
  assert.equal(handled,beforeConcurrent+4);releaseUploads();
  assert.deepEqual((await Promise.all(inflight)).map(response=>response.status),[201,201,201,201]);
  holdUploads=false;assert.equal((await upload(small)).status,201,'completed uploads return their capacity');
 }finally{releaseUploads();await close(server);await store.close();assert(path.basename(dir).startsWith('doon-doc-http-synthetic-'));await fs.rm(dir,{recursive:true,force:true,maxRetries:5});}
});
