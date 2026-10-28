'use client';
import {createContext,useContext,useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Download,FilePlus2,MessageSquare,RefreshCw,X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {clientId} from '@/lib/client-id';
import {businessTeamFetch,downloadBusinessTeamFile,getBusinessTeamScope} from './business-team-client';
import {useBusinessTeamScope} from './business-team-context';
import './business-followup-panel.css';

export type BusinessFollowupPanelProps={module:string;collection?:string;recordId?:string;sectionKey?:string;title?:string;onDirtyChange?:(dirty:boolean)=>void};
type Target={module:string;collection:string;recordId:string;label:string;sectionKey:string;sectionLabel:string;canAppend:boolean};
type Attachment={id:string;originalName:string;size:number;sha256:string};
type Entry={id:string;note:string;createdAt:string;createdByName:string;attachments:Attachment[]};
type Feed={target:Target;entries:Entry[]};
type Intent='attachment'|'communication'|'history';
type ProviderProps=BusinessFollowupPanelProps&{children:ReactNode;identityKey?:string;enabled?:boolean;suppressSlots?:boolean};
type ContextValue={defaults:BusinessFollowupPanelProps;identityKey:string;enabled:boolean;suppressSlots:boolean;open:(props:BusinessFollowupPanelProps,intent:Intent)=>void;reportDirty:(id:string,dirty:boolean)=>void};
const FollowupContext=createContext<ContextValue|null>(null);
const sizeLabel=(size:number)=>size<1024?`${size} B`:size<1024*1024?`${(size/1024).toFixed(1)} KiB`:`${(size/1024/1024).toFixed(2)} MiB`;
const atLabel=(value:string)=>{const at=new Date(value);return Number.isNaN(at.getTime())?value:at.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});};
const targetKey=(target:Pick<Target,'module'|'collection'|'recordId'|'sectionKey'>)=>JSON.stringify([target.module,target.collection,target.recordId,target.sectionKey]);
const targetRecordKey=(target:Pick<Target,'collection'|'recordId'|'sectionKey'>)=>JSON.stringify([target.collection,target.recordId,target.sectionKey]);
const recordKey=(target:Pick<Target,'collection'|'recordId'>)=>JSON.stringify([target.collection,target.recordId]);
const targetParams=(target:Pick<Target,'module'|'collection'|'recordId'|'sectionKey'>)=>new URLSearchParams({module:target.module,collection:target.collection,recordId:target.recordId,sectionKey:target.sectionKey}).toString();
const validTarget=(value:unknown):value is Target=>!!value&&typeof value==='object'&&['module','collection','recordId','label','sectionKey','sectionLabel'].every(key=>typeof (value as Record<string,unknown>)[key]==='string')&&typeof (value as Target).canAppend==='boolean';

class FollowupRequestError extends Error{
 constructor(message:string,readonly outcomeUnknown=false,readonly status?:number){super(message);}
}
async function followupRequest(action:string,options:{signal?:AbortSignal;body?:FormData;teamId?:string}={}){
 const writing=!!options.body;
 let response:Response;
 try{response=await businessTeamFetch('/api/workspace/'+action,{method:writing?'POST':'GET',credentials:'same-origin',cache:'no-store',signal:options.signal,body:options.body,headers:writing?{'X-Workspace-Team':options.teamId||''}:undefined});}
 catch(error){if(!writing&&options.signal?.aborted)throw error;throw new FollowupRequestError(writing?'连接中断，尚未确认保存结果。请重试原请求。':'无法读取记录，请检查连接后重试。',writing);}
 let result:any;
 try{result=await response.json();}catch{throw new FollowupRequestError(response.status===413?'本次文件总量超过服务器限制，请减少文件后保存。':'服务器未返回完整结果，请重新读取或重试原请求。',writing&&(response.ok||response.status>=500||response.status===408),response.status);}
 if(!response.ok)throw new FollowupRequestError(typeof result?.error==='string'?result.error:'本次操作未完成，请重试。',writing&&(response.status>=500||response.status===408),response.status);
 if(writing&&result?.ok!==true)throw new FollowupRequestError('尚未收到保存确认，请重试原请求核实结果。',true,response.status);
 return result;
}

