'use client';
import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {CircleCheck,CircleAlert} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {clientId} from '@/lib/client-id';
import {getBusinessTeamScope} from './business-team-client';
import {dateTime,request} from './ui';
import {ExcelTable,useExcelColumnFilters} from './excel-table';
import './kingdee-supplier-catalog.css';
import './supplier-workspace.css';

type SupplierRow={id:string;code:string;name:string;firstSeen:string;groupName:string|null;taxRate:string|null};
type Receipt={inserted:number;existing:number;changed:number;total:number;completedAt:string;scope?:'baseline'|'last-24-hours';addedSuppliers?:{code:string;name:string}[]};
type Issue={code:string;name:string;reason:string;previousCode:string;previousName:string;groupName:string|null;taxRate:string|null;previousGroupName:string|null;previousTaxRate:string|null};
type Catalog={rows:SupplierRow[];lastSync:Receipt|null;issues?:Issue[];autoEnabled?:boolean;autoStatus?:null|{lastAttemptAt:string;lastResult:'started'|'complete'|'failed';lastSuccessAt:string}};
const sourceValue=(value:string|null|undefined)=>value==null?'未提供':value===''?'空':value;

/** The catalog is an independent Kingdee source, not a link to existing suppliers. */
export function KingdeeSupplierCatalogPanel({actorId}:{actorId:string}){
 const team=getBusinessTeamScope(),scope=actorId+'\0'+team,scopeRef=useRef(scope);scopeRef.current=scope;
 const [data,setData]=useState<Catalog|null>(null),[dataScope,setDataScope]=useState(''),[search,setSearch]=useState(''),[page,setPage]=useState(0);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState<{tone:'success'|'error';message:string;addedSuppliers?:{code:string;name:string}[]}|null>(null),[pending,setPending]=useState('');
 const busyRef=useRef(false);
 useEffect(()=>{setData(null);setDataScope('');setSearch('');setPage(0);setError('');setNotice(null);setPending('');},[scope]);
 useEffect(()=>{if(!notice||notice.addedSuppliers?.length)return;const timer=setTimeout(()=>setNotice(null),5000);return()=>clearTimeout(timer);},[notice]);
 const current=(frozen:string)=>scopeRef.current===frozen&&getBusinessTeamScope()==='';
 async function load(frozen:string){
  try{const result=await request('kingdee-supplier-catalog') as Catalog;if(current(frozen)){setData(result);setDataScope(frozen);setError('');}}
  catch(e){if(current(frozen)){setData(null);setError((e as Error).message);}}
 }
 useEffect(()=>{if(actorId&&!team)void load(scope);},[scope]);
 async function sync(){
  if(busyRef.current||!actorId||getBusinessTeamScope())return;
  const frozen=scopeRef.current;let requestId=pending;
  try{if(!requestId)requestId=clientId();}catch{setError('无法生成安全的请求编号，请检查浏览器后重试。');return;}
  busyRef.current=true;setBusy(true);setPending(requestId);setError('');setNotice(null);
  async function complete(receipt:Receipt){if(current(frozen)){setPending('');const range=receipt.scope==='last-24-hours'?'最近 24 小时':receipt.scope==='baseline'?'首次历史':'本次';const message=receipt.total===0?(receipt.scope==='last-24-hours'?'未查到 24 小时内新增的供应商。':`${range}未查到供应商，没有新增。`):`${range}查询 ${receipt.total} 条，新增 ${receipt.inserted} 条${receipt.existing?`，已在档案中 ${receipt.existing} 条`:''}${receipt.changed?`，资料变化待核查 ${receipt.changed} 条`:''}。`;setNotice({tone:'success',message,addedSuppliers:receipt.addedSuppliers});await load(frozen);}}
  try{
   if(pending){const prior=await request('kingdee-supplier-catalog-result?requestId='+encodeURIComponent(requestId)) as {status:'complete'|'not-completed';receipt?:Receipt};if(prior.status==='complete'&&prior.receipt){await complete(prior.receipt);return;}}
   if(!current(frozen))return;
   const receipt=await request('kingdee-supplier-catalog-sync',{requestId}) as Receipt;
   await complete(receipt);
  }catch(e){
   if(!current(frozen))return;
   try{const prior=await request('kingdee-supplier-catalog-result?requestId='+encodeURIComponent(requestId)) as {status:'complete'|'not-completed';receipt?:Receipt};if(prior.status==='complete'&&prior.receipt){await complete(prior.receipt);return;}}catch{/* Keep the original request ID for the next attempt. */}
   if(current(frozen))setNotice({tone:'error',message:(e as Error).message+' 同步结果尚未确认，再次点击时会先核查本次结果。'});
  }
  finally{busyRef.current=false;setBusy(false);}
 }
 const visibleData=dataScope===scope&&!team?data:null;
 const baseRows=(visibleData?.rows||[]).filter(row=>[row.code,row.name].some(value=>value.toLowerCase().includes(search.toLowerCase())));
 const columnModel=useExcelColumnFilters(baseRows,row=>[row.code,row.name,sourceValue(row.groupName),sourceValue(row.taxRate)]);
 const filtered=columnModel.rows;
 useEffect(()=>setPage(0),[columnModel.filters]);
 useEffect(()=>{columnModel.clearFilters();},[scope,columnModel.clearFilters]);
 useEffect(()=>setPage(p=>Math.min(p,Math.max(0,Math.ceil(filtered.length/30)-1))),[filtered.length]);
 return <section className="kingdee-catalog" aria-label="金蝶供应商来源档案">
    <div className="kingdee-catalog-heading"><div><h3>金蝶供应商档案</h3><p>按金蝶编码保存的来源资料</p></div><div className="kingdee-catalog-actions"><Button className="kingdee-catalog-sync" disabled={busy||!actorId||!!team} aria-busy={busy} onClick={()=>void sync()}>{busy?'更新中…':'手动更新金蝶档案'}</Button><Button variant="outline" disabled={busy||!actorId||!!team} onClick={()=>void load(scopeRef.current)}>刷新列表</Button></div></div>
    {visibleData?.autoEnabled&&visibleData.autoStatus&&<p className="kingdee-catalog-meta">后台最近尝试 {dateTime(visibleData.autoStatus.lastAttemptAt)}：{visibleData.autoStatus.lastResult==='complete'?'已完成':visibleData.autoStatus.lastResult==='failed'?'未完成，请核查服务端':'已开始；如长时间不更新请核查服务端'}。最近后台成功 {dateTime(visibleData.autoStatus.lastSuccessAt)}。</p>}
    {error&&<p className="error" role="alert">{error}</p>}{notice&&createPortal(<div className={'kingdee-sync-toast kingdee-catalog-toast kingdee-sync-toast-'+notice.tone} role={notice.tone==='error'?'alert':'status'} aria-atomic="true">{notice.tone==='success'?<CircleCheck size={20}/>:<CircleAlert size={20}/>}<div><span>{notice.message}</span>{!!notice.addedSuppliers?.length&&<><p>新增供应商：</p><ul>{notice.addedSuppliers.map((supplier,index)=><li key={supplier.code+'-'+index}>{supplier.name}（{supplier.code}）</li>)}</ul></>}</div>{!!notice.addedSuppliers?.length&&<button type="button" aria-label="关闭同步结果" onClick={()=>setNotice(null)}>关闭</button>}</div>,document.body)}
    {visibleData&&<><div className="kingdee-catalog-bar"><label><span className="sr-only">搜索编码或名称</span><input aria-label="搜索编码或名称" placeholder="搜索供应商编码或名称" value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}}/></label><span>{filtered.length} 条 · 每页 30 条</span></div>
     <div className="kingdee-catalog-table"><ExcelTable filterModel={columnModel} className="w-full text-sm"><thead><tr><th>金蝶编码</th><th>供应商名称</th><th>分类原值</th><th>税率原值</th></tr></thead><tbody>{filtered.slice(page*30,page*30+30).map(row=><tr key={row.id}><td>{row.code}</td><td>{row.name}</td><td>{sourceValue(row.groupName)}</td><td>{sourceValue(row.taxRate)}</td></tr>)}</tbody></ExcelTable></div>
     {!filtered.length&&<p>暂无符合条件的供应商档案。</p>}<div className="kingdee-catalog-footer"><span>{visibleData.lastSync?`最近留存批次 ${dateTime(visibleData.lastSync.completedAt)} · 变更待核查 ${visibleData.lastSync.changed} 条`:'尚无留存批次'}</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page===0} onClick={()=>setPage(page-1)}>上一页</Button><Button variant="outline" size="sm" disabled={(page+1)*30>=filtered.length} onClick={()=>setPage(page+1)}>下一页</Button></div></div>
     {!!visibleData.issues?.length&&<section><h3>来源变化待核查 · {visibleData.issues.length} 条</h3><p>旧档案仍保留，请核对金蝶中的来源字段。</p><div className="overflow-auto max-h-64"><ExcelTable className="w-full text-sm"><thead><tr><th>原编码</th><th>原名称</th><th>当前编码</th><th>当前名称</th><th>原分类</th><th>原税率</th><th>当前分类</th><th>当前税率</th><th>原因</th></tr></thead><tbody>{visibleData.issues.map((issue,index)=><tr key={index}><td>{issue.previousCode}</td><td>{issue.previousName}</td><td>{issue.code}</td><td>{issue.name}</td><td>{sourceValue(issue.previousGroupName)}</td><td>{sourceValue(issue.previousTaxRate)}</td><td>{sourceValue(issue.groupName)}</td><td>{sourceValue(issue.taxRate)}</td><td>{issue.reason}</td></tr>)}</tbody></ExcelTable></div></section>}
    </>}
 </section>;
}
