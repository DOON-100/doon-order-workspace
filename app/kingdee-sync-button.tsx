'use client';
import {useEffect,useRef,useState} from 'react';
import {RefreshCw} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {clientId} from '@/lib/client-id';
import {request} from './ui';
import {getBusinessTeamScope} from './business-team-client';

type Result={inserted:number;skipped:number;held:number;deferred:number;page:number;pages:number;nextPage:number};
export function KingdeeSyncButton({onSynchronized}:{onSynchronized:()=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState<Result|null>(null);
 const pending=useRef(''),running=useRef(false),generation=useRef(0),scope=getBusinessTeamScope();
 useEffect(()=>{generation.current++;pending.current='';setResult(null);setError('');return()=>{generation.current++;};},[scope]);
 async function synchronize(){
  if(running.current)return;running.current=true;setBusy(true);setError('');setResult(null);
  const current=generation.current;
  function complete(value:Result){if(current!==generation.current)return;pending.current='';setResult(value);onSynchronized();}
  try{
   // A lost response reuses the same idempotency key, after checking its receipt.
   if(pending.current){const check=await request('kingdee-sync-result?requestId='+pending.current);if(check.status==='complete'){complete(check.receipt);return;}}
   if(current!==generation.current)return;
   pending.current ||= clientId();
   complete(await request('kingdee-sync-run',{requestId:pending.current}));
  }catch(e){
   if(current!==generation.current)return;
   try{const check=await request('kingdee-sync-result?requestId='+pending.current);if(check.status==='complete'){complete(check.receipt);return;}}catch{/* Preserve the batch key until its result is known. */}
   if(current===generation.current)setError((e as Error).message+' 可再次点击同步，程序会先核查本批结果并避免重复写入。');
  }finally{running.current=false;setBusy(false);}
 }
 return <div className="kingdee-sync-action">
  <Button variant="outline" disabled={busy} onClick={()=>void synchronize()}><RefreshCw size={16} className={busy?'animate-spin':undefined}/>{busy?'正在同步…':'同步金蝶总表'}</Button>
  {busy&&<p role="status">正在读取金蝶并去重新增，每次最多 30 条…</p>}
  {result&&<p role="status">本次新增 {result.inserted} 条，已有跳过 {result.skipped} 条，待核查 {result.held} 条。{result.deferred>0?`本页还有 ${result.deferred} 条待同步，再次点击继续。`:result.nextPage>1?'再次点击继续下一页。':'本轮已读取到末页。'}（第 {result.page} / {Math.max(1,result.pages)} 页）</p>}
  {error&&<p className="error" role="alert">{error}</p>}
 </div>;
}
