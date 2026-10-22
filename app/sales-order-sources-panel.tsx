'use client';

import {Fragment,useEffect,useRef,useState} from 'react';
import {ChevronDown,FileSpreadsheet,RefreshCw,Search} from 'lucide-react';
import {Button} from '@/components/ui/button';
import type {SalesOrderSource,SalesOrderSourceRecord} from '@/lib/sales-order-sources';
import {businessTeamFetch} from './business-team-client';
import {useBusinessTeamScope} from './business-team-context';
import {Input} from './ui';
import type {Data} from './workspace';
import './sales-order-sources-panel.css';

type SourceLine=SalesOrderSource['lines'][number];
type SourceItem=SalesOrderSourceRecord;
type SourceResponse={items:SourceItem[];canImport:boolean;error?:string};
type LoadedSources={key:string;response:SourceResponse};
const pageSize=20;
const mappingLabels={adopted:'已对应',pending:'保留候选',composite:'组合栏目'};
const normalized=(value:string)=>value.normalize('NFKC').trim().toLocaleLowerCase();
const numberText=(value:number)=>value.toLocaleString('zh-CN',{maximumFractionDigits:8});

function quantitySummary(lines:SourceLine[],field:'quantity'|'sampleQuantity'){
 const totals=new Map<string,number>();let unknown=0;
 for(const line of lines){const value=line[field];if(value===null){unknown++;continue;}totals.set(line.unit,(totals.get(line.unit)||0)+value);}
 const summary=Array.from(totals,([unit,value])=>`${numberText(value)} ${unit||'单位未填写'}`).join('；');
 return summary?summary+(unknown?`（${unknown} 行未填写）`:''):'原表未填写';
}

function OriginalValue({value}:{value:string|null}){
 if(value===null||value==='')return <span className="sales-source-empty-value">空白（源表未填写）</span>;
 if(value==='/')return <span className="sales-source-original-value">/<small>原文斜杠，保持原样</small></span>;
 return <span className="sales-source-original-value">{value}</span>;
}

function RawFieldOrigin({field}:{field:SourceLine['rawFields'][number]}){
 return <><span>{field.cell} · {field.column} 列</span>{field.sourceAnchor&&field.sourceAnchor!==field.cell&&<small>取值锚点：{field.sourceAnchor}</small>}{field.sourceRange&&<small>来源范围：{field.sourceRange}</small>}{field.hidden&&<small>原表隐藏栏目</small>}{field.formula&&<small className="sales-source-formula">原公式：{field.formula}<br/>缓存值：{field.cachedValue===null||field.cachedValue===undefined?'未提供':field.cachedValue}</small>}</>;
}

function LineDetails({line,sheet}:{line:SourceLine;sheet:string}){
 return <div className="sales-source-line-details" data-testid="sales-order-source-line-details">
  <div className="sales-source-detail-heading"><h4>原颜色与标准字段</h4><span>{sheet} · 原表第 {line.sourceRow} 行</span></div>
  <p className="sales-source-help">空白与原文“/”分别显示。标准标题按已确认规则对应；原颜色值和部位分别保留。</p>
  {line.colorFields.length?<div className="sales-source-table sales-source-color-table" tabIndex={0} aria-label="销售原单颜色字段详情"><table><thead><tr><th>来源列 / 原标题</th><th>原颜色值</th><th>标准中英标题</th><th>对应状态</th><th>部位 / 候选说明</th></tr></thead><tbody>{line.colorFields.map((field,index)=><tr key={field.sourceColumn+':'+index} data-mapping-status={field.status}><td><small>{field.sourceCell} · {field.sourceColumn} 列</small><strong>{field.sourceLabel}</strong></td><td><OriginalValue value={field.value}/></td><td>{field.standardZh||field.standardEn?<><strong>{field.standardZh}</strong><span>{field.standardEn}</span></>:<span className="sales-source-empty-value">保留原栏目</span>}</td><td><span className={'sales-source-mapping-status '+field.status}>{mappingLabels[field.status]}</span></td><td className="sales-source-wrap"><span>{field.qualifier||'—'}</span>{field.candidates.length>0&&<div className="sales-source-candidates"><small>{field.status==='composite'?'组合相关字段':'候选字段'}</small>{field.candidates.map((candidate,i)=><span key={i}>{candidate}</span>)}</div>}</td></tr>)}</tbody></table></div>:<p className="sales-source-help">此行未提供颜色栏目。</p>}
  {line.notes.length>0&&<ul className="sales-source-line-notes">{line.notes.map((note,index)=><li key={index}>{note}</li>)}</ul>}
  <details className="sales-source-raw-fields"><summary>查看全部原字段（{line.rawFields.length} 项）</summary><div className="sales-source-table" tabIndex={0} aria-label="销售原单全部原字段"><table><thead><tr><th>原单元格</th><th>原字段标题</th><th>原字段值</th></tr></thead><tbody>{line.rawFields.map((field,index)=><tr key={field.column+':'+index}><td><RawFieldOrigin field={field}/></td><td>{field.label}</td><td><OriginalValue value={field.value}/></td></tr>)}</tbody></table></div></details>
 </div>;
}

