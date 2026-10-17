import {z} from 'zod';
import {all,now,type Member,type State} from './domain';
import {AppError,commit,json,snapshot} from './store';
import {customerQuoteInput,type CustomerQuote,type CustomerQuoteRevision} from './customer-quotes';
import {buildCustomerQuotePersistenceRecords} from './customer-quote-api';
import {detachChangedQuoteTemplate} from './customer-quote-template-api';
import {
 assertFixedToolOwner,assertFixedToolJobAccess,fixedToolCustomers,fixedToolHash,fixedToolJobId,
 findFixedToolRequest,fixedToolRequestKey,fixedToolRuleVersion,parseFixedTool,publicFixedToolJob,
 readFixedToolJson,type FixedToolJob,
} from './fixed-data-tools-common';

const operation='quote-fees';
const id=z.string().trim().min(1).max(100);
const amount=z.number().finite().min(0).max(1e9).nullable();
const proposalSchema=z.object({
 quoteId:id,version:z.number().int().positive(),
 lines:z.array(z.object({id,toolingFee:amount}).strict()).min(1).max(200),
 customerCharges:z.array(z.object({id,amount}).strict()).max(50),
}).strict();
const previewSchema=proposalSchema.extend({requestKey:fixedToolRequestKey}).strict();
const decisionSchema=z.object({id:z.string().trim().min(1).max(160),previewHash:z.string().regex(/^[a-f0-9]{64}$/),decision:z.enum(['approve','reject','defer'])}).strict();
type Proposal=z.infer<typeof proposalSchema>;

function quoteFor(s:State,m:Member,quoteId:string,requireDraft=true):CustomerQuote{
 assertFixedToolOwner(m);
 const quote=all(s,'customer_quote').find(row=>row.id===quoteId) as CustomerQuote|undefined;
 if(!quote)throw new AppError('报价不存在或不可访问。',404);
 if(!quote.customerAccountId)throw new AppError('费用维护须先由管理员在报价工作台明确关联有效客户。',409);
 const [account]=fixedToolCustomers(s,m,[quote.customerAccountId]);
 if(quote.customerName!==account.customer||(account.customerCode&&quote.customerCode!==account.customerCode))throw new AppError('报价客户与当前客户档案不一致，请先核对客户关联。',409);
 if(requireDraft&&quote.status!=='draft')throw new AppError('费用工具仅允许修改现有草稿，不能覆盖已确认报价。',409);
 return quote;
}

function quoteView(quote:CustomerQuote){
 return {
  id:quote.id,version:quote.version,quoteNo:quote.quoteNo,currency:quote.currency,
  customerAccountId:quote.customerAccountId,customerCode:quote.customerCode,customerName:quote.customerName,
  lines:quote.lines.map(line=>({id:line.id,model:line.model,descriptionZh:line.descriptionZh,descriptionEn:line.descriptionEn,toolingFee:line.toolingFee})),
  customerCharges:(quote.customerCharges||[]).map(charge=>({id:charge.id,labelZh:charge.labelZh,labelEn:charge.labelEn,amount:charge.amount})),
 };
}

function proposedQuote(before:CustomerQuote,input:Proposal):CustomerQuote{
 if(before.version!==input.version)throw new AppError('报价版本已经变化，请重新读取并预览。',409);
 const charges=before.customerCharges||[];
 if(before.lines.length!==input.lines.length||charges.length!==input.customerCharges.length
  ||before.lines.some((line,index)=>line.id!==input.lines[index].id)
  ||charges.some((charge,index)=>charge.id!==input.customerCharges[index].id))throw new AppError('费用行的数量、顺序或编号已变化；不得新增、删除或重排报价行。',409);
 const quote=structuredClone(before);
 quote.lines=before.lines.map((line,index)=>({...line,toolingFee:input.lines[index].toolingFee}));
 // Preserve absent optional arrays and every non-amount property byte for byte.
 if(before.customerCharges!==undefined)quote.customerCharges=charges.map((charge,index)=>({...charge,amount:input.customerCharges[index].amount}));
 const fields=['id','version','companyEn','companyZh','collectionEn','collectionZh','customerCode','customerName','customerAccountId','contactName','brand','businessType','quoteMode','pricingBasis','currencyReviewed','quoteNo','quoteDate','validUntil','currency','internalNotesZh','exchangeRateCnyPerUsd','internalCosts','customerCharges','lines','terms','reviewNotes'];
 // Validate the complete business proposal without applying normalization to
 // unrelated original fields. Only the explicit fee whitelist is changed.
 parseFixedTool(customerQuoteInput,Object.fromEntries(fields.filter(key=>quote[key]!==undefined).map(key=>[key,quote[key]])));
 detachChangedQuoteTemplate(before,quote);
 return quote;
}

