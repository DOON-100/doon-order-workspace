import type {Member} from './domain';

export const PRODUCTION_PLANNING_ID='production-planning';
export const PRODUCTION_PLANNING_TITLE='度昂生产计划工作台';
export const productionPlanningSpaces=[
 {id:'pmc-handoff',label:'PMC 交接工作台',area:'订单与排程',detail:'接收客服移交，核对生产要求与交接事项。'},
 {id:'pmc',label:'PMC 排期总表',area:'订单与排程',detail:'统一安排交期、齐料日期和投产计划。'},
 {id:'orders',label:'动态订单总表',area:'订单与排程',detail:'查看在制订单、工序进度与包装入仓情况。'},
 {id:'mine',label:'我的订单',area:'订单与排程',detail:'跟进本人负责的订单明细与待办。'},
 {id:'receiving',label:'供应商收货',area:'齐料与生产执行',detail:'跟进采购、供应商交货、收货与核对凭证。'},
 {id:'department',label:'部门录入工作台',area:'齐料与生产执行',detail:'各部门维护工序实绩，衔接生产进度。'},
 {id:'finished-outsourcing',label:'成品外发跟进总表',area:'齐料与生产执行',detail:'跟进外发订单、供应商回复与交货进度。'},
 {id:'mes',label:'MES 核对',area:'齐料与生产执行',detail:'核对包装报工、订单关联与更正记录。'},
 {id:'dashboard',label:'欠数与异常看板',area:'异常与交付',detail:'查看交期逾期、生产余欠与待处理异常。'},
 {id:'losses',label:'部门损耗月报',area:'异常与交付',detail:'核对工序损耗、冲减和逐笔凭证。'},
 {id:'completed',label:'已完成订单档案',area:'异常与交付',detail:'查询已归档订单和历史生产记录。'},
 {id:'imports',label:'上传与更新',area:'数据与报表',detail:'导入订单与报工，核对差异并更新总表。'},
 {id:'reports',label:'报表中心',area:'数据与报表',detail:'汇总交期、生产进度和包装报表。'},
] as const;
const productionIds=new Set<string>(productionPlanningSpaces.map(item=>item.id));
export function isProductionPlanningView(view:string){return view===PRODUCTION_PLANNING_ID||productionIds.has(view);}
export type PlanningNavigationItem={id:string;label:string;group:string;icon:string;parent?:string;children?:PlanningNavigationItem[]};
/** Group existing routes without changing department deep links or business permissions. */
export function productionPlanningNavigation(items:readonly PlanningNavigationItem[],member?:Member):PlanningNavigationItem[]{
 const priority=member?.active&&member.role==='clerk'&&member.departments?.includes('finished')?new Set(['finished-outsourcing','department']):new Set<string>();
 const children=productionPlanningSpaces.flatMap(space=>items.filter(item=>item.id===space.id&&!priority.has(item.id)).map(item=>({...item,parent:PRODUCTION_PLANNING_ID})));
 const parent:PlanningNavigationItem={id:PRODUCTION_PLANNING_ID,label:PRODUCTION_PLANNING_TITLE,group:'工作空间',icon:'production',children};
 const result:PlanningNavigationItem[]=[];let inserted=false;
 const ordered=priority.size?[...items.filter(item=>item.id==='workbench'),...['finished-outsourcing','department'].flatMap(id=>items.filter(item=>item.id===id)),...items.filter(item=>item.id!=='workbench'&&!priority.has(item.id))]:items;
 for(const item of ordered){
  if(productionIds.has(item.id)&&!priority.has(item.id)){if(!inserted){result.push(parent);inserted=true;}}
  else result.push(item);
 }
 if(!inserted&&children.length)result.push(parent);
 return result;
}
