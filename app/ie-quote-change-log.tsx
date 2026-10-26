'use client';
import {useEffect,useState} from 'react';
import {businessTeamFetch} from './business-team-client';
import {compareIeQuoteVersions,type IeQuoteChange} from '@/lib/ie-quote-change-log';
import type {IeQuote} from '@/lib/ie-quotes';
type Version={version:number;revision:number;status:string;action:string;updatedAt:string;updatedBy:string};
export function IeQuoteChangeLog({quoteId,history,memberId}:{quoteId:string;history:Version[];memberId:string}){
 const versions=[...history].sort((a,b)=>b.version-a.version),historyKey=versions.map(v=>v.version).join(','),[after,setAfter]=useState(versions[0]?.version||0),[before,setBefore]=useState(versions[1]?.version||0),[changes,setChanges]=useState<IeQuoteChange[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState(''),[all,setAll]=useState(false),[refresh,setRefresh]=useState(0);
 useEffect(()=>{setAfter(versions[0]?.version||0);setBefore(versions[1]?.version||0);setChanges([]);setAll(false);},[quoteId,historyKey,memberId]);
 useEffect(()=>{const focus=()=>setRefresh(v=>v+1);window.addEventListener('focus',focus);return()=>window.removeEventListener('focus',focus);},[]);
 useEffect(()=>{let live=true;setChanges([]);setError('');setAll(false);if(!after)return;setLoading(true);
  const read=async(version:number)=>{const response=await businessTeamFetch('/api/workspace/ie-quote?id='+encodeURIComponent(quoteId)+'&version='+version,{cache:'no-store'}),result=await response.json() as {quote?:IeQuote;error?:string};if(!response.ok||!result.quote)throw new Error(result.error||'版本不可读取，请重新核对权限。');return result.quote;};
  void Promise.all([before?read(before):Promise.resolve(null),read(after)]).then(([a,b])=>{if(live)setChanges(compareIeQuoteVersions(a,b));}).catch(e=>{if(live){setChanges([]);setError((e as Error).message);}}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;};
 },[quoteId,before,after,memberId,historyKey,refresh]);
 const current=versions.find(v=>v.version===after),shown=all?changes:changes.slice(0,100);
 return <section className="ieq-change-log"><h3>版本修改日志</h3><p className="ieq-help">每次保存、提交、复核和修订均保留独立版本。按稳定明细编号比较前后内容，已发布记录不会被覆盖。</p>
 <div className="ieq-form-grid"><label>修改前版本 <select aria-label="修改前版本" value={before} onChange={e=>setBefore(Number(e.target.value))}><option value={0}>创建之前</option>{versions.map(v=><option key={v.version} value={v.version}>V{v.version} · {v.action}</option>)}</select></label><label>修改后版本 <select aria-label="修改后版本" value={after} onChange={e=>setAfter(Number(e.target.value))}>{versions.map(v=><option key={v.version} value={v.version}>V{v.version} · {v.action}</option>)}</select></label></div>
 {current&&<p><strong>V{current.version} · {current.action}</strong> · {current.updatedBy} · {new Date(current.updatedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}</p>}
 {error&&<div role="alert" className="ieq-alert error">{error}</div>}{loading?<p role="status">正在核对两个版本…</p>:!error&&<><p>共 {changes.length} 处字段或状态变化{!all&&changes.length>100?'，当前显示前 100 处':''}。</p><div style={{overflowX:'auto'}}><table><thead><tr><th>修改项目</th><th>修改前{before?' V'+before:''}</th><th>修改后 V{after}</th></tr></thead><tbody>{shown.map(c=><tr key={c.path}><td>{c.label}</td><td style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{c.before}</td><td style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{c.after}</td></tr>)}</tbody></table></div>{changes.length>100&&!all&&<button type="button" onClick={()=>setAll(true)}>查看全部 {changes.length} 处变化</button>}</>}
 </section>;
}
