import {commitImport} from '@/lib/import-commit';
import {warehouse,balance,currentStage,ownerLabel} from '@/lib/ledger';
import {departmentColumns} from '@/lib/departments';
import {operationGet,operationPost} from '@/lib/operations';
import {syncFollowColumns} from '@/lib/ledger-edit';
import {orderExportExtras} from '@/lib/order-export';
import {z} from 'zod';
import {actor,audit,AppError,bucket,commit,enroll,failure,json,sameOrigin,snapshot} from '@/lib/store';
import {all,allowedFields,broad,readsAllOrders,roles,businessKey,canRead,clean,email,fields,fieldLabels,mergeFields,newId,normalizeField,now,packed,productTypeOf,progress,validApproval,type Entity,type Member,type Order,type Report,type State,type PreviewRow} from '@/lib/domain';
import {makeWorkbook,openWorkbook,previewOrders,previewReports,sha,sheetRows,suggestMapping,isOriginalLedger,detectHeader} from '@/lib/workbooks';
import {canSeeSupplierPrice} from '@/lib/suppliers';
import {customerQuoteGet,customerQuotePost} from '@/lib/customer-quote-api';
import {serviceWorkspaceGet,serviceWorkspacePost} from '@/lib/service-workspace-api';
import {canReadServiceRecord} from '@/lib/service-workspace';
import {collaborationAssignments} from '@/lib/collaboration-api';
import {canUseCustomerQuotes,canReadCustomerQuote,type CustomerQuote} from '@/lib/customer-quotes';
export const dynamic='force-dynamic';
type Context={params:Promise<{action:string}>};
function requireAdmin(m:Member){if(m.role!=='admin')throw new AppError('此操作需要管理员权限。',403);}
function requirePMC(m:Member){if(!broad(m))throw new AppError('此操作需要 PMC 或管理员权限。',403);}
function line(s:State,m:Member,id:string){const o=s.records.find(r=>r.id===id&&r.kind==='order') as Order|undefined;if(!o||!canRead(m,o))throw new AppError('没有此订单明细的访问权限。',403);return o;}
function visible(s:State,m:Member){return (all(s,'order') as Order[]).filter(o=>canRead(m,o));}
function visibleWorkspaceAudit(s:State,m:Member,record:Entity,orderIds:Set<string>){
 const target=s.records.find(v=>v.id===record.targetId),parts=[target,record.before,record.after].filter(Boolean);
 if(parts.some(v=>typeof v.kind==='string'&&v.kind.startsWith('service_'))){
  const serviceRecord=target?.kind==='service_record'?target:s.records.find(v=>v.kind==='service_record'&&v.id===target?.recordId);
  if(!serviceRecord||!canReadServiceRecord(s,m,serviceRecord))return false;
  return parts.every(v=>v.kind==='service_record'?canReadServiceRecord(s,m,v):v.kind==='service_revision'?!!v.snapshot&&canReadServiceRecord(s,m,v.snapshot):!v.customerId||canReadServiceRecord(s,m,{...serviceRecord,customerId:v.customerId}));
 }
 if(!parts.some(v=>typeof v.kind==='string'&&v.kind.startsWith('customer_quote')))return broad(m)||orderIds.has(record.lineId);
 if(m.role==='admin')return true;
 if(parts.some(v=>v.kind==='customer_quote_access'))return false;
 const quote=target?.kind==='customer_quote'?target:s.records.find(v=>v.kind==='customer_quote'&&v.id===target?.quoteId);
 if(!quote||!canReadCustomerQuote(s,m,quote as CustomerQuote))return false;
 return parts.every(v=>v.kind==='customer_quote'?canReadCustomerQuote(s,m,v as CustomerQuote):v.kind==='customer_quote_revision'?!!v.snapshot&&canReadCustomerQuote(s,m,v.snapshot):false);
}
function filterOrders(orders:Order[],reports:Report[],m:Member,f:Record<string,string>){return orders.filter(o=>{
 const q=clean(f.q).toLowerCase();return o.lifecycle!=='archived'&&(!q||[o.orderNo,o.customer,o.customerPO,o.drawing,o.color,o.lens,productTypeOf(o)].some(v=>v.toLowerCase().includes(q)))&&(!f.customer||o.customer===f.customer)&&(!f.owner||o.ownerEmail===f.owner||ownerLabel(o)===f.owner)&&(!f.mine||o.ownerEmail===m.email)&&(!f.status|| (f.status==='unfinished'?(balance(o,reports)??o.quantity)>0:f.status==='packed'?(balance(o,reports)??o.quantity)<=0: f.status==='late'?!!o.requestedDate&&o.requestedDate<new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'})&&(balance(o,reports)??o.quantity)>0:true));});}
function validatePatch(input:unknown){if(!input||typeof input!=='object'||Array.isArray(input))throw new AppError('字段内容无效。');const patch:Record<string,any>={};for(const [k,v] of Object.entries(input)){if(!fields.some(([key])=>key===k))throw new AppError('不支持的修改字段。');try{patch[k]=normalizeField(k,v);}catch(e){throw new AppError(`${fieldLabels[k]}：${(e as Error).message}`);}}return patch;}
function fileResponse(bytes:BodyInit,name:string,type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'){return new Response(bytes,{headers:{'Content-Type':type,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(name)}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
export async function GET(req:Request,ctx:Context){try{
 const {action}=await ctx.params,s=await snapshot(),m=await actor(s),url=new URL(req.url),orders=visible(s,m),ids=new Set(orders.map(o=>o.id));
 const quotation=await customerQuoteGet(action,req,s,m);if(quotation)return quotation;
 const service=await serviceWorkspaceGet(action,req,s,m);if(service)return service;
 const operation=await operationGet(action,req,s,m);if(operation)return operation;
 if(action==='data')return json({collaborationAssignments:collaborationAssignments(s,m),customerQuoteAccess:canUseCustomerQuotes(s,m),customerAccounts:all(s,'customer_account'),collaborationTemplates:all(s,'collaboration_template').map(({fileKey,...r})=>r),losses:all(s,'loss').filter(r=>ids.has(r.lineId)),suppliers:all(s,'supplier').filter(v=>readsAllOrders(m)||all(s,'outsource').some(x=>ids.has(x.lineId)&&x.supplier===v.name)),supplierQuotes:canSeeSupplierPrice(m)?all(s,'supplier_quote'):[],supplierFollowups:all(s,'supplier_followup').filter(v=>ids.has(v.lineId)),ledgerImports:all(s,'ledger_import').filter(r=>broad(m)),outsource:all(s,'outsource').filter(r=>ids.has(r.lineId)),receipts:all(s,'receipt').filter(r=>r.lines.some((l:any)=>ids.has(l.lineId))).map(r=>({...r,lines:r.lines.filter((l:any)=>ids.has(l.lineId))})),me:m,revision:s.revision,orders,reports:all(s,'report').filter(r=>readsAllOrders(m)||ids.has(r.lineId)),members:all(s,'member').map(u=>m.role==='admin'?u:{id:u.id,name:u.name,email:u.email,active:u.active,role:u.role}),comments:all(s,'comment').filter(r=>ids.has(r.lineId)),corrections:all(s,'correction').filter(r=>ids.has(r.lineId)),attachments:all(s,'attachment').filter(r=>ids.has(r.lineId)),imports:all(s,'import').filter(r=>broad(m)||r.actorId===m.id).map(({rows,...r})=>({...r,counts:Object.fromEntries(['new','update','conflict','skip','error'].map(k=>[k,rows.filter((r:PreviewRow)=>r.status===k).length]))})).reverse(),audits:all(s,'audit').filter(r=>visibleWorkspaceAudit(s,m,r,ids)).slice(-250).reverse(),exports:all(s,'export').filter(r=>r.actorId===m.id||broad(m)).map(({lines,...r})=>r).reverse(),asOf:now(),integration:{mode:'file',mesConnected:false,kingdeeConnected:false}});
 if(action==='job'){const job=s.records.find(r=>r.id===url.searchParams.get('id')&&r.kind==='import');if(!job||(job.actorId!==m.id&&!broad(m)))throw new AppError('无权访问导入批次。',403);return json(job);}
 if(action==='file'){
  const file=s.records.find(r=>r.id===url.searchParams.get('id')&&['attachment','import','export'].includes(r.kind));if(!file)throw new AppError('文件不存在。',404);
  if(file.kind==='attachment')line(s,m,file.lineId);else if(file.actorId!==m.id&&!broad(m))throw new AppError('无权下载该文件。',403);
  if(file.kind==='export'&&!broad(m))for(const id of file.orderIds||[])line(s,m,id);
  const blob=await bucket().get(file.fileKey);if(!blob)throw new AppError('文件暂不可用。',404);return fileResponse(blob.body,file.filename,file.contentType||'application/octet-stream');
 }
 if(action==='template'){
  const mes=url.searchParams.get('type')==='mes',columns=mes?['报工编号','订单号','图纸编号','圈色','镜片类型','良品数','报工时间','审批状态','工单号','生产任务号','生产批号']:fields.map(([,label])=>label);
  return fileResponse(makeWorkbook([],mes?'包装报工':'订单明细',columns),mes?'MES包装报工整理模板.xlsx':'PMC订单导入模板.xlsx');
 }
 if(action==='backup'){requireAdmin(m);const data={format:'doon-workspace-snapshot-v1',createdAt:now(),revision:s.revision,records:s.records,note:'结构化数据快照。原始工作表和附件保存在文件存储，需分别保留；恢复前需校验文件与账号映射。'};return fileResponse(JSON.stringify(data,null,2),'订单中台数据快照.json','application/json');}
 throw new AppError('接口不存在。',404);
}catch(e){return failure(e);}}
export async function POST(req:Request,ctx:Context){try{
 sameOrigin(req);const {action}=await ctx.params;let s=await snapshot();
 if(action==='enroll'){await enroll(s);return json({ok:true});}
 const m=await actor(s);const quotation=await customerQuotePost(action,req,s,m);if(quotation)return quotation;const service=await serviceWorkspacePost(action,req,s,m);if(service)return service;if(['finance','programmer'].includes(m.role)&&action!=='export')throw new AppError('此角色仅可查询与导出授权报表，不能修改业务数据。',403);const operation=await operationPost(action,req,s,m);if(operation)return operation;
 if(['inspect','preview','attachment'].includes(action)){
  const form=await req.formData(),file=form.get('file');if(!(file instanceof File)||!file.size)throw new AppError('请选择非空文件。');if(file.size>10*1024*1024)throw new AppError('文件不能超过 10 MB。');
  const bytes=await file.arrayBuffer(),filename=file.name.replace(/[\\/\r\n]/g,'_').slice(0,180);
  if(action==='attachment'){
   const o=line(s,m,clean(form.get('lineId')));if(!allowedFields(m,o).length)throw new AppError('没有添加附件权限。',403);
   if(!/\.(pdf|xlsx|xls|csv|png|jpg|jpeg|webp|docx)$/i.test(filename))throw new AppError('附件支持 PDF、Excel、图片和 DOCX。');
   const item={id:newId('file'),kind:'attachment',lineId:o.id,filename,fileKey:newId('attachment'),actorId:m.id,actor:m.name,size:file.size,createdAt:now(),contentType:'application/octet-stream'};
   await bucket().put(item.fileKey,bytes);await commit(s.revision,[item,audit(m,item,null,'添加附件')]);return json({ok:true});
  }
  if(!['admin','pmc','clerk','sales'].includes(m.role))throw new AppError('权限受限：业务、客服、PMC 或管理员可上传订单表。',403);
  if(!/\.(xlsx|xls|csv)$/i.test(filename))throw new AppError('请上传 XLSX、XLS 或 CSV 工作表。');
  const book=openWorkbook(bytes),original=form.get('type')!=='mes'&&isOriginalLedger(book),sheetName=clean(form.get('sheet'))||(original?'动态表':book.SheetNames[0]),header=clean(form.get('header'))?Number(form.get('header')):(original?3:detectHeader(book,sheetName)),parsed=sheetRows(book,sheetName,header);
  if(action==='preview'&&original)throw new AppError('已识别度昂原版工作簿，请使用“度昂原版工作簿导入”，由系统自动分批。');
  if(action==='inspect')return json({format:original?'doon-ledger':'standard',sheets:book.SheetNames,sheet:sheetName,header,headers:parsed.headers,rowCount:parsed.body.length,mapping:suggestMapping(parsed.headers),sample:parsed.body.slice(0,3)});
  let map:Record<string,string>,lensMap:Record<string,string>;try{map=z.record(z.string().max(200)).parse(JSON.parse(clean(form.get('mapping'))||'{}'));lensMap=z.record(z.string().max(50)).parse(JSON.parse(clean(form.get('lensMapping'))||'{}'));}catch{throw new AppError('字段映射无效。');}
  const kind=form.get('type')==='mes'?'mes':'orders';
  const rows=kind==='mes'?await previewReports(s,m,book,sheetName,header,lensMap,filename):await previewOrders(s,m,book,sheetName,header,map,filename);
  const job={id:newId('import'),kind:'import',importType:kind,filename,hash:await sha(bytes),sheet:sheetName,header,mapping:map,lensMapping:lensMap,rows,actorId:m.id,actor:m.name,createdAt:now(),status:'待确认',fileKey:newId('source'),contentType:'application/octet-stream'};
  await bucket().put(job.fileKey,bytes);await commit(s.revision,[job]);return json(job);
 }
 const body=await req.json();
 if(action==='commit-import')return await commitImport(body,s,m);
 if(action==='edit-order'){
  const input=z.object({id:z.string(),version:z.number().int(),patch:z.record(z.unknown())}).parse(body),o=line(s,m,input.id),patch=validatePatch(input.patch),permitted=allowedFields(m,o);
  for(const k of Object.keys(patch))if(!permitted.includes(k))throw new AppError(`无权在线修改${fieldLabels[k]}；正式订单信息请从金蝶源单更正后导入。`,403);
  if(patch.ownerEmail&&!all(s,'member').some(u=>u.email===patch.ownerEmail&&u.active))throw new AppError('负责人必须是有效成员。');
  let base=o;if(o.version!==input.version){const revisions=all(s,'audit').filter(a=>a.lineId===o.id).flatMap(a=>[a.before,a.after]);base=revisions.find(x=>x?.kind==='order'&&x.version===input.version);if(!base)throw new AppError('原版本已过期，请刷新详情。',409);}
  const {next,conflicts}=mergeFields(o,base,patch);if(conflicts.length)throw new AppError(`以下字段已被修改：${conflicts.map(k=>fieldLabels[k]).join('、')}。请刷新详情并核对。`,409);
  if(next.promiseConfirmed&&!next.promisedDate)throw new AppError('请先填写回复交期。');
  if(JSON.stringify({...next,version:0})===JSON.stringify({...o,version:0}))return json({ok:true,unchanged:true});
  Object.assign(next,{version:o.version+1,updatedAt:now(),updatedBy:m.name});const synced=syncFollowColumns(next);await commit(s.revision,[synced,audit(m,synced,o,'更新订单跟进')]);return json({ok:true});
 }
 if(action==='comment'){
  const input=z.object({lineId:z.string(),text:z.string().trim().min(1).max(3000),dueDate:z.string().default('')}).parse(body),o=line(s,m,input.lineId);if(!allowedFields(m,o).length&&!departmentColumns(m,o).length)throw new AppError('没有跟进权限。',403);
  const item={id:newId('comment'),kind:'comment',lineId:o.id,text:input.text,dueDate:normalizeField('plannedDate',input.dueDate),done:false,actorId:m.id,actor:m.name,createdAt:now()};await commit(s.revision,[item,audit(m,item,null,'添加跟进')]);return json({ok:true});
 }
 if(action==='task'){
  const input=z.object({id:z.string(),done:z.boolean()}).parse(body),item=s.records.find(r=>r.id===input.id&&r.kind==='comment');if(!item)throw new AppError('跟进事项不存在。');const o=line(s,m,item.lineId);if(!allowedFields(m,o).length&&!departmentColumns(m,o).length)throw new AppError('没有跟进权限。',403);const next={...item,done:input.done,completedBy:m.name,completedAt:now()};await commit(s.revision,[next,audit(m,next,item,'更新待办状态')]);return json({ok:true});
 }
 if(action==='member'){
  requireAdmin(m);const input=z.object({id:z.string().optional(),name:z.string().trim().min(1).max(100),email:z.string().email(),role:z.enum(roles),orderScope:z.enum(['all','assigned']).optional(),customers:z.array(z.string().trim().min(1).max(100)).max(200),departments:z.array(z.enum(['pmc','titanium','outsourcing','plating','semifinished','plastic','finished'])).default([]),active:z.boolean()}).parse(body);
  const existing=input.id?s.records.find(r=>r.id===input.id&&r.kind==='member'):undefined;if(input.id&&!existing)throw new AppError('成员不存在。');
  if(existing?.owner&&(!input.active||input.role!=='admin'||email(input.email)!==existing.email))throw new AppError('初始管理员的角色、邮箱和启用状态不可在此更改。');
  if(existing&&email(input.email)!==existing.email)throw new AppError('已建立成员不能更换邮箱，请新增成员。');
  if(all(s,'member').some(u=>u.email===email(input.email)&&u.id!==existing?.id))throw new AppError('此邮箱已存在。');
  const item={...existing,...input,id:existing?.id||newId('member'),kind:'member',email:email(input.email),userId:existing?.userId||'',createdAt:existing?.createdAt||now()};await commit(s.revision,[item,audit(m,item,existing||null,'更新成员权限')]);return json({ok:true});
 }
 if(action==='match'){
  requirePMC(m);const input=z.object({reportId:z.string(),lineId:z.string(),version:z.number().int(),reason:z.string().trim().min(3).max(1000)}).parse(body),r=s.records.find(x=>x.id===input.reportId&&x.kind==='report');if(!r)throw new AppError('报工不存在。');if(r.version!==input.version)throw new AppError('报工版本已改变，请刷新。',409);const o=line(s,m,input.lineId);
  if([r.orderNo,r.drawing,r.color].map(clean).join('|').toUpperCase()!==[o.orderNo,o.drawing,o.color].map(clean).join('|').toUpperCase())throw new AppError('订单号、图号或圈色不符，不能强行关联。');
  const next={...r,lineId:o.id,lens:o.lens,version:r.version+1,updatedAt:now(),updatedBy:m.name};await commit(s.revision,[next,audit(m,next,r,'人工关联报工',input.reason)]);return json({ok:true});
 }
 if(action==='correction'){
  const input=z.object({reportId:z.string(),quantity:z.number().int().min(0).max(10000000),reason:z.string().trim().min(3).max(3000)}).parse(body),r=s.records.find(x=>x.id===input.reportId&&x.kind==='report');if(!r?.lineId)throw new AppError('请先关联订单再提交更正。');const o=line(s,m,r.lineId);if(!allowedFields(m,o).length)throw new AppError('没有更正申请权限。',403);if(r.quantity===input.quantity)throw new AppError('建议数量与当前数量相同。');
  const item={id:newId('correction'),kind:'correction',lineId:o.id,reportId:r.id,reportVersion:r.version,before:r.quantity,proposed:input.quantity,reason:input.reason,status:'待审核',actorId:m.id,actor:m.name,createdAt:now()};await commit(s.revision,[item,audit(m,item,null,'提交 MES 更正申请')]);return json({ok:true});
 }
 if(action==='review'){
  requirePMC(m);const input=z.object({id:z.string(),decision:z.enum(['approve','reject','verify']),note:z.string().trim().min(3).max(1000)}).parse(body),item=s.records.find(x=>x.id===input.id&&x.kind==='correction');if(!item)throw new AppError('更正申请不存在。');const r=s.records.find(x=>x.id===item.reportId&&x.kind==='report');
  if(input.decision==='verify'){if(item.status!=='待 MES 人工处理')throw new AppError('此申请尚未进入 MES 处理阶段。');if(!r||r.version<=item.reportVersion||r.quantity!==item.proposed||!validApproval(r as Report))throw new AppError('导入报工尚未与建议值一致且通过审批。请在 MES 更正后重新导入，不能直接标记完成。');}
  else{if(item.status!=='待审核')throw new AppError('此申请已审核，请刷新。',409);if(input.decision==='approve'&&r?.version!==item.reportVersion)throw new AppError('报工已发生变化，请重新核对并提交申请。',409);}
  const next={...item,status:input.decision==='approve'?'待 MES 人工处理':input.decision==='reject'?'已驳回':'导出回读已核验',reviewer:m.name,reviewedAt:now(),reviewNote:input.note};await commit(s.revision,[next,audit(m,next,item,'审核 / 核验 MES 更正')]);return json({ok:true});
 }
 if(action==='export'){
  const input=z.object({type:z.enum(['working','summary','customer','completion','progress']),filters:z.record(z.string()).default({})}).parse(body);
  const allReports=all(s,'report') as Report[],orders=filterOrders(visible(s,m),allReports,m,input.filters),ids=new Set(orders.map(o=>o.id));const exportId=newId('export'),createdAt=now();
  let rows:Record<string,any>[],title:string;
  if(input.type==='completion'){
   title='包装完工明细';rows=allReports.filter(r=>ids.has(r.lineId)&&validApproval(r)&&(!input.filters.from||r.reportedAt.slice(0,10)>=input.filters.from)&&(!input.filters.to||r.reportedAt.slice(0,10)<=input.filters.to)).map(r=>{const o=orders.find(o=>o.id===r.lineId)!;return {'客户':o.customer,'订单号':o.orderNo,'产品类型':productTypeOf(o),'图纸编号':o.drawing,'色号':o.color,'镜片类型':o.lens,'交货批次':o.batch,'报工编号':r.nativeId||r.id,'工单号':r.workOrder,'良品数':r.quantity,'报工时间':r.reportedAt,'审批状态':r.approval,'来源文件':r.source,'数据截止时间':createdAt};});
  }else if(input.type==='customer'||input.type==='progress'){
   title=input.type==='customer'?'客户交期回复表':'客户订单进度表';rows=orders.map(o=>({'客户':o.customer,'客户 PO':o.customerPO,'订单号':o.orderNo,'产品类型':productTypeOf(o),'图纸编号':o.drawing,'色号':o.color,'镜片类型':o.lens,'交货批次':o.batch,'订单数量':o.quantity,'客户要求交期':o.requestedDate,'已确认回复交期':o.promiseConfirmed?o.promisedDate:'待确认','包装完成数量':packed(o,allReports),'包装入仓数量':warehouse(o)??'未记录','剩余数量':Math.max(0,balance(o,allReports)??o.quantity),'分批交货安排':o.arrangement,'对客备注':o.customerNote,'数据截止时间':createdAt,'回复版本':exportId}));
  }else if(input.type==='working'){
   if(['viewer','finance','programmer'].includes(m.role))throw new AppError('此角色可导出查询报表，不能导出可回传工作表。',403);
   title='订单工作表';rows=orders.map(o=>({...Object.fromEntries(fields.map(([k,l])=>[l,k==='promiseConfirmed'?(o[k]?'是':'否'):k==='productType'?productTypeOf(o):o[k]])),...orderExportExtras(o),'_明细编号':o.id,'_版本':o.version,'_导出批次':exportId}));
  }else{title='订单进度汇总';rows=orders.map(o=>({'订单号':o.orderNo,'客户':o.customer,'产品类型':productTypeOf(o),'图纸编号':o.drawing,'色号':o.color,'镜片类型':o.lens,'交货批次':o.batch,'负责人邮箱':o.ownerEmail,'订单数量':o.quantity,'包装完成数量':packed(o,allReports),'包装入仓数量':warehouse(o)??'未记录','剩余数量':Math.max(0,balance(o,allReports)??o.quantity),'状态':o.ledger?currentStage(o):progress(o,allReports),'客户要求交期':o.requestedDate,'数据截止时间':createdAt}));}
  const bytes=makeWorkbook(rows,title,rows.length?undefined:['当前筛选无数据']),filename=`${title}_${createdAt.slice(0,10)}.xlsx`,fileKey=newId('exportfile');
  await bucket().put(fileKey,bytes);await commit(s.revision,[{id:exportId,kind:'export',reportType:input.type,filename,fileKey,actorId:m.id,actor:m.name,createdAt,filters:input.filters,count:rows.length,orderIds:orders.map(o=>o.id),lines:input.type==='working'?orders:[],revision:s.revision}]);
  return fileResponse(bytes,filename);
 }
 throw new AppError('接口不存在。',404);
}catch(e){if(e instanceof z.ZodError)return json({error:'提交内容格式不正确，请检查必填项、邮箱和数值。'},400);return failure(e);}}
