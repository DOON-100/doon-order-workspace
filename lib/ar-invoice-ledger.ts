import {all,clean,type Entity,type Member,type State} from './domain';
import {arAccess,arAttribution,arDay} from './ar-workspace';
import {AppError} from './store';
import {arCustomerProfile,arInvoiceExtra,arInvoiceTraceLinks,type ArCustomerProfile} from './ar-customer-profiles';

/** Historical invoice archives and cumulative reconciliations are not cash events. */
export const arInvoiceKey=(value:unknown)=>clean(value).normalize('NFKC').replace(/\s+/g,'').toUpperCase().replace(/\d+$/,digits=>digits.replace(/^0+(?=\d)/,''));
export function arInvoiceReadable(s:State,m:Member,row:Entity){
 const scope=arAccess(s,m);if(!scope.allowed)return false;
 const teamId=arAttribution(s,row).teamId;
 return scope.company||!!teamId&&scope.teamIds.includes(teamId);
}
export function arInvoiceRequire(s:State,m:Member,kind:string,id:string){
 const row=all(s,kind).find(r=>r.id===id);
 if(!row||!arInvoiceReadable(s,m,row))throw new AppError('历史发票资料不存在或没有该来源的访问权限。',403);
 return row;
}
export function arInvoiceDto(s:State,row:Entity):Entity&{receivedCents:number|null;balanceCents:number|null;paymentStatus:string;paymentRemark:string;proofCount:number}{
 const verified=row.status==='confirmed'&&Number.isSafeInteger(row.amountCents)&&Number.isSafeInteger(row.receivedCents)&&row.receivedCents>=0&&row.receivedCents<=row.amountCents;
 const receivedCents:number|null=verified?row.receivedCents:null,balanceCents:number|null=verified?row.amountCents-receivedCents!:null;
 const paymentStatus=!verified?'pending':balanceCents===0?'paid':receivedCents===0?'unpaid':'partial';
 const label={pending:'收款待核对',paid:'已收款',unpaid:'未收款',partial:'部分收款'}[paymentStatus];
 const proofCount=all(s,'ar_invoice_attachment').filter(a=>a.invoiceId===row.id&&a.category==='payment-proof').length;
 const paymentRemark=verified?`${label}（历史 STATEMENT 所列净应收；不表示 PI 全订单结清；不计作本期现金到账${proofCount?'':'；付款凭证待补'}）`:'历史 STATEMENT 净应收尚未完成逐票核对；实收及未收保持未知，不表示 PI 全订单余额';
 return {...row,receivedCents,balanceCents,paymentStatus,paymentRemark,proofCount};
}
export function arInvoiceAttachmentDto(row:Entity){const {fileKey,...safe}=row;return safe;}
export function arInvoiceData(s:State,m:Member,customerId=''){
 const scope=arAccess(s,m);if(!scope.allowed)throw new AppError('没有历史发票工作空间访问权限。',403);
 const visible=(kind:string)=>all(s,kind).filter(r=>(!customerId||r.customerId===customerId)&&arInvoiceReadable(s,m,r));
 const invoices=visible('ar_invoice').map(r=>arInvoiceDto(s,r)),batches=visible('ar_invoice_import');
 const customerIds=new Set([...invoices,...batches].map(r=>r.customerId));
 // Import selection is company-scoped; current customer membership never grants historical access.
 const customers=all(s,'customer_account').filter(c=>scope.company||customerIds.has(c.id)).map(c=>({id:c.id,customer:c.customer,customerCode:c.customerCode,active:c.active}));
 return {customers,invoices,batches,receipts:visible('ar_invoice_reconciliation'),statements:visible('ar_invoice_statement'),attachments:visible('ar_invoice_attachment').map(arInvoiceAttachmentDto),canWrite:scope.canConfigure,scope,basis:'历史累计核销不是实际到账；原表未核对数字不计正式余额或现金业绩。'};
}
export function arInvoiceDuplicateReason(s:State,row:Entity){
 const key=arInvoiceKey(row.invoiceNo),same=(value:unknown)=>arInvoiceKey(value)===key;
 if(all(s,'ar_invoice').some(r=>r.id!==row.id&&r.customerId===row.customerId&&r.status==='confirmed'&&same(r.invoiceNo)))return '该客户同发票号已有已确认版本，请保留版本并核对原账，不能再次确认。';
 if(all(s,'service_record').some(r=>r.type==='receivable'&&r.customerId===row.customerId&&r.status!=='cancelled'&&same(r.details?.invoiceNo)))return '该发票已关联订单应收，请核对原应收，不能重复确认历史账。';
 if(all(s,'project_charge').some(r=>r.customerId===row.customerId&&[r.invoiceNo,r.documentNo,r.sourceInvoiceNo].some(v=>!!v&&same(v))))return '该发票已关联项目收费，不能重复确认历史账。';
 if(all(s,'project_billing_document').some(r=>r.customerId===row.customerId&&same(r.documentNo)&&((r.chargeIds||[]).length||(r.lines||[]).some((l:Entity)=>l.chargeId))))return '该发票单据已关联项目收费，不能重复确认历史账。';
 const linked=all(s,'handoff_business_document').find(r=>r.customerId===row.customerId&&same(r.number)&&(r.originRefs||[]).some((ref:Entity)=>['service_record','project_charge'].includes(ref.kind)));
 return linked?'该发票已引用原应收，不能重复确认历史账。':'';
}

