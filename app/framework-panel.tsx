'use client';
import {useMemo,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {ArrowUpRight,BookOpen,CalendarDays,CheckCircle2,ClipboardList,RefreshCw,Search,ShieldCheck} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input,Empty,request} from './ui';
import type {Data} from './workspace';
import {buildFrameworkTodos,frameworkAgents,frameworkDay,frameworkDue,frameworkFlows,frameworkIsManager,frameworkMethods,frameworkRules,frameworkVersion,visibleFrameworkFlows,visibleFrameworkRules,type FrameworkProjectData,type FrameworkFollowupData,type FrameworkCommunicationData,type FrameworkTodo} from '@/lib/business-framework';
import './framework.css';
import {HandoffKnowledgePanel} from './handoff-framework-panel';
import {HandoffWorkbenchPanel} from './handoff-workbench-panel';

export type FrameworkPanelProps={data:Data;onNavigate:(view:string,context?:{recordId?:string;customerId?:string;projectId?:string;orderId?:string;tab?:string})=>void};
const stamp=(value:string)=>value&&!Number.isNaN(Date.parse(value))?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'未提供更新时间';
const errorMessage=(error:unknown)=>error instanceof Error?error.message:'该来源暂时无法读取，请重试。';
const destinations=[{view:'customers',title:'统一客户主档',detail:'客户、联系人及责任归属'},{view:'customer-projects',title:'项目与开发',detail:'客户跟进、项目任务与审核'},{view:'service',title:'订单与客服',detail:'单据、财务资料与出货跟进'},{view:'engineering-drawings',title:'工程资料',detail:'需求、图纸与版本检查'},{view:'pmc',title:'生产与排期',detail:'PMC 接收、准备与进度'}];

function SourceStatus({name,pending,error,updatedAt,onRetry}:{name:string;pending:boolean;error:unknown;updatedAt:number;onRetry:()=>void}){
 return <div className={'framework-source'+(error?' is-error':'')} role={error?'status':undefined}><span><b>{name}</b><small>{error?errorMessage(error):pending?'正在读取…':updatedAt?'已读取 · '+stamp(new Date(updatedAt).toISOString()):'尚未读取'}</small></span>{!!error&&<Button size="sm" variant="outline" onClick={onRetry}>重试</Button>}</div>;
}
function TodoCard({row,today,onNavigate}:{row:FrameworkTodo;today:string;onNavigate:FrameworkPanelProps['onNavigate']}){
 const due=frameworkDue(row.date,today);
 return <article className="framework-todo"><div className="framework-todo-main"><div className="framework-badges"><span className="pill">{row.source}</span><span className={'pill '+(due==='已逾期'?'red':due==='今日到期'?'amber':row.review?'blue':'')}>{row.review?row.status:due}</span></div><h3>{row.title}</h3><p className="framework-todo-context"><b>{row.customer||'客户待核对'}</b><span>{row.reference||'未提供项目或订单编号'}</span></p><p className="framework-next"><CheckCircle2 size={15}/><span>{row.nextAction}</span></p><div className="framework-todo-meta"><span>负责人：{row.owner}</span><span>{row.dateLabel}：{row.date||'未定'}</span><span>来源更新：{stamp(row.updatedAt)}</span></div></div><Button variant="outline" onClick={()=>onNavigate(row.view)}>查看原记录 <ArrowUpRight size={15}/></Button></article>;
}

