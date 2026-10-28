import {all,allowedFields,broad,canRead,clean,type Entity,type Member,type Order,type State} from './domain';
import {AppError} from './store';
import {businessTeamData,businessTeamHeader,filterBusinessTeamRows,scopeBusinessTeamResponse,ungroupedBusinessTeam} from './business-team-scope';
import {customerProjectGet} from './customer-project-api';
import {customerProjectFinanceGet} from './customer-project-finance-api';
import {workflowFileAccess} from './customer-workflow-files';
import {projectFolders} from './customer-workflow';
import {workflowCapabilities,workflowCustomer} from './customer-workflow-api';
import {serviceWorkspaceGet} from './service-workspace-api';
import {processWorkspaceGet} from './process-workspace-api';
import {planningControlGet} from './planning-control-api';
import {engineeringDrawingGet} from './engineering-drawing-api';
import {purchaseGet} from './purchase-api';
import {customerQuoteGet} from './customer-quote-api';
import {ieQuoteGet} from './ie-quote-api';
import {unifiedCommunicationGet} from './unified-communication-api';
import {handoffBusinessGet} from './handoff-business-api';
import {businessAccess} from './handoff-business';
import {projectCollaborationGet} from './project-collaboration-api';
import {customerProjectFollowupGet} from './customer-project-followup-api';
import {paymentTermsGet} from './payment-terms-api';
import {paymentTermsReadOnly} from './payment-terms';
import {collaborationGet} from './collaboration-api';
import {finishedSupplierGet} from './finished-supplier-api';
import {canOperateFinished} from './finished-supplier';
import {productionWorkspaceGet} from './production-workspace-api';
import {canCreateOutsource} from './suppliers';
import {arWorkspaceGet} from './ar-workspace-api';
import {customerPriceArchiveGet} from './customer-price-archive-api';
import {kingdeePendingGet} from './kingdee-pending-api';
import {projectAccess} from './customer-projects';
import {canVerifyProjectFinance} from './customer-project-finance';
import {sha} from './workbooks';
import {arMasterLedgerGet} from './ar-master-ledger-api';
import {arInvoiceLedgerGet} from './ar-invoice-ledger-api';
import {arAttribution} from './ar-workspace';
import {kingdeeSalesGet} from './kingdee-sales-api';
import {processKinds} from './process-workspace';

export type FollowupTargetKey={module:string;collection:string;recordId:string;sectionKey:string};
export type FollowupTarget=FollowupTargetKey&{label:string;sectionLabel:string;canAppend:boolean};
export type ResolvedFollowupTarget=FollowupTarget&{recordKind:string;customerId:string;projectId:string;orderId:string;scopeIdentity:string};
type Row=Record<string,any>;
const projectSections:Record<string,string>={directory:'项目资料目录',overview:'需求与款色',communication:'沟通与待办',drawings:'图纸与客批',quotes:'报价版本',samples:'样办与寄样',finance:'费用与收款',documents:'PI / CI 单据',orders:'大货交接','after-sales':'售后与额外费用'};
const financialSections=new Set(['tab:finance','tab:documents','tab:after-sales']);
const orderModules=new Set(['orders','mine','pmc','completed','department','sales','pmc-handoff','service','production-planning','dashboard','reports']);
const serviceModules=new Set(['service-workspace','service-followups','shipment-followups','service-receivables']);
const processModules=new Set(['process-workspace','business-process',...processKinds.map(kind=>'process-'+kind)]);
const purchaseModules=new Set(['purchases','purchase','supplier-purchases','supplier-delivery','supplier-followups','supplier-followup','supplier-reconciliation']);
const pendingModules=new Set(['supplier-workspace','supplier-pending','supplier-followup','supplier-kit','supplier-risk','supplier-samples','supplier-reconciliation']);
const documentModules=new Set(['documents','order-confirmations','engineering-materials','production-orders','production-shipments','logistics-waybills','finance-documents']);
const documentTypes:Record<string,string[]>={'order-confirmations':['po','pi'],'engineering-materials':['engineering_drawing','engineering_quote'],'production-orders':['production_order'],'production-shipments':['production_shipment'],'logistics-waybills':['packing','invoice','waybill'],'finance-documents':['finance_file','finance_request','paymentrequest']};
const financeCollections=['charges','receipts','allocations','adjustments','creditApplications','documents','notices','cases','costs','refunds','requirements','sends','reversals'];

