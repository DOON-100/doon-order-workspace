// JSON read views only. Authorization and redaction belong to their original
// handlers, including row/customer/price permissions. Never query raw rows here.
export const workflowSources=[
 ['data','订单、报工、外发、收货与基础资料'],['purchase-data','采购跟单'],['pmc-data','PMC 核单与排期'],['factory-orders','工厂内部订单'],
 ['kingdee-pending-data','金蝶待核对'],['customer-workflow-data','客户档案与客户跟进'],['customer-workflow-tasks','客户待办'],['customer-workflow-transfers','客户公海与交接'],
 ['customer-project-data','客户项目'],['project-collaboration-data','项目协作'],['customer-project-followup-data','项目跟进与邮件'],['project-finance-data','项目财务'],
 ['customer-quotes','客户报价'],['customer-quote-completed','已完成报价'],['customer-quote-templates','报价模板'],['customer-price-archive','历史价格与发票依据'],
 ['service-data','客服业务与收款'],['drawing-data','工程画图'],['sop-data','工程 SOP'],['planning-control-data','计划与产能'],
 ['ar-workspace-data','应收工作台'],['ar-dashboard-data','应收分析'],['payment-terms-data','付款条款'],['handoff-business-data','业务交接与单据'],['handoff-business-review-data','生产审核'],
 ['framework-channels','沟通渠道'],['framework-notices','业务通知'],['framework-knowledge','规则文档'],['framework-finance-tasks','财务任务'],['framework-offboarding','离职交接'],
 ['fixed-data-tools','固定数据工具'],['finished-supplier-data','成品外发工作台'],['business-team-data','业务小组'],['framework-settings','系统业务配置'],
].map(([id,label])=>({id,label,scopeParams:['customer-workflow-data','customer-workflow-tasks','customer-price-archive'].includes(id)?['customerId']:['ar-workspace-data','ar-dashboard-data'].includes(id)?['customerId','teamId']:[]}));

// Local preview samples are public synthetic records, never a production schema
// or proof of access. The connected gateway replaces this entire provider.
export function syntheticSource(source){
 const base={id:'SYN-'+source,kind:source,version:2,status:'待核查',title:'合成记录',customerId:'SYN-CUSTOMER',updatedAt:'2026-10-18T09:00:00Z'};
 const special=source==='purchase-data'?{po:'SYN-PO',supplier:'合成供应商',quantity:120,received:90,remaining:30,returnPending:0,balanceKnown:true,auditStatus:'已审核',closeStatus:'未关闭',expectedDate:'2026-10-25',promisedDate:'2026-10-20',followupNote:'合成跟进',lifecycle:'active'}:
 source==='data'?{orderNo:'SYN-ORDER',drawing:'SYN-SKU',quantity:120,requestedDate:'2026-10-25',plannedDate:'2026-10-24',stage:'生产中',ledger:{columns:{W:'合成产品',BF:'90'}},notes:'合成备注'}:
 source==='drawing-data'?{drawing:'SYN-DRAWING',status:'待确认',targetVersion:'B',dueDate:'2026-10-25'}:
 /finance|ar-|service/.test(source)?{amountCents:12000,receivedCents:3000,balanceCents:9000,currency:'USD',dueDate:'2026-10-25'}:
 {name:'合成'+workflowSources.find(s=>s.id===source)?.label,fields:{note:'合成业务字段',dueDate:'2026-10-25'},lines:[{id:'SYN-LINE',quantity:2,description:'合成明细'}]};
 return{records:[{...base,...special}],syntheticOnly:true};
}
