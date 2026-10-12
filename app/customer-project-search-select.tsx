'use client';
import {useEffect,useRef,useState} from 'react';
import {Combobox} from '@base-ui/react';
import {Check,ChevronDown} from 'lucide-react';
import type {CPOption} from './customer-project-ui';

const normalized=(text:string)=>text.normalize('NFKC').trim().toLocaleLowerCase();

export function CPSearchSelect({value,options,onChange,label,required,disabled,placeholder}:{value:string;options:CPOption[];onChange:(value:string)=>void;label:string;required?:boolean;disabled?:boolean;placeholder?:string}){
 const selected=options.find(option=>option.value===value)||null;
 const [query,setQuery]=useState(selected?.label||'');
 const [open,setOpen]=useState(false);
 const matching=options.filter(option=>normalized(query).split(/\s+/).every(part=>normalized(option.label).includes(part)));
 const input=useRef<HTMLInputElement>(null);
 useEffect(()=>{if(selected)setQuery(selected.label);},[selected?.value,selected?.label]);
 useEffect(()=>{input.current?.setCustomValidity(required&&!selected?'请从查询结果中选择客户。':'');},[required,selected?.value]);
 return <Combobox.Root<CPOption> items={options} filteredItems={matching} filter={null} value={selected} inputValue={query} disabled={disabled} autoHighlight open={open} onOpenChange={setOpen}
  isItemEqualToValue={(a,b)=>a.value===b.value}
  onInputValueChange={(text,details)=>{
   if(details.reason==='input-change'||details.reason==='input-clear'||details.reason==='clear-press'){
    setQuery(text);if(details.reason==='input-change')setOpen(true);if(text!==selected?.label)onChange('');
   }
  }}
  onValueChange={option=>{onChange(option?.value||'');if(option){setQuery(option.label);setOpen(false);}}}>
  <div className="cp-search-input">
   <Combobox.Input ref={input} aria-label={label} required={required} disabled={disabled} autoComplete="off" placeholder={placeholder||'输入客户编码或名称查询'}/>
   <Combobox.Trigger type="button" disabled={disabled} aria-label="展开客户查询结果"><ChevronDown size={16}/></Combobox.Trigger>
  </div>
  <Combobox.Portal><Combobox.Positioner sideOffset={5} style={{zIndex:120}}>
   <Combobox.Popup className="cp-search-popup">
    <Combobox.Empty className="cp-search-empty">没有匹配的客户，请更换编码或名称。</Combobox.Empty>
    <Combobox.List>{(option:CPOption)=><Combobox.Item key={option.value} value={option} className="cp-search-option">
     <span>{option.label}</span><Combobox.ItemIndicator><Check size={16}/></Combobox.ItemIndicator>
    </Combobox.Item>}</Combobox.List>
   </Combobox.Popup>
  </Combobox.Positioner></Combobox.Portal>
 </Combobox.Root>;
}
