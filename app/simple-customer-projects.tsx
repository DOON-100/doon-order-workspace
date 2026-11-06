'use client';
import {useCallback,useMemo,useState} from 'react';
import './customer-project-responsibility.css';
import {CustomerProjectTableScroll} from './customer-project-table-scroll';
import {Button} from '@/components/ui/button';
import {matchesProjectListFilters,projectListFilterValues,projectListOwnerNames,projectListPendingTasks} from '@/lib/customer-project-list';
import {normalizeExcelValue,type ExcelColumnFilter,type ExcelFilters} from '@/lib/excel-filters';
import type {ExcelFilterModel} from './excel-table';
import {CPTable,type CPRow} from './customer-project-ui';

const date=(value:string)=>{const d=new Date(value);return Number.isNaN(d.getTime())?'日期待补充':d.toLocaleString('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});};

export function SimpleCustomerProjects({projects,communications,tasks,teams,followupMembers=[],customerName,memberName,statusFor,onOpen,onAssign,onEdit,onProgress,onTasks,preferenceKey='default',busy}:{projects:CPRow[];communications:CPRow[];tasks:CPRow[];teams:CPRow[];followupMembers?:CPRow[];customerName:(id:string)=>string;memberName:(id:string)=>string;statusFor:(p:CPRow)=>string;onOpen:(id:string)=>void;onAssign?:(id:string)=>void;onEdit?:(id:string)=>void;onProgress?:(id:string)=>void;onTasks?:(id:string)=>void;preferenceKey?:string;busy:boolean}){
 const [agentOpen,setAgentOpen]=useState(false);
 const [filters,setFilters]=useState<ExcelFilters>({});
 const prepared=useMemo(()=>projects.map(project=>{
  const progress=communications.filter(row=>row.projectId===project.id).sort((a,b)=>String(b.occurredAt||b.createdAt||'').localeCompare(String(a.occurredAt||a.createdAt||'')));
  const pending=projectListPendingTasks(tasks,project.id),next=pending[0],latest=progress[0],ownerNames=projectListOwnerNames(pending,memberName);
  const serviceIds:string[]=Array.isArray(project.serviceMemberIds)?project.serviceMemberIds:project.serviceMemberId?[project.serviceMemberId]:[];
  const serviceNames=serviceIds.length?serviceIds.map(memberName):['未配置客服'];
  const values=[customerName(project.customerId),[project.title,project.code].filter(Boolean).join(' '),latest?[date(latest.occurredAt||latest.createdAt),latest.content,latest.createdBy||latest.updatedBy,'· 共 '+progress.length+' 条进展'].filter(Boolean).join(' '):'暂无进展记录',next?.title||'尚未安排下一步',ownerNames.join('、'),next?.dueDate||(next?'未设日期':'—'),teams.find(team=>team.id===project.teamId)?.name||'未分组',statusFor(project),project.salesMemberId?memberName(project.salesMemberId):'未配置业务',serviceNames.join('、'),'记录进展 / 指派待办 / 查看待办 / 历史记录'];
  return {project,progress,latest,ownerNames,serviceNames,values};
 }),[projects,communications,tasks,teams,customerName,memberName,statusFor]);
 const visible=useMemo(()=>prepared.filter(row=>matchesProjectListFilters(row,filters)),[prepared,filters]);
 const setFilter=useCallback((column:number,value:ExcelColumnFilter|null)=>setFilters(previous=>{const next={...previous};if(value===null)delete next[column];else next[column]=Array.isArray(value)?[...new Set(value.map(normalizeExcelValue))]:{...value};return next;}),[]);
 const clearFilters=useCallback(()=>setFilters(previous=>Object.keys(previous).length?{}:previous),[]);
 const filterModel:ExcelFilterModel={rows:visible,total:prepared.length,filters,setFilter,clearFilters,values:column=>projectListFilterValues(prepared,column,followupMembers.map(member=>String(member.name||'')))};
 return <section className="scp-board"><header className="scp-heading"><div><span className="cp-eyebrow">PROJECT WORKSPACE</span><h2>项目清单</h2><p>{projects.length} 个项目 · 点击表头箭头筛选，直接记录进展、指派待办，点击项目名称修改资料</p><p>项目业务、客服负责人负责项目；事项跟进人来自全部未完成事项。下一步事项和日期显示最早待办。</p></div><Button variant="outline" onClick={()=>setAgentOpen(v=>!v)} aria-expanded={agentOpen}>本组 Agent · 待接入</Button></header>{agentOpen&&<section className="scp-agent" aria-label="本组 Agent 与待确认建议"><h3>本组 Agent</h3><p>入口已预留，消息渠道尚未接入，暂未生成建议。</p><div className="scp-agent-flow">多平台消息 → 识别客户与项目 → 自动建档 / 追加日期进展 → 指定跟进人 → 我的待办</div><p>待确认建议将显示：所属客户、项目、原消息依据、建议行动、负责部门、跟进人及期限。后续接通后，归属明确的消息可按授权规则自动建立无编号客户、项目和跟进记录；归属不清或疑似重复时进入待确认。</p></section>}<CustomerProjectTableScroll storageKey={'customer-project-list:'+preferenceKey} label="项目清单" frozenColumns={2} defaultWidths={[110,220,300,220,140,120,90,150,120,160,160]}><CPTable headers={['客户','项目','最新记录 / 日期与进展','下一步事项','事项跟进人','截止日期','所属组','开发阶段','业务负责人','客服负责人','操作']} filterModel={filterModel} rows={visible.map(({project:p,progress,latest,ownerNames,values})=>{
 return [values[0],<div className="scp-project-cell"><button className="scp-project-link" aria-label={'修改项目 · '+p.title} disabled={busy||!p.canWrite} onClick={()=>onEdit?.(p.id)}><b>{p.title}</b><small>{p.code}</small></button><span className="cp-sub">业务：{values[8]}<br/>客服：{values[9]}</span></div>,latest?<div className="scp-progress"><time>{date(latest.occurredAt||latest.createdAt)}</time><p>{latest.content}</p><small>{latest.createdBy||latest.updatedBy} · 共 {progress.length} 条进展</small></div>:<span className="cp-muted">暂无进展记录</span>,values[3],ownerNames.join('、'),values[5],values[6],values[7],values[8],values[9],<div className="cp-row-actions"><Button size="sm" variant="outline" disabled={busy||!p.canWrite} onClick={()=>onProgress?.(p.id)}>记录进展</Button>{onAssign&&<Button size="sm" disabled={busy||!p.canAssignCollaboration} onClick={()=>onAssign(p.id)}>指派待办</Button>}<div className="scp-secondary-actions"><button className="scp-record-link" disabled={busy} onClick={()=>onTasks?.(p.id)}>查看待办</button><button className="scp-record-link" disabled={busy} onClick={()=>onOpen(p.id)}>历史记录</button></div>{onAssign&&!p.canAssignCollaboration&&<small className="cp-muted">{p.assignmentDisabledReason||'仅项目业务、客服负责人或管理员可指派'}</small>}</div>];
 })} empty="当前客户暂无项目。"/></CustomerProjectTableScroll></section>;
}
