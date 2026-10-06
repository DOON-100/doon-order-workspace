import {departmentColumns,mayReceive} from './departments';
import {metricExport} from './metric-export';
import {z} from 'zod';
import {AppError,audit,bucket,commit,json} from './store';
import {all,allowedFields,broad,canRead,clean,newId,now,productTypeOf,strictDate,type State,type Member,type Order,type Entity} from './domain';
import {parseLedger} from './ledger-import';
import {active,automaticDates,countValue,colLabels,dateCols,dateValue,editableCols,numeric,outstanding,stageDefs,stageNumbers,issues} from './ledger';
import {makeWorkbook,sha} from './workbooks';
import {supplierGet,supplierPost} from './supplier-api';
import {lossGet,lossPost} from './loss-api';
import {applyLedgerPatch} from './ledger-edit';
import {pmcGet,pmcPost} from './pmc-api';
import {purchaseGet,purchasePost} from './purchase-api';
import {factoryName,inProductionScope,productionScope} from './manufacturing';
import {orderExportExtras} from './order-export';
import {pmcOrder,reviewState,type PmcRound} from './pmc';
import {collaborationGet,collaborationPost} from './collaboration-api';
import {canCreateOutsource,outsourceApprover} from './suppliers';
const getOrder=(s:State,m:Member,id:string)=>{const o=s.records.find(r=>r.kind==='order'&&r.id===id) as Order|undefined;if(!o||!canRead(m,o))throw new AppError('无权访问此订单。',403);return o;};
const pmc=(m:Member)=>{if(!broad(m))throw new AppError('需要 PMC 或管理员权限。',403);};
const work=(m:Member,o:Order)=>{if(!active(o)||!allowedFields(m,o).length||m.role==='sales')throw new AppError('仅负责此单的文员、PMC 或管理员可办理在制业务。',403);};
function download(body:BodyInit,name:string,type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',inline=false){return new Response(body,{headers:{'Content-Type':type,'Content-Disposition':`${inline?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
export async function operationGet(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 const collaboration=await collaborationGet(action,req,s,m);if(collaboration)return collaboration;
 if(action==='metric-export')return metricExport(req,s,m);
 const purchase=await purchaseGet(action,req,s,m);if(purchase)return purchase;
 const pmcResult=pmcGet(action,s,m,req);if(pmcResult)return pmcResult;
 const loss=await lossGet(action,req,s,m);if(loss)return loss;
 const supplier=await supplierGet(action,req,s,m);if(supplier)return supplier;
 const url=new URL(req.url);
 if(action==='ledger-file'){
  const item=s.records.find(r=>r.id===url.searchParams.get('id')&&['ledger_import','receipt_photo'].includes(r.kind));if(!item)throw new AppError('文件不存在。',404);
  if(item.kind==='ledger_import')pmc(m);else{const receipts=all(s,'receipt').filter(r=>r.photoId===item.id);if(!broad(m)&&item.actorId!==m.id&&!receipts.some(r=>r.lines?.every((l:any)=>{try{getOrder(s,m,l.lineId);return true;}catch{return false;}})))throw new AppError('无权查看送货单。',403);}
  const object=await bucket().get(item.fileKey);if(!object)throw new AppError('文件未找到。',404);return download(object.body,item.filename,item.contentType||'application/octet-stream',item.kind==='receipt_photo');
 }
 if(action==='ledger-export'){
  const sourceScope=url.searchParams.get('production'),factory=clean(url.searchParams.get('factory')),reviewFilter=clean(url.searchParams.get('reviewStatus')),round=all(s,'pmc_round').filter(r=>r.actorId===m.id&&productionScope(r.productionScope)===productionScope(sourceScope)).at(-1) as PmcRound|undefined,reviewMap=new Map(all(s,'pmc_review').filter(r=>r.roundId===round?.id).map(r=>[r.lineId,r]));
  const mode=url.searchParams.get('mode')==='archived'?'archived':'active',q=clean(url.searchParams.get('q')).toLowerCase(),customer=clean(url.searchParams.get('customer')),owner=clean(url.searchParams.get('owner')),month=clean(url.searchParams.get('month')),exception=clean(url.searchParams.get('exception')),stage=stageDefs.find(d=>d.id===url.searchParams.get('stage')),archiveReview=url.searchParams.get('review')==='1';
  const rows=pmcOrder(all(s,'order') as Order[]).filter(o=>canRead(m,o)&&(!sourceScope||inProductionScope(o,productionScope(sourceScope)))&&(!factory||factoryName(o)===factory)&&(mode==='archived'?o.lifecycle==='archived':active(o))&&(!q||[o.orderNo,o.customer,o.drawing,o.color,o.lens,o.notes,o.ledger?.ownerName,o.ledger?.sourceRow,factoryName(o)].join(' ').toLowerCase().includes(q))&&(!customer||o.customer===customer)&&(!owner||o.ledger?.ownerName===owner||o.ownerEmail===owner||(owner==='mine'&&o.ownerEmail===m.email))&&(!month||(mode==='archived'?o.closedDate:o.plannedDate||o.requestedDate)?.startsWith(month))&&(!exception||issues(o).includes(exception))&&(!stage||(stageNumbers(o,stage).wip||0)>0)&&(!archiveReview||(outstanding(o)??0)>0||!o.closedDate)&&(!reviewFilter||(reviewFilter==='todo'?['unreviewed','changed','pending'].includes(reviewState(o,round,reviewMap.get(o.id) as any)):reviewState(o,round,reviewMap.get(o.id) as any)===reviewFilter)));
  const data=rows.map(o=>({'生产厂':factoryName(o),'订单号':o.orderNo,'客户':o.customer,'产品类型':productTypeOf(o),'款号':o.drawing,'色号':o.color,'镜片':o.lens,'跟单员':o.ledger?.ownerName||o.ownerEmail,'订单数量':o.quantity,'PMC排期':o.plannedDate,'状态备注':o.notes,'包装入仓':o.ledger?.columns.BF||'未记录','重算欠数':outstanding(o),'待核对':issues(o).join('；'),'当前状态':mode==='archived'?'已归档':'在制','结单日':o.closedDate||'','归档依据':o.archiveReason||'',...orderExportExtras(o,['A','B','AQ','BC','BF','BH']),'_明细编号':o.id,'_版本':o.version}));
  const title=sourceScope==='external'?'成品外发跟进总表':mode==='archived'?'PMC已完成订单档案':'度昂在制订单明细';return download(makeWorkbook(data,title),title+(factory?'_'+factory:'')+'.xlsx');
 }
 return null;
}
export async function operationPost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 const collaboration=await collaborationPost(action,req,s,m);if(collaboration)return collaboration;
 const purchase=await purchasePost(action,req,s,m);if(purchase)return purchase;
 const pmcResult=await pmcPost(action,req,s,m);if(pmcResult)return pmcResult;
 const loss=await lossPost(action,req,s,m);if(loss)return loss;
 const supplier=await supplierPost(action,req,s,m);if(supplier)return supplier;
 if(action==='ledger-preview'){
  pmc(m);const form=await req.formData(),file=form.get('file');if(!(file instanceof File)||!file.size||file.size>10*1024*1024)throw new AppError('请选择不超过 10 MB 的原始 XLSX。');
  if(!/\.xlsx$/i.test(file.name))throw new AppError('此入口只接受度昂原版 XLSX。');
  const mode=form.get('mode')==='archived'?'archived':'active',bytes=await file.arrayBuffer(),parsed=await parseLedger(bytes,file.name,mode,m);
  const previous=all(s,'ledger_import').find(j=>j.hash===parsed.hash&&j.mode===mode);if(previous)return json(previous);
  // Original rows retain individual identities; ambiguous old keys never overwrite collaborative records.
  const existing=(all(s,'order') as Order[]).filter(o=>(o.lifecycle||'active')===mode),key=(o:Order)=>[o.orderNo,o.drawing,o.color,o.lens].join('|');
  const oldKeys=new Set(existing.map(key)),conflicts=parsed.rows.filter(o=>oldKeys.has(key(o))),rows=parsed.rows.filter(o=>!oldKeys.has(key(o)));
  const job={id:newId('ledger_import'),kind:'ledger_import',mode,filename:file.name.replace(/[\\/]/g,'_'),hash:parsed.hash,fileKey:newId('ledger_source'),rowsKey:newId('ledger_rows'),summary:{...parsed.summary,newRows:rows.length,heldRows:conflicts.length},sample:rows.slice(0,5).map(o=>({row:o.ledger!.sourceRow,orderNo:o.orderNo,productType:o.productType||o.ledger?.columns.W||'',drawing:o.drawing,quantity:o.quantity})),heldSample:conflicts.slice(0,10).map(o=>({row:o.ledger!.sourceRow,orderNo:o.orderNo})),offset:0,total:rows.length,status:'待确认',actorId:m.id,actor:m.name,createdAt:now()};
  await bucket().put(job.fileKey,bytes);await bucket().put(job.rowsKey,JSON.stringify(rows));await commit(s.revision,[job]);return json(job);
 }
 if(action==='ledger-commit'){
  pmc(m);const input=z.object({id:z.string(),offset:z.number().int().min(0)}).parse(await req.json()),job=all(s,'ledger_import').find(r=>r.id===input.id);if(!job)throw new AppError('导入批次不存在。');
  if(job.status==='已完成'||job.offset!==input.offset)return json(job);
  const blob=await bucket().get(job.rowsKey);if(!blob)throw new AppError('导入预览已失效。');const rows=await blob.json<Order[]>(),batch=rows.slice(job.offset,job.offset+35);
  for(const o of batch){if(s.records.some(r=>r.id===o.id))throw new AppError('明细已导入，请刷新批次。',409);if(s.records.some(r=>r.kind==='order'&&(r.lifecycle||'active')===job.mode&&r.ledger?.sourceHash!==job.hash&&[r.orderNo,r.drawing,r.color,r.lens].join('|')===[o.orderNo,o.drawing,o.color,o.lens].join('|')))throw new AppError('另一批次刚新增了相同订单组合，本批次暂停，请核对后重新导入。',409);}
  const next={...job,offset:job.offset+batch.length,status:job.offset+batch.length>=job.total?'已完成':'导入中',updatedAt:now()};
  await commit(s.revision,[...batch,next]);return json(next);
 }
 if(action==='ledger-edit'){
  const input=z.object({id:z.string(),version:z.number().int(),patch:z.record(z.string().max(3000)),reason:z.string().trim().min(2).max(1000)}).parse(await req.json()),o=getOrder(s,m,input.id);if(!departmentColumns(m,o).length)throw new AppError('未分配该部门录入权限。',403);if(!o.ledger)throw new AppError('此订单未采用原表工序结构。');if(o.version!==input.version)throw new AppError('该明细已由其他同事更新，请刷新后核对。',409);
  const next=applyLedgerPatch(o,m,input.patch);await commit(s.revision,[next,audit(m,next,o,'更新原表工序',input.reason)]);return json({ok:true});
 }
 if(action==='ledger-lifecycle'){
  pmc(m);const input=z.object({id:z.string(),version:z.number().int(),mode:z.enum(['active','archived']),reason:z.string().trim().min(3).max(1000),closedDate:z.string().default('')}).parse(await req.json()),o=getOrder(s,m,input.id);if(o.version!==input.version)throw new AppError('明细版本已改变，请刷新。',409);if((o.lifecycle||'active')===input.mode)return json({ok:true});
  if(input.mode==='active'&&o.quantity<=0)throw new AppError('原表调整行数量非正，须先核对源单，不能恢复为生产订单。');if(input.mode==='archived'&&!input.closedDate)throw new AppError('请填写实际结单日期。');if(input.closedDate)strictDate(input.closedDate);
  const next={...o,lifecycle:input.mode,closedDate:input.mode==='archived'?input.closedDate:o.closedDate,archiveReason:input.reason,archivedAt:input.mode==='archived'?now():o.archivedAt,version:o.version+1,updatedAt:now(),updatedBy:m.name};await commit(s.revision,[next,audit(m,next,o,input.mode==='archived'?'结单归档':'恢复在制',input.reason)]);return json({ok:true});
 }
 if(action==='ledger-assign'){
  pmc(m);const input=z.object({ownerName:z.string().min(1),email:z.string().email()}).parse(await req.json());if(!all(s,'member').some(u=>u.email===input.email&&u.active))throw new AppError('请先添加有效成员。');
  const matching=(all(s,'order') as Order[]).filter(o=>active(o)&&o.ledger?.ownerName===input.ownerName),pending=matching.filter(o=>o.ownerEmail!==input.email),rows=pending.slice(0,30);
  if(rows.length)await commit(s.revision,rows.flatMap(o=>{const next={...o,ownerEmail:input.email,version:o.version+1,updatedAt:now(),updatedBy:m.name};return [next,audit(m,next,o,'绑定跟单账号')];}));
  return json({ok:true,count:rows.length,total:matching.length,bound:matching.length-pending.length+rows.length,remaining:pending.length-rows.length});
 }
 if(action==='outsource-create'){
  if(!canCreateOutsource(m))throw new AppError('仅部门文员、PMC 或管理员可创建外发单。',403);
  const p=z.object({lineId:z.string(),supplier:z.string().trim().min(1).max(100),process:z.string(),quantity:z.number().int().positive().max(10000000),sentDate:z.string(),dueDate:z.string(),reference:z.string().trim().min(1).max(100),buyerEmail:z.string().email().optional(),note:z.string().max(2000).default(''),token:z.string().uuid()}).parse(await req.json());
  const o=getOrder(s,m,p.lineId);if(!mayReceive(m,o,p.process))throw new AppError('没有此工序外发权限。',403);if(!stageDefs.some(d=>d.id===p.process&&d.id!=='procurement'&&d.id!=='packing'))throw new AppError('请选择有效外发工序。');try{strictDate(p.sentDate);strictDate(p.dueDate);}catch(e){throw new AppError((e as Error).message);}if(!p.sentDate||!p.dueDate||p.dueDate<p.sentDate)throw new AppError('回货日期不能早于外发日期。');
  if(all(s,'outsource').some(r=>r.token===p.token))return json({ok:true,reused:true});if(all(s,'outsource').some(r=>r.status!=='已取消'&&clean(r.supplier).toUpperCase()===clean(p.supplier).toUpperCase()&&clean(r.reference).toUpperCase()===clean(p.reference).toUpperCase()&&r.lineId===p.lineId&&r.process===p.process))throw new AppError('相同供应商外发单 / 订单 / 工序已登记。');
  const buyer=all(s,'member').find(u=>u.email===(p.buyerEmail||m.email)&&u.active&&['admin','pmc'].includes(u.role));if(!buyer)throw new AppError('请选择有效的 PMC / 采购跟进人。');
  const master=all(s,'supplier').find(v=>clean(v.name).toUpperCase()===clean(p.supplier).toUpperCase());if(master?.active===false)throw new AppError('此供应商已停用，请由采购核对后启用。');
  const approverName=outsourceApprover(p.process,o.productType||o.ledger?.columns?.W||''),autoApproved=broad(m),item={...p,supplier:master?.name||p.supplier,id:newId('outsource'),kind:'outsource',originalDueDate:p.dueDate,buyerEmail:buyer.email,buyerName:buyer.name,latestNote:p.note,received:0,approvalStatus:autoApproved?'已审批':'待主管审批',approverName,approvedBy:autoApproved?m.name:'',approvedAt:autoApproved?now():'',actorId:m.id,actor:m.name,createdAt:now(),version:1};
  const updates:Entity[]=[item,audit(m,item,null,'登记外发')];if(!master){const supplier={id:newId('supplier'),kind:'supplier',name:p.supplier,contact:'',phone:'',notes:'',active:true,version:1,createdAt:now(),updatedAt:now(),updatedBy:m.name};updates.push(supplier,audit(m,supplier,null,'登记供应商'));}
  await commit(s.revision,updates);return json({ok:true,item});
 }
 if(action==='receipt-photo'){
  if(!['admin','pmc','production','clerk'].includes(m.role))throw new AppError('没有登记收货权限。',403);const form=await req.formData(),file=form.get('file');if(!(file instanceof File)||!file.size||file.size>10*1024*1024)throw new AppError('请上传不超过 10 MB 的送货单照片或 PDF。');
  const bytes=await file.arrayBuffer(),u=new Uint8Array(bytes);const type=u[0]===0xff&&u[1]===0xd8?'image/jpeg':u[0]===0x89&&u[1]===0x50?'image/png':u[0]===0x25&&u[1]===0x50&&u[2]===0x44&&u[3]===0x46?'application/pdf':String.fromCharCode(...u.slice(0,4))==='RIFF'&&String.fromCharCode(...u.slice(8,12))==='WEBP'?'image/webp':'';if(!type)throw new AppError('支持 JPG、PNG、WebP 图片及 PDF，请将 HEIC 转为 JPG。');
  const hash=await sha(bytes),prior=all(s,'receipt_photo').find(r=>r.hash===hash);if(prior){if(!broad(m)&&prior.actorId!==m.id)throw new AppError('这张送货单照片已由其他同事上传，请核对。');return json(prior);}
  const item={id:newId('photo'),kind:'receipt_photo',filename:file.name.replace(/[\\/]/g,'_'),fileKey:newId('receipt'),hash,contentType:type,actorId:m.id,actor:m.name,createdAt:now()};await bucket().put(item.fileKey,bytes);await commit(s.revision,[item]);return json(item);
 }
 if(action==='receipt-confirm'){
  const p=z.object({photoId:z.string(),supplier:z.string().trim().min(1).max(100),deliveryNo:z.string().trim().min(1).max(100),receivedDate:z.string(),note:z.string().max(2000),token:z.string().uuid(),lines:z.array(z.object({outsourceId:z.string(),accepted:z.number().int().min(0).max(10000000),rejected:z.number().int().min(0).max(10000000)})).min(1).max(20)}).parse(await req.json());
  if(all(s,'receipt').some(r=>r.token===p.token))return json({ok:true,reused:true});const photo=all(s,'receipt_photo').find(r=>r.id===p.photoId);if(!photo||(!broad(m)&&photo.actorId!==m.id))throw new AppError('请先上传你可访问的送货单照片。');strictDate(p.receivedDate);if(!p.receivedDate)throw new AppError('请填写收货日期。');
  if(all(s,'receipt').some(r=>r.status!=='已撤销'&&(r.photoId===photo.id||(r.supplier.toUpperCase()===p.supplier.toUpperCase()&&r.deliveryNo.toUpperCase()===p.deliveryNo.toUpperCase()))))throw new AppError('这张照片或供应商送货单号已入账，不能重复消数。');
  if(new Set(p.lines.map(l=>l.outsourceId)).size!==p.lines.length)throw new AppError('同一外发明细只能出现一次。');
  const updates:Entity[]=[],orderUpdates=new Map<string,Order>(),lines:any[]=[];
  for(const l of p.lines){const x=all(s,'outsource').find(r=>r.id===l.outsourceId);if(!x||x.supplier!==p.supplier)throw new AppError('外发单与供应商不一致。');if(x.status==='已取消')throw new AppError('此外发单已取消，不能继续收货。');if(x.approvalStatus&&x.approvalStatus!=='已审批')throw new AppError('此外发单尚未完成主管审批，不能办理收货。');const original=getOrder(s,m,x.lineId);if(!mayReceive(m,original,x.process))throw new AppError('没有此工序收货权限。',403);if(l.accepted+l.rejected<=0)throw new AppError('收货数量须大于零。');if(l.accepted>x.quantity-x.received)throw new AppError('合格收货超过外发余欠，请核对外发登记。');
   const o=orderUpdates.get(original.id)||original,def=stageDefs.find(d=>d.id===x.process)!;
   if(o.ledger&&l.accepted){const value=o.ledger.columns[def.done];if(value==='-'||(value&&countValue(value)===null))throw new AppError('对应工序标为不适用或数量无效，请先核对原表。');const c={...o.ledger.columns,[def.done]:String((countValue(value)||0)+l.accepted),[def.end]:p.receivedDate};Object.assign(c,automaticDates(c));const next={...o,ledger:{...o.ledger,columns:c},extra:{...o.extra,[`${def.done} · ${colLabels[def.done]}`]:c[def.done],[`${def.end} · ${colLabels[def.end]}`]:p.receivedDate},version:original.version+1,updatedAt:now(),updatedBy:m.name};orderUpdates.set(o.id,next);}
   const next={...x,received:x.received+l.accepted,version:x.version+1,updatedAt:now()};updates.push(next,audit(m,next,x,'供应商收货消数',p.deliveryNo));lines.push({...l,lineId:o.id,process:x.process,orderNo:o.orderNo,drawing:o.drawing,color:o.color,updatedProgress:!!o.ledger&&l.accepted>0});
  }
  for(const o of orderUpdates.values())updates.push(o,audit(m,o,getOrder(s,m,o.id),'供应商收货更新工序',p.deliveryNo));
  const item={...p,lines,id:newId('receipt'),kind:'receipt',status:'已入账',actorId:m.id,actor:m.name,createdAt:now()};updates.push(item);await commit(s.revision,updates);return json({ok:true});
 }
 return null;
}

