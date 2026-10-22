'use client';

import {useEffect,useRef,useState} from 'react';
import {ArrowRight,Download,FileSpreadsheet,Maximize2,Minimize2,RefreshCw,Search,X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import type {SalesOrderSource,SalesOrderSourceRecord} from '@/lib/sales-order-sources';
import {businessTeamFetch} from './business-team-client';
import {useBusinessTeamScope} from './business-team-context';
import {Input} from './ui';
import type {Data} from './workspace';
import './sales-order-sources-panel.css';

type SourceLine=SalesOrderSource['lines'][number];
type ColorField=SourceLine['colorFields'][number];
type FieldLabel={zh:string;en:string;notes?:string;sourceRef?:string;kingdee?:{label:string;column:string;sourceRef:string;basis:'same-meaning'};originalZh?:string;originalEn?:string};
type FieldLabels=Record<string,FieldLabel>;
type SourceResponse={items:SalesOrderSourceRecord[];canImport:boolean;fieldLabels?:FieldLabels;fieldLabelsVersion?:string;error?:string};
type LoadedSources={key:string;response:SourceResponse};
type ColorColumn={key:string;field:ColorField};
type ExportState={key:string;busy:boolean;message:string;error:boolean};
const mappingLabels={adopted:'已对应',pending:'待匹配',composite:'组合栏目'};
const normalized=(value:string)=>value.normalize('NFKC').trim().toLocaleLowerCase();
const numberText=(value:number)=>value.toLocaleString('zh-CN',{maximumFractionDigits:8});
const basicLabels:Record<string,FieldLabel>={orderNo:{zh:'订单号',en:'Order No.'},customer:{zh:'客户号',en:'Customer No.'},customerPO:{zh:'客户订单号',en:'Customer PO'},drawing:{zh:'图纸编号',en:'Drawing No.'},model:{zh:'原款号',en:'Original Model'},sku:{zh:'SKU',en:'Source SKU'},color:{zh:'色号',en:'Color No.'},deliveryText:{zh:'原交期',en:'Original Delivery'},quantity:{zh:'数量',en:'Quantity'},unit:{zh:'单位',en:'Unit'},sampleQuantity:{zh:'样办数量',en:'Sample Quantity'},unitPrice:{zh:'原单价',en:'Original Unit Price'},sourceAmount:{zh:'原单金额',en:'Source Amount',notes:'仅显示原文件金额或公式缓存，不重新计算；币种和审批金额未确认。'}};
const basicColumns=[{key:'sourceRow',width:60},{key:'drawing',width:140},{key:'color',width:95},{key:'orderNo',width:170},{key:'customer',width:110},{key:'customerPO',width:220},{key:'model',width:140},{key:'sku',width:170},{key:'deliveryText',width:230}];
const quantityColumns=[{key:'quantity',width:120},{key:'unit',width:90},{key:'sampleQuantity',width:120},{key:'unitPrice',width:135},{key:'sourceAmount',width:145}];
const colorWidth=190;

function exportFilename(disposition:string|null,orderNo:string){
 const fallback=`销售原单_${orderNo}.xlsx`;
 const encoded=disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
 const plain=disposition?.match(/filename="([^"]+)"/i)?.[1];
 let filename=fallback;
 try{filename=encoded?decodeURIComponent(encoded):plain||fallback;}catch{/* Keep the selected order's fallback filename. */}
 const safe=filename.replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g,'_').trim().replace(/\.+$/,'').slice(0,180);
 return (safe.replace(/\.xlsx$/i,'')||'销售原单')+'.xlsx';
}

function quantitySummary(lines:SourceLine[],field:'quantity'|'sampleQuantity'){
 const totals=new Map<string,number>();let unknown=0;
 for(const line of lines){const value=line[field];if(value===null){unknown++;continue;}totals.set(line.unit,(totals.get(line.unit)||0)+value);}
 const summary=Array.from(totals,([unit,value])=>`${numberText(value)} ${unit||'单位未填写'}`).join('；');
 return summary?summary+(unknown?`（${unknown} 行未填写）`:''):'原表未填写';
}

