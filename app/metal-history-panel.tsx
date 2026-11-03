'use client';
import {useCallback,useEffect,useState} from 'react';
import type {MetalData} from '@/lib/metal-outsourcing-contract';
import {ExcelTable,useExcelColumnFilters} from './excel-table';
import {request} from './ui';
type HistoryRow={row:number;job:string;order:string;part:string;process:string;supplier:string;quantity:unknown;unit:string;price:unknown;pmc:string;candidate:string;reasons:string};
export function MetalHistoryPanel({data}:{data:MetalData}){
 const [archives,setArchives]=useState<{id:string;title:string;sheets:{name:string}[]}[]>([]),[archiveId,setArchiveId]=useState(''),[rows,setRows]=useState<HistoryRow[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const values=useCallback((r:HistoryRow)=>[r.row,r.job,r.order,r.part,r.process,r.supplier,r.quantity as string|number|null,r.unit,r.price as string|number|null,r.pmc,r.candidate,r.reasons],[]),model=useExcelColumnFilters(rows,values);
 useEffect(()=>{void request('outsourcing-workbooks').then(r=>setArchives(r.archives)).catch(e=>setError(e.message));},[]);
 useEffect(()=>{setRows([]);},[data.revision]);
 async function inspect(){setBusy(true);setError('');setRows([]);try{const a=archives.find(a=>a.id===archiveId);if(!a||a.sheets.length!==1)throw new Error('请选择单工作表的金属部历史统计原件。');const result=await request('outsourcing-workbook-sheet?id='+encodeURIComponent(a.id)+'&sheet='+encodeURIComponent(a.sheets[0].name)+'&headerRow=2');
  const headers=result.columns.map((c:{label:string})=>c.label);if(!headers.some((h:string)=>h.includes('收回日期①'))||!headers.some((h:string)=>h.includes('外发加工单号')))throw new Error('原件不是当前金属部外发加工统计表格式，未按固定列猜测导入。');
  const found:HistoryRow[]=[];
  for(const r of result.rows){if(r.row<=2)continue;const reasons:string[]=[];const value=(column:number)=>{const c=r.cells.find((c:{column:number})=>c.column===column);if(c?.cacheStatus==='missing'){reasons.push('第'+column+'列缺公式缓存，需核实原值');return null;}return c?.cacheStatus==='not-formula'?c.value:c?.cachedValue;},str=(c:number)=>String(value(c)??'').trim();
   const job=str(2),order=str(4),part=str(6),process=str(9),supplier=str(15),quantity=value(11),unit=str(12),price=value(13);if(!job&&!order&&!part&&!supplier)continue;
   let matches=data.sourceGroups.filter(g=>g.orderNo===order&&g.style===part);let candidateType='订单与款号完全相同';
   if(!matches.length){const parts=data.parts.filter(p=>p.code===part&&p.active);const boms=data.boms.filter(b=>b.status==='approved'&&b.orderNo===order&&b.lines.some(l=>parts.some(p=>p.id===l.partId)));matches=data.sourceGroups.filter(g=>boms.some(b=>b.groupKey===g.key));candidateType='已确认BOM物料引用候选';}
   if(matches.length!==1)reasons.push(matches.length?'同一来源有多个PMC/BOM候选，需确认具体生产批次和数量归属':'没有可唯一关联的PMC款式；材料号或配件号须先通过已确认BOM关联成品');
   if(typeof price!=='number')reasons.push('缺数值单价，不能生成加工费；空价不视为零价');
   if(typeof quantity!=='number'||quantity<=0)reasons.push('发出数量缺失或非正数，需核对原单');
   if(data.suppliers.filter(s=>s.name===supplier).length!==1)reasons.push('供应商完整名称未唯一匹配当前主资料，需核对主体及供应商编码');
   if(str(16))reasons.push('原表供应商编码'+str(16)+'尚未与当前供应商主体核定一致；原始名称、编码与外链缓存分别保留');
   if(!data.processes.some(p=>p.active&&p.name===str(18)))reasons.push('原表外发工序未精确匹配当前有效工序基础资料');
   if(matches.length===1&&matches[0].lines.some(l=>!l.pmcPlannedDate))reasons.push('关联PMC明细尚有未排期记录');
   reasons.push('历史原表尚未核定签收、分批实收、质检及已结账状态；仅建立来源候选，不生成新发货或应付');
   found.push({row:r.row,job,order,part,process,supplier,quantity,unit,price,pmc:matches.length===1?matches[0].lines.map(l=>l.lineId+'：'+(l.pmcPlannedDate||'未排期')).join('；'):'',candidate:matches.length===1?candidateType+'／'+matches[0].style+'／'+matches[0].lines.map(l=>l.lineId).join('、'):'',reasons:reasons.join('；')});
  }setRows(found);
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <section className="metal-section"><h3>历史外发表与PMC来源核对</h3><p>读取原件完整有效行，按订单、款号或已确认BOM物料引用列出PMC候选。配件数量不直接换算成品数量；所有待核对均列明原因。</p><label>历史统计原件<select value={archiveId} onChange={e=>{setArchiveId(e.target.value);setRows([]);}}><option value="">请选择金属部统计原件</option>{archives.map(a=><option key={a.id} value={a.id}>{a.title}</option>)}</select></label><button type="button" disabled={busy||!archiveId} onClick={()=>void inspect()}>{busy?'正在核对来源…':'核对完整历史来源与PMC'}</button>{error&&<p className="metal-alert" role="alert">{error}</p>}<p role="status">历史有效行 {rows.length} 条，筛选命中 {model.rows.length} 条。</p><div className="metal-table-wrap"><ExcelTable className="metal-table" filterModel={model}><thead><tr>{['原行','历史加工单','销售订单','款号或物料号','工序','供应商','原数量','单位','原单价','PMC当前排期','来源候选（待核定）','待核对原因'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{model.rows.map(r=><tr key={r.row}>{values(r).map((v,i)=><td key={i}>{v??'—'}</td>)}</tr>)}</tbody></ExcelTable></div></section>;
}
