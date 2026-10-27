/** Pure, shared arithmetic for the worksheet and server. Amounts are CNY per pair. */
export type IeFormulaVersion='ie-cost-v2-line-loss'|'ie-cost-v3-excel'|'ie-cost-v4-manual';
export type IeManualAdjustment={target:string;value:number;reason:string;sourceSignature:string};
export type IeAdjustmentCell={target:string;label:string;automaticValue:number|null;effectiveValue:number|null;sourceSignature:string;adjustment?:IeManualAdjustment;stale:boolean;applied:boolean};
export type IeLineAdjustmentKey='material'|'materialLoss'|'materialWithLoss'|'process'|'plating'|'outsourcing'|'outsourcingTotal'|'indirectLabor'|'rent'|'water'|'electricity'|'depreciation'|'supplies'|'indirect'|'laborTotal'|'productionCost'|'productionCostUsd'|'factoryPriceCny'|'factoryPriceUsd';
const targetPart=(value:string)=>encodeURIComponent(value);
export const ieAdjustmentTargets={material:(lineId:string,rowId:string)=>`line:${targetPart(lineId)}:material:${targetPart(rowId)}:amount`,process:(lineId:string,rowId:string)=>`line:${targetPart(lineId)}:process:${targetPart(rowId)}:amount`,outsourcing:(lineId:string,rowId:string)=>`line:${targetPart(lineId)}:outsourcing:${targetPart(rowId)}:amount`,line:(lineId:string,key:IeLineAdjustmentKey)=>`line:${targetPart(lineId)}:${key}`,tooling:'toolingChargeCny'};
export type IeCalculationInput={
 exchangeRateCnyPerUsd:number|null;
 lines:{id:string;model?:string;materials:{id?:string;name?:string;specification?:string;unit?:string;catalogId?:string;catalogVersion?:number|null;nameReference?:{catalogId:string;catalogVersion:number;entryId:string};priceSource?:string;basePrice:number|null;usage:number|null;coefficient:number|null;lossRate?:number;notApplicable:boolean}[];processes:{id?:string;name?:string;catalogId?:string;catalogVersion?:number|null;priceSource?:string;basePrice:number|null;difficulty:number|null;usage?:number|null;notApplicable:boolean}[];outsourcing:{id?:string;name?:string;part?:string;catalogId?:string;catalogVersion?:number|null;priceSource?:string;category:'plating'|'general';unitPrice:number|null;usage?:number|null;notApplicable:boolean}[]}[];
 tooling:{id?:string;toolingId?:string;name?:string;lineIds?:string[];chargeMode:string;amount:number|null;chargeQuoteId?:string;chargeVersion?:number|null}[];
 manualAdjustments?:IeManualAdjustment[];
 costs?:{formulaVersion?:string};
};
const SCALE=BigInt(1000000);
const micro=(v:number)=>BigInt(Math.round(v*1e6));
const div=(n:bigint,d:bigint)=>(n+d/BigInt(2))/d;
const out=(v:bigint)=>Number(v)/1e6;
const multiply=(values:number[],digits=6)=>{
 const scale=BigInt(10)**BigInt(digits),numerator=values.reduce((p,v)=>p*micro(v),BigInt(1));
 return Number(div(numerator*scale,SCALE**BigInt(values.length)))/Number(scale);
};
const sum=(values:number[])=>out(values.reduce((p,v)=>p+micro(v),BigInt(0)));
const cents=(value:number)=>Number(div(micro(value),BigInt(10000)))/100;
export {multiply as ieCostMultiply,sum as ieCostSum,cents as ieCostRoundCents};
export function ieCalculationVersion(fields:IeCalculationInput):IeFormulaVersion{
 // Saved snapshots retain their original rules. Presence of the editable
 // adjustment collection opts a new save into the manual-price rules.
 const saved=fields.costs?.formulaVersion;
 if(saved==='ie-cost-v2-line-loss'||saved==='ie-cost-v3-excel'||saved==='ie-cost-v4-manual')return saved;
 return fields.manualAdjustments===undefined?'ie-cost-v3-excel':'ie-cost-v4-manual';
}
/** A deterministic dependency fingerprint, not an authorization token. The
 * server reconstructs it independently; quote permissions still authorize edits. */
