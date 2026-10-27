import {z} from 'zod';
import {all,canRead,clean,newId,now,type Entity,type Member,type State} from './domain';
import {AppError,commit,json} from './store';
import {sha} from './workbooks';
import {assignedServiceCustomer,serviceOrderCustomerKeys} from './service-workspace';
import {assertProjectNotTrashed,projectAccess,projectKey} from './customer-projects';
import {canReadProjectFinance,canVerifyProjectFinance,paymentGate,pfDay,pfId,pfMoney,pfPositive,pfText,pfToken,projectAllocationNet,projectChargeAmounts,projectChargePaid,projectCreditSourceAvailable,projectCurrencies,projectFinanceTotals,projectReceiptAvailable,projectReceiptRefunded,projectReceiptReversed,type ProjectCharge,type ProjectReceipt} from './customer-project-finance';
import {paymentTermsReadOnly} from './payment-terms';

const edit={id:pfId.optional(),version:z.number().int().positive().optional()},token={token:pfToken};
const defaulted=<T extends z.ZodTypeAny>(schema:T,value:z.input<T>)=>z.preprocess(v=>v===''||v===undefined?value:v,schema);
const category=defaulted(z.enum(['sample','tooling','freight','sales_sample','preproduction','bulk','development','revision','repair','replacement','other']),'sample');
const optionalLink=pfText(160),entryMoney=defaulted(pfMoney,'0'),entryCurrency=defaulted(z.enum(projectCurrencies),'USD');
const entryQuantity=defaulted(z.number().int().min(0),0);
const entrySchemas={
 receipts:z.object({amount:entryMoney,currency:entryCurrency,date:pfDay,reference:pfText(240),payer:pfText(240),account:pfText(240),note:pfText()}),
 allocations:z.object({receiptId:optionalLink,chargeId:optionalLink,amount:entryMoney,currency:entryCurrency,reason:pfText()}),
 adjustments:z.object({chargeId:optionalLink,caseId:optionalLink,type:defaulted(z.enum(['discount','credit','waiver','debit']),'discount'),amount:entryMoney,currency:entryCurrency,prepay:z.boolean().default(false),reason:pfText(),evidence:pfText()}),
 creditApplications:z.object({sourceChargeId:optionalLink,targetChargeId:optionalLink,amount:entryMoney,currency:entryCurrency,reason:pfText(),evidence:pfText()}),
 refunds:z.object({receiptId:optionalLink,caseId:optionalLink,amount:entryMoney,currency:entryCurrency,reason:pfText(),date:pfDay,reference:pfText(240),account:pfText(240)}),
};
const entryKinds={receipts:'project_receipt',allocations:'project_allocation',adjustments:'project_adjustment',creditApplications:'project_credit_application',refunds:'project_refund'} as const;
export const projectFinanceSchemas={
 'project-finance-entry-save':z.object({...edit,...token,projectId:pfId,roundId:optionalLink,entryType:z.enum(['receipts','allocations','adjustments','creditApplications','refunds']),data:z.record(z.unknown())}).strict(),
 'project-charge-save':z.object({...edit,...token,projectId:pfId,roundId:optionalLink,title:pfText(240),category,currency:entryCurrency,amount:entryMoney,prepayAmount:entryMoney,dueDate:pfDay,note:pfText(),plan:z.array(z.object({title:pfText(160),amount:entryMoney,dueDate:pfDay,beforeOrder:z.boolean().default(false)}).strict()).optional()}).strict(),
 'project-charge-confirm':z.object({...token,id:pfId,version:z.number().int().positive()}).strict(),
 'project-payment-requirement':z.object({...token,projectId:pfId,roundId:pfId,mode:z.enum(['charges','free']),reason:z.string().trim().min(2).max(3000),version:z.number().int().min(0)}).strict(),
 'project-payment-notice':z.object({...edit,...token,projectId:pfId,roundId:optionalLink,amount:entryMoney,currency:entryCurrency,reference:pfText(240),note:pfText()}).strict(),
 'project-receipt-verify':z.object({...token,customerId:pfId,amount:pfPositive,currency:z.enum(projectCurrencies),date:pfDay.refine(Boolean,'请填写实际到账日期'),reference:z.string().trim().min(1).max(240),payer:pfText(240),account:z.string().trim().min(1).max(240),note:pfText(),noticeIds:z.array(pfId).default([])}).strict(),
 'project-receipt-reverse':z.object({...token,receiptId:pfId,reason:z.string().trim().min(2).max(3000)}).strict(),
 'project-allocation':z.object({...token,receiptId:pfId,chargeId:pfId,amount:pfPositive}).strict(),
 'project-allocation-release':z.object({...token,allocationId:pfId,amount:pfPositive,reason:z.string().trim().min(2).max(3000)}).strict(),
 'project-adjustment':z.object({...token,chargeId:pfId,caseId:pfId.optional(),type:z.enum(['discount','credit','waiver','debit']),amount:pfPositive,prepay:z.boolean().default(false),reason:z.string().trim().min(2).max(3000),evidence:z.string().trim().min(1).max(3000)}).strict(),
 'project-credit-apply':z.object({...token,sourceChargeId:pfId,targetChargeId:pfId,amount:pfPositive,reason:z.string().trim().min(2).max(3000),evidence:z.string().trim().min(1).max(3000)}).strict(),
 'project-document-save':z.object({...edit,...token,customerId:pfId,projectId:optionalLink,roundId:optionalLink,manualTitle:pfText(3000),manualAmount:entryMoney,documentType:defaulted(z.enum(['PI','CI','CHARGE','STATEMENT','CREDIT']),'PI'),documentNo:pfText(120),chargeIds:z.array(pfId).default([]),currency:entryCurrency,date:pfDay,customerAddress:pfText(),company:pfText(500),terms:pfText(6000),adjustmentIds:z.array(pfId).default([])}).strict(),
 'project-document-confirm':z.object({...token,id:pfId,version:z.number().int().positive()}).strict(),
 'project-document-revise':z.object({...token,id:pfId,version:z.number().int().positive(),reason:z.string().trim().min(2).max(3000)}).strict(),
 'project-document-sent':z.object({...token,id:pfId.optional(),sendId:pfId.optional(),version:z.number().int().positive().optional(),projectId:optionalLink,roundId:optionalLink,documentId:optionalLink,expectedDocumentVersion:z.number().int().positive().optional(),date:pfDay,recipient:pfText(240),reference:pfText(1000)}).strict(),
 'project-after-sale-save':z.object({...edit,...token,projectId:pfId,roundId:optionalLink,orderId:pfText(160),shipmentReference:pfText(240),title:pfText(240),description:pfText(10000),quantity:entryQuantity,resolution:defaulted(z.enum(['pending','repair','replacement','discount','return_refund','chargeable']),'pending'),status:defaulted(z.enum(['open','investigating','approved','executing','awaiting_customer','closed']),'open'),ownerMemberId:optionalLink,dueDate:pfDay,customerEvidence:pfText(),executionNote:pfText(),returnedQuantity:entryQuantity,completedQuantity:entryQuantity,resentQuantity:entryQuantity,trackingNo:pfText(240),customerAccepted:z.boolean().default(false)}).strict(),
 'project-after-sale-cost':z.object({...edit,...token,projectId:optionalLink,roundId:optionalLink,caseId:optionalLink,category:pfText(120),description:pfText(3000),currency:entryCurrency,budget:entryMoney,actual:entryMoney,bearer:defaulted(z.enum(['company','customer','supplier','shared']),'company'),supplierReference:pfText(500)}).strict(),
 'project-refund-request':z.object({...token,projectId:pfId,roundId:optionalLink,receiptId:pfId,caseId:pfId.optional(),amount:pfPositive,reason:z.string().trim().min(2).max(3000)}).strict(),
 'project-refund-execute':z.object({...token,id:pfId,version:z.number().int().positive(),date:pfDay.refine(Boolean),reference:z.string().trim().min(1).max(240),account:z.string().trim().min(1).max(240)}).strict(),
 'project-refund-cancel':z.object({...token,id:pfId,version:z.number().int().positive(),reason:z.string().trim().min(2).max(3000)}).strict(),
 'project-finance-grant-save':z.object({...token,...edit,memberId:pfId,customerIds:z.array(pfId),active:z.boolean()}).strict(),
};
type FinanceAction=keyof typeof projectFinanceSchemas;
const financialKinds=new Set(['project_charge','project_payment_requirement','project_payment_notice','project_receipt','project_receipt_reversal','project_allocation','project_adjustment','project_credit_application','project_billing_document','project_document_send','project_after_sale','project_after_sale_cost','project_refund','project_finance_entry']);
function accountAccess(s:State,m:Member,customerId:string){
 const c=all(s,'customer_account').find(r=>r.id===customerId),verify=canVerifyProjectFinance(s,m,customerId);
 const commercial=!!c&&m.active&&['sales','clerk','pmc'].includes(m.role)&&assignedServiceCustomer(s,m,c as any)&&projectAccess(s,m,customerId).read;
 return {read:canReadProjectFinance(s,m,customerId)||commercial||(m.active&&m.role==='admin'&&!!c),write:!paymentTermsReadOnly(s,m)&&(verify||(commercial&&projectAccess(s,m,customerId).write)),verify,customer:c};
}
function access(s:State,m:Member,customerId:string,mode:'read'|'write'|'verify'='read'){
 const result=accountAccess(s,m,customerId);if(!result[mode])throw new AppError(mode==='verify'?'只有明确获授权的财务或核实人可以确认收款及财务调整。':'没有该客户项目财务的访问权限。',403);return result;
}
function project(s:State,m:Member,projectId:string,roundId?:string,mode:'read'|'write'|'verify'='read'){
 const p=all(s,'customer_project').find(r=>r.id===projectId);if(!p)throw new AppError('项目不存在或不可访问。',403);access(s,m,p.customerId,mode);
 if(mode!=='read')assertProjectNotTrashed(p);
 const r=roundId?all(s,'customer_project_round').find(r=>r.id===roundId&&r.projectId===p.id&&r.customerId===p.customerId):null;
 if(roundId&&!r)throw new AppError('开发轮次与项目不一致。');
 return {p,r,customerId:p.customerId as string};
}
function row(s:State,m:Member,kind:string,id:string,mode:'read'|'write'|'verify'='read'){
 const r=all(s,kind).find(r=>r.id===id);if(!r)throw new AppError('记录不存在或不可访问。',403);access(s,m,r.customerId,mode);if(mode!=='read')assertFinancialProjectsWritable(s,r);return r;
}
// Documents may contain several projects, and customer-level receipts may link
// payment notices. Follow explicit sources without locking unrelated receipts.
function assertFinancialProjectsWritable(s:State,record:Entity,seen=new Set<string>()){
 if(record.id){if(seen.has(record.id))return;seen.add(record.id);}
 if(record.projectId){const p=all(s,'customer_project').find(p=>p.id===record.projectId);if(p)assertProjectNotTrashed(p);}
 const references=[record.chargeId,record.sourceChargeId,record.targetChargeId,record.caseId,record.receiptId,record.documentId,...(record.chargeIds||[]),...(record.adjustmentIds||[]),...(record.noticeIds||[])].filter(Boolean);
 for(const id of references){const linked=s.records.find(r=>r.id===id&&financialKinds.has(r.kind));if(linked)assertFinancialProjectsWritable(s,linked,seen);}
 if(record.kind==='project_receipt'){
  const linked=[...all(s,'project_payment_notice').filter(r=>r.receiptId===record.id),...all(s,'project_allocation').filter(r=>r.receiptId===record.id&&projectAllocationNet(s,r)>0),...all(s,'project_refund').filter(r=>r.receiptId===record.id&&r.status!=='cancelled')];
  for(const source of linked)assertFinancialProjectsWritable(s,source,seen);
 }
 for(const line of record.lines||[])assertFinancialProjectsWritable(s,line,seen);
}
function current(row:Entity,version:number|undefined){if((row.version||1)!==version)throw new AppError('记录已更新，请刷新后重试。',409);}
function assertDocumentNotIssued(s:State,document:Entity){if(all(s,'ar_document_issue').some(issue=>issue.sourceKind===document.kind&&issue.sourceId===document.id))throw new AppError('该 PI 已签发生效并形成应收，原合同与版本已锁定；金额或条款变更须另行记录调整，不能覆盖原单。',409);}
function issuedCharge(s:State,charge:Entity){return !!charge.sourceDocumentId&&all(s,'ar_document_issue').some(issue=>issue.sourceId===charge.sourceDocumentId&&issue.sourceKind==='project_billing_document'&&Array.isArray(issue.chargeIds)&&issue.chargeIds.includes(charge.id));}
const chargePlanContract=(plan:any[])=>plan.map(p=>({title:p.title,amountCents:p.amountCents,dueDate:p.dueDate,beforeOrder:p.beforeOrder===true}));
function verifyChargePlan(record:Entity){
 const plan=record.plan||[];
 if(!record.title||record.amountCents<=0||record.prepayCents>record.amountCents)throw new AppError('核实收费须有费用名称及有效总额，预收要求不能超过收费总额。');
 if(plan.some((p:any)=>!p.title||p.amountCents<=0)||plan.reduce((n:number,p:any)=>n+p.amountCents,0)!==record.amountCents||plan.filter((p:any)=>p.beforeOrder).reduce((n:number,p:any)=>n+p.amountCents,0)!==record.prepayCents)throw new AppError('核实前请补齐分期名称与金额；付款计划合计须等于总额，下单前分期合计须等于预收要求。');
}
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
 const liveProjects=all(s,'customer_project').filter(p=>ids.has(p.customerId)&&!p.trashedAt),liveProjectIds=new Set(liveProjects.map(p=>p.id));
 const projectWritable=!projectId||liveProjectIds.has(projectId);
 const visible=(kind:string)=>all(s,kind).filter(r=>ids.has(r.customerId));
 const charges=visible('project_charge') as ProjectCharge[],receipts=visible('project_receipt') as ProjectReceipt[];
 const entries=visible('project_finance_entry').filter(r=>!projectId||r.projectId===projectId);
 const withEntries=(type:keyof typeof entryKinds,records:Entity[])=>[...records,...entries.filter(r=>r.entryType===type).map(r=>({...financialDto(s,m,r),independent:true,status:'draft',availableCents:0,refundedCents:0,remainingCents:0,reversed:false,entryType:type==='allocations'?'allocate':r.entryType}))];
 const publicReceipt=(r:ProjectReceipt)=>{const verified=accountAccess(s,m,r.customerId).verify,{account,payer,...safe}=r;return {...safe,...(verified?{account,payer}:{}),availableCents:projectReceiptAvailable(s,r),refundedCents:projectReceiptRefunded(s,r.id),reversed:projectReceiptReversed(s,r.id)};};
 return json({cliWriteProtocol:'doon-project-finance-write-v1',customers:customers.map(c=>({id:c.id,customer:c.customer,customerCode:c.customerCode,canWrite:accountAccess(s,m,c.id).write,canVerify:accountAccess(s,m,c.id).verify})),
  projects:liveProjects.map(p=>({id:p.id,customerId:p.customerId,title:p.title,code:p.code,status:p.status})),rounds:all(s,'customer_project_round').filter(r=>ids.has(r.customerId)&&liveProjectIds.has(r.projectId)).map(r=>({id:r.id,projectId:r.projectId,title:r.title,type:r.type,status:r.status})),
  charges:charges.map(c=>({...c,net:projectChargeAmounts(s,c),creditSourceAvailableCents:projectCreditSourceAvailable(s,c)})),receipts:withEntries('receipts',receipts.map(publicReceipt)),allocations:withEntries('allocations',visible('project_allocation').map(a=>({...a,currency:a.currency||charges.find(c=>c.id===a.chargeId)?.currency||'USD',remainingCents:projectAllocationNet(s,a)}))),adjustments:withEntries('adjustments',visible('project_adjustment')),creditApplications:withEntries('creditApplications',visible('project_credit_application')),documents:visible('project_billing_document'),notices:visible('project_payment_notice'),cases:visible('project_after_sale'),costs:visible('project_after_sale_cost'),refunds:withEntries('refunds',visible('project_refund').map(r=>financialDto(s,m,r))),requirements:visible('project_payment_requirement'),sends:visible('project_document_send'),reversals:visible('project_receipt_reversal'),
   grants:m.role==='admin'?all(s,'project_finance_grant'):[],grantCustomers:m.role==='admin'?all(s,'customer_account').map(c=>({id:c.id,customer:c.customer,customerCode:c.customerCode,active:c.active})):[],canVerify:projectWritable&&!!customerId&&accountAccess(s,m,customerId).verify,canWrite:projectWritable&&!!customerId&&accountAccess(s,m,customerId).write,totalsByCurrency:projectFinanceTotals(s,charges,receipts),totalsScope:'customer',
  projectTotalsByCurrency:projectId?projectFinanceTotals(s,charges.filter(c=>c.projectId===projectId),[]):null,gates:projectId?all(s,'customer_project_round').filter(r=>r.projectId===projectId).map(r=>({roundId:r.id,...paymentGate(s,projectId,r.id)})):[]});
}

