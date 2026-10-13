import type {Member,Order,Entity,Report} from './domain';
import {active,balance} from './ledger';

/** Reviewed summaries only. Never embed customer archives or operational source documents here. */
export const frameworkVersion='2026-10-13.review.1';
export type FrameworkAudience='general'|'sales'|'service'|'engineering'|'pmc'|'finance'|'management';
export type FrameworkRule={id:string;number:string;title:string;summary:string;check:string;audiences:FrameworkAudience[];view:string};
export const frameworkRules:FrameworkRule[]=[
 {id:'rule-01',number:'01',title:'客户、订单与文件归属',summary:'统一维护客户主档；项目、订单与款号分别关联，业务入口引用同一份记录。',check:'关联不明确时先核实；保留原编号、附件、历史及来源，不按相似名称合并。',audiences:['general'],view:'customers'},
 {id:'rule-02',number:'02',title:'工程版本与业务通知',summary:'工程发布、客户确认和生产采用分别记录；新版保留旧版及变更依据。',check:'确认收到只针对该版本，不代表客户批准；来源更新后重新核对受影响内容。',audiences:['sales','service','engineering','pmc'],view:'engineering-drawings'},
 {id:'rule-03',number:'03',title:'报价、订单与 PI 核对',summary:'报价引用有效工程依据；正式订单和确认资料是 PI 的来源。',check:'最终报价沿用现有授权审核，价格、数量、币种及条款有依据；不将询价当订单。',audiences:['sales','service','finance'],view:'customer-quotes'},
 {id:'rule-04',number:'04',title:'财务与请款核对',summary:'付款凭证、正式到账、退款及本票应收分别记录；整单余额与本票请款分开。',check:'保留现有财务口径；分配、抵扣、退款或币种有疑问先交财务核实，不自动改账。',audiences:['sales','service','finance','pmc'],view:'service'},
 {id:'rule-05',number:'05',title:'出货单据与物流',summary:'按本批实际出货准备 Invoice、装箱单及运单资料；数量与正式来源一致。',check:'缺箱规、地址或价格依据先补齐；资料草稿不表示物流已受理、提货或签收。',audiences:['service','pmc','finance'],view:'service'},
 {id:'rule-06',number:'06',title:'工作台与权限',summary:'待办明确客户、项目或订单、责任人、日期及下一步；仅汇总当前账号可见资料。',check:'查看提醒不代表事项完成；岗位变化和交接保留原作者及处理历史。',audiences:['general'],view:'customers'},
 {id:'rule-07',number:'07',title:'沟通与文件准备',summary:'同一业务使用相同上下文与文件版本；正文和附件都需要业务核对。',check:'保存、复制、导出与发送分开；对外承诺须核实，所有发送均保留人工确认。',audiences:['sales','service'],view:'customer-projects'},
 {id:'rule-08',number:'08',title:'来源接入与状态',summary:'外部来源需明确归属、版本与更新时间；未接通来源保持未接通。',check:'邮箱、WhatsApp 与后台自动执行本期不接入；不显示虚构同步或回执。',audiences:['management'],view:'maintenance'},
 {id:'rule-09',number:'09',title:'工程画图与协作',summary:'按一个客户、项目或订单及款号发起需求，只共享明确选定的资料。',check:'缺资料退回补齐；工程接收、发布与业务检查分别留痕，不自动认可客户设计。',audiences:['sales','service','engineering'],view:'engineering-drawings'},
 {id:'rule-10',number:'10',title:'内部单据与部门交接',summary:'业务核对后交指定部门，接收、处理和回传分别记录；工程与备料可并行准备。',check:'排产计划不等于投产；图纸、物料和其他正式依据未齐时保持待核实。',audiences:['sales','service','engineering','pmc','finance'],view:'pmc-handoff'},
 {id:'rule-11',number:'11',title:'工程需求整理职责',summary:'整理所选需求、附件、缺项和版本变化，协助工程与业务核对。',check:'未知尺寸和技术结论不补造；工程发布、客户确认及采用责任沿用现有权限。',audiences:['engineering','sales','service'],view:'engineering-drawings'},
 {id:'rule-12',number:'12',title:'PMC 生产协作职责',summary:'核对生产下达条件，跟进备料、图纸、排期与实际生产进展。',check:'不从计划推断完成，不代替部门确认备料或采购，不自动下采购单。',audiences:['pmc','service','engineering'],view:'pmc'},
 {id:'rule-13',number:'13',title:'财务核对职责',summary:'整理正式款项依据、核对差异与请款资料；业务引用财务核实结果。',check:'任务回传不自动新增到账，不自行退款、转账、开税票或放行提货。',audiences:['finance','service','sales'],view:'service'},
 {id:'rule-14',number:'14',title:'客户回复场景',summary:'新询单、开发跟进与订单回复分开处理；多个问题在同一回复中逐项核对依据。',check:'历史邮件筛选不作为新询单准入条件；等级、客户类型和合作方向分别维护。',audiences:['sales','service'],view:'customer-projects'},
 {id:'rule-15',number:'15',title:'业务流程与审核节点',summary:'按业务事件串联资料准备、责任部门和人工审核；每个步骤有明确来源。',check:'本页为流程指引，打开入口不会自动执行；沿用现有业务功能和审批。',audiences:['general'],view:'customer-projects'},
 {id:'rule-16',number:'16',title:'目录与维护分工',summary:'规则维护业务口径，方法维护步骤，职责维护分工，流程维护顺序。',check:'版本变化须核对影响；方法定义不代表已连接模型或已执行任务。',audiences:['management'],view:'maintenance'},
 {id:'rule-17',number:'17',title:'多人协作与验收',summary:'在现有多人中台上核对权限、并发版本、来源、附件、审核及恢复能力。',check:'保留现有数据与权限；最终上线需确认，浏览器页面不替代服务端校验。',audiences:['management'],view:'maintenance'},
];
export type FrameworkMethod={id:string;name:string;output:string;ruleIds:string[]};
export const frameworkMethods:FrameworkMethod[]=[
 {id:'discover',name:'客户发现与身份核对',output:'可核对的身份线索与归属待确认项。',ruleIds:['rule-01','rule-14']},
 {id:'research',name:'客户背景与价值判断',output:'区分事实、判断和未知的背景摘要。',ruleIds:['rule-14']},
 {id:'context',name:'客户与订单上下文关联',output:'当前业务明确关联且有权读取的依据。',ruleIds:['rule-01','rule-07']},
 {id:'reply',name:'回复草稿整理',output:'一条消息的一份待核对正文与附件清单。',ruleIds:['rule-07','rule-14']},
 {id:'requirements',name:'工程需求提取与检查',output:'需求、缺项和冲突清单。',ruleIds:['rule-09','rule-11']},
 {id:'versions',name:'文件版本与影响检查',output:'当前版本、历史关系和受影响事项。',ruleIds:['rule-02','rule-09']},
 {id:'quotation',name:'工程报价转销售报价',output:'引用有效来源、待销售审核的报价草稿。',ruleIds:['rule-03']},
 {id:'pi',name:'客户订单核对与 PI 准备',output:'订单差异、PI 草稿和来源版本。',ruleIds:['rule-03']},
 {id:'production',name:'生产单准备与投产条件检查',output:'生产交接与未满足条件。',ruleIds:['rule-10','rule-12']},
 {id:'receipts',name:'到账与退款依据核对',output:'正式来源及财务待核实差异。',ruleIds:['rule-04','rule-13']},
 {id:'balance',name:'本票尾款与定金抵扣核算',output:'按现有财务规则核对的本票依据。',ruleIds:['rule-04']},
 {id:'shipping',name:'实际出货取数与单据准备',output:'关联同批出货的单据资料草稿。',ruleIds:['rule-05']},
 {id:'templates',name:'模板字段映射与生成',output:'模板、核定字段及待补项。',ruleIds:['rule-07']},
 {id:'handoff',name:'部门交接完整性检查',output:'指定接收人、资料、审核与接收记录。',ruleIds:['rule-09','rule-10']},
 {id:'nda',name:'NDA 内部原则比对',output:'当前协议版本的内部待审核项，不代表签署或法律批准。',ruleIds:['rule-14']},
 {id:'progress',name:'进度整理与到期提醒',output:'有来源日期和责任人的下一步事项。',ruleIds:['rule-06']},
];
export type FrameworkAgent={id:string;name:string;methodIds:string[]};
export const frameworkAgents:FrameworkAgent[]=[
 {id:'inquiry',name:'新询单背调与首复',methodIds:['discover','research','context','reply']},
 {id:'development',name:'开发客户跟进',methodIds:['research','context','reply','requirements','nda','handoff','progress']},
 {id:'service',name:'客服业务回复',methodIds:['context','reply','versions','receipts','progress']},
 {id:'quotation',name:'报价',methodIds:['versions','quotation','templates']},
 {id:'pi',name:'订单与 PI',methodIds:['context','pi','templates']},
 {id:'shipping',name:'出货单据',methodIds:['versions','shipping','templates']},
 {id:'engineering',name:'工程需求与图纸协作',methodIds:['context','requirements','versions','handoff']},
 {id:'pmc',name:'PMC 生产协作',methodIds:['pi','receipts','versions','production','handoff','progress']},
 {id:'finance',name:'财务收款与对账',methodIds:['pi','receipts','balance','templates','handoff']},
];
export type FrameworkStage={title:string;source:string;owner:string;review:string;view:string};
export type FrameworkFlow={id:string;name:string;audiences:FrameworkAudience[];agentIds:string[];ruleIds:string[];stages:FrameworkStage[]};
const step=(title:string,source:string,owner:string,review:string,view:string):FrameworkStage=>({title,source,owner,review,view});
export const frameworkFlows:FrameworkFlow[]=[
 {id:'inquiry',name:'新询单背调与首复',audiences:['sales','service'],agentIds:['inquiry'],ruleIds:['rule-01','rule-07','rule-14'],stages:[step('核对身份与需求','已登记来信、联系人和客户资料','负责业务','身份不清先核实，不自动新建或合并客户','customers'),step('准备首复','有来源的背景与当前需求','负责业务','区分事实与未知；商业条件逐项核实','customer-projects'),step('确认与跟进','确定的正文、对象和附件','获授权业务人员','人工确认；本期在原渠道处理发送并记录真实结果','customer-projects')]},
 {id:'development',name:'开发跟进与销售移交',audiences:['sales','service'],agentIds:['development'],ruleIds:['rule-01','rule-06','rule-14'],stages:[step('整理历史与下一步','客户主档、项目及跟进记录','当前负责人','只追问缺项，保留原沟通和资料','customer-projects'),step('核对移交资料','项目范围、附件及接收人','移交业务人员','核对客户和责任范围后确认交接','customers'),step('接收并继续跟进','移交记录与明确下一步','接手人员','接收未确认时不标移交完成','customer-projects')]},
 {id:'service',name:'客服回复与业务提醒',audiences:['sales','service'],agentIds:['service'],ruleIds:['rule-06','rule-07','rule-14'],stages:[step('定位问题','同客户、项目或订单的沟通与款号','负责客服','归属不明先核实，多个问题分别找依据','service'),step('核对部门依据','工程、生产、财务的有效记录','对应业务部门','计划与事实分开，过时或缺失信息先补齐','service'),step('审核回复与更新事项','正文、附件及确定版本','获授权业务人员','逐项核对承诺；记录真实处理结果','service')]},
 {id:'engineering',name:'工程需求与图纸更新',audiences:['sales','service','engineering','pmc'],agentIds:['engineering','service'],ruleIds:['rule-02','rule-09','rule-11'],stages:[step('提交需求','所选沟通、设计附件、材料和款号','业务发起人','核对需求和接收人后交接','engineering-drawings'),step('接收、核实与回图','工程任务、图号及变更依据','指定工程人员','缺项退回补齐，旧版及发布历史保留','engineering-drawings'),step('业务与客户确认','正式回图、版本和客户证据','业务及现有审核责任人','工程发布、客户确认、生产采用分别留证','customer-projects')]},
 {id:'quotation',name:'工程报价到销售报价',audiences:['sales','service','engineering'],agentIds:['quotation','service'],ruleIds:['rule-02','rule-03'],stages:[step('核对来源','同项目同款有效工程报价','负责业务','保留价格性质，不默认加价或改写来源','customer-quotes'),step('核定对客报价','款数、币种、条件及报价版本','现有授权销售审核人','最终价格和条款经审核，内部资料不外发','customer-quotes'),step('保留确认版本','报价来源及审核记录','负责业务','来源或内容变化须重核，不覆盖已确认历史','customer-quotes')]},
 {id:'pi',name:'客户订单到 PI 与款项核对',audiences:['sales','service','finance'],agentIds:['pi','finance'],ruleIds:['rule-03','rule-04','rule-10'],stages:[step('核对正式订单','客户正式订单、确认价格和条款','负责业务或客服','询价、意向与正式订单分开','factory-orders'),step('准备与确认文件','正式来源、数量、币种和地址','现有单据审核人员','发送不等于客户确认；差异先核实','service'),step('核对付款依据','有效确认文件及正式财务来源','业务与财务','付款条件沿用现系统，不默认比例或自动改账','service')]},
 {id:'production',name:'生产交接与 PMC 协作',audiences:['service','pmc','engineering','finance'],agentIds:['finance','pmc','engineering'],ruleIds:['rule-09','rule-10','rule-12'],stages:[step('核对交接条件','正式订单、确认资料及财务核实依据','业务、客服及财务','依现系统规则审核，缺项不跳过','pmc-handoff'),step('备料与工程并行','已确认交接任务及所选附件','指定 PMC 与工程人员','分别确认接收，记录缺图或缺料','pmc'),step('核对实际投产','物料、采购、图纸确认及排产依据','现有生产责任人','计划不代表投产，变更须重新核对','pmc')]},
 {id:'shipment',name:'出货制单与请款',audiences:['service','pmc','finance'],agentIds:['shipping','finance'],ruleIds:['rule-04','rule-05'],stages:[step('核对本批出货','实际出货明细与有效价格依据','负责客服与生产','款号、累计数量和来源版本一致','service'),step('准备单据与核款','本批箱规、地址、确认文件和资金记录','客服与财务','缺字段待补，本票与整单分别核对','service'),step('审核请款资料','确定单据、正文和附件','现有授权业务人员','抵扣或分配不清交财务；不自行套用新计算口径','service')]},
 {id:'pickup',name:'到账核实与物流提货',audiences:['service','finance','pmc'],agentIds:['finance','shipping','service'],ruleIds:['rule-04','rule-05','rule-10'],stages:[step('核实款项与条件','正式到账、余额和本批出货依据','财务人员','客户凭证不代替到账或放行依据','service'),step('检查提货安排','核实结果、地点、接收人和附件','负责客服','人工确认通知；本期不自动预约物流','service'),step('记录真实物流状态','正式物流受理、运单与后续回执','负责客服或物流人员','运单、提货与签收分开记录','service')]},
];
export const frameworkIsManager=(member:Pick<Member,'role'|'active'>)=>member.active&&['admin','programmer'].includes(member.role);
export function frameworkAudiences(member:Pick<Member,'role'|'active'|'departments'>):FrameworkAudience[]{
 if(!member.active||member.role==='supplier')return [];
 if(member.role==='admin')return ['general','sales','service','engineering','pmc','finance','management'];
 if(member.role==='programmer')return ['general','management'];
 if(member.role==='sales')return ['general','sales','service'];
 if(member.role==='finance')return ['general','finance'];
 if(member.role==='pmc')return ['general','pmc','service'];
 if(member.role==='production')return ['general','pmc','engineering'];
 if(member.role==='clerk')return ['general','service',...(member.departments?.some(d=>['engineering','engineering_review'].includes(d))?['engineering' as const]:[])];
 return ['general'];
}
export function visibleFrameworkRules(member:Member){const roles=frameworkAudiences(member);return frameworkRules.filter(r=>r.audiences.some(a=>roles.includes(a)));}
export function visibleFrameworkFlows(member:Member){const roles=frameworkAudiences(member);return frameworkFlows.filter(r=>frameworkIsManager(member)||r.audiences.some(a=>roles.includes(a)));}

