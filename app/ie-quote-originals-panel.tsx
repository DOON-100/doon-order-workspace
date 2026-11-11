'use client';
import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogDescription,DialogTitle} from '@/components/ui/dialog';
import {businessTeamFetch,getBusinessTeamScope} from './business-team-client';
import {useBusinessTeamScope} from './business-team-context';
import {dateTime} from './ui';
import './ie-quote-originals.css';

type TemplateStatus={configured?:boolean;filename?:string;templateVersion?:number;registeredQuoteVersion?:number;registeredAt?:string;canDownloadSource?:boolean;canDownloadPrepared?:boolean;message?:string};
type Quote={id?:string;version?:number;customerAccountId:string;templateStatus?:TemplateStatus};
type Attachment={id:string;originalName:string;size:number;sha256:string};
type Entry={id:string;note:string;createdAt:string;createdByName:string;attachments:Attachment[]};
type Feed={target:{module:string;collection:string;recordId:string;sectionKey:string};entries:Entry[]};
type OriginalDetail={scope:string;filename:string;url:string;canDownload:boolean;note:string;details:{label:string;value:string}[]};
const sizeLabel=(value:number)=>value<1024?`${value} B`:value<1024*1024?`${(value/1024).toFixed(1)} KiB`:`${(value/1024/1024).toFixed(2)} MiB`;
function failure(response:Response,result:unknown){const message=result&&typeof result==='object'&&'error'in result&&typeof result.error==='string'?result.error:'原件读取未完成，请重新读取当前报价资料。';return Object.assign(new Error(message),{status:response.status});}
async function readJson<T>(action:string,signal:AbortSignal):Promise<T>{
 const response=await businessTeamFetch('/api/workspace/'+action,{method:'GET',credentials:'same-origin',cache:'no-store',signal});
 const result=await response.json().catch(()=>null);if(!response.ok)throw failure(response,result);if(!result||typeof result!=='object')throw new Error('原件列表响应不完整，请重新读取。');return result as T;
}

/** Quote-version template files and separately authorized record-level originals.
 * No append/edit operation is exposed; changing identity or scope withdraws old reads.
 */
