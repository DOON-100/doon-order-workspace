import {all,type CustomerAccount,type Member,type State} from './domain';
import {matchesCustomerResponsibility} from './customer-responsibility';
import {customerQuoteAccessPolicy} from './customer-quote-access';

export function customerSalesMemberIds(s:State,customer:CustomerAccount){
 const aliases=customerQuoteAccessPolicy(s)?.aliasesByMember||{};
 return (all(s,'member') as Member[]).filter(m=>m.active&&m.role==='sales'&&matchesCustomerResponsibility(customer,m,'sales',aliases[m.id]||[])).map(m=>m.id);
}
/** Only an explicitly established or personally accepted primary is returned.
 * Pending handoffs never replace it; inactive/revoked identities fail closed. */
export function customerPrimarySalesMemberId(s:State,customerId:string):string{
 const customer=all(s,'customer_account').find(c=>c.id===customerId) as CustomerAccount|undefined;
 const state=all(s,'customer_workflow_state').find(c=>c.customerId===customerId);
 return customer&&typeof state?.primarySalesMemberId==='string'&&customerSalesMemberIds(s,customer).includes(state.primarySalesMemberId)?state.primarySalesMemberId:'';
}
