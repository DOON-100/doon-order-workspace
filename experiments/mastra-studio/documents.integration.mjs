import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {LibSQLStore} from '@mastra/libsql';
import {createStudio} from './server.mjs';
import {createLocalDocumentStore} from './document-store.mjs';
import {withModelAccess} from './model-scheduler.mjs';
import {setTimeout as delay} from 'node:timers/promises';
import sharp from 'sharp';

test('真实Mastra SDK将上传的Markdown送入DeepSeek并执行文档工具，得到可下载成果',{timeout:60000},async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'doon-doc-sdk-synthetic-'));
 const storage=new LibSQLStore({id:'syn-doc-'+randomUUID(),url:'file:'+path.join(dir,'memory.sqlite').replaceAll('\\','/')});
 const documents=await createLocalDocumentStore(dir);let studio,modelCalls=0,authChecks=0;
 const actor={id:'SYN-doc-user',role:'admin',name:'合成测试用户'},origin='https://studio.example.test';
 const fetchImpl=async(url,init)=>{
  assert.equal(String(url),'https://api.deepseek.com/chat/completions');modelCalls++;
  const body=JSON.parse(init.body);assert.equal(body.model,'deepseek-flash');assert.match(JSON.stringify(body.messages),/合成来源内容/);
  const result=body.messages.findLast(row=>row.role==='tool');
  const message=result?{role:'assistant',content:'已生成：[合成成果.md]('+JSON.parse(result.content).downloadUrl+')'}:{role:'assistant',content:null,tool_calls:[{id:'SYN-doc-call',type:'function',function:{name:'createDocument',arguments:JSON.stringify({format:'md',title:'合成成果',blocks:[{type:'heading',text:'合成结果',level:1},{type:'paragraph',text:'来自合成来源内容；测试环境，不含正式业务数据。'}]})}}]};
  return Response.json({id:'SYN-response-'+modelCalls,object:'chat.completion',created:1,model:'deepseek-flash',choices:[{index:0,message,finish_reason:result?'stop':'tool_calls'}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}});
 };
 const access={owner:actor.id,authorize:async()=>{authChecks++;}};
 try{
  studio=await createStudio({dataDir:dir,storage,documentStore:documents,cloud:true,liveReadOnly:true,scopeId:'SYN-doc-owner',deepseekOptions:{env:{DOON_STUDIO_MODEL:'deepseek-flash',DEEPSEEK_API_KEY:'synthetic-test-key'},fetchImpl}});
  const form=new FormData();form.set('file',new File(['# 合成来源内容\n测试环境，不含正式业务数据。'],'合成来源.md',{type:'text/markdown'}));
  const upload=await studio.handle(new Request(origin+'/studio/documents/upload',{method:'POST',headers:{Origin:origin},body:form}),{actor});assert.equal(upload.status,201);const input=await upload.json();
  const request=new Request(origin+'/studio/api/agents/supervisor/generate',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:'根据附件生成Markdown报告 [DOON_ATTACHMENT:'+input.id+']'}],memory:{thread:'SYN-doc-thread',resource:'supervisor'}})});
  const response=await withModelAccess(access,()=>studio.handle(request,{actor}));
  const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert.equal(modelCalls,2,JSON.stringify(result));
  const match=JSON.stringify(result).match(/\/studio\/documents\/([a-f0-9-]{36})\/download/);assert(match,JSON.stringify(result));
  const download=await studio.handle(new Request(origin+match[0]),{actor});assert.equal(download.status,200);assert.match(await download.text(),/合成结果/);assert(authChecks>=4);
  assert.equal((await documents.get('SYN-doc-owner',input.id)).threadId,'SYN-doc-thread');
 }finally{await studio?.close();if(!studio)await storage.close();await documents.close();await fs.rm(dir,{recursive:true,force:true,maxRetries:5});}
});

