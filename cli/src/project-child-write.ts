import {ApiClient} from './client.js';
import {CliError} from './errors.js';
import {StateStore} from './state.js';
import {executeWrite} from './write-operation.js';
import {type WriteSchema} from './write-input.js';
import {fields, pick} from './business.js';
import {isDeepStrictEqual} from 'node:util';
import {open} from 'node:fs/promises';
import {basename,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {readWriteInput} from './write-input.js';

const itemSchema:WriteSchema={projectId:{type:'string',required:true,min:1,max:160},model:{type:'string',required:true,min:1,max:160},quantity:{type:'number',required:true,integer:true,min:1,max:10000000},customerModel:{type:'string',max:160},drawing:{type:'string',max:160},color:{type:'string',max:160},lens:{type:'string',max:160},material:{type:'string',max:160},requirements:{type:'string',max:6000}};
const communicationSchema:WriteSchema={projectId:{type:'string',required:true,min:1,max:160},roundId:{type:'string',max:160},channel:{type:'string',max:120},contact:{type:'string',max:240},occurredAt:{type:'string',required:true,min:10,max:10},content:{type:'string',required:true,min:1,max:10000},nextAction:{type:'string',max:2000},ownerId:{type:'string',max:160},dueDate:{type:'string',max:10},visibility:{type:'string',enum:['internal','customer']},attachmentIds:{type:'array',max:300,items:{type:'string',min:1,max:160}}};
const roundSchema:WriteSchema={projectId:{type:'string',required:true,min:1,max:160},title:{type:'string',required:true,min:1,max:160},type:{type:'string',required:true,enum:['development','revision','sales_sample','preproduction','bulk']},scope:{type:'array',required:true,min:1,max:300,items:{type:'object',properties:{itemId:{type:'string',required:true,min:1,max:160},quantity:{type:'number',required:true,integer:true,min:1,max:10000000}}}},parentRoundId:{type:'string',max:160},stage:{type:'string',max:160},requiredDrawingTypes:{type:'array',max:2,items:{type:'string',enum:['2d','3d']}},requireQuote:{type:'boolean'},requiredSampleIds:{type:'array',max:300,items:{type:'string',min:1,max:160}},sampleGateStage:{type:'string',enum:['order','before_production','not_required']},sampleGateNote:{type:'string',max:2000},dueDate:{type:'string',max:10},reason:{type:'string',max:3000}};
const itemUpdate:WriteSchema={...Object.fromEntries(Object.entries(itemSchema).map(([key,field])=>[key,{...field,required:true}])),id:{type:'string',required:true,min:1,max:160}};
const roundUpdate:WriteSchema={...Object.fromEntries(Object.entries(roundSchema).map(([key,field])=>[key,{...field,required:true}])),id:{type:'string',required:true,min:1,max:160},status:{type:'string',required:true,enum:['open','cancelled']}};
const hasUntrimmed=(value:unknown):boolean=>typeof value==='string'?value!==value.trim():Array.isArray(value)?value.some(hasUntrimmed):!!value&&typeof value==='object'?Object.values(value).some(hasUntrimmed):false;
export type ProjectChildAction='item-add'|'item-update'|'communication-add'|'round-add'|'round-update';
export class ProjectChildWriteService {
 constructor(private store:StateStore,private transport:typeof fetch=fetch){}
 async execute(action:ProjectChildAction,file:string,token:string,rawVersion=''){
  if(!['item-add','item-update','communication-add','round-add','round-update'].includes(action))throw new CliError('UNSUPPORTED_OPERATION','该写入尚未接入。',2);
  const updating=action==='item-update'||action==='round-update';if(updating&&(!/^[1-9]\d*$/.test(rawVersion)||!Number.isSafeInteger(Number(rawVersion))))throw new CliError('INVALID_ARGUMENT','版本须为正整数。',2);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token))throw new CliError('INVALID_ARGUMENT','操作标识须为 UUID。',2);
  const config=await this.store.config(),session=await this.store.session(config);if(!session)throw new CliError('AUTH_REQUIRED','请先运行 doon login。',4);
  const api=new ApiClient(config,this.transport,30000),item=action==='item-add'||action==='item-update',round=action==='round-add'||action==='round-update',version=Number(rawVersion);
  return executeWrite({schema:item?(updating?itemUpdate:itemSchema):round?(updating?roundUpdate:roundSchema):communicationSchema,tokenField:'token',...(updating?{versionField:'version'}:{}),
   validate(payload){if(hasUntrimmed(payload))throw new CliError('INVALID_INPUT','字段不能含首尾空格。',2);},
   async send(payload){const data=(await api.request(item?'/api/workspace/customer-project-item-save':round?'/api/workspace/customer-project-round-save':'/api/workspace/customer-project-communication',session,payload)).data;
    if(data?.ok!==true||!data.item?.id||data.item.projectId!==payload.projectId||!data.item.customerId||(updating&&data.item.id!==payload.id))throw new CliError('INVALID_RESPONSE','写入结果无法核对，请查询原操作。',5,{outcomeUnknown:true});return data.item;},
   async readBack(result,input){const data=(await api.request('/api/workspace/customer-project-data',session)).data;
    const parent=Array.isArray(data?.projects)?data.projects.find((row:any)=>row.id===input.projectId):null;
    const rows=item?data?.items:round?data?.rounds:data?.communications,row=Array.isArray(rows)?rows.find((v:any)=>v.id===result.id):null;
    const keys=item?['projectId','model','quantity','customerModel','drawing','color','lens','material','requirements']:round?['projectId','title','type','scope','parentRoundId','stage','requiredDrawingTypes','requireQuote','requiredSampleIds','sampleGateStage','sampleGateNote','dueDate','reason','status']:['projectId','roundId','channel','contact','occurredAt','content','nextAction','ownerId','dueDate','visibility','attachmentIds'];
    if(!parent||!row||row.projectId!==input.projectId||row.customerId!==parent.customerId||row.customerId!==result.customerId||row.version!==(updating?version+1:1)||keys.some(key=>Object.hasOwn(input,key)&&!isDeepStrictEqual(row[key],input[key])))throw Error('scope or changed');
    if(!item&&!round&&input.nextAction){const tasks=Array.isArray(data?.tasks)?data.tasks:[];if(!tasks.some((task:any)=>task.communicationId===row.id&&task.projectId===row.projectId&&task.customerId===row.customerId&&task.title===input.nextAction))throw Error('task missing');}
    const record=pick(row,fields(item?'id version projectId customerId model quantity customerModel drawing color lens material requirements':round?'id version projectId customerId title type parentRoundId stage requiredDrawingTypes requireQuote requiredSampleIds sampleGateStage sampleGateNote dueDate reason status':'id version projectId customerId roundId channel contact occurredAt content nextAction ownerId dueDate visibility attachmentIds'));
    if(round)record.scope=row.scope.map((line:{itemId:string,quantity:number})=>({itemId:line.itemId,quantity:line.quantity}));
    return {scope:{teamId:null,customerId:row.customerId},record};
   }
  },{file,token,...(updating?{version}:{})});
 }
}

