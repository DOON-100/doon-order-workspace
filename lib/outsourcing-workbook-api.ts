import {z} from 'zod';
import * as XLSX from 'xlsx';
import {all,newId,now,personnelTypeOf,type Entity,type Member,type State} from './domain';
import {AppError,bucket,commit,json} from './store';
import {inspectFixedWorkbook,type FixedWorkbookCell} from './fixed-tool-workbook';
import {fixedToolBytesHash,readFixedToolBody,readFixedToolJson,parseFixedTool} from './fixed-data-tools-common';

const kind='outsourcing_workbook_archive';
const bytesLimit=10*1024*1024;
const ids=z.array(z.string().trim().min(1).max(160)).max(200).refine(values=>new Set(values).size===values.length,'授权成员不能重复');
type Inspection=ReturnType<typeof inspectFixedWorkbook>;
export type OutsourcingWorkbookArchive=Entity&{kind:typeof kind;version:number;title:string;filename:string;sha256:string;size:number;fileKey:string;viewMemberIds:string[];sheets:Inspection['sheets'];date1904:boolean;warnings:string[];createdAt:string;createdBy:string;updatedAt:string;updatedBy:string};
const archives=(s:State)=>all(s,kind) as OutsourcingWorkbookArchive[];
const internal=(m:Member)=>m.active&&m.role!=='supplier'&&personnelTypeOf(m)==='internal';
const admin=(m:Member)=>internal(m)&&m.role==='admin';
function manage(m:Member){if(!admin(m))throw new AppError('仅管理员可以归档原工作簿或调整查看授权。',403);}
function mayRead(m:Member,r:OutsourcingWorkbookArchive){return internal(m)&&(admin(m)||r.viewMemberIds.includes(m.id));}
function selected(s:State,m:Member,id:string|null){const r=archives(s).find(row=>row.id===id);if(!r||!mayRead(m,r))throw new AppError('工作簿不存在或当前账号没有原件查看权限。',403);return r;}
function publicRow(r:OutsourcingWorkbookArchive,m:Member){const {fileKey,viewMemberIds,...value}=r;return {...value,...(admin(m)?{viewMemberIds}:{})};}
function viewers(s:State,values:string[]){for(const id of values){const m=all(s,'member').find(row=>row.id===id) as Member|undefined;if(!m||!internal(m))throw new AppError('查看授权只能分配给有效的内部成员。');}return [...values].sort();}
function auditRow(m:Member,r:OutsourcingWorkbookArchive,action:string,before?:OutsourcingWorkbookArchive){return {id:newId('outsourcing_workbook_audit'),kind:'outsourcing_workbook_audit',archiveId:r.id,action,actorId:m.id,createdAt:now(),before:before?{version:before.version,viewMemberIds:before.viewMemberIds}:null,after:{version:r.version,sha256:r.sha256,viewMemberIds:r.viewMemberIds}};}
async function original(r:OutsourcingWorkbookArchive){const object=await bucket().get(r.fileKey);if(!object)throw new AppError('原件文件缺失，请联系管理员核查。',503);const bytes=await readFixedToolBody(new Response(object.body),bytesLimit);if(bytes.byteLength!==r.size||await fixedToolBytesHash(bytes)!==r.sha256)throw new AppError('原件完整性核对未通过，已停止读取。',409);return bytes;}
function display(cell:FixedWorkbookCell,date1904:boolean){const value=cell.cacheStatus==='not-formula'?cell.value:cell.cachedValue;if(cell.cacheStatus==='missing')return '〔公式缓存缺失〕';if(value===null)return '';if(typeof value==='number'&&cell.numberFormat){try{return XLSX.SSF.format(cell.numberFormat,value,{date1904});}catch{/* Preserve the stored scalar when its number format cannot be rendered. */}}return typeof value==='boolean'?(value?'TRUE':'FALSE'):String(value);}

