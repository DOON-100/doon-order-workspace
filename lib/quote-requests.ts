import {z} from 'zod';
import {all,strictDate,type CustomerAccount,type Entity,type Member,type State} from './domain';
import {canMaintainCustomerQuoteAccount,readableCustomerQuoteAccounts} from './customer-quote-access';
import {canFillIeQuote,canReadIeQuote,iePolicyMember} from './ie-quote-access';
import {currentIeQuote} from './ie-quotes';
import {paymentTermsReadOnly} from './payment-terms';

const text=(max=2000)=>z.string().trim().max(max).default('');
export const quoteRequestId=z.string().trim().min(1).max(120);
export const quoteRequestToken=z.string().trim().min(8).max(160);
export const quoteRequestLineSchema=z.object({id:quoteRequestId,model:text(200),customerModel:text(200),color:text(200),quantity:z.number().int().positive().max(10000000).nullable().default(null),material:text(1000),requirements:text(3000),drawingNo:text(200),drawingRevision:text(200)}).strict();
export const quoteRequestSaveSchema=z.object({id:quoteRequestId.optional(),version:z.number().int().positive().optional(),token:quoteRequestToken,customerAccountId:quoteRequestId,title:z.string().trim().min(1,'请填写报价需求名称').max(240),dueDate:text(10).refine(value=>{try{return !value||/^\d{4}-\d{2}-\d{2}$/.test(value)&&strictDate(value)===value;}catch{return false;}},'请选择有效的报价截止日期'),requirementText:text(12000),lines:z.array(quoteRequestLineSchema).min(1).max(100).refine(rows=>new Set(rows.map(r=>r.id)).size===rows.length,'款式行编号不能重复')}).strict();
export type QuoteRequestLine=z.infer<typeof quoteRequestLineSchema>;
export type QuoteRequest=Entity&{kind:'quote_request';version:number;requestNo:string;title:string;customerAccountId:string;customerName:string;customerCode:string;dueDate:string;requirementText:string;lines:QuoteRequestLine[];status:'draft'|'submitted'|'quoting';ieQuoteId:string;attachmentIds:string[];requestedById:string;requestedBy:string;assigneeId:string;assigneeName:string;createdAt:string;updatedAt:string;updatedById:string;updatedBy:string;submittedAt?:string;startedAt?:string};
export type QuoteRequestAttachment=Entity&{kind:'quote_request_attachment';requestId:string;customerAccountId:string;filename:string;contentType:string;size:number;sha256:string;fileKey:string;createdAt:string;createdBy:string;createdById:string};
export type QuoteRequestRevision=Entity&{kind:'quote_request_revision';requestId:string;version:number;action:string;actorId:string;actor:string;createdAt:string;snapshot:QuoteRequest;token:string;fingerprint:string};
export const requestAccount=(s:State,r:Pick<QuoteRequest,'customerAccountId'>)=>all(s,'customer_account').find(a=>a.id===r.customerAccountId) as CustomerAccount|undefined;
export function canWriteQuoteRequest(s:State,m:Member){return m.active&&!['viewer','programmer','supplier','finance'].includes(m.role)&&!paymentTermsReadOnly(s,m);}
export function canCreateQuoteRequestFor(s:State,m:Member,a:CustomerAccount){return !!a.active&&canWriteQuoteRequest(s,m)&&canMaintainCustomerQuoteAccount(s,m,a);}
export function assignedQuoteEngineer(s:State,m:Member,r:QuoteRequest){return m.active&&r.status!=='draft'&&r.assigneeId===m.id&&iePolicyMember(s,'engineer')?.id===m.id;}
export function availableQuoteEngineer(s:State){const engineer=iePolicyMember(s,'engineer');return engineer&&canWriteQuoteRequest(s,engineer)&&canFillIeQuote(s,engineer)?engineer:undefined;}
export function canReadQuoteRequest(s:State,m:Member,r:QuoteRequest){
 if(!m.active||m.role==='supplier'||!requestAccount(s,r))return false;
 if(m.role==='admin')return true;
 if(r.status==='draft')return r.requestedById===m.id&&readableCustomerQuoteAccounts(s,m).some(a=>a.id===r.customerAccountId);
 if(assignedQuoteEngineer(s,m,r))return true;
 const quote=r.ieQuoteId?currentIeQuote(s,r.ieQuoteId):undefined;
 return readableCustomerQuoteAccounts(s,m).some(a=>a.id===r.customerAccountId)||!!quote&&quote.customerAccountId===r.customerAccountId&&canReadIeQuote(s,m,quote);
}
export function canEditQuoteRequest(s:State,m:Member,r:QuoteRequest){const a=requestAccount(s,r);return !!a&&r.status==='draft'&&(r.requestedById===m.id||m.role==='admin')&&canCreateQuoteRequestFor(s,m,a);}
export function canStartQuoteRequest(s:State,m:Member,r:QuoteRequest){return r.status==='submitted'&&canReadQuoteRequest(s,m,r)&&canWriteQuoteRequest(s,m)&&canFillIeQuote(s,m)&&(m.role==='admin'||assignedQuoteEngineer(s,m,r))&&!!requestAccount(s,r)?.active;}
export function publicQuoteRequest(s:State,m:Member,r:QuoteRequest){
 const q=r.ieQuoteId?currentIeQuote(s,r.ieQuoteId):undefined,quote=q?.customerAccountId===r.customerAccountId&&canReadIeQuote(s,m,q)?q:undefined;
 return {...r,status:quote?.status==='released'?'quoted':r.status,quoteStatus:quote?.status||'',canOpenQuote:!!quote,canEdit:canEditQuoteRequest(s,m,r),canSubmit:canEditQuoteRequest(s,m,r)&&!!availableQuoteEngineer(s),canStart:canStartQuoteRequest(s,m,r),
 attachments:(all(s,'quote_request_attachment') as QuoteRequestAttachment[]).filter(a=>r.attachmentIds.includes(a.id)&&a.requestId===r.id&&a.customerAccountId===r.customerAccountId).map(({id,filename,contentType,size,sha256,createdAt,createdBy})=>({id,filename,contentType,size,sha256,createdAt,createdBy,url:`/api/workspace/quote-request-file?id=${encodeURIComponent(r.id)}&attachmentId=${encodeURIComponent(id)}`}))};
}
