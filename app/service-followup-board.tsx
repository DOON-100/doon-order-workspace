'use client';

import {useEffect,useId,useRef,useState} from 'react';
import {Activity,ArrowRight,CalendarDays,CheckCircle2,ChevronDown,Clock3,Download,FileText,History,MessageSquare,MinusCircle,Pencil,RefreshCw,Users,X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {dateTime,request} from './ui';
import './service-followup-board.css';

type Row={id:string;version:number;type:string;customerId:string;title:string;description:string;status:string;waitingFor:string;nextFollowUp:string;dueDate:string;teamId?:string;ownerId?:string;serviceReviewerId?:string;salesReviewerId?:string;orderId?:string;details:Record<string,string|number>;createdAt:string;updatedAt:string;updatedBy:string};
type Revision={id:string;recordId:string;customerId:string;version:number;action:string;actor:string;createdAt:string;snapshot:Row};
type Attachment={id:string;recordId:string;filename:string;originalName?:string;note?:string;category?:string;contentType?:string;createdAt:string;size?:number};
const statuses:Record<string,string>={open:'进行中',done:'已完成',cancelled:'已取消'};
const waiting:Record<string,string>={none:'客服处理中',customer:'等待客户',factory:'等待工厂',jennifer:'等待业务'};
const types:Record<string,string>={customer_profile:'客户联系档案',followup:'日常跟进',project:'新款 / 项目',sample:'样办 / 确认',shipment:'出货 / 单据',receivable:'应收 / 核销'};
const fields:Record<string,string>={contactPerson:'联系人',email:'联系邮箱',phone:'联系电话',address:'联系地址',category:'跟进类别',model:'客户款号',drawing:'图纸编号',stage:'项目阶段',sampleType:'样办类型',approvalCustomer:'客批确认',approvalColor:'颜色确认',approvalEngraving:'字印确认',approvalAccessory:'配件确认',trackingNo:'快递 / 运单号',invoiceNo:'发票号',quantity:'出货数量',shipDate:'出货日期',carrier:'承运商',packingNote:'装箱说明',terms:'付款条款'};
const approvals:Record<string,string>={pending:'待确认',approved:'已确认',rejected:'需修改',not_required:'不适用'};
const time=(value:string)=>value&&Number.isFinite(Date.parse(value))?dateTime(value):'时间未登记';
const day=(value:string)=>value||'未安排';
function StatusIcon({status}:{status:string}){return status==='done'?<CheckCircle2/>:status==='cancelled'?<MinusCircle/>:<Clock3/>;}
function changes(current:Row,previous?:Row){
 if(!previous)return [];
 return [
  current.status!==previous.status?'状态：'+(statuses[previous.status]||previous.status)+' → '+(statuses[current.status]||current.status):'',
  current.waitingFor!==previous.waitingFor?'等待：'+(waiting[previous.waitingFor]||'未登记')+' → '+(waiting[current.waitingFor]||'未登记'):'',
  current.nextFollowUp!==previous.nextFollowUp?'下次跟进：'+day(previous.nextFollowUp)+' → '+day(current.nextFollowUp):'',
  current.dueDate!==previous.dueDate?'完成期限已调整':'',
  current.ownerId!==previous.ownerId?'客服跟进人已调整':'',
 ].filter(Boolean);
}

export function ServiceFollowupBoard({record,customerLabel,teamLabel,orderLabel,memberName,attachments,canEdit,busy,onClose,onEdit,onRefresh}:{record:Row;customerLabel:string;teamLabel:string;orderLabel:string;memberName:(id?:string)=>string;attachments:Attachment[];canEdit:boolean;busy:boolean;onClose:()=>void;onEdit:()=>void;onRefresh:(signal:AbortSignal)=>Promise<void>}){
 const dialog=useRef<HTMLDialogElement>(null),refreshController=useRef<AbortController|null>(null),heading=useId();
 useEffect(()=>()=>{refreshController.current?.abort();},[]);
 const [history,setHistory]=useState<Revision[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
 useEffect(()=>{const node=dialog.current;if(node&&!node.open)node.showModal();return()=>{if(node?.open)node.close();};},[]);
 useEffect(()=>{
  const controller=new AbortController();let active=true,timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;controller.abort();},20000);setLoading(true);setError('');
  void request('service-history?id='+encodeURIComponent(record.id),undefined,{signal:controller.signal}).then(result=>{
   const rows=result.history;
   if(!Array.isArray(rows)||rows.some((row:Revision)=>row.recordId!==record.id||row.customerId!==record.customerId||!row.snapshot||row.snapshot.id!==record.id||row.snapshot.customerId!==record.customerId||row.snapshot.type!==record.type||!Number.isSafeInteger(row.version)||row.version<1||row.snapshot.version!==row.version))throw new Error('跟进历史无法核对，请刷新后重试。');
   if(active)setHistory(rows.slice().sort((a:Revision,b:Revision)=>b.version-a.version));
  }).catch(e=>{if(active&&(!controller.signal.aborted||timedOut)){setHistory([]);setError(timedOut?'读取跟进历史超时，请重试。':(e as Error).message);}}).finally(()=>{clearTimeout(timer);if(active)setLoading(false);});
  return()=>{active=false;clearTimeout(timer);controller.abort();};
 },[record.id,record.customerId,record.type,record.version,refresh]);
 const refreshBoard=async()=>{
  const controller=new AbortController();refreshController.current=controller;setLoading(true);setError('');
  try{await onRefresh(controller.signal);if(!controller.signal.aborted)setRefresh(v=>v+1);}
  catch(e){if(!controller.signal.aborted){setError((e as Error).message);setLoading(false);}}
  finally{if(refreshController.current===controller)refreshController.current=null;}
 };
 const ready=!loading&&!error,latest=history[0]?.snapshot;
 const current=latest&&latest.version>record.version?latest:record;
 const chronological=history.slice().reverse();
 const states=chronological.filter((row,i)=>!i||row.snapshot.status!==chronological[i-1].snapshot.status||row.snapshot.waitingFor!==chronological[i-1].snapshot.waitingFor).map(row=>({key:row.id,status:row.snapshot.status,waitingFor:row.snapshot.waitingFor,at:row.createdAt,version:row.version}));
 if(!states.length||states.at(-1)!.status!==current.status||states.at(-1)!.waitingFor!==current.waitingFor)states.push({key:'current',status:current.status,waitingFor:current.waitingFor,at:current.updatedAt,version:current.version});
 const trail=states.slice(-5),today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}),late=current.status==='open'&&!!current.nextFollowUp&&current.nextFollowUp<today;
 const files=attachments.filter(file=>file.recordId===record.id);
 const details=Object.entries(fields).filter(([key])=>current.details?.[key]!==undefined&&current.details[key]!=='');
 return <dialog className="sfb-dialog" ref={dialog} aria-labelledby={heading} onCancel={event=>{event.preventDefault();onClose();}} onClick={event=>{if(event.target===event.currentTarget)onClose();}}>
  <div className="sfb-shell">
   <header className="sfb-header"><div className="sfb-heading"><span className="sfb-eyebrow"><Activity size={14}/>跟进进度看板<span>只读查看</span></span><h2 id={heading}>{ready?current.title:'跟进详情'}</h2>{ready&&<p>{customerLabel}<span>·</span>{types[current.type]||current.type}<span>·</span>{teamLabel}</p>}</div><div className="sfb-header-actions"><Button variant="outline" disabled={!ready||busy} onClick={()=>void refreshBoard()} aria-label="刷新跟进详情"><RefreshCw size={15}/></Button>{canEdit&&ready&&<Button disabled={busy} onClick={onEdit}><Pencil size={15}/>{busy?'正在读取最新资料…':'编辑跟进'}</Button>}<Button variant="ghost" aria-label="关闭跟进看板" onClick={onClose}><X size={20}/></Button></div></header>
   <div className="sfb-body">
    {loading?<div className="sfb-loading" role="status"><div className="sfb-skeleton-cards">{[0,1,2,3].map(n=><i key={n}/>)}</div><div className="sfb-skeleton-line"/><p>正在读取跟进进度与历史…</p></div>:error?<div className="sfb-error" role="alert"><FileText size={32}/><h3>暂时无法查看详情</h3><p>{error}</p><Button variant="outline" onClick={()=>void refreshBoard()}>重试读取</Button></div>:<>
     <section className="sfb-metrics" aria-label="跟进进度概览">
      <article className={'sfb-metric state '+current.status}><div className="sfb-metric-icon"><StatusIcon status={current.status}/></div><div><span>当前状态</span><strong>{statuses[current.status]||current.status}</strong><small>当前版本 V{current.version}</small></div></article>
      <article className="sfb-metric"><div className="sfb-metric-icon"><Users/></div><div><span>当前等待</span><strong>{waiting[current.waitingFor]||'未登记'}</strong><small>{memberName(current.ownerId)}</small></div></article>
      <article className={'sfb-metric'+(late?' overdue':'')}><div className="sfb-metric-icon"><CalendarDays/></div><div><span>下次跟进</span><strong>{day(current.nextFollowUp)}</strong><small>{late?'已过跟进日，需要推进':current.dueDate?'完成期限 '+current.dueDate:'完成期限未安排'}</small></div></article>
      <article className="sfb-metric"><div className="sfb-metric-icon"><History/></div><div><span>历史留存</span><strong>{history.length}<em>次记录</em></strong><small>每次更新均可展开查看</small></div></article>
     </section>
     <div className="sfb-columns"><div className="sfb-overview">
      <section className="sfb-card"><div className="sfb-section-heading"><h3><Activity size={17}/>状态与等待变化</h3><span>{states.length>5?'最近 5 个节点':'按实际记录展示'}</span></div><ol className="sfb-progress">{trail.map((step,i)=><li className={step.status+(i===trail.length-1?' current':'')} key={step.key}><div className="sfb-progress-dot"><StatusIcon status={step.status}/></div><strong>{statuses[step.status]||step.status}</strong><span>{waiting[step.waitingFor]||'未登记'}</span><small>{time(step.at)}</small>{i===trail.length-1&&<b>当前</b>}</li>)}</ol></section>
      <section className="sfb-card"><div className="sfb-section-heading"><h3><MessageSquare size={17}/>当前跟进与下一步</h3><span>{current.updatedBy||'更新人未登记'}</span></div><p className="sfb-description">{current.description||'暂未填写跟进说明，可进入编辑补充。'}</p><div className="sfb-assignees">{[['客服跟进',current.ownerId],['客服审核',current.serviceReviewerId],['业务审核',current.salesReviewerId]].map(([label,id])=><div key={label}><span>{label}</span><strong>{memberName(id)}</strong></div>)}</div>{orderLabel&&<div className="sfb-order"><FileText size={15}/><span>关联订单</span><strong>{orderLabel}</strong></div>}</section>
      {(details.length>0||current.type==='receivable')&&<section className="sfb-card"><div className="sfb-section-heading"><h3><FileText size={17}/>业务资料</h3></div><dl className="sfb-facts">{current.type==='receivable'&&<div><dt>应收金额</dt><dd>{Number.isSafeInteger(current.details.amountCents)?String(current.details.currency||'USD')+' '+(Number(current.details.amountCents)/100).toFixed(2):'金额待确认'}</dd></div>}{details.map(([key,label])=><div key={key}><dt>{label}</dt><dd>{key.startsWith('approval')?approvals[String(current.details[key])]||String(current.details[key]):String(current.details[key])}</dd></div>)}</dl></section>}
      <section className="sfb-card"><div className="sfb-section-heading"><h3><FileText size={17}/>附件与参考图片</h3><span>{files.length} 份</span></div>{files.length?<div className="sfb-files">{files.map(file=><a key={file.id} href={'/api/workspace/service-file?id='+encodeURIComponent(file.id)} target="_blank" rel="noreferrer" className="sfb-file">{file.category==='reference-image'&&/^image\/(png|jpeg|gif|webp)$/.test(file.contentType||'')?<img src={'/api/workspace/service-file?id='+encodeURIComponent(file.id)+'&preview=1'} alt={file.note||file.filename} loading="lazy"/>:<div className="sfb-file-icon"><FileText size={23}/></div>}<span><strong>{file.filename||file.originalName||'资料附件'}</strong><small>{file.note||time(file.createdAt)}</small></span><Download size={15}/></a>)}</div>:<p className="sfb-empty">暂未上传附件</p>}</section>
     </div><section className="sfb-card sfb-history"><div className="sfb-section-heading"><h3><History size={17}/>历次跟进记录</h3><span>最新在前</span></div>{history.length?<ol className="sfb-timeline">{history.map((row,i)=>{const previous=history[i+1]?.snapshot,diff=changes(row.snapshot,previous);return <li key={row.id}><i className={'sfb-history-dot '+row.snapshot.status}/><details open={i===0}><summary><div><span className="sfb-version">V{row.version}</span><strong>{row.action||'跟进更新'}</strong>{i===0&&<b className="sfb-latest">最新</b>}<small>{time(row.createdAt)} · {row.actor||'更新人未登记'}</small></div><ChevronDown size={16}/></summary><div className="sfb-history-content"><div className="sfb-history-state"><span className={'sfb-status '+row.snapshot.status}>{statuses[row.snapshot.status]||row.snapshot.status}</span><span>{waiting[row.snapshot.waitingFor]||'未登记'}</span></div>{diff.length>0&&<div className="sfb-changes">{diff.map(item=><span key={item}><ArrowRight size={12}/>{item}</span>)}</div>}<p>{row.snapshot.description||'本次未填写跟进说明'}</p><div className="sfb-history-dates"><span>下次跟进 <b>{day(row.snapshot.nextFollowUp)}</b></span><span>完成期限 <b>{day(row.snapshot.dueDate)}</b></span></div></div></details></li>;})}</ol>:<div className="sfb-no-history"><History size={28}/><strong>暂无留存的修改记录</strong><p>当前资料仍可查看，后续保存将沿用原有历史留存。</p></div>}</section></div>
    </>}
   </div><footer className="sfb-footer"><span><History size={13}/>查看进展与历史不会修改原记录</span><Button variant="outline" onClick={onClose}>返回列表</Button></footer>
  </div>
 </dialog>;
}
