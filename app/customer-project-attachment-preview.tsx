'use client';
import {useEffect,useRef,useState} from 'react';
import {Download,Maximize2,RefreshCw,X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import type {CPRow} from './customer-project-ui';
import './customer-project-attachment-preview.css';

type PreviewKind='image'|'pdf'|'unsupported'|'missing';
const imageTypes=new Set(['image/png','image/jpeg','image/webp','image/gif']);
export function customerProjectPreviewKind(row:CPRow):PreviewKind{
 if(!row.id||!(Number(row.size)>0))return 'missing';
 if(row.category==='original-communication')return 'unsupported';
 if(imageTypes.has(row.contentType))return 'image';
 return row.contentType==='application/pdf'?'pdf':'unsupported';
}
export function customerProjectPreviewLinks(id:string){const download='/api/workspace/customer-project-file?id='+encodeURIComponent(id);return {download,preview:download+'&preview=1'};}
const filename=(row:CPRow)=>String(row.filename||'未命名资料');
const sizeLabel=(value:unknown)=>{const size=Number(value)||0;return size<1024?`${size} B`:size<1024*1024?`${(size/1024).toFixed(1)} KiB`:`${(size/1024/1024).toFixed(2)} MiB`;};
const failureFor=(status:number)=>status===401?'登录已失效，请重新登录后预览。':status===403?'当前账号已无权预览此原件，请刷新项目权限。':status===404?'原件暂不可用，请核对附件是否仍存在。':status===415?'此原件的格式或文件内容不支持页面内预览，可使用独立下载按钮查看。':`暂时无法预览（${status}），请重试或下载原件。`;

function AttachmentMedium({row,large=false,onOpen}:{row:CPRow;large?:boolean;onOpen?:(trigger:HTMLElement)=>void}){
 const kind=customerProjectPreviewKind(row),[attempt,setAttempt]=useState(0);
 const host=useRef<HTMLDivElement>(null),[nearViewport,setNearViewport]=useState(large);
 const url=customerProjectPreviewLinks(row.id).preview+(attempt?'&retry='+attempt:'');
 const key=[row.id,row.version,row.hash,row.contentType,row.size,row.category,attempt].join('|');
 const [state,setState]=useState({key:'',phase:'checking',error:''});
 const current=state.key===key?state:{key,phase:'checking',error:''};
 useEffect(()=>{
  if(kind==='unsupported'||kind==='missing')return;
  if(large||typeof IntersectionObserver==='undefined'){setNearViewport(true);return;}
  const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setNearViewport(true);observer.disconnect();}},{rootMargin:'160px'});
  if(host.current)observer.observe(host.current);return()=>observer.disconnect();
 },[kind,large]);
 useEffect(()=>{
  if(!nearViewport||kind==='unsupported'||kind==='missing')return;
  if(kind==='pdf'&&typeof navigator!=='undefined'&&navigator.pdfViewerEnabled===false){setState({key,phase:'failed',error:'此浏览器未启用 PDF 页面预览。可使用支持 PDF 的浏览器打开本页，或点击独立下载按钮。'});return;}
  let cancelled=false,timedOut=false;const controller=new AbortController();
  setState({key,phase:'checking',error:''});
  const timeout=setTimeout(()=>{timedOut=true;controller.abort();},20000);
  void (async()=>{
   try{
    // Same-origin HEAD performs the same authorization and file-signature checks
    // as preview GET, without treating an iframe load event as proof of success.
    const response=await fetch(url,{method:'HEAD',credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal});
    if(!response.ok)throw new Error(failureFor(response.status));
    const mime=response.headers.get('Content-Type')?.split(';')[0].trim();
    if(mime!==row.contentType||!/^inline(?:;|$)/i.test(response.headers.get('Content-Disposition')||''))throw new Error('服务器未提供可内嵌的原件预览，请使用独立下载按钮。');
    if(!cancelled)setState({key,phase:'ready',error:''});
   }catch(error){if(!cancelled)setState({key,phase:'failed',error:timedOut?'原件预览请求超时，请重试。':controller.signal.aborted?'原件预览请求已取消。':(error as Error).message});}
   finally{clearTimeout(timeout);}
  })();
  return()=>{cancelled=true;controller.abort();clearTimeout(timeout);};
 },[key,kind,url,row.contentType,nearViewport]);
 const failed=(message:string)=>setState({key,phase:'failed',error:message});
 if(kind==='missing')return <div className="cp-preview-unavailable">仅登记了资料信息，尚未上传可预览的原件。</div>;
 if(kind==='unsupported')return <div className="cp-preview-unavailable">此格式暂不支持页面内预览。请使用独立下载按钮查看原件。</div>;
 return <div ref={host} className={'cp-preview-medium '+(large?'large':'thumbnail')}>
  {current.phase==='checking'&&<div className="cp-preview-unavailable" role="status">{nearViewport?'正在核对原件预览…':'滚动到此处后自动加载预览。'}</div>}
  {current.phase==='failed'&&<div className="cp-preview-unavailable" role="alert">{current.error}</div>}
  {current.phase==='ready'&&<div className="cp-preview-visual">
   {kind==='image'?<img src={url} alt={filename(row)} loading={large?'eager':'lazy'} decoding="async" referrerPolicy="no-referrer" onError={()=>failed('图片暂未能显示，请重试或下载原件。')}/>:<iframe src={url+(large?'#page=1&view=FitH&toolbar=1':'#page=1&view=FitH&toolbar=0&navpanes=0')} title={filename(row)+(large?' · PDF 放大预览':' · PDF 第一页预览')} loading={large?'eager':'lazy'} referrerPolicy="no-referrer" tabIndex={large?0:-1} aria-hidden={!large} onError={()=>failed('PDF 预览暂不可用，请重试或使用独立下载按钮。')}/>}
   {!large&&onOpen&&<button type="button" className="cp-preview-open" aria-label={'放大预览 '+filename(row)} onClick={event=>onOpen(event.currentTarget)}><span><Maximize2 size={15}/>放大预览</span></button>}
  </div>}
  {kind==='pdf'&&<p className="cp-preview-hint">{large?'可使用 PDF 工具栏翻页和缩放。':'下方为 PDF 第一页预览，点击可放大浏览。'}若预览区域空白或不能浏览，请重试或下载原件。</p>}
  <Button type="button" size="sm" variant="ghost" className="cp-preview-retry" aria-label={'重新预览 '+filename(row)} onClick={()=>setAttempt(value=>value+1)}><RefreshCw size={13}/>重新预览</Button>
 </div>;
}

