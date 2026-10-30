'use client';
import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {clientId} from '@/lib/client-id';
import {getBusinessTeamScope} from './business-team-client';
import {dateTime,request} from './ui';

type SupplierRow={id:string;code:string;name:string;firstSeen:string;groupName:string|null;taxRate:string|null};
type Receipt={inserted:number;existing:number;changed:number;total:number;completedAt:string};
type Issue={code:string;name:string;reason:string;previousCode:string;previousName:string;groupName:string|null;taxRate:string|null;previousGroupName:string|null;previousTaxRate:string|null};
type Catalog={rows:SupplierRow[];lastSync:Receipt|null;issues?:Issue[];autoEnabled?:boolean;autoStatus?:null|{lastAttemptAt:string;lastResult:'started'|'complete'|'failed';lastSuccessAt:string}};
const sourceValue=(value:string|null|undefined)=>value==null?'未提供':value===''?'空':value;

/** The catalog is an independent Kingdee source, not a link to existing suppliers. */
export function KingdeeSupplierCatalogPanel({actorId}:{actorId:string}){
 const team=getBusinessTeamScope(),scope=actorId+'\0'+team,scopeRef=useRef(scope);scopeRef.current=scope;
 const [open,setOpen]=useState(false),[openScope,setOpenScope]=useState(''),[data,setData]=useState<Catalog|null>(null),[dataScope,setDataScope]=useState(''),[search,setSearch]=useState(''),[page,setPage]=useState(0);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[pending,setPending]=useState('');
 const busyRef=useRef(false);
 useEffect(()=>{setOpen(false);setOpenScope('');setData(null);setDataScope('');setSearch('');setPage(0);setError('');setNotice('');setPending('');},[scope]);
 const current=(frozen:string)=>scopeRef.current===frozen&&getBusinessTeamScope()==='';
 async function load(frozen:string){
  try{const result=await request('kingdee-supplier-catalog') as Catalog;if(current(frozen)){setData(result);setDataScope(frozen);setError('');}}
  catch(e){if(current(frozen)){setData(null);setError((e as Error).message);}}
 }
 async function show(){
  if(!actorId||getBusinessTeamScope())return;
  const frozen=scopeRef.current;setOpen(true);setOpenScope(frozen);setData(null);setDataScope('');setError('');setNotice('');await load(frozen);
 }
 async function sync(){
  if(busyRef.current||!actorId||getBusinessTeamScope())return;
  const frozen=scopeRef.current;let requestId=pending;
  try{if(!requestId)requestId=clientId();}catch{setError('无法生成安全的请求编号，请检查浏览器后重试。');return;}
  busyRef.current=true;setBusy(true);setPending(requestId);setError('');setNotice('');
  try{
   const receipt=await request('kingdee-supplier-catalog-sync',{requestId}) as Receipt;
   if(current(frozen)){setPending('');setNotice(`本次新增 ${receipt.inserted} 条，已有 ${receipt.existing} 条，变更待核查 ${receipt.changed} 条。`);await load(frozen);}
  }catch(e){if(current(frozen))setError((e as Error).message+' 同步结果尚未确认，请先核查本次结果或使用相同编号重试。');}
  finally{busyRef.current=false;setBusy(false);}
 }
 async function check(){
  if(!pending||busyRef.current||getBusinessTeamScope())return;
  const frozen=scopeRef.current,requestId=pending;busyRef.current=true;setBusy(true);setError('');
  try{
   const result=await request('kingdee-supplier-catalog-result?requestId='+encodeURIComponent(requestId)) as {status:'complete'|'not-completed';receipt?:Receipt};
   if(!current(frozen))return;
   if(result.status==='complete'&&result.receipt){setPending('');setNotice(`本次新增 ${result.receipt.inserted} 条，已有 ${result.receipt.existing} 条，变更待核查 ${result.receipt.changed} 条。`);await load(frozen);}
   else setNotice('暂未查到完成回执；请求可能仍在处理。请稍后核查，或使用同一编号重试。');
  }catch(e){if(current(frozen))setError((e as Error).message+' 请稍后再次核查本次结果。');}
  finally{busyRef.current=false;setBusy(false);}
 }
 const visibleData=dataScope===scope&&!team?data:null;
 const filtered=(visibleData?.rows||[]).filter(row=>[row.code,row.name].some(value=>value.toLowerCase().includes(search.toLowerCase())));
 return <>
  <Button variant="outline" disabled={!actorId||!!team} onClick={()=>void show()}>金蝶供应商档案</Button>
  <Dialog open={open&&openScope===scope&&!team} onOpenChange={value=>{if(!busy){setOpen(value);if(!value){setData(null);setDataScope('');setSearch('');setPage(0);}}}}>
   <DialogContent className="dialog-scroll sm:max-w-[950px]"><DialogHeader><DialogTitle>金蝶供应商档案</DialogTitle><DialogDescription>按金蝶供应商编码查看独立来源档案。</DialogDescription></DialogHeader>
    <p className="muted">这里是累计保留的金蝶来源档案，包含后来停用、删除或未在来源返回的记录，不代表供应商当前有效状态。更新只新增来源记录，不会自动关联已有供应商、外发或供应商门户，也不会覆盖历史资料。同名不同编码分别保留；来源变更须核查，旧名称保留。</p>
    {visibleData&&<p>{visibleData.autoEnabled?'自动同步已配置；请以最近成功更新时间判断运行状态。':'自动同步未启用；请手动更新。'}</p>}
    {visibleData?.autoEnabled&&visibleData.autoStatus&&<p>后台最近尝试 {dateTime(visibleData.autoStatus.lastAttemptAt)}：{visibleData.autoStatus.lastResult==='complete'?'已完成':visibleData.autoStatus.lastResult==='failed'?'未完成，请核查服务端':'已开始；如长时间不更新请核查服务端'}。最近后台成功 {dateTime(visibleData.autoStatus.lastSuccessAt)}。</p>}
    <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={()=>void sync()}>{busy?'正在处理…':pending?'使用同一编号重试':'手动更新金蝶档案'}</Button>{pending&&<Button variant="outline" disabled={busy} onClick={()=>void check()}>核查本次结果</Button>}<Button variant="outline" disabled={busy} onClick={()=>void load(scopeRef.current)}>刷新列表</Button></div>
    {error&&<p className="error" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {visibleData&&<><p>档案 {visibleData.rows.length} 条 · {visibleData.lastSync?`最近留存批次 ${dateTime(visibleData.lastSync.completedAt)}，该批次变更待核查 ${visibleData.lastSync.changed} 条`:'尚无留存批次'}</p>
     <label>搜索编码或名称<input className="block mt-2" value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}}/></label>
     <p>{filtered.length} 条 · 每页 30 条</p><div className="overflow-auto"><table className="w-full text-sm"><thead><tr><th>金蝶编码</th><th>供应商名称</th><th>分类原值</th><th>税率原值</th><th>首次记录</th></tr></thead><tbody>{filtered.slice(page*30,page*30+30).map(row=><tr key={row.id}><td>{row.code}</td><td>{row.name}</td><td>{sourceValue(row.groupName)}</td><td>{sourceValue(row.taxRate)}</td><td>{dateTime(row.firstSeen)}</td></tr>)}</tbody></table></div>
     {!filtered.length&&<p>暂无符合条件的供应商档案。</p>}<div className="flex gap-2"><Button variant="outline" size="sm" disabled={page===0} onClick={()=>setPage(page-1)}>上一页</Button><Button variant="outline" size="sm" disabled={(page+1)*30>=filtered.length} onClick={()=>setPage(page+1)}>下一页</Button></div>
     {!!visibleData.issues?.length&&<section><h3>来源变化待核查 · {visibleData.issues.length} 条</h3><p>旧档案仍保留，请核对金蝶中的来源字段。</p><div className="overflow-auto max-h-64"><table className="w-full text-sm"><thead><tr><th>原编码 / 名称</th><th>金蝶当前编码 / 名称</th><th>原分类 / 税率</th><th>当前分类 / 税率</th><th>原因</th></tr></thead><tbody>{visibleData.issues.map((issue,index)=><tr key={index}><td>{issue.previousCode} / {issue.previousName}</td><td>{issue.code} / {issue.name}</td><td>{sourceValue(issue.previousGroupName)} / {sourceValue(issue.previousTaxRate)}</td><td>{sourceValue(issue.groupName)} / {sourceValue(issue.taxRate)}</td><td>{issue.reason}</td></tr>)}</tbody></table></div></section>}
    </>}
   </DialogContent>
  </Dialog>
 </>;
}
