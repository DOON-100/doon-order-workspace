'use client';
import {businessTeamFetch} from './business-team-client';
import {useEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {MessageSquareText,Plus,Save,History,ShieldCheck} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input,dateTime} from './ui';
import type {Data} from './workspace';
import type {Communication} from '@/lib/unified-communication';
import './upgrade-workspace.css';

type Item=Communication&{canWrite:boolean;canSubmit:boolean;canReturn:boolean;canCompleteReview:boolean};
type Payload={customerId:string;projectId:string;orderId:string;channel:Communication['channel'];title:string;sourceText:string;sourceReference:string;occurredAt:string;draftText:string;internalNote:string};
type Feed={items:Item[];customers:{id:string;customer:string;customerCode:string;canWrite:boolean}[];projects:{id:string;customerId:string;title:string;code:string;canWrite:boolean}[];orders:{id:string;customerId:string;orderNo:string;drawing:string}[]};
type Action='save'|'submit'|'return'|'complete-review';
type PendingOperation={action:Action;body:Record<string,unknown>;token:string;uncertain:boolean};
type Revision={id:string;version:number;action:string;createdAt:string;actor:string;snapshot:Communication};
type Review={id:string;action:'submit'|'return'|'complete-review';createdAt:string;comment:string};
type InitialContext={recordId?:string;customerId?:string;projectId?:string;orderId?:string;tab?:string};
const blank=():Payload=>({customerId:'',projectId:'',orderId:'',channel:'other',title:'',sourceText:'',sourceReference:'',occurredAt:'',draftText:'',internalNote:''});
const fields=(item:Item):Payload=>Object.fromEntries(Object.keys(blank()).map(key=>[key,item[key]])) as Payload;
const channels={email:'邮件',whatsapp:'WhatsApp',wechat:'微信',phone:'电话',meeting:'会议',other:'其他'};
const statusLabel={draft:'草稿',pending_check:'待人工核对',returned:'已退回补充',checked:'内部核对完成'};
function uuid(){const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;return [...b].map((n,i)=>([4,6,8,10].includes(i)?'-':'')+n.toString(16).padStart(2,'0')).join('');}
class CommunicationRequestError extends Error{constructor(message:string,public status=0,public definitive=false){super(message);}}
async function communicationRequest(action:string,body?:unknown,signal?:AbortSignal){
 let response:Response;
 try{response=await businessTeamFetch('/api/workspace/unified-communication-'+action,{method:body===undefined?'GET':'POST',headers:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal});}
 catch{throw new CommunicationRequestError('连接公司主机失败，请检查内网连接。');}
 let result:any;try{result=await response.json();}catch{throw new CommunicationRequestError('服务器未返回完整结果。',response.status);}
 if(!response.ok)throw new CommunicationRequestError(result.error||'操作未完成，请重新核对。',response.status,response.status<500);
 return result;
}
const revisionLabel=(action:string)=>({save:'保存',submit:'提交待核对',return:'退回补充','complete-review':'内部核对完成'}[action.replace('unified-communication-','')]||'历史变更');
export function UnifiedCommunicationPanel({data,onDirtyChange,initialContext}:{data:Data;onDirtyChange?:(dirty:boolean)=>void;initialContext?:InitialContext}){
 const cache=useQueryClient(),[selected,setSelected]=useState<Item|null>(null),[form,setForm]=useState<Payload>(blank),[saved,setSaved]=useState(JSON.stringify(blank())),[search,setSearch]=useState(''),[filter,setFilter]=useState(''),[notice,setNotice]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[showHistory,setShowHistory]=useState(false),[reviewNote,setReviewNote]=useState(''),[pending,setPending]=useState<PendingOperation|null>(null);
 const [contextFilter,setContextFilter]=useState<InitialContext>({}),appliedContext=useRef('');
 const busyRef=useRef(false),seenRevision=useRef(data.revision),formDirty=JSON.stringify(form)!==saved,dirty=formDirty||!!reviewNote||!!pending||busy,queryKey=['unified-communication',data.me.id,data.revision];
 const query=useQuery<Feed>({queryKey,queryFn:({signal})=>communicationRequest('data',undefined,signal)});
 const feed=query.isError?undefined:query.data,customers=feed?.customers||[],customer=customers.find(c=>c.id===form.customerId),latest=feed?.items.find(i=>i.id===selected?.id),unavailable=!!selected&&!!feed&&!latest,canEdit=!!feed&&(selected?!!latest?.canWrite:!form.customerId||!!customer?.canWrite),stale=!!selected&&!!latest&&latest.version!==selected.version;
 const history=useQuery<{revisions:Revision[];reviews:Review[]}>({queryKey:['unified-communication-history',data.me.id,selected?.id,latest?.version],enabled:!!selected&&!!latest&&showHistory,queryFn:({signal})=>communicationRequest('history?id='+encodeURIComponent(selected!.id),undefined,signal)});
 useEffect(()=>{if(seenRevision.current!==data.revision){seenRevision.current=data.revision;void cache.invalidateQueries({queryKey:['unified-communication',data.me.id]});}},[data.revision,data.me.id,cache]);
 useEffect(()=>{onDirtyChange?.(dirty);},[dirty,onDirtyChange]);
 useEffect(()=>()=>onDirtyChange?.(false),[onDirtyChange]);
 useEffect(()=>{const block=(e:BeforeUnloadEvent)=>{if(dirty){e.preventDefault();e.returnValue='';}};addEventListener('beforeunload',block);return()=>removeEventListener('beforeunload',block);},[dirty]);
 function select(item:Item|null){if(dirty){setError('有未保存内容，请先保存或点击“放弃本次编辑”。');return;}const value=item?fields(item):blank();setSelected(item);setForm(value);setSaved(JSON.stringify(value));setError('');setNotice('');setReviewNote('');setShowHistory(false);}
 useEffect(()=>{
  const key=JSON.stringify(initialContext||{});if(!feed||appliedContext.current===key)return;
  if(dirty){setError('有未保存内容，暂未切换至导航指定记录。请先保存或放弃本次编辑。');return;}
  const context=initialContext||{},item=context.recordId?feed.items.find(i=>i.id===context.recordId&&(!context.customerId||i.customerId===context.customerId)&&(!context.projectId||i.projectId===context.projectId)&&(!context.orderId||i.orderId===context.orderId)):undefined;
  const valid=(!context.customerId||feed.customers.some(c=>c.id===context.customerId))&&(!context.projectId||feed.projects.some(p=>p.id===context.projectId&&(!context.customerId||p.customerId===context.customerId)))&&(!context.orderId||feed.orders.some(o=>o.id===context.orderId&&(!context.customerId||o.customerId===context.customerId)))&&(!context.recordId||!!item);
  appliedContext.current=key;setSearch('');setFilter('');setShowHistory(false);setReviewNote('');setSelected(item||null);
  const value=item?fields(item):valid?{...blank(),customerId:context.customerId||'',projectId:context.projectId||'',orderId:context.orderId||''}:blank();setForm(value);setSaved(JSON.stringify(value));setContextFilter(valid?context:{recordId:context.recordId||'unavailable'});setNotice('');setError(valid?'':'导航指定记录或客户不存在，或已不在当前授权范围内。');
 },[initialContext,feed,dirty]);
 function change<K extends keyof Payload>(key:K,value:Payload[K]){setForm(prev=>({...prev,[key]:value,...(key==='customerId'?{projectId:'',orderId:''}:{})}));}
 async function mutate(action:Action,retry?:PendingOperation){
  if(busyRef.current||pending&&!retry)return;
  if(!retry&&(!canEdit||stale||action!=='save'&&(!selected||formDirty)||action==='submit'&&!latest?.canSubmit||action==='return'&&!latest?.canReturn||action==='complete-review'&&!latest?.canCompleteReview))return;
  const operation=retry||{action,body:action==='save'?{...form,...(selected?{id:selected.id,expectedVersion:selected.version}:{})}:{id:selected!.id,expectedVersion:selected!.version,comment:reviewNote},token:uuid(),uncertain:false};
  busyRef.current=true;setBusy(true);setPending(operation);setError('');setNotice('');
  try{
   // Cancel old list reads before writing, so their older response cannot replace the saved version.
   await cache.cancelQueries({queryKey});
   const result=await communicationRequest(action,{...operation.body,token:operation.token});
   if(!result.item?.id||!Number.isInteger(result.item.version))throw new CommunicationRequestError('服务器未返回完整的已保存版本。');
   const item=result.item as Item;
   await cache.cancelQueries({queryKey});
   cache.setQueryData<Feed>(queryKey,previous=>previous?{...previous,items:[previous.items.find(r=>r.id===item.id&&r.version>item.version)||item,...previous.items.filter(r=>r.id!==item.id)]}:previous);
   setSelected(item);const value=fields(item);setForm(value);setSaved(JSON.stringify(value));if(action!=='save')setReviewNote('');setPending(null);
   setNotice((result.idempotent?'已核实原请求，未重复创建记录。':'')+(action==='save'?'沟通记录已保存，版本历史已保留。':action==='submit'?'已标记待人工核对。请由负责销售按现有业务流程核对。':action==='return'?'已退回，并保留原因。':'本版本内部核对已完成；此操作不代表正式报价批准或对外发送。'));
   // A subsequent refresh failure is not a failed mutation and must not invite another save.
   await Promise.allSettled([cache.invalidateQueries({queryKey}),cache.invalidateQueries({queryKey:['unified-communication-history',data.me.id,item.id]}),cache.invalidateQueries({queryKey:['workspace']})]);
  }catch(e){
   const failure=e as CommunicationRequestError,uncertain=!failure.definitive||operation.uncertain&&[401,403].includes(failure.status);
   setPending(uncertain?{...operation,uncertain:true}:null);setError(failure.message);
   if(failure.definitive&&[403,409].includes(failure.status))await Promise.allSettled([cache.invalidateQueries({queryKey})]);
  }finally{busyRef.current=false;setBusy(false);}
 }
 const items=(feed?.items||[]).filter(i=>(!contextFilter.customerId||i.customerId===contextFilter.customerId)&&(!contextFilter.projectId||i.projectId===contextFilter.projectId)&&(!contextFilter.orderId||i.orderId===contextFilter.orderId)&&(!contextFilter.recordId||feed?.items.some(r=>r.id===contextFilter.recordId))&&(!filter||i.status===filter)&&(!search||[i.title,customers.find(c=>c.id===i.customerId)?.customer,i.sourceReference].join(' ').toLocaleLowerCase().includes(search.toLocaleLowerCase())));
 return <div className="upgrade-space"><section className="panel section-pad upgrade-intro"><span className="upgrade-eyebrow">统一沟通</span><h2>客户原文、回复草稿与核对记录</h2><p>手工记录沟通原文，并关联同一客户的项目或订单。保存和修改均保留版本；报价、交期与对客承诺继续按现有流程核对。</p><div className="upgrade-info"><ShieldCheck size={18}/><span>邮件和 WhatsApp 尚未连接。{['admin','programmer'].includes(data.me.role)&&'AI 尚未启用。'}此处只保存内部记录与草稿，没有对外发送或正式报价批准功能。</span></div></section>
 {error&&<div className="error" role="alert">{error}</div>}{notice&&<div className="success" role="status">{notice}</div>}
 {pending&&<div className="upgrade-info" role="status"><span>{busy?'正在确认操作结果，请保留当前页面。':'尚未确认上次操作结果。已保留原内容和请求编号，请重试核实，避免重复新建。'}</span>{!busy&&<Button variant="outline" onClick={()=>mutate(pending.action,pending)}>重试核实原请求</Button>}</div>}
 {query.isError&&!!feed&&<div className="error" role="alert">刷新失败，当前编辑仍保留。{(query.error as Error).message}<Button variant="outline" onClick={()=>query.refetch()}>重新读取</Button></div>}
 {query.isError&&!feed?<section className="panel section-pad"><p role="alert">{(query.error as Error).message}</p><Button variant="outline" onClick={()=>query.refetch()}>重新读取</Button></section>:!feed?<div className="panel section-pad">正在读取获授权的客户沟通…</div>:<div className="upgrade-draft-layout"><section className="panel section-pad"><div className="panel-title"><h3 className="section-title"><MessageSquareText size={18}/> 沟通记录 · {items.length}</h3><Button size="sm" variant="outline" disabled={busy||!!pending||!customers.some(c=>c.canWrite)} onClick={()=>select(null)}><Plus size={16}/>新建</Button></div><Input aria-label="搜索沟通记录" placeholder="搜索客户、标题或来源" value={search} onChange={e=>setSearch(e.target.value)}/><select aria-label="沟通状态筛选" className="upgrade-native-select mt-3 mb-4" value={filter} onChange={e=>setFilter(e.target.value)}><option value="">全部状态</option>{Object.entries(statusLabel).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><div className="upgrade-draft-list">{items.map(item=><button key={item.id} className="upgrade-draft-item" aria-pressed={selected?.id===item.id} disabled={busy||!!pending} onClick={()=>select(item)}><h3>{item.title}</h3><p>{customers.find(c=>c.id===item.customerId)?.customer||'客户'} · {channels[item.channel]}</p><p>{statusLabel[item.status]} · v{item.version} · {dateTime(item.updatedAt)}</p></button>)}{!items.length&&<p className="upgrade-empty">当前筛选下没有沟通记录。</p>}</div></section>
 {unavailable?<section className="panel section-pad"><p role="alert">此记录已不在当前授权范围内，内容与历史已隐藏。</p><Button variant="outline" disabled={busy||!!pending} onClick={()=>{setSelected(null);setForm(blank());setSaved(JSON.stringify(blank()));setReviewNote('');setShowHistory(false);}}>关闭不可读记录</Button></section>:<section className="panel section-pad"><div className="panel-title"><h3 className="section-title">{selected?'沟通详情':'新增沟通'}</h3>{selected&&<span className="pill amber">{statusLabel[selected.status]} · v{selected.version}</span>}</div>{stale&&<div className="error">共享记录已有新版本。请保留需要的内容，再放弃本次编辑并读取最新版本。</div>}{unavailable&&<div className="error">此记录已不在当前可读取范围内；当前内容仅用于保留未完成编辑，不能继续保存或读取历史。</div>}{selected&&!canEdit&&<p className="upgrade-draft-meta">此记录按现有权限仅可查看。</p>}
 <fieldset disabled={busy||!!pending||!canEdit} className="upgrade-draft-fields"><div><label htmlFor="comm-customer">客户 *</label><select id="comm-customer" className="upgrade-native-select" value={form.customerId} disabled={!!selected} onChange={e=>change('customerId',e.target.value)}><option value="">选择统一客户档案</option>{customers.filter(c=>c.canWrite||c.id===form.customerId).map(c=><option key={c.id} value={c.id}>{c.customer}{c.customerCode?' · '+c.customerCode:''}</option>)}</select></div><div><label htmlFor="comm-channel">原始渠道</label><select id="comm-channel" className="upgrade-native-select" value={form.channel} onChange={e=>change('channel',e.target.value as Payload['channel'])}>{Object.entries(channels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></div>
 <div><label htmlFor="comm-project">关联项目（可选）</label><select id="comm-project" className="upgrade-native-select" value={form.projectId} onChange={e=>change('projectId',e.target.value)}><option value="">不关联项目</option>{feed.projects.filter(p=>p.customerId===form.customerId&&(p.canWrite||p.id===form.projectId)).map(p=><option key={p.id} value={p.id}>{p.code} · {p.title}</option>)}</select></div><div><label htmlFor="comm-order">关联订单（可选）</label><select id="comm-order" className="upgrade-native-select" value={form.orderId} onChange={e=>change('orderId',e.target.value)}><option value="">不关联订单</option>{feed.orders.filter(o=>o.customerId===form.customerId).map(o=><option key={o.id+'-'+o.customerId} value={o.id}>{o.orderNo} · {o.drawing}</option>)}</select></div>
 <div className="wide"><label htmlFor="comm-title">沟通标题 *</label><Input id="comm-title" maxLength={300} value={form.title} onChange={e=>change('title',e.target.value)}/></div><div><label htmlFor="comm-date">实际沟通日期（可选）</label><Input id="comm-date" type="date" value={form.occurredAt} onInput={e=>change('occurredAt',e.currentTarget.value)} onChange={e=>change('occurredAt',e.target.value)}/></div><div><label htmlFor="comm-reference">来源说明 / 原记录编号</label><Input id="comm-reference" maxLength={3000} value={form.sourceReference} onChange={e=>change('sourceReference',e.target.value)}/></div>
 <div className="wide"><label htmlFor="comm-source">客户沟通原文</label><textarea id="comm-source" rows={6} maxLength={100000} value={form.sourceText} onChange={e=>change('sourceText',e.target.value)} placeholder="粘贴或手工录入原文，保留事实与原意"/></div><div className="wide"><label htmlFor="comm-draft">回复草稿（仅内部保存）</label><textarea id="comm-draft" rows={7} maxLength={100000} value={form.draftText} onChange={e=>change('draftText',e.target.value)} placeholder="写下待人工核对的回复；不会发送给客户"/></div><div className="wide"><label htmlFor="comm-note">内部备注</label><textarea id="comm-note" rows={3} maxLength={10000} value={form.internalNote} onChange={e=>change('internalNote',e.target.value)}/></div></fieldset>
 <div className="upgrade-draft-toolbar"><Button disabled={busy||!!pending||!canEdit||stale||!form.customerId||!form.title.trim()||(!form.sourceText.trim()&&!form.draftText.trim())||!!selected&&!formDirty} onClick={()=>mutate('save')}><Save size={16}/>{selected?'保存新版本':'保存记录'}</Button>{(formDirty||!!reviewNote)&&<Button variant="outline" disabled={busy||!!pending} onClick={()=>{const value=selected?fields(selected):blank();setForm(value);setSaved(JSON.stringify(value));setReviewNote('');setError('');}}>放弃本次编辑</Button>}{stale&&!dirty&&<Button variant="outline" disabled={busy||!!pending} onClick={()=>select(latest!)}>读取最新版本</Button>}{selected&&<Button variant="outline" disabled={busy} onClick={()=>setShowHistory(v=>!v)}><History size={16}/>{showHistory?'收起历史':'版本与核对历史'}</Button>}</div>
 {selected&&<><p className="upgrade-draft-meta">创建于 {dateTime(selected.createdAt)} · 最后更新 {dateTime(selected.updatedAt)}{selected.requiresRecheck?' · 需要人工核对':''}{dirty?' · 当前有未保存修改':''}</p>{(latest?.canSubmit||latest?.canReturn||latest?.canCompleteReview)&&<div className="upgrade-draft-toolbar"><Input aria-label="核对备注或退回原因" maxLength={6000} disabled={busy||!!pending} value={reviewNote} onChange={e=>setReviewNote(e.target.value)} placeholder={latest?.canReturn?'核对备注（可选）；退回时须填写原因':'提交备注（可选）'}/>{latest?.canSubmit&&<Button variant="outline" disabled={busy||!!pending||formDirty||stale} onClick={()=>mutate('submit')}>提交待人工核对</Button>}{latest?.canCompleteReview&&<Button variant="outline" disabled={busy||!!pending||formDirty||stale} onClick={()=>mutate('complete-review')}>确认 v{selected.version} 内部核对完成</Button>}{latest?.canReturn&&<Button variant="outline" disabled={busy||!!pending||formDirty||stale||!reviewNote.trim()} onClick={()=>mutate('return')}>退回补充</Button>}</div>}</>}
 {selected&&latest&&showHistory&&<div className="upgrade-history" aria-label="沟通版本历史">{history.isError?<p role="alert">{(history.error as Error).message}</p>:!history.data?<p>正在读取历史…</p>:<>{history.data.revisions.map(r=><article key={r.id}><b>版本 {r.version} · {revisionLabel(r.action)}</b><time> · {dateTime(r.createdAt)} · {r.actor}</time><details><summary>查看当时的内容</summary><h4>{r.snapshot.title}</h4><p>原始日期：{r.snapshot.occurredAt||'未填写'} · 来源：{r.snapshot.sourceReference||'未填写'}</p><b>客户原文</b><pre>{r.snapshot.sourceText||'未填写'}</pre><b>回复草稿</b><pre>{r.snapshot.draftText||'未填写'}</pre><b>内部备注</b><pre>{r.snapshot.internalNote||'未填写'}</pre></details></article>)}{history.data.reviews.map(r=><article key={r.id}><b>{revisionLabel(r.action)}</b><time> · {dateTime(r.createdAt)}</time><p>{r.comment||'无备注'}</p></article>)}</>}</div>}
 </section>}</div>}</div>;
}
