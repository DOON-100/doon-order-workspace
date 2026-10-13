import {all,canRead,clean,type CustomerAccount,type Entity,type Member,type Order,type State} from './domain';
import {AppError} from './store';
import {assignedServiceCustomer,serviceOrderCustomerKeys,serviceTotalsByCurrency,type ServiceRecord} from './service-workspace';
import {readableCustomerQuoteAccounts} from './customer-quote-access';
import {drawingCustomers} from './engineering-drawings';
import {canVerifyProjectFinance,projectFinanceTotals,type ProjectCharge,type ProjectReceipt} from './customer-project-finance';

export const businessTeamHeader='X-Workspace-Team';
export const ungroupedBusinessTeam='__ungrouped';
/** List responses only. Files, direct detail/history and mutations retain their own authorization. */
const scopedActions=new Set(['data','service-data','customer-project-data','customer-project-followup-data','customer-quotes','customer-quote-completed','customer-quote-templates','customer-price-archive','customer-workflow-data','customer-workflow-tasks','customer-workflow-transfers','handoff-business-data','handoff-business-review-data','unified-communication-data','factory-orders','factory-order-templates','project-finance-data','drawing-data','sop-data','framework-channels','framework-notices','framework-finance-tasks','finished-supplier-data','pmc-data','purchase-data']);
const ids=(value:unknown):string[]=>Array.isArray(value)?value.filter((id):id is string=>typeof id==='string'):[];
const key=(value:unknown)=>clean(value).toLowerCase();
type Row=Record<string,any>;
type Association={customerId:string;teamId:string;invalid?:boolean;linked?:Association[]};

function teamIndex(s:State){
 const accounts=all(s,'customer_account') as CustomerAccount[],byId=new Map(s.records.map(row=>[row.id,row]));
 const customerIds=new Set(accounts.map(account=>account.id));
 const ordersByNumber=new Map<string,Entity[]>();for(const order of all(s,'order')){const number=key(order.orderNo);if(number)ordersByNumber.set(number,[...(ordersByNumber.get(number)||[]),order]);}
 const customerByKey=new Map<string,string>();
 for(const account of accounts)for(const identity of serviceOrderCustomerKeys(s,account))customerByKey.set(key(identity),account.id);
 const teams=all(s,'customer_project_team'),activeTeams=teams.filter(team=>team.active===true&&Array.isArray(team.customerIds));
 const groupsByCustomer=new Map<string,Set<string>>();
 for(const team of activeTeams)for(const customerId of ids(team.customerIds)){
  let groups=groupsByCustomer.get(customerId);if(!groups){groups=new Set();groupsByCustomer.set(customerId,groups);}groups.add(team.id);
 }
 const links=['projectId','recordId','sopId','drawingRecordId','orderId','orderLineId','lineId','quoteId','followupId','taskId','roundId','chargeId','receiptId','documentId','targetId','linkedCommunicationId'] as const;
 const association=(value:Row,seen=new Set<string>()):Association=>{
  const source=value.id&&byId.get(value.id),row={...source,...value};
  if(row.id&&customerIds.has(row.id))return {customerId:row.id,teamId:''};
  const explicit=typeof row.customerId==='string'&&row.customerId||typeof row.customerAccountId==='string'&&row.customerAccountId||'';
  let customerId=explicit,teamId=typeof row.teamId==='string'?row.teamId:'';const ownTeam=!!teamId,linked:Association[]=[];
  const next=new Set(seen);if(row.id)next.add(row.id);
  for(const link of links){
   const id=row[link];if(typeof id!=='string'||!id||next.has(id))continue;
   const related=byId.get(id);if(!related)continue;
   const resolved=association(related,next);if(resolved.invalid||customerId&&resolved.customerId&&customerId!==resolved.customerId)return {customerId:'',teamId:'',invalid:true};
   customerId=customerId||resolved.customerId;
   if(resolved.teamId&&!ownTeam){if(teamId&&teamId!==resolved.teamId)return {customerId:'',teamId:'',invalid:true};teamId=teamId||resolved.teamId;}
   if(resolved.linked)linked.push(...resolved.linked);
  }
  // A whole email / billing document may refer to several business records. It belongs
  // to a group only when every referenced record fits that group; mixed records stay pending.
  for(const field of ['followupIds','chargeIds','adjustmentIds'])for(const id of ids(row[field])){
   if(next.has(id))continue;const related=byId.get(id);linked.push(related?association(related,next):{customerId:'',teamId:''});
  }
  if(row.kind==='purchase'&&row.customerOrder){
   const orders=ordersByNumber.get(key(row.customerOrder))||[];
   linked.push(...(orders.length?orders.map(order=>association(order,next)):[{customerId:'',teamId:''}]));
  }
  // A nonempty explicit customer binding is authoritative, even if its account was removed.
  if(!customerId&&!explicit)customerId=customerByKey.get(key(row.customer||row.customerCode||row.customerName))||'';
  return {customerId,teamId,...(linked.length?{linked}:{})};
 };
 return {accounts,byId,teams,groupsByCustomer,association};
}

