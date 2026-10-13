import {z} from 'zod';
import {all,newId,now,strictDate,type Entity,type Member,type State} from './domain';
import {AppError,audit,commit,json} from './store';
import {communicationAccess,publicCommunication,type Communication} from './unified-communication';
import {frameworkAccountAccess,frameworkChannelAccess,type FrameworkChannelAccount} from './framework-channel-access';
import {handoffCatalog} from './handoff-framework-catalog';
import {canReadFrameworkKnowledge,frameworkKnowledgeMetadata} from './framework-knowledge';
import {canRead,clean,type CustomerAccount,type Order} from './domain';
import {serviceOrderCustomerKeys} from './service-workspace';
import {frameworkOffboardingGet,frameworkOffboardingPost} from './framework-offboarding';
import {businessEvidenceCurrent} from './handoff-business-evidence';
import {businessAccess} from './handoff-business';
import {frameworkFinanceTaskGet,frameworkFinanceTaskPost} from './framework-finance-task';

const manager=(m:Member)=>m.active&&['admin','programmer'].includes(m.role);
const text=(n:number)=>z.string().trim().max(n).default('');
const id=z.string().trim().min(1).max(160),token=z.string().uuid(),version=z.number().int().nonnegative();
const accountSchema=z.object({token,id:id.optional(),expectedVersion:version,channel:z.enum(['email','whatsapp']),label:z.string().trim().min(1).max(120),address:z.string().trim().min(1).max(200),ownerId:id,active:z.boolean(),reason:z.string().trim().min(1).max(3000),grants:z.record(id,z.object({view:z.boolean(),draft:z.boolean(),send:z.boolean()}).strict()).default({})}).strict();
const configSchema=z.object({token,type:z.enum(['agent','method','flow','template']),key:id,expectedVersion:version,ownerId:text(160),modelMode:z.enum(['待选择','共用公司模型','独立模型']).default('待选择'),modelName:text(160),extraRules:text(12000),templateLocation:text(2000),integrationNotes:text(6000)}).strict();
const messageSchema=z.object({token,id:id.optional(),expectedVersion:version,accountId:id,customerId:text(160),projectId:text(160),orderId:text(160),direction:z.enum(['incoming','outgoing']),sender:text(400),recipient:text(400),conversationType:z.enum(['direct','customer_group','internal_group']),conversation:text(400),occurredAt:z.string().trim().min(1).max(30),title:z.string().trim().min(1).max(300),sourceText:z.string().max(100000).default(''),draftText:z.string().max(100000).default(''),sourceNote:text(3000),missingInfo:text(3000)}).strict();
const linkSchema=z.object({token,id,expectedVersion:version,customerId:id,projectId:text(160),orderId:text(160),reason:z.string().trim().min(1).max(3000)}).strict();
const processSchema=z.object({token,id,expectedVersion:version,processed:z.boolean()}).strict();
const bindSchema=z.object({token,id,expectedVersion:version,accountId:id,reason:z.string().trim().min(1).max(3000)}).strict();
const receiveSchema=z.object({token,id,expectedVersion:z.number().int().positive()}).strict();
function noticeRows(s:State,m:Member){return all(s,'handoff_business_source').filter(r=>['engineering_drawing','engineering_quote','finance_file'].includes(r.type)&&r.status==='checked'&&businessEvidenceCurrent(s,r)&&businessAccess(s,m,{type:r.type,customerId:r.customerId,projectId:r.projectId||'',orderId:r.orderId||''}));}
function parse<T extends z.ZodTypeAny>(schema:T,body:unknown):z.output<T>{const p=schema.safeParse(body);if(!p.success)throw new AppError(p.error.issues.slice(0,3).map(e=>e.path.join('.')+': '+e.message).join('；'));return p.data;}
async function hash(x:unknown){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(x))))).map(x=>x.toString(16).padStart(2,'0')).join('');}
function matchesVersion(row:Entity|undefined,expected:number){if((row?.version||0)!==expected)throw new AppError('资料已经更新，请刷新后重新核对。',409);}
function actorAllowed(m:Member){if(!m.active||m.role==='supplier')throw new AppError('没有内部业务权限。',403);}
function account(s:State,m:Member,id:string,write=false){const a=all(s,'framework_channel_account').find(a=>a.id===id) as FrameworkChannelAccount|undefined;if(!a||!frameworkAccountAccess(s,m,id,write))throw new AppError('渠道账号不存在、已停用或没有权限。',403);return a;}
function linked(s:State,m:Member,row:Entity,write=false){return frameworkChannelAccess(s,m,row.id,write)&&communicationAccess(s,m,{customerId:row.customerId,projectId:row.projectId||'',orderId:row.orderId||''},write);}
function binding(s:State,id:string){return all(s,'framework_channel_binding').find(b=>b.communicationId===id);}
function sourceRecord(s:State,m:Member,id:string,write=false){const row=s.records.find(r=>r.id===id&&['framework_channel_inquiry','unified_communication'].includes(r.kind));if(!row)throw new AppError('消息不存在或没有权限。',403);if(row.kind==='unified_communication'){if(!linked(s,m,row,write))throw new AppError('没有此消息的客户或渠道权限。',403);}else{account(s,m,row.accountId,write);if(row.linkedCommunicationId){const target=all(s,'unified_communication').find(r=>r.id===row.linkedCommunicationId);if(!target||!linked(s,m,target,write))throw new AppError('关联客户的读取范围已变化。',403);}}return row;}
function viewMessage(s:State,m:Member,row:Entity):Entity{const side=row.kind==='unified_communication'?binding(s,row.id):row;return {...row,...(side?{accountId:side.accountId,sender:side.sender||'',recipient:side.recipient||'',conversationType:side.conversationType||'direct',conversation:side.conversation||'',direction:side.direction||'incoming',occurredAtPrecise:side.occurredAtPrecise||'',processed:!!side.processed,processVersion:side.version,sourceNote:side.sourceNote||'',missingInfo:side.missingInfo||''}:{}),canWrite:row.kind==='unified_communication'?linked(s,m,row,true):frameworkAccountAccess(s,m,row.accountId,true),...(row.kind==='unified_communication'?{canCompleteReview:publicCommunication(s,m,row as Communication).canCompleteReview}:{}),deliveryState:'manual_only'};}
function configKey(type:string,key:string){return `framework_configuration_${type}_${key}`;}
const templateKeys=['quotation','pi','invoice','packing','waybill','paymentrequest','production','receipt-check','reconciliation'];
function knownConfig(type:string,key:string){return type==='agent'?Object.hasOwn(handoffCatalog.agents,key):type==='method'?Object.hasOwn(handoffCatalog.methods,key):type==='flow'?Object.hasOwn(handoffCatalog.flows,key):templateKeys.includes(key);}
async function replay(s:State,m:Member,action:string,input:{token:string}){const row=s.records.find(r=>r.id==='framework_request_'+input.token);if(!row)return null;if(row.actorId!==m.id||row.action!==action||row.hash!==await hash(input))throw new AppError('请求标识已被其他内容使用。',409);return json({ok:true,id:row.targetId,idempotent:true});}
async function persist(s:State,m:Member,action:string,input:{token:string},row:Entity,extra:Entity[]=[],before?:Entity){
 const hist={id:newId('framework_history'),kind:'framework_history',targetId:row.id,targetKind:row.kind,version:row.version,actorId:m.id,actor:m.name,createdAt:now(),snapshot:structuredClone(row)};
 const request={id:'framework_request_'+input.token,kind:'framework_request',actorId:m.id,action,hash:await hash(input),targetId:row.id,createdAt:now()};
 await commit(s.revision,[row,...extra,hist,audit(m,row,before||null,action,'交接框架人工操作'),request]);return json({ok:true,id:row.id,version:row.version});
}
export async function frameworkGet(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(action.startsWith('framework-finance-task'))return frameworkFinanceTaskGet(action,req,s,m);
 if(action.startsWith('framework-offboarding'))return frameworkOffboardingGet(action,req,s,m);
 if(!['framework-settings','framework-channels','framework-channel-history','framework-channel-context','framework-knowledge','framework-knowledge-document','framework-notices'].includes(action))return null;actorAllowed(m);
 if(action==='framework-notices')return json({items:noticeRows(s,m).map(r=>{const receipt=all(s,'framework_notice_receipt').find(a=>a.targetId===r.id&&a.memberId===m.id),customer=all(s,'customer_account').find(c=>c.id===r.customerId);return {id:r.id,type:r.type,number:r.number,version:r.version,customerId:r.customerId,customer:customer?.customer||'授权客户',projectId:r.projectId,orderId:r.orderId,updatedAt:r.updatedAt,received:receipt?.sourceVersion===r.version,receivedAt:receipt&&receipt.sourceVersion===r.version?receipt.createdAt:'',canReceive:true};}),asOf:now()});
 if(action==='framework-knowledge')return json({documents:frameworkKnowledgeMetadata(s,m),asOf:now()});
 if(action==='framework-knowledge-document'){
  const id=new URL(req.url).searchParams.get('id'),row=all(s,'framework_knowledge_document').find(r=>r.id===id);
  if(!row||!canReadFrameworkKnowledge(s,m,row))throw new AppError('规则文档尚未导入或当前账号没有读取权限。',403);
  return json({document:row});
 }
 if(action==='framework-settings'){
  if(!manager(m))throw new AppError('仅管理员和程序员可查看系统配置。',403);
  return json({configs:all(s,'framework_configuration'),history:all(s,'framework_history').filter(h=>h.targetKind==='framework_configuration'),members:all(s,'member').map(a=>({id:a.id,name:a.name,role:a.role,active:a.active})),accounts:all(s,'framework_channel_account'),audits:all(s,'audit').filter(a=>String(a.after?.kind||a.before?.kind||'').startsWith('framework_')).slice(-100).reverse().map(a=>({id:a.id,action:a.action,actor:a.actor,createdAt:a.createdAt,kind:a.after?.kind||a.before?.kind})),capabilities:{automaticExecution:false,channelSending:false,sharedDatabase:true,realAuthentication:true},asOf:now()});
 }
 if(action==='framework-channel-history'){
  const row=sourceRecord(s,m,new URL(req.url).searchParams.get('id')||'');
  // Source and history use current account + customer authorization; snapshots never widen access.
  const origin=all(s,'framework_channel_inquiry').find(x=>x.linkedCommunicationId===row.id&&frameworkAccountAccess(s,m,x.accountId));
  const entries=row.kind==='unified_communication'?[...all(s,'unified_communication_revision').filter(x=>x.recordId===row.id&&x.customerId===row.customerId&&x.snapshot&&linked(s,m,{...x.snapshot,id:row.id})),...(origin?all(s,'framework_history').filter(x=>x.targetId===origin.id&&x.snapshot?.accountId===origin.accountId):[])]:all(s,'framework_history').filter(x=>x.targetId===row.id&&x.snapshot?.accountId===row.accountId);
  return json({entries:entries.sort((a,b)=>b.version-a.version)});
 }
 if(action==='framework-channel-context'){
  const row=sourceRecord(s,m,new URL(req.url).searchParams.get('id')||''),side=binding(s,row.id);
  const related=row.kind==='framework_channel_inquiry'?[row]:all(s,'unified_communication').filter(x=>{
   if(!linked(s,m,x)||x.customerId!==row.customerId)return false;
   if(row.orderId)return x.orderId===row.orderId;
   if(row.projectId)return x.projectId===row.projectId;
   const other=binding(s,x.id);return x.id===row.id||!x.orderId&&!x.projectId&&!!side?.conversation&&other?.conversation===side.conversation&&other?.accountId===side.accountId&&x.channel===row.channel;
  });
  return json({items:related.sort((a,b)=>String(a.occurredAt||a.createdAt).localeCompare(String(b.occurredAt||b.createdAt))).map(x=>{const b=x.kind==='framework_channel_inquiry'?x:binding(s,x.id);return {id:x.id,title:x.title,sourceText:x.sourceText,draftText:x.draftText,sourceReference:x.sourceReference||x.sourceNote||'',occurredAt:b?.occurredAtPrecise||x.occurredAt,version:x.version,sourceRevision:x.sourceRevision||x.version,channel:x.channel,sender:b?.sender||'',recipient:b?.recipient||'',conversation:b?.conversation||'',conversationType:b?.conversationType||'direct',status:x.status};}),rules:frameworkKnowledgeMetadata(s,m).filter(d=>d.active&&['source-reply','context-linking','context-review','rule-07','rule-14'].includes(d.ruleId)),asOf:now(),scope:'仅同客户、同订单或同项目的授权消息；未关联项目时只同账号明确会话。模型未调用。'});
 }
 const requested=new URL(req.url).searchParams.get('channel');if(!['email','whatsapp'].includes(requested||''))throw new AppError('请选择邮箱或WhatsApp。');
 const accounts=(all(s,'framework_channel_account') as FrameworkChannelAccount[]).filter(a=>a.channel===requested&&frameworkAccountAccess(s,m,a.id)).map(a=>({id:a.id,label:a.label,address:a.address,ownerId:a.ownerId,channel:a.channel,canWrite:frameworkAccountAccess(s,m,a.id,true)}));
 const messages=all(s,'unified_communication').filter(r=>r.channel===requested&&linked(s,m,r)).map(r=>viewMessage(s,m,r));
 const inquiries=all(s,'framework_channel_inquiry').filter(r=>r.channel===requested&&!r.linkedCommunicationId&&frameworkAccountAccess(s,m,r.accountId)).map(r=>viewMessage(s,m,r));
 const customers=all(s,'customer_account').filter(c=>communicationAccess(s,m,{customerId:c.id,projectId:'',orderId:''})).map(c=>({id:c.id,customer:c.customer,customerCode:c.customerCode,canWrite:communicationAccess(s,m,{customerId:c.id,projectId:'',orderId:''},true)}));
 const projects=all(s,'customer_project').filter(p=>communicationAccess(s,m,{customerId:p.customerId,projectId:p.id,orderId:''})).map(p=>({id:p.id,customerId:p.customerId,title:p.title,code:p.code}));
 const orderCustomers=new Map<string,string>();for(const c of all(s,'customer_account').filter(c=>customers.some(x=>x.id===c.id)))for(const key of serviceOrderCustomerKeys(s,c as CustomerAccount))orderCustomers.set(clean(key).toLowerCase(),c.id);
 const orders=(all(s,'order') as Order[]).filter(o=>canRead(m,o)&&orderCustomers.has(clean(o.customer).toLowerCase())).map(o=>({id:o.id,customerId:orderCustomers.get(clean(o.customer).toLowerCase()),orderNo:o.orderNo,drawing:o.drawing}));
 return json({items:[...messages,...inquiries].sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))),accounts,customers,projects,orders,members:all(s,'member').filter(a=>accounts.some(b=>b.ownerId===a.id)).map(a=>({id:a.id,name:a.name})),capabilities:{canSend:false,manualOnly:true},asOf:now()});
}
export async function frameworkPost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(action.startsWith('framework-finance-task'))return frameworkFinanceTaskPost(action,req,s,m);
 if(action.startsWith('framework-offboarding'))return frameworkOffboardingPost(action,req,s,m);
 if(!['framework-config-save','framework-account-save','framework-message-save','framework-message-link','framework-message-process','framework-message-bind','framework-notice-receive'].includes(action))return null;actorAllowed(m);
 const raw=await req.text();if(raw.length>260000)throw new AppError('内容超过大小上限。');let body:unknown;try{body=JSON.parse(raw);}catch{throw new AppError('请求内容无效。');}
 if(action==='framework-notice-receive'){
  const input=parse(receiveSchema,body),source=noticeRows(s,m).find(r=>r.id===input.id);if(!source)throw new AppError('资料不可见、未核对或来源已变更。',403);matchesVersion(source,input.expectedVersion);const prior=await replay(s,m,action,input);if(prior)return prior;
  const before=all(s,'framework_notice_receipt').find(r=>r.targetId===source.id&&r.memberId===m.id);if(before?.sourceVersion===source.version)throw new AppError('你已经确认收阅该版本。',409);
  const row={id:before?.id||newId('framework_notice_receipt'),kind:'framework_notice_receipt',version:(before?.version||0)+1,targetId:source.id,sourceVersion:source.version,customerId:source.customerId,memberId:m.id,memberName:m.name,createdAt:now(),meaning:'本人收阅指定资料版本，不代表内容审批、财务到账或生产采用'};return persist(s,m,action,input,row,[],before);
 }
 if(action==='framework-config-save'){
  if(!manager(m))throw new AppError('没有配置维护权限。',403);const input=parse(configSchema,body);if(!knownConfig(input.type,input.key))throw new AppError('未知配置项目。');
  if(input.ownerId&&!all(s,'member').some(a=>a.id===input.ownerId&&a.active&&a.role!=='supplier'))throw new AppError('负责人必须为在职内部成员。');
  if(/sk-[A-Za-z0-9_-]{12,}|BEGIN .*PRIVATE KEY/i.test([input.modelName,input.extraRules,input.integrationNotes].join(' ')))throw new AppError('此处只登记配置说明，不保存密钥。');
  const before=s.records.find(r=>r.id===configKey(input.type,input.key)),prior=await replay(s,m,action,input);if(prior)return prior;matchesVersion(before,input.expectedVersion);
  const {token:_,expectedVersion:__,...fields}=input,row={...fields,id:configKey(input.type,input.key),kind:'framework_configuration',version:input.expectedVersion+1,updatedAt:now(),updatedBy:m.name,updatedById:m.id,executionEnabled:false};return persist(s,m,action,input,row,[],before);
 }
 if(action==='framework-account-save'){
  if(!manager(m))throw new AppError('没有渠道账号配置权限。',403);const input=parse(accountSchema,body),before=input.id?all(s,'framework_channel_account').find(a=>a.id===input.id):undefined;
  if(input.id&&!before)throw new AppError('账号配置不存在。');if(!all(s,'member').some(a=>a.id===input.ownerId&&a.active&&a.role!=='supplier')&&!(before?.ownerId===input.ownerId&&all(s,'member').some(a=>a.id===before.continuityMemberId&&a.active&&a.role!=='supplier')))throw new AppError('请选择在职内部账号负责人；原负责人离岗后的已有账号须保留原身份并通过有效持续负责人管理。');
  if(input.channel==='email'?!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.address):!/^\+[1-9]\d{6,14}$/.test(input.address))throw new AppError('请填写有效邮箱地址或带国家区号的WhatsApp号码。');
  if(all(s,'framework_channel_account').some(a=>a.id!==input.id&&a.channel===input.channel&&a.address.toLowerCase()===input.address.toLowerCase()))throw new AppError('该渠道账号已登记，请维护原账号。');
  for(const [memberId,grant] of Object.entries(input.grants)){if(!all(s,'member').some(a=>a.id===memberId&&a.active&&a.role!=='supplier'))throw new AppError('授权对象须为在职内部成员。');if((grant.draft||grant.send)&&!grant.view)throw new AppError('草稿与发送计划权限必须同时具备查看权限。');}
  if(before&&[...all(s,'framework_channel_binding'),...all(s,'framework_channel_inquiry')].some(b=>b.accountId===before.id)&&['channel','address','ownerId'].some(k=>before[k]!==input[k as keyof typeof input]))throw new AppError('该账号已有业务来源，类型、地址和负责人不能直接变更；可调整授权或新建账号。',409);
  const prior=await replay(s,m,action,input);if(prior)return prior;matchesVersion(before,input.expectedVersion);const {token:_,expectedVersion:__,...fields}=input,row={...(before?.continuityMemberId?{continuityMemberId:before.continuityMemberId}:{}),...fields,id:before?.id||newId('framework_channel_account'),kind:'framework_channel_account',version:input.expectedVersion+1,updatedAt:now(),updatedBy:m.name,sendEnabled:false};return persist(s,m,action,input,row,[],before);
 }
 if(action==='framework-message-process'){
  const input=parse(processSchema,body),before=sourceRecord(s,m,input.id,true);const prior=await replay(s,m,action,input);if(prior)return prior;
  if(before.kind==='framework_channel_inquiry'){matchesVersion(before,input.expectedVersion);return persist(s,m,action,input,{...before,processed:input.processed,version:before.version+1,updatedAt:now(),updatedBy:m.name},[],before);}
  const old=binding(s,before.id);if(!old)throw new AppError('原统一沟通记录请在原业务页面处理；尚未绑定渠道账号。');
  matchesVersion(old,input.expectedVersion);const row={...old,processed:input.processed,version:(old.version||0)+1,updatedAt:now(),updatedBy:m.name};return persist(s,m,action,input,row,[],old);
 }
 if(action==='framework-message-bind'){
  if(!manager(m))throw new AppError('仅管理员可核实历史来源的账号绑定。',403);
  const input=parse(bindSchema,body),before=sourceRecord(s,m,input.id,true),acct=account(s,m,input.accountId,true),prior=await replay(s,m,action,input);if(prior)return prior;matchesVersion(before,input.expectedVersion);
  if(before.kind!=='unified_communication'||binding(s,before.id))throw new AppError('只能绑定尚未登记账号的人工沟通。',409);
  if(before.channel!==acct.channel)throw new AppError('账号渠道与原消息不一致。');
  if(before.draftText||before.lastSubmissionId||before.version>1)throw new AppError('已有草稿或历史版本的来源不得直接改绑账号，请先核实处理。',409);
  const row={id:'framework_channel_binding_'+before.id,kind:'framework_channel_binding',communicationId:before.id,accountId:acct.id,version:1,reason:input.reason,direction:'incoming',conversationType:'direct',processed:false,createdAt:now(),updatedAt:now(),updatedBy:m.name};return persist(s,m,action,input,row,[],undefined);
 }
 let input:z.infer<typeof messageSchema>,inquiry:Entity|undefined;
 if(action==='framework-message-link'){
  const link=parse(linkSchema,body);inquiry=sourceRecord(s,m,link.id,true);if(inquiry.kind!=='framework_channel_inquiry')throw new AppError('只可关联尚未归属客户的询单。',409);
  if(inquiry.linkedCommunicationId){const target=sourceRecord(s,m,inquiry.linkedCommunicationId,true);if(target.customerId!==link.customerId)throw new AppError('询单已关联其他客户。',409);const prior=await replay(s,m,action,link);if(prior)return prior;throw new AppError('该询单已关联，请打开统一沟通记录。',409);}matchesVersion(inquiry,link.expectedVersion);
  input={token:link.token,expectedVersion:0,accountId:inquiry.accountId,customerId:link.customerId,projectId:link.projectId,orderId:link.orderId,direction:inquiry.direction,sender:inquiry.sender,recipient:inquiry.recipient,conversationType:inquiry.conversationType,conversation:inquiry.conversation,occurredAt:inquiry.occurredAtPrecise,title:inquiry.title,sourceText:inquiry.sourceText,draftText:inquiry.draftText,sourceNote:inquiry.sourceNote,missingInfo:inquiry.missingInfo};
 }else input=parse(messageSchema,body);
 const acct=account(s,m,input.accountId,true),before=input.id?sourceRecord(s,m,input.id,true):undefined;
 if(before?.kind==='framework_channel_inquiry'&&before.linkedCommunicationId)throw new AppError('该询单已经关联，请打开统一沟通记录。',409);
 if(before?.kind==='unified_communication'&&before.customerId!==input.customerId)throw new AppError('已有客户沟通不得改绑客户。',409);
 const oldBinding=before?.kind==='unified_communication'?binding(s,before.id):before;
 if(before?.kind==='framework_channel_inquiry'&&input.customerId)throw new AppError('请使用核实并关联客户操作，填写关联原因，保留询单来源链。',409);
 if(before&&oldBinding?.accountId!==input.accountId)throw new AppError('已保存来源不能改绑渠道账号。',409);
 if(input.customerId&&!communicationAccess(s,m,input,true))throw new AppError('客户或关联项目/订单不在写入范围内。',403);
 if(!input.customerId&&(input.projectId||input.orderId))throw new AppError('关联业务前必须先核实客户。');
 if(input.direction==='outgoing'&&!input.customerId)throw new AppError('撰写对客草稿前须先核实客户。');
 if(!input.sender&&input.direction==='incoming'||!input.recipient&&input.direction==='outgoing')throw new AppError('请填写来信人或收件人。');
 if(acct.channel==='email'&&input.conversationType!=='direct')throw new AppError('邮箱记录使用单独沟通类型。');
 if(input.conversationType!=='direct'&&!input.conversation)throw new AppError('群聊记录必须填写群名。');
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(input.occurredAt)||Number.isNaN(Date.parse(input.occurredAt)))throw new AppError('请填写有效发生时间。');try{strictDate(input.occurredAt.slice(0,10));}catch{throw new AppError('请填写真实存在的发生日期。');}
 if(!input.sourceText.trim()&&!input.draftText.trim())throw new AppError('请录入原文或草稿。');
 const prior=await replay(s,m,action,body as {token:string});if(prior)return prior;matchesVersion(before,input.expectedVersion);
 const stamp=now(),side={accountId:acct.id,sender:input.sender,recipient:input.recipient,direction:input.direction,conversationType:input.conversationType,conversation:input.conversation,occurredAtPrecise:input.occurredAt,sourceNote:input.sourceNote,missingInfo:input.missingInfo,processed:false};
 if(!input.customerId){const row={...side,id:before?.id||newId('framework_channel_inquiry'),kind:'framework_channel_inquiry',channel:acct.channel,title:input.title,sourceText:input.sourceText,draftText:input.draftText,customerId:'',status:'draft',version:(before?.version||0)+1,createdAt:before?.createdAt||stamp,createdById:before?.createdById||m.id,updatedAt:stamp,updatedBy:m.name};return persist(s,m,action,input,row,[],before);}
 const fields={customerId:input.customerId,projectId:input.projectId,orderId:input.orderId,channel:acct.channel,title:input.title,sourceText:input.sourceText,sourceReference:input.sourceNote,occurredAt:input.occurredAt.slice(0,10),draftText:input.draftText,internalNote:before?.internalNote||''};
 const sourceHash=await hash({channel:fields.channel,title:fields.title,sourceText:fields.sourceText,sourceReference:fields.sourceReference,occurredAt:fields.occurredAt,side}),row:Communication={...fields,id:before?.kind==='unified_communication'?before.id:newId('unified_communication'),kind:'unified_communication',inputMode:'manual',version:(before?.version||0)+1,status:'draft',sourceHash,sourceRevision:before?(before.sourceRevision||1)+Number(sourceHash!==before.sourceHash):1,contentHash:await hash(fields),requiresRecheck:!!before?.lastSubmissionId,lastSubmissionId:before?.lastSubmissionId||'',createdAt:before?.createdAt||stamp,createdBy:before?.createdBy||m.name,createdById:before?.createdById||m.id,updatedAt:stamp,updatedBy:m.name,updatedById:m.id};
 const channelBinding={...side,id:oldBinding?.kind==='framework_channel_binding'?oldBinding.id:'framework_channel_binding_'+row.id,kind:'framework_channel_binding',communicationId:row.id,version:(oldBinding?.version||0)+1,updatedAt:stamp};
 const revision={id:newId('unified_communication_revision'),kind:'unified_communication_revision',recordId:row.id,customerId:row.customerId,version:row.version,action,actorId:m.id,actor:m.name,createdAt:stamp,snapshot:structuredClone(row),channelSnapshot:structuredClone(side)};
 const extras:Entity[]=[channelBinding,revision];if(inquiry)extras.push({...inquiry,linkedCommunicationId:row.id,version:inquiry.version+1,linkReason:(body as any).reason,updatedAt:stamp});
 return persist(s,m,action,body as {token:string},row,extras,before);
}
