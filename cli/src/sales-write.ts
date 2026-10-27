import {ApiClient} from './client.js';
import {CliError} from './errors.js';
import {StateStore} from './state.js';
import {executeWrite} from './write-operation.js';
import {type WriteField, type WriteSchema} from './write-input.js';
import {object, pick, fields} from './business.js';

// Bank and courier account data stay out of this initial CLI contract.
const names='legalName shortName website brandIntroduction backgroundResearch contactPerson contactTitle phone email whatsapp wechat contacts companyAddress billingAddress shippingAddress defaultPaymentMethod defaultTradeTerms ndaStatus packagingRequirements documentRequirements longTermNotes type source stage orderHistory firstListedOn lastOrderOn';
const profileFields=Object.fromEntries(names.split(' ').map(name=>[name,{type:'string'} as WriteField]));
const matches=(current:Record<string,unknown>,input:Record<string,unknown>,keys:string[])=>keys.every(key=>!Object.hasOwn(input,key)||JSON.stringify(current[key])===JSON.stringify(input[key]));
const profiles:WriteSchema={customerId:{type:'string',required:true,min:1,max:160},patch:{type:'object',required:true,properties:profileFields}};
const schedule:WriteSchema={customerId:{type:'string',required:true,min:1,max:160},next:{type:'string',required:true,min:1,max:300},nextDate:{type:'string',required:true,min:10,max:10}};
const projects:WriteSchema={customerId:{type:'string',required:true,min:1,max:160},title:{type:'string',required:true,min:1,max:160},code:{type:'string',max:120},description:{type:'string',max:10000},teamId:{type:'string',max:160},salesMemberId:{type:'string',max:160},serviceMemberIds:{type:'array',max:300,items:{type:'string',min:1,max:160}},dueDate:{type:'string',max:10}};
const inquiries:WriteSchema={customerId:{type:'string',required:true,min:1,max:160},title:{type:'string',required:true,min:1,max:240},orderId:{type:'string',max:160},teamId:{type:'string',max:160},notes:{type:'string',max:6000},details:{type:'object',properties:{gateReason:{type:'string',max:3000},documentRef:{type:'string',max:3000},requirement:{type:'string',max:3000},targetDelivery:{type:'string',max:3000},quantity:{type:'number',integer:true,min:0,max:10000000},currency:{type:'string',max:12},quoteRef:{type:'string',max:3000}}}};
export type CustomerWriteAction='profile-update'|'schedule-set'|'project-create'|'inquiry-create';
export class SalesWriteService {
 constructor(private store:StateStore,private transport:typeof fetch=fetch){}
 async execute(action:CustomerWriteAction,file:string,rawVersion:string,token:string){
  if(!['profile-update','schedule-set','project-create','inquiry-create'].includes(action))throw new CliError('UNSUPPORTED_OPERATION','该写入尚未接入。',2);
  if(!['project-create','inquiry-create'].includes(action)&&(!/^(0|[1-9]\d*)$/.test(rawVersion)||!Number.isSafeInteger(Number(rawVersion))))throw new CliError('INVALID_ARGUMENT','版本须为非负整数。',2);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token))throw new CliError('INVALID_ARGUMENT','操作标识须为 UUID。',2);
  const schema=action==='profile-update'?profiles:action==='schedule-set'?schedule:action==='project-create'?projects:inquiries;
  const config=await this.store.config(),session=await this.store.session(config);if(!session)throw new CliError('AUTH_REQUIRED','请先运行 doon login。',4);
  const api=new ApiClient(config,this.transport,30000),version=Number(rawVersion);
  const route=action==='profile-update'?'/api/workspace/customer-workflow-profile-save':action==='schedule-set'?'/api/workspace/customer-workflow-schedule':action==='project-create'?'/api/workspace/customer-project-save':'/api/workspace/process-save';
  return await executeWrite({schema,...(['project-create','inquiry-create'].includes(action)?{}:{versionField:'version',versionMin:0 as const}),tokenField:'token',
   validate(payload){
    if(String(payload.customerId)!==String(payload.customerId).trim())throw new CliError('INVALID_INPUT','客户编号不能含首尾空格。',2);
    if(action==='profile-update'){const patch=object(payload.patch);if(!Object.keys(patch).length)throw new CliError('INVALID_INPUT','资料更新至少需要一个字段。',2);if(Object.values(patch).some(value=>typeof value==='string'&&value!==value.trim()))throw new CliError('INVALID_INPUT','资料字段不能含首尾空格。',2);}
    else if(action==='schedule-set'&&typeof payload.next==='string'&&payload.next!==payload.next.trim())throw new CliError('INVALID_INPUT','下一步内容不能含首尾空格。',2);
    else if(['project-create','inquiry-create'].includes(action)){if(Object.values(payload).some(value=>typeof value==='string'&&value!==value.trim()))throw new CliError('INVALID_INPUT','字段不能含首尾空格。',2);if(action==='inquiry-create'){if(payload.details&&Object.values(object(payload.details)).some(value=>typeof value==='string'&&value!==value.trim()))throw new CliError('INVALID_INPUT','询价字段不能含首尾空格。',2);payload.type='rfq';}}
   },
   async send(payload){const data=(await api.request(route,session,payload)).data;if(data?.ok!==true||(action==='project-create'?data.item?.customerId!==payload.customerId:action==='inquiry-create'?data.record?.customerId!==payload.customerId:data.customerId!==payload.customerId))throw new CliError('INVALID_RESPONSE','写入结果无法核对，请查询原操作。',5,{outcomeUnknown:true});return data;},
   async readBack(response,input){const customerId=String(input.customerId);
    if(action==='inquiry-create'){const data=(await api.request('/api/workspace/process-data',session,undefined,{query:{type:'rfq'}})).data,id=response.record?.id;const row=Array.isArray(data?.records)?data.records.find((r:any)=>r.id===id):null;if(!row||row.customerId!==customerId||row.type!=='rfq'||row.title!==input.title||row.version!==1||!matches(row,input,['orderId','teamId','notes'])||(input.details&&!matches(object(row.details),object(input.details),Object.keys(object(input.details)))))throw Error('changed');return {scope:{teamId:null,customerId},record:{...pick(row,fields('id version type customerId orderId teamId title status gateStatus notes')),details:pick(row.details||{},fields('gateReason documentRef requirement targetDelivery quantity currency quoteRef'))}};}
    if(action==='project-create'){const data=(await api.request('/api/workspace/customer-project-data',session)).data, id=response.item?.id;const row=Array.isArray(data?.projects)?data.projects.find((r:any)=>r.id===id):null;if(!row||row.customerId!==customerId||row.title!==input.title||row.version!==1||!matches(row,input,['code','description','teamId','salesMemberId','serviceMemberIds','dueDate']))throw Error('changed');return {scope:{teamId:null,customerId},record:pick(row,fields('id version customerId teamId code title description salesMemberId serviceMemberIds dueDate status'))};}
    const data=(await api.request('/api/workspace/customer-workflow-data',session,undefined,{query:{customerId}})).data;
    if(data?.customer?.id!==customerId)throw Error('scope');
    if(action==='profile-update'){
     const profile=object(data.profile),current=object(profile.fields),patch=object(input.patch);
     if(profile.version!==version+1||Object.entries(patch).some(([key,value])=>current[key]!==value))throw Error('changed');
     return {scope:{teamId:null,customerId},record:{customerId,profile:{version:profile.version,fields:pick(current,fields(names))}}};
    }
    const current=object(data.workflow);if(current.version!==version+1||current.next!==input.next||current.nextDate!==input.nextDate)throw Error('changed');
    return {scope:{teamId:null,customerId},record:{customerId,workflow:pick(current,fields('version next nextDate followState latestFollowupOn updatedAt updatedBy'))}};
   }
  },{file,...(['project-create','inquiry-create'].includes(action)?{}:{version}),token});
 }
}
