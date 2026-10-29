import {test} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {createDeepSeekFiles,validateInlineImage,DeepSeekImageError,imageLimits} from './deepseek-files.mjs';

const key='synthetic-image-key',epoch=1_800_000_000_000;
const bytes=await sharp({create:{width:3,height:2,channels:3,background:'#348ac9'}}).png().toBuffer();
const data='data:image/png;base64,'+bytes.toString('base64');
const message=(images=[data],model='deepseek-flash')=>({model,messages:[{role:'user',content:[{type:'text',text:'合成图片'},...images.map(url=>({type:'image_url',image_url:{url}}))]}]});
function fixture(options={}){
 let clock=epoch,secret=key,sequence=0;const calls=[];
 const fetchImpl=async(url,init)=>{
  calls.push({url,init});
  if(url.endsWith('/files'))return Response.json({id:'file-api-synthetic-'+(++sequence),object:'file',purpose:'user_data',bytes:init.body.get('file').size,created_at:Math.floor(clock/1000),expires_at:Math.floor(clock/1000)+86400});
  return Response.json({ok:true});
 };
 const api=createDeepSeekFiles({fetchImpl,readKey:async()=>secret,now:()=>clock,...options});
 return{api,calls,advance:ms=>clock+=ms,key:value=>secret=value};
}
test('real PNG/JPEG/GIF/WebP pixels are decoded; MIME claims and synthetic header-only files fail',async()=>{
 for(const [format,mime] of [['png','image/png'],['jpeg','image/jpeg'],['gif','image/gif'],['webp','image/webp']]){
  const image=await sharp({create:{width:7,height:5,channels:3,background:'#1e2a3b'}}).toFormat(format).toBuffer();
  const result=await validateInlineImage('data:'+mime+';base64,'+image.toString('base64'),{mimeType:mime});
  assert.equal(result.width,7);assert.equal(result.height,5);assert.equal(result.mimeType,mime);assert(result.bytes.equals(image));assert.match(result.sha256,/^[a-f0-9]{64}$/);
 }
 await assert.rejects(validateInlineImage(data,{mimeType:'image/jpeg'}),DeepSeekImageError);
 for(const url of ['https://127.0.0.1/private','file:///secret','C:/secret.png','data:image/svg+xml;base64,PHN2Zy8+','data:image/png;base64,AAAA','data:image/png;base64,'+bytes.subarray(0,32).toString('base64')])await assert.rejects(validateInlineImage(url),DeepSeekImageError);
 await assert.rejects(validateInlineImage(data.replace(/=$/,'').slice(0,-1)),DeepSeekImageError);
});
test('size, decompression pixels and dimensions are checked from the actual file',async()=>{
 await assert.rejects(validateInlineImage('data:image/png;base64,'+Buffer.alloc(imageLimits.fileBytes+1).toString('base64')),{code:'IMAGE_SIZE'});
 const wide=await sharp({create:{width:8193,height:1,channels:3,background:'#ffffff'}}).png().toBuffer();
 await assert.rejects(validateInlineImage('data:image/png;base64,'+wide.toString('base64')),{code:'IMAGE_DIMENSIONS'});
 const huge=await sharp({create:{width:6000,height:6000,channels:3,background:'#ffffff'}}).png().toBuffer();
 await assert.rejects(validateInlineImage('data:image/png;base64,'+huge.toString('base64')),DeepSeekImageError);
});
test('upload uses authenticated multipart, expires in 24 hours, and chat receives only official file parts',async()=>{
 const f=fixture(),body=message(),original=JSON.stringify(body);
 const response=await f.api.fetch('https://api.deepseek.com/chat/completions',{method:'POST',headers:{Authorization:'Bearer ignored-old-key','Content-Type':'application/json','Content-Length':'1'},body:JSON.stringify(body)},{owner:'SYN-A'});
 await response.text();assert.equal(f.calls.length,2);const upload=f.calls[0];
 assert.equal(upload.url,'https://api.deepseek.com/files');assert.equal(upload.init.method,'POST');assert.equal(upload.init.headers.Authorization,'Bearer '+key);assert.equal(upload.init.redirect,'error');
 assert.equal(upload.init.body.get('purpose'),'user_data');assert.equal(upload.init.body.get('expires_after[anchor]'),'created_at');assert.equal(upload.init.body.get('expires_after[seconds]'),'86400');
 const image=upload.init.body.get('file');assert.equal(image.name,'image.png');assert.equal(image.type,'image/png');assert.deepEqual(Buffer.from(await image.arrayBuffer()),bytes);
 const chat=f.calls[1];assert.equal(chat.init.headers.get('authorization'),'Bearer '+key);assert.equal(chat.init.headers.get('content-length'),null);
 const sent=JSON.parse(chat.init.body);assert.deepEqual(sent.messages[0].content[1],{type:'file',file_id:'file-api-synthetic-1'});assert(!chat.init.body.includes('base64'));assert.equal(JSON.stringify(body),original);
});
test('cache isolates owners and credential rotations, expires, and stays bounded',async()=>{
 const f=fixture({maxEntries:2});
 const prepare=owner=>f.api.prepareChatRequest(message(),{owner});
 const a=await prepare('A');await prepare('A');assert.equal(f.calls.length,1);
 const b=await prepare('B');assert.notEqual(a.messages[0].content[1].file_id,b.messages[0].content[1].file_id);assert.equal(f.calls.length,2);
 f.key('synthetic-rotated-key');await prepare('A');assert.equal(f.calls.length,3);assert.equal(f.api.cacheSize(),2);
 await prepare('C');assert.equal(f.api.cacheSize(),2);
 f.advance(20*3600000+1);await prepare('C');assert.equal(f.calls.length,5);assert.equal(f.api.cacheSize(),1);
});
test('multiple turns reuse prior uploads while allowing more than four history images',async()=>{
 const f=fixture();await f.api.prepareChatRequest(message(),{owner:'A'});
 const body={model:'deepseek-flash',messages:Array.from({length:6},(_,i)=>({role:'user',content:[{type:'text',text:'turn '+i},{type:'image_url',image_url:{url:data}}]}))};
 const prepared=await f.api.prepareChatRequest(body,{owner:'A'});assert.equal(prepared.messages.length,6);assert.equal(f.calls.length,1);assert(prepared.messages.every(m=>m.content[1].file_id==='file-api-synthetic-1'));
});
test('15 or more context images apply the official 4096-pixel side limit before uploads',async()=>{
 const wide=await sharp({create:{width:4097,height:1,channels:3,background:'#ffffff'}}).png().toBuffer(),url='data:image/png;base64,'+wide.toString('base64');
 const f=fixture();await assert.rejects(f.api.prepareChatRequest(message([...Array(14).fill(data),url]),{owner:'A'}),{code:'IMAGE_DIMENSIONS'});assert.equal(f.calls.length,0);
 await f.api.prepareChatRequest(message([url]),{owner:'A'});assert.equal(f.calls.length,1);
});
test('all images are validated before first upload; remote references and text-only models fail closed',async()=>{
 for(const body of [message([data,'https://private.test/x']),message(Array(25).fill(data)),message([data],'deepseek-v4-pro'),{model:'deepseek-flash',messages:[{role:'user',content:[{type:'file',file_id:'file-api-stolen'}]}]},message([data.replace('image/png','image/jpeg')])]){
  const f=fixture();await assert.rejects(f.api.prepareChatRequest(body,{owner:'A'}),DeepSeekImageError);assert.equal(f.calls.length,0);
 }
 const f=fixture();await assert.rejects(f.api.prepareChatRequest(message(),{}),{code:'IMAGE_OWNER'});assert.equal(f.calls.length,0);
});
test('aggregate image bytes are bounded before uploading any part',async()=>{
 const big=await sharp({create:{width:1900,height:1700,channels:3,background:'#123456'}}).png({compressionLevel:0}).toBuffer();
 assert(big.length<imageLimits.fileBytes);assert(big.length*7>imageLimits.requestBytes);
 const f=fixture();await assert.rejects(f.api.prepareChatRequest(message(Array(7).fill('data:image/png;base64,'+big.toString('base64'))),{owner:'A'}),{code:'IMAGE_TOTAL_SIZE'});assert.equal(f.calls.length,0);
});
test('provider errors and corrupt responses do not leak secrets, cache entries, or trigger chat/retries',async()=>{
 for(const respond of [()=>Response.json({error:{message:key+' PRIVATE'}},{status:401}),()=>new Response('PRIVATE '+key),()=>Response.json({id:'file-api-not-trusted',object:'file',bytes:bytes.length,purpose:'user_data',created_at:epoch/1000,expires_at:epoch/1000+172800}),()=>new Response('x'.repeat(32769))]){
  let calls=0;const api=createDeepSeekFiles({readKey:async()=>key,now:()=>epoch,fetchImpl:async()=>{calls++;return respond();}});
  await assert.rejects(api.fetch('https://api.deepseek.com/chat/completions',{method:'POST',body:JSON.stringify(message())},{owner:'A'}),error=>error instanceof DeepSeekImageError&&!String(error).includes(key)&&!String(error).includes('PRIVATE'));
  assert.equal(calls,1);assert.equal(api.cacheSize(),0);
 }
});
test('cancellation stops the batch and reaches the upload transport; no automatic retry or chat follows',async()=>{
 const controller=new AbortController();let calls=0;
 const api=createDeepSeekFiles({readKey:async()=>key,fetchImpl:async(_url,init)=>{calls++;assert.equal(init.signal,controller.signal);controller.abort(new DOMException('stopped','AbortError'));throw new Error('PRIVATE');}});
 await assert.rejects(api.fetch('https://api.deepseek.com/chat/completions',{method:'POST',body:JSON.stringify(message()),signal:controller.signal},{owner:'A'}),{name:'AbortError'});assert.equal(calls,1);assert.equal(api.cacheSize(),0);
 const f=fixture();await assert.rejects(f.api.prepareChatRequest(message(),{owner:'A',signal:controller.signal}),{name:'AbortError'});assert.equal(f.calls.length,0);
});
test('a text-only request remains text-only and cannot choose a different provider destination',async()=>{
 const f=fixture(),body=message([]);const prepared=await f.api.prepareChatRequest(body,{owner:'A'});assert.equal(prepared,body);assert.equal(f.calls.length,0);
 await assert.rejects(f.api.fetch('https://evil.test/chat/completions',{method:'POST',body:JSON.stringify(body)},{owner:'A'}),{code:'IMAGE_REQUEST'});assert.equal(f.calls.length,0);
});
test('unreadable key configuration returns only a safe error',async()=>{
 let calls=0;const api=createDeepSeekFiles({readKey:async()=>{throw new Error('PRIVATE '+key+' /server/secrets/key');},fetchImpl:async()=>{calls++;}});
 await assert.rejects(api.prepareChatRequest(message(),{owner:'A'}),error=>error.code==='IMAGE_KEY'&&!String(error).includes('PRIVATE')&&!String(error).includes('/server/'));assert.equal(calls,0);
});
