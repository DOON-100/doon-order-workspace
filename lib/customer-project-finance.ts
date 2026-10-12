import {z} from 'zod';
import {all,clean,strictDate,type Entity,type Member,type State} from './domain';
import {serviceMoneyCents} from './service-workspace';

export const projectCurrencies=['CNY','USD','EUR','GBP','HKD'] as const;
export type ProjectCurrency=typeof projectCurrencies[number];
export type ProjectCharge=Entity&{kind:'project_charge';customerId:string;projectId:string;roundId:string;title:string;category:string;currency:ProjectCurrency;amountCents:number;prepayCents:number;dueDate:string;note:string;status:'draft'|'confirmed';version:number;plan:{title:string;amountCents:number;dueDate:string;beforeOrder:boolean}[]};
export type ProjectReceipt=Entity&{kind:'project_receipt';customerId:string;amountCents:number;currency:ProjectCurrency;date:string;reference:string;payer:string;account:string;note:string};
export type ProjectAllocation=Entity&{kind:'project_allocation';customerId:string;projectId:string;roundId:string;receiptId:string;chargeId:string;amountCents:number;entryType:'allocate'|'release';originalId:string;reason:string};
export type ProjectAdjustment=Entity&{kind:'project_adjustment';customerId:string;projectId:string;roundId:string;chargeId:string;caseId:string;type:'discount'|'credit'|'waiver'|'debit';amountCents:number;prepay:boolean;reason:string};
export type ProjectFinanceGrant=Entity&{kind:'project_finance_grant';memberId:string;customerIds:string[];active:boolean;version:number};
export const pfId=z.string().trim().min(1).max(160);
export const pfText=(max=3000)=>z.string().trim().max(max).default('');
export const pfDay=z.string().trim().default('').superRefine((v,c)=>{if(v)try{if(strictDate(v)!==v)throw new Error();}catch{c.addIssue({code:z.ZodIssueCode.custom,message:'日期须为有效的 YYYY-MM-DD'});}});
export const pfMoney=z.union([z.string(),z.number()]).transform((v,c)=>{try{return serviceMoneyCents(v);}catch(e){c.addIssue({code:z.ZodIssueCode.custom,message:(e as Error).message});return z.NEVER;}});
export const pfPositive=pfMoney.refine(v=>v>0,'金额须大于零');
export const pfToken=z.string().uuid();
export function canVerifyProjectFinance(s:State,m:Member,customerId:string){
 const c=all(s,'customer_account').find(r=>r.id===customerId);
 if(!m.active||!c?.active)return false;
 if(m.role==='admin')return true;
 if(['supplier','viewer','programmer','production'].includes(m.role))return false;
 const explicit=all(s,'project_finance_grant').some(g=>g.active&&g.memberId===m.id&&Array.isArray(g.customerIds)&&g.customerIds.includes(customerId));
 if(explicit)return true;
 if(m.role!=='finance')return false;
 return m.customers.some(value=>{const key=clean(value).toLowerCase();if(key===clean(c.id).toLowerCase())return true;if(!key)return false;const matches=all(s,'customer_account').filter(a=>a.active&&[a.customerCode,a.customer].some(v=>clean(v).toLowerCase()===key));return matches.length===1&&matches[0].id===c.id;});
}
export const projectReceiptReversed=(s:State,id:string)=>all(s,'project_receipt_reversal').some(r=>r.receiptId===id);
export function projectReceiptRefunded(s:State,id:string){return all(s,'project_refund').filter(r=>r.receiptId===id&&r.status==='executed').reduce((n,r)=>n+r.amountCents,0);}
export function projectAllocationNet(s:State,allocation:Entity){
 if(allocation.entryType!=='allocate'||projectReceiptReversed(s,allocation.receiptId))return 0;
 return allocation.amountCents-all(s,'project_allocation').filter(r=>r.entryType==='release'&&r.originalId===allocation.id).reduce((n,r)=>n+r.amountCents,0);
}
export function projectChargePaid(s:State,chargeId:string){return all(s,'project_allocation').filter(r=>r.chargeId===chargeId&&r.entryType==='allocate').reduce((n,r)=>n+projectAllocationNet(s,r),0);}
export function projectChargeAmounts(s:State,c:ProjectCharge){
 const adjustments=all(s,'project_adjustment').filter(r=>r.chargeId===c.id);
 const credits=adjustments.filter(r=>r.type!=='debit').reduce((n,r)=>n+r.amountCents,0),debits=adjustments.filter(r=>r.type==='debit').reduce((n,r)=>n+r.amountCents,0);
 const amountCents=c.amountCents+debits-credits,waiver=adjustments.filter(r=>r.type==='waiver').reduce((n,r)=>n+r.amountCents,0);
 const prepayCents=Math.max(0,Math.min(amountCents,c.prepayCents-waiver+adjustments.filter(r=>r.type==='debit'&&r.prepay).reduce((n,r)=>n+r.amountCents,0)));
 const receivedCents=projectChargePaid(s,c.id);
 return {amountCents,prepayCents,receivedCents,balanceCents:amountCents-receivedCents};
}
export function projectReceiptAvailable(s:State,r:ProjectReceipt){
 if(projectReceiptReversed(s,r.id))return 0;
 const assigned=all(s,'project_allocation').filter(a=>a.receiptId===r.id&&a.entryType==='allocate').reduce((n,a)=>n+projectAllocationNet(s,a),0);
 return r.amountCents-assigned-projectReceiptRefunded(s,r.id);
}
export function projectCreditSourceAvailable(s:State,c:ProjectCharge){
 const used=all(s,'project_credit_application').filter(a=>a.sourceChargeId===c.id).reduce((n,a)=>n+a.amountCents,0);
 return Math.max(0,Math.min(projectChargeAmounts(s,c).amountCents,projectChargePaid(s,c.id))-used);
}
export function paymentGate(s:State,projectId:string,roundId:string):{allowed:boolean;missing:string[]}{
 const p=all(s,'customer_project').find(r=>r.id===projectId),round=all(s,'customer_project_round').find(r=>r.id===roundId&&r.projectId===projectId),missing:string[]=[];
 if(!p||!round)return {allowed:false,missing:['项目或开发轮次不存在']};
 const requirements=all(s,'project_payment_requirement').filter(r=>r.projectId===projectId&&r.roundId===roundId);
 const requirement=requirements.length===1?requirements[0]:null;
 const charges=(all(s,'project_charge') as ProjectCharge[]).filter(r=>r.projectId===projectId&&r.roundId===roundId);
 if(!requirement)return {allowed:false,missing:['尚未由财务或指定核实人确认本轮收费要求']};
 if(requirement.mode==='free'){
  if(charges.length)missing.push('本轮已存在收费项，不能沿用无收费批准');
 }else{
  if(!charges.length)missing.push('本轮没有收费项，须明确批准不收费');
  if(charges.some(c=>c.status!=='confirmed'))missing.push('存在尚未核对确认的收费项');
  if(JSON.stringify([...charges.map(c=>c.id)].sort())!==JSON.stringify([...(requirement.chargeIds||[])].sort()))missing.push('收费范围已变化，请重新确认付款要求');
  for(const c of charges){const totals=projectChargeAmounts(s,c);if(totals.receivedCents<totals.prepayCents)missing.push(`${c.title} 尚需 ${c.currency} ${((totals.prepayCents-totals.receivedCents)/100).toFixed(2)}`);
   for(const application of all(s,'project_credit_application').filter(a=>a.targetChargeId===c.id)){const source=all(s,'project_charge').find(x=>x.id===application.sourceChargeId) as ProjectCharge|undefined,used=all(s,'project_credit_application').filter(a=>a.sourceChargeId===application.sourceChargeId).reduce((n,a)=>n+a.amountCents,0);if(!source||Math.min(projectChargeAmounts(s,source).amountCents,projectChargePaid(s,source.id))<used)missing.push(`${c.title} 抵扣来源已变更，须重新核对财务处理`);}
  }
 }
 return {allowed:missing.length===0,missing};
}
export function projectFinanceTotals(s:State,charges:ProjectCharge[],receipts:ProjectReceipt[]){
 const result:Record<string,{contractCents:number;receivableCents:number;receivedCents:number;allocatedCents:number;balanceCents:number;refundCents:number;unallocatedCents:number}>={};
 const get=(currency:string)=>result[currency]||(result[currency]={contractCents:0,receivableCents:0,receivedCents:0,allocatedCents:0,balanceCents:0,refundCents:0,unallocatedCents:0});
 for(const c of charges.filter(c=>c.status==='confirmed')){const t=projectChargeAmounts(s,c),r=get(c.currency);r.contractCents+=c.amountCents;r.receivableCents+=t.amountCents;r.allocatedCents+=t.receivedCents;r.balanceCents+=t.balanceCents;}
 for(const receipt of receipts){if(projectReceiptReversed(s,receipt.id))continue;const r=get(receipt.currency),refund=projectReceiptRefunded(s,receipt.id);r.receivedCents+=receipt.amountCents-refund;r.refundCents+=refund;r.unallocatedCents+=projectReceiptAvailable(s,receipt);}
 return result;
}
export function projectFinanceOpenReasons(s:State,projectId:string){
 const reasons:string[]=[];
 if((all(s,'project_charge') as ProjectCharge[]).some(c=>c.projectId===projectId&&(c.status==='draft'||projectChargeAmounts(s,c).balanceCents!==0)))reasons.push('项目仍有未确认收费或未结应收');
 if(all(s,'project_after_sale').some(c=>c.projectId===projectId&&c.status!=='closed'))reasons.push('项目仍有未关闭售后');
 if(all(s,'project_refund').some(c=>c.projectId===projectId&&c.status==='requested'))reasons.push('项目仍有待执行退款');
 return reasons;
}
