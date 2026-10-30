'use client';
import {ExcelTable,useExcelColumnFilters} from './excel-table';
import {useEffect,useMemo,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Search,ArrowRight,FolderOpen} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {handoffNavigation,type WorkspaceNavigationContext,type WorkspaceNavigate} from '@/lib/handoff-navigation';
import type {Entity,Order} from '@/lib/domain';
import type {Data} from './workspace';
import {request,Empty} from './ui';
import {useBusinessTeamScope} from './business-team-context';
type Feed={orders:Entity[];customers:Entity[];items:Entity[]};
type ServiceTeam={id:string;name:string;active:boolean;customerIds:string[]};
type ServiceGroups={teams:ServiceTeam[];customers:{id:string}[]};
const destinations=['order-confirmations','engineering-materials','production-orders','production-shipments','logistics-waybills','finance-documents'];
const folderFor:Record<string,string>={po:'06_订单_PI',pi:'06_订单_PI',engineering_drawing:'03_图纸',engineering_quote:'04_工程报价',production_order:'08_生产',production_shipment:'08_生产',packing:'09_出货',invoice:'09_出货',waybill:'09_出货',finance_file:'07_付款',finance_request:'07_付款',paymentrequest:'07_付款'};
export function HandoffOrderHub({data,onNavigate,openOrder,initialContext={}}:{data:Data;onNavigate:WorkspaceNavigate;openOrder:(order:Order)=>void;initialContext?:WorkspaceNavigationContext}){
 const businessTeam=useBusinessTeamScope();
 const [search,setSearch]=useState(''),[owner,setOwner]=useState(''),[localTeamId,setTeamId]=useState(''),[selected,setSelected]=useState(initialContext.orderId||''),[page,setPage]=useState(0);
 const teamId=businessTeam?'':localTeamId;
 const query=useQuery<Feed>({queryKey:['handoff-order-index',data.me.id,data.revision],queryFn:({signal})=>request('handoff-business-data',undefined,{signal}),retry:false});
 const groupQuery=useQuery<ServiceGroups>({queryKey:['handoff-service-groups',data.me.id,data.revision],queryFn:({signal})=>request('service-data',undefined,{signal}),retry:false});
 const source=query.isError?undefined:query.data;
 const groupingReady=!!source&&!groupQuery.isError&&Array.isArray(groupQuery.data?.teams)&&Array.isArray(groupQuery.data?.customers);
 const teams=businessTeam?.catalog?.teams||(groupingReady?groupQuery.data!.teams:[]);
 const groupCustomers=new Set(groupingReady?groupQuery.data!.customers.map(c=>c.id):[]);
 const orders=useMemo(()=>data.orders.filter(o=>o.lifecycle!=='archived'),[data.orders]);
 const names=(email:string)=>data.members.find(m=>m.email===email)?.name||email||'待分配';
 const grouping=(orderId:string)=>{
  if(!groupingReady)return {known:false,teams:[] as ServiceTeam[],label:query.isPending||groupQuery.isPending?'正在读取分组…':'分组暂不可用'};
  const customerId=source!.orders.find(o=>o.id===orderId)?.customerId;
  if(!customerId)return {known:false,teams:[] as ServiceTeam[],label:'客户待关联'};
  if(!groupCustomers.has(customerId))return {known:false,teams:[] as ServiceTeam[],label:'暂无分组权限'};
  const assigned=teams.filter(t=>t.customerIds.includes(customerId));
  return {known:true,teams:assigned,label:assigned.length?assigned.map(t=>t.name+(t.active?'':'（停用）')).join('、'):'未分组'};
 };
 const baseRows=orders.filter(o=>{const group=grouping(o.id);return (!teamId||group.known&&(teamId==='__ungrouped__'?!group.teams.length:group.teams.some(t=>t.id===teamId)))&&(!owner||o.ownerEmail===owner)&&(!search||[o.orderNo,o.customer,o.customerPO,o.drawing,o.color,o.lens,names(o.ownerEmail)].join(' ').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));});
 const columnModel=useExcelColumnFilters(baseRows,o=>[`${o.orderNo} ${o.customerPO||'PO 待补充'}`,source?.customers.find(c=>c.id===source.orders.find(r=>r.id===o.id)?.customerId)?.customer||o.customer,grouping(o.id).label,[o.drawing,o.color,o.lens,o.batch].filter(Boolean).join(' / '),o.quantity.toLocaleString(),`${o.salesName||names(o.ownerEmail)} ${o.serviceName||'客服待分配'}`,o.workflowStatus||o.stage||'待核查',`${o.requestedDate||'待确认'} ${o.promiseConfirmed?o.promisedDate:'回复交期待确认'}`,'订单档案']);
 const rows=columnModel.rows;
 useEffect(()=>setPage(0),[columnModel.filters]);
 const order=orders.find(o=>o.id===selected),binding=source?.orders.find(o=>o.id===selected),customer=source?.customers.find(c=>c.id===binding?.customerId);
 const documents=order?(source?.items||[]).filter(r=>r.orderId===order.id||(r.lines||[]).some((line:Entity)=>line.orderLineId===order.id)):[];
 const attachments=order?data.attachments.filter(a=>a.lineId===order.id):[];
 useEffect(()=>{if(selected&&!data.orders.some(o=>o.id===selected))setSelected('');},[selected,data.orders]);
 useEffect(()=>{setSelected(initialContext.orderId||'');},[initialContext.orderId]);
 useEffect(()=>{if(groupingReady&&teamId&&teamId!=='__ungrouped__'&&!teams.some(t=>t.id===teamId)){setTeamId('');setPage(0);}},[groupingReady,teamId,teams]);
 useEffect(()=>{setPage(p=>Math.min(p,Math.max(0,Math.ceil(rows.length/30)-1)));},[rows.length]);
 const context:WorkspaceNavigationContext={orderId:order?.id,customerId:customer?.id};
 return <div className="handoff-order-hub">
 <section className="panel section-pad hub-case"><div className="hub-case-head"><div><h2>客服订单工作台</h2><p>按业务客服组查看客户订单，在跟进事项中上传参考图并指定跟进与审核人员。</p></div><Button onClick={()=>onNavigate('service-followups',context)}>客服跟进 / 参考图与人员分派<ArrowRight size={16}/></Button></div></section>
 <section className="panel"><div className="panel-tools">
  <label className="search"><Search size={16}/><input aria-label="搜索客服订单" value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}} placeholder="客户、订单、PO、款号或负责人"/></label>
  {!businessTeam&&<select aria-label="筛选客服订单组" value={teamId} onChange={e=>{setTeamId(e.target.value);setPage(0);}}><option value="">全部可见组</option><option value="__ungrouped__" disabled={!groupingReady}>未分组</option>{teams.map(t=><option value={t.id} key={t.id}>{t.name}{t.active?'':'（停用）'}</option>)}</select>}
  <select aria-label="客服订单负责人" value={owner} onChange={e=>{setOwner(e.target.value);setPage(0);}}><option value="">全部负责人</option>{[...new Set(orders.map(o=>o.ownerEmail).filter(Boolean))].map(id=><option value={id} key={id}>{names(id)}</option>)}</select><span>{rows.length} 条订单明细</span>
 </div><div className="hub-table-scroll"><ExcelTable filterModel={columnModel}><thead><tr>{['订单号 / PO','客户','业务客服组','款号 / 颜色 / 镜片','数量','销售 / 客服','当前阶段','要求 / 回复交期','资料'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.slice(page*30,(page+1)*30).map(o=><tr key={o.id} aria-selected={selected===o.id}><td><button className="text-link" onClick={()=>setSelected(o.id)}>{o.orderNo}</button><small>{o.customerPO||'PO 待补充'}</small></td><td>{source?.customers.find(c=>c.id===source.orders.find(r=>r.id===o.id)?.customerId)?.customer||o.customer}</td><td>{grouping(o.id).label}</td><td>{o.drawing}<small>{[o.color,o.lens,o.batch].filter(Boolean).join(' / ')}</small></td><td>{o.quantity.toLocaleString()}</td><td>{o.salesName||names(o.ownerEmail)}<small>{o.serviceName||'客服待分配'}</small></td><td>{o.workflowStatus||o.stage||'待核查'}</td><td>{o.requestedDate||'待确认'}<small>{o.promiseConfirmed?o.promisedDate:'回复交期待确认'}</small></td><td><Button variant="outline" size="sm" onClick={()=>setSelected(o.id)}><FolderOpen size={14}/>订单档案</Button></td></tr>)}</tbody></ExcelTable></div>{!rows.length&&<Empty title={teamId&&!groupingReady?'暂无法读取所选组的订单':'没有符合条件的客服订单'} detail={teamId&&!groupingReady?'客户分组尚未确认，可重新读取资料或切回全部可见组。':'可调整筛选；现有权限范围内的订单在这里关联部门资料。'}/>}<div className="table-footer"><span>保留每条原订单明细的关联</span><div className="row-actions"><Button variant="outline" size="sm" disabled={page===0} onClick={()=>setPage(p=>p-1)}>上一页</Button><span>{Math.min(page+1,Math.max(1,Math.ceil(rows.length/30)))} / {Math.max(1,Math.ceil(rows.length/30))}</span><Button variant="outline" size="sm" disabled={(page+1)*30>=rows.length} onClick={()=>setPage(p=>p+1)}>下一页</Button></div></div></section>
 {!groupingReady&&!query.isPending&&!groupQuery.isPending&&<div className="error" role="alert">客户分组暂不可用，未将无法确认归属的订单计入未分组。<Button variant="outline" onClick={()=>{void query.refetch();void groupQuery.refetch();}}>重新读取分组</Button></div>}
 {query.isError&&<div className="error" role="alert">订单资料索引读取失败，当前仅展示已获授权的生产明细。<Button variant="outline" onClick={()=>void query.refetch()}>重新读取资料</Button></div>}
 {order&&<section className="panel section-pad hub-case"><div className="hub-case-head"><div><h3>{order.orderNo} · {order.drawing}</h3><p>{customer?.customer||order.customer} · {order.quantity.toLocaleString()} 副 · {order.workflowStatus||order.stage}</p><p>业务客服组：{grouping(order.id).label}</p></div><div className="row-actions"><Button onClick={()=>onNavigate('service-followups',context)}>跟进此订单 / 参考图与人员分派<ArrowRight size={16}/></Button><Button variant="outline" onClick={()=>openOrder(order)}>查看订单明细与历史</Button></div></div><nav className="hub-folders" aria-label="当前订单部门资料">{destinations.map(view=><button key={view} onClick={()=>onNavigate(view,context)}><FolderOpen size={16}/>{handoffNavigation.find(n=>n.id===view)?.label}<ArrowRight size={14}/></button>)}</nav>{query.isPending?<p>正在读取资料索引…</p>:<><h3>当前已明确关联的资料与版本</h3>{documents.length?<div className="hub-table-scroll"><ExcelTable><thead><tr><th>目录</th><th>单据编号</th><th>版本</th><th>状态</th><th>更新时间</th></tr></thead><tbody>{documents.map(d=><tr key={d.id}><td>{folderFor[d.type]||'待归类'}</td><td>{d.number}</td><td>V{d.version}</td><td>{d.sourceChanged?'来源已变化':d.status==='checked'?'内容已核对':d.status==='pending_check'?'待核对':'草稿'}</td><td>{d.updatedAt?new Date(d.updatedAt).toLocaleString('zh-CN'):''}</td></tr>)}</tbody></ExcelTable></div>:<p className="muted">当前没有已明确关联的新版业务资料。可进入对应目录登记或关联已有来源。</p>}<h3>原始附件</h3>{attachments.length?<ul className="hub-files">{attachments.map(a=><li key={a.id}><a href={'/api/workspace/file?id='+encodeURIComponent(a.id)} target="_blank" rel="noreferrer">{a.filename||'原附件'}</a><span>{a.createdAt?new Date(a.createdAt).toLocaleDateString('zh-CN'):''}</span></li>)}</ul>:<p className="muted">此订单明细没有原始附件记录。</p>}</>}</section>}
 </div>;
}