const taskCreate:WriteSchema={projectId:{type:'string',required:true,min:1,max:160},title:{type:'string',required:true,min:1,max:160},ownerId:{type:'string',required:true,min:1,max:160},roundId:{type:'string',max:160},description:{type:'string',max:6000},serviceReviewerId:{type:'string',max:160},salesReviewerId:{type:'string',max:160},waitingFor:{type:'string',max:240},dueDate:{type:'string',max:10}};
const taskUpdate:WriteSchema={...Object.fromEntries(Object.entries(taskCreate).map(([key,field])=>[key,{...field,required:true}])),id:{type:'string',required:true,min:1,max:160},status:{type:'string',required:true,enum:['open','cancelled']},changeReason:{type:'string',max:3000}};
const taskSubmit:WriteSchema={projectId:{type:'string',required:true,min:1,max:160},id:{type:'string',required:true,min:1,max:160},result:{type:'string',required:true,min:1,max:3000}};
const taskReview:WriteSchema={projectId:{type:'string',required:true,min:1,max:160},id:{type:'string',required:true,min:1,max:160},stage:{type:'string',required:true,enum:['service','sales']},decision:{type:'string',required:true,enum:['approve','return']},comment:{type:'string',max:3000}};
export type ProjectTaskAction='create'|'update'|'submit'|'review';
export class ProjectTaskWriteService {
 constructor(private store:StateStore,private transport:typeof fetch=fetch){}
 async execute(action:ProjectTaskAction,file:string,rawVersion:string,token:string){
  if(!['create','update','submit','review'].includes(action))throw new CliError('UNSUPPORTED_OPERATION','该写入尚未接入。',2);
  if(action!=='create'&&(!/^[1-9]\d*$/.test(rawVersion)||!Number.isSafeInteger(Number(rawVersion))))throw new CliError('INVALID_ARGUMENT','版本须为正整数。',2);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token))throw new CliError('INVALID_ARGUMENT','操作标识须为 UUID。',2);
  const config=await this.store.config(),session=await this.store.session(config);if(!session)throw new CliError('AUTH_REQUIRED','请先运行 doon login。',4);
  const api=new ApiClient(config,this.transport,30000),version=Number(rawVersion),route=action==='create'||action==='update'?'/api/workspace/customer-project-task-save':action==='submit'?'/api/workspace/customer-project-task-submit':'/api/workspace/customer-project-task-review';
  return executeWrite({schema:action==='create'?taskCreate:action==='update'?taskUpdate:action==='submit'?taskSubmit:taskReview,tokenField:'token',...(action==='create'?{}:{versionField:'version'}),
   validate(payload){if(hasUntrimmed(payload))throw new CliError('INVALID_INPUT','字段不能含首尾空格。',2);},
   async send(payload){const data=(await api.request(route,session,payload)).data;if(data?.ok!==true||!data.item?.id||data.item.projectId!==payload.projectId||!data.item.customerId||(action!=='create'&&data.item.id!==payload.id))throw new CliError('INVALID_RESPONSE','写入结果无法核对，请查询原操作。',5,{outcomeUnknown:true});return data.item;},
   async readBack(result,input){const data=(await api.request('/api/workspace/customer-project-data',session)).data,parent=Array.isArray(data?.projects)?data.projects.find((r:any)=>r.id===input.projectId):null,row=Array.isArray(data?.tasks)?data.tasks.find((r:any)=>r.id===result.id):null;
    const expected=action==='create'?'open':action==='update'?input.status:action==='submit'?'service_review':input.decision==='return'?'returned':input.stage==='service'?'sales_review':'done';
    const keys=action==='create'||action==='update'?['projectId','title','ownerId','roundId','description','serviceReviewerId','salesReviewerId','waitingFor','dueDate']:action==='submit'?['projectId','result']:['projectId'];
    if(!parent||!row||row.projectId!==input.projectId||row.customerId!==parent.customerId||row.customerId!==result.customerId||row.version!==(action==='create'?1:version+1)||row.status!==expected||keys.some(key=>Object.hasOwn(input,key)&&!isDeepStrictEqual(row[key],input[key])))throw Error('scope or changed');
    if(action==='review'){const event=Array.isArray(row.reviewHistory)?row.reviewHistory.at(-1):null;if(!event||event.action!==input.decision||event.stage!==input.stage||event.comment!==(input.comment||''))throw Error('review changed');}
    return {scope:{teamId:null,customerId:row.customerId},record:pick(row,fields('id version projectId customerId roundId title description ownerId serviceReviewerId salesReviewerId waitingFor dueDate status result reviewCycle canSubmit canReviewService canReviewSales'))};
   }
  },{file,...(action==='create'?{}:{version}),token});
 }
}

