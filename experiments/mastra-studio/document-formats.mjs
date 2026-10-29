import {Worker} from 'node:worker_threads';

export const DOCUMENT_LIMITS=Object.freeze({inputBytes:10*1024*1024,outputBytes:10*1024*1024,pages:100,rows:5000,columns:100,characters:120000,blocks:1000,queue:8,timeoutMs:30000,memoryMb:256});
export class DocumentFormatError extends Error {
 constructor(message,code='DOCUMENT_INVALID',status=400){super(message);this.name='DocumentFormatError';this.code=code;this.status=status;}
}
const pending=[];let running=false;
function pump(){
 if(running||!pending.length)return;
 running=true;const {job,resolve,reject}=pending.shift();let settled=false;
 const worker=new Worker(new URL('./document-worker.mjs',import.meta.url),{workerData:job,execArgv:[],resourceLimits:{maxOldGenerationSizeMb:DOCUMENT_LIMITS.memoryMb,maxYoungGenerationSizeMb:32,stackSizeMb:4},stdout:true,stderr:true});
 // Parser diagnostics can contain document contents. Only the reviewed error crosses this boundary.
 worker.stdout.resume();worker.stderr.resume();
 const finish=async(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);await worker.terminate();running=false;error?reject(error):resolve(value);pump();};
 const timer=setTimeout(()=>void finish(new DocumentFormatError('文档处理超过 30 秒，请拆分文件后重试。','DOCUMENT_TIMEOUT',408)),DOCUMENT_LIMITS.timeoutMs);
 worker.once('message',result=>void finish(result.ok?null:new DocumentFormatError(result.error.message,result.error.code,result.error.status),result.ok?{...result.value,...(result.value.bytes?{bytes:Buffer.from(result.value.bytes)}:{})}:undefined));
 worker.once('error',()=>void finish(new DocumentFormatError('文档处理失败或超过内存限制，请检查或拆分文件。','DOCUMENT_PROCESSING_FAILED',422)));
 worker.once('exit',()=>{if(!settled)void finish(new DocumentFormatError('文档处理提前结束，请检查文件。','DOCUMENT_PROCESSING_FAILED',422));});
}
function enqueue(job){if(pending.length>=DOCUMENT_LIMITS.queue)return Promise.reject(new DocumentFormatError('文档处理队列已满，请稍后重试。','DOCUMENT_QUEUE_FULL',429));return new Promise((resolve,reject)=>{pending.push({job,resolve,reject});pump();});}
function object(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key));}
const validText=value=>typeof value==='string'&&value.isWellFormed()&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value);
export function parseDocument(input){
 if(!object(input,['filename','mimeType','bytes'])||typeof input.filename!=='string'||input.filename.length>200||typeof input.mimeType!=='string'||input.mimeType.length>200||!(input.bytes instanceof Uint8Array))return Promise.reject(new DocumentFormatError('文档输入格式无效。'));
 if(!input.bytes.byteLength||input.bytes.byteLength>DOCUMENT_LIMITS.inputBytes)return Promise.reject(new DocumentFormatError('请提供非空且不超过 10 MiB 的文档。','DOCUMENT_SIZE_LIMIT',413));
 return enqueue({operation:'parse',input:{filename:input.filename,mimeType:input.mimeType,bytes:Buffer.from(input.bytes)}});
}
export function renderDocument(input){
 if(!object(input,['format','title','blocks'])||typeof input.format!=='string'||!validText(input.title)||input.title.length>160||!Array.isArray(input.blocks)||!input.blocks.length||input.blocks.length>DOCUMENT_LIMITS.blocks)return Promise.reject(new DocumentFormatError('文档生成参数无效。'));
 // Bound the queued structured clone before the worker is allocated. Never stringify arbitrary deep input.
 let characters=input.title.length,rows=0;
 for(const block of input.blocks){
  if(!block||typeof block!=='object'||Array.isArray(block))return Promise.reject(new DocumentFormatError('文档段落格式无效。'));
  if(block.type==='heading'||block.type==='paragraph'){
   if(!object(block,block.type==='heading'?['type','text','level']:['type','text'])||!validText(block.text)||(block.type==='heading'&&(!Number.isInteger(block.level)||block.level<1||block.level>6)))return Promise.reject(new DocumentFormatError('文档段落格式无效。'));
   characters+=block.text.length;
  }else if(block.type==='table'){
   if(!object(block,['type','headers','rows'])||!Array.isArray(block.headers)||!block.headers.length||block.headers.length>DOCUMENT_LIMITS.columns||!block.headers.every(validText)||!Array.isArray(block.rows))return Promise.reject(new DocumentFormatError('文档表格格式无效。'));
   rows+=block.rows.length+1;if(rows>DOCUMENT_LIMITS.rows)return Promise.reject(new DocumentFormatError('文档表格超过 5000 行，请拆分后重试。','DOCUMENT_ROW_LIMIT',413));
   for(const row of [block.headers,...block.rows]){if(!Array.isArray(row)||row.length!==block.headers.length||!row.every(value=>value===null||validText(value)||typeof value==='boolean'||(typeof value==='number'&&Number.isFinite(value))))return Promise.reject(new DocumentFormatError('表格仅支持等宽的文字、数值、布尔值或空单元格。'));characters+=row.reduce((sum,value)=>sum+String(value??'').length,0);}
  }else return Promise.reject(new DocumentFormatError('不支持的文档段落类型。'));
  if(characters>DOCUMENT_LIMITS.characters)return Promise.reject(new DocumentFormatError('文档内容超过 120000 字符，请拆分后重试。','DOCUMENT_TEXT_LIMIT',413));
 }
 return enqueue({operation:'render',input:structuredClone(input)});
}
