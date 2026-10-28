# W11 导航与阶段源码盘点

2026-10-28。仅公开源码盘点，不含正式业务数据。产品基线main `916d077c8c74668820a1adec7f51e23ca54829d3`，CLI0.41登记425条，本期413条非金蝶。完整成品与员工实机结果分别记录，不能由本页推断。

可复用工具 `cli/scripts/audit-navigation-coverage.mjs` 使用已锁定的TypeScript编译器只解析公开导航、阶段、CLI目录及固定路由源码，不执行网页或处理器，不读取员工配置、数据库或凭据，不连接服务器。实际运行覆盖11个栏目、72个配置入口和13个阶段，命令族均能在当前登记中找到；没有未分类的配置入口。它检查的是同类记录/命令族映射，不是逐按钮或字段验收。

| 栏目 | 配置入口 | 业务族链接 | 导航/展示及关联查询 | 明确能力边界 | 按用户指示暂缓 |
| --- | --- | --- | --- | --- | --- |
| 工作总览 | 5 | 3 | 2 | 0 | 0 |
| 业务部 | 9 | 7 | 0 | 2 | 0 |
| 客服与单证 | 10 | 8 | 0 | 1 | 1 |
| 工程部 | 5 | 5 | 0 | 0 | 0 |
| PMC计划 | 7 | 6 | 1 | 0 | 0 |
| 采购与外协 | 8 | 1 | 0 | 2 | 5 |
| 仓储物流 | 6 | 6 | 0 | 0 | 0 |
| 生产车间 | 3 | 2 | 0 | 1 | 0 |
| 品质部 | 6 | 6 | 0 | 0 | 0 |
| 财务部 | 7 | 5 | 0 | 2 | 0 |
| 系统管理 | 6 | 0 | 0 | 6 | 0 |
| 合计 | 72 | 49 | 3 | 14 | 6 |

49条“业务族链接”不能读成49条已完成全部操作。3条展示入口复用原查询，不发明跨阶段统一批准或CLI图表接口。14条明确边界包括：手工通讯不真实外发、供应商本人动作不代行、MES不外呼、财务凭据不等于银行转账、业务成员不创建/重置认证账号、规则及路径不执行任意代码、维护只诊断而不部署/备份恢复。6条暂缓为kingdee-sales及供应商待交源表工作空间/待交/样品/配套/风险视图；supplier-followup及supplier-reconciliation的原采购台账与独立流程部分另外保留，不能冒认为金蝶源表链路已覆盖。

## 13阶段对应

| 阶段 | 源码主入口 |
| --- | --- |
| S01客户开发 | customers、customer-projects |
| S02需求评估 | engineering-drawings、process-rfq |
| S03报价成本 | customer-quotes、customer-price-archive |
| S04订单评审 | order-confirmations、factory-orders、pmc-handoff |
| S05开发签样 | engineering-drawings、process-sample、process-engineering-change |
| S06计划采购 | pmc、planning-control、receiving |
| S07来料齐料 | process-iqc、process-material-kit、process-warehouse |
| S08生产制造 | pmc、department、finished-outsourcing、losses |
| S09过程品质 | process-first-article、process-process-quality、process-outsourcing-quality |
| S10成品包装 | department、process-oqc、process-packaging |
| S11出货交付 | production-shipments、logistics-waybills、process-shipment-release |
| S12账款核对 | ar-workspace、finance-documents、process-supplier-reconciliation |
| S13售后维护 | service-workspace、customer-projects、process-complaint |

逐项JSON包含源文件行号、文件SHA-256、命令名及副作用类别，保存在被忽略的 `test-output/cli-0.41-source-coverage-audit-v4.json`。本次工具SHA-256为 `03291fea145f4cdbc30204a759a03b47f044a08c45965068f0724afaac7b2451`。从仓库根目录用 `node cli/scripts/audit-navigation-coverage.mjs --output test-output/new-source-audit.json` 复核，输出必须是新的测试目录文件；新配置入口若未分类会返回非零，源码格式变化则要求复核解析器，不静默补映射。

同一盘点已加入Windows CLI CI，在构建/文档检查之后、打包之前运行；导航和阶段源码修改也会触发该CI。本机已从CI使用的cli工作目录实际执行相同入口，远端结果以新提交的Actions状态为准。这项守卫只阻止漏盘点，不把已分类入口自动认证为业务验收通过。

已核对远端main63d1064的CLI CI40683846845：首次既有真实DPAPI单元测试在10秒限时失败，盘点步骤尚未执行；保持原断言只重跑失败Windows任务，attempt2的106项、实际盘点及打包均成功，job122803772319的盘点步骤结论为success。产品基线916d077的两套CI、Windows413条/248组及下载来源另外独立通过，不将首次失败写成成功。

同一main63d1064的Native CI40683846772随后成功；因此新增只读盘点及CI接入的提交也完成双CI检查。本页最终归档只更新说明，不改程序或正式运行配置。

盘点使用已编译的命令登记；本机复核前先执行 `npm --prefix cli run build`，CI的npm test已包含构建。解析器只读TypeScript语法树，未知动态入口构造、重复分组或新页签上下文须人工复核，不能通过执行应用代码猜测其结果。

## 实机与动态范围仍待

导航函数保留未预配置的旧入口到管理组；隐藏按钮、角色条件、业务组/来源上下文、动态旧入口及真实员工机器不能仅靠固定72条证明全部完成。业务角色/版本/原件等合成验证查各批次验收，真实员工安装、专用测试地址、正式分发入口及真实部署容量仍需对应环境。WorkBuddy操作已被用户取消，不记为通过；不以本页扩大正式业务写入、外发或部署授权。