export function SalesOrderSourcesPanel({data}:{data:Data}){
 const teamId=useBusinessTeamScope()?.teamId||'';
 return <SalesOrderSourcesWorkspace key={JSON.stringify([data.me.id,data.me.role,teamId])} revision={data.revision}/>;
}

function SalesOrderSourcesWorkspace({revision}:{revision:number}){
 const [loaded,setLoaded]=useState<LoadedSources|null>(null),[failure,setFailure]=useState<{key:string;message:string}|null>(null),[retry,setRetry]=useState(0);
 const [selectedId,setSelectedId]=useState(''),[query,setQuery]=useState(''),[expandedLine,setExpandedLine]=useState(''),[page,setPage]=useState(0);
 const sequenceRef=useRef(0),requestKey=`${revision}:${retry}`;
 const response=loaded?.key===requestKey?loaded.response:null,error=failure?.key===requestKey?failure.message:'';
 const items=response?.items||[],selected=items.find(item=>item.id===selectedId)||null,order=selected?.source;

 useEffect(()=>{
  const controller=new AbortController(),sequence=++sequenceRef.current;
  setLoaded(null);setFailure(null);setExpandedLine('');
  void (async()=>{
   try{
    const result=await businessTeamFetch('/api/workspace/sales-order-sources-data',{cache:'no-store',signal:controller.signal});
    const value=await result.json() as SourceResponse;
    if(!result.ok)throw new Error(value.error||(result.status===401?'登录已失效，请重新登录。':result.status===403?'当前账号无权查看销售原单。':'销售原单读取失败，请重试。'));
    if(!Array.isArray(value.items))throw new Error('销售原单返回内容不完整，请重新读取。');
    if(!controller.signal.aborted&&sequence===sequenceRef.current){
     setLoaded({key:requestKey,response:value});
     setSelectedId(current=>value.items.some(item=>item.id===current)?current:value.items[0]?.id||'');
    }
   }catch(cause){if(!controller.signal.aborted&&sequence===sequenceRef.current)setFailure({key:requestKey,message:cause instanceof Error?cause.message:'销售原单读取失败，请重试。'});}
  })();
  return()=>{controller.abort();sequenceRef.current++;};
 },[requestKey]);

 const search=normalized(query),lines=(order?.lines||[]).filter(line=>!search||[line.drawing,line.model,line.color,line.sku].some(value=>normalized(value).includes(search)));
 const pages=Math.max(1,Math.ceil(lines.length/pageSize)),currentPage=Math.min(page,pages-1),start=currentPage*pageSize;
 const selectOrder=(id:string)=>{setSelectedId(id);setQuery('');setExpandedLine('');setPage(0);};
 const toggleLine=(id:string)=>setExpandedLine(current=>current===id?'':id);

 return <section id="sales-order-sources" className="panel mt-4 sales-order-sources" aria-label="已导入销售原单" data-testid="sales-order-sources-panel">
  <header className="sales-source-header"><div className="sales-source-title"><FileSpreadsheet size={25}/><div><h3>已导入销售原单</h3><p>查看客户原表明细、原颜色和标准字段对应，逐行核对。</p></div></div><div className="sales-source-header-actions"><span className="sales-source-review-badge">待核对资料 · 本次未下达生产 / ERP</span><Button type="button" variant="outline" aria-label="刷新已导入销售原单" onClick={()=>setRetry(value=>value+1)}><RefreshCw size={15}/>刷新</Button></div></header>
  {!response&&!error&&<p className="sales-source-empty" role="status">正在读取当前授权范围的销售原单…</p>}
  {error&&<div className="sales-source-error" role="alert"><p>{error}</p><Button type="button" variant="outline" onClick={()=>setRetry(value=>value+1)}>重新读取销售原单</Button></div>}
  {response&&!items.length&&<div className="sales-source-empty"><h4>当前范围暂无已导入销售原单</h4><p>导入的客户原单会在这里按订单展示，供核对款号、色号、数量和颜色资料。</p></div>}
  {!!items.length&&<>
   <div className="sales-source-order-cards" aria-label="选择已导入销售原单">{items.map(item=><button type="button" key={item.id} className={'sales-source-order-card'+(selectedId===item.id?' selected':'')} aria-pressed={selectedId===item.id} aria-label={`查看销售原单 ${item.source.orderNo}`} onClick={()=>selectOrder(item.id)}><span className="sales-source-card-top"><strong>{item.source.orderNo}</strong><small>{item.status}</small></span><span>{item.source.customer} · {item.source.productType}</span><span>{item.source.lines.length} 条明细 · 数量 {quantitySummary(item.source.lines,'quantity')}</span><small>样办：{quantitySummary(item.source.lines,'sampleQuantity')}</small></button>)}</div>
   {order&&<div className="sales-source-selected-order">
    <div className="sales-source-order-heading"><div><h4>{order.orderNo}</h4><p>{order.documentType} · 客户 {order.customer} · {order.productType}</p><p>客户 PO：{order.customerPO||'原表未填写'}</p></div><label className="sales-source-search"><span>查找本单明细</span><div><Search size={16}/><Input aria-label="搜索销售原单款号色号SKU" value={query} maxLength={300} placeholder="搜索图号、款号、色号或 SKU" onChange={event=>{setQuery(event.target.value);setExpandedLine('');setPage(0);}}/></div></label></div>
    <div className="sales-source-evidence"><span>来源：{order.source.filename}</span><span>工作表：{order.source.sheet} · {order.source.detailRange}</span>{order.dictionaryVersion&&<span>字段规则：{order.dictionaryVersion}</span>}<details><summary>查看源文件指纹</summary><code>{order.source.sha256}</code></details></div>
    {order.warnings.length>0&&<div className="sales-source-warnings"><strong>本单待核对事项</strong><ul>{order.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul></div>}
    <p className="sales-source-help">本单数量：{quantitySummary(order.lines,'quantity')}；样办：{quantitySummary(order.lines,'sampleQuantity')}。数量与样办分别保留，不自动相加。点击明细行查看原颜色和来源字段。</p>
    <div className="sales-source-table sales-source-lines-table" tabIndex={0} aria-label="已导入销售原单明细表"><table><thead><tr><th>原表行</th><th>图纸编号</th><th>原款号</th><th>SKU</th><th>色号</th><th>数量</th><th>样办数量</th><th>原单价</th><th>原交期</th><th>明细</th></tr></thead><tbody>{lines.slice(start,start+pageSize).map(line=><Fragment key={line.id}><tr className={'sales-source-line'+(expandedLine===line.id?' selected':'')} data-source-line-id={line.id} onClick={()=>toggleLine(line.id)}><td>{line.sourceRow}</td><td><strong>{line.drawing}</strong></td><td>{line.model||<span className="sales-source-empty-value">空白</span>}</td><td>{line.sku||<span className="sales-source-empty-value">空白</span>}</td><td>{line.color}</td><td className="sales-source-number">{numberText(line.quantity)} {line.unit||'单位未填写'}</td><td className="sales-source-number">{line.sampleQuantity===null?<span className="sales-source-empty-value">未填写</span>:`${numberText(line.sampleQuantity)} ${line.unit||'单位未填写'}`}</td><td>{line.unitPrice||<span className="sales-source-empty-value">未填写</span>}</td><td className="sales-source-delivery">{line.deliveryText?<OriginalValue value={line.deliveryText}/>:<span className="sales-source-empty-value">有效交期待确认</span>}</td><td><Button type="button" size="sm" variant="outline" aria-label={`查看原单第 ${line.sourceRow} 行颜色与来源`} aria-expanded={expandedLine===line.id} onClick={event=>{event.stopPropagation();toggleLine(line.id);}}><ChevronDown size={14}/>{expandedLine===line.id?'收起':'查看'}</Button></td></tr>{expandedLine===line.id&&<tr className="sales-source-detail-row"><td colSpan={10}><LineDetails line={line} sheet={order.source.sheet}/></td></tr>}</Fragment>)}{!lines.length&&<tr><td colSpan={10} className="sales-source-empty">没有匹配的明细，请调整搜索词。</td></tr>}</tbody></table></div>
    <div className="sales-source-pagination"><span>本单共 {order.lines.length} 条 · 当前匹配 {lines.length} 条{lines.length?` · 显示 ${start+1}–${Math.min(start+pageSize,lines.length)}`:''}</span><div><Button type="button" size="sm" variant="outline" disabled={currentPage===0} onClick={()=>{setPage(currentPage-1);setExpandedLine('');}}>上一页</Button><span>{currentPage+1} / {pages}</span><Button type="button" size="sm" variant="outline" disabled={currentPage>=pages-1} onClick={()=>{setPage(currentPage+1);setExpandedLine('');}}>下一页</Button></div></div>
   </div>}
  </>}
 </section>;
}
