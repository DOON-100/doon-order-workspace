'use client';

import {lazy,Suspense,useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {useQuery} from '@tanstack/react-query';
import {ArrowRight,RefreshCw,FileText,Download} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import type {Entity,Order} from '@/lib/domain';
import {active,currentStage,today,stageDefs} from '@/lib/ledger';
import {supplierPending,supplierStatus} from '@/lib/suppliers';
import type {OutsourcingScope} from '@/lib/outsourcing-workspace';
import {remaining,type Purchase} from '@/lib/purchases';
import {kitState,materialsForOrder,pendingMaterials,pendingRisks,quantityByUnit,type PendingMaterial,type ProcurementSnapshot} from '@/lib/supplier-operations';
import type {WorkspaceNavigationContext} from '@/lib/handoff-navigation';
import type {Data} from './workspace';
import {Grid,dateTime,request,type Act} from './ui';
import {useExcelColumnFilters,type ExcelFilterModel} from './excel-table';
import {Pager} from './ledger-panels';
import {PurchasePanel} from './purchase-panel';
import {LegacySupplierPanel} from './supplier-panel';
import {OutsourcingCatalogPanel} from './outsourcing-catalog-panel';
import {BusinessTeamDownloadButton} from './business-team-download';
import './supplier-operations-panel.css';

const OutsourcingWorkbookPanel=lazy(()=>import('./outsourcing-workbook-panel').then(module=>({default:module.OutsourcingWorkbookPanel})));
type Props={data:Data;act:Act;busy:boolean;openOrder:(order:Order)=>void;onDirtyChange:(dirty:boolean)=>void;onNavigate:(view:string,context?:WorkspaceNavigationContext)=>void;view:string};
type SnapshotResponse={snapshot:ProcurementSnapshot|null};
type ProjectResponse={samples:Entity[];internalSamples:Entity[];projects:Entity[]};
const descriptions:Record<string,{title:string;detail:string}>={
 'supplier-directory':{title:'供应商档案',detail:'查看和维护供应商资料，核对导入的金蝶供应商表。'},
 'supplier-followup':{title:'供应商与交期跟催',detail:'从最新采购未上货记录找出供应商与到期明细，再维护已有采购复期和催交记录。'},
 'supplier-kit':{title:'眼镜物料齐套与欠料',detail:'按板料、钛料、铰链、镜腿、镜片和包材查看采购，结合订单配件、板料、配套齐料日期逐单核对。'},
 'supplier-outsourcing':{title:'外协加工与未回货',detail:'按真实外发单跟进电镀、PVD、喷涂及其他工序；登记供应商回复、送货凭证与实际合格回货。'},
 'supplier-semifinished':{title:'钛架部',detail:'按钛焊、打磨和钛配套工序，跟进半成品送出、供应商复期与实际回货。'},
 'supplier-semifinished-plastic':{title:'胶架部',detail:'按脾加工、车房、出桶配套和钉装磨胶工序，跟进半成品送出、供应商复期与实际回货。'},
 'supplier-plating':{title:'电镀外发与回货',detail:'按电镀工序跟进外发单、供应商复期、未回数量与送货凭证，核对实际合格回货。'},
 'supplier-risk':{title:'采购异常与供应风险',detail:'集中检查采购原表交期、缺失信息和已登记外协的逾期、复期风险。'},
 'supplier-samples':{title:'样办与新品备料',detail:'查看实际样办单与采购原表中的样办、新品线索，按图号、规格和交期核对备料。'},
 'supplier-reconciliation':{title:'采购单据与对账',detail:'从采购源行、收货与退补留痕、供应商送货凭证逐项核对数量和来源。'},
};
const number=(value:number|null)=>value===null?'待核对':value.toLocaleString('zh-CN',{maximumFractionDigits:4});
const unitTotal=(item:ReturnType<typeof quantityByUnit>[number])=>item.unknown===item.rows?`数量待核对 · ${item.unit}`:`${number(item.quantity)} ${item.unit}${item.unknown?` · ${item.unknown} 行数量待核对`:''}`;
const processName=(id:string)=>stageDefs.find(stage=>stage.id===id)?.name||id;
const matches=(text:string,query:string)=>!query||text.toLowerCase().includes(query.trim().toLowerCase());
const showFilteredTable=(model:ExcelFilterModel)=>model.total>0||Object.keys(model.filters).length>0;
function useColumnPage<T>(records:T[],values:(row:T)=>unknown[],page:number,setPage:(page:number)=>void,size=20){
 const model=useExcelColumnFilters(records,values);
 const previousFilters=useRef(model.filters);
 useEffect(()=>{
  if(previousFilters.current!==model.filters){previousFilters.current=model.filters;setPage(0);return;}
  const last=Math.max(0,Math.ceil(model.rows.length/size)-1);if(page>last)setPage(last);
 },[model.filters,page,model.rows.length,size,setPage]);
 return model;
}

function Section({title,description,actions,children}:{title:string;description?:string;actions?:ReactNode;children:ReactNode}){return <section className="panel"><div className="supplier-ops-section-head"><div><h3>{title}</h3>{description&&<p>{description}</p>}</div>{actions}</div>{children}</section>;}
function Metrics({items}:{items:Array<[string,number,string]>}){return <div className="supplier-ops-metrics">{items.map(([label,count,detail])=><div key={label}><span>{label}</span><strong>{number(count)}</strong><small>{detail}</small></div>)}</div>;}
function EmptyRows({children}:{children:ReactNode}){return <div className="supplier-ops-empty">{children}</div>;}

export function SupplierOperationsPanel(props:Props){
 const {data,view,onNavigate}=props,description=descriptions[view]||descriptions['supplier-followup'];
 const outsourcingScope:OutsourcingScope|undefined=view==='supplier-semifinished'?'titanium':view==='supplier-semifinished-plastic'?'plastic':view==='supplier-plating'?'plating':view==='supplier-outsourcing'?'all':undefined;
 const referenceView=view==='outsourcing-catalog'||view==='outsourcing-workbooks';
 const current=useQuery<SnapshotResponse>({queryKey:['kingdee-pending',''],queryFn:()=>request('kingdee-pending-data'),enabled:data.me.active&&data.me.role!=='supplier'&&!outsourcingScope&&view!=='supplier-directory'&&!referenceView});
 const snapshot=current.data?.snapshot,materials=useMemo(()=>pendingMaterials(snapshot),[snapshot]);
 if(!data.me.active||data.me.role==='supplier')return <section className="panel"><EmptyRows>当前账号没有内部供应商管理工作台的查看权限。</EmptyRows></section>;
 if(view==='outsourcing-catalog')return <OutsourcingCatalogPanel me={data.me} onDirtyChange={props.onDirtyChange}/>;
 if(view==='outsourcing-workbooks')return <Suspense fallback={<section className="panel" role="status">正在加载原表与字段查询…</section>}><OutsourcingWorkbookPanel/></Suspense>;
 return <div className="supplier-operations">
  <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={()=>onNavigate('outsourcing-catalog')}>公司共享外发基础资料</Button>{outsourcingScope&&<Button variant="outline" onClick={()=>onNavigate('outsourcing-workbooks')}>原Excel与字段查询</Button>}</div>
  <section className="supplier-ops-intro"><div><span className="section-kicker">{outsourcingScope==='titanium'||outsourcingScope==='plastic'?'半成品外发':outsourcingScope==='plating'?'电镀外发':'供应商管理工作台'}</span><h2>{description.title}</h2><p>{description.detail}</p></div>{outsourcingScope&&outsourcingScope!=='all'?<Button variant="outline" onClick={()=>onNavigate(outsourcingScope==='plating'?'supplier-semifinished':'supplier-plating')}>{outsourcingScope==='plating'?'半成品外发':'电镀外发'}<ArrowRight size={16}/></Button>:<Button variant="outline" onClick={()=>onNavigate('supplier-pending')}>采购未上货总表<ArrowRight size={16}/></Button>}</section>
  {!outsourcingScope&&view!=='supplier-directory'&&<>
   {current.isError&&<div className="error" role="alert">金蝶采购快照读取失败：{(current.error as Error).message} {snapshot?'下方保留上次读取的快照。':''}<Button variant="outline" size="sm" onClick={()=>void current.refetch()}>重试</Button></div>}
   {current.isPending?<div className="supplier-ops-source" role="status">正在读取金蝶采购最新快照…</div>:snapshot?<div className="supplier-ops-source"><strong>金蝶采购来源截至 {snapshot.metadata.sourceAsOf}</strong> · {snapshot.metadata.filename}<br/>本范围 {number(materials.length)} 条明细 · 导入 {dateTime(snapshot.metadata.importedAt)}。数量沿用源表口径，按单位分别展示。<span className="supplier-ops-actions"><Button variant="ghost" size="sm" onClick={()=>void current.refetch()} disabled={current.isFetching}><RefreshCw size={14}/>刷新快照</Button></span></div>:!current.isError&&<div className="supplier-ops-source">尚未同步金蝶采购未上货记录。请在总表点击“同步金蝶总表”。</div>}
  </>}
  {view==='supplier-followup'&&<FollowupView materials={materials} {...props}/>}
  {view==='supplier-directory'&&<LegacySupplierPanel key="directory" initialView="directory" data={data} act={props.act} busy={props.busy} openOrder={props.openOrder}/>}
  {view==='supplier-kit'&&<KitView materials={materials} {...props}/>}
  {outsourcingScope&&<LegacySupplierPanel key={outsourcingScope} scope={outsourcingScope} data={data} act={props.act} busy={props.busy} openOrder={props.openOrder}/>}
  {view==='supplier-risk'&&<RiskView materials={materials} {...props}/>}
  {view==='supplier-samples'&&<SamplesView materials={materials} {...props}/>}
  {view==='supplier-reconciliation'&&<ReconciliationView materials={materials} {...props}/>}
 </div>;
}

function MaterialTable({rows,title='金蝶采购物料明细',description,initialQuery=''}:{rows:PendingMaterial[];title?:string;description?:string;initialQuery?:string}){
 const [query,setQuery]=useState(initialQuery),[category,setCategory]=useState(''),[supplier,setSupplier]=useState(''),[page,setPage]=useState(0),[selected,setSelected]=useState<PendingMaterial|null>(null);
 useEffect(()=>{setQuery(initialQuery);setPage(0);},[initialQuery]);
 const baseRows=rows.filter(row=>(!category||row.category===category)&&(!supplier||row.supplier===supplier)&&matches([row.po,row.supplier,row.itemCode,row.itemName,row.customerOrder,row.note].join(' '),query));
 const columnModel=useColumnPage(baseRows,row=>[
  `${row.po||'单号待核对'} 源行 ${row.sourceRow} · 查看原始字段`,`${row.supplier||'待核对'} ${row.buyer||'采购员未填写'}`,
  `${row.itemName||'名称待核对'} ${row.itemCode||'编码未填写'} ${row.spec}`,row.category,
  `${number(row.quantity)} ${row.unit||'单位未填写'}`,row.dueDate||'待核对',`${row.customerOrder||'未关联客户订单'} ${row.note||'—'}`,
 ],page,setPage),filtered=columnModel.rows;
 useEffect(()=>setPage(0),[query,category,supplier,rows.length]);
 return <Section title={`${title} · ${filtered.length} 条`} description={description||'点击源行查看金蝶原始字段；分类由商品名称与规格识别，其他项保留待核对。'}>
  <div className="supplier-ops-filters p-4"><label>查找<input aria-label="查找采购物料" placeholder="采购单号 / 商品 / 供应商 / 客户订单 / 备注" value={query} onChange={e=>setQuery(e.target.value)}/></label><label>眼镜物料分类<select aria-label="筛选眼镜物料分类" value={category} onChange={e=>setCategory(e.target.value)}><option value="">全部分类</option>{[...new Set(rows.map(row=>row.category))].sort().map(value=><option key={value}>{value}</option>)}</select></label><label>供应商<select aria-label="筛选物料供应商" value={supplier} onChange={e=>setSupplier(e.target.value)}><option value="">全部供应商</option>{[...new Set(rows.map(row=>row.supplier))].filter(Boolean).sort().map(value=><option key={value}>{value}</option>)}</select></label></div>
  <div className="supplier-ops-table">{showFilteredTable(columnModel)?<Grid filterModel={columnModel} headers={['源行 / 采购单','供应商 / 采购员','物料 / 编码','分类','原表数量 / 单位','原表预计交货','客户订单 / 备注']} rows={filtered.slice(page*20,page*20+20).map(row=>[<button className="supplier-ops-link" onClick={()=>setSelected(row)}><b>{row.po||'单号待核对'}</b><span className="subline">源行 {row.sourceRow} · 查看原始字段</span></button>,<>{row.supplier||'待核对'}<span className="subline">{row.buyer||'采购员未填写'}</span></>,<div className="supplier-ops-wrap"><b>{row.itemName||'名称待核对'}</b><span className="subline">{row.itemCode||'编码未填写'} {row.spec}</span></div>,row.category,<b>{number(row.quantity)} {row.unit||'单位未填写'}</b>,<span className={row.dueDate&&row.dueDate<today()?'text-orange-700':''}>{row.dueDate||'待核对'}</span>,<div className="supplier-ops-wrap">{row.customerOrder||'未关联客户订单'}<span className="subline">{row.note||'—'}</span></div>])}/>:<EmptyRows>没有符合当前筛选的源表明细。</EmptyRows>}</div><Pager count={filtered.length} page={page} setPage={setPage}/>
  <Dialog open={!!selected} onOpenChange={open=>{if(!open)setSelected(null);}}><DialogContent className="dialog-scroll sm:max-w-[800px]"><DialogHeader><DialogTitle>金蝶采购原始记录 · 源行 {selected?.sourceRow}</DialogTitle><DialogDescription>保留原表字段和显示文本。数量含义以金蝶报表为准。</DialogDescription></DialogHeader>{selected&&<dl className="supplier-ops-raw">{Object.entries(selected.raw).map(([key,value])=><div key={key}><dt>{key}</dt><dd>{value||'—'}</dd></div>)}</dl>}</DialogContent></Dialog>
 </Section>;
}

function FollowupView({data,materials,onDirtyChange}:Props&{materials:PendingMaterial[]}){
 const [supplier,setSupplier]=useState(''),[query,setQuery]=useState(''),[page,setPage]=useState(0);
 const grouped=useMemo(()=>{const map=new Map<string,PendingMaterial[]>();for(const item of materials){const key=item.supplier||'供应商待核对';map.set(key,[...(map.get(key)||[]),item]);}return [...map].map(([name,rows])=>({name,rows,overdue:rows.filter(row=>row.dueDate&&row.dueDate<today()).length,missing:rows.filter(row=>!row.dueDate).length,due:rows.map(row=>row.dueDate).filter(Boolean).sort()[0]})).sort((a,b)=>b.overdue-a.overdue||a.name.localeCompare(b.name,'zh-CN'));},[materials]);
 const baseGroups=grouped.filter(group=>matches(group.name,query));
 const columnModel=useColumnPage(baseGroups,group=>[group.name,`${new Set(group.rows.map(row=>row.po).filter(Boolean)).size} 单 / ${group.rows.length} 行`,group.due||'待核对',`${group.overdue} / ${group.missing}`,quantityByUnit(group.rows).map(unitTotal).join(' '),'核对该供应商'],page,setPage,15),groups=columnModel.rows;
 useEffect(()=>setPage(0),[query,materials.length]);
 return <>
  <Metrics items={[["当前供应商",grouped.length,'最新金蝶快照'],['采购明细',materials.length,'不合并同单重复源行'],['原表交期已过',materials.filter(row=>row.dueDate&&row.dueDate<today()).length,'按原表预计交货日期'],['交期待核对',materials.filter(row=>!row.dueDate).length,'原表未提供有效日期']]}/>
  <Section title="按供应商安排跟催" description="先核对本次未上货清单；数量分单位汇总，不把不同物料数量混算为欠料量。"><div className="supplier-ops-filters p-4"><label>供应商名称<input aria-label="搜索跟催供应商" value={query} onChange={e=>setQuery(e.target.value)} placeholder="输入供应商名称"/></label></div><div className="supplier-ops-table">{showFilteredTable(columnModel)?<Grid filterModel={columnModel} headers={['供应商','采购单 / 明细','原表最早交期','交期已过 / 待核对','原表数量（分单位）','明细']} rows={groups.slice(page*15,page*15+15).map(group=>[<b>{group.name}</b>,`${new Set(group.rows.map(row=>row.po).filter(Boolean)).size} 单 / ${group.rows.length} 行`,group.due||'待核对',`${group.overdue} / ${group.missing}`,<div className="supplier-ops-wrap">{quantityByUnit(group.rows).map(item=><span className="subline" key={item.unit}>{unitTotal(item)}</span>)}</div>,<Button size="sm" variant="outline" onClick={()=>setSupplier(group.name)}>核对该供应商</Button>])}/>:<EmptyRows>本范围暂无供应商采购明细。</EmptyRows>}</div><Pager count={groups.length} page={page} setPage={setPage} size={15}/></Section>
  {supplier&&<MaterialTable key={supplier} rows={materials.filter(row=>(row.supplier||'供应商待核对')===supplier)} title={supplier+' · 当前未上货源行'}/>}
  <details className="panel supplier-ops-history"><summary>已有采购跟催记录 · 复期 / 收货核对 / 已交货档案</summary><div><p className="supplier-ops-caption">这里保留原有采购跟单台账，来源日期见每条明细。它与上方最新金蝶快照独立，历史采购行不会因新快照导入而改写；请按单号、商品编码及客户订单核对后维护。</p><PurchasePanel me={data.me} onDirtyChange={onDirtyChange}/></div></details>
 </>;
}

function KitView({data,materials,openOrder}:Props&{materials:PendingMaterial[]}){
 const [query,setQuery]=useState(''),[status,setStatus]=useState('pending'),[page,setPage]=useState(0),[selectedOrder,setSelectedOrder]=useState<Order|null>(null);
 const orders=data.orders.filter(active),matched=orders.map(order=>({order,kit:kitState(order),materials:materialsForOrder(order,materials)}));
 const baseRows=matched.filter(row=>matches([row.order.orderNo,row.order.customer,row.order.drawing,row.order.color].join(' '),query)&&(status==='all'||status==='pending'&&row.kit.status==='齐料日期待核对'||status==='linked'&&row.materials.length>0||status==='ready'&&!!row.kit.kit));
 const columnModel=useColumnPage(baseRows,({order,kit,materials:linked})=>[`${order.orderNo} ${order.customer} · ${order.drawing} / ${order.color}`,kit.accessories||'待核对',kit.sheet||'待核对',`${kit.kit||kit.status} 投产 ${kit.started||'未登记'}`,currentStage(order),linked.length?`${linked.length} 行 / ${new Set(linked.map(row=>row.supplier)).size} 家`:'未匹配到采购源行','查看同单采购'],page,setPage),rows=columnModel.rows;
 useEffect(()=>setPage(0),[query,status,data.orders.length]);
 const categories=[...new Set(materials.map(row=>row.category))].map(category=>({category,rows:materials.filter(row=>row.category===category)}));
 return <>
  <Metrics items={[["在制订单明细",orders.length,'当前授权范围'],['齐料日期待核对',matched.filter(row=>row.kit.status==='齐料日期待核对').length,'未填日期不等于确认欠料'],['齐料日期已登记',matched.filter(row=>row.kit.kit).length,'沿用总表配套齐料日期'],['无客户单号的采购',materials.filter(row=>!row.customerOrder).length,'需人工核对物料用途']]}/>
  <Section title="眼镜物料分类" description="按商品名称与规格自动归类；同一物料的用途与替代关系仍按 BOM 核对。"><div className="supplier-ops-table">{categories.length?<Grid headers={['物料类别','源表明细','采购供应商','原表数量（分单位）']} rows={categories.map(item=>[item.category,item.rows.length,new Set(item.rows.map(row=>row.supplier).filter(Boolean)).size,<div className="supplier-ops-pills">{quantityByUnit(item.rows).map(unit=><span className="pill" key={unit.unit}>{unitTotal(unit)}</span>)}</div>])}/>:<EmptyRows>同步金蝶数据后显示物料分类。</EmptyRows>}</div></Section>
  <Section title="订单齐料日期核对" description="采购客户订单编号与中台订单号精确匹配，仅表示同单关联；同单多款多色不会自动分摊数量。未接入 BOM 需求及库存，因此不推算短缺数量。"><div className="supplier-ops-filters p-4"><label>查找订单<input aria-label="搜索齐料订单" placeholder="订单号 / 客户 / 款号 / 色号" value={query} onChange={e=>setQuery(e.target.value)}/></label><label>核对范围<select aria-label="筛选齐料状态" value={status} onChange={e=>setStatus(e.target.value)}><option value="pending">齐料日期待核对</option><option value="linked">有关联未上货采购</option><option value="ready">齐料日期已登记</option><option value="all">全部在制订单</option></select></label></div><div className="supplier-ops-table">{showFilteredTable(columnModel)?<Grid filterModel={columnModel} headers={['订单 / 款色','配件齐日期','板料齐日期','配套齐料 / 投产','当前工序','同单采购线索','操作']} rows={rows.slice(page*20,page*20+20).map(({order,kit,materials:linked})=>[<button className="supplier-ops-link" onClick={()=>openOrder(order)}><b>{order.orderNo}</b><span className="subline">{order.customer} · {order.drawing} / {order.color}</span></button>,kit.accessories||'待核对',kit.sheet||'待核对',<>{kit.kit||kit.status}<span className="subline">投产 {kit.started||'未登记'}</span></>,currentStage(order),linked.length?`${linked.length} 行 / ${new Set(linked.map(row=>row.supplier)).size} 家`:'未匹配到采购源行',<Button variant="outline" size="sm" disabled={!linked.length} onClick={()=>setSelectedOrder(order)}>查看同单采购</Button>])}/>:<EmptyRows>没有符合当前筛选的订单。</EmptyRows>}</div><Pager count={rows.length} page={page} setPage={setPage}/></Section>
  {selectedOrder&&<MaterialTable key={selectedOrder.id} rows={materialsForOrder(selectedOrder,materials)} title={selectedOrder.orderNo+' · 同单采购线索'}/>}
  <MaterialTable rows={materials}/>
 </>;
}

function RiskView({data,materials,onNavigate,openOrder}:Props&{materials:PendingMaterial[]}){
 const [reason,setReason]=useState(''),[query,setQuery]=useState(''),[page,setPage]=useState(0),[selectedRow,setSelectedRow]=useState<PendingMaterial|null>(null);
 const risks=pendingRisks(materials),baseRows=risks.filter(row=>(!reason||row.reasons.includes(reason))&&matches([row.po,row.supplier,row.itemCode,row.itemName,row.customerOrder].join(' '),query));
 const columnModel=useColumnPage(baseRows,row=>[`${row.po} 源行 ${row.sourceRow}`,`${row.supplier||'待核对'} ${row.itemName} · ${row.itemCode}`,row.reasons.join(' '),row.dueDate||'待核对',row.customerOrder||'未填写','核对源行'],page,setPage),filtered=columnModel.rows;
 const outsource=(data.outsource||[]).filter(row=>supplierPending(row)&&['已逾期','交期风险','待供应商复期','已驳回','待主管审批'].includes(supplierStatus(row)));
 useEffect(()=>setPage(0),[query,reason,materials.length]);
 return <>
  <Metrics items={[["采购风险线索",risks.length,'一条采购可有多项原因'],['原表交期已过',risks.filter(row=>row.reasons.includes('原表交期已过')).length,'需核对金蝶与实际到货'],['交期待核对',risks.filter(row=>row.reasons.includes('交期待核对')).length,'原表缺有效预计交货日'],['外协待处理',outsource.length,'来自中台实际外发记录']]}/>
  <Section title="当前采购异常清单" description="按快照原表值检查；未回货与延期原因须向采购和供应商核实。"><div className="supplier-ops-filters p-4"><label>查找风险明细<input aria-label="查找采购风险" value={query} onChange={e=>setQuery(e.target.value)} placeholder="采购单 / 供应商 / 物料 / 客户单"/></label><label>原因<select aria-label="筛选采购风险原因" value={reason} onChange={e=>setReason(e.target.value)}><option value="">全部原因</option>{[...new Set(risks.flatMap(row=>row.reasons))].map(value=><option key={value}>{value}</option>)}</select></label></div><div className="supplier-ops-table">{showFilteredTable(columnModel)?<Grid filterModel={columnModel} headers={['采购单 / 源行','供应商 / 商品','风险线索','原表交期','客户订单','核对']} rows={filtered.slice(page*20,page*20+20).map(row=>[<><b>{row.po}</b><span className="subline">源行 {row.sourceRow}</span></>,<div className="supplier-ops-wrap">{row.supplier||'待核对'}<span className="subline">{row.itemName} · {row.itemCode}</span></div>,<div className="supplier-ops-pills">{row.reasons.map(item=><span key={item} className="pill amber">{item}</span>)}</div>,row.dueDate||'待核对',row.customerOrder||'未填写',<Button variant="outline" size="sm" onClick={()=>setSelectedRow(row)}>核对源行</Button>])}/>:<EmptyRows>当前范围未检出上述采购风险线索。</EmptyRows>}</div><Pager count={filtered.length} page={page} setPage={setPage}/></Section>
  {selectedRow&&<MaterialTable key={selectedRow.sourceRow} rows={[selectedRow]} title="待核对的采购原始记录"/>}
  <Section title={`外协异常与复期 · ${outsource.length} 笔`} description="保留实际外发记录的审批、回货与交期状态。" actions={<Button variant="outline" size="sm" onClick={()=>onNavigate('supplier-outsourcing')}>处理外协跟进<ArrowRight size={15}/></Button>}><div className="supplier-ops-table">{outsource.length?<Grid headers={['外发单 / 供应商','订单 / 工序','状态','外发 / 已回 / 未回','要求 / 复期']} rows={outsource.slice(0,30).map(row=>{const order=data.orders.find(item=>item.id===row.lineId);return [<><b>{row.reference}</b><span className="subline">{row.supplier}</span></>,<><button className="supplier-ops-link" disabled={!order} onClick={()=>order&&openOrder(order)}>{order?.orderNo||'订单不在当前范围'}</button><span className="subline">{processName(row.process)}</span></>,<span className="pill amber">{supplierStatus(row)}</span>,`${number(row.quantity)} / ${number(row.received)} / ${number(Math.max(0,row.quantity-row.received))}`,<>{row.dueDate||'待核对'}<span className="subline">复期 {row.promisedDate||'待回复'}</span></>];})}/>:<EmptyRows>当前没有上述外协风险记录。</EmptyRows>}</div>{outsource.length>30&&<p className="supplier-ops-caption">这里列出前 30 笔，请进入外协工作区查看全部记录并跟进。</p>}</Section>
 </>;
}

function SamplesView({data,materials,onNavigate}:Props&{materials:PendingMaterial[]}){
 const projects=useQuery<ProjectResponse>({queryKey:['supplier-sample-projects'],queryFn:()=>request('customer-project-data')}),[query,setQuery]=useState(''),[page,setPage]=useState(0);
 const samples=[...new Map([...(projects.data?.samples||[]),...(projects.data?.internalSamples||[])].map(row=>[row.id,row])).values()].filter(row=>row.status!=='cancelled');
 const baseSampleRows=samples.filter(row=>matches([row.sampleNo,row.note,...(Array.isArray(row.itemSnapshot)?row.itemSnapshot:[]).flatMap((item:Entity)=>[item.model,item.customerModel,item.drawing,item.material])].join(' '),query));
 const clues=materials.filter(row=>row.sampleEvidence),statuses:Record<string,string>={pending:'待内部接单',accepted:'已接单',making:'制作中',qc:'检验中',ready:'可寄样',closed:'内部完成',cancelled:'已取消'};
 const columnModel=useColumnPage(baseSampleRows,row=>[
  `${row.sampleNo||'未编号'} ${statuses[row.status]||row.status||'待核对'}`,
  Array.isArray(row.itemSnapshot)&&row.itemSnapshot.length?row.itemSnapshot.map((item:Entity)=>`${item.model||item.customerModel||'款号待核对'} / ${item.color||'色号待核对'} · ${item.quantity} 副 · ${item.material||'材质待核对'}${item.drawing?' / '+item.drawing:''}`).join(' '):'尚未冻结款色与材料快照',
  data.members.find(member=>member.id===row.ownerId)?.name||'待核对',`${row.requiredDate||'待定'} 计划 ${row.plannedDate||'待安排'}`,row.note||'—','查看样办',
 ],page,setPage,15),sampleRows=columnModel.rows;
 useEffect(()=>setPage(0),[query,samples.length]);
 return <>
  <Metrics items={[["可见样办单",samples.length,'来自客户项目样办记录'],['进行中的样办',samples.filter(row=>!['ready','closed'].includes(row.status)).length,'按已登记内部状态'],['采购样办线索',clues.length,'商品 / 规格 / 备注含关键词'],['线索涉及供应商',new Set(clues.map(row=>row.supplier).filter(Boolean)).size,'按最新采购快照']]}/>
  <Section title="实际样办与新品交接" description="样办单来自现有客户项目；采购源表关键词只作备料线索，不自动建立或放行样办。" actions={<Button variant="outline" size="sm" onClick={()=>onNavigate('customer-projects')}>打开客户项目<ArrowRight size={15}/></Button>}>
   {projects.isError?<div className="error p-4" role="alert">样办记录读取失败：{(projects.error as Error).message} <button onClick={()=>void projects.refetch()}>重试</button></div>:projects.isPending?<EmptyRows>正在读取可见样办记录…</EmptyRows>:<><div className="supplier-ops-filters p-4"><label>查找样办<input aria-label="搜索样办备料" value={query} onChange={e=>setQuery(e.target.value)} placeholder="样办单号 / 款号 / 图号 / 材质"/></label></div><div className="supplier-ops-table">{showFilteredTable(columnModel)?<Grid filterModel={columnModel} headers={['样办单 / 状态','冻结款色 / 材料','负责人','要求 / 内部计划','交接备注','项目']} rows={sampleRows.slice(page*15,page*15+15).map(row=>[<><b>{row.sampleNo||'未编号'}</b><span className="subline">{statuses[row.status]||row.status||'待核对'}</span></>,<div className="supplier-ops-wrap">{(Array.isArray(row.itemSnapshot)?row.itemSnapshot:[]).map((item:Entity,index:number)=><span className="subline" key={item.id||index}>{item.model||item.customerModel||'款号待核对'} / {item.color||'色号待核对'} · {item.quantity} 副 · {item.material||'材质待核对'}{item.drawing?' / '+item.drawing:''}</span>)}{!row.itemSnapshot?.length&&'尚未冻结款色与材料快照'}</div>,data.members.find(member=>member.id===row.ownerId)?.name||'待核对',<>{row.requiredDate||'待定'}<span className="subline">计划 {row.plannedDate||'待安排'}</span></>,<div className="supplier-ops-wrap">{row.note||'—'}</div>,<Button variant="outline" size="sm" onClick={()=>onNavigate('customer-projects',{projectId:row.projectId,tab:'samples'})}>查看样办</Button>])}/>:<EmptyRows>当前授权范围暂无符合筛选的样办单。可在客户项目中登记或查看已下达样办。</EmptyRows>}</div><Pager count={sampleRows.length} page={page} setPage={setPage} size={15}/></>}
  </Section>
  <MaterialTable rows={clues} title="采购样办 / 新品线索" description="从商品名称、规格、备注识别“样办、样板、打样、试产、新品、新款”等文字。未命中关键词的采购仍可在物料页查找；此处不推断实际样办状态。"/>
 </>;
}

function ReconciliationView({data,materials,onNavigate}:Props&{materials:PendingMaterial[]}){
 const purchases=useQuery<{rows:Purchase[]}>({queryKey:['purchases'],queryFn:()=>request('purchase-data')});
 const [query,setQuery]=useState(''),[page,setPage]=useState(0),[receiptPage,setReceiptPage]=useState(0),[selected,setSelected]=useState<Purchase|null>(null);
 const history=useQuery<{events:Entity[];edits:Entity[]}>({queryKey:['supplier-reconciliation-history',selected?.id],queryFn:()=>request('purchase-history?id='+encodeURIComponent(selected!.id)),enabled:!!selected});
 const oldRows=purchases.data?.rows||[],baseRows=oldRows.filter(row=>matches([row.po,row.supplier,row.itemCode,row.itemName,row.customerOrder,row.sourceFile].join(' '),query)),baseReceipts=(data.receipts||[]).filter(row=>matches([row.supplier,row.deliveryNo,...(row.lines||[]).map((line:Entity)=>line.orderNo)].join(' '),query)).slice().reverse();
 const columnModel=useColumnPage(baseRows,row=>[`${row.po} ${row.supplier}`,`${row.itemName} ${row.itemCode} · ${row.unit}`,`${row.sourceAsOf} 源行 ${row.sourceRow}`,number(row.quantity),row.balanceKnown?number(row.received):'待核对',`${number(remaining(row))} 退补 ${row.balanceKnown?number(row.returnPending):'待核对'}`,'收货留痕'],page,setPage),filtered=columnModel.rows;
 const receiptModel=useColumnPage(baseReceipts,receipt=>[
  `${receipt.deliveryNo} ${receipt.supplier}`,`${receipt.receivedDate} ${receipt.status}`,
  (receipt.lines||[]).map((line:Entity)=>`${line.orderNo} / ${line.drawing} / ${processName(line.process)}`).join(' '),
  `${number((receipt.lines||[]).reduce((sum:number,line:Entity)=>sum+Number(line.accepted||0),0))} / ${number((receipt.lines||[]).reduce((sum:number,line:Entity)=>sum+Number(line.rejected||0),0))}`,
  `${receipt.actor} ${dateTime(receipt.createdAt)}`,receipt.photoId?'打开送货凭证':'原件待核对',
 ],receiptPage,setReceiptPage),receipts=receiptModel.rows;
 useEffect(()=>{setPage(0);setReceiptPage(0);},[query,oldRows.length,data.receipts.length]);
 return <>
  <Metrics items={[["本次源表明细",materials.length,'最新金蝶采购快照'],['已登记送货凭证',data.receipts.length,'中台外协收货记录'],['历史收货已核对',oldRows.filter(row=>row.balanceKnown).length,'原有采购台账'],['历史收货待核对',oldRows.filter(row=>!row.balanceKnown).length,'未知数量保留待核对']]}/>
  <div className="supplier-ops-source">本页用于采购与收货数量、凭证及来源核对。当前源表没有单价、税额、发票和付款数据，金额对账请结合金蝶对应单据核实。</div>
  <div className="supplier-ops-filters"><label>检索凭证或历史采购<input aria-label="搜索采购对账记录" value={query} onChange={e=>setQuery(e.target.value)} placeholder="供应商 / 采购单 / 送货单 / 商品 / 客户订单"/></label><BusinessTeamDownloadButton variant="outline" href={'/api/workspace/purchase-export?'+new URLSearchParams({mode:'active',q:query})}><Download size={16}/>按上方条件导出历史采购核对表</BusinessTeamDownloadButton></div>
  <Section title={`历史采购收货与退补 · ${filtered.length} 行`} description="逐条显示历史来源截至日；这些记录不会用来替代最新金蝶未上货快照。" actions={<Button variant="outline" size="sm" onClick={()=>onNavigate('supplier-followup')}>维护采购台账<ArrowRight size={15}/></Button>}>
   {purchases.isError?<div className="error p-4" role="alert">采购台账读取失败：{(purchases.error as Error).message} <button onClick={()=>void purchases.refetch()}>重试</button></div>:purchases.isPending?<EmptyRows>正在读取历史采购台账…</EmptyRows>:<div className="supplier-ops-table">{showFilteredTable(columnModel)?<Grid filterModel={columnModel} headers={['采购单 / 供应商','物料 / 单位','来源截至 / 源行','采购数量','净合格已收','剩余 / 退补','留痕']} rows={filtered.slice(page*20,page*20+20).map(row=>[<><b>{row.po}</b><span className="subline">{row.supplier}</span></>,<div className="supplier-ops-wrap">{row.itemName}<span className="subline">{row.itemCode} · {row.unit}</span></div>,<>{row.sourceAsOf}<span className="subline">源行 {row.sourceRow}</span></>,number(row.quantity),row.balanceKnown?number(row.received):'待核对',<>{number(remaining(row))}<span className="subline">退补 {row.balanceKnown?number(row.returnPending):'待核对'}</span></>,<Button variant="outline" size="sm" onClick={()=>setSelected(row)}><FileText size={15}/>收货留痕</Button>])}/>:<EmptyRows>暂无符合筛选的历史采购记录。</EmptyRows>}</div>}<Pager count={filtered.length} page={page} setPage={setPage}/>
  </Section>
  <Section title={`外协送货单凭证 · ${receipts.length} 份`} description="打开已上传凭证，按供应商、送货单号及对应订单核对合格与不良数量。"><div className="supplier-ops-table">{showFilteredTable(receiptModel)?<Grid filterModel={receiptModel} headers={['送货单 / 供应商','收货日期 / 状态','订单 / 工序','合格 / 不良','经办人','凭证']} rows={receipts.slice(receiptPage*20,receiptPage*20+20).map(receipt=>[<><b>{receipt.deliveryNo}</b><span className="subline">{receipt.supplier}</span></>,<>{receipt.receivedDate}<span className="subline">{receipt.status}</span></>,<div className="supplier-ops-wrap">{(receipt.lines||[]).map((line:Entity,index:number)=><span className="subline" key={index}>{line.orderNo} / {line.drawing} / {processName(line.process)}</span>)}</div>,`${number((receipt.lines||[]).reduce((sum:number,line:Entity)=>sum+Number(line.accepted||0),0))} / ${number((receipt.lines||[]).reduce((sum:number,line:Entity)=>sum+Number(line.rejected||0),0))}`,<>{receipt.actor}<span className="subline">{dateTime(receipt.createdAt)}</span></>,receipt.photoId?<a className="text-link" href={'/api/workspace/ledger-file?id='+encodeURIComponent(receipt.photoId)} target="_blank" rel="noreferrer">打开送货凭证</a>:'原件待核对'])}/>:<EmptyRows>当前范围暂无符合筛选的送货单凭证。</EmptyRows>}</div><Pager count={receipts.length} page={receiptPage} setPage={setReceiptPage}/></Section>
  <MaterialTable rows={materials} initialQuery={query} title="最新金蝶采购源行核对"/>
  <Dialog open={!!selected} onOpenChange={open=>{if(!open)setSelected(null);}}><DialogContent className="dialog-scroll sm:max-w-[850px]"><DialogHeader><DialogTitle>采购收货留痕</DialogTitle><DialogDescription>{selected?.po} · {selected?.itemName} · 源表截至 {selected?.sourceAsOf} / 源行 {selected?.sourceRow}</DialogDescription></DialogHeader>{history.isPending?<p>正在读取登记历史…</p>:history.isError?<p className="error" role="alert">{(history.error as Error).message}</p>:<div className="supplier-ops-timeline">{history.data?.events.length?history.data.events.map(event=><article key={event.id}><b>{event.event} · {number(event.quantity)} {selected?.unit}</b><p>{event.date} · {event.reference} · {event.actor}</p><p>{event.note}</p><small>登记后净合格 {number(event.after.received)} · 退补 {number(event.after.pending)} · 剩余 {number(event.after.remaining)}</small></article>):<p>尚无收货登记留痕；没有核对基数的明细保持“待核对”。</p>}{!!history.data?.edits.length&&<h3>采购跟进 / 存档留痕</h3>}{history.data?.edits.map(event=><article key={event.id}><b>{event.action}</b><p>{event.actor} · {dateTime(event.createdAt)}</p><p>{event.source}</p></article>)}</div>}</DialogContent></Dialog>
 </>;
}
