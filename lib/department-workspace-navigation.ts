import type {Member} from './domain';
import {departmentNavigationContext,resolveWorkspaceView,type WorkspaceNavigationContext} from './handoff-navigation';
import {productionPlanningNavigation,type PlanningNavigationItem} from './production-planning';
import {supplierWorkspaceNavigation} from './supplier-workspace';

export type DepartmentNavigationItem={
 id:string;label:string;icon:string;view:string;context?:WorkspaceNavigationContext;source:'existing'|'process';
};
export type DepartmentNavigationGroup={id:string;label:string;icon:string;phase:string;children:DepartmentNavigationItem[]};
export type DepartmentNavigationMatch={department:DepartmentNavigationGroup;item:DepartmentNavigationItem};

/** Departments are presentation groups. They never replace a business route or a record type. */
export const departmentWorkspaceGroups=[
 {id:'overview',label:'工作总览',icon:'home',phase:'全流程与个人事项'},
 {id:'sales',label:'业务部',icon:'business',phase:'客户开发 → 需求与报价'},
 {id:'service',label:'客服与单证',icon:'support',phase:'订单评审 → 制单交接 → 售后复盘'},
 {id:'engineering',label:'工程部',icon:'engineering',phase:'图纸 → 样品与资料确认'},
 {id:'planning',label:'PMC 计划',icon:'production',phase:'订单接收 → 齐套与排程'},
 {id:'purchasing',label:'采购与外协',icon:'truck',phase:'采购 → 催料与外发'},
 {id:'warehouse',label:'仓储物流',icon:'shipment',phase:'收货 → 仓储与发运'},
 {id:'production',label:'生产车间',icon:'factory',phase:'工序流转 → 报工与损耗'},
 {id:'quality',label:'品质部',icon:'document',phase:'来料 → 过程与出货放行'},
 {id:'finance',label:'财务部',icon:'finance',phase:'对账 → 应收与回款'},
 {id:'management',label:'系统管理',icon:'settings',phase:'规则 → 账号与系统维护'},
] as const;
export type WorkspaceDepartmentId=typeof departmentWorkspaceGroups[number]['id'];

const departmentRouteOrder:Record<WorkspaceDepartmentId,readonly string[]>={
 overview:['workbench','business-process','personal-tasks','dashboard','reports'],
 sales:['customers','customer-projects','process-rfq','sales','customer-quotes','customer-price-archive','mail','whatsapp','communications'],
 service:['service','service-workspace','service-followups','order-confirmations','factory-orders','kingdee-sales','production-orders','documents','process-complaint','completed'],
 engineering:['engineering-materials','engineering-drawings','process-sample','process-engineering-change'],
 planning:['production-planning','pmc-handoff','process-material-kit','pmc','planning-control','orders','mine'],
 purchasing:['supplier-workspace','supplier-pending','supplier-followup','supplier-samples','supplier-kit','supplier-outsourcing','finished-outsourcing','supplier-risk'],
 warehouse:['receiving','process-warehouse','process-packaging','production-shipments','logistics-waybills','shipment-followups'],
 production:['department','mes','losses'],
 quality:['process-iqc','process-first-article','process-process-quality','process-outsourcing-quality','process-oqc','process-shipment-release'],
 finance:['payment-terms','supplier-reconciliation','process-supplier-reconciliation','ar-workspace','service-receivables','project-finance','finance-documents'],
 management:['business-rules','imports','settings','members','maintenance','business-tools'],
};

/** These destinations already exist inside their original pages; surface them without remapping them. */
const existingNestedRoutes=[
 {id:'documents',label:'客户与内部单据',icon:'text',parents:['communications']},
 {id:'service-followups',label:'订单事项与跟进',icon:'support',parents:['service','service-workspace']},
 {id:'shipment-followups',label:'发运与签收跟进',icon:'truck',parents:['logistics-waybills']},
 {id:'service-receivables',label:'订单应收与核销',icon:'finance',parents:['finance-documents','ar-workspace']},
 {id:'project-finance',label:'项目结算',icon:'finance',parents:['finance-documents','ar-workspace']},
 {id:'payment-terms',label:'公司付款条件库',icon:'finance',parents:['customers']},
] as const;

