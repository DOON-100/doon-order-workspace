'use client';

import {useCallback,useLayoutEffect,useMemo,useRef,useState,type ComponentProps,type Ref} from 'react';
import {createPortal} from 'react-dom';
import {ChevronDown,Filter} from 'lucide-react';
import {Popover as PopoverPrimitive} from 'radix-ui';
import {Popover,PopoverTrigger} from '@/components/ui/popover';
import './excel-table.css';

export type ExcelFilters=Record<number,string[]>;
export function normalizeExcelValue(value:unknown):string {
  return String(value??'').replace(/\s+/gu,' ').trim();
}
export function matchesExcelFilters(values:unknown[],filters:ExcelFilters):boolean {
  return Object.entries(filters).every(([column,selected])=>selected.includes(normalizeExcelValue(values[Number(column)])));
}
export type ExcelFilterModel<T=unknown>={
  rows:T[];
  total:number;
  filters:ExcelFilters;
  setFilter:(column:number,values:string[]|null)=>void;
  clearFilters:()=>void;
  values:(column:number)=>string[];
};
const unique=(values:string[])=>[...new Set(values)].sort((a,b)=>a.localeCompare(b,'zh-CN',{numeric:true}));

/** Filter the complete authorized list before a caller paginates or virtualizes it. */
export function useExcelColumnFilters<T>(records:T[],getValues:(row:T)=>unknown[]):ExcelFilterModel<T> {
  const [filters,setFilters]=useState<ExcelFilters>({});
  const prepared=useMemo(()=>records.map(row=>({row,values:getValues(row).map(normalizeExcelValue)})),[records,getValues]);
  const rows=useMemo(()=>prepared.filter(entry=>matchesExcelFilters(entry.values,filters)).map(entry=>entry.row),[prepared,filters]);
  const setFilter=useCallback((column:number,values:string[]|null)=>setFilters(previous=>{
    const next={...previous};
    if(values===null)delete next[column];else next[column]=[...new Set(values.map(normalizeExcelValue))];
    return next;
  }),[]);
  const clearFilters=useCallback(()=>setFilters(previous=>Object.keys(previous).length?{}:previous),[]);
  const values=useCallback((column:number)=>unique(prepared.map(entry=>entry.values[column]??'')),[prepared]);
  return {rows,total:records.length,filters,setFilter,clearFilters,values};
}

type Header={cell:HTMLTableCellElement;host:HTMLSpanElement;column:number;label:string};
type RowGroup={rows:HTMLTableRowElement[];values:string[][]};
type Snapshot={headers:Header[];groups:RowGroup[];columns:number};
const emptySnapshot:Snapshot={headers:[],groups:[],columns:1};

/** Read displayed values, including current editors, without invoking a cell component. */
function cellText(node:Node):string {
  if(node.nodeType===Node.TEXT_NODE)return node.textContent||'';
  if(!(node instanceof Element))return '';
  if(node.matches('[data-excel-ui],svg,script,style,[aria-hidden="true"],[hidden],.sr-only'))return '';
  const explicit=node.getAttribute('data-filter-value');
  if(explicit!==null)return explicit;
  if(node instanceof HTMLInputElement){
    if(['hidden','password','file','button','submit','reset'].includes(node.type))return '';
    return node.type==='checkbox'||node.type==='radio'?(node.checked?'是':'否'):node.value;
  }
  if(node instanceof HTMLTextAreaElement)return node.value;
  if(node instanceof HTMLSelectElement)return Array.from(node.selectedOptions).map(option=>option.text).join(' ');
  if(node instanceof HTMLImageElement)return node.alt;
  if(node instanceof HTMLDetailsElement&&!node.open)return node.querySelector('summary')?.textContent||'';
  return Array.from(node.childNodes).map(cellText).filter(Boolean).join(' ');
}

