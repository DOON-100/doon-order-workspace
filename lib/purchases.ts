import {all,broad,canRead,readsAllOrders,type Entity,type Member,type Order,type State} from './domain';
import {today} from './ledger';
export const purchaseHeaders=['单据编号','单据日期','供应商','业务员','单据状态','关闭状态','预计交货日期','商品编码','商品名称','单位','数量','商品行备注','剩余备货天数','客户订单编号'];
export const followFields={promisedDate:'供应商复期',expectedDate:'预计到货',nextFollowupDate:'下次催交',followupNote:'采购跟进备注'};
export type Purchase=Entity & {kind:'purchase';version:number;sourceVersion:number;po:string;supplier:string;buyer:string;itemCode:string;itemName:string;unit:string;quantity:number;orderDate:string;dueDate:string;customerOrder:string;auditStatus:string;closeStatus:string;sourceNote:string;sourceRow:number;sourceAsOf:string;sourceHash:string;sourceFile:string;sourceSheet:string;sourceFilter:string;raw:Record<string,unknown>;promisedDate:string;expectedDate:string;nextFollowupDate:string;followupNote:string;balanceKnown:boolean;received:number;returnPending:number;lifecycle:'active'|'archived'};
export const purchaseKey=(p:Purchase)=>JSON.stringify([p.po,p.itemCode,p.customerOrder]);
export const roundQty=(n:number)=>Math.round((n+Number.EPSILON)*10000)/10000;
export const remaining=(p:Purchase)=>p.balanceKnown?roundQty(Math.max(0,p.quantity-p.received)):null;
export const full=(p:Purchase)=>p.balanceKnown&&remaining(p)===0&&p.returnPending===0;
export const sourceClosed=(p:Purchase)=>p.closeStatus!=='未关闭';
export function purchaseStatus(p:Purchase){
 if(p.lifecycle==='archived')return '已齐货 · 已存档';
 if(sourceClosed(p))return '金蝶已关闭';
 if(p.auditStatus!=='已审核')return '金蝶未审核';
 if(!p.balanceKnown)return '收货待核对';
 if(full(p))return '已齐货 · 待存档';
 if(p.returnPending>0)return '退货待补';
 const due=p.expectedDate||p.promisedDate||p.dueDate;
 if(due&&due<today())return '交期已逾期';
 if(!p.promisedDate)return '待供应商复期';
 return '采购跟进中';
}
export function visiblePurchases(s:State,m:Member):Purchase[]{
 const purchases=all(s,'purchase') as Purchase[];
 if(readsAllOrders(m)||broad(m))return purchases;
 const refs=new Set((all(s,'order') as Order[]).filter(o=>canRead(m,o)).map(o=>o.orderNo));
 return purchases.filter(p=>!!p.customerOrder&&refs.has(p.customerOrder));
}
export function filterPurchases(rows:Purchase[],f:Record<string,string>){return rows.filter(p=>(f.mode==='archived'?p.lifecycle==='archived':p.lifecycle!=='archived')&&(!f.supplier||p.supplier===f.supplier)&&(!f.buyer||p.buyer===f.buyer)&&(!f.status||purchaseStatus(p)===f.status)&&(!f.unit||p.unit===f.unit)&&(!f.from||p.dueDate>=f.from)&&(!f.to||(!!p.dueDate&&p.dueDate<=f.to))&&(!f.q||[p.po,p.supplier,p.itemCode,p.itemName,p.customerOrder,p.sourceNote,p.followupNote].join(' ').toLowerCase().includes(f.q.toLowerCase()))).sort((a,b)=>a.sourceAsOf.localeCompare(b.sourceAsOf)||a.sourceHash.localeCompare(b.sourceHash)||a.sourceRow-b.sourceRow);}
