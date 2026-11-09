import {z} from 'zod';
import {all,newId,now,strictDate,type Entity,type Member,type State} from './domain';
import {AppError,audit,bucket,commit,json} from './store';
import {canFillIeQuote} from './ie-quote-access';
import {IE_ATTACHMENT_MAX_BYTES,ieAttachmentHash,validateIeAttachment} from './ie-quote-attachments';

/** Original supplier evidence is independent of drawings and price interpretation. */
export type IeSupplierEvidence=Entity & {kind:'ie_quote_supplier_evidence';version:1;supplier:string;drawingNo:string;quoteDate:string;notes:string;category:'material'|'plating'|'general'|'process';filename:string;contentType:string;size:number;sha256:string;fileKey:string;createdAt:string;createdBy:string;createdById:string};
const text=(max:number)=>z.string().trim().max(max).default('');
/** Some supplier camera originals retain a small metadata trailer after JPEG EOI.
 * Validate the JPEG body without changing the bytes archived, hashed or served.
 * This exception is intentionally local to supplier evidence, never drawings. */
export function validateIeSupplierEvidence(bytes:Uint8Array,filename:string,declaredType:string){
 try{return validateIeAttachment(bytes,filename,declaredType);}catch(cause){
  if(!bytes.length||bytes.length>IE_ATTACHMENT_MAX_BYTES||bytes[0]!==255||bytes[1]!==216)throw cause;
  for(let end=bytes.length-3;end>=Math.max(2,bytes.length-258);end--){
   if(bytes[end]===255&&bytes[end+1]===217){
    const valid=validateIeAttachment(bytes.subarray(0,end+2),filename,declaredType);
    if(valid.contentType==='image/jpeg')return valid;
    throw cause;
   }
  }
  throw cause;
 }
}
const metadata=z.object({supplier:text(240),drawingNo:text(240),quoteDate:text(10).refine(v=>{try{return !v||/^\d{4}-\d{2}-\d{2}$/.test(v)&&strictDate(v)===v;}catch{return false;}},'报价日期须为空或有效 YYYY-MM-DD'),notes:text(4000),category:z.enum(['material','plating','general','process']).default('material')}).strict();
export const canReadIeSupplierEvidence=(s:State,m:Member)=>canFillIeQuote(s,m);
function permitted(s:State,m:Member){if(!canReadIeSupplierEvidence(s,m))throw new AppError('仅获准填写 IE 工程报价的成员可管理供应商报价原件。',403);}
export function requireIeSupplierEvidence(s:State,m:Member,evidenceId:string):IeSupplierEvidence{
 permitted(s,m);const rows=all(s,'ie_quote_supplier_evidence').filter(r=>r.id===evidenceId);
 if(rows.length!==1)throw new AppError('供应商报价原件不存在或无权访问。',403);
 return rows[0] as IeSupplierEvidence;
}
export function publicIeSupplierEvidence(item:IeSupplierEvidence){
 const {id,version,supplier,drawingNo,quoteDate,notes,category,filename,contentType,size,sha256,createdAt,createdBy}=item;
 return {id,version,supplier,drawingNo,quoteDate,notes,category,filename,contentType,size,sha256,createdAt,createdBy,url:`/api/workspace/ie-supplier-evidence?id=${encodeURIComponent(id)}`};
}
async function boundedForm(req:Request){
 const max=IE_ATTACHMENT_MAX_BYTES+65536;
 if(Number(req.headers.get('Content-Length')||0)>max)throw new AppError('报价原件请求超过 12 MB 文件大小上限。',413);
 if(!req.headers.get('Content-Type')?.toLowerCase().startsWith('multipart/form-data;'))throw new AppError('请以文件上传方式提交报价原件。');
 if(!req.body)throw new AppError('请选择报价原件。');
 const reader=req.body.getReader(),parts:Uint8Array[]=[];let size=0;
 try{for(;;){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>max){await reader.cancel();throw new AppError('报价原件请求超过 12 MB 文件大小上限。',413);}parts.push(next.value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
 try{return await new Response(bytes.buffer,{headers:{'Content-Type':req.headers.get('Content-Type')!}}).formData();}catch{throw new AppError('报价原件上传内容不完整，请重新选择文件。');}
}
export async function ieSupplierEvidenceGet(action:string,url:URL,s:State,m:Member):Promise<Response|null>{
 if(!['ie-supplier-evidence-list','ie-supplier-evidence'].includes(action))return null;
 permitted(s,m);
 if(action==='ie-supplier-evidence-list')return json({evidence:(all(s,'ie_quote_supplier_evidence') as IeSupplierEvidence[]).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id)).map(publicIeSupplierEvidence)});
 const item=requireIeSupplierEvidence(s,m,url.searchParams.get('id')||''),stored=await bucket().get(item.fileKey);
 if(!stored)throw new AppError('供应商报价原件暂不可用。',404);
 const bytes=new Uint8Array(await new Response(stored.body).arrayBuffer());
 if(bytes.length!==item.size||await ieAttachmentHash(bytes)!==item.sha256)throw new AppError('报价原件完整性校验失败，已阻止下载。',409);
 const valid=validateIeSupplierEvidence(bytes,item.filename,item.contentType);
 return new Response(bytes.buffer,{headers:{'Content-Type':valid.contentType,'Content-Disposition':`${url.searchParams.get('download')==='1'?'attachment':'inline'}; filename*=UTF-8''${encodeURIComponent(valid.filename)}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'; frame-ancestors 'self'",'Cross-Origin-Resource-Policy':'same-origin','Referrer-Policy':'no-referrer'}});
}
export async function ieSupplierEvidencePost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(action!=='ie-supplier-evidence-upload')return null;
 permitted(s,m);
 const form=await boundedForm(req),keys=[...form.keys()];
 if(keys.some(k=>!['file','supplier','drawingNo','quoteDate','notes','category'].includes(k)||form.getAll(k).length!==1))throw new AppError('报价原件字段重复或包含不支持的内容。');
 const values=Object.fromEntries(keys.filter(k=>k!=='file').map(k=>[k,form.get(k)])),parsed=metadata.safeParse(values);
 if(!parsed.success)throw new AppError(parsed.error.issues.slice(0,6).map(i=>`${i.path.join('.')}: ${i.message}`).join('；'));
 const file=form.get('file');if(!(file instanceof File)||file.size>IE_ATTACHMENT_MAX_BYTES)throw new AppError('请选择一个不超过 12 MB 的 JPG、PNG、WEBP 或静态 PDF 报价原件。');
 const bytes=new Uint8Array(await file.arrayBuffer()),valid=validateIeSupplierEvidence(bytes,file.name,file.type),sha256=await ieAttachmentHash(bytes),fields=parsed.data;
 const existing=(all(s,'ie_quote_supplier_evidence') as IeSupplierEvidence[]).find(r=>r.sha256===sha256&&r.filename===valid.filename&&Object.entries(fields).every(([k,v])=>r[k]===v));
 if(existing)return json({ok:true,duplicate:true,evidence:publicIeSupplierEvidence(existing)});
 const item:IeSupplierEvidence={id:newId('ie_supplier_evidence'),kind:'ie_quote_supplier_evidence',version:1,...fields,...valid,size:bytes.length,sha256,fileKey:newId('ie_supplier_evidence_file'),createdAt:now(),createdBy:m.name,createdById:m.id};
 await bucket().put(item.fileKey,bytes.buffer);
 await commit(s.revision,[item,audit(m,item,null,'上传供应商报价原件（价格待人工核对）','IE 工程报价原件')]);
 return json({ok:true,evidence:publicIeSupplierEvidence(item)});
}