function tableSnapshot(table:HTMLTableElement):Snapshot {
  const headers:Header[]=[],headerGrid:HTMLTableCellElement[][]=[];
  for(const [rowIndex,row] of Array.from(table.tHead?.rows||[]).entries()){
    headerGrid[rowIndex]??=[];
    let column=0;
    for(const cell of Array.from(row.cells)){
      while(headerGrid[rowIndex][column])column++;
      for(let down=0;down<cell.rowSpan;down++)for(let across=0;across<cell.colSpan;across++){
        headerGrid[rowIndex+down]??=[];
        // Some workspaces keep a second row of existing filter <td>s in thead.
        // Only actual header cells define the business field labels.
        if(cell.tagName==='TH')headerGrid[rowIndex+down][column+across]=cell;
      }
      column+=cell.colSpan;
    }
  }
  const columns=Math.max(1,...headerGrid.map(row=>row.length));
  const leaves=Array.from({length:columns},(_,column)=>headerGrid.map(row=>row[column]).filter(Boolean).at(-1));
  for(const [column,cell] of leaves.entries()){
    if(!cell||cell.colSpan>1||cell.hasAttribute('data-excel-no-filter')||headers.some(header=>header.cell===cell)||cell.querySelector('.pmc-filter-trigger'))continue;
    const label=normalizeExcelValue(cellText(cell));
    // Selection checkboxes are commands, not business fields.
    if(!label||cell.querySelector('input[type="checkbox"],[role="checkbox"]'))continue;
    let host=Array.from(cell.children).find(child=>child.hasAttribute('data-excel-header-host')) as HTMLSpanElement|undefined;
    if(!host){host=document.createElement('span');host.setAttribute('data-excel-header-host','');host.setAttribute('data-excel-ui','');host.className='excel-header-filter';cell.appendChild(host);}
    headers.push({cell,host,column,label});
  }
  const groups:RowGroup[]=[];
  for(const body of Array.from(table.tBodies)){
    if(body.hasAttribute('data-excel-ui'))continue;
    const spans=new Map<number,{value:string;remaining:number}>();
    let group:RowGroup|undefined,joinedUntil=-1;
    for(const [rowIndex,row] of Array.from(body.rows).entries()){
      if(row.hasAttribute('data-excel-ui'))continue;
      const cells=Array.from(row.cells);
      const companion=row.classList.contains('business-followup-record-row')||(cells.length===1&&cells[0].colSpan>=columns&&columns>1);
      if(companion){if(group)group.rows.push(row);continue;}
      const values:string[]=[],occupied=new Set<number>();
      for(const [column,span] of spans){values[column]=span.value;occupied.add(column);if(--span.remaining<=0)spans.delete(column);}
      let column=0;
      for(const cell of cells){
        while(occupied.has(column))column++;
        const value=normalizeExcelValue(cellText(cell));
        for(let across=0;across<cell.colSpan;across++){
          values[column+across]=value;
          if(cell.rowSpan>1)spans.set(column+across,{value,remaining:cell.rowSpan-1});
        }
        column+=cell.colSpan;
      }
      // Connected merged rows remain one unit, preserving the meaning of rowspans.
      if(!group||rowIndex>joinedUntil){group={rows:[],values:[]};groups.push(group);}
      group.rows.push(row);group.values.push(values);
      joinedUntil=Math.max(joinedUntil,...cells.map(cell=>rowIndex+cell.rowSpan-1));
    }
  }
  return {headers,groups,columns};
}
function sameSnapshot(a:Snapshot,b:Snapshot):boolean {
  return a.columns===b.columns&&a.headers.length===b.headers.length&&a.groups.length===b.groups.length&&
    a.headers.every((header,index)=>{const next=b.headers[index];return header.host===next.host&&header.column===next.column&&header.label===next.label;})&&
    a.groups.every((group,index)=>{const next=b.groups[index];return group.rows.length===next.rows.length&&group.rows.every((row,i)=>row===next.rows[i])&&JSON.stringify(group.values)===JSON.stringify(next.values);});
}

