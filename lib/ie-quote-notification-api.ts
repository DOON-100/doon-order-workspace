import {z} from 'zod';
import {env} from 'cloudflare:workers';
import {all,newId,now,type Member,type State} from './domain';
import {AppError,audit,commit,json,snapshot} from './store';
import {canConfigureIeQuotes,iePolicyMember} from './ie-quote-access';
import {buildIeNotificationPreview,ieNotificationHistory,ieNotificationMailbox,publicIeNotificationDelivery,validIeNotificationEmail,type IeNotificationDelivery,type IeNotificationMailbox,type IeNotificationTransport} from './ie-quote-notifications';
import {canReadIeQuote} from './ie-quote-access';
import {ieQuoteVersion,releasedIeSnapshot} from './ie-quotes';
import {buildIeQuoteWorkbookAttachment} from './ie-quote-workbook-api';
import {canReadCustomerQuote,type CustomerQuote} from './customer-quotes';
import {assertCustomerQuoteIeApproval} from './customer-quote-ie';
import {assertCustomerQuoteConfirmable} from './customer-quote-review';
const id=z.string().trim().min(1).max(120);
function parse<T extends z.ZodTypeAny>(schema:T,value:unknown):z.output<T>{const r=schema.safeParse(value);if(!r.success)throw new AppError(r.error.issues.slice(0,4).map(i=>i.message).join('；'));return r.data;}
export const ieNotificationPushInput=z.object({target:z.enum(['engineering','sales_approval']).default('engineering'),quoteId:id,quoteVersion:z.number().int().positive(),fingerprint:z.string().regex(/^[a-f0-9]{64}$/),idempotencyKey:z.string().trim().min(8).max(120)}).strict();
// The local runtime supplies the explicitly selected Tencent enterprise SMTP
// adapter. Safe sender/base metadata remains visible while disabled; secrets
// remain runtime-only and sending still requires configured === true.
const configuredTransport=():IeNotificationTransport|null=>{const transport=(env as unknown as {IE_MAIL?:IeNotificationTransport}).IE_MAIL;return transport&&typeof transport.send==='function'?transport:null;};
async function prepareNotification(s:State,m:Member,quoteId:string,quoteVersion:number,transport:IeNotificationTransport|null,target:'engineering'|'sales_approval'='engineering'){
 let attachment:Awaited<ReturnType<typeof buildIeQuoteWorkbookAttachment>>|null=null,problem='',salesProblem='';
 const sales=target==='sales_approval'?all(s,'customer_quote').find(q=>q.id===quoteId) as CustomerQuote|undefined:undefined;
 if(target==='sales_approval'&&(!sales||!canReadCustomerQuote(s,m,sales)))return {preview:null,attachment:null};
 if(sales&&sales.version!==quoteVersion)throw new AppError('客户报价已有新版本，请刷新并重新预览审批邮件。',409);
 if(sales){try{assertCustomerQuoteConfirmable(sales);const approver=iePolicyMember(s,'finalApprover');if(!approver)throw new AppError('尚未绑定有效总经理审批人。');assertCustomerQuoteIeApproval(s,approver,sales);}catch(e){salesProblem=e instanceof AppError?e.message:'客户报价尚未满足总经理审批条件。';}}
 const q=sales?(sales.ieSource?releasedIeSnapshot(s,sales.ieSource.quoteId,sales.ieSource.version):null):ieQuoteVersion(s,quoteId,quoteVersion);
 if(sales&&!q)throw new AppError('客户报价尚未绑定有效已发布工程依据，不能生成审批附件。',409);
 if(q&&canReadIeQuote(s,m,q)){try{attachment=await buildIeQuoteWorkbookAttachment(s,m,q);}catch(e){problem=e instanceof AppError?e.message:'当前版本工程附件尚未通过核验。';}}
 const preview=await buildIeNotificationPreview(s,m,q?.id||quoteId,q?.version||quoteVersion,transport,attachment,problem,sales);if(preview&&salesProblem){preview.blockers.push(salesProblem);preview.ready=false;}return {preview,attachment};
}
export async function ieQuoteNotificationGet(action:string,url:URL,s:State,m:Member):Promise<Response|null>{
 if(!['ie-quote-notification-preview','ie-quote-notification-history'].includes(action))return null;
 const quoteId=url.searchParams.get('id')||'',quoteVersion=Number(url.searchParams.get('version'));
 const target=parse(z.enum(['engineering','sales_approval']),url.searchParams.get('target')||'engineering');
 if(!Number.isSafeInteger(quoteVersion)||quoteVersion<1)throw new AppError('请选择明确的报价版本。');
 const {preview}=await prepareNotification(s,m,quoteId,quoteVersion,configuredTransport(),target);if(!preview)throw new AppError('报价不存在或无权查看通知预览。',403);
 return json({preview,history:ieNotificationHistory(s,m,quoteId,target)});
}
export async function ieQuoteNotificationPost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['ie-quote-notification-push','ie-quote-notification-mailbox'].includes(action))return null;
 if(action==='ie-quote-notification-mailbox'){
  if(!canConfigureIeQuotes(m))throw new AppError('仅管理员可以确认真实通知邮箱；不会修改登录账号。',403);
  const input=parse(z.object({memberId:id,email:z.string().trim().email().max(254),expectedVersion:z.number().int().nonnegative(),confirmed:z.literal(true)}).strict(),await req.json());
  if(!validIeNotificationEmail(input.email))throw new AppError('请填写真实通知邮箱，不能使用 .local / .invalid / localhost 等占位地址。');
  if(!all(s,'member').some(v=>v.id===input.memberId&&v.active&&v.role!=='supplier'))throw new AppError('只能为有效内部成员绑定通知邮箱。');
  const before=ieNotificationMailbox(s,input.memberId);if(all(s,'ie_quote_notification_mailbox').filter(v=>v.memberId===input.memberId).length>1)throw new AppError('通知邮箱记录重复，请核查。',409);if((before?.version||0)!==input.expectedVersion)throw new AppError('通知邮箱已更新，请刷新。',409);
  const mailbox:IeNotificationMailbox={id:before?.id||newId('ie_quote_notification_mailbox'),kind:'ie_quote_notification_mailbox',memberId:input.memberId,email:input.email,version:(before?.version||0)+1,confirmed:true,updatedAt:now(),updatedBy:m.name};await commit(s.revision,[mailbox,audit(m,mailbox,before,'确认内部通知邮箱','IE 工程报价',mailbox)]);return json({ok:true,mailbox:{memberId:mailbox.memberId,email:mailbox.email,version:mailbox.version}});
 }
 return pushIeQuoteNotification(s,m,parse(ieNotificationPushInput,await req.json()),configuredTransport());
}
export async function pushIeQuoteNotification(s:State,m:Member,input:z.infer<typeof ieNotificationPushInput>,transport:IeNotificationTransport|null){
 const {preview,attachment}=await prepareNotification(s,m,input.quoteId,input.quoteVersion,transport,input.target);if(!preview||!preview.canPush)throw new AppError('无权推送此工程报价通知。',403);
 const existing=(all(s,'ie_quote_notification_delivery') as IeNotificationDelivery[]).filter(d=>input.target==='sales_approval'?d.salesQuoteId===input.quoteId:d.quoteId===input.quoteId&&!d.salesQuoteId);
 const sameKey=existing.find(d=>d.idempotencyKey===input.idempotencyKey);if(sameKey&&sameKey.fingerprint!==input.fingerprint)throw new AppError('同一推送请求编号不能对应不同预览内容。',409);
 const prior=sameKey||existing.find(d=>(d.salesQuoteVersion||d.quoteVersion)===input.quoteVersion&&d.fingerprint===input.fingerprint);
 if(prior)return json({ok:true,alreadyPresent:true,delivery:publicIeNotificationDelivery(prior),history:ieNotificationHistory(s,m,input.quoteId,input.target)});
 if(preview.fingerprint!==input.fingerprint)throw new AppError('报价、角色、收件邮箱或发送配置已变化，请重新预览并核对。',409);
 if(!preview.ready||!transport?.configured||!attachment)throw new AppError(preview.blockers.join('；')||'邮件发送尚未就绪。',409);
 const at=now(),q=all(s,'ie_quote').find(q=>q.id===preview.engineeringQuoteId)!,delivery:IeNotificationDelivery={id:newId('ie_quote_notification_delivery'),kind:'ie_quote_notification_delivery',quoteId:preview.engineeringQuoteId,quoteVersion:preview.engineeringQuoteVersion,...(input.target==='sales_approval'?{salesQuoteId:input.quoteId,salesQuoteVersion:input.quoteVersion}:{}),customerAccountId:q.customerAccountId,fingerprint:input.fingerprint,idempotencyKey:input.idempotencyKey,status:'sending',createdAt:at,createdBy:m.name,createdById:m.id,updatedAt:at,subject:preview.subject,body:preview.body,to:preview.to.map(({memberId,name,email})=>({memberId,name,email})),cc:preview.cc.map(({memberId,name,email})=>({memberId,name,email})),attachment:{filename:attachment.filename,sha256:attachment.sha256,size:attachment.size},providerMessageId:'',message:'已保留本次版本和预览的发送尝试；结果确认前禁止重复发送。'};
 await commit(s.revision,[delivery,audit(m,{id:delivery.id,kind:delivery.kind,quoteId:delivery.quoteId},null,'发起已确认预览的内部通知','IE 工程报价',publicIeNotificationDelivery(delivery))]);
 let result:{status:'sent'|'failed'|'unknown';providerMessageId?:string;message?:string};
 try{result=await transport.send({subject:preview.subject,body:preview.body,to:delivery.to.map(v=>v.email),cc:delivery.cc.map(v=>v.email),attachments:[{filename:attachment.filename,contentType:attachment.contentType,bytes:attachment.bytes,sha256:attachment.sha256}],idempotencyKey:delivery.id});}catch{result={status:'unknown',message:'发送结果未知，请核查邮件服务；系统不会自动重试。'};}
 const fresh=await snapshot(),record=all(fresh,'ie_quote_notification_delivery').find(d=>d.id===delivery.id) as IeNotificationDelivery|undefined;if(!record||record.status!=='sending')throw new AppError('发送尝试状态已变化，请查看历史核对，禁止直接重发。',409);
 const updated:IeNotificationDelivery={...record,status:result.status,updatedAt:now(),providerMessageId:(result.providerMessageId||'').slice(0,200),message:result.status==='sent'?'邮件服务已确认接受本次发送。':result.status==='failed'?'邮件服务报告发送失败，请核查后处理；不会自动重试。':'邮件服务发送结果未知，请核查后处理；不会自动重试。'};
 await commit(fresh.revision,[updated,audit(m,{id:updated.id,kind:updated.kind,quoteId:updated.quoteId},publicIeNotificationDelivery(record),'记录内部通知发送结果','IE 工程报价',publicIeNotificationDelivery(updated))]);
 return json({ok:true,delivery:publicIeNotificationDelivery(updated),history:ieNotificationHistory({...fresh,records:[...fresh.records.filter(r=>r.id!==updated.id),updated]},m,input.quoteId,input.target)});
}
