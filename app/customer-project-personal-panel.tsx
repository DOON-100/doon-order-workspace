'use client';
import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Button} from '@/components/ui/button';
import type {CustomerProjectPersonalWork,PersonalProjectAction,PersonalResponsibleProject} from '@/lib/customer-project-personal';
import type {WorkspaceNavigate,WorkspaceNavigationContext} from '@/lib/handoff-navigation';
import type {Data} from './workspace';
import {workspaceFetch} from './workspace-read-queue';
import './project-collaboration-panel.css';

const statuses:Record<string,string>={open:'待跟进',returned:'已退回，待补充',service_review:'待客服审核',sales_review:'待业务审核',pending:'待跟进',in_progress:'进行中',waiting_customer:'等客户',waiting_internal:'等内部',active:'进行中',paused:'已暂停',cancelled:'已取消',archived:'已归档'};
type Feed={personalProjectWork?:CustomerProjectPersonalWork};
async function readPersonalProjects(signal:AbortSignal):Promise<Feed>{
 const response=await workspaceFetch('/api/workspace/project-collaboration-data',{credentials:'same-origin',cache:'no-store',signal},{unscoped:true});
 const result=await response.json() as Feed&{error?:string};if(!response.ok)throw new Error(result.error||'读取项目待办失败，请重新读取。');return result;
}
export function personalProjectActionContext(action:PersonalProjectAction):WorkspaceNavigationContext{
 return {...(action.customerId?{customerId:action.customerId}:{}),...(action.projectId?{projectId:action.projectId}:{}),recordId:action.id,tab:action.source==='project'?'project-task':'followup'};
}
export function personalResponsibleProjectContext(project:PersonalResponsibleProject):WorkspaceNavigationContext{return {projectId:project.id,customerId:project.customerId,tab:'directory'};}

export function CustomerProjectPersonalPanel({data,onNavigate,initialContext}:{data:Data;onNavigate:WorkspaceNavigate;initialContext?:WorkspaceNavigationContext}){
 const [search,setSearch]=useState('');
 // Share the personal collaboration response and revision with the existing task panel.
 const query=useQuery<Feed>({queryKey:['project-collaboration',data.me.id,data.revision,''],queryFn:({signal})=>readPersonalProjects(signal),enabled:data.me.active,retry:false,refetchOnMount:'always'});
 const feed=data.me.active&&!query.isError&&!query.isPending?query.data?.personalProjectWork:undefined;
 const matches=(row:{customerId:string;projectId?:string;id:string},words:string[])=>
  (!initialContext?.customerId||row.customerId===initialContext.customerId)&&(!initialContext?.projectId||(row.projectId??row.id)===initialContext.projectId)&&(!search.trim()||words.join(' ').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
 const actions=feed?.actions.filter(row=>matches(row,[row.title,row.customerLabel,row.projectTitle,row.projectCode,statuses[row.status]||row.status]))||[];
 const projects=feed?.projects.filter(row=>matches(row,[row.title,row.code,row.customerLabel,statuses[row.status]||row.status]))||[];
 return <section className="project-collaboration panel" aria-label="我的项目跟进与负责项目">
  <header className="pc-heading"><div><h2>我的项目跟进与审核</h2><p>显示当前轮到我处理的项目行动和客户跟进，打开原记录继续办理。</p></div><Button variant="outline" disabled={query.isFetching} onClick={()=>void query.refetch()}>刷新项目待办</Button></header>
  {query.isPending&&data.me.active&&<p role="status">正在读取我的项目待办…</p>}
  {query.isError&&<p className="pc-error" role="alert">项目待办读取失败，已隐藏上次资料。{query.error.message}</p>}
  {feed&&<><div className="pc-filters"><label>搜索项目与跟进<input type="search" aria-label="搜索我的项目与跟进" value={search} onChange={event=>setSearch(event.target.value)} placeholder="客户、项目、事项"/></label><span>{actions.length} 条待办 · {projects.length} 个负责项目</span></div>
   <div className="pc-task-list">{actions.map(action=><article key={action.source+':'+action.id} className="pc-task"><div className="pc-task-head"><strong>{action.title}</strong><span className="pc-status">{statuses[action.status]||action.status}</span></div><p>{action.customerLabel} · {action.projectCode} {action.projectTitle}</p><p>{action.source==='followup'?'客户跟进':action.stage==='service_review'?'由我客服审核':action.stage==='sales_review'?'由我业务审核':'由我跟进'} · 截止 {action.dueDate||'未设日期'}</p>{action.unavailableReason&&<p className="pc-warning">{action.unavailableReason}</p>}<Button variant="outline" onClick={()=>onNavigate('customer-projects',personalProjectActionContext(action))}>{action.canAct?'打开处理':'查看原记录'} · {action.title}</Button></article>)}{!actions.length&&<p className="pc-empty">当前筛选没有轮到我处理的项目行动或客户跟进。</p>}</div>
   <div className="pc-heading" style={{marginTop:24}}><div><h2>我负责的项目</h2><p>按项目业务和客服负责人显示；项目归属与具体待办分开管理。</p></div></div>
   <div className="pc-task-list">{projects.map(project=><article key={project.id} className="pc-task"><div className="pc-task-head"><strong>{project.title}</strong><span className="pc-status">{statuses[project.status]||project.status}</span></div><p>{project.customerLabel} · {project.code||'未设项目编号'}</p><p>{project.roles.map(role=>role==='sales'?'业务负责人':'客服负责人').join('、')} · 目标日 {project.dueDate||'未设日期'}</p><Button variant="outline" onClick={()=>onNavigate('customer-projects',personalResponsibleProjectContext(project))}>打开负责项目 · {project.title}</Button></article>)}{!projects.length&&<p className="pc-empty">当前筛选没有由我担任业务或客服负责人的项目。</p>}</div>
  </>}
 </section>;
}
