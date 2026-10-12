import {z} from 'zod';
import {all,clean,newId,now,type Entity,type Member,type State} from './domain';
import {AppError,commit,json} from './store';
import {sha} from './workbooks';
import {assignedServiceCustomer} from './service-workspace';
import {projectAccess} from './customer-projects';
import {canVerifyProjectFinance,paymentGate,pfDay,pfId,pfMoney,pfPositive,pfText,pfToken,projectAllocationNet,projectChargeAmounts,projectChargePaid,projectCreditSourceAvailable,projectCurrencies,projectFinanceTotals,projectReceiptAvailable,projectReceiptRefunded,projectReceiptReversed,type ProjectCharge,type ProjectReceipt} from './customer-project-finance';

const edit={id:pfId.optional(),version:z.number().int().positive().optional()},token={token:pfToken};
const category=z.enum(['sample','tooling','freight','sales_sample','preproduction','bulk','development','revision','repair','replacement','other']);
export const projectFinanceSchemas={
 'project-charge-save':z.object({...edit,...token,projectId:pfId,roundId:pfId,title:z.string().trim().min(1).max(240),category,currency:z.enum(projectCurrencies),amount:pfPositive,prepayAmount:pfMoney,dueDate:pfDay,note:pfText(),plan:z.array(z.object({title:z.string().trim().min(1).max(160),amount:pfPositive,dueDate:pfDay,beforeOrder:z.boolean()}).strict()).max(50).optional()}).strict(),
 'project-charge-confirm':z.object({...token,id:pfId,version:z.number().int().positive()}).strict(),
 'project-payment-requirement':z.object({...token,projectId:pfId,roundId:pfId,mode:z.enum(['charges','free']),reason:z.string().trim().min(2).max(3000),version:z.number().int().min(0)}).strict(),
 'project-payment-notice':z.object({...token,projectId:pfId,roundId:pfId,amount:pfPositive,currency:z.enum(projectCurrencies),reference:z.string().trim().min(1).max(240),note:pfText()}).strict(),
 'project-receipt-verify':z.object({...token,customerId:pfId,amount:pfPositive,currency:z.enum(projectCurrencies),date:pfDay.refine(Boolean,'请填写实际到账日期'),reference:z.string().trim().min(1).max(240),payer:pfText(240),account:z.string().trim().min(1).max(240),note:pfText(),noticeIds:z.array(pfId).max(100).default([])}).strict(),
 'project-receipt-reverse':z.object({...token,receiptId:pfId,reason:z.string().trim().min(2).max(3000)}).strict(),
 'project-allocation':z.object({...token,receiptId:pfId,chargeId:pfId,amount:pfPositive}).strict(),
 'project-allocation-release':z.object({...token,allocationId:pfId,amount:pfPositive,reason:z.string().trim().min(2).max(3000)}).strict(),
 'project-adjustment':z.object({...token,chargeId:pfId,caseId:pfId.optional(),type:z.enum(['discount','credit','waiver','debit']),amount:pfPositive,prepay:z.boolean().default(false),reason:z.string().trim().min(2).max(3000),evidence:z.string().trim().min(1).max(3000)}).strict(),
 'project-credit-apply':z.object({...token,sourceChargeId:pfId,targetChargeId:pfId,amount:pfPositive,reason:z.string().trim().min(2).max(3000),evidence:z.string().trim().min(1).max(3000)}).strict(),
 'project-document-save':z.object({...edit,...token,customerId:pfId,documentType:z.enum(['PI','CI','CHARGE','STATEMENT','CREDIT']),documentNo:z.string().trim().min(1).max(120),chargeIds:z.array(pfId).min(1).max(200),currency:z.enum(projectCurrencies),date:pfDay.refine(Boolean),customerAddress:pfText(),company:pfText(500),terms:pfText(6000),adjustmentIds:z.array(pfId).max(200).default([])}).strict(),
 'project-document-confirm':z.object({...token,id:pfId,version:z.number().int().positive()}).strict(),
 'project-document-revise':z.object({...token,id:pfId,version:z.number().int().positive(),reason:z.string().trim().min(2).max(3000)}).strict(),
 'project-document-sent':z.object({...token,id:pfId,version:z.number().int().positive(),date:pfDay.refine(Boolean),recipient:z.string().trim().min(1).max(240),reference:z.string().trim().min(1).max(1000)}).strict(),
 'project-after-sale-save':z.object({...edit,...token,projectId:pfId,roundId:pfId,orderId:pfText(160),shipmentReference:pfText(240),title:z.string().trim().min(1).max(240),description:z.string().trim().min(1).max(10000),quantity:z.number().int().min(0).max(10000000),resolution:z.enum(['pending','repair','replacement','discount','return_refund','chargeable']),status:z.enum(['open','investigating','approved','executing','awaiting_customer','closed']),ownerMemberId:pfId,dueDate:pfDay,customerEvidence:pfText(),executionNote:pfText(),returnedQuantity:z.number().int().min(0).max(10000000).default(0),completedQuantity:z.number().int().min(0).max(10000000).default(0),resentQuantity:z.number().int().min(0).max(10000000).default(0),trackingNo:pfText(240),customerAccepted:z.boolean().default(false)}).strict(),
 'project-after-sale-cost':z.object({...token,caseId:pfId,category:pfText(120),description:z.string().trim().min(1).max(3000),currency:z.enum(projectCurrencies),budget:pfMoney,actual:pfMoney,bearer:z.enum(['company','customer','supplier','shared']),supplierReference:pfText(500)}).strict(),
 'project-refund-request':z.object({...token,projectId:pfId,roundId:pfId,receiptId:pfId,caseId:pfId.optional(),amount:pfPositive,reason:z.string().trim().min(2).max(3000)}).strict(),
 'project-refund-execute':z.object({...token,id:pfId,version:z.number().int().positive(),date:pfDay.refine(Boolean),reference:z.string().trim().min(1).max(240),account:z.string().trim().min(1).max(240)}).strict(),
 'project-refund-cancel':z.object({...token,id:pfId,version:z.number().int().positive(),reason:z.string().trim().min(2).max(3000)}).strict(),
 'project-finance-grant-save':z.object({...token,...edit,memberId:pfId,customerIds:z.array(pfId).max(1000),active:z.boolean()}).strict(),
};
type FinanceAction=keyof typeof projectFinanceSchemas;
const financialKinds=new Set(['project_charge','project_payment_requirement','project_payment_notice','project_receipt','project_receipt_reversal','project_allocation','project_adjustment','project_credit_application','project_billing_document','project_document_send','project_after_sale','project_after_sale_cost','project_refund']);
function accountAccess(s:State,m:Member,customerId:string){
 const c=all(s,'customer_account').find(r=>r.id===customerId),verify=canVerifyProjectFinance(s,m,customerId);
 const commercial=!!c&&m.active&&['sales','clerk','pmc'].includes(m.role)&&assignedServiceCustomer(s,m,c as any)&&projectAccess(s,m,customerId).read;
 return {read:verify||commercial||(m.active&&m.role==='admin'&&!!c),write:verify||(commercial&&projectAccess(s,m,customerId).write),verify,customer:c};
}
function access(s:State,m:Member,customerId:string,mode:'read'|'write'|'verify'='read'){
 const result=accountAccess(s,m,customerId);if(!result[mode])throw new AppError(mode==='verify'?'只有明确获授权的财务或核实人可以确认收款及财务调整。':'没有该客户项目财务的访问权限。',403);return result;
}
function project(s:State,m:Member,projectId:string,roundId?:string,mode:'read'|'write'|'verify'='read'){
 const p=all(s,'customer_project').find(r=>r.id===projectId);if(!p)throw new AppError('项目不存在或不可访问。',403);access(s,m,p.customerId,mode);
 const r=roundId?all(s,'customer_project_round').find(r=>r.id===roundId&&r.projectId===p.id&&r.customerId===p.customerId):null;
 if(roundId&&!r)throw new AppError('开发轮次与项目不一致。');if(mode!=='read'&&(p.status==='archived'||p.status==='cancelled'))throw new AppError('归档或取消项目不能新增财务业务，请先按项目流程重新开启。',409);
 return {p,r,customerId:p.customerId as string};
}
function row(s:State,m:Member,kind:string,id:string,mode:'read'|'write'|'verify'='read'){
 const r=all(s,kind).find(r=>r.id===id);if(!r)throw new AppError('记录不存在或不可访问。',403);access(s,m,r.customerId,mode);return r;
}
function current(row:Entity,version:number|undefined){if(row.version!==version)throw new AppError('记录已更新，请刷新后重试。',409);}
function withoutRequest(record:Entity){const {requestFingerprint,...publicRecord}=record;return publicRecord;}
function financialDto(s:State,m:Member,record:Entity){if(accountAccess(s,m,record.customerId).verify)return withoutRequest(record);const {account,payer,...safe}=withoutRequest(record);return safe;}
function today(){return new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});}
function checkActualDate(date:string){if(date>today())throw new AppError('实际发生日期不能晚于今天。');}
function html(value:unknown){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));}
const money=(cents:number)=>(cents/100).toFixed(2);
function documentHtml(d:Entity){
 const statement=d.documentType==='STATEMENT',credit=d.documentType==='CREDIT';
 const lines=d.lines as Entity[],total=lines.reduce((n,l)=>n+(credit?l.creditCents:l.amountCents),0);
 return `<!doctype html><html lang="en"><meta charset="utf-8"><title>${html(d.documentType)} ${html(d.documentNo)}</title><style>body{font:14px/1.7 Arial,sans-serif;max-width:1000px;margin:32px auto;color:#172a34;padding:20px}h1{font-size:25px}table{border-collapse:collapse;width:100%;margin:24px 0}td,th{border:1px solid #bbb;padding:10px;text-align:left}.amount{text-align:right}pre{white-space:pre-wrap;font:inherit}.draft{color:#b42318;font-weight:bold}@media print{body{margin:0;padding:0}}</style><h1>${html(d.company||'DOON')} · ${html(d.documentType)}</h1>${d.status==='confirmed'?'':'<p class="draft">DRAFT — NOT CONFIRMED</p>'}<p>No. ${html(d.documentNo)} · Version ${d.version} · Date ${html(d.date)}</p><p>Customer: ${html(d.customerName)} (${html(d.customerCode)})</p><pre>${html(d.customerAddress)}</pre><table><thead><tr><th>Description</th><th>Currency</th><th>Amount</th>${statement?'<th>Applied payments</th><th>Outstanding</th>':''}</tr></thead><tbody>${lines.map(l=>`<tr><td>${html(l.title)}</td><td>${html(d.currency)}</td><td class="amount">${money(credit?l.creditCents:l.amountCents)}</td>${statement?`<td class="amount">${money(l.receivedCents)}</td><td class="amount">${money(l.balanceCents)}</td>`:''}</tr>`).join('')}</tbody></table><p>Total ${html(d.currency)} ${money(total)}</p><pre>${html(d.terms)}</pre><p>Original agreed payment schedule (before later credits or extra charges)</p><table><thead><tr><th>Description</th><th>Due date</th><th>Amount</th></tr></thead><tbody>${lines.flatMap(l=>(l.plan||[]).map((p:any)=>`<tr><td>${html(l.title)} — ${html(p.title)}</td><td>${html(p.dueDate||'As agreed')}</td><td>${html(d.currency)} ${money(p.amountCents)}</td></tr>`)).join('')}</tbody></table><p>Use your browser's print command to print or save as PDF.</p></html>`;
}

