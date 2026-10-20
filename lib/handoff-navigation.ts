import type {Member} from './domain';
import {canUseFixedDataTools} from './fixed-data-tools-access';

/** Final visible navigation from the handoff's installed overrides. Stable intranet routes remain valid. */
export const handoffNavigation = [
 {id:'workbench',label:'工作台',group:'工作区',icon:'home'},
 {id:'mail',label:'邮箱',group:'工作区',icon:'mail'},
 {id:'whatsapp',label:'WhatsApp',group:'工作区',icon:'message'},
 {id:'communications',label:'统一沟通',group:'工作区',icon:'messages'},
 {id:'customers',label:'客户清单',group:'客户业务',icon:'customer'},
 {id:'customer-projects',label:'前期开发',group:'客户业务',icon:'project'},
 {id:'service',label:'客服订单',group:'客户业务',icon:'orders'},
 {id:'order-confirmations',label:'01_订单与PI',group:'客户业务',icon:'document',parent:'service'},
 {id:'engineering-materials',label:'02_工程资料',group:'客户业务',icon:'engineering',parent:'service'},
 {id:'production-orders',label:'03_生产单',group:'客户业务',icon:'production',parent:'service'},
 {id:'production-shipments',label:'04_生产出货单',group:'客户业务',icon:'shipment',parent:'service'},
 {id:'logistics-waybills',label:'05_物流与出货',group:'客户业务',icon:'truck',parent:'service'},
 {id:'finance-documents',label:'06_财务资料',group:'客户业务',icon:'finance',parent:'service'},
 {id:'business-rules',label:'知识与规则',group:'规则与管理',icon:'book'},
 {id:'settings',label:'系统设置',group:'规则与管理',icon:'settings'},
] as const;
/** Original workspace names stay one click away alongside the new department pages. */
export const directWorkspaceNavigation = [
 {id:'personal-tasks',label:'我的待办',icon:'production'},
 {id:'customer-projects',label:'客户项目开发',icon:'business'},
 {id:'sales',label:'业务工作台',icon:'business'},
 {id:'customer-quotes',label:'客户报价',icon:'chart'},
 {id:'customer-price-archive',label:'历史报价档案',icon:'text'},
 {id:'service-workspace',label:'客服工作台',icon:'support'},
 {id:'engineering-drawings',label:'工程画图部门',icon:'production'},
 {id:'factory-orders',label:'中英内部订单',icon:'languages'},
 {id:'customers',label:'客户责任清单',icon:'customer'},
 {id:'ar-workspace',label:'应收账款工作空间',icon:'finance'},
 {id:'pmc-handoff',label:'PMC 交接工作台',icon:'people'},
 {id:'pmc',label:'PMC 排期总表',icon:'production'},
 {id:'planning-control',label:'计划分析与协调',icon:'chart'},
 {id:'finished-outsourcing',label:'成品外发跟进总表',icon:'factory'},
 {id:'orders',label:'动态订单总表',icon:'home'},
 {id:'dashboard',label:'欠数与异常看板',icon:'chart'},
 {id:'department',label:'部门录入工作台',icon:'factory'},
 {id:'losses',label:'部门损耗月报',icon:'chart'},
 {id:'receiving',label:'供应商收货',icon:'upload'},
 {id:'completed',label:'已完成订单档案',icon:'production'},
 {id:'mine',label:'我的订单',icon:'production'},
 {id:'imports',label:'上传与更新',icon:'upload'},
 {id:'mes',label:'MES 核对',icon:'factory'},
 {id:'reports',label:'报表中心',icon:'chart'},
 {id:'members',label:'成员与权限',icon:'people'},
 {id:'maintenance',label:'系统维护',icon:'sliders'},
] as const;
const directWorkspaceIds=new Set<string>(directWorkspaceNavigation.map(item=>item.id));
export const workspaceNavigation=[
 handoffNavigation[0],
 ...directWorkspaceNavigation.map(item=>({...item,group:'工作空间'})),
 ...handoffNavigation.filter(item=>item.id!=='workbench'&&!directWorkspaceIds.has(item.id)),
];
/** Keep finished clerks' daily entry points above the long shared workspace list. */
export function memberWorkspaceNavigation(member?:Member){
 if(canUseFixedDataTools(member))return [...workspaceNavigation,{id:'business-tools',label:'业务工具',group:'规则与管理',icon:'sliders'} as const];
 if(!member?.active||member.role!=='clerk'||!member.departments?.includes('finished'))return workspaceNavigation;
 const priority=['finished-outsourcing','department'];
 return [workspaceNavigation[0],...priority.flatMap(id=>workspaceNavigation.filter(item=>item.id===id)),...workspaceNavigation.slice(1).filter(item=>!priority.includes(item.id))];
}
export const handoffDocumentViews = ['order-confirmations','engineering-materials','production-orders','production-shipments','logistics-waybills','finance-documents'] as const;
export type HandoffDocumentView = typeof handoffDocumentViews[number];
export function isHandoffDocumentView(view:string):view is HandoffDocumentView{return (handoffDocumentViews as readonly string[]).includes(view);}
export type WorkspaceNavigationContext={recordId?:string;customerId?:string;projectId?:string;orderId?:string;tab?:string};
export type WorkspaceNavigate=(view:string,context?:WorkspaceNavigationContext)=>void;
/** A new department stage keeps business scope, never another form's record/tab. */
export function departmentNavigationContext(context:WorkspaceNavigationContext):WorkspaceNavigationContext{const {recordId:_recordId,tab:_tab,...scope}=context;return scope;}
export const departmentTabs:Record<string,{view:string;label:string;phase:string}[]>={
 service:[{view:'service',label:'客服订单',phase:'订单总览'},{view:'service-workspace',label:'客服工作台',phase:'全部客服事项'},{view:'sales',label:'业务移交',phase:'业务 → 客服'},{view:'service-followups',label:'订单事项',phase:'客服跟进'}],
 'order-confirmations':[{view:'order-confirmations',label:'订单与 PI',phase:'客户下单'},{view:'imports',label:'订单表核对',phase:'资料录入'}],
 'engineering-materials':[{view:'engineering-materials',label:'工程资料',phase:'资料与采用版本'},{view:'engineering-drawings',label:'工程协作',phase:'接收 → 画图 → 审核 → SOP'}],
 'production-orders':[{view:'production-orders',label:'生产单',phase:'资料核对'},{view:'factory-orders',label:'中英生产单',phase:'客服制单'},{view:'pmc-handoff',label:'PMC 接收',phase:'移交与接收'},{view:'receiving',label:'采购与收货',phase:'备料'},{view:'pmc',label:'排期与进度',phase:'排产'},{view:'department',label:'部门工序',phase:'生产执行'},{view:'finished-outsourcing',label:'成品外发',phase:'外发执行'},{view:'losses',label:'损耗记录',phase:'工序核对'},{view:'dashboard',label:'欠数与异常',phase:'异常跟进'},{view:'orders',label:'生产总表',phase:'全部明细'},{view:'mine',label:'我的生产事项',phase:'负责明细'},{view:'mes',label:'MES 核对',phase:'工序核对'},{view:'completed',label:'完工档案',phase:'完成归档'}],
 'production-shipments':[{view:'production-shipments',label:'生产出货单',phase:'生产完成 → 出库'}],
 'logistics-waybills':[{view:'logistics-waybills',label:'物流与出货',phase:'制单 → 交付'},{view:'shipment-followups',label:'发运与签收',phase:'物流跟进'}],
 'finance-documents':[{view:'ar-workspace',label:'应收账款',phase:'组别 → 回款 → 贡献'},{view:'finance-documents',label:'财务资料',phase:'凭证归档'},{view:'project-finance',label:'项目结算',phase:'应收 → 到账 → 核销'},{view:'service-receivables',label:'订单应收',phase:'到账与核销'},{view:'reports',label:'业务报表',phase:'汇总与核对'}],
 documents:[{view:'documents',label:'客户与内部单据',phase:'资料 → 草稿 → 核对'},{view:'customer-quotes',label:'销售报价',phase:'工程报价 → 销售核对'},{view:'customer-price-archive',label:'历史价格档案',phase:'报价依据'}],
 settings:[{view:'settings',label:'系统设置',phase:'规则与配置'},{view:'members',label:'成员与权限',phase:'账号管理'},{view:'maintenance',label:'运行与备份',phase:'系统维护'}],
};
export function workspaceDepartment(view:string){return Object.entries(departmentTabs).find(([,tabs])=>tabs.some(tab=>tab.view===view))?.[0]||view;}
export function workspacePrimaryView(view:string){const department=workspaceDepartment(view);return department==='documents'?'communications':department;}
export function resolveWorkspaceView(requested:string,context:WorkspaceNavigationContext={}){let view=({rules:'business-rules',knowledge:'business-rules',home:'workbench',inbox:'communications',mailbox:'mail',accounts:'customers',projects:'customer-projects'} as Record<string,string>)[requested]||requested;const department=workspaceDepartment(view);if(view===department&&context.tab&&departmentTabs[department]?.some(t=>t.view===context.tab))view=context.tab;return view;}
export function readWorkspaceContext(search:string):WorkspaceNavigationContext{const params=new URLSearchParams(search),result:WorkspaceNavigationContext={};for(const key of ['recordId','customerId','projectId','orderId','tab'] as const){const value=params.get(key);if(value&&value.length<=160)result[key]=value;}return result;}

