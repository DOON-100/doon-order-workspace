import {z} from 'zod';
import {all,clean,readStateIndexToken,strictDate,type CustomerAccount,type Entity,type Member,type State} from './domain';
import {customerQuoteAccessPolicy} from './customer-quote-access';
import {matchesCustomerResponsibility} from './customer-responsibility';
import {historicalCustomerIdentities} from './customer-identities';
import {paymentTermsReadOnly} from './payment-terms';

export const serviceTypes=['customer_profile','followup','project','sample','shipment','receivable'] as const;
export const serviceTypeLabels={customer_profile:'客户联系档案',followup:'日常跟进',project:'新款 / 项目',sample:'样办 / 确认',shipment:'出货 / 单据',receivable:'应收 / 核销'} as const;
export const serviceCurrencies=['CNY','USD','EUR','GBP','HKD'] as const;
export type ServiceType=typeof serviceTypes[number];
export type ServiceCurrency=typeof serviceCurrencies[number];
export type ServiceRecord=Entity & {
 kind:'service_record';type:ServiceType;version:number;customerId:string;orderId:string;
 teamId?:string;ownerId?:string;serviceReviewerId?:string;salesReviewerId?:string;
 title:string;description:string;status:'open'|'done'|'cancelled';
 waitingFor:'none'|'customer'|'factory'|'jennifer';dueDate:string;nextFollowUp:string;
 details:Record<string,string|number>;createdAt:string;updatedAt:string;updatedBy:string;
};
export type ServiceReceipt=Entity & {
 kind:'service_receipt';recordId:string;customerId:string;entryType:'payment'|'reversal';
 amountCents:number;currency:ServiceCurrency;date:string;reference:string;note:string;
 reversesId:string;reason:string;actorId:string;actor:string;createdAt:string;requestFingerprint:string;
};
export type ServiceAttachment=Entity & {
 kind:'service_attachment';recordId:string;customerId:string;filename:string;fileKey:string;
 category?:'general'|'reference-image';
 contentType:string;size:number;hash:string;note:string;actorId:string;actor:string;createdAt:string;
};
export type ServiceRevision=Entity & {
 kind:'service_revision';recordId:string;customerId:string;version:number;action:string;
 actorId:string;actor:string;createdAt:string;snapshot:ServiceRecord;
};

const nameKey=(value:unknown)=>clean(value).toLowerCase();
const readRoles=new Set(['admin','sales','clerk','pmc','finance']);
export function assignedServiceCustomer(s:State,m:Member,account:CustomerAccount){
 if(!m.active||!readRoles.has(m.role))return false;
 if(m.role==='admin')return true;
 if(!account.active)return false;
 // A quote grant is not required for CRM. Only administrator-configured aliases
 // are reused; broad order scopes and guessed English names never grant access.
 const policy=customerQuoteAccessPolicy(s);
 const aliases=policy&&Object.prototype.hasOwnProperty.call(policy.aliasesByMember,m.id)?policy.aliasesByMember[m.id]:[];
 return matchesCustomerResponsibility(account,m,'sales',aliases)||matchesCustomerResponsibility(account,m,'service',aliases);
}
export function serviceCustomerAccounts(s:State,m:Member):CustomerAccount[]{
 return (all(s,'customer_account') as CustomerAccount[]).filter(account=>assignedServiceCustomer(s,m,account));
}
type OrderCustomerIdentityIndex={owners:Map<string,Set<string>>;profiles:Map<string,Entity[]>;historyState:State;keys:WeakMap<CustomerAccount,string[]>};
const orderCustomerIdentityIndexes=new WeakMap<object,OrderCustomerIdentityIndex>();
function orderCustomerIdentityIndex(s:State):OrderCustomerIdentityIndex{
 const token=readStateIndexToken(s),saved=token&&orderCustomerIdentityIndexes.get(token);
 if(saved)return saved;
 const accounts=all(s,'customer_account') as CustomerAccount[];
 const profiles=new Map<string,Entity[]>();
 for(const row of all(s,'service_record'))if(row.type==='customer_profile'){
  const rows=profiles.get(row.customerId);if(rows)rows.push(row);else profiles.set(row.customerId,[row]);
 }
 // Use an independent history snapshot even when the same State is reindexed.
 // The history helper's own State cache must never retain an earlier GET index.
 const historyState:State={revision:s.revision,records:all(s,'customer_workflow_identity')},owners=new Map<string,Set<string>>();
 for(const other of accounts){
  const claims=(profiles.get(other.id)||[]).map(row=>row.source?.confirmedCustomerCode)
   .filter((value):value is string=>typeof value==='string'&&clean(value).length>0&&clean(value).length<=160);
  for(const value of [other.customer,other.customerCode,...claims,...historicalCustomerIdentities(historyState,other.id)]){
   const key=nameKey(value);if(!key)continue;
   const ids=owners.get(key);if(ids)ids.add(other.id);else owners.set(key,new Set([other.id]));
  }
 }
 const index={owners,profiles,historyState,keys:new WeakMap<CustomerAccount,string[]>()};
 if(token)orderCustomerIdentityIndexes.set(token,index);return index;
}
/** Explicit reviewed identities only; ambiguous codes never join an order. */
export function serviceOrderCustomerKeys(s:State,account:CustomerAccount):string[]{
 const index=orderCustomerIdentityIndex(s),saved=index.keys.get(account);if(saved)return saved.slice();
 const matches=index.profiles.get(account.id)||[],value=matches.length===1?matches[0].source?.confirmedCustomerCode:'';
 const confirmed=typeof value==='string'&&clean(value).length<=160?clean(value):'';
 const candidates=[account.customer,account.customerCode,confirmed,...historicalCustomerIdentities(index.historyState,account.id)].map(clean).filter(Boolean);
 const result=[...new Set(candidates)].filter(candidate=>{
  const owners=index.owners.get(nameKey(candidate));return !owners||owners.size===1&&owners.has(account.id);
 });
 index.keys.set(account,result);return result.slice();
}
export function canWriteServiceWorkspace(s:State,m:Member){
 if(!m.active||paymentTermsReadOnly(s,m))return false;
 if(m.role==='admin')return true;
 // Some customer-service accounts historically carry the PMC role. That role
 // alone grants nothing here: they still need an exact sales/service assignment.
 return ['sales','clerk','pmc'].includes(m.role)&&serviceCustomerAccounts(s,m).some(account=>account.active);
}
export function canReadServiceRecord(s:State,m:Member,record:Entity){
 if(!record.kind.startsWith('service_'))return false;
 const owner=record.kind==='service_record'?record:all(s,'service_record').find(row=>row.id===record.recordId);
 if(!owner||owner.kind!=='service_record'||(record.customerId&&record.customerId!==owner.customerId))return false;
 const account=all(s,'customer_account').find(row=>row.id===owner.customerId) as CustomerAccount|undefined;
 return !!account&&assignedServiceCustomer(s,m,account);
}

