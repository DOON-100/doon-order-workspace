'use client';
import {ExcelTable,useExcelColumnFilters} from './excel-table';
import {useEffect,useMemo,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {ArrowUpRight,Download,RefreshCw,Package,Truck,ClipboardList,Clock3} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {BusinessTeamDownloadButton} from './business-team-download';
import {request} from './ui';
import {dateValue,today} from '@/lib/ledger';
import {supplierWorkspaceSpaces} from '@/lib/supplier-workspace';
import type {WorkspaceNavigate} from '@/lib/handoff-navigation';
import './supplier-workspace.css';
import {KingdeeSyncButton} from './kingdee-sync-button';

type SourceRow={sourceRow:number;values:(string|number|boolean|null)[];displayValues:string[];rowType:'data'|'summary'|'blank'};
type Metadata={filename:string;sourceAsOf:string;sourceFilter:string;sourceSheet:string;sourceAccount?:string;importedAt:string;rowCount:number;orderCount:number;supplierCount:number;quantityMeaning:string;apiAddedCount?:number;scope?:'all'|'authorized'};
type Snapshot={id:string;headers:string[];rows:SourceRow[];metadata:Metadata};
type SourceData={snapshot:Snapshot|null;canImport:boolean;canDownloadOriginal:boolean;history:Array<{id:string;metadata:Metadata}>};
const sourceUrl='https://tf.jdy.com/ierp/index.html?formId=home_page';
const dateText=(value:string)=>value?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'—';

export function KingdeePendingPanel({overview=false,onNavigate,onDirtyChange}:{overview?:boolean;onNavigate:WorkspaceNavigate;onDirtyChange:(dirty:boolean)=>void}){
 const cache=useQueryClient(),[snapshotId,setSnapshotId]=useState('');
 const query=useQuery<SourceData>({queryKey:['kingdee-pending',snapshotId],queryFn:()=>request('kingdee-pending-data'+(snapshotId?'?id='+encodeURIComponent(snapshotId):''))});
 const snapshot=query.data?.snapshot,headers=snapshot?.headers||[],metadata=snapshot?.metadata;
 const [q,setQ]=useState(''),[supplier,setSupplier]=useState(''),[buyer,setBuyer]=useState(''),[period,setPeriod]=useState('all'),[page,setPage]=useState(0),[showSummary,setShowSummary]=useState(false);
 const sourceRows=useMemo(()=>(snapshot?.rows||[]).filter(row=>row.rowType==='data'),[snapshot]);
 const index=(name:string)=>headers.indexOf(name),cell=(row:SourceRow,name:string)=>String(row.displayValues[index(name)]??'').trim();
 const suppliers=[...new Set(sourceRows.map(row=>cell(row,'供应商')).filter(Boolean))].sort(),buyers=[...new Set(sourceRows.map(row=>cell(row,'业务员')).filter(Boolean))].sort();
 const currentDate=today(),weekEnd=new Date(new Date(currentDate+'T00:00:00Z').getTime()+7*86400000).toISOString().slice(0,10);
 const dueDate=(row:SourceRow)=>dateValue(cell(row,'预计交货日期'))||dateValue(row.values[index('预计交货日期')]);
 const late=(row:SourceRow)=>{const due=dueDate(row);return !!due&&due<currentDate;};
 const baseRows=sourceRows.filter(row=>(!q||row.displayValues.join(' ').toLowerCase().includes(q.toLowerCase()))&&(!supplier||cell(row,'供应商')===supplier)&&(!buyer||cell(row,'业务员')===buyer)&&(period==='all'||period==='late'&&late(row)||period==='week'&&dueDate(row)>=currentDate&&dueDate(row)<=weekEnd));
 const columnModel=useExcelColumnFilters(baseRows,row=>[row.sourceRow,...headers.map((_,i)=>row.displayValues[i]||'—')]);
 const filtered=columnModel.rows;
 useEffect(()=>setPage(0),[columnModel.filters]);
 const headerSchema=JSON.stringify(headers);
 useEffect(()=>columnModel.clearFilters(),[snapshotId,headerSchema]);
 const pageCount=Math.max(1,Math.ceil(filtered.length/50)),safePage=Math.min(page,pageCount-1),visible=filtered.slice(safePage*50,(safePage+1)*50);
 useEffect(()=>{setPage(0);},[q,supplier,buyer,period,snapshotId]);
 useEffect(()=>{onDirtyChange(false);return()=>onDirtyChange(false);},[onDirtyChange]);
 const reset=()=>{setQ('');setSupplier('');setBuyer('');setPeriod('all');setPage(0);};
 return <div className="supplier-workspace">
  <section className="supplier-source-hero"><div><span className="supplier-eyebrow">DOON · 供应商管理</span><h2>{overview?'从未上货到齐料交付':'采购未上货订单总表'}</h2><p>以金蝶采购记录为依据，集中查看供应商、采购物料与交期。</p><div className="supplier-source-badges"><span>{metadata?'金蝶数据已同步':'等待首次同步'}</span><span>来源截至 {metadata?.sourceAsOf||'—'}</span><span>{metadata?.scope==='authorized'?'当前授权范围明细':'保留来源明细'}</span></div></div><div className="supplier-source-actions"><a className="supplier-source-link" href={sourceUrl} target="_blank" rel="noreferrer">打开金蝶 <ArrowUpRight size={16}/></a>{query.data?.canImport&&<KingdeeSyncButton onSynchronized={()=>{setSnapshotId('');reset();void cache.invalidateQueries({queryKey:['kingdee-pending']});}}/>}</div></section>
  {query.isError&&<div className="error notice" role="alert">金蝶来源数据读取失败：{(query.error as Error).message}<Button variant="outline" onClick={()=>void query.refetch()}>重试</Button></div>}
  <div className="supplier-source-metrics">{[[ClipboardList,'未上货明细',sourceRows.length],[Package,'采购订单',new Set(sourceRows.map(row=>cell(row,'单据编号'))).size],[Truck,'供应商',suppliers.length],[Clock3,'原交期已过',sourceRows.filter(late).length]].map(([Icon,label,count])=>{const MetricIcon=Icon as typeof Package;return <div key={String(label)}><MetricIcon size={20}/><span>{String(label)}</span><strong>{Number(count).toLocaleString('zh-CN')}</strong></div>;})}</div>
  {overview&&<section className="supplier-space-grid" aria-label="供应商二级空间">{supplierWorkspaceSpaces.map((space,i)=><button key={space.id} onClick={()=>onNavigate(space.id)}><span>{String(i+1).padStart(2,'0')}</span><h3>{space.label}</h3><p>{space.detail}</p><ArrowUpRight size={18}/></button>)}</section>}
  <section className="supplier-source-panel"><div className="supplier-source-heading"><div><h3>金蝶采购总表 · {filtered.length.toLocaleString()} 条明细</h3><p>{metadata?`${metadata.sourceAccount||'金蝶采购报表'} · ${metadata.sourceSheet} · 同步于 ${dateText(metadata.importedAt)}`:'同步后显示金蝶采购明细。'}</p></div><div className="supplier-source-actions"><Button variant="outline" size="sm" onClick={()=>void query.refetch()} disabled={query.isFetching}><RefreshCw size={15}/>刷新中台</Button>{snapshot&&query.data?.canDownloadOriginal&&<BusinessTeamDownloadButton variant="outline" size="sm" href={'/api/workspace/kingdee-pending-file?id='+encodeURIComponent(snapshot.id)}><Download size={15}/>来源原表</BusinessTeamDownloadButton>}</div></div>
   <div className="supplier-source-filter"><label className="supplier-source-search">搜索<input aria-label="搜索金蝶未上货记录" placeholder="采购单号、物料、客户订单或备注" value={q} onChange={e=>setQ(e.target.value)}/></label><label>供应商<select aria-label="未上货供应商" value={supplier} onChange={e=>setSupplier(e.target.value)}><option value="">全部供应商</option>{suppliers.map(name=><option key={name}>{name}</option>)}</select></label><label>采购员<select aria-label="未上货采购员" value={buyer} onChange={e=>setBuyer(e.target.value)}><option value="">全部采购员</option>{buyers.map(name=><option key={name}>{name}</option>)}</select></label><label>金蝶交期<select aria-label="未上货交期" value={period} onChange={e=>setPeriod(e.target.value)}><option value="all">全部交期</option><option value="late">原交期已过</option><option value="week">未来 7 天到期</option></select></label><Button variant="ghost" size="sm" onClick={reset}>清除筛选</Button></div>
   {metadata&&<details className="supplier-source-details"><summary>同步范围与金蝶筛选条件</summary><p>{metadata.sourceFilter||'来源文件未包含筛选说明'}</p><p>文件：{metadata.filename}。列名“数量”沿用金蝶原文，不能据此推定剩余未上货数量。关闭状态沿用原表；按当前账号授权范围展示明细。</p><p>点击“同步金蝶总表”先筛选未入库、部分入库，再取最新 30 条商品明细去重新增；已有记录保留、不更新，不往更早的历史里补数量。状态或关联无法确定的记录暂不新增。点击“刷新中台”读取已保存的数据；“来源原表”下载原 Excel，不包含 API 新增记录。</p>{(query.data?.history.length||0)>0&&<label>查看同步版本<select aria-label="金蝶同步版本" value={snapshotId} onChange={e=>{setSnapshotId(e.target.value);reset();}}><option value="">当前总表（含 API 新增）</option>{query.data?.history.map(item=><option key={item.id} value={item.id}>{item.metadata?.sourceAsOf} · {item.metadata?.filename}</option>)}</select></label>}</details>}
   <div className="supplier-source-table-wrap"><ExcelTable className="supplier-source-table" filterModel={columnModel}><thead><tr><th>源行</th>{headers.map((header,i)=><th key={i}>{header||`第 ${i+1} 列`}</th>)}</tr></thead><tbody>{visible.map(row=><tr key={row.sourceRow}><td>{row.sourceRow}</td>{headers.map((header,i)=><td key={i} title={row.displayValues[i]} className={header==='预计交货日期'&&late(row)?'supplier-source-overdue':undefined}>{row.displayValues[i]||'—'}</td>)}</tr>)}</tbody>{showSummary&&snapshot&&<tfoot>{snapshot.rows.filter(row=>row.rowType==='summary').map(row=><tr key={row.sourceRow}><td>{row.sourceRow}</td>{headers.map((_,i)=><td key={i}>{row.displayValues[i]}</td>)}</tr>)}</tfoot>}</ExcelTable>{!filtered.length&&<div className="supplier-source-empty">{query.isPending?'正在读取金蝶来源…':snapshot?'当前筛选没有记录。':'尚未同步金蝶记录。可点击“同步金蝶总表”读取金蝶数据。'}</div>}</div>
   <div className="supplier-source-footer"><span>原始顺序 · 共 {filtered.length} 条 · 第 {safePage+1} / {pageCount} 页</span><label><input type="checkbox" checked={showSummary} onChange={e=>setShowSummary(e.target.checked)}/>显示金蝶原始合计（不随筛选变化）</label><div><Button variant="outline" size="sm" disabled={safePage===0} onClick={()=>setPage(safePage-1)}>上一页</Button><Button variant="outline" size="sm" disabled={safePage+1>=pageCount} onClick={()=>setPage(safePage+1)}>下一页</Button></div></div>
  </section>
 </div>;
}
