import {ApiClient} from './client.js';
import {StateStore} from './state.js';
import {CliError} from './errors.js';
import {quoteSchemas} from './quote-schemas.js';
import {readWriteInput,validateWriteInput,type WriteSchema,type WriteField} from './write-input.js';
import {isDeepStrictEqual} from 'node:util';
export type QuoteKind='ie'|'customer';
const specs={ie:{route:'/api/workspace/ie-quote-save',actions:{submit:'/api/workspace/ie-quote-submit',review:'/api/workspace/ie-quote-review',revise:'/api/workspace/ie-quote-revise'}},customer:{route:'/api/workspace/customer-quote-save',actions:{confirm:'/api/workspace/customer-quote-confirm',revise:'/api/workspace/customer-quote-revise','adopt-ie':'/api/workspace/customer-quote-adopt-ie'}}} as const;
const ref={type:'string',min:1,max:120} as const;
const change:WriteSchema={id:{...ref,required:true}};
const actions:Record<string,WriteSchema>={submit:change,revise:change,review:{...change,decision:{type:'string',required:true,enum:['approve','return']},reason:{type:'string',required:true,max:4000}},confirm:{...change,acknowledgeEnglish:{type:'boolean',required:true,enum:[true]}},'adopt-ie':{...change,ieQuoteId:{...ref,required:true},ieQuoteVersion:{type:'number',required:true,min:1,integer:true},scopeAcknowledged:{type:'boolean',required:true,enum:[true]},mappings:{type:'array',required:true,min:1,max:200,items:{type:'object',properties:{customerLineId:{...ref,required:true},ieLineId:{...ref,required:true}}}},toolingMappings:{type:'array',required:true,max:100,items:{type:'object',properties:{toolingId:{...ref,required:true},customerChargeId:{...ref,required:true}}}}}};
const project=(value:any,field:WriteField):any=>value==null?value:field.type==='object'?Object.fromEntries(Object.entries(field.properties||{}).filter(([key])=>Object.hasOwn(value,key)).map(([key,child])=>[key,project(value[key],child)])):field.type==='array'?value.map((row:any)=>project(row,field.items!)):value;
const versionNumber=(raw:string,min:number)=>{if(!/^(0|[1-9]\d*)$/.test(raw)||!Number.isSafeInteger(Number(raw))||Number(raw)<min)throw new CliError('INVALID_ARGUMENT','请提供有效的当前版本；新增报价使用0。',2);return Number(raw);};
export class QuoteWriteService{
 constructor(private store:StateStore,private transport:typeof fetch=fetch){}
 private async client(){const config=await this.store.config(),session=await this.store.session(config);if(!session)throw new CliError('AUTH_REQUIRED','请先运行 doon login。',4);return {api:new ApiClient(config,this.transport,30000),session};}
 schema(kind:QuoteKind){if(!Object.hasOwn(specs,kind))throw new CliError('UNSUPPORTED_OPERATION','报价类型未接入。',2);return {scope:{},type:kind,fields:quoteSchemas[kind],actions:Object.fromEntries(Object.keys(specs[kind].actions).map(action=>[action,actions[action]])),semantics:'服务器负责精确计算、业务和权限校验；保存指定顶层字段，数组须提供完整替换内容'};}
 private async current(kind:QuoteKind,id:string){
  const {api,session}=await this.client();
  const data=kind==='ie'?(await api.request('/api/workspace/ie-quote',session,undefined,{query:{id}})).data:(await api.request('/api/workspace/customer-quotes',session)).data;
  const row=kind==='ie'?data?.quote:data?.quotes?.find((value:any)=>value.id===id);
  if(!row||row.id!==id||!Number.isSafeInteger(row.version))throw new CliError('NOT_IN_SCOPE','报价不存在或不在当前授权范围。',7);return row;
 }
 async form(kind:QuoteKind,id:string){const schema=this.schema(kind).fields,row=await this.current(kind,id);return {scope:{customerId:row.customerAccountId},status:row.status,version:row.version,record:project(row,{type:'object',properties:schema}),capabilities:Object.fromEntries(Object.entries(row).filter(([key,value])=>key.startsWith('can')&&typeof value==='boolean'))};}
 async save(kind:QuoteKind,file:string,rawVersion:string){
  const schema=this.schema(kind).fields as WriteSchema,version=versionNumber(rawVersion,0);
  const allowed=Object.fromEntries(Object.entries(schema).filter(([key])=>key!=='version').map(([key,field])=>[key,{...field,required:false}]));
  const input=await readWriteInput(file,allowed);
  if(!!input.id!==(version>0))throw new CliError('INVALID_INPUT','修改报价须同时指定id和当前版本；新增不提供id。',2);
  const prior=input.id?await this.current(kind,String(input.id)):undefined;
  if(prior&&prior.version!==version)throw new CliError('CONFLICT','报价已更新，请重新查询；本次未提交。',6);
  const payload={...(prior?project(prior,{type:'object',properties:schema}):{}),...input,...(prior?{version}:{})};
  validateWriteInput(payload,schema);
  const {api,session}=await this.client(),response=(await api.request(specs[kind].route,session,payload)).data;
  if(response?.ok!==true||!response.quote?.id||(prior&&response.quote.id!==prior.id)||response.quote.version!==version+1)throw new CliError('INVALID_RESPONSE','保存响应无法核对，请查询报价。',5,{outcomeUnknown:true});
  try{
   const row=await this.current(kind,response.quote.id);
   if(row.version!==response.quote.version||row.customerAccountId!==response.quote.customerAccountId||row.status!==response.quote.status||!isDeepStrictEqual(project(row,{type:'object',properties:schema}),project(response.quote,{type:'object',properties:schema})))throw Error('changed');
   return {scope:{customerId:row.customerAccountId},record:project(row,{type:'object',properties:schema}),status:row.status};
  }catch{throw new CliError('READBACK_FAILED','保存已响应，但回读未完成，请先查询原操作。',5,{outcomeUnknown:true});}
 }
 async action(kind:QuoteKind,action:string,file:string,rawVersion:string){
  this.schema(kind);if(!Object.hasOwn(specs[kind].actions,action))throw new CliError('UNSUPPORTED_OPERATION','该报价动作尚未接入。',2);
  const version=versionNumber(rawVersion,1),payload:Record<string,unknown>={...await readWriteInput(file,actions[action]),version};
  const {api,session}=await this.client(),route=(specs[kind].actions as Record<string,keyof typeof import('./routes.js').routes>)[action],data=(await api.request(route,session,payload)).data;
  if(data?.ok!==true||data.quote?.id!==payload.id||data.quote.version!==version+1)throw new CliError('INVALID_RESPONSE','报价动作响应无法核对。',5,{outcomeUnknown:true});
  try{const row=await this.current(kind,String(payload.id));if(row.version!==version+1||row.status!==data.quote.status||row.status!==(action==='submit'?'submitted':action==='review'?(payload.decision==='approve'?'released':'returned'):action==='confirm'?'confirmed':'draft')||row.customerAccountId!==data.quote.customerAccountId)throw Error('changed');if(action==='review'&&row.reviewReason!==payload.reason)throw Error('reason changed');if(action==='adopt-ie'&&(row.ieSource?.quoteId!==payload.ieQuoteId||row.ieSource?.version!==payload.ieQuoteVersion))throw Error('source changed');return {scope:{customerId:row.customerAccountId},record:{id:row.id,version:row.version,status:row.status,...(row.ieSource?{ieSource:row.ieSource}:{})}};}catch{throw new CliError('READBACK_FAILED','报价动作已响应，但回读未完成，请先查询原操作。',5,{outcomeUnknown:true});}
 }
}
