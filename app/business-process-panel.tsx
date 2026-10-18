'use client';

import {ArrowRight,ArrowUpRight,GitBranch,ShieldCheck,Wallet} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {departmentNavigationContext,type WorkspaceNavigate,type WorkspaceNavigationContext} from '@/lib/handoff-navigation';
import type {Data} from './workspace';
import './process-workspace.css';

type Entry={label:string;view:string;tab?:string};
type Stage={id:string;title:string;department:string;input:string;output:string;gate:string;entries:Entry[];parallel?:boolean};
const task=(label:string,tab:string):Entry=>({label,view:'process-workspace',tab});
const stages:Stage[]=[
 {id:'S01',title:'市场与客户开发',department:'业务 → 客服',input:'客户线索、沟通记录与历史合作资料',output:'客户责任归属、开发项目与下一次跟进',gate:'客户身份、联系人和需求来源明确。',entries:[{label:'客户责任清单',view:'customers'},{label:'客户项目开发',view:'customer-projects'}]},
 {id:'S02',title:'需求与项目评估',department:'业务 / 客服 → 工程 / PMC',input:'款式、图纸、数量、质量要求与目标交期',output:'需求评估、可行性结论与待确认事项',gate:'缺失资料指定负责人；交期与工艺风险有结论。',entries:[task('询价与需求评估','rfq'),{label:'工程协作',view:'engineering-drawings'}]},
 {id:'S03',title:'报价与成本核算',department:'工程 / 采购 → 业务',input:'确认需求、BOM / 工艺、物料及外协价格依据',output:'报价版本、币种、条款与客户反馈',gate:'价格采用版本、数量口径与特殊费用可追溯。',entries:[{label:'客户报价',view:'customer-quotes'},{label:'历史报价档案',view:'customer-price-archive'}]},
 {id:'S04',title:'客户确认与订单评审',department:'业务 → 客服 → PMC',input:'客户订单、报价、PI、交期与付款条件',output:'评审结论、内部订单、风险与交接记录',gate:'款式、数量、交期、包装和特殊要求完成核对。',entries:[{label:'订单与 PI',view:'order-confirmations'},{label:'中英内部订单',view:'factory-orders'},{label:'PMC 交接',view:'pmc-handoff'}]},
 {id:'S05',title:'开发、签样与资料冻结',department:'工程 → 品质 / 业务 / 客户',input:'设计图、BOM、工艺、颜色、字印、配件要求',output:'采用版本、签样依据、工程变更与受影响范围',gate:'签样和采用版本明确；变更重新确认适用订单及批次。',entries:[{label:'工程画图与 SOP',view:'engineering-drawings'},task('样品与签样','sample'),task('工程变更','engineering-change')]},
 {id:'S06',title:'订单计划与物料采购',department:'PMC → 采购 / 供应商',input:'订单需求、采用版 BOM、库存与产能',output:'采购 / 外发计划、回复交期与排期依据',gate:'采购数量、到料日、产能及配套计划相互匹配。',entries:[{label:'PMC 排期',view:'pmc'},{label:'计划分析与协调',view:'planning-control'},{label:'采购与收货',view:'receiving'}]},
 {id:'S07',title:'来料检验与配套齐料',department:'采购 → 品质 → 仓库 / PMC',input:'到货、供应商单据、物料清单与检验标准',output:'来料检验、收货凭证、齐套结论和缺料责任',gate:'关键物料质量和数量核对完成；未齐套转入协调。',entries:[task('来料检验 IQC','iqc'),task('齐料与缺料','material-kit'),task('仓储流转','warehouse')]},
 {id:'S08',title:'排程与生产制造',department:'PMC → 生产部门 / 外协',input:'可开工资料、齐料结论、工艺和排程',output:'实际工序进度、交接、损耗及外协记录',gate:'按款式与工艺走适用路径；首件及过程质量同步确认。',entries:[{label:'生产排期',view:'pmc'},{label:'部门工序录入',view:'department'},{label:'成品委外',view:'finished-outsourcing'},{label:'损耗月报',view:'losses'}]},
 {id:'S09',title:'过程检验与质量关口',department:'品质 ↔ 生产 / 工程 / 采购',input:'首件、在制品、外协回货及适用检验标准',output:'检验依据、合格 / 不合格数量、整改与复验',gate:'贯穿开工和生产交接；不合格隔离、返工并复验。',parallel:true,entries:[task('首件检验','first-article'),task('过程质量','process-quality'),task('外协质量','outsourcing-quality')]},
 {id:'S10',title:'成品检验、包装与入仓',department:'成品 → 品质 → 包装 / 仓库',input:'完工产品、签样 / 检验标准与包装要求',output:'成品检验、包装清单、包装入仓数量与日期',gate:'成品质量、包装与实物入仓分别留痕。包装入仓不等于出货。',entries:[task('成品检验 OQC','oqc'),task('包装入仓核对','packaging'),{label:'原工序与入仓记录',view:'department'}]},
 {id:'S11',title:'出货、单证与客户交付',department:'客服 / 业务 → 品质 / 仓库 → 物流',input:'出货计划、质量结论、财务条件与包装单',output:'放行依据、出货单证、物流及签收跟进',gate:'质量与财务条件逐项核实后交接；分批出货明确数量。',entries:[task('出货放行核对','shipment-release'),{label:'生产出货单',view:'production-shipments'},{label:'物流与出货',view:'logistics-waybills'}]},
 {id:'S12',title:'开票、收款与账款核对',department:'财务 ↔ 业务 / 客服 / 采购',input:'付款条款、订单、交付凭证、发票与银行流水',output:'应收、到账核销、供应商对账与凭证',gate:'资金条件贯穿接单与出货；订单完工、入仓或出货不等于到账。',parallel:true,entries:[{label:'应收账款工作空间',view:'ar-workspace'},task('供应商对账','supplier-reconciliation'),{label:'财务资料',view:'finance-documents'}]},
 {id:'S13',title:'客诉、复盘与客户维护',department:'客服 → 品质 / 工程 / 生产 → 业务',input:'客诉证据、批次、检验与交付记录',output:'原因、纠正措施、验证及客户反馈',gate:'处理效果与客户回复有依据，问题反馈到资料和作业标准。',entries:[task('客诉与改善闭环','complaint'),{label:'客服跟进',view:'service-workspace'},{label:'客户项目维护',view:'customer-projects'}]},
];
const paths=[
 {title:'自制',detail:'工程资料 → 物料 / 齐套 → 自制工序 → 成品装配 → 检验 / 包装入仓',note:'金属 / 钛：焊接、打磨、表面处理及配套；板材：脾、车房、滚桶、配套及钉装，按具体产品工艺执行。',entry:{label:'查看部门工序',view:'department'}},
 {title:'工序外协',detail:'在制工序 → 外发交接 → 供应商加工 → 回货 / 检验 → 后续工序',note:'外发、回货及电镀进度沿用原有记录；外协质量和复验单独跟进。',entry:task('登记外协质量','outsourcing-quality')},
 {title:'成品委外',detail:'订单 / 资料 → 成品外发 → 供应商进度 → 回货 / 成品检验 → 包装入仓',note:'使用原成品外发跟进总表；供应商完工回复需与公司收货、检验及入仓核对。',entry:{label:'查看成品外发',view:'finished-outsourcing'}},
 {title:'现货出货',detail:'现货核对 → 订单评审 → 库存 / 质量 / 包装核实 → 放行 / 发运',note:'无需制造的订单仍核实货权、数量、适用检验和账款条件，并留存交付凭证。',entry:task('核对出货条件','shipment-release')},
];

