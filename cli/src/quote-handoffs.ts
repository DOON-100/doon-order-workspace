import {ApiClient} from './client.js';
import {StateStore} from './state.js';
import {CliError} from './errors.js';
import {type WriteSchema,readWriteInput} from './write-input.js';
import {executeWrite} from './write-operation.js';
import {fields,pick,pagination} from './business.js';
import {isDeepStrictEqual} from 'node:util';
const ref={type:'string',min:1,max:120} as const;
const itemFields=fields('id code name nameEn sourceSheet sourceRow catalogId version');
const namesSchema:WriteSchema={catalog:{type:'object',required:true,properties:{sourceFilename:{type:'string',required:true,min:1,max:240},sourceSha256:{type:'string',required:true,min:64,max:64},entries:{type:'array',required:true,min:1,max:2000,items:{type:'object',properties:{id:{...ref,required:true},code:{type:'string',required:true,min:1,max:100},name:{type:'string',required:true,min:1,max:240},nameEn:{type:'string',max:300},sourceSheet:{type:'string',required:true,min:1,max:100},sourceRow:{type:'number',required:true,min:1,max:1048576,integer:true}}}}}}};
const handoff=(row:any)=>({...pick(row,fields('id version quoteId quoteVersion quoteNo customerAccountId customerName customerCode models recipientMemberIds recipientNames createdAt createdBy stale canAccept')),acceptedBy:Array.isArray(row.acceptedBy)?row.acceptedBy.map((value:any)=>pick(value,fields('memberId name at'))):[]});
export class QuoteHandoffService{
 constructor(private store:StateStore,private transport:typeof fetch=fetch){}
 private async client(){const config=await this.store.config(),session=await this.store.session(config);if(!session)throw new CliError('AUTH_REQUIRED','请先运行 doon login。',4);return {api:new ApiClient(config,this.transport,30000),session};}
 async list(id='',quoteId=''){
  const {api,session}=await this.client();if(id&&quoteId)throw new CliError('INVALID_ARGUMENT','查看指定交接记录时不再指定报价筛选。',2);
  const data=(await api.request(id?'/api/workspace/ie-quote-handoff-read':'/api/workspace/ie-quote-handoffs',session,undefined,{query:id?{id}:quoteId?{quoteId}:{}})).data;
  if(id){if(data?.handoff?.id!==id)throw new CliError('INVALID_RESPONSE','交接记录响应不符合协议。',5);return {scope:{customerId:data.handoff.customerAccountId},record:handoff(data.handoff)};}
  if(!Array.isArray(data?.handoffs))throw new CliError('INVALID_RESPONSE','交接目录响应不符合协议。',5);return {scope:{},handoffs:data.handoffs.map(handoff)};
 }
 async execute(action:string,file:string,rawVersion:string){
  if(!['push','accept'].includes(action))throw new CliError('UNSUPPORTED_OPERATION','工程交接动作未接入。',2);
  if(!/^[1-9]\d*$/.test(rawVersion)||!Number.isSafeInteger(Number(rawVersion)))throw new CliError('INVALID_ARGUMENT','请指定报价或交接记录的当前正整数版本。',2);
  const schema:WriteSchema={id:{...ref,required:true},...(action==='push'?{recipientMemberIds:{type:'array',required:true,min:1,max:100,items:ref} as const}:{})},input=await readWriteInput(file,schema),version=Number(rawVersion),{api,session}=await this.client();
  const data=(await api.request(action==='push'?'/api/workspace/ie-quote-handoff':'/api/workspace/ie-quote-handoff-accept',session,{...input,version})).data,row=data?.handoff;
  if(data?.ok!==true||!row?.id||(action==='push'?(row.quoteId!==input.id||row.quoteVersion!==version||!isDeepStrictEqual([...row.recipientMemberIds].sort(),[...input.recipientMemberIds as string[]].sort())):(row.id!==input.id||(!data.alreadyPresent&&row.version!==version+1))))throw new CliError('INVALID_RESPONSE','交接响应无法核对，请查询交接目录。',5,{outcomeUnknown:true});
  try{const read=await this.list(row.id);if(!isDeepStrictEqual(read.record,handoff(row)))throw Error('changed');return read;}catch{throw new CliError('READBACK_FAILED','交接已响应，但回读未完成，请先查询。',5,{outcomeUnknown:true});}
 }
 namesSchema(){return {scope:{},fields:namesSchema,semantics:'管理员迁入独立名称资料；沿用来源文件摘要、行位置、版本和UUID，不改原报价或原颜色字典'};}
 async names(options:{search?:string;limit?:string;offset?:string}={}){
  const window=pagination(options);if(window.offset>2000)throw new CliError('INVALID_ARGUMENT','名称资料起始偏移不能超过2000。',2);
  const {api,session}=await this.client(),data=(await api.request('/api/workspace/ie-material-names',session,undefined,{query:{q:options.search||'',limit:String(window.limit),offset:String(window.offset)}})).data;
  if(!Array.isArray(data?.items)||!Number.isSafeInteger(data.total)||data.offset!==window.offset||data.limit!==window.limit)throw new CliError('INVALID_RESPONSE','名称资料响应不符合分页协议。',5);
  return {scope:{pagination:'server'},catalogId:data.catalogId,version:data.version,sourceFilename:data.sourceFilename,sourceSha256:data.sourceSha256,page:{...window,total:data.total,nextOffset:data.nextOffset,rows:data.items.map((row:any)=>pick(row,itemFields))}};
 }
 async importNames(file:string,rawVersion:string,token:string){
  if(!/^(0|[1-9]\d*)$/.test(rawVersion)||!Number.isSafeInteger(Number(rawVersion)))throw new CliError('INVALID_ARGUMENT','资料版本须为非负整数，首次使用0。',2);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token))throw new CliError('INVALID_ARGUMENT','操作标识须为UUID。',2);
  const version=Number(rawVersion),{api,session}=await this.client();
  return executeWrite({schema:namesSchema,versionField:'version',versionMin:0,tokenField:'token',
   async send(input){const data=(await api.request('/api/workspace/ie-material-names-import',session,input)).data;if(data?.ok!==true||!data.id||data.version!==version+1)throw new CliError('INVALID_RESPONSE','名称资料导入结果无法核对。',5,{outcomeUnknown:true});return data;},
   readBack:async(result,input)=>{const data=await this.names({limit:'100'}),catalog=input.catalog as any;if(data.catalogId!==result.id||data.version!==result.version||data.page.total!==catalog.entries.length||data.sourceSha256!==catalog.sourceSha256||data.sourceFilename!==catalog.sourceFilename||data.page.rows.some((row:any,index:number)=>!isDeepStrictEqual(pick(row,fields('id code name nameEn sourceSheet sourceRow')),{nameEn:'',...catalog.entries[index]})))throw Error('changed');return {scope:{},record:{id:data.catalogId,version:data.version,count:data.page.total,sourceFilename:data.sourceFilename,sourceSha256:data.sourceSha256}};}
  },{file,version,token});
 }
}
