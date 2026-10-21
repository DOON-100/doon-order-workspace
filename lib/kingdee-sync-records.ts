import {all,now,type Entity,type State} from './domain';
import {AppError,bucket} from './store';
import {sha} from './workbooks';
import {purchaseHeaders} from './purchases';
import {KINGDEE_PENDING_QUANTITY_MEANING,pendingCounts,type KingdeePendingRow,type KingdeePendingMetadata,type KingdeePendingSnapshot,type KingdeePendingImport} from './kingdee-pending';
import type {KingdeeQueryRow} from './kingdee-readonly-types';

export const KINGDEE_SYNC_LIMIT=30;
export const KINGDEE_SYNC_RULE='kingdee-purchase-append-v1';
export type KingdeeApiRecord=Entity&{kind:'kingdee_pending_api_row';accountId:string;instanceId:string;clientId:string;row:KingdeeQueryRow;sourceHash:string;createdAt:string;actorId:string;batchId:string};
export async function savedKingdeeRows(source:KingdeePendingSnapshot|KingdeePendingImport){
 const blob=await bucket().get(source.rowsKey);if(!blob)throw new AppError('金蝶源表快照暂不可用，请重试。',503);
 const text=await new Response(blob.body).text();if(await sha(text)!==source.rowsHash)throw new AppError('金蝶源表明细校验未通过，请保留原文件并联系管理员。',409);
 const rows=JSON.parse(text);if(!Array.isArray(rows))throw new AppError('金蝶来源格式异常，未执行同步。',409);return rows as KingdeePendingRow[];
}
const normalized=(value:unknown)=>String(value??'').trim().normalize('NFKC').toUpperCase();
function legacyKey(po:unknown,code:unknown,supplier:unknown,unit:unknown){return JSON.stringify([po,code,supplier,unit].map(normalized));}
export function apiLegacyKey(row:KingdeeQueryRow){return legacyKey(row.values[0],row.values[5],row.values[2],row.values[8]);}
export async function apiRecordId(accountId:string,row:KingdeeQueryRow){return 'kingdee_api_row_'+await sha(JSON.stringify([accountId,row.values[14],row.values[15]]));}
export function apiRecords(s:State){return all(s,'kingdee_pending_api_row') as KingdeeApiRecord[];}
export async function existingKingdeeIndex(s:State){
 const legacyKeys=new Set<string>(),legacyOrders=new Set<string>();
 const add=(po:unknown,code:unknown,supplier:unknown,unit:unknown)=>{
  if(!normalized(po))return;legacyOrders.add(normalized(po));
  if([code,supplier,unit].every(value=>normalized(value)))legacyKeys.add(legacyKey(po,code,supplier,unit));
 };
 for(const p of all(s,'purchase'))add(p.po,p.itemCode,p.supplier,p.unit);
 for(const source of all(s,'kingdee_pending_snapshot') as KingdeePendingSnapshot[]){
  const rows=await savedKingdeeRows(source),column=(row:KingdeePendingRow,name:string)=>row.values[source.headers.indexOf(name)];
  for(const row of rows)if(row.rowType==='data')add(column(row,'单据编号'),column(row,'商品编码'),column(row,'供应商'),column(row,'单位'));
 }
 return {legacyKeys,legacyOrders,ids:new Set(apiRecords(s).map(row=>row.id))};
}
export function classifyKingdeeRow(row:KingdeeQueryRow,id:string,index:Awaited<ReturnType<typeof existingKingdeeIndex>>):'new'|'existing'|'uncertain'{
 if(index.ids.has(id))return 'existing';
 if(index.legacyKeys.has(apiLegacyKey(row)))return 'existing';
 if(index.legacyOrders.has(normalized(row.values[0])))return 'uncertain';
 if(row.uncertain||!['未入库','部分入库'].includes(row.values[11])||[0,2,5,8,9,14,15].some(i=>!row.values[i]?.trim()))return 'uncertain';
 // Missing/invalid quantities are not invented; quantity is never a dedup key.
 if(!/^\d+(?:\.\d+)?$/.test(row.values[9])||!Number.isFinite(Number(row.values[9])))return 'uncertain';
 return 'new';
}

/** Compose a read view. Existing Excel snapshots, headers and blobs are never rewritten. */
export function appendKingdeeView(s:State,selected:KingdeePendingSnapshot|undefined,originalRows:KingdeePendingRow[]){
 const records=apiRecords(s).slice().sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
 const baseHeaders=selected?.headers||purchaseHeaders;
 const extras=['来源类型','金蝶账套 ID','金蝶单据 ID','金蝶行 ID','行入库状态','行关闭状态','商品规格'];
 const headers=[...baseHeaders,...extras.filter(header=>!baseHeaders.includes(header))];
 const rows:KingdeePendingRow[]=originalRows.map(row=>({...row,values:[...row.values,...headers.slice(baseHeaders.length).map(()=> '')],displayValues:[...row.displayValues,...headers.slice(baseHeaders.length).map(()=> '')]}));
 let sourceRow=Math.max(0,...originalRows.map(row=>row.sourceRow));
 for(const record of records){
  const v=record.row.values;
  const fields:Record<string,string>={'单据编号':v[0],'单据日期':v[1],'供应商':v[2],'业务员':v[3],'单据状态':'已审核','关闭状态':v[4],'预计交货日期':v[10],'商品编码':v[5],'商品名称':v[6],'单位':v[8],'数量':v[9],'商品行备注':v[13],'剩余备货天数':'','客户订单编号':'','来源类型':'金蝶 API 新增','金蝶账套 ID':record.accountId,'金蝶单据 ID':v[14],'金蝶行 ID':v[15],'行入库状态':v[11],'行关闭状态':v[12],'商品规格':v[7]};
  // Later file uploads are displayed as their own source. Never replace an immutable
  // API record's captured fields with a newer file or API response.
  const values=headers.map(header=>fields[header]??'');rows.push({sourceRow:++sourceRow,values,displayValues:values,rowType:'data'});
 }
 const last=records.at(-1),timestamp=last?.createdAt||now();
 const metadata:KingdeePendingMetadata={...(selected?.metadata||{filename:'金蝶 API 新增记录',hash:'',sourceAsOf:timestamp.slice(0,10),sourceFilter:'已审核采购订单的未入库、部分入库商品行；仅新增，不更新既有记录。',sourceAccount:'已核验的金蝶账套',sourceSheet:'采购订单 API',headerRow:0,importedAt:timestamp,importedBy:'',quantityMeaning:KINGDEE_PENDING_QUANTITY_MEANING}),...pendingCounts(headers,rows),apiAddedCount:records.length};
 return {id:selected?.id||'kingdee_api_current',headers,rows,metadata};
}
