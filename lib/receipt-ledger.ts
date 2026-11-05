import {z} from 'zod';
import {type State,type Member,type Entity,newId,now} from './domain';
import {AppError,audit,commit,json} from './store';
import {arReadOnly} from './ar-workspace';

export const receiptLedgerKind='receipt_master_entry';
export const receiptFinalConfirmer='朱了青';
export function receiptConfirmer(s:State){const matches=s.records.filter(r=>r.kind==='member'&&r.active&&r.name===receiptFinalConfirmer);return matches.length===1?matches[0]:null;}
export function canReadReceiptLedger(s:State,m:Member){return m.active&&(m.role==='admin'||m.role==='finance'||receiptConfirmer(s)?.id===m.id);}
const line=z.object({date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')),payer:z.string().trim().max(240),customer:z.string().trim().max(240),currency:z.enum(['','USD','CNY','HKD','EUR','GBP','AUD','CAD','JPY']),amount:z.string().regex(/^(?:|\d{1,12}(?:\.\d{1,2})?)$/),reference:z.string().trim().max(240)}).strict();
const fields=z.object({category:z.enum(['receipt','support','refund']),duplicateOf:z.string().max(240),businessReviewed:z.boolean(),note:z.string().max(6000),lines:z.array(line).min(1).max(100)}).strict();
const blankLine=()=>({date:'',payer:'',customer:'',currency:'',amount:'',reference:''});
export function newReceiptEntry(p:Entity,m:Member,businessReviewed=false,statement='群凭证自动归档，业务和客服审核状态待登记',confirmerId=''):Entity{return {id:newId(receiptLedgerKind),kind:receiptLedgerKind,version:1,proofId:p.id,proofHash:p.hash,category:'receipt',duplicateOf:'',lines:[blankLine()],businessReviewed,businessReviewBasis:statement,businessReviewRecordedAt:now(),businessReviewRecordedBy:m.id,financeStatus:'待取资料核对',finalConfirmer:receiptFinalConfirmer,finalConfirmerId:confirmerId,finalStatus:'pending',note:p.note?('归档时核对说明：'+p.note):'',createdAt:now(),actorId:m.id};}
function writeAllowed(s:State,m:Member){if(!m.active||m.role!=='admin'||arReadOnly(s,m))throw new AppError('仅有写入权限的管理员可登记收款资料。',403);}
function source(s:State,row:Entity){return s.records.find(p=>p.kind==='payment_proof_inbox'&&p.id===row.proofId);}
function publicEntry(s:State,row:Entity){const p=source(s,row);return {...row,source:p?{id:p.id,hash:p.hash,filename:p.filename,group:p.group,sender:p.sender,messageTime:p.messageTime,caption:p.caption}:null};}
export function receiptTotals(rows:Entity[]){const totals:Record<string,number>={};for(const row of rows){if(row.finalStatus!=='confirmed'||row.category!=='receipt'||row.duplicateOf)continue;for(const l of row.lines){const [whole,decimal='']=l.amount.split('.');const cents=Number(whole)*100+Number(decimal.padEnd(2,'0'));totals[l.currency]=(totals[l.currency]||0)+cents;if(!Number.isSafeInteger(totals[l.currency]))throw new AppError('汇总金额超出精确计算范围。');}}return totals;}
export async function receiptLedgerGet(action:string,s:State,m:Member){
 if(action!=='receipt-ledger-data')return null;
 if(!canReadReceiptLedger(s,m))throw new AppError('没有实收总表查看权限。',403);
 const rows=s.records.filter(r=>r.kind===receiptLedgerKind),confirmer=receiptConfirmer(s);
 return json({items:rows.map(r=>publicEntry(s,r)),unregistered:s.records.filter(p=>p.kind==='payment_proof_inbox'&&!rows.some(r=>r.proofId===p.id)).map(p=>({id:p.id,filename:p.filename,sender:p.sender,messageTime:p.messageTime,caption:p.caption})),canWrite:m.role==='admin'&&!arReadOnly(s,m),canConfirm:confirmer?.id===m.id&&!arReadOnly(s,m),confirmer:{name:receiptFinalConfirmer,resolved:!!confirmer},totalsCents:receiptTotals(rows)});
}
export async function receiptLedgerPost(action:string,req:Request,s:State,m:Member){
 if(!['receipt-ledger-register','receipt-ledger-save','receipt-ledger-confirm'].includes(action))return null;
 if(!canReadReceiptLedger(s,m))throw new AppError('没有实收总表权限。',403);
 const input=await req.json();
 if(action==='receipt-ledger-register'){
  writeAllowed(s,m);
  const v=z.object({proofIds:z.array(z.string()).min(1).max(500),businessReviewed:z.boolean().default(false),statement:z.string().trim().min(1).max(6000)}).strict().parse(input);
  const records:Entity[]=[];
  for(const id of new Set(v.proofIds)){
   if(s.records.some(r=>r.kind===receiptLedgerKind&&r.proofId===id))continue;
   const p=s.records.find(r=>r.kind==='payment_proof_inbox'&&r.id===id);if(!p)throw new AppError('来源凭证不存在，请刷新。');
   const row=newReceiptEntry(p,m,v.businessReviewed,v.statement,receiptConfirmer(s)?.id||'');
   records.push(row,audit(m,row,null,'登记实收总表来源','网页',{proofId:id,businessReviewed:v.businessReviewed,statement:v.statement}));
  }
  if(records.length)await commit(s.revision,records);
  return json({registered:records.length/2});
 }
 const v=z.object({id:z.string(),version:z.number().int().positive(),fields:fields.optional()}).strict().parse(input);
 const row=s.records.find(r=>r.kind===receiptLedgerKind&&r.id===v.id);if(!row||row.version!==v.version)throw new AppError('记录已更新，请刷新后重新核对。',409);
 if(row.finalStatus==='confirmed')throw new AppError('已最终确认的记录不可覆盖，请另行更正。',409);
 const p=source(s,row);if(!p||p.hash!==row.proofHash)throw new AppError('来源原件发生变化，不能继续。',409);
 let next:Entity;
 if(action==='receipt-ledger-save'){
  writeAllowed(s,m);if(!v.fields)throw new AppError('请填写收款资料。');
  if(v.fields.businessReviewed!==row.businessReviewed&&!v.fields.note.trim())throw new AppError('变更业务/客服审核状态时，请在说明中填写审核依据。');
  if(v.fields.duplicateOf&&(v.fields.duplicateOf===row.id||!s.records.some(r=>r.kind===receiptLedgerKind&&r.id===v.fields!.duplicateOf&&!r.duplicateOf&&r.category==='receipt')))throw new AppError('请选择不同的主凭证记录，不能循环关联。');
  if((v.fields.duplicateOf||v.fields.category!=='receipt')&&s.records.some(r=>r.kind===receiptLedgerKind&&r.duplicateOf===row.id))throw new AppError('已有同笔凭证引用本记录，请先核对关联。');
  for(const l of v.fields.lines)if(l.date){const d=new Date(l.date+'T00:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==l.date)throw new AppError('收款日期无效。');}
  next={...row,...v.fields,finalConfirmerId:row.finalConfirmerId||receiptConfirmer(s)?.id||'',...(v.fields.businessReviewed!==row.businessReviewed?{businessReviewBasis:v.fields.note.trim(),businessReviewRecordedAt:now(),businessReviewRecordedBy:m.id}:{}),version:row.version+1,updatedAt:now(),updatedBy:m.id};
 }else{
  if(v.fields)throw new AppError('最终确认不能同时修改内容。');
  if(!m.active||receiptConfirmer(s)?.id!==m.id||row.finalConfirmerId!==m.id||arReadOnly(s,m))throw new AppError('仅固定确认人朱了青本人可最终确认。',403);
  if(!row.businessReviewed)throw new AppError('业务和客服尚未审核收款。');
  if(row.category==='receipt'&&!row.duplicateOf&&row.lines.some((l:z.infer<typeof line>)=>!l.date||!l.payer||!l.currency||!l.amount||Number(l.amount)<=0))throw new AppError('请先补齐每笔收款日期、付款人、币种及正数金额。');
  next={...row,version:row.version+1,finalStatus:'confirmed',confirmedBy:m.id,confirmedName:m.name,confirmedAt:now(),confirmedSourceHash:p.hash};
  receiptTotals(s.records.filter(r=>r.kind===receiptLedgerKind&&r.id!==row.id).concat(next));
 }
 await commit(s.revision,[next,audit(m,next,row,action==='receipt-ledger-confirm'?'实收总表最终确认':'补录实收总表资料')]);
 return json({item:publicEntry(s,next)});
}
