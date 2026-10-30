import type {Member} from './domain';
import {PRODUCTION_PLANNING_ID,type PlanningNavigationItem} from './production-planning';

export const SUPPLIER_WORKSPACE_ID='supplier-workspace';
export const SUPPLIER_WORKSPACE_TITLE='供应商管理工作台';
export const supplierWorkspaceSpaces=[
 {id:'supplier-pending',label:'采购未上货订单总表',area:'采购与交期',icon:'upload',detail:'按金蝶来源快照核对全部采购未上货明细、原表字段与导出范围。'},
 {id:'supplier-followup',label:'供应商与交期跟催',area:'采购与交期',icon:'people',detail:'维护供应商资料、承诺交期、最新复期与催交事项。'},
 {id:'supplier-kit',label:'眼镜物料齐套与欠料',area:'制造与备料',icon:'production',detail:'按订单、款号与物料规格核对板料、钛料、铰链、配件和包材欠料。'},
 {id:'supplier-semifinished',label:'钛架部',area:'半成品外发',icon:'factory',detail:'跟进钛焊、打磨和钛配套的外发、供应商复期与回货。'},
 {id:'supplier-semifinished-plastic',label:'胶架部',area:'半成品外发',icon:'factory',detail:'跟进脾加工、车房、出桶配套和钉装磨胶的外发、供应商复期与回货。'},
 {id:'supplier-plating',label:'电镀外发与回货',area:'电镀外发',icon:'factory',detail:'独立跟进电镀工序的外发数量、供应商交期、未回货和送货凭证。'},
 {id:'supplier-outsourcing',label:'外协加工与未回货',area:'制造与备料',icon:'factory',detail:'跟进外协加工、电镀、PVD、喷涂的送出、回厂与检验节点。'},
 {id:'supplier-risk',label:'采购异常与供应风险',area:'异常与新品',icon:'chart',detail:'汇总采购原表交期和信息缺失线索，核对外协逾期、复期与审批状态。'},
 {id:'supplier-samples',label:'样办与新品备料',area:'异常与新品',icon:'engineering',detail:'核对样办与试产清单、工程版本、供货承诺和物料变更。'},
 {id:'supplier-reconciliation',label:'采购单据与对账',area:'单据与对账',icon:'finance',detail:'核对采购原始源行、历史收货与退补留痕，以及实际外协送货凭证。'},
] as const;
export type SupplierWorkspaceView=typeof SUPPLIER_WORKSPACE_ID|typeof supplierWorkspaceSpaces[number]['id'];
const supplierIds=new Set<string>(supplierWorkspaceSpaces.map(item=>item.id));
export function isSupplierWorkspaceView(view:string):view is SupplierWorkspaceView{return view===SUPPLIER_WORKSPACE_ID||supplierIds.has(view);}
export function supplierWorkspaceTitle(view:string){return view===SUPPLIER_WORKSPACE_ID?SUPPLIER_WORKSPACE_TITLE:supplierWorkspaceSpaces.find(item=>item.id===view)?.label;}
/** Internal members use the existing receiving entry and its server-enforced record scope. */
export function canSeeSupplierWorkspace(member?:Member){return !!member?.active&&member.role!=='supplier';}
const containsReceiving=(item:PlanningNavigationItem):boolean=>item.id==='receiving'||!!item.children?.some(containsReceiving);
/** Add a separate hierarchy without moving or repurposing any legacy receiving destination. */
export function supplierWorkspaceNavigation(items:readonly PlanningNavigationItem[],member?:Member):PlanningNavigationItem[]{
 const result=items.filter(item=>!isSupplierWorkspaceView(item.id));
 if(!canSeeSupplierWorkspace(member)||!result.some(containsReceiving))return result;
 const parent:PlanningNavigationItem={id:SUPPLIER_WORKSPACE_ID,label:SUPPLIER_WORKSPACE_TITLE,group:'工作空间',icon:'truck',children:supplierWorkspaceSpaces.map(space=>({id:space.id,label:space.label,group:'工作空间',icon:space.icon,parent:SUPPLIER_WORKSPACE_ID}))};
 const planningIndex=result.findIndex(item=>item.id===PRODUCTION_PLANNING_ID),receivingIndex=result.findIndex(containsReceiving);
 result.splice((planningIndex>=0?planningIndex:receivingIndex)+1,0,parent);
 return result;
}
