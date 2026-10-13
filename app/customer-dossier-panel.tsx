'use client';
import {businessTeamFetch} from './business-team-client';

import {useEffect,useState,type ReactNode} from 'react';
import {ArrowLeft,ArrowRight,RefreshCw} from 'lucide-react';
import {Button} from '@/components/ui/button';
import type {CustomerAccount} from '@/lib/domain';
import type {WorkspaceNavigate} from '@/lib/handoff-navigation';
import type {Data} from './workspace';
import {dateTime} from './ui';
import {CustomerWorkflowTasks} from './customer-workflow-tasks';
import {CustomerWorkflowPanel} from './customer-workflow-panel';
import {CustomerWorkflowFiles} from './customer-workflow-files';
import './customer-dossier.css';

type Props={data:Data;customerId:string;onClose:()=>void;onNavigate:WorkspaceNavigate;onDirtyChange?:(dirty:boolean)=>void;initialTaskId?:string};
type Row=Record<string,unknown>;
type LinkedRow={id:string;customerId:string;title:string;description:string;status:string;updatedAt:string};
type Project=LinkedRow&{code:string;dueDate:string};
type Service=LinkedRow&{type:string;nextFollowUp:string;contact: {label:string;value:string}[]};
type Communication=LinkedRow&{channel:string;occurredAt:string;draftText:string;requiresRecheck:boolean};
type SectionState<T>={requestKey:string;status:'loading'|'denied'|'error';message?:string}|{requestKey:string;status:'ready';items:T[]};
const projectStatuses:Record<string,string>={active:'进行中',paused:'已暂停',cancelled:'已取消',archived:'已归档'};
const serviceStatuses:Record<string,string>={open:'进行中',done:'已完成',cancelled:'已取消'};
const serviceTypes:Record<string,string>={customer_profile:'客户联系档案',followup:'日常跟进',project:'新款 / 项目',sample:'样办 / 确认',shipment:'出货 / 单据',receivable:'应收 / 核销'};
const communicationStatuses:Record<string,string>={draft:'内部草稿',pending_check:'待人工核对',returned:'已退回补充',checked:'已人工核对 · 未发送'};
const channels:Record<string,string>={email:'邮件',whatsapp:'WhatsApp',wechat:'微信',phone:'电话',meeting:'会议',other:'其他'};
const object=(value:unknown):value is Row=>typeof value==='object'&&value!==null&&!Array.isArray(value);
const text=(value:unknown)=>typeof value==='string'?value:'';
const linked=(row:Row):LinkedRow=>({id:text(row.id),customerId:text(row.customerId),title:text(row.title),description:text(row.description),status:text(row.status),updatedAt:text(row.updatedAt)});
const toProject=(row:Row):Project=>({...linked(row),code:text(row.code),dueDate:text(row.dueDate)});
const toService=(row:Row):Service=>{
 const details=object(row.details)?row.details:{};
 const fields=[['contactPerson','联系人'],['email','邮箱'],['phone','电话'],['address','公司 / 收货地址']];
 return {...linked(row),type:text(row.type),nextFollowUp:text(row.nextFollowUp),contact:row.type==='customer_profile'?fields.map(([key,label])=>({label,value:text(details[key])})).filter(field=>field.value.trim()):[]};
};
const toCommunication=(row:Row):Communication=>({...linked(row),description:text(row.sourceText),channel:text(row.channel),occurredAt:text(row.occurredAt),draftText:text(row.draftText),requiresRecheck:row.requiresRecheck===true});
const serviceSummaryRows=(items:Service[])=>[...items.filter(row=>row.type==='customer_profile'),...items.filter(row=>row.type!=='customer_profile')].slice(0,12);

class SectionError extends Error{
 constructor(message:string,readonly denied=false){super(message);}
}

