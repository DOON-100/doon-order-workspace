import {ApiClient} from './client.js';
import {StateStore} from './state.js';
import {CliError} from './errors.js';
import {collection,object,pick,fields,identifier,pagination,page,find,failResponse,type Row} from './business.js';
import type {Route} from './routes.js';

export type FinanceResource='records'|'receivables'|'reconciliations'|'complaints';
export type FinanceAction='list'|'show'|'history';
export type FinanceOptions={team?:string;customer?:string;project?:string;kind?:string;search?:string;limit?:string;offset?:string};
export const financeKinds=['charges','receipts','allocations','adjustments','creditApplications','documents','notices','cases','costs','refunds','requirements','sends','reversals'] as const;
const financeFields=fields('id kind version customerId customerName customerCode projectId roundId orderId title category type status currency amountCents prepayCents availableCents refundedCents remainingCents budgetCents actualCents manualAmountCents date dueDate reference note reason description documentType documentNo chargeId chargeIds adjustmentIds receiptId caseId sourceChargeId targetChargeId entryType originalId mode evidence independent reversed bearer supplierReference quantity resolution ownerMemberId shipmentReference returnedQuantity completedQuantity resentQuantity trackingNo customerAccepted customerEvidence executionNote createdAt createdBy updatedAt updatedBy');
const serviceFields=fields('id version type customerId orderId teamId ownerId title description status waitingFor dueDate nextFollowUp receivedCents balanceCents createdAt updatedAt updatedBy');
const processFields=fields('id version type customerId orderId teamId title ownerId responsibleId plannedDate actualDate status gateStatus blocker nextAction nextOwnerId nextDueDate notes createdAt updatedAt updatedBy');
export class FinanceService {
 constructor(private store:StateStore,private transport:typeof fetch=fetch){}
 async execute(resource:FinanceResource,action:FinanceAction,options:FinanceOptions={},rawId?:string){
  if(!['records','receivables','reconciliations','complaints'].includes(resource)||!['list','show','history'].includes(action))throw new CliError('UNSUPPORTED_OPERATION','该业务命令尚未开放。',2);
  const team=identifier(options.team,'业务组'),customer=identifier(options.customer,'客户'),project=identifier(options.project,'项目'),id=identifier(rawId,'记录',action!=='list'),window=pagination(options),search=options.search?.trim()||'';
  if(search.length>200||/[\u0000-\u001f\u007f]/.test(search)||action!=='list'&&search)throw new CliError('INVALID_ARGUMENT','搜索仅用于列表，最多200个字符。',2);
  if(resource==='records'&&!financeKinds.includes(options.kind as typeof financeKinds[number])||resource!=='records'&&(options.kind||project))throw new CliError('INVALID_ARGUMENT','财务记录须指定支持的类型，项目筛选仅适用于项目财务。',2);
  const type=resource==='reconciliations'?'supplier-reconciliation':resource==='complaints'?'complaint':resource==='receivables'?'receivable':options.kind!;
  const scope={teamId:team||null,customerId:customer||null,projectId:project||null,type,search:search||null,pagination:'client',authorization:'current-server-permissions',teamFilter:team?'server-list-guard':'all-authorized'};
  const config=await this.store.config(),saved=await this.store.session(config);if(!saved)throw new CliError('AUTH_REQUIRED','请先运行 doon login。',4);
  const api=new ApiClient(config,this.transport,30000);
  const read=async(route:Route,query?:Record<string,string>)=>{try{const data=(await api.request(route,saved,undefined,{team,query})).data;if(team&&['/api/workspace/project-finance-data','/api/workspace/service-data','/api/workspace/process-data'].includes(route)&&data?.businessTeamScope?.teamId!==team)throw new CliError('SCOPE_NOT_CONFIRMED','服务器未确认所选业务组范围。',5);return data;}catch(e){if(e instanceof CliError&&e.code==='AUTH_REQUIRED')await this.store.clearSession();throw e;}};
  const process=['reconciliations','complaints'].includes(resource),route=resource==='records'?'/api/workspace/project-finance-data':resource==='receivables'?'/api/workspace/service-data':'/api/workspace/process-data';
  const data=await read(route,process?{type}:undefined),key=resource==='records'?options.kind!:'records';let all=collection(data,key);
  if(process&&all.some(r=>r.type!==type))return failResponse();if(resource==='receivables')all=all.filter(r=>r.type==='receivable');
  const rows=all.filter(r=>(!customer||r.customerId===customer)&&(!project||r.projectId===project)&&(!search||['id','title','customerName','documentNo','reference','status','category'].some(k=>typeof r[k]==='string'&&r[k].toLocaleLowerCase().includes(search.toLocaleLowerCase()))));
  const projectRow=(r:Row)=>resource==='records'?{...pick(r,financeFields),...(r.net?{net:pick(r.net,fields('amountCents prepayCents receivedCents balanceCents'))}:{})}:resource==='receivables'?{...pick(r,serviceFields),details:pick(r.details,fields('invoiceNo currency amountCents amount terms'))}:{...pick(r,processFields),details:pick(r.details||{},fields('gateReason documentRef supplierName statementRef invoiceRef currency amount complaintRef cause correction verification customerConfirmation'))};
  if(action==='list')return {scope,amountUnit:'cents-where-suffixed',page:page(rows.map(projectRow),window)};
  const record=find(rows,id!);if(action==='show'){
   const schedule=resource==='records'&&options.kind==='charges'&&Array.isArray(record.plan)?page(record.plan.map((r:Row)=>pick(r,fields('title amountCents dueDate beforeOrder'))),window):undefined;
   const lines=resource==='records'&&options.kind==='documents'&&Array.isArray(record.lines)?page(record.lines.map((r:Row)=>({...pick(r,fields('chargeId projectId roundId title currency amountCents prepayCents receivedCents balanceCents creditCents')),...(Array.isArray(r.plan)?{plan:r.plan.map((p:Row)=>pick(p,fields('title amountCents dueDate beforeOrder')))}:{})})),window):undefined;
   return {scope,amountUnit:'cents-where-suffixed',record:projectRow(record),...(schedule?{schedule}:{}),...(lines?{lines}:{}),projection:'financial-fields-without-bank-account-or-raw-snapshots'};
  }
  const history=collection(await read(resource==='records'?'/api/workspace/project-finance-history':resource==='receivables'?'/api/workspace/service-history':'/api/workspace/process-history',{id:id!}),'history');
  for(const row of history){const snapshot=object(resource==='records'?row.after:row.snapshot);if((resource==='records'?row.targetId:row.recordId)!==id||snapshot.id!==id||snapshot.customerId!==record.customerId||resource==='records'&&snapshot.kind!==record.kind||resource!=='records'&&(snapshot.type!==type||snapshot.orderId!==record.orderId||snapshot.version!==row.version)||(team||project)&&(snapshot.projectId||'')!==(record.projectId||'')||team&&(snapshot.teamId||'')!==(record.teamId||''))return failResponse();}
  return {scope,recordId:id,projection:'history-summary-without-raw-snapshots',page:page(history.map(r=>pick(r,fields('id version action actor createdAt'))),window)};
 }
}
