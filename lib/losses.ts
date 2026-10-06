import {canRead,managesProduction,type Member,type Order} from './domain';
import {active,countValue} from './ledger';
import {departments} from './departments';
import {isFinishedOutsource} from './manufacturing';

// A process belongs to one running balance, even when two warehouses may maintain it.
export const lossProcesses=[
 {id:'welding',name:'钛焊',good:'AG',input:['N'],departments:['titanium']},
 {id:'polishing',name:'打磨 / 出电',good:'AI',input:['AG'],departments:['titanium']},
 {id:'plating',name:'电镀回货',good:'AL',input:['AI'],departments:['plating']},
 {id:'titanium',name:'钛配套',good:'AO',input:['AL'],departments:['plating','semifinished']},
 {id:'temple',name:'脾加工',good:'AR',input:['N'],departments:['plastic']},
 {id:'temple-barrel',name:'脾出桶',good:'AT',input:['AR'],departments:['plastic']},
 {id:'cnc',name:'车房下桶',good:'AV',input:['N'],departments:['plastic']},
 {id:'cnc-out',name:'车房出桶',good:'AX',input:['AV'],departments:['plastic']},
 {id:'kit',name:'胶配套 / 发钉胶',good:'BA',input:['AX'],departments:['plastic']},
 {id:'assembly',name:'钉装',good:'BD',input:['BA','AX'],departments:['plastic']},
 {id:'packing',name:'包装入仓',good:'BF',input:['AO','BD'],departments:['finished']},
];
export type LossProcess=typeof lossProcesses[number];
export type LossRecord={id:string;kind:'loss';lineId:string;process:string;department:string;sequence:number;previousId:string;reportDate:string;month:string;input:number|null;good:number|null;wip:number|null;loss:number;delta:number;reason:string;correction:boolean;source:'balance'|'mes';sourceRef:string;actor:string;actorId:string;createdAt:string;orderVersion:number;orderNo:string;customer:string;drawing:string;color:string;lens:string;orderQuantity:number;sourceRow:number|null;fingerprint:string};
export const departmentName=(id:string)=>departments.find(d=>d.id===id)?.name||id;
export const processName=(id:string)=>lossProcesses.find(p=>p.id===id)?.name||id;
export const lossDepartments=departments.filter(d=>lossProcesses.some(p=>p.departments.includes(d.id)));
export const goodQuantity=(o:Order,p:LossProcess)=>countValue(o.ledger?.columns[p.good]);
export function mayRecordLoss(m:Member,o:Order,department:string){return !!o.ledger&&!isFinishedOutsource(o)&&active(o)&&canRead(m,o)&&(managesProduction(m)||(m.role==='clerk'&&!!m.departments?.includes(department)));}
export function latestLoss(records:LossRecord[],lineId:string,process:string){return records.filter(r=>r.lineId===lineId&&r.process===process).reduce<LossRecord|undefined>((last,r)=>!last||r.sequence>last.sequence?r:last,undefined);}
export function lossBalance(records:LossRecord[],lineId:string,department=''){const current=new Map<string,LossRecord>();for(const r of records)if(r.lineId===lineId&&(!current.has(r.process)||current.get(r.process)!.sequence<r.sequence))current.set(r.process,r);return [...current.values()].filter(r=>!department||r.department===department).reduce((n,r)=>n+r.loss,0);}
export type LossFilters={month:string;department?:string;q?:string;customer?:string};
export function filterLosses(records:LossRecord[],f:LossFilters){const q=(f.q||'').trim().toLowerCase();return records.filter(r=>r.month===f.month&&(!f.department||r.department===f.department)&&(!f.customer||r.customer===f.customer)&&(!q||[r.orderNo,r.customer,r.drawing,r.color,r.lens,r.reason].join(' ').toLowerCase().includes(q)));}
export function summarizeLosses(records:LossRecord[]){return lossDepartments.map(d=>{const rows=records.filter(r=>r.department===d.id),lines=new Map(rows.map(r=>[r.lineId,r]));return {department:d.id,name:d.name,orders:new Set(rows.map(r=>r.orderNo)).size,lines:lines.size,orderQuantity:[...lines.values()].reduce((n,r)=>n+r.orderQuantity,0),added:rows.reduce((n,r)=>n+Math.max(0,r.delta),0),reduced:rows.reduce((n,r)=>n+Math.max(0,-r.delta),0),net:rows.reduce((n,r)=>n+r.delta,0),records:rows.length};});}
