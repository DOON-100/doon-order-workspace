import {all,clean,type Entity,type Member,type State} from './domain';
import {projectChargeAmounts,projectAllocationNet,type ProjectCharge} from './customer-project-finance';
import {serviceReceivedCents} from './service-workspace';

export const arCurrencies=['CNY','USD','EUR','GBP','HKD'] as const;
export const arUngrouped='__ungrouped';
export type ArScope={company:boolean;teamIds:string[];readOnly:boolean;canConfigure:boolean;canExport:boolean;exportCompany:boolean;exportTeamIds:string[];allowed:boolean};
export type ArQuery={teamId?:string;customerId?:string;currency?:string;periodType?:'month'|'quarter'|'year';period?:string};
export type ArRow={id:string;sourceKind:string;sourceId:string;canonicalKey:string;customerId:string;customer:string;customerCode:string;teamId:string;teamName:string;title:string;currency:string;amountCents:number|null;date:string;issues:string[];[key:string]:any};
const list=(v:unknown):string[]=>Array.isArray(v)?v.filter((x):x is string=>typeof x==='string'):[];
const cents=(v:unknown):number|null=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:null;
export function arDay(v:unknown){const d=typeof v==='string'?v:'';if(!/^\d{4}-\d{2}-\d{2}$/.test(d))return '';const t=new Date(d+'T00:00:00Z');return Number.isFinite(+t)&&t.toISOString().slice(0,10)===d?d:'';}
export function arToday(){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
export function arReadOnly(s:State,m:Member){return all(s,'ar_access_grant').some(g=>g.active===true&&g.memberId===m.id&&g.readOnly===true);}
/** Export grants remain scoped independently from read grants. Reading another team never extends export rights. */
export function arExportAccess(s:State,m:Member){
 const valid=m.active&&m.role!=='supplier',teams=all(s,'customer_project_team').filter(t=>t.active===true);
 const grants=valid?all(s,'ar_access_grant').filter(g=>g.active===true&&g.memberId===m.id&&list(g.capabilities).includes('read')&&list(g.capabilities).includes('export')):[];
 const company=valid&&(m.role==='admin'||grants.some(g=>g.scopeType==='company'));
 const teamIds=valid?[...new Set([...teams.filter(t=>['leaderIds','salesMemberIds','serviceMemberIds'].some(k=>list(t[k]).includes(m.id))).map(t=>t.id),...grants.filter(g=>g.scopeType==='team').flatMap(g=>list(g.teamIds))])].filter(id=>teams.some(t=>t.id===id)):[];
 return {company,teamIds};
}
export function arExportRowsAllowed(s:State,m:Member,rows:Record<string,any>[]){
 const scope=arExportAccess(s,m);return scope.company||rows.length>0&&rows.every(row=>!!row.teamId&&scope.teamIds.includes(row.teamId));
}
/** The selected read scope and every exported row must both fit the caller's current export scope. */
export function arExportAllowed(s:State,m:Member,teamId:string,rows:Record<string,any>[]){
 const scope=arExportAccess(s,m);if(scope.company)return true;
 if(!scope.teamIds.length)return false;
 if(teamId){if(!scope.teamIds.includes(teamId))return false;}
 else{const read=arAccess(s,m);if(read.company||read.teamIds.some(id=>!scope.teamIds.includes(id)))return false;}
 return rows.every(row=>!!row.teamId&&scope.teamIds.includes(row.teamId));
}
export function arAccess(s:State,m:Member):ArScope{
 const readOnly=arReadOnly(s,m),valid=m.active&&m.role!=='supplier';
 const grants=valid?all(s,'ar_access_grant').filter(g=>g.active===true&&g.memberId===m.id&&list(g.capabilities).includes('read')):[];
 const company=valid&&(m.role==='admin'||grants.some(g=>g.scopeType==='company'));
 const teams=all(s,'customer_project_team').filter(t=>t.active===true);
 const teamIds=valid?[...new Set([...teams.filter(t=>['leaderIds','salesMemberIds','serviceMemberIds'].some(k=>list(t[k]).includes(m.id))).map(t=>t.id),...grants.filter(g=>g.scopeType==='team').flatMap(g=>list(g.teamIds))])].filter(id=>teams.some(t=>t.id===id)):[];
 const exported=arExportAccess(s,m);return {company,teamIds,readOnly,canConfigure:valid&&m.role==='admin'&&!readOnly,canExport:exported.company||exported.teamIds.length>0,exportCompany:exported.company,exportTeamIds:exported.teamIds,allowed:company||teamIds.length>0};
}
export function arBinding(s:State,r:Entity){return all(s,'ar_source_binding').find(b=>b.active!==false&&b.sourceKind===r.kind&&b.sourceId===r.id);}
function shiftDate(date:string,days:number){if(!arDay(date)||!Number.isInteger(days))return '';const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
export function arChargeSchedule(s:State,charge:Entity,receivedCents:number){
 const milestone=all(s,'ar_document_milestone').find(x=>x.sourceId===charge.sourceDocumentId&&x.sourceKind==='project_billing_document');
 const plans=(Array.isArray(charge.plan)?charge.plan:[]).map((p:any,index:number)=>{
  let dueDate=arDay(p.dueDate);const days=Number.isInteger(p.offsetDays)?p.offsetDays:0;
  if(p.trigger==='before_shipment')dueDate=shiftDate(arDay(milestone?.plannedShipDate),-days);
  if(p.trigger==='after_shipment')dueDate=shiftDate(arDay(milestone?.actualShipDate),days);
  if(p.trigger==='shipment_month_end'){const date=arDay(milestone?.actualShipDate);if(date){const [year,month]=date.split('-').map(Number);dueDate=shiftDate(new Date(Date.UTC(year,month,0)).toISOString().slice(0,10),days);}else dueDate='';}
  return {id:clean(p.id)||String(index),title:clean(p.title),amountCents:cents(p.amountCents),dueDate,beforeOrder:p.beforeOrder===true,trigger:clean(p.trigger),offsetDays:days,index,receivedCents:0,balanceCents:cents(p.amountCents)};
 });
 let remaining=receivedCents;for(const p of [...plans].sort((a,b)=>(a.dueDate||'9999').localeCompare(b.dueDate||'9999')||a.index-b.index)){if(p.amountCents===null)continue;const applied=Math.min(remaining,p.amountCents);p.receivedCents=applied;p.balanceCents=p.amountCents-applied;remaining-=applied;}
 return plans;
}
/** Only explicit snapshots or a historical project version can attribute money. Current customer membership is never an attribution. */
export function arAttribution(s:State,r:Entity):{teamId:string;basis:string}{
 const binding=arBinding(s,r);if(binding)return {teamId:clean(binding.teamId),basis:'confirmed_binding'};
 for(const key of ['attributionTeamIdSnapshot','attributionTeamId','teamId'])if(Object.hasOwn(r,key))return {teamId:clean(r[key]),basis:'source_snapshot'};
 const p=r.projectId&&all(s,'customer_project').find(p=>p.id===r.projectId&&p.customerId===r.customerId);
 if(p){
  const at=String(r.createdAt||''),history=all(s,'audit').filter(a=>a.targetId===p.id&&a.after?.kind==='customer_project').sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));
  const prior=history.filter(h=>at&&h.createdAt<=at).at(-1)?.after;
  const following=history.find(h=>at&&h.createdAt>at)?.before;
  const snapshot=prior||following||(at&&p.createdAt&&p.createdAt<=at&&p.updatedAt&&p.updatedAt<=at?p:null);
  if(snapshot?.customerId===r.customerId&&snapshot.teamId)return {teamId:clean(snapshot.teamId),basis:'historical_project'};
 }
 return {teamId:'',basis:'pending_mapping'};
}
function canonical(s:State,r:Entity){return clean(arBinding(s,r)?.canonicalKey||r.arCanonicalKey)||`${r.kind}:${r.id}`;}
function base(s:State,r:Entity,title:string,amount:unknown,currency:unknown,date:unknown):ArRow{
 const attribution=arAttribution(s,r),customer=all(s,'customer_account').find(c=>c.id===r.customerId),team=all(s,'customer_project_team').find(t=>t.id===attribution.teamId);
 const validCurrency=arCurrencies.includes(currency as any),amountCents=cents(amount),issues:string[]=[];
 if(!customer)issues.push('客户待匹配');if(!attribution.teamId)issues.push('原单据所属组待确认');if(attribution.teamId&&!team)issues.push('原所属组目录待确认');if(!validCurrency)issues.push('币种待确认');if(amountCents===null)issues.push('金额待确认');
 return {id:`${r.kind}:${r.id}`,sourceKind:r.kind,sourceId:r.id,canonicalKey:canonical(s,r),customerId:clean(r.customerId),customer:clean(customer?.customer)||'待匹配客户',customerCode:clean(customer?.customerCode),teamId:attribution.teamId,teamName:clean(team?.name)||'未分组 / 待确认',title,currency:validCurrency?String(currency):'',amountCents,date:arDay(date),issues,attributionBasis:attribution.basis};
}
function deduplicate(rows:ArRow[]){
 const grouped=new Map<string,ArRow[]>();for(const r of rows){const group=grouped.get(r.canonicalKey)||[];group.push(r);grouped.set(r.canonicalKey,group);}
 const output:ArRow[]=[];let duplicateCount=0;
 for(const group of grouped.values()){
  const first=group[0];if(group.length>1){duplicateCount+=group.length-1;const signature=(r:ArRow)=>{const parts=new Map<string,number>();for(const p of r.parts||[])parts.set(p.teamId,(parts.get(p.teamId)||0)+p.amountCents);return JSON.stringify([r.customerId,r.teamId,r.currency,r.amountCents,r.balanceCents??null,r.date,r.eventType||'',Array.from(parts).sort((a,b)=>a[0].localeCompare(b[0]))]);};
   if(group.some(r=>signature(r)!==signature(first))){output.push({...first,amountCents:null,balanceCents:null,receivedCents:null,teamId:'',teamName:'未分组 / 待确认',issues:[...first.issues,'相同来源标识的数据冲突，暂不计金额'],duplicateSources:group.map(r=>r.id),duplicateConflict:true});continue;}
  }
  output.push({...first,duplicateSources:group.slice(1).map(r=>r.id)});
 }
 return {rows:output,duplicateCount};
}
export function arReceivables(s:State){
 const rows:ArRow[]=[];
 for(const charge of all(s,'project_charge')){
  let amounts:{amountCents:number;receivedCents:number;balanceCents:number;prepayCents:number}|null=null;
  try{if(cents(charge.amountCents)!==null)amounts=projectChargeAmounts(s,charge as ProjectCharge);}catch{/* incomplete historical source remains pending */}
  const row=base(s,charge,clean(charge.title)||'项目收费',amounts?.amountCents,charge.currency,charge.dueDate);
  const valid=!!amounts&&[amounts.amountCents,amounts.receivedCents,amounts.balanceCents].every(n=>cents(n)!==null);
  row.receivedCents=valid?amounts!.receivedCents:null;row.balanceCents=valid?amounts!.balanceCents:null;row.prepayCents=valid?amounts!.prepayCents:null;
  row.status=charge.status!=='confirmed'?'draft':!valid?'pending':amounts!.balanceCents===0?'settled':amounts!.receivedCents>0?'partial':'open';row.category=clean(charge.category);row.projectId=clean(charge.projectId);row.orderId=clean(charge.orderId);row.plan=arChargeSchedule(s,charge,valid?amounts!.receivedCents:0);
  const scheduleValid=row.plan.length>0&&row.plan.every((p:any)=>p.amountCents!==null)&&row.plan.reduce((n:number,p:any)=>n+p.amountCents,0)===row.amountCents;
  row.dueDate=scheduleValid?[...row.plan].filter((p:any)=>p.balanceCents>0&&p.dueDate).map((p:any)=>p.dueDate).sort()[0]||'':arDay(charge.dueDate);
  row.overdueCents=valid?(scheduleValid?row.plan.filter((p:any)=>p.balanceCents>0&&p.dueDate&&p.dueDate<arToday()).reduce((n:number,p:any)=>n+p.balanceCents,0):row.dueDate&&row.dueDate<arToday()?amounts!.balanceCents:0):null;
  row.pendingDueCents=scheduleValid?row.plan.filter((p:any)=>p.balanceCents>0&&!p.dueDate).reduce((n:number,p:any)=>n+p.balanceCents,0):!row.dueDate?row.balanceCents:0;
  if(!valid)row.issues.push('账务金额或核销关系待核对');if(row.plan.length&&!scheduleValid)row.issues.push('原分期与调整后应收不一致，分期归属待核对');if(row.pendingDueCents>0&&row.status!=='settled')row.issues.push('部分收款到期日待触发 / 待确认');rows.push(row);
 }
 for(const record of all(s,'service_record').filter(r=>r.type==='receivable')){
  const row=base(s,record,clean(record.title)||clean(record.details?.invoiceNo)||'订单应收',record.details?.amountCents,record.details?.currency,record.dueDate),received=serviceReceivedCents(s,record.id),balance=row.amountCents===null?null:row.amountCents-received;
  const valid=cents(received)!==null&&balance!==null&&cents(balance)!==null;row.receivedCents=valid?received:null;row.balanceCents=valid?balance:null;row.dueDate=arDay(record.dueDate);row.status=record.status==='cancelled'?'cancelled':!valid?'pending':balance===0?'settled':received>0?'partial':'open';row.category='order';row.projectId='';row.orderId=clean(record.orderId);row.invoiceNo=clean(record.details?.invoiceNo);row.plan=[];row.overdueCents=valid&&row.dueDate&&row.dueDate<arToday()?balance:0;row.pendingDueCents=valid&&!row.dueDate?balance:0;
  if(!valid)row.issues.push('账务金额或核销关系待核对');if(!row.dueDate&&row.status!=='settled')row.issues.push('收款到期日待触发 / 待确认');rows.push(row);
 }
 return deduplicate(rows);
}
/** Cash is counted on actual receipt/refund dates. Allocations split attribution; they never create another cash event. */
export function arCash(s:State){
 const events:ArRow[]=[];
 const push=(row:ArRow)=>{if(!row.date)row.issues.push('实际发生日期待确认');events.push(row);};
 for(const receipt of all(s,'project_receipt')){
  if(all(s,'project_receipt_reversal').some(r=>r.receiptId===receipt.id))continue;
  const row=base(s,receipt,'实际到账',receipt.amountCents,receipt.currency,receipt.date);row.eventType='receipt';row.cashSign=1;
  const allocations=all(s,'project_allocation').filter(a=>a.receiptId===receipt.id&&a.entryType==='allocate'),parts:{teamId:string;amountCents:number;chargeId:string}[]=[];
  for(const a of allocations){const c=all(s,'project_charge').find(c=>c.id===a.chargeId&&c.customerId===receipt.customerId&&c.currency===receipt.currency);const net=projectAllocationNet(s,a);if(!c||cents(net)===null){row.issues.push('到账分配来源或金额待核对');continue;}if(net>0)parts.push({teamId:arAttribution(s,a).teamId||arAttribution(s,c).teamId,amountCents:net,chargeId:c.id});}
  const allocated=parts.reduce((n,p)=>n+p.amountCents,0),refunds=all(s,'project_refund').filter(r=>r.receiptId===receipt.id&&r.status==='executed'),refunded=refunds.reduce((n,r)=>n+(cents(r.amountCents)??0),0);
  if(row.amountCents!==null&&allocated+refunded>row.amountCents){row.issues.push('核销与退款超过原到账');row.parts=[{teamId:'',amountCents:row.amountCents}];}
  else row.parts=[...parts,...refunds.filter(r=>cents(r.amountCents)!==null).map(r=>({teamId:arAttribution(s,r).teamId||arAttribution(s,receipt).teamId,amountCents:r.amountCents})),...(row.amountCents!==null&&row.amountCents>allocated+refunded?[{teamId:arAttribution(s,receipt).teamId,amountCents:row.amountCents-allocated-refunded}]:[])];
  push(row);
  for(const refund of refunds){const r=base(s,{...refund,customerId:receipt.customerId},'实际退款',refund.amountCents,refund.currency||receipt.currency,refund.date);r.eventType='refund';r.cashSign=-1;r.parts=[{teamId:arAttribution(s,refund).teamId||arAttribution(s,receipt).teamId,amountCents:r.amountCents}];push(r);}
 }
 for(const receipt of all(s,'service_receipt').filter(r=>r.entryType==='payment')){
  if(all(s,'service_receipt').some(r=>r.entryType==='reversal'&&r.reversesId===receipt.id))continue;
  const record=all(s,'service_record').find(r=>r.id===receipt.recordId&&r.type==='receivable'&&r.customerId===receipt.customerId);const r=base(s,receipt,'订单实际到账',receipt.amountCents,receipt.currency,receipt.date);r.eventType='receipt';r.cashSign=1;
  r.parts=[{teamId:arAttribution(s,receipt).teamId||(record?arAttribution(s,record).teamId:''),amountCents:r.amountCents}];if(!record)r.issues.push('原应收来源待核对');push(r);
 }
 const dedup=deduplicate(events),rows:ArRow[]=[];
 for(const event of dedup.rows){
  if(event.duplicateConflict||event.amountCents===null){rows.push({...event,teamId:'',teamName:'未分组 / 待确认'});continue;}
  const parts=event.parts as {teamId:string;amountCents:number}[];
  const grouped=new Map<string,number>();for(const p of parts)grouped.set(p.teamId,(grouped.get(p.teamId)||0)+p.amountCents);
  for(const [teamId,amountCents] of grouped){const team=all(s,'customer_project_team').find(t=>t.id===teamId);rows.push({...event,id:event.id+':'+(teamId||arUngrouped),teamId,teamName:clean(team?.name)||'未分组 / 待确认',amountCents,netCents:amountCents*event.cashSign,issues:event.issues.filter(x=>!teamId||x!=='原单据所属组待确认'),parts:undefined});}
 }
 return {rows,duplicateCount:dedup.duplicateCount};
}
export function arShipments(s:State){
 const rows:ArRow[]=[];
 for(const source of s.records.filter(r=>r.kind==='handoff_business_source'&&r.type==='production_shipment'||r.kind==='service_record'&&r.type==='shipment')){
  const isService=source.kind==='service_record',date=isService?source.details?.shipDate:source.fields?.date;
  // A prepared shipment source is not evidence of an actual shipment. Explicit actual-state evidence is required.
  const actual=source.actualShipped===true||!!arDay(source.actualShipDate)||isService&&source.status==='done';
  let amount:number|null=null,currency=source.currency||source.fields?.currency||source.details?.currency;
  const evidence=arBinding(s,source);if(evidence?.shipmentVerified===true){amount=cents(evidence.shipmentAmountCents);currency=evidence.currency;}
  const row=base(s,source,clean(source.title||source.number||source.details?.invoiceNo)||'出货资料',amount,currency,source.actualShipDate||date);row.status=actual||evidence?.shipmentVerified===true?'actual':'pending';row.quantity=source.details?.quantity??(Array.isArray(source.lines)?source.lines.reduce((n:number,l:any)=>n+(Number(l.quantity)||0),0):null);
  if(!actual&&evidence?.shipmentVerified!==true)row.issues.push('实际出货状态待核实');if(!row.date)row.issues.push('实际出货日期待确认');if(amount===null)row.issues.push('已确认出货价款待关联');rows.push(row);
 }
 return deduplicate(rows);
}
export function arPeriod(periodType:'month'|'quarter'|'year'='month',period='',today=arToday()){
 const value=period|| (periodType==='year'?today.slice(0,4):periodType==='quarter'?`${today.slice(0,4)}-Q${Math.ceil(Number(today.slice(5,7))/3)}`:today.slice(0,7));
 let start='',end='';if(periodType==='month'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(value)){start=value+'-01';const [y,m]=value.split('-').map(Number);end=new Date(Date.UTC(y,m,1)).toISOString().slice(0,10);}else if(periodType==='quarter'&&/^\d{4}-Q[1-4]$/.test(value)){const y=Number(value.slice(0,4)),q=Number(value.at(-1));start=new Date(Date.UTC(y,(q-1)*3,1)).toISOString().slice(0,10);end=new Date(Date.UTC(y,q*3,1)).toISOString().slice(0,10);}else if(periodType==='year'&&/^\d{4}$/.test(value)){start=value+'-01-01';end=String(Number(value)+1).padStart(4,'0')+'-01-01';}
 if(!start||Number(start.slice(0,4))<2000||Number(start.slice(0,4))>2100)throw new Error('请选择有效的月、季或年期间');return {periodType,period:value,start,end};
}
export function arWorkspaceData(s:State,m:Member,query:ArQuery={}){
 const scope=arAccess(s,m);if(!scope.allowed)throw Object.assign(new Error('没有应收工作空间的组或公司访问权限。'),{status:403});
 const teamId=clean(query.teamId),customerId=clean(query.customerId),currency=clean(query.currency);
 if(teamId&&!scope.company&&(teamId===arUngrouped||!scope.teamIds.includes(teamId)))throw Object.assign(new Error('没有该组应收数据权限。'),{status:403});
 if(currency&&!arCurrencies.includes(currency as any))throw new Error('币种无效。');
 const period=arPeriod(query.periodType,query.period),today=arToday();
 const visible=(r:ArRow)=> (scope.company||!!r.teamId&&scope.teamIds.includes(r.teamId))&&(!teamId||(teamId===arUngrouped?!r.teamId:r.teamId===teamId))&&(!customerId||r.customerId===customerId)&&(!currency||r.currency===currency);
 const ar=arReceivables(s),cash=arCash(s),shipped=arShipments(s);
 const receivables=ar.rows.filter(visible),receipts=cash.rows.filter(visible),shipments=shipped.rows.filter(visible);
 type Balance={receivableCents:number;receivedCents:number;balanceCents:number;overdueCents:number;settledCount:number;openCount:number;pendingCount:number};
 const totalsByCurrency:Record<string,Balance>={};
 for(const r of receivables){if(!r.currency)continue;const t=totalsByCurrency[r.currency]??={receivableCents:0,receivedCents:0,balanceCents:0,overdueCents:0,settledCount:0,openCount:0,pendingCount:0};if(['draft','cancelled','pending'].includes(r.status)||r.amountCents===null||r.balanceCents===null){t.pendingCount++;continue;}t.receivableCents+=r.amountCents;t.receivedCents+=r.receivedCents;t.balanceCents+=r.balanceCents;t.overdueCents+=r.overdueCents||0;if(r.status==='settled')t.settledCount++;else t.openCount++;}
 type Performance={currency:string;receiptsCents:number;refundsCents:number;netCashCents:number;shipmentCents:number;cashEventCount:number;shipmentCount:number};
 const byCurrency:Record<string,Performance>={},teamMap=new Map<string,Performance&{teamId:string;teamName:string}>(),customerMap=new Map<string,Performance&{customerId:string;customer:string;customerCode:string}>();
 const empty=(c:string):Performance=>({currency:c,receiptsCents:0,refundsCents:0,netCashCents:0,shipmentCents:0,cashEventCount:0,shipmentCount:0});
 const periodRows=(rows:ArRow[])=>rows.filter(r=>r.date&&r.date>=period.start&&r.date<period.end&&r.currency&&r.amountCents!==null);
 const accumulate=(r:ArRow,isCash:boolean)=>{const tk=(r.teamId||arUngrouped)+'|'+r.currency,ck=r.customerId+'|'+r.currency;const targets=[byCurrency[r.currency]??=empty(r.currency),teamMap.get(tk)||{...empty(r.currency),teamId:r.teamId,teamName:r.teamName},customerMap.get(ck)||{...empty(r.currency),customerId:r.customerId,customer:r.customer,customerCode:r.customerCode}];teamMap.set(tk,targets[1] as any);customerMap.set(ck,targets[2] as any);for(const t of targets){if(isCash){if(r.cashSign===-1)t.refundsCents+=r.amountCents!;else t.receiptsCents+=r.amountCents!;t.netCashCents+=r.amountCents!*r.cashSign;t.cashEventCount++;}else{t.shipmentCents+=r.amountCents!;t.shipmentCount++;}}};
 for(const r of periodRows(receipts))accumulate(r,true);for(const r of periodRows(shipments).filter(r=>r.status==='actual'))accumulate(r,false);
 const allVisible=[...receivables,...receipts,...shipments],customerIds=new Set(allVisible.map(r=>r.customerId));
 const pending:{id:string;sourceKind:string;sourceId:string;customerId:string;customer:string;teamId:string;title:string;issues:string[];currency?:string;sourceAmountCents?:number|null;sourceReceivedCents?:number|null;sourceBalanceCents?:number|null;raw?:{paymentTermsRaw:string;originalAmountDecimal:string;invoiceDateRaw:string;dueDateRaw:string;remarkRaw:string;poPlRaw:string;sourceSheet:string;sourceRow:number|null};confirmed?:boolean;contributesToProductionBalance?:boolean}[]=allVisible.filter(r=>r.issues.length).map(r=>({id:r.id,sourceKind:r.sourceKind,sourceId:r.sourceId,customerId:r.customerId,customer:r.customer,teamId:r.teamId,title:r.title,issues:r.issues}));
 // Registration is tracked independently; immutable legacy rows remain source evidence.
 const registeredLegacy=new Set(all(s,'ar_master_entry').flatMap(r=>[
  ...(r.sourceKind==='ar_legacy_pending'?[r.sourceId]:[]),
  ...(Array.isArray(r.additionalSources)?r.additionalSources.filter((v:Entity)=>v.kind==='ar_legacy_pending').map((v:Entity)=>v.id):[]),
 ]));
 for(const legacy of all(s,'ar_legacy_pending').filter(r=>r.status==='pending'&&!registeredLegacy.has(r.id))){
  const row=base(s,legacy,clean(legacy.title)||'历史货款待核对',legacy.amountCents,legacy.currency,'');
  if(!visible(row))continue;pending.push({id:row.id,sourceKind:row.sourceKind,sourceId:row.sourceId,customerId:row.customerId,customer:row.customerId?row.customer:clean(legacy.customerLabel)||'待匹配客户',teamId:row.teamId,title:row.title,currency:row.currency,sourceAmountCents:cents(legacy.amountCents),sourceReceivedCents:cents(legacy.receivedCents),sourceBalanceCents:cents(legacy.balanceCents),raw:{paymentTermsRaw:clean(legacy.paymentTermsRaw),originalAmountDecimal:clean(legacy.originalAmountDecimal),invoiceDateRaw:clean(legacy.invoiceDateRaw),dueDateRaw:clean(legacy.dueDateRaw),remarkRaw:clean(legacy.remarkRaw),poPlRaw:clean(legacy.poPlRaw),sourceSheet:clean(legacy.sourceSheet),sourceRow:Number.isSafeInteger(legacy.sourceRow)?legacy.sourceRow:null},confirmed:false,contributesToProductionBalance:false,issues:[...new Set([...row.issues,...list(legacy.issues),'历史迁移待核对，不计正式余额或业绩'])]});
 }
 for(const collection of [Object.values(totalsByCurrency),Object.values(byCurrency),[...teamMap.values()],[...customerMap.values()]])for(const row of collection)for(const v of Object.values(row))if(typeof v==='number'&&!Number.isSafeInteger(v))throw new Error('金额累计超过安全范围，请缩小查询范围并核对来源。');
 return {scope,filter:{teamId,customerId,currency},teams:all(s,'customer_project_team').filter(t=>scope.company||scope.teamIds.includes(t.id)).map(t=>({id:t.id,name:clean(t.name),active:t.active===true})),customers:all(s,'customer_account').filter(c=>customerIds.has(c.id)).map(c=>({id:c.id,customer:c.customer,customerCode:c.customerCode})),receivables,receipts,shipments,pending,totalsByCurrency,performance:{...period,byCurrency,byTeam:[...teamMap.values()],byCustomer:[...customerMap.values()]},dataQuality:{pendingCount:pending.length,undatedCashCount:receipts.filter(r=>!r.date).length,unvaluedShipmentCount:shipments.filter(r=>r.amountCents===null||!r.date||r.status!=='actual').length,duplicateSources:scope.company?ar.duplicateCount+cash.duplicateCount+shipped.duplicateCount:undefined},generatedAt:new Date().toISOString(),basis:{cash:'实际到账日减实际退款日；错误冲销更正原到账，内部抵扣不计回款',shipment:'仅已核实实际出货与价款，未核实不填零',attribution:'单据/核销组快照；未分组款仅公司总览可见',balance:'当前余额；期间筛选仅用于回款与出货贡献',currency:'原币分列，不自动换汇'}};
}