export function FrameworkWorkbench(props:FrameworkPanelProps){return <HandoffWorkbenchPanel {...props}/>;}
export function FrameworkLegacyWorkbench({data,onNavigate}:FrameworkPanelProps){
 const cache=useQueryClient(),[scope,setScope]=useState<'all'|'mine'>('all'),[filter,setFilter]=useState('all'),[search,setSearch]=useState(''),[limit,setLimit]=useState(30);
 const enabled=data.me.active&&data.me.role!=='supplier';
 // Each existing endpoint applies its own server-side customer and project authorization.
 const queryScope=[data.me.id,data.me.role,data.me.active,data.revision];
 const projects=useQuery<FrameworkProjectData>({queryKey:['framework-projects',...queryScope],enabled,queryFn:()=>request('customer-project-data'),refetchInterval:30000,retry:false});
 const followups=useQuery<FrameworkFollowupData>({queryKey:['framework-followups',...queryScope],enabled,queryFn:()=>request('customer-project-followup-data'),refetchInterval:30000,retry:false});
 const communications=useQuery<FrameworkCommunicationData>({queryKey:['framework-communications',...queryScope],enabled,queryFn:()=>request('unified-communication-data'),refetchInterval:30000,retry:false});
 const today=frameworkDay();
 const todos=useMemo(()=>buildFrameworkTodos(data,projects.isError?undefined:projects.data,followups.isError?undefined:followups.data,today,communications.isError?undefined:communications.data),[data,projects.data,projects.isError,followups.data,followups.isError,communications.data,communications.isError,today]);
 const scoped=todos.filter(t=>scope==='all'||t.mine),late=scoped.filter(t=>t.date&&t.date<today),reviews=scoped.filter(t=>t.review),dated=scoped.filter(t=>t.date===today);
 const filtered=scoped.filter(t=>(filter==='all'||filter==='late'&&!!t.date&&t.date<today||filter==='today'&&t.date===today||filter==='review'&&t.review)&&(!search||[t.title,t.customer,t.reference,t.owner,t.nextAction].join(' ').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())));
 const manager=frameworkIsManager(data.me),loading=projects.isPending||followups.isPending||communications.isPending,partial=projects.isError||followups.isError||communications.isError,refreshing=projects.isFetching||followups.isFetching||communications.isFetching;
 function choose(next:string){setFilter(next);setLimit(30);}
 if(!enabled)return <section className="panel"><Empty title="当前账号没有工作台读取范围" detail="请使用已启用的内部成员账号，原有业务数据保持不变。"/></section>;
 return <div className="framework-workspace" data-framework-workbench>
  <section className="framework-hero"><div><p className="eyebrow">协作工作台</p><h2>从待办进入业务</h2><p>把客户跟进、沟通核对、项目审核与订单事项放在一起，处理结果回到原记录。</p><span className="framework-scope"><ShieldCheck size={14}/> 当前账号可见范围 · {today}</span></div><Button variant="outline" onClick={()=>{void cache.invalidateQueries({queryKey:['workspace']});void projects.refetch();void followups.refetch();void communications.refetch();}} disabled={refreshing}><RefreshCw size={16} className={refreshing?'animate-spin':''}/>刷新来源</Button></section>
  <div className="framework-shortcuts">{destinations.map(d=><button key={d.view} onClick={()=>onNavigate(d.view)}><span>{d.title}<ArrowUpRight size={15}/></span><small>{d.detail}</small></button>)}</div>
  <div className="framework-section-head"><div><h2 className="section-title">待处理事项</h2><p className="subtitle">按原记录的状态和日期汇总；不同业务来源保留各自记录。</p></div><div className="segmented" aria-label="事项责任范围"><button className={scope==='all'?'selected':''} aria-pressed={scope==='all'} onClick={()=>{setScope('all');setLimit(30);}}>全部可见</button><button className={scope==='mine'?'selected':''} aria-pressed={scope==='mine'} onClick={()=>{setScope('mine');setLimit(30);}}>与我有关</button></div></div>
  <div className="framework-counts">{[{id:'all',label:'已读取的待办',value:scoped.length,icon:ClipboardList},{id:'late',label:'日期已逾期',value:late.length,icon:CalendarDays},{id:'today',label:'今日到期',value:dated.length,icon:CalendarDays},{id:'review',label:'待核对与审核',value:reviews.length,icon:ShieldCheck}].map(({id,label,value,icon:Icon})=><button key={id} className={filter===id?'selected':''} aria-pressed={filter===id} onClick={()=>choose(id)}><span><Icon size={17}/>{label}</span><strong>{value}</strong><small>{partial||loading?'当前已读取来源的事项':'查看对应事项'}</small></button>)}</div>
  <section className="panel"><div className="panel-tools"><b>{filter==='late'?'逾期待办':filter==='today'?'今日事项':filter==='review'?'待核对与审核':'事项清单'} · {filtered.length}</b><div className="search"><Search size={16}/><Input aria-label="搜索工作台事项" placeholder="客户、项目、订单或负责人" value={search} onChange={e=>{setSearch(e.target.value);setLimit(30);}}/></div></div>
   {(partial||loading)&&<div className="framework-inline-note" role="status">{partial?'部分来源暂时不可读，下面保留其他已读取来源的事项；当前数量不是全部事项总数。':'正在读取补充来源，已显示的订单事项可以先查看。'}</div>}
   {filtered.length?filtered.slice(0,limit).map(t=><TodoCard key={t.id} row={t} today={today} onNavigate={onNavigate}/>):<Empty title={loading?'正在汇总可见事项…':partial?'已读取来源中没有符合条件的事项':'当前没有符合条件的待办'} detail={partial?'请检查下方来源状态，重试后再核对完整范围。':search||filter!=='all'||scope==='mine'?'可调整搜索、日期或责任范围后再查看。':'已完成、已取消的事项不在此重复列出；可从业务入口查看完整历史。'}/>}
   {filtered.length>limit&&<div className="framework-more"><Button variant="outline" onClick={()=>setLimit(v=>v+30)}>再显示 30 项（还有 {filtered.length-limit} 项）</Button></div>}
  </section>
  <section className="panel section-pad"><h2 className="section-title">来源状态</h2><div className="framework-sources"><div className="framework-source"><span><b>现有订单与跟进记录</b><small>共享数据版本 {data.revision} · {stamp(data.asOf)}</small></span></div><SourceStatus name="客户项目与审核任务" pending={projects.isPending} error={projects.error} updatedAt={projects.dataUpdatedAt} onRetry={()=>void projects.refetch()}/><SourceStatus name="客户跟进事项" pending={followups.isPending} error={followups.error} updatedAt={followups.dataUpdatedAt} onRetry={()=>void followups.refetch()}/><SourceStatus name="统一沟通核对事项" pending={communications.isPending} error={communications.error} updatedAt={communications.dataUpdatedAt} onRetry={()=>void communications.refetch()}/></div><p className="framework-footnote">邮件与 WhatsApp 本期仍在原渠道处理；这里的待办不代表消息已经发送或部门已经接收。</p>{manager&&<p className="framework-footnote">邮箱、WhatsApp 和后台 AI 暂未接通；本页只读取现有接口，不运行模型、不发送消息。</p>}</section>
 </div>;
}

