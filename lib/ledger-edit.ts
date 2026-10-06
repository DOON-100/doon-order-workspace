import {AppError} from './store';
import {departmentColumns} from './departments';
import {automaticDates,colLabels,dateCols,dateValue,editableCols,numeric} from './ledger';
import {now,strictDate,type Member,type Order} from './domain';
import {isFinishedOutsource} from './manufacturing';
import {processDate} from './process-date';
export function applyLedgerPatch(o:Order,m:Member,patch:Record<string,string>){
 if(!departmentColumns(m,o).length)throw new AppError('未分配该部门录入权限。',403);
 if(!o.ledger)throw new AppError('此订单未采用原表工序结构。');
 const c:Record<string,string>={...o.ledger.columns,U:o.plannedDate||(o.ledger.columns.U==='-'?'-':''),AB:o.notes||''},extra={...o.extra};
 for(const [col,raw] of Object.entries(patch)){
  let v=raw;
  if(!editableCols.includes(col)||!departmentColumns(m,o).includes(col as never))throw new AppError('此原表字段不允许在线修改。',403);
  if(dateCols.includes(col)){try{v=processDate(v,`${col} · ${colLabels[col]}`);}catch(e){throw new AppError((e as Error).message);}}
  else if(!['AB','AK','AN','AZ','BI'].includes(col)&&v&&v!=='-'&&(!Number.isSafeInteger(numeric(v))||numeric(v)!<0))throw new AppError(`${colLabels[col]}必须为非负整数、空白或 -。`);
  c[col]=v;extra[`${col} · ${colLabels[col]}`]=v;
 }
 if(!isFinishedOutsource(o))Object.assign(c,automaticDates(c));extra['U · '+colLabels.U]=c.U;extra['AB · '+colLabels.AB]=c.AB;return {...o,ledger:{...o.ledger,columns:c},extra,plannedDate:dateValue(c.U),closedDate:dateValue(c.BH),notes:c.AB||'',version:o.version+1,updatedAt:now(),updatedBy:m.name};
}

export function syncFollowColumns(o:Order):Order{
 if(!o.ledger)return o;
 const U=o.plannedDate||(o.ledger.columns.U==='-'?'-':''),AB=o.notes||'';
 return {...o,ledger:{...o.ledger,columns:{...o.ledger.columns,U,AB}},extra:{...o.extra,['U · '+colLabels.U]:U,['AB · '+colLabels.AB]:AB}};
}
