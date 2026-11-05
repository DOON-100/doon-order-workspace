import {z} from 'zod';
import {type State,type Member,type Entity,newId,now} from './domain';
import {AppError,audit,commit,json} from './store';
import {arReadOnly} from './ar-workspace';
import {canReadReceiptLedger,receiptConfirmer} from './receipt-ledger';
const statuses=['linked','conflict','duplicate','unmatched','support','refund'] as const;
const target=z.object({sheet:z.string().max(240),sourceRow:z.number().int().min(2).max(5000)}).strict();
const line=z.object({date:z.string(),payer:z.string(),customer:z.string(),currency:z.string(),amount:z.string(),reference:z.string()}).strict();
const item=z.object({receiptId:z.string(),receiptVersion:z.number().int().positive(),proofHash:z.string().regex(/^[a-f0-9]{64}$/),lineIndex:z.number().int().nonnegative(),expectedLine:line,status:z.enum(statuses),targets:z.array(target).max(50),related:z.array(z.object({receiptId:z.string(),lineIndex:z.number().int().nonnegative()}).strict()).max(50),basis:z.string().trim().min(8).max(6000),issue:z.string().max(6000)}).strict();
const rows=(s:State,k:string)=>s.records.filter(r=>r.kind===k);
function read(s:State,m:Member){if(!canReadReceiptLedger(s,m))throw new AppError('没有逐笔匹配查看权限。',403);}
function writer(s:State,m:Member){read(s,m);if(m.role!=='admin'||arReadOnly(s,m))throw new AppError('仅有权管理员可登记匹配依据。',403);}
const key=(r:Entity)=>r.workbookId+'|'+r.receiptId+'|'+r.lineIndex;
const sameLine=(a:Record<string,unknown>|undefined,b:Record<string,unknown>)=>!!a&&['date','payer','customer','currency','amount','reference'].every(k=>a[k]===b[k]);
export function matchingRows(s:State){const latest=new Map<string,Entity>();for(const r of rows(s,'collection_match')){const old=latest.get(key(r));if(!old||r.version>old.version)latest.set(key(r),r);}return [...latest.values()];}
function live(s:State,r:Entity){const b=rows(s,'collection_workbook').find(b=>b.id===r.workbookId),p=rows(s,'receipt_master_entry').find(p=>p.id===r.receiptId),proof=rows(s,'payment_proof_inbox').find(q=>q.id===p?.proofId);return !!b&&b.hash===r.workbookHash&&!!p&&p.version===r.receiptVersion&&!!proof&&proof.hash===r.proofHash&&sameLine(p.lines[r.lineIndex],r.expectedLine);}
export async function matchingGet(action:string,s:State,m:Member){
 if(action!=='collection-matching-data')return null;read(s,m);
 const items=matchingRows(s).map(r=>{const p=rows(s,'receipt_master_entry').find(p=>p.id===r.receiptId),proof=rows(s,'payment_proof_inbox').find(q=>q.id===p?.proofId);return {...r,current:live(s,r),filename:proof?.filename||'',proofId:proof?.id||'',sender:proof?.sender||'',messageTime:proof?.messageTime||'',finalConfirmer:'朱了青'};});
 return json({items,batches:rows(s,'collection_match_batch'),canWrite:m.role==='admin'&&!arReadOnly(s,m),canConfirm:receiptConfirmer(s)?.id===m.id&&!arReadOnly(s,m)});
}
export async function matchingPost(action:string,req:Request,s:State,m:Member){
 if(!['collection-matching-register','collection-matching-review'].includes(action))return null;read(s,m);
 if(action==='collection-matching-review'){
  if(receiptConfirmer(s)?.id!==m.id||arReadOnly(s,m))throw new AppError('仅朱了青本人可确认匹配或异常处理。',403);
  const v=z.object({id:z.string(),version:z.number().int(),decision:z.enum(['accept_link','reject_link','needs_evidence']),reason:z.string().trim().min(4).max(6000)}).strict().parse(await req.json()),old=matchingRows(s).find(r=>r.id===v.id);
  if(!old||old.version!==v.version||!live(s,old)||old.reviewStatus==='reviewed')throw new AppError('匹配依据已变化或已处理，请重新核对。',409);
  if(v.decision==='accept_link'&&!old.targets.length)throw new AppError('尚无对应原表行，须先补充依据。');
  const next={...old,id:newId('collection_match'),previousId:old.id,version:old.version+1,reviewStatus:'reviewed',decision:v.decision,reviewReason:v.reason,reviewedBy:m.id,reviewedAt:now()};await commit(s.revision,[next,audit(m,{id:next.id,kind:next.kind},null,'朱了青确认匹配资料','逐笔核对')]);return json({item:next});
 }
 writer(s,m);const v=z.object({workbookId:z.string(),workbookHash:z.string(),proofIds:z.array(z.string()).min(1).max(1000),items:z.array(item).min(1).max(3000),note:z.string().trim().min(8).max(6000)}).strict().parse(await req.json());
 const b=rows(s,'collection_workbook').find(b=>b.id===v.workbookId&&b.hash===v.workbookHash);if(!b)throw new AppError('原工作簿已变化或不存在。',409);
 if(new Set(v.proofIds).size!==v.proofIds.length)throw new AppError('凭证范围重复。');
 const scope=rows(s,'receipt_master_entry').filter(r=>v.proofIds.includes(r.proofId));if(scope.length!==v.proofIds.length)throw new AppError('凭证范围未完整登记实收总表。');
 const expected=scope.flatMap(r=>r.lines.map((_:unknown,i:number)=>r.id+'|'+i)),received=v.items.map(r=>r.receiptId+'|'+r.lineIndex);
 if(new Set(received).size!==received.length||expected.length!==received.length||expected.some(k=>!received.includes(k)))throw new AppError('本次凭证范围须逐笔全覆盖，不得遗漏或重复。');
 const records:Entity[]=[];let duplicateCount=0;
 for(const x of v.items){
  const r=scope.find(r=>r.id===x.receiptId),p=rows(s,'payment_proof_inbox').find(p=>p.id===r?.proofId);
  if(!r||r.version!==x.receiptVersion||!p||p.hash!==x.proofHash||r.proofHash!==p.hash||!sameLine(r.lines[x.lineIndex],x.expectedLine))throw new AppError('实收版本、原件摘要或分笔内容已变化。',409);
  if(x.status==='linked'&&(!x.targets.length||r.category!=='receipt'))throw new AppError('明确关联必须对应原表明细，退款及核对资料不能登记为实收关联。');
  const targets=x.targets.map(t=>{const sh=b.sheets.find((sh:Entity)=>sh.name===t.sheet),row=sh?.rows.find((row:Entity)=>row.sourceRow===t.sourceRow&&row.rowType==='detail');if(!row)throw new AppError('对应原表明细行不存在，不能关联小计。');return {...t,snapshot:structuredClone(row.cells)};});
  if(new Set(x.targets.map(t=>t.sheet+'|'+t.sourceRow)).size!==x.targets.length)throw new AppError('来源行不能重复。');
  for(const rel of x.related)if(rel.receiptId===x.receiptId&&rel.lineIndex===x.lineIndex||!rows(s,'receipt_master_entry').some(r=>r.id===rel.receiptId&&r.lines[rel.lineIndex]))throw new AppError('同笔/疑似重复的相关分笔不存在。');
  const fingerprint=JSON.stringify(x),prior=matchingRows(s).find(r=>r.workbookId===b.id&&r.receiptId===x.receiptId&&r.lineIndex===x.lineIndex);
  if(prior){if(prior.fingerprint!==fingerprint)throw new AppError('该凭证分笔已有不同匹配依据，保留旧记录，须另行人工复核。',409);duplicateCount++;continue;}
  records.push({id:newId('collection_match'),kind:'collection_match',version:1,...x,targets,workbookId:b.id,workbookHash:b.hash,sourceAsOf:b.asOf,fingerprint,reviewStatus:x.status==='linked'?'linked_pending_final':'pending',assignedTo:receiptConfirmer(s)?.id||'',assignedName:'朱了青',createdAt:now(),actorId:m.id,contributesToCash:false,changesBalance:false});
 }
 if(records.length){const batch={id:newId('collection_match_batch'),kind:'collection_match_batch',version:1,workbookId:b.id,workbookHash:b.hash,proofIds:v.proofIds,itemIds:records.map(r=>r.id),lineCount:v.items.length,registeredCount:records.length,note:v.note,createdAt:now(),actorId:m.id};await commit(s.revision,[...records,batch,audit(m,{id:batch.id,kind:batch.kind},null,'登记全部凭证逐笔匹配及朱了青待确认清单','逐笔核对')]);}
 return json({registeredCount:records.length,duplicateCount,coveredLines:v.items.length,changesBalance:false});
}
