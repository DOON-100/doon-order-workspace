'use client';
import {useEffect,useRef,type ReactNode} from 'react';
import {X} from 'lucide-react';
import {Button} from '@/components/ui/button';

/** A focused record window. The list stays mounted so its filters and scroll survive. */
export function CustomerProjectRecordDialog({title,description,busy,onClose,children}:{title:string;description:string;busy:boolean;onClose:()=>void;children:ReactNode}){
 const panel=useRef<HTMLElement>(null),close=useRef(onClose);close.current=onClose;
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null,overflow=document.body.style.overflow;
  document.body.style.overflow='hidden';panel.current?.focus();
  const keydown=(event:KeyboardEvent)=>{
   // A portal such as the Excel filter owns its own Escape and focus handling.
   if(event.defaultPrevented||!panel.current?.contains(event.target as Node))return;
   const dialogs=document.querySelectorAll('[role="dialog"][aria-modal="true"]');
   if(dialogs[dialogs.length-1]!==panel.current)return;
   if(event.key==='Escape'){event.preventDefault();close.current();}
   if(event.key==='Tab'){
    const controls=Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')||[]).filter(node=>node.getClientRects().length);
    const first=controls[0],last=controls.at(-1);
    if(!first){event.preventDefault();panel.current?.focus();}
    else if(event.shiftKey&&(document.activeElement===first||document.activeElement===panel.current)){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
   }
  };
  document.addEventListener('keydown',keydown);
  return()=>{document.removeEventListener('keydown',keydown);document.body.style.overflow=overflow;if(previous?.isConnected)previous.focus();};
 },[]);
 return <div className="cp-project-dialog-backdrop"><section ref={panel} tabIndex={-1} className="cp-project-dialog" role="dialog" aria-modal="true" aria-label={title}>
  <header className="cp-project-dialog-heading"><div><h2>{title}</h2><p>{description}</p></div><Button variant="ghost" disabled={busy} aria-label="关闭项目窗口" onClick={onClose}><X size={18}/></Button></header>
  <div className="cp-project-dialog-body">{children}</div>
 </section></div>;
}
