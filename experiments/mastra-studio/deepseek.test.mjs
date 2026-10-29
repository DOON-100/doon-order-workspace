import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDeepSeekStatus,explainError,loadDeepSeekFileKey} from './deepseek.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {createModelScheduler,withModelAccess} from './model-scheduler.mjs';

const key='synthetic-only-not-a-real-secret';
const balance={is_available:true,balance_infos:[{currency:'CNY',total_balance:'12.3400',granted_balance:'2.3400',topped_up_balance:'10.0000'},{currency:'USD',total_balance:'1.20',granted_balance:'0.00',topped_up_balance:'1.20'}]};
test('文件密钥同步到服务端标准变量；空文件不沿用旧密钥，无文件配置保持原变量',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'deepseek-file-key-')),file=path.join(dir,'key');
 try{
  const env={DEEPSEEK_API_KEY_FILE:file,DEEPSEEK_API_KEY:'synthetic-old'};
  await fs.writeFile(file,key+'\n');await loadDeepSeekFileKey(env);assert.equal(env.DEEPSEEK_API_KEY,key);
  await fs.writeFile(file,'\n');await loadDeepSeekFileKey(env);assert.equal(env.DEEPSEEK_API_KEY,undefined);
  await fs.writeFile(file,'invalid key');await assert.rejects(()=>loadDeepSeekFileKey(env),/invalid key configuration/);
  const direct={DEEPSEEK_API_KEY:key};await loadDeepSeekFileKey(direct);assert.equal(direct.DEEPSEEK_API_KEY,key);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('缺少密钥不发请求；真实模型配置必须有服务端密钥',async()=>{
 let calls=0;const service=createDeepSeekStatus({env:{},fetchImpl:async()=>{calls++;}});
 assert.equal((await service.get()).status,'unconfigured');assert.equal(calls,0);
 await assert.rejects(()=>createDeepSeekStatus({env:{DOON_STUDIO_MODEL:'deepseek-flash'}}).model(),/server-side API key/);
});
test('余额保留原币种和小数，单飞缓存与手动刷新不会形成请求风暴',async()=>{
 let calls=0,clock=100000;const service=createDeepSeekStatus({env:{DEEPSEEK_API_KEY:key},now:()=>clock,fetchImpl:async(url,init)=>{assert.equal(url,'https://api.deepseek.com/user/balance');assert.equal(init.headers.Authorization,`Bearer ${key}`);calls++;return Response.json(balance);}});
 const [a,b]=await Promise.all([service.get(),service.get()]);assert.equal(calls,1);assert.equal(a.balance.infos[0].total,'12.3400');assert.equal(b.balance.infos[1].currency,'USD');assert(!JSON.stringify(a).includes(key));
 await service.get({refresh:true});assert.equal(calls,1);
 clock+=11000;await service.get();assert.equal(calls,1);await service.get({refresh:true});assert.equal(calls,2);
 const empty=await createDeepSeekStatus({env:{DEEPSEEK_API_KEY:key},fetchImpl:async()=>Response.json({is_available:false,balance_infos:[]})}).get();assert.equal(empty.status,'ok');assert.equal(empty.balance.available,false);
});
test('官方错误码映射、未知码、敏感响应和网络异常不会被误报为余额零',async()=>{
 for(const [status,title] of [[400,'格式错误'],[401,'认证失败'],[402,'余额不足'],[422,'参数错误'],[429,'请求速率达到上限'],[500,'服务器故障'],[503,'服务器繁忙']]){
  const service=createDeepSeekStatus({env:{DEEPSEEK_API_KEY:key},fetchImpl:async()=>Response.json({error:{message:key+' private detail',code:'synthetic_error',type:'api_error'}},{status})});
  const result=await service.get();assert.equal(result.error.httpStatus,status);assert.equal(result.error.title,title);assert.equal(result.error.providerCode,'synthetic_error');assert.equal(result.balance,null);assert(!JSON.stringify(result).includes(key));assert(!JSON.stringify(result).includes('private detail'));
 }
 assert.equal(explainError(418).documented,false);assert.equal(explainError(401,{error:{code:key,type:'<script>'}},key).providerCode,null);
 for(const fetchImpl of [async()=>Response.json({is_available:true,balance_infos:[{currency:'CNY',total_balance:'bad'}]}),async()=>new Response('<html>upstream</html>'),async()=>{throw new DOMException('secret detail','TimeoutError');},async()=>{throw new Error(key);}]){
  const result=await createDeepSeekStatus({env:{DEEPSEEK_API_KEY:key},fetchImpl}).get();assert.equal(result.status,'error');assert.equal(result.balance,null);assert(!JSON.stringify(result).includes(key));
 }
});
test('模型 API 错误与余额查询状态分别保留，并不泄露原始错误消息',async()=>{
 const service=createDeepSeekStatus({env:{DEEPSEEK_API_KEY:key,DOON_STUDIO_MODEL:'deepseek-flash'},fetchImpl:async url=>url.includes('/chat/completions')?Response.json({error:{code:'invalid_api_key',message:key}},{status:401}):Response.json(balance)});
 const model=await service.model();await assert.rejects(()=>model.doGenerate({prompt:[{role:'user',content:[{type:'text',text:'SYN-PRIVATE-DOCUMENT-CONTENT'}]}]}),error=>error.name==='DeepSeekResponseError'&&error.requestBodyValues===undefined&&error.cause===undefined&&error.isRetryable===false&&!JSON.stringify(error).includes('SYN-PRIVATE-DOCUMENT-CONTENT')&&!error.message.includes(key)&&error.message.includes('认证失败'));
 const result=await service.get();assert.equal(result.model.id,'deepseek-flash');assert.equal(result.lastModelCall.error.httpStatus,401);assert.equal(result.status,'ok');assert(!JSON.stringify(result).includes(key));
});

test('真实 SDK 图片先在授权调度内上传，再以官方 file_id 调用聊天，同一用户历史复用上传',async()=>{
 const image=await sharp({create:{width:2,height:2,channels:3,background:'#345678'}}).png().toBuffer();
 const scheduler=createModelScheduler({maxRunning:1,maxQueued:2});let authorized=0,uploads=0,chats=0;const seen=[];
 const clock=1_800_000_000_000,service=createDeepSeekStatus({env:{DEEPSEEK_API_KEY:key,DOON_STUDIO_MODEL:'deepseek-flash'},scheduler,now:()=>clock,requireModelAccess:true,fetchImpl:async(url,init)=>{
  assert(authorized>0,'外发前必须完成真实身份复核');seen.push(url);
  if(url.endsWith('/files')){uploads++;return Response.json({id:'file-api-SYN-'+uploads,object:'file',purpose:'user_data',bytes:init.body.get('file').size,created_at:clock/1000,expires_at:clock/1000+86400});}
  chats++;const body=JSON.parse(init.body);assert.deepEqual(body.messages[0].content[1],{type:'file',file_id:'file-api-SYN-1'});assert(!init.body.includes('base64'));
  return Response.json({id:'SYN-chat',object:'chat.completion',created:clock/1000,model:'deepseek-flash',choices:[{index:0,message:{role:'assistant',content:'合成图片已接收'},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}});
 }});
 try{
  const model=await service.model(),prompt=[{role:'user',content:[{type:'text',text:'合成图片'},{type:'file',data:new Uint8Array(image),mediaType:'image/png'}]}];
  const generate=()=>withModelAccess({owner:'SYN-A',authorize:async()=>{authorized++;}},()=>model.doGenerate({prompt}));
  await generate();await generate();assert.equal(authorized,2);assert.equal(uploads,1);assert.equal(chats,2);assert.deepEqual(seen.map(url=>url.split('/').pop()),['files','completions','completions']);
 }finally{await scheduler.close();}
});

test('排队后撤权拒绝图片上传，缺失服务端身份也不外发',async()=>{
 const image=await sharp({create:{width:1,height:1,channels:3,background:'#000000'}}).png().toBuffer();
 const scheduler=createModelScheduler({maxRunning:1,maxQueued:2});let release,calls=0,allowed=true;
 const occupied=scheduler.fetch(async()=>{await new Promise(resolve=>{release=resolve;});return Response.json({ok:true});},'SYN-occupied',{}, {owner:'SYN-A'});
 const service=createDeepSeekStatus({env:{DEEPSEEK_API_KEY:key,DOON_STUDIO_MODEL:'deepseek-flash'},scheduler,requireModelAccess:true,fetchImpl:async()=>{calls++;throw Error('must not call');}}),model=await service.model();
 const prompt=[{role:'user',content:[{type:'file',data:new Uint8Array(image),mediaType:'image/png'}]}];
 try{
  await assert.rejects(model.doGenerate({prompt}),{code:'authorization'});assert.equal(calls,0);
  const waiting=withModelAccess({owner:'SYN-B',authorize:async()=>{if(!allowed)throw Error('PRIVATE');}},()=>model.doGenerate({prompt}));
  const rejected=assert.rejects(waiting,error=>error.code==='authorization'&&!String(error).includes('PRIVATE'));
  while(scheduler.snapshot('SYN-B').own.queued===0)await new Promise(resolve=>setTimeout(resolve,1));
  allowed=false;release();await(await occupied).text();await rejected;assert.equal(calls,0);
 }finally{await scheduler.close();}
});

test('真实 SDK 上传错误保留安全错误类型，不携带原始请求或上游正文',async()=>{
 const image=await sharp({create:{width:1,height:1,channels:3,background:'#ffffff'}}).png().toBuffer();let uploads=0,chats=0;
 const service=createDeepSeekStatus({env:{DEEPSEEK_API_KEY:key,DOON_STUDIO_MODEL:'deepseek-flash'},fetchImpl:async url=>{
  if(url.endsWith('/files')){uploads++;return Response.json({error:{message:'PRIVATE '+key}},{status:401});}
  if(url.endsWith('/chat/completions'))chats++;
  return Response.json(balance);
 }}),model=await service.model();
 await assert.rejects(model.doGenerate({prompt:[{role:'user',content:[{type:'file',data:new Uint8Array(image),mediaType:'image/png'}]}]}),error=>error.name==='DeepSeekImageError'&&error.requestBodyValues===undefined&&!JSON.stringify(error).includes('PRIVATE')&&!String(error).includes(key)&&error.isRetryable===false);
 assert.equal(uploads,1);assert.equal(chats,0);assert(!JSON.stringify((await service.get()).lastModelCall).includes(key));
});

test('图片聊天 HTTP 错误也不让 SDK 附加原始 base64 请求，状态仍保留官方错误分类',async()=>{
 const image=await sharp({create:{width:1,height:1,channels:3,background:'#ffffff'}}).png().toBuffer(),clock=1_800_000_000_000;
 const service=createDeepSeekStatus({env:{DEEPSEEK_API_KEY:key,DOON_STUDIO_MODEL:'deepseek-flash'},now:()=>clock,fetchImpl:async(url,init)=>{
  if(url.endsWith('/files'))return Response.json({id:'file-api-SYN-one',object:'file',purpose:'user_data',bytes:init.body.get('file').size,created_at:clock/1000,expires_at:clock/1000+86400});
  if(url.endsWith('/chat/completions'))return Response.json({error:{code:'invalid_api_key',message:'PRIVATE '+key}},{status:401});
  return Response.json(balance);
 }}),model=await service.model();
 await assert.rejects(model.doGenerate({prompt:[{role:'user',content:[{type:'file',data:new Uint8Array(image),mediaType:'image/png'}]}]}),error=>error.code==='DEEPSEEK_HTTP_ERROR'&&error.requestBodyValues===undefined&&error.cause===undefined&&!JSON.stringify(error).includes(image.toString('base64'))&&!String(error).includes(key)&&String(error).includes('认证失败'));
 const state=await service.get();assert.equal(state.lastModelCall.error.httpStatus,401);assert.equal(state.lastModelCall.error.title,'认证失败');assert(!JSON.stringify(state).includes('PRIVATE'));
});
