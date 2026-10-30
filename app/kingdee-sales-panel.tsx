'use client';
import {ExcelTable} from './excel-table';
import {useEffect,useRef,useState} from 'react';
import {CheckCircle2,Download,FileSpreadsheet,RefreshCw,Save,ShieldCheck,UploadCloud} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from './ui';
import {businessTeamFetch,downloadBusinessTeamFile,getBusinessTeamScope} from './business-team-client';
import {useBusinessTeamScope} from './business-team-context';
import type {Data} from './workspace';
import type {KingdeeSalesData,KingdeeSalesInputs,KingdeeSalesLineInput,KingdeeSalesPublicDraft,KingdeeSalesStatus} from '@/lib/kingdee-sales-types';
import type {SalesOrderSource} from '@/lib/sales-order-sources';
import './kingdee-sales-panel.css';

const statusLabels:Record<KingdeeSalesStatus,string>={draft:'待补充核对',validated:'校验通过 · 待客服确认',confirmed:'客服已确认 · 待上传',uploading:'上传中 · 待回读',unknown:'结果待核查',uploaded:'已上传金蝶'};
const headFields:{key:Exclude<keyof KingdeeSalesInputs,'lines'|'taxMode'>;label:string;type?:string;placeholder?:string}[]=[
 {key:'billDate',label:'单据日期',type:'date'},{key:'customerNumber',label:'金蝶客户编码',placeholder:'与金蝶客户主档一致'},
 {key:'employeeName',label:'业务员名称'},{key:'currencyName',label:'币别名称',placeholder:'与金蝶币别名称一致'},
 {key:'exchangeRate',label:'汇率',placeholder:'请确认汇率'},{key:'businessType',label:'业务类型',placeholder:'与金蝶模板一致'},
 {key:'customerPO',label:'客户订单号 / PO'},{key:'remark',label:'整单备注'},
];
const lineFields:{key:Exclude<keyof KingdeeSalesLineInput,'sourceLineId'|'isFree'|'categoryCode'>;label:string;type?:string}[]=[
 {key:'drawing',label:'图纸编号'},{key:'customerModel',label:'客户型号'},{key:'finishCode',label:'板料 / 电镀颜色编码'},
 {key:'color',label:'色号'},{key:'quantity',label:'数量'},{key:'unitName',label:'单位名称'},
 {key:'unitPrice',label:'单价'},{key:'taxRate',label:'税率 %'},{key:'deliveryDate',label:'交货日期',type:'date'},{key:'remark',label:'分录备注'},
];

export function KingdeeSalesPanel({data,onDirtyChange,initialSourceId}:{data:Data;onDirtyChange?:(dirty:boolean)=>void;initialSourceId?:string}){
 const team=useBusinessTeamScope()?.teamId||'';
 return <KingdeeSalesWorkspace key={JSON.stringify([data.me.id,team,initialSourceId])} data={data} onDirtyChange={onDirtyChange} initialSourceId={initialSourceId}/>;
}

