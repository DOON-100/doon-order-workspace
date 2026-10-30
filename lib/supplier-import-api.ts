import * as XLSX from 'xlsx';
import {z} from 'zod';
import {all,clean,newId,now,type Entity,type Member,type State} from './domain';
import {AppError,audit,bucket,commit,json} from './store';
import {managesSuppliers} from './suppliers';
import {businessTeamHeader} from './business-team-scope';
import {openWorkbook,sheetRows,sha} from './workbooks';

// The export itself contains no account identity. Do not claim it is linked to a
// specific Kingdee account; API identities need an explicit future reconciliation.
const scope='金蝶导出未标明账套';
const columns=['供应商编码','供应商名称','供应商分类','增值税税率（%）','结算期限','部门','采购员','银行账号','公司地址','采购入库时自动抵扣预付款','联系人','手机','性别','EMail','创建人','创建时间','发票类型','Email','银行户名','开票地址'];
type SourceRow={row:number;code:string;name:string;values:string[]};
type Decision={row:number;code:string;name:string;status:'new'|'skip'|'conflict';reason:string};
const key=(v:unknown)=>clean(v).toUpperCase();
function decide(rows:SourceRow[],suppliers:Entity[]):Decision[]{
 const codeCounts=new Map<string,number>(),nameCounts=new Map<string,number>();
 for(const row of rows){codeCounts.set(key(row.code),(codeCounts.get(key(row.code))||0)+1);nameCounts.set(key(row.name),(nameCounts.get(key(row.name))||0)+1);}
 return rows.map(row=>{
  const code=key(row.code),name=key(row.name),linked=suppliers.filter(s=>s.kingdeeImportScope===scope&&key(s.kingdeeImportCode)===code),sameName=suppliers.filter(s=>key(s.name)===name);
  let status:Decision['status']='new',reason='';
  if(!code||!name){status='conflict';reason='供应商编码或名称为空。';}
  else if(row.code.length>100||row.name.length>100){status='conflict';reason='供应商编码或名称超过长度限制。';}
  else if(clean(row.values[10]).length>100||clean(row.values[11]).length>100){status='conflict';reason='联系人或手机超过中台档案长度限制。';}
  else if((codeCounts.get(code)||0)>1){status='conflict';reason='文件内供应商编码重复。';}
  else if((nameCounts.get(name)||0)>1){status='conflict';reason='文件内同名供应商存在多个编码，须核查。';}
  else if(linked.length>1){status='conflict';reason='该编码已关联多个中台档案，须核查。';}
  else if(linked.length===1){if(key(linked[0].name)!==name||sameName.some(s=>s.id!==linked[0].id)){status='conflict';reason='该编码对应的名称或档案已变化，须核查。';}else{status='skip';reason='该编码已导入，保留现有档案。';}}
  else if(sameName.length){status='conflict';reason='中台已有同名档案，无法确认是否为同一金蝶编码。';}
  return {row:row.row,code:row.code,name:row.name,status,reason};
 });
}
function response(job:Entity,decisions:Decision[]){return {previewId:job.id,fileName:job.filename,total:decisions.length,candidateCount:decisions.filter(d=>d.status==='new').length,candidates:decisions.filter(d=>d.status==='new').map(({row,code,name})=>({row,code,name})),conflicts:decisions.filter(d=>d.status==='conflict').map(({row,code,name,reason})=>({row,code,name,reason})),existingCount:decisions.filter(d=>d.status==='skip').length};}
export async function supplierImportGet(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['supplier-import-sources','supplier-import-source'].includes(action))return null;
 if(!m.active||!managesSuppliers(m))throw new AppError('仅有效 PMC / 采购或管理员可查看供应商导入来源。',403);
 if(req.headers.get(businessTeamHeader)?.trim())throw new AppError('供应商来源须在有全表权限的全部范围查看。',403);
 const sources=all(s,'kingdee_supplier_source');
 if(action==='supplier-import-source'){
  const id=new URL(req.url).searchParams.get('id'),source=sources.find(r=>r.id===id);if(!source)throw new AppError('供应商来源记录不存在。',404);
  return json({source:{id:source.id,batchId:source.batchId,row:source.row,status:source.status,reason:source.reason,supplierId:source.supplierId,fields:columns.map((label,i)=>({label,value:source.values[i]||''}))}});
 }
 const batches=all(s,'supplier_import').filter(r=>r.status==='已完成').map(r=>({id:r.id,filename:r.filename,hash:r.hash,createdAt:r.createdAt,completedAt:r.completedAt,result:r.result}));
 const batchNames=new Map(batches.map(b=>[b.id,b.filename]));
 return json({batches,sources:sources.map(r=>({id:r.id,batchId:r.batchId,filename:batchNames.get(r.batchId)||'',row:r.row,code:r.values[0],name:r.values[1],status:r.status,reason:r.reason,supplierId:r.supplierId}))});
}
export async function supplierImportPost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['supplier-import-preview','supplier-import-commit'].includes(action))return null;
 if(!m.active||!managesSuppliers(m))throw new AppError('仅有效 PMC / 采购或管理员可导入供应商档案。',403);
 if(req.headers.get(businessTeamHeader)?.trim())throw new AppError('供应商导入须在有全表权限的全部范围操作。',403);
 if(action==='supplier-import-preview'){
  const form=await req.formData(),file=form.get('file');
  if(!(file instanceof File)||!file.size||file.size>10*1024*1024||!/\.xlsx$/i.test(file.name))throw new AppError('请选择不超过 10 MB 的金蝶 XLSX 供应商导出文件。');
  const bytes=await file.arrayBuffer(),book=openWorkbook(bytes);
  if(book.SheetNames.length!==1)throw new AppError('请使用仅含一个工作表的金蝶供应商导出文件。');
  const {headers,body,sheet}=sheetRows(book,book.SheetNames[0],1);
  if(headers.length!==columns.length||columns.some((h,i)=>headers[i]!==clean(h)))throw new AppError('供应商导出表头与金蝶模板不一致，请核对所有列和顺序。');
  for(let col=0;col<columns.length;col++)if(sheet[XLSX.utils.encode_cell({r:0,c:col})]?.f)throw new AppError('表头含公式，请先保存为值。');
  if(!body.length||body.length>5000)throw new AppError('供应商导出须包含 1 至 5000 条资料。');
  const rows:SourceRow[]=body.map(item=>{
   for(let col=0;col<columns.length;col++)if(sheet[XLSX.utils.encode_cell({r:item.index-1,c:col})]?.f)throw new AppError(`第 ${item.index} 行含公式，请先保存为值。`);
   const values=columns.map((_,i)=>String(item.values[i]??''));if(values.some(v=>v.length>4000))throw new AppError(`第 ${item.index} 行字段过长，请核对来源。`);
   return {row:item.index,code:clean(values[0]),name:clean(values[1]),values};
  });
  const decisions=decide(rows,all(s,'supplier')),filename=file.name.replace(/[\\/\r\n]/g,'_').slice(0,180),job={id:newId('supplier_import'),kind:'supplier_import',filename,hash:await sha(bytes),fileKey:newId('supplier_source'),sourceScope:scope,rows,decisions,actorId:m.id,actor:m.name,createdAt:now(),status:'待确认'};
  await bucket().put(job.fileKey,bytes);await commit(s.revision,[job]);return json(response(job,decisions));
 }
 const {previewId}=z.object({previewId:z.string().min(1).max(160)}).strict().parse(await req.json());
 const job=all(s,'supplier_import').find(x=>x.id===previewId);if(!job||job.actorId!==m.id)throw new AppError('导入预览不存在或不属于当前操作人。',404);
 if(job.status==='已完成')return json(job.result);
 if(job.status!=='待确认'||!Array.isArray(job.rows)||!Array.isArray(job.decisions))throw new AppError('导入预览不可用，请重新上传。',409);
 const rows=job.rows as SourceRow[],decisions=decide(rows,all(s,'supplier'));
 if(JSON.stringify(decisions)!==JSON.stringify(job.decisions))throw new AppError('供应商档案已发生变化，请重新上传并核对预览。',409);
 const at=now(),writes:Entity[]=[];
 for(let i=0;i<rows.length;i++){
  const row=rows[i],decision=decisions[i],supplierId=decision.status==='new'?newId('supplier'):'';
  // Preserve all original columns as a separate restricted source record, including
  // both distinct email columns; never put bank details on the general supplier DTO.
  writes.push({id:newId('kingdee_supplier_source'),kind:'kingdee_supplier_source',batchId:job.id,fileHash:job.hash,sourceScope:scope,row:row.row,columns,values:row.values,status:decision.status,reason:decision.reason,supplierId,createdAt:at});
  if(supplierId){const supplier={id:supplierId,kind:'supplier',name:row.name,contact:clean(row.values[10]),phone:clean(row.values[11]),notes:'',active:true,version:1,createdAt:at,updatedAt:at,updatedBy:m.name,kingdeeImportCode:row.code,kingdeeImportScope:scope};writes.push(supplier,audit(m,supplier,null,'导入金蝶供应商','金蝶供应商文件',{id:supplierId,kind:'supplier',name:row.name,kingdeeImportCode:row.code}));}
 }
 const result={inserted:decisions.filter(d=>d.status==='new').length,skipped:decisions.filter(d=>d.status==='skip').length,held:decisions.filter(d=>d.status==='conflict').length};
 const completed={...job,status:'已完成',result,completedAt:at};
 writes.push(completed,audit(m,{id:job.id,kind:'supplier_import'},null,'导入金蝶供应商批次','金蝶供应商文件',{hash:job.hash,...result}));
 await commit(s.revision,writes);return json(result);
}
