import {z} from 'zod';
import {all,clean,type CustomerAccount,type Entity,type Member,type State} from './domain';
import {explicitCustomerResponsibility} from './customer-responsibility';

// A separate grant prevents broad order/PMC roles from also exposing customer prices.
// Names and account IDs are configuration data, never a source-code allowlist.
export type CustomerQuoteAccessPolicy=Entity & {
 kind:'customer_quote_access';memberIds:string[];aliasesByMember:Record<string,string[]>;
};
const nonempty=z.string().trim().min(1).max(240);
const accessPolicySchema=z.object({
 id:nonempty,kind:z.literal('customer_quote_access'),
 memberIds:z.array(nonempty).max(1000).refine(ids=>new Set(ids).size===ids.length),
 aliasesByMember:z.record(z.array(nonempty).max(30)),
}).passthrough();

export function customerQuoteAccessPolicy(s:State):CustomerQuoteAccessPolicy|null{
 const records=all(s,'customer_quote_access');
 // Missing, duplicate or malformed configuration must never widen access.
 if(records.length!==1)return null;
 const result=accessPolicySchema.safeParse(records[0]);
 return result.success?result.data as CustomerQuoteAccessPolicy:null;
}
export const isCustomerQuoteAdministrator=(m:Member)=>m.active&&m.role==='admin';
export function canUseCustomerQuotes(s:State,m:Member){
 return !!m.active&&(isCustomerQuoteAdministrator(m)||!!customerQuoteAccessPolicy(s)?.memberIds.includes(m.id));
}

const nameKey=(value:unknown)=>clean(value).toLowerCase();
export function assignedCustomerQuoteAccount(s:State,m:Member,account:CustomerAccount){
 if(!m.active||!account.active||!canUseCustomerQuotes(s,m))return false;
 if(isCustomerQuoteAdministrator(m))return true;
 const explicit=explicitCustomerResponsibility(account,m,'quote');if(explicit!==undefined)return explicit;
 const policy=customerQuoteAccessPolicy(s)!;
 const aliases=Object.prototype.hasOwnProperty.call(policy.aliasesByMember,m.id)?policy.aliasesByMember[m.id]:[];
 const names=new Set([m.name,...aliases].map(nameKey).filter(Boolean));
 // Match an entire confirmed responsibility name: never substring-match, infer
 // English aliases, or fall back to creator, legacy customer scopes or PMC name.
 return [account.salesName,account.serviceName].some(name=>!!nameKey(name)&&names.has(nameKey(name)));
}
export function eligibleCustomerQuoteAccounts(s:State,m:Member){
 return (all(s,'customer_account') as CustomerAccount[]).filter(account=>assignedCustomerQuoteAccount(s,m,account));
}
export function canCreateCustomerQuote(s:State,m:Member){
 return isCustomerQuoteAdministrator(m)||eligibleCustomerQuoteAccounts(s,m).length>0;
}