export async function customerProjectFinanceGet(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['project-finance-data','project-document-print','project-finance-history'].includes(action))return null;
 const params=new URL(req.url).searchParams;
 if(action==='project-document-print'){
  let d=row(s,m,'project_billing_document',params.get('id')||'');
  const requestedVersion=params.get('version');
  if(requestedVersion){const version=Number(requestedVersion);if(!Number.isSafeInteger(version)||version<1)throw new AppError('单据版本无效。');if(version!==d.version){const historical=all(s,'project_finance_history').find(h=>h.targetId===d.id&&h.customerId===d.customerId&&h.after?.version===version);if(!historical)throw new AppError('单据历史版本不存在。',404);d=historical.after;}}
  if(d.chargeIds.some((id:string)=>!all(s,'project_charge').some(c=>c.id===id&&c.customerId===d.customerId)))throw new AppError('单据收费来源异常，请核对。',409);
  return new Response(documentHtml(d),{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; sandbox allow-modals",'X-Content-Type-Options':'nosniff'}});
 }
 if(action==='project-finance-history'){
  const id=params.get('id')||'',target=s.records.find(r=>r.id===id&&financialKinds.has(r.kind));if(!target)throw new AppError('记录不存在。',403);access(s,m,target.customerId);
  return json({history:all(s,'project_finance_history').filter(r=>r.targetId===id&&r.customerId===target.customerId).map(h=>({...withoutRequest(h),before:h.before?financialDto(s,m,h.before):null,after:h.after?financialDto(s,m,h.after):null}))});
 }
 let customerId=params.get('customerId')||'';const projectId=params.get('projectId')||'';
 if(projectId){const {p}=project(s,m,projectId);if(customerId&&customerId!==p.customerId)throw new AppError('客户与项目不一致。');customerId=p.customerId;}
 if(customerId)access(s,m,customerId);
 const customers=all(s,'customer_account').filter(c=>(!customerId||c.id===customerId)&&accountAccess(s,m,c.id).read);
 const ids=new Set(customers.map(c=>c.id));
 const visible=(kind:string)=>all(s,kind).filter(r=>ids.has(r.customerId));
 const charges=visible('project_charge') as ProjectCharge[],receipts=visible('project_receipt') as ProjectReceipt[];
 const publicReceipt=(r:ProjectReceipt)=>{const verified=accountAccess(s,m,r.customerId).verify,{account,payer,...safe}=r;return {...safe,...(verified?{account,payer}:{}),availableCents:projectReceiptAvailable(s,r),refundedCents:projectReceiptRefunded(s,r.id),reversed:projectReceiptReversed(s,r.id)};};
 return json({customers:customers.map(c=>({id:c.id,customer:c.customer,customerCode:c.customerCode,canWrite:accountAccess(s,m,c.id).write,canVerify:accountAccess(s,m,c.id).verify})),
  projects:all(s,'customer_project').filter(p=>ids.has(p.customerId)).map(p=>({id:p.id,customerId:p.customerId,title:p.title,code:p.code,status:p.status})),rounds:all(s,'customer_project_round').filter(r=>ids.has(r.customerId)).map(r=>({id:r.id,projectId:r.projectId,title:r.title,type:r.type,status:r.status})),
  charges:charges.map(c=>({...c,net:projectChargeAmounts(s,c),creditSourceAvailableCents:projectCreditSourceAvailable(s,c)})),receipts:receipts.map(publicReceipt),allocations:visible('project_allocation').map(a=>({...a,remainingCents:projectAllocationNet(s,a)})),adjustments:visible('project_adjustment'),creditApplications:visible('project_credit_application'),documents:visible('project_billing_document'),notices:visible('project_payment_notice'),cases:visible('project_after_sale'),costs:visible('project_after_sale_cost'),refunds:visible('project_refund').map(r=>financialDto(s,m,r)),requirements:visible('project_payment_requirement'),sends:visible('project_document_send'),reversals:visible('project_receipt_reversal'),
  grants:m.role==='admin'?all(s,'project_finance_grant'):[],canVerify:!!customerId&&accountAccess(s,m,customerId).verify,canWrite:!!customerId&&accountAccess(s,m,customerId).write,totalsByCurrency:projectFinanceTotals(s,charges,receipts),totalsScope:'customer',
  projectTotalsByCurrency:projectId?projectFinanceTotals(s,charges.filter(c=>c.projectId===projectId),[]):null,gates:projectId?all(s,'customer_project_round').filter(r=>r.projectId===projectId).map(r=>({roundId:r.id,...paymentGate(s,projectId,r.id)})):[]});
}

export async function customerProjectFinancePost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!Object.prototype.hasOwnProperty.call(projectFinanceSchemas,action))return null;
 if(!m.active)throw new AppError('账号已停用。',403);
 const raw=await req.json(),schema=projectFinanceSchemas[action as FinanceAction],parsed=schema.safeParse(raw);
 if(!parsed.success)throw new AppError(parsed.error.issues.slice(0,4).map(x=>`${x.path.join('.')}：${x.message}`).join('；'));
 const input=parsed.data as any,fingerprint=await sha(JSON.stringify({action,input})),requestId='project_finance_request_'+input.token;
 const repeated=all(s,'project_finance_request').find(r=>r.id===requestId);
 if(repeated){if(repeated.actorId!==m.id||repeated.fingerprint!==fingerprint)throw new AppError('操作标识已用于其他请求。',409);if(repeated.customerId){const verifyActions=['project-charge-confirm','project-payment-requirement','project-receipt-verify','project-receipt-reverse','project-allocation','project-allocation-release','project-adjustment','project-credit-apply','project-refund-execute','project-refund-cancel'];access(s,m,repeated.customerId,verifyActions.includes(action)?'verify':'write');}else if(m.role!=='admin')throw new AppError('需要管理员权限。',403);return json({...repeated.result,idempotent:true});}
 const meta=()=>({createdAt:now(),createdBy:m.name,createdById:m.id});
 async function save(customerId:string,updates:Entity[],result:Record<string,unknown>,before:Entity|null=null){
  const at=now(),history:Entity[]=updates.filter(r=>financialKinds.has(r.kind)).map(target=>({id:newId('project_finance_history'),kind:'project_finance_history',customerId,targetId:target.id,projectId:target.projectId||'',action,actorId:m.id,actor:m.name,createdAt:at,before:before?.id===target.id?before:null,after:structuredClone(target)}));
  const resultBody={ok:true,...result};await commit(s.revision,[...updates,...history,{id:requestId,kind:'project_finance_request',customerId,actorId:m.id,fingerprint,result:resultBody,createdAt:at}]);return json(resultBody);
 }
 if(action==='project-finance-grant-save'){
  if(m.role!=='admin')throw new AppError('仅管理员可配置财务核实授权。',403);
  const member=all(s,'member').find(r=>r.id===input.memberId&&r.active&&!['supplier','viewer','programmer','production'].includes(r.role));if(!member)throw new AppError('核实人须为有效内部业务或财务成员。');
  if(new Set(input.customerIds).size!==input.customerIds.length||input.customerIds.some((id:string)=>!all(s,'customer_account').some(c=>c.id===id&&c.active)))throw new AppError('客户范围包含重复或无效客户。');
  const before=input.id?all(s,'project_finance_grant').find(r=>r.id===input.id):null;if(input.id&&!before)throw new AppError('授权不存在。');if(before){current(before,input.version);if(before.memberId!==input.memberId)throw new AppError('不能换绑授权成员。');}
  if(all(s,'project_finance_grant').some(r=>r.id!==before?.id&&r.memberId===input.memberId))throw new AppError('该成员已有财务授权，请修改原记录。',409);
  const record={id:before?.id||newId('project_finance_grant'),kind:'project_finance_grant',memberId:input.memberId,customerIds:input.customerIds,active:input.active,version:(before?.version||0)+1,...meta()};
  return save('',[record,{id:newId('project_finance_grant_history'),kind:'project_finance_grant_history',before,after:record,...meta()}],{record},before||null);
 }
 if(action==='project-charge-save'){
  const {customerId}=project(s,m,input.projectId,input.roundId,'write');
  if(input.prepayAmount>input.amount)throw new AppError('预收要求不能超过收费总额。');
  const before=input.id?row(s,m,'project_charge',input.id,'write'):null;
  if(before){current(before,input.version);if(before.status!=='draft')throw new AppError('已确认收费不可覆盖，请用财务调整保留原收费。',409);if(before.projectId!==input.projectId||before.roundId!==input.roundId||before.customerId!==customerId)throw new AppError('收费归属不能改换。');}
  const plan=input.plan?input.plan.map((p:any)=>({title:p.title,amountCents:p.amount,dueDate:p.dueDate,beforeOrder:p.beforeOrder})):[...(input.prepayAmount?[{title:'Prepayment before order',amountCents:input.prepayAmount,dueDate:input.dueDate,beforeOrder:true}]:[]),...(input.amount>input.prepayAmount?[{title:'Balance payment',amountCents:input.amount-input.prepayAmount,dueDate:input.dueDate,beforeOrder:false}]:[])];
  if(plan.reduce((n:number,p:any)=>n+p.amountCents,0)!==input.amount||plan.filter((p:any)=>p.beforeOrder).reduce((n:number,p:any)=>n+p.amountCents,0)!==input.prepayAmount)throw new AppError('付款计划合计须等于总额，下单前分期合计须等于预收要求。');
  const record:ProjectCharge={id:before?.id||newId('project_charge'),kind:'project_charge',customerId,projectId:input.projectId,roundId:input.roundId,title:input.title,category:input.category,currency:input.currency,amountCents:input.amount,prepayCents:input.prepayAmount,dueDate:input.dueDate,note:input.note,status:'draft',version:(before?.version||0)+1,plan,...meta()};
  return save(customerId,[record],{record},before);
 }
 if(action==='project-charge-confirm'){
  const before=row(s,m,'project_charge',input.id,'verify');current(before,input.version);if(before.status!=='draft')throw new AppError('收费已确认。',409);
  const record:Entity={...before,status:'confirmed',version:before.version+1,confirmedAt:now(),confirmedBy:m.name,confirmedById:m.id};return save(before.customerId,[record],{record},before);
 }
 if(action==='project-payment-requirement'){
  const {customerId}=project(s,m,input.projectId,input.roundId,'verify'),before=all(s,'project_payment_requirement').find(r=>r.projectId===input.projectId&&r.roundId===input.roundId)||null;
  if((before?.version||0)!==input.version)throw new AppError('付款要求已更新，请刷新。',409);
  const charges=all(s,'project_charge').filter(c=>c.projectId===input.projectId&&c.roundId===input.roundId);
  if(input.mode==='free'&&charges.length)throw new AppError('已有收费项，请通过批准豁免或抵扣处理，不能再声明无收费。');
  if(input.mode==='charges'&&(!charges.length||charges.some(c=>c.status!=='confirmed')))throw new AppError('请先核对确认本轮全部收费项。');
  const record={id:before?.id||newId('project_payment_requirement'),kind:'project_payment_requirement',customerId,projectId:input.projectId,roundId:input.roundId,mode:input.mode,reason:input.reason,chargeIds:charges.map(c=>c.id),version:(before?.version||0)+1,...meta()};return save(customerId,[record],{record},before);
 }
 if(action==='project-payment-notice'){
  const {customerId}=project(s,m,input.projectId,input.roundId,'write'),record={id:newId('project_payment_notice'),kind:'project_payment_notice',customerId,projectId:input.projectId,roundId:input.roundId,amountCents:input.amount,currency:input.currency,reference:input.reference,note:input.note,status:'pending',...meta()};return save(customerId,[record],{record});
 }
 if(action==='project-receipt-verify'){
  access(s,m,input.customerId,'verify');checkActualDate(input.date);
  if(all(s,'project_receipt').some(r=>r.currency===input.currency&&clean(r.reference).toLowerCase()===input.reference.toLowerCase()&&clean(r.account).toLowerCase()===input.account.toLowerCase()&&!projectReceiptReversed(s,r.id)))throw new AppError('该账户的银行流水已登记，不能换客户重复核实。',409);
  if(new Set(input.noticeIds).size!==input.noticeIds.length)throw new AppError('付款通知不可重复。');
  const notices=input.noticeIds.map((id:string)=>row(s,m,'project_payment_notice',id,'verify'));
  if(notices.some((n:Entity)=>n.customerId!==input.customerId||n.currency!==input.currency||n.status!=='pending'))throw new AppError('付款通知客户、币种或状态不一致。');
  const record:ProjectReceipt={id:newId('project_receipt'),kind:'project_receipt',customerId:input.customerId,amountCents:input.amount,currency:input.currency,date:input.date,reference:input.reference,payer:input.payer,account:input.account,note:input.note,...meta()};
  return save(input.customerId,[record,...notices.map((n:Entity)=>({...n,status:'verified',receiptId:record.id,verifiedAt:now(),verifiedBy:m.name}))],{record});
 }
 if(action==='project-receipt-reverse'){
  const receipt=row(s,m,'project_receipt',input.receiptId,'verify');if(projectReceiptReversed(s,receipt.id))throw new AppError('到账已冲销，不能重复。',409);
  if(all(s,'project_refund').some(r=>r.receiptId===receipt.id&&r.status!=='cancelled'))throw new AppError('此到账有关联退款，请先核对退款；实际退钱不能使用到账误录冲销。');
  const record={id:newId('project_receipt_reversal'),kind:'project_receipt_reversal',customerId:receipt.customerId,receiptId:receipt.id,amountCents:receipt.amountCents,currency:receipt.currency,reason:input.reason,...meta()};
  return save(receipt.customerId,[record],{record});
 }
 if(action==='project-allocation'){
  const receipt=row(s,m,'project_receipt',input.receiptId,'verify') as ProjectReceipt,charge=row(s,m,'project_charge',input.chargeId,'verify') as ProjectCharge;
  if(charge.status!=='confirmed'||receipt.customerId!==charge.customerId||receipt.currency!==charge.currency)throw new AppError('只能核销同客户同币种且已确认的收费项。');
  if(input.amount>projectReceiptAvailable(s,receipt)||input.amount>projectChargeAmounts(s,charge).balanceCents)throw new AppError('分配超过可用到账或未收余额。');
  const record={id:newId('project_allocation'),kind:'project_allocation',customerId:charge.customerId,projectId:charge.projectId,roundId:charge.roundId,receiptId:receipt.id,chargeId:charge.id,amountCents:input.amount,entryType:'allocate',originalId:'',reason:'确认收款用途分配',...meta()};return save(charge.customerId,[record],{record});
 }
 if(action==='project-allocation-release'){
  const original=row(s,m,'project_allocation',input.allocationId,'verify');if(original.entryType!=='allocate'||input.amount>projectAllocationNet(s,original))throw new AppError('释放金额超过该笔有效分配。');
  const record={...original,id:newId('project_allocation'),entryType:'release',originalId:original.id,amountCents:input.amount,reason:input.reason,...meta()};return save(original.customerId,[record],{record});
 }
 if(action==='project-adjustment'){
  const charge=row(s,m,'project_charge',input.chargeId,'verify') as ProjectCharge;if(charge.status!=='confirmed')throw new AppError('须先确认原收费再登记调整。');
  if(input.caseId){const c=row(s,m,'project_after_sale',input.caseId,'verify');if(c.projectId!==charge.projectId||c.customerId!==charge.customerId)throw new AppError('售后与收费不属于同一项目。');if(c.status==='closed')throw new AppError('已关闭售后不能追加调整。');}
  const totals=projectChargeAmounts(s,charge);if(input.type!=='debit'&&input.amount>totals.amountCents)throw new AppError('减免或贷项超过原收费净额。');
  const usedCredits=all(s,'project_credit_application').filter(a=>a.sourceChargeId===charge.id).reduce((n,a)=>n+a.amountCents,0);if(input.type!=='debit'&&totals.amountCents-input.amount<usedCredits)throw new AppError('该收费已用于抵扣，请先核对既有抵扣，不能减少到已用额度以下。');
  const record:Entity={id:newId('project_adjustment'),kind:'project_adjustment',customerId:charge.customerId,projectId:charge.projectId,roundId:charge.roundId,chargeId:charge.id,caseId:input.caseId||'',type:input.type,amountCents:input.amount,currency:charge.currency,prepay:input.prepay,reason:input.reason,evidence:input.evidence,...meta()};
  const updates:Entity[]=[record];let excess=input.type==='debit'?0:Math.max(0,totals.receivedCents-(totals.amountCents-input.amount));
  for(const original of all(s,'project_allocation').filter(a=>a.chargeId===charge.id&&a.entryType==='allocate')){if(!excess)break;const amount=Math.min(excess,projectAllocationNet(s,original));if(amount){updates.push({...original,id:newId('project_allocation'),entryType:'release',originalId:original.id,amountCents:amount,reason:'贷项/豁免释放原分配，关联 '+record.id,...meta()});excess-=amount;}}
  record.releasedCents=updates.slice(1).reduce((n,r)=>n+r.amountCents,0);return save(charge.customerId,updates,{record,releasedCents:record.releasedCents});
 }
 if(action==='project-credit-apply'){
  const source=row(s,m,'project_charge',input.sourceChargeId,'verify') as ProjectCharge,target=row(s,m,'project_charge',input.targetChargeId,'verify') as ProjectCharge;
  if(source.id===target.id||source.customerId!==target.customerId||source.currency!==target.currency||source.status!=='confirmed'||target.status!=='confirmed')throw new AppError('抵扣须引用同客户同币种的两个已确认收费项。');
  if(all(s,'project_credit_application').some(a=>a.targetChargeId===source.id))throw new AppError('已接受抵扣的收费不能再作为抵扣来源，避免循环或重复信用。');
  if(input.amount>projectCreditSourceAvailable(s,source)||input.amount>projectChargeAmounts(s,target).balanceCents)throw new AppError('抵扣超过来源已收可用额度或目标未收余额。');
  const adjustment:Entity={id:newId('project_adjustment'),kind:'project_adjustment',customerId:target.customerId,projectId:target.projectId,roundId:target.roundId,chargeId:target.id,caseId:'',type:'credit',amountCents:input.amount,currency:target.currency,prepay:false,reason:input.reason,evidence:input.evidence,sourceChargeId:source.id,releasedCents:0,...meta()};
  const record={id:newId('project_credit_application'),kind:'project_credit_application',customerId:target.customerId,projectId:target.projectId,roundId:target.roundId,sourceChargeId:source.id,targetChargeId:target.id,adjustmentId:adjustment.id,amountCents:input.amount,currency:target.currency,reason:input.reason,evidence:input.evidence,...meta()};return save(target.customerId,[adjustment,record],{record,adjustment});
 }
 if(action==='project-document-save'){
  const {customer}=access(s,m,input.customerId,'write'),before=input.id?row(s,m,'project_billing_document',input.id,'write'):null;
  if(before){current(before,input.version);if(before.status!=='draft')throw new AppError('已核对单据须先创建修订草稿。',409);if(before.customerId!==input.customerId)throw new AppError('单据客户不能改换。');}
  if(new Set(input.chargeIds).size!==input.chargeIds.length||new Set(input.adjustmentIds).size!==input.adjustmentIds.length)throw new AppError('单据不能重复引用同一收费或调整。');
  const charges=input.chargeIds.map((id:string)=>row(s,m,'project_charge',id,'write') as ProjectCharge);
  if(charges.some((c:ProjectCharge)=>c.customerId!==input.customerId||c.currency!==input.currency||c.status!=='confirmed'))throw new AppError('单据只能引用同客户同币种已确认收费。');
  if(all(s,'project_billing_document').some(d=>d.id!==before?.id&&d.customerId===input.customerId&&d.documentType===input.documentType&&d.documentNo.toLowerCase()===input.documentNo.toLowerCase()))throw new AppError('同客户同类单据号已存在。',409);
  const adjustments=input.adjustmentIds.map((id:string)=>row(s,m,'project_adjustment',id,'write'));
  if(adjustments.some((a:Entity)=>!input.chargeIds.includes(a.chargeId)||a.type==='debit'))throw new AppError('贷项单只能引用选中收费的减免调整。');
  if(input.documentType==='CREDIT'&&!adjustments.length)throw new AppError('贷项单须明确引用已有调整；生成单据不会重复减少应收。');
  const lines=charges.map((c:ProjectCharge)=>({chargeId:c.id,projectId:c.projectId,roundId:c.roundId,title:c.title,currency:c.currency,...projectChargeAmounts(s,c),plan:c.plan,creditCents:adjustments.filter((a:Entity)=>a.chargeId===c.id).reduce((n:number,a:Entity)=>n+a.amountCents,0)}));
  const record={id:before?.id||newId('project_billing_document'),kind:'project_billing_document',customerId:input.customerId,customerName:customer!.customer,customerCode:customer!.customerCode,documentType:input.documentType,documentNo:input.documentNo,currency:input.currency,date:input.date,chargeIds:input.chargeIds,adjustmentIds:input.adjustmentIds,lines,customerAddress:input.customerAddress,company:input.company,terms:input.terms,status:'draft',version:(before?.version||0)+1,...meta()};return save(input.customerId,[record],{record},before);
 }
 if(['project-document-confirm','project-document-revise','project-document-sent'].includes(action)){
  const before=row(s,m,'project_billing_document',input.id,'write');current(before,input.version);
  if(action==='project-document-confirm'){
   if(before.status!=='draft')throw new AppError('单据已核对。',409);
   for(const line of before.lines){const c=row(s,m,'project_charge',line.chargeId) as ProjectCharge,t=projectChargeAmounts(s,c);if(c.status!=='confirmed'||t.amountCents!==line.amountCents||(before.documentType==='STATEMENT'&&(t.receivedCents!==line.receivedCents||t.balanceCents!==line.balanceCents)))throw new AppError('收费或收款发生变化，请先重新保存单据快照。',409);}
   const record={...before,status:'confirmed',version:before.version+1,confirmedAt:now(),confirmedBy:m.name,confirmedById:m.id};return save(before.customerId,[record],{record},before);
  }
  if(before.status!=='confirmed')throw new AppError('只有核对后的单据可修订或登记发送。',409);
  if(action==='project-document-revise'){const record={...before,status:'draft',version:before.version+1,revisionReason:input.reason,confirmedAt:'',confirmedBy:'',confirmedById:''};return save(before.customerId,[record],{record},before);}
  checkActualDate(input.date);const record={id:newId('project_document_send'),kind:'project_document_send',customerId:before.customerId,documentId:before.id,documentVersion:before.version,date:input.date,recipient:input.recipient,reference:input.reference,...meta()};return save(before.customerId,[record],{record});
 }
 if(action==='project-after-sale-save'){
  const {p,customerId}=project(s,m,input.projectId,input.roundId,'write'),before=input.id?row(s,m,'project_after_sale',input.id,'write'):null;
  if(before){current(before,input.version);if(before.projectId!==p.id||before.roundId!==input.roundId)throw new AppError('售后归属不能改换。');if(before.status==='closed'&&input.status!=='open')throw new AppError('已关闭售后须先重新开启，不能改写结案内容。',409);}
  if(input.orderId){const order=all(s,'order').find(o=>o.id===input.orderId),link=all(s,'customer_project_handover').find(l=>l.projectId===p.id&&(l.orderLinks||[]).some((line:any)=>line.orderId===input.orderId));if(!order||!link)throw new AppError('售后订单须来自本项目已关联订单。');}
  const owner=all(s,'member').find(r=>r.id===input.ownerMemberId&&r.active&&r.role!=='supplier') as Member|undefined;if(!owner||!(projectAccess(s,owner,customerId).read||projectAccess(s,owner,customerId).internal||canVerifyProjectFinance(s,owner,customerId)))throw new AppError('请选择有本客户权限或内部执行职责的有效责任人。');
  if(input.returnedQuantity>input.quantity||input.completedQuantity>input.quantity||input.resentQuantity>input.completedQuantity)throw new AppError('退回、处理和重寄数量不一致。');
  if(!before&&!['open','investigating'].includes(input.status))throw new AppError('新售后请先登记调查，再核对处理方案。');
  if(['approved','executing','awaiting_customer','closed'].includes(input.status)&&(input.resolution==='pending'||!input.customerEvidence))throw new AppError('执行或关闭前须明确处理方案及客户确认依据。');
  if(['executing','awaiting_customer','closed'].includes(input.status)&&!['approved','executing','awaiting_customer'].includes(before?.status))throw new AppError('请先确认售后处理方案。');
  if(input.status==='closed'){
   if(!input.customerAccepted||!input.customerEvidence||!input.executionNote)throw new AppError('结案须有执行说明和客户确认依据。');
   if(['repair','replacement'].includes(input.resolution)&&(input.completedQuantity!==input.quantity||input.resentQuantity!==input.quantity))throw new AppError('返修或补货数量尚未完成。');
   if(all(s,'project_refund').some(r=>r.caseId===before?.id&&r.status==='requested'))throw new AppError('售后仍有待执行退款。');
   if(['discount','return_refund'].includes(input.resolution)&&!all(s,'project_adjustment').some(a=>a.caseId===before?.id&&['discount','credit'].includes(a.type)))throw new AppError('折让或退货退款须有对应有效贷项调整。');
   if(input.resolution==='return_refund'&&input.returnedQuantity!==input.quantity)throw new AppError('退货数量尚未核对完成。');
   if(input.resolution==='return_refund'){const released=all(s,'project_adjustment').filter(a=>a.caseId===before?.id).reduce((n,a)=>n+(a.releasedCents||0),0),refunded=all(s,'project_refund').filter(r=>r.caseId===before?.id&&r.status==='executed').reduce((n,r)=>n+r.amountCents,0);if(refunded<released)throw new AppError('退货退款方案仍有已收款应退金额未实际退款。');}
   if(input.resolution==='chargeable'&&!all(s,'project_adjustment').some(a=>a.caseId===before?.id&&a.type==='debit'))throw new AppError('对客收费售后须有对应已确认补收费。');
  }
  const {token,id,version,...fields}=input,record={...fields,id:before?.id||newId('project_after_sale'),kind:'project_after_sale',customerId,version:(before?.version||0)+1,...meta()};return save(customerId,[record],{record},before);
 }
 if(action==='project-after-sale-cost'){
  const c=row(s,m,'project_after_sale',input.caseId,'write');if(c.status==='closed')throw new AppError('已关闭售后不能追加成本。');
  const record={id:newId('project_after_sale_cost'),kind:'project_after_sale_cost',customerId:c.customerId,projectId:c.projectId,roundId:c.roundId,caseId:c.id,category:input.category,description:input.description,currency:input.currency,budgetCents:input.budget,actualCents:input.actual,bearer:input.bearer,supplierReference:input.supplierReference,...meta()};return save(c.customerId,[record],{record});
 }
 if(action==='project-refund-request'){
  const {customerId}=project(s,m,input.projectId,input.roundId,'write'),receipt=row(s,m,'project_receipt',input.receiptId);
  if(receipt.customerId!==customerId||projectReceiptReversed(s,receipt.id))throw new AppError('退款收款来源无效。');
  if(input.caseId){const c=row(s,m,'project_after_sale',input.caseId,'write');if(c.projectId!==input.projectId||c.status==='closed')throw new AppError('退款售后来源无效。');}
  const record={id:newId('project_refund'),kind:'project_refund',customerId,projectId:input.projectId,roundId:input.roundId,receiptId:receipt.id,caseId:input.caseId||'',amountCents:input.amount,currency:receipt.currency,reason:input.reason,status:'requested',version:1,...meta()};return save(customerId,[record],{record});
 }
 if(action==='project-refund-execute'||action==='project-refund-cancel'){
  const before=row(s,m,'project_refund',input.id,'verify');current(before,input.version);if(before.status!=='requested')throw new AppError('退款已处理。',409);
  if(action==='project-refund-cancel'){const record={...before,status:'cancelled',version:before.version+1,cancelReason:input.reason,cancelledAt:now(),cancelledBy:m.name};return save(before.customerId,[record],{record},before);}
  checkActualDate(input.date);const receipt=row(s,m,'project_receipt',before.receiptId,'verify') as ProjectReceipt;
  if(before.amountCents>projectReceiptAvailable(s,receipt))throw new AppError('退款超过未分配款。已核销收费须先依据贷项释放原分配，不能把退款变成客户重新欠款。');
  if(all(s,'project_refund').some(r=>r.status==='executed'&&r.currency===before.currency&&r.account===input.account&&r.reference===input.reference))throw new AppError('退款流水已登记。',409);
  const record={...before,status:'executed',version:before.version+1,date:input.date,reference:input.reference,account:input.account,executedAt:now(),executedBy:m.name,executedById:m.id};return save(before.customerId,[record],{record},before);
 }
 throw new AppError('不支持的项目财务操作。',404);
}
