'use client';
import {createContext,useContext,type ReactNode} from 'react';

export type BusinessTeam={id:string;name:string;active:boolean;customerIds:string[];leaderIds:string[];salesMemberIds:string[];serviceMemberIds:string[]};
export type BusinessTeamCatalog={teams:BusinessTeam[];members:{id:string;name:string}[];customers?:{id:string;customer:string;customerCode:string}[]};
type TeamScope={teamId:string;changeTeam:(id:string)=>void;catalog?:BusinessTeamCatalog};
const Context=createContext<TeamScope|null>(null);
export const useBusinessTeamScope=()=>useContext(Context);
export function BusinessTeamProvider({value,children}:{value:TeamScope;children:ReactNode}){return <Context.Provider value={value}>{children}</Context.Provider>;}

export function BusinessTeamBar({teamId,changeTeam,catalog,loading,error,onRetry,disabled}:{teamId:string;changeTeam:(id:string)=>void;catalog?:BusinessTeamCatalog;loading:boolean;error:boolean;onRetry:()=>void;disabled:boolean}){
 const name=(ids:string[])=>(ids||[]).map(id=>catalog?.members.find(member=>member.id===id)?.name||'待核对').join('、')||'待配置';
 const selected=catalog?.teams.find(team=>team.id===teamId);
 return <section className="business-team-bar" aria-label="统一业务客服分组">
  <div className="business-team-scope"><div><b>业务与客服组织</b><span>各工作空间共用同一组关系</span></div><label>当前工作组<select aria-label="统一工作组" value={teamId} disabled={disabled||loading} onChange={event=>changeTeam(event.target.value)}><option value="">全部授权组</option><option value="__ungrouped">未分组 / 待关联</option>{catalog?.teams.map(team=><option key={team.id} value={team.id}>{team.name}{team.active?'':'（已停用）'}</option>)}{teamId&&teamId!=='__ungrouped'&&!selected&&<option value={teamId}>原选择组暂不可用</option>}</select></label></div>
  {error?<p role="alert">组关系读取失败。<button type="button" onClick={onRetry}>重新读取</button></p>:loading?<p>正在读取统一组关系…</p>:<div className="business-team-roster">{(selected?[selected]:teamId==='__ungrouped'?[]:catalog?.teams||[]).map(team=><div key={team.id}><b>{team.name}{team.active?'':'（已停用）'}</b><span>业务：{name(team.salesMemberIds)}</span><span>客服：{name(team.serviceMemberIds)}</span></div>)}{teamId==='__ungrouped'&&<p>显示尚未归入组或客户关联待核对的记录。</p>}{!catalog?.teams.length&&<p>当前授权范围暂无已配置的业务客服组。</p>}</div>}
 </section>;
}
