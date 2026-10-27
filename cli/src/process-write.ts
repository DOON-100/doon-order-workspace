import {isDeepStrictEqual} from 'node:util';
import {ApiClient} from './client.js';
import {StateStore} from './state.js';
import {CliError} from './errors.js';
import {processFields,processDetails} from './process-schemas.js';
import {readWriteInput,validateWriteInput,type WriteSchema} from './write-input.js';
import {projectFields,without} from './engineering-write.js';
import {fields,pick,page,pagination,identifier} from './business.js';
import {integer} from './order-write.js';

export const qualityProcessTypes=['iqc','first-article','process-quality','outsourcing-quality','oqc'] as const;
export const warehouseProcessTypes=['material-kit','warehouse','packaging','shipment-release'] as const;
const metadata=fields('id version type customerId orderId teamId createdAt updatedAt updatedBy');
type Options={team?:string;customer?:string;order?:string;limit?:string;offset?:string};
export class ProcessRecordService{
 constructor(private store:StateStore,private transport:typeof fetch=fetch){}
 private async client(){const config=await this.store.config(),session=await this.store.session(config);if(!session)throw new CliError('AUTH_REQUIRED','请先运行 doon login。',4);return {api:new ApiClient(config,this.transport,60000),session};}
 schema(type:string){
  if(!Object.hasOwn(processDetails,type))throw new CliError('UNSUPPORTED_OPERATION','该流程类型尚未接入。',2);
  const detailFields=(processDetails as Record<string,WriteSchema>)[type];
  return {fields:{...without(processFields,['type','token','version']),details:{type:'object',properties:detailFields} as const},semantics:'独立流程凭据记录；不会自动增加库存、报工、实发、ERP过账或实际品质放行。修改只合并指定字段，details默认按键合并；--replace-details整对象替换，可省略数值恢复待核查，未知不能填null或猜成0。',version:'新增0且不提供id；修改提供id和当前版本',requestId:'服务端按当前身份和完整内容去重，结果不明先查询原记录，不自动重试'};
 }
 private async data(type:string,rawTeam?:string){this.schema(type);const team=identifier(rawTeam,'业务组'),{api,session}=await this.client(),data=(await api.request('/api/workspace/process-data',session,undefined,{query:{type},team})).data;if(!Array.isArray(data?.records)||data.records.some((row:any)=>row.type!==type))throw new CliError('INVALID_RESPONSE','流程目录响应无效。',5);if(team&&data.businessTeamScope?.teamId!==team)throw new CliError('SCOPE_NOT_CONFIRMED','服务器未确认所选业务组范围。',5);return data;}
 private record(type:string,row:any):Record<string,any>{return {...projectFields(row,this.schema(type).fields),...pick(row,metadata)};}
 async list(type:string,options:Options={}){const customer=identifier(options.customer,'客户'),order=identifier(options.order,'订单'),team=identifier(options.team,'业务组'),data=await this.data(type,team),rows=data.records.filter((row:any)=>(!customer||row.customerId===customer)&&(!order||row.orderId===order));return {scope:{type,teamId:team||null,customerId:customer||null,orderId:order||null},page:page(rows.map((row:any)=>this.record(type,row)),pagination(options))};}
 async form(type:string,rawId:string,rawTeam?:string){const id=identifier(rawId,'流程记录',true),team=identifier(rawTeam,'业务组'),data=await this.data(type,team),row=data.records.find((row:any)=>row.id===id);if(!row)throw new CliError('NOT_IN_SCOPE','流程记录不在当前客户、订单、类型或业务组范围。',7);return {scope:{type,customerId:row.customerId,orderId:row.orderId,teamId:row.teamId||null},record:this.record(type,row),capabilities:pick(row,fields('canEdit'))};}
 async references(type:string,options:Options={}){const data=await this.data(type,options.team);return {scope:{type,teamId:options.team||null},customers:(data.customers||[]).map((row:any)=>pick(row,fields('id customer customerCode active orderKeys'))),orders:page((data.orders||[]).map((row:any)=>pick(row,fields('id orderNo customer drawing color batch'))),pagination(options)),members:(data.members||[]).map((row:any)=>pick(row,fields('id name'))),teams:(data.teams||[]).map((row:any)=>pick(row,fields('id name active customerIds'))),canCreate:(data.allowedKinds||[]).includes(type),semantics:'选择负责人不会授予客户、订单或部门权限；保存时由服务器重核'};}
 private async revisions(type:string,id:string,team?:string){const current=await this.form(type,id,team),{api,session}=await this.client(),data=(await api.request('/api/workspace/process-history',session,undefined,{query:{id},team})).data;if(!Array.isArray(data?.history)||data.history.some((row:any)=>row.recordId!==id||row.snapshot?.id!==id||row.snapshot.type!==type||row.snapshot.customerId!==current.record.customerId||row.snapshot.orderId!==current.record.orderId||row.snapshot.teamId!==current.record.teamId||row.snapshot.version!==row.version))throw new CliError('INVALID_RESPONSE','流程历史的类型、客户、订单或业务组关联不一致。',5);return {current,rows:data.history};}
 async history(type:string,id:string,options:Options={}){const data=await this.revisions(type,id,options.team);return {scope:data.current.scope,page:page(data.rows.map((row:any)=>({...pick(row,fields('id recordId version action actor createdAt')),record:this.record(type,row.snapshot)})),pagination(options))};}
 async save(type:string,file:string,rawVersion:string,requestId:string,rawTeam?:string,replaceDetails=false){
  const schema=this.schema(type).fields,loose=Object.fromEntries(Object.entries(schema).map(([key,value])=>[key,{...value,required:false}])),input=await readWriteInput(file,loose),version=integer(rawVersion,0),team=identifier(rawTeam,'业务组');
  if(!!input.id!==(version>0))throw new CliError('INVALID_INPUT','新增版本0且不提供id；修改提供id和当前版本。',2);
  if(!/^[A-Za-z0-9_-]{8,160}$/.test(requestId))throw new CliError('INVALID_ARGUMENT','须提供有效的操作标识。',2);
  if(replaceDetails&&!Object.hasOwn(input,'details'))throw new CliError('INVALID_INPUT','整对象替换时须显式提供details对象。',2);
  let body:Record<string,any>={...input};
  if(input.id){let before=(await this.form(type,String(input.id),team)).record;if(before.version!==version){const revisions=await this.revisions(type,String(input.id),team),row=revisions.rows.find((row:any)=>row.version===version);if(!row)throw new CliError('CONFLICT','找不到指定基础版本，请读取当前记录。',2);before=this.record(type,row.snapshot);}const old=without(before as any,['version','type','createdAt','updatedAt','updatedBy']);body={...old,...input,details:replaceDetails?input.details:{...before.details,...input.details as object}};}
  validateWriteInput(body,schema);body.type=type;body.token=requestId;if(version)body.version=version;
  const {api,session}=await this.client(),data=(await api.request('/api/workspace/process-save',session,body,{team})).data,row=data?.record;
  if(data?.ok!==true||!row?.id||row.type!==type||(input.id&&row.id!==input.id)||(body.customerId!==undefined&&row.customerId!==body.customerId)||(body.orderId!==undefined&&row.orderId!==body.orderId)||(body.teamId!==undefined&&row.teamId!==body.teamId))throw new CliError('INVALID_RESPONSE','流程保存响应无法核对。',5,{outcomeUnknown:true});
  try{const current=await this.form(type,row.id,team);if(!isDeepStrictEqual(current.record,this.record(type,row)))throw Error('changed');return {...current,idempotent:data.idempotent===true};}catch{throw new CliError('READBACK_FAILED','流程保存已响应但回读未完成；请核查原记录和历史，勿盲目重提。',5,{outcomeUnknown:true});}
 }
}
