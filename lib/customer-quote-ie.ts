import {z} from 'zod';
import {all,now,type Member,type State} from './domain';
import {AppError} from './store';
import {canReadIeQuote,canFinalApproveIeSales} from './ie-quote-access';
import {releasedIeSnapshot,type IeQuote,type IeQuoteRevision} from './ie-quotes';
import {customerQuoteLineDetails,type CustomerQuote,type CustomerQuoteLine,type CustomerQuoteRevision} from './customer-quotes';

const key=z.string().trim().min(1).max(120);
export const adoptIeInput=z.object({id:key,version:z.number().int().positive(),ieQuoteId:key,ieQuoteVersion:z.number().int().positive(),scopeAcknowledged:z.literal(true),mappings:z.array(z.object({customerLineId:key,ieLineId:key}).strict()).min(1).max(200),toolingMappings:z.array(z.object({toolingId:key,customerChargeId:key}).strict()).max(100)}).strict();
export type CustomerQuoteIeSource={quoteId:string;version:number;quoteNo:string;batchId:string;customerAccountId:string;adoptedAt:string;adoptedBy:string;adoptedById:string;mappings:{customerLineId:string;ieLineId:string;scopeFingerprint:string}[];toolingMappings:{toolingId:string;customerChargeId:string}[]};
// The product, drawing interpretation and quantity must be explicitly rechecked
// after a sales draft changes scope. Sales price remains independently editable.
function scopeFingerprint(q:CustomerQuote,l:CustomerQuoteLine){return JSON.stringify({model:l.model,descriptionZh:l.descriptionZh,descriptionEn:l.descriptionEn,quantity:l.quantity,...customerQuoteLineDetails(l,q)});}
export function latestReleasedIeQuotes(s:State,m:Member,customerAccountId:string){
 const latest=new Map<string,IeQuote>();
 for(const r of all(s,'ie_quote_revision') as IeQuoteRevision[]){const q=r.snapshot;if(q?.status==='released'&&q.customerAccountId===customerAccountId&&canReadIeQuote(s,m,q)&&(!latest.has(q.id)||latest.get(q.id)!.version<q.version))latest.set(q.id,q);}
 return [...latest.values()].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
}
function sourceFor(s:State,m:Member,q:CustomerQuote,quoteId:string,version:number){
 const source=releasedIeSnapshot(s,quoteId,version);
 if(!source||!canReadIeQuote(s,m,source)||source.customerAccountId!==q.customerAccountId)throw new AppError('工程来源必须是当前客户获授权的已发布报价版本。',403);
 if((all(s,'ie_quote_revision') as IeQuoteRevision[]).some(r=>r.quoteId===quoteId&&r.version>version&&r.snapshot?.status==='released'))throw new AppError('工程报价已有新的复核发布版本，请重新核对并采用。',409);
 if(q.quoteDate<source.quoteDate||!source.validUntil||q.quoteDate>source.validUntil||!q.validUntil||q.validUntil>source.validUntil)throw new AppError('客价日期和有效期必须在工程报价的有效范围内；请先修订工程依据或客价日期。');
 return source;
}
function assertMappings(q:CustomerQuote,source:IeQuote,mappings:{customerLineId:string;ieLineId:string}[],toolingMappings:{toolingId:string;customerChargeId:string}[]){
 if(mappings.length!==q.lines.length||new Set(mappings.map(v=>v.customerLineId)).size!==q.lines.length||new Set(mappings.map(v=>v.ieLineId)).size!==mappings.length)throw new AppError('每一条客价明细必须唯一对应一款工程报价，不得漏项或重复采用。');
 for(const mapping of mappings){
  const sales=q.lines.find(l=>l.id===mapping.customerLineId),ie=source.lines.find(l=>l.id===mapping.ieLineId);
  if(!sales||!ie)throw new AppError('工程与客价明细对应关系已变化，请重新采用。',409);
  const details=customerQuoteLineDetails(sales,q),model=(sales.factoryModel||sales.model).trim().toLowerCase();
  if(model!==ie.model.trim().toLowerCase())throw new AppError(`客价型号 ${sales.model} 与所选工程厂款不一致，请填写对应厂款。`);
  if(details.productType!=='frame'||details.unit!=='pair'||details.supplyStage!=='finished'||!details.scopeReviewed)throw new AppError('当前工程报价按成品镜架每副核价；业务须先确认相同产品、供货阶段和单位。');
  if(sales.quantity===null||ie.quantityMin===null||ie.quantityMax===null||sales.quantity<ie.quantityMin||sales.quantity>ie.quantityMax)throw new AppError(`款式 ${ie.model} 的客价数量不在工程报价适用数量档内。`);
  if(sales.toolingFee!==null&&sales.toolingFee!==0)throw new AppError('采用工程报价后，模具等一次性费用统一在附加费用单独列一次，请清除逐款重复模具费。');
 }
 const lineIds=new Set(mappings.map(m=>m.ieLineId)),chargeTools=source.tooling.filter(t=>t.chargeMode==='charge'&&t.lineIds.some(id=>lineIds.has(id)));
 if(toolingMappings.length!==chargeTools.length||new Set(toolingMappings.map(v=>v.toolingId)).size!==chargeTools.length||new Set(toolingMappings.map(v=>v.customerChargeId)).size!==toolingMappings.length)throw new AppError('本次采用涉及的每项模具 / 一次性费用须唯一对应一个附加费用项目。');
 for(const mapping of toolingMappings){const tool=chargeTools.find(t=>t.toolingId===mapping.toolingId),charge=q.customerCharges?.find(c=>c.id===mapping.customerChargeId);if(!tool||!charge||charge.amount===null||charge.needsReview)throw new AppError('一次性费用对应项目不存在、金额未填或仍待核对。');}
}
export function adoptCustomerQuoteIe(s:State,m:Member,q:CustomerQuote,input:z.infer<typeof adoptIeInput>):CustomerQuoteIeSource{
 const source=sourceFor(s,m,q,input.ieQuoteId,input.ieQuoteVersion);assertMappings(q,source,input.mappings,input.toolingMappings);
 return {quoteId:source.id,version:source.version,quoteNo:source.quoteNo,batchId:source.batchId,customerAccountId:source.customerAccountId,adoptedAt:now(),adoptedBy:m.name,adoptedById:m.id,mappings:input.mappings.map(v=>({...v,scopeFingerprint:scopeFingerprint(q,q.lines.find(l=>l.id===v.customerLineId)!)})),toolingMappings:input.toolingMappings};
}
export function assertCustomerQuoteIeApproval(s:State,m:Member,q:CustomerQuote){
 if(!q.ieSource)return;
 if(!canFinalApproveIeSales(s,m))throw new AppError('工程报价衔接的最终客价须由绑定的曲艳红总经理批准。',403);
 if(hasIeSalesSelfEdit(s,m.id,q))throw new AppError('本次客价修订的填报人不能同时批准该版本，请业务人员另建报价草稿后提交。',403);
 validateCustomerQuoteIeSource(s,m,q);const binding=q.ieSource;
 const charged=new Set(binding.toolingMappings.map(v=>v.toolingId));
 if(all(s,'ie_quote_tooling').some(t=>t.customerAccountId===q.customerAccountId&&charged.has(t.id)&&t.chargeStatus==='collected'))throw new AppError('所引用模具已有实际收费凭证，请重新发布已收费工程依据并更新客价，不能再次列费。',409);
 // A draft revision does not revoke the prior customer-facing approval. Read
 // the latest confirmed snapshot for every other quote, even while editing it.
 const approved=new Map<string,CustomerQuote>();
 for(const r of all(s,'customer_quote_revision') as CustomerQuoteRevision[]){const other=r.snapshot;if(other?.status==='confirmed'&&(!approved.has(other.id)||approved.get(other.id)!.version<other.version))approved.set(other.id,other);}
 for(const other of all(s,'customer_quote') as CustomerQuote[])if(other.status==='confirmed'&&(!approved.has(other.id)||approved.get(other.id)!.version<other.version))approved.set(other.id,other);
 for(const other of approved.values()){if(other.id===q.id||other.customerAccountId!==q.customerAccountId||!other.ieSource)continue;if(other.ieSource.toolingMappings.some(v=>charged.has(v.toolingId)))throw new AppError('此客户共用模具已在另一份已批准客价中单独列费，不能通过更换批次重复收费。',409);}
}
export function hasIeSalesSelfEdit(s:State,approverId:string,q:CustomerQuote){const revisions=(all(s,'customer_quote_revision') as CustomerQuoteRevision[]).filter(r=>r.quoteId===q.id),lastApproved=Math.max(0,...revisions.filter(r=>r.snapshot?.status==='confirmed').map(r=>r.version));return q.updatedById===approverId||revisions.some(r=>r.version>lastApproved&&r.snapshot?.status==='draft'&&r.snapshot.updatedById===approverId);}
export function validateCustomerQuoteIeSource(s:State,m:Member,q:CustomerQuote){
 const binding=q.ieSource;if(!binding)throw new AppError('客户报价尚未明确采用已发布工程版本。',409);
 const source=sourceFor(s,m,q,binding.quoteId,binding.version);assertMappings(q,source,binding.mappings,binding.toolingMappings);
 if(binding.mappings.some(v=>v.scopeFingerprint!==scopeFingerprint(q,q.lines.find(l=>l.id===v.customerLineId)!)))throw new AppError('采用工程依据后，客价的型号、描述、数量或供货范围发生变化，请重新核对并采用工程版本。',409);
 return source;
}
export function publicCustomerQuoteIe(s:State,m:Member,q:CustomerQuote){
 if(!q.ieSource)return {};
 const binding=q.ieSource,source=releasedIeSnapshot(s,binding.quoteId,binding.version);
 if(!source||!canReadIeQuote(s,m,source)||source.customerAccountId!==q.customerAccountId)return {ieSourceUnavailable:true};
 const {mappings,...publicBinding}=binding;
 return {ieSource:{...publicBinding,mappings:mappings.map(({scopeFingerprint:_scope,...v})=>v)},ieSourceStale:(all(s,'ie_quote_revision') as IeQuoteRevision[]).some(r=>r.quoteId===binding.quoteId&&r.version>binding.version&&r.snapshot?.status==='released'),ieReference:{exchangeRateCnyPerUsd:source.exchangeRateCnyPerUsd,exchangeRateDate:source.exchangeRateDate,costs:source.costs,lines:source.lines,tooling:source.tooling}};
}