export class ProjectRecycleService {
 constructor(private store:StateStore,private transport:typeof fetch=fetch){}
 async execute(action:'trash'|'restore',file:string,rawVersion:string,token:string){
  if(!['trash','restore'].includes(action))throw new CliError('UNSUPPORTED_OPERATION','该写入尚未接入。',2);
  if(!/^[1-9]\d*$/.test(rawVersion)||!Number.isSafeInteger(Number(rawVersion)))throw new CliError('INVALID_ARGUMENT','版本须为正整数。',2);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token))throw new CliError('INVALID_ARGUMENT','操作标识须为 UUID。',2);
  const version=Number(rawVersion),config=await this.store.config(),session=await this.store.session(config);if(!session)throw new CliError('AUTH_REQUIRED','请先运行 doon login。',4);
  const api=new ApiClient(config,this.transport,30000),schema:WriteSchema={id:{type:'string',required:true,min:1,max:160},...(action==='trash'?{reason:{type:'string',required:true,min:1,max:2000} as const}:{})};
  return executeWrite({schema,versionField:'version',tokenField:'token',
   validate(payload){if(hasUntrimmed(payload))throw new CliError('INVALID_INPUT','字段不能含首尾空格。',2);},
   async send(payload){const data=(await api.request(action==='trash'?'/api/workspace/customer-project-trash':'/api/workspace/customer-project-restore',session,payload)).data;if(data?.ok!==true||data.item?.id!==payload.id||!data.item.customerId)throw new CliError('INVALID_RESPONSE','写入结果无法核对，请查询原操作。',5,{outcomeUnknown:true});return data.item;},
   async readBack(result,input){const data=(await api.request('/api/workspace/customer-project-data',session)).data,rows=action==='trash'?data?.trashedProjects:data?.projects,row=Array.isArray(rows)?rows.find((v:any)=>v.id===input.id):null;if(!row||row.version!==version+1||row.customerId!==result.customerId||(action==='trash'&&(!row.trashedAt||row.trashReason!==input.reason))||(action==='restore'&&row.trashedAt))throw Error('scope or changed');return {scope:{customerId:row.customerId},record:pick(row,fields('id version customerId title status trashedAt trashedBy trashReason'))};}
  },{file,version,token});
 }
}

