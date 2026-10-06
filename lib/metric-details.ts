import {canRead,productTypeOf,readsAllOrders,type Order,type Report,type Entity,type Member,type State} from './domain';
import {active,balance,warehouse,issues,currentStage,ownerLabel,dateValue,colLabels} from './ledger';
import {factoryName} from './manufacturing';

export const metricDefinitions={
 orders:{title:'有效订单',unit:'项',description:'按订单号去重',rule:'当前可见的在制、未取消订单；按订单号去重。订单汇总可展开到款式、色号和镜片明细。'},
 progress:{title:'进行中明细',unit:'项',description:'按款式 / 颜色 / 镜片',rule:'当前可见的在制、未取消订单中，出货欠数大于 0 的明细。欠数无法计算时沿用总表的订单数量口径。'},
 warehouse:{title:'已包装入仓',unit:'副',description:'原表 BF · MES 报工另列',rule:'当前可见的在制、未取消订单中，原表 BF 包装入仓数量大于 0 的明细，卡片显示 BF 合计。MES 报工单独展示，不计入 BF。'},
 review:{title:'待核对明细',unit:'项',description:'原表异常及 MES 核对',rule:'每条异常订单计 1 项（多种异常合并展示），每条未匹配 MES 报工计 1 项，每条未驳回且未完成回读核验的更正计 1 项；同一订单可能有不同待办。'},
} as const;
export type MetricKey=keyof typeof metricDefinitions;
export type MetricSource={orders:Order[];reports:Report[];corrections:Entity[];comments:Entity[]};
export type MetricRow={id:string;lineId:string;values:Record<string,string|number|null>};
export type MetricFilters={q?:string;customer?:string;owner?:string;stage?:string;issue?:string;orderNo?:string};
export const detailColumns=['订单号','事项类型','客户','生产厂','原表行号','产品类型','图纸编号','色号','圈色','镜片','跟单员','订单数量','包装入仓数量 BF','包装入仓日期 BG','出货欠数','当前工序','PMC排期','客户要求交期','回复交期','状态备注','核对原因','处理状态','待跟进事项','跟进期限','最近跟进记录','报工良品数','报工时间','审批状态','记录编号','明细编号','版本','数据更新时间'];
export const followupColumns=['责任部门（跟进填写）','跟进责任人（跟进填写）','计划完成日期（跟进填写）','跟进结果（跟进填写）'];
export const processColumns=['AC','AD','AE','AF','AG','AH','AI','AJ','AK','AL','AM','AN','AO','AP','AQ','AR','AS','AT','AU','AV','AW','AX','AY','AZ','BA','BB','BC','BD','BE','BH','BI'];
export const summaryColumns=['订单号','客户','生产厂','产品类型','跟单员','明细条数','订单数量','包装入仓数量 BF','出货欠数','欠数待核对条数','异常明细条数','最早客户交期','最近PMC排期'];

