import {ApiClient} from './client.js';
import {StateStore} from './state.js';
import {CliError} from './errors.js';
import {quoteSchemas} from './quote-schemas.js';
import {type WriteField,type WriteSchema,readWriteInput,validateWriteInput} from './write-input.js';
import {isDeepStrictEqual} from 'node:util';
import {page,pagination} from './business.js';
const text=(max:number,min=0):WriteField=>({type:'string',max,min,required:true});
const id={type:'string',min:1,max:120} as const;
const number:WriteField={type:'number',min:0,max:100000000,required:true};
const process=quoteSchemas.ie.lines.items.properties.processes.items;
const schemas:Record<string,WriteSchema>={
 catalog:{id,category:{type:'string',required:true,enum:['material','process','plating','general']},name:text(240,1),specification:text(1000),unit:text(40),basePrice:number,standardSeconds:{...number,nullable:true},priceSource:text(1000,1),effectiveDate:text(10,10),active:{type:'boolean',required:true}},
 preset:{id,name:text(240,1),description:text(4000),processes:{type:'array',required:true,min:1,max:300,items:process},active:{type:'boolean',required:true}},
 tooling:{id,customerAccountId:{...id,required:true},name:text(240,1),reference:text(500,1),chargeStatus:{type:'string',required:true,enum:['uncollected','collected']},evidence:text(4000)}
};
const specs={catalog:{rows:'catalog',result:'catalog',route:'/api/workspace/ie-quote-catalog-save'},preset:{rows:'processPresets',result:'preset',route:'/api/workspace/ie-quote-process-preset-save'},tooling:{rows:'toolingRegistry',result:'tooling',route:'/api/workspace/ie-quote-tooling-register'}} as const;
type Kind=keyof typeof specs;
const project=(value:any,field:WriteField):any=>value==null?value:field.type==='object'?Object.fromEntries(Object.entries(field.properties||{}).filter(([key])=>Object.hasOwn(value,key)).map(([key,child])=>[key,project(value[key],child)])):field.type==='array'?value.map((row:any)=>project(row,field.items!)):value;
export class QuoteResourceService{
 constructor(private store:StateStore,private transport:typeof fetch=fetch){}
 private async client(){const config=await this.store.config(),session=await this.store.session(config);if(!session)throw new CliError('AUTH_REQUIRED','请先运行 doon login。',4);return {api:new ApiClient(config,this.transport,30000),session};}
 schema(type:string){if(!Object.hasOwn(specs,type))throw new CliError('UNSUPPORTED_OPERATION','报价资料类型未接入。',2);return {scope:{},type,fields:schemas[type],semantics:'新增使用0；修改指定id及当前版本，仅提交变化字段，数组完整替换'};}
 private async rows(type:Kind,includeInactive:boolean){const {api,session}=await this.client(),data=(await api.request('/api/workspace/ie-quotes',session,undefined,{query:includeInactive&&type!=='tooling'?{includeInactive:'1'}:{}})).data,rows=data?.[specs[type].rows];if(!Array.isArray(rows))throw new CliError('INVALID_RESPONSE','报价参考资料响应不符合协议。',5);return rows;}
 async list(type:string,options:{includeInactive?:boolean;limit?:string;offset?:string;search?:string}={}){const schema=this.schema(type).fields,rows=await this.rows(type as Kind,!!options.includeInactive),search=options.search?.toLocaleLowerCase()||'',safe=rows.filter((row:any)=>!search||[row.name,row.reference,row.category].some(value=>String(value||'').toLocaleLowerCase().includes(search))).map((row:any)=>({...project(row,{type:'object',properties:schema}),version:row.version}));return {scope:{},type,page:page(safe,pagination(options))};}
 async save(type:string,file:string,rawVersion:string){
  const schema=this.schema(type).fields;if(!/^(0|[1-9]\d*)$/.test(rawVersion)||!Number.isSafeInteger(Number(rawVersion)))throw new CliError('INVALID_ARGUMENT','版本须为非负整数，新增使用0。',2);
  const version=Number(rawVersion),input=await readWriteInput(file,Object.fromEntries(Object.entries(schema).map(([key,field])=>[key,{...field,required:false}]))),kind=type as Kind,spec=specs[kind];
  if(!!input.id!==(version>0))throw new CliError('INVALID_INPUT','修改须提供id和当前版本；新增不提供id。',2);
  const before=input.id?(await this.rows(kind,true)).find((row:any)=>row.id===input.id):undefined;
  if(input.id&&!before)throw new CliError('NOT_IN_SCOPE','报价资料不存在或不可维护。',7);
  if(before&&before.version!==version)throw new CliError('CONFLICT','报价资料已更新，本次未提交。',6);
  const payload={...(before?project(before,{type:'object',properties:schema}):{}),...input};validateWriteInput(payload,schema);if(version)payload.version=version;
  const {api,session}=await this.client(),data=(await api.request(spec.route,session,payload)).data,result=data?.[spec.result];
  if(data?.ok!==true||!result?.id||(input.id&&result.id!==input.id)||result.version!==version+1)throw new CliError('INVALID_RESPONSE','报价资料写入结果无法核对。',5,{outcomeUnknown:true});
  try{const row=(await this.rows(kind,true)).find((value:any)=>value.id===result.id);if(!row||row.version!==version+1||!isDeepStrictEqual(project(row,{type:'object',properties:schema}),project(result,{type:'object',properties:schema})))throw Error('changed');return {scope:{customerId:row.customerAccountId},record:{...project(row,{type:'object',properties:schema}),version:row.version}};}catch{throw new CliError('READBACK_FAILED','资料保存已响应，但回读未完成，请先查询。',5,{outcomeUnknown:true});}
 }
}
