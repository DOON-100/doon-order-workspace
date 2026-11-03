'use client';
import {useCallback,useMemo} from 'react';
import type {MetalData} from '@/lib/metal-outsourcing-contract';
import {ExcelTable,useExcelColumnFilters} from './excel-table';
type Followup={id:string;supplier:string;delivery:string;job:string;order:string;style:string;unit:string;dispatched:number;received:number;outstanding:number;due:string;pmc:string;reasons:string;message:string};
export function MetalFollowupPanel({data}:{data:MetalData}){
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const rows=useMemo(()=>data.deliveries.filter(d=>!d.voided&&d.status==='dispatched').flatMap(d=>d.lines.flatMap(l=>{
  const received=data.receipts.filter(r=>!r.voided&&r.deliveryLineId===l.id).reduce((n,r)=>n+r.quantity,0),outstanding=Math.max(0,l.quantity-received);if(!outstanding)return [];
  const demand=data.demands.find(x=>x.id===l.demandId),job=data.jobs.find(x=>x.id===l.jobId),styles=[...new Set(demand?.sources.map(s=>s.style)||[])],sourceIds=new Set(demand?.sourceLineIds||[]),sources=data.sourceGroups.flatMap(g=>g.lines).filter(s=>sourceIds.has(s.lineId)),dates=[...new Set(sources.map(s=>s.pmcPlannedDate).filter((v):v is string=>!!v))].sort(),reasons=[];
  if(!d.signedAt)reasons.push('已登记发出，缺少供应商签收日期或签收依据');
  if(d.dueDate<today)reasons.push('要求收回日期已过，仍有未回实物');
  if(sources.some(s=>!s.pmcPlannedDate)||!sources.length)reasons.push('来源PMC明细缺少预计完工日，无法确定对生产排期的影响');
  if(dates.length>1)reasons.push('关联PMC明细有多个预计完工日，需逐批核对');
  if(dates.length&&d.dueDate>dates[0])reasons.push('外发要求收回日晚于至少一条PMC预计完工日');
  const order=demand?.orderNo||'',style=styles.join('、'),unit=demand?.unit||'';
  return [{id:l.id,supplier:d.supplierName,delivery:d.number,job:job?.number||'',order,style,unit,dispatched:l.quantity,received,outstanding,due:d.dueDate,pmc:dates.join('、'),reasons:reasons.join('；')||'未回货，按要求收回日例行跟进',message:`${d.supplierName}：请确认加工单${job?.number||'待核对'}、送货单${d.number}，订单${order}，${style}／${demand?.process.name||''}，未回${outstanding}${unit}，要求收回日${d.dueDate}。请回复预计完成日、可交数量及异常原因。如已送回，请提供送货单号供我们核实。`}];
 })),[data,today]);
 const columns=['供应商','送货单','加工单','销售订单','款式','单位','实发','实收','未回','要求收回日','PMC当前预计完工日','跟进或核对原因','供应商跟催内容'];
 const values=useCallback((r:Followup)=>[r.supplier,r.delivery,r.job,r.order,r.style,r.unit,r.dispatched,r.received,r.outstanding,r.due,r.pmc,r.reasons,r.message],[]),model=useExcelColumnFilters(rows,values);
 return <section className="metal-section"><h3>每日外发跟进与PMC排期</h3><p>按实际已发与实收计算未回实物；供应商回复需有原消息依据。共 {rows.length} 条未回明细，当前筛选 {model.rows.length} 条。<a href="/pmc">打开PMC排期总表</a></p><div className="metal-table-wrap"><ExcelTable className="metal-table" filterModel={model}><thead><tr>{columns.map(c=><th key={c}>{c}</th>)}</tr></thead><tbody>{model.rows.map(r=><tr key={r.id}>{values(r).map((v,i)=><td key={i}>{v===''?'—':v}</td>)}</tr>)}</tbody></ExcelTable></div><p>群按供应商完整名称匹配；同名群、别名或主体不一致时记录核对原因，不能只按简称发送。发送前去重，发送结果不明确时先查询原消息。</p></section>;
}
