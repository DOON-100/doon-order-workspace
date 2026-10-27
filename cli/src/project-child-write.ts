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
const hasUntrimmed=(value:unknown):boolean=>typeof value==='string'?value!==value.trim():Array.isArray(value)?value.some(hasUntrimmed):!!value&&typeof value==='object'?Object.values(value).some(hasUntrimmed):false;
export type ProjectChildAction='item-add'|'communication-add'|'round-add';
export class ProjectChildWriteService {
 constructor(private store:StateStore,private transport:typeof fetch=fetch){}
 async execute(action:ProjectChildAction,file:string,token:string){
  if(!['item-add','communication-add','round-add'].includes(action))throw new CliError('UNSUPPORTED_OPERATION','该写入尚未接入。',2);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token))throw new CliError('INVALID_ARGUMENT','操作标识须为 UUID。',2);
  const config=await this.store.config(),session=await this.store.session(config);if(!session)throw new CliError('AUTH_REQUIRED','请先运行 doon login。',4);
  const api=new ApiClient(config,this.transport,30000),item=action==='item-add',round=action==='round-add';
  return executeWrite({schema:item?itemSchema:round?roundSchema:communicationSchema,tokenField:'token',
   validate(payload){if(hasUntrimmed(payload))throw new CliError('INVALID_INPUT','字段不能含首尾空格。',2);},
   async send(payload){const data=(await api.request(item?'/api/workspace/customer-project-item-save':round?'/api/workspace/customer-project-round-save':'/api/workspace/customer-project-communication',session,payload)).data;
    if(data?.ok!==true||!data.item?.id||data.item.projectId!==payload.projectId||!data.item.customerId)throw new CliError('INVALID_RESPONSE','写入结果无法核对，请查询原操作。',5,{outcomeUnknown:true});return data.item;},
   async readBack(result,input){const data=(await api.request('/api/workspace/customer-project-data',session)).data;
    const parent=Array.isArray(data?.projects)?data.projects.find((row:any)=>row.id===input.projectId):null;
    const rows=item?data?.items:round?data?.rounds:data?.communications,row=Array.isArray(rows)?rows.find((v:any)=>v.id===result.id):null;
    const keys=item?['projectId','model','quantity','customerModel','drawing','color','lens','material','requirements']:round?['projectId','title','type','scope','parentRoundId','stage','requiredDrawingTypes','requireQuote','requiredSampleIds','sampleGateStage','sampleGateNote','dueDate','reason']:['projectId','roundId','channel','contact','occurredAt','content','nextAction','ownerId','dueDate','visibility','attachmentIds'];
    if(!parent||!row||row.projectId!==input.projectId||row.customerId!==parent.customerId||row.customerId!==result.customerId||row.version!==1||keys.some(key=>Object.hasOwn(input,key)&&!isDeepStrictEqual(row[key],input[key])))throw Error('scope or changed');
    if(!item&&!round&&input.nextAction){const tasks=Array.isArray(data?.tasks)?data.tasks:[];if(!tasks.some((task:any)=>task.communicationId===row.id&&task.projectId===row.projectId&&task.customerId===row.customerId&&task.title===input.nextAction))throw Error('task missing');}
    const record=pick(row,fields(item?'id version projectId customerId model quantity customerModel drawing color lens material requirements':round?'id version projectId customerId title type parentRoundId stage requiredDrawingTypes requireQuote requiredSampleIds sampleGateStage sampleGateNote dueDate reason status':'id version projectId customerId roundId channel contact occurredAt content nextAction ownerId dueDate visibility attachmentIds'));
    if(round)record.scope=row.scope.map((line:{itemId:string,quantity:number})=>({itemId:line.itemId,quantity:line.quantity}));
    return {scope:{teamId:null,customerId:row.customerId},record};
   }
  },{file,token});
 }
}
