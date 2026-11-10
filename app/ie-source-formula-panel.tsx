'use client';
import type {ReactNode} from 'react';
import {ExcelTable} from './excel-table';
import type {Costs,Quote,SourceFormulaDraft} from './ie-quote-panel';
import {IE_OFFLINE_CONFIRMED_LABEL,isIeOfflineConfirmed} from './ie-quote-confirmation';
import './ie-source-formula.css';

const price=(value:number|null|undefined)=>value==null||!Number.isFinite(value)?'待计算':value.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
const defaults=():SourceFormulaDraft=>({version:'ie-source-excel-v1',sourceFilename:'',sourceSha256:'',costExchangeRateCnyPerUsd:6.5,quoteExchangeRateCnyPerUsd:6.5,finalExchangeRateCnyPerUsd:6.5,factoryMarkupRate:0.3,resultBasis:'source-C73-D73'});
function Field({label,children}:{label:string;children:ReactNode}){return <label className="ieq-field"><span>{label}</span>{children}</label>;}

export function IeSourceFormulaPanel({quote,costs,editable,dirty,selectedLineId,onChange,onSelectLine}:{quote:Quote;costs:Costs|null;editable:boolean;dirty:boolean;selectedLineId?:string;onChange:(values:Partial<Quote>)=>void;onSelectLine:(id:string)=>void}){
 const source=quote.calculationMode==='source-excel-v1',formula=quote.sourceFormula||defaults();
 const reviewed=quote.status==='released',offlineConfirmed=isIeOfflineConfirmed(quote,dirty),confirmationLabel=offlineConfirmed?IE_OFFLINE_CONFIRMED_LABEL:reviewed?'工程已复核':'待 IE 审核';
 const rateValues=[formula.costExchangeRateCnyPerUsd,formula.quoteExchangeRateCnyPerUsd,formula.finalExchangeRateCnyPerUsd].map(value=>value==null||value===''?null:Number(value));
 const uniformRate=rateValues.every(value=>value!==null&&value===rateValues[0])?rateValues[0]:null;
 const changeFormula=(values:Partial<SourceFormulaDraft>)=>onChange({sourceFormula:{...formula,...values},costs:undefined});
 const changeMode=(mode:string)=>onChange({calculationMode:mode==='source-excel-v1'?'source-excel-v1':'standard',...(mode==='source-excel-v1'?{sourceFormula:formula,...(uniformRate!==null?{exchangeRateCnyPerUsd:uniformRate}:{})}:{}),costs:undefined});
 const changeUnifiedRate=(value:string)=>onChange({exchangeRateCnyPerUsd:value,sourceFormula:{...formula,costExchangeRateCnyPerUsd:value,quoteExchangeRateCnyPerUsd:value,finalExchangeRateCnyPerUsd:value},costs:undefined});

 return <section className="ieq-card ieq-source-formula" aria-label="源Excel公式报价">
  <div className="ieq-source-heading">
   <div><h3>{source?(offlineConfirmed||reviewed?'最终工厂报价':'最终工厂报价（待 IE 审核）'):'报价计算方式'}</h3><p>{source?(uniformRate!==null?offlineConfirmed?'按原表公式生成，工程主管已在线下确认当前版本。':'按原表公式，汇率已统一。IE 工程师可继续审核和修改。':'原保存版本的三条汇率尚未统一，填写统一汇率后保存重算。'):'可使用标准核价，或按原 Excel 公式先生成报价，再由 IE 审核和修改。'}</p></div>
   <fieldset disabled={!editable}><Field label="报价计算方式"><select aria-label="报价计算方式" value={source?'source-excel-v1':'standard'} onChange={event=>changeMode(event.target.value)}><option value="standard">标准核价</option><option value="source-excel-v1">按原 Excel 公式生成报价</option></select></Field></fieldset>
  </div>
  {source&&<>
   <div className="ieq-source-status" role="status"><strong>{offlineConfirmed||reviewed?confirmationLabel:'待 IE 审核和修改'}</strong><span>{dirty?'保存后生成新版本，以下为当前填写值的计算结果。':'当前保存版本的系统计算结果。'}空白费用按原表公式作为 0 参与计算，原始空值与待核事项仍保留。</span></div>
   <ExcelTable className="ieq-source-result" aria-label="系统生成报价总表">
    <thead><tr><th>厂款 / 客款</th><th>生产成本 CNY / 副</th><th>成本加价后人民币 I66</th><th>最终报价 USD / 副 C73</th><th>最终报价 CNY / 副 D73</th><th>审核状态</th></tr></thead>
    <tbody>{quote.lines.map(line=>{const cost=costs?.lines.find(item=>item.lineId===line.id);return <tr key={line.id}>
     <td><button type="button" className="ieq-source-line-link" aria-pressed={selectedLineId===line.id} onClick={()=>onSelectLine(line.id)}>{line.model||'厂款待填写'}{line.customerModel?' / '+line.customerModel:''}</button></td>
     <td>{price(cost?.productionCost)}</td><td>{price(cost?.sourceMarkupPriceCny)}</td><td>{price(cost?.factoryPriceUsd)}</td><td>{price(cost?.factoryPriceCny)}</td><td>{confirmationLabel}</td>
    </tr>;})}</tbody>
   </ExcelTable>
   <details className="ieq-source-config" open>
    <summary>源表公式与参数</summary>
    <p>{uniformRate!==null?'生产成本 H62 汇总材料、损耗、人工、间接费用、电镀及外发；I66 = H62 ×（1 + 成本加价率）。成本美元 H63 = H62 ÷ 统一汇率；美元报价 C73 = I66 ÷ 统一汇率；最终人民币 D73 = C73 × 统一汇率。':'当前版本仍按下方保存的各路径汇率计算；I66 = H62 ×（1 + 成本加价率），H63 = H62 ÷ 成本汇率，C73 = I66 ÷ 报价汇率，D73 = C73 × 回算汇率。填写统一汇率并保存后，三条路径使用同一数值。'}</p>
    <fieldset disabled={!editable}><div className="ieq-form-grid">
     <Field label="统一汇率 · 1 USD = x CNY"><input aria-label="统一汇率 · 1 USD = x CNY" type="number" step="any" min="0.000001" value={uniformRate??''} placeholder="统一填写三条公式路径" onChange={event=>changeUnifiedRate(event.target.value)}/></Field>
     <Field label="成本加价率（%）"><input aria-label="成本加价率（%）" type="number" min="0" step="any" value={formula.factoryMarkupRate==null||formula.factoryMarkupRate===''?'':Number(formula.factoryMarkupRate)*100} onChange={event=>changeFormula({factoryMarkupRate:event.target.value===''?null:Number(event.target.value)/100})}/></Field>
    </div></fieldset>
    <p className="ieq-help">统一汇率同时更新成本美元、美元报价及人民币回算三条路径。IE 可修改单价、用量、难度和公式参数，保存后重新计算并留存新版本。</p>
    <details className="ieq-source-metadata"><summary>查看公式路径的保存汇率</summary><dl className="ieq-source-rate-paths"><dt>成本美元 H63</dt><dd>{formula.costExchangeRateCnyPerUsd??'未填写'}</dd><dt>美元报价 I67 / C73</dt><dd>{formula.quoteExchangeRateCnyPerUsd??'未填写'}</dd><dt>人民币回算 D73</dt><dd>{formula.finalExchangeRateCnyPerUsd??'未填写'}</dd></dl></details>
    <details className="ieq-source-metadata"><summary>来源引用（文件名及原件摘要）</summary><fieldset disabled={!editable}><div className="ieq-form-grid">
     <Field label="来源文件名"><input aria-label="来源文件名" value={formula.sourceFilename} placeholder="原 Excel 文件名" onChange={event=>changeFormula({sourceFilename:event.target.value})}/></Field>
     <Field label="来源引用 SHA-256"><input aria-label="来源引用 SHA-256" value={formula.sourceSha256} maxLength={64} placeholder="64 位原件摘要" onChange={event=>changeFormula({sourceSha256:event.target.value.trim().toLowerCase()})}/></Field>
    </div></fieldset><p className="ieq-help">文件名与摘要是来源引用，未表示中台已验证该工作簿。</p></details>
   </details>
  </>}
 </section>;
}
