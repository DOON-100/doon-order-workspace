'use client';
import {ExcelTable} from './excel-table';

import {ArrowUpRight, BookOpen, CheckCircle2, FileText, Layers3, Link2} from 'lucide-react';
import type {WorkspaceNavigate} from '@/lib/handoff-navigation';
import './ar-process-panel.css';

const futureSteps = [
  ['01', '客户与模板', '业务 / 客服', '建立唯一客户代码、付款主体和原币；选择客户对账标题、语言、可选列及产品扩展字段。', '客户代码与模板版本'],
  ['02', '订单与 PI', '客服制单 / 业务审核', '依据客户 PO、已确认报价、SKU、数量、价格和付款条件制单。PI 签发后按约定建立订金与尾款计划。', '原订单、PI 版本、唯一应收义务'],
  ['03', '到账与核销', '财务', '核实银行实际到账日期、金额、币种、流水号和凭证；再把到账分配到对应应收。一笔到账可分配多票。', '到账记录、核销关系与未分配余额'],
  ['04', '出货与商业发票', 'PMC / 仓储 / 客服', '按实际出货批次生成商业发票，并关联原订单与 PI；核实本次出货数量、订金抵扣和尾款范围。', '出货证据、商业发票及原应收关联'],
  ['05', '对账与跟进', '财务 / 客服', '按客户、币种和截至日核查实收、未收、版本差异及到期日，生成并留存 STATEMENT。', '冻结快照、差异说明与客户反馈'],
  ['06', '结清与后续调整', '财务', '按应收及核销金额计算状态；退款、折扣、贷项或冲销各自保留依据，不用改备注代替账务调整。', '原票、收款、调整与凭证完整历史'],
];
const fieldGroups = [
  ['统一账务字段', '客户代码、原币、发票号、单据类型与版本、金额口径、应收、实收、未收、截至日、原单关联。', '由业务事实、系统规则和核对记录确定；模板不能改金额、币种、核销算法或收款状态。'],
  ['客户展示模板', 'STATEMENT 标题、显示语言、可选业务信息列。', '调整对账单的展示方式；保存后用于新快照，已生成的快照保持原样。'],
  ['眼镜与订单扩展字段', '眼镜类别、客款号、工厂款号、镜片类型、框色、尺寸、客户 PO、包装要求等。', '按客户设置文本、数字或日期字段，逐票填写；不参与金额计算，不支持自定义公式。'],
  ['原票与导入映射', '客户原发票版式、历史总表栏目、工作表及单元格位置。', '原件原样保存；不同版式先整理为统一导入清单并核对，不能只按列位置盲目合并。'],
];
const exceptions = [
  ['历史总表只有累计余额', '先区分逐票应收与客户累计余额；没有明确分配依据的款项保留待核对。'],
  ['已确认历史实收，但原表截至日不明', '历史实收继续保留；截至日实收与余额保持未知，STATEMENT 作为核对草稿。'],
  ['同号不同版本 / 原订单已有应收', '保留全部来源，明确有效版本及原应收关系；同一义务只记一次，不重复确认历史账。'],
  ['PI 订金与商业发票同时存在', '区分整单货值、本期净应收、已付订金与尾款；“历史净应收已收”不等同整单结清。'],
  ['合并付款、超收、手续费或退款', '按依据分配；超收留为客户未分配款，手续费、折扣和退款独立处理，不强行凑平。'],
  ['原金额超过两位小数 / 金额缺失', '保留原值与来源，核对舍入口径；未知金额不补零、不猜算。'],
  ['关联不到原订单 / 客户不一致', '继续保留未关联状态，回到客户或原单核对。只有同客户、权限内的精确记录可建立关联。'],
];