/** Existing production capabilities retained as secondary tools; no legacy route or record is removed. */
export const existingBusinessTools = [
 {id:'sales',label:'业务工作台',group:'业务与客服',detail:'原业务交接、客户责任和订单协作'},
 {id:'customer-quotes',label:'客户报价',group:'业务与客服',detail:'中英报价明细、审批与正式版本'},
 {id:'customer-price-archive',label:'历史报价档案',group:'业务与客服',detail:'原有价格来源和历史报价记录'},
 {id:'factory-orders',label:'中英内部订单',group:'业务与客服',detail:'中文工艺、客服确认与内部交接'},
 {id:'engineering-drawings',label:'工程画图部门',group:'工程与生产',detail:'需求、画图、审批和历史版本'},
 {id:'pmc-handoff',label:'PMC 交接工作台',group:'工程与生产',detail:'订单接收、检查和交接记录'},
 {id:'pmc',label:'PMC 排期总表',group:'工程与生产',detail:'生产准备、计划与原有总表'},
 {id:'planning-control',label:'计划分析与协调',group:'工程与生产',detail:'产能与变更方案、周计划、试产及交付依据'},
 {id:'finished-outsourcing',label:'成品外发跟进总表',group:'工程与生产',detail:'外发任务、供应商回复和进度'},
 {id:'orders',label:'动态订单总表',group:'工程与生产',detail:'原有全部在制明细与工序进度'},
 {id:'dashboard',label:'欠数与异常看板',group:'工程与生产',detail:'包装欠数、超期和异常事项'},
 {id:'department',label:'部门录入工作台',group:'工程与生产',detail:'各工序获授权字段与录入记录'},
 {id:'losses',label:'部门损耗月报',group:'工程与生产',detail:'损耗确认、冲减与逐笔凭证'},
 {id:'receiving',label:'供应商收货',group:'工程与生产',detail:'采购、收货、跟进和历史凭证'},
 {id:'completed',label:'已完成订单档案',group:'记录与报表',detail:'已归档订单及历史内容'},
 {id:'mine',label:'我的订单',group:'记录与报表',detail:'当前成员负责的订单明细'},
 {id:'imports',label:'上传与更新',group:'记录与报表',detail:'原工作表导入、差异检查与回传'},
 {id:'mes',label:'MES 核对',group:'记录与报表',detail:'MES 文件核对及来源记录'},
 {id:'reports',label:'报表中心',group:'记录与报表',detail:'导出报表与已保存版本'},
 {id:'members',label:'成员与权限',group:'管理',detail:'现有员工账号、权限与客户范围'},
 {id:'maintenance',label:'系统维护',group:'管理',detail:'运行状态、共享数据库与备份检查'},
] as const;
