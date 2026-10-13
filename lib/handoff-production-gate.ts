import {all,canRead,clean,type CustomerAccount,type Member,type Order,type State} from './domain';
import {AppError} from './store';
import {businessMoneyCents,businessTotal,type BusinessRow} from './handoff-business';
import {businessEvidenceCurrent} from './handoff-business-evidence';
import {productionAdoption} from './handoff-production-review';
import {serviceOrderCustomerKeys,serviceReceivedCents} from './service-workspace';
import {countValue,dateValue} from './ledger';
import {canDeclareBusinessFunding,fundingDeclarationState} from './handoff-payment-state';

const executing=new Set(['生产中','表面处理','装配中','包装中','待核验关闭']);
const actual=(value:unknown)=>!!clean(value)&&clean(value)!=='-';
const productionIndexes=new WeakMap<State,Map<string,BusinessRow[]>>();
function sourcesByLine(s:State){let index=productionIndexes.get(s);if(index)return index;index=new Map();for(const r of all(s,'handoff_business_source').filter(r=>r.type==='production_order') as BusinessRow[])for(const id of new Set((r.lines||[]).map(l=>l.orderLineId).filter(Boolean)))index.set(id,[...(index.get(id)||[]),r]);productionIndexes.set(s,index);return index;}
/** Evidence already recorded in the native ledger is historical fact, not a newly granted release. */
export function hasRecordedProduction(o:Order){return executing.has(o.stage)||o.workflowStatus==='生产中'||!!dateValue(o.ledger?.columns.AF)||['AG','AI','AL','AR','AT','AV','AX','BD','BF'].some(k=>(countValue(o.ledger?.columns[k])||0)>0);}
/** Scheduling is preparatory. Only an actual start/date change or entry into execution needs release. */
export function requiresProductionGate(before:Order,next:Order){
 return !hasRecordedProduction(before)&&(hasRecordedProduction(next)||actual(next.ledger?.columns.AF));
}
/** Same guard for all native and framework release endpoints. Never infer a PI or payment by a matching number. */
export function handoffProductionGate(s:State,m:Member,o:Order){
 if(!m.active||!canRead(m,o))throw new AppError('无权核对该订单投产条件',403);
 const missing:string[]=[],fundingMissing:string[]=[],sources=sourcesByLine(s).get(o.id)||[];
 if(sources.length!==1){const reason=sources.length?'同一订单明细关联多份生产单，须先明确当前生产采用单':'尚未将原订单明细明确关联生产单';return {allowed:false,missing:[reason],hardMissing:[reason],fundingMissing,productionId:'',productionVersion:0,piId:'',piVersion:0,declarationSequence:0,exceptionEnabled:true,paymentException:null,depositDeclaration:null,fundingReminder:false,fundingBasisCurrent:false,canAuthorizeException:false,canDeclareDeposit:false};}
 const production=sources[0],customer=all(s,'customer_account').find(c=>c.id===production.customerId) as CustomerAccount|undefined;
 if(!customer?.active||!serviceOrderCustomerKeys(s,customer).some(k=>clean(k).toLowerCase()===clean(o.customer).toLowerCase()))missing.push('生产单客户归属已变化，须重新核实');
 if(!businessEvidenceCurrent(s,production))missing.push('生产单或其原资料已有新版本，须重新核对');
 if(production.status==='draft')missing.push('生产单尚未提交核对');
 const linked=production.sourceRefs.map(ref=>s.records.find(r=>r.id===ref.id&&r.version===ref.version)).filter(Boolean) as BusinessRow[],pis=linked.filter(r=>r.kind==='handoff_business_document'&&r.type==='pi');
 const pi=pis.length===1?pis[0]:undefined;
 if(!pi||pi.status!=='checked'||!businessEvidenceCurrent(s,pi))missing.push('缺同一客户订单当前内容已核对的 PI');
 if(pi&&!pi.lines.some(l=>l.orderLineId===o.id&&l.quantity>0))missing.push('PI 未明确包含此原订单明细');
 const drawings=linked.filter(r=>r.kind==='handoff_business_source'&&r.type==='engineering_drawing');
 if(!drawings.some(r=>r.orderId===o.id||(r.lines||[]).some(l=>l.orderLineId===o.id))||drawings.some(r=>!productionAdoption(s,r).effective))missing.push('当前工程生产采用版须画图组长和工程主管双签齐备');
 if(production.fields.materialState!=='物料齐备')missing.push('物料尚未齐备');
 if(!['采购完成','无需采购'].includes(production.fields.purchaseState))missing.push('采购条件尚未齐备');
 const percent=Number(pi?.fields.depositPercent),receivable=all(s,'service_record').find(r=>r.id===production.fields.receivableId&&r.type==='receivable'&&r.status!=='cancelled'&&r.customerId===production.customerId&&r.orderId===production.orderId);
 let basisPoints=0;try{basisPoints=businessMoneyCents(pi?.fields.depositPercent||'');}catch{}
 let total:number|null=null;try{total=pi?businessTotal(pi):null;}catch{}
 if(basisPoints<=0||basisPoints>10000)missing.push('PI 约定定金比例尚未核实');
 if(production.fields.depositPercent&&Number(production.fields.depositPercent)!==percent)missing.push('生产单登记定金比例与已核对 PI 不一致');
 if(!pi||total===null||!pi.fields.currency)missing.push('PI 金额或币种尚未明确');
 if(production.fields.receivableId&&(!receivable||!pi||receivable.details.currency!==pi.fields.currency||receivable.details.amountCents!==total))missing.push('已关联原应收的客户、订单、币种或金额与当前 PI 不一致，须先核实');
 else if(!receivable)fundingMissing.push('尚未明确关联本 PI 的原应收与实际到账');
 else if(total!==null&&basisPoints>0&&basisPoints<=10000){const required=Number((BigInt(total)*BigInt(basisPoints)+BigInt(9999))/BigInt(10000));if(serviceReceivedCents(s,receivable.id)<required)fundingMissing.push('原到账凭证扣除冲销后尚未达到约定定金');}
 const declarations=fundingDeclarationState(s,production),canDeclare=canDeclareBusinessFunding(s,m,production),exception=declarations.public.exception;
 return {allowed:missing.length===0&&(!fundingMissing.length||!!exception),missing:[...missing,...(!exception?fundingMissing:[])],hardMissing:missing,fundingMissing,productionId:production.id,productionVersion:production.version,piId:pi?.id||'',piVersion:pi?.version||0,declarationSequence:declarations.sequence,exceptionEnabled:true,paymentException:exception,depositDeclaration:declarations.public.depositDeclaration,fundingReminder:declarations.public.fundingReminder,fundingBasisCurrent:declarations.public.basisCurrent,canAuthorizeException:canDeclare&&!missing.length&&!!fundingMissing.length&&!exception,canDeclareDeposit:canDeclare&&!!declarations.basis&&declarations.hasExceptionHistory&&!declarations.deposit};
}
export function assertHandoffProductionGate(s:State,m:Member,o:Order){const gate=handoffProductionGate(s,m,o);if(!gate.allowed)throw new AppError('投产条件待核实：'+gate.missing.join('；')+'。仅款项可由当前负责销售确认例外，其他条件不能豁免。',409);return gate;}

