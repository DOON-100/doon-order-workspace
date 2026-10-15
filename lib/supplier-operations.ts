import {dateValue,numeric,today} from './ledger';
import type {Order} from './domain';
import type {KingdeePendingMetadata,KingdeePendingRow} from './kingdee-pending';

export type ProcurementSnapshot={id:string;headers:string[];rows:KingdeePendingRow[];metadata:KingdeePendingMetadata};
export type PendingMaterial={sourceRow:number;po:string;supplier:string;buyer:string;itemCode:string;itemName:string;spec:string;unit:string;quantity:number|null;dueDate:string;customerOrder:string;note:string;category:string;sampleEvidence:string;raw:Record<string,string>};
const materialGroups:Array<[string,RegExp]>=[
 ['外协加工',/电镀|PVD|喷涂|喷油|抛光|滚桶|真空镀|阳极|激光|镭射/i],
 ['镜片',/镜片|太阳片|光学片|偏光|lens/i],
 ['包材',/包装|包材|镜盒|眼镜盒|眼镜布|擦镜布|纸箱|胶袋|说明书|吊牌|标签|眼镜袋/i],
 ['板料 / 胶料',/板料|板材|胶料|醋酸|acetate|TR90|尼龙|注塑/i],
 ['钛料 / 金属',/钛|金属|不锈钢|钢材|钢线|铜料|铜材|铝|titanium/i],
 ['铰链 / 小配件',/铰链|铰|螺丝|螺母|鼻托|托叶|托臂|弹弓|桩头|垫片|配件/i],
 ['镜腿 / 脾',/镜腿|脚套|脾|temple/i],
 ['镜框 / 圈',/镜框|镜架|前框|镜圈|圈丝|中梁|横梁/i],
];
export function materialCategory(text:string){return materialGroups.find(([,pattern])=>pattern.test(text))?.[0]||'其他 / 待分类';}
export function sampleEvidence(text:string){return text.match(/样办|样板|打样|试样|试产|新品|新款|首样|\bsample\b|\bprototype\b/i)?.[0]||'';}
function valueOf(raw:Record<string,string>,names:string[]){for(const name of names){const key=Object.keys(raw).find(k=>k.replace(/\s/g,'')===name);if(key&&raw[key])return raw[key];}return '';}
export function pendingMaterials(snapshot:ProcurementSnapshot|null|undefined):PendingMaterial[]{
 if(!snapshot)return [];
 return snapshot.rows.filter(r=>r.rowType==='data').map(row=>{
  const raw=Object.fromEntries(snapshot.headers.map((h,i)=>[h,String(row.displayValues?.[i]??row.values?.[i]??'').trim()]));
  const original=Object.fromEntries(snapshot.headers.map((h,i)=>[h,String(row.values?.[i]??'').trim()]));
  const get=(...names:string[])=>valueOf(raw,names),itemName=get('商品名称','物料名称','品名'),spec=get('规格型号','规格','商品规格'),note=get('商品行备注','行备注','备注');
  const dates=['预计交货日期','交货日期','预计到货日期','交货期'],quantities=['数量','未上货数量','未入库数量','未到货数量'];
  return {sourceRow:row.sourceRow,po:get('单据编号','采购订单号','采购单号','订单编号'),supplier:get('供应商','供应商名称'),buyer:get('业务员','采购员','采购负责人'),itemCode:get('商品编码','物料编码','商品编号'),itemName,spec,unit:get('单位','基本单位'),quantity:numeric(valueOf(original,quantities))??numeric(get(...quantities)),dueDate:dateValue(get(...dates))||dateValue(valueOf(original,dates)),customerOrder:get('客户订单编号','客户订单号','客户单号'),note,category:materialCategory(itemName+' '+spec),sampleEvidence:sampleEvidence(itemName+' '+spec+' '+note),raw};
 });
}
export function quantityByUnit(rows:PendingMaterial[]){
 const result=new Map<string,{unit:string;quantity:number;unknown:number;rows:number}>();
 for(const row of rows){const unit=row.unit||'单位未填写',item=result.get(unit)||{unit,quantity:0,unknown:0,rows:0};item.rows++;if(row.quantity===null)item.unknown++;else item.quantity+=row.quantity;result.set(unit,item);}
 return [...result.values()].sort((a,b)=>a.unit.localeCompare(b.unit,'zh-CN'));
}
export function pendingRisks(row:PendingMaterial[],asOf=today()){
 return row.flatMap(item=>{
  const reasons:string[]=[];
  if(item.dueDate&&item.dueDate<asOf)reasons.push('原表交期已过');
  if(!item.dueDate)reasons.push('交期待核对');
  if(!item.supplier)reasons.push('供应商待核对');
  if(!item.itemCode)reasons.push('商品编码待核对');
  if(!item.unit||item.quantity===null||item.quantity<0)reasons.push('数量 / 单位待核对');
  return reasons.length?[{...item,reasons}]:[];
 });
}
export function kitState(order:Order){
 const columns=order.ledger?.columns||{};
 return {accessories:dateValue(columns.AC),sheet:dateValue(columns.AD),kit:dateValue(columns.AE),started:dateValue(columns.AF),status:dateValue(columns.AE)?'齐料日期已登记':columns.AE==='-'?'原表标记不适用':'齐料日期待核对'};
}
/** A shared customer order number is an order-level clue, never a color/BOM allocation. */
export function materialsForOrder(order:Order,rows:PendingMaterial[]){return order.orderNo?rows.filter(row=>!!row.customerOrder&&row.customerOrder===order.orderNo):[];}
