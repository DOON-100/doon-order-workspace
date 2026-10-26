import {all,type CustomerAccount,type Entity,type Member,type State} from './domain';
import {canMaintainCustomerQuoteAccount,customerQuoteAccessPolicy} from './customer-quote-access';
import {matchesCustomerResponsibility} from './customer-responsibility';
import {canConfigureIeQuotes,canReadIeQuote,iePolicyMember,ieQuotePolicy,isIeApprover,isIeEngineeringMember} from './ie-quote-access';
import {currentIeQuote,ieQuoteVersion,type IeQuote} from './ie-quotes';
import {canReadCustomerQuote,mayChangeQuoteCustomer,type CustomerQuote} from './customer-quotes';
import {memberNotificationMailbox,validMemberNotificationEmail,type MemberNotificationMailbox} from './member-notification-mailboxes';

export type IeNotificationMailbox=MemberNotificationMailbox;
export type IeNotificationAttachment={filename:string;contentType:string;bytes:Uint8Array;sha256:string;size:number;templateId:string;templateSha256:string};
export type IeNotificationDelivery=Entity & {kind:'ie_quote_notification_delivery';quoteId:string;quoteVersion:number;salesQuoteId?:string;salesQuoteVersion?:number;customerAccountId:string;fingerprint:string;idempotencyKey:string;status:'sending'|'sent'|'failed'|'unknown';createdAt:string;createdBy:string;createdById:string;updatedAt:string;subject:string;body:string;to:{memberId:string;name:string;email:string}[];cc:{memberId:string;name:string;email:string}[];attachment:{filename:string;sha256:string;size:number};providerMessageId:string;message:string};
export type IeNotificationTransport={configured:boolean;from:string;workspaceBaseUrl:string;send:(payload:{subject:string;body:string;to:string[];cc:string[];attachments:{filename:string;contentType:string;bytes:Uint8Array;sha256:string}[];idempotencyKey:string})=>Promise<{status:'sent'|'failed'|'unknown';providerMessageId?:string;message?:string}>};
export const validIeNotificationEmail=validMemberNotificationEmail;
export const canPushIeNotification=(s:State,m:Member)=>m.active&&(canConfigureIeQuotes(m)||isIeEngineeringMember(s,m)||isIeApprover(s,m));
export const ieNotificationMailbox=memberNotificationMailbox;
export function ieNotificationCandidates(s:State,q:IeQuote){
 const account=all(s,'customer_account').find(a=>a.id===q.customerAccountId) as CustomerAccount|undefined;
 const roleIds=new Map((['engineer','reviewer','finalApprover'] as const).map(role=>[iePolicyMember(s,role)?.id,role==='engineer'?'工程主管':role==='reviewer'?'生产副总':'总经理']));
 return (all(s,'member') as Member[]).filter(m=>m.active&&m.role!=='supplier'&&(roleIds.has(m.id)||!!account&&m.role!=='admin'&&canMaintainCustomerQuoteAccount(s,m,account)&&matchesCustomerResponsibility(account,m,'sales',customerQuoteAccessPolicy(s)?.aliasesByMember[m.id]||[]))).map(m=>{
  const binding=ieNotificationMailbox(s,m.id),valid=!!binding?.confirmed&&validIeNotificationEmail(binding.email);
  return {memberId:m.id,name:m.name,email:valid?binding!.email:'',mailboxVersion:binding?.version||0,reason:roleIds.get(m.id)||'本客户已授权业务',configured:valid};
 });
}
const digest=async(value:unknown)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(n=>n.toString(16).padStart(2,'0')).join('');
export async function buildIeNotificationPreview(s:State,m:Member,quoteId:string,quoteVersion:number,transport:IeNotificationTransport|null=null,attachment:IeNotificationAttachment|null=null,attachmentProblem='',sales?:CustomerQuote){
 const q=ieQuoteVersion(s,quoteId,quoteVersion),current=currentIeQuote(s,quoteId);if(!q||!current||q.customerAccountId!==current.customerAccountId||!canReadIeQuote(s,m,q)||!canReadIeQuote(s,m,current))return null;
 const candidates=ieNotificationCandidates(s,q),byId=new Map(candidates.map(c=>[c.memberId,c])),blockers:string[]=[];
 const recipientMemberIds=sales?[iePolicyMember(s,'finalApprover')?.id||'']:q.status==='submitted'?[q.requiredReviewMemberId]:q.status==='released'?candidates.filter(c=>c.reason==='本客户已授权业务').map(c=>c.memberId):[];
 const ccMemberIds=!sales&&q.status==='released'?[iePolicyMember(s,'engineer')?.id||'',iePolicyMember(s,'reviewer')?.id||''].filter(id=>id&&!recipientMemberIds.includes(id)):[],ids=[...recipientMemberIds,...ccMemberIds];
 if(!sales&&current.version!==quoteVersion)blockers.push('报价已有新版本，请重新预览当前版本。');
 if(sales&&sales.status!=='draft')blockers.push('只有尚未批准的客价草稿可以推送总经理审批通知。');
 if(!sales&&!['submitted','released'].includes(q.status))blockers.push('此状态尚不在已确认的自动收件规则内；请先提交或发布报价。');
 if(!recipientMemberIds.length)blockers.push(q.status==='released'?'本客户尚未配置有工程成本查看权限的负责业务。':'未找到有效的指定工程复核人。');
 if(new Set(ids).size!==ids.length)blockers.push('收件人与抄送不能重复。');
 if(ids.some(id=>!byId.has(id)))blockers.push('所选人员不在此报价的工程角色或业务客户范围内。');
 if(ids.some(id=>!byId.get(id)?.email))blockers.push('所选人员尚未绑定并确认真实通知邮箱；登录账号邮箱不能直接用于发送。');
 const to=recipientMemberIds.flatMap(id=>byId.has(id)?[byId.get(id)!]:[]),cc=ccMemberIds.flatMap(id=>byId.has(id)?[byId.get(id)!]:[]);
 const boundEmails=[...to,...cc].flatMap(v=>v.email?[v.email.toLowerCase()]:[]);
 if(new Set(boundEmails).size<boundEmails.length)blockers.push('所选人员的通知邮箱重复，请核对共享邮箱收件范围。');
 let link='中台共享访问地址待管理员配置';if(transport?.workspaceBaseUrl){try{const u=new URL(transport.workspaceBaseUrl);if(['localhost','127.0.0.1','::1','[::1]'].includes(u.hostname)||u.username||u.password||!['http:','https:'].includes(u.protocol))blockers.push('通知链接须为收件人可访问的共享中台地址，不能使用本机环回地址。');else link=new URL((sales?'/customer-quotes':'/ie-quotes')+'?recordId='+encodeURIComponent(sales?.id||q.id),u.origin).href;}catch{blockers.push('共享中台访问地址无效。');}}else blockers.push('尚未配置收件人可访问的共享中台地址。');
 if(!transport?.configured)blockers.push('尚未配置并验证真实邮件发送服务；不会记录为已发送。');
 else if(!validIeNotificationEmail(transport.from))blockers.push('发送服务的发件地址无效。');
 const engineerMailbox=ieNotificationMailbox(s,iePolicyMember(s,'engineer')?.id||'');
 if(!engineerMailbox?.confirmed||!transport?.from||engineerMailbox.email.toLowerCase()!==transport.from.toLowerCase())blockers.push('发件地址须与管理员为工程主管明确绑定的真实通知邮箱一致。');
 if(!attachment)blockers.push(attachmentProblem||'尚未生成并核验当前工程版本的原 Excel 附件；缺模板不能发送。');
 const stateLabel={draft:'草稿',submitted:'待复核',returned:'退回补充',released:'已复核发布'}[q.status],subject=sales?`客户报价 ${sales.quoteNo} · V${sales.version} · 待总经理审批`:`IE 工程报价 ${q.quoteNo} · R${q.revision}/V${q.version} · ${stateLabel}`;
 const salesSummary=sales?`客户报价待总经理审批\n客价编号：${sales.quoteNo}\n客价版本：V${sales.version}\n业务最终价格：${sales.lines.map(l=>`${l.model} / 数量 ${l.quantity??'待填'} / 单价 ${l.unitPrice??'待填'} ${sales.currency}`).join('；')}\n\n工程依据：\n`:'';
 const body=salesSummary+`IE 工程报价流程通知\n\n报价编号：${q.quoteNo}\n报价版本：R${q.revision} / V${q.version}\n客户：${q.customerName}（${q.customerCode}）\n款式：${q.lines.map(l=>`${l.model} / ${l.color}`).join('；')}\n流程状态：${stateLabel}\n更新人：${sales?.updatedBy||q.updatedBy}\n更新时间：${sales?.updatedAt||q.updatedAt}\n\n请登录中台工作空间查看授权范围内的报价及修改日志：\n${link}\n\n附件为此工程报价版本的内部成本 Excel，仅限授权内部收件人使用；业务最终对客报价另行定价及审批。`;
 const attachmentMeta=attachment?{filename:attachment.filename,sha256:attachment.sha256,size:attachment.size,templateId:attachment.templateId,templateSha256:attachment.templateSha256}:null;
 const fingerprint=await digest({quote:q,salesQuote:sales||null,policy:ieQuotePolicy(s),to,cc,subject,body,from:transport?.from||'',transportConfigured:!!transport?.configured,workspaceBaseUrl:transport?.workspaceBaseUrl||'',attachment:attachmentMeta,ruleVersion:'ie-mail-v1-confirmed-flow'});
 const canPush=sales?canReadCustomerQuote(s,m,sales)&&mayChangeQuoteCustomer(s,m,sales):canPushIeNotification(s,m);if(!canPush)blockers.push('当前成员只有查看权限，不能推送此报价通知。');
 return {quoteId:sales?.id||q.id,quoteVersion:sales?.version||q.version,engineeringQuoteId:q.id,engineeringQuoteVersion:q.version,subject,body,to,cc,candidates:candidates.map(c=>({...c,suggestedEmail:c.memberId===iePolicyMember(s,'engineer')?.id?transport?.from||'':''})),fingerprint,canPush,ready:canPush&&!blockers.length,blockers:[...new Set(blockers)],transport:{configured:!!transport?.configured,from:transport?.from||''},attachmentMode:'engineering_xlsx' as const,attachment:attachmentMeta,proposal:false,
  canConfigureMailboxes:canConfigureIeQuotes(m),mailboxes:canConfigureIeQuotes(m)?candidates.map(c=>({memberId:c.memberId,email:ieNotificationMailbox(s,c.memberId)?.email||'',version:ieNotificationMailbox(s,c.memberId)?.version||0})):[],
 };
}
export function publicIeNotificationDelivery(d:IeNotificationDelivery){const {id,status,createdAt,createdBy,updatedAt,message,providerMessageId}=d;return {id,quoteVersion:d.salesQuoteVersion||d.quoteVersion,engineeringQuoteVersion:d.quoteVersion,status,createdAt,createdBy,updatedAt,message,providerMessageId};}
export function ieNotificationHistory(s:State,m:Member,quoteId:string,target:'engineering'|'sales_approval'='engineering'){const sales=target==='sales_approval'?all(s,'customer_quote').find(q=>q.id===quoteId) as CustomerQuote|undefined:undefined,q=target==='engineering'?currentIeQuote(s,quoteId):sales;if(!q||(sales?!canReadCustomerQuote(s,m,sales):!canReadIeQuote(s,m,q as IeQuote)))return [];return (all(s,'ie_quote_notification_delivery') as IeNotificationDelivery[]).filter(d=>(sales?d.salesQuoteId===quoteId:d.quoteId===quoteId&&!d.salesQuoteId)&&d.customerAccountId===q.customerAccountId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(publicIeNotificationDelivery);}
