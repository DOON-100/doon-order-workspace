import {all,type Entity,type Member,type State} from './domain';
import {AppError} from './store';
import {businessAccess,businessSourceState,businessTotal,type BusinessRow} from './handoff-business';
import {canReadServiceRecord,serviceReceivedCents,type ServiceRecord} from './service-workspace';

/** The handoff supports one full shipment only; partial batches need an allocation ledger. */
export function paymentRequestBasis(s:State,m:Member,invoice:BusinessRow){
 const same=(r:Entity)=>r.customerId===invoice.customerId&&r.projectId===invoice.projectId&&r.orderId===invoice.orderId;
 if(invoice.kind!=='handoff_business_document'||invoice.type!=='invoice'||invoice.status!=='checked'||!invoice.orderId||!businessAccess(s,m,invoice)||businessSourceState(s,m,invoice).sourceChanged)throw new AppError('请款须由同一订单当前已核对的 Commercial Invoice 生成');
 const invoices=all(s,'handoff_business_document').filter(r=>same(r)&&r.type==='invoice');
 if(invoices.length!==1)throw new AppError('本订单有多张 Invoice；须先明确逐批到账分配，不能将整单余额当成本批请款');
 const pis=all(s,'handoff_business_document').filter(r=>same(r)&&r.type==='pi'&&r.status==='checked') as BusinessRow[];
 const pi=pis.length===1?pis[0]:undefined;
 if(!pi||businessSourceState(s,m,pi).sourceChanged||!invoice.sourceRefs.some(r=>r.id===pi.id&&r.version===pi.version))throw new AppError('请款须明确关联唯一的当前已核对 PI');
 const shipments=invoice.sourceRefs.map(ref=>s.records.find(r=>r.id===ref.id&&r.version===ref.version&&r.kind==='handoff_business_source'&&r.type==='production_shipment')).filter(Boolean) as BusinessRow[];
 const shipment=shipments.length===1?shipments[0]:undefined;
 if(!shipment||!same(shipment)||shipment.status==='draft'||shipment.fields.piId!==pi.id||businessSourceState(s,m,shipment).sourceChanged)throw new AppError('请先核对并提交明确关联本 PI 的实际生产出货批次');
 const exact=(r:BusinessRow,prices=true)=>r.lines.map(l=>({id:l.orderLineId,quantity:l.quantity,...(prices?{price:l.unitPrice}:{})})).sort((a,b)=>a.id.localeCompare(b.id));
 if(!pi.lines.length||pi.lines.some(l=>!l.orderLineId)||new Set(pi.lines.map(l=>l.orderLineId)).size!==pi.lines.length||JSON.stringify(exact(pi))!==JSON.stringify(exact(invoice))||JSON.stringify(exact(pi,false))!==JSON.stringify(exact(shipment,false))||invoice.fields.currency!==pi.fields.currency)throw new AppError('仅支持单张 Invoice 完整出货且数量、币种、单价逐行等于 PI 的请款；部分出货须另行明确分配');
 const productions=(all(s,'handoff_business_source') as BusinessRow[]).filter(r=>same(r)&&r.type==='production_order'&&r.sourceRefs.some(ref=>ref.id===pi.id));
 if(!productions.length||productions.some(r=>r.status==='draft'||!businessAccess(s,m,r)||businessSourceState(s,m,r).sourceChanged||!r.sourceRefs.some(ref=>ref.id===pi.id&&ref.version===pi.version)))throw new AppError('请先在生产单明确关联本 PI 当前版本及原应收账款');
 const receivableIds=new Set(productions.map(r=>r.fields.receivableId));
 if(receivableIds.size!==1||receivableIds.has('')||receivableIds.has(undefined as never))throw new AppError('本 PI 的生产单须明确关联同一份原应收账款');
 const receivable=all(s,'service_record').find(r=>r.id===[...receivableIds][0]&&r.type==='receivable'&&r.status!=='cancelled') as ServiceRecord|undefined,total=businessTotal(pi);
 if(!receivable||!canReadServiceRecord(s,m,receivable)||receivable.customerId!==pi.customerId||receivable.orderId!==pi.orderId||!pi.fields.currency||receivable.details.currency!==pi.fields.currency||total===null||receivable.details.amountCents!==total)throw new AppError('原应收的客户、明确订单、币种和金额须与本 PI 一致；其他项目款项不会自动合并');
 const entries=all(s,'service_receipt').filter(r=>r.recordId===receivable.id).map(r=>({id:r.id,entryType:r.entryType,amountCents:r.amountCents,currency:r.currency})).sort((a,b)=>a.id.localeCompare(b.id));
 if(entries.some(r=>r.entryType!=='payment'||!Number.isSafeInteger(r.amountCents)||r.amountCents<=0||r.currency!==pi.fields.currency))throw new AppError('到账含冲销、币种或异常记录，请先人工明确本批分配；不会自动生成请款');
 const received=serviceReceivedCents(s,receivable.id),balance=total-received;
 if(!Number.isSafeInteger(received)||received<0||balance<=0)throw new AppError(balance===0?'本 PI 已无尾款可请':'到账超额或金额异常，请先核实');
 const sources=[invoice,pi,shipment,...productions];
 return {invoice,pi,shipment,productions,receivable,sources,summary:{scope:'single-full-shipment',invoiceId:invoice.id,piId:pi.id,receivableId:receivable.id,receivableVersion:receivable.version,currency:pi.fields.currency,totalCents:total,receivedCents:received,balanceCents:balance,entries}};
}

export function assertPaymentRequest(s:State,m:Member,row:BusinessRow){
 const invoice=s.records.find(r=>r.id===row.billingSummary?.invoiceId&&r.kind==='handoff_business_document') as BusinessRow|undefined;
 if(!invoice)throw new AppError('请从当前已核对 Invoice 生成或更新请款依据');
 const basis=paymentRequestBasis(s,m,invoice);
 if(JSON.stringify(basis.summary)!==JSON.stringify(row.billingSummary)||row.lines.length!==1||row.lines[0].quantity!==1||row.lines[0].orderLineId||businessTotal(row)!==basis.summary.balanceCents||row.lines[0].description!=='Outstanding balance on '+invoice.number)throw new AppError('请款余额或来源已变化，请按最新依据更新草稿',409);
 for(const key of ['currency','buyer','seller','billingAddress','shippingAddress','paymentTerms','tradeTerms','paymentDueDate'])if(row.fields[key]!==invoice.fields[key])throw new AppError('请款商业字段须与本 Invoice 一致：'+key);
 if(!basis.sources.every(source=>row.sourceRefs.some(ref=>ref.id===source.id&&ref.version===source.version))||!(row.originRefs||[]).some((ref:Entity)=>ref.id===basis.receivable.id&&ref.kind==='service_record'&&ref.version===basis.receivable.version))throw new AppError('请款须保留完整的当前出货、PI、生产单和原账来源',409);
 return basis;
}
