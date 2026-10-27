'use client';
import {useEffect,useId,useRef,useState,type KeyboardEvent} from 'react';
import {createPortal} from 'react-dom';
import {businessTeamFetch} from './business-team-client';

export type IeMaterialNameItem={catalogId:string;id:string;version:number;name:string;code:string;nameEn:string;sourceSheet:string;sourceRow:number};
export type IeMaterialNameReference={catalogId:string;catalogVersion:number;entryId:string};
/** Browsing/searching never changes the quotation. Only a deliberate choice confirms a name. */
export function IeMaterialPicker({value,label,disabled,onChange,onSelect,reference}:{value:string;label:string;disabled:boolean;onChange:(value:string)=>void;onSelect:(item:IeMaterialNameItem)=>void;reference?:IeMaterialNameReference|null}){
 const listId=useId(),anchor=useRef<HTMLDivElement>(null),input=useRef<HTMLInputElement>(null),search=useRef<HTMLInputElement>(null),popup=useRef<HTMLDivElement>(null);
 const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[items,setItems]=useState<IeMaterialNameItem[]>([]),[active,setActive]=useState(-1),[loading,setLoading]=useState(false),[error,setError]=useState(''),[total,setTotal]=useState(0),[position,setPosition]=useState({top:0,left:0,width:360,maxHeight:300});
 useEffect(()=>{if(disabled)setOpen(false);},[disabled]);
 useEffect(()=>{
  if(!open||disabled)return;
  const controller=new AbortController();setLoading(true);setError('');setItems([]);setActive(-1);
  const timer=setTimeout(()=>{
   businessTeamFetch('/api/workspace/ie-material-names?q='+encodeURIComponent(query),{cache:'no-store',signal:controller.signal})
    .then(async response=>{if(!response.ok)throw new Error('名称资料暂未读到，仍可直接手填。');return response.json() as Promise<{items:IeMaterialNameItem[];total:number}>;})
    .then(result=>{if(controller.signal.aborted)return;const next=Array.isArray(result.items)?result.items:[];setItems(next);setTotal(Number(result.total)||0);setActive(next.length?0:-1);setLoading(false);})
    .catch(cause=>{if(controller.signal.aborted)return;setError((cause as Error).message||'名称查询未完成，仍可直接手填。');setLoading(false);});
  },query?180:0);
  return()=>{clearTimeout(timer);controller.abort();};
 },[open,disabled,query]);
 useEffect(()=>{
  if(!open)return;
  const positionList=()=>{const rect=anchor.current?.getBoundingClientRect();if(!rect)return;const width=Math.min(Math.max(rect.width,360),window.innerWidth-24),availableBelow=window.innerHeight-rect.bottom-12,above=availableBelow<200&&rect.top>250,maxHeight=Math.min(420,above?rect.top-16:availableBelow);setPosition({left:Math.max(12,Math.min(rect.left,window.innerWidth-width-12)),top:above?Math.max(12,rect.top-maxHeight-5):rect.bottom+5,width,maxHeight:Math.max(140,maxHeight)});};
  positionList();search.current?.focus();
  const closeOutside=(event:PointerEvent)=>{if(!anchor.current?.contains(event.target as Node)&&!popup.current?.contains(event.target as Node))setOpen(false);};
  window.addEventListener('resize',positionList);window.addEventListener('scroll',positionList,true);document.addEventListener('pointerdown',closeOutside);
  return()=>{window.removeEventListener('resize',positionList);window.removeEventListener('scroll',positionList,true);document.removeEventListener('pointerdown',closeOutside);};
 },[open]);
 useEffect(()=>{if(open&&active>=0)document.getElementById(listId+'-'+active)?.scrollIntoView({block:'nearest'});},[open,active,listId]);
 const close=()=>{setOpen(false);input.current?.focus();};
 const browse=()=>{if(disabled)return;setQuery('');setItems([]);setActive(-1);setLoading(true);setOpen(true);};
 const choose=(item:IeMaterialNameItem)=>{if(disabled)return;onSelect(item);close();};
 const candidateKeys=(event:KeyboardEvent<HTMLInputElement>)=>{
  if(event.nativeEvent.isComposing||event.keyCode===229)return;
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){
   event.preventDefault();event.stopPropagation();
   if(!open){browse();return;}
   if(!items.length)return;
   setActive(current=>event.key==='ArrowDown'?Math.min(items.length-1,current+1):Math.max(0,current-1));
  }else if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();close();}
  else if(event.key==='Enter'&&open){event.preventDefault();event.stopPropagation();if(!loading&&active>=0&&items[active])choose(items[active]);}
 };
 return <div className="ieq-material-picker" ref={anchor}>
  <div className="ieq-material-input">
   <input ref={input} aria-label={label} role="combobox" aria-autocomplete="none" aria-haspopup="listbox" aria-controls={open?listId:undefined} aria-expanded={open} autoComplete="off" disabled={disabled} value={value} placeholder="手填名称，或点右侧下拉选用" onChange={event=>onChange(event.target.value)} onKeyDown={candidateKeys}/>
   <button type="button" aria-label={label+'查询下拉清单'} aria-expanded={open} aria-controls={open?listId:undefined} disabled={disabled} onClick={()=>{if(open)close();else browse();}}>⌄</button>
  </div>
  {reference&&<small className="ieq-material-confirmed">已选颜色资料名称 · v{reference.catalogVersion}</small>}
  {open&&!disabled&&createPortal(<div className="ieq-material-options" data-ieq-grid-popover="material-names" ref={popup} style={position} onKeyDown={event=>event.stopPropagation()} onBlur={event=>{const target=event.relatedTarget as Node|null;if(target&&!popup.current?.contains(target)&&!anchor.current?.contains(target))setOpen(false);}}>
   <div className="ieq-material-options-heading" style={{position:'sticky',top:0,zIndex:1}}>
    选择材料名称<small>下拉展示全部资料；输入中文、英文或编码查询。选用只修改名称。</small>
    <div style={{display:'flex',gap:6,marginTop:8}}>
     <input ref={search} type="search" role="combobox" aria-label={label+'查询中文英文或编码'} aria-autocomplete="list" aria-expanded="true" aria-controls={listId} aria-activedescendant={active>=0?listId+'-'+active:undefined} autoComplete="off" maxLength={100} placeholder="查询中文 / 英文 / 编码" value={query} onChange={event=>setQuery(event.target.value)} onKeyDown={candidateKeys} style={{width:'100%',minWidth:0,border:'1px solid #a8c1ab',borderRadius:4,padding:'7px 8px',background:'#fff',color:'#274b35',fontSize:13}}/>
     {query&&<button type="button" onClick={()=>{setQuery('');search.current?.focus();}} style={{flexShrink:0,padding:'4px 7px',border:'1px solid #a8c1ab',borderRadius:4,background:'#fff'}}>全部</button>}
    </div>
    <small aria-live="polite">{loading?'正在查询…':error?'查询未完成':query?`匹配 ${total} 项`:`全部 ${total} 项`} · ↑↓选择，Enter确认，Esc关闭</small>
   </div>
   {loading?<p role="status">正在查询…</p>:error?<p role="alert">{error}</p>:<>
    <div id={listId} role="listbox" aria-label="材料名称候选">
     {items.map((item,index)=><button type="button" tabIndex={-1} id={listId+'-'+index} role="option" aria-selected={index===active} className={index===active?'active':''} key={item.id+':'+item.version} onMouseEnter={()=>setActive(index)} onMouseDown={event=>event.preventDefault()} onClick={()=>choose(item)}><span><b>{item.name}</b><small>{[item.code,item.nameEn].filter(Boolean).join(' · ')}</small><small>{item.sourceSheet} · 第 {item.sourceRow} 行</small></span><em>选用</em></button>)}
    </div>
    {!items.length&&<p>{query?'没有匹配名称，可清空查询查看全部，或关闭后直接手填。':'尚无名称资料，可关闭后直接手填材料名称。'}</p>}
    {total>items.length&&<p>共 {total} 项，当前显示 {items.length} 项；输入文字查询其他名称。</p>}
   </>}
   <button type="button" className="ieq-material-close" onClick={close}>保留手填名称并关闭</button>
  </div>,document.body)}
 </div>;
}