function teamPredicate(index:ReturnType<typeof teamIndex>,teamId:string){
 const matchingGroups=(association:Association):Set<string>=>{
  if(association.invalid)return new Set();
  const groups=index.groupsByCustomer.get(association.customerId)||new Set<string>();
  let matched=association.teamId?new Set(groups.has(association.teamId)?[association.teamId]:[]):association.customerId?new Set(groups):null;
  for(const linked of association.linked||[]){const next=matchingGroups(linked);matched=matched===null?next:new Set([...matched].filter(id=>next.has(id)));}
  return matched||new Set();
 };
 return (row:Row)=>{
  const matched=matchingGroups(index.association(row));
  return teamId===ungroupedBusinessTeam?!matched.size:matched.has(teamId);
 };
}
/** Export handlers call this only after obtaining their original authorized rows. */
export function filterBusinessTeamRows<T extends Row>(s:State,rows:T[],teamId:string):T[]{
 return teamId?rows.filter(teamPredicate(teamIndex(s),teamId)):rows;
}

/** Safe directory for switching views; group membership itself never grants customer access. */
export function businessTeamData(s:State,m:Member){
 if(!m.active||m.role==='supplier')throw new AppError('没有业务分组目录访问权限。',403);
 const index=teamIndex(s),visibleIds=new Set<string>();
 for(const account of index.accounts)if(assignedServiceCustomer(s,m,account)||canVerifyProjectFinance(s,m,account.id))visibleIds.add(account.id);
 for(const account of [...readableCustomerQuoteAccounts(s,m),...drawingCustomers(s,m)])visibleIds.add(account.id);
 for(const order of all(s,'order') as Order[])if(canRead(m,order)){const customerId=index.association(order).customerId;if(customerId)visibleIds.add(customerId);}
 const customers=index.accounts.filter(account=>visibleIds.has(account.id)).map(account=>({id:account.id,customer:account.customer,customerCode:account.customerCode,active:account.active}));
 const teams=index.teams.filter(team=>ids(team.customerIds).some(id=>visibleIds.has(id))).map(team=>({id:team.id,name:String(team.name||''),active:team.active===true,
  customerIds:ids(team.customerIds).filter(id=>visibleIds.has(id)),leaderIds:ids(team.leaderIds),salesMemberIds:ids(team.salesMemberIds),serviceMemberIds:ids(team.serviceMemberIds)}));
 const memberIds=new Set(teams.flatMap(team=>[...team.leaderIds,...team.salesMemberIds,...team.serviceMemberIds]));
 return {teams,customers,members:all(s,'member').filter(member=>memberIds.has(member.id)).map(member=>({id:member.id,name:member.name}))};
}

