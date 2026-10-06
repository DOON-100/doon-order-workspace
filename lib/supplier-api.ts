import {z} from 'zod';
import {all,canRead,clean,now,newId,productTypeOf,strictDate,type Entity,type Member,type Order,type State} from './domain';
import {AppError,audit,bucket,commit,json} from './store';
import {canSeeSupplierPrice,managesSuppliers,supplierStatus,matchesSupplierStatus} from './suppliers';
import {makeWorkbook,sha} from './workbooks';
import {stageDefs} from './ledger';
const key=(s:string)=>clean(s).toUpperCase();
const pmc=(m:Member)=>{if(!managesSuppliers(m))throw new AppError('权限受限：供应商资料、外发单和复期由 PMC / 采购（Candy、Tina）或管理员维护。',403);};
const date=(v:string)=>{try{strictDate(v);return v;}catch(e){throw new AppError((e as Error).message);}};
export async function supplierGet(action:string,req:Request,s:State,m:Member){
 if(action==='supplier-quote-template'){
  if(!canSeeSupplierPrice(m))throw new AppError('没有供应商价格权限。',403);
  const columns=['供应商','报价类别','配件/工序编码','配件名称/加工工序','规格/材料/颜色','计价单位','数量下限','数量上限','未税单价','含税单价','税率(%)','币种','最小起订量','最低加工费','打样费','模具费','损耗比例(%)','样品交期(天)','量产交期(天)','报价有效期起','报价有效期止','备注'];
  return new Response(makeWorkbook([], '供应商标准报价',columns),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent('度昂供应商标准报价模板.xlsx'),'Cache-Control':'no-store'}});
 }
 if(action==='supplier-quote-file'){
  if(!canSeeSupplierPrice(m))throw new AppError('没有供应商价格权限。',403);const id=new URL(req.url).searchParams.get('id'),item=all(s,'supplier_quote_file').find(v=>v.id===id);if(!item)throw new AppError('报价附件不存在。',404);const object=await bucket().get(item.fileKey);if(!object)throw new AppError('报价附件未找到。',404);return new Response(object.body,{headers:{'Content-Type':item.contentType||'application/octet-stream','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(item.filename),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 }
 if(action==='supplier-quote-export'){
  if(!canSeeSupplierPrice(m))throw new AppError('没有供应商价格权限。',403);const rows=all(s,'supplier_quote').map(q=>({'供应商':q.supplier,'报价类别':q.category,'配件/工序编码':q.itemCode,'配件名称/加工工序':q.itemName,'规格/材料/颜色':q.specification,'计价单位':q.unit,'数量下限':q.qtyFrom,'数量上限':q.qtyTo||'','未税单价':q.priceExTax,'含税单价':q.priceIncTax,'税率(%)':q.taxRate,'币种':q.currency,'最小起订量':q.moq,'最低加工费':q.minimumCharge,'打样费':q.sampleFee,'模具费':q.mouldFee,'损耗比例(%)':q.lossRate,'样品交期(天)':q.sampleLeadDays,'量产交期(天)':q.massLeadDays,'报价有效期起':q.validFrom,'报价有效期止':q.validTo,'版本':`V${q.version}`,'状态':q.status,'录入人':q.createdBy,'录入时间':q.createdAt}));return new Response(makeWorkbook(rows,'供应商报价档案'),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent('供应商报价档案.xlsx'),'Cache-Control':'no-store'}});
 }
 if(action!=='supplier-export')return null;
 const url=new URL(req.url),q=clean(url.searchParams.get('q')).toLowerCase(),status=clean(url.searchParams.get('status')),supplier=clean(url.searchParams.get('supplier')),buyer=clean(url.searchParams.get('buyer'));
 const orders=(all(s,'order') as Order[]).filter(o=>canRead(m,o)),ids=new Set(orders.map(o=>o.id));
 const rows=all(s,'outsource').filter(x=>ids.has(x.lineId)&&matchesSupplierStatus(x,status)&&(!supplier||x.supplier===supplier)&&(!buyer||x.buyerEmail===buyer)&&(!q||[x.supplier,x.reference,orders.find(o=>o.id===x.lineId)?.orderNo,orders.find(o=>o.id===x.lineId)?.drawing].join(' ').toLowerCase().includes(q)));
 const data=rows.map(x=>{const o=orders.find(o=>o.id===x.lineId)!;return {'供应商':x.supplier,'外发单号':x.reference,'订单号':o.orderNo,'客户':o.customer,'产品类型':productTypeOf(o),'款号':o.drawing,'色号':o.color,'工序':stageDefs.find(d=>d.id===x.process)?.name,'外发数量':x.quantity,'合格回货':x.received,'未回数量':x.status==='已取消'?0:Math.max(0,x.quantity-x.received),'原始要求交期':x.originalDueDate||x.dueDate,'当前要求交期':x.dueDate,'供应商回复日期':x.replyDate||'','供应商承诺交期':x.promisedDate||'待复期','复期数量':x.promisedQuantity??'','预计到货日':x.expectedDate||'','下次催交日':x.nextFollowupDate||'','采购跟进人':x.buyerName||x.actor,'状态':supplierStatus(x),'延期原因':x.delayReason||'','最新跟进':x.latestNote||'','更新人':x.updatedBy||x.actor};});
 return new Response(makeWorkbook(data,'供应商交期跟进',data.length?undefined:['暂无符合筛选的外发记录']),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent('供应商交期跟进.xlsx'),'Cache-Control':'no-store'}});
}
export async function supplierPost(action:string,req:Request,s:State,m:Member){
 if(!['supplier-save','outsource-update','outsource-cancel','outsource-approve','supplier-quote-file','supplier-quote-save'].includes(action))return null;
 if(action==='supplier-quote-file'){
  if(!canSeeSupplierPrice(m))throw new AppError('没有供应商价格权限。',403);const form=await req.formData(),file=form.get('file');if(!(file instanceof File)||!file.size||file.size>10*1024*1024)throw new AppError('请上传不超过 10 MB 的报价单。');if(!/\.(xlsx?|pdf|jpe?g|png|webp)$/i.test(file.name))throw new AppError('报价单支持 XLSX、XLS、PDF、JPG、PNG 或 WebP。');const bytes=await file.arrayBuffer(),hash=await sha(bytes),prior=all(s,'supplier_quote_file').find(v=>v.hash===hash);if(prior)return json(prior);const item={id:newId('supplier_quote_file'),kind:'supplier_quote_file',filename:file.name.replace(/[\\/]/g,'_'),fileKey:newId('supplier_quote_source'),contentType:file.type||'application/octet-stream',hash,actorId:m.id,actor:m.name,createdAt:now()};await bucket().put(item.fileKey,bytes);await commit(s.revision,[item]);return json(item);
 }
 if(action==='supplier-quote-save'){
  if(!canSeeSupplierPrice(m))throw new AppError('没有供应商价格权限。',403);const p=z.object({quoteGroupId:z.string().optional(),supplier:z.string().trim().min(1).max(100),category:z.enum(['原材料','配件','半成品','加工工序','成品外发','模具治具','包装及服务']),itemCode:z.string().trim().max(100).default(''),itemName:z.string().trim().min(1).max(200),specification:z.string().max(1000).default(''),unit:z.string().trim().min(1).max(30),qtyFrom:z.number().min(0).max(1e9).default(0),qtyTo:z.number().min(0).max(1e9).nullable().default(null),priceExTax:z.number().min(0).max(1e9),priceIncTax:z.number().min(0).max(1e9),taxRate:z.number().min(0).max(100).default(0),currency:z.string().trim().min(1).max(10).default('CNY'),moq:z.number().min(0).max(1e9).default(0),minimumCharge:z.number().min(0).max(1e9).default(0),sampleFee:z.number().min(0).max(1e9).default(0),mouldFee:z.number().min(0).max(1e9).default(0),lossRate:z.number().min(0).max(100).default(0),sampleLeadDays:z.number().int().min(0).max(3650).default(0),massLeadDays:z.number().int().min(0).max(3650).default(0),validFrom:z.string().default(''),validTo:z.string().default(''),fileId:z.string().default(''),notes:z.string().max(2000).default('')}).parse(await req.json());for(const d of [p.validFrom,p.validTo])if(d)date(d);if(p.validFrom&&p.validTo&&p.validTo<p.validFrom)throw new AppError('报价有效期止不能早于开始日期。');if(p.qtyTo!==null&&p.qtyTo<p.qtyFrom)throw new AppError('数量上限不能小于数量下限。');if(p.fileId&&!all(s,'supplier_quote_file').some(v=>v.id===p.fileId))throw new AppError('报价附件不存在，请重新上传。');const group=p.quoteGroupId||newId('supplier_quote_group'),previous=all(s,'supplier_quote').filter(v=>v.quoteGroupId===group).sort((a,b)=>b.version-a.version)[0],item={...p,id:newId('supplier_quote'),kind:'supplier_quote',quoteGroupId:group,version:(previous?.version||0)+1,priorId:previous?.id||'',status:'有效',createdAt:now(),createdBy:m.name,createdById:m.id};await commit(s.revision,[item,audit(m,item,previous||null,'保存供应商报价',`${p.supplier} / ${p.itemName}`)]);return json(item);
 }
 if(action==='outsource-approve'){
  const body=z.object({id:z.string(),version:z.number().int(),decision:z.enum(['approve','reject']),note:z.string().trim().min(2).max(1000)}).parse(await req.json()),x=all(s,'outsource').find(v=>v.id===body.id);if(!x)throw new AppError('外发单不存在。',404);if(x.version!==body.version)throw new AppError('外发单已更新，请刷新后再审批。',409);if(x.approvalStatus!=='待主管审批')throw new AppError('此外发单当前不在待审批状态。');if(m.role!=='admin'&&m.name!==x.approverName)throw new AppError(`此外发单需要 ${x.approverName} 审批。`,403);const next={...x,approvalStatus:body.decision==='approve'?'已审批':'已驳回',approvalNote:body.note,approvedBy:m.name,approvedAt:now(),version:x.version+1,updatedAt:now(),updatedBy:m.name};await commit(s.revision,[next,audit(m,next,x,body.decision==='approve'?'主管批准外发':'主管驳回外发',body.note)]);return json(next);
 }
 pmc(m);const body=z.record(z.unknown()).parse(await req.json());
 if(action==='supplier-save'){
  const p=z.object({id:z.string().optional(),version:z.number().int().optional(),name:z.string().trim().min(1).max(100),contact:z.string().trim().max(100).default(''),phone:z.string().trim().max(100).default(''),notes:z.string().max(2000).default(''),active:z.boolean().default(true)}).parse(body);
  const prior=p.id?all(s,'supplier').find(x=>x.id===p.id):undefined;if(p.id&&!prior)throw new AppError('供应商不存在，请刷新。',404);if(prior&&prior.version!==p.version)throw new AppError('供应商资料已由另一位同事更新，请刷新后核对。',409);
  if(all(s,'supplier').some(x=>x.id!==p.id&&key(x.name)===key(p.name)))throw new AppError('此供应商已存在，请直接编辑现有资料。');
  if(prior&&p.name!==prior.name&&all(s,'outsource').some(x=>key(x.supplier)===key(prior.name)))throw new AppError('此名称已有外发凭证，请保留名称以便追溯；联系人、电话和备注仍可修改。');
  const item={...prior,...p,id:prior?.id||newId('supplier'),kind:'supplier',version:(prior?.version||0)+1,createdAt:prior?.createdAt||now(),updatedAt:now(),updatedBy:m.name};await commit(s.revision,[item,audit(m,item,prior||null,'维护供应商资料')]);return json(item);
 }
 const id=z.string().parse(body.id),x=all(s,'outsource').find(x=>x.id===id);if(!x)throw new AppError('外发单不存在。',404);
 const o=all(s,'order').find(o=>o.id===x.lineId) as Order|undefined;if(!o||!canRead(m,o))throw new AppError('无权访问此订单。',403);
 if(x.version!==z.number().int().parse(body.version))throw new AppError('此外发单已被另一位同事更新，请刷新后重新核对。',409);
 if(x.status==='已取消')throw new AppError('此外发单已取消，历史记录仅供查验。');
 const hasReceipt=all(s,'receipt').some(r=>r.status!=='已撤销'&&r.lines.some((l:any)=>l.outsourceId===x.id));
 let next:Entity,event:string,note:string,newMaster:Entity|undefined;
 if(action==='outsource-cancel'){
  note=z.string().trim().min(3).max(2000).parse(body.reason);if(x.received>0||hasReceipt)throw new AppError('已有收货凭证，不能取消或清除外发欠数；请核对收货和退货业务。');
  next={...x,status:'已取消',cancelReason:note,cancelledAt:now()};event='取消外发';
 }else{
  const p=z.object({supplier:z.string().trim().min(1).max(100),reference:z.string().trim().min(1).max(100),quantity:z.number().int().positive().max(10000000),sentDate:z.string(),dueDate:z.string(),buyerEmail:z.string().email(),replyDate:z.string().default(''),promisedDate:z.string().default(''),promisedQuantity:z.number().int().positive().max(10000000).nullable().default(null),expectedDate:z.string().default(''),nextFollowupDate:z.string().default(''),delayReason:z.string().max(1000).default(''),note:z.string().trim().min(2).max(2000)}).parse(body);
  for(const k of ['sentDate','dueDate','replyDate','promisedDate','expectedDate','nextFollowupDate'] as const)date(p[k]);
  if(!p.sentDate||!p.dueDate||p.dueDate<p.sentDate)throw new AppError('要求交期不能早于外发日期。');
  if(p.promisedDate&&!p.replyDate)throw new AppError('填写供应商承诺交期时，请同时记录供应商回复日期。');
  if((p.promisedDate&&p.promisedDate<p.sentDate)||(p.expectedDate&&p.expectedDate<p.sentDate))throw new AppError('供应商交期及预计到货不能早于外发日期。');
  if(p.quantity<x.received)throw new AppError('外发数量不能少于已合格收货数量。');
  if(p.promisedQuantity!==null&&(!p.promisedDate||p.promisedQuantity>p.quantity))throw new AppError('复期数量需对应承诺日期，且不能超过外发数量。');
  if((p.promisedDate>p.dueDate||p.expectedDate>p.dueDate)&&!p.delayReason.trim())throw new AppError('复期或预计到货晚于要求交期，请填写延期原因。');
  if(hasReceipt&&(p.supplier!==x.supplier||p.reference!==x.reference||p.sentDate!==x.sentDate))throw new AppError('已有收货凭证，供应商、外发单号和外发日期不可变更；可继续维护复期和跟进。');
  if(all(s,'outsource').some(y=>y.id!==x.id&&y.status!=='已取消'&&key(y.supplier)===key(p.supplier)&&key(y.reference)===key(p.reference)&&y.lineId===x.lineId&&y.process===x.process))throw new AppError('相同供应商、外发单号与工序已登记。');
  const buyer=all(s,'member').find(u=>u.email===p.buyerEmail&&u.active&&['pmc','admin'].includes(u.role));if(!buyer)throw new AppError('请选择有效的 PMC / 采购跟进人。');
  const supplier=all(s,'supplier').find(v=>key(v.name)===key(p.supplier));if(supplier?.active===false&&p.supplier!==x.supplier)throw new AppError('此供应商已停用，请选用有效供应商。');
  if(!supplier)newMaster={id:newId('supplier'),kind:'supplier',name:p.supplier,contact:'',phone:'',notes:'',active:true,version:1,createdAt:now(),updatedAt:now(),updatedBy:m.name};
  const {note:followup,...fields}=p;note=followup;next={...x,...fields,originalDueDate:x.originalDueDate||x.dueDate,buyerName:buyer.name,latestNote:note};event='更新复期 / 催交跟进';
 }
 Object.assign(next,{version:x.version+1,updatedAt:now(),updatedBy:m.name});
 const log={id:newId('supplier_followup'),kind:'supplier_followup',outsourceId:x.id,lineId:x.lineId,supplier:next.supplier,event,note,actor:m.name,actorId:m.id,createdAt:now(),before:{dueDate:x.dueDate,promisedDate:x.promisedDate||'',expectedDate:x.expectedDate||'',quantity:x.quantity},after:{dueDate:next.dueDate,promisedDate:next.promisedDate||'',expectedDate:next.expectedDate||'',quantity:next.quantity,nextFollowupDate:next.nextFollowupDate||''}};
 await commit(s.revision,[next,log,audit(m,next,x,event,note),...(newMaster?[newMaster,audit(m,newMaster,null,'登记供应商')]:[])]);return json(next);
}