/** A provider owns its dialog so switching the section that launched it cannot discard a draft. */
export function BusinessFollowupProvider({children,module,collection,recordId,sectionKey='record',title,onDirtyChange,identityKey='',enabled=true,suppressSlots=false}:ProviderProps){
 const parent=useContext(FollowupContext),id=useId(),[active,setActive]=useState<{props:BusinessFollowupPanelProps;intent:Intent;id:string}|null>(null),dirtyIds=useRef(new Set<string>()),opener=useRef<HTMLElement|null>(null);
 const callbacks=useRef({onDirtyChange,parent});callbacks.current={onDirtyChange,parent};
 const reportDirty=(childId:string,dirty:boolean)=>{if(dirty)dirtyIds.current.add(childId);else dirtyIds.current.delete(childId);const any=dirtyIds.current.size>0;callbacks.current.onDirtyChange?.(any);callbacks.current.parent?.reportDirty(id,any);};
 useEffect(()=>()=>{callbacks.current.onDirtyChange?.(false);callbacks.current.parent?.reportDirty(id,false);},[id]);
 const defaults={module,collection,recordId,sectionKey,title};
 const open=(props:BusinessFollowupPanelProps,intent:Intent)=>{if(!enabled||dirtyIds.current.size)return;if(typeof document!=='undefined'&&typeof HTMLElement!=='undefined'&&document.activeElement instanceof HTMLElement)opener.current=document.activeElement;setActive({props,intent,id:clientId()});};
 const close=()=>{setActive(null);queueMicrotask(()=>opener.current?.isConnected&&opener.current.focus());};
 return <FollowupContext.Provider value={{defaults,identityKey:identityKey||parent?.identityKey||'',enabled,suppressSlots,open,reportDirty}}>{children}{active&&<div className="bf-dialog-backdrop"><div className="bf-dialog" role="dialog" aria-modal="true" aria-label={active.props.title||'附件与沟通记录'}><BusinessFollowupPanel key={active.id} {...active.props} initialIntent={active.intent} onClose={close}/></div></div>}</FollowupContext.Provider>;
}

/** Lightweight section/row entry point; no read is issued until its dialog opens. */
export function BusinessFollowupSlot({enabled=true,...overrides}:Partial<BusinessFollowupPanelProps>&{enabled?:boolean}){
 const context=useContext(FollowupContext);
 if(!context||!context.enabled||context.suppressSlots||!enabled)return null;
 const props={...context.defaults,...overrides};
 return <div className="bf-slot" aria-label={props.title?props.title+'附件与沟通':'附件与沟通'}><span>附件与沟通</span><div className="bf-actions"><Button type="button" variant="outline" size="sm" onClick={()=>context.open(props,'attachment')}><FilePlus2 size={14}/>上传附件</Button><Button type="button" variant="outline" size="sm" onClick={()=>context.open(props,'communication')}><MessageSquare size={14}/>记录沟通</Button><Button type="button" variant="ghost" size="sm" onClick={()=>context.open(props,'history')}>查看记录</Button></div></div>;
}

