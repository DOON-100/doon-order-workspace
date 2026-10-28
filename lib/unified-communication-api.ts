import {z} from 'zod';
import {all,canRead,clean,newId,now,type CustomerAccount,type Entity,type Member,type Order,type State} from './domain';
import {AppError,audit,commit,json} from './store';
import {communicationAccess,communicationSchemas,canReviewCommunication,publicCommunication,type Communication,type CommunicationLinks} from './unified-communication';
import {serviceOrderCustomerKeys} from './service-workspace';
import {frameworkChannelMatches} from './framework-channel-access';
import {isProjectTrashed} from './customer-projects';

const prefix='unified-communication-';
function parse<T extends z.ZodTypeAny>(schema:T,value:unknown):z.output<T>{
 const result=schema.safeParse(value);if(!result.success)throw new AppError(result.error.issues.slice(0,4).map(e=>`${e.path.join('.')}: ${e.message}`).join('；'));
 return result.data;
}
async function hash(value:unknown){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))).map(x=>x.toString(16).padStart(2,'0')).join('');}
function assertAccess(s:State,m:Member,row:CommunicationLinks,write=false){if(!communicationAccess(s,m,row,write))throw new AppError('客户、项目或订单不在当前责任范围内，或关联不一致。',403);}
function record(s:State,m:Member,id:string,write=false){const row=all(s,'unified_communication').find(r=>r.id===id) as Communication|undefined;if(!row)throw new AppError('沟通记录不存在或无权限。',403);assertAccess(s,m,row,write);return row;}
function assertVersion(row:Communication,expected:number){if(row.version!==expected)throw new AppError('记录已有新版本，请刷新后核对再保存。',409);}
function response(s:State,m:Member,item:Communication){return {ok:true,item:publicCommunication(s,m,item)};}

async function replay(s:State,m:Member,action:string,input:{token:string}){
 const prior=s.records.find(r=>r.id==='unified_communication_request_'+input.token);if(!prior)return null;
 if(prior.kind!=='unified_communication_request'||prior.actorId!==m.id||prior.action!==action||prior.hash!==await hash(input))throw new AppError('请求编号已用于其他操作或内容。',409);
 record(s,m,prior.recordId,true);
 assertAccess(s,m,prior.snapshot,true);
 return json({...response(s,m,prior.snapshot),idempotent:true});
}
async function persist(s:State,m:Member,action:string,input:{token:string},item:Communication,before?:Communication,review?:Entity){
 const revision={id:newId('unified_communication_revision'),kind:'unified_communication_revision',recordId:item.id,customerId:item.customerId,version:item.version,action,actorId:m.id,actor:m.name,createdAt:item.updatedAt,snapshot:structuredClone(item)};
 const request={id:'unified_communication_request_'+input.token,kind:'unified_communication_request',recordId:item.id,actorId:m.id,action,hash:await hash(input),snapshot:structuredClone(item),createdAt:item.updatedAt};
 // The current value, immutable snapshots, audit and idempotency key share one revision-guarded transaction.
 await commit(s.revision,[item,revision,...(review?[review]:[]),audit(m,item,before||null,'统一沟通 · '+action,'人工录入'),request]);
 return json(response(s,m,item));
}

export async function unifiedCommunicationGet(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(![prefix+'data',prefix+'history'].includes(action))return null;
 if(!m.active)throw new AppError('账号已停用。',403);
 if(action===prefix+'history'){
  const row=record(s,m,new URL(req.url).searchParams.get('id')||'');
  const visible=(entry:Entity)=>entry.recordId===row.id&&entry.customerId===row.customerId&&entry.snapshot?.kind==='unified_communication'&&entry.snapshot.id===row.id&&communicationAccess(s,m,entry.snapshot);
  return json({item:publicCommunication(s,m,row),revisions:all(s,'unified_communication_revision').filter(visible).sort((a,b)=>b.version-a.version),reviews:all(s,'unified_communication_review').filter(visible).sort((a,b)=>b.version-a.version)});
 }
 const customers=all(s,'customer_account').filter(c=>communicationAccess(s,m,{customerId:c.id,projectId:'',orderId:''}));
 const projects=all(s,'customer_project').filter(p=>!isProjectTrashed(p)&&communicationAccess(s,m,{customerId:p.customerId,projectId:p.id,orderId:''}));
 const customerByOrderKey=new Map<string,string>();
 for(const customer of customers)for(const key of serviceOrderCustomerKeys(s,customer as CustomerAccount))customerByOrderKey.set(clean(key).toLowerCase(),customer.id);
 const orders=(all(s,'order') as Order[]).filter(o=>canRead(m,o)&&customerByOrderKey.has(clean(o.customer).toLowerCase())).map(o=>({id:o.id,customerId:customerByOrderKey.get(clean(o.customer).toLowerCase())!,orderNo:o.orderNo,drawing:o.drawing}));
 // Reading never creates samples, seeds, tasks, or provider jobs.
 return json({items:(all(s,'unified_communication') as Communication[]).filter(r=>communicationAccess(s,m,r)).map(r=>publicCommunication(s,m,r)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)),
  customers:customers.map(c=>({id:c.id,customer:c.customer,customerCode:c.customerCode,canWrite:communicationAccess(s,m,{customerId:c.id,projectId:'',orderId:''},true)})),
  projects:projects.map(p=>({id:p.id,customerId:p.customerId,title:p.title,code:p.code,canWrite:communicationAccess(s,m,{customerId:p.customerId,projectId:p.id,orderId:''},true)})),orders,
  capabilities:{manualOnly:true,canSend:false,canApproveQuote:false,canCompleteReview:true}});
}