export async function customerProjectFinancePost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!Object.prototype.hasOwnProperty.call(projectFinanceSchemas,action))return null;
 if(!m.active)throw new AppError('账号已停用。',403);
 if(paymentTermsReadOnly(s,m))throw new AppError('当前账号仅有取数与总览权限，不能修改项目财务、核实到账、审核或调整账款。',403);
 const raw=await req.json(),schema=projectFinanceSchemas[action as FinanceAction],parsed=schema.safeParse(raw);
 if(!parsed.success)throw new AppError(parsed.error.issues.slice(0,4).map(x=>`${x.path.join('.')}：${x.message}`).join('；'));
 const input=parsed.data as any,fingerprint=await sha(JSON.stringify({action,input})),requestId='project_finance_request_'+input.token;
 if(input.id&&['project-document-save','project-document-revise','project-document-confirm'].includes(action))assertDocumentNotIssued(s,row(s,m,'project_billing_document',input.id,'write'));
 const repeated=s.records.find(r=>r.id===requestId);
 if(repeated){if(repeated.kind!=='project_finance_request'||repeated.actorId!==m.id||repeated.fingerprint!==fingerprint)throw new AppError('操作标识已用于其他请求。',409);if(repeated.customerId){const verifyActions=['project-charge-confirm','project-payment-requirement','project-receipt-verify','project-receipt-reverse','project-allocation','project-allocation-release','project-adjustment','project-credit-apply','project-refund-execute','project-refund-cancel'];access(s,m,repeated.customerId,(verifyActions.includes(action)||(action==='project-finance-entry-save'&&repeated.result?.record?.kind!=='project_finance_entry')||(action==='project-charge-save'&&repeated.result?.record?.status==='confirmed'))?'verify':'write');}else if(m.role!=='admin')throw new AppError('需要管理员权限。',403);if(repeated.result?.record){assertFinancialProjectsWritable(s,repeated.result.record);const latest=s.records.find(r=>r.id===repeated.result.record.id);if(latest)assertFinancialProjectsWritable(s,latest);}return json({...repeated.result,...(repeated.result?.record?.customerId?{record:financialDto(s,m,repeated.result.record)}:{}),idempotent:true});}
 const meta=()=>({createdAt:now(),createdBy:m.name,createdById:m.id});
 async function save(customerId:string,updates:Entity[],result:Record<string,unknown>,before:Entity|null=null){
  for(const target of updates){if(!financialKinds.has(target.kind))continue;assertFinancialProjectsWritable(s,target);const previous=s.records.find(r=>r.id===target.id&&r.kind===target.kind);if(previous)assertFinancialProjectsWritable(s,previous);}
  const at=now(),history:Entity[]=updates.filter(r=>financialKinds.has(r.kind)).map(target=>({id:newId('project_finance_history'),kind:'project_finance_history',customerId,targetId:target.id,projectId:target.projectId||'',action,actorId:m.id,actor:m.name,createdAt:at,before:before?.id===target.id?before:s.records.find(r=>r.id===target.id&&r.kind===target.kind)||null,after:structuredClone(target)}));
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
 if(action==='project-finance-entry-save'){
  const {customerId}=project(s,m,input.projectId,input.roundId,'write'),entryType=input.entryType as keyof typeof entrySchemas;
  const parsedEntry=entrySchemas[entryType].strict().safeParse(input.data);
  if(!parsedEntry.success)throw new AppError(parsedEntry.error.issues.slice(0,4).map(x=>`${x.path.join('.')}：${x.message}`).join('；'));
  const fields=parsedEntry.data as any,{amount,...details}=fields;
  const before=input.id?s.records.find(r=>r.id===input.id&&(r.kind==='project_finance_entry'||r.kind===entryKinds[entryType])):null;
  if(input.id&&!before)throw new AppError('记录不存在或不可访问。',403);
  if(before){access(s,m,before.customerId,'write');current(before,input.version);if(before.customerId!==customerId||before.projectId&&before.projectId!==input.projectId)throw new AppError('记录归属不能改换。');if(before.kind==='project_finance_entry'&&before.entryType!==entryType)throw new AppError('记录类型不能改换。');}
  for(const [key,kind] of Object.entries({receiptId:'project_receipt',chargeId:'project_charge',sourceChargeId:'project_charge',targetChargeId:'project_charge',caseId:'project_after_sale'})){
   if(details[key]){const linked=row(s,m,kind,details[key],'read');if(linked.customerId!==customerId)throw new AppError('关联记录须属于同一客户。');if(key==='caseId'&&linked.projectId!==input.projectId)throw new AppError('关联售后须属于当前项目。');}
  }
  if(!before||before.kind==='project_finance_entry'){
   if(before&&!accountAccess(s,m,customerId).verify){for(const key of ['account','payer'])if(!Object.hasOwn(input.data,key)&&Object.hasOwn(before,key))details[key]=before[key];}
   const record={...details,id:before?.id||newId('project_finance_entry'),kind:'project_finance_entry',entryType,customerId,projectId:input.projectId,roundId:input.roundId,amountCents:amount,status:'draft',independent:true,version:(before?.version||0)+1,...(before?{createdAt:before.createdAt,createdBy:before.createdBy,createdById:before.createdById}:meta()),updatedAt:now(),updatedBy:m.name};
   return save(customerId,[record],{record:financialDto(s,m,record)},before||null);
  }
  // Existing verified records are edited in place only after their accounting
  // invariants are rechecked. No allocation, release or reversal is manufactured.
  access(s,m,customerId,'verify');
  if(amount<=0)throw new AppError('已核实账务金额须大于零；尚待核实的内容可新增为独立记录。');
  if(details.currency!==before.currency&&before.currency)throw new AppError('已核实账务币种不能改换，请登记对应币种的新记录。');
  for(const key of ['receiptId','chargeId','sourceChargeId','targetChargeId'])if(key in details&&details[key]!==before[key])throw new AppError('已核实账务的关联来源不能改换；请先按原记录释放或冲销，再核实新的关联。');
  const record:Entity={...before,...details,amountCents:amount,version:(before.version||1)+1,updatedAt:now(),updatedBy:m.name,updatedById:m.id};
  const updates=[record],delta=amount-before.amountCents;
  if(entryType==='receipts'){
   if(!details.date||!details.reference||!details.account)throw new AppError('已核实到账须保留实际日期、银行流水和收款账户；待补资料请另存独立记录。');
   if(projectReceiptReversed(s,before.id)&&delta)throw new AppError('已冲销到账的原金额须保留，请新增待核实记录。');
   if(amount<before.amountCents-projectReceiptAvailable(s,before as ProjectReceipt))throw new AppError('到账金额不能少于现有分配和实退金额；请先核实已有用途。');
   checkActualDate(details.date);
   if(all(s,'project_receipt').some(r=>r.id!==before.id&&r.currency===record.currency&&clean(r.reference).toLowerCase()===clean(record.reference).toLowerCase()&&clean(r.account).toLowerCase()===clean(record.account).toLowerCase()&&!projectReceiptReversed(s,r.id)))throw new AppError('该账户银行流水已登记。',409);
  }
  if(entryType==='allocations'){
   if(before.entryType==='release'){if(delta)throw new AppError('释放金额须保留原凭据，可修改说明；金额更正请核实对应分配。');return save(customerId,[record],{record},before);}
   const receipt=row(s,m,'project_receipt',before.receiptId,'verify') as ProjectReceipt,charge=row(s,m,'project_charge',before.chargeId,'verify') as ProjectCharge;
   if(details.currency!==receipt.currency)throw new AppError('分配币种须与原到账一致。');
   if(amount<before.amountCents-projectAllocationNet(s,before)||delta>projectReceiptAvailable(s,receipt)||delta>projectChargeAmounts(s,charge).balanceCents)throw new AppError('修改金额与已有释放、可用到账或未收余额不一致。');
   const used=all(s,'project_credit_application').filter(r=>r.sourceChargeId===charge.id).reduce((n,r)=>n+r.amountCents,0);if(projectChargePaid(s,charge.id)+delta<used)throw new AppError('该收款已有抵扣用途，不能减少到已用抵扣以下。');
  }
  if(entryType==='adjustments'){
   if(before.sourceChargeId)throw new AppError('该调整来自抵扣记录，请在样办费抵大货记录中修改。');
   const charge=row(s,m,'project_charge',before.chargeId,'verify') as ProjectCharge;
   const candidate={...s,records:s.records.map(r=>r.id===before.id?record:r)} as State,t=projectChargeAmounts(candidate,charge);
   const used=all(s,'project_credit_application').filter(r=>r.sourceChargeId===charge.id).reduce((n,r)=>n+r.amountCents,0);
   if(t.amountCents<0||t.amountCents<t.receivedCents||t.amountCents<used)throw new AppError('修改后的应收少于现有核销或已用抵扣；请先核实并释放相关分配。');
  }
  if(entryType==='creditApplications'){
   const source=row(s,m,'project_charge',before.sourceChargeId,'verify') as ProjectCharge,target=row(s,m,'project_charge',before.targetChargeId,'verify') as ProjectCharge;
   if(delta>projectCreditSourceAvailable(s,source)||delta>projectChargeAmounts(s,target).balanceCents)throw new AppError('修改抵扣超过来源可用额度或目标未收余额。');
   const adjustment=row(s,m,'project_adjustment',before.adjustmentId,'verify');updates.push({...adjustment,amountCents:amount,reason:details.reason,evidence:details.evidence,version:(adjustment.version||1)+1,updatedAt:now(),updatedBy:m.name});
  }
  if(entryType==='refunds'){
   const receipt=row(s,m,'project_receipt',before.receiptId,'verify') as ProjectReceipt;
   if(before.status==='executed'&&delta>projectReceiptAvailable(s,receipt))throw new AppError('修改实退金额超过原到账未分配余额。');
   if(before.status==='executed'){
    if(!details.date||!details.reference||!details.account)throw new AppError('已执行退款须保留实际日期、银行流水和退款账户；待补资料请另存独立记录。');
    checkActualDate(details.date);
    if(all(s,'project_refund').some(r=>r.id!==before.id&&r.status==='executed'&&r.currency===record.currency&&clean(r.account).toLowerCase()===clean(record.account).toLowerCase()&&clean(r.reference).toLowerCase()===clean(record.reference).toLowerCase()))throw new AppError('该退款银行流水已登记。',409);
   }
  }
  return save(customerId,updates,{record},before);
 }
 if(action==='project-charge-save'){
  const {customerId}=project(s,m,input.projectId,input.roundId,'write');
  const before=input.id?row(s,m,'project_charge',input.id,'write'):null;
  if(before){current(before,input.version);if(before.projectId!==input.projectId||before.roundId!==input.roundId||before.customerId!==customerId)throw new AppError('收费归属不能改换。');}
  const plan=input.plan?input.plan.map((p:any)=>({title:p.title,amountCents:p.amount,dueDate:p.dueDate,beforeOrder:p.beforeOrder})):[...(input.prepayAmount?[{title:'Prepayment before order',amountCents:input.prepayAmount,dueDate:input.dueDate,beforeOrder:true}]:[]),...(input.amount>input.prepayAmount?[{title:'Balance payment',amountCents:input.amount-input.prepayAmount,dueDate:input.dueDate,beforeOrder:false}]:[])];
  const record:ProjectCharge={...before,id:before?.id||newId('project_charge'),kind:'project_charge',customerId,projectId:input.projectId,roundId:input.roundId,title:input.title,category:input.category,currency:input.currency,amountCents:input.amount,prepayCents:input.prepayAmount,dueDate:input.dueDate,note:input.note,status:before?.status||'draft',version:(before?.version||0)+1,plan,...(before?{createdAt:before.createdAt,createdBy:before.createdBy,createdById:before.createdById}:meta()),updatedAt:now(),updatedBy:m.name};
  if(before&&issuedCharge(s,before)){
   if(['title','category','currency','amountCents','prepayCents','dueDate'].some(key=>before[key]!==record[key])||JSON.stringify(chargePlanContract(before.plan||[]))!==JSON.stringify(chargePlanContract(record.plan)))throw new AppError('该收费来自已签发 PI，原金额、币种、条款和分期已锁定；请使用独立账务调整记录，不能改写原收费。',409);
   record.plan=structuredClone(before.plan);
  }
  if(before?.status==='confirmed'){
   verifyChargePlan(record);
   const financialChange=before.amountCents!==record.amountCents||before.prepayCents!==record.prepayCents||before.currency!==record.currency||JSON.stringify(before.plan)!==JSON.stringify(record.plan);
   if(financialChange)access(s,m,customerId,'verify');
   if(before.currency!==record.currency&&(projectChargePaid(s,before.id)||all(s,'project_adjustment').some(r=>r.chargeId===before.id)||all(s,'project_credit_application').some(r=>r.sourceChargeId===before.id||r.targetChargeId===before.id)))throw new AppError('已有核销或调整的收费币种不能直接改换。');
   const amounts=projectChargeAmounts(s,record),used=all(s,'project_credit_application').filter(r=>r.sourceChargeId===record.id).reduce((n,r)=>n+r.amountCents,0);
   if(amounts.amountCents<amounts.receivedCents||amounts.amountCents<used)throw new AppError('修改后的应收不能少于现有核销或已用抵扣。');
  }
  return save(customerId,[record],{record},before);
 }
 if(action==='project-charge-confirm'){
  const before=row(s,m,'project_charge',input.id,'verify');current(before,input.version);if(before.status!=='draft')throw new AppError('收费已确认。',409);verifyChargePlan(before);
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
  const {customerId}=project(s,m,input.projectId,input.roundId,'write'),before=input.id?row(s,m,'project_payment_notice',input.id,'write'):null;
  if(before){current(before,input.version);if(before.projectId!==input.projectId)throw new AppError('付款通知归属不能改换。');}
  const record={...before,id:before?.id||newId('project_payment_notice'),kind:'project_payment_notice',customerId,projectId:input.projectId,roundId:input.roundId,amountCents:input.amount,currency:input.currency,reference:input.reference,note:input.note,status:before?.status||'pending',version:(before?.version||0)+1,...(before?{}:meta()),updatedAt:now(),updatedBy:m.name};return save(customerId,[record],{record},before);
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
  const affected=new Set(all(s,'project_allocation').filter(r=>r.receiptId===receipt.id&&projectAllocationNet(s,r)>0).map(r=>r.chargeId));for(const chargeId of affected){const released=all(s,'project_allocation').filter(r=>r.receiptId===receipt.id&&r.chargeId===chargeId).reduce((n,r)=>n+projectAllocationNet(s,r),0),used=all(s,'project_credit_application').filter(r=>r.sourceChargeId===chargeId).reduce((n,r)=>n+r.amountCents,0);if(projectChargePaid(s,chargeId)-released<used)throw new AppError('该到账已支持抵扣，冲销后不足以支持既有抵扣；请先核对抵扣用途。',409);}
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
  const usedCredits=all(s,'project_credit_application').filter(r=>r.sourceChargeId===original.chargeId).reduce((n,r)=>n+r.amountCents,0);if(projectChargePaid(s,original.chargeId)-input.amount<usedCredits)throw new AppError('原收款已支持抵扣，释放后不足以支持既有抵扣；请先核对抵扣用途。',409);
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
  record.releasedCents=updates.slice(1).reduce((n,r)=>n+r.amountCents,0);return save(charge.customerId,updates,{record,releasedCents:record.releasedCents,releaseIds:updates.slice(1).map(r=>r.id)});
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
  if(before){current(before,input.version);if(before.customerId!==input.customerId)throw new AppError('单据客户不能改换。');}
  if(new Set(input.chargeIds).size!==input.chargeIds.length||new Set(input.adjustmentIds).size!==input.adjustmentIds.length)throw new AppError('单据不能重复引用同一收费或调整。');
  const charges=input.chargeIds.map((id:string)=>row(s,m,'project_charge',id,'write') as ProjectCharge);
  if(charges.some((c:ProjectCharge)=>c.customerId!==input.customerId||c.currency!==input.currency))throw new AppError('单据引用收费须属于同客户同币种。');
  const adjustments=input.adjustmentIds.map((id:string)=>row(s,m,'project_adjustment',id,'write'));
  if(adjustments.some((a:Entity)=>!input.chargeIds.includes(a.chargeId)||a.type==='debit'))throw new AppError('贷项单只能引用选中收费的减免调整。');
  const lines=charges.map((c:ProjectCharge)=>({chargeId:c.id,projectId:c.projectId,roundId:c.roundId,title:c.title,currency:c.currency,...projectChargeAmounts(s,c),plan:c.plan,creditCents:adjustments.filter((a:Entity)=>a.chargeId===c.id).reduce((n:number,a:Entity)=>n+a.amountCents,0)}));
  if(input.roundId&&!input.projectId)throw new AppError('关联开发轮次时须同时指定所属项目。');
  if(input.projectId){const parent=project(s,m,input.projectId,input.roundId,'write');if(parent.customerId!==input.customerId)throw new AppError('单据项目与客户不一致。');}
  if(before?.projectId&&input.projectId!==before.projectId)throw new AppError('单据项目归属不能改换。');
  if(input.manualTitle||input.manualAmount||!lines.length)lines.push({chargeId:'',projectId:input.projectId,roundId:input.roundId,title:input.manualTitle,currency:input.currency,amountCents:input.manualAmount,prepayCents:0,receivedCents:0,balanceCents:input.manualAmount,plan:[],creditCents:input.documentType==='CREDIT'?input.manualAmount:0});
  const record={id:before?.id||newId('project_billing_document'),kind:'project_billing_document',projectId:input.projectId||before?.projectId||'',roundId:input.roundId,manualTitle:input.manualTitle,manualAmountCents:input.manualAmount,customerId:input.customerId,customerName:customer!.customer,customerCode:customer!.customerCode,documentType:input.documentType,documentNo:input.documentNo,currency:input.currency,date:input.date,chargeIds:input.chargeIds,adjustmentIds:input.adjustmentIds,lines,customerAddress:input.customerAddress,company:input.company,terms:input.terms,status:'draft',version:(before?.version||0)+1,...meta()};return save(input.customerId,[record],{record},before);
 }
 if(['project-document-confirm','project-document-revise'].includes(action)){
  const before=row(s,m,'project_billing_document',input.id,'write');current(before,input.version);
  if(action==='project-document-confirm'){
   if(before.documentNo&&all(s,'project_billing_document').some(d=>d.id!==before.id&&d.status==='confirmed'&&d.customerId===before.customerId&&d.documentType===before.documentType&&clean(d.documentNo).toLowerCase()===clean(before.documentNo).toLowerCase()))throw new AppError('同客户同类单据号已有已确认版本，请核对编号。',409);
   if(before.status!=='draft')throw new AppError('单据已核对。',409);
   for(const line of before.lines){if(!line.chargeId)continue;const c=row(s,m,'project_charge',line.chargeId) as ProjectCharge,t=projectChargeAmounts(s,c);if(c.status!=='confirmed'||t.amountCents!==line.amountCents||(before.documentType==='STATEMENT'&&(t.receivedCents!==line.receivedCents||t.balanceCents!==line.balanceCents)))throw new AppError('收费或收款发生变化，请先重新保存单据快照。',409);}
   const record={...before,status:'confirmed',version:before.version+1,confirmedAt:now(),confirmedBy:m.name,confirmedById:m.id};return save(before.customerId,[record],{record},before);
  }
  if(before.status!=='confirmed')throw new AppError('只有核对后的单据可修订或登记发送。',409);
  if(action==='project-document-revise'){const record={...before,status:'draft',version:before.version+1,revisionReason:input.reason,confirmedAt:'',confirmedBy:'',confirmedById:''};return save(before.customerId,[record],{record},before);}
 }
 if(action==='project-document-sent'){
  const documentId=input.documentId||input.id||'',document=documentId?row(s,m,'project_billing_document',documentId,'write'):null;
  const before=input.sendId?row(s,m,'project_document_send',input.sendId,'write'):null;
  if(before)current(before,input.version);
  const projectId=input.projectId||before?.projectId||document?.projectId||document?.lines?.find((l:any)=>l.projectId)?.projectId||'';
  const customerId=projectId?project(s,m,projectId,input.roundId,'write').customerId:document?.customerId;
  if(!customerId)throw new AppError('请指定发送记录所属项目。');
  if(document&&document.customerId!==customerId||before&&before.customerId!==customerId)throw new AppError('发送记录客户不一致。');
  if(before?.projectId&&before.projectId!==projectId)throw new AppError('发送记录项目归属不能改换。');
  const linkedDocument=before?.documentId===documentId&&before?.documentSnapshot?before.documentSnapshot:document;
  if(input.expectedDocumentVersion!==undefined&&(!linkedDocument||linkedDocument.version!==input.expectedDocumentVersion))throw new AppError('拟登记发送的单据依据版本已变化，请重新核对原版本。',409);
  const documentProjects=new Set([linkedDocument?.projectId,...(linkedDocument?.lines||[]).map((line:any)=>line.projectId)].filter(Boolean));
  if(documentProjects.size&&projectId&&!documentProjects.has(projectId))throw new AppError('发送记录须属于关联单据包含的项目。');
  if(input.roundId&&!projectId)throw new AppError('关联开发轮次时须同时指定所属项目。');
  // The document snapshot is frozen when the send is registered. Editing delivery
  // details never rewrites the version that was actually sent.
  const record={...before,id:before?.id||newId('project_document_send'),kind:'project_document_send',customerId,projectId,roundId:input.roundId,documentId,documentVersion:before&&before.documentId===documentId?before.documentVersion:document?.version||0,documentSnapshot:before&&before.documentId===documentId?before.documentSnapshot||null:document?structuredClone(document):null,date:input.date,recipient:input.recipient,reference:input.reference,version:(before?.version||0)+1,...(before?{}:meta()),updatedAt:now(),updatedBy:m.name};
  return save(customerId,[record],{record},before);
 }
 if(action==='project-after-sale-save'){
  const {p,customerId}=project(s,m,input.projectId,input.roundId,'write'),before=input.id?row(s,m,'project_after_sale',input.id,'write'):null;
  if(before){current(before,input.version);if(before.projectId!==p.id||before.roundId!==input.roundId)throw new AppError('售后归属不能改换。');}
  if(input.orderId){const order=all(s,'order').find(o=>o.id===input.orderId),customer=projectAccess(s,m,customerId).customer!,keys=serviceOrderCustomerKeys(s,customer).map(projectKey);if(!order||!canRead(m,order as any)||!keys.includes(projectKey(order.customer)))throw new AppError('售后订单不属于当前客户或没有读取权限。',403);}
  const owner=all(s,'member').find(r=>r.id===input.ownerMemberId&&r.active&&r.role!=='supplier') as Member|undefined;if(input.ownerMemberId&&(!owner||!(projectAccess(s,owner,customerId).read||projectAccess(s,owner,customerId).internal||canVerifyProjectFinance(s,owner,customerId))))throw new AppError('请选择有本客户权限或内部执行职责的有效责任人。');
  const {token,id,version,...fields}=input,record={...fields,id:before?.id||newId('project_after_sale'),kind:'project_after_sale',customerId,version:(before?.version||0)+1,...meta()};return save(customerId,[record],{record},before);
 }
 if(action==='project-after-sale-cost'){
  const linked=input.caseId?row(s,m,'project_after_sale',input.caseId,'write'):null;
  const projectId=input.projectId||linked?.projectId,roundId=input.roundId||linked?.roundId||'';
  const {customerId}=project(s,m,projectId,roundId,'write');
  if(linked&&linked.projectId!==projectId)throw new AppError('售后费用须关联本项目事项。');
  const before=input.id?row(s,m,'project_after_sale_cost',input.id,'write'):null;
  if(before){current(before,input.version);if(before.projectId!==projectId)throw new AppError('售后费用归属不能改换。');}
  const record={...before,id:before?.id||newId('project_after_sale_cost'),kind:'project_after_sale_cost',customerId,projectId,roundId,caseId:input.caseId,category:input.category,description:input.description,currency:input.currency,budgetCents:input.budget,actualCents:input.actual,bearer:input.bearer,supplierReference:input.supplierReference,version:(before?.version||0)+1,...(before?{}:meta()),updatedAt:now(),updatedBy:m.name};return save(customerId,[record],{record},before);
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
