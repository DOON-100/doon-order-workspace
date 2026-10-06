import * as XLSX from 'xlsx';
import {openWorkbook,sha} from './workbooks';
import {AppError} from './store';
import {clean,strictDate,now} from './domain';
import {purchaseHeaders,type Purchase} from './purchases';
export async function parsePurchases(bytes:ArrayBuffer,filename:string,sourceAsOf:string){
 const book=openWorkbook(bytes),hash=await sha(bytes),rows:Purchase[]=[];
 function date(v:unknown){if(v===''||v==null)return '';if(typeof v==='number'){const d=XLSX.SSF.parse_date_code(v);if(!d)throw new Error('无效日期');return strictDate(`${d.y}-${d.m}-${d.d}`);}return strictDate(v);}
 let found=0,sourceFilter='';
 for(const sheetName of book.SheetNames){
  const sheet=book.Sheets[sheetName],body=XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,raw:true,defval:'',blankrows:true});
  const h=body.slice(0,30).findIndex(r=>purchaseHeaders.every(k=>r.map(clean).includes(k)));if(h<0)continue;found++;
  const headers=body[h].map(clean);if(purchaseHeaders.some(k=>headers.filter(x=>x===k).length!==1))throw new AppError('采购表表头重复，请核对。');
  sourceFilter=body.slice(0,h).flat().map(clean).filter(Boolean).join('；');
  for(let i=h+1;i<body.length;i++){
   const r=body[i],raw=Object.fromEntries(purchaseHeaders.map(k=>[k,r[headers.indexOf(k)]??''])),get=(k:string)=>clean(raw[k]);
   if(!r.some(v=>clean(v)))continue;if(!get('单据编号')&&get('商品名称')==='合计')continue;
   try{
    for(const k of purchaseHeaders){if(sheet[XLSX.utils.encode_cell({r:i,c:headers.indexOf(k)})]?.f)throw new Error('源数据包含公式，请导出为值');}
    if(!get('单据编号')||!get('供应商')||!get('商品编码')||!get('单位')||!get('数量'))throw new Error('缺少单号、供应商、编码、单位或数量');
    const qty=Number(get('数量').replace(/,/g,''));if(!Number.isFinite(qty)||qty<=0||qty>1e9||Math.abs(qty*10000-Math.round(qty*10000))>0.01)throw new Error('数量应大于零且最多四位小数');
    rows.push({id:'purchase_'+await sha(`${hash}|${sheetName}|${i+1}`),kind:'purchase',version:1,sourceVersion:1,po:get('单据编号'),supplier:get('供应商'),buyer:get('业务员'),itemCode:get('商品编码'),itemName:get('商品名称'),unit:get('单位'),quantity:qty,orderDate:date(raw['单据日期']),dueDate:date(raw['预计交货日期']),customerOrder:get('客户订单编号'),auditStatus:get('单据状态'),closeStatus:get('关闭状态'),sourceNote:get('商品行备注'),sourceRow:i+1,sourceAsOf,sourceHash:hash,sourceFile:filename,sourceSheet:sheetName,sourceFilter,raw,promisedDate:'',expectedDate:'',nextFollowupDate:'',followupNote:'',balanceKnown:false,received:0,returnPending:0,lifecycle:'active',createdAt:now(),updatedAt:now()});
   }catch(e){throw new AppError(`${sheetName} 第 ${i+1} 行：${(e as Error).message}`);}
  }
 }
 if(found!==1||!rows.length||rows.length>10000)throw new AppError('需要一张包含采购跟踪表完整 14 列、1 至 10000 条明细的工作表。');
 return {rows,hash,sourceFilter};
}
