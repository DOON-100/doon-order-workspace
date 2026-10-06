import {clean,strictDate} from './domain';
import {colLabels,dateCols,dateValue} from './ledger';

// Process dates accept a full year only; never infer a year for a factory report.
export function processDate(value:unknown,label:string){
 const raw=clean(value);if(!raw||raw==='-')return raw;
 const formatted=raw.replace(/年|月/g,'-').replace(/日$/,'').replace(/\./g,'-').replace(/\s*([-\/])\s*/g,'$1');
 try {return strictDate(formatted);}catch{
  throw new Error(`${label}：日期无效。请选择日历，或填写完整日期，例如 2026-09-17；不适用请选择“－”。`);
 }
}
export function ledgerDraftValue(col:string,value:string){return dateCols.includes(col)?dateValue(value)||value:value;}
export function processDateErrors(patch:Record<string,string>){
 const errors:Record<string,string>={};for(const [col,value] of Object.entries(patch))if(dateCols.includes(col))try{processDate(value,`${col} · ${colLabels[col]}`);}catch(e){errors[col]=(e as Error).message;}return errors;
}