function feePreview(before:CustomerQuote,after:CustomerQuote,expiresAt:string){
 const view=quoteView(before);
 const lines=view.lines.map((line,index)=>{const {toolingFee,...description}=line;return {...description,before:toolingFee,after:after.lines[index].toolingFee};});
 const customerCharges=view.customerCharges.map((charge,index)=>{const {amount,...description}=charge;return {...description,before:amount,after:after.customerCharges![index].amount};});
 return {
  quoteId:before.id,quoteNo:before.quoteNo,currency:before.currency,customerAccountId:before.customerAccountId,
  customerCode:before.customerCode,customerName:before.customerName,fromVersion:before.version,expiresAt,
  changes:[...lines,...customerCharges].filter(row=>row.before!==row.after).length,lines,customerCharges,
 };
}

async function approvalHash(job:FixedToolJob){
 return fixedToolHash({operation:job.operation,actorId:job.actorId,customerIds:job.customerIds,ruleVersion:job.ruleVersion,
  beforeHash:job.beforeHash,proposal:job.proposal,preview:job.preview,expiresAt:job.expiresAt});
}

export async function verifyFixedToolFeeReceipt(s:State,job:FixedToolJob):Promise<void>{
 if(job.operation!==operation||job.status!=='completed')throw new AppError('费用任务尚未提交，不能确认执行回执。',409);
 const receipt=job.receipt;
 if(!receipt||typeof receipt.quoteId!=='string'||typeof receipt.revisionId!=='string'||typeof receipt.quoteHash!=='string')throw new AppError('任务已提交但回执缺失，请核查原任务，不要重新执行。',409);
 const current=all(s,'customer_quote').find(row=>row.id===receipt.quoteId);
 if(job.customerIds.length!==1||!current||current.customerAccountId!==job.customerIds[0])throw new AppError('原任务报价的客户范围已变化，请人工核查。',403);
 const revision=s.records.find(row=>row.id===receipt.revisionId) as CustomerQuoteRevision|undefined;
 if(revision?.kind!=='customer_quote_revision'||revision.quoteId!==receipt.quoteId||revision.version!==receipt.version
  ||await fixedToolHash(revision.snapshot)!==receipt.quoteHash)throw new AppError('已提交结果未通过历史版本回读，请核查原任务，不要重新执行。',409);
}

async function verifiedResult(s:State,m:Member,job:FixedToolJob,replayed=false){
 assertFixedToolJobAccess(s,m,job);
 quoteFor(s,m,job.receipt?.quoteId,false);
 await verifyFixedToolFeeReceipt(s,job);
 const verifiedReceipt={...job.receipt,verified:true};
 return json({job:publicFixedToolJob({...job,receipt:verifiedReceipt,verification:'verified'}),receipt:verifiedReceipt,replayed});
}

export async function fixedToolFeesGet(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(action!=='fixed-tool-quote')return null;
 assertFixedToolOwner(m);
 const quoteId=parseFixedTool(id,new URL(req.url).searchParams.get('id'));
 return json({quote:quoteView(quoteFor(s,m,quoteId))});
}

