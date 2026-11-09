import {all,type CustomerAccount,type Entity,type Member,type State} from './domain';
import {canMaintainCustomerQuoteAccount} from './customer-quote-access';
import {canFillIeQuote,canReadIeQuote,ieQuotePolicy,iePolicyMember,isIeApprover} from './ie-quote-access';
import {ieTemplateStatus} from './ie-quote-template';
import {ieAttachmentIssues,publicIeAttachments,type IeAttachmentRef} from './ie-quote-attachments';
import {calculateIeQuote,ieAdjustmentTargets} from './ie-quote-calculation';
import {ieHandoffFields} from './ie-quote-handoffs';
import {validateIeMaterialNameReferences} from './ie-material-names';
import type {IeCatalogMetadata} from './ie-price-catalog';
export {calculateIeQuote} from './ie-quote-calculation';
export {canReadIeQuote,readAccess,canFinalApproveIeSales,iePolicyMember,ieQuotePolicy} from './ie-quote-access';

import type {IeQuoteFields} from './ie-quote-input';
export {ieQuoteInput,ieNumericValue,ieProcessSchema} from './ie-quote-input';
export type {IeQuoteFields} from './ie-quote-input';
export type IeQuoteLine=IeQuoteFields['lines'][number];
export type IeTooling=Entity & {kind:'ie_quote_tooling';version:number;customerAccountId:string;name:string;reference:string;chargeStatus:'uncollected'|'collected';evidence:string;updatedAt:string;updatedBy:string;updatedById:string};
export type IeCatalog=Entity & IeCatalogMetadata & {kind:'ie_quote_catalog';version:number;category:'material'|'process'|'plating'|'general';name:string;specification:string;unit:string;basePrice:number;standardSeconds:number|null;priceSource:string;effectiveDate:string;active:boolean;updatedAt:string;updatedBy:string};
export type IeQuote=Entity & IeQuoteFields & {kind:'ie_quote';version:number;revision:number;status:'draft'|'submitted'|'returned'|'released';attachmentRefs?:IeAttachmentRef[];customerName:string;customerCode:string;preparedByIds:string[];policyVersion:number;requiredReviewMemberId:string;costs:IeQuoteCosts;createdAt:string;createdBy:string;createdById:string;updatedAt:string;updatedBy:string;updatedById:string;submittedAt?:string;submittedBy?:string;submittedById?:string;reviewedAt?:string;reviewedBy?:string;reviewedById?:string;reviewReason?:string};
export type IeQuoteRevision=Entity & {kind:'ie_quote_revision';quoteId:string;version:number;revision:number;action:string;updatedAt:string;updatedBy:string;snapshot:IeQuote};
export type IeQuoteCosts=ReturnType<typeof calculateIeQuote>;
export function currentIeQuote(s:State,id:string){return all(s,'ie_quote').find(q=>q.id===id) as IeQuote|undefined;}
export function releasedIeSnapshot(s:State,id:string,version:number):IeQuote|null{
 const rows=(all(s,'ie_quote_revision') as IeQuoteRevision[]).filter(r=>r.quoteId===id&&r.version===version&&r.snapshot?.status==='released');
 if(rows.length!==1)return null;const q=rows[0].snapshot;return q.id===id&&q.version===version?q:null;
}
export const findReleasedIeVersion=releasedIeSnapshot;
export function latestReleasedIeVersion(s:State,id:string){return (all(s,'ie_quote_revision') as IeQuoteRevision[]).filter(r=>r.quoteId===id&&r.snapshot?.status==='released').sort((a,b)=>b.version-a.version)[0]?.snapshot||null;}
export function ieQuoteVersion(s:State,id:string,version?:number):IeQuote|null{
 const q=currentIeQuote(s,id);if(!q)return null;if(!version||version===q.version)return q;
 const rows=(all(s,'ie_quote_revision') as IeQuoteRevision[]).filter(r=>r.quoteId===id&&r.version===version);return rows.length===1?rows[0].snapshot:null;
}
/** Participation belongs to the quotation, including its earlier revisions. */
export function ieQuotePreparedByIds(s:State,q:Pick<IeQuote,'id'|'version'|'preparedByIds'|'createdById'>,actorId=''){
 const history=(all(s,'ie_quote_revision') as IeQuoteRevision[]).filter(r=>r.quoteId===q.id&&r.version<=q.version&&r.snapshot?.id===q.id);
 return [...new Set([q.createdById,...(q.preparedByIds||[]),...history.flatMap(r=>[r.snapshot.createdById,...(r.snapshot.preparedByIds||[])]),actorId].filter(id=>typeof id==='string'&&!!id))];
}
export function ieQuoteReviewRouting(s:State,q:Pick<IeQuote,'id'|'version'|'preparedByIds'|'createdById'>,actorId=''){
 const preparedByIds=ieQuotePreparedByIds(s,q,actorId),primary=iePolicyMember(s,'reviewer'),fallback=iePolicyMember(s,'finalApprover');
 if(!ieQuotePolicy(s)||!iePolicyMember(s,'engineer')||!primary||!fallback)return {preparedByIds,reviewer:undefined,reason:'工程报价角色中有未绑定、停用或无效成员，请管理员核对后再提交独立复核。'};
 const reviewer=[primary,fallback].find(member=>!preparedByIds.includes(member.id));
 return {preparedByIds,reviewer,reason:reviewer?'':'杨德周、曲艳红均已参与本笔报价填报，不能审核同一笔报价。请管理员安排未参与填报的独立复核人后再提交；历史参与记录不能清除。'};
}
export function canReviewIeQuote(s:State,m:Member,q:IeQuote){return isIeApprover(s,m)&&q.status==='submitted'&&q.requiredReviewMemberId===m.id&&!ieQuotePreparedByIds(s,q).includes(m.id);}
export function ieQuoteIssues(s:State,q:IeQuoteFields & {attachmentRefs?:IeAttachmentRef[];costs?:{formulaVersion?:string}},ownId=''){
 const issues:string[]=ieAttachmentIssues(s,q,ownId),need=(condition:unknown,message:string)=>{if(!condition)issues.push(message);};
 const nameReferenceIssue=validateIeMaterialNameReferences(s,q);if(nameReferenceIssue)issues.push(nameReferenceIssue);
 const costs=calculateIeQuote(q),sourceExcel=costs.formulaVersion==='ie-cost-v6-source-excel',checklist=sourceExcel||costs.formulaVersion==='ie-cost-v5-material-checklist',manualCells=new Map(costs.adjustmentCells.filter(c=>c.applied).map(c=>[c.target,c]));
 for(const c of costs.adjustmentCells)if(c.stale)issues.push(c.label+'：计算依据已变动，须重新确认人工调整或恢复自动计算');
 const account=all(s,'customer_account').find(a=>a.id===q.customerAccountId);need(account?.active,'客户档案不存在或已停用');
 need(q.quoteNo,'填写工程报价编号');need(q.quoteDate,'填写报价日期');need(q.validUntil,'填写报价有效期');need(!q.validUntil||!q.quoteDate||q.validUntil>=q.quoteDate,'有效期不能早于报价日期');need(q.batchId,'填写客户报价批次编号，用于跨款共用模具计费');
 if(sourceExcel){const source=q.sourceFormula;need(source?.sourceFilename,'填写原 Excel 来源文件名');need(source?.sourceSha256,'填写原 Excel 来源 SHA-256 摘要');need(source&&source.costExchangeRateCnyPerUsd!==null&&source.costExchangeRateCnyPerUsd>0,'填写原表美元成本汇率 H63');need(source&&source.quoteExchangeRateCnyPerUsd!==null&&source.quoteExchangeRateCnyPerUsd>0,'填写原表美元报价汇率 I67 / C73');need(source&&source.finalExchangeRateCnyPerUsd!==null&&source.finalExchangeRateCnyPerUsd>0,'填写原表人民币工厂价换算汇率 D73');need(source?.factoryMarkupRate!==null&&source?.factoryMarkupRate!==undefined,'填写原表成本加价比例 I66');}else{need(q.exchangeRateCnyPerUsd!==null&&q.exchangeRateCnyPerUsd>0,'手填正数汇率（1 USD = x CNY）');need(q.exchangeRateDate,'填写汇率采集日期');need(q.exchangeRateSource,'填写汇率来源');}
 q.lines.forEach((l,index)=>{
  const prefix=`第 ${index+1} 款：`;for(const [value,label] of [[l.model,'工厂型号'],[l.color,'颜色 / 色号'],[l.drawingNo,'图纸编号'],[l.drawingRevision,'图纸版本'],[l.structureNotes,'结构分析'],[l.scopeNotes,'报价范围']] as const)need(value,prefix+'填写'+label);
  need(l.quantityMin&&l.quantityMax,prefix+'填写数量档上下限');need(l.quantityMin===null||l.quantityMax===null||l.quantityMax>=l.quantityMin,prefix+'数量档上限不能小于下限');
  if(!checklist)need(l.materials.length,prefix+'列出材料；不适用须明确勾选');need(l.processes.length,prefix+'列出工艺；不适用须明确勾选');
  for(const category of ['plating','general'])need(l.outsourcing.some(r=>r.category===category),prefix+(category==='plating'?'电镀':'一般外发')+'须列明或显式不适用');
  l.materials.forEach((r,i)=>{const adjusted=manualCells.get(ieAdjustmentTargets.material(l.id,r.id));if(checklist){if(r.notApplicable||r.basePrice===null&&!adjusted)return;need(r.name,prefix+`材料 ${i+1} 名称为空`);need((r.lossRate??0.1)===0.1||r.lossAdjustmentReason,prefix+`材料 ${i+1} 调整默认 10% 损耗须说明原因`);return;}need(r.name,prefix+`材料 ${i+1} 名称为空`);if(r.notApplicable){need(r.notes,prefix+`材料 ${i+1} 不适用须说明`);return;}need(adjusted||r.basePrice!==null&&r.usage!==null&&r.coefficient!==null,prefix+`材料 ${i+1} 未税基价 / 用量 / 系数缺失（空白不算 0，可说明原因后人工填写本行金额）`);need(r.priceSource||adjusted?.adjustment?.reason,prefix+`材料 ${i+1} 价格依据缺失`);need((r.lossRate??0.1)===0.1||r.lossAdjustmentReason,prefix+`材料 ${i+1} 调整默认 10% 损耗须说明原因`);});
  const ids=new Set(l.processes.map(r=>r.id));
  l.processes.forEach((r,i)=>{need(r.name,prefix+`工序 ${i+1} 名称为空`);need(!r.parentId||ids.has(r.parentId)&&r.parentId!==r.id,prefix+`工序 ${i+1} 上级无效`);let next=r.parentId,seen=new Set([r.id]);while(next){if(seen.has(next)){issues.push(prefix+`工序 ${i+1} 上下级形成循环`);break;}seen.add(next);next=l.processes.find(p=>p.id===next)?.parentId||'';}if(r.notApplicable){need(r.notes,prefix+`工序 ${i+1} 不适用须说明`);return;}const adjusted=manualCells.get(ieAdjustmentTargets.process(l.id,r.id));need(adjusted||r.basePrice!==null&&r.difficulty!==null&&r.usage!==null,prefix+`工序 ${i+1} 基价 / 难度系数 / 用量缺失（可说明原因后人工填写本行金额）`);need(r.priceSource||adjusted?.adjustment?.reason,prefix+`工序 ${i+1} 价格依据缺失`);});
  l.outsourcing.forEach((r,i)=>{need(r.name,prefix+`外发 ${i+1} 名称为空`);if(r.notApplicable){need(r.notes,prefix+`外发 ${i+1} 不适用须说明`);return;}const adjusted=manualCells.get(ieAdjustmentTargets.outsourcing(l.id,r.id));need(adjusted||r.unitPrice!==null&&r.usage!==null,prefix+`外发 ${i+1} 未税单价 / 用量缺失`);need(r.priceSource||adjusted?.adjustment?.reason,prefix+`外发 ${i+1} 价格依据缺失`);});
 });
 const lineIds=new Set(q.lines.map(l=>l.id)),used=new Set<string>();
 for(const t of q.tooling){
  need(t.name,'一次性费用名称缺失');need(t.lineIds.length&&t.lineIds.every(id=>lineIds.has(id))&&new Set(t.lineIds).size===t.lineIds.length,'一次性费用须关联有效且不重复的款式');
  if(t.chargeMode==='not_applicable'){need(t.notes,'不适用的一次性费用须说明原因');continue;}
  need(t.toolingId&&!used.has(t.toolingId),'同一模具登记编号每份报价只能列一次收费条目，多款共用请选择多个款式');used.add(t.toolingId);
  const registry=all(s,'ie_quote_tooling').find(r=>r.id===t.toolingId&&r.customerAccountId===q.customerAccountId) as IeTooling|undefined;need(registry,'先选择该客户的有效模具 / 一次性费用登记编号');
  if(t.chargeMode==='charge'){
   need(t.amount!==null&&t.amount>0,'单独收费金额须为正数');need(registry?.chargeStatus!=='collected','此模具已有收费凭证，请选择已收费，不能再次收费');
   const duplicate=(all(s,'ie_quote') as IeQuote[]).flatMap(other=>[other.status==='submitted'?other:null,latestReleasedIeVersion(s,other.id)]).find(other=>other&&other.id!==ownId&&other.customerAccountId===q.customerAccountId&&other.tooling.some(r=>r.toolingId===t.toolingId&&r.chargeMode==='charge'));
   need(!duplicate,`同客户模具已在 ${duplicate?.quoteNo||''} 单独计费，请引用关联收费版本，不能通过更换批次重复列费`);
  }else if(t.chargeMode==='already_charged')need(registry?.chargeStatus==='collected'&&registry.evidence,'已收费必须已有授权审核人登记的实际收费凭证');
  else {
   const source=t.chargeVersion?releasedIeSnapshot(s,t.chargeQuoteId,t.chargeVersion):null;
   need(source&&source.id!==ownId&&latestReleasedIeVersion(s,source.id)?.version===source.version&&source.customerAccountId===q.customerAccountId&&source.tooling.some(r=>r.toolingId===t.toolingId&&r.chargeMode==='charge'),'关联报价已列费用必须引用同客户的最新已发布唯一收费版本');
  }
 }
 need(q.tooling.length,'一次性费用须明确登记，或增加一项并选择不适用');
 need(costs.adjustmentCells.every(c=>c.effectiveValue===null||Number.isFinite(c.effectiveValue)&&c.effectiveValue<=1000000000),'成本或汇率换算超过有效金额范围，请核对基价、用量、系数和汇率');
 return [...new Set(issues)];
}
export function publicIeQuote(s:State,m:Member,q:IeQuote){
 const current=currentIeQuote(s,q.id),latest=current?.version===q.version,editable=latest&&['draft','returned'].includes(q.status)&&canFillIeQuote(s,m);
 const routing=ieQuoteReviewRouting(s,q,m.id),submissionBlockReason=editable?routing.reason:'';
 const account=all(s,'customer_account').find(a=>a.id===q.customerAccountId) as CustomerAccount|undefined;
 const templateStatus=ieTemplateStatus(s,m,q),issues=ieQuoteIssues(s,q,q.id),costs=calculateIeQuote(q);
 return {...q,...ieHandoffFields(s,m,q),attachments:publicIeAttachments(s,q),costs,warnings:costs.warnings,issues,...(editable&&q.materialPricingMode!=='checklist'?{checklistIssues:ieQuoteIssues(s,{...q,materialPricingMode:'checklist',costs:undefined},q.id)}:{}),templateStatus,canExportDraftWorkbook:canReadIeQuote(s,m,q),canExportWorkbook:templateStatus.verified&&!issues.length,canEdit:!!editable,canSubmit:!!editable&&!!routing.reviewer,nextReviewMemberId:editable?routing.reviewer?.id||'':'',submissionBlockReason,canReview:!!latest&&canReviewIeQuote(s,m,q),canRevise:!!latest&&q.status==='released'&&canFillIeQuote(s,m),canExport:canReadIeQuote(s,m,q),canHandoff:q.status==='released'&&!!account&&canMaintainCustomerQuoteAccount(s,m,account),
 history:(all(s,'ie_quote_revision') as IeQuoteRevision[]).filter(r=>r.quoteId===q.id&&canReadIeQuote(s,m,r.snapshot)).sort((a,b)=>b.version-a.version).map(({version,revision,action,updatedAt,updatedBy,snapshot})=>({version,revision,action,updatedAt,updatedBy,status:snapshot.status})),
 };
}
