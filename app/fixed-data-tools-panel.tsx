'use client';
import {ExcelTable} from './excel-table';

import {useEffect,useRef,useState} from 'react';
import {Check,Download,FileSpreadsheet,History,RefreshCw,ShieldCheck} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {clientId} from '@/lib/client-id';
import {canUseFixedDataTools} from '@/lib/fixed-data-tools-access';
import {businessTeamFetch} from './business-team-client';
import {dateTime,Input} from './ui';
import type {Data} from './workspace';
import './fixed-data-tools-panel.css';

type Customer={id:string;customer:string;customerCode:string};
type Member={id:string;name:string};
type QuoteSummary={id:string;version:number;customerName:string;quoteNo?:string};
type FeeLine={id:string;model:string;descriptionZh?:string;descriptionEn?:string;toolingFee:number|null};
type FeeCharge={id:string;labelZh:string;labelEn?:string;amount:number|null};
type FeeQuote=QuoteSummary&{currency:string;customerAccountId:string;customerCode:string;lines:FeeLine[];customerCharges:FeeCharge[]};
type FeePreview={quoteId:string;quoteNo:string;currency:string;customerName:string;customerCode:string;fromVersion:number;expiresAt:string;lines:Array<Omit<FeeLine,'toolingFee'>&{before:number|null;after:number|null}>;customerCharges:Array<Omit<FeeCharge,'amount'>&{before:number|null;after:number|null}>};
type Cell={address:string;value:string|number|boolean|null;formula?:string|null;cachedValue?:string|number|boolean|null;cacheStatus?:string;unknown?:boolean;unknownReason?:string};
type WorkbookResult={operation:'inspect'|'rows';sheets:Array<{name:string;state:string;dimension:string|null;rows:number;columns:number;formulaCells:number;missingFormulaCaches:number;errorCells:number}>;warnings:string[];selection?:{sheet:string;range:string;headerRow:number;headers:Cell[]};rows?:Array<{row:number;cells:Cell[]}>;returnedRows?:number;omittedEmptyRows?:number};
type OwnershipPreview={customerCount:number;memberCount:number;customersWithoutExplicitOwnership:number;customers:Array<Customer&{salesMembers:Member[];serviceMembers:Member[];salesStatus?:'explicit'|'unconfirmed';serviceStatus?:'explicit'|'unconfirmed';ownershipStatus:'explicit'|'unconfirmed'}>};
type Job={id:string;requestKey?:string;operation:string;status:'pending'|'completed'|'rejected'|'deferred';createdAt:string;expiresAt?:string;previewHash?:string;preview?:unknown;receipt?:unknown;filename?:string;hasSource:boolean;hasResult:boolean;resultHash?:string};
type Catalog={customers:Customer[];members:Member[];quotes:QuoteSummary[];jobs:Job[]};
type Tab='workbook'|'ownership'|'fees';
type UnknownRequest={requestKey:string;label:string};
const blankCatalog:Catalog={customers:[],members:[],quotes:[],jobs:[]};
const statusLabels:Record<Job['status'],string>={pending:'待人工确认',completed:'已完成',rejected:'已拒绝',deferred:'已暂缓'};
const amount=(value:number|null|undefined)=>value==null?'待确认':String(value);
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const operationLabel=(value:string)=>value.includes('fee')?'草稿费用维护':value.includes('ownership')?'客户归属导出':value.includes('row')?'表格范围提取':value.includes('inspect')||value.includes('workbook')?'表格检查':value;
function feePreview(value:unknown):value is FeePreview{return record(value)&&typeof value.quoteId==='string'&&typeof value.fromVersion==='number'&&Array.isArray(value.lines)&&Array.isArray(value.customerCharges);}
function workbookResult(value:unknown):value is WorkbookResult{return record(value)&&['inspect','rows'].includes(String(value.operation))&&Array.isArray(value.sheets);}
function ownershipPreview(value:unknown):value is OwnershipPreview{return record(value)&&typeof value.customerCount==='number'&&Array.isArray(value.customers);}
class ToolRequestError extends Error{constructor(message:string,readonly status=0){super(message);}}
async function api<T>(action:string,body?:unknown):Promise<T>{
 let response:Response;
 try{response=await businessTeamFetch('/api/workspace/'+action,{method:body===undefined?'GET':'POST',cache:'no-store',headers:body===undefined||body instanceof FormData?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});}catch{throw new ToolRequestError('连接中断，尚未确认本次处理结果。');}
 let result:unknown;try{result=await response.json();}catch{throw new ToolRequestError('服务器没有返回完整结果。',response.ok?0:response.status);}
 if(!response.ok)throw new ToolRequestError(record(result)&&typeof result.error==='string'?result.error:'操作未完成，请核对任务状态。',response.status);
 return result as T;
}
function cellText(cell:Cell){
 if(cell.formula!=null)return cell.cacheStatus==='missing'?'公式结果待核查':`缓存：${cell.cachedValue==null?'空白':String(cell.cachedValue)}`;
 if(cell.unknown)return '待核查';
 return cell.value==null?'空白':String(cell.value);
}
function WorkbookPreview({value}:{value:WorkbookResult}){
 return <div className="fixed-tools-preview">
  <div className="fixed-tools-table"><ExcelTable><caption>工作表检查结果</caption><thead><tr><th>工作表</th><th>可见性</th><th>记录范围</th><th>行 / 列</th><th>公式</th><th>待核查公式 / 错误单元格</th></tr></thead><tbody>{value.sheets.map(sheet=><tr key={sheet.name}><td>{sheet.name}</td><td>{sheet.state==='visible'?'可见':sheet.state==='veryHidden'?'深度隐藏':'隐藏'}</td><td>{sheet.dimension||'空白'}</td><td>{sheet.rows} / {sheet.columns}</td><td>{sheet.formulaCells}</td><td>{sheet.missingFormulaCaches} / {sheet.errorCells}</td></tr>)}</tbody></ExcelTable></div>
  {!!value.warnings?.length&&<ul className="fixed-tools-warnings">{value.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul>}
  {value.selection&&<><p className="fixed-tools-hint">{value.selection.sheet} · {value.selection.range} · 返回 {value.returnedRows??value.rows?.length??0} 行，跳过 {value.omittedEmptyRows??0} 个空行。公式显示已有缓存，未重新计算。</p><div className="fixed-tools-table"><ExcelTable><caption>提取结果预览（最多显示前 20 行）</caption><thead><tr><th>原行号</th>{(value.selection.headers?.length?value.selection.headers:value.rows?.[0]?.cells||[]).map((cell,index)=><th key={cell.address||index}>{value.selection!.headerRow>0?cellText(cell):cell.address.replace(/\d+$/,'')}</th>)}</tr></thead><tbody>{(value.rows||[]).slice(0,20).map(row=><tr key={row.row}><th>{row.row}</th>{row.cells.map(cell=><td key={cell.address} title={[cell.address,cell.formula?`公式：${cell.formula}`:'',cell.unknownReason||''].filter(Boolean).join(' · ')} className={cell.unknown||cell.cacheStatus==='missing'?'fixed-tools-unknown':undefined}>{cellText(cell)}</td>)}</tr>)}</tbody></ExcelTable></div></>}
 </div>;
}
function FeeItemLabel({name,id,description}:{name:string;id:string;description?:string}){
 return <><strong>{name}</strong>{description&&<small className="fixed-tools-item-detail">{description}</small>}<small className="fixed-tools-item-detail">行编号：{id}</small></>;
}
function FeeChanges({preview}:{preview:FeePreview}){
 const rows=[...preview.lines.map(line=>({key:'line-'+line.id,id:line.id,label:line.model||line.id,description:[line.descriptionZh,line.descriptionEn].filter(Boolean).join(' / '),kind:'模具费',before:line.before,after:line.after})),...preview.customerCharges.map(charge=>({key:'charge-'+charge.id,id:charge.id,label:charge.labelZh||charge.labelEn||charge.id,description:charge.labelEn||'',kind:'附加费用',before:charge.before,after:charge.after}))].filter(row=>row.before!==row.after);
 return <><p><strong>{preview.customerName} · {preview.quoteNo}</strong> · 原版本 {preview.fromVersion} · {preview.currency}</p><div className="fixed-tools-table"><ExcelTable><caption>本次费用变化</caption><thead><tr><th>项目</th><th>费用</th><th>原值</th><th>拟修改为</th></tr></thead><tbody>{rows.map(row=><tr key={row.key}><td><FeeItemLabel name={row.label} id={row.id} description={row.description}/></td><td>{row.kind}</td><td>{amount(row.before)}</td><td><strong>{amount(row.after)}</strong></td></tr>)}{!rows.length&&<tr><td colSpan={4}>没有费用变化。</td></tr>}</tbody></ExcelTable></div></>;
}
function OwnershipResults({preview}:{preview:OwnershipPreview}){
 const names=(members:Member[],status?:'explicit'|'unconfirmed')=>members.length?members.map(member=>member.name).join('、')+(status==='explicit'?'':'（待核对）'):status==='explicit'?'未分配':'待核对';
 return <div className="fixed-tools-preview"><p>本次导出 {preview.customerCount} 个客户、{preview.memberCount} 位责任人员；{preview.customersWithoutExplicitOwnership} 个客户的明确归属仍待核查。</p><div className="fixed-tools-table"><ExcelTable><caption>所选客户责任归属</caption><thead><tr><th>客户</th><th>客户代码</th><th>业务负责人</th><th>客服负责人</th><th>归属状态</th></tr></thead><tbody>{preview.customers.map(customer=><tr key={customer.id}><td>{customer.customer}</td><td>{customer.customerCode||'未登记'}</td><td>{names(customer.salesMembers,customer.salesStatus)}</td><td>{names(customer.serviceMembers,customer.serviceStatus)}</td><td>{customer.ownershipStatus==='explicit'?'已有明确归属':'待核查'}</td></tr>)}</tbody></ExcelTable></div></div>;
}

export function FixedDataToolsPanel({data}:{data:Data}){
 if(!canUseFixedDataTools(data.me))return null;
 return <FixedToolsWorkspace key={data.me.id} actorId={data.me.id}/>;
}

function FixedToolsWorkspace({actorId}:{actorId:string}){
 const [catalog,setCatalog]=useState<Catalog>(blankCatalog),[tab,setTab]=useState<Tab>('workbook');
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[denied,setDenied]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [selectedJob,setSelectedJob]=useState<Job|null>(null),[approvedReview,setApprovedReview]=useState(false),[decisionNeedsRefresh,setDecisionNeedsRefresh]=useState(false),[unknownRequest,setUnknownRequest]=useState<UnknownRequest|null>(null);
 const [file,setFile]=useState<File|null>(null),[operation,setOperation]=useState<'inspect'|'rows'>('inspect'),[sheet,setSheet]=useState(''),[range,setRange]=useState(''),[headerRow,setHeaderRow]=useState('1'),[includeEmpty,setIncludeEmpty]=useState(false);
 const [customerIds,setCustomerIds]=useState<string[]>([]),[memberIds,setMemberIds]=useState<string[]>([]),[customerSearch,setCustomerSearch]=useState('');
 const [quoteId,setQuoteId]=useState(''),[quote,setQuote]=useState<FeeQuote|null>(null),[lineFees,setLineFees]=useState<Record<string,string>>({}),[chargeFees,setChargeFees]=useState<Record<string,string>>({});
 const [now,setNow]=useState(()=>Date.now());
 const busyRef=useRef(false),mounted=useRef(false),fileInput=useRef<HTMLInputElement>(null);
 const submitBlocked=busy||loading||denied||!!unknownRequest;
 const acceptJob=(job:Job)=>{setSelectedJob(job);setApprovedReview(false);setCatalog(current=>({...current,jobs:[job,...current.jobs.filter(item=>item.id!==job.id)]}));};
 const reportError=(cause:unknown)=>{
  const message=cause instanceof Error?cause.message:'操作未完成，请核对任务状态。';
  if(cause instanceof ToolRequestError&&[401,403].includes(cause.status)){setDenied(true);setCatalog(blankCatalog);setSelectedJob(null);setQuote(null);setLineFees({});setChargeFees({});setFile(null);if(fileInput.current)fileInput.current.value='';}
  setError(message);
 };
 const run=async(work:()=>Promise<void>)=>{if(busyRef.current)return;busyRef.current=true;setBusy(true);setError('');setNotice('');try{await work();}catch(cause){if(mounted.current)reportError(cause);}finally{busyRef.current=false;if(mounted.current)setBusy(false);}};
 const reload=async()=>{
  const result=await api<Catalog>('fixed-data-tools');if(!mounted.current)return;
  setCatalog(result);setDenied(false);setLoading(false);
  setCustomerIds(ids=>ids.filter(id=>result.customers.some(customer=>customer.id===id)));setMemberIds(ids=>ids.filter(id=>result.members.some(member=>member.id===id)));
  return result;
 };
 useEffect(()=>{mounted.current=true;void reload().catch(cause=>{if(mounted.current){reportError(cause);setLoading(false);}});const timer=window.setInterval(()=>setNow(Date.now()),15000);return()=>{mounted.current=false;window.clearInterval(timer);};},[actorId]);
 const refresh=()=>run(async()=>{await reload();setNotice('已刷新当前授权范围与任务记录。');});
 const refreshJob=(job:Job)=>run(async()=>{
  const result=await api<{job:Job}>('fixed-tool-job?id='+encodeURIComponent(job.id));if(!mounted.current)return;
  acceptJob(result.job);setDecisionNeedsRefresh(false);
  const recovered=result.job;
  if(recovered.status==='completed'&&feePreview(recovered.preview)&&quote?.id===recovered.preview.quoteId&&quote.version<=recovered.preview.fromVersion){setQuote(null);setQuoteId('');setLineFees({});setChargeFees({});await reload();setNotice('原费用任务已完成，旧版本编辑已清除。继续修改时请选择最新草稿。');}
  else setNotice('已读取原任务的当前结果。');
 });
 const recoverRequest=()=>{if(!unknownRequest)return;const pending=unknownRequest;void run(async()=>{try{const result=await api<{job:Job}>('fixed-tool-job?requestKey='+encodeURIComponent(pending.requestKey));if(!mounted.current)return;acceptJob(result.job);setUnknownRequest(null);setNotice('已找回原请求对应的任务，请查看下方结果。');}catch(cause){if(cause instanceof ToolRequestError&&cause.status===404)throw new ToolRequestError('尚未查到原请求的任务，不能据此判断它未执行。请保留请求编号交由维护人员核查，不要重新提交。',404);throw cause;}});};
 const submit=async(label:string,action:string,body:(requestKey:string)=>unknown)=>{
  if(submitBlocked||busyRef.current)return;
  const requestKey=clientId();
  await run(async()=>{try{const result=await api<{job:Job}>(action,body(requestKey));if(!mounted.current)return;acceptJob(result.job);setDecisionNeedsRefresh(false);setNotice(label+'已生成，请核对下方任务结果。');}catch(cause){if(!(cause instanceof ToolRequestError)||cause.status===0||cause.status>=500)setUnknownRequest({requestKey,label});throw cause;}});
 };
 const upload=()=>{
  if(!file){setError('请先选择 XLSX 文件。');return;}
  if(!/\.xlsx$/i.test(file.name)||file.size===0||file.size>10*1024*1024){setError('请选择大于 0 且不超过 10 MiB 的 XLSX 文件。');return;}
  if(operation==='rows'&&(!sheet.trim()||!range.trim())){setError('提取行数据需要明确的工作表名称和单元格范围。');return;}
  if(range.trim()&&!sheet.trim()){setError('指定范围时请同时填写工作表名称。');return;}
  if(!/^\d+$/.test(headerRow)){setError('表头行请填写非负整数；0 表示没有表头。');return;}
  void submit(operation==='rows'?'范围提取':'工作簿检查','fixed-tool-workbook',requestKey=>{const body=new FormData();body.set('file',file);body.set('operation',operation);body.set('requestKey',requestKey);if(sheet.trim())body.set('sheet',sheet.trim());if(range.trim())body.set('range',range.trim());body.set('headerRow',headerRow);body.set('includeEmpty',String(includeEmpty));return body;});
 };
 const exportOwnership=()=>{if(!customerIds.length||customerIds.length>100){setError('请明确选择 1 至 100 个客户。');return;}void submit('客户归属导出','fixed-tool-ownership',requestKey=>({requestKey,customerIds,memberIds}));};
 const loadQuote=(id:string)=>{
  setQuoteId(id);setQuote(null);setLineFees({});setChargeFees({});setSelectedJob(null);setApprovedReview(false);
  if(!id)return;
  void run(async()=>{const result=await api<{quote:FeeQuote}>('fixed-tool-quote?id='+encodeURIComponent(id));if(!mounted.current)return;setQuote(result.quote);setLineFees(Object.fromEntries(result.quote.lines.map(line=>[line.id,line.toolingFee==null?'':String(line.toolingFee)])));setChargeFees(Object.fromEntries(result.quote.customerCharges.map(charge=>[charge.id,charge.amount==null?'':String(charge.amount)])));});
 };
 const feesDirty=!!quote&&(quote.lines.some(line=>(lineFees[line.id]??'')!==(line.toolingFee==null?'':String(line.toolingFee)))||quote.customerCharges.some(charge=>(chargeFees[charge.id]??'')!==(charge.amount==null?'':String(charge.amount))));
 const previewFees=()=>{
  if(!quote||!feesDirty)return;
  const numeric=(value:string|undefined)=>value?.trim()?Number(value):null;
  const lines=quote.lines.map(line=>({id:line.id,toolingFee:numeric(lineFees[line.id])})),customerCharges=quote.customerCharges.map(charge=>({id:charge.id,amount:numeric(chargeFees[charge.id])}));
  if([...lines.map(line=>line.toolingFee),...customerCharges.map(charge=>charge.amount)].some(value=>value!==null&&(!Number.isFinite(value)||value<0))){setError('费用应为非负数字；未确认留空，免收请明确填写 0。');return;}
  void submit('费用变更预览','fixed-tool-fees-preview',requestKey=>({requestKey,quoteId:quote.id,version:quote.version,lines,customerCharges}));
 };
 const changeFee=(kind:'line'|'charge',id:string,value:string)=>{(kind==='line'?setLineFees:setChargeFees)(current=>({...current,[id]:value}));setSelectedJob(null);setApprovedReview(false);};
 const decide=(decision:'approve'|'reject'|'defer')=>{
  if(!selectedJob||!feePreview(selectedJob.preview)||!selectedJob.previewHash||selectedJob.status!=='pending'||decisionNeedsRefresh||busyRef.current)return;
  const deadline=Date.parse(selectedJob.expiresAt||selectedJob.preview.expiresAt);
  if(decision==='approve'&&(!approvedReview||!Number.isFinite(deadline)||deadline<=Date.now()))return;
  const job=selectedJob;
  void run(async()=>{try{const result=await api<{job:Job}>('fixed-tool-fees-decision',{id:job.id,previewHash:job.previewHash,decision});if(!mounted.current)return;acceptJob(result.job);setNotice(decision==='approve'?'本次费用变更已执行，请核对任务回执。':decision==='reject'?'已拒绝这份变更，未执行费用修改。':'已暂缓，继续处理时请读取最新报价并重新生成预览。');if(decision==='approve'){setQuote(null);setQuoteId('');setLineFees({});setChargeFees({});}await reload();}catch(cause){setDecisionNeedsRefresh(true);throw cause;}});
 };
 const download=(job:Job,artifact:'source'|'result')=>run(async()=>{
  let response:Response;try{response=await businessTeamFetch('/api/workspace/fixed-tool-file?id='+encodeURIComponent(job.id)+'&artifact='+artifact,{cache:'no-store'});}catch{throw new ToolRequestError('下载连接中断，请核对网络后重新下载。');}
  if(!response.ok){const result:unknown=await response.json().catch(()=>null);throw new ToolRequestError(record(result)&&typeof result.error==='string'?result.error:'当前无法下载该产物。',response.status);}
  const blob=await response.blob();if(!mounted.current)return;const url=URL.createObjectURL(blob),link=document.createElement('a');let filename=artifact==='source'?job.filename||'原始工作簿.xlsx':'处理结果.json';
  const encoded=response.headers.get('Content-Disposition')?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];try{if(encoded)filename=decodeURIComponent(encoded);}catch{/* Keep the safe fallback filename. */}
  link.href=url;link.download=filename;link.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
 });
 const preview=selectedJob?.preview,isFeePreview=feePreview(preview),expiry=selectedJob?.expiresAt||(isFeePreview?preview.expiresAt:undefined),expiryTime=expiry?Date.parse(expiry):NaN,expired=isFeePreview&&(!Number.isFinite(expiryTime)||expiryTime<=now);
 const visibleCustomers=catalog.customers.filter(customer=>[customer.customer,customer.customerCode].join(' ').toLowerCase().includes(customerSearch.trim().toLowerCase()));
 return <details className="fixed-tools" open>
  <summary><span><ShieldCheck size={18}/><strong>固定程序工具</strong></span><small>文件检查、客户归属导出、草稿费用维护</small></summary>
  <div className="fixed-tools-body">
   <div className="fixed-tools-intro"><p>选择明确范围后运行程序。费用变更先生成差异，由你确认后执行。</p><Button variant="outline" size="sm" onClick={refresh} disabled={busy}><RefreshCw size={14}/>刷新任务</Button></div>
   {error&&<div className="fixed-tools-error" role="alert">{error}{decisionNeedsRefresh&&' 请先刷新下方原任务，核对是否已经执行。'}</div>}
   {notice&&<p className="fixed-tools-notice" role="status">{notice}</p>}
   {unknownRequest&&<div className="fixed-tools-warning" role="status"><strong>{unknownRequest.label}的结果尚未确认。</strong><p>请求编号：<code>{unknownRequest.requestKey}</code></p><p>请查询原请求并核对任务；当前已暂停新建操作，避免重复提交。</p><Button variant="outline" size="sm" disabled={busy||denied} onClick={recoverRequest}>查询原请求结果</Button></div>}
   {denied?<p>当前账号已无法访问固定工具，页面中的任务内容已清除。</p>:<>
    <div className="fixed-tools-tabs" role="tablist" aria-label="固定程序工具"><button role="tab" aria-selected={tab==='workbook'} onClick={()=>setTab('workbook')}>1. 表格检查与提取</button><button role="tab" aria-selected={tab==='ownership'} onClick={()=>setTab('ownership')}>2. 客户归属导出</button><button role="tab" aria-selected={tab==='fees'} onClick={()=>setTab('fees')}>3. 草稿费用维护</button></div>
    {loading?<p role="status">正在读取工具及当前权限范围…</p>:<div className="fixed-tools-form">
     {tab==='workbook'&&<>
      <label className="fixed-tools-field">选择工作簿<input ref={fileInput} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={submitBlocked} onChange={event=>setFile(event.target.files?.[0]||null)}/><small>XLSX，最大 10 MiB。原文件保留，可下载处理结果。</small></label>
      <div className="fixed-tools-fields"><label className="fixed-tools-field">处理方式<select value={operation} disabled={submitBlocked} onChange={event=>setOperation(event.target.value as 'inspect'|'rows')}><option value="inspect">检查工作簿结构</option><option value="rows">提取指定范围行数据</option></select></label><label className="fixed-tools-field">工作表名称{operation==='rows'?'（必填）':'（可选）'}<Input value={sheet} disabled={submitBlocked} onChange={event=>setSheet(event.target.value)} placeholder="与原表工作表名称一致"/></label><label className="fixed-tools-field">单元格范围{operation==='rows'?'（必填）':'（可选）'}<Input value={range} disabled={submitBlocked} onChange={event=>setRange(event.target.value)} placeholder="例如 A1:H50"/></label>{operation==='rows'&&<label className="fixed-tools-field">表头行（0 表示无表头）<Input type="number" min={0} step={1} value={headerRow} disabled={submitBlocked} onChange={event=>setHeaderRow(event.target.value)}/></label>}</div>
      {operation==='rows'&&<label className="fixed-tools-checkbox"><input type="checkbox" checked={includeEmpty} disabled={submitBlocked} onChange={event=>setIncludeEmpty(event.target.checked)}/>保留范围内的空行</label>}
      <p className="fixed-tools-hint">先检查可查看工作表名称。提取范围最多 1000 行、100 列、10000 个单元格；公式显示缓存与未知项。</p><Button onClick={upload} disabled={submitBlocked||!file}><FileSpreadsheet size={15}/>{operation==='inspect'?'检查工作簿':'生成范围提取结果'}</Button>
     </>}
     {tab==='ownership'&&<>
      <div className="fixed-tools-fields"><label className="fixed-tools-field">查找客户<Input value={customerSearch} onChange={event=>setCustomerSearch(event.target.value)} placeholder="客户名称或代码"/></label><p className="fixed-tools-hint">已选 {customerIds.length} 个客户，最多 100 个。仅导出你明确选定且有权限的客户。</p></div>
      <fieldset className="fixed-tools-choices" disabled={submitBlocked}><legend>选择客户（必选）</legend>{visibleCustomers.map(customer=><label key={customer.id}><input type="checkbox" checked={customerIds.includes(customer.id)} disabled={!customerIds.includes(customer.id)&&customerIds.length>=100} onChange={event=>setCustomerIds(ids=>event.target.checked?[...ids,customer.id]:ids.filter(id=>id!==customer.id))}/><span>{customer.customer}{customer.customerCode&&<small>{customer.customerCode}</small>}</span></label>)}{!visibleCustomers.length&&<p>没有匹配的授权客户。</p>}</fieldset>
      <details className="fixed-tools-member-filter"><summary>按责任人员进一步缩小范围（可选，已选 {memberIds.length} 人）</summary><fieldset className="fixed-tools-choices" disabled={submitBlocked}><legend>责任人员筛选</legend>{catalog.members.map(member=><label key={member.id}><input type="checkbox" checked={memberIds.includes(member.id)} onChange={event=>setMemberIds(ids=>event.target.checked?[...ids,member.id]:ids.filter(id=>id!==member.id))}/>{member.name}</label>)}</fieldset></details>
      <Button onClick={exportOwnership} disabled={submitBlocked||!customerIds.length}>生成客户归属导出</Button>
     </>}
     {tab==='fees'&&<>
      <label className="fixed-tools-field">选择一张既有草稿<select value={quoteId} disabled={submitBlocked} onChange={event=>loadQuote(event.target.value)}><option value="">请选择草稿报价</option>{catalog.quotes.map(item=><option key={item.id} value={item.id}>{item.customerName} · {item.quoteNo||'未编号'} · 版本 {item.version}</option>)}</select></label>
      {quote&&<><p><strong>{quote.customerName} · {quote.quoteNo}</strong> · 版本 {quote.version} · {quote.currency}</p><p className="fixed-tools-hint">仅调整已有模具费和附加费金额。空白保持待确认，免收填 0；先查看差异再确认。</p><div className="fixed-tools-table"><ExcelTable><caption>既有费用项目</caption><thead><tr><th>项目</th><th>类型</th><th>当前金额</th><th>拟修改金额（{quote.currency}）</th></tr></thead><tbody>{quote.lines.map(line=><tr key={line.id}><td><FeeItemLabel name={line.model} id={line.id} description={[line.descriptionZh,line.descriptionEn].filter(Boolean).join(' / ')}/></td><td>模具费</td><td>{amount(line.toolingFee)}</td><td><Input aria-label={line.model+'（行 '+line.id+'）模具费'} type="number" min={0} step="any" value={lineFees[line.id]??''} placeholder="待确认" disabled={submitBlocked} onChange={event=>changeFee('line',line.id,event.target.value)}/></td></tr>)}{quote.customerCharges.map(charge=><tr key={charge.id}><td><FeeItemLabel name={charge.labelZh||charge.labelEn||charge.id} id={charge.id} description={charge.labelEn}/></td><td>附加费</td><td>{amount(charge.amount)}</td><td><Input aria-label={(charge.labelZh||charge.labelEn)+'（行 '+charge.id+'）金额'} type="number" min={0} step="any" value={chargeFees[charge.id]??''} placeholder="待确认" disabled={submitBlocked} onChange={event=>changeFee('charge',charge.id,event.target.value)}/></td></tr>)}</tbody></ExcelTable></div><Button onClick={previewFees} disabled={submitBlocked||!feesDirty}>生成费用差异预览</Button></>}
     </>}
    </div>}
    {selectedJob&&<section className="fixed-tools-job" aria-label="当前任务详情"><div className="fixed-tools-job-head"><div><h4>{operationLabel(selectedJob.operation)}</h4><p>{dateTime(selectedJob.createdAt)} · <span className={'fixed-tools-status is-'+selectedJob.status}>{statusLabels[selectedJob.status]||selectedJob.status}</span></p></div><Button variant="outline" size="sm" disabled={busy} onClick={()=>refreshJob(selectedJob)}><RefreshCw size={14}/>刷新原任务</Button></div>
     <p className="fixed-tools-job-id">任务编号：{selectedJob.id}</p>
     {isFeePreview?<FeeChanges preview={preview}/>:workbookResult(preview)?<WorkbookPreview value={preview}/>:ownershipPreview(preview)?<OwnershipResults preview={preview}/>:record(preview)&&<pre className="fixed-tools-json">{JSON.stringify(preview,null,2)}</pre>}
     {expiry&&<p className={expired&&selectedJob.status==='pending'?'fixed-tools-error':'fixed-tools-hint'}>预览有效至 {dateTime(expiry)}{expired&&selectedJob.status==='pending'?'，已过期，请读取最新报价并重新预览。':''}</p>}
     {isFeePreview&&selectedJob.status==='pending'&&<div className="fixed-tools-decision"><label className="fixed-tools-checkbox"><input type="checkbox" checked={approvedReview} disabled={busy||expired||decisionNeedsRefresh} onChange={event=>setApprovedReview(event.target.checked)}/>我已核对客户、报价版本和上方金额变化，同意执行这份变更。</label><div className="fixed-tools-actions"><Button disabled={busy||expired||!approvedReview||decisionNeedsRefresh||!selectedJob.previewHash} onClick={()=>decide('approve')}><Check size={15}/>确认并执行这份变更</Button><Button variant="outline" disabled={busy||decisionNeedsRefresh||!selectedJob.previewHash} onClick={()=>decide('reject')}>拒绝</Button><Button variant="outline" disabled={busy||decisionNeedsRefresh||!selectedJob.previewHash} onClick={()=>decide('defer')}>暂缓</Button></div></div>}
     {record(selectedJob.receipt)&&<div className="fixed-tools-receipt"><strong>任务回执</strong>{typeof selectedJob.receipt.version==='number'&&<p>保存版本：{selectedJob.receipt.version}</p>}{selectedJob.receipt.verified===true&&<p>执行结果已回读核验。</p>}{typeof selectedJob.receipt.committedAt==='string'&&<p>执行时间：{dateTime(selectedJob.receipt.committedAt)}</p>}<details><summary>查看回执摘要</summary><pre className="fixed-tools-json">{JSON.stringify(selectedJob.receipt,null,2)}</pre></details></div>}
     <div className="fixed-tools-actions">{selectedJob.hasSource&&<Button variant="outline" size="sm" disabled={busy} onClick={()=>download(selectedJob,'source')}><Download size={14}/>下载原始文件</Button>}{selectedJob.hasResult&&<Button variant="outline" size="sm" disabled={busy} onClick={()=>download(selectedJob,'result')}><Download size={14}/>下载处理结果</Button>}</div>
    </section>}
    <section className="fixed-tools-history"><h4><History size={16}/>最近任务</h4>{!catalog.jobs.length?<p className="fixed-tools-hint">暂无任务记录。完成的结果和待确认的费用变更会保留在这里。</p>:<div className="fixed-tools-table"><ExcelTable><thead><tr><th>创建时间</th><th>操作</th><th>状态</th><th>任务</th></tr></thead><tbody>{catalog.jobs.map(job=><tr key={job.id}><td>{dateTime(job.createdAt)}</td><td>{operationLabel(job.operation)}{job.filename&&<small className="fixed-tools-filename">{job.filename}</small>}</td><td>{statusLabels[job.status]||job.status}</td><td><Button variant="outline" size="sm" disabled={busy} onClick={()=>refreshJob(job)}>查看任务</Button></td></tr>)}</tbody></ExcelTable></div>}</section>
   </>}
  </div>
 </details>;
}
