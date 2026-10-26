'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import type {Member} from '@/lib/domain';
import {businessTeamFetch} from './business-team-client';
import {Input,dateTime} from './ui';

type Mailbox={memberId:string;name?:string;active?:boolean;email:string;version:number;confirmed:boolean;updatedAt?:string;updatedBy?:string};
type Draft={email:string;version:number};
class MailboxError extends Error{constructor(message:string,readonly status:number){super(message);}}
async function mailboxRequest(action:string,body?:unknown){
 const response=await businessTeamFetch('/api/workspace/'+action,{method:body===undefined?'GET':'POST',cache:'no-store',headers:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 const result:any=await response.json().catch(()=>null);
 if(!response.ok)throw new MailboxError(result?.error||'流程通知邮箱操作未完成，请重试。',response.status);
 if(!result)throw new Error('服务器未返回完整邮箱信息，请重新读取。');
 return result;
}
function emailProblem(value:string){
 const email=value.trim();
 if(!email)return '';
 if(email.length>254||! /^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(email))return '请输入完整有效的邮箱地址，或留空表示未配置。';
 if(/(?:^|[.@])(?:localhost|local|invalid|test|example)$/i.test(email))return '请填写真实收件邮箱；本地登录标识不能用于流程邮件。';
 return '';
}

/** Notification addresses are maintained independently of login accounts. */
export function useMemberNotificationMailboxes({me,members,busy,onDirtyChange}:{me:Member;members:Member[];busy:boolean;onDirtyChange?:(dirty:boolean)=>void}){
 const [rows,setRows]=useState<Mailbox[]>([]),[drafts,setDrafts]=useState<Record<string,Draft>>({}),[errors,setErrors]=useState<Record<string,string>>({}),[notices,setNotices]=useState<Record<string,string>>({});
 const [loaded,setLoaded]=useState(false),[loading,setLoading]=useState(false),[saving,setSaving]=useState(''),[error,setError]=useState(''),[allowed,setAllowed]=useState(false);
 const epoch=useRef(0),readSequence=useRef(0),actor=useRef('');
 const isAdmin=me.active&&me.role==='admin',actorKey=me.id+':'+String(isAdmin);actor.current=actorKey;
 const memberKeys=members.filter(m=>m.role!=='supplier').map(m=>m.id).sort().join('|');
 const clearPrivate=useCallback(()=>{setRows([]);setDrafts({});setErrors({});setNotices({});setAllowed(false);setLoaded(false);},[]);
 const load=useCallback(async()=>{
  if(!isAdmin)return;
  const generation=epoch.current,request=++readSequence.current,requestActor=actor.current;
  setLoading(true);setError('');
  try{
   const result=await mailboxRequest('member-notification-mailboxes');
   if(generation!==epoch.current||request!==readSequence.current||requestActor!==actor.current)return;
   setRows(result.mailboxes||[]);setAllowed(result.canConfigure===true);setLoaded(true);
  }catch(cause){
   if(generation!==epoch.current||request!==readSequence.current||requestActor!==actor.current)return;
   if(cause instanceof MailboxError&&[401,403].includes(cause.status))clearPrivate();
   setError((cause as Error).message||'邮箱列表读取失败，输入已保留。');
  }finally{if(generation===epoch.current&&request===readSequence.current)setLoading(false);}
 },[isAdmin,clearPrivate]);
 useEffect(()=>{epoch.current++;readSequence.current++;clearPrivate();setError('');setSaving('');setLoading(false);return()=>{epoch.current++;readSequence.current++;};},[actorKey,clearPrivate]);
 useEffect(()=>{void load();},[actorKey,memberKeys,load]);
 useEffect(()=>{const ids=new Set(memberKeys.split('|'));setDrafts(current=>Object.fromEntries(Object.entries(current).filter(([id])=>ids.has(id))));},[memberKeys]);
 const dirty=isAdmin&&(!!saving||Object.keys(drafts).length>0);
 useEffect(()=>{onDirtyChange?.(dirty);},[dirty,onDirtyChange]);
 useEffect(()=>()=>onDirtyChange?.(false),[onDirtyChange]);
 useEffect(()=>{if(!dirty)return;const guard=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard);},[dirty]);
 const change=(memberId:string,value:string)=>{
  const stored=rows.find(row=>row.memberId===memberId);if(!stored)return;
  setDrafts(current=>{const next={...current};if(value===stored.email)delete next[memberId];else next[memberId]={email:value,version:current[memberId]?.version??stored.version};return next;});
  setErrors(current=>({...current,[memberId]:''}));setNotices(current=>({...current,[memberId]:''}));
 };
 const discard=(memberId:string)=>{setDrafts(current=>{const next={...current};delete next[memberId];return next;});setErrors(current=>({...current,[memberId]:''}));};
 const save=async(memberId:string)=>{
  const draft=drafts[memberId],stored=rows.find(row=>row.memberId===memberId);if(!isAdmin||!allowed||!draft||!stored||saving||busy||loading)return;
  const invalid=emailProblem(draft.email);if(invalid){setErrors(current=>({...current,[memberId]:invalid}));return;}
  if(draft.version!==stored.version){setErrors(current=>({...current,[memberId]:'此人的邮箱已被更新，请核对当前已存邮箱后重新编辑。'}));return;}
  const generation=epoch.current,requestActor=actor.current;setSaving(memberId);setErrors(current=>({...current,[memberId]:''}));setNotices(current=>({...current,[memberId]:''}));
  try{
   const result=await mailboxRequest('member-notification-mailbox',{memberId,email:draft.email.trim(),expectedVersion:draft.version,confirmed:true});
   if(generation!==epoch.current||requestActor!==actor.current)return;
   readSequence.current++;setLoading(false);
   setRows(current=>current.map(row=>row.memberId===memberId?{...row,...result.mailbox}:row));
   setDrafts(current=>{const next={...current};delete next[memberId];return next;});
   setNotices(current=>({...current,[memberId]:result.mailbox.email?'流程通知邮箱已保存。':'邮箱已清空，暂不接收流程邮件。'}));
  }catch(cause){
   if(generation!==epoch.current||requestActor!==actor.current)return;
   if(cause instanceof MailboxError&&[401,403].includes(cause.status)){clearPrivate();setError(cause.message);}
   else{setErrors(current=>({...current,[memberId]:(cause as Error).message||'保存未完成，输入已保留。'}));if(cause instanceof MailboxError&&cause.status===409)await load();}
  }finally{if(generation===epoch.current&&requestActor===actor.current)setSaving('');}
 };
 const renderCell=(member:Member)=>{
  if(member.role==='supplier')return <span className="subline">不参与内部流程邮件</span>;
  if(!isAdmin)return <span className="subline">由管理员维护</span>;
  const stored=rows.find(row=>row.memberId===member.id),draft=drafts[member.id],value=draft?.email??stored?.email??'',invalid=emailProblem(value),conflict=!!draft&&!!stored&&draft.version!==stored.version;
  const locked=busy||loading||!!saving||!loaded||!allowed||!stored;
  return <div className="min-w-64 max-w-sm space-y-2" data-member-notification-mailbox={member.id}>
   <Input type="email" autoComplete="off" aria-label={member.name+'流程通知邮箱'} aria-invalid={!!invalid||!!errors[member.id]} placeholder={loading&&!loaded?'正在读取…':'未配置，可留空'} maxLength={254} value={value} disabled={locked} onChange={event=>change(member.id,event.target.value)}/>
   {allowed&&stored&&<div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" disabled={locked||!draft||!!invalid||conflict} onClick={()=>void save(member.id)}>{saving===member.id?'正在保存…':!value.trim()&&stored.email?'清空邮箱':'保存邮箱'}</Button>{draft&&<Button type="button" variant="ghost" size="sm" disabled={locked} onClick={()=>discard(member.id)}>放弃修改</Button>}</div>}
   {conflict&&<p className="error text-xs" role="alert">当前已存邮箱：{stored?.email||'未配置'}。请放弃旧草稿后，依据最新记录重新编辑。</p>}
   {(invalid||errors[member.id])&&<p className="error text-xs" role="alert">{invalid||errors[member.id]}</p>}
   {notices[member.id]&&<p className="success text-xs" role="status">{notices[member.id]}</p>}
   {!member.active&&<small className="subline">账号已停用，配置邮箱不会恢复账号或发送通知。</small>}
   {stored?.updatedAt&&<small className="subline">{dateTime(stored.updatedAt)} · {stored.updatedBy||'管理员'}</small>}
  </div>;
 };
 const status=isAdmin?<div className="section-pad border-b"><div className="flex flex-wrap items-center justify-between gap-3"><p className="note">流程通知邮箱用于报价复核等内部邮件；留空为未配置。保存邮箱不会修改登录账号、密码、角色或客户范围。</p><Button type="button" variant="outline" size="sm" disabled={loading||!!saving||busy} onClick={()=>void load()}>刷新通知邮箱</Button></div>{error&&<p className="error mt-2" role="alert">{error}</p>}</div>:null;
 return {renderCell,status};
}
