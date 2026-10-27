import {ApiClient} from './client.js';
import {StateStore} from './state.js';
import {CliError} from './errors.js';
import {collection, pick, fields, identifier, pagination, page, find, failResponse} from './business.js';
import type {Route} from './routes.js';

export type PlanningResource='rounds'|'purchases'|'outsource'|'factory-orders';
export type PlanningAction='list'|'show'|'history';
export type PlanningOptions={team?:string;order?:string;scope?:string;search?:string;limit?:string;offset?:string};
const purchaseFields=fields('id version sourceVersion po supplier buyer itemCode itemName unit quantity orderDate dueDate customerOrder auditStatus closeStatus sourceNote sourceRow sourceAsOf sourceFile sourceSheet promisedDate expectedDate nextFollowupDate followupNote balanceKnown received returnPending lifecycle completedDate archivedAt archivedBy');
const outsourceFields=fields('id version lineId supplier process quantity sentDate dueDate originalDueDate reference note latestNote received approvalStatus approverName approvedBy approvedAt actor createdAt');
const factoryFields=fields('id version lineId priorId sourceEnglish chineseProcess materialSpec platingSpec lensSpec materialImageConfirmed status serviceConfirmedBy serviceConfirmedAt pmcConfirmedBy pmcConfirmedAt releasedBy releasedAt createdAt createdBy');
const roundFields=fields('id actorId actor lineIds createdAt lastLineId scope productionScope');
export class PlanningService {
 constructor(private store:StateStore,private transport:typeof fetch=fetch){}
 async execute(resource:PlanningResource,action:PlanningAction,options:PlanningOptions={},rawId?:string){
  const allowed={rounds:['list','show'],purchases:['list','show','history'],outsource:['list','show'],'factory-orders':['list','show']};
  if(!Object.hasOwn(allowed,resource)||!allowed[resource].includes(action))throw new CliError('UNSUPPORTED_OPERATION','该业务命令尚未开放。',2);
  const team=identifier(options.team,'业务组'),order=identifier(options.order,'订单明细'),id=identifier(rawId,'记录',action!=='list'),window=pagination(options),search=options.search?.trim()||'';
  if(search.length>200||/[\u0000-\u001f\u007f]/.test(search)||action!=='list'&&search)throw new CliError('INVALID_ARGUMENT','搜索仅用于列表，最多200个字符。',2);
  if(options.scope&&resource!=='rounds'||options.scope&&!['internal','external'].includes(options.scope))throw new CliError('INVALID_ARGUMENT','生产范围仅支持 internal 或 external 核对轮次。',2);
  if(order&&!['outsource','factory-orders'].includes(resource))throw new CliError('INVALID_ARGUMENT','订单明细筛选仅用于外协和工厂内部订单。',2);
  const productionScope=resource==='rounds'?options.scope||'internal':null,scope={teamId:team||null,orderId:order||null,productionScope,search:search||null,pagination:'client',authorization:'current-server-permissions',teamFilter:team?'server-list-guard':'all-authorized'};
  const config=await this.store.config(),saved=await this.store.session(config);if(!saved)throw new CliError('AUTH_REQUIRED','请先运行 doon login。',4);
  const api=new ApiClient(config,this.transport,30000);
  const read=async(route:Route,query?:Record<string,string>)=>{try{const data=(await api.request(route,saved,undefined,{team,query})).data;if(team&&['/api/workspace/data','/api/workspace/pmc-data','/api/workspace/purchase-data','/api/workspace/factory-orders'].includes(route)&&data?.businessTeamScope?.teamId!==team)throw new CliError('SCOPE_NOT_CONFIRMED','服务器未确认所选业务组范围。',5);return data;}catch(e){if(e instanceof CliError&&e.code==='AUTH_REQUIRED')await this.store.clearSession();throw e;}};
  const route=resource==='rounds'?'/api/workspace/pmc-data':resource==='purchases'?'/api/workspace/purchase-data':resource==='outsource'?'/api/workspace/data':'/api/workspace/factory-orders';
  const data=await read(route,resource==='rounds'?{scope:productionScope!}:undefined),key=resource==='rounds'?'rounds':resource==='purchases'?'rows':resource==='outsource'?'outsource':'items';
  const rows=collection(data,key).filter(r=>(!order||r.lineId===order)&&(!search||['id','po','supplier','buyer','itemCode','itemName','customerOrder','reference','process','actor','status'].some(k=>typeof r[k]==='string'&&r[k].toLocaleLowerCase().includes(search.toLocaleLowerCase()))));
  const keys=resource==='rounds'?roundFields:resource==='purchases'?purchaseFields:resource==='outsource'?outsourceFields:factoryFields;
  const project=(r:Record<string,any>)=>resource==='purchases'?{...pick(r,keys),received:r.balanceKnown===true?r.received:null,returnPending:r.balanceKnown===true?r.returnPending:null}:pick(r,keys);
  if(action==='list')return {scope,page:page(rows.map(project),window)};
  const record=find(rows,id!);
  if(resource==='rounds')return {scope,record:pick(record,keys),reviews:page(collection(data,'reviews').filter(r=>r.roundId===id).map(r=>pick(r,fields('id roundId lineId orderVersion status note actor updatedAt'))),window)};
  if(resource==='purchases'&&action==='history'){
   const history=await read('/api/workspace/purchase-history',{id:id!}),events=collection(history,'events');
   if(events.some(r=>r.purchaseId!==id))return failResponse();
   return {scope,purchaseId:id,events:page(events.map(r=>pick(r,fields('id purchaseId version type quantity returnPending date reference note actor createdAt event'))),window),edits:page(collection(history,'edits').map(r=>pick(r,fields('id action actor createdAt source'))),window),editsLimit:'server-last-50'};
  }
  return {scope,projection:'business-fields-without-raw-import-or-storage-keys',record:project(record)};
 }
}
