'use client';
import {useEffect,useRef,useState} from 'react';
import {RefreshCw,CircleCheck,CircleAlert,Info} from 'lucide-react';
import {createPortal} from 'react-dom';
import {Button} from '@/components/ui/button';
import {clientId} from '@/lib/client-id';
import {request} from './ui';
import {getBusinessTeamScope} from './business-team-client';

type Result={inserted:number;skipped:number;held:number;selected?:number;excludedComplete?:number;excludedUnknown?:number};
export function KingdeeSyncButton({onSynchronized}:{onSynchronized:()=>void}){
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState<{tone:'success'|'error'|'info';message:string}|null>(null);
 const pending=useRef(''),running=useRef(false),generation=useRef(0),scope=getBusinessTeamScope();
 useEffect(()=>{generation.current++;pending.current='';setNotice(null);return()=>{generation.current++;};},[scope]);
 // Prepare the shared token when the button appears; synchronization still requires a click.
 useEffect(()=>{if(!scope)void request('kingdee-sync-ready').catch(()=>{});},[scope]);
 useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(null),5000);return()=>clearTimeout(timer);},[notice]);
 async function synchronize(){
  if(running.current)return;running.current=true;setBusy(true);setNotice({tone:'info',message:'正在读取最新 30 条未上货明细，已有记录自动跳过…'});
  const current=generation.current;
  function complete(value:Result){if(current!==generation.current)return;pending.current='';setNotice({tone:'success',message:`本次新增 ${value.inserted} 条，已有跳过 ${value.skipped} 条，待核查 ${value.held} 条。${value.excludedUnknown?`入库状态不明 ${value.excludedUnknown} 条未纳入。`:''}仅同步最新 ${value.selected??30} 条未上货明细，历史记录保留。`});onSynchronized();}
  try{
   // A lost response reuses the same idempotency key, after checking its receipt.
   if(pending.current){const check=await request('kingdee-sync-result?requestId='+pending.current);if(check.status==='complete'){complete(check.receipt);return;}}
   if(current!==generation.current)return;
   pending.current ||= clientId();
   complete(await request('kingdee-sync-run',{requestId:pending.current}));
  }catch(e){
   if(current!==generation.current)return;
   try{const check=await request('kingdee-sync-result?requestId='+pending.current);if(check.status==='complete'){complete(check.receipt);return;}}catch{/* Preserve the batch key until its result is known. */}
   if(current===generation.current)setNotice({tone:'error',message:(e as Error).message+' 可再次点击同步，程序会先核查本批结果并避免重复写入。'});
  }finally{running.current=false;setBusy(false);}
 }
 return <div className="kingdee-sync-action">
  <Button variant="outline" disabled={busy} aria-busy={busy} onClick={()=>void synchronize()}><RefreshCw size={16} className={busy?'animate-spin':undefined}/>同步金蝶总表</Button>
  {notice&&createPortal(<div className={'kingdee-sync-toast kingdee-sync-toast-'+notice.tone} role={notice.tone==='error'?'alert':'status'} aria-atomic="true">{notice.tone==='success'?<CircleCheck size={20}/>:notice.tone==='error'?<CircleAlert size={20}/>:<Info size={20}/>}<span>{notice.message}</span></div>,document.body)}
 </div>;
}
