import * as XLSX from 'xlsx';
import {AppError} from './store';
import {type Member,type State} from './domain';
import {metricDefinitions,metricSource,metricRows,filterMetricRows,sortMetricRows,metricSummary,metricValue,detailColumns,summaryColumns,followupColumns,type MetricKey} from './metric-details';

export function metricExport(req:Request,s:State,m:Member){
 const q=new URL(req.url).searchParams,kind=q.get('metric') as MetricKey;
 if(!Object.hasOwn(metricDefinitions,kind))throw new AppError('请选择有效的汇总项目。');
 if(q.get('revision')!==String(s.revision))throw new AppError('共享数据已更新，请刷新明细后再导出，确保汇总与文件一致。',409);
 const filters=Object.fromEntries(['q','customer','owner','stage','issue','orderNo'].map(k=>[k,q.get(k)||'']));
 const allRows=metricRows(kind,metricSource(s,m)),rows=sortMetricRows(filterMetricRows(allRows,filters),q.get('sort')||'原表行号',q.get('desc')==='1'),meta=metricDefinitions[kind],book=XLSX.utils.book_new();
 const add=(title:string,data:Record<string,unknown>[],headers:string[])=>{
  const sheet=XLSX.utils.json_to_sheet(data,{header:headers});
  sheet['!autofilter']={ref:sheet['!ref']||'A1'};
  sheet['!cols']=headers.map(h=>({wch:/编号|订单号/.test(h)?30:/备注|原因|事项|记录|结果|内容/.test(h)?42:/日期|交期|排期|时间|期限/.test(h)?23:18}));
  XLSX.utils.book_append_sheet(book,sheet,title);
 };
 if(kind==='orders')add('订单汇总',sortMetricRows(metricSummary(rows),'订单号').map(r=>r.values),summaryColumns);
 const extra=[...new Set(rows.flatMap(r=>Object.keys(r.values)))].filter(k=>!detailColumns.includes(k));
 add('明细与跟进',rows.map(r=>({...r.values,...Object.fromEntries(followupColumns.map(k=>[k,'']))})),[...detailColumns,...extra,...followupColumns]);
 add('导出说明',[
  {项目:'汇总项目',内容:meta.title},{项目:'统计口径',内容:meta.rule},{项目:'未筛选汇总',内容:`${metricValue(kind,allRows)} ${meta.unit}`},{项目:'当前筛选汇总',内容:`${metricValue(kind,rows)} ${meta.unit}`},{项目:'导出明细条数',内容:rows.length},{项目:'数据版本',内容:s.revision},{项目:'导出时间（北京时间）',内容:new Date().toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})},{项目:'筛选条件',内容:JSON.stringify(filters)},{项目:'用途',内容:'供内部跨部门追踪；按明细编号定位原订单。末尾四列可在 Excel 填写，系统内跟进请打开对应订单。此文件不自动回写生产数据。'},{项目:'数量说明',内容:'包装入仓仅取 BF；报工良品数单列，不与 BF 相加。欠数待核对条数大于 0 时，订单汇总欠数仅为已知部分之和。'}
 ],['项目','内容']);
 const bytes=XLSX.write(book,{type:'array',bookType:'xlsx'}) as ArrayBuffer;
 const name=`${meta.title}_明细跟进_${new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'})}.xlsx`;
 return new Response(bytes,{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(name)}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
