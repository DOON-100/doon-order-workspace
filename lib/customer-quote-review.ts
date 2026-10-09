import {all,newId,type Member,type State} from './domain';
import {isCustomerQuoteAdministrator} from './customer-quote-access';
import {canReadCustomerQuote,customerQuoteInput,customerQuoteLineDetails,customerQuoteVersion,customerQuoteMedia,publicCustomerQuoteMedia,customerQuoteSentHistory,type CustomerQuote,type CustomerQuoteCompleted,type CustomerQuoteRevision} from './customer-quotes';
import {AppError} from './store';

// Confirm the stored draft, never a second payload which has not been saved and
// reviewed. Internal estimates are deliberately not a source of selling prices.
export function assertCustomerQuoteConfirmable(q:CustomerQuote){
 const {id,version,companyEn,companyZh,collectionEn,collectionZh,customerCode,customerName,customerAccountId,contactName,quoteNo,quoteDate,validUntil,currency,lines,terms,reviewNotes,internalNotesZh,exchangeRateCnyPerUsd,internalCosts,customerCharges,brand,businessType,quoteMode,pricingBasis,currencyReviewed}=q;
 const check=customerQuoteInput.safeParse({id,version,companyEn,companyZh,collectionEn,collectionZh,customerCode,customerName,customerAccountId,contactName,quoteNo,quoteDate,validUntil,currency,lines,terms,reviewNotes,internalNotesZh,exchangeRateCnyPerUsd,internalCosts,customerCharges,brand,businessType,quoteMode,pricingBasis,currencyReviewed});
 if(!check.success)throw new AppError('报价草稿字段不完整或格式无效，请保存并核对后确认。');
 const fields=check.data,charges=fields.customerCharges||[],issues:string[]=[];
 const mode=fields.quoteMode||'order';
 if(fields.pricingBasis==='pending')issues.push('报价计价方式仍待确认');
 const special=mode==='price_list'||fields.businessType==='spare_parts'||fields.lines.some(line=>line.productType==='spare_part');
 if(special&&fields.currencyReviewed!==true)issues.push('请明确复核本备件／价目表报价的币种');
 if(special&&!fields.pricingBasis)issues.push('请明确复核本备件／价目表的计价方式');
 if(fields.lines.some(line=>line.productType==='spare_part')&&(!fields.businessType||fields.businessType==='frame'))issues.push('备件报价须明确选择业务类型');
 if(!fields.validUntil)issues.push('请确认报价有效期');
 fields.lines.forEach((line,index)=>{
  const scope=customerQuoteLineDetails(line,fields);
  if(mode==='order'&&line.quantity===null)issues.push(`第 ${index+1} 项报价数量待确认`);
  if(mode==='price_list'&&(!line.quantityBasisZh?.trim()||!line.quantityBasisEn?.trim()))issues.push(`第 ${index+1} 项价目表数量适用条件须填写中英文`);
  if(scope.unit==='unknown')issues.push(`第 ${index+1} 项计价单位待确认`);
  if(scope.productType==='unknown')issues.push(`第 ${index+1} 项产品类型待确认`);
  if(scope.supplyStage==='unknown'||!scope.scopeReviewed)issues.push(`第 ${index+1} 项供货范围待复核`);
  if((scope.productType==='spare_part'||scope.supplyStage==='raw'||scope.supplyStage==='semi_finished')&&(!scope.scopeNotesZh.trim()||!scope.scopeNotesEn.trim()))issues.push(`第 ${index+1} 项须说明中英文供货范围及包含／排除项`);
  if(scope.productType==='spare_part'&&!scope.component&&!scope.materialNumber)issues.push(`第 ${index+1} 项须明确备件名称或物料编号`);
  if(line.unitPrice===null)issues.push(`第 ${index+1} 项对客单价待确认`);
  if((special||!charges.length)&&line.toolingFee===null)issues.push(`第 ${index+1} 项模具费待确认，免收或不适用请明确填 0`);
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
  model:line.model,descriptionZh:line.descriptionZh,descriptionEn:line.descriptionEn,quantity:line.quantity,unitPrice:line.unitPrice!,toolingFee:line.toolingFee,
  unitPriceUsd:q.currency==='USD'?line.unitPrice!:null,toolingFeeUsd:q.currency==='USD'?line.toolingFee:null,...customerQuoteLineDetails(line,q),
  brand:q.brand||'',businessType:q.businessType||'frame',quoteMode:q.quoteMode||'order',pricingBasis:q.pricingBasis||'row_item',currencyReviewed:q.currencyReviewed??false,
  ...(q.templateBinding?{templateBinding:structuredClone(q.templateBinding)}:{}),
  ...(line.quantityBasisZh!==undefined?{quantityBasisZh:line.quantityBasisZh}:{}),...(line.quantityBasisEn!==undefined?{quantityBasisEn:line.quantityBasisEn}:{}),
  currency:q.currency,quoteDate:q.quoteDate,validUntil:q.validUntil,customerCharges:structuredClone(q.customerCharges||[]),
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
  return isCustomerQuoteAdministrator(m,s)||q.customerAccountId===snapshot.customerAccountId;
 }).sort((a,b)=>b.confirmedAt.localeCompare(a.confirmedAt)||b.quoteVersion-a.quoteVersion).flatMap(row=>{
  const snapshot=customerQuoteVersion(s,m,row.quoteId,row.quoteVersion);if(!snapshot)return [];
  const media=customerQuoteMedia(s,m,snapshot).filter(item=>!item.lineId||item.lineId===row.lineId).map(publicCustomerQuoteMedia),sentHistory=customerQuoteSentHistory(s,m,snapshot);
  return [{
  id:row.id,quoteId:row.quoteId,quoteVersion:row.quoteVersion,lineId:row.lineId,quoteNo:row.quoteNo,customerAccountId:row.customerAccountId,customerCode:row.customerCode,customerName:row.customerName,contactName:row.contactName,
  model:row.model,descriptionZh:row.descriptionZh,descriptionEn:row.descriptionEn,quantity:row.quantity,
  unitPrice:row.unitPrice??(row.currency==='USD'?row.unitPriceUsd:null),toolingFee:row.toolingFee??(row.currency==='USD'?row.toolingFeeUsd:null),
  unitPriceUsd:row.currency==='USD'?row.unitPriceUsd:null,toolingFeeUsd:row.currency==='USD'?row.toolingFeeUsd:null,...customerQuoteLineDetails(row,row),
  brand:row.brand||'',businessType:row.businessType||'frame',quoteMode:row.quoteMode||'order',pricingBasis:row.pricingBasis||'row_item',currencyReviewed:row.currencyReviewed??false,
  ...(row.templateBinding?{templateBinding:row.templateBinding}:{}),
  ...(row.quantityBasisZh!==undefined?{quantityBasisZh:row.quantityBasisZh}:{}),...(row.quantityBasisEn!==undefined?{quantityBasisEn:row.quantityBasisEn}:{}),
  currency:row.currency,quoteDate:row.quoteDate,validUntil:row.validUntil,customerCharges:row.customerCharges,confirmedAt:row.confirmedAt,confirmedBy:row.confirmedBy,quotedCustomer:sentHistory.length?'Y' as const:'' as const,
  media,sentHistory,canRegisterSent:true,canSupplementArchive:true,
 }];});
}
