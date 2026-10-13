'use client';

import {useEffect,useMemo,useState} from 'react';
import {ArrowUpRight,ClipboardList,FileCheck2,Search} from 'lucide-react';
import './engineering-task-board.css';

export type EngineeringTaskCard={id:string;kind:'drawing'|'sop';title:string;customerCode:string;category:string;status:string;assignee:string;deadline:string;summary:string;updatedAt:string;attention?:boolean};
type GroupBy='category'|'status'|'assignee';
type Scope='all'|'open'|'attention';
const terminal=new Set(['已完成','已交接','已确认','已取消','已替代']);
const done=(task:EngineeringTaskCard)=>terminal.has(task.status);
const pageSize=8;

export function EngineeringTaskBoard({tasks,onOpen}:{tasks:EngineeringTaskCard[];onOpen:(task:EngineeringTaskCard)=>void}){
 const [groupBy,setGroupBy]=useState<GroupBy>('category'),[scope,setScope]=useState<Scope>('all'),[query,setQuery]=useState(''),[limits,setLimits]=useState<Record<string,number>>({});
 const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
 const isOverdue=(task:EngineeringTaskCard)=>!done(task)&&/^\d{4}-\d{2}-\d{2}$/.test(task.deadline)&&task.deadline<today;
 const needsAttention=(task:EngineeringTaskCard)=>!done(task)&&(!!task.attention||isOverdue(task));
 const metrics=[{key:'all' as const,label:'任务总数',value:tasks.length},{key:'open' as const,label:'未完成',value:tasks.filter(task=>!done(task)).length},{key:'attention' as const,label:'需处理',value:tasks.filter(needsAttention).length}];
 useEffect(()=>setLimits({}),[groupBy,scope,query]);
 const filtered=useMemo(()=>{
  const search=query.trim().toLocaleLowerCase();
  return tasks.filter(task=>
   (scope==='all'||scope==='open'&&!done(task)||scope==='attention'&&needsAttention(task))&&
   (!search||[task.title,task.customerCode,task.category,task.status,task.assignee,task.summary].join(' ').toLocaleLowerCase().includes(search))
  ).sort((a,b)=>Number(needsAttention(b))-Number(needsAttention(a))||Number(done(a))-Number(done(b))||b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id));
 },[tasks,scope,query,today]);
 const groups=useMemo(()=>{
  const map=new Map<string,{key:string;label:string;tasks:EngineeringTaskCard[]}>();
  for(const task of filtered){
   const value=groupBy==='category'?(task.category||'未分类'):groupBy==='status'?(task.status||'待核对'):(task.assignee||'待分配');
   const key=groupBy==='category'?task.kind+':'+value:value;
   const group=map.get(key)||{key,label:groupBy==='category'?(task.kind==='sop'?'SOP · ':'画图 · ')+value:value,tasks:[]};
   group.tasks.push(task);map.set(key,group);
  }
  return [...map.values()].sort((a,b)=>Number(b.tasks.some(needsAttention))-Number(a.tasks.some(needsAttention))||a.label.localeCompare(b.label,'zh-CN'));
 },[filtered,groupBy,today]);
 const reset=()=>{setQuery('');setScope('all');};
 return <section className="engineering-task-board" aria-label="工程任务看板">
  <div className="etb-heading"><div><h2>工程任务看板</h2><p>画图与 SOP 任务分类展示，点击卡片查看完整资料和处理记录。</p></div><span className="etb-total">{tasks.length} 项任务</span></div>
  <div className="etb-metrics" aria-label="工程任务范围">{metrics.map(metric=><button type="button" key={metric.key} className={scope===metric.key?'selected':''} aria-pressed={scope===metric.key} onClick={()=>setScope(metric.key)}><span>{metric.label}</span><strong>{metric.value}</strong><small>{metric.key==='all'?'包含已完成与历史任务':metric.key==='open'?'跟进尚未结束的任务':'需要核对、更新或处理的任务'}</small></button>)}</div>
  <div className="etb-controls"><label className="etb-search"><Search size={17} aria-hidden="true"/><input aria-label="搜索工程任务" placeholder="搜索客户、任务、款号或负责人" value={query} onChange={event=>setQuery(event.target.value)}/></label><label className="etb-group-select"><span>分组方式</span><select aria-label="工程任务分组方式" value={groupBy} onChange={event=>setGroupBy(event.target.value as GroupBy)}><option value="category">按任务分类</option><option value="status">按跟进状态</option><option value="assignee">按负责人</option></select></label></div>
  <div className="etb-result" aria-live="polite"><span>{scope==='all'?'全部任务':scope==='open'?'未完成任务':'需处理任务'} · 当前显示 {filtered.length} 项，共 {groups.length} 组</span>{(query||scope!=='all')&&<button type="button" onClick={reset}>显示全部任务</button>}</div>
  {!groups.length?<div className="etb-empty"><ClipboardList size={28} aria-hidden="true"/><strong>{tasks.length?'没有符合条件的任务':'暂无工程任务'}</strong><p>{tasks.length?'调整搜索或切回全部任务查看。':'登记画图需求或 SOP 任务后，会在这里按分类显示。'}</p></div>:<div className="etb-groups">{groups.map(group=>{
   const limit=limits[group.key]||pageSize,visible=group.tasks.slice(0,limit),remaining=group.tasks.length-visible.length;
   return <section key={group.key} className="etb-group" aria-label={group.label}><header><div><h3>{group.label}</h3><span>{group.tasks.length}</span></div><small>{group.tasks.filter(task=>!done(task)).length} 项未完成</small></header><div className="etb-cards">{visible.map(task=>{
    const complete=done(task),attention=needsAttention(task),overdue=isOverdue(task);
    const Icon=task.kind==='sop'?FileCheck2:ClipboardList;
    return <button type="button" key={task.kind+':'+task.id} className={'etb-card'+(attention?' etb-attention':'')+(complete?' etb-complete':'')} aria-label={'查看'+(task.title||'工程任务')+'详情'} onClick={()=>onOpen(task)}><span className="etb-card-top"><span className="etb-kind"><Icon size={15} aria-hidden="true"/>{task.kind==='sop'?'SOP':'画图'}</span><span className={'etb-status'+(complete?' done':'')}>{task.status||'待核对'}</span></span><span className="etb-card-title">{task.title||'未命名任务'}</span><span className="etb-customer">{task.customerCode||'客户待关联'}</span><span className="etb-summary">{task.summary||'暂无补充说明，点击查看详情。'}</span><span className="etb-card-meta"><span>负责人<strong>{task.assignee||'待分配'}</strong></span><span>截止日期<strong>{task.deadline||'待排期'}</strong></span></span><span className="etb-card-footer"><span>{overdue?'已逾期':attention?'需处理':complete?'已结束':'跟进中'}</span><span>查看详情<ArrowUpRight size={14} aria-hidden="true"/></span></span></button>;
   })}</div>{group.tasks.length>pageSize&&<footer className="etb-group-footer"><span>已显示 {visible.length} / {group.tasks.length} 项</span><div>{remaining>0&&<button type="button" onClick={()=>setLimits(current=>({...current,[group.key]:limit+pageSize}))}>再显示 {Math.min(pageSize,remaining)} 项</button>}{limit>pageSize&&<button type="button" onClick={()=>setLimits(current=>({...current,[group.key]:pageSize}))}>收起</button>}</div></footer>}</section>;
  })}</div>}
 </section>;
}
