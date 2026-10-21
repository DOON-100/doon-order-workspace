'use client';
import {useEffect,useRef,useState} from 'react';
import {RefreshCw} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {kingdeeQueryHeaders,type KingdeeQueryPage} from '@/lib/kingdee-readonly-types';
import {request,dateTime} from './ui';
import {getBusinessTeamScope} from './business-team-client';

export function KingdeeReadonlyDialog(){
 const [open,setOpen]=useState(false),[status,setStatus]=useState<{configured:boolean;message:string}|null>(null);
 const [start,setStart]=useState(''),[end,setEnd]=useState(''),[result,setResult]=useState<KingdeeQueryPage|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const controller=useRef<AbortController|null>(null),scope=getBusinessTeamScope();
 useEffect(()=>()=>controller.current?.abort(),[]);
 useEffect(()=>{controller.current?.abort();setOpen(false);setResult(null);setStatus(null);setBusy(false);setError('');},[scope]);
 function close(){controller.current?.abort();controller.current=null;setOpen(false);setResult(null);setStatus(null);setBusy(false);setError('');}
 async function begin(){
  controller.current?.abort();const current=new AbortController();controller.current=current;
  setOpen(true);setResult(null);setStatus(null);setError('');setBusy(true);
  try{const value=await request('kingdee-readonly-status',undefined,{signal:current.signal});if(!current.signal.aborted)setStatus(value);}
  catch(e){if(!current.signal.aborted)setError((e as Error).message);}
  finally{if(controller.current===current)setBusy(false);}
 }
 async function query(page:number){
  if(busy||!status?.configured)return;
  controller.current?.abort();const current=new AbortController();controller.current=current;
  setBusy(true);setError('');setResult(null);
  const params=new URLSearchParams({page:String(page),...(start?{start}:{}),...(end?{end}:{})});
  try{const value=await request('kingdee-readonly-query?'+params,undefined,{signal:current.signal});if(!current.signal.aborted)setResult(value);}
  catch(e){if(!current.signal.aborted)setError((e as Error).message);}
  finally{if(controller.current===current)setBusy(false);}
 }
 return <>
  <Button variant="outline" onClick={()=>void begin()}><RefreshCw size={16}/>同步金蝶总表</Button>
  <Dialog open={open} onOpenChange={value=>{if(!value)close();}}><DialogContent className="dialog-scroll sm:max-w-[1100px]">
   <DialogHeader><DialogTitle>同步金蝶总表 · 只读查询</DialogTitle><DialogDescription>从金蝶查询已审核采购订单，展示未入库、部分入库及状态待核查的商品行。结果仅在此窗口显示，不写入中台，不修改金蝶。</DialogDescription></DialogHeader>
   {status&&<p role="status">{status.message}</p>}
   <div className="supplier-source-import kingdee-readonly-filters">
    <label>单据开始日期<input type="date" aria-label="金蝶查询开始日期" value={start} disabled={busy} onChange={e=>{setStart(e.target.value);setResult(null);}}/></label>
    <label>单据结束日期<input type="date" aria-label="金蝶查询结束日期" value={end} disabled={busy} onChange={e=>{setEnd(e.target.value);setResult(null);}}/></label>
   </div>
   <p className="note">日期留空表示不限日期。按金蝶采购单分页，每页最多 5 张；数量为原单数量。关闭状态保留原值，缺失信息不推断。</p>
   <div className="supplier-source-actions"><Button disabled={busy||!status?.configured} onClick={()=>void query(1)}>{busy?'正在查询…':'只读查询金蝶'}</Button><Button variant="outline" onClick={close}>{busy?'取消查询并关闭':'关闭'}</Button>{!status&&!busy&&<Button variant="outline" onClick={()=>void begin()}>重新检查连接配置</Button>}</div>
   {error&&<p className="error" role="alert">{error} 未取得完整的当前页结果。</p>}
   {busy&&<p role="status">正在读取金蝶，可能需要等待数秒…</p>}
   {result&&<section className="supplier-source-preview">
    <h3>本页查询结果：{result.rows.length} 条商品行</h3>
    <p>日期范围内共 {result.count} 张已审核采购单（含已全部入库订单），第 {result.page} / {Math.max(1,result.pages)} 页。本页已排除 {result.excludedComplete} 条全部入库商品行，{result.unknown} 条入库状态待核查。</p>
    <p>读取时间：{dateTime(result.startedAt)} 至 {dateTime(result.finishedAt)}。分页查询不代表同一时刻的完整账套快照；结果尚未与中台客户订单建立关联。</p>
    <p>左右滚动表格可查看数量、交货日期、入库状态和金蝶行 ID。</p>
    <div className="supplier-source-table-wrap supplier-source-preview-table kingdee-readonly-results" role="region" aria-label="金蝶采购只读查询结果" tabIndex={0}><table className="supplier-source-table"><thead><tr>{kingdeeQueryHeaders.map(header=><th key={header}>{header}</th>)}</tr></thead><tbody>{result.rows.map(row=><tr key={row.id}>{row.values.map((value,i)=><td key={i} className={row.uncertain&&i===11?'supplier-source-overdue':undefined}>{value||'—'}</td>)}</tr>)}</tbody></table></div>
    {!result.rows.length&&<p>{result.count?'本页采购单没有未入库、部分入库或状态待核查的商品行。可继续查看其他页。':'当前单据日期范围内没有已审核采购订单。'}</p>}
    <div className="supplier-source-actions"><Button variant="outline" disabled={busy||result.page===1} onClick={()=>void query(result.page-1)}>上一页</Button><Button variant="outline" disabled={busy||result.page>=result.pages} onClick={()=>void query(result.page+1)}>下一页</Button></div>
   </section>}
  </DialogContent></Dialog>
 </>;
}
