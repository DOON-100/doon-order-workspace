import {z} from 'zod';
import * as XLSX from 'xlsx';
import {all,broad,newId,now,strictDate,type State,type Member,type Entity} from './domain';
import {AppError,audit,bucket,commit,json} from './store';
import {parsePurchases} from './purchase-import';
import {purchaseHeaders,purchaseKey,visiblePurchases,filterPurchases,followFields,remaining,full,sourceClosed,purchaseStatus,roundQty,type Purchase} from './purchases';
const manage=(m:Member)=>{if(!broad(m))throw new AppError('权限受限：仅 PMC / 采购 Candy、Tina 和管理员可维护采购跟单。',403);};
function validDate(v:string){try{return strictDate(v);}catch(e){throw new AppError((e as Error).message);}}
function download(bytes:BodyInit,name:string){return new Response(bytes,{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(name)}`,'Cache-Control':'no-store'}});}
function excel(rows:Record<string,unknown>[],name:string,columns?:string[]){const book=XLSX.utils.book_new(),sheet=XLSX.utils.json_to_sheet(rows,{header:columns});sheet['!cols']=(columns||Object.keys(rows[0]||{})).map(k=>({wch:k.includes('备注')||k==='供应商'?36:20}));if(sheet['!ref'])sheet['!autofilter']={ref:sheet['!ref']};XLSX.utils.book_append_sheet(book,sheet,name);return XLSX.write(book,{type:'array',bookType:'xlsx'}) as ArrayBuffer;}
function exported(p:Purchase){return {...p.raw,'供应商复期':p.promisedDate,'预计到货':p.expectedDate,'下次催交':p.nextFollowupDate,'采购跟进备注':p.followupNote,'收货核对':p.balanceKnown?'已核对':'待核对','已收数量（净合格）':p.balanceKnown?p.received:'待核对','剩余数量（含退货待补）':remaining(p)??'待核对','退货待补数量':p.balanceKnown?p.returnPending:'待核对','齐货状态':full(p)?'已齐货':'未齐 / 待核对','跟进状态':purchaseStatus(p),'齐货日期':p.completedDate||'','存档时间':p.archivedAt||'','存档人':p.archivedBy||'','源表截至日期':p.sourceAsOf,'来源文件':p.sourceFile,'源表行号':p.sourceRow,'明细编号':p.id};}
export async function purchaseGet(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!action.startsWith('purchase-'))return null;
 const rows=visiblePurchases(s,m),url=new URL(req.url);
 if(action==='purchase-data')return json({rows,canEdit:broad(m),jobs:broad(m)?all(s,'purchase_import').slice(-8).reverse():[]});
 if(action==='purchase-history'){const p=rows.find(r=>r.id===url.searchParams.get('id'));if(!p)throw new AppError('此采购明细不在可查看范围。',403);return json({events:all(s,'purchase_event').filter(r=>r.purchaseId===p.id).reverse(),edits:all(s,'audit').filter(r=>r.targetId===p.id).slice(-50).reverse().map(r=>({id:r.id,action:r.action,actor:r.actor,createdAt:r.createdAt,source:r.source,before:r.before&&Object.fromEntries(Object.keys(followFields).map(k=>[k,r.before[k]])),after:r.after&&Object.fromEntries(Object.keys(followFields).map(k=>[k,r.after[k]]))}))});}
 if(action==='purchase-export'){const filters=Object.fromEntries(url.searchParams),filtered=filterPurchases(rows,filters);const columns=[...purchaseHeaders,...Object.keys(exported({raw:{}} as Purchase)).filter(k=>!purchaseHeaders.includes(k))];return download(excel(filtered.map(exported),'采购跟单总表',columns),`${filters.mode==='archived'?'供应商已交货档案':'采购跟单总表'}${filters.supplier?'_'+filters.supplier:''}.xlsx`);}
 if(action==='purchase-held'){manage(m);const job=all(s,'purchase_import').find(r=>r.id===url.searchParams.get('id'));if(!job)throw new AppError('找不到导入批次。');const blob=await bucket().get(job.rowsKey);if(!blob)throw new AppError('导入明细未找到。');const data=await blob.json<any>();return download(excel(data.held.map((r:any)=>({...r.row.raw,'源行':r.row.sourceRow,'暂缓原因':r.reason})),'待核对明细'),'采购导入待核对.xlsx');}
 return null;
}
async function post(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!action.startsWith('purchase-'))return null;manage(m);
 const existing=all(s,'purchase') as Purchase[],get=(id:string)=>{const p=existing.find(p=>p.id===id);if(!p)throw new AppError('采购明细不存在。',404);return p;};
 if(action==='purchase-preview'){
  const form=await req.formData(),file=form.get('file'),sourceAsOf=validDate(String(form.get('sourceAsOf')||''));if(!sourceAsOf)throw new AppError('请填写金蝶导出截至日期。');
  if(!(file instanceof File)||!file.size||file.size>10*1024*1024||!file.name.toLowerCase().endsWith('.xlsx'))throw new AppError('请选择不超过 10 MB 的金蝶采购跟踪 XLSX。');
  const parsed=await parsePurchases(await file.arrayBuffer(),file.name,sourceAsOf),prior=all(s,'purchase_import').find(j=>j.hash===parsed.hash);if(prior)return json(prior);
  const counts=new Map<string,number>();for(const p of parsed.rows)counts.set(purchaseKey(p),(counts.get(purchaseKey(p))||0)+1);
  const changes:any[]=[],held:any[]=[];
  for(const row of parsed.rows){const matches=existing.filter(p=>purchaseKey(p)===purchaseKey(row));let reason='';
   if(matches.length&&(matches.length!==1||counts.get(purchaseKey(row))!==1))reason='同采购单 / 商品 / 客户单有多行，不能自动覆盖，请按源行核对';
   const old=matches[0];if(old&&!reason&&sourceAsOf<old.sourceAsOf)reason='导出日期早于当前来源，防止旧表覆盖';
   if(old&&!reason&&old.balanceKnown&&(row.unit!==old.unit||row.quantity<old.received||row.quantity-old.received<old.returnPending||(old.lifecycle==='archived'&&row.quantity!==old.quantity)))reason='已登记收货或存档，源数量 / 单位改变需要人工核对';
   if(reason)held.push({row,reason});else changes.push({row,id:old?.id||row.id,expectedSourceVersion:old?.sourceVersion||0});
  }
  const job={id:newId('purchase_import'),kind:'purchase_import',hash:parsed.hash,filename:file.name,sourceAsOf,sourceFilter:parsed.sourceFilter,rowsKey:newId('purchase_rows'),fileKey:newId('purchase_file'),total:changes.length,offset:0,status:changes.length?'待确认':'已完成',summary:{sourceRows:parsed.rows.length,orders:new Set(parsed.rows.map(r=>r.po)).size,suppliers:new Set(parsed.rows.map(r=>r.supplier)).size,newRows:changes.filter(r=>!r.expectedSourceVersion).length,updateRows:changes.filter(r=>r.expectedSourceVersion).length,heldRows:held.length},sample:changes.slice(0,5).map(r=>({row:r.row.sourceRow,po:r.row.po,supplier:r.row.supplier,itemName:r.row.itemName})),actor:m.name,createdAt:now()};
  await bucket().put(job.rowsKey,JSON.stringify({changes,held}));await bucket().put(job.fileKey,await file.arrayBuffer());await commit(s.revision,[job]);return json(job);
 }
 if(action==='purchase-commit'){
  const input=z.object({id:z.string(),offset:z.number().int().min(0)}).parse(await req.json()),job=all(s,'purchase_import').find(r=>r.id===input.id);if(!job)throw new AppError('批次不存在。');if(job.status==='已完成'||job.offset!==input.offset)return json(job);
  const blob=await bucket().get(job.rowsKey);if(!blob)throw new AppError('导入文件未找到。');const plan=await blob.json<any>(),batch=plan.changes.slice(job.offset,job.offset+40),updates:Entity[]=[];
  for(const change of batch){const p=change.row as Purchase,old=existing.find(r=>r.id===change.id);
   if(change.expectedSourceVersion){if(!old||old.sourceVersion!==change.expectedSourceVersion)throw new AppError('源数据已由其他导入更新，请重新核对批次。',409);
    if(old.balanceKnown&&(p.unit!==old.unit||p.quantity<old.received||p.quantity-old.received<old.returnPending||(old.lifecycle==='archived'&&p.quantity!==old.quantity)))throw new AppError('预览后收货发生变化，请核对源数量后重新上传。',409);
    const next={...old,...Object.fromEntries(['po','supplier','buyer','itemCode','itemName','unit','quantity','orderDate','dueDate','customerOrder','auditStatus','closeStatus','sourceNote','sourceRow','sourceAsOf','sourceHash','sourceFile','sourceSheet','sourceFilter','raw'].map(k=>[k,p[k]])),version:old.version+1,sourceVersion:old.sourceVersion+1,updatedAt:now(),updatedBy:m.name};updates.push(next,audit(m,next,old,'更新金蝶采购来源',job.filename));
   }else{if(old||existing.some(r=>purchaseKey(r)===purchaseKey(p)&&r.sourceHash!==job.hash))throw new AppError('其他批次已新增相同采购组合，请重新核对。',409);updates.push({...p,updatedBy:m.name});}
  }
  const next={...job,offset:job.offset+batch.length,status:job.offset+batch.length>=job.total?'已完成':'导入中',updatedAt:now()};await commit(s.revision,[...updates,next]);return json(next);
 }
 if(action==='purchase-save'){
  const input=z.object({changes:z.array(z.object({id:z.string(),version:z.number().int().positive(),field:z.enum(['promisedDate','expectedDate','nextFollowupDate','followupNote']),value:z.string().max(3000)})).min(1).max(100)}).parse(await req.json()),updates=new Map<string,Purchase>();
  for(const c of input.changes){const p=get(c.id);if(p.lifecycle==='archived'||sourceClosed(p))throw new AppError('存档或金蝶已关闭的采购单仅可查看。',409);const v=c.field==='followupNote'?c.value.trim():validDate(c.value);const base=p.version===c.version?p:all(s,'audit').find(a=>a.targetId===p.id&&a.before?.version===c.version)?.before;if(!base)throw new AppError('版本已变，请刷新后核对。',409);if(p[c.field]!==base[c.field]&&p[c.field]!==v)throw new AppError(`${followFields[c.field]}已被同事修改，本次输入未保存，请刷新核对。`,409);updates.set(p.id,{...(updates.get(p.id)||p),[c.field]:v,version:p.version+1,updatedAt:now(),updatedBy:m.name});}
  await commit(s.revision,[...updates.values()].flatMap(p=>[p,audit(m,p,get(p.id),'编辑采购跟进单元格')]));return json({rows:[...updates.values()]});
 }
 if(action==='purchase-receipt'){
  const p=z.object({id:z.string(),version:z.number().int(),type:z.enum(['opening','receipt','return','replacement','correction']),quantity:z.number().finite().min(0).max(1e9),returnPending:z.number().finite().min(0).max(1e9).optional(),date:z.string(),reference:z.string().trim().min(2).max(120),note:z.string().trim().min(2).max(3000),token:z.string().uuid()}).parse(await req.json());
  const duplicate=all(s,'purchase_event').find(e=>e.token===p.token);if(duplicate){if(duplicate.purchaseId!==p.id)throw new AppError('重复请求标识不一致。');return json({row:get(p.id),reused:true});}
  const old=get(p.id);if(old.version!==p.version)throw new AppError('这条明细已更新，请关闭窗口刷新后重新核对。',409);const date=validDate(p.date);if(!date)throw new AppError('请填写业务日期。');
  if(sourceClosed(old)||old.auditStatus!=='已审核')throw new AppError('金蝶已关闭或未审核的订单须先在金蝶核对状态，再导入更新。');
  if(old.lifecycle==='archived'&&p.type!=='return')throw new AppError('已交货档案只允许登记实际退货，退货后自动恢复跟进。');
  if(all(s,'purchase_event').some(e=>e.purchaseId===p.id&&e.type===p.type&&e.reference===p.reference))throw new AppError('此明细的同类凭证已登记，请核对历史，勿重复入账。',409);
  for(const q of [p.quantity,p.returnPending||0])if(Math.abs(q*10000-Math.round(q*10000))>0.01)throw new AppError('数量最多四位小数。');
  let received=old.received,pending=old.returnPending;
  if(p.type==='opening'||p.type==='correction'){
   if(p.type==='opening'&&old.balanceKnown)throw new AppError('已有核对基数，请使用核对更正并说明依据。');if(p.type==='correction'&&!old.balanceKnown)throw new AppError('请先核对初始已收数量。');received=p.quantity;pending=p.returnPending||0;
  }else{
   if(!old.balanceKnown)throw new AppError('先核对历史已收和退货待补数量，才能继续登记。');if(p.quantity<=0)throw new AppError('本次数量必须大于零。');
   if(p.type==='return'){if(p.quantity>received)throw new AppError('退货数不能超过已收合格数。');received-=p.quantity;pending+=p.quantity;}
   if(p.type==='receipt'){if(p.quantity>old.quantity-received-pending+0.00001)throw new AppError('普通收货不能占用退货待补数；补货请选择“退货补回”。');received+=p.quantity;}
   if(p.type==='replacement'){if(p.quantity>pending)throw new AppError('补回数量不能超过退货待补数。');received+=p.quantity;pending-=p.quantity;}
  }
  received=roundQty(received);pending=roundQty(pending);if(received<0||received>old.quantity||pending<0||pending>roundQty(old.quantity-received))throw new AppError('已收不能超过采购数量，退货待补不能超过剩余数量。');
  const next={...old,received,returnPending:pending,balanceKnown:true,lifecycle:'active' as const,completedDate:'',archivedAt:'',archivedBy:'',archiveNote:'',version:old.version+1,updatedAt:now(),updatedBy:m.name};
  const names={opening:'核对初始数量',receipt:'采购收货',return:'退货待补',replacement:'退货补回',correction:'更正收货基数'},event={...p,id:newId('purchase_event'),kind:'purchase_event',purchaseId:old.id,actor:m.name,actorId:m.id,createdAt:now(),date,before:{known:old.balanceKnown,received:old.received,returnPending:old.returnPending,lifecycle:old.lifecycle},after:{received,pending,remaining:remaining(next)},event:names[p.type]};
  await commit(s.revision,[next,event,audit(m,next,old,names[p.type],p.reference+' · '+p.note)]);return json({row:next});
 }
 if(action==='purchase-archive'){
  const p=z.object({items:z.array(z.object({id:z.string(),version:z.number().int()})).min(1).max(100),date:z.string(),note:z.string().trim().min(2).max(1000)}).parse(await req.json()),date=validDate(p.date);if(!date)throw new AppError('请填写齐货日期。');if(new Set(p.items.map(i=>i.id)).size!==p.items.length)throw new AppError('明细重复。');const updates:Entity[]=[];
  for(const i of p.items){const old=get(i.id);if(old.version!==i.version)throw new AppError('数量或跟进已变，请重新核对后存档。',409);if(old.lifecycle==='archived'||!full(old)||sourceClosed(old)||old.auditStatus!=='已审核')throw new AppError('仅已审核、已核对齐货、无退货待补的在跟明细可存档。');const next={...old,lifecycle:'archived',completedDate:date,archivedAt:now(),archivedBy:m.name,archiveNote:p.note,version:old.version+1,updatedAt:now(),updatedBy:m.name};updates.push(next,audit(m,next,old,'确认已齐货并存档',p.note));}
  await commit(s.revision,updates);return json({ok:true,count:p.items.length});
 }
 return null;
}
export async function purchasePost(action:string,req:Request,s:State,m:Member){try{return await post(action,req,s,m);}catch(e){if(e instanceof z.ZodError)throw new AppError('请完整填写有效的数量、日期、单据号和核对说明。');throw e;}}
