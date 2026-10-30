import {SSF} from 'xlsx';
import {excelDate,type ExcelFilterValue} from './excel-filters';

type Cell={display:string;type:string;value:unknown;cachedValue:unknown;cacheStatus:string;unknownReason:string|null;numberFormat:string|null};

/** Keep UI labels independent of stored numbers and formula caches. Never recalculates a formula. */
export function workbookFilterValue(cell:Cell|undefined,date1904=false):ExcelFilterValue {
 const result=(type:ExcelFilterValue['type'],raw:unknown):ExcelFilterValue=>({excelFilterValue:true,display:cell?.display||'',type,raw});
 if(!cell)return result('blank',null);
 if(cell.cacheStatus==='missing')return result('unknown',null);
 if(cell.type==='e'||cell.unknownReason==='error')return result('error',null);
 const raw=cell.cacheStatus==='not-formula'?cell.value:cell.cachedValue;
 if(raw===null||raw===undefined)return result(cell.unknownReason==='blank'?'blank':'unknown',null);
 if(cell.type==='d')return result(excelDate(raw)!==null?'date':'unknown',raw);
 if(typeof raw==='number'){
  if(cell.numberFormat&&SSF.is_date(cell.numberFormat)){
   const date=SSF.parse_date_code(raw,{date1904});
   if(date){const iso=String(date.y).padStart(4,'0')+'-'+String(date.m).padStart(2,'0')+'-'+String(date.d).padStart(2,'0');if(excelDate(iso)!==null)return result('date',iso);}
   return result('unknown',raw);
  }
  return result('number',raw);
 }
 if(typeof raw==='boolean')return result('boolean',raw);
 return result('text',raw);
}