export type FrameworkProjectData={projects:Entity[];tasks:Entity[];customers:Entity[];members:Entity[]};
export type FrameworkFollowupData={followups:Entity[];customers:Entity[];projects:Entity[];members:Entity[]};
export type FrameworkCommunicationData={items:Entity[];customers:Entity[];projects:Entity[];orders:Entity[]};
export type FrameworkTodo={id:string;source:string;title:string;customer:string;reference:string;owner:string;date:string;dateLabel:string;nextAction:string;status:string;view:string;mine:boolean;review:boolean;updatedAt:string;category?:string;recordId?:string;customerId?:string;projectId?:string;orderId?:string;tab?:string;done?:boolean;receiveVersion?:number};
type TodoData={me:Member;orders:Order[];reports:Report[];comments:Entity[];members:Member[]};
const text=(v:unknown)=>typeof v==='string'?v:'';
export const frameworkDay=(date=new Date())=>date.toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'});
export function validFrameworkDate(value:unknown):string{const v=text(value);if(!/^\d{4}-\d{2}-\d{2}$/.test(v))return '';const parsed=new Date(v+'T00:00:00Z');return !Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===v?v:'';}
export function frameworkDue(date:string,today:string){return !validFrameworkDate(date)?'未定日期':date<today?'已逾期':date===today?'今日到期':'后续事项';}
/** Input rows must come from the existing scoped GET responses. This is a read-only projection. */
export function buildFrameworkTodos(data:TodoData,projectData?:FrameworkProjectData,followupData?:FrameworkFollowupData,today=frameworkDay(),communicationData?:FrameworkCommunicationData,leadDays=7):FrameworkTodo[]{
 if(!data.me.active||data.me.role==='supplier')return [];
 const rows:FrameworkTodo[]=[],names=new Map([...data.members,...(projectData?.members||[]),...(followupData?.members||[])].map(m=>[m.id,text(m.name)]));
 const customers=new Map([...(projectData?.customers||[]),...(followupData?.customers||[]),...(communicationData?.customers||[])].map(c=>[c.id,text(c.customer)]));
 const projects=new Map((projectData?.projects||[]).map(p=>[p.id,p]));
 const person=(id:unknown)=>names.get(text(id))||(id?'负责人待核对':'待分配');
 const projectStatuses:Record<string,string>={open:'待处理',returned:'退回补充',service_review:'客服待审核',sales_review:'销售待审核'};
 for(const task of projectData?.tasks||[]){
  const p=projects.get(task.projectId);if(!p||p.status!=='active'||!projectStatuses[task.status])continue;
  const reviewer=task.status==='service_review'?task.serviceReviewerId:task.status==='sales_review'?task.salesReviewerId:task.ownerId;
  rows.push({id:'project:'+task.id,recordId:task.id,customerId:task.customerId,projectId:task.projectId,tab:'tasks',source:'项目任务',title:text(task.title)||'项目任务',customer:customers.get(task.customerId)||'客户归属待核实',reference:[text(p.code),text(p.title)].filter(Boolean).join(' · '),owner:person(reviewer),date:validFrameworkDate(task.dueDate),dateLabel:'任务日期',nextAction:task.canReviewService?'进入项目核对并完成客服审核':task.canReviewSales?'进入项目核对并完成销售审核':task.status==='service_review'||task.status==='sales_review'?'等待指定审核人核对当前任务版本':task.waitingFor?'核实待补内容：'+text(task.waitingFor):'进入项目补充处理结果并按现有流程提交',status:projectStatuses[task.status],view:'customer-projects',mine:reviewer===data.me.id||task.ownerId===data.me.id,review:['service_review','sales_review'].includes(task.status),updatedAt:text(task.updatedAt)});
 }
 const followupStatuses:Record<string,string>={pending:'待跟进',in_progress:'跟进中',waiting_customer:'待客户反馈',waiting_internal:'待内部反馈'};
 for(const f of followupData?.followups||[]){if(!followupStatuses[f.status])continue;const p=(followupData?.projects||[]).find(v=>v.id===f.projectId);
  rows.push({id:'followup:'+f.id,recordId:f.id,customerId:f.customerId,projectId:f.projectId,tab:'followups',source:'客户跟进',title:text(f.title)||'客户跟进',customer:customers.get(f.customerId)||(f.customerId?'客户归属待核实':'未关联客户'),reference:p?[text(p.code),text(p.title)].filter(Boolean).join(' · '):'未关联项目',owner:person(f.ownerId),date:validFrameworkDate(f.followUpDate),dateLabel:'跟进日期',nextAction:text(f.nextAction)||'进入客户项目开发核对下一步与跟进日期',status:followupStatuses[f.status],view:'customer-projects',mine:f.ownerId===data.me.id,review:false,updatedAt:text(f.updatedAt)});
 }
 for(const c of communicationData?.items||[]){
  if(c.status!=='pending_check'||!communicationData?.customers.some(customer=>customer.id===c.customerId))continue;
  const p=communicationData.projects.find(project=>project.id===c.projectId&&project.customerId===c.customerId),o=communicationData.orders.find(order=>order.id===c.orderId&&order.customerId===c.customerId);
  if(c.projectId&&!p||c.orderId&&!o)continue;
  const responsible=c.canReturn===true;
  rows.push({id:'communication:'+c.id,recordId:c.id,customerId:c.customerId,projectId:c.projectId,orderId:c.orderId,tab:'messages',source:'统一沟通',title:text(c.title)||'沟通草稿待核对',customer:customers.get(c.customerId)||'客户归属待核实',reference:[text(p?.code),text(p?.title),text(o?.orderNo),text(o?.drawing)].filter(Boolean).join(' · ')||'客户沟通',owner:responsible?data.me.name:'负责销售',date:'',dateLabel:'核对截止日',nextAction:responsible?'进入统一沟通核对当前草稿；需修改时退回':'等待负责销售核对',status:'待人工核对',view:'communications',mine:responsible,review:true,updatedAt:text(c.updatedAt)});
 }
 const dueLimit=new Date(Date.parse(today+'T00:00:00Z')+Math.min(90,Math.max(1,leadDays))*86400000).toISOString().slice(0,10);
 const orders=new Map(data.orders.filter(active).map(o=>[o.id,o]));
 const isMine=(o:Order)=>o.ownerEmail===data.me.email||data.me.customers.includes(o.customer);
 const owner=(o:Order)=>data.members.find(m=>m.email===o.ownerEmail)?.name||o.ledger?.ownerName||o.ownerEmail||'待分配';
 for(const c of data.comments){const o=orders.get(c.lineId);if(!o||c.done||!c.dueDate)continue;
  rows.push({id:'comment:'+c.id,recordId:c.id,orderId:o.id,tab:'followups',source:'订单跟进',title:text(c.text)||'订单跟进',customer:o.customer,reference:[o.orderNo,o.customerPO,o.drawing].filter(Boolean).join(' · '),owner:owner(o),date:validFrameworkDate(c.dueDate),dateLabel:'跟进日期',nextAction:'进入订单详情查看原跟进记录，核对后更新处理状态',status:'待跟进',view:'orders',mine:isMine(o),review:false,updatedAt:text(c.createdAt)});
 }
 const handoffs:Record<string,{ownerKey:'salesName'|'serviceName'|'pmcName';next:string;view:string}>={
  '业务待提交':{ownerKey:'salesName',next:'业务核对订单资料后提交',view:'sales'},'退回业务补充':{ownerKey:'salesName',next:'业务查看退回原因并补齐资料',view:'sales'},'客服待审核':{ownerKey:'serviceName',next:'客服在原工作台核对当前订单版本',view:'service'},'PMC待接单':{ownerKey:'pmcName',next:'PMC 核对交接资料后接单',view:'pmc-handoff'},
 };
 for(const o of orders.values()){
  const h=handoffs[o.workflowStatus||''];if(h)rows.push({id:'handoff:'+o.id,recordId:o.id,orderId:o.id,source:'订单交接',title:o.workflowStatus||'待交接',customer:o.customer,reference:[o.orderNo,o.customerPO,o.drawing].filter(Boolean).join(' · '),owner:text(o[h.ownerKey])||owner(o),date:'',dateLabel:'未设审核截止日',nextAction:h.next,status:o.workflowStatus||'待交接',view:h.view,mine:isMine(o),review:o.workflowStatus==='客服待审核',updatedAt:o.updatedAt});
  const due=validFrameworkDate(o.requestedDate),remaining=balance(o,data.reports);if(due&&due<=dueLimit&&remaining!==null&&remaining>0&&o.workflowStatus!=='已完成')rows.push({id:'due:'+o.id,recordId:o.id,orderId:o.id,source:'订单交期',title:due>today?'客户要求交期临近':'客户要求交期待核对',customer:o.customer,reference:[o.orderNo,o.customerPO,o.drawing].filter(Boolean).join(' · '),owner:owner(o),date:due,dateLabel:'客户要求交期',nextAction:'核对实际进度和欠数，在原订单中更新交期或完成依据',status:due>today?'临近交期':'到期未结事项',view:'orders',mine:isMine(o),review:false,updatedAt:o.updatedAt});
 }
 return [...new Map(rows.map(row=>[row.id,row])).values()].sort((a,b)=>Number(!!b.date&&b.date<today)-Number(!!a.date&&a.date<today)||Number(b.review)-Number(a.review)||(a.date||'9999').localeCompare(b.date||'9999')||a.id.localeCompare(b.id));
}

