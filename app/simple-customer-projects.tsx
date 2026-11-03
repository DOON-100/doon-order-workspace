'use client';
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {CPTable,CPBadge,type CPRow} from './customer-project-ui';

export function SimpleCustomerProjects({projects,communications,tasks,teams,customerName,memberName,statusFor,onOpen,busy}:{projects:CPRow[];communications:CPRow[];tasks:CPRow[];teams:CPRow[];customerName:(id:string)=>string;memberName:(id:string)=>string;statusFor:(p:CPRow)=>string;onOpen:(id:string)=>void;busy:boolean}){
 const [agentOpen,setAgentOpen]=useState(false);
 const date=(value:string)=>{const d=new Date(value);return Number.isNaN(d.getTime())?'日期待补充':d.toLocaleString('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});};
 return <section className="scp-board"><header className="scp-heading"><div><span className="cp-eyebrow">PROJECT WORKSPACE</span><h2>项目清单</h2><p>{projects.length} 个项目 · 点击表头箭头筛选，打开项目记录进展、指定下一步跟进人</p></div><Button variant="outline" onClick={()=>setAgentOpen(v=>!v)} aria-expanded={agentOpen}>本组 Agent · 待接入</Button></header>{agentOpen&&<section className="scp-agent" aria-label="本组 Agent 与待确认建议"><h3>本组 Agent</h3><p>入口已预留，消息渠道尚未接入，暂未生成建议。</p><div className="scp-agent-flow">多平台消息 → 识别客户与项目 → 自动建档 / 追加日期进展 → 指定跟进人 → 我的待办</div><p>待确认建议将显示：所属客户、项目、原消息依据、建议行动、负责部门、跟进人及期限。后续接通后，归属明确的消息可按授权规则自动建立无编号客户、项目和跟进记录；归属不清或疑似重复时进入待确认。</p></section>}<CPTable headers={['客户','项目','最新记录 / 日期与进展','下一步事项','负责部门','指定跟进人','截止日期','状态','所属组','操作']} rows={projects.map(p=>{
 const progress=communications.filter(r=>r.projectId===p.id).sort((a,b)=>String(b.occurredAt||b.createdAt||'').localeCompare(String(a.occurredAt||a.createdAt||'')));
 const next=tasks.filter(t=>t.projectId===p.id).sort((a,b)=>String(a.dueDate||'9999').localeCompare(String(b.dueDate||'9999')))[0];
 const latest=progress[0],departments:Record<string,string>={service:'客服',sales:'业务',pmc:'PMC',engineering:'工程',finance:'财务',production:'生产',purchase:'采购',purchasing:'采购',factory:'工厂',other:'其他'};
 return [customerName(p.customerId),<button className="scp-project-link" disabled={busy} onClick={()=>onOpen(p.id)}><b>{p.title}</b><small>{p.code}</small></button>,latest?<div className="scp-progress"><time>{date(latest.occurredAt||latest.createdAt)}</time><p>{latest.content}</p><small>{latest.createdBy||latest.updatedBy} · 共 {progress.length} 条进展</small></div>:<span className="cp-muted">暂无进展记录</span>,next?.title||'待安排',next?.department?departments[next.department]||next.department:'待指定',next?.ownerId?memberName(next.ownerId):'待指定',next?.dueDate||'未设日期',<CPBadge>{statusFor(p)}</CPBadge>,teams.find(t=>t.id===p.teamId)?.name||'未分组',<Button size="sm" variant="outline" disabled={busy} onClick={()=>onOpen(p.id)}>记录 / 指派</Button>];
 })} empty="当前客户暂无项目。"/></section>;
}
