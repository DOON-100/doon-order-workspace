import * as XLSX from 'xlsx';
import {all,broad,canRead,clean,readsAllOrders,type Entity,type Member,type Order,type State} from './domain';
import {AppError} from './store';
import {openWorkbook,sha} from './workbooks';
import {purchaseHeaders} from './purchases';
import {filterBusinessTeamRows} from './business-team-scope';

export const KINGDEE_PENDING_QUANTITY_MEANING='原表数量，未推定剩余未上货数量';
export type KingdeePendingValue=string|number|boolean|null;
export type KingdeePendingRow={sourceRow:number;values:KingdeePendingValue[];displayValues:string[];rowType:'data'|'summary'|'blank'};
export type KingdeePendingMetadata={filename:string;hash:string;sourceAsOf:string;sourceFilter:string;sourceAccount:string;sourceSheet:string;headerRow:number;importedAt:string;importedBy:string;rowCount:number;sourceRowCount:number;orderCount:number;supplierCount:number;quantityMeaning:string;scope?:'all'|'authorized';apiAddedCount?:number};
export type KingdeePendingSnapshot=Entity&{kind:'kingdee_pending_snapshot';headers:string[];metadata:KingdeePendingMetadata;hash:string;rowsHash:string;rowsKey:string;fileKey:string;committedRevision:number;createdAt:string};
export type KingdeePendingImport=Entity&{kind:'kingdee_pending_import';headers:string[];metadata:KingdeePendingMetadata;hash:string;rowsHash:string;rowsKey:string;fileKey:string;sample:KingdeePendingRow[];status:'待确认'|'已完成';snapshotId?:string;createdAt:string};

/** The successful workspace revision determines sync order, independently of storage row order or clock drift. */
export function orderedKingdeePendingSnapshots(s:State){
 return (all(s,'kingdee_pending_snapshot') as KingdeePendingSnapshot[]).slice().sort((a,b)=>(b.committedRevision||0)-(a.committedRevision||0)||b.metadata.importedAt.localeCompare(a.metadata.importedAt)||b.id.localeCompare(a.id));
}

export function pendingCounts(headers:string[],rows:KingdeePendingRow[]){
 const data=rows.filter(row=>row.rowType==='data'),po=headers.indexOf('单据编号'),supplier=headers.indexOf('供应商');
 return {rowCount:data.length,sourceRowCount:rows.length,orderCount:new Set(data.map(row=>clean(row.values[po])).filter(Boolean)).size,supplierCount:new Set(data.map(row=>clean(row.values[supplier])).filter(Boolean)).size};
}

/** Keep source values and Excel display text separately, including duplicate and total rows. */
export async function parseKingdeePending(bytes:ArrayBuffer){
 const book=openWorkbook(bytes),candidates:{sheetName:string;sheet:XLSX.WorkSheet;body:unknown[][];header:number}[]=[];
 for(const sheetName of book.SheetNames){
  const sheet=book.Sheets[sheetName],body=XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,raw:true,defval:'',blankrows:true,range:0});
  const header=body.slice(0,30).findIndex(row=>purchaseHeaders.every(name=>row.map(clean).includes(name)));
  if(header>=0)candidates.push({sheetName,sheet,body,header});
 }
 if(candidates.length!==1)throw new AppError('需要一张包含金蝶采购原表完整 14 列的工作表。');
 const {sheetName,sheet,body,header}=candidates[0],range=XLSX.utils.decode_range(String(sheet['!fullref']||sheet['!ref']||'A1'));
 if(range.e.r>=10001||range.e.c>=100)throw new AppError('采购源表最多 10000 行、100 列，请分批导出。');
 const headers=body[header].map(clean);
 while(headers.length&&!headers.at(-1))headers.pop();
 if(purchaseHeaders.some(name=>headers.filter(value=>value===name).length!==1))throw new AppError('金蝶采购源表必需表头重复，请核对。');
 if(headers.some(name=>!name)||new Set(headers).size!==headers.length)throw new AppError('源表存在空白或重复表头，请核对后重新导出。');
 const rows:KingdeePendingRow[]=[],po=headers.indexOf('单据编号');
 const display=XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,raw:false,defval:'',blankrows:true,range:0});
 for(let index=header+1;index<body.length;index++){
  const row=body[index];
  if(row.slice(headers.length).some(value=>clean(value)))throw new AppError(`第 ${index+1} 行存在没有表头的源数据，请核对。`);
  const values=headers.map((_,column)=>{
   const cell=sheet[XLSX.utils.encode_cell({r:index,c:column})];
   if(cell?.f)throw new AppError(`第 ${index+1} 行含公式，请从金蝶导出为值后上传。`);
   const value=row[column]??'';
   if(typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)||value===null)return value as KingdeePendingValue;
   throw new AppError(`第 ${index+1} 行存在无法保留的源值。`);
  });
  const blank=!values.some(value=>clean(value)),rowType=blank?'blank':clean(values[po])?'data':'summary';
  rows.push({sourceRow:index+1,values,displayValues:headers.map((_,column)=>String(display[index]?.[column]??'')),rowType});
 }
 return {headers,rows,hash:await sha(bytes),sourceSheet:sheetName,headerRow:header+1,sourceFilter:[...new Set(body.slice(0,header).flat().map(value=>String(value??'').trim()).filter(Boolean))].join('；'),...pendingCounts(headers,rows)};
}

/** Exactly the existing purchase row authorization, followed by the selected business-team filter. */
export function visibleKingdeePending(s:State,m:Member,headers:string[],rows:KingdeePendingRow[],teamId=''){
 if(!m.active||m.role==='supplier')throw new AppError('没有采购明细查看权限。',403);
 const full=(readsAllOrders(m)||broad(m))&&!teamId;
 if(full)return {rows,full:true};
 const customerOrder=headers.indexOf('客户订单编号'),refs=new Set((all(s,'order') as Order[]).filter(order=>canRead(m,order)).map(order=>order.orderNo));
 const authorized=rows.filter(row=>row.rowType==='data'&&(readsAllOrders(m)||broad(m)||!!clean(row.values[customerOrder])&&refs.has(clean(row.values[customerOrder]))));
 const filtered=filterBusinessTeamRows(s,authorized.map(row=>({...row,kind:'purchase',customerOrder:clean(row.values[customerOrder])})),teamId);
 return {rows:filtered.map(({kind:_kind,customerOrder:_customerOrder,...row})=>row),full:false};
}

export function pendingMetadata(metadata:KingdeePendingMetadata,headers:string[],rows:KingdeePendingRow[],full:boolean):KingdeePendingMetadata{
 if(full)return {...metadata,scope:'all'};
 return {...metadata,apiAddedCount:undefined,filename:'金蝶采购未上货表（授权范围）',sourceFilter:'仅显示当前授权及小组范围的明细，源表合计和筛选说明不在此范围展示。',importedBy:'',...pendingCounts(headers,rows),scope:'authorized'};
}