function OriginalValue({value,compact=false}:{value:string|null;compact?:boolean}){
 if(value===null||value==='')return <span className="sales-source-empty-value" title="空白（源表未填写）">{compact?'—':'空白（源表未填写）'}</span>;
 if(value==='/')return <span className="sales-source-original-value" title="原文斜杠，保持原样">/{!compact&&<small>原文斜杠，保持原样</small>}</span>;
 return <span className="sales-source-original-value">{value}</span>;
}

function fieldLabel(key:string,labels?:FieldLabels):FieldLabel{return labels&&Object.hasOwn(labels,key)?labels[key]:Object.hasOwn(basicLabels,key)?basicLabels[key]:{zh:key,en:''};}
function colorLabel(field:ColorField,labels?:FieldLabels):FieldLabel{
 return field.standardZh&&!Object.hasOwn(basicLabels,field.standardZh)&&labels&&Object.hasOwn(labels,field.standardZh)?labels[field.standardZh]:{zh:field.standardZh||field.sourceLabel,en:field.standardEn};
}
function colorEntries(line:SourceLine){
 const occurrences=new Map<string,number>();
 return line.colorFields.map(field=>{
  // Repeated standard names must retain separate source positions and unresolved meanings.
  const identity=JSON.stringify([field.sourceColumn,field.sourceLabel,field.standardZh,field.standardEn,field.qualifier,field.status]);
  const occurrence=occurrences.get(identity)||0;occurrences.set(identity,occurrence+1);
  return {key:identity+':'+occurrence,field};
 });
}
function colorColumns(lines:SourceLine[]):ColorColumn[]{
 const columns=new Map<string,ColorColumn>();
 for(const line of lines)for(const entry of colorEntries(line))if(!columns.has(entry.key))columns.set(entry.key,entry);
 return [...columns.values()];
}
function SourceAmount({line}:{line:SourceLine}){
 const matches=line.rawFields.filter(field=>['item net','total','amount','金额'].includes(normalized(field.label).replace(/\s+/g,' ')));
 if(matches.length!==1)return <span className="sales-source-empty-value">{matches.length?'多个金额栏待核对':'原表未提供'}</span>;
 const field=matches[0],formula=field.formula||field.value?.startsWith('='),value=formula?field.cachedValue:field.value;
 if(formula&&(value===null||value===undefined||value===''))return <span className="sales-source-empty-value">公式缓存未提供</span>;
 return <span title={`${field.cell} · ${field.label}${formula?' · 原文件公式缓存，未重新计算':''}`}><OriginalValue value={value??null} compact/></span>;
}
function LabelText({label}:{label:FieldLabel}){return <><strong>{label.zh}</strong>{label.en&&<small lang="en">{label.en}</small>}</>;}
function RawFieldOrigin({field}:{field:SourceLine['rawFields'][number]}){
 return <><span>{field.cell} · {field.column} 列</span>{field.sourceAnchor&&field.sourceAnchor!==field.cell&&<small>取值锚点：{field.sourceAnchor}</small>}{field.sourceRange&&<small>来源范围：{field.sourceRange}</small>}{field.hidden&&<small>原表隐藏栏目</small>}{field.formula&&<small className="sales-source-formula">原公式：{field.formula}<br/>缓存值：{field.cachedValue===null||field.cachedValue===undefined?'未提供':field.cachedValue}</small>}</>;
}

