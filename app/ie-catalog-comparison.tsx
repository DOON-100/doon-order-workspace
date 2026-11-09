'use client';

import {useMemo,useState} from 'react';
import {ExcelTable,useExcelColumnFilters} from './excel-table';
import type {Catalog} from './ie-quote-panel';
import './ie-catalog-comparison.css';

type PriceItem=Catalog&{supplier?:string;currency?:string;taxBasis?:string;taxRate?:number|null;frameType?:string;processType?:string;color?:string;notes?:string};
type Reference={catalogId?:string;catalogVersion?:number|null;name?:string;specification?:string;unit?:string};
const normalized=(value:string|undefined)=>(value||'').trim().replace(/\s+/g,' ').toLocaleLowerCase();
const price=(value:Catalog['basePrice'])=>value===null||String(value).trim()===''?'待填写':String(value);
const basis=(item:PriceItem)=>item.taxBasis==='inclusive'?'含税':item.taxBasis==='exclusive'?'未税':item.taxBasis?'待核对税口径':'未税（旧目录）';
const currency=(item:PriceItem)=>(item.currency||'CNY').toUpperCase();
const canUse=(item:PriceItem)=>!!item.id&&!!item.version&&item.basePrice!==null&&String(item.basePrice).trim()!==''&&Number.isFinite(Number(item.basePrice))&&Number(item.basePrice)>=0&&currency(item)==='CNY'&&(!item.taxBasis||item.taxBasis==='exclusive');
const values=(item:PriceItem)=>[item.supplier||'',item.name,item.specification,item.unit,item.basePrice,currency(item),basis(item),item.taxRate??'',item.frameType||'',item.processType||'',item.color||'',item.effectiveDate,item.version,item.priceSource,item.notes||''];
const labels=['供应商','名称','规格','单位','基价','币种','税口径','加收税点','架型','工艺类别','颜色','生效日期','版本','价格来源','备注'];

/** Each adoption copies a single catalog version; catalog maintenance cannot rewrite this quote. */
export function IeCatalogComparison({row,category,catalog,onChange,disabled=false}:{row:Reference;category:Catalog['category'];catalog:Catalog[];onChange:(item:Catalog|null)=>void;disabled?:boolean}){
 const [search,setSearch]=useState(''),[matching,setMatching]=useState(true);
 const candidates=useMemo(()=>catalog.filter((item:PriceItem)=>{
  if(item.category!==category||!item.active)return false;
  if(matching&&row.name){
   if(normalized(item.name)!==normalized(row.name))return false;
   if(category==='material'&&(normalized(item.specification)!==normalized(row.specification)||normalized(item.unit)!==normalized(row.unit)))return false;
  }
  return !search||values(item).some(value=>String(value??'').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
 }),[catalog,category,matching,row.name,row.specification,row.unit,search]);
 const model=useExcelColumnFilters(candidates,values);
 const selected=catalog.find(item=>item.id===row.catalogId&&item.version===row.catalogVersion);
 return <details className="ieq-catalog-comparison">
  <summary>{category==='material'?'供应商报价对比 / 选用':category==='process'?'标准人工单价 / 选用':'工艺报价筛选 / 选用'}{row.catalogId&&<small>已引用 v{row.catalogVersion}{selected?' · '+((selected as PriceItem).supplier||selected.name):' · 保留历史价格'}</small>}</summary>
  <div className="ieq-catalog-toolbar">
   <label><span>搜索供应商、工艺、颜色或来源</span><input type="search" value={search} placeholder="输入关键词" onChange={event=>setSearch(event.target.value)}/></label>
   <label className="ieq-catalog-match"><input type="checkbox" checked={matching} onChange={event=>setMatching(event.target.checked)}/>{category==='material'?'仅同名称、规格、单位':'仅同名称'}</label>
   <span role="status">匹配 {model.rows.length} / {model.total} 项</span>
  </div>
  <p>逐项核对供应商、规格、计价单位、币种和税口径后选用。本单按人民币未税成本计价，外币及含税价格需先核定换算；这里不自动推荐最低价。</p>
  {category==='material'&&matching&&row.name&&(!row.specification||!row.unit)&&<p className="ieq-catalog-notice">当前材料规格或单位未填，仅匹配同样留空的条目；采用前请补齐并核对计价口径。</p>}
  <div className="ieq-catalog-scroll"><ExcelTable filterModel={model} aria-label={category==='material'?'材料供应商报价对比':'工艺基础价格筛选'} className="ieq-catalog-table"><thead><tr>{labels.map(label=><th key={label}>{label}</th>)}<th data-excel-no-filter>操作</th></tr></thead><tbody>{model.rows.map(item=>{
   const chosen=item.id===row.catalogId&&item.version===row.catalogVersion,allowed=canUse(item);
   return <tr key={item.id+':'+item.version} className={chosen?'chosen':''}>{values(item).map((value,index)=><td key={index}>{String(value??'')||'—'}</td>)}<td><button type="button" disabled={disabled||!allowed} title={!allowed?'须先核定为人民币未税价格，再从基础价格库选用':undefined} onClick={()=>onChange(item)}>{chosen?'再次选用此版本':allowed?'采用此报价':'待核定换算'}</button></td></tr>;
  })}{!model.rows.length&&<tr data-excel-ui><td colSpan={16}>暂无匹配价格；可调整匹配条件，或先在基础价格库新增、上传供应商报价。</td></tr>}</tbody></ExcelTable></div>
  <div className="ieq-catalog-footer"><span>采用后保存目录编号、版本及价格快照；后续新价格不会改写本单。</span><button type="button" disabled={disabled||!row.catalogId} onClick={()=>onChange(null)}>保留当前金额，改为手填</button></div>
 </details>;
}