export async function unifiedCommunicationPost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 const names:Record<string,keyof typeof communicationSchemas>={[prefix+'save']:'save',[prefix+'submit']:'submit',[prefix+'return']:'return',[prefix+'complete-review']:'completeReview'};
 const name=names[action];if(!name)return null;
 if(!m.active||!['admin','sales','clerk','pmc'].includes(m.role))throw new AppError('没有人工沟通草稿维护权限。',403);
 const raw=await req.text();if(raw.length>240000)throw new AppError('沟通内容超过大小上限。');
 let body:unknown;try{body=JSON.parse(raw);}catch{throw new AppError('请求 JSON 无效。');}
 if(name==='save'){
   const input=parse(communicationSchemas.save,body),before=input.id?record(s,m,input.id,true):undefined;
   if(before&&!frameworkChannelMatches(s,before.id,input.channel))throw new AppError('已绑定账号的沟通渠道不能更换；请在正确账号下另建并保留原记录。',409);
  if(before&&input.customerId!==before.customerId)throw new AppError('已保存沟通的客户归属不能直接更换，请核实后在正确客户下另建记录并保留原记录。',409);
  assertAccess(s,m,input,true);const prior=await replay(s,m,action,input);if(prior)return prior;
  if(before)assertVersion(before,input.expectedVersion!);
  const {token:_,id:__,expectedVersion:___,...fields}=input;
  const sourceHash=await hash({channel:fields.channel,sourceText:fields.sourceText,sourceReference:fields.sourceReference,occurredAt:fields.occurredAt});
  const stamp=now(),item:Communication={...fields,id:before?.id||newId('unified_communication'),kind:'unified_communication',inputMode:'manual',version:(before?.version||0)+1,status:'draft',
   sourceHash,sourceRevision:before?before.sourceRevision+Number(sourceHash!==before.sourceHash):1,contentHash:await hash(fields),requiresRecheck:!!before?.lastSubmissionId,lastSubmissionId:before?.lastSubmissionId||'',
   createdAt:before?.createdAt||stamp,createdBy:before?.createdBy||m.name,createdById:before?.createdById||m.id,updatedAt:stamp,updatedBy:m.name,updatedById:m.id};
  return persist(s,m,action,input,item,before);
 }
 const input=parse(communicationSchemas[name],body),before=record(s,m,input.id,true);
 if(name!=='submit'&&!canReviewCommunication(s,m,before))throw new AppError('仅现有明确负责销售可完成内部核对或退回这份沟通草稿。',403);
 if(input.expectedSourceHash!==undefined&&input.expectedSourceHash!==before.sourceHash||input.expectedContentHash!==undefined&&input.expectedContentHash!==before.contentHash)throw new AppError('沟通来源或草稿内容已变化，请重新读取并核对。',409);
 const prior=await replay(s,m,action,input);if(prior)return prior;assertVersion(before,input.expectedVersion);
 if(name==='submit'&&(!['draft','returned'].includes(before.status)||!before.draftText.trim()))throw new AppError('请先保存非空回复草稿；仅草稿或已退回版本可提交。',409);
 if(name!=='submit'&&before.status!=='pending_check')throw new AppError('只有当前待核对草稿可以完成核对或退回修改。',409);
 if(name==='completeReview'){
  const submission=all(s,'unified_communication_review').find(r=>r.id===before.lastSubmissionId&&r.action==='submit'&&r.recordId===before.id&&r.version===before.version);
  if(!submission||submission.sourceHash!==before.sourceHash||submission.contentHash!==before.contentHash)throw new AppError('提交依据已变化，请保存并重新提交核对。',409);
 }
 const stamp=now(),reviewId=newId('unified_communication_review'),item:Communication={...before,version:before.version+1,status:name==='submit'?'pending_check':name==='return'?'returned':'checked',requiresRecheck:name==='return',lastSubmissionId:name==='submit'?reviewId:before.lastSubmissionId,updatedAt:stamp,updatedBy:m.name,updatedById:m.id};
 const review={id:reviewId,kind:'unified_communication_review',recordId:item.id,customerId:item.customerId,version:item.version,basedOnVersion:before.version,action:name==='completeReview'?'complete-review':name,comment:input.comment,actorId:m.id,actor:m.name,createdAt:stamp,sourceHash:item.sourceHash,contentHash:item.contentHash,snapshot:structuredClone(item)};
 return persist(s,m,action,input,item,before,review);
}
