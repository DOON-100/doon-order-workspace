import {z} from 'zod';
import {all,newId,now,type Member,type State} from './domain';
import {AppError,bucket,commit,json} from './store';
import {canReadIeQuote,isIeEngineeringMember} from './ie-quote-access';
import {currentIeQuote,ieQuoteVersion,publicIeQuote,type IeQuote} from './ie-quotes';
import {buildIeQuotePersistenceRecords} from './ie-quote-api';
import {IE_ATTACHMENT_MAX_BYTES,ieAttachmentHash,validateIeAttachment,type IeAttachmentRef,type IeQuoteAttachment} from './ie-quote-attachments';
const id=z.string().trim().min(1).max(120),change=z.object({id,version:z.number().int().positive(),lineId:id,attachmentId:id}).strict();
function editable(s:State,m:Member,quoteId:string,version:number,lineId:string){
 const q=currentIeQuote(s,quoteId);if(!q||!canReadIeQuote(s,m,q)||!isIeEngineeringMember(s,m))throw new AppError('只有工程填报人或替补可维护授权报价的图纸附件。',403);
 if(q.version!==version||!['draft','returned'].includes(q.status))throw new AppError('报价版本已变化或已提交，请刷新；已发布内容须先创建修订。',409);
 if(!q.lines.some(l=>l.id===lineId))throw new AppError('请选择当前报价中的有效款式。');return q;
}
async function persistRefs(s:State,m:Member,q:IeQuote,refs:IeAttachmentRef[],action:string,attachment?:IeQuoteAttachment){
 const next:IeQuote={...q,attachmentRefs:refs,version:q.version+1,preparedByIds:[...new Set([...q.preparedByIds,m.id])],updatedAt:now(),updatedBy:m.name,updatedById:m.id};
 const records=[...buildIeQuotePersistenceRecords(m,next,q,action),...(attachment?[attachment]:[])];await commit(s.revision,records);
 const ids=new Set(records.map(r=>r.id));return json({ok:true,quote:publicIeQuote({...s,records:[...s.records.filter(r=>!ids.has(r.id)),...records]},m,next)});
}
export async function ieAttachmentGet(action:string,url:URL,s:State,m:Member):Promise<Response|null>{
 if(action!=='ie-quote-attachment')return null;
 const quoteId=url.searchParams.get('id')||'',version=Number(url.searchParams.get('version')),attachmentId=url.searchParams.get('attachmentId')||'';
 if(!Number.isSafeInteger(version)||version<1)throw new AppError('附件读取必须指定工程报价版本。');
 const q=ieQuoteVersion(s,quoteId,version),current=currentIeQuote(s,quoteId),ref=q?.attachmentRefs?.find(r=>r.attachmentId===attachmentId),a=all(s,'ie_quote_attachment').find(a=>a.id===attachmentId) as IeQuoteAttachment|undefined;
 if(!q||!current||!ref||!a||q.customerAccountId!==current.customerAccountId||a.customerAccountId!==q.customerAccountId||a.quoteId!==q.id||a.lineId!==ref.lineId||a.sha256!==ref.sha256||!canReadIeQuote(s,m,q)||!canReadIeQuote(s,m,current))throw new AppError('附件不属于此报价版本或当前无权访问。',403);
 const stored=await bucket().get(a.fileKey);if(!stored)throw new AppError('附件原件暂不可用。',404);
 const bytes=new Uint8Array(await new Response(stored.body).arrayBuffer());if(bytes.length!==a.size||await ieAttachmentHash(bytes)!==a.sha256)throw new AppError('附件完整性校验失败，已阻止下载。',409);
 const valid=validateIeAttachment(bytes,a.filename,a.contentType);
 return new Response(bytes.buffer,{headers:{'Content-Type':valid.contentType,'Content-Disposition':`${url.searchParams.get('download')==='1'?'attachment':'inline'}; filename*=UTF-8''${encodeURIComponent(valid.filename)}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'; frame-ancestors 'self'",'Cross-Origin-Resource-Policy':'same-origin','Referrer-Policy':'no-referrer'}});
}
export async function ieAttachmentPost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['ie-quote-attachment-upload','ie-quote-attachment-remove','ie-quote-attachment-bind'].includes(action))return null;
 if(action==='ie-quote-attachment-upload'){
  const declaredLength=Number(req.headers.get('Content-Length')||0);if(declaredLength>IE_ATTACHMENT_MAX_BYTES+65536)throw new AppError('图纸附件请求超过大小上限。');
  const form=await req.formData(),quoteId=String(form.get('quoteId')||''),version=Number(form.get('version')),lineId=String(form.get('lineId')||''),replaceId=String(form.get('replaceAttachmentId')||'');
  const keys=[...form.keys()];if(keys.some(k=>!['quoteId','version','lineId','replaceAttachmentId','file'].includes(k)||form.getAll(k).length!==1))throw new AppError('附件上传字段重复或包含不支持的内容。');
  if(!Number.isSafeInteger(version)||version<1)throw new AppError('请先保存当前工程报价版本。');const q=editable(s,m,quoteId,version,lineId),line=q.lines.find(l=>l.id===lineId)!;
  const refs=q.attachmentRefs||[];if(replaceId&&!refs.some(r=>r.attachmentId===replaceId&&r.lineId===lineId))throw new AppError('被替换附件不属于当前款式引用。');
  if(refs.length>=100&&!replaceId||refs.filter(r=>r.lineId===lineId).length>=10&&!replaceId)throw new AppError('每款最多 10 个附件，每份工程报价最多 100 个。');
  const file=form.get('file');if(!(file instanceof File)||form.getAll('file').length!==1||file.size>IE_ATTACHMENT_MAX_BYTES)throw new AppError('请选择一个不超过 12 MB 的图纸或图片。');
  const bytes=new Uint8Array(await file.arrayBuffer()),valid=validateIeAttachment(bytes,file.name,file.type),hash=await ieAttachmentHash(bytes);
  const attachment:IeQuoteAttachment={id:newId('ie_quote_attachment'),kind:'ie_quote_attachment',quoteId:q.id,customerAccountId:q.customerAccountId,lineId,uploadedQuoteVersion:q.version+1,quoteRevision:q.revision,drawingNo:line.drawingNo,drawingRevision:line.drawingRevision,...valid,size:bytes.length,sha256:hash,fileKey:newId('ie_quote_attachment_file'),createdAt:now(),createdBy:m.name,createdById:m.id};
  const ref:IeAttachmentRef={attachmentId:attachment.id,lineId,drawingNo:line.drawingNo,drawingRevision:line.drawingRevision,filename:attachment.filename,sha256:hash};
  await bucket().put(attachment.fileKey,bytes.buffer);
  return persistRefs(s,m,q,[...refs.filter(r=>r.attachmentId!==replaceId),ref],replaceId?'替换款式图纸附件（保留原件）':'上传款式图纸附件',attachment);
 }
 const schema=action==='ie-quote-attachment-bind'?change.extend({acknowledgeDrawingRevision:z.literal(true)}).strict():change,parsed=schema.safeParse(await req.json());if(!parsed.success)throw new AppError('附件操作须明确当前报价、款式及版本；重新绑定需明确确认图纸版本。');
 const input=parsed.data,q=editable(s,m,input.id,input.version,input.lineId),refs=q.attachmentRefs||[],existing=refs.find(r=>r.attachmentId===input.attachmentId&&r.lineId===input.lineId);
 if(action==='ie-quote-attachment-remove'){if(!existing)throw new AppError('附件引用已移除或不属于当前款式。',409);return persistRefs(s,m,q,refs.filter(r=>r!==existing),'移除款式附件引用（保留历史原件）');}
 const a=all(s,'ie_quote_attachment').find(a=>a.id===input.attachmentId) as IeQuoteAttachment|undefined,line=q.lines.find(l=>l.id===input.lineId)!;
 if(!a||a.quoteId!==q.id||a.customerAccountId!==q.customerAccountId||a.lineId!==line.id)throw new AppError('只能重新绑定该报价原款式上传的文件。',403);
 if(!existing&&(refs.length>=100||refs.filter(r=>r.lineId===line.id).length>=10))throw new AppError('当前款式或报价附件数量已达上限。');
 const ref:IeAttachmentRef={attachmentId:a.id,lineId:line.id,drawingNo:line.drawingNo,drawingRevision:line.drawingRevision,filename:a.filename,sha256:a.sha256};
 return persistRefs(s,m,q,[...refs.filter(r=>r.attachmentId!==a.id),ref],'明确沿用附件并重新绑定当前图纸版本');
}
