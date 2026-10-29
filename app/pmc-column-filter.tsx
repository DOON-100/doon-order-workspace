'use client';
import {useMemo,useState,type ReactNode} from 'react';
import {Check,ChevronDown} from 'lucide-react';
import {Popover,PopoverContent,PopoverTrigger} from '@/components/ui/popover';

export function PmcColumnFilter({label,value,options,onChange,children}:{label:string;value:string|undefined;options:string[];onChange:(value:string|undefined)=>void;children:ReactNode}){
 const [open,setOpen]=useState(false),[search,setSearch]=useState('');
 const shown=useMemo(()=>options.filter(option=>(option||'（空白）').toLocaleLowerCase().includes(search.toLocaleLowerCase())),[options,search]);
 function choose(next:string|undefined){onChange(next);setOpen(false);}
 return <Popover open={open} onOpenChange={next=>{setOpen(next);if(next)setSearch('');}}>
  <PopoverTrigger asChild><button type="button" className={'pmc-filter-trigger'+(value!==undefined?' is-filtered':'')} aria-label={'筛选'+label} title={value===undefined?'筛选'+label:label+'：'+(value||'（空白）')}><span>{children}</span><ChevronDown size={12} aria-hidden="true"/></button></PopoverTrigger>
  <PopoverContent align="start" className="pmc-filter-popover" aria-label={'筛选'+label}>
   <strong>{label}</strong>
   <input type="search" aria-label={'搜索'+label+'筛选值'} placeholder="搜索筛选值" value={search} onChange={e=>setSearch(e.target.value)}/>
   <button type="button" className="pmc-filter-option" aria-pressed={value===undefined} onClick={()=>choose(undefined)}><span>全部</span>{value===undefined&&<Check size={14} aria-hidden="true"/>}</button>
   <div className="pmc-filter-options">{shown.map(option=><button type="button" key={option} className="pmc-filter-option" aria-pressed={value===option} title={option||'（空白）'} onClick={()=>choose(option)}><span>{option||'（空白）'}</span>{value===option&&<Check size={14} aria-hidden="true"/>}</button>)}{!shown.length&&<p>没有匹配的值</p>}</div>
  </PopoverContent>
 </Popover>;
}
