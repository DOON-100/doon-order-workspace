import {ApiClient} from './client.js';
import {StateStore} from './state.js';
import {CliError} from './errors.js';
import {collection,object,pick,fields,identifier,pagination,page,find,failResponse,type Row} from './business.js';
import type {Route} from './routes.js';

export type OperationResource='reports'|'finished'|'quality'|'packaging'|'releases'|'shipments';
export type OperationAction='list'|'show'|'history';
export type OperationOptions={team?:string;order?:string;customer?:string;type?:string;search?:string;limit?:string;offset?:string};
const qualityTypes=['iqc','first-article','process-quality','outsourcing-quality','oqc'];
const reportFields=fields('id version lineId orderNo drawing color lens workOrder task process batch startedAt reportedAt quantity approval nativeId identityType source updatedAt updatedBy');
const finishedFields=fields('id version lineId orderVersion supplierId supplierName orderNo drawing color lens productType quantity unit businessType baselineStatus template dueDate promisedDate baselineStock baselineStockReturned acceptedAt acceptedDate closedAt createdAt updatedAt status stocked remaining normalDispatched inTransit pendingInspection pendingStock openRework');
const processFields=fields('id version type customerId orderId teamId title batch ownerId responsibleId plannedDate actualDate status inputBasis inputVersion outputEvidence gateStatus blocker nextAction nextOwnerId nextDueDate notes createdAt updatedAt updatedBy canEdit');
const serviceFields=fields('id version type customerId orderId teamId ownerId title description status waitingFor dueDate nextFollowUp createdAt updatedAt updatedBy');
const detailFields=fields('gateReason documentRef inspectedQuantity acceptedQuantity rejectedQuantity inspectionRef processName supplierName lotNo quantity cartons packingSpec packingListRef logisticsRef releaseRef');
export class OperationsService {
 constructor(private store:StateStore,private transport:typeof fetch=fetch){}
 async execute(resource:OperationResource,action:OperationAction,options:OperationOptions={},rawId?:string){
  const allowed={reports:['list','show'],finished:['list','show','history'],quality:['list','show','history'],packaging:['list','show','history'],releases:['list','show','history'],shipments:['list','show','history']};
  if(!Object.hasOwn(allowed,resource)||!allowed[resource].includes(action))throw new CliError('UNSUPPORTED_OPERATION','该业务命令尚未开放。',2);
  const team=identifier(options.team,'业务组'),order=identifier(options.order,'订单明细'),customer=identifier(options.customer,'客户'),id=identifier(rawId,'记录',action!=='list'),window=pagination(options),search=options.search?.trim()||'';
  if(search.length>200||/[\u0000-\u001f\u007f]/.test(search)||action!=='list'&&search)throw new CliError('INVALID_ARGUMENT','搜索仅用于列表，最多200个字符。',2);
  if(resource==='quality'&&!qualityTypes.includes(options.type||''))throw new CliError('INVALID_ARGUMENT','质检类型须为 iqc、first-article、process-quality、outsourcing-quality 或 oqc。',2);
  if(resource!=='quality'&&options.type||customer&&['reports','finished'].includes(resource))throw new CliError('INVALID_ARGUMENT','筛选参数与此资源不匹配。',2);
  const type=resource==='quality'?options.type!:resource==='packaging'?'packaging':resource==='releases'?'shipment-release':resource==='shipments'?'shipment':null;
  const scope={teamId:team||null,orderId:order||null,customerId:customer||null,type,search:search||null,pagination:'client',authorization:'current-server-permissions',teamFilter:team?'server-list-guard':'all-authorized'};
  const config=await this.store.config(),saved=await this.store.session(config);if(!saved)throw new CliError('AUTH_REQUIRED','请先运行 doon login。',4);
  const api=new ApiClient(config,this.transport,30000);
  const read=async(route:Route,query?:Record<string,string>)=>{try{const data=(await api.request(route,saved,undefined,{team,query})).data;if(team&&['/api/workspace/data','/api/workspace/finished-supplier-data','/api/workspace/service-data','/api/workspace/process-data'].includes(route)&&data?.businessTeamScope?.teamId!==team)throw new CliError('SCOPE_NOT_CONFIRMED','服务器未确认所选业务组范围。',5);return data;}catch(e){if(e instanceof CliError&&e.code==='AUTH_REQUIRED')await this.store.clearSession();throw e;}};
  const isProcess=['quality','packaging','releases'].includes(resource);
  const route=resource==='reports'?'/api/workspace/data':resource==='finished'?'/api/workspace/finished-supplier-data':resource==='shipments'?'/api/workspace/service-data':'/api/workspace/process-data';
  const data=await read(route,isProcess?{type:type!}:undefined),key=resource==='reports'?'reports':resource==='finished'?'tasks':'records';
  let all=collection(data,key);if(isProcess&&all.some(r=>r.type!==type))return failResponse();if(resource==='shipments')all=all.filter(r=>r.type==='shipment');
  const rows=all.filter(r=>(!customer||r.customerId===customer)&&(!order||r[['reports','finished'].includes(resource)?'lineId':'orderId']===order)&&(!search||['id','orderNo','title','status','process','supplierName','reference'].some(k=>typeof r[k]==='string'&&r[k].toLocaleLowerCase().includes(search.toLocaleLowerCase()))));
  const keys=resource==='reports'?reportFields:resource==='finished'?finishedFields:resource==='shipments'?serviceFields:processFields;
  const project=(r:Row)=>resource==='shipments'?{...pick(r,keys),details:pick(r.details,fields('invoiceNo quantity shipDate carrier trackingNo packingNote'))}:isProcess?{...pick(r,keys),details:pick(r.details||{},detailFields)}:pick(r,keys);
  if(action==='list')return {scope,page:page(rows.map(project),window)};
  const record=find(rows,id!);
  if(resource==='finished'){
   if(!Array.isArray(record.stages))return failResponse();
   if(action==='history')return {scope,taskId:id,page:page(collection(data,'events').filter(r=>r.taskId===id).map(r=>pick(r,fields('id taskId action date note actor actorType createdAt'))),window),projection:'event-summary'};
   const related=(key:string,fieldList:string)=>page(collection(data,key).filter(r=>r.taskId===id).map(r=>pick(r,fields(fieldList))),window);
   return {scope,record:project(record),stages:page(record.stages.map((r:Row)=>pick(r,fields('id label baseline completed'))),window),shipments:related('shipments','id taskId reference quantity date expectedDate reworkId source received accepted rejected stocked returned status'),reworks:related('reworks','id taskId reference quantity date sourceShipmentId parentId source confirmedAt confirmedDate shipped accepted stocked transferred status')};
  }
  if(action==='show')return {scope,record:project(record)};
  const history=collection(await read(resource==='shipments'?'/api/workspace/service-history':'/api/workspace/process-history',{id:id!}),'history');
  for(const row of history){const snapshot=object(row.snapshot);if(row.recordId!==id||snapshot.id!==id||snapshot.type!==type||snapshot.customerId!==record.customerId||snapshot.orderId!==record.orderId||snapshot.version!==row.version)return failResponse();}
  return {scope,recordId:id,projection:'history-summary-without-raw-snapshots',page:page(history.map(r=>pick(r,fields('id version action actor createdAt'))),window)};
 }
}
