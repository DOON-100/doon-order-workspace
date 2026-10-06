'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Archive,ArrowLeft,ArrowRight,Check,ChevronDown,ClipboardCheck,CornerDownLeft,Flag,RefreshCw,Search,Settings2,X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {factoryName,inProductionScope,type ProductionScope} from '@/lib/manufacturing';
import {active,balance,colLabels,currentStage,ownerLabel,today,warehouse} from '@/lib/ledger';
import {broad,productTypeOf,type Order} from '@/lib/domain';
import {pmcColumns,pmcOrder,pmcValue,reviewLabels,reviewState,type PmcColumn,type PmcReview,type PmcRound} from '@/lib/pmc';
import {clientId} from '@/lib/client-id';
import {request} from './ui';
import type {Data} from './workspace';
import {AccessNotice} from './access-notice';

type Draft={id:string;col:PmcColumn;version:number;value:string;original:string;error?:string;saving?:boolean};
type ReviewData={rounds:PmcRound[];reviews:PmcReview[]};
const rowHeight=76;
const cellKey=(id:string,col:string)=>id+':'+col;
const defaultMovableColumns=['productType','owner','U','AB','color','lens','quantity','balance','requestedDate','AC','AD','AE','AF','stage','close'] as const;
type MovableColumn=typeof defaultMovableColumns[number];
const movableLabels:Record<MovableColumn,string>={productType:'产品类型',owner:'跟单员',U:'PMC排期',AB:'状态备注',color:'色号',lens:'镜片',quantity:'订单数',balance:'欠数',requestedDate:'客原交期',AC:'配件齐日期',AD:'板料齐期',AE:'配套齐料期',AF:'投产日',stage:'当前工序',close:'结单'};
const movableWidths:Record<MovableColumn,number>={productType:125,owner:95,U:130,AB:290,color:110,lens:95,quantity:90,balance:90,requestedDate:120,AC:130,AD:130,AE:130,AF:130,stage:160,close:110};
export function PmcPanel({data,openOrder,onDirtyChange,productionScope='internal'}:{productionScope?:ProductionScope;data:Data;openOrder:(o:Order)=>void;onDirtyChange:(dirty:boolean)=>void}){
 const external=productionScope==='external',editColumns:readonly PmcColumn[]=external?pmcColumns.filter(c=>c==='U'||c==='AB'):pmcColumns;
 const [factory,setFactory]=useState('');
 const cache=useQueryClient(),editable=broad(data.me),scroller=useRef<HTMLDivElement>(null),queue=useRef(Promise.resolve()),draftRef=useRef<Record<string,Draft>>({});
 const roundToken=useRef(''),[focusMode,setFocusMode]=useState(false);
 const [drafts,setDrafts]=useState<Record<string,Draft>>({}),[editing,setEditing]=useState(''),[q,setQ]=useState(''),[owner,setOwner]=useState(''),[filter,setFilter]=useState(''),[scrollTop,setScrollTop]=useState(0),[focusRow,setFocusRow]=useState(''),[selection,setSelection]=useState<string[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[newRound,setNewRound]=useState(false),[pending,setPending]=useState<Order|null>(null),[pendingNote,setPendingNote]=useState(''),[batch,setBatch]=useState<Order[]|null>(null),[batchCol,setBatchCol]=useState<PmcColumn>('U'),[batchValue,setBatchValue]=useState(''),[append,setAppend]=useState(true),[columnPanel,setColumnPanel]=useState(false),[columnOrder,setColumnOrder]=useState<MovableColumn[]>([...defaultMovableColumns]),[closing,setClosing]=useState<Order|null>(null),[closeDate,setCloseDate]=useState(today()),[closeReason,setCloseReason]=useState('PMC确认结单');
 const columnPrefsLoaded=useRef(false),columnPrefsKey=`doon-pmc-column-order:${data.me.id}:${productionScope}`;
 const reviews=useQuery<ReviewData>({queryKey:['pmc-progress',productionScope],enabled:editable,queryFn:()=>request('pmc-data?scope='+productionScope),refetchInterval:30000});
 const progress=reviews.data,round=progress?.rounds.find(r=>r.actorId===data.me.id);
 const reviewMap=useMemo(()=>new Map(progress?.reviews.filter(r=>r.roundId===round?.id).map(r=>[r.lineId,r])||[]),[progress,round?.id]);
 const allOrders=useMemo(()=>pmcOrder(data.orders).filter(o=>active(o)&&inProductionScope(o,productionScope)),[data.orders,productionScope]);
 const states=useMemo(()=>new Map(allOrders.map(o=>[o.id,reviewState(o,round,reviewMap.get(o.id))])),[allOrders,round,reviewMap]);
 const scopeRows=useMemo(()=>allOrders.filter(o=>(!factory||factoryName(o)===factory)&&(!owner||(owner==='mine'?o.ownerEmail===data.me.email:ownerLabel(o)===owner))&&(!q||[o.orderNo,o.customer,o.drawing,o.color,o.lens,productTypeOf(o),o.notes,ownerLabel(o),o.ledger?.sourceRow,factoryName(o)].join(' ').toLowerCase().includes(q.toLowerCase()))),[allOrders,owner,q,factory,data.me.email]);
 const rows=scopeRows.filter(o=>!filter||(filter==='todo'?['unreviewed','changed','pending'].includes(states.get(o.id)!):states.get(o.id)===filter));
 const start=Math.max(0,Math.floor(Math.max(0,scrollTop-44)/rowHeight)-5),end=Math.min(rows.length,start+28),visible=rows.slice(start,end),orderMap=new Map(data.orders.map(o=>[o.id,o]));
 const counts:Record<string,number>={done:0,pending:0,changed:0,unreviewed:0,closed:0,moved:0};for(const id of round?.lineIds||[]){const o=orderMap.get(id);counts[o?reviewState(o,round,reviewMap.get(id)):'closed']++;}
 const total=round?.lineIds.length||0,done=counts.done+counts.closed;
 const dirty=Object.keys(drafts).length>0;
 useEffect(()=>{if(!message)return;const timer=setTimeout(()=>setMessage(''),4500);return()=>clearTimeout(timer);},[message]);
 function updateDrafts(fn:(old:Record<string,Draft>)=>Record<string,Draft>){const next=fn(draftRef.current);draftRef.current=next;setDrafts(next);}
 useEffect(()=>{onDirtyChange(dirty);const warn=(e:BeforeUnloadEvent)=>{if(Object.keys(draftRef.current).length){e.preventDefault();e.returnValue='';}};addEventListener('beforeunload',warn);return()=>removeEventListener('beforeunload',warn);},[dirty,onDirtyChange]);
 useEffect(()=>()=>onDirtyChange(false),[onDirtyChange]);
 useEffect(()=>{if(scroller.current)scroller.current.scrollTop=0;setScrollTop(0);},[q,owner,filter,factory]);
 useEffect(()=>{try{const saved=JSON.parse(localStorage.getItem(columnPrefsKey)||'[]') as string[],valid=saved.filter((v):v is MovableColumn=>(defaultMovableColumns as readonly string[]).includes(v)),missing=defaultMovableColumns.filter(v=>!valid.includes(v));if(valid.length)setColumnOrder([...valid,...missing]);}catch{}columnPrefsLoaded.current=true;},[columnPrefsKey]);
 useEffect(()=>{if(columnPrefsLoaded.current)localStorage.setItem(columnPrefsKey,JSON.stringify(columnOrder));},[columnOrder,columnPrefsKey]);
 function resetFilters(){setFactory('');setQ('');setOwner('');setFilter('');}
 function moveColumn(key:MovableColumn,direction:-1|1){setColumnOrder(old=>{const at=old.indexOf(key),to=at+direction;if(at<0||to<0||to>=old.length)return old;const next=[...old];[next[at],next[to]]=[next[to],next[at]];return next;});}
 function jump(id:string,clear=false){
  if(clear)resetFilters();const target=clear?allOrders:rows,index=target.findIndex(o=>o.id===id);if(index<0){setMessage('该行不在当前筛选中，可清除筛选后继续。');return;}
  setFocusRow(id);requestAnimationFrame(()=>{scroller.current?.scrollTo({top:index*rowHeight,behavior:'instant'});setScrollTop(index*rowHeight);});
 }
 function nextUnreviewed(after?:string){const scope=round?.lineIds||[],at=after?scope.indexOf(after):-1,ordered=[...scope.slice(at+1),...scope.slice(0,at+1)],id=ordered.find(id=>['unreviewed','changed','pending'].includes(states.get(id)||''));if(id)jump(id,true);else setMessage('本轮已没有待核对、需复核或待处理明细。');}
 function begin(o:Order,col:PmcColumn){
  if(!editable||busy||!editColumns.includes(col)||(!o.ledger&&!['U','AB'].includes(col)))return;const key=cellKey(o.id,col);
  if(!draftRef.current[key])updateDrafts(old=>({...old,[key]:{id:o.id,col,version:o.version,value:pmcValue(o,col),original:pmcValue(o,col)}}));setEditing(key);setFocusRow(o.id);
 }
 async function refresh(){await Promise.all([cache.invalidateQueries({queryKey:['workspace']}),cache.invalidateQueries({queryKey:['pmc-progress']})]);}
 function save(key:string){
  const draft=draftRef.current[key];if(!draft||draft.saving)return Promise.resolve(true);
  if(draft.value===draft.original){updateDrafts(old=>{const next={...old};delete next[key];return next;});setEditing(v=>v===key?'':v);return Promise.resolve(true);}
  updateDrafts(old=>({...old,[key]:{...draft,saving:true,error:undefined}}));setEditing(v=>v===key?'':v);
  const operation=queue.current.then(async()=>{
   try{const result=await request('pmc-save',{changes:[{id:draft.id,version:draft.version,col:draft.col,value:draft.value}]});
    cache.setQueryData<Data>(['workspace'],old=>old?{...old,orders:old.orders.map(o=>result.orders.find((n:Order)=>n.id===o.id)||o)}:old);
    updateDrafts(old=>{const next={...old};delete next[key];return next;});setMessage('已保存到共享总表 · '+colLabels[draft.col]);await refresh();return true;
   }catch(e){await refresh().catch(()=>{});updateDrafts(old=>({...old,[key]:{...draft,error:(e as Error).message,saving:false}}));return false;}
  });queue.current=operation.then(()=>{});return operation;
 }
 async function prepareClose(o:Order){
  if(!editable||busy)return;setBusy(true);setError('');
  try{
   const keys=Object.keys(draftRef.current),results=await Promise.all(keys.map(save));await queue.current;
   if(results.some(ok=>!ok)||Object.keys(draftRef.current).length){setError('待填单元格尚未全部保存，系统已保留你的输入。请处理上方“单元格未保存”提示后再结单。');return;}
   await refresh();const latest=cache.getQueryData<Data>(['workspace'])?.orders.find(row=>row.id===o.id)||o;
   setClosing(latest);setCloseDate(today());setCloseReason('PMC确认结单');
  }catch(e){setError((e as Error).message);await refresh().catch(()=>{});}finally{setBusy(false);}
 }
 function moveCell(o:Order,col:PmcColumn,direction:'down'|'next'|'prev'){
  const index=rows.findIndex(r=>r.id===o.id),c=editColumns.indexOf(col);let nextRow=index,nextCol=c;
  if(direction==='down')nextRow++;else if(direction==='next'){nextCol++;if(nextCol>=editColumns.length){nextCol=0;nextRow++;}}else{nextCol--;if(nextCol<0){nextCol=editColumns.length-1;nextRow--;}}
  const next=rows[nextRow];if(next){if(nextRow<start+2||nextRow>end-3)jump(next.id);begin(next,editColumns[nextCol]);}
 }
 async function run(fn:()=>Promise<void>){setBusy(true);setError('');try{await fn();}catch(e){setError((e as Error).message);await refresh().catch(()=>{});}finally{setBusy(false);}}
 async function mark(o:Order,status:'done'|'pending',note=''){
  if(dirty){setError('请先保存或处理未保存单元格，再登记核对状态。');return;}if(!round)return;
  await run(async()=>{await request('pmc-review',{roundId:round.id,lineId:o.id,version:o.version,status,note});await reviews.refetch();setPending(null);setMessage(`原表第 ${o.ledger?.sourceRow||'—'} 行：${status==='done'?'已核对':'已登记待处理'}`);const next=round.lineIds.slice(round.lineIds.indexOf(o.id)+1).find(id=>['unreviewed','changed'].includes(states.get(id)||''));if(next)jump(next,true);});
 }
 function openBatch(ids:string[]){if(dirty){setError('请先处理未保存单元格，再批量修改。');return;}const selected=ids.map(id=>orderMap.get(id)).filter((o):o is Order=>!!o&&active(o));if(!selected.length||selected.length>100){setError('每批请选择 1 至 100 条明细。');return;}setBatch(selected);setBatchValue('');setBatchCol('U');setAppend(true);setError('');}
 function cell(o:Order,col:PmcColumn){const key=cellKey(o.id,col),draft=drafts[key],canEdit=editable&&editColumns.includes(col)&&(!!o.ledger||['U','AB'].includes(col)),value=draft?.value??pmcValue(o,col);
  return <td key={col} className={'pmc-edit-cell '+(draft?.error?'cell-error':draft?.saving?'cell-saving':'')}>
   {editing===key&&draft?<textarea autoFocus rows={col==='AB'?3:1} aria-label={`编辑 ${o.ledger?.sourceRow||o.id} ${colLabels[col]}`} placeholder={col==='AB'?'输入状态备注':'YYYY-MM-DD / -'} value={draft.value} maxLength={3000} onFocus={e=>e.target.select()} onChange={e=>updateDrafts(old=>({...old,[key]:{...old[key],value:e.target.value,error:undefined}}))} onBlur={()=>{void save(key);}} onKeyDown={e=>{if(e.nativeEvent.isComposing)return;if(e.key==='Escape'){e.preventDefault();updateDrafts(old=>{const next={...old};delete next[key];return next;});setEditing('');}else if(e.key==='Tab'||(e.key==='Enter'&&!e.shiftKey)){e.preventDefault();const direction=e.key==='Enter'?'down':e.shiftKey?'prev':'next';void save(key).then(ok=>{if(ok)moveCell(o,col,direction);});}}}/>:<button type="button" className="pmc-cell-button" disabled={!canEdit||busy||draft?.saving} aria-label={`原表${o.ledger?.sourceRow||'新增'}行 ${colLabels[col]}：${value||'空白'}`} title={value||'点击填写'} onClick={()=>begin(o,col)}><span className={!value?'pmc-placeholder':''}>{value|| (canEdit?'点击填写':'—')}</span>{draft?.saving&&<small>保存中…</small>}{draft?.error&&<small>未保存 · 请核对</small>}</button>}
  </td>;
 }
 function movableHeader(key:MovableColumn){
  if((pmcColumns as readonly string[]).includes(key))return <th className="pmc-owned" key={key}><small>{key}</small>{colLabels[key]}</th>;
  return <th key={key}>{movableLabels[key]}</th>;
 }
 function movableCell(o:Order,key:MovableColumn){
  if((pmcColumns as readonly string[]).includes(key))return cell(o,key as PmcColumn);
  if(key==='productType')return <td key={key}><b>{productTypeOf(o)||'未填写'}</b></td>;
  if(key==='owner')return <td key={key}>{ownerLabel(o)}</td>;
  if(key==='color')return <td key={key} title={o.color}>{o.color||'—'}</td>;
  if(key==='lens')return <td key={key}>{o.lens||'—'}</td>;
  if(key==='quantity')return <td key={key} className="pmc-number">{o.quantity}</td>;
  if(key==='balance')return <td key={key} className="pmc-number pmc-amber">{balance(o,data.reports)??'待核'}</td>;
  if(key==='requestedDate')return <td key={key}>{o.requestedDate||'—'}</td>;
  if(key==='close')return <td key={key} className="pmc-close-cell"><Button size="sm" variant="outline" disabled={!editable||busy} title={dirty?'将先自动保存待填单元格，再办理结单':'办理结单'} onClick={()=>void prepareClose(o)}><Archive size={14}/>{dirty?'保存后结单':'办理结单'}</Button></td>;
  return <td key={key}><span className="pmc-stage">{currentStage(o)}</span><small>入仓 {warehouse(o)??'待核'}</small></td>;
 }
 return <div className={"pmc-workbench"+(focusMode?" pmc-focus":"")}>
  <section className="pmc-intro"><span className="pmc-intro-icon"><ClipboardCheck size={26}/></span><div><h2>顺着原表，一行一行核对。</h2><p>{external?'按生产厂归集整单外发 · 保留原表行序 · 排期、备注直接填写':'度昂厂内排期 · 固定原行序 · 单元格直接填写 · Enter 向下，Tab 向右'}</p></div><span className="pmc-live"><i/>共享总表 · 30 秒刷新</span></section>
  {!editable&&<AccessNotice me={data.me} detail="此页可查看授权订单。排期、状态备注与核对进度由 PMC / 管理员维护。"/>}
  {editable&&<section className="pmc-review-card"><div className="pmc-review-heading"><div><strong>{round?'我的核对进度':'开始第一轮核对'}</strong><p>{round?`${new Date(round.createdAt).toLocaleString('zh-CN')} · ${round.scope}`:'先选跟单员或搜索范围，再开始本轮。每个人的核对进度独立保存，可换电脑接着做。'}</p></div><div className="pmc-buttons"><Button variant="outline" disabled={busy||dirty||!scopeRows.length||reviews.isLoading||reviews.isError} onClick={()=>{roundToken.current=clientId();setNewRound(true);}}>{round?'开始新一轮':'开始核对'}</Button>{round&&<><Button variant="outline" disabled={busy||dirty} onClick={()=>round.lastLineId?jump(round.lastLineId,true):nextUnreviewed()}>回到上次位置</Button><Button disabled={busy||dirty} onClick={()=>nextUnreviewed(round.lastLineId)}>下一条待核对 <ChevronDown size={14}/></Button></>}</div></div>
   {round&&<><div className="pmc-progress-bar" aria-label={`本轮完成 ${done} / ${total}`}><span style={{width:`${total?done/total*100:0}%`}}/></div><div className="pmc-counts"><span>本轮 <b>{total}</b> 条</span><button onClick={()=>setFilter('done')}>已核对 <b>{counts.done}</b></button><button onClick={()=>setFilter('unreviewed')}>待核对 <b>{counts.unreviewed}</b></button><button className="pmc-amber" onClick={()=>setFilter('changed')}>需复核 <b>{counts.changed}</b></button><button className="pmc-red" onClick={()=>setFilter('pending')}>待处理 <b>{counts.pending}</b></button><span>退出在制 <b>{counts.closed}</b></span><span>已转其他总表 <b>{counts.moved}</b></span></div><p className="pmc-caption">核对后有新修改会转为“需复核”；新订单标为“未纳入本轮”，下一轮再纳入。筛选只改变显示，不改变本轮总数。</p></>}
   {progress&&progress.rounds.some(r=>r.actorId!==data.me.id)&&<div className="pmc-peer-progress">{progress.rounds.filter(r=>r.actorId!==data.me.id).map(r=>{const done=progress.reviews.filter(v=>v.roundId===r.id&&v.status==='done'&&orderMap.get(v.lineId)?.version===v.orderVersion).length;return <span key={r.id}>{r.actor}：已核对 {done} / {r.lineIds.length} 条 <small>本人的当前轮次</small></span>;})}</div>}
   {reviews.isError&&<p className="error" role="alert">核对进度加载失败：{(reviews.error as Error).message} <button onClick={()=>reviews.refetch()}>重试</button></p>}
  </section>}
  {(message||error)&&<div role={error?'alert':'status'} className={error?'error notice':'success notice'}><span>{error||message}</span><button aria-label="关闭PMC提示" onClick={()=>{setError('');setMessage('');}}><X size={16}/></button></div>}
  {Object.entries(drafts).filter(([,d])=>d.error).map(([key,d])=><section className="pmc-conflict" role="alert" key={key}><b>单元格未保存 · {orderMap.get(d.id)?.orderNo} · {colLabels[d.col]}</b><p>{d.error}</p><div>我的输入：<strong>{d.value||'（空白）'}</strong>　最新值：<strong>{pmcValue(orderMap.get(d.id)!,d.col)||'（空白）'}</strong></div><div className="pmc-buttons"><Button size="sm" variant="outline" onClick={()=>{jump(d.id,true);setEditing(key);}}>继续编辑</Button><Button size="sm" variant="outline" onClick={()=>{updateDrafts(old=>{const next={...old};delete next[key];return next;});}}>采用最新值</Button><Button size="sm" onClick={()=>{const current=orderMap.get(d.id)!;updateDrafts(old=>({...old,[key]:{...d,version:current.version,original:pmcValue(current,d.col),error:undefined}}));void save(key);}}>已核对，保存我的输入</Button></div></section>)}
  <section className="panel pmc-sheet-panel"><div className="pmc-toolbar"><label className="pmc-search"><Search size={16}/><input aria-label="搜索PMC总表" placeholder="订单、款号、备注、原行号" value={q} onChange={e=>setQ(e.target.value)}/></label>{external&&<select aria-label="成品生产厂" value={factory} onChange={e=>setFactory(e.target.value)}><option value="">全部成品厂</option>{[...new Set(allOrders.map(factoryName))].sort().map(v=><option key={v}>{v}</option>)}</select>}<select aria-label="PMC跟单员" value={owner} onChange={e=>setOwner(e.target.value)}><option value="">全部跟单员</option><option value="mine">我负责的订单</option>{[...new Set(allOrders.map(ownerLabel))].map(v=><option key={v}>{v}</option>)}</select><select aria-label="PMC核对状态" value={filter} onChange={e=>setFilter(e.target.value)}><option value="">全部核对状态</option>{['todo','unreviewed','changed','pending','done','outside'].map(v=><option key={v} value={v}>{v==='todo'?'全部待跟进':reviewLabels[v]}</option>)}</select><button className="text-link" onClick={resetFilters}>清除筛选</button><span className="pmc-toolbar-spacer"/><Button size="sm" variant="outline" onClick={()=>setColumnPanel(v=>!v)}><Settings2 size={14}/>字段顺序</Button><Button size="sm" variant="outline" asChild><a href={'/api/workspace/ledger-export?'+new URLSearchParams({mode:'active',production:productionScope,factory,q,owner,reviewStatus:filter})}>导出当前总表</a></Button><Button size="sm" variant="outline" onClick={()=>setFocusMode(v=>!v)}>{focusMode?"展开说明":"专注表格"}</Button><Button size="sm" variant="outline" onClick={()=>void refresh()}><RefreshCw size={14}/>刷新</Button></div>
   {columnPanel&&<div className="pmc-column-panel"><div><b>我的字段顺序</b><span>点击箭头移动，自动保存在当前账号的浏览器中。</span></div><div className="pmc-column-list">{columnOrder.map((key,index)=><span key={key}><i>{index+1}</i><b>{movableLabels[key]}</b><button aria-label={`${movableLabels[key]}向左移动`} disabled={index===0} onClick={()=>moveColumn(key,-1)}><ArrowLeft size={14}/></button><button aria-label={`${movableLabels[key]}向右移动`} disabled={index===columnOrder.length-1} onClick={()=>moveColumn(key,1)}><ArrowRight size={14}/></button></span>)}</div><div className="pmc-column-actions"><Button size="sm" variant="outline" onClick={()=>setColumnOrder([...defaultMovableColumns])}>恢复默认</Button><Button size="sm" onClick={()=>setColumnPanel(false)}>完成</Button></div></div>}
   <div className="pmc-sheet-status"><span><b>{rows.length}</b> 条明细 · 按原 Excel 行序连续显示{dirty&&<em> · {Object.keys(drafts).length} 个单元格待保存 / 保存中</em>}</span><div>{editable&&<><span>已选 {selection.length} 条</span>{dirty&&<Button size="sm" variant="outline" disabled={busy||Object.values(drafts).every(d=>d.saving)} onClick={()=>{for(const [key,d] of Object.entries(draftRef.current))if(!d.saving&&!d.error)void save(key);}}>保存待填单元格</Button>}<Button size="sm" variant="outline" disabled={!selection.length||busy||dirty} onClick={()=>openBatch(selection)}>批量排期 / 备注</Button>{selection.length>0&&<button className="text-link" onClick={()=>setSelection([])}>取消选择</button>}</>}</div></div>
   <div className="pmc-scroll" ref={scroller} onScroll={e=>setScrollTop(e.currentTarget.scrollTop)} tabIndex={0} aria-label="PMC排期连续总表">
    <table className="pmc-sheet" style={{width:539+columnOrder.reduce((n,key)=>n+movableWidths[key],0)}}><colgroup><col style={{width:76}}/><col style={{width:278}}/>{columnOrder.map(key=><col key={key} style={{width:movableWidths[key]}}/>)}<col style={{width:185}}/></colgroup><thead><tr><th className="pmc-freeze-one">原行号</th><th className="pmc-freeze-two">订单 / 图纸编号</th>{columnOrder.map(movableHeader)}<th>本轮核对</th></tr></thead><tbody>
     {start>0&&<tr aria-hidden="true"><td colSpan={18} style={{height:start*rowHeight,padding:0,border:0}}/></tr>}
     {visible.map(o=>{const state=states.get(o.id)!,r=reviewMap.get(o.id),index=allOrders.findIndex(n=>n.id===o.id),first=index===0||allOrders[index-1].orderNo!==o.orderNo;return <tr key={o.id} data-line-id={o.id} className={`${focusRow===o.id?'pmc-current ':''}${first?'pmc-order-start ':''}pmc-state-${state}`} style={{height:rowHeight}}>
      <td className="pmc-freeze-one"><label>{editable&&<input type="checkbox" aria-label={`选择原表${o.ledger?.sourceRow||o.id}行`} checked={selection.includes(o.id)} onChange={e=>{if(e.target.checked&&selection.length>=100){setError('每批最多选择100条。');return;}setSelection(old=>e.target.checked?[...old,o.id]:old.filter(id=>id!==o.id));}}/>}<b title={o.ledger?`${o.ledger.filename} / ${o.ledger.sheet} / 第${o.ledger.sourceRow}行`:'新录入订单'}>{o.ledger?.sourceRow||'新'}</b></label></td>
      <td className="pmc-freeze-two"><button className="pmc-order-link" onClick={()=>{if(!dirty)openOrder(o);else setError('请先处理未保存单元格，再打开详情。');}}>{o.orderNo}</button><div className="pmc-order-detail">{external?factoryName(o)+' · ':''}{o.customer} · {o.drawing} · {o.color} · {o.lens}</div>{editable&&<button className="pmc-select-order" title="仅选择此订单在当前筛选中的明细" onClick={()=>{const ids=rows.filter(r=>r.orderNo===o.orderNo).map(r=>r.id);if(ids.length>100)setError('此订单超过100条，请按款号筛选后分批选择。');else setSelection(ids);}}>选此订单</button>}</td>
      {columnOrder.map(key=>movableCell(o,key))}
      <td className="pmc-review-cell"><span className={'pmc-review-tag '+state} title={r?`${r.actor} · ${new Date(r.updatedAt).toLocaleString('zh-CN')} · ${r.note}`:''}>{reviewLabels[state]}</span>{editable&&round&&round.lineIds.includes(o.id)&&<div><button disabled={busy||dirty} aria-label={`核对原表${o.ledger?.sourceRow||o.id}行`} onClick={()=>void mark(o,'done')}><Check size={13}/>核对</button><button disabled={busy||dirty} aria-label={`待处理原表${o.ledger?.sourceRow||o.id}行`} onClick={()=>{setPending(o);setPendingNote(r?.note||'');}}><Flag size={12}/>待处理</button></div>}{r?.note&&<small title={r.note}>{r.note}</small>}</td>
     </tr>;})}
     {end<rows.length&&<tr aria-hidden="true"><td colSpan={18} style={{height:(rows.length-end)*rowHeight,padding:0,border:0}}/></tr>}
     {!rows.length&&<tr><td colSpan={18} className="pmc-no-rows">没有符合当前筛选的明细。清除筛选后可继续核对。</td></tr>}
    </tbody></table>
   </div><div className="pmc-sheet-footer"><span>浅黄色为 PMC 可编辑字段 · 横向滚动查看齐料、投产和核对状态</span><span><CornerDownLeft size={12}/> Enter 下一行 · Shift+Enter 备注换行 · Esc 取消本格</span></div>
  </section>
  {newRound&&<div className="pmc-modal-backdrop"><section role="dialog" aria-modal="true" aria-label="开始PMC核对轮次" className="pmc-modal"><h2>{round?'开始新一轮核对':'开始本轮核对'}</h2><p>将当前跟单员 / 搜索范围内的 <b>{scopeRows.length}</b> 条在制明细纳入本轮，保持原行序。核对状态筛选不缩小本轮范围。</p><p>范围：{owner||'全部跟单员'}{q?' · 搜索「'+q+'」':''}。{round?'上一轮进度保留在服务器历史中，本页切换到新一轮。':'每行需实际核对后手动标记。'}</p><div className="pmc-buttons"><Button variant="outline" disabled={busy} onClick={()=>setNewRound(false)}>取消</Button><Button disabled={busy||dirty||!scopeRows.length} onClick={()=>void run(async()=>{await request('pmc-round',{token:roundToken.current,productionScope,lineIds:scopeRows.map(o=>o.id),scope:(factory?factory+' · ':'')+(owner||'全部跟单员')+(q?' · '+q:'')});await reviews.refetch();setNewRound(false);setFilter('');setMessage('本轮已开始，核对进度会自动保存。');})}>确认开始 {scopeRows.length} 条</Button></div>{error&&<p role="alert" className="error">{error}</p>}</section></div>}
  {pending&&<div className="pmc-modal-backdrop"><section role="dialog" aria-modal="true" aria-label="记录待处理原因" className="pmc-modal"><h2>记录待处理事项</h2><p>{pending.orderNo} / {pending.drawing} / {pending.color} · 原表第 {pending.ledger?.sourceRow} 行</p><textarea aria-label="待处理原因" rows={4} maxLength={1000} value={pendingNote} onChange={e=>setPendingNote(e.target.value)} placeholder="例如：等电镀仓确认回货数量后复核"/><div className="pmc-buttons"><Button variant="outline" disabled={busy} onClick={()=>setPending(null)}>取消</Button><Button disabled={busy||!pendingNote.trim()} onClick={()=>void mark(pending,'pending',pendingNote)}>保存待处理</Button></div>{error&&<p role="alert" className="error">{error}</p>}</section></div>}
  {closing&&<div className="pmc-modal-backdrop"><section role="dialog" aria-modal="true" aria-label="办理订单结单" className="pmc-modal"><h2>确认结单并归档</h2><p>{closing.orderNo} / {closing.drawing} / {closing.color} · 原表第 {closing.ledger?.sourceRow||'—'} 行</p><div className="pmc-close-summary"><span>订单数量<b>{closing.quantity}</b></span><span>包装入仓<b>{warehouse(closing)??'待核'}</b></span><span>当前欠数<b>{balance(closing,data.reports)??'待核'}</b></span></div>{(balance(closing,data.reports)??closing.quantity)>0&&<p className="pmc-close-warning">此明细仍有欠数。确认后系统仍会保留欠数、结单日期和结单依据，便于后续追溯。</p>}<label className="pmc-close-field"><span>结单日期</span><input type="date" aria-label="PMC结单日期" value={closeDate} onChange={e=>setCloseDate(e.target.value)}/></label><label className="pmc-close-field"><span>结单依据</span><textarea aria-label="PMC结单依据" rows={3} maxLength={1000} value={closeReason} onChange={e=>setCloseReason(e.target.value)} placeholder="例如：已全部入仓，PMC确认结单"/></label><div className="pmc-buttons"><Button variant="outline" disabled={busy} onClick={()=>setClosing(null)}>取消结单</Button><Button disabled={busy||dirty||!closeDate||closeReason.trim().length<3} onClick={()=>void run(async()=>{const closed=closing;await request('ledger-lifecycle',{id:closed.id,version:closed.version,mode:'archived',reason:closeReason.trim(),closedDate:closeDate});await refresh();setClosing(null);setSelection(old=>old.filter(id=>id!==closed.id));setMessage(`${closed.orderNo} 已结单并移入已完成订单档案。`);})}><Archive size={14}/>确认结单</Button></div>{error&&<p role="alert" className="error">{error}</p>}</section></div>}
  {batch&&<div className="pmc-modal-backdrop"><section role="dialog" aria-modal="true" aria-label="批量排期与备注" className="pmc-modal pmc-batch-modal"><h2>批量修改 · {batch.length} 条明细</h2><p>仅修改下列明确选中的行；同订单的其他颜色、款号不会自动带入。</p><div className="pmc-batch-fields"><label>修改字段<select aria-label="批量修改字段" value={batchCol} onChange={e=>setBatchCol(e.target.value as PmcColumn)}>{editColumns.map(c=><option key={c} value={c}>{c} · {colLabels[c]}</option>)}</select></label><label>填写内容<textarea rows={2} maxLength={3000} aria-label="批量修改内容" value={batchValue} onChange={e=>setBatchValue(e.target.value)} placeholder={batchCol==='AB'?'输入状态备注':'YYYY-MM-DD；空白表示清空；- 表示不适用'}/></label>{batchCol==='AB'&&<label><input type="checkbox" checked={append} onChange={e=>setAppend(e.target.checked)}/>追加到各行原备注末尾（取消则替换）</label>}</div><div className="pmc-batch-preview"><table><thead><tr><th>原行</th><th>订单 / 款号 / 色号 / 镜片</th><th>当前值 → 修改后</th></tr></thead><tbody>{batch.map(o=><tr key={o.id}><td>{o.ledger?.sourceRow||'新'}</td><td>{o.orderNo} / {o.drawing} / {o.color} / {o.lens}</td><td>{pmcValue(o,batchCol)||'空白'} → <b>{batchCol==='AB'&&append?[o.notes,batchValue].filter(Boolean).join('\n'):batchValue||'空白'}</b></td></tr>)}</tbody></table></div><div className="pmc-buttons"><Button disabled={busy} variant="outline" onClick={()=>setBatch(null)}>取消</Button><Button disabled={busy||dirty||(batchCol==='AB'&&append&&!batchValue.trim())} onClick={()=>void run(async()=>{await request('pmc-save',{changes:batch.map(o=>({id:o.id,version:o.version,col:batchCol,value:batchCol==='AB'&&append?[o.notes,batchValue].filter(Boolean).join('\n'):batchValue}))});await refresh();setBatch(null);setSelection([]);setMessage(`已保存 ${batch.length} 条明细的${colLabels[batchCol]}。`);})}>确认保存 {batch.length} 条</Button></div>{error&&<p role="alert" className="error">{error} 请取消后重新选择以核对最新内容。</p>}</section></div>}
 </div>;
}