function signature(value:unknown){const text=JSON.stringify(value);let a=2166136261,b=2246822519;for(let i=0;i<text.length;i++){const code=text.charCodeAt(i);a=Math.imul(a^code,16777619);b=Math.imul(b^code,3266489917);}return 'ie-adjust-v1:'+(a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');}
const completeSum=(values:(number|null)[])=>values.some(v=>v===null)?null:sum(values as number[]);
export function calculateIeQuote(fields:IeCalculationInput){
 const formulaVersion=ieCalculationVersion(fields),excel=formulaVersion!=='ie-cost-v2-line-loss',manual=formulaVersion==='ie-cost-v4-manual';
 const adjustmentCells:IeAdjustmentCell[]=[],warnings:string[]=[],tokens=new Map<string,unknown>();
 const overrides=new Map((manual?fields.manualAdjustments||[]:[]).map(a=>[a.target,a]));
 const cell=(target:string,label:string,automaticValue:number|null,source:unknown,eligible=true)=>{
  const sourceSignature=signature([target,automaticValue,source]),adjustment=overrides.get(target),stale=!!adjustment&&(!eligible||adjustment.sourceSignature!==sourceSignature),applied=!!adjustment&&!stale;
  const effectiveValue=applied?adjustment!.value:automaticValue;
  adjustmentCells.push({target,label,automaticValue,effectiveValue,sourceSignature,...(adjustment?{adjustment}:{}),stale,applied});
  tokens.set(target,[sourceSignature,effectiveValue,applied]);return effectiveValue;
 };
 const token=(target:string)=>tokens.get(target);
 const lines=fields.lines.map(l=>{
  const target=(key:IeLineAdjustmentKey)=>ieAdjustmentTargets.line(l.id,key),label=l.model||l.id;
  const lineCell=(key:IeLineAdjustmentKey,title:string,automatic:number|null,source:unknown)=>cell(target(key),label+' / '+title,automatic,source);
  const materialRows=l.materials.map((r,i)=>{const t=ieAdjustmentTargets.material(l.id,r.id??String(i)),automatic=r.notApplicable?0:r.basePrice===null||r.usage===null||r.coefficient===null?null:multiply([r.basePrice,r.usage,r.coefficient],excel?2:6);return {row:r,target:t,value:cell(t,label+' / 材料 '+(r.name||String(i+1))+' 金额',automatic,[r.name,r.specification||'',r.unit||'',r.catalogId||'',r.catalogVersion??null,r.nameReference?[r.nameReference.catalogId,r.nameReference.catalogVersion,r.nameReference.entryId]:null,r.priceSource,r.basePrice,r.usage,r.coefficient,r.notApplicable],!r.notApplicable)};});
  const processRows=l.processes.map((r,i)=>{const usage=r.usage===undefined?1:r.usage,t=ieAdjustmentTargets.process(l.id,r.id??String(i)),automatic=r.notApplicable?0:r.basePrice===null||r.difficulty===null||usage===null?null:multiply([r.basePrice,r.difficulty,usage]);return {row:r,target:t,value:cell(t,label+' / 工序 '+(r.name||String(i+1))+' 金额',automatic,[r.name,r.catalogId||'',r.catalogVersion??null,r.priceSource,r.basePrice,r.difficulty,usage,r.notApplicable],!r.notApplicable)};});
  const outsourcingRows=l.outsourcing.map((r,i)=>{const usage=r.usage===undefined?1:r.usage,t=ieAdjustmentTargets.outsourcing(l.id,r.id??String(i)),automatic=r.notApplicable?0:r.unitPrice===null||usage===null?null:multiply([r.unitPrice,usage]);return {row:r,target:t,value:cell(t,label+' / '+(r.category==='plating'?'电镀':'一般外发')+' '+(r.name||String(i+1))+' 金额',automatic,[r.name,r.part||'',r.catalogId||'',r.catalogVersion??null,r.priceSource,r.category,r.unitPrice,usage,r.notApplicable],!r.notApplicable)};});
  const material=lineCell('material','材料净额',l.materials.length?completeSum(materialRows.map(r=>r.value)):null,materialRows.map(r=>token(r.target)));
  const process=lineCell('process','直接人工 / 工序',l.processes.length?completeSum(processRows.map(r=>r.value)):null,processRows.map(r=>token(r.target)));
  const categoryRows=(category:'plating'|'general')=>outsourcingRows.filter(r=>r.row.category===category),categoryTotal=(category:'plating'|'general')=>{const rows=categoryRows(category);return rows.length?completeSum(rows.map(r=>r.value)):null;};
  const plating=lineCell('plating','电镀',categoryTotal('plating'),categoryRows('plating').map(r=>token(r.target)));
  const outsourcing=lineCell('outsourcing','一般外发',categoryTotal('general'),categoryRows('general').map(r=>token(r.target)));
  const rawLoss=l.materials.length?completeSum(materialRows.filter(r=>!r.row.notApplicable).map(({row:r,value})=>value===null?null:excel?multiply([value,r.lossRate??.1]):multiply([r.basePrice!,r.usage!,r.coefficient!,r.lossRate??.1]))):null;
  // Original Excel rounds each material line to cents, then the total material
  // loss to cents. Weighting each rounded line preserves individual extra loss.
  const materialLoss=lineCell('materialLoss','材料损耗额',rawLoss===null?null:excel?cents(rawLoss):rawLoss,materialRows.map(r=>[token(r.target),r.row.lossRate??.1,r.row.notApplicable]));
  const materialWithLoss=lineCell('materialWithLoss','材料含损耗合计',completeSum([material,materialLoss]),[token(target('material')),token(target('materialLoss'))]);
  const outsourcingTotal=lineCell('outsourcingTotal','电镀及一般外发合计',completeSum([plating,outsourcing]),[token(target('plating')),token(target('outsourcing'))]);
  const indirectLabor=lineCell('indirectLabor','间接人工',5,5),rent=lineCell('rent','房租',3,3),water=lineCell('water','水费',.2,.2),electricity=lineCell('electricity','电费',2,2),depreciation=lineCell('depreciation','折旧',2,2),supplies=lineCell('supplies','辅料',1.5,1.5);
  const indirect=lineCell('indirect','间接费用合计',completeSum([indirectLabor,rent,water,electricity,depreciation,supplies]),(['indirectLabor','rent','water','electricity','depreciation','supplies'] as const).map(k=>token(target(k))));
  const laborTotal=lineCell('laborTotal','直接人工及间接费合计',completeSum([process,indirect]),[token(target('process')),token(target('indirect'))]);
  const productionCost=lineCell('productionCost','生产成本 CNY',completeSum([materialWithLoss,outsourcingTotal,laborTotal]),[token(target('materialWithLoss')),token(target('outsourcingTotal')),token(target('laborTotal'))]);
  const converted=(value:number|null)=>value===null||!fields.exchangeRateCnyPerUsd?null:out(div(micro(value)*SCALE,micro(fields.exchangeRateCnyPerUsd)));
  const productionCostUsd=lineCell('productionCostUsd','生产成本 USD',converted(productionCost),[token(target('productionCost')),fields.exchangeRateCnyPerUsd]);
  const factoryPriceCny=lineCell('factoryPriceCny','IE 出厂价 CNY',productionCost===null?null:multiply([productionCost,1.3]),token(target('productionCost')));
  const usdCostAdjusted=adjustmentCells.find(c=>c.target===target('productionCostUsd'))?.applied;
  if(usdCostAdjusted&&adjustmentCells.find(c=>c.target===target('factoryPriceCny'))?.applied)warnings.push(label+'：CNY 出厂价和 USD 生产成本分别人工调整，USD 出厂价默认按人工 USD 成本 × 1.3；请审核两种币种口径。');
  const factoryPriceUsd=lineCell('factoryPriceUsd','IE 出厂价 USD',usdCostAdjusted?(productionCostUsd===null?null:multiply([productionCostUsd,1.3])):converted(factoryPriceCny),usdCostAdjusted?[token(target('productionCostUsd')),1.3]:[token(target('factoryPriceCny')),fields.exchangeRateCnyPerUsd]);
  return {lineId:l.id,material,materialLoss,materialWithLoss,process,plating,outsourcing,outsourcingTotal,indirectLabor,rent,water,electricity,depreciation,supplies,indirect,laborTotal,productionCost,productionCostUsd,factoryPriceCny,factoryPriceUsd};
 });
 const amounts=fields.tooling.filter(t=>t.chargeMode==='charge').map(t=>t.amount);
 // Review/print may add paid-receipt or source-quote descriptions. Those do not
 // change the charging instruction and must not silently invalidate its price.
 const toolingBasis=fields.tooling.map(t=>[t.id||'',t.toolingId||'',t.name||'',t.lineIds||[],t.chargeMode,t.amount,t.chargeQuoteId||'',t.chargeVersion??null]);
 const toolingChargeCny=cell(ieAdjustmentTargets.tooling,'整单一次性费用合计',completeSum(amounts),toolingBasis,fields.tooling.some(t=>t.chargeMode==='charge'));
 return {formulaVersion,materialLossRate:.1,factoryMultiplier:1.3,lines,toolingChargeCny,adjustmentCells,warnings};
}
