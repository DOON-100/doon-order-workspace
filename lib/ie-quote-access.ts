import {z} from 'zod';
import {all,type CustomerAccount,type Entity,type Member,type State} from './domain';
import {canMaintainCustomerQuoteAccount} from './customer-quote-access';

export type IeQuotePolicy=Entity & {kind:'ie_quote_policy';version:number;engineerMemberId:string;reviewerMemberId:string;finalApproverMemberId:string;updatedAt:string;updatedBy:string};
export const iePolicyInput=z.object({version:z.number().int().nonnegative(),engineerMemberId:z.string().trim().min(1).max(120),reviewerMemberId:z.string().trim().min(1).max(120),finalApproverMemberId:z.string().trim().min(1).max(120)}).strict();
export function ieQuotePolicy(s:State):IeQuotePolicy|null{
 const rows=all(s,'ie_quote_policy');if(rows.length!==1)return null;
 const p=rows[0],parsed=iePolicyInput.safeParse({version:p.version,engineerMemberId:p.engineerMemberId,reviewerMemberId:p.reviewerMemberId,finalApproverMemberId:p.finalApproverMemberId});
 if(!parsed.success||p.version<1||new Set([p.engineerMemberId,p.reviewerMemberId,p.finalApproverMemberId]).size!==3)return null;
 return p as IeQuotePolicy;
}
export function iePolicyMember(s:State,role:'engineer'|'reviewer'|'finalApprover'):Member|undefined{
 const policy=ieQuotePolicy(s),id=policy?.[`${role}MemberId`];return all(s,'member').find(m=>m.id===id&&m.active&&m.role!=='supplier') as Member|undefined;
}
export const canConfigureIeQuotes=(m:Member)=>m.active&&m.role==='admin';
export function isIeEngineeringMember(s:State,m:Member){return !!m.active&&!!ieQuotePolicy(s)&&[iePolicyMember(s,'engineer')?.id,iePolicyMember(s,'reviewer')?.id].includes(m.id);}
export function isIeApprover(s:State,m:Member){return !!m.active&&[iePolicyMember(s,'reviewer')?.id,iePolicyMember(s,'finalApprover')?.id].includes(m.id);}
export function canFinalApproveIeSales(s:State,m:Member){return !!m.active&&iePolicyMember(s,'finalApprover')?.id===m.id;}
export function canReadIeAccount(s:State,m:Member,a:CustomerAccount){
 return !!m.active&&(canConfigureIeQuotes(m)||isIeEngineeringMember(s,m)||canFinalApproveIeSales(s,m)||canMaintainCustomerQuoteAccount(s,m,a));
}
export function canReadIeQuote(s:State,m:Member,q:{customerAccountId:string}){
 const a=all(s,'customer_account').find(a=>a.id===q.customerAccountId) as CustomerAccount|undefined;return !!a&&canReadIeAccount(s,m,a);
}
export const readAccess=canReadIeQuote;
export function canUseIeQuotes(s:State,m:Member){return !!m.active&&(canConfigureIeQuotes(m)||isIeEngineeringMember(s,m)||canFinalApproveIeSales(s,m)||(all(s,'customer_account') as CustomerAccount[]).some(a=>canMaintainCustomerQuoteAccount(s,m,a)));}
export function ieCapabilities(s:State,m:Member){return {canCreate:isIeEngineeringMember(s,m),canConfigure:canConfigureIeQuotes(m),canReview:isIeApprover(s,m),canFinalApprove:canFinalApproveIeSales(s,m)};}
export function publicIePolicy(s:State,m:Member){
 const p=ieQuotePolicy(s);return {version:p?.version||0,engineerMemberId:p?.engineerMemberId||'',reviewerMemberId:p?.reviewerMemberId||'',finalApproverMemberId:p?.finalApproverMemberId||'',labels:{engineer:'郑忠伟 · 工程主管',reviewer:'杨德周 · 生产副总',finalApprover:'曲艳红 · 总经理'},
 members:canConfigureIeQuotes(m)?(all(s,'member') as Member[]).filter(v=>v.active&&v.role!=='supplier').map(({id,name,role})=>({id,name,role})):[],
 boundMembers:(['engineer','reviewer','finalApprover'] as const).map(role=>({role,id:iePolicyMember(s,role)?.id||'',name:iePolicyMember(s,role)?.name||''})),
 constants:{materialLossRate:0.1,indirect:13.7,indirectItems:[{name:'间接人工',amount:5},{name:'房租',amount:3},{name:'水费',amount:0.2},{name:'电费',amount:2},{name:'折旧',amount:2},{name:'辅料',amount:1.5}],factoryMultiplier:1.3,exchangeRateDirection:'1 USD = x CNY',formulaVersion:'ie-cost-v2-line-loss'},configured:!!p};
}
