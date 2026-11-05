'use client';
import {useCallback,useMemo,useState} from 'react';
import {Button} from '@/components/ui/button';
import {matchesProjectListFilters,projectListFilterValues,projectListOwnerNames,projectListPendingTasks} from '@/lib/customer-project-list';
import {normalizeExcelValue,type ExcelColumnFilter,type ExcelFilters} from '@/lib/excel-filters';
import type {ExcelFilterModel} from './excel-table';
import {CPTable,CPBadge,type CPRow} from './customer-project-ui';

const date=(value:string)=>{const d=new Date(value);return Number.isNaN(d.getTime())?'日期待补充':d.toLocaleString('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});};
const departments:Record<string,string>={service:'客服',sales:'业务',pmc:'PMC',engineering:'工程',finance:'财务',production:'生产',purchase:'采购',purchasing:'采购',factory:'工厂',other:'其他'};

export function SimpleCustomerProjects({projects,communications,tasks,teams,followupMembers=[],customerName,memberName,statusFor,onOpen,busy}:{projects:CPRow[];communications:CPRow[];tasks:CPRow[];teams:CPRow[];followupMembers?:CPRow[];customerName:(id:string)=>string;memberName:(id:string)=>string;statusFor:(p:CPRow)=>string;onOpen:(id:string)=>void;busy:boolean}){
 const [agentOpen,setAgentOpen]=useState(false);
 const [filters,setFilters]=useState<ExcelFilters>({});
 const prepared=useMemo(()=>projects.map(project=>{
  const progress=communications.filter(row=>row.projectId===project.id).sort((a,b)=>String(b.occurredAt||b.createdAt||'').localeCompare(String(a.occurredAt||a.createdAt||'')));
  const pending=projectListPendingTasks(tasks,project.id),next=pending[0],latest=progress[0],ownerNames=projectListOwnerNames(pending,memberName);
  const values=[customerName(project.customerId),[project.title,project.code].filter(Boolean).join(' '),latest?[date(latest.occurredAt||latest.createdAt),latest.content,latest.createdBy||latest.updatedBy,'· 共 '+progress.length+' 条进展'].filter(Boolean).join(' '):'暂无进展记录',next?.title||'待安排',next?.department?departments[next.department]||next.department:'待指定',ownerNames.join('、'),next?.dueDate||'未设日期',statusFor(project),teams.find(team=>team.id===project.teamId)?.name||'未分组','记录 / 指派'];
  return {project,progress,latest,ownerNames,values};
 }),[projects,communications,tasks,teams,customerName,memberName,statusFor]);
 const visible=useMemo(()=>prepared.filter(row=>matchesProjectListFilters(row,filters)),[prepared,filters]);
 const setFilter=useCallback((column:number,value:ExcelColumnFilter|null)=>setFilters(previous=>{const next={...previous};if(value===null)delete next[column];else next[column]=Array.isArray(value)?[...new Set(value.map(normalizeExcelValue))]:{...value};return next;}),[]);
 const clearFilters=useCallback(()=>setFilters(previous=>Object.keys(previous).length?{}:previous),[]);
 const filterModel:ExcelFilterModel={rows:visible,total:prepared.length,filters,setFilter,clearFilters,values:column=>projectListFilterValues(prepared,column,followupMembers.map(member=>String(member.name||'')))};
 return <section className="scp-board"><header className="scp-heading"><div><span className="cp-eyebrow">PROJECT WORKSPACE</span><h2>项目清单</h2><p>{projects.length} 个项目 · 点击表头箭头筛选，打开项目记录进展、指定下一步跟进人</p><p>指定跟进人包含全部未完成事项；下一步事项、负责部门和截止日期显示最早待办。</p></div><Button variant="outline" onClick={()=>setAgentOpen(v=>!v)} aria-expanded={agentOpen}>本组 Agent · 待接入</Button></header>{agentOpen&&<section className="scp-agent" aria-label="本组 Agent 与待确认建议"><h3>本组 Agent</h3><p>入口已预留，消息渠道尚未接入，暂未生成建议。</p><div className="scp-agent-flow">多平台消息 → 识别客户与项目 → 自动建档 / 追加日期进展 → 指定跟进人 → 我的待办</div><p>待确认建议将显示：所属客户、项目、原消息依据、建议行动、负责部门、跟进人及期限。后续接通后，归属明确的消息可按授权规则自动建立无编号客户、项目和跟进记录；归属不清或疑似重复时进入待确认。</p></section>}<CPTable headers={['客户','项目','最新记录 / 日期与进展','下一步事项','负责部门','指定跟进人','截止日期','状态','所属组','操作']} filterModel={filterModel} rows={visible.map(({project:p,progress,latest,ownerNames,values})=>{
 return [values[0],<button className="scp-project-link" disabled={busy} onClick={()=>onOpen(p.id)}><b>{p.title}</b><small>{p.code}</small></button>,latest?<div className="scp-progress"><time>{date(latest.occurredAt||latest.createdAt)}</time><p>{latest.content}</p><small>{latest.createdBy||latest.updatedBy} · 共 {progress.length} 条进展</small></div>:<span className="cp-muted">暂无进展记录</span>,values[3],values[4],ownerNames.join('、'),values[6],<CPBadge>{values[7]}</CPBadge>,values[8],<Button size="sm" variant="outline" disabled={busy} onClick={()=>onOpen(p.id)}>记录 / 指派</Button>];
 })} empty="当前客户暂无项目。"/></section>;
}