function requireMember(s:State,m:Member){
 const members=s.records.filter(row=>row.id===m.id);
 if(members.length!==1||members[0].kind!=='member'||!members[0].active||!m.active||m.role==='supplier')throw new AppError('没有当前业务跟进权限。',403);
}
function teamScope(req:Request,s:State,m:Member){
 const team=(req.headers.get(businessTeamHeader)||'').trim();
 if(team.length>160||team&&team!==ungroupedBusinessTeam&&!businessTeamData(s,m).teams.some(row=>row.id===team))throw new AppError('业务小组不存在或无权限。',403);
 return team;
}
function sourceRequest(req:Request,action:string,params:Record<string,string>={}){const url=new URL('/api/workspace/'+action,req.url);for(const [key,value] of Object.entries(params))if(value)url.searchParams.set(key,value);return new Request(url,{headers:req.headers});}
async function feed(action:string,req:Request,s:State,m:Member,get:(action:string,req:Request,s:State,m:Member)=>Response|null|Promise<Response|null>,params:Record<string,string>={}){
 const source=sourceRequest(req,action,params),response=await get(action,source,s,m);if(!response||!response.ok)throw new AppError('业务记录目录暂不可用。',503);
 return await (await scopeBusinessTeamResponse(action,source,s,m,response)).json() as Row;
}
async function optionalFeed(...args:Parameters<typeof feed>){try{return await feed(...args);}catch(error){if(error instanceof AppError&&error.status===403)return null;throw error;}}
function original(s:State,row:Row){const records=s.records.filter(item=>item.id===row.id);if(records.length!==1||row.kind&&records[0].kind!==row.kind)throw new AppError('业务记录标识冲突，请核对。',409);return records[0];}
function label(row:Row){return [row.code||row.quoteNo||row.po||row.orderNo||row.number||row.sampleNo||row.drawingNo||row.documentNo,row.title||row.name||row.model||row.itemName||row.drawing||row.customer||row.description||row.reference||row.filename].filter(Boolean).join(' · ').slice(0,500)||String(row.id);}
export function publicFollowupTarget(target:ResolvedFollowupTarget):FollowupTarget{const {module,collection,recordId,sectionKey,label,sectionLabel,canAppend}=target;return {module,collection,recordId,sectionKey,label,sectionLabel,canAppend};}
export function followupTargetScope(target:ResolvedFollowupTarget){return {recordKind:target.recordKind,customerId:target.customerId,projectId:target.projectId,orderId:target.orderId,scopeIdentity:target.scopeIdentity};}
// Legacy orders identify their customer by text. Include that identity and direct
// source associations so a reassignment cannot expose earlier customer content.
function sourceIdentity(s:State,row:Entity,seen=new Set<string>()):unknown{
 if(seen.has(row.id))return {id:row.id};const visited=new Set(seen);visited.add(row.id);
 const links:Record<string,unknown>={};for(const name of ['projectId','orderId','lineId','sourceOrderId','sourceId','recordId','taskId','quoteId','quoteLinkId'])if(row[name]){const parent=s.records.find(r=>r.id===row[name]);links[name]=parent&&visited.size<5?sourceIdentity(s,parent,visited):String(row[name]);}
 // Legacy procurement authorization joins the customer order number, which can
 // match several order lines. Freeze every matching source identity, not only
 // the first line, so changing ownership cannot transfer old evidence.
 if(row.kind==='purchase'&&row.customerOrder)links.customerOrders=all(s,'order').filter(order=>order.orderNo===row.customerOrder).sort((a,b)=>a.id.localeCompare(b.id)).map(order=>sourceIdentity(s,order,visited));
 const customerId=String(row.kind==='customer_account'?row.id:row.customerId||row.customerAccountId||'');
 return {id:row.id,kind:row.kind,customerId,...(!customerId?{customer:clean(row.customer).toLowerCase(),customerName:clean(row.customerName).toLowerCase(),customerCode:clean(row.customerCode).toLowerCase(),...(row.kind==='customer_project_followup'?{ownerId:clean(row.ownerId)}:{})}:{}),customerOrder:clean(row.customerOrder),teamId:clean(row.teamId),type:clean(row.type),channel:clean(row.channel),links};
}