export const serviceIdSchema=z.string().trim().min(1).max(160);
const text=(max:number)=>z.string().trim().max(max).default('');
const day=z.string().trim().default('').superRefine((value,ctx)=>{
 if(!value)return;
 try{if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||strictDate(value)!==value)throw new Error();}
 catch{ctx.addIssue({code:z.ZodIssueCode.custom,message:'日期须为有效的 YYYY-MM-DD（2000—2100 年）'});}
});

/** Parse decimal money without binary floating-point multiplication or rounding. */
export function serviceMoneyCents(value:unknown):number{
 const raw=typeof value==='number'?String(value):typeof value==='string'?value.trim():'';
 if(!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(raw))throw new Error('金额须为非负数，最多两位小数，不接受科学计数法');
 const [whole,fraction='']=raw.split('.'),cents=Number(whole)*100+Number(fraction.padEnd(2,'0'));
 if(!Number.isSafeInteger(cents)||cents>100_000_000_000)throw new Error('金额超出上限 1,000,000,000');
 return cents;
}
const money=z.union([z.string(),z.number()]).transform((value,ctx)=>{
 try{return serviceMoneyCents(value);}catch(e){ctx.addIssue({code:z.ZodIssueCode.custom,message:(e as Error).message});return z.NEVER;}
});
const approval=z.enum(['pending','approved','rejected','not_required']).default('pending');
export const serviceDetailsSchemas={
 customer_profile:z.object({contactPerson:text(240),email:z.string().trim().max(240).default('').refine(value=>!value||z.string().email().safeParse(value).success,'请填写有效的联系邮箱'),phone:text(240),address:text(3000)}).strict(),
 followup:z.object({category:text(120)}).strict(),
 project:z.object({model:text(160),drawing:text(160),stage:text(160)}).strict(),
 sample:z.object({model:text(160),drawing:text(160),sampleType:text(160),approvalCustomer:approval,approvalColor:approval,approvalEngraving:approval,approvalAccessory:approval,trackingNo:text(240)}).strict(),
 shipment:z.object({invoiceNo:text(160),quantity:z.preprocess(value=>typeof value==='string'&&!value.trim()?undefined:value,z.number().int().positive().max(100_000_000).optional()),shipDate:day,carrier:text(240),trackingNo:text(240),packingNote:text(3000)}).strict(),
 receivable:z.object({invoiceNo:text(160),currency:z.enum(serviceCurrencies).default('USD'),amount:z.preprocess(value=>typeof value==='string'&&!value.trim()?undefined:value,money.optional()),terms:text(3000)}).strict(),
};
export const serviceSaveSchema=z.object({
 id:serviceIdSchema.optional(),version:z.number().int().positive().optional(),token:z.string().uuid().optional(),sourceOrderVersion:z.number().int().positive().optional(),
 type:z.enum(serviceTypes),customerId:serviceIdSchema,orderId:z.string().trim().max(160).default(''),
 teamId:z.string().trim().max(160).optional(),ownerId:z.string().trim().max(160).optional(),
 serviceReviewerId:z.string().trim().max(160).optional(),salesReviewerId:z.string().trim().max(160).optional(),
 title:text(300),description:text(10000),
 status:z.enum(['open','done','cancelled']).default('open'),
 waitingFor:z.enum(['none','customer','factory','jennifer']).default('none'),
 dueDate:day,nextFollowUp:day,details:z.record(z.unknown()).default({}),
}).strict().superRefine((value,ctx)=>{
 if(value.sourceOrderVersion!==undefined&&(!value.token||!value.orderId))ctx.addIssue({code:z.ZodIssueCode.custom,path:['sourceOrderVersion'],message:'来源版本须绑定操作标识和明确订单'});
 if(value.token&&value.orderId&&value.sourceOrderVersion===undefined)ctx.addIssue({code:z.ZodIssueCode.custom,path:['sourceOrderVersion'],message:'请提供关联订单当前版本'});
 if(value.id&&!value.version)ctx.addIssue({code:z.ZodIssueCode.custom,path:['version'],message:'更新时必须提供当前版本号'});
 if(!value.id&&value.version!==undefined)ctx.addIssue({code:z.ZodIssueCode.custom,path:['version'],message:'新记录不能指定历史版本号'});
});
/** Shared strict validation for the API and a reviewed, additive migration. */
export function validateServiceRecordInput(value:unknown){
 const input=serviceSaveSchema.parse(value),validated=serviceDetailsSchemas[input.type].parse(input.details);
 let details:Record<string,string|number>=validated as Record<string,string|number>;
 if(input.type==='receivable'){
  const {amount,...other}=validated as {amount?:number;invoiceNo:string;currency:ServiceCurrency;terms:string};
  details={...other,...(amount===undefined?{}:{amountCents:amount})};
 }
 return {...input,title:input.title||serviceTypeLabels[input.type],details};
}
export const serviceReceiptSchema=z.object({
 recordId:serviceIdSchema,version:z.number().int().positive(),amount:money.refine(value=>value>0,'到账金额须大于零'),
 date:day.refine(Boolean,'请填写实际到账日期'),reference:text(240),note:text(3000),token:z.string().uuid(),
}).strict();
export const serviceReceiptReverseSchema=z.object({
 receiptId:serviceIdSchema,version:z.number().int().positive(),reason:z.string().trim().min(2,'请填写冲销原因').max(3000),token:z.string().uuid(),
}).strict();

