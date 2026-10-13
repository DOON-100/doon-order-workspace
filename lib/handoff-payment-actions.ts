import {z} from 'zod';
import {all,newId,now,type Member,type Order,type State} from './domain';
import {AppError,audit,commit,json} from './store';
import {businessAccess,type BusinessRow} from './handoff-business';
import {canDeclareBusinessFunding,fundingDeclarationState} from './handoff-payment-state';
import {handoffProductionGate} from './handoff-production-gate';
import {serviceReceivedCents} from './service-workspace';

const inputSchema=z.object({token:z.string().uuid(),productionId:z.string().trim().min(1).max(160),expectedVersion:z.number().int().positive(),piId:z.string().trim().min(1).max(160),expectedPiVersion:z.number().int().positive(),expectedDeclarationSequence:z.number().int().min(0),note:z.string().trim().min(3).max(6000)}).strict();
export async function businessPaymentPost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['handoff-business-payment-exception','handoff-business-deposit-declaration'].includes(action))return null;
 const result=inputSchema.safeParse(await req.json());if(!result.success)throw new AppError(result.error.issues[0].message);const input=result.data;
 const production=all(s,'handoff_business_source').find(r=>r.id===input.productionId&&r.type==='production_order') as BusinessRow|undefined;
 if(!production||!businessAccess(s,m,production)||!canDeclareBusinessFunding(s,m,production))throw new AppError('仅此客户或项目当前指定负责销售本人可确认款项例外或定金声明',403);
 const order=all(s,'order').find(r=>r.id===production.orderId) as Order|undefined;if(!order)throw new AppError('原订单不存在或归属待核实',409);
 const fingerprint=JSON.stringify({action,input}),requestId='handoff_business_request_'+input.token,prior=s.records.find(r=>r.id===requestId);
 if(prior){if(prior.kind!=='handoff_business_request'||prior.actorId!==m.id||prior.action!==action||prior.fingerprint!==fingerprint)throw new AppError('操作编号已用于其他内容',409);return json({ok:true,idempotent:true,productionId:production.id,gate:handoffProductionGate(s,m,order)});}
 const state=fundingDeclarationState(s,production),basis=state.basis;
 if(production.version!==input.expectedVersion||state.sequence!==input.expectedDeclarationSequence||!basis||basis.basis.piId!==input.piId||basis.basis.piVersion!==input.expectedPiVersion)throw new AppError('生产单、PI、定金依据或声明已变化，请按当前版本重新核对',409);
 const declarationType=action.endsWith('payment-exception')?'payment_exception':'deposit_received';
 const gates=production.lines.map(l=>all(s,'order').find(r=>r.id===l.orderLineId) as Order|undefined).map(o=>o?handoffProductionGate(s,m,o):null);
 if(declarationType==='payment_exception'){
  if(!gates.length||gates.some(g=>!g||g.productionId!==production.id||g.hardMissing.length))throw new AppError('仅款项可例外；PI、当前工程双签、物料和采购须全部齐备',409);
  if(gates.every(g=>g&&!g.fundingMissing.length))throw new AppError('当前原到账已满足约定定金，无需新增缺款例外',409);
  if(state.exception)throw new AppError('此版本已有当前负责销售的款项例外；请读取现有记录',409);
 }else{
  if(!state.hasExceptionHistory)throw new AppError('此生产单没有待跟进的款项例外',409);
  if(state.deposit)throw new AppError('当前依据已有定金已收齐声明，请读取原记录',409);
 }
 const receivable=all(s,'service_record').find(r=>r.id===production.fields.receivableId&&r.type==='receivable'&&r.customerId===production.customerId&&r.orderId===production.orderId);
 const receiptSnapshot=receivable?{id:receivable.id,version:receivable.version,currency:receivable.details.currency,amountCents:receivable.details.amountCents,receivedCents:serviceReceivedCents(s,receivable.id),entries:all(s,'service_receipt').filter(r=>r.recordId===receivable.id).map(r=>({id:r.id,entryType:r.entryType,amountCents:r.amountCents}))}:null;
 const item={id:newId('handoff_business_funding_declaration'),kind:'handoff_business_funding_declaration',productionId:production.id,customerId:production.customerId,projectId:production.projectId,orderId:production.orderId,sequence:state.sequence+1,declarationType,basis:structuredClone(basis.basis),basisKey:basis.key,actorId:m.id,actor:m.name,note:input.note,createdAt:now(),snapshot:{productionId:production.id,productionVersion:production.version,piSourceRefs:structuredClone(basis.basis.piSourceRefs),fundingMissing:gates.flatMap(g=>g?.fundingMissing||[]),receiptSnapshot}};
 const updates=[item,{id:requestId,kind:'handoff_business_request',actorId:m.id,action,fingerprint,recordId:production.id,createdAt:item.createdAt},audit(m,item,null,declarationType==='payment_exception'?'负责销售确认仅款项例外投产':'负责销售声明本PI约定定金已收齐','销售独立声明，不改写实际到账账套')];
 await commit(s.revision,updates);const next={revision:s.revision+1,records:[...s.records,...updates]};return json({ok:true,productionId:production.id,gate:handoffProductionGate(next,m,order)});
}
