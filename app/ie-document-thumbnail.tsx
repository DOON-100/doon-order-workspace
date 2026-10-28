'use client';
import {useEffect,useRef,useState} from 'react';
import {businessTeamFetch,getBusinessTeamScope} from './business-team-client';

type ThumbnailProps={url:string;filename:string;contentType:string;onError:(cause:unknown)=>void;onPreview:()=>void;disabled:boolean};
type ThumbnailState={key:string;phase:'loading'|'ready'|'failed';objectUrl?:string};

/** Thumbnails use the same authenticated team scope as opening the original. */
export function IeDocumentThumbnail({url,filename,contentType,onError,onPreview,disabled}:ThumbnailProps){
 const teamScope=getBusinessTeamScope(),image=['image/png','image/jpeg','image/webp'].includes(contentType),pdf=contentType==='application/pdf';
 const key=JSON.stringify([teamScope,url,contentType]);
 const button=useRef<HTMLButtonElement>(null),errorHandler=useRef(onError),cache=useRef<{key:string;blob:Blob}|null>(null),failed=useRef('');
 errorHandler.current=onError;
 const [visibleKey,setVisibleKey]=useState(''),[state,setState]=useState<ThumbnailState|null>(null);

 useEffect(()=>{
  if(!image||disabled||visibleKey===key)return;
  const target=button.current;if(!target)return;
  if(typeof IntersectionObserver==='undefined'){setVisibleKey(key);return;}
  let stopped=false;
  const observer=new IntersectionObserver(entries=>{if(!stopped&&entries.some(entry=>entry.isIntersecting)){setVisibleKey(key);observer.disconnect();}},{rootMargin:'120px'});
  observer.observe(target);
  return()=>{stopped=true;observer.disconnect();};
 },[image,disabled,key,visibleKey]);

 useEffect(()=>{
  if(cache.current?.key!==key)cache.current=null;
  if(!image||disabled||visibleKey!==key||failed.current===key)return;
  const controller=new AbortController();let stopped=false,objectUrl='';
  const current=()=>!stopped&&!controller.signal.aborted&&getBusinessTeamScope()===teamScope;
  const show=(blob:Blob)=>{if(!current())return;objectUrl=URL.createObjectURL(blob);setState({key,phase:'ready',objectUrl});};
  if(cache.current)show(cache.current.blob);
  else{
   setState({key,phase:'loading'});
   void (async()=>{
    try{
     const response=await businessTeamFetch(url,{cache:'no-store',signal:controller.signal});
     if(!current())return;
     if(!response.ok){
      const body=await response.json().catch(()=>null) as {error?:unknown}|null;
      throw Object.assign(new Error(typeof body?.error==='string'?body.error:'缩略图暂未加载，可点击预览原件。'),{status:response.status});
     }
     const blob=await response.blob();if(!current())return;
     if(!['image/png','image/jpeg','image/webp'].includes(blob.type.split(';')[0].trim().toLowerCase()))throw new Error('缩略图暂未加载，可点击预览原件。');
     cache.current={key,blob};show(blob);
    }catch(cause){
     if(!current())return;
     failed.current=key;setState({key,phase:'failed'});
     if([401,403].includes((cause as {status?:number})?.status||0))errorHandler.current(cause);
    }
   })();
  }
  return()=>{stopped=true;controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
 },[image,disabled,key,teamScope,url,visibleKey]);

 const phase=state?.key===key?state.phase:undefined;
 return <button ref={button} type="button" className="ieq-document-thumbnail" aria-label={'预览 '+filename} disabled={disabled} onClick={onPreview}>
  {image&&!disabled&&phase==='ready'&&state?.objectUrl?<img src={state.objectUrl} alt={filename}/>:<span className="ieq-document-thumbnail-placeholder"><strong>{pdf?'PDF':image?'图片':'文件'}</strong><span>{disabled?'预览暂不可用':phase==='loading'?'正在加载缩略图…':phase==='failed'?'缩略图未加载，点击预览':'点击预览'}</span></span>}
 </button>;
}
