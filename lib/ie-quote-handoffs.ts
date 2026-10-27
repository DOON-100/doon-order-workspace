import {all,type CustomerAccount,type Entity,type Member,type State} from './domain';
import {canMaintainCustomerQuoteAccount,customerQuoteAccessPolicy} from './customer-quote-access';
import {explicitCustomerResponsibility,matchesCustomerResponsibility} from './customer-responsibility';
import {canReadIeQuote,iePolicyMember,isIeApprover,isIeEngineeringMember} from './ie-quote-access';
import {currentIeQuote,latestReleasedIeVersion,releasedIeSnapshot,type IeQuote} from './ie-quotes';

export type IeSalesHandoff=Entity & {kind:'ie_quote_sales_handoff';version:number;quoteId:string;quoteVersion:number;customerAccountId:string;recipientMemberIds:string[];recipientNames:string[];createdAt:string;createdBy:string;createdById:string;acceptedBy:{memberId:string;name:string;at:string}[];sourceSnapshot:IeQuote};
export function ieHandoffCandidates(s:State,q:Pick<IeQuote,'customerAccountId'>){
 const account=all(s,'customer_account').find(a=>a.id===q.customerAccountId) as CustomerAccount|undefined;if(!account?.active)return [];
 const excluded=new Set((['engineer','reviewer','finalApprover'] as const).map(role=>iePolicyMember(s,role)?.id));
 const policy=customerQuoteAccessPolicy(s);
 return (all(s,'member') as Member[]).flatMap(m=>{
  if(!m.active||m.role==='supplier'||excluded.has(m.id)||!canMaintainCustomerQuoteAccount(s,m,account)||!canReadIeQuote(s,m,q))return [];
  const explicit=explicitCustomerResponsibility(account,m,'quote')===true,sales=matchesCustomerResponsibility(account,m,'sales',policy?.aliasesByMember[m.id]||[]);
  return explicit||sales?[{memberId:m.id,name:m.name,reason:explicit?'明确负责报价':'负责业务'}]:[];
 });
}
export function validIeHandoffSource(s:State,q:IeQuote){
 const current=currentIeQuote(s,q.id),released=releasedIeSnapshot(s,q.id,q.version),latest=latestReleasedIeVersion(s,q.id);
 return !!current&&current.customerAccountId===q.customerAccountId&&!!released&&released.customerAccountId===q.customerAccountId&&latest?.version===q.version&&q.status==='released'&&!!q.reviewedById&&q.reviewedById===q.requiredReviewMemberId&&!q.preparedByIds.includes(q.reviewedById);
}
export function canPushIeToBusiness(s:State,m:Member,q:IeQuote){return !!m.active&&(isIeEngineeringMember(s,m)||isIeApprover(s,m))&&canReadIeQuote(s,m,q)&&validIeHandoffSource(s,q);}
export function canReadIeHandoff(s:State,m:Member,h:IeSalesHandoff){
 const current=currentIeQuote(s,h.quoteId),source=releasedIeSnapshot(s,h.quoteId,h.quoteVersion);
 if(!current||!source||source.customerAccountId!==h.customerAccountId||current.customerAccountId!==h.customerAccountId||!canReadIeQuote(s,m,current)||!canReadIeQuote(s,m,source))return false;
 return isIeEngineeringMember(s,m)||isIeApprover(s,m)||h.recipientMemberIds.includes(m.id)&&ieHandoffCandidates(s,source).some(c=>c.memberId===m.id);
}
export function publicIeHandoff(s:State,m:Member,h:IeSalesHandoff){
 const source=releasedIeSnapshot(s,h.quoteId,h.quoteVersion),stale=!source||!validIeHandoffSource(s,source),eligible=!!source&&h.recipientMemberIds.includes(m.id)&&ieHandoffCandidates(s,source).some(c=>c.memberId===m.id);
 return {id:h.id,version:h.version,quoteId:h.quoteId,quoteVersion:h.quoteVersion,quoteNo:h.sourceSnapshot.quoteNo,customerAccountId:h.customerAccountId,customerName:h.sourceSnapshot.customerName,customerCode:h.sourceSnapshot.customerCode,models:h.sourceSnapshot.lines.map(l=>l.model),recipientMemberIds:h.recipientMemberIds,recipientNames:h.recipientNames,createdAt:h.createdAt,createdBy:h.createdBy,acceptedBy:h.acceptedBy,stale,canAccept:!stale&&eligible&&!h.acceptedBy.some(a=>a.memberId===m.id)};
}
export function ieHandoffFields(s:State,m:Member,q:IeQuote){return {
 canPushToBusiness:canPushIeToBusiness(s,m,q),handoffCandidates:canPushIeToBusiness(s,m,q)?ieHandoffCandidates(s,q):[],
 businessHandoffs:(all(s,'ie_quote_sales_handoff') as IeSalesHandoff[]).filter(h=>h.quoteId===q.id&&h.quoteVersion===q.version&&canReadIeHandoff(s,m,h)).map(h=>publicIeHandoff(s,m,h)),
};}