async function readSection<T>(action:string,field:string,customerId:string,decode:(row:Row)=>T,signal:AbortSignal):Promise<T[]>{
 const response=await businessTeamFetch('/api/workspace/'+action,{method:'GET',credentials:'same-origin',cache:'no-store',signal});
 if(response.status===401)throw new SectionError('登录已失效，请重新登录后查看。');
 if(response.status===403)throw new SectionError('当前账号没有此模块的读取权限。',true);
 if(!response.ok)throw new SectionError('此模块暂时读取失败，请重试或进入对应功能核对。');
 const result:unknown=await response.json();
 if(!object(result)||!Array.isArray(result.customers)||!result.customers.every(row=>object(row)&&typeof row.id==='string')||!Array.isArray(result[field]))throw new SectionError('此模块返回的数据不完整，请进入对应功能核对。');
 // An omitted customer means access is unavailable, never a successful empty result.
 if(!result.customers.some(row=>object(row)&&row.id===customerId))throw new SectionError('此模块未返回当前客户的访问范围，请在对应功能核对权限。',true);
 const rows=result[field] as unknown[];
 if(!rows.every(row=>object(row)&&typeof row.id==='string'&&typeof row.customerId==='string'))throw new SectionError('此模块的客户关联信息不完整，请进入对应功能核对。');
 // Do not associate orders, amounts or records using names, codes or neighbouring rows.
 return (rows as Row[]).filter(row=>row.customerId===customerId).sort((a,b)=>text(b.updatedAt).localeCompare(text(a.updatedAt))).map(decode);
}

function useSection<T>(action:string,field:string,customerId:string,decode:(row:Row)=>T,revision:number){
 const [requestKey,setRequestKey]=useState(0);
 const effectiveKey=revision+':'+requestKey;
 const [state,setState]=useState<SectionState<T>>({status:'loading',requestKey:effectiveKey});
 useEffect(()=>{
  const controller=new AbortController();
  setState({status:'loading',requestKey:effectiveKey});
  void readSection(action,field,customerId,decode,controller.signal).then(items=>{
   if(!controller.signal.aborted)setState({status:'ready',items,requestKey:effectiveKey});
  }).catch((error:unknown)=>{
   if(controller.signal.aborted)return;
   setState({status:error instanceof SectionError&&error.denied?'denied':'error',message:error instanceof SectionError?error.message:'连接或读取失败，请检查内网连接后重试。',requestKey:effectiveKey});
  });
  return ()=>controller.abort();
 },[action,field,customerId,decode,requestKey,revision]);
 return {state:state.requestKey===effectiveKey?state:{status:'loading' as const,requestKey:effectiveKey},reload:()=>setRequestKey(value=>value+1)};
}

function SummaryText({value,label='正文'}:{value:string;label?:string}){
 if(!value.trim())return <p className="dossier-muted">未填写{label}</p>;
 if(value.length<=280)return <p className="dossier-text">{value}</p>;
 return <details className="dossier-excerpt"><summary>{label}摘要：{value.slice(0,280)}… <span>展开全文</span></summary><p className="dossier-text">{value}</p></details>;
}

function Section<T>({title,state,reload,onOpen,children}:{title:string;state:SectionState<T>;reload:()=>void;onOpen:()=>void;children:(items:T[])=>ReactNode}){
 return <section className="panel dossier-section" aria-label={title}>
  <div className="dossier-section-heading"><h3>{title}{state.status==='ready'&&<span className="dossier-count">{state.items.length} 条可见记录</span>}</h3><div className="dossier-actions"><Button type="button" size="sm" variant="ghost" disabled={state.status==='loading'} onClick={reload} aria-label={'重新读取'+title}><RefreshCw size={14}/>刷新</Button><Button type="button" size="sm" variant="outline" onClick={onOpen}>查看{title}<ArrowRight size={14}/></Button></div></div>
  <div aria-live="polite">
   {state.status==='loading'?<p className="dossier-state" role="status">正在读取{title}…</p>:state.status==='denied'||state.status==='error'?<div className={'dossier-state dossier-state-'+state.status} role={state.status==='error'?'alert':'status'}><b>{state.status==='denied'?'访问范围未确认':'读取未完成'}</b><p>{state.message}</p><span>本区尚未取得完整结果。</span></div>:state.status==='ready'&&(state.items.length?children(state.items):<p className="dossier-state">当前可访问范围内，暂无关联此客户的{title}记录。</p>)}
  </div>
 </section>;
}

