import {all,broad,canRead,productTypeOf,type Entity,type Member,type Order,type State} from './domain';
import {countValue} from './ledger';

export type FinishedStage={id:string;label:string;baseline:number|null;completed:number|null};
export type FinishedTask=Entity&{kind:'finished_supplier_task';lineId:string;supplierId:string;supplierName:string;orderNo:string;drawing:string;color:string;lens:string;productType:string;quantity:number;unit?:'付'|'副';businessType?:'finished_full_outsource';baselineStatus?:'pending'|'confirmed';template:string;stages:FinishedStage[];dueDate:string;promisedDate:string;baselineStock:number|null;baselineStockReturned:number;baselineRework:number;baseline:{cutoffDate:string;note:string};acceptedAt:string;acceptedDate:string;closedAt:string;version:number;createdAt:string;updatedAt:string;lastException:{category:string;note:string;date:string;expectedDate:string}|null};
export type FinishedShipment=Entity&{kind:'finished_supplier_shipment';taskId:string;reference:string;quantity:number;date:string;expectedDate:string;note:string;reworkId:string;source:'baseline-transit'|'baseline-inspection'|'supplier';received:number;accepted:number;rejected:number;stocked:number;returned:number;attachmentIds:string[];createdAt:string;updatedAt:string};
export type FinishedRework=Entity&{kind:'finished_supplier_rework';taskId:string;reference:string;quantity:number;date:string;note:string;sourceShipmentId:string;parentId:string;source:'baseline'|'qc'|'return';confirmedAt:string;confirmedDate:string;shipped:number;accepted:number;stocked:number;transferred:number;createdAt:string;updatedAt:string};
export type FinishedEvent=Entity&{kind:'finished_supplier_event';taskId:string;action:string;actorId:string;actor:string;actorType:'supplier'|'employee';token:string;fingerprint:string;date:string;note:string;data:Record<string,unknown>;createdAt:string};
export type FinishedAttachment=Entity&{kind:'finished_supplier_attachment';taskId:string;filename:string;contentType:string;size:number;fileKey:string;hash:string;actorId:string;createdAt:string;token:string;fingerprint:string};

