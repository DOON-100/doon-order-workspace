import type {Entity,State} from './domain';

export function paymentRequestLedgerCurrent(s:State,row:Entity){
 if(row.type!=='paymentrequest')return true;
 const summary=row.billingSummary;if(!summary||summary.scope!=='single-full-shipment')return false;
 const account=s.records.find(r=>r.id===summary.receivableId&&r.kind==='service_record'&&r.type==='receivable');
 if(!account||account.status==='cancelled'||account.version!==summary.receivableVersion||account.customerId!==row.customerId||account.orderId!==row.orderId||account.details.currency!==summary.currency||account.details.amountCents!==summary.totalCents)return false;
 const entries=s.records.filter(r=>r.kind==='service_receipt'&&r.recordId===account.id).map(r=>({id:r.id,entryType:r.entryType,amountCents:r.amountCents,currency:r.currency})).sort((a,b)=>a.id.localeCompare(b.id));
 const same=(r:Entity)=>r.customerId===row.customerId&&r.orderId===row.orderId&&r.projectId===row.projectId;
 return JSON.stringify(entries)===JSON.stringify(summary.entries)&&s.records.filter(r=>r.kind==='handoff_business_document'&&same(r)&&r.type==='invoice').length===1&&s.records.filter(r=>r.kind==='handoff_business_document'&&same(r)&&r.type==='pi'&&r.status==='checked').length===1;
}

/** Structural freshness only. Callers must apply their own current read/write scope. */
export function businessEvidenceCurrent(s:State,row:Entity,seen=new Set<string>()):boolean{
 if(!paymentRequestLedgerCurrent(s,row))return false;
 if(seen.has(row.id))return false;
 const path=new Set(seen);path.add(row.id);
 if((row.originRefs||[]).some((ref:Entity)=>!s.records.some(r=>r.id===ref.id&&r.kind===ref.kind&&r.version===ref.version)))return false;
 return (row.sourceRefs||[]).every((ref:Entity)=>{
  const current=s.records.find(r=>r.id===ref.id&&['handoff_business_source','handoff_business_document'].includes(r.kind));
  return !!current&&current.version===ref.version&&current.customerId===row.customerId&&current.projectId===row.projectId&&current.orderId===row.orderId&&businessEvidenceCurrent(s,current,path);
 });
}
