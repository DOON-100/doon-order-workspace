import {ApiClient} from './client.js';
import {StateStore} from './state.js';
import {CliError} from './errors.js';
import {collection, object, pick, fields, identifier, pagination, page, find, failResponse, type Row} from './business.js';
import type {Route} from './routes.js';

export type EngineeringResource = 'drawings'|'sops'|'samples'|'ie-quotes';
export type EngineeringAction = 'list'|'show'|'history'|'version';
export type EngineeringOptions = {team?:string;customer?:string;project?:string;search?:string;limit?:string;offset?:string};
const drawingFields=fields('id version customerId customerCode drawingType requestedDate newCount revisionCount requester modelNo drawingNotes assigneeId assignee deadline completedDate approval status upstreamDepartment priority requirement downstream deliveredDate deliveryNote legacyNeedsReview approvalNote approvalBy approvalAt createdAt updatedAt updatedBy canEdit canManage canApprove');
const sopFields=fields('id version drawingRecordId customerId modelNo targetVersion currentVersion status mode requirement isCurrent predecessorId sourceEventId preparedVersion targetNote confirmationNote confirmedBy confirmedAt createdAt updatedAt updatedBy canManage canApprove canInstruct');
const sampleFields=fields('id version projectId customerId roundId sampleNo purpose ownerId requiredDate plannedDate promisedDate promiseNote status note canExecute canCommunicate createdAt updatedAt updatedBy');
const quoteFields=fields('id version revision customerAccountId customerName customerCode quoteNo quoteDate validUntil batchId exchangeRateCnyPerUsd exchangeRateDate exchangeRateSource notes status policyVersion requiredReviewMemberId createdAt createdBy updatedAt updatedBy submittedAt submittedBy reviewedAt reviewedBy reviewReason canEdit canSubmit canReview canRevise canExport canHandoff issues');
export class EngineeringService {
  constructor(private store:StateStore,private transport:typeof fetch=fetch){}
  async execute(resource:EngineeringResource,action:EngineeringAction,options:EngineeringOptions={},rawId?:string,rawVersion?:string){
    const allowed={drawings:['list','show','history'],sops:['list','show','history'],samples:['list','show'],'ie-quotes':['list','show','history','version']};
    if(!Object.hasOwn(allowed,resource)||!allowed[resource].includes(action))throw new CliError('UNSUPPORTED_OPERATION','该业务命令尚未开放。',2);
    const team=identifier(options.team,'业务组'),customer=identifier(options.customer,'客户'),project=identifier(options.project,'项目'),id=identifier(rawId,'记录',action!=='list'),window=pagination(options),search=options.search?.trim()||'';
    if(resource==='ie-quotes'&&team)throw new CliError('INVALID_ARGUMENT','工程报价接口暂不支持可靠业务组筛选，请按授权客户查询。',2);
    if(project&&resource!=='samples')throw new CliError('INVALID_ARGUMENT','项目筛选仅用于样品。',2);
    if(search.length>200||/[\u0000-\u001f\u007f]/.test(search)||action!=='list'&&search)throw new CliError('INVALID_ARGUMENT','搜索仅用于列表，最多200个字符。',2);
    if(action==='version'&&(!rawVersion||!/^[1-9]\d*$/.test(rawVersion)||!Number.isSafeInteger(Number(rawVersion))))throw new CliError('INVALID_ARGUMENT','版本须为正整数。',2);
    const scope={teamId:team||null,customerId:customer||null,projectId:project||null,search:search||null,pagination:'client',authorization:'current-server-permissions',teamFilter:resource==='ie-quotes'?'not-supported':team?'server-list-guard':'all-authorized'};
    const config=await this.store.config(),saved=await this.store.session(config);if(!saved)throw new CliError('AUTH_REQUIRED','请先运行 doon login。',4);
    const api=new ApiClient(config,this.transport,30000);
    const read=async(route:Route,query?:Record<string,string>)=>{try{const data=(await api.request(route,saved,undefined,{team,query})).data;if(team&&['/api/workspace/drawing-data','/api/workspace/sop-data','/api/workspace/customer-project-data'].includes(route)&&data?.businessTeamScope?.teamId!==team)throw new CliError('SCOPE_NOT_CONFIRMED','服务器未确认所选业务组范围。',5);return data;}catch(e){if(e instanceof CliError&&e.code==='AUTH_REQUIRED')await this.store.clearSession();throw e;}};
    const route=resource==='drawings'?'/api/workspace/drawing-data':resource==='sops'?'/api/workspace/sop-data':resource==='samples'?'/api/workspace/customer-project-data':'/api/workspace/ie-quotes';
    const data=await read(route),key=resource==='samples'?'samples':resource==='ie-quotes'?'quotes':'records';
    const rows=collection(data,key).filter(r=>(!customer||r[resource==='ie-quotes'?'customerAccountId':'customerId']===customer)&&(!project||r.projectId===project)&&(!search||['id','modelNo','sampleNo','quoteNo','customerName','status'].some(k=>typeof r[k]==='string'&&r[k].toLocaleLowerCase().includes(search.toLocaleLowerCase()))));
    const keys=resource==='drawings'?drawingFields:resource==='sops'?sopFields:resource==='samples'?sampleFields:quoteFields;
    if(action==='list')return {scope,page:page(rows.map(r=>pick(r,keys)),window)};
    const current=find(rows,id!);
    if(resource==='samples'){
      if(!Array.isArray(current.scope))return failResponse();
      return {scope,record:pick(current,[...keys,...fields('drawingIds')]),items:page(current.scope.map((r:Row)=>pick(r,fields('itemId quantity'))),window),projection:'sample-summary-without-internal-snapshots'};
    }
    if(resource==='ie-quotes'){
      if(action==='history'){
        if(!Array.isArray(current.history))return failResponse();
        return {scope,quoteId:id,page:page(current.history.map((r:Row)=>pick(r,fields('version revision action updatedAt updatedBy status'))),window)};
      }
      const selected=action==='version'?object((await read('/api/workspace/ie-quote',{id:id!,version:rawVersion!})).quote):current;
      if(selected.id!==id||selected.customerAccountId!==current.customerAccountId||action==='version'&&selected.version!==Number(rawVersion))return failResponse();
      const lines=collection(selected,'lines').map(l=>({...pick(l,fields('id model customerModel color drawingNo drawingRevision quantityMin quantityMax structureNotes scopeNotes')),
        materials:collection(l,'materials').map(x=>pick(x,fields('id name specification unit basePrice usage coefficient lossRate lossAdjustmentReason notApplicable notes priceSource'))),
        processes:collection(l,'processes').map(x=>pick(x,fields('id name parentId sequence standardSeconds basePrice difficulty notApplicable notes priceSource'))),
        outsourcing:collection(l,'outsourcing').map(x=>pick(x,fields('id category name unitPrice notApplicable notes priceSource')))}));
      const costs=object(selected.costs);
      return {scope,projection:'server-authorized-engineering-costs',record:pick(selected,quoteFields),lines:page(lines,window),costs:{...pick(costs,fields('formulaVersion materialLossRate factoryMultiplier toolingChargeCny')),lines:page(collection({lines:costs.lines?.map((r:Row)=>({...r,id:r.lineId}))},'lines').map(r=>pick(r,fields('lineId material materialLoss process plating outsourcing indirect productionCost factoryPriceCny factoryPriceUsd'))),window)},tooling:page(collection(selected,'tooling').map(x=>pick(x,fields('id toolingId name lineIds amount chargeMode chargeQuoteId chargeVersion evidence notes'))),window)};
    }
    if(action==='show')return {scope,record:pick(current,keys),projection:'business-fields-without-raw-sources'};
    const history=collection(await read(resource==='drawings'?'/api/workspace/drawing-history':'/api/workspace/sop-history',{id:id!}),'history');
    for(const row of history){const snapshot=object(row.snapshot);if((resource==='drawings'?row.recordId:row.sopId)!==id||snapshot.id!==id||snapshot.customerId!==current.customerId||snapshot.version!==row.version) return failResponse();}
    return {scope,recordId:id,projection:'history-summary-without-raw-snapshots',page:page(history.map(r=>pick(r,fields('id version action actor createdAt'))),window)};
  }
}