const metal=[['materials','齐料'],['welding','焊接'],['polishing','打磨'],['plating','电镀／喷涂'],['kit','配套'],['assembly','装配／装片'],['adjustment','调校'],['inspection','供应商终检'],['packing','包装']];
const acetate=[['materials','齐料'],['cnc','车房加工'],['barrel','下桶／出桶'],['temple','脾加工'],['kit','配套'],['assembly','钉装／装配'],['adjustment','调校'],['inspection','供应商终检'],['packing','包装']];
export const finishedTemplates=[{id:'metal',label:'钛架／金属架',steps:metal.map(([id,label])=>({id,label}))},{id:'acetate',label:'胶架／板材架',steps:acetate.map(([id,label])=>({id,label}))},{id:'custom',label:'自选固定工序',steps:[...new Map([...metal,...acetate].map(([id,label])=>[id,{id,label}])).values()]}];
export const isSupplierMember=(m:Member)=>String(m.role)==='supplier';
export const supplierMemberId=(m:Member)=>String((m as Member&{supplierId?:string}).supplierId||'');
export const canOperateFinished=(m:Member)=>!isSupplierMember(m)&&(broad(m)||m.role==='production'||(m.role==='clerk'&&!!m.departments?.includes('finished')));
export const finishedTasks=(s:State)=>all(s,'finished_supplier_task') as FinishedTask[];
export const finishedShipments=(s:State,id:string)=>(all(s,'finished_supplier_shipment') as FinishedShipment[]).filter(x=>x.taskId===id);
export const finishedReworks=(s:State,id:string)=>(all(s,'finished_supplier_rework') as FinishedRework[]).filter(x=>x.taskId===id);
export function canReadFinished(s:State,m:Member,t:FinishedTask){
 if(!m.active)return false;
 if(isSupplierMember(m))return !!supplierMemberId(m)&&t.supplierId===supplierMemberId(m)&&all(s,'supplier').some(x=>x.id===t.supplierId&&x.active!==false);
 const o=all(s,'order').find(x=>x.id===t.lineId) as Order|undefined;return !!o&&canRead(m,o);
}
export const reworkComplete=(r:FinishedRework)=>r.stocked+r.transferred>=r.quantity;
export const pendingFinishedBaseline=(t:FinishedTask)=>t.baselineStatus==='pending'||t.baselineStock===null;
export function finishedBalance(s:State,t:FinishedTask){
 if(pendingFinishedBaseline(t)||t.baselineStock===null)return {stocked:null,remaining:null,normalDispatched:null,inTransit:null,pendingInspection:null,pendingStock:null,openRework:null};
 const shipments=finishedShipments(s,t.id),stocked=t.baselineStock-t.baselineStockReturned+shipments.reduce((n,x)=>n+x.stocked-x.returned,0);
 const normalDispatched=t.baselineStock+t.baselineRework+shipments.filter(x=>!x.reworkId).reduce((n,x)=>n+x.quantity,0);
 return {stocked,remaining:t.quantity-stocked,normalDispatched,inTransit:shipments.reduce((n,x)=>n+x.quantity-x.received,0),pendingInspection:shipments.reduce((n,x)=>n+x.received-x.accepted-x.rejected,0),pendingStock:shipments.reduce((n,x)=>n+x.accepted-x.stocked,0),openRework:finishedReworks(s,t.id).filter(x=>!reworkComplete(x)).reduce((n,x)=>n+x.quantity-x.stocked-x.transferred,0)};
}
export function finishedStatus(s:State,t:FinishedTask){
 if(t.closedAt)return '已结单';if(pendingFinishedBaseline(t))return t.acceptedAt?'待公司核定期初':'待公司核定 · 待供应商接单';if(!t.acceptedAt)return '待供应商接单';const b=finishedBalance(s,t);if(b.stocked===null)return '待公司核定期初';
 if(b.remaining===0&&b.inTransit===0&&b.pendingInspection===0&&b.pendingStock===0&&b.openRework===0)return '履约完成 · 待结单';
 if(b.openRework>0)return '返工待处理';if(b.pendingInspection>0)return '到货待检';if(b.pendingStock>0)return '合格待入仓';if(b.inTransit>0)return '在途／部分交货';if(b.stocked>0)return '部分入仓';return '生产中';
}
export function publicFinishedTask(s:State,t:FinishedTask,supplier=false){
 const b=finishedBalance(s,t),o=all(s,'order').find(x=>x.id===t.lineId) as Order|undefined;
 return {id:t.id,...(!supplier?{lineId:t.lineId,orderVersion:o?.version}:{}),supplierId:t.supplierId,supplierName:t.supplierName,orderNo:t.orderNo,drawing:t.drawing,color:t.color,lens:t.lens,productType:t.productType,quantity:t.quantity,unit:t.unit||'副',businessType:t.businessType||'finished_full_outsource',baselineStatus:pendingFinishedBaseline(t)?'pending':'confirmed',template:t.template,stages:t.stages.map(x=>({...x})),dueDate:t.dueDate,promisedDate:t.promisedDate,baselineStock:t.baselineStock,baselineStockReturned:t.baselineStockReturned,baseline:{cutoffDate:t.baseline.cutoffDate,...(!supplier?{note:t.baseline.note}:{})},acceptedAt:t.acceptedAt,acceptedDate:t.acceptedDate,closedAt:t.closedAt,version:t.version,createdAt:t.createdAt,updatedAt:t.updatedAt,lastException:t.lastException,status:finishedStatus(s,t),...b};
}
export function publicFinishedShipment(x:FinishedShipment){return {id:x.id,taskId:x.taskId,reference:x.reference,quantity:x.quantity,date:x.date,expectedDate:x.expectedDate,note:x.note,reworkId:x.reworkId,source:x.source,received:x.received,accepted:x.accepted,rejected:x.rejected,stocked:x.stocked,returned:x.returned,attachmentIds:x.attachmentIds,createdAt:x.createdAt,updatedAt:x.updatedAt,status:x.stocked+x.rejected===x.quantity?'已处理':x.accepted+x.rejected===x.received&&x.received===x.quantity?'验收完成':x.received>0?'已到货／待处理':'在途'};}
export function publicFinishedRework(x:FinishedRework){return {id:x.id,taskId:x.taskId,reference:x.reference,quantity:x.quantity,date:x.date,note:x.note,sourceShipmentId:x.sourceShipmentId,parentId:x.parentId,source:x.source,confirmedAt:x.confirmedAt,confirmedDate:x.confirmedDate,shipped:x.shipped,accepted:x.accepted,stocked:x.stocked,transferred:x.transferred,createdAt:x.createdAt,updatedAt:x.updatedAt,status:reworkComplete(x)?'已关闭':x.confirmedAt?'返工／待复验':'待供应商确认'};}
export function publicFinishedEvent(e:FinishedEvent,supplier=false){const {lineId,orderVersion,...safe}=e.data;const internalBaseline=supplier&&['task-create','baseline-stage','baseline-confirm'].includes(e.action);const data=internalBaseline?{template:safe.template,steps:safe.steps,baselineStatus:safe.baselineStatus,baselineStock:safe.baselineStock,stageId:safe.stageId,quantity:safe.quantity}:supplier?safe:e.data;return {id:e.id,taskId:e.taskId,action:e.action,date:e.date,note:internalBaseline?(safe.baselineStatus==='pending'?'任务已发布，期初数量待公司核定':'公司已核定期初基线'):e.note,data,actor:supplier&&e.actorType==='employee'?'公司':e.actor,actorType:e.actorType,createdAt:e.createdAt};}
export function publicFinishedAttachment(x:FinishedAttachment){return {id:x.id,taskId:x.taskId,filename:x.filename,contentType:x.contentType,size:x.size,createdAt:x.createdAt};}
export function finishedData(s:State,m:Member){
 const supplier=isSupplierMember(m),tasks=finishedTasks(s).filter(t=>canReadFinished(s,m,t)),ids=new Set(tasks.map(t=>t.id));
 const dto={tasks:tasks.map(t=>publicFinishedTask(s,t,supplier)),shipments:(all(s,'finished_supplier_shipment') as FinishedShipment[]).filter(x=>ids.has(x.taskId)).map(publicFinishedShipment),reworks:(all(s,'finished_supplier_rework') as FinishedRework[]).filter(x=>ids.has(x.taskId)).map(publicFinishedRework),events:(all(s,'finished_supplier_event') as FinishedEvent[]).filter(x=>ids.has(x.taskId)).map(e=>publicFinishedEvent(e,supplier)),attachments:(all(s,'finished_supplier_attachment') as FinishedAttachment[]).filter(x=>ids.has(x.taskId)).map(publicFinishedAttachment),templates:finishedTemplates};
 if(supplier)return dto;
 return {...dto,supplierMasters:all(s,'supplier').filter(x=>x.active!==false).map(x=>({id:x.id,name:x.name})),availableOrders:(all(s,'order') as Order[]).filter(o=>canRead(m,o)&&o.lifecycle!=='archived'&&o.sourceStatus!=='已取消').map(o=>({id:o.id,version:o.version,orderNo:o.orderNo,drawing:o.drawing,color:o.color,lens:o.lens,productType:productTypeOf(o),quantity:o.quantity,unit:o.unit||'副',businessType:o.businessType||'finished_full_outsource',warehouse:countValue(o.ledger?.columns.BF),factoryName:o.ledger?.columns.A||o.extra?.['生产厂']||'',plannedDate:o.plannedDate,requestedDate:o.requestedDate}))};
}
