import {AppError} from './store';
import {strictDate} from './domain';
import {kingdeeRead,kingdeeDetails,object,sourceId,sourceText,type KingdeeConfig} from './kingdee-client';
import {kingdeeDetailRows} from './kingdee-readonly-api';
import {KINGDEE_SYNC_LIMIT} from './kingdee-sync-records';
import type {KingdeeQueryRow} from './kingdee-readonly-types';

function createdAt(value:unknown){
 const text=sourceText(value),match=/^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(text);
 if(!match||Number(match[2])>23||Number(match[3])>59||Number(match[4])>59)throw new AppError('金蝶创建时间格式不完整，无法确定最新记录。',502);
 try{strictDate(match[1]);}catch{throw new AppError('金蝶创建日期无效。',502);}
 return Date.parse(text.replace(' ','T')+'+08:00');
}

/** Filter inbound status first, select the latest 30 eligible lines, then dedup elsewhere. */
export async function latestKingdeeRows(config:KingdeeConfig,signal:AbortSignal){
 const cutoff=Date.now(),sourceAsOf=new Date(cutoff).toISOString(),rows:KingdeeQueryRow[]=[];
 const seenOrders=new Set<string>();let count:number|undefined,previousTime=cutoff,excludedComplete=0,excludedUnknown=0;
 for(let page=1;rows.length<KINGDEE_SYNC_LIMIT;page++){
  const data=await kingdeeRead(config,'list',{page:String(page),page_size:String(KINGDEE_SYNC_LIMIT),bill_status:'C',create_end_time:String(cutoff)},signal);
  if(!Number.isSafeInteger(data.count)||Number(data.count)<0||data.page!==page||data.page_size!==KINGDEE_SYNC_LIMIT||!Array.isArray(data.rows)||data.current_page_size!==data.rows.length||data.rows.length!==Math.min(KINGDEE_SYNC_LIMIT,Math.max(0,Number(data.count)-(page-1)*KINGDEE_SYNC_LIMIT)))throw new AppError('金蝶最新记录返回不完整，本次未同步。',502);
  if(count!==undefined&&data.count!==count)throw new AppError('金蝶采购列表在查询期间发生变化，本次未同步。',409);count=Number(data.count);
  const summaries=data.rows.map(object);
  for(const summary of summaries){
   const id=sourceId(summary.id),time=createdAt(summary.create_time);
   if(seenOrders.has(id)||summary.bill_status!=='C'||time>previousTime)throw new AppError('金蝶最新记录的顺序、标识或审核状态异常，本次未同步。',409);
   seenOrders.add(id);previousTime=time;
  }
  // real_io_status is the documented whole-order inbound status, not io_status
  // (execution/association status). Completed orders need no detail requests.
  const pending=summaries.filter(summary=>summary.real_io_status!=='C');
  for(let offset=0;offset<pending.length&&rows.length<KINGDEE_SYNC_LIMIT;offset+=3){
   const batch=pending.slice(offset,offset+3),details=await kingdeeDetails(config,batch.map(row=>sourceId(row.id)),signal);
   for(let index=0;index<batch.length&&rows.length<KINGDEE_SYNC_LIMIT;index++){
    const summary=batch[index],detail=details[index],orderId=sourceId(summary.id);
    if(sourceId(detail.id)!==orderId||['bill_no','supplier_id'].some(key=>sourceText(detail[key])!==sourceText(summary[key])))throw new AppError('金蝶采购单身份不一致，本次未同步。',409);
    const mapped=kingdeeDetailRows(detail,orderId);
    excludedComplete+=mapped.excludedComplete;
    for(const row of mapped.rows){
     if(row.uncertain){excludedUnknown++;continue;}
     rows.push(row);if(rows.length===KINGDEE_SYNC_LIMIT)break;
    }
   }
  }
  if(page*KINGDEE_SYNC_LIMIT>=count)break;
 }
 return {rows,selected:rows.length,excludedComplete,excludedUnknown,sourceAsOf};
}