type Draft={target:Target;originModule:string;teamId:string;identityKey:string;note:string;files:File[]};
type Pending={body:FormData;draft:Draft;token:string;uncertain:boolean};
export function BusinessFollowupPanel({module,collection='',recordId='',sectionKey='record',title='附件与沟通记录',onDirtyChange,initialIntent='history',onClose}:BusinessFollowupPanelProps&{initialIntent?:Intent;onClose?:()=>void}){
 const context=useContext(FollowupContext),scope=useBusinessTeamScope(),instance=useId(),cache=useQueryClient(),teamId=scope?.teamId??getBusinessTeamScope(),identityKey=context?.identityKey||instance;
 const [selection,setSelection]=useState<Target|null>(null),[selectionScope,setSelectionScope]=useState(''),[search,setSearch]=useState(''),[intent,setIntent]=useState<Intent>(initialIntent),[draft,setDraft]=useState<Draft|null>(null),[pending,setPending]=useState<Pending|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[downloading,setDownloading]=useState('');
 const draftRef=useRef<Draft|null>(null),pendingRef=useRef<Pending|null>(null),running=useRef(false),mounted=useRef(true),noteInput=useRef<HTMLTextAreaElement>(null),fileInput=useRef<HTMLInputElement>(null),panel=useRef<HTMLElement>(null);
 const callbacks=useRef({onDirtyChange,context});callbacks.current={onDirtyChange,context};
 const dirty=!!draft||!!pending||busy,dirtyRef=useRef(dirty);dirtyRef.current=dirty;
 const reportDirty=(value:boolean)=>{dirtyRef.current=value;callbacks.current.onDirtyChange?.(value);callbacks.current.context?.reportDirty(instance,value);};
 const changeDraft=(next:Draft|null)=>{draftRef.current=next;setDraft(next);reportDirty(!!next||!!pendingRef.current||running.current);};
 const changePending=(next:Pending|null)=>{pendingRef.current=next;setPending(next);};
 useEffect(()=>{reportDirty(dirty);},[dirty]);
 useEffect(()=>{mounted.current=true;panel.current?.focus();const unload=(event:BeforeUnloadEvent)=>{if(dirtyRef.current){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',unload);return()=>{mounted.current=false;window.removeEventListener('beforeunload',unload);callbacks.current.onDirtyChange?.(false);callbacks.current.context?.reportDirty(instance,false);};},[instance]);
 const fixed=!!collection&&!!recordId;
 const selectionScopeKey=JSON.stringify([module,teamId,identityKey,collection]),selectedTarget=selectionScope===selectionScopeKey?selection:null;
 const requestedTarget:Target|null=fixed?{module,collection,recordId,sectionKey,label:recordId,sectionLabel:sectionKey,canAppend:false}:selectedTarget&&(!collection||selectedTarget.collection===collection)?{...selectedTarget,sectionKey}:null;
 const currentTarget=draft?.target||requestedTarget;
 const scopeChanged=!!draft&&(draft.teamId!==teamId||draft.identityKey!==identityKey||draft.originModule!==module||fixed&&recordKey(draft.target)!==JSON.stringify([collection,recordId])||draft.target.sectionKey!==sectionKey);
 const targets=useQuery<{targets:Target[];supported?:boolean;notice?:string}>({queryKey:['business-followup-targets',identityKey,teamId,module],enabled:!fixed&&!scopeChanged,queryFn:async({signal})=>{const result=await followupRequest('business-followup-targets?'+new URLSearchParams({module}),{signal});if(!Array.isArray(result?.targets)||!result.targets.every(validTarget))throw new Error('业务记录清单格式不完整，请重新读取。');return result;},retry:false,staleTime:0,gcTime:0});
 const feedKey=['business-followup-data',identityKey,teamId,currentTarget?targetKey(currentTarget):''];
 const feed=useQuery<Feed>({queryKey:feedKey,enabled:!!currentTarget&&!scopeChanged,queryFn:async({signal})=>{const target=currentTarget!;const result=await followupRequest('business-followup-data?'+targetParams(target),{signal});if(!validTarget(result?.target)||targetRecordKey(result.target)!==targetRecordKey(target)||!Array.isArray(result?.entries)||!result.entries.every((entry:any)=>entry&&typeof entry.id==='string'&&typeof entry.note==='string'&&typeof entry.createdAt==='string'&&typeof entry.createdByName==='string'&&Array.isArray(entry.attachments)&&entry.attachments.every((file:any)=>file&&typeof file.id==='string'&&typeof file.originalName==='string'&&typeof file.size==='number'&&typeof file.sha256==='string')))throw new Error('记录详情格式不完整，请重新读取。');return result;},retry:false,staleTime:0,gcTime:0});
 const canAppend=!!feed.data?.target.canAppend&&!feed.isError&&!scopeChanged;
 useEffect(()=>{if(intent==='history'||draftRef.current||!canAppend||!feed.data)return;changeDraft({target:{...feed.data.target},originModule:module,teamId,identityKey,note:'',files:[]});},[intent,canAppend,feed.data,teamId,identityKey,module]);
 useEffect(()=>{if(!draft)return;if(intent==='communication')noteInput.current?.focus();else fileInput.current?.focus();},[!!draft,intent]);
 const choices=(targets.data?.targets||[]).filter(target=>(!collection||target.collection===collection)&&(!search.trim()||[target.label,target.recordId,target.sectionLabel].join(' ').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())));
 const selectTarget=(value:string)=>{if(draftRef.current||pendingRef.current||running.current)return;setSelection((targets.data?.targets||[]).find(target=>recordKey(target)===value)||null);setSelectionScope(selectionScopeKey);setError('');setNotice('');};
 const begin=(next:Intent)=>{if(pendingRef.current||running.current)return;setIntent(next);setError('');setNotice('');};
 const discard=()=>{if(pendingRef.current||running.current)return false;const current=draftRef.current;if(current&&(current.note.trim()||current.files.length)&&!window.confirm('放弃尚未保存的沟通内容和附件？'))return false;changeDraft(null);setIntent('history');setError('');return true;};
 const close=()=>{if(discard())onClose?.();};
 const addFiles=(files:File[])=>{if(!draftRef.current||pendingRef.current||running.current)return;const all=[...draftRef.current.files,...files];if(all.length>10){setError('一次最多上传 10 个附件，请分批保存。');return;}const invalid=all.find(file=>!file.size||file.size>20*1024*1024);if(invalid){setError(`${invalid.name}：文件须非空且不超过 20 MiB。`);return;}if(all.reduce((total,file)=>total+file.size,0)>49*1024*1024){setError('本次文件合计不能超过 49 MiB，请分批保存。');return;}changeDraft({...draftRef.current,files:all});setError('');};
 const save=async()=>{
  if(running.current||scopeChanged)return;
  let attempt=pendingRef.current;
  if(!attempt){const current=draftRef.current;if(!current||!canAppend)return;if(!current.note.trim()&&!current.files.length){setError('请填写沟通内容或选择附件。');return;}const token=clientId(),body=new FormData();for(const [key,value] of Object.entries({token,module:current.target.module,collection:current.target.collection,recordId:current.target.recordId,sectionKey:current.target.sectionKey,note:current.note}))body.set(key,value);for(const file of current.files)body.append('files',file,file.name);attempt={body,token,draft:{...current,files:[...current.files]},uncertain:false};changePending(attempt);}
  running.current=true;setBusy(true);reportDirty(true);setError('');setNotice('');
  try{const result=await followupRequest('business-followup-save',{body:attempt.body,teamId:attempt.draft.teamId});if(!validTarget(result?.target)||targetRecordKey(result.target)!==targetRecordKey(attempt.draft.target)||typeof result?.entry?.id!=='string'||result.entry.note!==attempt.draft.note.trim()||!Array.isArray(result.entry.attachments)||result.entry.attachments.length!==attempt.draft.files.length||result.entry.attachments.some((file:any,index:number)=>!file||typeof file.id!=='string'||file.size!==attempt!.draft.files[index].size||typeof file.sha256!=='string'||!/^[a-f0-9]{64}$/i.test(file.sha256)))throw new FollowupRequestError('保存回执与本次内容无法核对，请重试原请求。',true);if(!mounted.current)return;changePending(null);changeDraft(null);setIntent('history');setNotice('已保存附件与沟通记录。');const refreshed=await feed.refetch();if(mounted.current&&(refreshed.isError||!refreshed.data?.entries.some(entry=>entry.id===result.entry.id)))setNotice('已收到保存确认，清单暂未核对到该记录。请点击“刷新记录”查看，无需重复保存。');void cache.invalidateQueries({queryKey:['business-followup-targets']});}
  catch(cause){if(!mounted.current)return;const failure=cause as FollowupRequestError;setError(failure.message||'未能确认保存结果，请重试原请求。');if(failure instanceof FollowupRequestError&&!failure.outcomeUnknown&&!attempt.uncertain&&failure.status!==409)changePending(null);else changePending({...attempt,uncertain:true});}
  finally{running.current=false;if(mounted.current){setBusy(false);reportDirty(!!draftRef.current||!!pendingRef.current);}}
 };
 const download=async(file:Attachment)=>{if(downloading||scopeChanged)return;setDownloading(file.id);setError('');try{await downloadBusinessTeamFile('/api/workspace/business-followup-download?id='+encodeURIComponent(file.id),file.originalName);}catch(cause){if(mounted.current)setError((cause as Error).message);}finally{if(mounted.current)setDownloading('');}};
 const trapFocus=(event:React.KeyboardEvent<HTMLElement>)=>{if(event.key==='Escape'&&onClose){event.preventDefault();close();}if(event.key!=='Tab'||!onClose)return;const focusable=Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]')||[]).filter(element=>element.getClientRects().length>0);if(!focusable.length){event.preventDefault();panel.current?.focus();return;}const first=focusable[0],last=focusable[focusable.length-1];if(event.shiftKey&&(document.activeElement===first||document.activeElement===panel.current)){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}};
 return <section className="bf-panel" ref={panel} tabIndex={-1} aria-label={title} onKeyDown={trapFocus}><div className="bf-heading"><div><h3>{title}</h3><p>按具体业务记录保存附件和沟通，保留操作人及时间。</p></div>{onClose&&<Button type="button" size="sm" variant="ghost" aria-label="关闭附件与沟通" disabled={busy||!!pending} onClick={close}><X size={18}/></Button>}</div>
 {!fixed&&<div className="bf-target-fields"><label>搜索业务记录<input aria-label="搜索附件沟通业务记录" value={search} disabled={!!draft||!!pending||busy} onChange={event=>setSearch(event.target.value)} placeholder="输入编号或名称"/></label><label>保存到业务记录<select aria-label="附件沟通所属业务记录" value={selectedTarget?recordKey(selectedTarget):''} disabled={!!draft||!!pending||busy||targets.isPending||targets.isError} onChange={event=>selectTarget(event.target.value)}><option value="">请选择具体记录</option>{choices.map(target=><option key={recordKey(target)} value={recordKey(target)}>{target.label}{target.canAppend?'':'（只读）'}</option>)}{selectedTarget&&!choices.some(target=>recordKey(target)===recordKey(selectedTarget))&&<option value={recordKey(selectedTarget)}>{selectedTarget.label}</option>}</select></label></div>}
 {targets.isError&&!fixed&&<p className="bf-alert" role="alert">{targets.error.message}<Button type="button" variant="outline" size="sm" onClick={()=>void targets.refetch()}>重新读取记录清单</Button></p>}
 {!fixed&&targets.isPending&&<p className="bf-muted">正在读取业务记录…</p>}
 {!fixed&&!targets.isPending&&!targets.isError&&!choices.length&&<p className="bf-muted">{targets.data?.targets.length===0&&targets.data.notice?targets.data.notice:'当前搜索范围暂无可见业务记录。'}</p>}
 {scopeChanged&&<p className="bf-alert" role="alert">当前草稿仍属于“{draft?.target.label}”。请返回原业务记录和工作组，再继续保存或重试。</p>}
 {currentTarget&&!scopeChanged&&<><div className="bf-target"><b>{feed.data?.target.label||currentTarget.label}</b><span>{feed.data?.target.sectionLabel||currentTarget.sectionLabel}</span></div>{feed.isError&&<p className="bf-alert" role="alert">{feed.error.message}</p>}{feed.isPending&&<p className="bf-muted">正在读取附件与沟通记录…</p>}<div className="bf-actions"><Button type="button" variant="outline" size="sm" disabled={!canAppend||!!draft||busy||!!pending} onClick={()=>begin('attachment')}><FilePlus2 size={14}/>上传附件</Button><Button type="button" variant="outline" size="sm" disabled={!canAppend||!!draft||busy||!!pending} onClick={()=>begin('communication')}><MessageSquare size={14}/>记录沟通</Button><Button type="button" variant="ghost" size="sm" disabled={feed.isFetching||busy} onClick={()=>void feed.refetch()}><RefreshCw size={14}/>刷新记录</Button></div>{feed.data&&!feed.data.target.canAppend&&<p className="bf-muted">您可查看本记录，目前没有追加附件或沟通的权限。</p>}</>}
 {draft&&<form className="bf-compose" onSubmit={event=>{event.preventDefault();void save();}}><fieldset disabled={busy||!!pending||scopeChanged}><label>沟通内容 / 附件说明<textarea ref={noteInput} aria-label="沟通内容或附件说明" value={draft.note} maxLength={12000} rows={5} placeholder="记录沟通结论、下一步或附件说明" onChange={event=>changeDraft({...draft,note:event.target.value})}/></label><label>上传附件（可多选）<input ref={fileInput} aria-label="选择沟通附件" type="file" multiple onChange={event=>{addFiles(Array.from(event.target.files||[]));event.target.value='';}}/><small>一次最多 10 个附件，单文件不超过 20 MiB，本次文件合计不超过 49 MiB。可只记录沟通，也可只上传附件。</small></label>{draft.files.length>0&&<ul className="bf-file-queue">{draft.files.map((file,index)=><li key={index}><span>{file.name}<small>{sizeLabel(file.size)}</small></span><Button type="button" size="sm" variant="ghost" aria-label={'移除附件 '+file.name} onClick={()=>changeDraft({...draft,files:draft.files.filter((_,at)=>at!==index)})}><X size={14}/></Button></li>)}</ul>}</fieldset><div className="bf-actions"><Button type="submit" disabled={busy||!!pending||scopeChanged||!canAppend}>{busy?'正在保存…':'保存记录'}</Button><Button type="button" variant="outline" disabled={busy||!!pending} onClick={discard}>取消填写</Button></div></form>}
 {pending&&<div className="bf-pending" role="status"><p>{busy?'正在提交，附件和沟通内容已固定。':'上次保存结果尚未确认，业务记录、内容、原文件及请求编号已保留。请重试原请求核实。'}</p><Button type="button" variant="outline" disabled={busy||scopeChanged} onClick={()=>void save()}>重试原请求</Button></div>}
 {error&&<p className="bf-alert" role="alert">{error}</p>}{notice&&<p className="bf-notice" role="status">{notice}</p>}
 {!scopeChanged&&feed.data&&!feed.isError&&<div className="bf-history" aria-label="附件与沟通历史">{feed.data.entries.length?feed.data.entries.map(entry=><article key={entry.id} className="bf-entry"><header><b>{entry.createdByName||'未填写姓名'}</b><time dateTime={entry.createdAt}>{atLabel(entry.createdAt)}</time></header>{entry.note&&<p>{entry.note}</p>}{entry.attachments.length>0&&<ul className="bf-attachments">{entry.attachments.map(file=><li key={file.id}><div><b>{file.originalName}</b><span>{sizeLabel(file.size)}</span><details><summary>查看文件校验值</summary><code>SHA-256 {file.sha256}</code></details></div><Button type="button" size="sm" variant="outline" disabled={!!downloading} onClick={()=>void download(file)}><Download size={14}/>{downloading===file.id?'正在下载…':'下载原件'}</Button></li>)}</ul>}</article>):<p className="bf-muted">此业务记录还没有附件或沟通记录。</p>}</div>}
 </section>;
}