export function serviceReceivedCents(s:State,recordId:string){
 return (all(s,'service_receipt') as ServiceReceipt[]).filter(row=>row.recordId===recordId)
  .reduce((sum,row)=>sum+(row.entryType==='reversal'?-row.amountCents:row.amountCents),0);
}
export function publicServiceRecord(s:State,record:ServiceRecord){
 if(record.type!=='receivable')return record;
 const receivedCents=serviceReceivedCents(s,record.id),amountCents=record.details.amountCents;
 if(!Number.isSafeInteger(amountCents))return {...record,details:{...record.details,amount:''},receivedCents,balanceCents:null};
 return {...record,details:{...record.details,amount:(Number(amountCents)/100).toFixed(2)},receivedCents,balanceCents:Number(amountCents)-receivedCents};
}
export function publicServiceReceipt(receipt:ServiceReceipt){const {requestFingerprint,...safe}=receipt;return safe;}
export function publicServiceAttachment(attachment:ServiceAttachment){const {fileKey,...safe}=attachment;return safe;}

export function serviceTotalsByCurrency(s:State,records:ServiceRecord[]){
 const totals:Partial<Record<ServiceCurrency,{amountCents:number;receivedCents:number;balanceCents:number;pendingAmountCount?:number}>>={};
 for(const record of records){
  if(record.type!=='receivable'||record.status==='cancelled')continue;
  const currency=record.details.currency as ServiceCurrency;
  const row=totals[currency]||(totals[currency]={amountCents:0,receivedCents:0,balanceCents:0});
  if(!Number.isSafeInteger(record.details.amountCents)){row.pendingAmountCount=(row.pendingAmountCount||0)+1;continue;}
  row.amountCents+=Number(record.details.amountCents);row.receivedCents+=serviceReceivedCents(s,record.id);row.balanceCents=row.amountCents-row.receivedCents;
 }
 return totals;
}