export function BusinessProcessPanel({data,onNavigate,initialContext}:{data:Data;onNavigate:WorkspaceNavigate;initialContext?:WorkspaceNavigationContext}){
 const open=(entry:Entry)=>onNavigate(entry.view,{...departmentNavigationContext(initialContext||{}),...(entry.tab?{tab:entry.tab}:{})});
 const visibleEntry=(entry:Entry)=>!['customer-quotes','customer-price-archive'].includes(entry.view)||data.customerQuoteAccess===true;
 return <div className="process-overview">
  <header className="process-hero"><div><span className="process-eyebrow">度昂 · 从客户需求到交付回款</span><h2>端到端业务总览</h2><p>按部门交接找入口，按工序流转看完成条件。客户、订单、生产进度和账款继续使用各自原有记录。</p></div><Button variant="outline" onClick={()=>open({view:'orders',label:'动态订单总表'})}>查看动态订单总表<ArrowUpRight size={16}/></Button></header>
  <div className="process-ribbon" aria-label="跨阶段管理"><article><ShieldCheck size={20}/><div><b>S09 质量贯穿生产</b><p>首件 → 过程 → 外协回货 → 成品检验，未通过时进入处理与复验。</p></div></article><article><Wallet size={20}/><div><b>S12 资金贯穿接单与交付</b><p>条款 → 定金 / 信用条件 → 出货核对 → 开票 → 到账核销。</p></div></article></div>
  <section aria-label="四条业务执行路径"><div className="process-section-heading"><h3><GitBranch size={19}/>度昂实际执行路径</h3><p>按产品与订单选择适用路径；外协可以嵌入自制过程。</p></div><div className="process-paths">{paths.map(path=><article key={path.title}><h4>{path.title}</h4><p className="process-path-flow">{path.detail}</p><p>{path.note}</p><button type="button" onClick={()=>open(path.entry)}>{path.entry.label}<ArrowUpRight size={15}/></button></article>)}</div></section>
  <section aria-label="十三阶段业务流"><div className="process-section-heading"><h3>从前到后的部门交接</h3><p>每一站对应输入、输出、完成条件和实际工作入口。</p></div><ol className="process-stage-grid">{stages.map(stage=><li key={stage.id} className={stage.parallel?'process-stage parallel':'process-stage'}><header><span>{stage.id}</span><h4>{stage.title}</h4>{stage.parallel&&<small>跨阶段</small>}</header><div className="process-department">{stage.department}</div><dl><div><dt>接收</dt><dd>{stage.input}</dd></div><div><dt>交付</dt><dd>{stage.output}</dd></div></dl><p className="process-gate"><ShieldCheck size={15}/>{stage.gate}</p><div className="process-stage-links">{stage.entries.filter(visibleEntry).map(entry=><button key={entry.view+':'+entry.tab} type="button" onClick={()=>open(entry)}>{entry.label}<ArrowRight size={14}/></button>)}</div></li>)}</ol></section>
  <footer className="process-overview-footer"><span>当前成员：{data.me.name}</span><p>入口中的可见资料和操作由现有权限决定。新流程作业记录用于交接与证据追踪；实际库存、出货和收付款以对应业务单据为准。</p></footer>
 </div>;
}