export function FrameworkRulesPanel(props:FrameworkPanelProps){return <HandoffKnowledgePanel {...props}/>;}
export function FrameworkRulesReferencePanel({data,onNavigate}:FrameworkPanelProps){
 const manager=frameworkIsManager(data.me),[tab,setTab]=useState('flows'),[search,setSearch]=useState('');
 const rules=visibleFrameworkRules(data.me),flows=visibleFrameworkFlows(data.me),query=search.trim().toLocaleLowerCase();
 const matches=(...parts:string[])=>!query||parts.join(' ').toLocaleLowerCase().includes(query);
 const actualTab=!manager&&['methods','agents'].includes(tab)?'flows':tab;
 const tabs=[{id:'flows',label:'业务流程'},{id:'rules',label:'规则摘要'},...(manager?[{id:'methods',label:'方法目录'},{id:'agents',label:'业务智能体'}]:[])];
 const displayedFlows=flows.filter(f=>matches(f.name,...f.stages.map(s=>s.title))),displayedRules=rules.filter(r=>matches(r.title,r.summary,r.check)),displayedMethods=frameworkMethods.filter(m=>matches(m.name,m.output)),displayedAgents=frameworkAgents.filter(a=>matches(a.name,...a.methodIds));
 if(!data.me.active||data.me.role==='supplier')return <section className="panel"><Empty title="当前账号没有规则中心读取范围" detail="请使用已启用的内部成员账号。"/></section>;
 return <div className="framework-workspace" data-framework-rules>
  <section className="framework-hero"><div><p className="eyebrow">知识与规则</p><h2>沿业务流程核对每一步</h2><p>客户主档统一维护，业务仍在原有入口处理；规则摘要按当前岗位展示。</p><span className="framework-scope"><BookOpen size={14}/> 摘要版本 {frameworkVersion} · 待验收</span></div><Button variant="outline" onClick={()=>onNavigate('customers')}>统一客户主档 <ArrowUpRight size={16}/></Button></section>
  <div className="framework-inline-note">价格、MOQ、特殊财务处理及审批角色沿用现系统，差异逐项核实后再调整。流程指引不会代替正式源单据或改变现有权限。</div>
  <section className="panel"><div className="panel-tools"><div className="segmented" aria-label="规则内容分类">{tabs.map(t=><button key={t.id} className={actualTab===t.id?'selected':''} aria-pressed={actualTab===t.id} onClick={()=>{setTab(t.id);setSearch('');}}>{t.label}</button>)}</div><div className="search"><Search size={16}/><Input aria-label="搜索规则内容" placeholder="搜索职责、流程或核对要求" value={search} onChange={e=>setSearch(e.target.value)}/></div></div>
   {actualTab==='flows'&&<div className="framework-flow-list">{displayedFlows.length?displayedFlows.map(flow=><details className="framework-flow" key={flow.id}><summary><span><b>{flow.name}</b><small>{flow.stages.length} 个核对步骤 · 人工处理与审核</small></span><span className="framework-expand">展开步骤</span></summary><div className="framework-flow-body"><ol>{flow.stages.map((stage,i)=><li key={stage.title}><span className="framework-step-number">{i+1}</span><div><h3>{stage.title}</h3><dl><div><dt>来源</dt><dd>{stage.source}</dd></div><div><dt>负责</dt><dd>{stage.owner}</dd></div><div><dt>核对与审核</dt><dd>{stage.review}</dd></div></dl><Button variant="outline" size="sm" onClick={()=>onNavigate(stage.view)}>打开业务入口 <ArrowUpRight size={14}/></Button></div></li>)}</ol><p className="framework-footnote">关联规则：{flow.ruleIds.map(id=>frameworkRules.find(r=>r.id===id)?.title).filter(Boolean).join(' / ')}</p>{manager&&<p className="framework-footnote">流程标识：{flow.id} · 关联智能体：{flow.agentIds.map(id=>frameworkAgents.find(a=>a.id===id)?.name).join(' / ')} · 自动执行未启用</p>}</div></details>):<Empty title="当前范围没有匹配的流程" detail="可以切换规则摘要查看通用操作要求，或调整搜索。"/>}</div>}
   {actualTab==='rules'&&<div className="framework-rule-grid">{displayedRules.length?displayedRules.map(rule=><article className="framework-rule" key={rule.id}><span className="framework-rule-number">{rule.number}</span><h3>{rule.title}</h3><p>{rule.summary}</p><div className="framework-check"><b>核对要求</b><p>{rule.check}</p></div><Button variant="outline" size="sm" onClick={()=>onNavigate(rule.view)}>查看业务入口 <ArrowUpRight size={14}/></Button></article>):<Empty title="没有匹配的规则" detail="请调整搜索关键词。"/>}</div>}
   {manager&&actualTab==='methods'&&<><div className="framework-inline-note">16 项方法定义，自动执行未启用。只描述输入处理与输出要求，不会连接模型、读取外部资料或改变业务记录。</div><div className="framework-rule-grid">{displayedMethods.length?displayedMethods.map(method=><article className="framework-rule" key={method.id}><span className="pill">方法定义</span><h3>{method.name}</h3><p>{method.output}</p><small>引用规则：{method.ruleIds.map(id=>frameworkRules.find(r=>r.id===id)?.title).join(' / ')}</small><small>使用方：{frameworkAgents.filter(a=>a.methodIds.includes(method.id)).map(a=>a.name).join(' / ')}</small><span className="framework-footnote">稳定标识：{method.id} · 自动执行未启用</span></article>):<Empty title="没有匹配的方法" detail="请调整搜索关键词。"/>}</div></>}
   {manager&&actualTab==='agents'&&<><div className="framework-inline-note">9 个业务智能体为职责定义，自动执行未启用。岗位审核、账号权限和现有业务审批分别保留。</div><div className="framework-rule-grid">{displayedAgents.length?displayedAgents.map(agent=><article className="framework-rule" key={agent.id}><span className="pill">职责定义</span><h3>{agent.name}</h3><p>方法：{agent.methodIds.map(id=>frameworkMethods.find(m=>m.id===id)?.name).join(' / ')}</p><small>流程：{frameworkFlows.filter(f=>f.agentIds.includes(agent.id)).map(f=>f.name).join(' / ')}</small><span className="framework-footnote">稳定标识：{agent.id} · 自动执行未启用</span></article>):<Empty title="没有匹配的职责" detail="请调整搜索关键词。"/>}</div></>}
  </section>
  {manager&&<section className="panel section-pad"><h2 className="section-title">本期接入范围</h2><div className="framework-connection-grid">{['邮箱','WhatsApp','后台 AI'].map(name=><div key={name}><b>{name}</b><span className="pill">暂未接通</span></div>)}</div><p className="framework-footnote">保留现有内网业务数据与原有入口。本页的版本和关系用于审阅，不代表流程已发布或后台任务已运行。</p></section>}
 </div>;
}
