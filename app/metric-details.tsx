'use client';
import {useMemo,useState} from 'react';
import {ArrowDownUp,ChevronRight,Download,RefreshCw,Search,X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Input} from './ui';
import {metricDefinitions,metricRows,metricValue,filterMetricRows,sortMetricRows,metricSummary,detailColumns,summaryColumns,type MetricFilters,type MetricKey,type MetricRow} from '@/lib/metric-details';
import type {Data} from './workspace';
import type {Order} from '@/lib/domain';
import './metric-details.css';

export function MetricCards({data,onOpen}:{data:Data;onOpen:(kind:MetricKey)=>void}){
 const metrics=useMemo(()=>(Object.keys(metricDefinitions) as MetricKey[]).map(kind=>({kind,...metricDefinitions[kind],value:metricValue(kind,metricRows(kind,data))})),[data]);
 return <div className="metrics">{metrics.map(m=><div className="metric" key={m.kind}><span>{m.title}</span><strong>{m.value.toLocaleString()}<small>{m.unit}</small></strong><p>{m.description}</p><Button className="metric-open" variant="outline" size="sm" aria-label={`查看${m.title}${m.title.endsWith('明细')?'':'明细'}`} onClick={()=>onOpen(m.kind)}>查看明细 <ChevronRight size={14}/></Button></div>)}</div>;
}
const initialColumns=['订单号','事项类型','原表行号','产品类型','图纸编号','色号','镜片','跟单员','订单数量','包装入仓数量 BF','出货欠数','当前工序','PMC排期','核对原因','处理状态','待跟进事项','跟进期限'];
export function MetricDetails({kind,data,onClose,openOrder,openMes,refresh}:{kind:MetricKey;data:Data;onClose:()=>void;openOrder:(o:Order)=>void;openMes:()=>void;refresh:()=>Promise<unknown>}){
 const meta=metricDefinitions[kind],base=useMemo(()=>metricRows(kind,data),[kind,data]);
 const [filters,setFilters]=useState<MetricFilters>({}),[mode,setMode]=useState(kind==='orders'?'summary':'detail'),[sort,setSort]=useState('原表行号'),[desc,setDesc]=useState(false),[page,setPage]=useState(0),[pageSize,setPageSize]=useState(50),[showAll,setShowAll]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const filtered=useMemo(()=>filterMetricRows(base,filters),[base,filters]);
 const rows=useMemo(()=>sortMetricRows(mode==='summary'?metricSummary(filtered):filtered,mode==='summary'&&sort==='原表行号'?'订单号':sort,desc),[filtered,mode,sort,desc]);
 const columns=mode==='summary'?summaryColumns:showAll?[...detailColumns,...new Set(base.flatMap(r=>Object.keys(r.values)).filter(k=>!detailColumns.includes(k)))]:initialColumns;
 const pages=Math.max(1,Math.ceil(rows.length/pageSize)),currentPage=Math.min(page,pages-1),visible=rows.slice(currentPage*pageSize,(currentPage+1)*pageSize);
 const options=(key:string)=>[...new Set(base.map(r=>String(r.values[key]||'')).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
 const filter=(key:keyof MetricFilters,value:string)=>{setFilters(f=>({...f,[key]:value}));setPage(0);};
 const toggleSort=(key:string)=>{setDesc(sort===key?!desc:false);setSort(key);setPage(0);};
 const viewOrder=(row:MetricRow)=>{const order=data.orders.find(o=>o.id===row.lineId);onClose();if(order)openOrder(order);else openMes();};
 const openRow=(row:MetricRow)=>{if(mode==='summary'){filter('orderNo',String(row.values['订单号']));setMode('detail');setSort('原表行号');}else viewOrder(row);};
 async function exportRows(){setBusy(true);setError('');try{
  const params=new URLSearchParams({metric:kind,revision:String(data.revision),sort,desc:desc?'1':'0',...filters});
  const res=await fetch('/api/workspace/metric-export?'+params);
  if(!res.ok){const value=await res.json() as {error?:string};throw new Error(value.error||'导出失败，请重试。');}
  const url=URL.createObjectURL(await res.blob()),a=document.createElement('a');a.href=url;a.download=decodeURIComponent(res.headers.get('Content-Disposition')?.split("UTF-8''")[1]||`${meta.title}.xlsx`);a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }catch(e){setError(e instanceof Error?e.message:'连接失败，请重试。');}finally{setBusy(false);}}
 async function refreshRows(){setBusy(true);setError('');try{const result=await refresh() as {error?:Error};if(result?.error)throw result.error;}catch(e){setError(e instanceof Error?e.message:'刷新失败。');}finally{setBusy(false);}}
 return <Dialog open onOpenChange={open=>{if(!open)onClose();}}><DialogContent className="metric-dialog" showCloseButton={false}>
  <div className="metric-detail-heading"><div><span className="section-kicker">汇总明细 · 跨部门跟进</span><DialogTitle>{meta.title}</DialogTitle><DialogDescription>{meta.rule}</DialogDescription></div><Button variant="ghost" size="icon" aria-label="关闭汇总明细" onClick={onClose}><X/></Button></div>
  <div className="metric-detail-summary"><span>全部 <b>{metricValue(kind,base).toLocaleString()}</b> {meta.unit}</span><span>筛选后 <b>{metricValue(kind,filtered).toLocaleString()}</b> {meta.unit} · <b>{filtered.length.toLocaleString()}</b> 条明细</span><span className="metric-asof">版本 {data.revision} · {new Date(data.asOf).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}</span><Button variant="outline" disabled={busy} onClick={()=>void refreshRows()}><RefreshCw size={15}/>刷新明细</Button><Button disabled={busy||!filtered.length} onClick={()=>void exportRows()}><Download size={15}/>{busy?'处理中…':'导出筛选明细'}</Button></div>
  {error&&<div role="alert" className="error metric-export-error">{error}</div>}
  <div className="metric-detail-filters"><div className="metric-search"><Search size={16}/><Input aria-label="搜索汇总明细" placeholder="搜索订单、图号、异常或跟进内容" value={filters.q||''} onChange={e=>filter('q',e.target.value)}/></div>{([['customer','客户'],['owner','跟单员'],['stage','当前工序'],...(kind==='review'?[['issue','事项类型']]:[])] as [keyof MetricFilters,string][]).map(([key,label])=><select key={key} aria-label={`明细${label}筛选`} value={filters[key]||''} onChange={e=>filter(key,e.target.value)}><option value="">全部{label}</option>{options(label).map(v=><option key={v} value={v}>{v}</option>)}</select>)}<Button variant="ghost" onClick={()=>{setFilters({});setPage(0);}}>清除筛选</Button></div>
  <div className="metric-view-tools">{kind==='orders'&&<div className="metric-view-tabs" role="group" aria-label="汇总浏览方式"><button aria-pressed={mode==='summary'} onClick={()=>{setMode('summary');setSort('订单号');setPage(0);}}>按订单汇总</button><button aria-pressed={mode==='detail'} onClick={()=>{setMode('detail');setSort('原表行号');setPage(0);}}>款色明细</button></div>}{filters.orderNo&&<button className="text-link" onClick={()=>filter('orderNo','')}>订单：{filters.orderNo} ×</button>}<span>点击表头排序 · 横向滚动查看各部门字段</span>{mode==='detail'&&<label><input type="checkbox" checked={showAll} onChange={e=>setShowAll(e.target.checked)}/>显示全部工序与跟进列</label>}</div>
  <div className="metric-sheet-scroll" tabIndex={0} aria-label={`${meta.title}明细表格`}><table className="metric-sheet"><thead><tr><th className="metric-rowno">序号</th>{columns.map(key=><th key={key} aria-sort={sort===key?(desc?'descending':'ascending'):'none'}><button onClick={()=>toggleSort(key)}>{key}<ArrowDownUp size={12}/></button></th>)}<th>跟进操作</th></tr></thead><tbody>{visible.length?visible.map((row,i)=><tr key={row.id} data-record-id={row.id}><td className="metric-rowno">{currentPage*pageSize+i+1}</td>{columns.map(key=><td key={key} className={/原因|备注|事项|记录/.test(key)?'metric-wrap':''} title={String(row.values[key]??'')}><span>{key==='订单号'?<button className="text-link" onClick={()=>openRow(row)}>{String(row.values[key]||'未标注订单')}</button>:row.values[key]===null?'待核对':row.values[key]===''||row.values[key]===undefined?'—':typeof row.values[key]==='number'?row.values[key].toLocaleString():row.values[key]}</span></td>)}<td>{mode==='summary'?<button className="text-link" onClick={()=>{filter('orderNo',String(row.values['订单号']));setMode('detail');setSort('原表行号');}}>展开订单明细</button>:<button className="text-link" onClick={()=>viewOrder(row)}>{row.lineId?'打开订单跟进':'进入 MES 核对'}</button>}</td></tr>):<tr><td colSpan={columns.length+2} className="metric-empty">没有符合条件的明细，请调整筛选。</td></tr>}</tbody></table></div>
  <div className="metric-detail-footer"><span>共 {rows.length.toLocaleString()} {mode==='summary'?'个订单':'条明细'} · Excel 导出包含全部筛选结果、工序字段和跟进填写列</span><div><select aria-label="明细每页条数" value={pageSize} onChange={e=>{setPageSize(Number(e.target.value));setPage(0);}}>{[50,100,200].map(n=><option key={n} value={n}>每页 {n} 条</option>)}</select><Button variant="outline" size="sm" disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>上一页</Button><span>{currentPage+1} / {pages}</span><Button variant="outline" size="sm" disabled={currentPage>=pages-1} onClick={()=>setPage(currentPage+1)}>下一页</Button></div></div>
 </DialogContent></Dialog>;
}
