import {ApiClient} from './client.js';
import {CliError} from './errors.js';
import {StateStore} from './state.js';
import {executeWrite} from './write-operation.js';
import {type WriteField, type WriteSchema} from './write-input.js';
import {isDeepStrictEqual} from 'node:util';
import {open} from 'node:fs/promises';
import {basename,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {readWriteInput} from './write-input.js';
import {fields, pick} from './business.js';

const text:WriteField={type:'string',max:100000};
const ref:WriteField={type:'string',max:160};
const ids:WriteField={type:'array',max:1000,items:{...ref,min:1}};
const quantity:WriteField={type:'number',min:0};
const scope:WriteField={type:'array',max:1000,items:{type:'object',properties:{itemId:ref,quantity}}};
const choice=(...values:string[]):WriteField=>({type:'string',enum:values});
const strings=(names:string):WriteSchema=>Object.fromEntries(names.split(' ').map(name=>[name,text]));
// The same partial-update contracts as the website's ordinary entry forms.
// Formal release, submission and review keep their separate server endpoints.
export const projectEntrySchemas:Record<string,WriteSchema>={
 item:{...strings('model customerModel drawing color lens material requirements'),quantity},
 round:{...strings('title stage sampleGateNote dueDate reason'),type:choice('development','revision','sales_sample','preproduction','bulk'),parentRoundId:ref,scope,requiredDrawingTypes:{type:'array',max:2,items:choice('2d','3d')},requireQuote:{type:'boolean'},requiredSampleIds:ids,sampleGateStage:choice('order','before_production','not_required'),status:choice('open','partial','transferred','cancelled')},
 communication:{...strings('channel contact occurredAt content nextAction dueDate'),ownerId:ref,visibility:choice('internal','customer'),attachmentIds:ids},
 task:{...strings('title description waitingFor dueDate result changeReason'),ownerId:ref,serviceReviewerId:ref,salesReviewerId:ref,status:choice('open','service_review','sales_review','returned','done','cancelled')},
 attachment:strings('filename note'),
};
const collections:Record<string,string>={item:'items',round:'rounds',communication:'communications',task:'tasks',attachment:'attachments'};
const kinds:Record<string,string>={item:'customer_project_item',round:'customer_project_round',communication:'customer_project_communication',task:'customer_project_task',attachment:'customer_project_attachment'};
const defaults:Record<string,Record<string,string>>={item:{model:'未命名款色'},round:{title:'未命名轮次'},task:{title:'未命名待办'},attachment:{filename:'未命名资料'}};
const base:WriteSchema={projectId:{...ref,required:true,min:1},roundId:ref,id:{...ref,min:1}};

export class ProjectEntryService {
 constructor(private store:StateStore,private transport:typeof fetch=fetch){}
 private async client(){const config=await this.store.config(),session=await this.store.session(config);if(!session)throw new CliError('AUTH_REQUIRED','请先运行 doon login。',4);return {api:new ApiClient(config,this.transport,30000),session};}
 async upload(inputFile:string,filePath:string){
  const input=await readWriteInput(inputFile,{projectId:{...ref,required:true,min:1},roundId:ref,category:choice('general','original-communication'),note:{type:'string',max:3000}});
  const handle=await open(filePath,'r').catch(()=>{throw new CliError('INVALID_INPUT','无法读取项目原件。',2);});let bytes:Buffer;
  try{const info=await handle.stat(),limit=50*1024*1024;if(!info.isFile()||info.size<1||info.size>limit)throw new CliError('INVALID_INPUT','项目原件须为不超过50 MiB的非空普通文件。',2);const buffer=Buffer.alloc(limit+1);let size=0;while(size<buffer.length){const read=await handle.read(buffer,size,buffer.length-size,null);if(!read.bytesRead)break;size+=read.bytesRead;}if(size>limit||size!==info.size)throw new CliError('INVALID_INPUT','文件大小发生变化。',2);bytes=buffer.subarray(0,size);}finally{await handle.close();}
  const hash=createHash('sha256').update(bytes).digest('hex'),form=new FormData();for(const [key,value] of Object.entries(input))form.set(key,String(value));form.set('file',new File([Uint8Array.from(bytes)],basename(filePath)));
  const {api,session}=await this.client(),data=(await api.request('/api/workspace/customer-project-attachment',session,form)).data;
  if(data?.ok!==true||!data.item?.id||data.item.projectId!==input.projectId||data.item.hash!==hash||data.item.size!==bytes.length)throw new CliError('INVALID_RESPONSE','原件上传结果无法核对，请查询项目附件。',5,{outcomeUnknown:true});
  try{const view=(await api.request('/api/workspace/customer-project-data',session)).data,row=view.attachments?.find((v:any)=>v.id===data.item.id&&v.projectId===input.projectId&&v.customerId===data.item.customerId);if(!row||row.hash!==hash||row.size!==bytes.length)throw Error('changed');return {scope:{customerId:row.customerId},record:pick(row,fields('id version projectId customerId roundId category filename contentType size hash note'))};}catch{throw new CliError('READBACK_FAILED','上传已响应，但回读未完成，请查询原操作。',5,{outcomeUnknown:true});}
 }
 async download(projectId:string,id:string,output:string){
  const {api,session}=await this.client(),data=(await api.request('/api/workspace/customer-project-data',session)).data,row=data.attachments?.find((v:any)=>v.id===id&&v.projectId===projectId);
  if(!row)throw new CliError('NOT_IN_SCOPE','项目附件不在当前授权范围。',7);
  const bytes=(await api.request('/api/workspace/customer-project-file',session,undefined,{query:{id}})).data as Buffer;
  if(bytes.length!==row.size||createHash('sha256').update(bytes).digest('hex')!==row.hash)throw new CliError('INVALID_RESPONSE','项目原件完整性校验失败。',5);
  const target=resolve(output);let handle;try{handle=await open(target,'wx',0o600);await handle.writeFile(bytes);}catch(error){throw new CliError((error as NodeJS.ErrnoException).code==='EEXIST'?'OUTPUT_EXISTS':'OUTPUT_WRITE_FAILED','无法写入新文件，不会覆盖已有文件。',3);}finally{await handle?.close();}
  return {scope:{customerId:row.customerId},file:{path:target,bytes:bytes.length,sha256:row.hash}};
 }
 schema(type:string){
  if(!Object.hasOwn(projectEntrySchemas,type))throw new CliError('UNSUPPORTED_OPERATION','项目表单类型未接入。',2);
  return {scope:{},type,fields:{...base,...projectEntrySchemas[type]},version:'新增不传版本；修改须提供当前正整数版本',semantics:'指定字段保存，未提供字段由服务器保留；不执行正式下单或发送'};
 }
 async save(type:string,file:string,rawVersion:string,token:string){
  const schema=this.schema(type).fields;
  if(!/^(0|[1-9]\d*)$/.test(rawVersion)||!Number.isSafeInteger(Number(rawVersion)))throw new CliError('INVALID_ARGUMENT','版本须为非负整数；新增使用0。',2);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token))throw new CliError('INVALID_ARGUMENT','操作标识须为 UUID。',2);
  const version=Number(rawVersion),config=await this.store.config(),session=await this.store.session(config);
  if(!session)throw new CliError('AUTH_REQUIRED','请先运行 doon login。',4);
  const api=new ApiClient(config,this.transport,30000);
  const outputKeys=[...fields('id kind version projectId customerId roundId independentEntry createdAt createdBy updatedAt updatedBy'),...Object.keys(projectEntrySchemas[type]),...(type==='attachment'?fields('category contentType size hash'):[])].filter(key=>key!=='changeReason');
  const project=(row:Record<string,unknown>)=>Object.fromEntries(outputKeys.filter(key=>Object.hasOwn(row,key)).map(key=>[key,row[key]]));
  return executeWrite({schema,tokenField:'token',
   validate(input){
    if(!!input.id!==(version>0))throw new CliError('INVALID_INPUT','修改须同时提供id与当前版本；新增不提供id和已有版本。',2);
    const untrimmed=(value:unknown):boolean=>typeof value==='string'?value!==value.trim():Array.isArray(value)?value.some(untrimmed):!!value&&typeof value==='object'?Object.values(value).some(untrimmed):false;
    if(untrimmed(input))throw new CliError('INVALID_INPUT','字段不能含首尾空格。',2);
    if(type==='attachment'&&!input.id)throw new CliError('INVALID_INPUT','附件须先上传原件，此表单只修改已有附件资料。',2);
    input.entryType=type;if(version)input.version=version;
   },
   async send(input){const data=(await api.request('/api/workspace/customer-project-entry-save',session,input)).data;
    if(data?.ok!==true||!data.item?.id||data.item.kind!==kinds[type]||data.item.projectId!==input.projectId||!data.item.customerId||(input.id&&data.item.id!==input.id))throw new CliError('INVALID_RESPONSE','保存结果无法核对，请查询原操作。',5,{outcomeUnknown:true});return data.item;
   },
   async readBack(result,input){
    const data=(await api.request('/api/workspace/customer-project-data',session)).data;
    const parent=data?.projects?.find((row:any)=>row.id===input.projectId),row=data?.[collections[type]]?.find((row:any)=>row.id===result.id);
    if(!parent||!row||row.customerId!==parent.customerId||row.projectId!==input.projectId||row.version!==version+1||!isDeepStrictEqual(project(row),project(result)))throw Error('scope or changed');
    for(const key of Object.keys(schema))if(Object.hasOwn(input,key)&&key!=='id'&&key!=='changeReason'){
     const expected=input[key]===''&&defaults[type]?.[key]?defaults[type][key]:input[key];
     if(!isDeepStrictEqual(row[key],expected))throw Error('field changed');
    }
    return {scope:{customerId:row.customerId},record:project(row)};
   }
  },{file,token});
 }
}