test('send-message确认收件后仍按原账号生成成果；图片进入官方Files请求',{timeout:60000},async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'doon-doc-stream-synthetic-'));
 const storage=new LibSQLStore({id:'syn-stream-'+randomUUID(),url:'file:'+path.join(dir,'memory.sqlite').replaceAll('\\','/')});
 const backing=await createLocalDocumentStore(dir),saved=[];
 const documents={...backing,async put(owner,value){const row=await backing.put(owner,value);if(value.kind==='output')saved.push({owner,...row});return row;}};
 let studio,modelCalls=0,fileCalls=0,release,acknowledged=false;const gate=new Promise(resolve=>{release=resolve;});
 const actor={id:'SYN-stream-user',role:'admin',name:'合成测试用户'},origin='https://studio.example.test';
 const fetchImpl=async(url,init)=>{
  if(String(url)==='https://api.deepseek.com/files'){
   fileCalls++;assert.equal(init.body.get('purpose'),'user_data');assert.equal(init.body.get('expires_after[seconds]'),'86400');
   const now=Math.floor(Date.now()/1000);return Response.json({id:'file-api-SYN-image',object:'file',bytes:init.body.get('file').size,purpose:'user_data',created_at:now,expires_at:now+86400});
  }
  assert.equal(String(url),'https://api.deepseek.com/chat/completions');modelCalls++;const body=JSON.parse(init.body);assert.equal(body.stream,true);
  assert(body.messages.some(message=>Array.isArray(message.content)&&message.content.some(part=>part.type==='file'&&part.file_id==='file-api-SYN-image')));
  const result=body.messages.findLast(row=>row.role==='tool'),number=modelCalls;
  return new Response(new ReadableStream({async start(controller){
   const chunk=(delta,finish=null)=>controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify({id:'SYN-stream-'+number,object:'chat.completion.chunk',created:1,model:'deepseek-flash',choices:[{index:0,delta,finish_reason:finish}]})+'\n\n'));
   chunk({role:'assistant'});
   if(!result){await gate;assert(acknowledged);chunk({tool_calls:[{index:0,id:'SYN-stream-tool',type:'function',function:{name:'createDocument',arguments:JSON.stringify({format:'md',title:'图片合成成果',blocks:[{type:'paragraph',text:'合成图片验收；测试环境，不含正式业务数据。'}]})}}]});chunk({},'tool_calls');}
   else{chunk({content:'已生成：[图片合成成果.md]('+JSON.parse(result.content).downloadUrl+')'});chunk({},'stop');}
   controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));controller.close();
  }}),{headers:{'Content-Type':'text/event-stream'}});
 };
 try{
  studio=await createStudio({dataDir:dir,storage,documentStore:documents,cloud:true,liveReadOnly:true,scopeId:'SYN-stream-owner',deepseekOptions:{env:{DOON_STUDIO_MODEL:'deepseek-flash',DEEPSEEK_API_KEY:'synthetic-stream-key'},fetchImpl}});
  const png=await sharp({create:{width:8,height:8,channels:3,background:'#336699'}}).png().toBuffer(),form=new FormData();form.set('file',new File([png],'合成图片.png',{type:'image/png'}));
  const uploaded=await studio.handle(new Request(origin+'/studio/documents/upload',{method:'POST',headers:{Origin:origin},body:form}),{actor});assert.equal(uploaded.status,201);const image=await uploaded.json();
  const request=new Request(origin+'/studio/api/agents/supervisor/send-message',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({message:'读取图片并生成Markdown [DOON_ATTACHMENT:'+image.id+']',threadId:'SYN-stream-thread',resourceId:'supervisor'})});
  const response=await withModelAccess({owner:actor.id,authorize:async()=>{}},()=>studio.handle(request,{actor}));
  assert(response.ok,await response.clone().text());acknowledged=true;assert.equal(saved.length,0);release();
  for(let i=0;i<200&&(!saved.length||studio.isBusy());i++)await delay(100);
  assert.equal(saved.length,1);assert.equal(saved[0].owner,'SYN-stream-owner');assert.equal(saved[0].threadId,'SYN-stream-thread');assert.equal(modelCalls,2);assert.equal(fileCalls,1,'同图第二轮工具返回时复用远端文件');
  const download=await studio.handle(new Request(origin+'/studio/documents/'+saved[0].id+'/download'),{actor});assert.equal(download.status,200);assert.match(await download.text(),/合成图片验收/);
 }finally{release();await studio?.close();if(!studio)await storage.close();await backing.close();await fs.rm(dir,{recursive:true,force:true,maxRetries:5});}
});
