import {all,clean,type Entity,type State} from './domain';

// Keep the byte order of legacy scope identities: existing attachments compare
// this exact JSON string when their business ownership is checked.
export function businessFollowupSourceIdentity(s:State,row:Entity,seen=new Set<string>()):unknown{
 if(seen.has(row.id))return {id:row.id};const visited=new Set(seen);visited.add(row.id);
 const links:Record<string,unknown>={};for(const name of ['projectId','orderId','lineId','sourceOrderId','sourceId','recordId','taskId','quoteId','quoteLinkId'])if(row[name]){const parent=s.records.find(r=>r.id===row[name]);links[name]=parent&&visited.size<5?businessFollowupSourceIdentity(s,parent,visited):String(row[name]);}
 // A historical procurement row can match several order lines; preserve every
 // matching identity so ownership changes cannot transfer earlier evidence.
 if(row.kind==='purchase'&&row.customerOrder)links.customerOrders=all(s,'order').filter(order=>order.orderNo===row.customerOrder).sort((a,b)=>a.id.localeCompare(b.id)).map(order=>businessFollowupSourceIdentity(s,order,visited));
 const customerId=String(row.kind==='customer_account'?row.id:row.customerId||row.customerAccountId||'');
 return {id:row.id,kind:row.kind,customerId,...(!customerId?{customer:clean(row.customer).toLowerCase(),customerName:clean(row.customerName).toLowerCase(),customerCode:clean(row.customerCode).toLowerCase(),...(row.kind==='customer_project_followup'?{ownerId:clean(row.ownerId)}:{})}:{}),customerOrder:clean(row.customerOrder),teamId:clean(row.teamId),type:clean(row.type),channel:clean(row.channel),links};
}
export function businessFollowupScopeIdentity(s:State,row:Entity){return JSON.stringify(businessFollowupSourceIdentity(s,row));}
