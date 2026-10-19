import {all,canRead,clean,type CustomerAccount,type Entity,type Member,type Order,type State} from './domain';
import {arAccess,arAttribution} from './ar-workspace';
import {canReadServiceRecord,serviceOrderCustomerKeys} from './service-workspace';
import {canReadProject,projectAccess} from './customer-projects';
import {canReadProjectFinance} from './customer-project-finance';
import {businessAccess} from './handoff-business';

export const arProfileCoreColumns=[
 {key:'invoiceNo',labelZh:'发票编号',labelEn:'Invoice No.'},
 {key:'currency',labelZh:'币种',labelEn:'Currency'},
 {key:'amountCents',labelZh:'历史净应收',labelEn:'Historical net receivable'},
 {key:'receivedCents',labelZh:'截至日实收',labelEn:'As-of receipts'},
 {key:'balanceCents',labelZh:'截至日未收',labelEn:'As-of outstanding'},
] as const;
export const arProfileOptionalColumns=[
 {key:'invoiceDate',labelZh:'发票日期',labelEn:'Invoice date'},
 {key:'documentType',labelZh:'单据类型',labelEn:'Document type'},
 {key:'sourceSheet',labelZh:'原工作表',labelEn:'Source worksheet'},
 {key:'note',labelZh:'补充备注',labelEn:'Additional note'},
 {key:'remarks',labelZh:'原表备注',labelEn:'Source remarks'},
 {key:'orderNo',labelZh:'原订单号',labelEn:'Source order No.'},
 {key:'projectNo',labelZh:'原项目号',labelEn:'Source project No.'},
] as const;
export const arProfileTargetKinds=['order','customer_project','project_billing_document','handoff_business_document','service_record','ar_invoice'] as const;
export type ArProfileField={key:string;labelZh:string;labelEn:string;type:'text'|'number'|'date';required:boolean};
export type ArCustomerProfile=Entity&{customerId:string;version:number;documentTitle:string;language:'zh'|'en'|'bilingual';statementColumns:string[];customFields:ArProfileField[];note:string};
export const arProfileBoundary='客户模板只规定新对账单的展示与扩展字段，不改变核心金额口径、不执行公式、不重新排列已冻结对账单，也不自动建立订单关联。';
export function arCustomerProfile(s:State,customerId:string):ArCustomerProfile{
 const existing=all(s,'ar_customer_profile').find(p=>p.customerId===customerId);
 return existing as ArCustomerProfile||{id:'',kind:'ar_customer_profile',customerId,version:0,documentTitle:'STATEMENT',language:'bilingual',statementColumns:['invoiceNo','invoiceDate','currency','amountCents','receivedCents','balanceCents','sourceSheet','note'],customFields:[],note:''};
}
export function arProfileInvoiceReadable(s:State,m:Member,row:Entity){const scope=arAccess(s,m),teamId=arAttribution(s,row).teamId;return scope.allowed&&(scope.company||!!teamId&&scope.teamIds.includes(teamId));}
export function arProfileCustomerReadable(s:State,m:Member,customerId:string){
 const scope=arAccess(s,m);if(!scope.allowed||!all(s,'customer_account').some(c=>c.id===customerId))return false;
 return scope.company||all(s,'customer_project_team').some(t=>scope.teamIds.includes(t.id)&&(t.customerIds||[]).includes(customerId))||all(s,'ar_invoice').some(r=>r.customerId===customerId&&arProfileInvoiceReadable(s,m,r));
}
function matchingOrder(s:State,m:Member,customerId:string,order:Entity){
 const c=all(s,'customer_account').find(c=>c.id===customerId) as CustomerAccount|undefined;
 return !!c&&canRead(m,order as Order)&&serviceOrderCustomerKeys(s,c).some(key=>clean(key).toLowerCase()===clean(order.customer).toLowerCase());
}
/** Candidate permissions belong to their original modules, independently of the AR display grant. */
export function arProfileTarget(s:State,m:Member,customerId:string,kind:string,id:string):Entity|null{
 if(!m.active||!arProfileTargetKinds.includes(kind as never))return null;
 const row=s.records.find(r=>r.kind===kind&&r.id===id);if(!row)return null;
 if(kind==='order'){if(!matchingOrder(s,m,customerId,row))return null;}
 else{
  if(row.customerId!==customerId)return null;
  if(kind==='customer_project'&&(row.trashedAt||!canReadProject(s,m,row)))return null;
  if(kind==='project_billing_document'&&(!['PI','CI'].includes(row.documentType)||!(canReadProjectFinance(s,m,customerId)||projectAccess(s,m,customerId).read)))return null;
  if(kind==='handoff_business_document'&&(!['pi','invoice'].includes(row.type)||!businessAccess(s,m,{customerId,projectId:row.projectId||'',orderId:row.orderId||'',type:row.type})))return null;
  if(kind==='service_record'&&(row.type!=='receivable'||!canReadServiceRecord(s,m,row)))return null;
  if(kind==='ar_invoice'&&!arProfileInvoiceReadable(s,m,row))return null;
 }
 const order=kind==='order'?row:row.orderId?all(s,'order').find(o=>o.id===row.orderId&&matchingOrder(s,m,customerId,o)):undefined;
 const project=kind==='customer_project'?row:row.projectId?all(s,'customer_project').find(p=>p.id===row.projectId&&p.customerId===customerId&&!p.trashedAt&&canReadProject(s,m,p)):undefined;
 const label=kind==='order'?[row.orderNo,row.customerPO,row.drawing].filter(Boolean).join(' · '):kind==='customer_project'?[row.code,row.title].filter(Boolean).join(' · '):clean(row.documentNo||row.number||row.invoiceNo||row.details?.invoiceNo||row.title);
 const view=kind==='order'?'orders':kind==='customer_project'?'customer-projects':kind==='project_billing_document'?'project-finance':kind==='handoff_business_document'?'documents':kind==='service_record'?'service-receivables':'ar-workspace';
 return {kind,id,version:Number.isSafeInteger(row.version)?row.version:1,label:label||id,view,...(order?{orderId:order.id,orderNo:clean(order.orderNo),customerPO:clean(order.customerPO),drawing:clean(order.drawing)}:{}),...(project?{projectId:project.id,projectNo:clean(project.code)}:{}),...(!['order','customer_project'].includes(kind)?{documentNo:clean(row.documentNo||row.number||row.invoiceNo||row.details?.invoiceNo)}:{})};
}
export function arInvoiceExtra(s:State,invoiceId:string):Entity|null{return all(s,'ar_invoice_extra_values').filter(r=>r.invoiceId===invoiceId).sort((a,b)=>b.version-a.version)[0]||null;}
export function arInvoiceTraceLinks(s:State,m:Member,invoiceId:string):Entity[]{
 const invoice=all(s,'ar_invoice').find(r=>r.id===invoiceId);if(!invoice||!arProfileInvoiceReadable(s,m,invoice))return [];
 return all(s,'ar_invoice_source_link').filter(l=>l.invoiceId===invoiceId&&l.customerId===invoice.customerId).map(l=>{
  const cancelEvents=all(s,'ar_invoice_source_link_cancel').filter(c=>c.linkId===l.id&&c.invoiceId===invoiceId&&c.customerId===invoice.customerId),target=arProfileTarget(s,m,invoice.customerId,l.targetKind,l.targetId);
  return {...l,status:cancelEvents.length?'cancelled':'active',cancelEvents,targetSnapshot:target?structuredClone(l.targetSnapshot):null,targetUnavailable:!target,targetChanged:!!target&&target.version!==l.targetVersion};
 });
}
