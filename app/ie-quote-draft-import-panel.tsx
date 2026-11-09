'use client';
import {useEffect,useRef,useState} from 'react';
import {Upload} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle,DialogTrigger} from '@/components/ui/dialog';
import {IE_DRAFT_IMPORT_MAX_BYTES,parseIeQuoteDraftImport,type IeDraftImportCustomer} from './ie-quote-draft-import';
import type {IeQuoteFields} from '@/lib/ie-quote-input';
import './ie-quote-draft-import.css';

type Preview=ReturnType<typeof parseIeQuoteDraftImport>;
const amount=(value:number|null|undefined)=>value==null?'待 IE 核对':value.toLocaleString('zh-CN',{maximumFractionDigits:6});
export function IeQuoteDraftImportPanel({customers,disabled,onApply,onDirtyChange}:{customers:readonly IeDraftImportCustomer[];disabled:boolean;onApply:(fields:IeQuoteFields,customer:IeDraftImportCustomer)=>boolean;onDirtyChange:(dirty:boolean)=>void}){
 const [open,setOpen]=useState(false),[reading,setReading]=useState(false),[error,setError]=useState(''),[filename,setFilename]=useState(''),[preview,setPreview]=useState<Preview|null>(null);
 const text=useRef(''),sequence=useRef(0),alive=useRef(true),latestCustomers=useRef(customers);latestCustomers.current=customers;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;sequence.current++;onDirtyChange(false);};},[onDirtyChange]);
 useEffect(()=>{onDirtyChange(open&&(reading||!!filename));},[open,reading,filename,onDirtyChange]);
 const reset=()=>{sequence.current++;text.current='';setFilename('');setPreview(null);setReading(false);setError('');};
 const changeOpen=(value:boolean)=>{if(disabled&&value)return;reset();setOpen(value);};
 const read=async(file:File|undefined)=>{
  reset();if(!file)return;setFilename(file.name);if(file.size>IE_DRAFT_IMPORT_MAX_BYTES){setError('报价草稿文件不能超过 8 MB。');return;}
  const request=++sequence.current;setReading(true);
  try{const source=await file.text();if(!alive.current||request!==sequence.current)return;const result=parseIeQuoteDraftImport(source,latestCustomers.current);text.current=source;setPreview(result);}catch(cause){if(alive.current&&request===sequence.current)setError((cause as Error).message);}finally{if(alive.current&&request===sequence.current)setReading(false);}
 };
 const apply=()=>{if(disabled||reading||!preview)return;try{const current=parseIeQuoteDraftImport(text.current,latestCustomers.current);if(onApply(current.fields,current.customer))changeOpen(false);}catch(cause){setPreview(null);setError((cause as Error).message);}};
 return <Dialog open={open} onOpenChange={changeOpen}><DialogTrigger asChild><Button variant="outline" disabled={disabled}><Upload size={15}/>导入报价草稿</Button></DialogTrigger><DialogContent className="ieq-draft-import" onKeyDown={event=>{event.stopPropagation();if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s')event.preventDefault();}}><DialogHeader><DialogTitle>导入报价草稿</DialogTitle><DialogDescription>先查看客户、款式和费用明细，再载入可编辑草稿。待 IE 核对的空价、难度系数及备注均可继续修改；最后点击页面原有的“保存草稿”。</DialogDescription></DialogHeader>
  <label className="ieq-draft-import-file"><span>报价草稿文件（不超过 8 MB）</span><input type="file" accept=".iequote,.json,application/json" aria-label="报价草稿文件" disabled={disabled||reading} onChange={event=>void read(event.target.files?.[0])}/></label>
  {reading&&<p role="status">正在读取并校验草稿……</p>}{error&&<p className="ieq-alert error" role="alert">{error}</p>}
  {preview&&<div className="ieq-draft-import-preview" aria-label="报价草稿预览"><dl><dt>文件</dt><dd>{filename}</dd><dt>客户</dt><dd>{preview.customer.customerCode} · {preview.customer.customer}</dd><dt>工程报价编号</dt><dd>{preview.fields.quoteNo||'待填写'}</dd><dt>批次</dt><dd>{preview.fields.batchId||'待填写'}</dd><dt>款式数量</dt><dd>{preview.fields.lines.length} 款</dd><dt>汇率</dt><dd>{amount(preview.fields.exchangeRateCnyPerUsd)}</dd></dl>{preview.fields.notes&&<p className="ieq-draft-import-notes">{preview.fields.notes}</p>}
   {preview.fields.lines.map((line,i)=><details key={line.id}><summary>{i+1}. {line.model||'型号待填写'} · {line.drawingNo||'图号待填写'} · {line.color||'色号待填写'}<span>查看明细</span></summary><p>客户型号：{line.customerModel||'待填写'}；图纸版本：{line.drawingRevision||'待填写'}；数量：{amount(line.quantityMin)} — {amount(line.quantityMax)} 副</p><p className="ieq-draft-import-notes">结构分析：{line.structureNotes||'待 IE 核对'}<br/>报价范围：{line.scopeNotes||'待 IE 核对'}</p><h4>BOM 材料 · {line.materials.length} 项</h4><ul>{line.materials.map(row=><li key={row.id}><strong>{row.name||'名称待填写'}</strong> · 基价 {amount(row.basePrice)} · 用量 {amount(row.usage)} · 系数 {amount(row.coefficient)}{row.notApplicable?' · 不适用':''}<small>{[row.specification,row.unit,row.priceSource,row.notes].filter(Boolean).join('；')}</small></li>)}</ul><h4>加工工艺 · {line.processes.length} 项</h4><ul>{line.processes.map(row=><li key={row.id}><strong>{row.name||'名称待填写'}</strong> · 基价 {amount(row.basePrice)} · 难度 {amount(row.difficulty)} · 用量 {amount(row.usage)}{row.notApplicable?' · 不适用':''}<small>{[row.priceSource,row.notes].filter(Boolean).join('；')}</small></li>)}</ul><h4>电镀及其他外发 · {line.outsourcing.length} 项</h4><ul>{line.outsourcing.map(row=><li key={row.id}><strong>{row.category==='plating'?'电镀':'外发'} · {row.name||'名称待填写'}</strong> · {row.part||'部位待填写'} · 单价 {amount(row.unitPrice)} · 用量 {amount(row.usage)}{row.notApplicable?' · 不适用':''}<small>{[row.priceSource,row.notes].filter(Boolean).join('；')}</small></li>)}</ul></details>)}
   <details><summary>一次性费用 · {preview.fields.tooling.length} 项<span>查看明细</span></summary><ul>{preview.fields.tooling.map(row=><li key={row.id}><strong>{row.name||'名称待填写'}</strong> · {amount(row.amount)}<small>{[row.evidence,row.notes].filter(Boolean).join('；')}</small></li>)}</ul></details><p>人工金额调整：{preview.fields.manualAdjustments?.length||0} 项，载入后可在报价明细中核对金额与原因。</p>
  </div>}
  <DialogFooter><Button variant="outline" onClick={()=>changeOpen(false)}>关闭</Button><Button disabled={disabled||reading||!preview} onClick={apply}>载入可编辑草稿</Button></DialogFooter></DialogContent></Dialog>;
}