export function ArProcessPanel({onNavigate, onOpenTab}: {onNavigate: WorkspaceNavigate; onOpenTab: (tab: string) => void}) {
  return <section className="arp" aria-label="应收账款流程说明">
    <header className="arp-hero"><div><span>ACCOUNTS RECEIVABLE · WORKING GUIDE</span><h2>从订单到对账，每笔款项可追溯</h2><p>统一账务口径，保留客户版式与产品差异。办理前先确认客户、原单、金额范围和凭证，再进入对应业务环节。</p></div><BookOpen size={34}/></header>
    <nav className="arp-shortcuts" aria-label="应收流程办理入口"><button onClick={() => onOpenTab('master')}><BookOpen size={15}/>应收总表</button><button onClick={() => onOpenTab('invoices')}><FileText size={15}/>历史发票与对账单</button><button onClick={() => onOpenTab('profiles')}><Layers3 size={15}/>客户模板与追踪</button><button onClick={() => onNavigate('order-confirmations')}>订单与 PI <ArrowUpRight size={14}/></button><button onClick={() => onNavigate('project-finance')}>实际到账与核销 <ArrowUpRight size={14}/></button></nav>

    <section className="arp-section"><div className="arp-heading"><span>01</span><div><h3>当前能办理什么</h3><p>本页说明办理顺序和边界，功能状态以对应入口为准。</p></div></div><div className="arp-boundaries"><article><h4><CheckCircle2 size={16}/>当前可用</h4><ul><li>历史暂存逐条正式登记应收总表，保留原值、原行、付款条件、备注与核对历史。</li><li>历史原件归档、导入清单预览、全部发票版本与来源定位。</li><li>逐票历史累计实收核对、付款凭证补传、系统收款说明与人工备注。</li><li>按客户、币种、截至日生成冻结的 STATEMENT 核对草稿。</li><li>客户对账模板、逐票扩展信息及同客户原业务记录关联，供查询追踪。</li><li>现有客户项目财务的实际到账、用途分配、退款和冲销入口。</li></ul></article><article className="arp-pending"><h4>仍需逐步完善的联动</h4><ul><li>不同客户原始 Excel / PDF 版式自动识别与映射审核。</li><li>订单 PI 与商业发票自动归集到同一个应收义务。</li><li>历史期初正式切换、历史核对反向更正与统一跨票到账入口。</li><li>客户级付款凭证供多票引用、凭证撤换版本管理。</li></ul><p>目前建立原单关联只增加追踪依据，不自动记账、生成收款或改动原订单。</p></article></div></section>

    <section className="arp-section"><div className="arp-heading"><span>02</span><div><h3>历史客户总表如何迁移</h3><p>每个客户独立核对，原文件完整保存，后续导入使用增量。</p></div></div><ol className="arp-migration"><li><b>收齐原资料</b><p>发票、STATEMENT 历史总表和已有付款依据；明确客户代码、币种、发票截止号及原表截至日。文件名日期不能直接作为对账截至日。</p></li><li><b>整理已核对导入清单</b><p>统一核心字段，保留工作表、单元格、原值、版本与异常。不同眼镜类别的业务信息放入客户扩展字段，原票版式保持原样。</p></li><li><b>预览并归档</b><p>先核对客户、截止范围和原件对应关系，再提交。重复原件不重复建档；同号不同版本全部保留。</p></li><li><b>登记应收总表</b><p>将历史明细逐行登记，小计与总计不重复导入；金额缺失、负数贷扣项、精度差异和客户冲突保留原值与提示。登记完成后从历史暂存移入总表，原始资料继续留存。</p></li><li><b>逐票核对历史净应收与实收</b><p>区分订金、尾款与本次对账范围；确认付款归属并填写依据。不能直接把客户累计余额当本票未收，也不能按相邻行自动认领付款。</p></li><li><b>补证、关联并生成草稿</b><p>补传付款凭证，关联同客户的原订单 / PI / 收费记录；核查异常后生成 STATEMENT。未知截至日保留历史实收说明，不算出一个虚假的截至日余额。</p></li></ol><p className="arp-note">总表登记与金额核对分别记录：先确认原金额是应收总额还是期初未收余额，并注明截至日；应收、实收、未收缺失时保持待补。历史核对不创建本期现金到账。已存在正式应收时明确关联“同一应收”，该总表行不重复累计；原订单或发票关联只作为追踪依据。</p></section>

    <section className="arp-section"><div className="arp-heading"><span>03</span><div><h3>日后新增：按业务发生顺序办理</h3><p>以唯一应收义务衔接原订单与多张单据，避免每月覆盖历史总表。</p></div></div><div className="arp-chain" aria-label="订单到对账关联链">{['原订单 / PO', 'PI / 商业发票', '实际收款', '核销分配', 'STATEMENT'].map((item, index) => <span key={item}>{index > 0 && <Link2 size={13}/>}<b>{item}</b></span>)}</div><div className="arp-table-wrap"><ExcelTable><thead><tr><th>环节</th><th>负责人</th><th>办理内容</th><th>保留的关联依据</th></tr></thead><tbody>{futureSteps.map(([number, name, owner, action, evidence]) => <tr key={number}><td><small>{number}</small><b>{name}</b></td><td>{owner}</td><td>{action}</td><td>{evidence}</td></tr>)}</tbody></ExcelTable></div><p className="arp-note">PI 与商业发票可以对应同一批业务。订单已经形成应收时，商业发票须引用该应收，不能再把整票金额另记一次；新增的真实收费、差额或贷项须单独核对。</p><p className="arp-footnote">上述为完整办理顺序。尚未自动联动的环节继续使用现有原业务入口并保存关联依据；外部新增发票可增量归档，新号新增、修订版留版本，已核对旧版不覆盖。</p></section>

    <section className="arp-section"><div className="arp-heading"><span>04</span><div><h3>不同客户、不同眼镜类别共用一套账务</h3><p>格式差异通过模板与扩展信息表达，核心账务字段保持统一。</p></div></div><div className="arp-table-wrap"><ExcelTable><thead><tr><th>字段层次</th><th>保存什么</th><th>控制方式</th></tr></thead><tbody>{fieldGroups.map(([name, content, rule]) => <tr key={name}><td><b>{name}</b></td><td>{content}</td><td>{rule}</td></tr>)}</tbody></ExcelTable></div><div className="arp-examples"><article><b>光学架 / 太阳镜</b><p>共用客户、币种、发票号和金额口径；按需增加镜片类型、客款号、框色、尺寸等字段。</p></article><article><b>配件 / 包装 / 模具 / 样办</b><p>明确收费类别、数量依据和原订单关系，避免把费用单或订金通知当成另一笔整单货款。</p></article><article><b>模板版本</b><p>修改标题、语言或可选列后，新生成的对账快照采用新配置；旧快照保留当时的模板及业务内容。</p></article></div><p className="arp-note">客户模板用于对账单展示与扩展信息登记。客户原发票的版式归档及未来制单模板是不同环节；模板设置不会自动解析任意格式文件，也不会重算历史账。</p></section>

    <section className="arp-section"><div className="arp-heading"><span>05</span><div><h3>原订单、发票与付款怎样追踪</h3><p>从发票回查原业务，从对账单追溯生成时的版本与依据。</p></div></div><div className="arp-trace"><article><b>原订单 → 发票</b><p>选择同一客户的精确原业务记录，核对编号、类型、金额范围和来源；保留关联理由。没有对应记录时保持未关联。</p></article><article><b>发票 → 收款 / 核销</b><p>历史档案查看已核对累计实收及付款依据；新的实际到账回到原财务入口登记，并按依据分配到应收。</p></article><article><b>发票 → 原件 / STATEMENT</b><p>原件可下载，工作表及单元格可核查。STATEMENT 冻结当时的金额、关联、备注和模板；之后发生的业务生成新快照。</p></article></div><p className="arp-note">上传付款凭证只补充证据，不等于银行到账。收款状态由金额和核对记录生成，人工备注与产品扩展信息不能更改账务状态。</p></section>

    <section className="arp-section"><div className="arp-heading"><span>06</span><div><h3>遇到异常先保留依据</h3><p>缺失值显示待核对；金额、原币、来源或关联不一致时，先解决差异。</p></div></div><div className="arp-exception-list">{exceptions.map(([issue, action]) => <article key={issue}><b>{issue}</b><p>{action}</p></article>)}</div></section>

    <section className="arp-section"><div className="arp-heading"><span>07</span><div><h3>分工与权限</h3><p>业务职责与账号权限共同约束操作。</p></div></div><div className="arp-role-grid"><article><b>客服</b><p>维护原票、客户模板和业务说明，核对订单 / 出货关联，跟进客户差异。</p></article><article><b>财务</b><p>确认到账、核销、退款、金额口径和对账截至日；复核对客定稿。</p></article><article><b>业务 / PMC</b><p>业务确认合同与价格变更；PMC、仓储提供实际生产及出货依据。</p></article><article><b>管理员</b><p>按既有权限办理历史迁移与配置。当前新增维护入口仅对有权管理员开放。</p></article></div><p className="arp-footnote">只读账号不能写入、核对或上传；客户分组变化不倒改历史归属。发送客户前由客服与财务核对收件人、版本、金额和附件，系统不自动外发。</p></section>
  </section>;
}