export const departmentProcessEntries=[
 {tab:'rfq',label:'需求与询价评估',icon:'project',parents:['customer-projects','sales']},
 {tab:'sample',label:'样品与签样确认',icon:'engineering',parents:['engineering-drawings','engineering-materials']},
 {tab:'engineering-change',label:'工程变更与版本冻结',icon:'engineering',parents:['engineering-drawings','engineering-materials']},
 {tab:'material-kit',label:'齐料与开工条件确认',icon:'production',parents:['pmc','planning-control','receiving']},
 {tab:'warehouse',label:'仓储与收发料协同',icon:'orders',parents:['receiving','production-shipments']},
 {tab:'packaging',label:'包装与入仓核对',icon:'shipment',parents:['department','production-shipments']},
 {tab:'iqc',label:'来料检验 IQC',icon:'document',parents:['receiving']},
 {tab:'first-article',label:'首件与开工确认',icon:'document',parents:['department']},
 {tab:'process-quality',label:'过程检验与 QC-GATE',icon:'document',parents:['department']},
 {tab:'outsourcing-quality',label:'外协回厂检验',icon:'document',parents:['finished-outsourcing','receiving']},
 {tab:'oqc',label:'成品检验 OQC',icon:'document',parents:['department','production-shipments']},
 {tab:'shipment-release',label:'出货放行核对',icon:'shipment',parents:['production-shipments','logistics-waybills']},
 {tab:'supplier-reconciliation',label:'供应商结算核对',icon:'finance',parents:['receiving']},
 {tab:'complaint',label:'客诉与整改闭环',icon:'messages',parents:['service','service-workspace']},
] as const;

function flatten(items:readonly PlanningNavigationItem[]):PlanningNavigationItem[]{
 return items.flatMap(item=>[item,...flatten(item.children||[])]);
}

/**
 * The caller's filtered items remain authoritative for quotations, maintenance and owner tools.
 * Grouping is pure: no data fetch, record conversion, local storage, or permission changes.
 */
export function departmentWorkspaceNavigation(items:readonly PlanningNavigationItem[],member?:Member):DepartmentNavigationGroup[]{
 const original=flatten(items),navigation=supplierWorkspaceNavigation(productionPlanningNavigation(original,member),member);
 const visible=new Map<string,DepartmentNavigationItem>();
 for(const item of flatten(navigation))if(!visible.has(item.id))visible.set(item.id,{id:item.id,label:item.label,icon:item.icon,view:item.id,source:'existing'});
 const internal=!!member?.active&&member.role!=='supplier';
 if(internal){
  for(const item of existingNestedRoutes)if(!visible.has(item.id)&&item.parents.some(id=>visible.has(id)))visible.set(item.id,{id:item.id,label:item.label,icon:item.icon,view:item.id,source:'existing'});
  if(visible.has('workbench'))visible.set('business-process',{id:'business-process',label:'端到端业务总览',icon:'project',view:'business-process',source:'process'});
  for(const item of departmentProcessEntries)if(item.parents.some(id=>visible.has(id)))visible.set('process-'+item.tab,{id:'process-'+item.tab,label:item.label,icon:item.icon,view:'process-workspace',context:{tab:item.tab},source:'process'});
 }
 const claimed=new Set<string>();
 const groups=departmentWorkspaceGroups.map(group=>({...group,children:departmentRouteOrder[group.id].flatMap(id=>{const item=visible.get(id);if(!item||claimed.has(id))return [];claimed.add(id);return [item];})}));
 // Preserve newly supplied legacy entries even before a department placement is configured.
 const management=groups.find(group=>group.id==='management')!;
 for(const [id,item] of visible)if(!claimed.has(id)){management.children.push(item);claimed.add(id);}
 return groups.filter(group=>group.children.length>0);
}

/** Exact route + process tab wins before any legacy parent fallback. */
export function matchDepartmentWorkspaceNavigation(groups:readonly DepartmentNavigationGroup[],view:string,context:WorkspaceNavigationContext={},activeView?:string):DepartmentNavigationMatch|undefined{
 const resolved=resolveWorkspaceView(view,context);
 // A bare process-workspace renders the inquiry workbench; an explicit unknown tab stays unmatched.
 const processTab=resolved==='process-workspace'&&!context.tab?'rfq':context.tab;
 const match=(candidate:string)=>groups.flatMap(department=>department.children.map(item=>({department,item}))).find(({item})=>item.view===candidate&&(!item.context?.tab||item.context.tab===processTab));
 return match(resolved)||(resolved!=='process-workspace'&&activeView?match(activeView):undefined);
}

export function departmentWorkspaceBreadcrumb(groups:readonly DepartmentNavigationGroup[],view:string,context:WorkspaceNavigationContext={},activeView?:string){
 const matched=matchDepartmentWorkspaceNavigation(groups,view,context,activeView);
 return matched?{departmentId:matched.department.id,departmentLabel:matched.department.label,label:matched.item.label,view:matched.item.view,context:matched.item.context}:undefined;
}

/** Carry only customer/project/order scope across stages, never another page's record or tab. */
export function departmentWorkspaceNavigationContext(item:DepartmentNavigationItem,context:WorkspaceNavigationContext={}):WorkspaceNavigationContext{
 return {...departmentNavigationContext(context),...item.context};
}
