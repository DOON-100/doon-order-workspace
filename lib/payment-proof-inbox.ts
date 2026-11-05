import {z} from 'zod';
import {type State,type Member,newId,now} from './domain';
import {AppError,audit,bucket,commit,json} from './store';
import {arReadOnly} from './ar-workspace';
import {canReadReceiptLedger,newReceiptEntry,receiptConfirmer,receiptLedgerGet,receiptLedgerPost} from './receipt-ledger';
import {collectionGet,collectionPost} from './collection-workspace';
import {matchingGet,matchingPost} from './collection-matching';

const kind='payment_proof_inbox';
export const proofMetadata=z.object({group:z.string().trim().min(1).max(240),sender:z.string().trim().min(1).max(240),messageTime:z.string().datetime({offset:true}),caption:z.string().max(6000),note:z.string().max(6000).default('')}).strict();
function allowed(m:Member){if(!m.active||m.role!=='admin')throw new AppError('待核对凭证仅当前在职管理员可访问。',403);}
export async function proofInboxGet(action:string,req:Request,s:State,m:Member){
 const matching=await matchingGet(action,s,m);if(matching)return matching;
 const collection=await collectionGet(action,req,s,m);if(collection)return collection;
 const ledger=await receiptLedgerGet(action,s,m);if(ledger)return ledger;
 if(!['payment-proof-inbox','payment-proof-file'].includes(action))return null;
 if(!canReadReceiptLedger(s,m))throw new AppError('凭证仅在职管理员、财务及固定确认人可查看。',403);
 const rows=s.records.filter(r=>r.kind===kind);
 if(action==='payment-proof-inbox')return json({items:rows.map(({fileKey,...r})=>r),canWrite:m.role==='admin'&&!arReadOnly(s,m),note:'原件归档与业务审核、最终确认分别留痕，不核销应收。'});
 const row=rows.find(r=>r.id===new URL(req.url).searchParams.get('id'));
 if(!row)throw new AppError('凭证不存在。',404);
 const file=await bucket().get(row.fileKey);if(!file)throw new AppError('原图片不存在。',404);
 return new Response(file.body,{headers:{'Content-Type':row.mime,'Content-Disposition':`${row.mime==='application/pdf'?'attachment':'inline'}; filename*=UTF-8''${encodeURIComponent(row.filename)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}
export async function proofInboxPost(action:string,req:Request,s:State,m:Member){
 const matching=await matchingPost(action,req,s,m);if(matching)return matching;
 const collection=await collectionPost(action,req,s,m);if(collection)return collection;
 const ledger=await receiptLedgerPost(action,req,s,m);if(ledger)return ledger;
 if(action!=='payment-proof-upload')return null;
 allowed(m);
 if(arReadOnly(s,m))throw new AppError('当前账号的应收资料为只读，不能归档新凭证。',403);
 const form=await req.formData();
 let metadata:unknown;try{metadata=JSON.parse(String(form.get('metadata')||'{}'));}catch{throw new AppError('消息来源格式无效。');}
 const parsed=proofMetadata.safeParse(metadata);
 if(!parsed.success)throw new AppError('请完整填写群名、发送人、带时区的消息时间及原消息备注。');
 const file=form.get('file');if(!(file instanceof File)||!file.size||file.size>10*1024*1024)throw new AppError('请选择不超过10 MB的原图片。');
 const bytes=new Uint8Array(await file.arrayBuffer());
 const mime=bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':bytes.slice(0,8).join(',')==='137,80,78,71,13,10,26,10'?'image/png':new TextDecoder().decode(bytes.slice(0,8)).match(/^%PDF-[12]\.\d/)?'application/pdf':'';
 if(!mime)throw new AppError('当前收件箱仅接收 JPEG / PNG 图片及 PDF 原件。');
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');
 const existing=s.records.find(r=>r.kind===kind&&r.hash===hash);
 if(existing){const {fileKey,...item}=existing;return json({item,duplicate:true});}
 const row={id:newId(kind),kind,version:1,...parsed.data,status:'待核对',customerId:'',receivableId:'',hash,filename:file.name.replace(/[\\/\u0000-\u001f]/g,'_').slice(0,240),mime,size:file.size,fileKey:newId('payment_proof_file'),createdAt:now(),actorId:m.id};
 await bucket().put(row.fileKey,bytes);
 const entry=newReceiptEntry(row,m,false,undefined,receiptConfirmer(s)?.id||'');
 await commit(s.revision,[row,entry,audit(m,{id:row.id,kind:row.kind},null,'付款凭证待核对归档','网页',{id:row.id,kind:row.kind,status:row.status}),audit(m,entry,null,'自动登记实收总表来源','网页',{proofId:row.id})]);
 const {fileKey,...item}=row;return json({item,duplicate:false});
}