function ColumnFilter({label,options,selected,onChange,disabled,container}:{label:string;options:string[];selected:string[]|undefined;onChange:(values:string[]|null)=>void;disabled:boolean;container?:HTMLElement}){
  const [open,setOpen]=useState(false),[search,setSearch]=useState(''),[draft,setDraft]=useState<string[]>([]);
  const choices=unique([...options,...(selected||[])]);
  const shown=choices.filter(value=>(value||'（空白）').toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const begin=(next:boolean)=>{setOpen(next);if(next){setSearch('');setDraft(selected?[...selected]:[...options]);}};
  return <Popover open={open&&!disabled} onOpenChange={begin}>
    <PopoverTrigger asChild><button type="button" disabled={disabled} className={'excel-filter-trigger'+(selected!==undefined?' is-filtered':'')} aria-label={'筛选'+label} title={label+(selected===undefined?'：全部':'：已筛选')} onClick={event=>event.stopPropagation()}>{selected===undefined?<ChevronDown size={12} aria-hidden="true"/>:<Filter size={12} aria-hidden="true"/>}</button></PopoverTrigger>
    <PopoverPrimitive.Portal container={container}><PopoverPrimitive.Content className="excel-filter-popover" align="start" sideOffset={6} collisionPadding={12} aria-label={'筛选'+label} onClick={event=>event.stopPropagation()}>
      <strong>{label}</strong>
      <input type="search" aria-label={'搜索'+label+'筛选值'} placeholder="搜索筛选值" value={search} onChange={event=>setSearch(event.target.value)}/>
      <div className="excel-filter-select-actions"><button type="button" onClick={()=>setDraft([...choices])}>全选</button>{search&&<button type="button" onClick={()=>setDraft([...shown])}>仅选搜索结果</button>}<button type="button" onClick={()=>setDraft([])}>全不选</button></div>
      <div className="excel-filter-options">{shown.map(value=><label key={value} title={value||'（空白）'}><input type="checkbox" checked={draft.includes(value)} onChange={event=>setDraft(previous=>event.target.checked?[...previous,value]:previous.filter(item=>item!==value))}/><span>{value||'（空白）'}</span></label>)}{!shown.length&&<p>没有匹配的值</p>}</div>
      <button type="button" className="excel-filter-clear" disabled={selected===undefined} onClick={()=>{onChange(null);setOpen(false);}}>清除此列筛选</button>
      <div className="excel-filter-confirm"><button type="button" onClick={()=>setOpen(false)}>取消</button><button type="button" onClick={()=>{onChange(options.length>0&&options.every(value=>draft.includes(value))?null:draft);setOpen(false);}}>确定</button></div>
    </PopoverPrimitive.Content></PopoverPrimitive.Portal>
  </Popover>;
}

export type ExcelTableProps=ComponentProps<'table'>&{filterModel?:ExcelFilterModel;enhance?:boolean;filterDisabled?:boolean};
function assignRef(ref:Ref<HTMLTableElement>|undefined,value:HTMLTableElement|null){if(typeof ref==='function')ref(value);else if(ref)ref.current=value;}

/** A native table with read-only Excel-style filtering; its business children stay intact. */
export function ExcelTable({children,className,filterModel,enhance=true,filterDisabled=false,ref,...props}:ExcelTableProps){
  const table=useRef<HTMLTableElement|null>(null),scan=useRef<()=>void>(()=>{}),schema=useRef('');
  const [snapshot,setSnapshot]=useState<Snapshot>(emptySnapshot),[filters,setFilters]=useState<ExcelFilters>({});
  const activeFilters=filterModel?.filters||filters;
  const setFilter=filterModel?.setFilter||((column:number,values:string[]|null)=>setFilters(previous=>{const next={...previous};if(values===null)delete next[column];else next[column]=values;return next;}));
  const clearFilters=filterModel?.clearFilters||(()=>setFilters({}));
  const controller=useRef({clearFilters});controller.current={clearFilters};
  const bind=useCallback((value:HTMLTableElement|null)=>{table.current=value;assignRef(ref,value);},[ref]);

  useLayoutEffect(()=>{
    const element=table.current;if(!element||!enhance)return;
    let frame=0,disposed=false;
    const update=()=>{
      if(disposed)return;
      const next=tableSnapshot(element),nextSchema=JSON.stringify(next.headers.map(header=>[header.column,header.label]));
      if(schema.current&&schema.current!==nextSchema)controller.current.clearFilters();
      schema.current=nextSchema;
      setSnapshot(previous=>sameSnapshot(previous,next)?previous:next);
    };
    scan.current=update;
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(()=>{frame=0;update();});};
    const observer=new MutationObserver(mutations=>{
      if(mutations.some(mutation=>{
        const target=mutation.target instanceof Element?mutation.target:mutation.target.parentElement;
        if(target?.closest('[data-excel-ui]'))return false;
        if(mutation.type==='childList'&&[...mutation.addedNodes,...mutation.removedNodes].every(node=>node instanceof Element&&node.hasAttribute('data-excel-ui')))return false;
        return true;
      }))schedule();
    });
    observer.observe(element,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['value','checked','selected','data-filter-value','colspan','rowspan','open']});
    element.addEventListener('input',schedule);element.addEventListener('change',schedule);update();
    return()=>{
      disposed=true;observer.disconnect();cancelAnimationFrame(frame);scan.current=()=>{};
      element.removeEventListener('input',schedule);element.removeEventListener('change',schedule);
      element.querySelectorAll('.excel-filtered-row').forEach(row=>{if(row.closest('table')===element)row.classList.remove('excel-filtered-row');});
      element.querySelectorAll('[data-excel-header-host]').forEach(host=>{if(host.closest('table')===element)host.remove();});
    };
  },[enhance]);
  useLayoutEffect(()=>{scan.current();},[children]);
  useLayoutEffect(()=>{
    if(!enhance)return;
    for(const group of snapshot.groups){
      const hidden=!filterModel&&!group.values.some(values=>matchesExcelFilters(values,activeFilters));
      for(const row of group.rows)row.classList.toggle('excel-filtered-row',hidden);
    }
  },[snapshot,activeFilters,filterModel,enhance]);

  const active=enhance&&Object.keys(activeFilters).length>0;
  const total=filterModel?.total??snapshot.groups.reduce((sum,group)=>sum+group.values.length,0);
  const visible=filterModel?.rows.length??snapshot.groups.reduce((sum,group)=>sum+(group.values.some(values=>matchesExcelFilters(values,activeFilters))?group.values.length:0),0);
  return <>
    <table {...props} ref={bind} className={['excel-table',(filterModel||!enhance)&&'excel-table-windowed',className].filter(Boolean).join(' ')}>{children}{active&&<tbody data-excel-ui="" className="excel-filter-status"><tr><td colSpan={snapshot.columns}><span role="status">{visible===0?'没有匹配记录 · ':''}已筛选 {visible} / {total} 条</span><button type="button" disabled={filterDisabled} onClick={clearFilters}>清除全部筛选</button></td></tr></tbody>}</table>
    {enhance&&snapshot.headers.map(header=>createPortal(<ColumnFilter label={header.label} options={filterModel?filterModel.values(header.column):unique(snapshot.groups.flatMap(group=>group.values.map(values=>values[header.column]??'')))} selected={activeFilters[header.column]} onChange={values=>setFilter(header.column,values)} disabled={filterDisabled} container={header.cell.closest('dialog')||undefined}/>,header.host,String(header.column)+':'+header.label))}
  </>;
}