function DossierContent({data,customer,onClose,onNavigate,onDirtyChange,initialTaskId}:{data:Data;customer:CustomerAccount;onClose:()=>void;onNavigate:WorkspaceNavigate;onDirtyChange?:(dirty:boolean)=>void;initialTaskId?:string}){
 const [workflowDirty,setWorkflowDirty]=useState(false),[fileDirty,setFileDirty]=useState(false),[taskDirty,setTaskDirty]=useState(false);
 useEffect(()=>{onDirtyChange?.(workflowDirty||fileDirty||taskDirty);},[workflowDirty,fileDirty,taskDirty,onDirtyChange]);
 useEffect(()=>()=>onDirtyChange?.(false),[onDirtyChange]);
 const projects=useSection('customer-project-data','projects',customer.id,toProject,data.revision);
 const service=useSection('service-data','records',customer.id,toService,data.revision);
 const communication=useSection('unified-communication-data','items',customer.id,toCommunication,data.revision);
 const quoteAllowed=data.customerQuoteAccess===true;
 const showIntegrationDetail=['admin','programmer'].includes(data.me.role);
 const needsCheck=/待核查|待核对/.test(customer.notes||'');
 const directory=customer.directory;
 return <div className="customer-dossier">
  <div className="dossier-heading"><div><Button type="button" variant="ghost" size="sm" onClick={onClose}><ArrowLeft size={15}/>返回客户清单</Button><p className="dossier-eyebrow">统一客户档案</p><h2>{customer.customer}</h2><p className="dossier-muted">通用资料、联系方式、跟进与交接在同一客户档案留存，按现有权限读取和维护。</p></div><span className={'dossier-badge '+(customer.active?'':'dossier-badge-muted')}>{customer.active?'有效客户':'已停用 · 记录保留'}</span></div>
  <section className="panel dossier-section" aria-label="客户基础信息"><h3>客户基础信息</h3><dl className="dossier-basics"><div><dt>正式客户编码</dt><dd>{customer.customerCode||'未填写'}</dd></div><div><dt>国家 / 地区</dt><dd>{directory?.country||'待核查'}</dd></div><div><dt>客户等级</dt><dd>{directory?.grade||'待核查'}</dd></div><div><dt>品质要求</dt><dd>{directory?.qualityGrade||'待核查'}</dd></div><div><dt>产品难度</dt><dd>{directory?.productDifficulty||'待核查'}</dd></div><div><dt>客户分组</dt><dd>{directory?.bucket||'待核查'}</dd></div><div><dt>重点关注</dt><dd>{directory?.focus===true?'是':directory?.focus===false?'否':'待核查'}</dd></div><div><dt>登记日期（原始资料）</dt><dd>{directory?.registeredOn||'待核查'}</dd></div><div><dt>交接日期（原始资料）</dt><dd>{directory?.handoffOn||'待核查'}</dd></div><div><dt>业务负责人</dt><dd>{customer.salesName||'未填写'}</dd></div><div><dt>客服负责人</dt><dd>{customer.serviceName||'未填写'}</dd></div><div><dt>PMC 负责人</dt><dd>{customer.pmcName||'未填写'}</dd></div><div><dt>系统建档时间</dt><dd>{dateTime(customer.createdAt)}</dd></div><div><dt>最近更新</dt><dd>{dateTime(customer.updatedAt)}</dd></div></dl><p className="dossier-muted">登记及交接日期按原始资料核对填写，系统建档时间单独记录。</p><div className={'dossier-notes '+(needsCheck?'dossier-notes-pending':'')}><h4>{needsCheck?'待核查备注 / 客户备注':'客户备注'}</h4><p className="dossier-text">{customer.notes||'暂无备注'}</p></div></section>
  <CustomerWorkflowTasks data={data} customerId={customer.id} initialTaskId={initialTaskId} onDirtyChange={setTaskDirty}/><CustomerWorkflowPanel data={data} customer={customer} onDirtyChange={setWorkflowDirty}/><CustomerWorkflowFiles data={data} customerId={customer.id} onDirtyChange={setFileDirty}/>
  <Section title="前期开发" state={projects.state} reload={projects.reload} onOpen={()=>onNavigate('customer-projects',{customerId:customer.id})}>{items=><><ul className="dossier-list">{items.slice(0,8).map(row=><li key={row.id}><div className="dossier-record-heading"><h4>{row.title||'未填写项目标题'}</h4><span className="dossier-badge">{projectStatuses[row.status]||'状态待核对'}</span></div><p className="dossier-meta">{row.code||'未填写项目编号'}{row.dueDate&&<> · 计划日期 {row.dueDate}</>} · 更新 {dateTime(row.updatedAt)}</p><SummaryText value={row.description}/><Button variant="outline" size="sm" onClick={()=>onNavigate('customer-projects',{customerId:customer.id,projectId:row.id,tab:'directory'})}>查看此项目</Button></li>)}</ul>{items.length>8&&<p className="dossier-muted">此处显示最近更新的 8 条，其余请进入客户项目查看。</p>}</>}</Section>
  <Section title="客服档案与跟进" state={service.state} reload={service.reload} onOpen={()=>onNavigate('service',{customerId:customer.id})}>{items=><><ul className="dossier-list">{serviceSummaryRows(items).map(row=><li key={row.id}><div className="dossier-record-heading"><h4>{row.title||'未填写记录标题'}</h4><span className="dossier-badge">{serviceStatuses[row.status]||'状态待核对'}</span></div><p className="dossier-meta">{serviceTypes[row.type]||'其他记录'} · 更新 {dateTime(row.updatedAt)}{row.nextFollowUp&&<> · 下次跟进 {row.nextFollowUp}</>}</p>{row.contact.length>0&&<dl className="dossier-contacts">{row.contact.map(field=><div key={field.label}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl>}<SummaryText value={row.description}/><Button variant="outline" size="sm" onClick={()=>onNavigate('service',{customerId:customer.id,recordId:row.id})}>查看此记录</Button></li>)}</ul>{items.length>12&&<p className="dossier-muted">此处优先显示客户联系档案及最近跟进，共 12 条，其余请进入客服工作台查看。</p>}</>}</Section>
  <Section title="统一沟通" state={communication.state} reload={communication.reload} onOpen={()=>onNavigate('communications',{customerId:customer.id})}>{items=><><p className="dossier-muted">人工录入内容与内部草稿；草稿不代表已发送。{showIntegrationDetail&&' 邮件、WhatsApp 和 AI 尚未接通。'}</p><ul className="dossier-list">{items.slice(0,8).map(row=><li key={row.id}><div className="dossier-record-heading"><h4>{row.title||'未填写沟通标题'}</h4><span className="dossier-badge">{communicationStatuses[row.status]||'状态待核对'}</span></div><p className="dossier-meta">{channels[row.channel]||'其他'} · {row.occurredAt?dateTime(row.occurredAt):'未填写沟通时间'} · 更新 {dateTime(row.updatedAt)}</p>{row.requiresRecheck&&<p className="dossier-review-note">原文已变更，需重新核对草稿。</p>}<h5>录入的原文</h5><SummaryText value={row.description} label="原文"/>{row.draftText&&<div className="dossier-draft"><h5>内部草稿 · 未发送</h5><SummaryText value={row.draftText} label="草稿"/></div>}<Button variant="outline" size="sm" onClick={()=>onNavigate('communications',{customerId:customer.id,recordId:row.id})}>查看此沟通</Button></li>)}</ul>{items.length>8&&<p className="dossier-muted">此处显示最近更新的 8 条，其余请进入统一沟通查看。</p>}</>}</Section>
  <section className="panel dossier-section" aria-label="报价与附件入口"><h3>报价与附件</h3><p className="dossier-muted">按当前客户直接查看对应报价与附件，所有功能沿用当前账号授权。</p><div className="dossier-actions dossier-module-links">{quoteAllowed&&<Button type="button" variant="outline" onClick={()=>onNavigate('customer-quotes',{customerId:customer.id})}>查看客户报价<ArrowRight size={14}/></Button>}<Button type="button" variant="outline" onClick={()=>onNavigate('customer-projects',{customerId:customer.id})}>查看项目附件<ArrowRight size={14}/></Button><Button type="button" variant="outline" onClick={()=>onNavigate('service',{customerId:customer.id})}>查看客服附件<ArrowRight size={14}/></Button></div>{!quoteAllowed&&<p className="dossier-muted">当前账号未开放客户报价入口。</p>}</section>
 </div>;
}

export function CustomerDossierPanel({data,customerId,onClose,onNavigate,onDirtyChange,initialTaskId}:Props){
 const customer=data.customerAccounts?.find(row=>row.id===customerId);
 if(!customer||!data.me.active)return <section className="panel dossier-section"><Button type="button" variant="outline" onClick={onClose}><ArrowLeft size={15}/>返回客户清单</Button><p className="dossier-state">当前客户不在可见清单内，或登录账号已停用。请刷新客户清单后核对。</p></section>;
 // Identity/customer remount clears drafts; revision-aware feeds hide cached scope while preserving unsaved input.
 return <DossierContent key={`${data.me.id}:${customer.id}`} data={data} customer={customer} onClose={onClose} onNavigate={onNavigate} onDirtyChange={onDirtyChange} initialTaskId={initialTaskId}/>;
}
