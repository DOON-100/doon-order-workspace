'use client';
import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import type {PDFDocumentLoadingTask,PDFDocumentProxy,RenderTask} from 'pdfjs-dist';

/** Render only the already authorized in-memory original; no PDF URL or new permission path. */
export function PdfOriginalPreview({blob,filename,onLoaded,onError}:{blob?:Blob;filename:string;onLoaded:()=>void;onError:()=>void}){
 const [pdf,setPdf]=useState<PDFDocumentProxy|null>(null),[page,setPage]=useState(1),[zoom,setZoom]=useState(1),[width,setWidth]=useState(800),[rendering,setRendering]=useState(true);
 const container=useRef<HTMLDivElement>(null),canvas=useRef<HTMLCanvasElement>(null),callbacks=useRef({onLoaded,onError});callbacks.current={onLoaded,onError};
 useEffect(()=>{const target=container.current;if(!target)return;const measure=()=>setWidth(Math.max(200,target.clientWidth));measure();const observer=new ResizeObserver(measure);observer.observe(target);return()=>observer.disconnect();},[]);
 useEffect(()=>{
  let active=true,loading:PDFDocumentLoadingTask|undefined;setPdf(null);setPage(1);setZoom(1);setRendering(true);
  const timer=setTimeout(()=>{if(active)callbacks.current.onError();},25000);
  void (async()=>{try{
   if(!blob)throw new Error('Original unavailable');
   const [library,worker,bytes]=await Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'),import('pdfjs-dist/legacy/build/pdf.worker.min.mjs'),blob.arrayBuffer()]);if(!active)return;
   // PDF.js supports an in-process worker handler. Both modules are bundled same-origin.
   (globalThis as typeof globalThis & {pdfjsWorker?:{WorkerMessageHandler:unknown}}).pdfjsWorker={WorkerMessageHandler:worker.WorkerMessageHandler};
   loading=library.getDocument({data:new Uint8Array(bytes),useSystemFonts:true,useWorkerFetch:false,useWasm:false});
   const document=await loading.promise;if(!active){await loading.destroy();return;}if(!document.numPages)throw new Error('No pages');setPdf(document);
  }catch{if(active)callbacks.current.onError();}finally{clearTimeout(timer);}})();
  return()=>{active=false;clearTimeout(timer);void loading?.destroy().catch(()=>{});};
 },[blob]);
 useEffect(()=>{
  if(!pdf||!canvas.current)return;let active=true,task:RenderTask|undefined;const target=canvas.current;setRendering(true);
  const timer=setTimeout(()=>{if(active)callbacks.current.onError();},25000);
  void (async()=>{try{const sheet=await pdf.getPage(page);if(!active)return;const original=sheet.getViewport({scale:1}),scale=(Math.max(160,width-32)/original.width)*zoom,viewport=sheet.getViewport({scale}),pixels=Math.min(window.devicePixelRatio||1,2,8192/Math.max(viewport.width,viewport.height),Math.sqrt(16000000/(viewport.width*viewport.height)));
   target.width=Math.max(1,Math.floor(viewport.width*pixels));target.height=Math.max(1,Math.floor(viewport.height*pixels));target.style.width=`${viewport.width}px`;target.style.height=`${viewport.height}px`;
   task=sheet.render({canvas:target,viewport,transform:pixels===1?undefined:[pixels,0,0,pixels,0,0],background:'#fff'});await task.promise;if(active){setRendering(false);callbacks.current.onLoaded();}
  }catch{if(active)callbacks.current.onError();}finally{clearTimeout(timer);}})();
  return()=>{active=false;clearTimeout(timer);task?.cancel();};
 },[pdf,page,zoom,width]);
 return <div ref={container} className="ieq-pdf-canvas-viewer"><div className="ieq-original-zoom" aria-label="PDF 翻页和缩放"><Button type="button" variant="outline" size="sm" disabled={!pdf||page<=1} onClick={()=>setPage(value=>value-1)}>上一页</Button><span>第 {page} / {pdf?.numPages||'…'} 页</span><Button type="button" variant="outline" size="sm" disabled={!pdf||page>=pdf.numPages} onClick={()=>setPage(value=>value+1)}>下一页</Button><Button type="button" variant="outline" size="sm" disabled={!pdf||zoom<=0.5} onClick={()=>setZoom(value=>Math.max(0.5,value-0.25))}>缩小</Button><span>{Math.round(zoom*100)}%</span><Button type="button" variant="outline" size="sm" disabled={!pdf||zoom>=3} onClick={()=>setZoom(value=>Math.min(3,value+0.25))}>放大</Button><Button type="button" variant="outline" size="sm" disabled={!pdf} onClick={()=>setZoom(1)}>适合窗口</Button></div><div className="ieq-pdf-canvas-stage" aria-busy={rendering}>{rendering&&<p role="status">正在绘制 PDF 第 {page} 页…</p>}<canvas key={`${page}:${zoom}:${width}`} ref={canvas} role="img" aria-label={`${filename} 第 ${page} 页`}/></div></div>;
}