export function IeQuoteOriginalsPanel({quote,identityKey='',active=true}:{quote:Quote;identityKey?:string;active?:boolean}){
 const businessScope=useBusinessTeamScope(),team=businessScope?.teamId??getBusinessTeamScope();
 const scope=JSON.stringify([quote.id,quote.version,quote.customerAccountId,team,identityKey,active]);
 const currentScope=useRef(scope);currentScope.current=scope;
 const [loaded,setLoaded]=useState<{scope:string;feed:Feed;template:TemplateStatus}|null>(null),[retry,setRetry]=useState(0),[loading,setLoading]=useState(false),[working,setWorking]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[detail,setDetail]=useState<OriginalDetail|null>(null);
 const fileRequest=useRef<AbortController|null>(null),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;fileRequest.current?.abort();};},[]);
 useEffect(()=>{
  const controller=new AbortController(),globalTeam=getBusinessTeamScope();fileRequest.current?.abort();setLoaded(null);setDetail(null);setError('');setNotice('');setWorking(false);
  if(!active||!quote.id||!quote.version){setLoading(false);return()=>controller.abort();}
  const isCurrent=()=>alive.current&&!controller.signal.aborted&&currentScope.current===scope&&getBusinessTeamScope()===globalTeam;
  setLoading(true);
  const params=new URLSearchParams({module:'ie-quotes',collection:'quotes',recordId:quote.id,sectionKey:'record'}),templateParams=new URLSearchParams({id:quote.id,version:String(quote.version)});
  void Promise.all([readJson<Feed>('business-followup-data?'+params,controller.signal),readJson<{templateStatus:TemplateStatus}>('ie-quote-template-status?'+templateParams,controller.signal)]).then(([feed,template])=>{
   if(!isCurrent())return;
   if(feed.target?.module!=='ie-quotes'||feed.target?.collection!=='quotes'||feed.target?.recordId!==quote.id||feed.target?.sectionKey!=='record'||!Array.isArray(feed.entries)||feed.entries.some((entry:Entry)=>!entry||typeof entry.id!=='string'||!Array.isArray(entry.attachments)||entry.attachments.some(file=>!file||typeof file.id!=='string'||typeof file.originalName!=='string'||typeof file.size!=='number'||typeof file.sha256!=='string'))||!template.templateStatus||typeof template.templateStatus.configured!=='boolean')throw new Error('原件关联与所选报价不一致，旧列表已撤回，请重新读取。');
   setLoaded({scope,feed,template:template.templateStatus});
  }).catch(cause=>{if(isCurrent()){setLoaded(null);setDetail(null);setError(cause instanceof Error?cause.message:'原件读取失败，旧列表已撤回。');}}).finally(()=>{if(isCurrent())setLoading(false);});
  return()=>{controller.abort();fileRequest.current?.abort();};
 },[scope,retry,quote.id,quote.version,active]);
 const data=active&&loaded?.scope===scope?loaded:null,visibleDetail=active&&detail?.scope===scope?detail:null;
 const download=async(file:OriginalDetail)=>{
  if(!active||!file.canDownload||working||!data||file.scope!==currentScope.current)return;
  const controller=new AbortController(),globalTeam=getBusinessTeamScope();fileRequest.current?.abort();fileRequest.current=controller;setWorking(true);setError('');setNotice('');
  const isCurrent=()=>alive.current&&!controller.signal.aborted&&currentScope.current===file.scope&&getBusinessTeamScope()===globalTeam;
  try{
   const response=await businessTeamFetch(file.url,{method:'GET',credentials:'same-origin',cache:'no-store',signal:controller.signal});
   if(!response.ok)throw failure(response,await response.json().catch(()=>null));
   const blob=await response.blob();if(!isCurrent())return;if(!blob.size||response.headers.get('content-type')?.includes('application/json'))throw new Error('未返回有效原件，旧列表已撤回，请重新读取。');
   const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=file.filename;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setNotice('已发起原件下载，请在浏览器下载列表核对。');
  }catch(cause){if(isCurrent()){setLoaded(null);setDetail(null);setError(cause instanceof Error?cause.message:'原件下载未完成，请重新读取。');}}
  finally{if(isCurrent())setWorking(false);}
 };
 const templateFile=(kind:'source'|'prepared'):OriginalDetail=>{
  const status=data!.template,filename=(kind==='source'?'源Excel原件_':'已整理打印副本_')+(status.filename||'报价模板.xlsx');
  const params=new URLSearchParams({id:quote.id!,version:String(quote.version),kind});
  return {scope,filename,url:'/api/workspace/ie-quote-template-file?'+params,canDownload:kind==='source'?status.canDownloadSource===true:status.canDownloadPrepared===true,note:kind==='source'?'完整源 Excel 可能含其他客户或历史表，仅管理员可下载；原件不等于全部表已被本报价采用。':'此打印副本仅保留登记映射的款式，不重新核算或替换所选报价历史版本。',details:[{label:'所选报价版本',value:'V'+quote.version},{label:'模板登记版本',value:'T'+status.templateVersion},{label:'首次登记报价版本',value:'V'+status.registeredQuoteVersion},{label:'登记时间',value:status.registeredAt?dateTime(status.registeredAt):'未记录'}]};
 };
 const recordFile=(entry:Entry,file:Attachment):OriginalDetail=>({scope,filename:file.originalName,url:'/api/workspace/business-followup-download?'+new URLSearchParams({id:file.id}),canDownload:true,note:'这是报价记录级附件；它不是所选历史版本已采用资料的证明，采用关系仍以该版本明确引用为准。',details:[{label:'资料范围',value:'报价记录级资料'},{label:'记录人',value:entry.createdByName||'未记录'},{label:'记录时间',value:dateTime(entry.createdAt)},{label:'文件大小',value:sizeLabel(file.size)},{label:'原件 SHA-256',value:file.sha256},{label:'来源记录说明',value:entry.note||'无补充说明'}]});
 if(!active)return null;
 return <section className="ieq-originals" aria-label="报价原件与来源资料"><div className="ieq-section-title"><div><h3>原 Excel、打印副本与来源资料</h3><p className="ieq-help">原件保留原位置与内容；查看或下载不保存、不审核、不下推报价。</p></div><Button type="button" size="sm" variant="outline" disabled={loading||working||!quote.id} onClick={()=>setRetry(value=>value+1)}>重新读取原件</Button></div>
 {!quote.id&&<p className="ieq-help">保存报价后可查看它的历史来源资料与原件。</p>}{loading&&<p role="status">正在按所选报价、版本及当前权限读取原件……</p>}{error&&<p role="alert" className="ieq-alert error">{error}</p>}{notice&&<p role="status" className="ieq-alert success">{notice}</p>}
 {data&&<><div className="ieq-original-group"><h4>所选报价 V{quote.version} 的 Excel 模板</h4>{data.template.configured?<><p className="ieq-help">{data.template.message}</p><div className="ieq-original-list">{(['prepared','source'] as const).map(kind=>{const file=templateFile(kind);return <article key={kind}><div><button type="button" className="ieq-original-name" disabled={working} onClick={()=>setDetail(file)}>{file.filename}</button><p>{kind==='source'?'完整源 Excel · 仅管理员可下载':'已整理打印副本 · 按当前报价权限下载'} · 模板 T{data.template.templateVersion}</p></div><Button type="button" size="sm" variant="outline" disabled={working||!file.canDownload} onClick={()=>void download(file)}>下载{kind==='source'?'源 Excel':'打印副本'}</Button></article>;})}</div></>:<p className="ieq-help">所选报价版本没有已绑定的 Excel 打印模板。下方来源附件仍按记录级范围查询，不能自动当作本版本模板。</p>}</div>
 <div className="ieq-original-group"><h4>报价记录级来源与原附件</h4><p className="ieq-original-boundary">以下资料属于同一报价记录，不是所选历史版本已采用资料。记录时间、来源说明及原件分别保留。</p>{!data.feed.entries.length&&<p className="ieq-help">当前授权范围没有记录级来源资料。</p>}{data.feed.entries.map(entry=><article className="ieq-original-entry" key={entry.id}><header><b>{entry.createdByName||'未记录'}</b><span>{dateTime(entry.createdAt)}</span></header><p className="ieq-original-note">{entry.note||'此记录未填写说明。'}</p>{entry.attachments.length?<div className="ieq-original-list">{entry.attachments.map(file=>{const original=recordFile(entry,file);return <article key={file.id}><div><button type="button" className="ieq-original-name" disabled={working} onClick={()=>setDetail(original)}>{file.originalName}</button><p>{sizeLabel(file.size)} · 记录级原件</p></div><Button type="button" size="sm" variant="outline" disabled={working} onClick={()=>void download(original)}>下载原件</Button></article>;})}</div>:<p className="ieq-help">此来源记录没有附件。</p>}</article>)}</div></>}
 <Dialog open={!!visibleDetail} onOpenChange={open=>{if(!open)setDetail(null);}}><DialogContent className="ieq-original-dialog"><DialogTitle>报价原件详情</DialogTitle><DialogDescription>{visibleDetail?.note||'查看已授权的报价原件及来源信息。'}</DialogDescription>{visibleDetail&&<><h4>{visibleDetail.filename}</h4><dl>{visibleDetail.details.map(item=><div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl><Button type="button" disabled={working||!visibleDetail.canDownload||!data} onClick={()=>void download(visibleDetail)}>{working?'正在读取原件…':'下载此原件'}</Button>{!visibleDetail.canDownload&&<p className="ieq-help">当前账号没有完整源 Excel 下载权限。</p>}</>}</DialogContent></Dialog>
 </section>;
}
