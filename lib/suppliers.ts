import {broad,type Member,type Entity} from './domain';
import {today,days} from './ledger';
export const managesSuppliers=(m:Member)=>broad(m);
export const canCreateOutsource=(m:Member)=>broad(m)||m.role==='clerk';
export const canSeeSupplierPrice=(m:Member)=>['admin','pmc','finance','sales'].includes(m.role)||['杨德周','曲艳红'].includes(m.name);
export function outsourceApprover(process:string,productType:string){
 const p=String(process||'').toLowerCase(),t=String(productType||'').toLowerCase();
 if(/plating|spray|电镀|喷油/.test(p))return '杨德周';
 if(/polishing|抛光|打磨/.test(p))return /胶|板材|acetate|plastic/.test(t)?'盛武斌':'杨伟光';
 if(/包装|印刷|packing|print/.test(p))return '蒋志林';
 if(/胶|板材|acetate|plastic/.test(t))return '盛武斌';
 if(/钛|金属|metal|titanium/.test(t))return '杨伟光';
 return '杨德周';
}
export const supplierPending=(x:Entity)=>x.status!=='已取消'&&x.received<x.quantity;
export const arrivalDate=(x:Entity)=>x.expectedDate||x.promisedDate||x.dueDate||'';
export function supplierStatus(x:Entity,asOf=today()){
 if(x.status==='已取消')return '已取消';
 if(x.approvalStatus==='待主管审批')return '待主管审批';
 if(x.approvalStatus==='已驳回')return '已驳回';
 if(x.received>=x.quantity)return '已收齐';
 if((x.dueDate&&x.dueDate<asOf)||(arrivalDate(x)&&arrivalDate(x)<asOf))return '已逾期';
 if(!x.promisedDate)return '待供应商复期';
 if(arrivalDate(x)>x.dueDate)return '交期风险';
 if((days(asOf,arrivalDate(x))??99)<=3)return '3天内到货';
 return '待回货';
}
export const needsFollowup=(x:Entity,asOf=today())=>supplierPending(x)&&!!x.nextFollowupDate&&x.nextFollowupDate<=asOf;
export function matchesSupplierStatus(x:Entity,status:string){return !status||(status==='pending'?supplierPending(x):status==='followup'?needsFollowup(x):status==='待供应商复期'?supplierPending(x)&&!x.promisedDate:supplierStatus(x)===status);}
