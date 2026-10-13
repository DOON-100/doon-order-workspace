import {z} from 'zod';
import {all,canRead,clean,strictDate,type CustomerAccount,type Entity,type Member,type Order,type State} from './domain';
import {communicationAccess,canReviewCommunication,type Communication,type CommunicationLinks} from './unified-communication';
import {serviceOrderCustomerKeys} from './service-workspace';
import {canReadServiceRecord,type ServiceRecord} from './service-workspace';
import {canReadDrawing,type EngineeringDrawing} from './engineering-drawings';
import {paymentRequestLedgerCurrent} from './handoff-business-evidence';
import {assignedCustomerQuoteAccount,canUseCustomerQuotes,customerQuoteServiceReadOnly} from './customer-quote-access';

export {businessSourceTypes,businessDocumentTypes,businessNames,businessSections} from './handoff-business-catalog';
import {businessSourceTypes,businessDocumentTypes} from './handoff-business-catalog';
export type BusinessRow=Entity&CommunicationLinks&{kind:'handoff_business_source'|'handoff_business_document';type:string;version:number;number:string;status:'draft'|'pending_check'|'checked';fields:Record<string,string>;lines:BusinessLine[];sourceRefs:{id:string;version:number}[];sourceSnapshots:Entity[];createdAt:string;updatedAt:string;updatedBy:string};
export type BusinessLine={orderLineId:string;description:string;quantity:number;unitPrice:string};
export type BusinessOrigin={id:string;kind:'order'|'engineering_drawing'|'service_record';version:number};
const text=(max=3000)=>z.string().trim().max(max).default('');
const id=z.string().trim().min(1).max(160);
const day=text(10).refine(value=>{try{return !value||/^\d{4}-\d{2}-\d{2}$/.test(value)&&strictDate(value)===value;}catch{return false;}},'日期须为有效 YYYY-MM-DD');
const currency=z.enum(['','CNY','USD','EUR','GBP','HKD']).default('');
const depositPercent=text(30).refine(v=>!v||/^(?:0|[1-9]\d?|100)(?:\.\d{1,2})?$/.test(v)&&Number(v)>0&&Number(v)<=100,'约定定金比例须大于0且不超过100，最多两位小数');
const money=text(30).refine(v=>!v||/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(v),'金额须非负、最多两位小数；未知请留空');
const positive=text(30).refine(v=>!v||/^(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/.test(v)&&Number(v)>0,'请填大于零的数值');
const packing={shippingContact:text(240),shippingPhone:text(240),courierAccount:text(240),cartonCount:text(20).refine(v=>!v||/^[1-9]\d{0,6}$/.test(v),'箱数须为正整数'),netWeight:positive,grossWeight:positive,cartonDimensions:text(1000),cartonDetails:text(6000)};
const commercial={date:day,currency,buyer:text(500),seller:text(500),billingAddress:text(6000),shippingAddress:text(6000),paymentTerms:text(6000),depositPercent,tradeTerms:text(3000),paymentDueDate:day,delivery:text(3000)};
const source={path:text(3000),confirmedBy:text(240),notes:text(10000)};
export const businessFieldSchemas={
 po:z.object({...commercial,...source,reference:text(240)}).strict(),
 engineering_drawing:z.object({...source,style:text(240),versionLabel:text(120),title:text(500),drawingNumber:text(240),date:day,customerConfirmation:text(6000),productionAdoption:text(6000),linkedDrawingId:text(160)}).strict(),
 engineering_quote:z.object({...source,style:text(240),versionLabel:text(120),title:text(500),date:day,currency,salesReferencePrice:money}).strict(),
 production_order:z.object({...source,style:text(240),dueDate:day,pmcId:text(160),requirements:text(10000),materials:text(6000),depositPercent,receivableId:text(160),depositEvidence:text(6000),engineeringTaskId:text(160),materialState:z.enum(['未开始','备料中','缺料','物料齐备']).default('未开始'),purchaseState:z.enum(['未开始','采购中','待到料','采购完成','无需采购']).default('未开始'),materialDue:day,plannedStart:day,progressNote:text(6000)}).strict(),
 production_shipment:z.object({...source,...packing,date:day,shippingAddress:text(6000),piId:text(160)}).strict(),
 finance_file:z.object({...source,date:day,currency,category:z.enum(['deposit','balance','refund','statement','taxinvoice','other']),amount:money,actualState:z.enum(['客户付款凭证','退款申请','对账资料','税务发票资料','其他资料']).default('其他资料'),period:text(240)}).strict(),
 finance_request:z.object({...source,dueDate:day,recipientId:text(160),requestType:z.enum(['收款核对','对账','退款核对']),body:text(12000),result:text(12000)}).strict(),
 document:z.object({...commercial,...packing,reference:text(240),notes:text(10000),templateLabel:text(500),manualBasis:text(6000)}).strict(),
};
const line=z.object({orderLineId:text(160),description:z.string().trim().min(1).max(1000),quantity:z.number().int().positive().max(100000000),unitPrice:money}).strict();
export const businessSaveSchema=z.object({token:z.string().uuid(),id:id.optional(),expectedVersion:z.number().int().positive().optional(),kind:z.enum(['source','document']),type:z.string().min(1).max(100),customerId:id,projectId:text(160),orderId:text(160),number:z.string().trim().min(1).max(240),fields:z.record(z.unknown()),lines:z.array(line).max(50),originRefs:z.array(z.object({id,kind:z.enum(['order','engineering_drawing','service_record']),version:z.number().int().positive()}).strict()).max(50).default([]),sourceRefs:z.array(z.object({id,version:z.number().int().positive()}).strict()).max(50)}).strict().superRefine((v,c)=>{
 if(v.id&&!v.expectedVersion)c.addIssue({code:'custom',path:['expectedVersion'],message:'修改必须提供当前版本'});
 if(!v.id&&v.expectedVersion!==undefined)c.addIssue({code:'custom',path:['expectedVersion'],message:'新资料不能带历史版本'});
 if(new Set(v.sourceRefs.map(r=>r.id)).size!==v.sourceRefs.length)c.addIssue({code:'custom',path:['sourceRefs'],message:'来源不能重复'});
});
export const businessActionSchema=z.object({token:z.string().uuid(),id,expectedVersion:z.number().int().positive(),note:text(6000)}).strict();
export const businessGenerateSchema=z.object({token:z.string().uuid(),sourceId:id,sourceVersion:z.number().int().positive(),type:z.enum(businessDocumentTypes),number:z.string().trim().min(1).max(240),piId:text(160),piVersion:z.number().int().positive().optional(),targetId:id.optional(),expectedVersion:z.number().int().positive().optional()}).strict().superRefine((v,c)=>{if((v.targetId||v.expectedVersion)&&(v.type!=='paymentrequest'||!v.targetId||!v.expectedVersion))c.addIssue({code:'custom',path:['targetId'],message:'更新请款必须同时指定原请款及当前版本'});});
export function businessFields(type:string,kind:'source'|'document',raw:unknown){
 const schema=kind==='document'?businessFieldSchemas.document:businessFieldSchemas[type as keyof typeof businessFieldSchemas];
 if(!schema||!(kind==='document'?businessDocumentTypes:businessSourceTypes).includes(type as never))throw new Error('不支持的业务资料类型');
 const result=schema.parse(raw) as Record<string,string>;
 if(result.netWeight&&result.grossWeight&&Number(result.grossWeight)<Number(result.netWeight))throw new Error('毛重不得小于净重');
 if(result.plannedStart&&result.dueDate&&result.plannedStart>result.dueDate)throw new Error('计划开工不得晚于生产交期');
 return result;
}
export function businessAccess(s:State,m:Member,row:CommunicationLinks&{type?:string},write=false){
 if(!communicationAccess(s,m,row,write))return false;
 if(row.type==='engineering_quote'){
  const account=all(s,'customer_account').find(c=>c.id===row.customerId) as CustomerAccount|undefined;
  return !!account&&canUseCustomerQuotes(s,m)&&assignedCustomerQuoteAccount(s,m,account)&&!customerQuoteServiceReadOnly(s,m,account);
 }
 return true;
}
export function businessOrder(s:State,m:Member,customerId:string,id:string){
 const account=all(s,'customer_account').find(c=>c.id===customerId) as CustomerAccount|undefined,order=all(s,'order').find(o=>o.id===id) as Order|undefined;
 return account&&order&&canRead(m,order)&&serviceOrderCustomerKeys(s,account).some(k=>clean(k).toLowerCase()===clean(order.customer).toLowerCase())?order:null;
}
/** Reuse exact existing identities; no number or fuzzy-name migration. Return only needed evidence fields. */
export function businessOrigin(s:State,m:Member,owner:CommunicationLinks,ref:BusinessOrigin):Entity|null{
 const r=s.records.find(r=>r.id===ref.id&&r.kind===ref.kind);if(!r)return null;
 if(ref.kind==='order'){
  const o=businessOrder(s,m,owner.customerId,r.id),anchor=owner.orderId?businessOrder(s,m,owner.customerId,owner.orderId):null;
  if(!o||!anchor||o.orderNo!==anchor.orderNo||o.customerPO!==anchor.customerPO)return null;
  return {id:o.id,kind:o.kind,version:o.version,orderNo:o.orderNo,customerPO:o.customerPO,drawing:o.drawing,color:o.color,lens:o.lens,batch:o.batch,quantity:o.quantity};
 }
 if(r.customerId!==owner.customerId)return null;
 if(ref.kind==='engineering_drawing')return canReadDrawing(s,m,r as EngineeringDrawing)?{id:r.id,kind:r.kind,version:r.version,modelNo:r.modelNo,drawingType:r.drawingType,status:r.status,approval:r.approval,requirement:r.requirement}:null;
 if(!canReadServiceRecord(s,m,r)||r.orderId&&r.orderId!==owner.orderId)return null;
 const service=r as ServiceRecord;return {id:r.id,kind:r.kind,version:r.version,type:service.type,title:service.title,status:service.status,details:structuredClone(service.details)};
}
export function businessSourceState(s:State,m:Member,row:BusinessRow){
 const originChanged=(r:BusinessRow)=>(r.originRefs||[]).some((ref:BusinessOrigin)=>{const live=businessOrigin(s,m,r,ref);return !live||live.version!==ref.version;});
 const changedRef=(ref:{id:string;version:number},path:Set<string>):boolean=>{const live=s.records.find(r=>r.id===ref.id&&['handoff_business_source','handoff_business_document'].includes(r.kind)) as BusinessRow|undefined;if(!live||path.has(ref.id)||live.customerId!==row.customerId||!businessAccess(s,m,live)||live.version!==ref.version||originChanged(live))return true;const next=new Set(path);next.add(ref.id);return live.sourceRefs.some(r=>changedRef(r,next));};
 const changed=row.sourceRefs.filter(ref=>changedRef(ref,new Set([row.id])));
 return {sourceChanged:changed.length>0||originChanged(row)||!paymentRequestLedgerCurrent(s,row),changedSourceIds:changed.map(r=>r.id),canWrite:businessAccess(s,m,row,true)};
}
export function canCheckBusiness(s:State,m:Member,row:BusinessRow){return row.kind==='handoff_business_document'&&['pi','invoice','packing','waybill','paymentrequest'].includes(row.type)&&canReviewCommunication(s,m,row as unknown as Communication);}
export const businessPublic=(s:State,m:Member,row:BusinessRow)=>{const {sourceSnapshots,originSnapshots,...safe}=row;return {...safe,...businessSourceState(s,m,row),canConfirm:row.status==='pending_check'&&canCheckBusiness(s,m,row)};};
export function businessMoneyCents(value:string){if(!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(value))throw new Error('单价待核对');const [n,f='']=value.split('.');return Number(n)*100+Number(f.padEnd(2,'0'));}
export function businessTotal(row:BusinessRow){let amount=0;for(const l of row.lines){if(!l.unitPrice)return null;amount+=businessMoneyCents(l.unitPrice)*l.quantity;if(!Number.isSafeInteger(amount))throw new Error('金额超过安全上限');}return amount;}
