import type {Entity,Member,State} from './domain';
import {canSeeCustomerQuoteInternal,isCustomerQuoteAdministrator} from './customer-quote-access';
import {canReadPriceArchive,type PriceArchive} from './customer-price-archive';
export function canReadCustomerPriceAudit(s:State,m:Member,record:Entity):boolean|null{
 const target=s.records.find(v=>v.id===record.targetId),parts=[target,record.before,record.after].filter(Boolean);
 if(!parts.some(v=>typeof v.kind==='string'&&v.kind.startsWith('customer_price_')))return null;
 const archive=target?.kind==='customer_price_archive'?target:s.records.find(v=>v.kind==='customer_price_archive'&&v.id===target?.archiveId);
 return !!archive&&canReadPriceArchive(s,m,archive as PriceArchive)&&isCustomerQuoteAdministrator(m,s);
}
export function publicCustomerPriceAudit(s:State,m:Member,record:Entity){
 const target=s.records.find(v=>v.id===record.targetId),parts=[target,record.before,record.after].filter(Boolean);
 if(!parts.some(v=>typeof v.kind==='string'&&(v.kind.startsWith('customer_quote')||v.kind.startsWith('customer_price_'))))return record;
 const internal=canSeeCustomerQuoteInternal(s,m),hidden=new Set(['sourceFileKey','fileKey','path',...(!internal?['internalNotesZh','internalCosts','exchangeRateCnyPerUsd']:[])]);
 const scrub=(value:unknown):unknown=>Array.isArray(value)?value.map(scrub):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([k])=>!hidden.has(k)).map(([k,v])=>[k,scrub(v)])):value;
 return scrub(record) as Entity;
}