/** Preserve all versions, but select at most one version of each invoice for totals. */
export function arInvoiceStatementSnapshot(s:State,m:Member,customerId:string,currency:string,asOf:string){
 const profile=structuredClone(arCustomerProfile(s,customerId));
 const rows=all(s,'ar_invoice').filter(r=>r.customerId===customerId&&r.currency===currency&&arInvoiceReadable(s,m,r));
 const groups=new Map<string,Entity[]>();for(const r of rows){const key=arInvoiceKey(r.invoiceNo),group=groups.get(key)||[];group.push(r);groups.set(key,group);}
 const lines:Entity[]=[],issues:string[]=[],excluded:{id:string;invoiceNo:string;reason:string}[]=[];
 let knownAmountCents=0,confirmedAmountCents=0,confirmedReceivedCents=0,confirmedBalanceCents=0,pendingCount=0,duplicateCount=0;
 for(const versions of groups.values()){
  const confirmed=versions.filter(r=>r.status==='confirmed');
  const chosen=confirmed.length===1?confirmed[0]:versions.length===1?versions[0]:undefined;
  if(!chosen){duplicateCount++;pendingCount++;issues.push(`${versions[0].invoiceNo} 有多个未确定版本，不重复合计`);for(const r of versions){const dto=arInvoiceDto(s,r);lines.push({...dto,historicalReceivedCents:dto.receivedCents,historicalBalanceCents:dto.balanceCents,includedInTotals:false,statementIssue:'同号版本待核对'});}continue;}
  const date=arDay(chosen.invoiceDate);
  if(date&&date>asOf){excluded.push({id:chosen.id,invoiceNo:chosen.invoiceNo,reason:'发票日期晚于对账截止日'});continue;}
  const batch=all(s,'ar_invoice_import').find(b=>b.id===chosen.batchId),basisDate=arDay(batch?.sourceAsOf),dto=arInvoiceDto(s,chosen);
  const temporalKnown=!!date&&!!basisDate&&basisDate>=date&&basisDate<=asOf;
  // A cumulative value without an established source cutoff cannot be presented as an as-of balance.
  const verified=chosen.status==='confirmed'&&dto.receivedCents!==null&&temporalKnown;
  const amountKnown=Number.isSafeInteger(chosen.amountCents)&&chosen.amountCents>=0&&!!date;
  if(amountKnown)knownAmountCents+=chosen.amountCents;
  if(verified){confirmedAmountCents+=chosen.amountCents;confirmedReceivedCents+=dto.receivedCents!;confirmedBalanceCents+=dto.balanceCents!;}
  else pendingCount++;
  const issue=!date?'发票日期待核对':!basisDate?'原表累计收款截止日不明':basisDate<date?'原表累计收款截止日早于发票日期':basisDate>asOf?'原表累计金额晚于本对账截止日':chosen.status!=='confirmed'?'累计实收尚未人工核对':'';
  if(issue)issues.push(`${chosen.invoiceNo}：${issue}`);
  lines.push({...dto,historicalReceivedCents:dto.receivedCents,historicalBalanceCents:dto.balanceCents,receivedCents:verified?dto.receivedCents:null,balanceCents:verified?dto.balanceCents:null,includedInTotals:amountKnown,confirmedForStatement:verified,statementIssue:issue,sourceAsOf:batch?.sourceAsOf||null,otherVersionIds:versions.filter(r=>r.id!==chosen.id).map(r=>r.id)});
 }
 const sourceBatches=all(s,'ar_invoice_import').filter(b=>rows.some(r=>r.batchId===b.id)).map(b=>({id:b.id,filename:b.filename,hash:b.hash,sourceCutoff:b.sourceCutoff,sourceAsOf:b.sourceAsOf,issues:b.issues}));
 for(const b of sourceBatches)for(const issue of b.issues||[])issues.push(`${b.filename}：${issue}`);
 const customer=all(s,'customer_account').find(c=>c.id===customerId);
 return {customerId,customer:clean(customer?.customer),customerCode:clean(customer?.customerCode),currency,asOf,status:'draft',teamId:'',presentationVersion:1,customerProfileSnapshot:profile,lines:lines.map(row=>({...row,...arInvoiceStatementFields(s,m,row,profile)})),excluded,sourceBatches,totals:{knownAmountCents,confirmedAmountCents,confirmedReceivedCents,confirmedBalanceCents,pendingCount,duplicateCount,receivedCents:pendingCount?null:confirmedReceivedCents,balanceCents:pendingCount?null:confirmedBalanceCents},issues:[...new Set(issues)],basis:'历史发票档案草稿；金额为历史 STATEMENT 所列净应收，不表示 PI 票面金额或全订单余额。仅汇总唯一版本，历史累计核销不代表银行到账。已核对部分金额与未知部分分列，不能作为完整正式对账单。'};
}