/** Apply a display filter to an already-authorized DTO, never to the State used by an API. */
export function scopeBusinessTeamPayload(action:string,payload:Row,s:State,teamId:string,req?:Request):Row{
 const index=teamIndex(s);
 const belongs=teamPredicate(index,teamId);
 const customerBelongs=(id:string)=>belongs({customerId:id});
 const associated=(row:Row)=>{const result=index.association(row);return !!(result.customerId||result.teamId||result.linked?.length);};
 const hasRouting=(row:Row)=>associated(row)||['customerId','customerAccountId','customer','customerCode','customerName','projectId','recordId','lineId','orderLineId','orderId','quoteId','taskId','sopId'].some(field=>!!row[field]);
 const nested=(row:Row):Row=>{
  const result={...row};
  const indivisible=!!index.association(row).linked?.length;
  for(const field of ['lines','orderLinks','sourceRefs','sourceSnapshots','attachments','media','sentHistory'])if(Array.isArray(row[field])&&!indivisible){
   result[field]=row[field].filter((child:Row)=>!hasRouting(child)||belongs(child)).map((child:Row)=>({...child}));
  }
  for(const field of ['customerIds','readableCustomerIds'])if(Array.isArray(row[field]))result[field]=ids(row[field]).filter(customerBelongs);
  for(const field of ['orderIds','readableOrderIds','readableProjectIds'])if(Array.isArray(row[field]))result[field]=ids(row[field]).filter(id=>{const target=index.byId.get(id);return !!target&&belongs(target);});
  return result;
 };
 const filter=(rows:unknown)=>Array.isArray(rows)?rows.flatMap((row:Row)=>{
  if(!row||typeof row!=='object')return [];
  // Receipts aggregate independently linked order lines and have no customer on the header.
  if(!associated(row)&&Array.isArray(row.lines)&&row.lines.some(hasRouting)){
   const result=nested(row);return result.lines.length?[result]:[];
  }
  return belongs(row)?[nested(row)]:[];
 }):[];
 const data={...payload};
 const collections=['customers','customerAccounts','records','items','rows','orders','projects','trashedProjects','rounds','communications','tasks','drawings','confirmations','quoteLinks','samples','dispatches','feedback','handovers','attachments','receipts','uploads','events','details','followups','mails','sourceBundles','quotes','selections','charges','allocations','adjustments','creditApplications','documents','notices','cases','costs','refunds','requirements','sends','reversals','pool','handoffs','poolRequests','claims','reports','comments','corrections','outsource','losses','supplierFollowups','factory','service','sourceRequests','availableOrders','shipments','reworks'];
 for(const field of collections)if(Array.isArray(data[field]))data[field]=filter(data[field]);
 if(Array.isArray(data.templates))data.templates=data.templates.filter((row:Row)=>!hasRouting(row)||belongs(row));
 // Service/project team catalogs intentionally retain all authorized choices for switching.
 if(Array.isArray(data.members))data.members=data.members.map(nested);
 if(Array.isArray(data.ownerCandidates))data.ownerCandidates=data.ownerCandidates.map(nested).filter((row:Row)=>row.customerIds.length);
 // Financial grants are complete editable configuration, already admin-only in
 // the source DTO. Cropping customerIds here would revoke hidden customers on save.
 // Keep grants and their separate grantCustomers editor catalog intact.
 if(Array.isArray(data.quoteAuthorizedCustomerIds))data.quoteAuthorizedCustomerIds=data.quoteAuthorizedCustomerIds.filter(customerBelongs);
 if(action==='data'){
  // Import/export batches and their cached counts can span groups. They are available in the full view.
  for(const field of ['imports','ledgerImports'])data[field]=[];
  data.exports=(payload.exports||[]).filter((row:Row)=>ids(row.orderIds).length&&ids(row.orderIds).every(id=>{const order=index.byId.get(id);return !!order&&belongs(order);}));
  data.audits=(payload.audits||[]).filter((entry:Row)=>{
   const snapshots=[entry.before,entry.after].filter(Boolean);return snapshots.length?snapshots.every(belongs):belongs(entry);
  }).map(nested);
  const suppliers=new Set((data.outsource||[]).map((row:Row)=>row.supplier));
  data.suppliers=(payload.suppliers||[]).filter((row:Row)=>suppliers.has(row.name));
  data.supplierQuotes=(payload.supplierQuotes||[]).filter((row:Row)=>suppliers.has(row.supplier));
  data.collaborationTemplates=(payload.collaborationTemplates||[]).filter((row:Row)=>!row.customer||belongs(row));
  data.collaborationAssignments=filter(payload.collaborationAssignments);
  if(Array.isArray(data.receipts))data.receipts=data.receipts.filter((row:Row)=>row.lines?.length);
 }
 if(action==='service-data')data.totalsByCurrency=serviceTotalsByCurrency(s,data.records as ServiceRecord[]);
 if(action==='pmc-data'){
  data.rounds=(payload.rounds||[]).map((row:Row)=>({...row,lineIds:ids(row.lineIds).filter(id=>{const order=index.byId.get(id);return !!order&&belongs(order);}),lastLineId:row.lastLineId&&index.byId.has(row.lastLineId)&&belongs(index.byId.get(row.lastLineId)!)?row.lastLineId:''}));
  data.reviews=filter(payload.reviews);
 }
 if(action==='purchase-data')data.jobs=[];
 if(action==='customer-price-archive'){
  const rows=data.rows as Row[];data.summary={products:rows.length,skus:rows.filter(row=>row.product?.sku).length,verified:rows.filter(row=>row.status==='verified').length,needsReview:rows.filter(row=>row.status==='needs_review').length,missingPrice:rows.filter(row=>row.status==='missing_price').length};
 }
 if(action==='project-finance-data'){
  const charges=(data.charges||[]) as ProjectCharge[],receipts=(data.receipts||[]).filter((row:Row)=>row.kind==='project_receipt'&&!row.independent) as ProjectReceipt[];
  data.totalsByCurrency=projectFinanceTotals(s,charges,receipts);data.totalsScope='team';
  const projectId=req?new URL(req.url).searchParams.get('projectId'):'';
  data.projectTotalsByCurrency=payload.projectTotalsByCurrency===null?null:projectFinanceTotals(s,charges.filter(row=>!projectId||row.projectId===projectId),[]);
  data.gates=(payload.gates||[]).filter((row:Row)=>{const round=index.byId.get(row.roundId);return !!round&&belongs(round);});
 }
 if(action==='handoff-business-data'&&payload.queues){
  data.queues={...payload.queues};for(const field of ['drawings','sops','orders','factory','service','quotes'])data.queues[field]=filter(payload.queues[field]);
  data.queues.finance=scopeBusinessTeamPayload('project-finance-data',payload.queues.finance||{},s,teamId,req);
 }
 // A direct customer detail is deliberately not a list filter; its endpoint already authorizes it.
 return {...data,businessTeamScope:{teamId,mode:teamId===ungroupedBusinessTeam?'ungrouped':'team'}};
}

export async function scopeBusinessTeamResponse(action:string,req:Request,s:State,m:Member,response:Response){
 const teamId=(req.headers.get(businessTeamHeader)||'').trim();
 if(!teamId||m.role==='supplier'||!scopedActions.has(action)||!response.ok||!response.headers.get('Content-Type')?.includes('application/json'))return response;
 if(action==='customer-workflow-data'&&new URL(req.url).searchParams.has('customerId'))return response;
 if(teamId.length>160)throw new AppError('业务小组筛选编号无效。');
 if(teamId!==ungroupedBusinessTeam&&!businessTeamData(s,m).teams.some(team=>team.id===teamId))throw new AppError('业务小组不存在或不在可见客户范围内。',403);
 const payload=await response.json(),headers=new Headers(response.headers);headers.delete('Content-Length');headers.set('Vary',businessTeamHeader);headers.set('Cache-Control','no-store');
 return new Response(JSON.stringify(scopeBusinessTeamPayload(action,payload as Row,s,teamId,req)),{status:response.status,headers});
}
