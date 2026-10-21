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

/** Fixed latest window, selected before dedup. Never fill skips from older history. */
export async function latestKingdeeRows(config:KingdeeConfig,signal:AbortSignal){
 const cutoff=Date.now(),sourceAsOf=new Date(cutoff).toISOString();
 const data=await kingdeeRead(config,'list',{page:'1',page_size:String(KINGDEE_SYNC_LIMIT),bill_status:'C',create_end_time:String(cutoff)},signal);
 if(!Number.isSafeInteger(data.count)||Number(data.count)<0||data.page!==1||data.page_size!==KINGDEE_SYNC_LIMIT||!Array.isArray(data.rows)||data.current_page_size!==data.rows.length||data.rows.length!==Math.min(KINGDEE_SYNC_LIMIT,Number(data.count)))throw new AppError('金蝶最新记录返回不完整，本次未同步。',502);
 const summaries=data.rows.map(object),ids=summaries.map(row=>sourceId(row.id)),times=summaries.map(row=>createdAt(row.create_time));
 if(new Set(ids).size!==ids.length||summaries.some(row=>row.bill_status!=='C')||times.some((time,index)=>time>cutoff||index>0&&time>times[index-1]))throw new AppError('金蝶最新记录的顺序、标识或审核状态异常，本次未同步。',409);
 const rows:KingdeeQueryRow[]=[];let selected=0,excludedComplete=0;
 for(let offset=0;offset<summaries.length&&selected<KINGDEE_SYNC_LIMIT;offset+=3){
  const batch=summaries.slice(offset,offset+3),details=await kingdeeDetails(config,batch.map(row=>sourceId(row.id)),signal);
  for(let index=0;index<batch.length&&selected<KINGDEE_SYNC_LIMIT;index++){
   const summary=batch[index],detail=details[index],orderId=sourceId(summary.id);
   if(sourceId(detail.id)!==orderId||['bill_no','supplier_id'].some(key=>sourceText(detail[key])!==sourceText(summary[key])))throw new AppError('金蝶采购单身份不一致，本次未同步。',409);
   if(!Array.isArray(detail.material_entity)||!detail.material_entity.length||detail.material_entity.length>2000)throw new AppError('金蝶商品行缺失或数量异常，本次未同步。',502);
   const lines=detail.material_entity.slice(0,KINGDEE_SYNC_LIMIT-selected);
   const mapped=kingdeeDetailRows({...detail,material_entity:lines},orderId);
   selected+=lines.length;rows.push(...mapped.rows);excludedComplete+=mapped.excludedComplete;
  }
 }
 return {rows,selected,excludedComplete,sourceAsOf};
}