/** Presentation evidence is frozen independently; it cannot change financial totals or source records. */
function arInvoiceStatementFields(s:State,m:Member,row:Entity,profile:ArCustomerProfile){
 const candidate=arInvoiceExtra(s,row.id),extra=candidate?.customerId===row.customerId?structuredClone(candidate):null;
 const schemaCurrent=!!extra&&extra.profileId===profile.id&&extra.profileVersion===profile.version&&JSON.stringify(extra.schemaSnapshot)===JSON.stringify(profile.customFields);
 const invoiceVersionCurrent=!!extra&&extra.invoiceVersion===row.version;
 const fieldIssues:string[]=[];
 if(extra&&!schemaCurrent)fieldIssues.push(`扩展字段配置已变化：原配置版本 ${extra.profileVersion}，本快照配置版本 ${profile.version}；旧值保留为历史依据，当前列待重新映射。`);
 if(extra&&!invoiceVersionCurrent)fieldIssues.push(`发票版本已变化：扩展值绑定发票版本 ${extra.invoiceVersion}，本快照发票版本 ${row.version}；旧值保留为历史依据，当前列待重新核对并映射。`);
 if(!extra&&profile.customFields.some(f=>f.required))fieldIssues.push('必填扩展字段尚未填写；不以空白代替已确认业务数据。');
 const sourceLinksSnapshot=arInvoiceTraceLinks(s,m,row.id).filter(link=>link.status==='active'&&!link.targetUnavailable&&link.targetSnapshot).map(link=>{
  const targetSnapshot:Entity={id:clean(link.targetSnapshot.id),kind:clean(link.targetSnapshot.kind)};
  for(const key of ['version','label','view','orderId','projectId','orderNo','customerPO','projectNo','documentNo','drawing']){
   const value=link.targetSnapshot[key];if(typeof value==='string'||typeof value==='number'&&Number.isFinite(value))targetSnapshot[key]=value;
  }
  return {id:link.id,kind:link.kind,invoiceId:link.invoiceId,customerId:link.customerId,invoiceVersion:link.invoiceVersion,targetKind:link.targetKind,targetId:link.targetId,targetVersion:link.targetVersion,targetSnapshot,note:clean(link.note),status:'active',targetChanged:!!link.targetChanged,createdAt:link.createdAt,createdById:link.createdById};
 });
 return {extraValuesSnapshot:extra,extraValuesState:extra?(schemaCurrent&&invoiceVersionCurrent?'current':'stale'):'missing',sourceLinksSnapshot,fieldIssues};
}
