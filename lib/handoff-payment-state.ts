import {all,type Entity,type Member,type State} from './domain';
import {businessMoneyCents,businessTotal,type BusinessRow} from './handoff-business';
import {businessEvidenceCurrent} from './handoff-business-evidence';
import {canReviewCommunication,type Communication} from './unified-communication';

export function canDeclareBusinessFunding(s:State,m:Member,production:BusinessRow){return canReviewCommunication(s,m,production as unknown as Communication);}
export function fundingBasis(s:State,production:BusinessRow){
 const pis=production.sourceRefs.map(ref=>s.records.find(r=>r.id===ref.id&&r.version===ref.version&&r.kind==='handoff_business_document'&&r.type==='pi')).filter(Boolean) as BusinessRow[];
 const pi=pis.length===1?pis[0]:undefined;
 if(!pi||pi.customerId!==production.customerId||pi.projectId!==production.projectId||pi.orderId!==production.orderId||pi.status!=='checked'||!businessEvidenceCurrent(s,pi)||!pi.fields.currency)return null;
 let totalCents:number|null=null,basisPoints=0;try{totalCents=businessTotal(pi);basisPoints=businessMoneyCents(pi.fields.depositPercent);}catch{}
 if(totalCents===null||basisPoints<=0||basisPoints>10000)return null;
 const basis={productionId:production.id,productionVersion:production.version,piId:pi.id,piVersion:pi.version,currency:pi.fields.currency,totalCents,depositBasisPoints:basisPoints,requiredDepositCents:Number((BigInt(totalCents)*BigInt(basisPoints)+BigInt(9999))/BigInt(10000)),piSourceRefs:structuredClone(pi.sourceRefs)};
 return {basis,key:JSON.stringify(basis)};
}
export function fundingDeclarationState(s:State,production:BusinessRow){
 const basis=fundingBasis(s,production),history=all(s,'handoff_business_funding_declaration').filter(r=>r.productionId===production.id&&r.customerId===production.customerId&&r.projectId===production.projectId&&r.orderId===production.orderId);
 const current=history.filter(r=>basis&&r.basisKey===basis.key&&all(s,'member').some(m=>m.id===r.actorId&&canDeclareBusinessFunding(s,m as Member,production)));
 const exception=current.filter(r=>r.declarationType==='payment_exception').at(-1),deposit=current.filter(r=>r.declarationType==='deposit_received').at(-1);
 const summary=(r:Entity|undefined)=>r?{id:r.id,sequence:r.sequence,actor:r.actor,createdAt:r.createdAt}:null;
 return {basis,history,sequence:history.reduce((max,r)=>Math.max(max,Number(r.sequence)||0),0),exception,deposit,hasExceptionHistory:history.some(r=>r.declarationType==='payment_exception'),public:{exception:summary(exception),depositDeclaration:summary(deposit),fundingReminder:history.some(r=>r.declarationType==='payment_exception')&&!deposit,basisCurrent:!!basis}};
}
export function publicFundingHistory(s:State,production:BusinessRow){const state=fundingDeclarationState(s,production);return state.history.map(r=>({id:r.id,sequence:r.sequence,type:r.declarationType,actor:r.actor,createdAt:r.createdAt,note:r.note,basis:r.basis,current:r.id===state.exception?.id||r.id===state.deposit?.id}));}
