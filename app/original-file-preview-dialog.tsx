'use client';
import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogDescription,DialogTitle} from '@/components/ui/dialog';
import './ie-supplier-evidence-preview.css';
export type OriginalFilePreview={filename:string;contentType:string;url:string;loading:boolean;mediaLoading:boolean;error:string};
export function OriginalFilePreviewDialog({title,preview,details,note,onClose,onRetry,onDownload,onMediaLoaded,onMediaError,returnFocus,downloadDisabled=false}:{title:string;preview:OriginalFilePreview;details:{label:string;value:string}[];note?:string;onClose:()=>void;onRetry:()=>void;onDownload:()=>void;onMediaLoaded:()=>void;onMediaError:()=>void;returnFocus:()=>void;downloadDisabled?:boolean}){
 const [zoom,setZoom]=useState(1);useEffect(()=>setZoom(1),[preview.filename]);
 return <Dialog open onOpenChange={open=>{if(!open)onClose();}}><DialogContent className="ieq-original-dialog" showCloseButton={false} onCloseAutoFocus={event=>{event.preventDefault();returnFocus();}}>
  <header className="ieq-original-heading"><div><DialogTitle>{title}</DialogTitle><DialogDescription>{preview.filename}</DialogDescription></div><div className="ieq-original-actions"><Button type="button" variant="outline" disabled={downloadDisabled} onClick={onDownload}>下载原件</Button><Button type="button" variant="outline" aria-label="关闭原件详情" onClick={onClose}>关闭</Button></div></header>
  <div className="ieq-original-layout"><section className="ieq-original-viewer" aria-label="报价原件预览">
   {preview.contentType!=='application/pdf'&&<div className="ieq-original-zoom" aria-label="图片缩放"><Button type="button" size="sm" variant="outline" disabled={zoom<=1||preview.loading} onClick={()=>setZoom(value=>Math.max(1,value-0.5))}>缩小</Button><span>{Math.round(zoom*100)}%</span><Button type="button" size="sm" variant="outline" disabled={zoom>=4||preview.loading} onClick={()=>setZoom(value=>Math.min(4,value+0.5))}>放大</Button><Button type="button" size="sm" variant="outline" onClick={()=>setZoom(1)}>适合窗口</Button></div>}
   <div className="ieq-original-stage" aria-busy={preview.loading||preview.mediaLoading}>
    {(preview.loading||preview.url&&preview.mediaLoading)&&<p className="ieq-original-progress" role="status">正在加载报价原件…</p>}
    {preview.error&&<div className="ieq-original-load-error" role="alert"><p>{preview.error}</p><Button type="button" variant="outline" onClick={onRetry}>重新加载原件</Button><Button type="button" variant="outline" onClick={onDownload}>下载原件查看</Button></div>}
    {preview.url&&!preview.error&&(preview.contentType==='application/pdf'?<iframe title={preview.filename+' PDF 原件'} src={preview.url} onLoad={onMediaLoaded} onError={onMediaError}/>:<div className={'ieq-original-image-plane'+(zoom===1?' fit':'')} style={zoom===1?undefined:{width:`${zoom*100}%`,height:`${zoom*100}%`}}><img src={preview.url} alt={preview.filename} onLoad={onMediaLoaded} onError={onMediaError}/></div>)}
   </div>
  </section><aside className="ieq-original-information"><h3>原件资料</h3><dl>{details.map(({label,value})=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>{note&&<p>{note}</p>}</aside></div>
 </DialogContent></Dialog>;

}
