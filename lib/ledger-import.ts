import * as X from 'xlsx';
import {openWorkbook,sha} from './workbooks';
import {type Order,type Member,now} from './domain';
import {colLabels,dateCols,dateValue,numeric} from './ledger';
import {AppError} from './store';
export async function parseLedger(bytes:ArrayBuffer,filename:string,mode:'active'|'archived',m:Member){
 const b=openWorkbook(bytes),sheet=b.Sheets['动态表'];if(!sheet)throw new AppError('请选择包含“动态表”的度昂原始工作簿。');
 if(String(sheet.I3?.v)!=='订单号'||String(sheet.M3?.v)!=='订单数量'||String(sheet.BF3?.v)!=='包装入仓数量')throw new AppError('原表格式不符：第 3 行应含订单号、订单数量、包装入仓数量。');
 const hash=await sha(bytes),rows:Order[]=[],range=X.utils.decode_range(sheet['!ref']||'A1');if(range.e.r>4000)throw new AppError('原表最多 4000 行，请按批次拆分。');
 for(let r=4;r<=range.e.r+1;r++){
  const val=(col:string)=>{const cell=sheet[col+r];return cell?.t==='e'?String(cell.w||'#VALUE!'):String(cell?.v??'').trim();};if(!val('I')&&!val('J'))continue;
  const columns:Record<string,string>={};for(let i=0;i<=range.e.c;i++){const col=X.utils.encode_col(i),v=val(col);if(v)columns[col]=v;}
  const extra=Object.fromEntries(Object.entries(columns).map(([k,v])=>[`${k} · ${colLabels[k]||String(sheet[k+'3']?.v||sheet[k+'2']?.v||'原表字段').replace(/\n/g,' ')}`,dateCols.includes(k)?dateValue(v)||v:v]));
  const quantity=numeric(val('M'));if(quantity===null||!Number.isSafeInteger(quantity)||(mode==='active'&&quantity<0))throw new AppError(`第 ${r} 行订单数量无效，请核对后导入；未写入任何订单。`);
  rows.push({id:'ledger_'+hash.slice(0,20)+'_'+mode+'_'+r,kind:'order',version:1,createdAt:now(),updatedAt:now(),updatedBy:m.name,source:filename,orderNo:val('I'),customer:val('C'),customerPO:'',drawing:val('J'),color:val('L'),lens:val('H'),batch:'',quantity,requestedDate:dateValue(val('T')),ownerEmail:'',stage:'生产中',plannedDate:dateValue(val('U')),shipDate:'',promisedDate:'',promiseConfirmed:false,customerNote:'',arrangement:'',notes:val('AB'),sourceStatus:'正式订单',extra,lifecycle:mode,closedDate:dateValue(val('BH')),archivedAt:mode==='archived'?now():undefined,archiveReason:mode==='archived'?'来自 PMC 已完成订单档案，按原始归档范围保留。':undefined,ledger:{columns,sourceRow:r,sheet:'动态表',filename,sourceHash:hash,issues:[],ownerName:val('B'),originalOutstanding:val('P')}});
 }
 const keys=new Map<string,Order[]>();for(const o of rows){const k=[o.orderNo,o.drawing,o.color,o.lens].join('|');keys.set(k,[...(keys.get(k)||[]),o]);}for(const group of keys.values())if(group.length>1)for(const o of group)o.ledger!.issues.push('同键多行');
 if(!rows.length)throw new AppError('动态表中未找到订单明细。');
 return {hash,rows,summary:{rows:rows.length,orders:new Set(rows.map(o=>o.orderNo)).size,quantity:rows.reduce((n,o)=>n+o.quantity,0),missingDrawing:rows.filter(o=>!o.drawing).length,duplicates:rows.filter(o=>o.ledger!.issues.includes('同键多行')).length,sourceQuantity:numeric(sheet.M1?.v),sourceOutstanding:numeric(sheet.P1?.v)}};
}
