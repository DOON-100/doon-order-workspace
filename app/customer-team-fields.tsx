'use client';
import type {CustomerAccount,Member} from '@/lib/domain';

export const teamKeys=['salesMemberIds','serviceMemberIds','quoteMemberIds'] as const;
type TeamKey=typeof teamKeys[number];
export type CustomerTeamDraft=Omit<Partial<CustomerAccount>,TeamKey>&Partial<Record<TeamKey,string[]|null>>;
const labels:Record<TeamKey,string>={salesMemberIds:'业务协作成员',serviceMemberIds:'客服协作成员',quoteMemberIds:'报价授权成员'};

export function customerTeamPayload(edit:CustomerTeamDraft){
 return Object.fromEntries(teamKeys.filter(key=>Object.prototype.hasOwnProperty.call(edit,key)).map(key=>[key,edit[key]]));
}

export function CustomerTeamFields({edit,members,onChange,disabled}:{edit:CustomerTeamDraft;members:Member[];onChange:(next:CustomerTeamDraft)=>void;disabled:boolean}){
 const candidates=members.filter(m=>m.active&&m.role!=='admin');
 return <fieldset disabled={disabled} className="col-span-full rounded-lg border p-4 space-y-3">
  <legend className="px-2 font-medium">客户协作授权</legend>
  <p className="text-sm text-slate-600">仅管理员确认。管理员保留全局管理权限；协作成员仍用各自账号，操作分别留痕。此处不会授予 PMC 排期或结单权限。</p>
  <div className="grid gap-4 md:grid-cols-3">{teamKeys.map(key=>{
   const ids=edit[key],explicit=Array.isArray(ids);
   return <section key={key} className="rounded-md border p-3 space-y-2">
    <label className="flex items-center gap-2 font-medium"><input type="checkbox" aria-label={`为${labels[key]}指定名单`} checked={explicit} onChange={e=>onChange({...edit,[key]:e.target.checked?[]:null})}/>{labels[key]}</label>
    <p className="text-xs text-slate-600">{explicit?(ids.length?'仅下列勾选成员获本客户权限。':'当前名单为空：无人获此项客户权限。'):'未指定名单：沿用已确认的责任人匹配规则。'}</p>
    {explicit&&<div className="max-h-48 overflow-y-auto space-y-1">{candidates.map(member=><label key={member.id} className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label={`${labels[key]}：${member.name}`} checked={ids.includes(member.id)} onChange={e=>onChange({...edit,[key]:e.target.checked?[...ids,member.id]:ids.filter(id=>id!==member.id)})}/>{member.name}</label>)}{ids.filter(id=>!candidates.some(m=>m.id===id)).map(id=><p key={id} className="text-xs text-amber-700">已停用或不可选成员：{members.find(m=>m.id===id)?.name||'未知成员'}；请重新核对名单。</p>)}</div>}
   </section>;
  })}</div>
  <p className="text-xs text-slate-600">跟进、样办、出货和应收向本客户业务与客服成员共享。报价还须具备账号级报价权限，内部核价资料按原权限控制。</p>
 </fieldset>;
}