function LineDetails({line,sheet,labels}:{line:SourceLine;sheet:string;labels?:FieldLabels}){
 return <div className="sales-source-line-details" data-testid="sales-order-source-line-details">
  <div className="sales-source-detail-heading"><h4>原颜色与标准字段</h4><span>{sheet} · 原表第 {line.sourceRow} 行</span></div>
  <p className="sales-source-help">主表已平铺全部颜色。此处保留原文、部位、候选及单元格来源，供核对。</p>
  {line.colorFields.length?<div className="sales-source-table sales-source-color-table" tabIndex={0} aria-label="销售原单颜色字段详情"><table><thead><tr><th>来源列 / 原标题</th><th>原颜色值</th><th>当前标准中英标题</th><th>对应状态</th><th>部位 / 候选说明</th></tr></thead><tbody>{line.colorFields.map((field,index)=><tr key={field.sourceColumn+':'+index} data-mapping-status={field.status}><td><small>{field.sourceCell} · {field.sourceColumn} 列</small><strong>{field.sourceLabel}</strong></td><td><OriginalValue value={field.value}/></td><td><LabelText label={colorLabel(field,labels)}/></td><td><span className={'sales-source-mapping-status '+field.status}>{mappingLabels[field.status]}</span></td><td className="sales-source-wrap"><span>{field.qualifier||'—'}</span>{field.candidates.length>0&&<div className="sales-source-candidates"><small>{field.status==='composite'?'组合相关字段':'候选字段'}</small>{field.candidates.map((candidate,i)=><span key={i}>{candidate}</span>)}</div>}</td></tr>)}</tbody></table></div>:<p className="sales-source-help">此行未提供颜色栏目。</p>}
  {line.notes.length>0&&<ul className="sales-source-line-notes">{line.notes.map((note,index)=><li key={index}>{note}</li>)}</ul>}
  <details className="sales-source-raw-fields"><summary>查看全部原字段（{line.rawFields.length} 项）</summary><div className="sales-source-table" tabIndex={0} aria-label="销售原单全部原字段"><table><thead><tr><th>原单元格</th><th>原字段标题</th><th>原字段值</th></tr></thead><tbody>{line.rawFields.map((field,index)=><tr key={field.column+':'+index}><td><RawFieldOrigin field={field}/></td><td>{field.label}</td><td><OriginalValue value={field.value}/></td></tr>)}</tbody></table></div></details>
 </div>;
}

function SourceDetailsDialog({line,order,labels,onClose}:{line:SourceLine;order:SalesOrderSource;labels?:FieldLabels;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const element=dialog.current;element?.showModal();return()=>element?.close();},[]);
 return <dialog ref={dialog} className="sales-source-dialog" aria-labelledby="sales-source-dialog-title" onCancel={onClose} onClose={onClose}>
  <header><div><h3 id="sales-source-dialog-title">原表第 {line.sourceRow} 行 · 来源核对</h3><p>{order.orderNo} · {line.drawing} · {line.color}</p></div><Button type="button" variant="outline" aria-label="关闭原单来源核对" onClick={onClose}><X size={16}/>关闭</Button></header>
  <LineDetails line={line} sheet={order.source.sheet} labels={labels}/>
 </dialog>;
}

export function SalesOrderSourcesPanel({data,onKingdeeOrder}:{data:Data;onKingdeeOrder?:(sourceId:string)=>void}){
 const teamId=useBusinessTeamScope()?.teamId||'';
 return <SalesOrderSourcesWorkspace key={JSON.stringify([data.me.id,data.me.role,teamId])} revision={data.revision} onKingdeeOrder={onKingdeeOrder}/>;
}