function AttachmentPreviewDialog({row,onClose}:{row:CPRow;onClose:()=>void}){
 const closeButton=useRef<HTMLButtonElement>(null),dialog=useRef<HTMLElement>(null),callback=useRef(onClose);callback.current=onClose;
 useEffect(()=>{
  closeButton.current?.focus();
  const keydown=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){event.preventDefault();event.stopPropagation();callback.current();return;}
   if(event.key!=='Tab')return;
   const controls=Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],iframe[tabindex="0"]')||[]);if(!controls.length)return;
   const first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  };
  window.addEventListener('keydown',keydown,true);return()=>window.removeEventListener('keydown',keydown,true);
 },[]);
 const uploaded=customerProjectPreviewKind(row)!=='missing';
 return <div className="cp-preview-backdrop"><section ref={dialog} className="cp-preview-dialog" role="dialog" aria-modal="true" aria-label={'原件预览：'+filename(row)}>
  <header><div><h2>{filename(row)}</h2><p>{sizeLabel(row.size)}{row.note?' · '+String(row.note):''}</p></div><Button ref={closeButton} type="button" variant="ghost" aria-label="关闭原件预览" onClick={onClose}><X size={22}/></Button></header>
  <div className="cp-preview-dialog-content"><AttachmentMedium key={[row.id,row.version,row.hash].join('|')} row={row} large/></div>
  <footer><span>关闭后返回缩略图；预览不会修改原件。</span>{uploaded&&<a href={customerProjectPreviewLinks(row.id).download} download={filename(row)} className="cp-preview-download"><Download size={16}/>下载原件</a>}</footer>
 </section></div>;
}

export function CustomerProjectAttachmentPreviewGallery({attachments,canEdit,onEdit,busy=false}:{attachments:CPRow[];canEdit:boolean;onEdit:(row:CPRow)=>void;busy?:boolean}){
 const [selectedId,setSelectedId]=useState(''),trigger=useRef<HTMLElement|null>(null),selected=attachments.find(row=>row.id===selectedId);
 const open=(row:CPRow,element:HTMLElement)=>{trigger.current=element;setSelectedId(row.id);};
 const close=()=>{setSelectedId('');const element=trigger.current;requestAnimationFrame(()=>{if(element?.isConnected)element.focus();});};
 useEffect(()=>{if(selectedId&&!selected)setSelectedId('');},[selectedId,selected]);
 if(!attachments.length)return <div className="cp-preview-empty">暂无项目原件。上传图纸图片或 PDF 后可直接预览。</div>;
 return <><div className="cp-preview-gallery">{attachments.map(row=>{const kind=customerProjectPreviewKind(row),name=filename(row);return <article className={'cp-preview-card '+(kind==='pdf'?'pdf':'')} key={row.id}>
  <AttachmentMedium key={[row.id,row.version,row.hash].join('|')} row={row} onOpen={element=>open(row,element)}/>
  <div className="cp-preview-card-info"><button type="button" className="cp-preview-filename" aria-label={'预览文件 '+name} disabled={kind==='missing'} onClick={event=>open(row,event.currentTarget)}>{name}</button><span>{kind==='missing'?'原件待补充':sizeLabel(row.size)}</span><p>{row.note||'暂无资料说明'}</p><div className="cp-actions">{kind!=='missing'&&<a href={customerProjectPreviewLinks(row.id).download} download={name} className="cp-preview-download"><Download size={14}/>下载原件</a>}{canEdit&&<Button type="button" variant="outline" size="sm" disabled={busy} onClick={()=>{if(!busy)onEdit(row);}}>修改资料</Button>}</div></div>
 </article>;})}</div>{selected&&<AttachmentPreviewDialog key={selected.id} row={selected} onClose={close}/>}</>;
}
