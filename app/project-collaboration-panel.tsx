'use client';
import {useEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Button} from '@/components/ui/button';
import {clientId} from '@/lib/client-id';
import type {WorkspaceNavigationContext,WorkspaceNavigate} from '@/lib/handoff-navigation';
import type {Data} from './workspace';
import './project-collaboration-panel.css';

const steps={directory:'项目资料目录',overview:'需求与款色',communication:'沟通与待办',drawings:'图纸与客批',quotes:'报价版本',samples:'样办与寄样',finance:'费用与收款',documents:'PI / CI 单据',orders:'大货交接','after-sales':'售后与额外费用'};
const departments={sales:'业务',service:'客服',pmc:'PMC',purchasing:'采购',engineering:'工程',factory:'工厂 / 文员',finance:'财务',other:'其他部门'};
const statuses={open:'待处理',in_progress:'进行中',blocked:'受阻',done:'已完成',cancelled:'已取消'};
const historyActions={create:'建立待办',save:'修改待办',assign:'调整负责人',followup:'跟进回复',complete:'确认完成',cancel:'取消待办',acknowledge:'已阅反馈',transfer:'移交负责人'};
type Step=keyof typeof steps;
type Department=keyof typeof departments;
type TaskStatus=keyof typeof statuses;
type Task={id:string;version:number;projectId:string;customerId:string;roundId:string;roundTitle?:string;stepKey:Step;department:Department;ownerId:string;ownerName:string;title:string;description:string;dueDate:string;status:TaskStatus;result:string;acknowledgedAt?:string;projectTitle:string;projectCode:string;customerLabel:string;canAssign:boolean;canReply:boolean;canComplete:boolean;canAcknowledge:boolean;canOpenProject:boolean;history:{id?:string;actorId:string;actorName:string;at:string;action:string;comment:string;changes?:{field:string;before:string;after:string}[]}[]};
type Feed={tasks:Task[];members:{id:string;name:string;role?:string}[];canAssign:boolean};
type Draft={id?:string;version:number;projectId:string;roundId:string;stepKey:Step;department:Department|'';ownerId:string;title:string;description:string;dueDate:string;reason:string;scope:string};
type Reply={id:string;version:number;comment:string;status:''|'in_progress'|'blocked';scope:string};
type Submission={action:string;body:Record<string,unknown>;scope:string};
type Props={data?:Data;projectId?:string;roundId?:string;stepKey?:string;onDirtyChange?:(dirty:boolean)=>void;onChanged?:()=>void|Promise<void>;onNavigate?:WorkspaceNavigate;initialContext?:WorkspaceNavigationContext};
class TaskRequestError extends Error{constructor(message:string,public status:number){super(message);}}
async function taskRequest(action:string,body?:Record<string,unknown>,signal?:AbortSignal):Promise<Feed>{
 // Personal assignments span business groups. Server authorization, not a UI team filter, determines access.
 const response=await fetch('/api/workspace/'+action,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',signal,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});
 let result:any;try{result=await response.json();}catch{throw new TaskRequestError('未取得完整返回，请使用同一请求核实并重试。',response.status>=400?response.status:0);}
 if(!response.ok)throw new TaskRequestError(result.error||'操作未完成，请核对后重试。',response.status);return result;
}
const label=<T extends Record<string,string>>(map:T,key:string)=>map[key]||'待核查';
const time=(value:string)=>{if(!value)return '未记录时间';const date=new Date(value);return Number.isNaN(date.getTime())?'时间待核查':date.toLocaleString(undefined,{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});};
const roundLabel=(task:Task)=>task.roundTitle||(task.roundId?'待核查轮次':'项目级（不指定轮次）');
const openTask=(task:Task)=>!['done','cancelled'].includes(task.status);
const changedFields:Record<string,string>={roundId:'开发轮次',stepKey:'所属环节',department:'负责部门',ownerId:'负责人',title:'任务名称',description:'任务说明',dueDate:'截止日期',status:'状态'};
function changeText(field:string,value:string){if(field==='department')return label(departments,value);if(field==='stepKey')return label(steps,value);if(field==='status')return label(statuses,value);return value||'未填写';}
const draftOf=(task:Task,scope:string):Draft=>({id:task.id,version:task.version,projectId:task.projectId,roundId:task.roundId||'',stepKey:task.stepKey,department:task.department,ownerId:task.ownerId,title:task.title,description:task.description,dueDate:task.dueDate,reason:'',scope});

export function PersonalTasksPanel({data,onNavigate,onDirtyChange,initialContext}:{data:Data;onNavigate:WorkspaceNavigate;onDirtyChange?:(dirty:boolean)=>void;initialContext?:WorkspaceNavigationContext}){
 return <TaskWorkspace data={data} onNavigate={onNavigate} onDirtyChange={onDirtyChange} initialContext={initialContext}/>;
}
export function ProjectStepCollaboration({projectId,roundId,stepKey,onDirtyChange,onChanged}:{projectId:string;roundId:string;stepKey:string;onDirtyChange?:(dirty:boolean)=>void;onChanged?:()=>void|Promise<void>}){
 return <TaskWorkspace projectId={projectId} roundId={roundId} stepKey={stepKey} onDirtyChange={onDirtyChange} onChanged={onChanged}/>;
}
function TaskWorkspace({data,projectId='',roundId='',stepKey='directory',onDirtyChange,onChanged,onNavigate,initialContext}:Props){
 const cache=useQueryClient(),personal=!projectId,actor=data?.me.id||'project',revision=data?.revision||0,scope=[actor,projectId,roundId,stepKey].join('|');
 const [queue,setQueue]=useState('pending'),[search,setSearch]=useState(''),[allSteps,setAllSteps]=useState(false),[selectedId,setSelectedId]=useState('');
 const [draft,setDraft]=useState<Draft|null>(null),[reply,setReply]=useState<Reply|null>(null),[pending,setPending]=useState<Submission|null>(null),[busy,setBusy]=useState(false);
 const [navigationRequest,setNavigationRequest]=useState<{scope:string;taskId:string;context:WorkspaceNavigationContext}|null>(null);
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[refreshWarning,setRefreshWarning]=useState(''),[discardPrompt,setDiscardPrompt]=useState('');
 const mounted=useRef(true),busyRef=useRef(false),pendingRef=useRef<Submission|null>(null),scopeRef=useRef(scope),switchAction=useRef<(()=>void)|null>(null),applied=useRef(''),controller=useRef<AbortController|null>(null),heading=useRef<HTMLHeadingElement|null>(null),returnFocus=useRef<HTMLElement|null>(null);
 scopeRef.current=scope;
 const feedQuery=useQuery<Feed>({queryKey:['project-collaboration',actor,revision,projectId],queryFn:({signal})=>taskRequest('project-collaboration-data'+(projectId?'?projectId='+encodeURIComponent(projectId):''),undefined,signal),enabled:!data||data.me.active,retry:false,refetchInterval:30000,refetchOnWindowFocus:true});
 const feed=!feedQuery.isError&&!feedQuery.isPending&&(!data||data.me.active)?feedQuery.data:undefined;
 const detailQuery=useQuery<Feed>({queryKey:['project-collaboration-detail',actor,revision,selectedId],queryFn:({signal})=>taskRequest('project-collaboration-data?taskId='+encodeURIComponent(selectedId),undefined,signal),enabled:!!selectedId&&!!feed,retry:false,refetchInterval:30000,refetchOnWindowFocus:true});
 const selected=feed&&selectedId&&!detailQuery.isError&&!detailQuery.isPending?detailQuery.data?.tasks.find(t=>t.id===selectedId&&(!projectId||t.projectId===projectId)):undefined;
 const candidatesQuery=useQuery<Feed>({queryKey:['project-collaboration-candidates',actor,revision,draft?.projectId||''],queryFn:({signal})=>taskRequest('project-collaboration-data?projectId='+encodeURIComponent(draft?.projectId||''),undefined,signal),enabled:personal&&!!draft?.id&&!!feed,retry:false,refetchInterval:30000,refetchOnWindowFocus:true});
 const candidates=personal?(candidatesQuery.isError||candidatesQuery.isPending?undefined:candidatesQuery.data):feed;
 const draftTask=draft?.id?(selected?.id===draft.id?selected:feed?.tasks.find(t=>t.id===draft.id)):undefined;
 const draftAllowed=!!feed&&!!draft&&draft.scope===scope&&!!candidates?.canAssign&&(draft.id?!!draftTask?.canAssign:feed.canAssign&&draft.projectId===projectId)&&(!selectedId||!detailQuery.isError);
 const replyAllowed=!!selected&&!!reply&&reply.scope===scope&&reply.id===selected.id&&(selected.canReply||selected.canComplete||selected.canAssign||selected.canAcknowledge);
 const stale=!!draft?.id&&!!draftTask&&draft.version!==draftTask.version||!!reply&&!!selected&&reply.id===selected.id&&reply.version!==selected.version;
 const dirty=!!draft||!!reply?.comment||!!reply?.status||busy||!!pending;
 const locked=busy||!!pending;
 useEffect(()=>{onDirtyChange?.(dirty);},[dirty,onDirtyChange]);
 // Run external navigation only after the cleared editor has committed and the parent dirty callback has run.
 useEffect(()=>{if(!navigationRequest||dirty)return;setNavigationRequest(null);if(navigationRequest.scope===scope&&selected?.id===navigationRequest.taskId&&selected.canOpenProject)onNavigate?.('customer-projects',navigationRequest.context);else setError('任务范围已变化，请重新读取后打开项目。');},[navigationRequest,dirty,scope,selected,onNavigate]);
 useEffect(()=>()=>onDirtyChange?.(false),[onDirtyChange]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;controller.current?.abort();};},[]);
 useEffect(()=>{if(!dirty)return;const block=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',block);return()=>window.removeEventListener('beforeunload',block);},[dirty]);
 useEffect(()=>{heading.current?.focus();},[selectedId,!!draft]);
 useEffect(()=>{if(dirty)return;setDraft(null);setReply(null);setSelectedId('');setError('');setDiscardPrompt('');},[scope]);
 useEffect(()=>{const key=JSON.stringify(initialContext||{});if(!personal||!feed||!initialContext?.recordId||applied.current===key||dirty)return;applied.current=key;setSelectedId(initialContext.recordId);setReply(null);setDraft(null);setError('');},[initialContext,personal,feed,dirty]);
 useEffect(()=>{if(selected)setError(value=>value==='指定任务不存在或当前无权读取，未打开其他任务。'?'':value);else if(selectedId&&feed&&!detailQuery.isPending&&!detailQuery.isFetching)setError('指定任务不存在或当前无权读取，未打开其他任务。');},[selectedId,feed,detailQuery.isPending,detailQuery.isFetching,selected]);
 function switchTo(next:()=>void,message='切换任务'){
  if(busyRef.current||pendingRef.current)return;
  if(dirty){switchAction.current=next;setDiscardPrompt(message);return;}
  setError('');setDiscardPrompt('');next();
 }
 function clearEditor(){setDraft(null);setReply(null);setDiscardPrompt('');switchAction.current=null;}
 function select(task:Task,event:React.MouseEvent<HTMLButtonElement>){returnFocus.current=event.currentTarget;switchTo(()=>{clearEditor();setSelectedId(task.id);},'打开另一条任务');}
 function create(){if(!feed?.canAssign||!projectId||locked)return;switchTo(()=>{setSelectedId('');setReply(null);setDraft({version:0,projectId,roundId,stepKey:(stepKey in steps?stepKey:'directory') as Step,department:'',ownerId:'',title:'',description:'',dueDate:'',reason:'',scope});},'新建下一步待办');}
 function setDraftField<K extends keyof Draft>(key:K,value:Draft[K]){if(locked||!draftAllowed)return;setDraft(before=>before?{...before,[key]:value}:before);}
 function setReplyField(key:'comment'|'status',value:string){if(locked||!selected)return;setReply(before=>({...before||{id:selected.id,version:selected.version,comment:'',status:'',scope},[key]:value} as Reply));}
 async function refresh(){setRefreshWarning('');const results=await Promise.all([feedQuery.refetch(),...(selectedId?[detailQuery.refetch()]:[]),...(personal&&draft?.id?[candidatesQuery.refetch()]:[])]);if(mounted.current&&results.some(r=>r.isError))setRefreshWarning('清单读取失败，已暂停显示旧资料；本地未保存输入仍保留。');}
 async function submit(action:string,body:Record<string,unknown>,retry=false){
  if(busyRef.current||pendingRef.current&&!retry)return;
  const submission=retry?pendingRef.current:{action,body:{...body,token:clientId()},scope};if(!submission||submission.scope!==scope)return;
  if(!retry&&(!feed||stale))return;
  busyRef.current=true;pendingRef.current=submission;setBusy(true);setPending(submission);setError('');setNotice('');setRefreshWarning('');
  const abort=new AbortController();controller.current=abort;
  try{
   await taskRequest(submission.action,submission.body,abort.signal);
  }catch(e){
   if(!mounted.current)return;
   setError(e instanceof Error?e.message:'保存失败，请核实后重试。');
   if(e instanceof TaskRequestError&&e.status>=400&&e.status<500){pendingRef.current=null;setPending(null);void refresh();}
   busyRef.current=false;setBusy(false);return;
  }
  if(!mounted.current)return;
  // A confirmed write is final even if any subsequent list refresh fails.
  pendingRef.current=null;setPending(null);clearEditor();setNotice('已保存，完成记录与回复已同步留在项目中。');
  try{
   const results=await Promise.all([feedQuery.refetch(),...(selectedId?[detailQuery.refetch()]:[])]);
   await onChanged?.();void cache.invalidateQueries({queryKey:['workspace']});
   if(results.some(r=>r.isError))throw new Error('refresh');
  }catch{if(mounted.current)setRefreshWarning('操作已保存，但最新清单刷新失败。请重新读取，无需再次提交。');}
  finally{busyRef.current=false;if(mounted.current)setBusy(false);}
 }
 function saveDraft(event:React.FormEvent){event.preventDefault();if(!draftAllowed||!draft||locked||stale)return;if(!draft.title.trim()||!draft.department||!draft.ownerId||draft.id&&!draft.reason.trim()){setError('请填写任务名、负责部门、负责人；修改任务还需填写原因。');return;}const {scope:_,...body}=draft;void submit('project-collaboration-save',body);}
 function actionTask(action:'followup'|'complete'|'cancel'|'acknowledge'){
  if(!selected||locked||stale||draft)return;
  const allowed={followup:selected.canReply,complete:selected.canComplete,cancel:selected.canAssign&&openTask(selected),acknowledge:selected.canAcknowledge};if(!allowed[action])return;
  const comment=reply?.id===selected.id?reply.comment.trim():'';
  if(action!=='acknowledge'&&!comment){setError(action==='complete'?'确认完成前必须填写完成备注。':'请先填写本次回复或操作原因。');return;}
  const body:Record<string,unknown>={id:selected.id,version:reply?.id===selected.id?reply.version:selected.version,comment};
  if(action==='followup'&&selected.canComplete&&reply?.status)body.status=reply.status;
  void submit('project-collaboration-'+action,body);
 }
 const scopedTasks=(feed?.tasks||[]).filter(task=>!personal||!initialContext?.customerId||task.customerId===initialContext.customerId).filter(task=>!personal||!initialContext?.projectId||task.projectId===initialContext.projectId);
 const inQueue=(task:Task,value:string)=>value==='pending'?openTask(task)&&task.ownerId===data?.me.id:value==='done'?task.status==='done':value==='feedback'?task.canAcknowledge:true;
 const visibleTasks=scopedTasks.filter(task=>personal?inQueue(task,queue):(allSteps||task.stepKey===stepKey)).filter(task=>!search.trim()||[task.title,task.description,task.projectCode,task.projectTitle,task.customerLabel,task.ownerName,label(departments,task.department),task.result].join(' ').toLowerCase().includes(search.trim().toLowerCase())).sort((a,b)=>(a.dueDate||'9999').localeCompare(b.dueDate||'9999')||a.id.localeCompare(b.id));
 return <section className="project-collaboration panel" aria-label={personal?'我的待办':'项目环节协作'}>
  <header className="pc-heading"><div><h2>{personal?'我的待办':'负责人和下一步待办'}</h2><p>{personal?'显示本人跨组任务与待推进的完成反馈。':'当前环节：'+label(steps,stepKey)+'。'+(allSteps?'展示全部环节、各轮次待办；':'展示该环节各轮次待办；')+'新建待办跟随顶部所选轮次。回复与完成记录保存到同一项目。'}</p></div><div className="pc-actions"><Button variant="outline" disabled={busy} onClick={()=>void refresh()}>重新读取</Button>{!personal&&<Button disabled={!feed?.canAssign||locked} onClick={create}>新增待办</Button>}</div></header>
  {error&&<p className="pc-error" role="alert">{error}</p>}{notice&&<p className="pc-notice" role="status">{notice}</p>}{refreshWarning&&<p className="pc-warning" role="alert">{refreshWarning}</p>}
  {feedQuery.isPending&&<p role="status">正在读取当前授权任务…</p>}{feedQuery.isError&&<p className="pc-error" role="alert">读取任务失败，已隐藏上次资料。{feedQuery.error.message}</p>}
  {pending&&<div className="pc-warning" role="alert"><p>{busy?'正在提交，请勿离开。':'上次提交结果尚未确认，原文和唯一请求编号已保留。'}</p><Button disabled={busy||pending.scope!==scope} variant="outline" onClick={()=>void submit(pending.action,pending.body,true)}>核实并重试同一请求</Button></div>}
  {discardPrompt&&<div className="pc-warning" role="alert"><p>当前有未保存输入。是否放弃后{discardPrompt}？</p><div className="pc-actions"><Button variant="outline" onClick={()=>{setDiscardPrompt('');switchAction.current=null;}}>继续编辑</Button><Button variant="outline" onClick={()=>{if(locked)return;const next=switchAction.current;clearEditor();next?.();}}>放弃未保存输入并继续</Button></div></div>}
  {feed&&<><div className="pc-filters">{personal?<nav aria-label="个人任务筛选">{[['pending','待处理'],['done','已完成'],['feedback','待我推进反馈'],['all','全部']].map(([value,title])=><button key={value} type="button" aria-pressed={queue===value} disabled={locked} onClick={()=>switchTo(()=>setQueue(value),'切换任务分类')}>{title} · {scopedTasks.filter(task=>inQueue(task,value)).length}</button>)}</nav>:<label className="pc-check"><input type="checkbox" checked={allSteps} disabled={locked} onChange={e=>switchTo(()=>setAllSteps(e.target.checked),'切换环节范围')}/>显示全部环节</label>}<label>搜索待办<input type="search" aria-label="搜索待办" value={search} disabled={locked} onChange={e=>setSearch(e.target.value)} placeholder="任务、项目、负责人"/></label></div>
  <div className="pc-task-list">{visibleTasks.map(task=><article key={task.id} className={'pc-task '+(selectedId===task.id?'pc-selected':'')}><div className="pc-task-head"><strong>{task.title}</strong><span className={'pc-status pc-status-'+task.status}>{label(statuses,task.status)}</span></div><p>{task.customerLabel} · {task.projectCode} {task.projectTitle}</p><p>轮次：{roundLabel(task)}</p><p>{label(steps,task.stepKey)} · {label(departments,task.department)} · {task.ownerName||'待分配'} · 截止 {task.dueDate||'未安排'}</p>{task.status==='done'&&<p>{task.acknowledgedAt?'项目负责人已阅反馈':'完成反馈待项目负责人推进'}</p>}<Button variant="outline" disabled={locked} onClick={event=>select(task,event)}>查看任务 · {task.title}</Button></article>)}{!visibleTasks.length&&<p className="pc-empty">当前筛选没有可见任务。</p>}</div></>}
  {selectedId&&feed&&<section className="pc-detail" aria-label="任务详情"><div className="pc-heading"><h3 tabIndex={-1} ref={heading}>任务详情</h3><Button variant="outline" disabled={locked} onClick={()=>switchTo(()=>{clearEditor();setSelectedId('');returnFocus.current?.focus();},'关闭任务详情')}>关闭详情</Button></div>{detailQuery.isPending&&<p role="status">正在核对任务读取权限…</p>}{detailQuery.isError&&<p role="alert" className="pc-error">任务读取失败，已隐藏原详情。{detailQuery.error.message}</p>}{selected&&<><h4>{selected.title}</h4><dl className="pc-summary"><div><dt>项目与环节</dt><dd>{selected.customerLabel} · {selected.projectCode} {selected.projectTitle}<br/>{label(steps,selected.stepKey)}<br/>轮次：{roundLabel(selected)}</dd></div><div><dt>负责人</dt><dd>{label(departments,selected.department)} · {selected.ownerName}</dd></div><div><dt>截止 / 状态</dt><dd>{selected.dueDate||'未安排'} · {label(statuses,selected.status)} · V{selected.version}</dd></div></dl><p className="pc-text">{selected.description||'未填写任务说明'}</p>{selected.result&&<div className="pc-result"><b>完成备注</b><p className="pc-text">{selected.result}</p></div>}
   <div className="pc-actions">{selected.canAssign&&openTask(selected)&&<Button variant="outline" disabled={locked} onClick={()=>switchTo(()=>{setReply(null);setDraft(draftOf(selected,scope));},'修改任务')}>修改任务</Button>}{selected.canOpenProject&&onNavigate&&<Button variant="outline" disabled={locked} onClick={()=>switchTo(()=>setNavigationRequest({scope,taskId:selected.id,context:{projectId:selected.projectId,customerId:selected.customerId,recordId:selected.id,tab:selected.stepKey}}),'打开项目原环节')}>打开项目原环节</Button>}</div>
   {!draft&&(selected.canReply||selected.canComplete||selected.canAcknowledge||selected.canAssign&&openTask(selected))&&<div className="pc-reply"><label>本次回复 / 完成备注<textarea aria-label="本次回复 / 完成备注" rows={4} maxLength={12000} disabled={locked} value={replyAllowed?reply?.comment||'':''} onChange={e=>setReplyField('comment',e.target.value)} placeholder="确认完成必须填写本次结果或完成依据。"/></label>{selected.canComplete&&<label>跟进进度<select aria-label="跟进进度" disabled={locked} value={replyAllowed?reply?.status||'':''} onChange={e=>setReplyField('status',e.target.value)}><option value="">保持当前进度</option><option value="in_progress">进行中</option><option value="blocked">受阻</option></select></label>}<div className="pc-actions">{selected.canReply&&<Button disabled={locked||stale} onClick={()=>actionTask('followup')}>{selected.canComplete?'保存跟进':'经理回复'}</Button>}{selected.canComplete&&<Button disabled={locked||stale} onClick={()=>actionTask('complete')}>确认完成</Button>}{selected.canAcknowledge&&<Button disabled={locked||stale} onClick={()=>actionTask('acknowledge')}>已阅反馈</Button>}{selected.canAssign&&openTask(selected)&&<Button variant="outline" disabled={locked||stale} onClick={()=>actionTask('cancel')}>取消任务（填写原因）</Button>}</div></div>}
   <details className="pc-history" open><summary>回复与操作历史 · {selected.history?.length||0} 条</summary><ol>{(selected.history||[]).map((entry,index)=><li key={entry.id||index}><header><b>{entry.actorName} · {label(historyActions,entry.action)}</b><time>{time(entry.at)}</time></header><p className="pc-text">{entry.comment||'已记录操作'}</p>{entry.changes?.filter(change=>changedFields[change.field]).map((change,i)=><p className="pc-text pc-change" key={i}>{changedFields[change.field]}：{['ownerId','roundId'].includes(change.field)?'已调整（保留原变更记录）':<>{changeText(change.field,change.before)} → {changeText(change.field,change.after)}</>}</p>)}</li>)}</ol></details>
  </>}</section>}
  {draft&&<section className="pc-editor" aria-label="待办编辑"><h3 tabIndex={-1} ref={heading}>{draft.id?'修改待办':'新增下一步待办'}</h3>{!draftAllowed?<p className="pc-warning" role="alert">当前范围或权限已变化，已暂停显示和保存表单；原输入仍保留。</p>:<form onSubmit={saveDraft}><fieldset disabled={locked}><div className="pc-fields"><label>任务名称<input aria-label="任务名称" required maxLength={300} value={draft.title} onChange={e=>setDraftField('title',e.target.value)}/></label><label>所属环节<select aria-label="所属环节" value={draft.stepKey} onChange={e=>setDraftField('stepKey',e.target.value as Step)}>{Object.entries(steps).map(([key,value])=><option key={key} value={key}>{value}</option>)}</select></label><label>负责部门<select aria-label="负责部门" required value={draft.department} onChange={e=>setDraftField('department',e.target.value as Department)}><option value="">请选择负责部门</option>{Object.entries(departments).map(([key,value])=><option key={key} value={key}>{value}</option>)}</select></label><label>负责人<select aria-label="负责人" required value={draft.ownerId} onChange={e=>setDraftField('ownerId',e.target.value)}><option value="">请选择在职负责人</option>{candidates?.members.map(member=><option key={member.id} value={member.id}>{member.name}</option>)}</select></label><label>截止日期<input aria-label="截止日期" type="date" value={draft.dueDate} onInput={e=>setDraftField('dueDate',e.currentTarget.value)} onChange={e=>setDraftField('dueDate',e.target.value)}/></label><label className="pc-wide">任务说明<textarea aria-label="任务说明" rows={3} maxLength={12000} value={draft.description} onChange={e=>setDraftField('description',e.target.value)}/></label>{draft.id&&<label className="pc-wide">修改原因<textarea aria-label="修改原因" required rows={2} maxLength={3000} value={draft.reason} onChange={e=>setDraftField('reason',e.target.value)}/></label>}</div><Button type="submit" disabled={stale}>保存待办</Button></fieldset></form>}<Button variant="outline" disabled={locked} onClick={()=>switchTo(clearEditor,'放弃本次编辑')}>放弃本次编辑</Button></section>}
  {stale&&feed&&<div className="pc-warning" role="alert"><p>任务已有新版本。你的输入已保留，当前不能覆盖保存。请核对上方最新详情后继续。</p><Button variant="outline" disabled={locked||!!draft&&!draftAllowed||!!reply&&!replyAllowed} onClick={()=>{if(draft&&draftTask)setDraft({...draft,version:draftTask.version});if(reply&&selected)setReply({...reply,version:selected.version});setError('');}}>已核对，保留输入并采用最新版本</Button></div>}
  {(draft||reply)&&!locked&&<div className="pc-actions"><Button variant="outline" onClick={()=>switchTo(clearEditor,'丢弃未保存输入')}>清除未保存输入</Button></div>}
 </section>;
}
