import {ApiClient} from './client.js';
import {CliError} from './errors.js';
import {StateStore} from './state.js';
import {executeWrite} from './write-operation.js';
import {type WriteSchema} from './write-input.js';
import {fields, pick} from './business.js';
import {isDeepStrictEqual} from 'node:util';

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
export class ProjectDevelopmentService {
 constructor(private store:StateStore,private transport:typeof fetch=fetch){}
 async show(customerId:string,projectId:string){
  if(!customerId||!projectId||customerId!==customerId.trim()||projectId!==projectId.trim())throw new CliError('INVALID_ARGUMENT','请提供明确客户和项目编号。',2);
  const config=await this.store.config(),session=await this.store.session(config);if(!session)throw new CliError('AUTH_REQUIRED','请先运行 doon login。',4);
  const data=(await new ApiClient(config,this.transport,30000).request('/api/workspace/customer-workflow-project',session,undefined,{query:{customerId,projectId}})).data;
  if(!data||!Array.isArray(data.logs)||data.project&&(!data.project.id||data.project.customerId!==customerId||data.project.projectId!==projectId))throw new CliError('INVALID_RESPONSE','项目开发资料响应不符合协议。',5);
  return {scope:{customerId,projectId},project:data.project?pick(data.project,fields('id version customerId projectId stage next notes updatedAt updatedBy')):null,version:data.project?.version||0,logs:data.logs.map((row:any)=>pick(row,fields('id stage result next createdAt createdBy'))),canWrite:!!data.canWrite};
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