const developmentStage=['待核实','需求了解','可行性','报价','打样','样品反馈','商务确认','暂缓','关闭'] as const;
const developmentBase:WriteSchema={customerId:{type:'string',required:true,min:1,max:160},projectId:{type:'string',required:true,min:1,max:160},stage:{type:'string',required:true,enum:developmentStage},next:{type:'string',required:true,max:300}};
const developmentSave:WriteSchema={...developmentBase,notes:{type:'string',required:true,max:12000},reason:{type:'string',required:true,min:1,max:3000}};
const developmentLog:WriteSchema={...developmentBase,result:{type:'string',required:true,min:1,max:12000}};
const developmentDocument:WriteSchema={customerId:{type:'string',required:true,min:1,max:160},projectId:{type:'string',required:true,min:1,max:160},content:{type:'string',required:true,max:20000},reason:{type:'string',required:true,min:1,max:3000}};
export class ProjectDevelopmentService {
 constructor(private store:StateStore,private transport:typeof fetch=fetch){}
 async show(customerId:string,projectId:string){
  if(!customerId||!projectId||customerId!==customerId.trim()||projectId!==projectId.trim())throw new CliError('INVALID_ARGUMENT','请提供明确客户和项目编号。',2);
  const config=await this.store.config(),session=await this.store.session(config);if(!session)throw new CliError('AUTH_REQUIRED','请先运行 doon login。',4);
  const data=(await new ApiClient(config,this.transport,30000).request('/api/workspace/customer-workflow-project',session,undefined,{query:{customerId,projectId}})).data;
  if(!data||!Array.isArray(data.logs)||data.project&&(!data.project.id||data.project.customerId!==customerId||data.project.projectId!==projectId))throw new CliError('INVALID_RESPONSE','项目开发资料响应不符合协议。',5);
  return {scope:{customerId,projectId},project:data.project?pick(data.project,fields('id version customerId projectId stage next notes updatedAt updatedBy')):null,version:data.project?.version||0,logs:data.logs.map((row:any)=>pick(row,fields('id stage result next createdAt createdBy'))),canWrite:!!data.canWrite};
 }
 async documentShow(customerId:string,projectId:string){
  if(!customerId||!projectId||customerId!==customerId.trim()||projectId!==projectId.trim())throw new CliError('INVALID_ARGUMENT','请提供明确客户和项目编号。',2);
  const config=await this.store.config(),session=await this.store.session(config);if(!session)throw new CliError('AUTH_REQUIRED','请先运行 doon login。',4);
  const data=(await new ApiClient(config,this.transport,30000).request('/api/workspace/customer-workflow-project-document',session,undefined,{query:{customerId,projectId}})).data;
  if(!data||!Array.isArray(data.revisions)||data.document&&(data.document.customerId!==customerId||data.document.projectId!==projectId))throw new CliError('INVALID_RESPONSE','项目文档响应不符合协议。',5);
  return {scope:{customerId,projectId},document:data.document?pick(data.document,fields('id version customerId projectId content updatedAt updatedBy')):null,version:data.document?.version||0,revisions:data.revisions.map((row:any)=>pick(row,fields('id version content reason createdAt createdBy'))),canWrite:!!data.canWrite};
 }
 async documentSave(file:string,rawVersion:string,token:string){
  if(!/^(0|[1-9]\d*)$/.test(rawVersion)||!Number.isSafeInteger(Number(rawVersion)))throw new CliError('INVALID_ARGUMENT','版本须为非负整数。',2);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token))throw new CliError('INVALID_ARGUMENT','操作标识须为 UUID。',2);
  const version=Number(rawVersion),config=await this.store.config(),session=await this.store.session(config);if(!session)throw new CliError('AUTH_REQUIRED','请先运行 doon login。',4);
  const api=new ApiClient(config,this.transport,30000);
  return executeWrite({schema:developmentDocument,versionField:'version',versionMin:0,tokenField:'token',
   validate(payload){if(['customerId','projectId','reason'].some(key=>String(payload[key])!==String(payload[key]).trim()))throw new CliError('INVALID_INPUT','编号和原因不能含首尾空格。',2);},
   async send(payload){const data=(await api.request('/api/workspace/customer-workflow-project-document-save',session,payload)).data;if(data?.ok!==true||data.customerId!==payload.customerId)throw new CliError('INVALID_RESPONSE','写入结果无法核对，请查询原操作。',5,{outcomeUnknown:true});return data;},
   async readBack(_result,input){const data=(await api.request('/api/workspace/customer-workflow-project-document',session,undefined,{query:{customerId:String(input.customerId),projectId:String(input.projectId)}})).data,row=data?.document;if(!row||row.customerId!==input.customerId||row.projectId!==input.projectId||row.version!==version+1||row.content!==input.content||!Array.isArray(data.revisions)||!data.revisions.some((r:any)=>r.version===row.version&&r.content===input.content&&r.reason===input.reason))throw Error('changed');return {scope:{customerId:row.customerId,projectId:row.projectId},record:pick(row,fields('id version customerId projectId content updatedAt updatedBy'))};}
  },{file,version,token});
 }
 async execute(action:'save'|'log',file:string,rawVersion:string,token:string){
  if(!['save','log'].includes(action))throw new CliError('UNSUPPORTED_OPERATION','该写入尚未接入。',2);
  if(!/^(0|[1-9]\d*)$/.test(rawVersion)||!Number.isSafeInteger(Number(rawVersion)))throw new CliError('INVALID_ARGUMENT','版本须为非负整数。',2);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token))throw new CliError('INVALID_ARGUMENT','操作标识须为 UUID。',2);
  const version=Number(rawVersion),config=await this.store.config(),session=await this.store.session(config);if(!session)throw new CliError('AUTH_REQUIRED','请先运行 doon login。',4);
  const api=new ApiClient(config,this.transport,30000);
  return executeWrite({schema:action==='save'?developmentSave:developmentLog,versionField:'version',versionMin:0,tokenField:'token',
   validate(payload){if(['customerId','projectId','stage','next','reason','result'].some(key=>typeof payload[key]==='string'&&payload[key]!==String(payload[key]).trim()))throw new CliError('INVALID_INPUT','编号及指定字段不能含首尾空格。',2);},
   async send(payload){const data=(await api.request(action==='save'?'/api/workspace/customer-workflow-project-save':'/api/workspace/customer-workflow-project-log',session,payload)).data;if(data?.ok!==true||data.customerId!==payload.customerId)throw new CliError('INVALID_RESPONSE','写入结果无法核对，请查询原操作。',5,{outcomeUnknown:true});return data;},
   async readBack(_result,input){const data=(await api.request('/api/workspace/customer-workflow-project',session,undefined,{query:{customerId:String(input.customerId),projectId:String(input.projectId)}})).data,row=data?.project;if(!row||row.customerId!==input.customerId||row.projectId!==input.projectId||row.version!==version+1||row.stage!==input.stage||row.next!==input.next||(action==='save'&&row.notes!==input.notes))throw Error('changed');if(action==='log'&&(!Array.isArray(data.logs)||!data.logs.some((v:any)=>v.stage===input.stage&&v.next===input.next&&v.result===input.result)))throw Error('log missing');return {scope:{customerId:row.customerId,projectId:row.projectId},record:pick(row,fields('id version customerId projectId stage next notes updatedAt updatedBy'))};}
  },{file,version,token});
 }
}

