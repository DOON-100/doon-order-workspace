'use client';
import {Children,isValidElement,useEffect,useRef,useState,type ReactNode} from 'react';
import {Combobox} from '@base-ui/react';
import {Check,ChevronDown} from 'lucide-react';
import './customer-project-search-select.css';

type Option={value:string;label:string;disabled?:boolean};
function text(node:ReactNode):string{
 if(node===null||node===undefined||typeof node==='boolean')return '';
 if(typeof node==='string'||typeof node==='number')return String(node);
 if(isValidElement<{children?:ReactNode}>(node))return text(node.props.children);
 return Children.toArray(node).map(text).join('');
}
function optionsFrom(children:ReactNode):Option[]{
 const options:Option[]=[];
 Children.forEach(children,child=>{
  if(!isValidElement<{value?:string;disabled?:boolean;children?:ReactNode}>(child))return;
  if(child.type==='option')options.push({value:String(child.props.value??text(child.props.children)),label:text(child.props.children),disabled:child.props.disabled});
  else options.push(...optionsFrom(child.props.children));
 });
 return options;
}
const normalized=(value:string)=>value.normalize('NFKC').trim().toLocaleLowerCase();

// Search text only filters existing options. Only selecting an item emits a value.
export function ServiceSearchSelect({value,children,onChange,required,disabled,'aria-label':label}:{value:string;children:ReactNode;onChange:(event:{target:{value:string}})=>void;required?:boolean;disabled?:boolean;'aria-label':string}){
 const options=optionsFrom(children),selected=options.find(option=>option.value===value)||null;
 const [query,setQuery]=useState(selected?.label||''),[open,setOpen]=useState(false);
 const input=useRef<HTMLInputElement>(null);
 const matching=query===selected?.label?options:options.filter(option=>normalized(query).split(/\s+/).every(part=>normalized(option.label).includes(part)));
 useEffect(()=>{if(!open)setQuery(selected?.label||'');},[open,value,selected?.label]);
 useEffect(()=>{input.current?.setCustomValidity(required&&!selected?.value?'请从查询结果中选择'+label+'。':'');},[required,selected?.value,label]);
 return <Combobox.Root<Option> items={options} filteredItems={matching} filter={null} value={selected} inputValue={query} disabled={disabled} autoHighlight open={open}
  isItemEqualToValue={(a,b)=>a.value===b.value}
  onOpenChange={next=>{setOpen(next);if(!next)setQuery(selected?.label||'');}}
  onInputValueChange={(value,details)=>{if(['input-change','input-clear','clear-press'].includes(details.reason)){setQuery(value);setOpen(true);}}}
  onValueChange={option=>{if(!option||option.disabled)return;onChange({target:{value:option.value}});setQuery(option.label);setOpen(false);}}>
  <div className="cp-search-input sw-search-select">
   <Combobox.Input ref={input} aria-label={label} disabled={disabled} required={required} autoComplete="off" placeholder="输入关键词查询，仅可选择已有选项"/>
   <Combobox.Trigger type="button" disabled={disabled} aria-label={'展开'+label+'选项'}><ChevronDown size={16}/></Combobox.Trigger>
  </div>
  <Combobox.Portal><Combobox.Positioner sideOffset={5} style={{zIndex:120}}>
   <Combobox.Popup className="cp-search-popup">
    <Combobox.Empty className="cp-search-empty">没有匹配的选项，请更换关键词；不支持自定义。</Combobox.Empty>
    <Combobox.List>{(option:Option)=><Combobox.Item key={option.value} value={option} disabled={option.disabled} className="cp-search-option"><span>{option.label}</span><Combobox.ItemIndicator><Check size={16}/></Combobox.ItemIndicator></Combobox.Item>}</Combobox.List>
   </Combobox.Popup>
  </Combobox.Positioner></Combobox.Portal>
 </Combobox.Root>;
}