function SalesOrderSourcesWorkspace({revision,onKingdeeOrder}:{revision:number;onKingdeeOrder?:(sourceId:string)=>void}){
 const [loaded,setLoaded]=useState<LoadedSources|null>(null),[failure,setFailure]=useState<{key:string;message:string}|null>(null),[retry,setRetry]=useState(0);
 const [selectedId,setSelectedId]=useState(''),[query,setQuery]=useState(''),[detailId,setDetailId]=useState(''),[showOriginalHeaders,setShowOriginalHeaders]=useState(false),[focusMode,setFocusMode]=useState(false);
 const [exportState,setExportState]=useState<ExportState|null>(null);
 const exportRequest=useRef<{key:string;controller:AbortController}|null>(null),currentExportKey=useRef('');
 const sequenceRef=useRef(0),scroller=useRef<HTMLDivElement>(null),panelRef=useRef<HTMLElement>(null),requestKey=`${revision}:${retry}`;
 const response=loaded?.key===requestKey?loaded.response:null,error=failure?.key===requestKey?failure.message:'';
 const items=response?.items||[],selected=items.find(item=>item.id===selectedId)||null,order=selected?.source,labels=response?.fieldLabels;
 const exportKey=`${requestKey}:${selected?.id||''}`,activeExport=exportState?.key===exportKey?exportState:null;
 currentExportKey.current=exportKey;

 useEffect(()=>()=>{exportRequest.current?.controller.abort();exportRequest.current=null;},[]);
 useEffect(()=>{
  if(exportRequest.current&&exportRequest.current.key!==exportKey){exportRequest.current.controller.abort();exportRequest.current=null;}
  setExportState(current=>current?.key===exportKey?current:null);
 },[exportKey]);

 useEffect(()=>{
  const controller=new AbortController(),sequence=++sequenceRef.current;
  setLoaded(null);setFailure(null);setDetailId('');
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
 useEffect(()=>{
  if(!focusMode)return;
  const originalOverflow=document.body.style.overflow,previousFocus=document.activeElement;document.body.style.overflow='hidden';
  const onKey=(event:KeyboardEvent)=>{
   if(document.querySelector('dialog[open]'))return;
   if(event.key==='Escape'){event.preventDefault();setFocusMode(false);return;}
   if(event.key!=='Tab')return;
   const controls=[...panelRef.current?.querySelectorAll<HTMLElement>('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])')||[]].filter(element=>!element.hasAttribute('disabled')&&element.getClientRects().length>0);
   if(!controls.length){event.preventDefault();return;}
   const first=controls[0],last=controls[controls.length-1],active=document.activeElement,outside=!panelRef.current?.contains(active);
   if(event.shiftKey&&(active===first||outside)){event.preventDefault();last.focus();}else if(!event.shiftKey&&(active===last||outside)){event.preventDefault();first.focus();}
  };
  window.addEventListener('keydown',onKey);return()=>{document.body.style.overflow=originalOverflow;window.removeEventListener('keydown',onKey);if(previousFocus instanceof HTMLElement&&previousFocus.isConnected)previousFocus.focus({preventScroll:true});};
 },[focusMode]);

 const search=normalized(query),lines=(order?.lines||[]).filter(line=>!search||[line.drawing,line.model,line.color,line.sku,...line.colorFields.map(field=>field.value||'')].some(value=>normalized(value).includes(search)));
 const colors=colorColumns(order?.lines||[]),basicWidth=basicColumns.reduce((sum,column)=>sum+column.width,0),totalWidth=basicWidth+colors.length*colorWidth+quantityColumns.reduce((sum,column)=>sum+column.width,0)+100;
 const detailLine=order?.lines.find(line=>line.id===detailId);
 const selectOrder=(id:string)=>{setSelectedId(id);setQuery('');setDetailId('');scroller.current?.scrollTo({left:0,top:0});};
 const jumpTo=(section:'basic'|'colors'|'quantity')=>{
  const frozenWidth=window.matchMedia('(max-width:650px)').matches?60:295;
  const left=section==='basic'?0:basicWidth+(section==='quantity'?colors.length*colorWidth:0)-frozenWidth;
  scroller.current?.scrollTo({left,behavior:'smooth'});
 };
 const exportOrder=async()=>{
  if(!selected||!order||exportRequest.current)return;
  const target={id:selected.id,orderNo:order.orderNo,lineCount:order.lines.length},key=exportKey,controller=new AbortController();
  exportRequest.current={key,controller};setExportState({key,busy:true,message:'正在生成整张订单的 Excel…',error:false});
  const isCurrent=()=>!controller.signal.aborted&&exportRequest.current?.controller===controller&&currentExportKey.current===key;
  try{
   const result=await businessTeamFetch('/api/workspace/sales-order-sources-export?id='+encodeURIComponent(target.id),{cache:'no-store',credentials:'same-origin',signal:controller.signal});
   if(!result.ok){
    const value=await result.json().catch(()=>null) as {error?:string}|null;
    throw new Error(value?.error||(result.status===401?'登录已失效，请重新登录。':result.status===403?'当前账号无权导出这张订单。':'订单导出失败，请重试。'));
   }
   if(result.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')throw new Error('服务器未返回 Excel 文件，请重新导出。');
   const blob=await result.blob();
   if(!isCurrent())return;
   if(!blob.size)throw new Error('导出文件为空，请重试。');
   const objectUrl=URL.createObjectURL(blob),anchor=document.createElement('a');
   try{
    anchor.href=objectUrl;anchor.download=exportFilename(result.headers.get('Content-Disposition'),target.orderNo);
    document.body.appendChild(anchor);anchor.click();
   }finally{anchor.remove();setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);}
   setExportState({key,busy:false,message:`${target.orderNo} 已生成，已发起下载（${target.lineCount} 条明细）。`,error:false});
  }catch(cause){if(isCurrent())setExportState({key,busy:false,message:cause instanceof Error?cause.message:'订单导出失败，请重试。',error:true});}
  finally{if(exportRequest.current?.controller===controller)exportRequest.current=null;}
 };

 return <section ref={panelRef} id="sales-order-sources" className={'panel mt-4 sales-order-sources'+(focusMode?' sales-source-focus':'')} role={focusMode?'dialog':undefined} aria-modal={focusMode||undefined} aria-label="已导入销售原单" data-testid="sales-order-sources-panel">
  <header className="sales-source-header"><div className="sales-source-title"><FileSpreadsheet size={25}/><div><h3>已导入销售原单</h3><p>中英订单明细总表 · 基本信息、颜色、数量及价格同表核对</p></div></div><div className="sales-source-header-actions">{onKingdeeOrder&&<Button type="button" variant="outline" disabled={!selected} onClick={()=>selected&&onKingdeeOrder(selected.id)}>生成金蝶销售订单</Button>}<span className="sales-source-review-badge">待核对资料 · 本次未下达生产 / ERP</span><Button type="button" variant="outline" disabled={!selected||activeExport?.busy} aria-busy={activeExport?.busy||undefined} title="导出当前选定的整张订单，自动去掉全空列" onClick={()=>void exportOrder()}><Download size={15}/><span>{activeExport?.busy?'正在导出…':'导出 Excel'}</span></Button><Button type="button" variant="outline" aria-pressed={focusMode} onClick={()=>setFocusMode(value=>!value)}>{focusMode?<Minimize2 size={15}/>:<Maximize2 size={15}/>}<span>{focusMode?'退出专注':'专注表格'}</span></Button><Button type="button" variant="outline" aria-label="刷新已导入销售原单" onClick={()=>setRetry(value=>value+1)}><RefreshCw size={15}/>刷新</Button></div></header>
  {!response&&!error&&<p className="sales-source-empty" role="status">正在读取当前授权范围的销售原单…</p>}
  {error&&<div className="sales-source-error" role="alert"><p>{error}</p><Button type="button" variant="outline" onClick={()=>setRetry(value=>value+1)}>重新读取销售原单</Button></div>}
  {response&&!items.length&&<div className="sales-source-empty"><h4>当前范围暂无已导入销售原单</h4><p>导入的客户原单会在这里按订单展示，供核对款号、色号、数量和颜色资料。</p></div>}
  {!!items.length&&<>
   <div className="sales-source-order-cards" aria-label="选择已导入销售原单">{items.map(item=><button type="button" key={item.id} className={'sales-source-order-card'+(selectedId===item.id?' selected':'')} aria-pressed={selectedId===item.id} aria-label={`查看销售原单 ${item.source.orderNo}`} onClick={()=>selectOrder(item.id)}><span className="sales-source-card-top"><strong>{item.source.orderNo}</strong><small>{item.status}</small></span><span>{item.source.customer} · {item.source.productType}</span><span>{item.source.lines.length} 条明细 · 数量 {quantitySummary(item.source.lines,'quantity')}</span><small>样办：{quantitySummary(item.source.lines,'sampleQuantity')}</small></button>)}</div>
   {order&&<div className="sales-source-selected-order">
    <div className="sales-source-export-note"><span>导出整张订单，自动去掉全空列；搜索仅影响页面显示。</span>{activeExport?.message&&<span className={activeExport.error?'sales-source-export-error':''} role={activeExport.error?'alert':'status'} aria-live={activeExport.error?'assertive':'polite'}>{activeExport.message}</span>}</div>
    <div className="sales-source-order-heading"><div><h4>{order.orderNo}</h4><p>{order.documentType} · {fieldLabel('customer',labels).zh} {order.customer} · {order.productType}</p><p>{fieldLabel('customerPO',labels).zh} / Customer PO：{order.customerPO||'原表未填写'}</p></div><label className="sales-source-search"><span>查找本单明细</span><div><Search size={16}/><Input aria-label="搜索销售原单款号色号SKU" value={query} maxLength={300} placeholder="搜索款号、色号、SKU 或颜色原文" onChange={event=>{setQuery(event.target.value);setDetailId('');scroller.current?.scrollTo({top:0});}}/></div></label></div>
    <div className="sales-source-evidence"><span>来源：{order.source.filename} · {order.source.sheet} · {order.source.detailRange}</span>{response?.fieldLabelsVersion&&<span>当前字段清单：{response.fieldLabelsVersion}</span>}<details><summary>来源版本与指纹</summary>{order.dictionaryVersion&&<span>导入时字段规则：{order.dictionaryVersion}</span>}<code>{order.source.sha256}</code></details></div>
    {order.warnings.length>0&&<details className="sales-source-warnings"><summary>待核对 {order.warnings.length} 项 <span>展开查看数量口径、交期及原模板提醒</span></summary><ul>{order.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul></details>}
    <div className="sales-source-sheet-toolbar"><nav aria-label="定位销售原单列区域"><Button type="button" size="sm" variant="outline" onClick={()=>jumpTo('basic')}>基本信息</Button><ArrowRight size={13}/><Button type="button" size="sm" variant="outline" onClick={()=>jumpTo('colors')}>颜色信息（{colors.length} 列）</Button><ArrowRight size={13}/><Button type="button" size="sm" variant="outline" onClick={()=>jumpTo('quantity')}>数量 / 价格</Button></nav><label><input type="checkbox" checked={showOriginalHeaders} onChange={event=>setShowOriginalHeaders(event.target.checked)}/>显示原字段标题</label></div>
    <div className="sales-source-table sales-source-lines-table" ref={scroller} tabIndex={0} aria-label="已导入销售原单明细表"><table style={{width:totalWidth,minWidth:totalWidth}}>
     <colgroup>{basicColumns.map(column=><col key={column.key} style={{width:column.width}}/>)}{colors.map(column=><col key={column.key} style={{width:colorWidth}}/>)}{quantityColumns.map(column=><col key={column.key} style={{width:column.width}}/>)}<col style={{width:100}}/></colgroup>
     <thead><tr className="sales-source-group-header"><th colSpan={basicColumns.length} scope="colgroup" className="sales-source-basic-group">基本信息 <span>Basic information</span></th>{colors.length>0&&<th colSpan={colors.length} scope="colgroup" className="sales-source-color-group">颜色信息 <span>Colors · {colors.length} 列</span></th>}<th colSpan={quantityColumns.length} scope="colgroup" className="sales-source-quantity-group">数量 / 价格 <span>Quantity &amp; price</span></th><th scope="colgroup">原始资料</th></tr>
      <tr className="sales-source-column-header">{basicColumns.map((column,index)=><th key={column.key} scope="col" data-field-key={column.key} title={fieldLabel(column.key,labels).notes} className={index<3?`sales-source-freeze-${index+1}`:''}>{column.key==='sourceRow'?<><strong>原表行</strong><small>Row</small></>:<LabelText label={fieldLabel(column.key,labels)}/>}</th>)}
       {colors.map(column=>{const field=column.field,label=colorLabel(field,labels);return <th key={column.key} scope="col" className={'sales-source-color-header '+field.status} data-color-column={field.sourceColumn} data-color-key={column.key} title={[`原字段：${field.sourceLabel}`,field.qualifier,field.candidates.length?'候选：'+field.candidates.join(' / '):'',label.kingdee?'金蝶模板：'+label.kingdee.column+' '+label.kingdee.label:''].filter(Boolean).join('\n')}><span className="sales-source-column-origin">{field.sourceColumn} 列{field.status!=='adopted'&&<em>{mappingLabels[field.status]}</em>}</span><LabelText label={label}/>{field.qualifier&&<span className="sales-source-column-qualifier">{field.qualifier}</span>}{showOriginalHeaders&&<span className="sales-source-column-original">原：{field.sourceLabel}</span>}</th>;})}
       {quantityColumns.map(column=><th key={column.key} scope="col" data-field-key={column.key} title={fieldLabel(column.key,labels).notes} className="sales-source-quantity-header"><LabelText label={fieldLabel(column.key,labels)}/></th>)}<th scope="col"><strong>来源核对</strong><small>Source</small></th>
      </tr></thead>
     <tbody>{lines.map(line=>{const entries=new Map(colorEntries(line).map(entry=>[entry.key,entry.field]));return <tr key={line.id} className="sales-source-line" data-source-line-id={line.id}>
      <td className="sales-source-freeze-1 sales-source-row-number">{line.sourceRow}</td><td className="sales-source-freeze-2"><strong>{line.drawing}</strong></td><td className="sales-source-freeze-3">{line.color}</td><td>{order.orderNo}</td><td>{order.customer}</td><td><OriginalValue value={order.customerPO} compact/></td><td><OriginalValue value={line.model} compact/></td><td><OriginalValue value={line.sku} compact/></td><td className="sales-source-delivery">{line.deliveryText?<OriginalValue value={line.deliveryText} compact/>:<span className="sales-source-empty-value">有效交期待确认</span>}</td>
      {colors.map(column=>{const field=entries.get(column.key);return <td key={column.key} className={'sales-source-color-cell '+(field?.status||'missing')} data-color-column={column.field.sourceColumn} data-color-key={column.key} title={field?`${field.sourceCell} · ${field.sourceLabel}${field.value===null||field.value===''?'\n空白（源表未填写）':field.value==='/'?'\n原文斜杠，保持原样':''}`:'本行没有此来源栏目'}>{field?<OriginalValue value={field.value} compact/>:<span className="sales-source-empty-value">本行无此栏目</span>}</td>;})}
      <td className="sales-source-number" data-field-key="quantity">{numberText(line.quantity)}</td><td data-field-key="unit">{line.unit||<span className="sales-source-empty-value">单位未填写</span>}</td><td className="sales-source-number" data-field-key="sampleQuantity">{line.sampleQuantity===null?<span className="sales-source-empty-value">未填写</span>:numberText(line.sampleQuantity)}</td><td className="sales-source-number" data-field-key="unitPrice"><OriginalValue value={line.unitPrice} compact/></td><td className="sales-source-number" data-field-key="sourceAmount"><SourceAmount line={line}/></td><td><Button type="button" size="sm" variant="outline" aria-label={`查看原单第 ${line.sourceRow} 行来源`} onClick={()=>setDetailId(line.id)}>来源</Button></td>
     </tr>;})}{!lines.length&&<tr><td colSpan={basicColumns.length+colors.length+quantityColumns.length+1} className="sales-source-empty">没有匹配的明细，请调整搜索词。</td></tr>}</tbody>
    </table></div>
    <div className="sales-source-sheet-footer"><span>本单 {order.lines.length} 条 · 当前显示 {lines.length} 条 · {colors.length} 个颜色栏目</span><span>数量 {quantitySummary(order.lines,'quantity')} · 样办 {quantitySummary(order.lines,'sampleQuantity')}（单独保留）</span></div>
    <p className="sales-source-help sales-source-sheet-legend">横向滚动查看全部列；原表行、图纸编号及色号固定在左侧。— 表示源表空白，“/”保留原文；同名颜色按来源列和部位分别展示。</p>
    {detailLine&&<SourceDetailsDialog line={detailLine} order={order} labels={labels} onClose={()=>setDetailId('')}/>}
   </div>}
  </>}
 </section>;
}
