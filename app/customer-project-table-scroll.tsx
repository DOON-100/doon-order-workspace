'use client';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import './customer-project-table-scroll.css';

type ColumnLayout={key:string;headers:string[];defaults:number[];widths:number[]};
const clampWidth=(width:number)=>Math.max(80,Math.min(1200,Math.round(width)));
const sameHeaders=(a:string[],b:string[])=>a.length===b.length&&a.every((value,index)=>value===b[index]);

function bindColumnWidths(table:HTMLTableElement,storageKey:string,label:string,cache:{current:ColumnLayout|null},onResize:()=>void,defaultWidths?:number[]){
 const cells=Array.from(table.tHead?.rows[0]?.cells||[]);if(!cells.length||cells.some(cell=>cell.colSpan!==1))return ()=>{};
 const headers=cells.map(cell=>{const copy=cell.cloneNode(true) as HTMLElement;copy.querySelectorAll('[data-excel-ui]').forEach(node=>node.remove());return copy.textContent?.trim()||'';});
 const key=storageKey?'doon:customer-project-table-columns:v1:'+storageKey:'',originalWidth=table.style.width,originalLayout=table.style.tableLayout;
 let layout=cache.current;
 if(!layout||layout.key!==key||!sameHeaders(layout.headers,headers)){
  const defaults=cells.map((cell,index)=>clampWidth(typeof defaultWidths?.[index]==='number'&&Number.isFinite(defaultWidths[index])?defaultWidths[index]:cell.getBoundingClientRect().width));
  layout={key,headers,defaults,widths:[...defaults]};
  if(key)try{const stored=JSON.parse(localStorage.getItem(key)||'null');if(stored?.version===1&&Array.isArray(stored.headers)&&sameHeaders(stored.headers,headers)&&Array.isArray(stored.widths)&&stored.widths.length===headers.length&&stored.widths.every((width:unknown)=>typeof width==='number'&&Number.isFinite(width)))layout.widths=stored.widths.map(clampWidth);}catch{/* Column preferences are optional when browser storage is unavailable. */}
  cache.current=layout;
 }
 // New suggested baselines affect explicit reset only; saved/current user widths win.
 else if(defaultWidths)layout.defaults=layout.defaults.map((width,index)=>typeof defaultWidths[index]==='number'&&Number.isFinite(defaultWidths[index])?clampWidth(defaultWidths[index]):width);
 const current=layout,colgroup=document.createElement('colgroup');colgroup.setAttribute('data-excel-ui','');
 const columns=cells.map(()=>{const col=document.createElement('col');colgroup.appendChild(col);return col;});table.insertBefore(colgroup,table.firstChild);
 const handles=cells.map((cell,index)=>{const handle=document.createElement('span');handle.className='cp-project-column-resize';handle.setAttribute('data-excel-ui','');handle.setAttribute('role','separator');handle.setAttribute('aria-label',`调整${label}${headers[index]}列宽`);handle.setAttribute('aria-orientation','vertical');handle.setAttribute('aria-valuemin','80');handle.setAttribute('aria-valuemax','1200');handle.tabIndex=0;handle.title='拖动调整列宽，双击恢复默认';cell.appendChild(handle);return handle;});
 const apply=()=>{table.style.tableLayout='fixed';table.style.width=current.widths.reduce((sum,width)=>sum+width,0)+'px';current.widths.forEach((width,index)=>{columns[index].style.width=width+'px';handles[index].setAttribute('aria-valuenow',String(width));});onResize();};
 const save=()=>{if(key)try{localStorage.setItem(key,JSON.stringify({version:1,headers,widths:current.widths}));}catch{/* Keep working with in-memory widths. */}};
 const stops=handles.map((handle,index)=>{
  let drag:{id:number;x:number;width:number}|null=null;
  const change=(width:number)=>{current.widths[index]=clampWidth(width);apply();};
  const stop=(event:Event)=>event.stopPropagation();
  const down=(event:PointerEvent)=>{if(event.button!==0)return;event.preventDefault();event.stopPropagation();drag={id:event.pointerId,x:event.clientX,width:current.widths[index]};handle.setPointerCapture(event.pointerId);};
  const move=(event:PointerEvent)=>{if(drag?.id===event.pointerId){event.preventDefault();event.stopPropagation();change(drag.width+event.clientX-drag.x);}};
  const end=(event:PointerEvent)=>{if(drag?.id!==event.pointerId)return;drag=null;save();if(handle.hasPointerCapture(event.pointerId))handle.releasePointerCapture(event.pointerId);};
  const lost=()=>{if(drag){drag=null;save();}};
  const reset=(event:MouseEvent)=>{event.preventDefault();event.stopPropagation();change(current.defaults[index]);save();};
  const keydown=(event:KeyboardEvent)=>{if(!['ArrowLeft','ArrowRight','Home'].includes(event.key))return;event.preventDefault();event.stopPropagation();change(event.key==='Home'?current.defaults[index]:current.widths[index]+(event.key==='ArrowRight'?10:-10));save();};
  handle.addEventListener('click',stop);handle.addEventListener('dblclick',reset);handle.addEventListener('pointerdown',down);handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end);handle.addEventListener('lostpointercapture',lost);handle.addEventListener('keydown',keydown);
  return ()=>{lost();handle.remove();};
 });
 apply();return ()=>{stops.forEach(stop=>stop());colgroup.remove();table.style.width=originalWidth;table.style.tableLayout=originalLayout;};
}

