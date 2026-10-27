import {z} from 'zod';
import {all,type Entity,type Member,type State} from './domain';

export const paymentTermKind='payment_term';
export const paymentTermAuthorityId='payment_term_authority_company';
export const paymentTermTriggers=['issue','before_shipment','after_shipment','shipment_month_end'] as const;
export const paymentTermTriggerLabels:Record<typeof paymentTermTriggers[number],string>={issue:'签发生效后',before_shipment:'计划出货前',after_shipment:'实际出货后',shipment_month_end:'实际出货月末后'};
export const paymentTermStageSchema=z.object({id:z.string().trim().min(1).max(80),label:z.string().trim().min(1).max(80),percent:z.number().finite().positive().max(100).refine(n=>Math.abs(n*100-Math.round(n*100))<0.000001,'比例最多两位小数'),trigger:z.enum(paymentTermTriggers),days:z.number().int().min(0).max(365)}).strict();
const stages=z.array(paymentTermStageSchema).min(1).max(3).refine(rows=>rows.reduce((n,r)=>n+Math.round(r.percent*100),0)===10000,'各收费类型的分期比例合计必须为100%').refine(rows=>new Set(rows.map(r=>r.id)).size===rows.length,'阶段标识不能重复');
export const paymentTermContentSchema=z.object({name:z.string().trim().min(1,'请填写付款条件名称').max(160),bulk:stages,sample:stages,mold:stages,note:z.string().trim().min(1,'请说明适用范围与条款依据').max(6000)}).strict();
export type PaymentTermStage=z.infer<typeof paymentTermStageSchema>;
export type PaymentTermContent=z.infer<typeof paymentTermContentSchema>;
export type PaymentTerm=Entity&PaymentTermContent&{kind:'payment_term';familyId:string;termVersion:number;version:number;status:'draft'|'active'|'disabled';createdAt:string;createdById:string;updatedAt:string;updatedById:string;authorizedById?:string;authorizedAt?:string;authorizationReason?:string;disabledById?:string;disabledAt?:string;disableReason?:string};
export type PaymentTermAuthority=Entity&{kind:'payment_term_authority';authorizerMemberIds:string[];version:number;updatedAt:string;updatedById:string;reason:string};
export type PaymentTermsFeed={terms:PaymentTerm[];capabilities:{create:boolean;authorize:boolean;configure:boolean;readOnly:boolean};authorizerMemberIds:string[];authorityVersion:number;members:{id:string;name:string;role:string}[]};

/** Explicit account-ID restriction takes priority even over administrator roles. */
export function paymentTermsReadOnly(s:State,m:Member){return all(s,'ar_access_grant').some(r=>r.active===true&&r.memberId===m.id&&r.readOnly===true);}
export function paymentTermAuthority(s:State){return all(s,'payment_term_authority').find(r=>r.id===paymentTermAuthorityId) as PaymentTermAuthority|undefined;}
export function paymentTermsCapabilities(s:State,m:Member){const readOnly=paymentTermsReadOnly(s,m),internal=m.active&&m.role!=='supplier',write=internal&&!readOnly;return {readOnly,create:write&&['admin','sales','clerk'].includes(m.role),authorize:write&&eligiblePaymentTermAuthorizer(s,m)&&!!paymentTermAuthority(s)?.authorizerMemberIds.includes(m.id),configure:write&&m.role==='admin'};}
export function eligiblePaymentTermAuthorizer(s:State,m:Member){return m.active&&['admin','sales'].includes(m.role)&&!paymentTermsReadOnly(s,m);}
export function paymentTermById(s:State,id:string){return all(s,paymentTermKind).find(t=>t.id===id) as PaymentTerm|undefined;}
export function activePaymentTerm(s:State,id:string){const t=paymentTermById(s,id);return t?.status==='active'&&paymentTermContentSchema.safeParse({name:t.name,bulk:t.bulk,sample:t.sample,mold:t.mold,note:t.note}).success?t:undefined;}
export function paymentTermSnapshot(term:PaymentTerm):PaymentTerm{return structuredClone(term);}
