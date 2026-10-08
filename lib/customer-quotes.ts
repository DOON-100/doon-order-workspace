import {z} from 'zod';
import {all,clean,strictDate,type CustomerAccount,type Entity,type Member,type State} from './domain';
import {assignedCustomerQuoteAccount,canUseCustomerQuotes,canSeeCustomerQuoteInternal,isCustomerQuoteAdministrator} from './customer-quote-access';
export {canCreateCustomerQuote,canUseCustomerQuotes,eligibleCustomerQuoteAccounts} from './customer-quote-access';

const text=(max:number)=>z.string().trim().max(max);
const required=(max:number)=>text(max).min(1);
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/,'日期格式应为 YYYY-MM-DD').refine(value=>{try{return strictDate(value)===value;}catch{return false;}},'日期不存在或超出有效范围');
const line=z.object({
 id:required(100),model:required(200),descriptionZh:z.string().max(4000),descriptionEn:z.string().max(4000),
 quantity:z.number().finite().int().positive().max(10000000).nullable(),unitPrice:z.number().finite().min(0).max(1e9).nullable(),toolingFee:z.number().finite().min(0).max(1e9).nullable(),
 sourceFormula:z.string().max(500).optional(),
 quantityBasisZh:text(200).optional(),quantityBasisEn:text(200).optional(),
}).strict();
const term=z.object({id:required(100),labelZh:required(200),labelEn:required(200),zh:z.string().max(8000),en:z.string().max(8000),needsReview:z.boolean(),reviewNote:z.string().max(4000).optional()}).strict();
const internalCost=z.object({id:required(100),label:required(240),rmb:z.number().finite().min(0).max(1e9),notes:text(4000).default('')}).strict();
const customerCharge=z.object({id:required(100),labelZh:required(240),labelEn:required(240),amount:z.number().finite().min(0).max(1e9).nullable(),basisZh:text(500),basisEn:text(500),conditional:z.boolean(),needsReview:z.boolean()}).strict();

// Do not coerce strings to numbers: an empty price is not a legitimate zero price.
export const customerQuoteInput=z.object({
 id:required(100).optional(),version:z.number().int().positive().optional(),
 companyEn:required(240),companyZh:required(240),collectionEn:text(240).default(''),collectionZh:text(240).default(''),
 customerCode:text(80),customerName:required(200),customerAccountId:required(120).nullable().default(null),contactName:text(200).optional(),
 quoteNo:required(120),quoteDate:date,validUntil:z.union([date,z.literal('')]),currency:z.string().trim().regex(/^[A-Z]{3}$/,'币种应为三个大写字母'),
 internalNotesZh:text(8000).optional(),exchangeRateCnyPerUsd:z.number().finite().positive().max(10000).nullable().optional(),internalCosts:z.array(internalCost).max(50).optional(),
 customerCharges:z.array(customerCharge).max(50).optional(),
 lines:z.array(line).min(1).max(200),terms:z.array(term).max(50),reviewNotes:z.array(z.string().max(4000)).max(50),
}).strict().superRefine((value,ctx)=>{
 if(value.validUntil&&value.validUntil<value.quoteDate)ctx.addIssue({code:z.ZodIssueCode.custom,path:['validUntil'],message:'报价有效期不能早于报价日期'});
 if(value.id&&!value.version)ctx.addIssue({code:z.ZodIssueCode.custom,path:['version'],message:'编辑报价必须提供当前版本'});
 if(!value.id&&value.version!==undefined)ctx.addIssue({code:z.ZodIssueCode.custom,path:['version'],message:'新报价不应提供版本'});
 for(const key of ['lines','terms','internalCosts','customerCharges'] as const){const items=value[key]||[];if(new Set(items.map(item=>item.id)).size!==items.length)ctx.addIssue({code:z.ZodIssueCode.custom,path:[key],message:'同一报价中的行编号不可重复'});}
});

