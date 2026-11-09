import {z} from 'zod';
import {all,newId,now,strictDate,type Entity,type Member,type State} from './domain';
import {AppError,audit,bucket,commit,json} from './store';
import {canFillIeQuote} from './ie-quote-access';
import {IE_TEMPLATE_MAX_BYTES} from './ie-quote-workbook';
import {parseIePriceWorkbook,type IePriceImportRow} from './ie-price-import';
import {ieCatalogInput,ieCatalogOfferKey,type IeCatalogInput} from './ie-price-catalog';
import type {IeCatalog} from './ie-quotes';

type PriceImport=Entity&{kind:'ie_quote_catalog_import';filename:string;fileKey:string;sha256:string;size:number;createdAt:string;createdBy:string;createdById:string;category:IeCatalogInput['category'];supplier:string;effectiveDate:string;sheetName:string;rows:IePriceImportRow[];issues:string[];sheets:string[];committed?:{selected:number[];ids:string[];inserted:number;existing:number}};
const metadata=z.object({category:z.enum(['material','process','plating','general']),supplier:z.string().trim().max(240),effectiveDate:z.string().refine(v=>{try{return !!v&&strictDate(v)===v;}catch{return false;}},'生效日期无效'),sheetName:z.string().trim().max(120)}).strict();
const hash=async(bytes:Uint8Array)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes).buffer))].map(n=>n.toString(16).padStart(2,'0')).join('');
const safeName=(name:string)=>name.replace(/[\\/\r\n\u0000-\u001f]/g,'_').slice(0,160);
function requireWriter(s:State,m:Member){if(!canFillIeQuote(s,m))throw new AppError('只有获授权的 IE 报价维护人员可上传、导入和读取供应商报价原件。',403);}
function previewResult(p:PriceImport){return {ok:true,id:p.id,filename:p.filename,sha256:p.sha256,rows:p.rows,issues:p.issues,sheets:p.sheets,committed:p.committed};}
function existingKeys(s:State){return new Set((all(s,'ie_quote_catalog') as IeCatalog[]).map(c=>ieCatalogOfferKey(c)));}
function markExisting(rows:IePriceImportRow[],s:State){const keys=existingKeys(s);return rows.map(row=>row.status==='new'&&keys.has(ieCatalogOfferKey(row.entry))?{...row,status:'duplicate' as const,issues:['价格库已有完全相同的报价；不会重复新增。']}:row);}
export async function iePriceImportGet(action:string,url:URL,s:State,m:Member):Promise<Response|null>{
 if(!['ie-quote-catalog-source','ie-quote-catalog-import'].includes(action))return null;requireWriter(s,m);
 const id=url.searchParams.get('id')||'',p=all(s,'ie_quote_catalog_import').find(v=>v.id===id) as PriceImport|undefined;if(!p)throw new AppError('供应商报价原件不存在。',404);
 if(action==='ie-quote-catalog-import')return json(previewResult(p));
 const stored=await bucket().get(p.fileKey);if(!stored)throw new AppError('报价原件暂不可用。',404);
 const bytes=new Uint8Array(await new Response(stored.body).arrayBuffer());if(bytes.length!==p.size||await hash(bytes)!==p.sha256)throw new AppError('报价原件完整性校验失败，已阻止下载。',409);
 return new Response(bytes.buffer,{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(p.filename)}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
export async function iePriceImportPost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['ie-quote-catalog-import-preview','ie-quote-catalog-import-commit'].includes(action))return null;requireWriter(s,m);
 if(action==='ie-quote-catalog-import-preview'){
  if(Number(req.headers.get('Content-Length')||0)>IE_TEMPLATE_MAX_BYTES+65536)throw new AppError('报价原件须小于 12 MB。');
  const form=await req.formData();if([...form.keys()].some(k=>!['file','category','supplier','effectiveDate','sheetName'].includes(k)||form.getAll(k).length!==1))throw new AppError('上传字段重复或包含不支持的内容。');
  const parsed=metadata.safeParse({category:form.get('category'),supplier:String(form.get('supplier')||''),effectiveDate:form.get('effectiveDate'),sheetName:String(form.get('sheetName')||'')});if(!parsed.success)throw new AppError(parsed.error.issues[0]?.message||'请检查上传参数。');
  const options=parsed.data,file=form.get('file');if(!(file instanceof File)||!file.size||file.size>IE_TEMPLATE_MAX_BYTES||!file.name.toLowerCase().endsWith('.xlsx'))throw new AppError('请上传一个不超过 12 MB 的 XLSX 原始报价表。');
  const bytes=new Uint8Array(await file.arrayBuffer()),sha256=await hash(bytes),filename=safeName(file.name);
  const prior=all(s,'ie_quote_catalog_import').find(p=>!p.committed&&p.createdById===m.id&&p.sha256===sha256&&p.category===options.category&&p.supplier===options.supplier&&p.effectiveDate===options.effectiveDate&&p.sheetName===options.sheetName) as PriceImport|undefined;
  if(prior)return json(previewResult(prior));
  let parsedBook:ReturnType<typeof parseIePriceWorkbook>;try{parsedBook=parseIePriceWorkbook(bytes,{...options,filename});}catch(e){throw new AppError(e instanceof Error?e.message:'无法解析报价表。');}
  const p:PriceImport={id:newId('ie_quote_catalog_import'),kind:'ie_quote_catalog_import',filename,fileKey:newId('ie_quote_catalog_original'),sha256,size:bytes.length,createdAt:now(),createdBy:m.name,createdById:m.id,...options,...parsedBook,rows:markExisting(parsedBook.rows,s)};
  await bucket().put(p.fileKey,bytes.buffer);
  await commit(s.revision,[p,audit(m,{id:p.id,kind:p.kind},null,'上传供应商报价原件并预览（未计入价格库）','IE 工程报价',{filename,sha256,category:p.category,rowCount:p.rows.length})]);
  return json(previewResult(p));
 }
 const parsed=z.object({id:z.string().trim().min(1).max(120),selected:z.array(z.number().int().positive()).min(1).max(2000)}).strict().safeParse(await req.json());if(!parsed.success)throw new AppError('请选择预览中有效的报价行。');
 const {id,selected}=parsed.data;if(new Set(selected).size!==selected.length)throw new AppError('选择行不能重复。');
 const p=all(s,'ie_quote_catalog_import').find(v=>v.id===id) as PriceImport|undefined;if(!p||p.createdById!==m.id)throw new AppError('导入预览不存在或不属于当前操作人。',403);
 const selection=[...selected].sort((a,b)=>a-b);
 if(p.committed){if(JSON.stringify(selection)!==JSON.stringify(p.committed.selected))throw new AppError('此预览已按另一选择导入，请重新上传预览。',409);return json({ok:true,...p.committed,id:p.id});}
 const rows=selected.map(id=>p.rows.find(r=>r.rowId===id));if(rows.some(r=>!r||r.status==='error'))throw new AppError('选择中包含无效或有错误的报价行。');
 const keys=existingKeys(s),records:Entity[]=[],ids:string[]=[];
 for(const row of rows){if(!row)continue;const parsedEntry=ieCatalogInput.safeParse(row.entry);if(!parsedEntry.success)throw new AppError('预览报价内容无效，请重新上传。',409);
  const entry=parsedEntry.data,key=ieCatalogOfferKey(entry);if(keys.has(key))continue;keys.add(key);
  const c:IeCatalog={...entry,id:newId('ie_quote_catalog'),kind:'ie_quote_catalog',version:1,sourceImportId:p.id,sourceSheet:row.sheetName,sourceRow:row.sourceRow,updatedAt:now(),updatedBy:m.name};ids.push(c.id);
  records.push(c,{id:newId('ie_quote_catalog_revision'),kind:'ie_quote_catalog_revision',catalogId:c.id,version:c.version,snapshot:structuredClone(c)},audit(m,c,null,'从供应商报价原件导入基价（保留历史报价）','IE 工程报价',c));
 }
 const result={selected:selection,ids,inserted:ids.length,existing:selected.length-ids.length};records.push({...p,committed:result,committedAt:now(),committedById:m.id});
 await commit(s.revision,records);return json({ok:true,...result,id:p.id});
}
