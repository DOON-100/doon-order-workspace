import {all,type Entity,type State} from './domain';
import {AppError} from './store';
import type {IeQuote,IeQuoteFields} from './ie-quotes';

export const IE_ATTACHMENT_MAX_BYTES=12*1024*1024;
export type IeAttachmentRef={attachmentId:string;lineId:string;drawingNo:string;drawingRevision:string;filename:string;sha256:string};
export type IeQuoteAttachment=Entity & {kind:'ie_quote_attachment';quoteId:string;customerAccountId:string;lineId:string;uploadedQuoteVersion:number;quoteRevision:number;drawingNo:string;drawingRevision:string;filename:string;contentType:string;size:number;sha256:string;fileKey:string;createdAt:string;createdBy:string;createdById:string};
const ascii=(b:Uint8Array,start=0,end=b.length)=>new TextDecoder('latin1').decode(b.slice(start,end));
const be32=(b:Uint8Array,n:number)=>new DataView(b.buffer,b.byteOffset,b.byteLength).getUint32(n,false);
const le32=(b:Uint8Array,n:number)=>new DataView(b.buffer,b.byteOffset,b.byteLength).getUint32(n,true);
const dimensions=(w:number,h:number)=>w>0&&h>0&&w<=30000&&h<=30000&&w*h<=100000000;
function actualType(b:Uint8Array){
 if(b.length>=45&&[137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v)){
  let n=8,header=false,data=false,end=false;
  while(n+12<=b.length){const len=be32(b,n),type=ascii(b,n+4,n+8);if(len>b.length-n-12)return '';if(!header){if(type!=='IHDR'||len!==13||!dimensions(be32(b,n+8),be32(b,n+12)))return '';header=true;}else if(type==='IHDR')return '';if(type==='IDAT'&&len>0)data=true;n+=len+12;if(type==='IEND'){end=len===0&&n===b.length;break;}}
  return header&&data&&end?'image/png':'';
 }
 if(b.length>=20&&b[0]===255&&b[1]===216&&b.at(-2)===255&&b.at(-1)===217){
  let n=2,frame=false;
  while(n+4<=b.length){if(b[n++]!==255)return '';while(b[n]===255)n++;const marker=b[n++];if(marker===0xda)return frame?'image/jpeg':'';if(marker===0xd9)return '';const len=(b[n]<<8)|b[n+1];if(len<2||n+len>b.length)return '';if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){if(len<8||!dimensions((b[n+5]<<8)|b[n+6],(b[n+3]<<8)|b[n+4]))return '';frame=true;}n+=len;}
 }
 if(b.length>=26&&ascii(b,0,4)==='RIFF'&&ascii(b,8,12)==='WEBP'&&le32(b,4)===b.length-8){
  let n=12,image=false;while(n+8<=b.length){const type=ascii(b,n,n+4),len=le32(b,n+4),start=n+8;if(len>b.length-start)return '';if(type==='VP8 '){if(len<10||b[start+3]!==157||b[start+4]!==1||b[start+5]!==42||!dimensions((b[start+6]|b[start+7]<<8)&0x3fff,(b[start+8]|b[start+9]<<8)&0x3fff))return '';image=true;}if(type==='VP8L'){if(len<5||b[start]!==0x2f)return '';const bits=le32(b,start+1);if(!dimensions((bits&0x3fff)+1,((bits>>>14)&0x3fff)+1))return '';image=true;}n=start+len+(len%2);}return n===b.length&&image?'image/webp':'';
 }
 if(b.length>=32&&/^%PDF-(?:1\.[0-7]|2\.0)(?:\r|\n|\s)/.test(ascii(b,0,12))){const text=ascii(b),names=text.replace(/#([0-9a-f]{2})/gi,(_,v)=>String.fromCharCode(parseInt(v,16)));if(/\/(?:JavaScript|JS|OpenAction|AA|Launch|EmbeddedFiles|RichMedia|XFA)(?=[\s/<>\[\](){}%]|$)/i.test(names))throw new AppError('PDF 含主动脚本、启动动作或嵌入附件，请导出静态图纸 PDF 后上传。');if(/%%EOF\s*$/.test(text)&&/\b\d+\s+\d+\s+obj\b/.test(text)&&/startxref\s+\d+\s+%%EOF\s*$/.test(text))return 'application/pdf';}
 return '';
}
export function validateIeAttachment(bytes:Uint8Array,filename:string,declaredType:string){
 if(!bytes.length||bytes.length>IE_ATTACHMENT_MAX_BYTES)throw new AppError('图纸附件须为非空且不超过 12 MB 的 JPG、PNG、WEBP 或 PDF。');
 filename=filename.normalize('NFKC');
 if(/[\\/\u0000-\u001f\u007f]/.test(filename)||!filename.trim())throw new AppError('附件文件名不能含路径或控制字符。');
 const ext=filename.split('.').pop()?.toLowerCase(),expected:Record<string,string>={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',pdf:'application/pdf'},type=actualType(bytes);
 if(!ext||!expected[ext]||!type||type!==expected[ext]||declaredType&&declaredType!==type&&declaredType!=='application/octet-stream')throw new AppError('附件真实内容与文件扩展名 / 类型不一致；只接受 JPG、PNG、WEBP、PDF，不能上传 HTML 或 SVG。');
 const base=[...filename.replace(/[<>:"|?*\u0000-\u001f\u007f]/g,'_')].slice(0,140).join('');
 return {contentType:type,filename:base.toLowerCase().endsWith('.'+ext)?base:base+'.'+ext};
}
export async function ieAttachmentHash(bytes:Uint8Array){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes).buffer))].map(v=>v.toString(16).padStart(2,'0')).join('');}
export function ieAttachmentIssues(s:State,q:IeQuoteFields & {attachmentRefs?:IeAttachmentRef[]},quoteId:string){
 const issues:string[]=[],seen=new Set<string>();for(const ref of q.attachmentRefs||[]){const file=all(s,'ie_quote_attachment').find(a=>a.id===ref.attachmentId) as IeQuoteAttachment|undefined,line=q.lines.find(l=>l.id===ref.lineId);if(seen.has(ref.attachmentId)||!file||file.quoteId!==quoteId||file.customerAccountId!==q.customerAccountId||file.lineId!==ref.lineId||file.sha256!==ref.sha256||file.filename!==ref.filename||!line)issues.push('图纸附件引用无效，请重新核对附件与款式。');else if(ref.drawingNo!==line.drawingNo||ref.drawingRevision!==line.drawingRevision)issues.push(`款式 ${line.model} 的附件仍绑定旧图纸版本，请替换或明确重新绑定当前版本。`);seen.add(ref.attachmentId);}return issues;
}
export function publicIeAttachments(s:State,q:IeQuote){return (q.attachmentRefs||[]).flatMap(ref=>{const f=all(s,'ie_quote_attachment').find(a=>a.id===ref.attachmentId) as IeQuoteAttachment|undefined,l=q.lines.find(l=>l.id===ref.lineId);if(!f||f.quoteId!==q.id||f.customerAccountId!==q.customerAccountId||f.lineId!==ref.lineId||f.sha256!==ref.sha256)return [];return [{id:f.id,lineId:ref.lineId,drawingNo:ref.drawingNo,drawingRevision:ref.drawingRevision,filename:ref.filename,contentType:f.contentType,size:f.size,sha256:ref.sha256,uploadedAt:f.createdAt,uploadedBy:f.createdBy,quoteVersion:f.uploadedQuoteVersion,matchesDrawingRevision:!!l&&l.drawingNo===ref.drawingNo&&l.drawingRevision===ref.drawingRevision,url:`/api/workspace/ie-quote-attachment?id=${encodeURIComponent(q.id)}&version=${q.version}&attachmentId=${encodeURIComponent(f.id)}`}];});}
