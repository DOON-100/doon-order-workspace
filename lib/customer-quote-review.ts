import {all,newId,type Member,type State} from './domain';
import {isCustomerQuoteAdministrator} from './customer-quote-access';
import {canReadCustomerQuote,customerQuoteInput,type CustomerQuote,type CustomerQuoteCompleted,type CustomerQuoteRevision} from './customer-quotes';
import {AppError} from './store';

// Confirm the stored draft, never a second payload which has not been saved and
// reviewed. Internal estimates are deliberately not a source of selling prices.
export function assertCustomerQuoteConfirmable(q:CustomerQuote){
 const {id,version,companyEn,companyZh,collectionEn,collectionZh,customerCode,customerName,customerAccountId,contactName,quoteNo,quoteDate,validUntil,currency,lines,terms,reviewNotes,internalNotesZh,exchangeRateCnyPerUsd,internalCosts,customerCharges}=q;
 const check=customerQuoteInput.safeParse({id,version,companyEn,companyZh,collectionEn,collectionZh,customerCode,customerName,customerAccountId,contactName,quoteNo,quoteDate,validUntil,currency,lines,terms,reviewNotes,internalNotesZh,exchangeRateCnyPerUsd,internalCosts,customerCharges});
 if(!check.success)throw new AppError('报价草稿字段不完整或格式无效，请保存并核对后确认。');
 const fields=check.data,charges=fields.customerCharges||[],issues:string[]=[];
 if(fields.currency!=='USD')issues.push('本报价完成清单使用美元，请先核对对客报价币种');
 if(!fields.validUntil)issues.push('请确认报价有效期');
 fields.lines.forEach((line,index)=>{
  if(line.quantity===null)issues.push(`第 ${index+1} 项报价数量待确认`);
  if(line.unitPrice===null)issues.push(`第 ${index+1} 项对客单价待确认`);
  if(!charges.length&&line.toolingFee===null)issues.push(`第 ${index+1} 项模具费待确认，免收请明确填 0`);
  if(!line.descriptionEn.trim())issues.push(`第 ${index+1} 项英文产品描述待确认`);
  if((line.quantityBasisZh||line.quantityBasisEn)&&(!line.quantityBasisZh?.trim()||!line.quantityBasisEn?.trim()))issues.push(`第 ${index+1} 项数量计价基准须填写中英文`);
 });
 if(!fields.terms.length)issues.push('至少需要一项已复核的中英文报价条款');
 if(fields.terms.some(term=>term.needsReview||!term.zh.trim()||!term.en.trim()))issues.push('报价条款仍有待复核项或缺少中英文内容');
 if(charges.some(charge=>charge.amount===null||charge.needsReview||!charge.basisZh.trim()||!charge.basisEn.trim()))issues.push('单列费用仍有待确认金额、计费依据或未复核项');
 if(fields.reviewNotes.some(note=>note.trim()))issues.push('待确认问题尚未处理，请核对后清除待确认问题');
 if(issues.length)throw new AppError(issues.slice(0,6).join('；'));
}

export function completedCustomerQuoteRows(q:CustomerQuote):CustomerQuoteCompleted[]{
 // Only the confirmation transaction invokes this after validating every field.
 return q.lines.map(line=>({
  id:newId('customer_quote_completed'),kind:'customer_quote_completed',quoteId:q.id,quoteVersion:q.version,lineId:line.id,
  quoteNo:q.quoteNo,customerAccountId:q.customerAccountId,customerCode:q.customerCode,customerName:q.customerName,contactName:q.contactName||'',
  model:line.model,descriptionZh:line.descriptionZh,descriptionEn:line.descriptionEn,quantity:line.quantity!,unitPriceUsd:line.unitPrice!,toolingFeeUsd:line.toolingFee,
  ...(line.quantityBasisZh!==undefined?{quantityBasisZh:line.quantityBasisZh}:{}),...(line.quantityBasisEn!==undefined?{quantityBasisEn:line.quantityBasisEn}:{}),
  currency:'USD',quoteDate:q.quoteDate,validUntil:q.validUntil,customerCharges:structuredClone(q.customerCharges||[]),
  confirmedAt:q.confirmedAt!,confirmedBy:q.confirmedBy!,confirmedById:q.confirmedById!,quotedCustomer:'',
 }));
}

export function visibleCompletedCustomerQuotes(s:State,m:Member){
 const quotes=new Map((all(s,'customer_quote') as CustomerQuote[]).map(q=>[q.id,q]));
 const revisions=all(s,'customer_quote_revision') as CustomerQuoteRevision[];
 return (all(s,'customer_quote_completed') as CustomerQuoteCompleted[]).filter(row=>{
  const q=quotes.get(row.quoteId);
  if(!q||!canReadCustomerQuote(s,m,q))return false;
  const candidates=revisions.filter(revision=>revision.quoteId===row.quoteId&&revision.version===row.quoteVersion);
  if(candidates.length!==1)return false;
  const snapshot=candidates[0].snapshot;
  if(!snapshot||snapshot.status!=='confirmed'||snapshot.id!==q.id||snapshot.version!==row.quoteVersion||snapshot.customerAccountId!==row.customerAccountId||!canReadCustomerQuote(s,m,snapshot))return false;
  // Even a member who happens to follow both customers must not see a prior
  // customer's archive mixed into a quote that was reassociated by an admin.
  return isCustomerQuoteAdministrator(m)||q.customerAccountId===snapshot.customerAccountId;
 }).sort((a,b)=>b.confirmedAt.localeCompare(a.confirmedAt)||b.quoteVersion-a.quoteVersion).map(row=>({
  id:row.id,quoteId:row.quoteId,quoteVersion:row.quoteVersion,lineId:row.lineId,quoteNo:row.quoteNo,customerAccountId:row.customerAccountId,customerCode:row.customerCode,customerName:row.customerName,contactName:row.contactName,
  model:row.model,descriptionZh:row.descriptionZh,descriptionEn:row.descriptionEn,quantity:row.quantity,unitPriceUsd:row.unitPriceUsd,toolingFeeUsd:row.toolingFeeUsd,
  ...(row.quantityBasisZh!==undefined?{quantityBasisZh:row.quantityBasisZh}:{}),...(row.quantityBasisEn!==undefined?{quantityBasisEn:row.quantityBasisEn}:{}),
  currency:row.currency,quoteDate:row.quoteDate,validUntil:row.validUntil,customerCharges:row.customerCharges,confirmedAt:row.confirmedAt,confirmedBy:row.confirmedBy,quotedCustomer:row.quotedCustomer,
 }));
}