const attachmentMeta:WriteSchema={customerId:{type:'string',required:true,min:1,max:160},projectId:{type:'string',max:160},category:{type:'string',enum:['NDA 原件','长期合作协议','公司资料','银行资料证明','固定地址资料','其他客户通用正式附件']},folder:{type:'string',max:160},documentType:{type:'string',max:160},title:{type:'string',required:true,min:1,max:240},fileVersion:{type:'string',required:true,min:1,max:80},status:{type:'string',enum:['待确认','有效']},note:{type:'string',max:3000}};
const attachmentFields=fields('id version customerId projectId category folder documentType title fileVersion status note filename contentType size hash createdAt createdBy updatedAt updatedBy archivedAt archivedBy archiveReason');
export class CustomerAttachmentService {
 constructor(private store:StateStore,private transport:typeof fetch=fetch){}
 private async client(){const config=await this.store.config(),session=await this.store.session(config);if(!session)throw new CliError('AUTH_REQUIRED','请先运行 doon login。',4);return {api:new ApiClient(config,this.transport,30000),session};}
 async list(customerId:string,projectId=''){
  if(!customerId||customerId!==customerId.trim()||projectId!==projectId.trim())throw new CliError('INVALID_ARGUMENT','请提供明确客户和项目编号。',2);
  const {api,session}=await this.client(),data=(await api.request('/api/workspace/customer-workflow-files',session,undefined,{query:{customerId,projectId}})).data;if(!Array.isArray(data?.files))throw new CliError('INVALID_RESPONSE','附件列表响应不符合协议。',5);
  if(data.files.some((row:any)=>row.customerId!==customerId||(row.projectId||'')!==projectId))throw new CliError('INVALID_RESPONSE','附件范围不匹配。',5);
  return {scope:{customerId,projectId:projectId||null},files:data.files.map((row:any)=>pick(row,attachmentFields)),canWrite:!!data.canWrite};
 }
 async upload(inputFile:string,filePath:string,token:string){
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token))throw new CliError('INVALID_ARGUMENT','操作标识须为 UUID。',2);
  const input=await readWriteInput(inputFile,attachmentMeta);if(['customerId','projectId','category','folder','documentType','title','fileVersion'].some(key=>typeof input[key]==='string'&&input[key]!==String(input[key]).trim()))throw new CliError('INVALID_INPUT','附件编号和名称不能含首尾空格。',2);
  const handle=await open(filePath,'r').catch(()=>{throw new CliError('INVALID_INPUT','无法读取附件。',2);});let bytes:Buffer;try{const info=await handle.stat(),limit=20*1024*1024;if(!info.isFile()||info.size<1||info.size>limit)throw new CliError('INVALID_INPUT','附件须为不超过 20 MiB 的非空普通文件。',2);const buffer=Buffer.alloc(limit+1);let size=0;while(size<buffer.length){const read=await handle.read(buffer,size,buffer.length-size,null);if(!read.bytesRead)break;size+=read.bytesRead;}if(size>limit||size!==info.size)throw new CliError('INVALID_INPUT','附件大小发生变化。',2);bytes=buffer.subarray(0,size);}finally{await handle.close();}
  const filename=basename(filePath),hash=createHash('sha256').update(bytes).digest('hex'),form=new FormData();for(const [key,value] of Object.entries(input))form.set(key,String(value));form.set('token',token);form.set('file',new File([Uint8Array.from(bytes)],filename));
  const {api,session}=await this.client(),data=(await api.request('/api/workspace/customer-workflow-file-upload',session,form)).data;if(data?.ok!==true||data.customerId!==input.customerId)throw new CliError('INVALID_RESPONSE','上传结果无法核对，请查询原操作。',5,{outcomeUnknown:true});
  try{const list=await this.list(String(input.customerId),String(input.projectId||'')),found=list.files.filter((row:any)=>row.hash===hash&&row.title===input.title&&row.fileVersion===input.fileVersion&&row.size===bytes.length);if(found.length!==1)throw Error('ambiguous');return {scope:list.scope,record:found[0]};}catch{throw new CliError('READBACK_FAILED','上传已响应但回读未完成；请查询原操作，不要重复提交。',5,{outcomeUnknown:true});}
 }
 async download(customerId:string,projectId:string,id:string,output:string){
  const list=await this.list(customerId,projectId),row=list.files.find((r:any)=>r.id===id);if(!row)throw new CliError('NOT_IN_SCOPE','附件不在当前授权范围。',7);
  const {api,session}=await this.client(),bytes=(await api.request('/api/workspace/customer-workflow-file',session,undefined,{query:{id}})).data as Buffer;
  if(bytes.length!==row.size||createHash('sha256').update(bytes).digest('hex')!==row.hash)throw new CliError('INVALID_RESPONSE','附件完整性校验失败。',5);
  const target=resolve(output);let file;try{file=await open(target,'wx',0o600);await file.writeFile(bytes);}catch(error){throw new CliError((error as NodeJS.ErrnoException).code==='EEXIST'?'OUTPUT_EXISTS':'OUTPUT_WRITE_FAILED','无法写入新文件，请核对路径；不会覆盖已有文件。',3);}finally{await file?.close();}
  return {scope:list.scope,file:{path:target,bytes:bytes.length,sha256:row.hash}};
 }
 async update(file:string,rawVersion:string,token:string){
  if(!/^[1-9]\d*$/.test(rawVersion)||!Number.isSafeInteger(Number(rawVersion)))throw new CliError('INVALID_ARGUMENT','版本须为正整数。',2);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token))throw new CliError('INVALID_ARGUMENT','操作标识须为 UUID。',2);
  const schema:WriteSchema={...attachmentMeta,id:{type:'string',required:true,min:1,max:160},projectId:{type:'string',required:true,max:160},documentType:{type:'string',required:true,max:160},note:{type:'string',required:true,max:3000},status:{type:'string',required:true,enum:['待确认','有效','已归档']},reason:{type:'string',required:true,min:1,max:3000}};
  const version=Number(rawVersion),{api,session}=await this.client();
  return executeWrite({schema,versionField:'version',tokenField:'token',
   validate(input){if(['id','customerId','projectId','category','folder','documentType','title','fileVersion','reason'].some(key=>typeof input[key]==='string'&&input[key]!==String(input[key]).trim()))throw new CliError('INVALID_INPUT','附件编号、名称和原因不能含首尾空格。',2);},
   async send(input){const data=(await api.request('/api/workspace/customer-workflow-file-save',session,input)).data;if(data?.ok!==true||data.customerId!==input.customerId)throw new CliError('INVALID_RESPONSE','写入结果无法核对，请查询原操作。',5,{outcomeUnknown:true});return data;},
   readBack:async(_result,input)=>{const list=await this.list(String(input.customerId),String(input.projectId)),row=list.files.find((v:any)=>v.id===input.id);if(!row||row.version!==version+1||['title','fileVersion','status','note','category','folder','documentType'].some(key=>Object.hasOwn(input,key)&&!isDeepStrictEqual(row[key],input[key])))throw Error('changed');return {scope:list.scope,record:row};}
  },{file,version,token});
 }
}

