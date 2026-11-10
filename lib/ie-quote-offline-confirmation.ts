import {all,type Entity,type Member,type State} from './domain';
import {canConfigureIeQuotes,canFillIeQuote,iePolicyMember} from './ie-quote-access';
import {businessFollowupScopeIdentity} from './business-followup-scope';
import type {IeQuote} from './ie-quotes';

export type IeOfflineConfirmation=Entity & {kind:'ie_quote_offline_confirmation';quoteId:string;quoteVersion:number;customerAccountId:string;contentSha256:string;contentSnapshot:string;attachmentId:string;attachmentSha256:string;confirmedRole:'engineering-supervisor';evidence:string;recordedAt:string;recordedBy:string;recordedById:string};
const shaPattern=/^[a-f0-9]{64}$/;
const fields=['materialPricingMode','calculationMode','sourceFormula','customerAccountId','quoteNo','quoteDate','validUntil','batchId','exchangeRateCnyPerUsd','exchangeRateDate','exchangeRateSource','notes','lines','tooling','manualAdjustments'] as const;
function canonical(value:unknown):string{
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,v])=>JSON.stringify(key)+':'+canonical(v)).join(',')+'}';
 return JSON.stringify(value)??'null';
}
/** Exact server-generated canonical content is retained alongside its SHA-256.
 * Read paths compare that content directly; no mutable client fingerprint is trusted. */
export function ieOfflineContentSnapshot(q:IeQuote){return canonical({id:q.id,version:q.version,revision:q.revision,customerName:q.customerName,customerCode:q.customerCode,status:q.status,fields:Object.fromEntries(fields.map(key=>[key,q[key]])),attachmentRefs:q.attachmentRefs||[]});}
function targetMatches(s:State,q:IeQuote,row:Entity){return row.module==='ie-quotes'&&row.collection==='quotes'&&row.recordId===q.id&&row.sectionKey==='record'&&row.recordKind==='ie_quote'&&row.customerId===q.customerAccountId&&row.projectId===''&&row.orderId===''&&row.scopeIdentity===businessFollowupScopeIdentity(s,q);}
export function ieOfflineSourceAttachments(s:State,q:IeQuote){
 return all(s,'business_followup_attachment').filter(file=>targetMatches(s,q,file)&&/\.xlsx$/i.test(String(file.originalName))&&Number.isSafeInteger(file.size)&&file.size>0&&file.size<=20*1024*1024&&typeof file.fileKey==='string'&&shaPattern.test(file.sha256)&&(!q.sourceFormula?.sourceSha256||file.sha256===q.sourceFormula.sourceSha256)&&all(s,'business_followup').some(entry=>entry.id===file.entryId&&targetMatches(s,q,entry)));
}
export function publicIeOfflineSourceAttachments(s:State,q:IeQuote){return ieOfflineSourceAttachments(s,q).map(file=>({id:file.id,originalName:String(file.originalName),filename:String(file.originalName),size:Number(file.size),sha256:String(file.sha256)}));}
export function activeIeOfflineConfirmation(s:State,q:IeQuote):IeOfflineConfirmation|null{
 if(!['draft','returned'].includes(q.status))return null;
 const content=ieOfflineContentSnapshot(q),attachments=ieOfflineSourceAttachments(s,q);
 const rows=(all(s,'ie_quote_offline_confirmation') as IeOfflineConfirmation[]).filter(row=>row.quoteId===q.id&&row.quoteVersion===q.version&&row.customerAccountId===q.customerAccountId&&row.confirmedRole==='engineering-supervisor'&&row.contentSnapshot===content&&shaPattern.test(row.contentSha256)&&row.evidence&&row.recordedAt&&row.recordedById&&attachments.some(file=>file.id===row.attachmentId&&file.sha256===row.attachmentSha256));
 return rows.length===1?rows[0]:null;
}
export function publicIeOfflineConfirmation(row:IeOfflineConfirmation|null){if(!row)return null;const {contentSnapshot:_content,...publicRow}=row;return publicRow;}
export function canRegisterIeOfflineConfirmation(s:State,m:Member,q:IeQuote){return canFillIeQuote(s,m)&&(canConfigureIeQuotes(m)||iePolicyMember(s,'engineer')?.id===m.id)&&['draft','returned'].includes(q.status)&&!activeIeOfflineConfirmation(s,q);}
