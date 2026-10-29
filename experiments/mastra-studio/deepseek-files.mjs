import {createHash} from 'node:crypto';
import sharp from 'sharp';

// Application limits are deliberately below the provider's limits. Historical
// images count towards the provider request, not the current composer message.
export const imageLimits=Object.freeze({fileBytes:10*1024*1024,requestImages:24,requestBytes:64*1024*1024,pixels:32_000_000,dimension:8192,manyImages:15,manyImageDimension:4096,frames:100});
const FILES='https://api.deepseek.com/files',CHAT='https://api.deepseek.com/chat/completions';
const formats=new Map([['image/jpeg','jpeg'],['image/png','png'],['image/gif','gif'],['image/webp','webp']]);
const sha=value=>createHash('sha256').update(value).digest('hex');
export class DeepSeekImageError extends Error{
 constructor(message,code='IMAGE_INVALID',status=400){super(message);this.name='DeepSeekImageError';this.code=code;this.status=status;this.isRetryable=false;}
}
const fail=(message,code,status)=>{throw new DeepSeekImageError(message,code,status);};
const aborted=signal=>signal?.throwIfAborted();
function magic(bytes,mime){
 if(mime==='image/png')return bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 if(mime==='image/jpeg')return bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 if(mime==='image/gif')return ['GIF87a','GIF89a'].includes(bytes.subarray(0,6).toString('ascii'));
 return bytes.subarray(0,4).toString('ascii')==='RIFF'&&bytes.subarray(8,12).toString('ascii')==='WEBP';
}
// No local paths, URLs, SVG or browser-supplied size/dimension claims. Decode
// every frame rather than accepting an image-looking header or extension.
let decoding=0;
export async function validateInlineImage(dataURL,{mimeType}={}){
 if(typeof dataURL!=='string'||dataURL.length>Math.ceil(imageLimits.fileBytes/3)*4+64)fail('单张图片不能超过 10 MiB。','IMAGE_SIZE',413);
 const match=/^data:(image\/(?:jpeg|png|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataURL);
 if(!match||mimeType!==undefined&&mimeType!==match[1])fail('图片必须是 PNG、JPEG、GIF 或 WebP 的内联数据，不能使用网址或文件路径。');
 const [,type,encoded]=match;
 if(encoded.length%4)fail('图片编码无效。');
 const bytes=Buffer.from(encoded,'base64');
 if(!bytes.length||bytes.length>imageLimits.fileBytes)fail('单张图片不能超过 10 MiB。','IMAGE_SIZE',413);
 if(bytes.toString('base64')!==encoded||!magic(bytes,type))fail('图片内容与格式不匹配。');
 if(decoding>=4)fail('图片校验繁忙，请稍后再试。','IMAGE_BUSY',429);
 decoding++;
 try{
  const decoder=sharp(bytes,{animated:true,limitInputPixels:imageLimits.pixels,failOn:'warning'});
  const meta=await decoder.metadata(),height=meta.pageHeight||meta.height,frames=meta.pages||1;
  if(meta.format!==formats.get(type)||!Number.isSafeInteger(meta.width)||!Number.isSafeInteger(height)||meta.width<1||height<1||meta.width>imageLimits.dimension||height>imageLimits.dimension||!Number.isSafeInteger(frames)||frames<1||frames>imageLimits.frames||meta.width*height*frames>imageLimits.pixels)fail('图片尺寸、帧数或总像素超过处理限制。','IMAGE_DIMENSIONS',413);
  // stats traverses decoded pixels without returning a large raw pixel buffer.
  await decoder.stats();
  return {bytes,mimeType:type,sha256:sha(bytes),width:meta.width,height,frames};
 }catch(error){if(error instanceof DeepSeekImageError)throw error;fail('图片已损坏或无法完整解码，请重新导出后上传。','IMAGE_DECODE');}
 finally{decoding--;}
}
async function boundedJson(response,signal){
 const reader=response.body?.getReader();if(!reader)fail('图片上传返回格式异常。','IMAGE_UPLOAD_RESPONSE',502);
 let length=0;const chunks=[];
 try{while(true){aborted(signal);const part=await reader.read();if(part.done)break;length+=part.value.byteLength;if(length>32768)fail('图片上传返回格式异常。','IMAGE_UPLOAD_RESPONSE',502);chunks.push(part.value);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
 catch(error){if(signal?.aborted)throw signal.reason;if(error instanceof DeepSeekImageError)throw error;fail('图片上传返回格式异常。','IMAGE_UPLOAD_RESPONSE',502);}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
function imageParts(body){
 if(!body||typeof body!=='object'||!Array.isArray(body.messages))fail('模型消息格式无效。','IMAGE_MESSAGE');
 const parts=[];
 for(let i=0;i<body.messages.length;i++){
  const message=body.messages[i];if(!Array.isArray(message?.content))continue;
  for(let j=0;j<message.content.length;j++){
   const part=message.content[j];
   if(part&&typeof part==='object'&&(part.type==='file'||Object.hasOwn(part,'file_id')||Object.hasOwn(part,'file_data')))fail('不接受客户端提供的远端文件编号。请重新选择图片。','IMAGE_REFERENCE');
   if(part?.type!=='image_url')continue;
   if(!['user','tool'].includes(message.role)||!part.image_url||typeof part.image_url!=='object'||Object.keys(part.image_url).some(k=>!['url','detail'].includes(k))||part.image_url.detail!==undefined&&!['auto','high','original'].includes(part.image_url.detail))fail('图片消息格式无效，请使用原图。','IMAGE_MESSAGE');
   parts.push({message:i,part:j,url:part.image_url.url});
  }
 }
 if(parts.length>imageLimits.requestImages)fail('本次对话上下文图片超过 24 张，请开启新对话。','IMAGE_COUNT',413);
 if(parts.length&&body.model!=='deepseek-flash')fail('当前模型不支持图片，请选择 DeepSeek Flash。','IMAGE_MODEL');
 return parts;
}

/** Called only inside an admitted, freshly authorized model scheduler permit. */
export function createDeepSeekFiles({fetchImpl=fetch,readKey,now=Date.now,maxEntries=128,ttlMs=20*3600000}={}){
 if(typeof readKey!=='function'||!Number.isInteger(maxEntries)||maxEntries<1||maxEntries>128||!Number.isFinite(ttlMs)||ttlMs<=0||ttlMs>20*3600000)throw new Error('Invalid image upload configuration');
 const cache=new Map();
 function prune(){for(const [key,item] of cache)if(item.expires<=now())cache.delete(key);while(cache.size>maxEntries)cache.delete(cache.keys().next().value);}
 async function serverKey(){let key;try{key=await readKey();}catch{fail('图片服务的服务端密钥无法读取。','IMAGE_KEY',503);}if(typeof key!=='string'||!key||/[\s\x00-\x1f\x7f]/.test(key)||key.length>512)fail('图片服务的服务端密钥未配置或无效。','IMAGE_KEY',503);return key;}
 async function upload(image,owner,key,signal){
  aborted(signal);prune();const identity=sha(JSON.stringify([owner,sha(key),image.sha256])),saved=cache.get(identity);
  if(saved){cache.delete(identity);cache.set(identity,saved);return saved.id;}
  const form=new FormData();form.set('purpose','user_data');form.set('expires_after[anchor]','created_at');form.set('expires_after[seconds]','86400');
  // A generic filename discloses neither the original filename nor local paths.
  form.set('file',new Blob([image.bytes],{type:image.mimeType}),'image.'+formats.get(image.mimeType));
  let response;
  try{response=await fetchImpl(FILES,{method:'POST',headers:{Authorization:'Bearer '+key,Accept:'application/json'},body:form,redirect:'error',signal});}
  catch{if(signal?.aborted)throw signal.reason;fail('图片上传连接失败；本次未发送聊天请求，请稍后重试。','IMAGE_UPLOAD_NETWORK',503);}
  aborted(signal);
  if(!response.ok){await response.body?.cancel().catch(()=>{});const status=response.status;fail('图片上传失败（HTTP '+status+'），本次未发送聊天请求。','IMAGE_UPLOAD_HTTP',status>=400&&status<=599?status:502);}
  const result=await boundedJson(response,signal),created=Number(result?.created_at),expiry=Number(result?.expires_at),clock=now();
  if(!result||typeof result.id!=='string'||!/^file-api-[A-Za-z0-9_-]{1,180}$/.test(result.id)||result.object!=='file'||result.purpose!=='user_data'||result.bytes!==image.bytes.length||!Number.isSafeInteger(created)||!Number.isSafeInteger(expiry)||created<0||expiry<=created||expiry-created>86400||expiry*1000<=clock+60000||created*1000>clock+300000)fail('图片上传返回格式或有效期异常，本次未发送聊天请求。','IMAGE_UPLOAD_RESPONSE',502);
  cache.set(identity,{id:result.id,expires:Math.min(clock+ttlMs,expiry*1000-60000)});prune();return result.id;
 }
 async function prepare(body,{owner,signal},key){
  aborted(signal);const parts=imageParts(body);if(!parts.length)return body;
  if(typeof owner!=='string'||!owner||owner.length>512)fail('图片处理缺少有效用户身份。','IMAGE_OWNER',403);
  const validated=[];let total=0;
  // Validate the entire batch before uploading any member. Upload sequentially.
  for(const part of parts){aborted(signal);const image=await validateInlineImage(part.url);if(parts.length>=imageLimits.manyImages&&(image.width>imageLimits.manyImageDimension||image.height>imageLimits.manyImageDimension))fail('对话上下文有 15 张及以上图片时，每边不能超过 4096 像素，请缩小图片或开启新对话。','IMAGE_DIMENSIONS',413);total+=image.bytes.length;if(total>imageLimits.requestBytes)fail('对话上下文图片总大小超过 64 MiB，请开启新对话。','IMAGE_TOTAL_SIZE',413);validated.push({...part,image});}
  const messages=body.messages.map(message=>({...message,...(Array.isArray(message.content)?{content:message.content.slice()}: {})}));
  for(const part of validated){const id=await upload(part.image,owner,key,signal);aborted(signal);messages[part.message].content[part.part]={type:'file',file_id:id};}
  return {...body,messages};
 }
 return{
  async prepareChatRequest(body,access={}){return prepare(body,access,await serverKey());},
  async fetch(input,init={},access={}){
   if(String(input)!==CHAT||init.method&&init.method.toUpperCase()!=='POST'||typeof init.body!=='string')fail('模型请求地址或格式无效。','IMAGE_REQUEST');
   if(init.body.length>Math.ceil(imageLimits.requestBytes/3)*4+1024*1024)fail('模型请求超过图片处理限制。','IMAGE_TOTAL_SIZE',413);
   let body;try{body=JSON.parse(init.body);}catch{fail('模型消息格式无效。','IMAGE_MESSAGE');}
   const key=await serverKey(),prepared=await prepare(body,{...access,signal:init.signal},key);aborted(init.signal);
   const headers=new Headers(init.headers);headers.set('Authorization','Bearer '+key);headers.delete('Content-Length');
   return fetchImpl(CHAT,{...init,headers,redirect:'error',body:JSON.stringify(prepared)});
  },
  cacheSize(){prune();return cache.size;},
 };
}
