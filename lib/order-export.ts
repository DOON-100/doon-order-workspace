import {clean,type Order} from './domain';
// Standard fields are exported once under their normalized names. Keep the remaining
// original ledger/process columns (including their column codes) for traceability.
// BJ and later columns are legacy formula/helper columns from the source workbook. Their generic
// labels (for example several different columns all named “欠数”) are meaningful
// only inside the old formula layout, so standardized exports use the named,
// recalculated fields instead of exposing these ambiguous duplicates.
const standardSourceCodes=new Set(['C','H','I','J','L','M','T','U','W','AB']);
const standardLabels=new Set(['客户','客户号','镜片','镜片类型','订单号','图纸编号','图纸编号 / 款号','款号','色号','订单数量','客户要求交期','客原交货期','PMC排期','产品类型','状态备注','内部跟进备注']);
const sourceCode=(key:string)=>key.match(/^([A-Z]{1,2})\s*·/)?.[1]||'';
const sourceLabel=(key:string)=>clean(key.replace(/^[A-Z]{1,2}\s*·\s*/,''));
const columnNumber=(code:string)=>[...code].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);
const legacyCalculated=(code:string)=>!!code&&columnNumber(code)>=columnNumber('BJ');
export function orderExportExtras(o:Order,additionalSourceCodes:string[]=[]){
 const excluded=new Set([...standardSourceCodes,...additionalSourceCodes]);
 return Object.fromEntries(Object.entries(o.extra||{}).filter(([key,value])=>{const code=sourceCode(key);return !excluded.has(code)&&!legacyCalculated(code)&&!standardLabels.has(sourceLabel(key))&&!(key==='圈色'&&clean(value)===clean(o.color));}));
}
