'use client';
import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {businessTeamFetch,getBusinessTeamScope} from './business-team-client';
import {dateTime} from './ui';
import './ie-quote-documents.css';
import {IeDocumentThumbnail} from './ie-document-thumbnail';

type Document={id:string;lineId:string;drawingNo:string;drawingRevision:string;filename:string;contentType:string;size:number;sha256:string;uploadedAt:string;uploadedBy:string;quoteVersion:number;matchesDrawingRevision:boolean;url:string};
type DocumentQuote={id?:string;version?:number;status:string;lines:{id:string;model:string;drawingNo:string;drawingRevision:string}[];canEdit?:boolean;attachments?:Document[]};
async function mutate(action:string,body:FormData|object){
 const response=await businessTeamFetch('/api/workspace/'+action,{method:'POST',headers:body instanceof FormData?undefined:{'Content-Type':'application/json'},body:body instanceof FormData?body:JSON.stringify(body)});
 const result=await response.json().catch(()=>null) as {error?:string}|null;if(!response.ok)throw Object.assign(new Error(result?.error||'图纸操作未完成，请重新核对当前版本。'),{status:response.status});return result;
}
export function IeQuoteDocumentsPanel({quote,dirty,historical,busy,onUpload,onSaved,onError,onDirtyChange}:{quote:DocumentQuote;dirty:boolean;historical:boolean;busy:boolean;onUpload:(selection:{file:File;lineId:string;replaceAttachmentId?:string})=>Promise<void>;onSaved:()=>Promise<void>;onError:(cause:unknown)=>void;onDirtyChange:(dirty:boolean)=>void}){
 const [lineId,setLineId]=useState(quote.lines[0]?.id||''),[file,setFile]=useState<File|null>(null),[replacement,setReplacement]=useState(''),[working,setWorking]=useState(false),[requiresReload,setRequiresReload]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[ack,setAck]=useState<Record<string,boolean>>({}),[preview,setPreview]=useState<{url:string;type:string;name:string}|null>(null);
 const input=useRef<HTMLInputElement>(null),alive=useRef(true),previewUrl=useRef(''),operation=useRef(false),previewRequest=useRef<AbortController|null>(null);
 const team=getBusinessTeamScope(),previewScope=`${quote.id}:${quote.version}:${team}`,currentPreviewScope=useRef(previewScope);currentPreviewScope.current=previewScope;
 useEffect(()=>{previewRequest.current?.abort();setPreview(null);if(previewUrl.current){URL.revokeObjectURL(previewUrl.current);previewUrl.current='';}},[previewScope]);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>()=>{previewRequest.current?.abort();if(previewUrl.current)URL.revokeObjectURL(previewUrl.current);},[]);
 const pending=!!file||!!replacement||Object.values(ack).some(Boolean);
 useEffect(()=>{onDirtyChange(pending);},[pending,onDirtyChange]);useEffect(()=>()=>onDirtyChange(false),[onDirtyChange]);
 const canUpload=!!quote.canEdit&&!historical&&!busy&&!working;
 const editable=!!quote.id&&canUpload&&!dirty&&!file;
 const selectedLine=quote.lines.find(l=>l.id===lineId),documents=quote.attachments||[];
 const fail=(cause:unknown)=>{if(!alive.current)return;setError((cause as Error).message);if((cause as {requiresReload?:boolean}).requiresReload)setRequiresReload(true);if([401,403].includes((cause as {status?:number}).status||0)){setPreview(null);onError(cause);}};
 const act=async(action:string,body:FormData|object,message:string)=>{if(!editable)return;setWorking(true);setError('');setNotice('');try{await mutate(action,body);if(!alive.current)return;setFile(null);setReplacement('');setAck({});if(input.current)input.current.value='';await onSaved();if(alive.current)setNotice(message);}catch(cause){fail(cause);}finally{if(alive.current)setWorking(false);}};
 const upload=async()=>{
  if(!file||!canUpload||operation.current||requiresReload)return;
  if(!selectedLine){setError('请选择文件对应的款式。');return;}
  if(!/\.(pdf|png|jpe?g|webp)$/i.test(file.name)||!file.size||file.size>12*1024*1024){setError('请选择非空且不超过 12 MB 的 JPG、PNG、WEBP 或 PDF 文件。');return;}
  operation.current=true;setWorking(true);setError('');setNotice('');
  try{await onUpload({file,lineId:selectedLine.id,replaceAttachmentId:replacement||undefined});if(!alive.current)return;setFile(null);setReplacement('');setAck({});if(input.current)input.current.value='';setPreview(null);if(previewUrl.current){URL.revokeObjectURL(previewUrl.current);previewUrl.current='';}setNotice('上传并保存成功，已显示在下方附件中。');}catch(cause){fail(cause);}finally{operation.current=false;if(alive.current)setWorking(false);}
 };
 const read=async(doc:Document,download=false)=>{
  if(operation.current||busy)return;operation.current=true;setWorking(true);setError('');const controller=new AbortController();previewRequest.current?.abort();previewRequest.current=controller;
  const active=()=>alive.current&&!controller.signal.aborted&&getBusinessTeamScope()===team&&currentPreviewScope.current===previewScope;
  try{const response=await businessTeamFetch(`/api/workspace/ie-quote-attachment?id=${encodeURIComponent(quote.id!)}&version=${quote.version}&attachmentId=${encodeURIComponent(doc.id)}${download?'&download=1':''}`,{cache:'no-store',signal:controller.signal});if(!response.ok){const body=await response.json().catch(()=>null) as {error?:string}|null;throw Object.assign(new Error(body?.error||'无法读取图纸，请检查权限或刷新。'),{status:response.status});}const blob=await response.blob();if(!active())return;const url=URL.createObjectURL(blob);if(download){const anchor=document.createElement('a');anchor.href=url;anchor.download=doc.filename;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}else{if(previewUrl.current)URL.revokeObjectURL(previewUrl.current);previewUrl.current=url;setPreview({url,type:doc.contentType,name:doc.filename});}}
  catch(cause){if(active())fail(cause);}finally{operation.current=false;if(alive.current)setWorking(false);}
 };
 const view=(doc:Document)=>read(doc),download=(doc:Document)=>read(doc,true);
 return <section className="ieq-documents" aria-label="报价图纸和图片"><div className="ieq-section-title"><div><h3>图纸、图片与 PDF</h3><p className="ieq-help">支持 JPG、PNG、WEBP、PDF，单个文件最大 12 MB。按款式保存原件，图纸与报价版本一起留档。工程人员依据图纸填写材料和工艺，价格由报价表计算。</p></div></div>
 {error&&<div role="alert" className="ieq-alert error">{error}</div>}{notice&&<div role="status" className="ieq-alert success">{notice}</div>}
 {quote.canEdit&&!historical&&<fieldset disabled={!canUpload} className="ieq-document-upload"><label>对应款式<select aria-label="图纸对应款式" value={selectedLine?.id||''} onChange={e=>{setLineId(e.target.value);setReplacement('');}}>{!selectedLine&&<option value="">请选择款式</option>}{quote.lines.map(l=><option key={l.id} value={l.id}>{l.model||'未填厂款'} · {l.drawingNo||'未填图号'} / {l.drawingRevision||'未填版次'}</option>)}</select></label><label>上传文件<input ref={input} aria-label="上传图纸图片或PDF" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={e=>{setFile(e.target.files?.[0]||null);if(!requiresReload)setError('');}}/></label><label>新增或替换<select aria-label="新增或替换图纸" value={replacement} onChange={e=>setReplacement(e.target.value)}><option value="">新增图纸附件</option>{documents.filter(d=>d.lineId===selectedLine?.id).map(d=><option key={d.id} value={d.id}>替换：{d.filename}</option>)}</select></label><Button type="button" disabled={!canUpload||!file||requiresReload} onClick={()=>void upload()}>{working?'正在保存…':'上传并保存'}</Button></fieldset>}
 {pending&&!historical&&<Button type="button" size="sm" variant="outline" disabled={working||busy} onClick={()=>{setFile(null);setReplacement('');setAck({});if(input.current)input.current.value='';}}>取消本次选择</Button>}
 {quote.canEdit&&!historical&&<p className="ieq-help">选择对应款式和文件后，点击“上传并保存”。未保存的报价内容会一并保存；图片显示缩略图，PDF 可点击预览。</p>}
 {!documents.length&&<p className="ieq-help">当前报价版本尚未上传图纸附件。</p>}
 {!!documents.length&&<div className="ieq-document-list">{documents.map(doc=><article key={doc.id}><IeDocumentThumbnail url={`/api/workspace/ie-quote-attachment?id=${encodeURIComponent(quote.id!)}&version=${quote.version}&attachmentId=${encodeURIComponent(doc.id)}`} filename={doc.filename} contentType={doc.contentType} disabled={working||busy} onPreview={()=>void view(doc)} onError={fail}/><div className="ieq-document-description"><strong>{doc.filename}</strong><span>{quote.lines.find(l=>l.id===doc.lineId)?.model||'款式'} · 图号 {doc.drawingNo||'未填'} / {doc.drawingRevision||'未填版次'} · {(doc.size/1024/1024).toFixed(2)} MB</span><small>{doc.uploadedBy} · {dateTime(doc.uploadedAt)} · 首次关联 V{doc.quoteVersion}</small></div><div className="ieq-actions"><Button type="button" variant="outline" size="sm" disabled={working||busy} onClick={()=>void view(doc)}>预览</Button><Button type="button" variant="outline" size="sm" disabled={working||busy} onClick={()=>void download(doc)}>下载原件</Button>{editable&&<Button type="button" variant="outline" size="sm" onClick={()=>{if(window.confirm('从当前草稿移除此图纸引用？历史报价中的原件仍会保留。'))void act('ie-quote-attachment-remove',{id:quote.id,version:quote.version,lineId:doc.lineId,attachmentId:doc.id},'当前引用已移除，历史图纸原件仍保留。');}}>移除引用</Button>}</div>{!doc.matchesDrawingRevision&&<div className="ieq-document-mismatch"><p>此附件对应旧图号或版次。请上传新图纸，或核对后明确沿用此原件。</p>{editable&&<><label><input type="checkbox" checked={!!ack[doc.id]} onChange={e=>setAck(v=>({...v,[doc.id]:e.target.checked}))}/>已核对原件适用于当前图号和版次</label><Button type="button" size="sm" variant="outline" disabled={!ack[doc.id]} onClick={()=>void act('ie-quote-attachment-bind',{id:quote.id,version:quote.version,lineId:doc.lineId,attachmentId:doc.id,acknowledgeDrawingRevision:true},'已记录图纸沿用确认并生成新版本。')}>确认沿用并保存版本</Button></>}</div>}</article>)}</div>}
 {preview&&<div className="ieq-document-preview"><div><strong>{preview.name}</strong><Button type="button" size="sm" variant="outline" onClick={()=>{setPreview(null);if(previewUrl.current){URL.revokeObjectURL(previewUrl.current);previewUrl.current='';}}}>关闭预览</Button></div>{preview.type==='application/pdf'?<div className="ieq-pdf-preview"><iframe title={preview.name+' PDF 预览'} src={preview.url}/><p className="ieq-help"><a href={preview.url} target="_blank" rel="noopener noreferrer">在新窗口预览 PDF 原件</a>，也可使用上方“下载原件”保存查看。</p></div>:<img alt={preview.name} src={preview.url}/>}</div>}
 </section>;
}
