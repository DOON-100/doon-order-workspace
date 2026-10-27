import {ApiClient} from './client.js';
import {StateStore} from './state.js';
import {CliError} from './errors.js';
import {executeWrite} from './write-operation.js';
import {type WriteSchema} from './write-input.js';
import {fields,pick} from './business.js';
import {isDeepStrictEqual} from 'node:util';
const ref={type:'string',min:1,max:160} as const;
const schemas:Record<string,WriteSchema>={
 promote:{id:{...ref,required:true},customerId:{...ref,required:true},teamId:{type:'string',max:160},title:{type:'string',required:true,min:1,max:160},description:{type:'string',required:true,max:10000},code:{type:'string',required:true,max:120}},
 classify:{id:{...ref,required:true},followupIds:{type:'array',required:true,max:100,items:ref}}
};
const routes={promote:'/api/workspace/customer-project-followup-promote',classify:'/api/workspace/customer-project-followup-mail-classify'} as const;
const mailFields=fields('id version ownerId sourceOwnerId followupIds subject from to sentAt summary draftStatus sourceUrl links canClassify createdAt updatedAt');
const mail=(row:any)=>({...pick(row,mailFields),links:Array.isArray(row.links)?row.links.map((link:any)=>pick(link,fields('label url'))):[]});
const snapshot=(row:any)=>!row?null:row.kind==='customer_project_followup_mail'?{...mail(row),body:row.body}:{...pick(row,fields('id kind version ownerId customerId projectId promotedProjectId title category stars status followUpDate notes nextAction createdAt createdBy updatedAt updatedBy')),checklist:Array.isArray(row.checklist)?row.checklist.map((item:any)=>pick(item,fields('id text checked'))):[]};
export class FollowupActionService{
 constructor(private store:StateStore,private transport:typeof fetch=fetch){}
 private async client(){const config=await this.store.config(),session=await this.store.session(config);if(!session)throw new CliError('AUTH_REQUIRED','请先运行 doon login。',4);return {api:new ApiClient(config,this.transport,30000),session};}
 async mailbox(id=''){
  const {api,session}=await this.client(),data=(await api.request('/api/workspace/customer-project-followup-data',session)).data;
  if(!Array.isArray(data?.mails))throw new CliError('INVALID_RESPONSE','邮件档案响应不符合协议。',5);
  if(!id)return {scope:{},mails:data.mails.map(mail)};
  const row=data.mails.find((v:any)=>v.id===id);if(!row)throw new CliError('NOT_IN_SCOPE','邮件档案不在当前授权范围。',7);
  return {scope:{},record:{...mail(row),body:row.body}};
 }
 async history(id:string){const {api,session}=await this.client(),data=(await api.request('/api/workspace/customer-project-followup-history',session,undefined,{query:{id}})).data;if(!Array.isArray(data?.history))throw new CliError('INVALID_RESPONSE','跟进历史响应不符合协议。',5);return {scope:{},history:data.history.map((row:any)=>({...pick(row,fields('id action actor createdAt targetId')),before:snapshot(row.before),after:snapshot(row.after)}))};}
 async execute(type:string,file:string,rawVersion:string,token:string){
  if(!Object.hasOwn(schemas,type))throw new CliError('UNSUPPORTED_OPERATION','跟进动作未接入。',2);
  if(!/^[1-9]\d*$/.test(rawVersion)||!Number.isSafeInteger(Number(rawVersion)))throw new CliError('INVALID_ARGUMENT','版本须为正整数。',2);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token))throw new CliError('INVALID_ARGUMENT','操作标识须为UUID。',2);
  const version=Number(rawVersion),{api,session}=await this.client();
  return executeWrite({schema:schemas[type],versionField:'version',tokenField:'token',
   async send(input){const data=(await api.request(routes[type as keyof typeof routes],session,input)).data;if(data?.ok!==true||data.item?.id!==input.id)throw new CliError('INVALID_RESPONSE','跟进动作结果无法核对。',5,{outcomeUnknown:true});return data;},
   async readBack(result,input){const data=(await api.request('/api/workspace/customer-project-followup-data',session)).data,row=data?.[type==='promote'?'followups':'mails']?.find((v:any)=>v.id===input.id);if(!row||row.version!==version+1)throw Error('changed');
    if(type==='classify'){if(!isDeepStrictEqual(row.followupIds,input.followupIds))throw Error('changed');return {scope:{},record:pick(row,mailFields)};}
    const project=data.projects?.find((v:any)=>v.id===row.projectId);if(!project||project.id!==result.project?.id||project.customerId!==input.customerId||project.title!==input.title||project.code!==input.code||(input.teamId&&project.teamId!==input.teamId))throw Error('project missing');
    return {scope:{customerId:project.customerId},record:pick(row,fields('id version customerId projectId promotedProjectId title ownerId')),project:pick(project,fields('id version customerId title code status teamId salesMemberId serviceMemberIds'))};
   }
  },{file,version,token});
 }
}