export type FrameworkDepartmentData={items:Entity[];customers:Entity[];orders:Entity[];projects:Entity[];members:Entity[];attachments?:Entity[];serviceConfig?:{leadDays:number;version:number;drawingRoot:string;quoteRoot:string;configured:boolean};queues?:{drawings?:Entity[];sops?:Entity[];orders?:Entity[];factory?:Entity[];service?:Entity[];finance?:Entity;quotes?:Entity[]}};
export function buildFrameworkNoticeTodos(me:Member,items:Entity[]=[]):FrameworkTodo[]{if(!me.active||me.role==='supplier')return [];return items.map(r=>({id:'notice:'+r.id,recordId:r.id,source:'指定版本收阅',title:(r.type==='finance_file'?'财务资料':'工程资料')+' · '+r.number+' · V'+r.version,customer:r.customer,customerId:r.customerId,projectId:r.projectId,orderId:r.orderId,reference:'当前已核对版本',owner:me.name,date:'',dateLabel:'收阅日期',nextAction:r.received?'已保留本人对此版本的收阅记录':'打开原资料核对版本，再确认本人已收阅；收阅不代表批准或到账',status:r.received?'本人已收阅':'待本人收阅',view:r.type==='finance_file'?'finance-documents':'engineering-materials',tab:r.type,mine:true,review:false,updatedAt:r.updatedAt||'',done:!!r.received,category:r.type==='finance_file'?'付款':'工程资料',receiveVersion:!r.received&&r.canReceive?r.version:undefined}));}
export type FrameworkTransferData={customers:Entity[];handoffs:Entity[];poolRequests:Entity[];claims:Entity[];sales:Entity[];canApprove:boolean;tasks?:Entity[]};
export function buildFrameworkFinanceTodos(me:Member,tasks:Entity[]=[]):FrameworkTodo[]{
 if(!me.active||me.role==='supplier')return [];
 return tasks.filter(t=>['草稿','待财务接收','财务处理中','待业务核对'].includes(t.status)).map(t=>({id:'finance-task:'+t.id,recordId:t.id,customerId:t.customerId,orderId:t.orderId,source:'财务协作任务',category:'付款',title:t.type+' · '+t.status,customer:t.customerLabel,reference:t.orderLabel,owner:['待财务接收','财务处理中'].includes(t.status)?t.recipientName:'负责业务',date:validFrameworkDate(t.due),dateLabel:'希望反馈日期',nextAction:t.sourceChanged?'原订单、PI或正式款项已有变化，请业务重核；不将旧结果当作新依据':t.canAccept?'核对本任务内容后接收':t.canReturn?'核实正式财务来源并回传结果与完整依据路径':t.canReview?'核对财务回传结果和当前来源':t.canSubmit?'核对正文、接收人及依据后交财务':'等待对应责任人处理',status:t.status,view:'finance-documents',tab:'finance-tasks',mine:!!(t.canAccept||t.canReturn||t.canReview||t.canSubmit),review:true,updatedAt:t.updatedAt}));
}
export function buildFrameworkCustomerTodos(me:Member,accounts:Entity[],profiles:Entity[]=[]):FrameworkTodo[]{
 if(!me.active||me.role==='supplier')return [];
 return profiles.flatMap(p=>{const w=p.workflow,c=accounts.find(c=>c.id===p.id);if(!c||!w||w.followState==='暂停'||!w.next&&!w.nextDate)return [];
  const responsible=w.primarySalesMemberId?w.primarySalesMemberId===me.id:Array.isArray(c.salesMemberIds)?c.salesMemberIds.includes(me.id):c.salesName===me.name;
  return [{id:'customer-followup:'+p.id,recordId:p.id,customerId:p.id,source:'客户下次跟进',category:'客户跟进',title:w.next||'核实下一次客户跟进',customer:c.customer,reference:c.customerCode||'客户主档',owner:responsible?me.name:c.salesName||'当前负责销售',date:validFrameworkDate(w.nextDate),dateLabel:'下次跟进日',nextAction:w.next||'核实下一步并记录跟进结果',status:w.followState||'待安排',view:'customers',tab:'workflow',mine:responsible,review:false,updatedAt:text(w.updatedAt)}];});
}
export type FrameworkDrawingReviewData={reviewerRole:string;drawings:Entity[];policyVersion:number};
/** All inputs are already authorized API responses. Never derive extra access from a role label. */
export function buildFrameworkDepartmentTodos(me:Member,business?:FrameworkDepartmentData,transfers?:FrameworkTransferData,drawingReview?:FrameworkDrawingReviewData,today=frameworkDay()):FrameworkTodo[]{
 if(!me.active||me.role==='supplier')return [];
 const result:FrameworkTodo[]=[],customers=new Map([...(business?.customers||[]),...(transfers?.customers||[])].map(c=>[c.id,text(c.customer)]));
 for(const task of transfers?.tasks||[]){if(!['待接手','进行中','受阻'].includes(task.status))continue;result.push({id:'customer-task:'+task.id,recordId:task.id,customerId:task.customerId||undefined,source:'客户任务',category:'业务事项',title:task.title,customer:task.customerId?customers.get(task.customerId)||'授权客户':'未关联客户',reference:'客户独立任务',owner:task.owner||'指定负责人',date:validFrameworkDate(task.due),dateLabel:'任务到期日',nextAction:task.status==='受阻'?'核对阻碍与下一步，保留处理结果和备注':'处理当前任务并记录实际进展、结果和备注',status:task.status,view:'customers',tab:'tasks',mine:task.ownerId===me.id,review:false,updatedAt:text(task.updatedAt)});}
 const memberName=(id:string)=>[...(business?.members||[]),...(transfers?.sales||[])].find(m=>m.id===id)?.name||'指定负责人';
 const kindNames:Record<string,string>={po:'客户PO',customer_po:'客户PO',engineering_drawing:'工程图纸',engineering_quote:'工程报价',production_order:'生产单',production_shipment:'生产出货单',finance_file:'财务资料',finance_request:'财务核对',finance_receipt:'正式收款',finance_refund:'正式退款',logistics_record:'物流资料',quotation:'销售报价',pi:'PI',invoice:'Invoice',packing:'Packing List',waybill:'运单资料',paymentrequest:'请款资料'};
 const category=(type:string)=>type.startsWith('engineering')?'工程资料':type.startsWith('finance')||type==='paymentrequest'?'付款':type==='production_order'?'生产交期':type==='production_shipment'||type==='waybill'||type==='logistics_record'?'订单交付':'业务文件';
 const route=(type:string)=>type.startsWith('engineering')?'engineering-materials':type.startsWith('finance')||type==='paymentrequest'?'finance-documents':type==='production_order'?'production-orders':type==='production_shipment'?'production-shipments':['waybill','logistics_record','invoice','packing'].includes(type)?'logistics-waybills':'order-confirmations';
 for(const row of business?.items||[]){
  if(!['pending_check','checked'].includes(row.status)&&!row.sourceChanged)continue;
  const order=business?.orders.find(o=>o.id===row.orderId),project=business?.projects.find(p=>p.id===row.projectId);
  result.push({id:'business:'+row.id,recordId:row.id,customerId:row.customerId,projectId:row.projectId,orderId:row.orderId,source:'业务资料',category:category(row.type),title:(kindNames[row.type]||row.type)+' · '+(row.number||'待核对'),customer:customers.get(row.customerId)||'客户归属待核实',reference:[order?.orderNo,order?.customerPO,project?.code,row.fields?.style].filter(Boolean).join(' · '),owner:row.canConfirm?me.name:'指定业务核对人',date:'',dateLabel:'核对截止日',nextAction:row.sourceChanged?'引用来源已有新版本，重新核对并更新资料':row.status==='checked'?'查看已核对版本及其完整处理历史':row.canConfirm?'核对当前资料版本、字段及来源后确认':'等待负责人员核对当前版本',status:row.sourceChanged?'来源已变化':row.status==='checked'?'已确认':'待人工核对',view:route(row.type),tab:row.type,mine:!!row.canConfirm,review:row.status!=='checked'||!!row.sourceChanged,done:row.status==='checked'&&!row.sourceChanged,updatedAt:text(row.updatedAt)});
 }
 const dueLimit=new Date(Date.parse(today+'T00:00:00Z')+Math.min(90,Math.max(1,business?.serviceConfig?.leadDays||7))*86400000).toISOString().slice(0,10);
 for(const r of business?.items||[]){if(r.type!=='production_order')continue;const due=validFrameworkDate(r.fields?.dueDate);if(!due||due>dueLimit||['completed','cancelled'].includes(r.productionStatus))continue;const o=business?.orders.find(o=>o.id===r.orderId);result.push({id:'production-due:'+r.id,recordId:r.id,customerId:r.customerId,orderId:r.orderId,source:'生产单交期',category:'生产交期',title:'生产单 '+r.number+' · '+(due<today?'逾期需核实':'临近交期'),customer:customers.get(r.customerId)||'授权客户',reference:[o?.orderNo,r.fields.style].filter(Boolean).join(' · '),owner:memberName(r.fields.pmcId),date:due,dateLabel:'生产单交期',nextAction:'核对实际生产进度、物料和采购；确认单据不等于生产完成',status:due<today?'逾期':'临近到期',view:'production-orders',tab:'production_order',mine:r.fields.pmcId===me.id,review:false,updatedAt:text(r.updatedAt)});}
 for(const d of business?.queues?.drawings||[]){
  if(['completed','cancelled','archived','已完成','已取消'].includes(d.status))continue;
  result.push({id:'drawing:'+d.id,recordId:d.id,customerId:d.customerId,source:'工程任务',category:'工程资料',title:'工程画图 · '+(d.modelNo||'款号待补'),customer:customers.get(d.customerId)||'授权工程客户',reference:d.drawingType||'',owner:d.assignee||'指定工程',date:validFrameworkDate(d.deadline),dateLabel:'工程日期',nextAction:'核对画图要求、接收状态与当前回传版本',status:d.status||'状态待核对',view:'engineering-drawings',tab:'drawings',mine:d.assignee===me.name||d.assignee===me.id,review:false,updatedAt:text(d.updatedAt)});
 }
 const fundingSeen=new Set<string>();for(const order of business?.queues?.orders||[]){const g=order.productionGate;if(!g?.fundingReminder||!g.productionId||fundingSeen.has(g.productionId))continue;fundingSeen.add(g.productionId);const r=business?.items.find(r=>r.id===g.productionId);result.push({id:'funding-reminder:'+g.productionId,recordId:g.productionId,customerId:r?.customerId,orderId:order.id,source:'款项例外持续跟进',category:'付款',title:'约定定金收齐声明待确认',customer:r?customers.get(r.customerId)||'授权客户':order.customer||'授权订单',reference:[order.orderNo,order.drawing,g.piId?'当前PI版本 V'+g.piVersion:'PI待核实'].filter(Boolean).join(' · '),owner:g.canDeclareDeposit?me.name:'当前负责销售',date:'',dateLabel:'声明日期',nextAction:g.fundingBasisCurrent?'跟进款项直至当前负责销售明确声明已收齐本PI约定定金；声明不等于正式财务到账':'例外或款项依据已变更，先重核当前PI和责任人；原声明历史保留',status:g.fundingBasisCurrent?'持续跟进款项':'款项依据待重核',view:'production-orders',tab:'production_order',mine:!!g.canDeclareDeposit,review:true,updatedAt:g.paymentException?.createdAt||''});}
 for(const row of transfers?.handoffs||[]){if(row.status!=='pending')continue;result.push({id:'customer-handoff:'+row.id,recordId:row.id,customerId:row.customerId,source:'客户交接',category:'交接',title:'负责销售移交待接收',customer:customers.get(row.customerId)||'待接收客户',reference:'客户主档',owner:memberName(row.to),date:'',dateLabel:'接收截止日',nextAction:row.to===me.id?'由接收销售本人核对资料并接收':'等待指定销售本人接收',status:'待接收',view:'customers',tab:'workflow',mine:row.to===me.id&&me.role==='sales',review:true,updatedAt:text(row.createdAt)});}
 for(const [kind,list,title] of [['pool',transfers?.poolRequests||[],'客户转入公海申请'],['claim',transfers?.claims||[],'公海客户领取申请']] as const){for(const row of list){if(row.status!=='pending')continue;result.push({id:kind+':'+row.id,recordId:row.id,customerId:row.customerId,source:'客户申请',category:'交接',title,customer:customers.get(row.customerId)||'授权客户',reference:'客户主档',owner:transfers?.canApprove?me.name:'管理员',date:'',dateLabel:'审批截止日',nextAction:transfers?.canApprove?'核对申请依据并按既有流程处理':'等待管理员核对申请',status:'待核对申请',view:'customers',tab:'workflow',mine:!!transfers?.canApprove,review:true,updatedAt:text(row.createdAt)});}}
 if(drawingReview?.reviewerRole)for(const d of drawingReview.drawings){const signed=drawingReview.reviewerRole==='drawing_lead'?d.lead:d.supervisor;if(d.effective||signed?.decision==='confirm')continue;result.push({id:'drawing-adoption:'+d.id,recordId:d.id,source:'图纸生产采用',category:'工程资料',title:'当前版本待'+(drawingReview.reviewerRole==='drawing_lead'?'画图组长':'工程主管')+'核对',customer:'岗位授权工程资料',reference:[d.number,d.style,d.versionLabel,d.drawingNumber].filter(Boolean).join(' · '),owner:me.name,date:'',dateLabel:'核对截止日',nextAction:'核对当前同一图纸版本并由本人签核；管理员不默认代签',status:'岗位待确认',view:'engineering-materials',tab:'production-review',mine:true,review:true,updatedAt:''});}
 return result;
}