export const customerTransferActions=['primary','handoff','accept','cancel-handoff','pool-request','pool-approve','pool-reject','pool-withdraw','claim','claim-approve'] as const;
export type CustomerTransferAction=typeof customerTransferActions[number];
const transferReason={type:'string',required:true,min:1,max:3000} as const;
export class CustomerTransferService {
 constructor(private store:StateStore,private transport:typeof fetch=fetch){}
 private async client(){const config=await this.store.config(),session=await this.store.session(config);if(!session)throw new CliError('AUTH_REQUIRED','请先运行 doon login。',4);return {api:new ApiClient(config,this.transport,30000),session};}
 async list(){const {api,session}=await this.client(),data=(await api.request('/api/workspace/customer-workflow-transfers',session)).data;for(const key of ['pool','handoffs','poolRequests','claims','customers','sales'])if(!Array.isArray(data?.[key]))throw new CliError('INVALID_RESPONSE','客户流转响应不符合协议。',5);
  const requestFields=fields('id version customerId from to status reason basis next nextDate actorId actor note processedBy processedAt createdAt');
  return {pool:data.pool.map((v:any)=>pick(v,fields('id customer customerCode country grade version customerVersion poolAt primarySalesMemberId'))),customers:data.customers.map((v:any)=>pick(v,fields('id customer customerCode version customerVersion poolAt primarySalesMemberId'))),handoffs:data.handoffs.map((v:any)=>pick(v,requestFields)),poolRequests:data.poolRequests.map((v:any)=>pick(v,requestFields)),claims:data.claims.map((v:any)=>pick(v,requestFields)),sales:data.sales.map((v:any)=>pick(v,fields('id name'))),canApprove:!!data.canApprove};
 }
 async execute(action:CustomerTransferAction,file:string,rawVersion:string,token:string){
  if(!customerTransferActions.includes(action))throw new CliError('UNSUPPORTED_OPERATION','客户流转动作未接入。',2);
  if(!/^(0|[1-9]\d*)$/.test(rawVersion)||!Number.isSafeInteger(Number(rawVersion)))throw new CliError('INVALID_ARGUMENT','状态版本须为非负整数。',2);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token))throw new CliError('INVALID_ARGUMENT','操作标识须为 UUID。',2);
  const base:WriteSchema={customerId:{type:'string',required:true,min:1,max:160},customerVersion:{type:'number',required:true,integer:true,min:0}},extra:WriteSchema=['primary','handoff'].includes(action)?{to:{type:'string',required:true,min:1,max:160},reason:transferReason}:action==='pool-request'?{reason:{type:'string',required:true,enum:['两年未下单','多轮跟进未成功']},basis:transferReason}:action==='claim'?{next:{type:'string',required:true,min:1,max:300},nextDate:{type:'string',required:true,min:10,max:10},reason:transferReason}:{id:{type:'string',required:true,min:1,max:160},requestVersion:{type:'number',required:true,integer:true,min:0},note:transferReason};
  const version=Number(rawVersion),{api,session}=await this.client();
  const route=transferRoutes[action];
  return executeWrite({schema:{...base,...extra},versionField:'version',versionMin:0,tokenField:'token',
   validate(input){if(hasUntrimmed(input))throw new CliError('INVALID_INPUT','流转字段不能含首尾空格。',2);},
   async send(input){const data=(await api.request(route,session,input)).data;if(data?.ok!==true||data.customerId!==input.customerId)throw new CliError('INVALID_RESPONSE','写入结果无法核对，请查询原操作。',5,{outcomeUnknown:true});return data;},
   readBack:async(_response,input)=>{const data=await this.list(),customer=data.customers.find((v:any)=>v.id===input.customerId);if(!customer||customer.version!==version+1)throw Error('state changed');let record:any;
    if(action==='primary'){if(customer.primarySalesMemberId!==input.to)throw Error('primary changed');record=customer;}
    else if(['handoff','pool-request','claim'].includes(action)){const rows=action==='handoff'?data.handoffs:action==='pool-request'?data.poolRequests:data.claims;const matches=rows.filter((v:any)=>v.customerId===input.customerId&&v.status==='pending'&&(action==='handoff'?v.to===input.to&&v.reason===input.reason:action==='pool-request'?v.reason===input.reason&&v.basis===input.basis:v.reason===input.reason&&v.next===input.next&&v.nextDate===input.nextDate));if(matches.length!==1)throw Error('request ambiguous');record=matches[0];}
    else {const rows=['accept','cancel-handoff'].includes(action)?data.handoffs:action==='claim-approve'?data.claims:data.poolRequests;record=rows.find((v:any)=>v.id===input.id&&v.customerId===input.customerId);const expected=action==='accept'?'accepted':action==='cancel-handoff'?'cancelled':action==='pool-withdraw'?'withdrawn':action==='pool-reject'?'rejected':'approved';if(!record||record.version!==Number(input.requestVersion)+1||record.status!==expected)throw Error('request changed');if(action==='pool-approve'&&!data.pool.some((v:any)=>v.id===input.customerId))throw Error('pool missing');}
    return {scope:{customerId:input.customerId},customer,record};}
  },{file,version,token});
 }
}
const transferRoutes={primary:'/api/workspace/customer-workflow-primary',handoff:'/api/workspace/customer-workflow-handoff',accept:'/api/workspace/customer-workflow-accept','cancel-handoff':'/api/workspace/customer-workflow-cancel-handoff','pool-request':'/api/workspace/customer-workflow-pool-request','pool-approve':'/api/workspace/customer-workflow-pool-approve','pool-reject':'/api/workspace/customer-workflow-pool-reject','pool-withdraw':'/api/workspace/customer-workflow-pool-withdraw',claim:'/api/workspace/customer-workflow-claim','claim-approve':'/api/workspace/customer-workflow-claim-approve'} as const;

