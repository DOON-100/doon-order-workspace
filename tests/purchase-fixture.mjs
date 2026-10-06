// Entirely synthetic Kingdee-shaped workbook; no production workbook is needed.
import * as XLSX from 'xlsx';

export function purchaseFixture(){
 const headers=['单据编号','单据日期','供应商','业务员','单据状态','关闭状态','预计交货日期','商品编码','商品名称','单位','数量','商品行备注','剩余备货天数','客户订单编号'];
 const count=1203,ambiguousRows=60,uniqueRows=count-ambiguousRows,rows=[];
 for(let i=0;i<count;i++){
  const duplicate=i>=uniqueRows,index=duplicate?uniqueRows+Math.floor((i-uniqueRows)/2):i;
  const kilos=index>0&&index%5===0;
  rows.push([`TEST-PO-${duplicate?'D'+(index-uniqueRows):Math.floor(index/4)}`,'2026-09-10',`示例供应商${String(index%60+1).padStart(3,'0')}`,'示例采购员',index>0&&index%7===0?'未审核':'已审核',index>0&&index%11===0?'手动关闭':'未关闭','2026-09-25',`TEST-ITEM-${index}`,'合成测试商品',kilos?'公斤':'副',kilos?Number((0.125+index/10000).toFixed(4)):200+index,'合成测试记录',15,`TEST-CUSTOMER-${index}`]);
 }
 const sheet=XLSX.utils.aoa_to_sheet([['合成采购跟踪表；仅供自动化测试'],[],headers,...rows]);
 const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'sheet1');
 const bytes=XLSX.write(book,{type:'buffer',bookType:'xlsx'});
 return {bytes,rows,count,ambiguousRows,uniqueRows,orders:new Set(rows.map(r=>r[0])).size,suppliers:new Set(rows.map(r=>r[2])).size,closed:rows.filter(r=>r[5]==='手动关闭').length,unapproved:rows.filter(r=>r[4]==='未审核').length,kilograms:rows.filter(r=>r[9]==='公斤').reduce((n,r)=>n+r[10],0).toFixed(4)};
}