/** The catalog only accepts rows already returned by the original scoped domain API. */
export async function businessFollowupTargets(req:Request,s:State,m:Member,module:string,projectId='',targetRecordId=''){
 requireMember(s,m);const team=module==='ar-workspace'?(req.headers.get(businessTeamHeader)||'').trim():teamScope(req,s,m);if(team.length>160)throw new AppError('业务小组编号无效。');
 const targets:ResolvedFollowupTarget[]=[],canonicalModule=orderModules.has(module)?'orders':serviceModules.has(module)?'service-workspace':purchaseModules.has(module)?'purchase':documentModules.has(module)?'documents':['mail','whatsapp'].includes(module)?'communications':processModules.has(module)?'process-workspace':module==='receiving'?'supplier-outsourcing':module;
 const virtual=(namespace:string,collection:string,recordId:string,label:string,scope:{customerId?:string;projectId?:string;orderId?:string;recordKind:string;scopeIdentity:string},canAppend:boolean)=>{
  if(recordId.length>160)throw new AppError('来源记录编号超出跟进长度限制。');
  targets.push({module:namespace,collection,recordId,sectionKey:'record',sectionLabel:'本条记录',label:label.slice(0,500),canAppend:canAppend&&!paymentTermsReadOnly(s,m),customerId:scope.customerId||'',projectId:scope.projectId||'',orderId:scope.orderId||'',recordKind:scope.recordKind,scopeIdentity:scope.scopeIdentity});
 };
 const add=(collection:string,rows:Row[]|undefined,append:(row:Row,raw:Entity)=>boolean,filter?:(row:Row)=>boolean)=>{
  for(const row of filterBusinessTeamRows(s,rows||[],team)){
   if(!row?.id||filter&&!filter(row))continue;const raw=original(s,row);
   const parent=raw.kind==='customer_project'?raw:raw.projectId?all(s,'customer_project').find(p=>p.id===raw.projectId):undefined;
   if(projectId&&raw.id!==projectId&&raw.projectId!==projectId)continue;
   const canAppend=!paymentTermsReadOnly(s,m)&&append(row,raw)&&(!parent||!parent.trashedAt&&parent.status!=='archived');
   targets.push({module:canonicalModule,collection,recordId:row.id,sectionKey:'record',sectionLabel:'本条记录',label:label(row),canAppend,recordKind:raw.kind,customerId:String(raw.customerId||raw.customerAccountId||parent?.customerId||''),projectId:raw.kind==='customer_project'?raw.id:String(raw.projectId||''),orderId:raw.kind==='order'?raw.id:String(raw.orderId||raw.lineId||raw.sourceOrderId||''),scopeIdentity:JSON.stringify(sourceIdentity(s,raw))});
  }
 };
 if(module==='customer-projects'){
  const data=await feed('customer-project-data',req,s,m,customerProjectGet),projects=new Map<string,Row>((data.projects||[]).map((p:Row)=>[p.id,p]));
  add('projects',data.projects,row=>row.canWrite===true);
  for(const collection of ['items','rounds','communications','tasks','drawings','confirmations','samples','dispatches','feedback','handovers','attachments'])add(collection,data[collection],row=>projects.get(row.projectId)?.canWrite===true,row=>projects.has(row.projectId));
  const followupData=await feed('customer-project-followup-data',req,s,m,customerProjectFollowupGet),followupStart=targets.length;
  add('followups',followupData.followups,row=>row.canWrite===true,row=>projects.has(row.projectId));for(const target of targets.slice(followupStart))target.module='customer-followups';
  add('quoteLinks',data.quoteLinks,(row,raw)=>{const project=projects.get(row.projectId);if(!project?.canWrite)return false;try{workflowFileAccess(s,m,{customerId:raw.customerId,projectId:raw.projectId,folder:'05_销售报价'},true);return true;}catch{return false;}},row=>projects.has(row.projectId)&&!row.restricted&&(()=>{try{workflowFileAccess(s,m,{customerId:row.customerId,projectId:row.projectId,folder:'05_销售报价'});return true;}catch{return false;}})());
 }else if(module==='project-finance'){
  const data=await feed('project-finance-data',req,s,m,customerProjectFinanceGet,projectId?{projectId}:{}),customers=new Map<string,Row>((data.customers||[]).map((c:Row)=>[c.id,c]));
  add('projects',data.projects,row=>customers.get(row.customerId)?.canWrite===true);
  for(const collection of financeCollections)add(collection,data[collection],row=>customers.get(row.customerId)?.canWrite===true);
 }else if(orderModules.has(module)){
  add('orders',(all(s,'order') as Order[]).filter(order=>canRead(m,order)),(_row,raw)=>allowedFields(m,raw as Order).length>0);
 }else if(module==='factory-orders'){
  const data=await feed('factory-orders',req,s,m,collaborationGet);add('items',data.items,()=>broad(m)||m.role==='sales');
 }else if(module==='finished-outsourcing'){
  const data=await feed('finished-supplier-data',req,s,m,finishedSupplierGet);for(const collection of ['tasks','shipments','reworks'])add(collection,data[collection],()=>canOperateFinished(m));
 }else if(module==='mes'||module==='losses'){
  const data=await feed('production-workspace-data',req,s,m,productionWorkspaceGet);for(const collection of module==='mes'?['reports','corrections']:['losses'])add(collection,data[collection],(_row,raw)=>{const order=all(s,'order').find(o=>o.id===raw.lineId) as Order|undefined;return broad(m)||!!order&&allowedFields(m,order).length>0;});
 }else if(module==='supplier-outsourcing'||module==='receiving'){
  add('outsource',all(s,'outsource').filter(row=>{const order=all(s,'order').find(o=>o.id===row.lineId) as Order|undefined;return !!order&&canRead(m,order);}),row=>canCreateOutsource(m)&&row.status!=='已取消');
 }else if(serviceModules.has(module)){
  const data=await feed('service-data',req,s,m,serviceWorkspaceGet);add('records',data.records,()=>data.canWrite===true,row=>module!=='shipment-followups'&&module!=='service-receivables'||row.type===(module==='shipment-followups'?'shipment':'receivable'));
 }else if(processModules.has(module)){
  const type=module!=='process-workspace'&&module.startsWith('process-')?module.slice(8):'';
  const data=await feed('process-data',req,s,m,processWorkspaceGet,type?{type}:{});add('records',data.records,row=>row.canEdit===true);
 }else if(module==='planning-control'){
  const data=await feed('planning-control-data',req,s,m,planningControlGet,{includeArchived:'true'});for(const collection of ['records','calculations','windows','allocations'])add(collection,data[collection],row=>row.canEdit===true||row.canProgress===true);
 }else if(module==='engineering-drawings'){
  const data=await feed('drawing-data',req,s,m,engineeringDrawingGet);add('records',data.records,row=>row.canEdit===true||row.canManage===true||row.canApprove===true);
 }else if(pendingModules.has(module)){
  // Snapshot source rows are immutable projections, not ordinary Entity records.
  // Resolve historical file rows through that exact snapshot's original API.
  const historical=targetRecordId.startsWith('kingdee_pending_snapshot_')?targetRecordId.split(':')[0]:'';
  const data=await feed('kingdee-pending-data',req,s,m,kingdeePendingGet,historical?{id:historical}:{}),source=data.snapshot;
  if(source){
   const headers=source.headers as string[],column=(row:Row,name:string)=>clean(row.values?.[headers.indexOf(name)]);
   for(const row of source.rows||[]){if(row.rowType!=='data')continue;
    const api=column(row,'来源类型')==='金蝶 API 新增',identity=api?[column(row,'金蝶账套 ID'),column(row,'金蝶单据 ID'),column(row,'金蝶行 ID')]:[source.id,row.sourceRow];
    if(api&&identity.some(value=>!value))continue;
    const recordId=api?'api:'+await sha(JSON.stringify(identity)):String(source.id)+':'+row.sourceRow;
    const values=headers.map((header,index)=>[header,row.values?.[index]]).filter(([,value])=>value!==''&&value!==null&&value!==undefined).sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
    const authorization=sourceIdentity(s,{id:recordId,kind:'purchase',customerOrder:column(row,'客户订单编号')});
    virtual('supplier-pending','rows',recordId,[column(row,'单据编号'),column(row,'商品名称'),column(row,'供应商'),'源行 '+row.sourceRow].filter(Boolean).join(' · '),{recordKind:'kingdee_pending_row_scope',scopeIdentity:JSON.stringify({identity,authorization,...(api?{}:{values})})},data.canImport===true);
   }
  }
  // These two pages also display the separately maintained historical purchase ledger.
  if(['supplier-followup','supplier-reconciliation'].includes(module)){
   const ledger=await feed('purchase-data',req,s,m,purchaseGet);const start=targets.length;add('rows',ledger.rows,()=>ledger.canEdit===true);for(const target of targets.slice(start)){target.module='purchase';target.label='历史采购台账 · '+target.label;}
  }
 }else if(purchaseModules.has(module)){
  const data=await feed('purchase-data',req,s,m,purchaseGet);add('rows',data.rows,()=>data.canEdit===true);
 }else if(module==='customer-quotes'){
  const data=await feed('customer-quotes',req,s,m,customerQuoteGet);add('quotes',data.quotes,row=>row.canEdit===true||row.canSupplementArchive===true);
 }else if(module==='ie-quotes'){
  const data=await feed('ie-quotes',req,s,m,(action,request,state,member)=>ieQuoteGet(action,new URL(request.url),state,member));add('quotes',data.quotes,()=>data.capabilities?.canCreate===true||data.capabilities?.canReview===true);
 }else if(module==='communications'||module==='mail'||module==='whatsapp'){
  const data=await feed('unified-communication-data',req,s,m,unifiedCommunicationGet);add('items',data.items,row=>row.canWrite===true,row=>module==='communications'||row.channel===(module==='mail'?'email':'whatsapp'));
 }else if(documentModules.has(module)){
  const data=await feed('handoff-business-data',req,s,m,handoffBusinessGet);add('items',data.items,(_row,raw)=>businessAccess(s,m,raw as any,true),row=>!documentTypes[module]||documentTypes[module].includes(row.type));
 }else if(module==='personal-tasks'){
  const data=await feed('project-collaboration-data',req,s,m,projectCollaborationGet);add('tasks',data.tasks,row=>row.canReply===true);
 }else if(module==='customer-followups'){
  const data=await feed('customer-project-followup-data',req,s,m,customerProjectFollowupGet);add('followups',data.followups,row=>row.canWrite===true);
 }else if(module==='customers'){
  add('customers',all(s,'customer_account').filter(row=>{try{workflowCustomer(s,m,row.id);return true;}catch{return false;}}),(row)=>workflowCapabilities(s,m,row as any).writeProfile);
 }else if(module==='payment-terms'){
  const data=await feed('payment-terms-data',req,s,m,paymentTermsGet);add('terms',data.terms,row=>!data.capabilities?.readOnly&&(data.capabilities?.authorize===true||data.capabilities?.create===true&&row.createdById===m.id));
 }else if(module==='ar-workspace'){
  const data=await feed('ar-workspace-data',req,s,m,arWorkspaceGet),seen=new Set<string>();
  for(const collection of ['receivables','receipts','shipments','pending'])for(const row of data[collection]||[]){
   // Use only the authorized AR projection. Its source ID grants no access to the
   // original project, receipt, source document, account or original attachment.
   const identity=JSON.stringify({sourceKind:row.sourceKind,sourceId:row.sourceId,canonicalKey:row.canonicalKey||'',customerId:row.customerId,teamId:row.teamId,duplicateSources:row.duplicateSources||[]});
   // A cash source may be allocated across several teams. Its authorized row ID
   // identifies that projection slice; do not collapse slices by sourceId.
   const recordId='ar_'+await sha(JSON.stringify([row.sourceKind,row.sourceId,row.id]));if(seen.has(recordId))continue;seen.add(recordId);
   const append=!data.scope?.readOnly&&(data.scope?.canConfigure===true||projectAccess(s,m,row.customerId).write||canVerifyProjectFinance(s,m,row.customerId));
   virtual('ar-workspace','sources',recordId,[row.customer,row.title,row.currency].filter(Boolean).join(' · '),{recordKind:'ar_projection_scope',customerId:row.customerId,projectId:row.projectId,orderId:row.orderId,scopeIdentity:identity},append);
  }
  const master=await optionalFeed('ar-master-data',req,s,m,arMasterLedgerGet,team?{teamId:team}:{}),invoice=await optionalFeed('ar-invoice-data',req,s,m,arInvoiceLedgerGet);
  for(const [collection,rows,write] of [['master',master?.rows,master?.canWrite],['invoices',invoice?.invoices,invoice?.canWrite]] as const)for(const row of rows||[]){
   const rowTeam=collection==='master'?row.teamId:arAttribution(s,row).teamId;if(team&&(team===ungroupedBusinessTeam?!!rowTeam:rowTeam!==team))continue;
   virtual('ar-workspace',collection,row.id,[row.customer||row.customerLabel,row.title||row.invoiceNo,collection==='master'?'应收总表':'历史发票'].filter(Boolean).join(' · '),{recordKind:'ar_registered_scope',customerId:row.customerId,scopeIdentity:JSON.stringify({id:row.id,kind:row.kind,customerId:row.customerId,teamId:rowTeam})},write===true);
  }
 }else if(module==='customer-price-archive'){
  for(const view of ['sku','history']){
   const data=await feed('customer-price-archive',req,s,m,customerPriceArchiveGet,{view});
   if(!data.canManageSelection)return {supported:true,notice:'价格档案原件及补充沟通沿用报价管理员权限；销售沟通可记录在客户项目的销售报价目录。',targets};
   for(const row of data.rows||[]){const recordId='price_'+await sha(String(row.id));virtual('customer-price-archive',view,recordId,[row.customerCode,row.product?.sku,row.product?.factoryModel,row.product?.customerModel,view==='sku'?'SKU 发票价格':'历史价格'].filter(Boolean).join(' · '),{recordKind:'customer_price_projection_scope',customerId:row.customerAccountId,scopeIdentity:JSON.stringify({customerAccountId:row.customerAccountId,sourceIdentity:row.id})},data.canManageSelection===true);}
  }
 }else if(module==='kingdee-sales'){
  const data=await feed('kingdee-sales-data',req,s,m,kingdeeSalesGet);add('drafts',data.drafts,row=>row.canPrepare===true||row.canConfirm===true);
 }else if(module==='imports'){
  add('imports',all(s,'import').filter(row=>broad(m)||row.actorId===m.id),()=>broad(m)||['clerk','sales'].includes(m.role));
 }else return {supported:false,notice:'此栏目尚未接入逐条记录的附件与沟通权限；请从相关客户项目、订单或业务记录留下跟进。',targets};
 return {supported:true,notice:'附件与沟通独立留存，不改变原业务单据、审核或财务状态。',targets};
}

