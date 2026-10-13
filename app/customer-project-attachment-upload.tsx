'use client';
import {useEffect,useRef,useState,type ClipboardEvent} from 'react';
import {Upload,X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {clientId} from '@/lib/client-id';
import {request} from './ui';
import './customer-project-attachment-upload.css';

export type CPAttachmentUploadTarget={projectId:string;roundId:string;category:'general'|'original-communication';projectLabel:string;roundLabel:string};
type UploadRow={id:string;file:File;status:'ready'|'uploading'|'succeeded'|'failed'|'invalid';error:string;note?:string};
// Match the existing single-file endpoint; uploading never changes drawing approval.
export const projectAttachmentExtensions=['pdf','png','jpg','jpeg','webp','gif','xls','xlsx','docx','eml','dwg','dxf','step','stp','iges','igs','stl'];
export function projectAttachmentError(file:File,category:CPAttachmentUploadTarget['category']){
 if(!file.size)return '文件为空，请重新选择。';
 if(file.size>50*1024*1024)return '单文件不能超过 50 MiB。';
 if(category==='general'&&!projectAttachmentExtensions.includes(file.name.split('.').at(-1)?.toLowerCase()||''))return '此格式不支持项目原件上传，请选择列出的图纸、图片、PDF、Office 或 EML 文件。';
 return '';
}
export function clipboardAttachmentFiles(clipboard:Pick<DataTransfer,'files'|'items'>):File[]{
 const files=Array.from(clipboard.files||[]);if(files.length)return files;
 return Array.from(clipboard.items||[]).filter(item=>item.kind==='file').map(item=>item.getAsFile()).filter((file):file is File=>file!==null);
}
const sizeLabel=(size:number)=>size<1024?`${size} B`:size<1024*1024?`${(size/1024).toFixed(1)} KiB`:`${(size/1024/1024).toFixed(2)} MiB`;
const statusLabels={ready:'待上传',uploading:'正在上传',succeeded:'已上传',failed:'上传失败',invalid:'不可上传'};

export function CustomerProjectAttachmentUpload({target,onClose,onDirtyChange,onBusyChange,onUploaded}:{target:CPAttachmentUploadTarget;onClose:()=>void;onDirtyChange:(dirty:boolean)=>void;onBusyChange:(busy:boolean)=>void;onUploaded:()=>Promise<unknown>}){
 const scope=useRef({...target});
 const [rows,setRows]=useState<UploadRow[]>([]),[note,setNote]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[refreshError,setRefreshError]=useState(''),[started,setStarted]=useState(false);
 const rowsRef=useRef<UploadRow[]>([]),running=useRef(false),mounted=useRef(true),controller=useRef<AbortController|null>(null),pasteArea=useRef<HTMLDivElement>(null);
 const callbacks=useRef({onClose,onDirtyChange,onBusyChange,onUploaded});callbacks.current={onClose,onDirtyChange,onBusyChange,onUploaded};
 const dirty=busy||rows.some(row=>row.status!=='succeeded')||(!started&&!!note),dirtyRef=useRef(dirty);dirtyRef.current=dirty;
 const changeRows=(change:(current:UploadRow[])=>UploadRow[])=>{const next=change(rowsRef.current);rowsRef.current=next;if(mounted.current)setRows(next);};
 useEffect(()=>{callbacks.current.onDirtyChange(dirty);},[dirty]);
 useEffect(()=>{
  mounted.current=true;pasteArea.current?.focus();
  const unload=(event:BeforeUnloadEvent)=>{if(running.current||dirtyRef.current){event.preventDefault();event.returnValue='';}};
  window.addEventListener('beforeunload',unload);
  return()=>{mounted.current=false;controller.current?.abort();window.removeEventListener('beforeunload',unload);callbacks.current.onDirtyChange(false);callbacks.current.onBusyChange(false);};
 },[]);
 const close=()=>{
  if(running.current)return;
  if(dirtyRef.current&&!window.confirm('放弃尚未上传的文件与说明并关闭？已上传成功的文件会保留，不会删除。'))return;
  callbacks.current.onClose();
 };
 const addFiles=(files:File[])=>{
  if(running.current)return;
  if(!files.length){setMessage('未读取到文件。请使用“选择文件”，或复制图片后在此区域粘贴；部分浏览器不支持粘贴复制的本地文件。');return;}
  const additions=files.map(file=>{const error=projectAttachmentError(file,scope.current.category);return {id:clientId(),file,status:error?'invalid' as const:'ready' as const,error};});
  changeRows(current=>[...current,...additions]);dirtyRef.current=true;callbacks.current.onDirtyChange(true);setMessage(`已加入 ${additions.length} 个文件，请核对后上传。`);
 };
 const paste=(event:ClipboardEvent<HTMLDivElement>)=>{event.preventDefault();if(!running.current)addFiles(clipboardAttachmentFiles(event.clipboardData));};
 const remove=(id:string)=>{if(!running.current)changeRows(current=>current.filter(row=>row.id!==id||row.status==='succeeded'));};
 const upload=async(onlyId?:string)=>{
  if(running.current)return;
  const pending=rowsRef.current.filter(row=>(row.status==='ready'||row.status==='failed')&&(!onlyId||row.id===onlyId));if(!pending.length)return;
  running.current=true;setBusy(true);setStarted(true);setMessage('');setRefreshError('');dirtyRef.current=true;callbacks.current.onBusyChange(true);callbacks.current.onDirtyChange(true);
  let saved=0;
  try{
   for(const row of pending){
    if(!mounted.current)break;
    // Freeze each file's note on its first attempt. Retrying an uncertain response
    // sends identical original bytes/scope/note to the endpoint's existing dedupe.
    const frozenNote=row.note??note;
    changeRows(current=>current.map(item=>item.id===row.id?{...item,status:'uploading',error:'',note:frozenNote}:item));
    const body=new FormData();body.set('projectId',scope.current.projectId);body.set('roundId',scope.current.category==='original-communication'?'':scope.current.roundId);body.set('category',scope.current.category);body.set('note',frozenNote);body.set('file',row.file);
    const abort=new AbortController();controller.current=abort;
    try{
     const result=await request('customer-project-attachment',body,{signal:abort.signal});if(!result?.ok)throw new Error('服务器尚未确认保存，请重试核实。');
     if(!mounted.current)break;
     saved++;changeRows(current=>current.map(item=>item.id===row.id?{...item,status:'succeeded',error:''}:item));
    }catch(error){if(!mounted.current)break;changeRows(current=>current.map(item=>item.id===row.id?{...item,status:'failed',error:(error as Error).message}:item));}
    finally{if(controller.current===abort)controller.current=null;}
   }
   if(saved&&mounted.current){try{await callbacks.current.onUploaded();}catch(error){if(mounted.current)setRefreshError('文件已上传，但清单刷新失败：'+(error as Error).message+'。已成功的文件无需重传。');}}
   if(mounted.current)setMessage(`已上传 ${rowsRef.current.filter(row=>row.status==='succeeded').length} 个；${rowsRef.current.filter(row=>row.status==='failed').length} 个失败。已成功的文件不会在重试时重复上传。`);
  }finally{running.current=false;if(mounted.current){setBusy(false);callbacks.current.onBusyChange(false);}}
 };
 const original=scope.current.category==='original-communication',title=original?'上传原始沟通文档':'上传项目原件';
 const pending=rows.filter(row=>row.status==='ready'||row.status==='failed').length,completed=rows.filter(row=>row.status==='succeeded').length;
 return <div className="cp-dialog-backdrop"><section className="cp-dialog cp-upload-dialog" role="dialog" aria-modal="true" aria-label={title} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();close();}}}>
  <div className="cp-dialog-heading"><div><h2>{title}</h2><p>{scope.current.projectLabel} · {original?'项目级原始沟通文档（不绑定轮次）':scope.current.roundLabel||'项目级原件（未绑定轮次）'}</p><p>保留文件原始内容；上传不表示图纸或客批已批准。</p></div><Button type="button" variant="ghost" size="sm" aria-label="关闭上传对话框" disabled={busy} onClick={close}><X size={18}/></Button></div>
  <form onSubmit={event=>{event.preventDefault();void upload();}}>
   <fieldset disabled={busy}><div className="cp-form-grid">
    <label className="cp-field wide"><span>选择文件（可多选）</span><input aria-label="选择上传文件" type="file" multiple disabled={busy} accept={original?undefined:projectAttachmentExtensions.map(ext=>'.'+ext).join(',')} onChange={event=>{addFiles(Array.from(event.target.files||[]));event.target.value='';}}/><small>单文件须非空且不超过 50 MiB。{original?'支持任意文件类型。':'支持 PDF、图片、XLS/XLSX、DOCX、EML、DWG/DXF、STEP/STP、IGES/IGS、STL。'}</small></label>
    <div className="cp-upload-paste" role="region" aria-label="粘贴上传文件区域" aria-disabled={busy} tabIndex={busy?-1:0} ref={pasteArea} onPaste={paste}><b>点击这里后按 Ctrl+V 粘贴文件或图片</b><span>可粘贴文件或图片；若浏览器无法读取复制的文件，请使用上方多选文件。</span></div>
    <label className="cp-field wide"><span>{original?'文档说明':'附件说明'}（本批次共用）</span><textarea aria-label="上传文件说明" rows={3} maxLength={3000} value={note} disabled={busy||started} onChange={event=>{if(!running.current&&!started)setNote(event.target.value);}}/><small>{started?'已经开始上传，说明已固定；重试将保留同一说明，避免生成重复记录。':'如不同文件需要不同说明，可分批上传，或上传后分别修改说明。'}</small></label>
   </div></fieldset>
   {rows.length>0?<ul className="cp-upload-queue" aria-label="待上传文件列表">{rows.map(row=><li key={row.id}><div><b>{row.file.name}</b><span>{sizeLabel(row.file.size)} · <strong className={'cp-upload-status '+row.status}>{statusLabels[row.status]}</strong></span>{row.error&&<p role="alert">{row.error}</p>}</div><div className="cp-actions">{row.status==='failed'&&<Button type="button" size="sm" variant="outline" disabled={busy} aria-label={'重试上传 '+row.file.name} onClick={()=>void upload(row.id)}>重试</Button>}{row.status!=='succeeded'&&<Button type="button" size="sm" variant="ghost" disabled={busy} aria-label={'移除文件 '+row.file.name} onClick={()=>remove(row.id)}>移除</Button>}</div></li>)}</ul>:<p className="cp-upload-empty">可多次选择或粘贴，核对文件列表后再开始上传。</p>}
   {message&&<div className="cp-upload-message" role="status" aria-live="polite">{message}</div>}{refreshError&&<div className="cp-alert error" role="alert">{refreshError}</div>}
   <div className="cp-dialog-footer"><span>{busy?'正在逐个上传，请等待完成。':`已上传 ${completed} 个；关闭不会删除已上传文件。`}</span><div className="cp-actions"><Button type="button" variant="outline" disabled={busy} onClick={close}>{pending||rows.some(row=>row.status==='invalid')?'取消未上传并关闭':'完成并关闭'}</Button><Button type="submit" disabled={busy||!pending}><Upload size={15}/>{busy?'正在上传…':rows.some(row=>row.status==='failed')?'上传待办 / 重试失败项':`开始上传${pending?`（${pending}）`:''}`}</Button></div></div>
  </form>
 </section></div>;
}