function KingdeeSalesWorkspace({data,onDirtyChange,initialSourceId}:{data:Data;onDirtyChange?:(dirty:boolean)=>void;initialSourceId?:string}){
 const [loaded,setLoaded]=useState<KingdeeSalesData|null>(null),[sourceId,setSourceId]=useState(initialSourceId||'');
 const [item,setItem]=useState<KingdeeSalesPublicDraft|null>(null),[inputs,setInputs]=useState<KingdeeSalesInputs|null>(null);
 const [busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[ack,setAck]=useState(false),[loadFailed,setLoadFailed]=useState(false);
 const [preview,setPreview]=useState<{id:string;source:SalesOrderSource;warnings:string[];unmappedColumns:string[]}|null>(null),[importAck,setImportAck]=useState(false);
 const mounted=useRef(true),operation=useRef(false),sequence=useRef(0),controller=useRef<AbortController|null>(null);
 const dirty=!!inputs&&!!item&&JSON.stringify(inputs)!==JSON.stringify(item.inputs);
 const dirtyRef=useRef(dirty);dirtyRef.current=dirty;
 const selected=loaded?.sources.find(source=>source.id===sourceId),locked=!!item&&['uploading','unknown','uploaded'].includes(item.status);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;controller.current?.abort();sequence.current++;};},[]);
 useEffect(()=>{onDirtyChange?.(dirty||!!busy||!!preview);return()=>onDirtyChange?.(false);},[dirty,busy,preview,onDirtyChange]);
 useEffect(()=>{const prevent=(event:BeforeUnloadEvent)=>{if(dirty||operation.current||preview){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',prevent);return()=>window.removeEventListener('beforeunload',prevent);},[dirty,preview]);
 const adopt=(next:KingdeeSalesPublicDraft|null)=>{setItem(next);setInputs(next?structuredClone(next.inputs):null);setAck(false);};
 async function read(preferred=sourceId){
  controller.current?.abort();const current=new AbortController();controller.current=current;const ticket=++sequence.current;
  try{
   const response=await businessTeamFetch('/api/workspace/kingdee-sales-data',{cache:'no-store',signal:current.signal});
   const value=await response.json() as KingdeeSalesData&{error?:string};if(!response.ok)throw Error(value.error||'金蝶销售订单读取失败。');
   if(!mounted.current||ticket!==sequence.current)return;
   setLoadFailed(false);setLoaded(value);
   const target=value.sources.some(source=>source.id===preferred)?preferred:preferred?'':value.sources[0]?.id||'';
   setSourceId(target);if(!dirtyRef.current)adopt(value.drafts.find(draft=>draft.sourceId===target)||null);
   if(preferred&&!target)setError('指定原单不存在或已不在当前授权范围，请重新选择。');
  }catch(cause){if(!mounted.current||current.signal.aborted||ticket!==sequence.current)return;setLoaded(null);setLoadFailed(true);setError((cause as Error).message);}
 }
 useEffect(()=>{if(!dirtyRef.current&&!operation.current)void read(sourceId);},[data.revision]);
 async function post(action:string,payload:unknown,message:string){
  if(operation.current)return;operation.current=true;setBusy(action);setError('');setNotice('');
  try{
   const response=await businessTeamFetch('/api/workspace/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-Workspace-Team':getBusinessTeamScope()},body:JSON.stringify(payload)});
   const result=await response.json() as {item?:KingdeeSalesPublicDraft;sourceId?:string;error?:string};if(!response.ok)throw Error(result.error||'操作未完成。');
   if(!mounted.current)return;
   if(result.item){adopt(result.item);setLoaded(value=>value?{...value,drafts:[...value.drafts.filter(draft=>draft.id!==result.item!.id),result.item!]}:value);}
   if(result.sourceId){setPreview(null);setImportAck(false);setSourceId(result.sourceId);await read(result.sourceId);}
   setNotice(result.item?.status==='unknown'?'上传结果待核查，请点击“核查上传结果”。':result.item?.status==='uploaded'?'已回读核验金蝶销售订单。':message);
  }catch(cause){if(mounted.current){setError((cause as Error).message);if(action==='kingdee-sales-upload'||action==='kingdee-sales-reconcile')await read(sourceId);}}
  finally{operation.current=false;if(mounted.current)setBusy('');}
 }
 function select(id:string){if(dirty||busy||preview){setError('请先保存或放弃当前修改及上传预览，再切换订单。');return;}setSourceId(id);adopt(loaded?.drafts.find(draft=>draft.sourceId===id)||null);setError('');setNotice('');}
 const patchHead=(key:Exclude<keyof KingdeeSalesInputs,'lines'>,value:string)=>{setInputs(current=>current?{...current,[key]:value}:current);setAck(false);};
 const patchLine=(index:number,key:keyof KingdeeSalesLineInput,value:string|boolean)=>{setInputs(current=>current?{...current,lines:current.lines.map((line,i)=>i===index?{...line,[key]:value}:line)}:current);setAck(false);};
 async function download(){if(!item||busy||dirty)return;setBusy('export');setError('');try{await downloadBusinessTeamFile(`/api/workspace/kingdee-sales-export?id=${encodeURIComponent(item.id)}&version=${item.version}`,'金蝶销售订单.xlsx');if(mounted.current)setNotice('金蝶模板文件已生成并发起下载。');}catch(cause){if(mounted.current)setError((cause as Error).message);}finally{if(mounted.current)setBusy('');}}
 async function uploadTemplate(file:File){
  if(operation.current)return;operation.current=true;setBusy('template');setError('');
  try{const form=new FormData();form.set('file',file);const response=await businessTeamFetch('/api/workspace/kingdee-template',{method:'POST',headers:{'X-Workspace-Team':getBusinessTeamScope()},body:form});const value=await response.json() as {error?:string};if(!response.ok)throw Error(value.error||'模板保存失败。');if(mounted.current){setNotice('金蝶模板已保存，请重新校验订单。');await read(sourceId);}}catch(cause){if(mounted.current)setError((cause as Error).message);}finally{operation.current=false;if(mounted.current)setBusy('');}
 }
 async function previewSource(file:File){
  if(operation.current)return;operation.current=true;setBusy('source-preview');setError('');setNotice('');setPreview(null);setImportAck(false);
  try{const form=new FormData();form.set('file',file);const response=await businessTeamFetch('/api/workspace/kingdee-sales-source-preview',{method:'POST',headers:{'X-Workspace-Team':getBusinessTeamScope()},body:form});const result=await response.json() as {preview?:NonNullable<typeof preview>;error?:string};if(!response.ok||!result.preview)throw Error(result.error||'订单文件解析未完成。');if(mounted.current)setPreview(result.preview);}catch(cause){if(mounted.current)setError((cause as Error).message);}finally{operation.current=false;if(mounted.current)setBusy('');}
 }
 return <div className="kingdee-sales" data-testid="kingdee-sales-panel">
  <section className="kingdee-sales-hero"><div><span>SALES ORDER · KINGDEE</span><h2>金蝶销售订单</h2><p>从中英文订单生成销售订单，客服核对确认后上传金蝶。</p></div><UploadCloud size={42}/></section>
  <ol className="kingdee-sales-steps" aria-label="金蝶订单流程">{['选择中英文原单','生成编码并核对','客服确认订单','上传并核验回执'].map((label,index)=><li key={label} className={(index===0&&selected||index===1&&item||index===2&&item?.confirmation||index===3&&item?.status==='uploaded')?'complete':''}><b>{index+1}</b>{label}</li>)}</ol>
  {error&&<div className="error" role="alert">{error}</div>}{notice&&<div className="success" role="status">{notice}</div>}
  {!loaded&&<section className="panel section-pad"><p>{loadFailed?'暂时无法读取当前授权范围的订单。':'正在读取销售原单与金蝶订单…'}</p>{loadFailed&&<Button onClick={()=>void read()}>重新读取</Button>}</section>}
  {loaded&&<>
   <section className="panel section-pad kingdee-sales-source"><div className="kingdee-sales-heading"><div><h3>选择中英文销售原单</h3><p>按原单整单生成，样办数量单独核对。</p></div><Button variant="outline" disabled={!!busy||dirty} onClick={()=>void read()}><RefreshCw size={15}/>刷新</Button></div>
    <details className="kingdee-sales-import"><summary>上传新的中英文订单</summary><p>先下载标准中英文订单表，按固定栏目填写后上传预览。原客户文件请保留，待核对内容可先留空。</p><div className="row-actions"><Button variant="outline" disabled={!!busy} onClick={()=>void downloadBusinessTeamFile('/api/workspace/kingdee-sales-source-template','中英文订单上传模板.xlsx').catch(cause=>setError((cause as Error).message))}><Download size={16}/>下载中英文订单模板</Button><label>上传订单 Excel<input aria-label="上传中英文订单" type="file" accept=".xlsx" disabled={!!busy||dirty||!!preview} onChange={event=>{const file=event.target.files?.[0];if(file)void previewSource(file);event.target.value='';}}/></label></div></details>
    {preview&&<div className="kingdee-sales-import-preview"><h4>上传预览：{preview.source.orderNo}</h4><p>{preview.source.customer} · {preview.source.lines.length} 条明细 · {preview.source.source.filename}</p><div className="kingdee-sales-preview-table"><ExcelTable><thead><tr><th>原表行</th><th>图纸编号</th><th>客户型号</th><th>色号</th><th>数量</th><th>单位</th><th>单价</th></tr></thead><tbody>{preview.source.lines.map(line=><tr key={line.id}><td>{line.sourceRow}</td><td>{line.drawing||'待补齐'}</td><td>{line.model||'待补齐'}</td><td>{line.color||'待补齐'}</td><td>{line.quantity}</td><td>{line.unit}</td><td>{line.unitPrice||'待核对'}</td></tr>)}</tbody></ExcelTable></div><ul>{(preview.warnings||[]).map((warning,index)=><li key={index}>{warning}</li>)}</ul>{!!preview.unmappedColumns?.length&&<p>额外栏目保留为原始资料：{preview.unmappedColumns.join('、')}</p>}<label className="kingdee-sales-check"><input type="checkbox" checked={importAck} onChange={event=>setImportAck(event.target.checked)} disabled={!!busy}/>已核对上传预览，确认导入这些原单明细。</label><div className="row-actions"><Button disabled={!!busy||!importAck} onClick={()=>void post('kingdee-sales-source-commit',{id:preview.id,acknowledged:true},'原单已导入并生成金蝶草稿。')}>确认导入并生成草稿</Button><Button variant="outline" disabled={!!busy} onClick={()=>{setPreview(null);setImportAck(false);}}>取消本次导入</Button></div></div>}
    <div className="kingdee-sales-source-picker"><label>销售原单<select aria-label="选择中英文销售原单" value={sourceId} disabled={!!busy} onChange={event=>select(event.target.value)}><option value="">请选择订单</option>{loaded.sources.map(source=><option key={source.id} value={source.id}>{source.orderNo} · {source.customer} · {source.source.lines.length} 条</option>)}</select></label><Button disabled={!selected||!!item||!!busy} onClick={()=>void post('kingdee-sales-prepare',{sourceId},'已生成金蝶销售订单草稿，请补齐待核对项。')}><FileSpreadsheet size={16}/>生成金蝶销售订单</Button></div>
    {!loaded.sources.length&&<p className="kingdee-sales-hint">当前范围暂无销售原单，可展开“上传新的中英文订单”导入。</p>}
    {selected&&<details className="kingdee-sales-evidence"><summary>原单来源与待核对说明</summary><p>{selected.source.source.filename} · {selected.source.source.sheet} · {selected.source.source.detailRange}</p><ul>{selected.source.warnings.map((text,index)=><li key={index}>{text}</li>)}</ul><p>原单明细 {selected.source.lines.length} 条；生成草稿保留来源关联。</p></details>}
    <details className="kingdee-sales-evidence"><summary>金蝶导入模板：{loaded.template?.filename||'尚未上传'}</summary><p>{loaded.template?'生成文件沿用该模板字段；模板变更后须重新核对。':'请上传从金蝶导出的销售订单标准导入模板。'}</p>{['admin','pmc'].includes(data.me.role)&&<label>上传金蝶销售订单模板<input type="file" aria-label="上传金蝶销售订单模板" accept=".xlsx,.xls" disabled={!!busy||dirty} onChange={event=>{const file=event.target.files?.[0];if(file)void uploadTemplate(file);event.target.value='';}}/></label>}</details>
   </section>
   {item&&inputs&&<>
    <section className="panel section-pad"><div className="kingdee-sales-heading"><div><h3>{item.orderNo}</h3><p>{item.customer} · 草稿版本 {item.version}</p></div><span className={'kingdee-sales-status '+item.status}>{statusLabels[item.status]}</span></div>
     <fieldset disabled={!!busy||locked||!item.canPrepare}><div className="kingdee-sales-fields">{headFields.map(field=><label key={field.key}>{field.label}<Input aria-label={field.label} type={field.type||'text'} placeholder={field.placeholder} maxLength={field.key==='remark'?1000:160} value={inputs[field.key]} onChange={event=>patchHead(field.key,event.target.value)}/></label>)}<label>单价口径<select aria-label="单价口径" value={inputs.taxMode} onChange={event=>patchHead('taxMode',event.target.value)}><option value="">请选择计价方式</option><option value="exclusive">不含税单价</option><option value="inclusive">含税单价</option></select></label></div>
     <p className="kingdee-sales-rule">成品编码：类别 - 客户编码 - 图纸编号 - 客户型号 - 板料/电镀颜色编码 - 色号。缺项会列入核对清单。</p>
     <div className="kingdee-sales-table" tabIndex={0} aria-label="金蝶销售订单明细"><ExcelTable><thead><tr><th>原单行 / 原文</th><th>类别</th>{lineFields.map(field=><th key={field.key}>{field.label}</th>)}<th>赠品</th><th>成品编码预览</th></tr></thead><tbody>{inputs.lines.map((line,index)=>{const source=selected?.source.lines.find(row=>row.id===line.sourceLineId),parts=[line.categoryCode,inputs.customerNumber,line.drawing,line.customerModel,line.finishCode,line.color],code=parts.every(part=>part.trim())?parts.map(part=>part.trim()).join('-'):'';return <tr key={line.sourceLineId}><td><b>第 {source?.sourceRow??index+1} 行</b><small>{source?.drawing} / {source?.model} / {source?.color}</small><small>原数量 {source?.quantity} {source?.unit} · 单价 {source?.unitPrice||'未填写'}</small><small>样办 {source?.sampleQuantity??'未填写'} · 交期 {source?.deliveryText||'未填写'}</small></td><td><select aria-label={`第${index+1}行类别`} value={line.categoryCode} onChange={event=>patchLine(index,'categoryCode',event.target.value)}><option value="">请选择</option>{loaded.categories.map(code=><option key={code}>{code}</option>)}</select></td>{lineFields.map(field=><td key={field.key}><Input aria-label={`第${index+1}行${field.label}`} type={field.type||'text'} maxLength={field.key==='remark'?1000:160} value={line[field.key]} onChange={event=>patchLine(index,field.key,event.target.value)}/></td>)}<td><input type="checkbox" aria-label={`第${index+1}行赠品`} checked={line.isFree} onChange={event=>patchLine(index,'isFree',event.target.checked)}/></td><td><code>{code||'待补齐编码字段'}</code></td></tr>;})}</tbody></ExcelTable></div></fieldset>
     <div className="row-actions mt-4"><Button variant="outline" disabled={!!busy||locked||!item.canPrepare} onClick={()=>void post('kingdee-sales-save',{id:item.id,version:item.version,inputs},'草稿已保存，请重新检查订单。')}><Save size={16}/>保存草稿</Button><Button variant="outline" disabled={!!busy||locked||!item.canPrepare||dirty} onClick={()=>void post('kingdee-sales-validate',{id:item.id,version:item.version},'订单检查已完成，请查看核对结果。')}><ShieldCheck size={16}/>检查订单</Button><Button variant="outline" disabled={!!busy||dirty||!['confirmed','uploaded'].includes(item.status)} onClick={()=>void download()}><Download size={16}/>下载金蝶模板订单</Button>{dirty&&<Button variant="outline" disabled={!!busy} onClick={()=>{if(window.confirm('放弃本次未保存的金蝶订单修改？'))adopt(item);}}>放弃修改</Button>}</div>{dirty&&<p className="kingdee-sales-hint">有未保存修改。保存后重新检查，原客服确认会失效。</p>}
    </section>
    <section className="panel section-pad"><div className="kingdee-sales-heading"><div><h3>客服核对与上传</h3><p>确认当前订单的客户、成品编码、数量、单位、价格、税率和交期。</p></div><CheckCircle2 size={26}/></div>
     {item.validation.issues.length>0&&<div className="kingdee-sales-issues" role="status"><b>待处理 {item.validation.issues.length} 项</b><ul>{item.validation.issues.map((issue,index)=><li key={index}>{issue.sourceLineId?`第 ${(inputs.lines.findIndex(line=>line.sourceLineId===issue.sourceLineId))+1} 行：`:''}{issue.message}</li>)}</ul></div>}
     {!!item.validation.warnings.length&&<details className="kingdee-sales-evidence"><summary>核对提醒（{item.validation.warnings.length}）</summary><ul>{item.validation.warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul></details>}
     <div className="kingdee-sales-totals"><span>数量<b>{item.validation.valid?item.validation.totalQuantity:'待校验'}</b></span><span>不含税金额<b>{item.validation.valid?item.validation.netAmount:'待校验'}</b></span><span>税额<b>{item.validation.valid?item.validation.taxAmount:'待校验'}</b></span><span>价税合计<b>{item.validation.valid?item.validation.grossAmount:'待校验'} {inputs.currencyName}</b></span></div>{dirty&&<p className="kingdee-sales-hint">以上为上次保存版本的校验结果。</p>}
     <p className="kingdee-sales-hint">{loaded.connection.message}</p>{!!loaded.connection.readinessIssues?.length&&<ul className="kingdee-sales-blockers">{loaded.connection.readinessIssues.filter(issue=>!loaded.connection.message.includes(issue)).map((issue,index)=><li key={index}>{issue}</li>)}</ul>}
     {item.confirmation&&<p className="kingdee-sales-confirmation">客服确认：{item.confirmation.actor} · {new Date(item.confirmation.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}</p>}
     {!locked&&<><label className="kingdee-sales-check"><input type="checkbox" checked={ack} disabled={!!busy||dirty||!item.validation.valid||!item.canConfirm} onChange={event=>setAck(event.target.checked)}/>我已逐项核对整张销售订单，确认资料无误。</label><div className="row-actions"><Button variant="outline" disabled={!!busy||dirty||!ack||!item.validation.valid||!item.canConfirm||item.status==='confirmed'} onClick={()=>void post('kingdee-sales-confirm',{id:item.id,version:item.version,acknowledged:true},'客服已确认此版本，可下载金蝶模板订单；直接上传须满足页面所列条件。')}><ShieldCheck size={16}/>客服确认无误</Button><Button disabled={!!busy||dirty||item.status!=='confirmed'||!item.canUpload||!loaded.connection.writeEnabled} onClick={()=>void post('kingdee-sales-upload',{id:item.id,version:item.version},'上传请求已处理，请查看金蝶回执。')}><UploadCloud size={16}/>{busy==='kingdee-sales-upload'?'正在上传并核验…':'确认上传到金蝶'}</Button></div></>}
     {item.attempt&&<div className="kingdee-sales-receipt"><b>上传回执</b><p>{item.attempt.message}</p>{item.remoteNumber&&<p>金蝶销售订单号：<strong>{item.remoteNumber}</strong></p>}{['unknown','uploading'].includes(item.status)&&<Button disabled={!!busy} variant="outline" onClick={()=>void post('kingdee-sales-reconcile',{id:item.id,version:item.version},'已核查上传结果。')}><RefreshCw size={16}/>核查上传结果</Button>}</div>}
    </section>
   </>}
  </>}
 </div>;
}
