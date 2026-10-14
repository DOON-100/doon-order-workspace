import {all,clean,newId,now,type CustomerAccount,type Entity,type Member,type State} from './domain';
const key=(value:unknown)=>clean(value).toLowerCase();
const valid=(value:unknown):value is string=>typeof value==='string'&&!!clean(value)&&clean(value).length<=160;
const historicalIndexes=new WeakMap<State,Map<string,string[]>>();

/** Historical names/codes come from an authorized master edit or an explicit,
 * evidenced confirmation of a legacy code that was missing from the master.
 * Source-note IDs and user-supplied aliases never enter this identity index. */
export function historicalCustomerIdentities(s:State,customerId:string):string[]{
 let index=historicalIndexes.get(s);
 if(!index){index=new Map();for(const record of all(s,'customer_workflow_identity')){const confirmedLegacy=record.origin==='user-confirmed-legacy-code'&&valid(record.confirmedCode)&&typeof record.reason==='string'&&!!clean(record.reason)&&typeof record.actorId==='string'&&!!clean(record.actorId);if(typeof record.customerId!=='string'||record.origin!=='customer-master-edit'&&!confirmedLegacy||!Number.isInteger(record.customerVersion)||record.customerVersion<=0)continue;const values=index.get(record.customerId)||[];index.set(record.customerId,[...new Set([...values,...[record.name,record.code].filter(valid).map(clean)])]);}historicalIndexes.set(s,index);}
 return index.get(customerId)||[];
}

/** Prevent a rename/code change from claiming another customer's old identity. */
export function conflictingCustomerIdentity(s:State,customerId:string|undefined,name:string,code:string):boolean{
 const proposed=[name,code].filter(valid).map(key);
 return all(s,'customer_account').some(account=>account.id!==customerId&&[
  account.customer,account.customerCode,...historicalCustomerIdentities(s,account.id),
  ...all(s,'service_record').filter(r=>r.type==='customer_profile'&&r.customerId===account.id).map(r=>r.source?.confirmedCustomerCode),
 ].filter(valid).some(value=>proposed.includes(key(value))));
}

export function customerIdentityChanges(s:State,m:Member,before:CustomerAccount|undefined,next:CustomerAccount):Entity[]{
 if(!before||key(before.customer)===key(next.customer)&&key(before.customerCode)===key(next.customerCode))return [];
 const existing=all(s,'customer_workflow_identity').some(r=>r.customerId===before.id&&r.customerVersion===before.version&&r.origin==='customer-master-edit');
 if(existing)return [];
 return [{id:newId('customer_identity'),kind:'customer_workflow_identity',customerId:before.id,name:before.customer,code:before.customerCode,customerVersion:before.version,origin:'customer-master-edit',actorId:m.id,actor:m.name,createdAt:now()}];
}
