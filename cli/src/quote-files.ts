import {ApiClient} from './client.js';
import {StateStore} from './state.js';
import {CliError} from './errors.js';
import {readWriteInput,type WriteSchema} from './write-input.js';
import {executeWrite} from './write-operation.js';
import {type QuoteKind} from './quote-write.js';
import {fields,pick} from './business.js';
import {open} from 'node:fs/promises';
import {basename,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
const ref={type:'string',min:1,max:120,required:true} as const;
const quote:WriteSchema={quoteId:ref};
const uploadSchemas:Record<string,WriteSchema>={
 'ie:drawing':{...quote,lineId:ref,replaceAttachmentId:{type:'string',max:120}},
 'ie:template':{...quote,acknowledgeRemoveUnmapped:{type:'boolean',required:true,enum:[true]},sheetBindings:{type:'array',required:true,min:1,max:100,items:{type:'object',properties:{sheetName:ref,lineId:ref}}}},
 'customer:source':quote,
 'customer:media':{...quote,lineId:{type:'string',max:100},category:{type:'string',required:true,enum:['image','drawing','sent_quote','evidence']},title:{type:'string',max:200},drawingNo:{type:'string',max:200}},
 'customer:template':{customerAccountId:ref,brand:{type:'string',required:true,min:1,max:240},businessType:{type:'string',required:true,min:1,max:120},title:{type:'string',required:true,min:1,max:240}},
 'customer:archive':quote
};
const uploadRoutes={
 'ie:drawing':'/api/workspace/ie-quote-attachment-upload','ie:template':'/api/workspace/ie-quote-template-register',
 'customer:source':'/api/workspace/customer-quote-upload','customer:media':'/api/workspace/customer-quote-media-upload','customer:template':'/api/workspace/customer-quote-template-register','customer:archive':'/api/workspace/customer-quote-template-archive'
} as const;
const positive=(raw:string)=>{if(!/^[1-9]\d*$/.test(raw)||!Number.isSafeInteger(Number(raw)))throw new CliError('INVALID_ARGUMENT','请指定正整数报价版本。',2);return Number(raw);};
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
export async function readQuoteFile(file:string,limit:number){const handle=await open(file,'r').catch(()=>{throw new CliError('INVALID_INPUT','无法读取报价文件。',2);});try{const info=await handle.stat();if(!info.isFile()||info.size<1||info.size>limit)throw new CliError('INVALID_INPUT','文件须为对应服务器限制内的非空普通文件。',2);const bytes=Buffer.alloc(limit+1);let size=0;while(size<bytes.length){const read=await handle.read(bytes,size,bytes.length-size,null);if(!read.bytesRead)break;size+=read.bytesRead;}if(size!==info.size||size>limit)throw new CliError('INVALID_INPUT','文件大小发生变化。',2);return bytes.subarray(0,size);}finally{await handle.close();}}
export async function writeNewQuoteFile(bytes:Buffer,output:string){const path=resolve(output);let handle;try{handle=await open(path,'wx',0o600);await handle.writeFile(bytes);}catch(error){throw new CliError((error as NodeJS.ErrnoException).code==='EEXIST'?'OUTPUT_EXISTS':'OUTPUT_WRITE_FAILED','无法写入新文件，不会覆盖已有文件。',3);}finally{await handle?.close();}return {path,bytes:bytes.length,sha256:digest(bytes)};}
const media=(row:any)=>pick(row,fields('id quoteId quoteVersion lineId category filename contentType size sha256 title drawingNo uploadedAt uploadedBy supplement'));
export class QuoteFileService{
 constructor(private store:StateStore,private transport:typeof fetch=fetch){}
 private async client(){const config=await this.store.config(),session=await this.store.session(config);if(!session)throw new CliError('AUTH_REQUIRED','请先运行 doon login。',4);return {api:new ApiClient(config,this.transport,30000),session};}
 schema(kind:QuoteKind,type:string){const key=kind+':'+type;if(!Object.hasOwn(uploadSchemas,key))throw new CliError('UNSUPPORTED_OPERATION','该报价文件类型未接入。',2);return {scope:{},type,fields:uploadSchemas[key],maxBytes:(kind==='ie'?12:10)*1024*1024,version:kind==='customer'&&type==='template'?'客户模板登记不接受报价版本':'须提供明确报价版本'};}
 private async quote(kind:QuoteKind,id:string,version:number){const {api,session}=await this.client(),data=(await api.request(kind==='ie'?'/api/workspace/ie-quote':'/api/workspace/customer-quote-version',session,undefined,{query:kind==='ie'?{id,version:String(version)}:{quoteId:id,quoteVersion:String(version)}})).data;if(data?.quote?.id!==id||data.quote.version!==version)throw new CliError('INVALID_RESPONSE','报价文件版本无法核对。',5);return data.quote;}
 async list(kind:QuoteKind,id:string,rawVersion:string){const version=positive(rawVersion),row=await this.quote(kind,id,version);return {scope:{customerId:row.customerAccountId},record:pick(row,fields('id version status sourceFilename sourceHash hasSource')),files:kind==='ie'?(row.attachments||[]).map((value:any)=>pick(value,fields('id lineId filename contentType size sha256 drawingNo drawingRevision matchesDrawingRevision quoteVersion uploadedAt uploadedBy'))):(row.media||[]).map(media),templateStatus:kind==='ie'?row.templateStatus:undefined,templateOutputs:kind==='customer'?(row.templateOutputs||[]).map((value:any)=>pick(value,fields('id filename sourceHash uploaded createdAt'))):undefined};}
 async templates(customerId:string){const {api,session}=await this.client(),data=(await api.request('/api/workspace/customer-quote-templates',session,undefined,{query:{customerAccountId:customerId}})).data;if(!Array.isArray(data?.templates))throw new CliError('INVALID_RESPONSE','客户模板目录不符合协议。',5);return {scope:{customerId},templates:data.templates.map((row:any)=>({...pick(row,fields('id title customerAccountId brand businessType version rowCount itemCount sourceFilename sourceHash createdAt')),issues:row.issues||[]})),canRegister:!!data.canRegister};}
 async upload(kind:QuoteKind,type:string,inputFile:string,filePath:string,rawVersion=''){
  const spec=this.schema(kind,type),key=(kind+':'+type) as keyof typeof uploadRoutes,input=await readWriteInput(inputFile,spec.fields),version=kind==='customer'&&type==='template'?undefined:positive(rawVersion);
  if(version===undefined&&rawVersion)throw new CliError('INVALID_ARGUMENT','客户模板登记不使用报价版本。',2);
  const bytes=await readQuoteFile(filePath,spec.maxBytes),hash=digest(bytes),form=new FormData();for(const [name,value] of Object.entries(input))form.set(name,typeof value==='object'?JSON.stringify(value):String(value));if(version)form.set(kind==='customer'&&['media','archive'].includes(type)?'quoteVersion':'version',String(version));form.set('file',new File([Uint8Array.from(bytes)],basename(filePath)));
  const {api,session}=await this.client(),data=(await api.request(uploadRoutes[key],session,form)).data;if(data?.ok!==true)throw new CliError('INVALID_RESPONSE','上传结果无法核对，请查询报价文件。',5,{outcomeUnknown:true});
  try{
   if(type==='template'&&kind==='customer'){const list=await this.templates(String(input.customerAccountId)),row=list.templates.find((value:any)=>value.id===data.template?.id);if(!row||row.sourceHash!==hash)throw Error('template changed');return {scope:list.scope,record:row};}
   if(type==='template'){const row=await this.quote('ie',String(input.quoteId),version!);if(!row.templateStatus?.verified||row.templateStatus.templateId!==data.templateStatus?.templateId||!isDeepStrictEqual(row.templateStatus.sheetBindings,input.sheetBindings))throw Error('template changed');return {scope:{customerId:row.customerAccountId},templateStatus:row.templateStatus,uploadedFileSha256:hash};}
   const resultingVersion=data.quote?.version||version!,row=await this.quote(kind,String(input.quoteId),resultingVersion);
   if(kind==='ie'){const attachment=(row.attachments||[]).find((value:any)=>value.sha256===hash&&value.lineId===input.lineId&&value.quoteVersion===version!+1);if(!attachment||attachment.size!==bytes.length||row.version!==version!+1)throw Error('drawing missing');return {scope:{customerId:row.customerAccountId},version:row.version,record:pick(attachment,fields('id lineId filename contentType size sha256 drawingNo drawingRevision'))};}
   if(type==='source'){if(row.version!==version!+1||row.sourceHash!==hash)throw Error('source changed');return {scope:{customerId:row.customerAccountId},record:pick(row,fields('id version sourceFilename sourceHash hasSource'))};}
   if(type==='archive'){const output=row.templateOutputs?.find((value:any)=>value.id===data.output?.id);if(!output||output.sourceHash!==hash)throw Error('output missing');return {scope:{customerId:row.customerAccountId},record:pick(output,fields('id filename sourceHash uploaded createdAt'))};}
   const attachment=row.media?.find((value:any)=>value.id===data.media?.id);if(!attachment||attachment.sha256!==hash||attachment.size!==bytes.length||row.version!==resultingVersion)throw Error('media missing');return {scope:{customerId:row.customerAccountId},version:row.version,record:media(attachment)};
  }catch{throw new CliError('READBACK_FAILED','文件上传已响应，但回读未完成，请查询原操作。',5,{outcomeUnknown:true});}
 }
 async action(kind:QuoteKind,action:string,inputFile:string,rawVersion:string){
  const version=positive(rawVersion),schema:WriteSchema=kind==='ie'?{id:ref,lineId:ref,attachmentId:ref,...(action==='bind'?{acknowledgeDrawingRevision:{type:'boolean',required:true,enum:[true]} as const}:{})}:{quoteId:ref,templateId:ref};
  if(kind==='ie'?!['remove','bind'].includes(action):action!=='apply-template')throw new CliError('UNSUPPORTED_OPERATION','该文件资料动作未接入。',2);
  const input=await readWriteInput(inputFile,schema),{api,session}=await this.client(),data=(await api.request(kind==='customer'?'/api/workspace/customer-quote-template-apply':action==='remove'?'/api/workspace/ie-quote-attachment-remove':'/api/workspace/ie-quote-attachment-bind',session,{...input,version})).data;
  if(data?.ok!==true||data.quote?.id!==(input.id||input.quoteId)||data.quote.version!==version+1)throw new CliError('INVALID_RESPONSE','文件操作响应无法核对。',5,{outcomeUnknown:true});
  try{const row=await this.quote(kind,data.quote.id,version+1);if(kind==='customer'){if(row.templateBinding?.id!==input.templateId)throw Error('binding missing');return {scope:{customerId:row.customerAccountId},record:{id:row.id,version:row.version,templateBinding:row.templateBinding}};}const present=(row.attachments||[]).some((value:any)=>value.id===input.attachmentId&&value.lineId===input.lineId);if(present!==(action==='bind'))throw Error('reference changed');return {scope:{customerId:row.customerAccountId},record:{id:row.id,version:row.version},files:(row.attachments||[]).map((value:any)=>pick(value,fields('id lineId filename size sha256 drawingNo drawingRevision')))};}catch{throw new CliError('READBACK_FAILED','文件操作已响应，但回读未完成，请查询原操作。',5,{outcomeUnknown:true});}
 }
 async download(kind:QuoteKind,type:string,quoteId:string,rawVersion:string,id:string,output:string){
  if(kind==='ie'?type!=='drawing':!['source','media','output'].includes(type))throw new CliError('UNSUPPORTED_OPERATION','该下载类型未接入。',2);
  const version=positive(rawVersion),row=await this.quote(kind,quoteId,version),{api,session}=await this.client();let route:keyof typeof import('./routes.js').routes,query:Record<string,string>,expectedHash:string|undefined,expectedSize:number|undefined;
  if(kind==='ie'){const file=row.attachments?.find((value:any)=>value.id===id);if(!file)throw new CliError('NOT_IN_SCOPE','附件不属于该报价版本。',7);route='/api/workspace/ie-quote-attachment';query={id:quoteId,version:String(version),attachmentId:id,download:'1'};expectedHash=file.sha256;expectedSize=file.size;}
  else if(type==='source'){if(!row.hasSource||!row.sourceHash)throw new CliError('NOT_IN_SCOPE','没有原报价附件读取权限。',7);route='/api/workspace/customer-quote-file';query={id:quoteId};expectedHash=row.sourceHash;}
  else{const file=(type==='media'?row.media:row.templateOutputs)?.find((value:any)=>value.id===id);if(!file)throw new CliError('NOT_IN_SCOPE','文件不属于该报价版本。',7);route=type==='media'?'/api/workspace/customer-quote-media-file':'/api/workspace/customer-quote-template-output-file';query={id};expectedHash=type==='media'?file.sha256:file.sourceHash;expectedSize=file.size;}
  const bytes=(await api.request(route,session,undefined,{query})).data as Buffer;if(!expectedHash||digest(bytes)!==expectedHash||expectedSize!==undefined&&bytes.length!==expectedSize)throw new CliError('INVALID_RESPONSE','文件完整性核对失败。',5);return {scope:{customerId:row.customerAccountId},file:await writeNewQuoteFile(bytes,output)};
 }
 async export(kind:QuoteKind,type:string,quoteId:string,rawVersion:string,output:string){
  if(kind==='ie'?!['draft','released'].includes(type):type!=='template')throw new CliError('UNSUPPORTED_OPERATION','该报价导出类型未接入。',2);const version=positive(rawVersion),row=await this.quote(kind,quoteId,version),{api,session}=await this.client(),data=await api.request(kind==='customer'?'/api/workspace/customer-quote-template-export':type==='draft'?'/api/workspace/ie-quote-draft-export':'/api/workspace/ie-quote-export',session,undefined,{query:kind==='customer'?{quoteId,quoteVersion:String(version)}:{id:quoteId,version:String(version)}});
  // A writable customer's template export also archives output on the server.
  if(kind==='customer'&&row.canRegisterSent){try{const read=await this.quote(kind,quoteId,version);if(!read.templateOutputs?.some((value:any)=>value.sourceHash===digest(data.data)))throw Error('archive missing');}catch{throw new CliError('READBACK_FAILED','模板已导出响应，但归档回读未完成，请先查询报价文件。',5,{outcomeUnknown:true});}}
  try{return {scope:{customerId:row.customerAccountId},file:await writeNewQuoteFile(data.data as Buffer,output),serverMayArchive:kind==='customer'};}catch(error){if(kind==='customer'&&error instanceof CliError)Object.assign(error.details,{serverMayArchive:true,quoteId,quoteVersion:version});throw error;}
 }
 async recordSent(inputFile:string,rawVersion:string,token:string){
  const version=positive(rawVersion);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token))throw new CliError('INVALID_ARGUMENT','登记请求标识须为UUID。',2);
  const schema:WriteSchema={quoteId:ref,sentDate:{type:'string',required:true,min:10,max:10},recipient:{type:'string',required:true,min:1,max:240},channel:{type:'string',required:true,enum:['email','whatsapp','wechat','other']},mediaIds:{type:'array',max:30,items:ref}}, {api,session}=await this.client();
  return executeWrite({schema,versionField:'quoteVersion',tokenField:'idempotencyKey',
   async send(input){const data=(await api.request('/api/workspace/customer-quote-record-sent',session,input)).data;if(data?.ok!==true||!Array.isArray(data.sentHistory))throw new CliError('INVALID_RESPONSE','发送登记响应无法核对。',5,{outcomeUnknown:true});return data;},
   readBack:async(result,input)=>{const row=await this.quote('customer',String(input.quoteId),version),matches=(row.sentHistory||[]).filter((event:any)=>event.quoteId===input.quoteId&&event.quoteVersion===version&&event.sentDate===input.sentDate&&event.recipient===String(input.recipient).trim()&&event.channel===input.channel&&isDeepStrictEqual([...(event.mediaIds||[])].sort(),[...(input.mediaIds as string[]||[])].sort()));if(matches.length!==1||!result.sentHistory.some((event:any)=>event.id===matches[0].id))throw Error('event missing or ambiguous');return {scope:{customerId:row.customerAccountId},record:pick(matches[0],fields('id quoteId quoteVersion sentDate recipient channel mediaIds createdAt createdBy'))};}
  },{file:inputFile,version,token});
 }
}