// Both the cards and their exports consume this projection. Always authorize first.
export function metricSource(s:State,m:Member):MetricSource{
 const orders=s.records.filter(r=>r.kind==='order'&&canRead(m,r as Order)) as Order[],ids=new Set(orders.map(o=>o.id));
 return {orders,reports:s.records.filter(r=>r.kind==='report'&&(readsAllOrders(m)||ids.has(r.lineId))) as Report[],corrections:s.records.filter(r=>r.kind==='correction'&&ids.has(r.lineId)),comments:s.records.filter(r=>r.kind==='comment'&&ids.has(r.lineId))};
}
const text=(v:unknown)=>String(v??'');
export function metricRows(kind:MetricKey,source:MetricSource):MetricRow[]{
 const allOrders=new Map(source.orders.map(o=>[o.id,o]));
 const comments=new Map<string,Entity[]>();
 for(const c of source.comments){const list=comments.get(c.lineId)||[];list.push(c);comments.set(c.lineId,list);}
 const reportTotals=new Map<string,number>();
 for(const r of source.reports)if(['已审批','审批完成'].includes(r.approval))reportTotals.set(r.lineId,(reportTotals.get(r.lineId)||0)+r.quantity);
 const orderRow=(o:Order,type='订单明细',id=o.id):MetricRow=>{
  const c=o.ledger?.columns||{},notes=(comments.get(o.id)||[]).slice().sort((a,b)=>text(a.createdAt).localeCompare(text(b.createdAt))),todo=notes.filter(n=>!n.done),latest=notes.at(-1);
  const values:MetricRow['values']={'事项类型':type,'订单号':o.orderNo,'客户':o.customer,'生产厂':factoryName(o),'原表行号':o.ledger?.sourceRow??'','产品类型':productTypeOf(o),'图纸编号':o.drawing,'色号':o.color,'圈色':c.X||'','镜片':o.lens,'跟单员':ownerLabel(o),'订单数量':o.quantity,'包装入仓数量 BF':warehouse(o),'包装入仓日期 BG':dateValue(c.BG)||c.BG||'','出货欠数':balance(o,source.reports),'当前工序':currentStage(o),'PMC排期':o.plannedDate,'客户要求交期':o.requestedDate,'回复交期':o.promiseConfirmed?o.promisedDate:'待确认','状态备注':o.notes,'核对原因':issues(o).join('；'),'处理状态':type==='订单异常'?'待核对':'','待跟进事项':todo.map(n=>text(n.text)).join('\n'),'跟进期限':todo.map(n=>text(n.dueDate)).filter(Boolean).sort()[0]||'','最近跟进记录':latest?`${latest.actor||''}：${latest.text}`:'','报工良品数':reportTotals.get(o.id)??0,'报工时间':'','审批状态':'','记录编号':id,'明细编号':o.id,'版本':o.version,'数据更新时间':o.updatedAt};
  for(const col of processColumns)values[`${col} · ${colLabels[col]}`]=/日期|交期|齐期|完成日|桶日|胶日|成品日|结单日|投产日/.test(colLabels[col]||'')?(dateValue(c[col])||c[col]||''):(c[col]||'');
  return {id,lineId:o.id,values};
 };
 const orders=source.orders.filter(active);
 if(kind!=='review')return orders.filter(o=>kind==='progress'?(balance(o,source.reports)??o.quantity)>0:kind==='warehouse'?(warehouse(o)??0)>0:true).map(o=>orderRow(o));
 const rows=orders.filter(o=>issues(o).length).map(o=>orderRow(o,'订单异常'));
 for(const r of source.reports.filter(r=>!r.lineId))rows.push({id:r.id,lineId:'',values:{'事项类型':'MES 未匹配报工','订单号':r.orderNo,'图纸编号':r.drawing,'色号':r.color,'镜片':r.lens,'核对原因':'尚未关联到唯一订单明细','处理状态':'待匹配','报工良品数':r.quantity,'报工时间':r.reportedAt,'审批状态':r.approval,'记录编号':r.id,'明细编号':'','版本':r.version,'数据更新时间':r.updatedAt,'工单号':r.workOrder,'工序':r.process,'生产任务号':r.task,'生产批号':r.batch}});
 for(const c of source.corrections.filter(c=>!['已驳回','导出回读已核验'].includes(c.status))){const o=allOrders.get(c.lineId);if(!o)continue;const row=orderRow(o,'MES 更正待办',c.id);Object.assign(row.values,{'核对原因':c.reason||'更正尚未完成回读核验','处理状态':c.status||'待处理','更正前数量':c.before??'','建议更正数量':c.proposed??'','更正申请人':c.actor||'','更正申请时间':c.createdAt||'','更正审核意见':c.reviewNote||'','报工记录编号':c.reportId||''});rows.push(row);}
 return rows;
}
export function filterMetricRows(rows:MetricRow[],f:MetricFilters){const q=(f.q||'').trim().toLowerCase();return rows.filter(({values:v})=>(!q||Object.values(v).some(x=>text(x).toLowerCase().includes(q)))&&(!f.customer||v['客户']===f.customer)&&(!f.owner||v['跟单员']===f.owner)&&(!f.stage||v['当前工序']===f.stage)&&(!f.issue||v['事项类型']===f.issue)&&(!f.orderNo||v['订单号']===f.orderNo));}
export function sortMetricRows(rows:MetricRow[],key:string,descending=false){return rows.slice().sort((a,b)=>{const x=a.values[key],y=b.values[key],n=typeof x==='number'&&typeof y==='number'?x-y:text(x).localeCompare(text(y),'zh-CN',{numeric:true});return (descending?-n:n)||a.id.localeCompare(b.id);});}
export function metricValue(kind:MetricKey,rows:MetricRow[]){return kind==='orders'?new Set(rows.map(r=>r.values['订单号'])).size:kind==='warehouse'?rows.reduce((n,r)=>n+(Number(r.values['包装入仓数量 BF'])||0),0):rows.length;}
export function metricSummary(rows:MetricRow[]):MetricRow[]{
 const groups=new Map<string,MetricRow[]>();for(const r of rows){const k=text(r.values['订单号']),g=groups.get(k)||[];g.push(r);groups.set(k,g);}
 return [...groups].map(([id,group])=>{const sum=(k:string)=>group.reduce((n,r)=>n+(Number(r.values[k])||0),0),unique=(k:string)=>[...new Set(group.map(r=>text(r.values[k])).filter(Boolean))].join('、'),dates=(k:string)=>group.map(r=>text(r.values[k])).filter(Boolean).sort();return {id,lineId:'',values:{'订单号':id,'客户':unique('客户'),'生产厂':unique('生产厂'),'产品类型':unique('产品类型'),'跟单员':unique('跟单员'),'明细条数':group.length,'订单数量':sum('订单数量'),'包装入仓数量 BF':sum('包装入仓数量 BF'),'出货欠数':sum('出货欠数'),'欠数待核对条数':group.filter(r=>r.values['出货欠数']===null).length,'异常明细条数':group.filter(r=>r.values['核对原因']).length,'最早客户交期':dates('客户要求交期')[0]||'','最近PMC排期':dates('PMC排期').at(-1)||''}};});
}
