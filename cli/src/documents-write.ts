import {ApiClient} from './client.js';
import {StateStore} from './state.js';
import {CliError} from './errors.js';
import {orderSchemas,businessForms} from './order-schemas.js';
import {executeWrite} from './write-operation.js';
import {readWriteInput,validateWriteInput,type WriteSchema} from './write-input.js';
import {pick,fields,page,pagination} from './business.js';
import {isDeepStrictEqual} from 'node:util';
import {readQuoteFile,writeNewQuoteFile} from './quote-files.js';
import {createHash} from 'node:crypto';
import {basename} from 'node:path';
const sourceTypes=['po','engineering_drawing','engineering_quote','production_order','production_shipment'];
const documentTypes=['pi','invoice','packing','paymentrequest','waybill'];
const omit=(schema:WriteSchema,keys:string[])=>Object.fromEntries(Object.entries(schema).filter(([key])=>!keys.includes(key)));
const ref={type:'string',required:true,min:1,max:160} as const;
const versionNumber=(raw:string,min=0)=>{if(!/^(0|[1-9]\d*)$/.test(raw)||!Number.isSafeInteger(Number(raw))||Number(raw)<min)throw new CliError('INVALID_ARGUMENT','版本须为有效整数；新增用0。',2);return Number(raw);};
const tokenValid=(token:string)=>{if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token))throw new CliError('INVALID_ARGUMENT','操作标识须为UUID。',2);};
export class BusinessDocumentWriteService{
 constructor(private store:StateStore,private transport:typeof fetch=fetch){}
 private async client(){const config=await this.store.config(),session=await this.store.session(config);if(!session)throw new CliError('AUTH_REQUIRED','请先运行 doon login。',4);return {api:new ApiClient(config,this.transport,30000),session};}
 schema(kind:string,type:string){
  if(kind==='source'?!sourceTypes.includes(type):kind!=='document'||!documentTypes.includes(type))throw new CliError('UNSUPPORTED_OPERATION','该内部资料类型尚未接入。',2);
  const form=(businessForms as Record<string,WriteSchema>)[kind==='document'?'document':type];
  return {scope:{},kind,type,fields:{...omit(orderSchemas.save,['token','expectedVersion','kind','type']),fields:{type:'object',required:true,properties:form} as const},actions:omit(orderSchemas.action,['token','expectedVersion']),semantics:'指定顶层字段增量保存，fields按键合并，lines/sourceRefs/originRefs提供完整替换；关联和审批仍由服务器校验。生产出货批次及物流单据是中台资料，内容核对不表示真实发运、签发、发送或签收'};
 }
 private async data(){const {api,session}=await this.client(),data=(await api.request('/api/workspace/handoff-business-data',session)).data;if(!Array.isArray(data?.items)||!Array.isArray(data.attachments))throw new CliError('INVALID_RESPONSE','内部资料响应不符合协议。',5);return data;}
 private async current(id:string){const row=(await this.data()).items.find((value:any)=>value.id===id);if(!row)throw new CliError('NOT_IN_SCOPE','内部资料不在当前授权范围。',7);this.schema(row.kind==='handoff_business_document'?'document':'source',row.type);return row;}
 private record(row:any){const kind=row.kind==='handoff_business_document'?'document':'source',schema=this.schema(kind,row.type),keys=Object.keys(schema.fields.fields.properties);return {...pick(row,fields('id kind type version customerId projectId orderId number status createdAt updatedAt updatedBy')),fields:pick(row.fields,keys),lines:(row.lines||[]).map((value:any)=>pick(value,fields('orderLineId description quantity unitPrice'))),sourceRefs:(row.sourceRefs||[]).map((value:any)=>pick(value,fields('id version'))),originRefs:(row.originRefs||[]).map((value:any)=>pick(value,fields('id kind version')))};}
 async form(id:string){const row=await this.current(id);return {scope:{customerId:row.customerId},record:this.record(row),capabilities:pick(row,fields('canWrite canConfirm sourceChanged changedSourceIds'))};}
 async references(options:{kind?:string;type?:string;customer?:string;limit?:string;offset?:string}={}){if(options.kind&&!['source','document'].includes(options.kind)||options.type&&![...sourceTypes,...documentTypes].includes(options.type))throw new CliError('INVALID_ARGUMENT','资料类型无效。',2);const data=await this.data(),rows=data.items.filter((row:any)=>(row.kind==='handoff_business_document'?documentTypes:sourceTypes).includes(row.type)&&(!options.kind||row.kind==='handoff_business_'+options.kind)&&(!options.type||row.type===options.type)&&(!options.customer||row.customerId===options.customer));return {scope:{customerId:options.customer||null},page:page(rows.map((row:any)=>this.record(row)),pagination(options)),...(options.type==='production_shipment'?{origins:page((data.queues?.service||[]).filter((row:any)=>row.type==='shipment'&&row.orderId&&(!options.customer||row.customerId===options.customer)).map((row:any)=>({...pick(row,fields('id version customerId orderId title status')),kind:'service_record',details:pick(row.details||{},fields('invoiceNo quantity shipDate carrier trackingNo packingNote'))})),pagination(options))}:{}),members:(data.members||[]).map((row:any)=>pick(row,fields('id name role')))};}
 async save(kind:string,type:string,file:string,rawVersion:string,token:string){
  tokenValid(token);const version=versionNumber(rawVersion),spec=this.schema(kind,type),loose=Object.fromEntries(Object.entries(spec.fields).map(([key,field])=>[key,{...field,required:false,...(key==='fields'?{properties:Object.fromEntries(Object.entries(field.properties||{}).map(([key,value])=>[key,{...value,required:false}]))}:{})}])),{api,session}=await this.client();
  return executeWrite({schema:loose,tokenField:'token',
   validate:async input=>{
    if(!!input.id!==(version>0))throw new CliError('INVALID_INPUT','修改须同时提供id和当前版本；新增不提供id。',2);
    if(input.id){let before=await this.current(String(input.id));if(before.version!==version){const data=(await api.request('/api/workspace/handoff-business-history',session,undefined,{query:{id:String(input.id)}})).data;before=data?.history?.find((row:any)=>row.version===version)?.snapshot;if(!before)throw new CliError('VERSION_CONFLICT','找不到指定资料版本，请重新读取。',6);}if((before.kind==='handoff_business_document'?'document':'source')!==kind||before.type!==type)throw new CliError('INVALID_INPUT','类型须与原资料一致。',2);const previous=this.record(before),previousFields=previous.fields;Object.assign(input,{...omitValue(previous,['version','status','kind','type','createdAt','updatedAt','updatedBy']),...input,fields:{...previousFields,...(input.fields as object||{})}});}
    validateWriteInput(input,spec.fields);input.kind=kind;input.type=type;if(version)input.expectedVersion=version;
   },
   async send(input){const data=(await api.request('/api/workspace/handoff-business-save',session,input)).data;if(data?.ok!==true||!data.item?.id||data.item.customerId!==input.customerId||(input.id&&data.item.id!==input.id))throw new CliError('INVALID_RESPONSE','资料保存响应无法核对。',5,{outcomeUnknown:true});return data.item;},
   readBack:async(result)=>{const row=await this.current(result.id);if(row.version!==version+1||!isDeepStrictEqual(this.record(row),this.record(result)))throw Error('changed');return {scope:{customerId:row.customerId},record:this.record(row)};}
  },{file,token});
 }
 async action(action:string,file:string,rawVersion:string,token:string){
  if(!['submit','return','confirm'].includes(action))throw new CliError('UNSUPPORTED_OPERATION','该资料状态动作未接入。',2);tokenValid(token);const version=versionNumber(rawVersion,1),{api,session}=await this.client();
  return executeWrite({schema:omit(orderSchemas.action,['token','expectedVersion']),versionField:'expectedVersion',tokenField:'token',
   validate:async input=>{await this.current(String(input.id));},
   async send(input){const route=action==='submit'?'/api/workspace/handoff-business-submit':action==='return'?'/api/workspace/handoff-business-return':'/api/workspace/handoff-business-confirm',data=(await api.request(route,session,input)).data;if(data?.ok!==true||data.item?.id!==input.id)throw new CliError('INVALID_RESPONSE','资料状态响应无法核对。',5,{outcomeUnknown:true});return data.item;},
   readBack:async result=>{const row=await this.current(result.id);if(row.version!==version+1||row.status!==(action==='submit'?'pending_check':action==='return'?'draft':'checked')||!isDeepStrictEqual(this.record(row),this.record(result)))throw Error('changed');return {scope:{customerId:row.customerId},record:this.record(row)};}
  },{file,version,token});
 }
 async generate(type:string,file:string,rawVersion:string,token:string){
  this.schema('document',type);tokenValid(token);const version=versionNumber(rawVersion,1),{api,session}=await this.client();
  return executeWrite({schema:omit(orderSchemas.generate,['token','sourceVersion','type']),versionField:'sourceVersion',tokenField:'token',validate:input=>{input.type=type;},
   async send(input){const data=(await api.request('/api/workspace/handoff-business-generate',session,input)).data;if(data?.ok!==true||!data.item?.id||data.item.type!==type)throw new CliError('INVALID_RESPONSE','单据生成响应无法核对。',5,{outcomeUnknown:true});return data.item;},
   readBack:async(result,input)=>{const row=await this.current(result.id);if(!isDeepStrictEqual(this.record(row),this.record(result))||!row.sourceRefs?.some((ref:any)=>ref.id===input.sourceId&&ref.version===version))throw Error('source changed');return {scope:{customerId:row.customerId},record:this.record(row)};}
  },{file,version,token});
 }
 async files(id:string){const row=await this.current(id),data=await this.data();return {scope:{customerId:row.customerId},record:pick(row,fields('id version')),files:data.attachments.filter((file:any)=>file.recordId===id&&file.customerId===row.customerId).map((file:any)=>pick(file,fields('id recordId customerId sourceVersion filename contentType size hash note createdAt actor')))};}
 async upload(file:string,filePath:string,rawVersion:string,token:string){
  tokenValid(token);const version=versionNumber(rawVersion,1),input=await readWriteInput(file,{id:ref,note:{type:'string',max:6000}});await this.current(String(input.id));
  const bytes=await readQuoteFile(filePath,10*1024*1024),hash=createHash('sha256').update(bytes).digest('hex'),form=new FormData();form.set('id',String(input.id));form.set('expectedVersion',String(version));form.set('token',token);form.set('note',String(input.note||''));form.set('file',new File([Uint8Array.from(bytes)],basename(filePath)));
  const {api,session}=await this.client(),data=(await api.request('/api/workspace/handoff-business-attachment',session,form)).data;if(data?.ok!==true||data.item?.id!==input.id)throw new CliError('INVALID_RESPONSE','附件上传响应无法核对。',5,{outcomeUnknown:true});
  try{const read=await this.files(String(input.id)),matches=read.files.filter((row:any)=>row.hash===hash&&row.size===bytes.length&&row.sourceVersion===version+1);if(read.record.version!==version+1||matches.length!==1)throw Error('attachment missing');return {scope:read.scope,record:read.record,file:matches[0]};}catch{throw new CliError('READBACK_FAILED','附件上传已响应，但回读未完成，请查询原操作。',5,{outcomeUnknown:true});}
 }
 async download(id:string,fileId:string,output:string){const data=await this.files(id),file=data.files.find((row:any)=>row.id===fileId);if(!file)throw new CliError('NOT_IN_SCOPE','文件不属于当前资料。',7);const {api,session}=await this.client(),bytes=(await api.request('/api/workspace/handoff-business-file',session,undefined,{query:{id:fileId}})).data as Buffer;if(bytes.length!==file.size||createHash('sha256').update(bytes).digest('hex')!==file.hash)throw new CliError('INVALID_RESPONSE','内部资料附件摘要核对失败。',5);return {scope:data.scope,file:await writeNewQuoteFile(bytes,output)};}
}
function omitValue(value:Record<string,any>,keys:string[]){return Object.fromEntries(Object.entries(value).filter(([key])=>!keys.includes(key)));}
