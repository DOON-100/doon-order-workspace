import {z} from 'zod';
import {all,clean,type CustomerAccount,type Member,type State} from './domain';

export const customerResponsibilityListKeys=['salesMemberIds','serviceMemberIds','quoteMemberIds'] as const;
export type CustomerResponsibilityListKey=typeof customerResponsibilityListKeys[number];
export type CustomerResponsibilitySide='sales'|'service'|'quote';
export type CustomerResponsibilityLists=Pick<CustomerAccount,CustomerResponsibilityListKey>;
export type CustomerResponsibilityInput={ [K in CustomerResponsibilityListKey]?:string[]|null };
type ResponsibilityNames=Pick<CustomerAccount,'salesName'|'serviceName'>;
const has=(value:object,key:PropertyKey)=>Object.prototype.hasOwnProperty.call(value,key);
const nameKey=(value:unknown)=>clean(value).toLowerCase();
const memberIds=z.array(z.string().trim().min(1).max(160)).max(1000)
 .refine(ids=>new Set(ids).size===ids.length,'客户责任成员不能重复');
export const customerResponsibilityFields={salesMemberIds:memberIds.nullable().optional(),serviceMemberIds:memberIds.nullable().optional(),quoteMemberIds:memberIds.nullable().optional()};

/** A present binding, including [], is authoritative. Invalid stored lists fail closed. */
export function explicitCustomerResponsibility(account:CustomerAccount,m:Member,side:CustomerResponsibilitySide):boolean|undefined{
 const key=`${side}MemberIds` as CustomerResponsibilityListKey;
 if(!has(account,key))return undefined;
 const parsed=memberIds.safeParse(account[key]);
 return m.active&&account.active&&parsed.success&&parsed.data.includes(m.id);
}

/** Only whole, administrator-confirmed names are accepted for pre-binding records. */
export function matchesCustomerResponsibility(account:CustomerAccount,m:Member,side:'sales'|'service',aliases:string[]=[]){
 if(!m.active||!account.active)return false;
 const explicit=explicitCustomerResponsibility(account,m,side);
 if(explicit!==undefined)return explicit;
 const names=new Set([m.name,...aliases].map(nameKey).filter(Boolean));
 const value=side==='sales'?account.salesName:account.serviceName;
 return !!nameKey(value)&&names.has(nameKey(value));
}

/** Read-modify-write metadata preservation; never re-grant stale responsibility lists. */
export function mergeCustomerResponsibilities(s:State,before:CustomerAccount|undefined,input:ResponsibilityNames&CustomerResponsibilityInput):CustomerResponsibilityLists{
 const result:CustomerResponsibilityLists={};
 const changedSales=!!before&&nameKey(before.salesName)!==nameKey(input.salesName);
 const changedService=!!before&&nameKey(before.serviceName)!==nameKey(input.serviceName);
 const activeMembers=new Set((all(s,'member') as Member[]).filter(member=>member.active).map(member=>member.id));
 for(const key of customerResponsibilityListKeys){
  if(has(input,key)){
   if(input[key]===null){result[key]=undefined;continue;}
   const parsed=memberIds.parse(input[key]);
   if(parsed.some(id=>!activeMembers.has(id)))throw new Error('客户责任名单包含不存在或已停用的成员，请刷新后重新确认。');
   result[key]=parsed;
  }else if(before&&has(before,key)){
   const changed=key==='salesMemberIds'?changedSales:key==='serviceMemberIds'?changedService:changedSales||changedService;
   // undefined removes the old binding when merged onto an existing object.
   // JSON persistence omits it and activates the new exact-name responsibility.
   result[key]=changed?undefined:before[key];
  }
 }
 return result;
}

/** Legacy clients may echo an unchanged binding while editing contact details. */
export function customerResponsibilityListsChanged(before:CustomerAccount|undefined,input:CustomerResponsibilityInput){
 return customerResponsibilityListKeys.some(key=>has(input,key)&&JSON.stringify(input[key])!==JSON.stringify(before?.[key]));
}