/** A second native scrollbar keeps wide project columns reachable above long lists. */
export function CustomerProjectTableScroll({children,storageKey='',label='项目清单',defaultWidths}:{children:ReactNode;storageKey?:string;label?:string;defaultWidths?:number[]}){
 const root=useRef<HTMLDivElement>(null),rail=useRef<HTMLDivElement>(null),spacer=useRef<HTMLDivElement>(null),viewport=useRef<HTMLElement|null>(null);
 const columnLayout=useRef<ColumnLayout|null>(null);
 const [position,setPosition]=useState({overflow:false,left:false,right:false});
 useEffect(()=>{
  const tableViewport=root.current?.querySelector<HTMLElement>(':scope > .cp-table-scroll'),track=rail.current,fill=spacer.current;
  if(!tableViewport||!track||!fill)return;
  viewport.current=tableViewport;
  const updatePosition=()=>{
   const maximum=Math.max(0,tableViewport.scrollWidth-tableViewport.clientWidth),offset=tableViewport.scrollLeft;
   const next={overflow:maximum>1,left:offset>1,right:offset<maximum-1};
   setPosition(before=>before.overflow===next.overflow&&before.left===next.left&&before.right===next.right?before:next);
  };
  const fromTable=()=>{if(Math.abs(track.scrollLeft-tableViewport.scrollLeft)>.5)track.scrollLeft=tableViewport.scrollLeft;updatePosition();};
  const fromTrack=()=>{if(Math.abs(tableViewport.scrollLeft-track.scrollLeft)>.5)tableViewport.scrollLeft=track.scrollLeft;updatePosition();};
  const measure=()=>{
   // Compensate for the table's vertical scrollbar so both horizontal ranges match.
   const trackWidth=track.clientWidth||tableViewport.clientWidth;
   fill.style.width=Math.max(0,tableViewport.scrollWidth+trackWidth-tableViewport.clientWidth)+'px';
   fromTable();
  };
  tableViewport.addEventListener('scroll',fromTable,{passive:true});track.addEventListener('scroll',fromTrack,{passive:true});
  const resize=typeof ResizeObserver==='undefined'?null:new ResizeObserver(measure);
  resize?.observe(tableViewport);resize?.observe(track);
  const table=tableViewport.querySelector('table');if(table)resize?.observe(table);
  const unbindColumns=table?bindColumnWidths(table,storageKey,label,columnLayout,measure,defaultWidths):()=>{};
  window.addEventListener('resize',measure);measure();
  return ()=>{resize?.disconnect();window.removeEventListener('resize',measure);tableViewport.removeEventListener('scroll',fromTable);track.removeEventListener('scroll',fromTrack);unbindColumns();viewport.current=null;};
 },[children,storageKey,label,defaultWidths]);
 const move=(direction:number)=>{const table=viewport.current;if(!table)return;table.scrollLeft+=direction*Math.max(160,Math.round(table.clientWidth*.75));};
 return <div className="customer-project-table-scroll" ref={root} aria-label={label+'滚动与列宽'}>
  <div className="cp-project-scroll-tools" hidden={!position.overflow}>
   <div className="cp-project-scroll-buttons"><span>左右移动查看全部列 · 拖动表头边缘调整列宽</span><div><button type="button" aria-label={label+'向左移动'} disabled={!position.left} onClick={()=>move(-1)}>← 向左</button><button type="button" aria-label={label+'向右移动'} disabled={!position.right} onClick={()=>move(1)}>向右 →</button></div></div>
   <div className="cp-project-scroll-rail" ref={rail} tabIndex={position.overflow?0:-1} role="region" aria-label={label+'横向滚动条'}><div ref={spacer}/></div>
  </div>
  {children}
 </div>;
}
