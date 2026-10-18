import {z} from 'zod';
import {all,canRead,clean,strictDate,type CustomerAccount,type Entity,type Member,type Order,type State} from './domain';
import {assignedServiceCustomer,serviceOrderCustomerKeys} from './service-workspace';
import {paymentTermsReadOnly} from './payment-terms';
import {readableCustomerQuoteAccounts} from './customer-quote-access';
import {drawingCustomers} from './engineering-drawings';
import {canVerifyProjectFinance} from './customer-project-finance';
import {canSeeSupplierPrice} from './suppliers';

export const processKinds=['rfq','sample','engineering-change','iqc','material-kit','warehouse','first-article','process-quality','outsourcing-quality','oqc','packaging','shipment-release','supplier-reconciliation','complaint'] as const;
export type ProcessKind=typeof processKinds[number];
export const processKindLabels:Record<ProcessKind,string>={rfq:'询价与需求评估',sample:'样品与签样', 'engineering-change':'工程变更',iqc:'来料检验','material-kit':'配套齐料',warehouse:'仓库流转','first-article':'首件确认','process-quality':'过程检验','outsourcing-quality':'外协检验',oqc:'成品检验',packaging:'包装核对','shipment-release':'出货放行记录','supplier-reconciliation':'供应商对账',complaint:'客诉与复盘'};
export const processStatuses=['待处理','进行中','受阻','待核实','已完成','已取消'] as const;
export const processGateStatuses=['待核实','待检','通过','不通过','不适用'] as const;
export type ProcessDetailField={key:string;label:string;type:'text'|'number'};
const detail=(key:string,label:string,type:'text'|'number'='text'):ProcessDetailField=>({key,label,type});
const common=[detail('gateReason','不适用或关口判断依据'),detail('documentRef','单据引用')];
const inspection=[detail('inspectedQuantity','检验数量','number'),detail('acceptedQuantity','合格数量','number'),detail('rejectedQuantity','不良数量','number'),detail('inspectionRef','检验单引用'),detail('processName','工序名称')];
export const processDetailFields:Record<ProcessKind,ProcessDetailField[]>={
 rfq:[...common,detail('requirement','客户要求'),detail('targetDelivery','期望交期'),detail('quantity','需求数量','number'),detail('currency','币种'),detail('quoteRef','报价引用')],
 sample:[...common,detail('sampleVersion','样品版本'),detail('sampleQuantity','样品数量','number'),detail('sampleResult','样品结果'),detail('signoffRef','签样凭证')],
 'engineering-change':[...common,detail('previousVersion','原版本'),detail('newVersion','新版本'),detail('changeReason','变更原因'),detail('impactScope','影响范围'),detail('approvalRef','审批引用')],
 iqc:[...common,...inspection,detail('supplierName','供应商'),detail('lotNo','来料批次')],
 'material-kit':[...common,detail('requiredQuantity','需求数量','number'),detail('readyQuantity','齐套数量','number'),detail('shortageNote','缺料事项'),detail('materialListRef','配料清单引用')],
 warehouse:[...common,detail('movementType','流转类型'),detail('quantity','流转数量','number'),detail('warehouseName','仓库名称'),detail('sourceDocumentRef','出入库单引用')],
 'first-article':[...common,...inspection], 'process-quality':[...common,...inspection],
 'outsourcing-quality':[...common,...inspection,detail('supplierName','供应商'),detail('lotNo','外协批次')], oqc:[...common,...inspection],
 packaging:[...common,detail('quantity','包装数量','number'),detail('cartons','箱数','number'),detail('packingSpec','包装要求版本'),detail('packingListRef','装箱单引用')],
 'shipment-release':[...common,detail('quantity','出货数量','number'),detail('logisticsRef','物流凭证'),detail('releaseRef','实际放行单引用')],
 'supplier-reconciliation':[...common,detail('supplierName','供应商'),detail('statementRef','对账单引用'),detail('invoiceRef','发票引用'),detail('currency','币种'),detail('amount','对账金额','number')],
 complaint:[...common,detail('complaintRef','客诉引用'),detail('cause','原因'),detail('correction','纠正措施'),detail('verification','验证结果'),detail('customerConfirmation','客户确认')],
};
const text=(max=3000)=>z.string().trim().max(max).default('');
const day=z.string().trim().default('').superRefine((value,ctx)=>{if(!value)return;try{if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||strictDate(value)!==value)throw new Error();}catch{ctx.addIssue({code:z.ZodIssueCode.custom,message:'请使用有效日期 YYYY-MM-DD'});}});
export const processSaveSchema=z.object({
 id:z.string().trim().min(1).max(160).optional(),version:z.number().int().positive().optional(),token:z.string().trim().min(8).max(160).optional(),
 type:z.enum(processKinds),customerId:text(160),orderId:text(160),teamId:text(160),title:z.string().trim().min(1,'请填写事项名称').max(240),
 batch:text(160),ownerId:text(160),responsibleId:text(160),plannedDate:day,actualDate:day,status:z.enum(processStatuses).default('待处理'),
 inputBasis:text(6000),inputVersion:text(240),outputEvidence:text(6000),gateStatus:z.enum(processGateStatuses).default('待核实'),
 blocker:text(6000),nextAction:text(3000),nextOwnerId:text(160),nextDueDate:day,notes:text(6000),details:z.record(z.unknown()).default({}),
}).strict();
export type ProcessFields=Omit<z.output<typeof processSaveSchema>,'id'|'version'|'token'|'details'>&{details:Record<string,string|number>};
export type ProcessRecord=Entity&ProcessFields&{kind:'process_record';version:number;createdAt:string;createdById:string;updatedAt:string;updatedById:string;updatedBy:string};
export type ProcessRevision=Entity&{kind:'process_record_revision';recordId:string;customerId:string;orderId:string;teamId:string;version:number;action:string;actorId:string;actor:string;createdAt:string;snapshot:ProcessRecord;requestToken?:string;requestFingerprint?:string};
// State is an immutable request snapshot. Avoid recomputing the entire original
// customer directory for each visible workflow row and each assigned member.
const customerScopeCache=new WeakMap<State,WeakMap<Member,CustomerAccount[]>>();
const identityCache=new WeakMap<State,Map<string,string[]>>();
function customerOrderKeys(s:State,account:CustomerAccount){
 let cache=identityCache.get(s);if(!cache){cache=new Map();identityCache.set(s,cache);}
 let keys=cache.get(account.id);if(!keys){keys=serviceOrderCustomerKeys(s,account);cache.set(account.id,keys);}return keys;
}