export type CustomerQuoteFields=Omit<z.infer<typeof customerQuoteInput>,'id'|'version'>;
export type CustomerQuote=Entity & CustomerQuoteFields & {
 kind:'customer_quote';status:'draft'|'confirmed';version:number;createdAt:string;createdBy:string;createdById:string;updatedAt:string;updatedBy:string;updatedById:string;
 confirmedAt?:string;confirmedBy?:string;confirmedById?:string;
 sourceFilename?:string;sourceHash?:string;sourceFileKey?:string;sourceContentType?:string;
};
export type CustomerQuoteRevision=Entity & {kind:'customer_quote_revision';quoteId:string;version:number;action:string;updatedAt:string;updatedBy:string;snapshot:CustomerQuote};
export type CustomerQuoteCompleted=Entity & {
 kind:'customer_quote_completed';quoteId:string;quoteVersion:number;lineId:string;quoteNo:string;customerAccountId:string|null;customerCode:string;customerName:string;contactName:string;
 model:string;descriptionZh:string;descriptionEn:string;quantity:number;unitPriceUsd:number;toolingFeeUsd:number|null;currency:'USD';quoteDate:string;validUntil:string;
 quantityBasisZh?:string;quantityBasisEn?:string;customerCharges:NonNullable<CustomerQuoteFields['customerCharges']>;
 confirmedAt:string;confirmedBy:string;confirmedById:string;quotedCustomer:'';
};
const key=(v:unknown)=>clean(v).toLowerCase();

export function quoteAccount(s:State,id:string|null){return id?all(s,'customer_account').find(a=>a.id===id) as CustomerAccount|undefined:undefined;}
export function assignedCustomerQuote(s:State,m:Member,q:Pick<CustomerQuoteFields,'customerAccountId'|'customerName'|'customerCode'>){
 const a=quoteAccount(s,q.customerAccountId);
 return !!a&&assignedCustomerQuoteAccount(s,m,a);
}
export function canEditCustomerQuote(s:State,m:Member,q:CustomerQuote){
 return q.status==='draft'&&canReadCustomerQuote(s,m,q);
}
export function canReadCustomerQuote(s:State,m:Member,q:CustomerQuote){
 return canUseCustomerQuotes(s,m)&&(isCustomerQuoteAdministrator(m,s)||assignedCustomerQuote(s,m,q));
}
export function changedQuoteCustomer(before:CustomerQuote,after:CustomerQuoteFields){return ['customerAccountId','customerName','customerCode'].some(field=>key(before[field])!==key(after[field as keyof CustomerQuoteFields]));}
export function mayChangeQuoteCustomer(s:State,m:Member,next:CustomerQuoteFields){return isCustomerQuoteAdministrator(m,s)||assignedCustomerQuote(s,m,next);}

// Explicit response allowlist. Bucket keys and full historical snapshots remain server-side.
export function publicCustomerQuote(s:State,m:Member,q:CustomerQuote){
 const internal=canSeeCustomerQuoteInternal(s,m),administrator=isCustomerQuoteAdministrator(m,s);
 const history=(all(s,'customer_quote_revision') as CustomerQuoteRevision[]).filter(v=>v.quoteId===q.id&&v.snapshot&&canReadCustomerQuote(s,m,v.snapshot)).sort((a,b)=>b.version-a.version).map(v=>({
  id:v.id,version:v.version,status:v.snapshot.status,action:v.action,updatedAt:v.updatedAt,updatedBy:v.updatedBy,sourceFilename:v.snapshot.sourceFilename||'',sourceHash:v.snapshot.sourceHash||'',
 }));
 return {
  id:q.id,version:q.version,status:q.status,companyEn:q.companyEn,companyZh:q.companyZh,collectionEn:q.collectionEn,collectionZh:q.collectionZh,
  customerCode:q.customerCode,customerName:q.customerName,customerAccountId:q.customerAccountId,contactName:q.contactName||'',quoteNo:q.quoteNo,quoteDate:q.quoteDate,validUntil:q.validUntil,currency:q.currency,
  ...(internal?{internalNotesZh:q.internalNotesZh||'',exchangeRateCnyPerUsd:q.exchangeRateCnyPerUsd??null,internalCosts:q.internalCosts||[]}:{}),canSeeInternal:internal,customerCharges:q.customerCharges||[],
  lines:q.lines,terms:q.terms,reviewNotes:q.reviewNotes,createdAt:q.createdAt,createdBy:q.createdBy,updatedAt:q.updatedAt,updatedBy:q.updatedBy,
  confirmedAt:q.confirmedAt||'',confirmedBy:q.confirmedBy||'',sourceFilename:q.sourceFilename||'',sourceHash:q.sourceHash||'',hasSource:administrator&&!!q.sourceFileKey,canEdit:canEditCustomerQuote(s,m,q),canConfirm:q.status==='draft'&&administrator,canRevise:q.status==='confirmed'&&canReadCustomerQuote(s,m,q),history,
 };
}