/** Field query only. The validated original remains the authority for native Excel features. */
export function outsourcingWorkbookSheet(bytes:ArrayBuffer,sheetName:string,headerRow=0){
 const inspection=inspectFixedWorkbook(bytes,{operation:'inspect'}),meta=inspection.sheets.find(sheet=>sheet.name===sheetName);
 if(!meta)throw new AppError('原件中不存在所选工作表。',404);
 if(!Number.isSafeInteger(headerRow)||headerRow<0||headerRow>meta.rows)throw new AppError('表头行超出工作表范围。');
 if(!meta.dimension)return {sheet:meta,headerRow,columns:[],rows:[],total:0,formulaCachesRecalculated:false,date1904:inspection.date1904};
 const range=XLSX.utils.decode_range(meta.dimension),width=range.e.c-range.s.c+1,height=range.e.r-range.s.r+1;
 if(width>200||height>5000||width*height>100000)throw new AppError('该表范围超过字段查询上限（5000行、200列、100000格）。原件已完整保留，请下载原件查看；未返回截断数据。',413);
 // The shared reader has already bounded inflation, XML and stored cells. This
 // second parse reads only presentation metadata; it never evaluates a formula.
 const workbook=XLSX.read(new Uint8Array(bytes),{type:'array',cellStyles:true,cellFormula:true,cellNF:true,cellDates:false,cellText:false,cellHTML:false,sheetStubs:true,nodim:true});
 const sheet=workbook.Sheets[sheetName],map=new Map<number,FixedWorkbookCell[]>();
 for(let startColumn=range.s.c;startColumn<=range.e.c;startColumn+=100){
  const endColumn=Math.min(startColumn+99,range.e.c),chunkWidth=endColumn-startColumn+1,chunkRows=Math.min(1000,Math.floor(10000/chunkWidth));
  for(let startRow=range.s.r;startRow<=range.e.r;startRow+=chunkRows){
   const result=inspectFixedWorkbook(bytes,{operation:'rows',sheet:sheetName,range:XLSX.utils.encode_range({s:{r:startRow,c:startColumn},e:{r:Math.min(startRow+chunkRows-1,range.e.r),c:endColumn}}),headerRow:0,includeEmpty:false});
   for(const row of result.rows){const cells=map.get(row.row)||[];for(const cell of row.cells)cells[cell.column-1-range.s.c]=cell;map.set(row.row,cells);}
  }
 }
 const blank=(row:number,column:number):FixedWorkbookCell=>({address:XLSX.utils.encode_cell({r:row-1,c:column-1}),row,column,type:'blank',value:null,formula:null,rawFormula:null,cachedValue:null,cacheStatus:'not-formula',unknown:true,unknownReason:'blank',sourceValue:null,numberFormat:null,arrayFormulaRange:null});
 const columns=Array.from({length:width},(_,index)=>{const c=index+range.s.c,cell=map.get(headerRow)?.[index],letter=XLSX.utils.encode_col(c);return {column:c+1,letter,label:(cell?display(cell,inspection.date1904):'')||letter,hidden:!!sheet['!cols']?.[c]?.hidden};});
 const rows=[...map].sort(([a],[b])=>a-b).map(([row,cells])=>({row,hidden:!!sheet['!rows']?.[row-1]?.hidden,cells:columns.map((column,index)=>{const cell=cells[index]||blank(row,column.column);return {...cell,display:display(cell,inspection.date1904)};})}));
 return {sheet:meta,headerRow,columns,rows,total:rows.length,formulaCachesRecalculated:false,date1904:inspection.date1904};
}