export function processDetailsSchema(type:ProcessKind){
 const shape:Record<string,z.ZodTypeAny>={};
 for(const field of processDetailFields[type])shape[field.key]=field.type==='number'
  ?(field.key==='amount'?z.number().finite().nonnegative().max(1000000000).refine(value=>Math.abs(value*100-Math.round(value*100))<0.000001,'金额最多两位小数'):z.number().int().min(0).max(10000000)).optional()
  :text(field.key==='currency'?12:3000);
 return z.object(shape).strict();
}
export function processCustomerAccounts(s:State,m:Member):CustomerAccount[]{
 if(!m.active||m.role==='supplier')return [];
 let cache=customerScopeCache.get(s);if(!cache){cache=new WeakMap();customerScopeCache.set(s,cache);}
 const cached=cache.get(m);if(cached)return cached;
 // Reuse the same source authorization helpers as the business-team directory.
 // Keep this shared module browser-safe; request-team enforcement lives in the API.
 const accounts=all(s,'customer_account') as CustomerAccount[];
 const ids=new Set([...readableCustomerQuoteAccounts(s,m),...drawingCustomers(s,m)].map(row=>row.id));
 for(const account of accounts)if(assignedServiceCustomer(s,m,account)||canVerifyProjectFinance(s,m,account.id))ids.add(account.id);
 const orderKeys=new Set((all(s,'order') as Order[]).filter(order=>canRead(m,order)).map(order=>clean(order.customer).toLowerCase()));
 for(const account of accounts)if(customerOrderKeys(s,account).some(key=>orderKeys.has(key.toLowerCase())))ids.add(account.id);
 const result=accounts.filter(account=>ids.has(account.id));cache.set(m,result);return result;
}
export function processOrderMatchesCustomer(s:State,order:Order,account:CustomerAccount){
 return customerOrderKeys(s,account).some(key=>key.toLowerCase()===clean(order.customer).toLowerCase());
}
/** Directory membership inferred from one order is not a customer-wide grant. */
export function canReadProcessCustomer(s:State,m:Member,account:CustomerAccount,type:ProcessKind){
 if(!m.active||m.role==='supplier')return false;
 if(m.role==='admin'||assignedServiceCustomer(s,m,account))return true;
 // Match the existing exact customer scope; never infer it from order ownership.
 if(customerOrderKeys(s,account).some(key=>m.customers.includes(key)))return true;
 if(type==='rfq'&&readableCustomerQuoteAccounts(s,m).some(row=>row.id===account.id))return true;
 if(['sample','engineering-change'].includes(type)&&drawingCustomers(s,m).some(row=>row.id===account.id))return true;
 return type==='supplier-reconciliation'&&canVerifyProjectFinance(s,m,account.id);
}
/** Source authorization is always checked; being assigned a process never grants access. */
export function canReadProcessRecord(s:State,m:Member,record:Pick<ProcessRecord,'customerId'|'orderId'|'type'>){
 if(!m.active||m.role==='supplier'||!record.customerId&&!record.orderId)return false;
 const order=record.orderId?all(s,'order').find(row=>row.id===record.orderId) as Order|undefined:undefined;
 if(record.orderId&&(!order||!canRead(m,order)))return false;
 if(record.customerId){
  const account=processCustomerAccounts(s,m).find(row=>row.id===record.customerId);
  if(!account||order&&!processOrderMatchesCustomer(s,order,account))return false;
  if(!order&&!canReadProcessCustomer(s,m,account,record.type))return false;
 }
 if(record.type==='supplier-reconciliation')return canSeeSupplierPrice(m);
 if(!['rfq','sample','complaint'].includes(record.type)||m.role==='admin')return true;
 // A broad factory order scope must not expose commercial requirements or terms.
 const account=record.customerId?(all(s,'customer_account') as CustomerAccount[]).find(row=>row.id===record.customerId)
  :order?(all(s,'customer_account') as CustomerAccount[]).find(row=>processOrderMatchesCustomer(s,order,row)):undefined;
 if(!account)return false;
 if(assignedServiceCustomer(s,m,account))return true;
 if(record.type==='rfq')return readableCustomerQuoteAccounts(s,m).some(row=>row.id===account.id);
 if(record.type==='sample')return drawingCustomers(s,m).some(row=>row.id===account.id);
 return false;
}
const factoryDepartments=['pmc','titanium','outsourcing','plating','semifinished','plastic','finished'];
const departmentsByKind:Partial<Record<ProcessKind,string[]>>={
 'engineering-change':['engineering','engineering_review'],sample:['engineering','engineering_review'],
 iqc:['pmc','plating','semifinished'], 'material-kit':['pmc','semifinished','plastic'],warehouse:['plating','semifinished','finished'],
 'first-article':factoryDepartments,'process-quality':factoryDepartments,'outsourcing-quality':['outsourcing','plating'],oqc:['finished'],packaging:['finished'],'shipment-release':['finished'],
};
export function canWriteProcessKind(s:State,m:Member,type:ProcessKind){
 if(!m.active||['viewer','programmer','supplier'].includes(m.role)||paymentTermsReadOnly(s,m))return false;
 if(m.role==='admin')return true;
 if(type==='supplier-reconciliation')return ['finance','pmc'].includes(m.role);
 if(m.role==='finance')return false;
 if(type==='engineering-change')return m.role==='clerk'&&!!m.departments?.some(d=>departmentsByKind[type]!.includes(d));
 if(['rfq','sample','complaint'].includes(type)&&['sales','clerk','pmc'].includes(m.role))return true;
 if(!['rfq','sample','complaint'].includes(type)&&['production','pmc'].includes(m.role))return true;
 return m.role==='clerk'&&!!m.departments?.some(d=>departmentsByKind[type]?.includes(d));
}
export function canEditProcessRecord(s:State,m:Member,record:Pick<ProcessRecord,'customerId'|'orderId'|'type'>){
 if(!canReadProcessRecord(s,m,record)||!canWriteProcessKind(s,m,record.type))return false;
 if(record.customerId&&!all(s,'customer_account').find(row=>row.id===record.customerId)?.active)return false;
 if(m.role==='admin'||!['rfq','sample','complaint'].includes(record.type))return true;
 if(record.type==='sample'&&m.role==='clerk'&&m.departments?.some(d=>['engineering','engineering_review'].includes(d)))return true;
 const account=all(s,'customer_account').find(row=>row.id===record.customerId) as CustomerAccount|undefined;
 if(account&&assignedServiceCustomer(s,m,account))return true;
 const order=all(s,'order').find(row=>row.id===record.orderId) as Order|undefined;
 return !!order&&(order.ownerEmail===m.email||m.customers.includes(order.customer));
}
export function assertProcessCompletion(record:ProcessFields){
 const details=record.details;
 if(['iqc','first-article','process-quality','outsourcing-quality','oqc'].includes(record.type)){
  const inspected=details.inspectedQuantity,accepted=details.acceptedQuantity,rejected=details.rejectedQuantity;
  if(typeof inspected==='number'&&typeof accepted==='number'&&typeof rejected==='number'&&accepted+rejected!==inspected)throw new Error('合格数量与不良数量之和必须等于检验数量。');
  if(typeof inspected==='number'&&[accepted,rejected].some(value=>typeof value==='number'&&value>inspected))throw new Error('合格或不良数量不能超过检验数量。');
 }
 if(record.status==='受阻'&&!record.blocker)throw new Error('受阻事项须填写阻塞原因。');
 if(record.gateStatus==='不适用'&&!details.gateReason)throw new Error('关口不适用时须填写判断依据。');
 if(record.status!=='已完成')return;
 if(!record.actualDate||!record.outputEvidence||!record.ownerId||!record.responsibleId)throw new Error('完成前须填写实际完成日、结果证据、执行负责人及最终负责人。');
 if(record.blocker)throw new Error('仍有阻塞事项，不能标记已完成；请先核实并更新。');
 if(!['通过','不适用'].includes(record.gateStatus))throw new Error('完成前须记录关口通过，或说明关口不适用的依据。');
 if(['iqc','first-article','process-quality','outsourcing-quality','oqc'].includes(record.type)&&record.gateStatus==='通过'
  &&![details.inspectedQuantity,details.acceptedQuantity,details.rejectedQuantity].every(value=>typeof value==='number'))throw new Error('检验通过须填写检验、合格与不良数量。');
 if(record.type==='material-kit'&&record.gateStatus==='通过'&&(typeof details.requiredQuantity!=='number'||typeof details.readyQuantity!=='number'||details.readyQuantity<details.requiredQuantity))throw new Error('齐料通过须填写需求数量与齐套数量，并确认已满足需求。');
 const required:Partial<Record<ProcessKind,string[]>>={sample:['sampleVersion','signoffRef'],'engineering-change':['newVersion','approvalRef','impactScope'],'shipment-release':['releaseRef'],complaint:['cause','correction','verification']};
 const missing=(required[record.type]||[]).filter(key=>!details[key]);
 if(missing.length)throw new Error('该流程完成前须填写：'+missing.map(key=>processDetailFields[record.type].find(field=>field.key===key)?.label||key).join('、')+'。');
}