export async function resolveBusinessFollowupTarget(req:Request,s:State,m:Member,key:FollowupTargetKey,write=false):Promise<ResolvedFollowupTarget>{
 const {module,collection,recordId,sectionKey}=key;
 if(sectionKey!=='record'&&!(module==='customer-projects'&&collection==='projects')&&!(module==='project-finance'&&collection==='projects'&&financialSections.has(sectionKey)))throw new AppError('此业务记录不支持所选栏目。');
 const financeSection=financialSections.has(sectionKey),catalogModule=module==='customer-projects'&&collection==='projects'&&financeSection?'project-finance':module;
 const data=await businessFollowupTargets(req,s,m,catalogModule,'',recordId),found=data.targets.find(t=>t.collection===collection&&t.recordId===recordId);
 if(!found)throw new AppError('业务记录不存在或不在当前授权范围内。',403);
 const result={...found,sectionKey};
 if(sectionKey!=='record'){
  if(sectionKey.startsWith('directory:')){
   const folder=sectionKey.slice(10);if(!projectFolders.includes(folder as typeof projectFolders[number]))throw new AppError('项目资料目录无效。');
   workflowFileAccess(s,m,{customerId:found.customerId,projectId:found.recordId,folder});
   try{workflowFileAccess(s,m,{customerId:found.customerId,projectId:found.recordId,folder},true);}catch{result.canAppend=false;}
   result.sectionLabel=folder;
  }else if(sectionKey.startsWith('tab:')&&Object.hasOwn(projectSections,sectionKey.slice(4))){
   const tab=sectionKey.slice(4);result.sectionLabel=projectSections[tab];
   if(tab==='quotes'){
    workflowFileAccess(s,m,{customerId:found.customerId,projectId:found.recordId,folder:'05_销售报价'});
    try{workflowFileAccess(s,m,{customerId:found.customerId,projectId:found.recordId,folder:'05_销售报价'},true);}catch{result.canAppend=false;}
   }
  }else throw new AppError('项目跟进栏目无效。');
 }
 if(write&&!result.canAppend)throw new AppError('当前记录仅可查看，不能新增附件或沟通。',403);
 return result;
}
