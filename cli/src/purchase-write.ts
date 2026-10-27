import {isDeepStrictEqual} from 'node:util';
import {ApiClient} from './client.js';
import {StateStore} from './state.js';
import {CliError} from './errors.js';
import {readWriteInput,type WriteSchema} from './write-input.js';
import {pick,fields} from './business.js';
import {integer} from './order-write.js';

const id={type:'string',required:true,min:1,max:160} as const;
const date={type:'string',required:true,min:10,max:10} as const;
const followup:WriteSchema={id,promisedDate:{type:'string',max:10},expectedDate:{type:'string',max:10},nextFollowupDate:{type:'string',max:10},followupNote:{type:'string',max:3000}};
const event:WriteSchema={id,quantity:{type:'number',required:true,min:0,max:1e9},date,reference:{type:'string',required:true,min:2,max:120},note:{type:'string',required:true,min:2,max:3000}};
const archive:WriteSchema={items:{type:'array',required:true,min:1,max:100,items:{type:'object',properties:{id,version:{type:'number',required:true,integer:true,min:1}}}},date,note:{type:'string',required:true,min:2,max:1000}};
const rowKeys=fields('id version sourceVersion po supplier buyer itemCode itemName unit quantity orderDate dueDate customerOrder auditStatus closeStatus sourceNote sourceRow sourceAsOf sourceHash sourceFile sourceSheet promisedDate expectedDate nextFollowupDate followupNote balanceKnown received returnPending lifecycle completedDate archivedAt archivedBy archiveNote updatedAt updatedBy');
const project=(row:any):Record<string,any>=>({...pick(row,rowKeys),received:row.balanceKnown===true?row.received:null,returnPending:row.balanceKnown===true?row.returnPending:null});
export class PurchaseWriteService {
 constructor(private store:StateStore,private transport:typeof fetch=fetch){}
 private async client(){const config=await this.store.config(),session=await this.store.session(config);if(!session)throw new CliError('AUTH_REQUIRED','请先运行 doon login。',4);return {api:new ApiClient(config,this.transport,60000),session};}
 private async rows(){const {api,session}=await this.client(),data=(await api.request('/api/workspace/purchase-data',session)).data;if(!Array.isArray(data?.rows))throw new CliError('INVALID_RESPONSE','采购目录响应无效。',5);return data;}
 async form(id:string){const data=await this.rows(),row=data.rows.find((row:any)=>row.id===id);if(!row)throw new CliError('NOT_IN_SCOPE','采购明细不在当前权限范围。',7);return {scope:{},record:project(row),capabilities:{canEdit:data.canEdit===true},semantics:'采购净合格与退补核数，不代表仓库库存或质检放行'};}
 schema(type='followup'){let schema:WriteSchema;if(type==='followup')schema=followup;else if(type==='archive')schema=archive;else if(['opening','correction','receipt','return','replacement'].includes(type))schema={...event,...(['opening','correction'].includes(type)?{returnPending:{type:'number',min:0,max:1e9} as const}:{})};else throw new CliError('UNSUPPORTED_OPERATION','采购表单类型未接入。',2);return {fields:schema,semantics:type==='followup'?'仅更新指定跟进字段，服务端按字段并发合并，无请求去重契约':type==='archive'?'按明细版本齐货存档，保留历史；不是删除，无请求去重契约':'按当前版本登记采购核数，使用服务端UUID去重；最多四位小数。opening/correction的returnPending省略按0处理',version:type==='archive'?'items逐项携带当前版本':'使用--version当前版本'};}
 async save(file:string,rawVersion:string){const input=await readWriteInput(file,followup),version=integer(rawVersion),changes=Object.entries(input).filter(([key])=>key!=='id').map(([field,value])=>({id:input.id,version,field,value}));if(!changes.length)throw new CliError('INVALID_INPUT','请至少指定一个采购跟进字段。',2);const {api,session}=await this.client(),data=(await api.request('/api/workspace/purchase-save',session,{changes})).data;if(!Array.isArray(data?.rows)||data.rows.length!==1||data.rows[0].id!==input.id)throw new CliError('INVALID_RESPONSE','采购保存响应无法核对。',5,{outcomeUnknown:true});return this.verifyRows(data.rows);}
 async action(type:string,file:string,rawVersion?:string,token?:string){const input=await readWriteInput(file,this.schema(type).fields);if(type==='followup')throw new CliError('INVALID_ARGUMENT','跟进修改使用save。',2);if(type==='archive'){
   if(rawVersion!==undefined||token!==undefined)throw new CliError('INVALID_ARGUMENT','存档在items逐项提供版本，不接受操作标识。',2);const items=input.items as {id:string;version:number}[];if(new Set(items.map(row=>row.id)).size!==items.length)throw new CliError('INVALID_INPUT','存档明细不能重复。',2);
   const {api,session}=await this.client(),data=(await api.request('/api/workspace/purchase-archive',session,input)).data;if(data?.ok!==true||data.count!==items.length)throw new CliError('INVALID_RESPONSE','采购存档响应无法核对。',5,{outcomeUnknown:true});
   try{const rows=[];for(const item of items){const row=(await this.form(item.id)).record;if(row.version!==item.version+1||row.lifecycle!=='archived'||row.completedDate!==input.date||row.archiveNote!==(input.note as string).trim())throw Error('changed');rows.push(row);}return {scope:{},records:rows,count:rows.length};}catch{throw new CliError('READBACK_FAILED','存档已响应，回读未完成；请先核查明细和历史，勿重复存档。',5,{outcomeUnknown:true});}
  }
  if(!token||!/^\w{8}-\w{4}-[1-8]\w{3}-[89ab]\w{3}-\w{12}$/i.test(token)||!/^[0-9a-f-]+$/i.test(token))throw new CliError('INVALID_ARGUMENT','采购核数须提供UUID操作标识。',2);
  const version=integer(rawVersion||''),{api,session}=await this.client(),data=(await api.request('/api/workspace/purchase-receipt',session,{...input,version,type,token})).data;if(data?.row?.id!==input.id)throw new CliError('INVALID_RESPONSE','采购核数响应无法核对。',5,{outcomeUnknown:true});return {...await this.verifyRows([data.row]),reused:data.reused===true};
 }
 private async verifyRows(rows:any[]){try{const records=[];for(const row of rows){const current=(await this.form(row.id)).record;if(!isDeepStrictEqual(current,project(row)))throw Error('changed');records.push(current);}return {scope:{},records,record:records.length===1?records[0]:undefined};}catch{throw new CliError('READBACK_FAILED','采购操作已响应，回读未完成；请查询原明细和历史，勿盲目重试。',5,{outcomeUnknown:true});}}
}