export async function outsourcingWorkbookGet(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['outsourcing-workbooks','outsourcing-workbook-file','outsourcing-workbook-sheet'].includes(action))return null;
 if(!internal(m))throw new AppError('当前账号无权查看外发原件。',403);
 if(action==='outsourcing-workbooks')return json({canManage:admin(m),archives:archives(s).filter(r=>mayRead(m,r)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(r=>publicRow(r,m)),members:admin(m)?all(s,'member').filter(r=>internal(r as Member)).map(r=>({id:r.id,name:r.name,departments:r.departments||[]})):[]});
 const url=new URL(req.url),r=selected(s,m,url.searchParams.get('id')),bytes=await original(r);
 if(action==='outsourcing-workbook-file')return new Response(bytes,{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(r.filename)}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'",'X-Content-SHA256':r.sha256}});
 const header=url.searchParams.get('headerRow')||'0';if(!/^\d+$/.test(header))throw new AppError('表头行须为非负整数。');
 return json({archive:publicRow(r,m),...outsourcingWorkbookSheet(bytes,url.searchParams.get('sheet')||'',Number(header))});
}

export async function outsourcingWorkbookPost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['outsourcing-workbook-upload','outsourcing-workbook-access'].includes(action))return null;
 manage(m);
 if(action==='outsourcing-workbook-access'){
  const input=parseFixedTool(z.object({id:z.string().min(1).max(160),version:z.number().int().positive(),viewMemberIds:ids}).strict(),await readFixedToolJson(req));
  const before=selected(s,m,input.id);if(before.version!==input.version)throw new AppError('查看授权已更新，请刷新后核对再保存。',409);
  const allowed=viewers(s,input.viewMemberIds);if(JSON.stringify(allowed)===JSON.stringify(before.viewMemberIds))return json({ok:true,unchanged:true,archive:publicRow(before,m)});
  const next={...before,viewMemberIds:allowed,version:before.version+1,updatedAt:now(),updatedBy:m.id};
  await commit(s.revision,[next,auditRow(m,next,'更新原工作簿查看授权',before)]);return json({ok:true,archive:publicRow(next,m)});
 }
 const body=await readFixedToolBody(req,11*1024*1024);let form:FormData;try{form=await new Response(body,{headers:{'Content-Type':req.headers.get('content-type')||''}}).formData();}catch{throw new AppError('请使用XLSX文件上传表单。');}
 for(const name of form.keys())if(!['file','title','viewMemberIds'].includes(name)||form.getAll(name).length!==1)throw new AppError('上传参数包含重复或未知字段。');
 const file=form.get('file');if(!(file instanceof File)||!file.size||file.size>bytesLimit||!/\.xlsx$/i.test(file.name))throw new AppError('请上传非空且不超过10 MiB的无宏XLSX原件。');
 const title=parseFixedTool(z.string().trim().min(1).max(200),form.get('title')||file.name);
 let rawIds:unknown;try{rawIds=JSON.parse(String(form.get('viewMemberIds')||'[]'));}catch{throw new AppError('查看成员列表格式无效。');}
 const viewMemberIds=viewers(s,parseFixedTool(ids,rawIds));
 const bytes=await file.arrayBuffer(),sha256=await fixedToolBytesHash(bytes),id='outsourcing_workbook_'+sha256;
 const collision=s.records.find(r=>r.id===id),existing=archives(s).find(r=>r.sha256===sha256);
 if(collision&&(!existing||collision.id!==existing.id))throw new AppError('归档标识冲突，未覆盖原记录。',409);
 if(existing){await original(existing);return json({ok:true,alreadyPresent:true,accessUnchanged:true,archive:publicRow(existing,m)});}
 const info=inspectFixedWorkbook(bytes,{operation:'inspect'}),timestamp=now();
 const filename=(file.name.split(/[\\/]/).pop()||'外发原件.xlsx').replace(/[\u0000-\u001f\u007f]/g,'_').slice(0,180);
 const archive:OutsourcingWorkbookArchive={id,kind,version:1,title,filename,sha256,size:bytes.byteLength,fileKey:newId('outsourcing_workbook_object'),viewMemberIds,sheets:info.sheets,date1904:info.date1904,warnings:info.warnings,createdAt:timestamp,createdBy:m.id,updatedAt:timestamp,updatedBy:m.id};
 await bucket().put(archive.fileKey,bytes);await original(archive);
 // Publish only the archive and its isolated audit. No orders, receipts,
 // inspections, settlement or production-progress records are generated.
 await commit(s.revision,[archive,auditRow(m,archive,'归档外发原工作簿（未导入业务事实）')]);
 return json({ok:true,alreadyPresent:false,archive:publicRow(archive,m)});
}
