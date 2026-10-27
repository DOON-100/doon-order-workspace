/** Pure, shared arithmetic for the worksheet and server. Amounts are CNY per pair. */
export type IeFormulaVersion='ie-cost-v2-line-loss'|'ie-cost-v3-excel';
export type IeCalculationInput={
 exchangeRateCnyPerUsd:number|null;
 lines:{id:string;materials:{basePrice:number|null;usage:number|null;coefficient:number|null;lossRate?:number;notApplicable:boolean}[];processes:{basePrice:number|null;difficulty:number|null;notApplicable:boolean}[];outsourcing:{category:'plating'|'general';unitPrice:number|null;notApplicable:boolean}[]}[];
 tooling:{chargeMode:string;amount:number|null}[];
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
const sumRows=<T extends {notApplicable:boolean}>(rows:T[],calc:(r:T)=>number|null)=>{
 if(!rows.length)return null;
 const values=rows.filter(r=>!r.notApplicable).map(calc);
 return values.some(v=>v===null)?null:sum(values as number[]);
};
export function ieCalculationVersion(fields:IeCalculationInput):IeFormulaVersion{
 // Historical snapshots retain their original calculation. New input/save uses v3.
 return fields.costs?.formulaVersion==='ie-cost-v2-line-loss'?'ie-cost-v2-line-loss':'ie-cost-v3-excel';
}
export function calculateIeQuote(fields:IeCalculationInput){
 const formulaVersion=ieCalculationVersion(fields),excel=formulaVersion==='ie-cost-v3-excel';
 const lines=fields.lines.map(l=>{
  const net=(r:IeCalculationInput['lines'][number]['materials'][number])=>r.basePrice===null||r.usage===null||r.coefficient===null?null:multiply([r.basePrice,r.usage,r.coefficient],excel?2:6);
  const material=sumRows(l.materials,net),process=sumRows(l.processes,r=>r.basePrice===null||r.difficulty===null?null:multiply([r.basePrice,r.difficulty]));
  const plating=sumRows(l.outsourcing.filter(r=>r.category==='plating'),r=>r.unitPrice),outsourcing=sumRows(l.outsourcing.filter(r=>r.category==='general'),r=>r.unitPrice);
  const rawLoss=sumRows(l.materials,r=>{const value=net(r);return value===null?null:excel?multiply([value,r.lossRate??.1]):multiply([r.basePrice!,r.usage!,r.coefficient!,r.lossRate??.1]);});
  // Original Excel rounds each material line to cents, then the total material
  // loss to cents. Weighting each rounded line preserves individual extra loss.
  const materialLoss=rawLoss===null?null:excel?cents(rawLoss):rawLoss;
  const productionCost=[material,materialLoss,process,plating,outsourcing].some(v=>v===null)?null:sum([material!,materialLoss!,process!,plating!,outsourcing!,13.7]);
  const factoryPriceCny=productionCost===null?null:multiply([productionCost,1.3]);
  const factoryPriceUsd=factoryPriceCny===null||!fields.exchangeRateCnyPerUsd?null:out(div(micro(factoryPriceCny)*SCALE,micro(fields.exchangeRateCnyPerUsd)));
  return {lineId:l.id,material,materialLoss,process,plating,outsourcing,indirect:13.7,productionCost,factoryPriceCny,factoryPriceUsd};
 });
 const amounts=fields.tooling.filter(t=>t.chargeMode==='charge').map(t=>t.amount);
 return {formulaVersion,materialLossRate:.1,factoryMultiplier:1.3,lines,toolingChargeCny:amounts.some(v=>v===null)?null:sum(amounts as number[])};
}
