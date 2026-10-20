import {all,clean,type Entity,type Member,type State} from './domain';
import {AppError} from './store';
import {arAccess,arAttribution,arCurrencies,arDay,arReceivables} from './ar-workspace';
import {arProfileCustomerReadable,arProfileTarget,arProfileTargetKinds} from './ar-customer-profiles';
import {canReadProjectFinance} from './customer-project-finance';
import {arInvoiceDto,arInvoiceKey} from './ar-invoice-ledger';

export const arMasterBoundary='总表保留每条历史来源；原表金额与已确认账务金额分开。空值表示未知，贷扣保留负数。历史累计实收不生成现金事件；关联现有正式应收的行不再次计金额。不同或未知截至日不能视为今日余额。';
export const arMasterTargetKinds=[...arProfileTargetKinds,'project_charge'] as const;
export const arMasterBases=['unknown','gross_receivable','opening_balance'] as const;
export const arMasterMoneyLimit=100_000_000_000;
const list=(v:unknown):string[]=>Array.isArray(v)?v.filter((x):x is string=>typeof x==='string'):[];
export const arMasterCents=(v:unknown):number|null=>typeof v==='number'&&Number.isSafeInteger(v)&&Math.abs(v)<=arMasterMoneyLimit?v:null;
function stable(value:any):any{
 if(Array.isArray(value))return value.map(stable);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
 return value;
}
export async function arMasterSourceHash(value:unknown){
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(stable(value))));
 return Array.from(new Uint8Array(bytes)).map(n=>n.toString(16).padStart(2,'0')).join('');
}
/** The original decimal is never rounded and is never used as a confirmed amount. */
export function arMasterExactAmount(value:unknown):{cents:number|null;issue:string}{
 if(value===null||value===undefined||value==='')return {cents:null,issue:'原表金额未填写'};
 if(typeof value!=='string'||value.length>120||!/^[-+]?\d+(?:\.\d+)?$/.test(value.trim()))return {cents:null,issue:'原表金额格式待核对'};
 const text=value.trim(),negative=text.startsWith('-'),[whole,fraction='']=text.replace(/^[-+]/,'').split('.');
 if(fraction.slice(2).replaceAll('0',''))return {cents:null,issue:'原表金额精度超过整分，未自动舍入'};
 const signed=(BigInt(whole)*BigInt(100)+BigInt((fraction+'00').slice(0,2)))*(negative?BigInt(-1):BigInt(1));
 if(signed>BigInt(arMasterMoneyLimit)||signed<BigInt(-arMasterMoneyLimit))return {cents:null,issue:'原表金额超出确认范围'};
 return {cents:Number(signed),issue:''};
}
export function arMasterLegacyIssues(s:State,source:Entity){
 const issues=[...list(source.issues)],exact=arMasterExactAmount(source.originalAmountDecimal),code=clean(source.customerLabel).normalize('NFKC').toUpperCase();
 if(exact.issue)issues.push(exact.issue);
 if(typeof source.originalAmountDecimal==='string'&&/^-/.test(source.originalAmountDecimal.trim())&&Number(source.originalAmountDecimal)!==0)issues.push('原表为负数贷扣项，保留原符号，不能转为正数应收');
 const matches=all(s,'customer_account').filter(c=>code&&clean(c.customerCode).normalize('NFKC').toUpperCase()===code);
 if(!source.customerId&&matches.length===0)issues.push('原客户代码未找到唯一客户主档，须人工补充客户依据');
 if(!source.customerId&&matches.length>1)issues.push('原客户代码对应多个客户主档，不自动匹配');
 const codes=clean(source.title).normalize('NFKC').toUpperCase().match(/(?:^|[^A-Z0-9])C\d+(?=$|[^A-Z0-9])/g)?.map(v=>v.replace(/^[^C]*/,''))||[];
 if(/^C\d+$/.test(code)&&codes.some(other=>other!==code))issues.push('票号中的客户代码与原表客户标识不一致，须核对原凭证');
 return [...new Set(issues)];
}
export function arMasterReadable(s:State,m:Member,row:Entity){
 const scope=arAccess(s,m),team=arAttribution(s,row).teamId;
 return scope.allowed&&(scope.company||!!team&&scope.teamIds.includes(team));
}
export function arMasterRequire(s:State,m:Member,id:string){
 const row=all(s,'ar_master_entry').find(r=>r.id===id);
 if(!row||!arMasterReadable(s,m,row))throw new AppError('总表记录不存在或没有该记录的读取权限。',403);
 return row;
}
export function arMasterSource(s:State,row:Entity){return s.records.find(r=>r.kind==='ar_legacy_pending'&&r.id===row.sourceId);}
export async function arMasterSourceCurrent(s:State,row:Entity){
 if(row.sourceKind==='ar_invoice_group'){
  const invoices=all(s,'ar_invoice').filter(r=>r.customerId===row.invoiceSourceCustomerId&&arInvoiceKey(r.invoiceNo)===row.invoiceKey).sort((a,b)=>a.id.localeCompare(b.id));
  const legacy=(row.additionalSources||[]).map((r:Entity)=>all(s,'ar_legacy_pending').find(l=>l.id===r.id));
  if(legacy.some((r:Entity|undefined)=>!r))return false;
  const batches=all(s,'ar_invoice_import').filter(b=>invoices.some(r=>r.batchId===b.id)).sort((a,b)=>a.id.localeCompare(b.id)).map(b=>({id:b.id,sourceAsOf:b.sourceAsOf??null,hash:b.hash||''}));
  return await arMasterSourceHash({invoices,legacy:legacy.sort((a:Entity,b:Entity)=>a.id.localeCompare(b.id))})===row.sourceHash&&JSON.stringify(batches)===JSON.stringify(row.sourceBatchSnapshots||[]);
 }
 const source=arMasterSource(s,row);return !!source&&await arMasterSourceHash(source)===row.sourceHash;
}
export type ArMasterPlanEntry={sourceKind:string;sourceId:string;sourceHash:string;sourceSnapshot:Entity;sourceSnapshots?:Entity[];additionalSources?:Entity[];sourceBatchSnapshots?:any[];invoiceSourceCustomerId?:string;invoiceKey?:string;customerId:string;currency:string};
/** Exact customer directory code + invoice number are the only cross-source grouping evidence. */
export async function arMasterRegistrationPlan(s:State,m:Member,sourceIds:string[],invoiceCustomerIds:string[]){
 if(new Set(sourceIds).size!==sourceIds.length||new Set(invoiceCustomerIds).size!==invoiceCustomerIds.length)throw new AppError('登记范围不能包含重复来源或客户。');
 const legacy=sourceIds.map(id=>{const r=all(s,'ar_legacy_pending').find(r=>r.id===id&&r.status==='pending');if(!r||!arMasterReadable(s,m,r))throw new AppError('历史暂存来源不存在、已变化或不可读取。',409);return r;}).sort((a,b)=>a.id.localeCompare(b.id));
 for(const customerId of invoiceCustomerIds)if(!all(s,'customer_account').some(c=>c.id===customerId)||!all(s,'ar_invoice').some(r=>r.customerId===customerId&&arMasterReadable(s,m,r)))throw new AppError('历史发票客户不存在或没有可读取的发票来源。',403);
 const allInvoices=all(s,'ar_invoice').filter(r=>invoiceCustomerIds.includes(r.customerId));
 if(allInvoices.some(r=>!arMasterReadable(s,m,r)))throw new AppError('须能读取客户同票号的全部历史版本后才可生成总表。',403);
 const groups=new Map<string,Entity[]>();for(const invoice of allInvoices){const key=invoice.customerId+'|'+arInvoiceKey(invoice.invoiceNo);groups.set(key,[...(groups.get(key)||[]),invoice]);}
 const groupedLegacy=new Set<string>(),entries:ArMasterPlanEntry[]=[];
 for(const [key,unsorted] of [...groups].sort((a,b)=>a[0].localeCompare(b[0]))){
  const invoices=unsorted.sort((a,b)=>a.id.localeCompare(b.id)),customerId=invoices[0].customerId,invoiceKey=arInvoiceKey(invoices[0].invoiceNo),customer=all(s,'customer_account').find(c=>c.id===customerId)!;
  const additionalSources=legacy.filter(source=>{
   if(source.customerId)return source.customerId===customerId&&arInvoiceKey(source.title)===invoiceKey;
   const code=clean(source.customerLabel).normalize('NFKC').toUpperCase(),matches=all(s,'customer_account').filter(c=>code&&clean(c.customerCode).normalize('NFKC').toUpperCase()===code);
   return matches.length===1&&matches[0].id===customerId&&arInvoiceKey(source.title)===invoiceKey;
  });
  for(const source of additionalSources)groupedLegacy.add(source.id);
  const currency=[...new Set(invoices.map(i=>i.currency))];
  const sourceBatchSnapshots=all(s,'ar_invoice_import').filter(b=>invoices.some(r=>r.batchId===b.id)).sort((a,b)=>a.id.localeCompare(b.id)).map(b=>({id:b.id,sourceAsOf:b.sourceAsOf??null,hash:b.hash||''}));
  entries.push({sourceKind:'ar_invoice_group',sourceId:key,sourceHash:await arMasterSourceHash({invoices,legacy:additionalSources}),sourceSnapshot:{id:key,kind:'ar_invoice_group_source',title:invoices[0].invoiceNo,customerLabel:customer.customerCode||customer.customer,originalAmountDecimal:null,sourceSheet:invoices.map(r=>r.sourceSheet).filter(Boolean).join('；'),issues:['全部原发票版本已保留；本组未自动选择账务金额',...(additionalSources.length?['同客户同票号原表已归并为附加来源；各来源金额及日期口径须分别核对']:[])]},
   sourceSnapshots:structuredClone(invoices),additionalSources:structuredClone(additionalSources),sourceBatchSnapshots,invoiceSourceCustomerId:customerId,invoiceKey,customerId,currency:currency.length===1&&arCurrencies.includes(currency[0])?currency[0]:''});
 }
 for(const source of legacy.filter(r=>!groupedLegacy.has(r.id)))entries.push({sourceKind:'ar_legacy_pending',sourceId:source.id,sourceHash:await arMasterSourceHash(source),sourceSnapshot:structuredClone(source),customerId:'',currency:arCurrencies.includes(source.currency)?source.currency:''});
 const ordered=entries.sort((a,b)=>(a.sourceKind+':'+a.sourceId).localeCompare(b.sourceKind+':'+b.sourceId));
 const previewHash=await arMasterSourceHash({sources:ordered.map(e=>({sourceKind:e.sourceKind,sourceId:e.sourceId,sourceHash:e.sourceHash,sourceBatchSnapshots:e.sourceBatchSnapshots||[]})),invoiceCustomerIds:[...invoiceCustomerIds].sort()});
 const existingEntryCount=ordered.filter(e=>all(s,'ar_master_entry').some(r=>r.sourceKind===e.sourceKind&&r.sourceId===e.sourceId)).length;
 return {entries:ordered,sourceIds:[...sourceIds].sort(),invoiceCustomerIds:[...invoiceCustomerIds].sort(),previewHash,entryCount:ordered.length,existingEntryCount,newEntryCount:ordered.length-existingEntryCount,legacyEntryCount:legacy.length-groupedLegacy.size,invoiceGroupCount:groups.size,overlapCount:groupedLegacy.size};
}
function formalRow(s:State,kind:string,id:string){
 const key=kind+':'+id;
 return arReceivables(s).rows.find(r=>r.sourceKind===kind&&r.sourceId===id||(r.duplicateSources||[]).includes(key));
}
export function arMasterTarget(s:State,m:Member,customerId:string,kind:string,id:string):Entity|null{
 if(!customerId)return null;
 if(kind==='project_charge'){
  const charge=all(s,'project_charge').find(r=>r.id===id&&r.customerId===customerId);
  if(!charge||!canReadProjectFinance(s,m,customerId))return null;
  return {kind,id,version:Number.isSafeInteger(charge.version)?charge.version:1,label:clean(charge.title)||id,view:'project-finance',projectId:clean(charge.projectId),orderId:clean(charge.orderId)};
 }
 return arProfileTarget(s,m,customerId,kind,id);
}
export function arMasterFormalTarget(s:State,m:Member,customerId:string,kind:string,id:string){
 if(!['project_charge','service_record'].includes(kind)||!arMasterTarget(s,m,customerId,kind,id))return null;
 const row=formalRow(s,kind,id);
 if(!row||row.customerId!==customerId||row.duplicateConflict||['draft','cancelled','pending'].includes(row.status)||!row.currency||row.amountCents===null||row.receivedCents===null||row.balanceCents===null)return null;
 return {canonicalKey:row.canonicalKey,currency:row.currency,amountCents:row.amountCents,receivedCents:row.receivedCents,balanceCents:row.balanceCents,status:row.status,dueDate:row.dueDate||'',sourceKind:kind,sourceId:id};
}
export function arMasterActiveLinks(s:State,entryId:string){
 return all(s,'ar_master_source_link').filter(l=>l.entryId===entryId&&!all(s,'ar_master_source_link_cancel').some(c=>c.linkId===l.id&&c.entryId===entryId));
}
export function arMasterLinks(s:State,m:Member,row:Entity):Entity[]{
 return all(s,'ar_master_source_link').filter(l=>l.entryId===row.id).map(l=>{
  const cancels=all(s,'ar_master_source_link_cancel').filter(c=>c.linkId===l.id&&c.entryId===row.id);
  const target=l.customerId===row.customerId?arMasterTarget(s,m,row.customerId,l.targetKind,l.targetId):null;
  const currentFormal=l.relation==='same_receivable'&&target?arMasterFormalTarget(s,m,row.customerId,l.targetKind,l.targetId):null;
  return {...l,status:cancels.length?'cancelled':'active',targetSnapshot:target?structuredClone(l.targetSnapshot):null,cancelEvents:cancels,
   targetUnavailable:!target,targetChanged:!!target&&(target.version!==l.targetVersion||l.relation==='same_receivable'&&JSON.stringify(currentFormal)!==JSON.stringify(l.formalSnapshot)),currentFormal};
 });
}
export async function arMasterDto(s:State,m:Member,row:Entity):Promise<Entity&{amountCents:number|null;receivedCents:number|null;balanceCents:number|null;links:Entity[];sourceAmountExactCents:number|null;sourceAmountIssue:string;includedInTotals:boolean;issues:string[]} >{
 const sourceChanged=!await arMasterSourceCurrent(s,row),customer=all(s,'customer_account').find(c=>c.id===row.customerId),team=all(s,'customer_project_team').find(t=>t.id===row.teamId);
 const sourceAmount=row.sourceKind==='ar_invoice_group'?{cents:null,issue:''}:arMasterExactAmount(row.sourceSnapshot?.originalAmountDecimal),links=arMasterLinks(s,m,row),same=links.filter(l=>l.status==='active'&&l.relation==='same_receivable'),issues:string[]=[];
 if(!customer)issues.push('客户待手工匹配');if(!row.teamId)issues.push('历史所属组待核对');
 if(!arCurrencies.includes(row.currency))issues.push('币种待核对');if(row.amountBasis==='unknown')issues.push('原金额是应收总额还是期初未收余额待核对');
 if(!arDay(row.asOf))issues.push('金额截至日待核对');if(row.reviewStatus!=='confirmed'&&!same.length)issues.push('账务金额尚未确认');
 if(sourceAmount.issue)issues.push(sourceAmount.issue);if(sourceChanged)issues.push('原暂存记录已改变或缺失，请先核对来源差异');
 if(links.some(l=>l.status==='active'&&l.targetUnavailable))issues.push('部分关联来源已不可读取');
 if(links.some(l=>l.status==='active'&&l.targetChanged))issues.push('部分关联来源版本或账务金额已变化，请重新核对关联');
 if(same.length)issues.push('本行引用已有正式应收，不再独立累计金额');
 const versions:Entity[]=row.sourceKind==='ar_invoice_group'?row.sourceSnapshots||[]:[],confirmed=versions.filter(r=>r.status==='confirmed');
 let historicalAmounts:Record<string,unknown>|null=null;
 if(confirmed.length===1){const original=confirmed[0],dto=arInvoiceDto(s,original),batch=(row.sourceBatchSnapshots||[]).find((b:Entity)=>b.id===original.batchId);historicalAmounts={invoiceId:original.id,amountCents:dto.amountCents,receivedCents:dto.receivedCents,balanceCents:dto.balanceCents,currency:original.currency,sourceAsOf:batch?.sourceAsOf||null,paymentStatus:dto.paymentStatus,paymentRemark:dto.paymentRemark};}
 if(versions.length>1)issues.push('同票号全部版本已保留，确认金额须核对有效版本与口径');
 if(row.additionalSources?.length)issues.push('包含其他历史表的同票号附加来源；不可将尾款与累计应收混作同一金额');
 return {...row,customer:clean(customer?.customer)||clean(row.sourceSnapshot?.customerLabel)||'待匹配客户',customerCode:clean(customer?.customerCode),
  teamName:clean(team?.name)||'未分组 / 待确认',title:clean(row.sourceSnapshot?.title)||'历史应收登记',sourceAmountExactCents:sourceAmount.cents,sourceAmountIssue:sourceAmount.issue,
  amountCents:arMasterCents(row.amountCents),receivedCents:arMasterCents(row.receivedCents),balanceCents:arMasterCents(row.balanceCents),
  sourceIssues:row.sourceKind==='ar_invoice_group'?[...list(row.sourceSnapshot?.issues),...(row.additionalSources||[]).flatMap((r:Entity)=>arMasterLegacyIssues(s,r))]:arMasterLegacyIssues(s,row.sourceSnapshot),
  sourceChanged,links,historicalAmounts,linkedAmounts:same.length===1?same[0].currentFormal:null,
  includedInTotals:row.reviewStatus==='confirmed'&&!sourceChanged&&!same.length,issues,contributesToCash:false,contributesToProductionBalance:false};
}
export type ArMasterQuery={customerId?:string;teamId?:string;id?:string;invoiceCustomerIds?:string[]};
export async function arMasterData(s:State,m:Member,query:ArMasterQuery={}){
 const scope=arAccess(s,m);if(!scope.allowed)throw new AppError('没有应收总表访问权限。',403);
 if(query.teamId&&!scope.company&&(query.teamId==='__ungrouped'||!scope.teamIds.includes(query.teamId)))throw new AppError('没有该组总表读取权限。',403);
 const matches=(r:Entity)=>arMasterReadable(s,m,r)&&(!query.customerId||r.customerId===query.customerId)&&(!query.teamId||(query.teamId==='__ungrouped'?!r.teamId:r.teamId===query.teamId));
 const entries=all(s,'ar_master_entry').filter(matches),selected=query.id?arMasterRequire(s,m,query.id):null;
 if(selected&&!matches(selected))throw new AppError('总表记录与筛选范围不一致。',403);
 const rows=await Promise.all(entries.filter(r=>!query.id||r.id===query.id).map(r=>arMasterDto(s,m,r)));
 const allSources=all(s,'ar_legacy_pending').filter(r=>r.status==='pending'&&arMasterReadable(s,m,r));
 const sources=allSources.filter(r=>!all(s,'ar_master_entry').some(e=>e.sourceKind==='ar_legacy_pending'&&e.sourceId===r.id||(e.additionalSources||[]).some((a:Entity)=>a.id===r.id)));
 const legacySources=await Promise.all(sources.map(async source=>({id:source.id,sourceHash:await arMasterSourceHash(source),title:clean(source.title),customerLabel:clean(source.customerLabel),currency:clean(source.currency),originalAmountDecimal:source.originalAmountDecimal??null,sourceSheet:clean(source.sourceSheet||source.source?.sheet),sourceRow:source.sourceRow??source.source?.rowNumber??null,issues:list(source.issues)})));
 const invoiceCustomerIds=query.invoiceCustomerIds??[...new Set(all(s,'ar_invoice').filter(r=>arMasterReadable(s,m,r)).map(r=>r.customerId))];
 const registrationPlan=scope.canConfigure?await arMasterRegistrationPlan(s,m,allSources.map(r=>r.id),invoiceCustomerIds):null;
 const registration=registrationPlan?(({entries:_,...publicPlan})=>publicPlan)(registrationPlan):{sourceIds:[],invoiceCustomerIds:[],previewHash:'',entryCount:0,existingEntryCount:0,newEntryCount:0,legacyEntryCount:0,invoiceGroupCount:0,overlapCount:0};
 const visibleCustomers=new Set(entries.map(r=>r.customerId).filter(Boolean));
 const customers=all(s,'customer_account').filter(c=>scope.company||visibleCustomers.has(c.id)||arProfileCustomerReadable(s,m,c.id)).map(c=>({id:c.id,customer:c.customer,customerCode:c.customerCode,active:c.active}));
 const candidateCustomer=selected?.customerId||query.customerId||'',candidates=selected&&candidateCustomer?s.records.filter(r=>arMasterTargetKinds.includes(r.kind as never)).flatMap(r=>{
  const target=arMasterTarget(s,m,candidateCustomer,r.kind,r.id);if(!target)return [];
  return [{...target,relations:arMasterFormalTarget(s,m,candidateCustomer,r.kind,r.id)?['origin','same_receivable']:['origin']}];
 }):[];
 const totalsByCurrency:Record<string,{knownReceivableCents:number;knownReceivedCents:number;knownBalanceCents:number;unknownReceivableCount:number;unknownReceivedCount:number;unknownBalanceCount:number;includedCount:number;excludedLinkedCount:number;asOfDates:string[];mixedAsOf:boolean}>={};
 for(const row of rows){
  if(!arCurrencies.includes(row.currency))continue;
  const total=totalsByCurrency[row.currency]??={knownReceivableCents:0,knownReceivedCents:0,knownBalanceCents:0,unknownReceivableCount:0,unknownReceivedCount:0,unknownBalanceCount:0,includedCount:0,excludedLinkedCount:0,asOfDates:[],mixedAsOf:false};
  if(row.links.some(l=>l.status==='active'&&l.relation==='same_receivable')){total.excludedLinkedCount++;continue;}
  for(const [field,sum,unknown] of [['amountCents','knownReceivableCents','unknownReceivableCount'],['receivedCents','knownReceivedCents','unknownReceivedCount'],['balanceCents','knownBalanceCents','unknownBalanceCount']] as const){
   if(row.includedInTotals&&row[field]!==null){total[sum]+=row[field]!;if(!Number.isSafeInteger(total[sum]))throw new AppError('汇总金额超出安全范围，请缩小筛选范围。');}else total[unknown]++;
  }
  if(row.includedInTotals){total.includedCount++;if(row.asOf&&!total.asOfDates.includes(row.asOf))total.asOfDates.push(row.asOf);}
  total.asOfDates.sort();total.mixedAsOf=total.asOfDates.length>1;
 }
 const linkedCount=rows.filter(r=>r.links.some(l=>l.status==='active'&&l.relation==='same_receivable')).length;
 return {rows,customers,teams:all(s,'customer_project_team').filter(t=>scope.company||scope.teamIds.includes(t.id)).map(t=>({id:t.id,name:t.name,active:t.active})),candidates,legacySources,
  registration,totalsByCurrency,counts:{registeredCount:rows.length,pendingCount:rows.filter(r=>!r.includedInTotals&&!r.links.some(l=>l.status==='active'&&l.relation==='same_receivable')).length,confirmedCount:rows.filter(r=>r.includedInTotals).length,linkedCount,sourceChangedCount:rows.filter(r=>r.sourceChanged).length,unregisteredCount:registration.newEntryCount,negativeSourceCount:rows.filter(r=>r.sourceAmountExactCents!==null&&r.sourceAmountExactCents<0).length,precisionIssueCount:rows.filter(r=>r.sourceAmountIssue.includes('精度')).length,unknownAsOfCount:rows.filter(r=>!r.asOf).length},
  canWrite:scope.canConfigure,scope,boundary:arMasterBoundary};
}
