import {z} from 'zod';
import {all,strictDate,type CustomerAccount,type Entity,type Member,type State} from './domain';
import {canMaintainCustomerQuoteAccount} from './customer-quote-access';
import {canReadIeQuote,ieQuotePolicy,iePolicyMember,isIeEngineeringMember} from './ie-quote-access';
import {ieTemplateStatus} from './ie-quote-template';
import {ieAttachmentIssues,publicIeAttachments,type IeAttachmentRef} from './ie-quote-attachments';
import {calculateIeQuote} from './ie-quote-calculation';
import {ieHandoffFields} from './ie-quote-handoffs';
export {calculateIeQuote} from './ie-quote-calculation';
export {canReadIeQuote,readAccess,canFinalApproveIeSales,iePolicyMember,ieQuotePolicy} from './ie-quote-access';

const text=(n=4000)=>z.string().trim().max(n).default('');
const id=z.string().trim().min(1).max(120);
const precise=(n:number)=>Math.abs(n-Math.round(n*1e6)/1e6)<=Number.EPSILON*Math.max(1,Math.abs(n))*2;
export const ieNumericValue=z.number().finite().min(0).max(100000000).refine(precise,'最多保留 6 位小数');
const num=ieNumericValue.nullable();
const date=z.string().refine(v=>{try{return !v||strictDate(v)===v;}catch{return false;}},'日期格式应为有效 YYYY-MM-DD').default('');
const catalogRef={catalogId:text(120),catalogVersion:z.number().int().positive().nullable().default(null),priceSource:text(1000)};
const material=z.object({id,name:text(240),specification:text(1000),unit:text(40),basePrice:num,usage:num,coefficient:num,lossRate:z.number().finite().min(0.1,'材料正常损耗固定为 10%，仅允许逐项追加损耗').max(10).refine(precise,'损耗比例最多保留 6 位小数').default(0.1),lossAdjustmentReason:text(1000),notApplicable:z.boolean(),notes:text(),...catalogRef}).strict();
export const ieProcessSchema=z.object({id,name:text(240),parentId:text(120),sequence:z.number().int().nonnegative().max(10000),standardSeconds:num,basePrice:num,difficulty:num,notApplicable:z.boolean(),notes:text(),...catalogRef}).strict();
const outsourcing=z.object({id,category:z.enum(['plating','general']),name:text(240),unitPrice:num,notApplicable:z.boolean(),notes:text(),...catalogRef}).strict();
const line=z.object({id,model:text(200),customerModel:text(200),color:text(200),drawingNo:text(200),drawingRevision:text(200),quantityMin:z.number().int().positive().max(10000000).nullable(),quantityMax:z.number().int().positive().max(10000000).nullable(),structureNotes:text(),scopeNotes:text(),materials:z.array(material).max(200),processes:z.array(ieProcessSchema).max(300),outsourcing:z.array(outsourcing).max(100)}).strict();
const tooling=z.object({id,toolingId:text(120),name:text(240),lineIds:z.array(id).max(100),amount:num,chargeMode:z.enum(['charge','already_charged','included_in_batch','not_applicable']),chargeQuoteId:text(120),chargeVersion:z.number().int().positive().nullable().default(null),evidence:text(),notes:text()}).strict();
export const ieQuoteInput=z.object({id:id.optional(),version:z.number().int().positive().optional(),customerAccountId:id,quoteNo:text(120),quoteDate:date,validUntil:date,batchId:text(120),exchangeRateCnyPerUsd:num,exchangeRateDate:date,exchangeRateSource:text(1000),notes:text(8000),lines:z.array(line).min(1).max(100),tooling:z.array(tooling).max(100)}).strict().superRefine((v,ctx)=>{
 if(v.id&&!v.version)ctx.addIssue({code:'custom',path:['version'],message:'编辑必须提供当前版本'});
 if(!v.id&&v.version)ctx.addIssue({code:'custom',path:['version'],message:'新建不能提供版本'});
 const unique=(items:{id:string}[],path:(string|number)[])=>{if(new Set(items.map(i=>i.id)).size!==items.length)ctx.addIssue({code:'custom',path,message:'行编号不能重复'});};
 unique(v.lines,['lines']);unique(v.tooling,['tooling']);v.lines.forEach((l,i)=>{unique(l.materials,['lines',i,'materials']);unique(l.processes,['lines',i,'processes']);unique(l.outsourcing,['lines',i,'outsourcing']);});
});
export type IeQuoteFields=Omit<z.infer<typeof ieQuoteInput>,'id'|'version'>;
export type IeQuoteLine=IeQuoteFields['lines'][number];
export type IeTooling=Entity & {kind:'ie_quote_tooling';version:number;customerAccountId:string;name:string;reference:string;chargeStatus:'uncollected'|'collected';evidence:string;updatedAt:string;updatedBy:string;updatedById:string};
export type IeCatalog=Entity & {kind:'ie_quote_catalog';version:number;category:'material'|'process'|'plating'|'general';name:string;specification:string;unit:string;basePrice:number;standardSeconds:number|null;priceSource:string;effectiveDate:string;active:boolean;updatedAt:string;updatedBy:string};
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
export function canReviewIeQuote(s:State,m:Member,q:IeQuote){return m.active&&q.status==='submitted'&&q.requiredReviewMemberId===m.id&&!q.preparedByIds.includes(m.id)&&!!all(s,'member').find(v=>v.id===m.id&&v.active);}
export function ieQuoteIssues(s:State,q:IeQuoteFields & {attachmentRefs?:IeAttachmentRef[]},ownId=''){
 const issues:string[]=ieAttachmentIssues(s,q,ownId),need=(condition:unknown,message:string)=>{if(!condition)issues.push(message);};
 const account=all(s,'customer_account').find(a=>a.id===q.customerAccountId);need(account?.active,'客户档案不存在或已停用');
 need(q.quoteNo,'填写工程报价编号');need(q.quoteDate,'填写报价日期');need(q.validUntil,'填写报价有效期');need(!q.validUntil||!q.quoteDate||q.validUntil>=q.quoteDate,'有效期不能早于报价日期');need(q.batchId,'填写客户报价批次编号，用于跨款共用模具计费');
 need(q.exchangeRateCnyPerUsd!==null&&q.exchangeRateCnyPerUsd>0,'手填正数汇率（1 USD = x CNY）');need(q.exchangeRateDate,'填写汇率采集日期');need(q.exchangeRateSource,'填写汇率来源');
 q.lines.forEach((l,index)=>{
  const prefix=`第 ${index+1} 款：`;for(const [value,label] of [[l.model,'工厂型号'],[l.color,'颜色 / 色号'],[l.drawingNo,'图纸编号'],[l.drawingRevision,'图纸版本'],[l.structureNotes,'结构分析'],[l.scopeNotes,'报价范围']] as const)need(value,prefix+'填写'+label);
  need(l.quantityMin&&l.quantityMax,prefix+'填写数量档上下限');need(l.quantityMin===null||l.quantityMax===null||l.quantityMax>=l.quantityMin,prefix+'数量档上限不能小于下限');
  need(l.materials.length,prefix+'列出材料；不适用须明确勾选');need(l.processes.length,prefix+'列出工艺；不适用须明确勾选');
  for(const category of ['plating','general'])need(l.outsourcing.some(r=>r.category===category),prefix+(category==='plating'?'电镀':'一般外发')+'须列明或显式不适用');
  l.materials.forEach((r,i)=>{need(r.name,prefix+`材料 ${i+1} 名称为空`);if(r.notApplicable){need(r.notes,prefix+`材料 ${i+1} 不适用须说明`);return;}need(r.basePrice!==null&&r.usage!==null&&r.coefficient!==null,prefix+`材料 ${i+1} 未税基价 / 用量 / 系数缺失（空白不算 0）`);need(r.priceSource,prefix+`材料 ${i+1} 价格依据缺失`);need((r.lossRate??0.1)===0.1||r.lossAdjustmentReason,prefix+`材料 ${i+1} 调整默认 10% 损耗须说明原因`);});
  const ids=new Set(l.processes.map(r=>r.id));
  l.processes.forEach((r,i)=>{need(r.name,prefix+`工序 ${i+1} 名称为空`);need(!r.parentId||ids.has(r.parentId)&&r.parentId!==r.id,prefix+`工序 ${i+1} 上级无效`);let next=r.parentId,seen=new Set([r.id]);while(next){if(seen.has(next)){issues.push(prefix+`工序 ${i+1} 上下级形成循环`);break;}seen.add(next);next=l.processes.find(p=>p.id===next)?.parentId||'';}if(r.notApplicable){need(r.notes,prefix+`工序 ${i+1} 不适用须说明`);return;}need(r.basePrice!==null&&r.difficulty!==null,prefix+`工序 ${i+1} 基价 / 难度系数缺失`);need(r.priceSource,prefix+`工序 ${i+1} 价格依据缺失`);});
  l.outsourcing.forEach((r,i)=>{need(r.name,prefix+`外发 ${i+1} 名称为空`);if(r.notApplicable){need(r.notes,prefix+`外发 ${i+1} 不适用须说明`);return;}need(r.unitPrice!==null,prefix+`外发 ${i+1} 未税单价缺失`);need(r.priceSource,prefix+`外发 ${i+1} 价格依据缺失`);});
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
 const costs=calculateIeQuote(q);need(costs.lines.every(l=>[l.material,l.materialLoss,l.process,l.plating,l.outsourcing,l.productionCost,l.factoryPriceCny,l.factoryPriceUsd].every(v=>v===null||Number.isFinite(v)&&v<=1000000000))&&(costs.toolingChargeCny===null||costs.toolingChargeCny<=1000000000),'成本或汇率换算超过有效金额范围，请核对基价、用量、系数和汇率');
 return [...new Set(issues)];
}
export function publicIeQuote(s:State,m:Member,q:IeQuote){
 const current=currentIeQuote(s,q.id),latest=current?.version===q.version,editable=latest&&['draft','returned'].includes(q.status)&&isIeEngineeringMember(s,m);
 const account=all(s,'customer_account').find(a=>a.id===q.customerAccountId) as CustomerAccount|undefined;
 const templateStatus=ieTemplateStatus(s,m,q),issues=ieQuoteIssues(s,q,q.id);
 return {...q,...ieHandoffFields(s,m,q),attachments:publicIeAttachments(s,q),costs:calculateIeQuote(q),issues,templateStatus,canExportDraftWorkbook:canReadIeQuote(s,m,q),canExportWorkbook:templateStatus.verified&&!issues.length,canEdit:!!editable,canSubmit:!!editable,canReview:!!latest&&canReviewIeQuote(s,m,q),canRevise:!!latest&&q.status==='released'&&isIeEngineeringMember(s,m),canExport:canReadIeQuote(s,m,q),canHandoff:q.status==='released'&&!!account&&canMaintainCustomerQuoteAccount(s,m,account),
 history:(all(s,'ie_quote_revision') as IeQuoteRevision[]).filter(r=>r.quoteId===q.id&&canReadIeQuote(s,m,r.snapshot)).sort((a,b)=>b.version-a.version).map(({version,revision,action,updatedAt,updatedBy,snapshot})=>({version,revision,action,updatedAt,updatedBy,status:snapshot.status})),
 };
}