export async function fixedToolFeesPost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['fixed-tool-fees-preview','fixed-tool-fees-decision'].includes(action))return null;
 assertFixedToolOwner(m);
 if(action==='fixed-tool-fees-preview'){
  const input=parseFixedTool(previewSchema,await readFixedToolJson(req)),{requestKey,...proposal}=input;
  const requestHash=await fixedToolHash({operation,input}),existing=findFixedToolRequest(s,m,requestKey,requestHash);
  if(existing){
   if(existing.operation!==operation)throw new AppError('请求编号已用于其他操作。',409);
   if(existing.status==='completed')return verifiedResult(s,m,existing,true);
   return json({job:publicFixedToolJob(existing),replayed:true});
  }
  const before=quoteFor(s,m,input.quoteId),after=proposedQuote(before,proposal);
  const createdAt=now(),expiresAt=new Date(Date.parse(createdAt)+30*60*1000).toISOString(),preview=feePreview(before,after,expiresAt);
  if(!preview.changes)throw new AppError('费用金额没有变化，无需创建确认任务。');
  const job:FixedToolJob={id:await fixedToolJobId(m,requestKey),kind:'fixed_tool_job',operation,actorId:m.id,
   customerIds:[before.customerAccountId!],createdAt,requestKey,requestHash,ruleVersion:fixedToolRuleVersion,status:'pending',
   expiresAt,beforeHash:await fixedToolHash(before),proposal,preview};
  job.previewHash=await approvalHash(job);
  await commit(s.revision,[job]);
  return json({job:publicFixedToolJob(job)});
 }
 const input=parseFixedTool(decisionSchema,await readFixedToolJson(req));
 const job=all(s,'fixed_tool_job').find(row=>row.id===input.id) as FixedToolJob|undefined;
 if(!job||job.operation!==operation)throw new AppError('费用确认任务不存在。',404);
 assertFixedToolJobAccess(s,m,job);
 if(job.previewHash!==input.previewHash||await approvalHash(job)!==input.previewHash)throw new AppError('确认内容与原预览不一致，请重新预览。',409);
 if(job.status==='completed'){
  if(input.decision!=='approve')throw new AppError('费用已经提交，不能更改原决定。',409);
  return verifiedResult(s,m,job,true);
 }
 if(job.status!=='pending')throw new AppError('此任务已拒绝或暂缓；继续处理须重新预览并确认。',409);
 if(input.decision!=='approve'){
  const decided:FixedToolJob={...job,status:input.decision==='reject'?'rejected':'deferred',updatedAt:now(),decidedById:m.id};
  await commit(s.revision,[decided]);
  return json({job:publicFixedToolJob(decided)});
 }
 if(job.ruleVersion!==fixedToolRuleVersion||!Number.isFinite(Date.parse(job.expiresAt))||Date.parse(job.expiresAt)<=Date.now())throw new AppError('预览已过期或规则已变化，请重新预览并确认。',409);
 const proposal=parseFixedTool(proposalSchema,job.proposal),before=quoteFor(s,m,proposal.quoteId);
 if(job.customerIds.length!==1||job.customerIds[0]!==before.customerAccountId||await fixedToolHash(before)!==job.beforeHash)throw new AppError('报价内容或客户范围已经变化，请重新预览并确认。',409);
 const after=proposedQuote(before,proposal),at=now();
 after.version=before.version+1;after.updatedAt=at;after.updatedBy=m.name;after.updatedById=m.id;
 const records=buildCustomerQuotePersistenceRecords(m,after,before,'固定工具 · 确认报价费用');
 const revision=records.find(row=>row.kind==='customer_quote_revision')!;
 const completed:FixedToolJob={...job,status:'completed',updatedAt:at,decidedById:m.id,receipt:{quoteId:after.id,version:after.version,revisionId:revision.id,quoteHash:await fixedToolHash(after),committedAt:at}};
 // The fee update, immutable revision, audit and task receipt are one commit.
 // A failed revision guard leaves both the quote and pending job unchanged.
 await commit(s.revision,[...records,completed]);
 return verifiedResult(await snapshot(),m,completed);
}
