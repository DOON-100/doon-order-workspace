'use client';
import {useEffect,useState} from 'react';
import {businessTeamFetch} from './business-team-client';
import {IeQuoteNotificationPanel} from './ie-quote-notification-panel';
import type {IeQuote} from '@/lib/ie-quotes';
import type {CustomerQuoteIeSource} from '@/lib/customer-quote-ie';

type SalesDraft={id?:string;version?:number;status?:string;quoteNo?:string;customerAccountId:string|null;canEdit?:boolean;lines:{id:string;model:string;factoryModel?:string;quantity:number|string|null}[];customerCharges?:{id:string;labelZh:string;amount:number|string|null}[];ieSource?:Omit<CustomerQuoteIeSource,'mappings'>&{mappings:{customerLineId:string;ieLineId:string}[]};ieSourceStale?:boolean;ieSourceUnavailable?:boolean;ieReference?:{costs:IeQuote['costs'];lines:IeQuote['lines'];tooling:IeQuote['tooling'];exchangeRateCnyPerUsd:number|null;exchangeRateDate:string}};
export type IeSalesReference=Pick<SalesDraft,'ieSource'|'ieSourceStale'|'ieSourceUnavailable'|'ieReference'>;
const money=(n:number|null|undefined)=>n==null?'待核价':n.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:6});
export function CustomerQuoteIePanel({quote,memberId,disabled,execute,onDirtyChange}:{quote:SalesDraft;memberId:string;disabled:boolean;execute:(action:string,body:unknown)=>Promise<unknown>;onDirtyChange?:(dirty:boolean)=>void}){
 const [quotes,setQuotes]=useState<IeQuote[]>([]),[sourceId,setSourceId]=useState(''),[mappings,setMappings]=useState<Record<string,string>>({}),[tools,setTools]=useState<Record<string,string>>({}),[ack,setAck]=useState(false),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 useEffect(()=>{let active=true;setQuotes([]);setSourceId('');setMappings({});setTools({});setAck(false);setError('');if(!quote.id||!quote.customerAccountId)return;setLoading(true);
  void businessTeamFetch('/api/workspace/customer-quote-ie-candidates?id='+encodeURIComponent(quote.id),{cache:'no-store'}).then(async r=>{const data=await r.json() as {quotes?:IeQuote[];error?:string};if(!r.ok)throw new Error(data.error||'工程依据读取失败');return data;}).then(data=>{if(active)setQuotes(data.quotes||[]);}).catch(e=>{if(active){setQuotes([]);setError((e as Error).message);}}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};
 },[quote.id,quote.version,quote.customerAccountId,memberId]);
 const source=quotes.find(q=>q.id===sourceId),picked=new Set(Object.values(mappings)),chargeTools=source?.tooling.filter(t=>t.chargeMode==='charge'&&t.lineIds.some(id=>picked.has(id)))||[];
 const choose=(id:string)=>{setSourceId(id);setAck(false);setTools({});const q=quotes.find(v=>v.id===id);setMappings(Object.fromEntries(quote.lines.map(l=>{const matches=q?.lines.filter(v=>v.model.toLowerCase()===(l.factoryModel||l.model).toLowerCase())||[];return [l.id,matches.length===1?matches[0].id:''];})));};
 const reference=quote.ieReference;
 return <section className="cq-ie-source cq-no-print" style={{padding:20,border:'1px solid #cbd5e1',borderRadius:12,margin:'16px 0',background:'#f8fafc'}}>
  <h3>工程核价依据 → 业务定价 → 总经理批准</h3>
  <p>业务单独填写最终客价。采用工程依据只锁定来源和适用范围，不会改写你的销售单价。模具等费用在附加费用中单列，共用模具只列一次。</p>
  {quote.ieSource&&<p><strong>已采用 {quote.ieSource.quoteNo} · V{quote.ieSource.version}</strong> · {quote.ieSource.adoptedBy} · {quote.ieSource.adoptedAt.slice(0,10)} · 最终客价由曲艳红批准</p>}
  {quote.ieSourceStale&&<p role="alert">工程报价已有新的发布版本，请重新核对后采用，当前依据不能批准新客价。</p>}
  {quote.ieSourceUnavailable&&<p role="alert">工程依据当前不可读取；须重新核对客户和来源。</p>}
  {reference&&<details><summary>查看已采用版本的成本汇总与完整明细</summary><IeReferenceDetails reference={reference}/></details>}
  {!quote.id?<p>先保存客户报价草稿，再选择已复核发布的工程依据。</p>:quote.canEdit&&<>
   {loading?<p>正在读取已发布工程报价…</p>:<label>选择该客户的工程发布版本 <select aria-label="选择工程发布版本" disabled={disabled} value={sourceId} onChange={e=>choose(e.target.value)}><option value="">请选择</option>{quotes.map(q=><option key={q.id} value={q.id}>{q.quoteNo} · V{q.version} · {q.lines.map(l=>l.model).join(' / ')}</option>)}</select></label>}
   {!loading&&!quotes.length&&!error&&<p>该客户暂无可用工程发布版本，请先完成工程复核。</p>}
   {source&&<><p>工程有效期：{source.quoteDate} 至 {source.validUntil}；手填汇率 1 USD = {source.exchangeRateCnyPerUsd} CNY（{source.exchangeRateDate}）。</p>
    <details><summary>核对选中工程版本的结构、工艺与成本明细</summary><IeReferenceDetails reference={source}/></details>
    {quote.lines.map(l=><div key={l.id} style={{margin:'12px 0'}}><label>{l.model} · 客价数量 {l.quantity??'未填'} → <select aria-label={'工程对应款式 '+l.model} disabled={disabled} value={mappings[l.id]||''} onChange={e=>{setMappings(v=>({...v,[l.id]:e.target.value}));setAck(false);}}><option value="">请选择对应工程款式</option>{source.lines.map(ie=><option key={ie.id} value={ie.id}>{ie.model} · {ie.color} · 图 {ie.drawingNo}/{ie.drawingRevision} · {ie.quantityMin}–{ie.quantityMax} 副</option>)}</select></label></div>)}
    {chargeTools.map(t=><div key={t.toolingId}><label>{t.name} · 工程单独费用 CNY {money(t.amount)} → <select aria-label={'一次性费用对应 '+t.name} disabled={disabled} value={tools[t.toolingId]||''} onChange={e=>{setTools(v=>({...v,[t.toolingId]:e.target.value}));setAck(false);}}><option value="">选择已填写的客价附加费用</option>{quote.customerCharges?.map(c=><option key={c.id} value={c.id}>{c.labelZh} · {c.amount??'待定'}</option>)}</select></label></div>)}
    <p><label><input type="checkbox" checked={ack} disabled={disabled} onChange={e=>setAck(e.target.checked)}/> 已逐款核对颜色、图纸版本、数量档、供货范围，以及共用模具对应费用</label></p>
    <button type="button" disabled={disabled||!ack||quote.lines.some(l=>!mappings[l.id])||chargeTools.some(t=>!tools[t.toolingId])} onClick={()=>void execute('customer-quote-adopt-ie',{id:quote.id,version:quote.version,ieQuoteId:source.id,ieQuoteVersion:source.version,scopeAcknowledged:true,mappings:quote.lines.map(l=>({customerLineId:l.id,ieLineId:mappings[l.id]})),toolingMappings:chargeTools.map(t=>({toolingId:t.toolingId,customerChargeId:tools[t.toolingId]}))})}>采用此工程版本，保留业务客价</button>
   </>}
  </>}
  {error&&<p role="alert">{error}</p>}
  {quote.id&&quote.ieSource&&quote.status!=='confirmed'&&<div className="ieq-workspace"><IeQuoteNotificationPanel key={'sales-approval:'+quote.id} target="sales_approval" quote={{id:quote.id,version:quote.version,status:quote.status||'draft',quoteNo:quote.quoteNo||'客户报价'}} memberId={memberId} disabled={disabled||!!quote.ieSourceStale||!!quote.ieSourceUnavailable} disabledMessage={quote.ieSourceStale?'工程依据已有新版，请重新核对并采用后再通知总经理。':quote.ieSourceUnavailable?'工程依据当前不可读取，请核对后再通知总经理。':undefined} onDirtyChange={onDirtyChange}/></div>}
 </section>;
}
function IeReferenceDetails({reference:r}:{reference:NonNullable<SalesDraft['ieReference']>}){
 return <div>{r.lines.map(l=>{const c=r.costs.lines.find(c=>c.lineId===l.id);return <section key={l.id} style={{margin:'18px 0'}}><h4>{l.model} · {l.color} · {l.quantityMin}–{l.quantityMax} 副</h4><p>图纸 {l.drawingNo} / {l.drawingRevision}；结构：{l.structureNotes}；范围：{l.scopeNotes}</p><p>材料净额 {money(c?.material)} + 分项损耗 {money(c?.materialLoss)} + 工序 {money(c?.process)} + 电镀 {money(c?.plating)} + 一般外发 {money(c?.outsourcing)} + 间接 {money(c?.indirect)} = 生产成本 CNY {money(c?.productionCost)}；× 1.3 = 出厂价 CNY {money(c?.factoryPriceCny)} / USD {money(c?.factoryPriceUsd)}</p><table><thead><tr><th>材料 / 规格</th><th>基价 × 用量 × 系数</th><th>损耗</th><th>依据 / 说明</th></tr></thead><tbody>{l.materials.map(m=><tr key={m.id}><td>{m.name} · {m.specification}（{m.unit}）</td><td>{m.notApplicable?'不适用':`${money(m.basePrice)} × ${m.usage??'待定'} × ${m.coefficient??'待定'}`}</td><td>正常 10% + 本项额外 {Number((((m.lossRate??.1)-.1)*100).toFixed(4))} 个百分点 = 本项总损耗 {Number(((m.lossRate??.1)*100).toFixed(4))}% · {m.lossAdjustmentReason}</td><td>{m.priceSource} {m.notes}</td></tr>)}</tbody></table><table><thead><tr><th>工序</th><th>基价 × 难度</th><th>标准秒数</th><th>依据</th></tr></thead><tbody>{l.processes.map(p=><tr key={p.id}><td>{p.sequence}. {p.name}</td><td>{p.notApplicable?'不适用':`${money(p.basePrice)} × ${p.difficulty??'待定'}`}</td><td>{p.standardSeconds??'待填'}</td><td>{p.priceSource} {p.notes}</td></tr>)}</tbody></table><p>外发：{l.outsourcing.map(o=>`${o.category==='plating'?'电镀':'一般外发'} / ${o.name}：${o.notApplicable?'不适用':money(o.unitPrice)}（${o.priceSource} ${o.notes}）`).join('；')}</p></section>;})}<p>一次性费用：{r.tooling.map(t=>`${t.name} · ${t.chargeMode} · CNY ${money(t.amount)} · ${t.evidence||t.notes}`).join('；')}</p></div>;
}
