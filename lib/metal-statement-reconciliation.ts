import type {MetalData} from './metal-outsourcing-contract';

export type StatementRow={sourceRow:number;jobNo:string;orderNo:string;style:string;process:string;unit:string;quantity:number|null;price:number|null;amount:number|null;currency:string;reasons:string[]};
export type StatementCheck={sourceRow:number|null;jobNo:string;orderNo:string;style:string;process:string;unit:string;supplierQuantity:number|null;systemQuantity:number|null;supplierAmount:number|null;systemAmount:number|null;qcIds:string[];status:'一致'|'待核对';reasons:string[]};
const norm=(s:string)=>s.trim().normalize('NFKC').toUpperCase();
const key=(r:{jobNo:string;orderNo:string;style:string;process:string;unit:string;currency:string})=>JSON.stringify([r.jobNo,r.orderNo,r.style,r.process,r.unit,r.currency].map(norm));
const cents=(n:number)=>Math.round(n*100);

/** Preview only. Matching never creates receipts, prices, settlements or payments. */
export function reconcileMetalStatement(data:MetalData,rows:StatementRow[],supplierId:string,period:string):StatementCheck[]{
 if(!data.permissions.price||!data.permissions.settle)throw new Error('没有供应商金额核对权限。');
 if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(period))throw new Error('请选择明确的对账月份。');
 if(!data.suppliers.some(s=>s.id===supplierId))throw new Error('请选择当前可用的供应商。');
 const system=new Map<string,{identity:{jobNo:string;orderNo:string;style:string;process:string;unit:string;currency:string};quantity:number;amountCents:number;prices:Set<number>;ids:string[];reasons:string[]}>();
 for(const q of data.quality.filter(q=>!q.voided&&q.supplierId===supplierId&&q.date.slice(0,7)===period&&q.billableGood>0)){
  const receipt=data.receipts.find(r=>r.id===q.receiptId&&!r.voided),delivery=data.deliveries.find(d=>d.id===receipt?.deliveryId&&!d.voided),line=delivery?.lines.find(l=>l.id===receipt?.deliveryLineId),job=data.jobs.find(j=>j.id===line?.jobId&&!j.voided),demand=data.demands.find(d=>d.id===q.demandId);
  const styles=[...new Set(demand?.sources.map(s=>s.style)||[])];
  const identity={jobNo:job?.number||'',orderNo:demand?.orderNo||'',style:styles.length===1?styles[0]:'',process:demand?.process.name||'',unit:demand?.unit||'',currency:q.currency};
  const k=key(identity),g=system.get(k)||{identity,quantity:0,amountCents:0,prices:new Set<number>(),ids:[],reasons:[]};
  g.quantity+=q.billableGood;g.amountCents+=cents(q.amountIncTax);g.prices.add(q.quote.priceIncTax);g.ids.push(q.id);
  if(styles.length!==1)g.reasons.push('共用配件涉及多个款式，不能按计划比例推定供应商账单的款式归属');
  if(!job||!delivery||!receipt||!demand)g.reasons.push('系统计费记录缺少完整加工单、送货、实收或需求来源');
  if(q.reworkAmountIncTax)g.reasons.push('存在额外返工费，须单列核对原工序费和返工费');
  if(q.quote.pricingFactor!==1||q.quote.pricingUnit!==demand?.unit)g.reasons.push('数量单位与计价单位存在换算，须核对账单使用的单位与换算依据');
  system.set(k,g);
 }
 const counts=new Map<string,number>();for(const r of rows)counts.set(key(r),(counts.get(key(r))||0)+1);
 const seen=new Set<string>(),result:StatementCheck[]=[];
 for(const r of rows){
  const k=key(r),g=system.get(k),reasons=[...r.reasons];
  for(const field of ['jobNo','orderNo','style','process','unit','currency'] as const)if(!r[field])reasons.push(`缺少${({jobNo:'外发加工单号',orderNo:'销售订单号',style:'款号或材料号',process:'外发工序',unit:'数量单位',currency:'币种'})[field]}，无法唯一匹配`);
  if(counts.get(k)!==1)reasons.push('账单存在同键多行，需说明分批或重复收费依据；未自动合并');
  if(r.quantity===null||r.amount===null||r.price===null)reasons.push('数量、单价或金额不是明确数值，空白不按零处理');
  if(r.quantity!==null&&(!Number.isFinite(r.quantity)||r.quantity<0))reasons.push('计费数量无效或为负数，需核对退货或更正依据');
  if(r.price!==null&&(!Number.isFinite(r.price)||r.price<0))reasons.push('单价无效或为负数，不能采用');
  if(r.amount!==null&&(!Number.isFinite(r.amount)||r.amount<0||Math.abs(r.amount*100-cents(r.amount))>0.0000001))reasons.push('金额无效、为负数或超过两位小数，需核对贷项与舍入口径');
  if(!g)reasons.push('本供应商、本账期未找到同单号、订单、款式、工序、单位及币种的已质检计费记录；历史原表归档不等于已承接');
  else{
   seen.add(k);reasons.push(...g.reasons);
   if(r.quantity!==null&&Math.abs(r.quantity-g.quantity)>0.0000005)reasons.push(`计费数量差异：供应商${r.quantity}，系统${g.quantity}`);
   if(r.amount!==null&&cents(r.amount)!==g.amountCents)reasons.push(`含税金额差异：供应商${r.amount}，系统${g.amountCents/100}`);
   if(g.prices.size!==1)reasons.push('系统同键存在多种采用单价，需分价核对');
   else if(r.price!==null&&!g.prices.has(r.price))reasons.push(`单价差异：供应商${r.price}，系统${[...g.prices][0]}`);
  }
  result.push({sourceRow:r.sourceRow,jobNo:r.jobNo,orderNo:r.orderNo,style:r.style,process:r.process,unit:r.unit,supplierQuantity:r.quantity,systemQuantity:g?.quantity??null,supplierAmount:r.amount,systemAmount:g?g.amountCents/100:null,qcIds:g?.ids||[],status:reasons.length?'待核对':'一致',reasons:[...new Set(reasons)]});
 }
 for(const [k,g] of system)if(!seen.has(k))result.push({sourceRow:null,...g.identity,supplierQuantity:null,systemQuantity:g.quantity,supplierAmount:null,systemAmount:g.amountCents/100,qcIds:g.ids,status:'待核对',reasons:['系统有本月已质检计费记录，供应商账单未列出',...g.reasons]});
 for(const a of data.adjustments.filter(a=>!a.voided&&a.supplierId===supplierId&&a.status==='approved'))if(data.quality.some(q=>q.id===a.qcId&&q.date.slice(0,7)===period))result.push({sourceRow:null,jobNo:'扣补 '+a.id,orderNo:'',style:'',process:'',unit:'',supplierQuantity:null,systemQuantity:null,supplierAmount:null,systemAmount:a.amountIncTax,qcIds:[a.qcId],status:'待核对',reasons:['存在已确认扣补，需与供应商账单扣补行单独核对：'+a.reason]});
 return result;
}

export const statementHeaders:Record<string,string[]>={jobNo:['外发加工单号','Subcon Order.No.','加工单号'],orderNo:['销售订单号',"Sale's Order.No",'订单号'],style:['款号','Style.No','图纸号','材料号'],process:['外发工序','工序名称','Process.Name'],unit:['单位','Unit'],quantity:['计费数量','收回良品数量','数量','Quantity'],price:['含税单价','taxprice','单价'],amount:['含税金额','金额','Amount'],currency:['币种','Currency']};
export function statementHeaderKey(s:string){return norm(s).replace(/[\s.\n\r'’_]/g,'');}
export function statementHeaderColumn(headers:string[],field:string){const aliases=statementHeaders[field]||[];const hits=headers.map((h,i)=>aliases.some(a=>statementHeaderKey(h)===statementHeaderKey(a)||statementHeaderKey(h)===statementHeaderKey(a+' '+(aliases[1]||'')))?i:-1).filter(i=>i>=0);return hits.length===1?hits[0]:-1;}