const customerTaskSchema:WriteSchema={id:{type:'string',min:1,max:160},customerId:{type:'string',required:true,max:160},title:{type:'string',required:true,min:1,max:300},ownerId:{type:'string',required:true,min:1,max:160},due:{type:'string',required:true,max:10},status:{type:'string',required:true,enum:['待接手','进行中','受阻','完成','取消']},result:{type:'string',required:true,max:12000},notes:{type:'string',required:true,max:12000}};
const customerTaskFields=fields('id version customerId title ownerId owner due status result notes createdAt createdBy updatedAt updatedBy canEdit');
export class CustomerTaskService {
 constructor(private store:StateStore,private transport:typeof fetch=fetch){}
 private async client(){const config=await this.store.config(),session=await this.store.session(config);if(!session)throw new CliError('AUTH_REQUIRED','请先运行 doon login。',4);return {api:new ApiClient(config,this.transport,30000),session};}
 async list(customerId=''){const {api,session}=await this.client(),data=(await api.request('/api/workspace/customer-workflow-tasks',session,undefined,{query:customerId?{customerId}:{}})).data;if(!Array.isArray(data?.tasks)||!Array.isArray(data.ownerCandidates)||!Array.isArray(data.customers))throw new CliError('INVALID_RESPONSE','客户任务响应不符合协议。',5);return {tasks:data.tasks.map((r:any)=>pick(r,customerTaskFields)),customers:data.customers.map((r:any)=>pick(r,fields('id customer customerCode'))),ownerCandidates:data.ownerCandidates.map((r:any)=>pick(r,fields('id name customerIds'))),canCreate:!!data.canCreate};}
 async history(id:string){const {api,session}=await this.client(),data=(await api.request('/api/workspace/customer-workflow-task-history',session,undefined,{query:{id}})).data;if(data?.taskId!==id||!Array.isArray(data.revisions))throw new CliError('INVALID_RESPONSE','客户任务历史响应不符合协议。',5);return {taskId:id,revisions:data.revisions.map((r:any)=>({...pick(r,fields('id version customerId actor createdAt reason')),snapshot:pick(r.snapshot,customerTaskFields)}))};}
 async save(file:string,rawVersion:string,token:string){
  if(!/^(0|[1-9]\d*)$/.test(rawVersion)||!Number.isSafeInteger(Number(rawVersion)))throw new CliError('INVALID_ARGUMENT','版本须为非负整数。',2);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token))throw new CliError('INVALID_ARGUMENT','操作标识须为 UUID。',2);
  const version=Number(rawVersion),{api,session}=await this.client();
  return executeWrite({schema:customerTaskSchema,versionField:'version',versionMin:0,tokenField:'token',
   validate(input){if(['id','customerId','ownerId','title','result'].some(key=>typeof input[key]==='string'&&input[key]!==String(input[key]).trim()))throw new CliError('INVALID_INPUT','任务编号、标题和结果不能含首尾空格。',2);if(input.id&&version===0||!input.id&&version!==0)throw new CliError('INVALID_INPUT','新增使用版本0，修改须提供任务编号和当前版本。',2);},
   async send(input){const data=(await api.request('/api/workspace/customer-workflow-task-save',session,input)).data;if(data?.ok!==true||!data.item?.id||data.item.customerId!==input.customerId||input.id&&data.item.id!==input.id)throw new CliError('INVALID_RESPONSE','写入结果无法核对，请查询原操作。',5,{outcomeUnknown:true});return data.item;},
   readBack:async(item,input)=>{const data=await this.list(String(input.customerId)),row=data.tasks.find((v:any)=>v.id===item.id);if(!row||row.version!==version+1||['customerId','title','ownerId','due','status','result','notes'].some(key=>row[key]!==input[key]))throw Error('changed');return {scope:{customerId:input.customerId||null},record:row};}
  },{file,version,token});
 }
}
