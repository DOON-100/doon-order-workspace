# CLI 全站入口覆盖清单（W0）

基线：`2cd873e`，2026-10-27。本页由 `lib/department-workspace-navigation.ts` 的 `departmentRouteOrder` 明确列出的入口逐一登记；动态生成或落入管理组的旧入口仍待逐页扫描。清单是盘点起点，不表示这些页面可见于每个员工，也不表示已完成逐表单/字段/接口/权限核验。字段、动作、角色与范围、依赖和验收均须在对应批次补齐；不能将页面入口数量当作完成数量。页面表中的候选源码是按栏目归集的排查入口，不表示每个源码均适用于该页面，必须逐项核对。

业务接口入口为 `app/api/workspace/[action]/route.ts`；具体限制以各处理器和数据模型为准。已有 CLI 查询覆盖与实际 `cli/src/catalog.ts` 对照。所有业务写入仍未开放；候选接口及批次见 [写入阶段计划](cli-write-implementation-plan.md)，处理器初筛见 [API 源码索引](cli-write-api-index.md)，部分 schema 的顶层字段线索见 [字段源码索引](cli-write-field-index.md)。从界面枚举实际按钮、隐含表单、动态角色入口、附件和外部动作，是后续逐批必须完成的工作。所有空缺必须显式登记，不能由页面名称推断权限或 CRUD。

| 栏目 | 页面/入口标识 | 计划批次 | 表单与字段 | 动作/接口 | 角色与记录范围 | 验收 |
| --- | --- | --- | --- | --- | --- | --- |
| 工作总览 | `workbench` | W10 | 待核验 | 候选源码：app/workspace.tsx | 待核验 | 待核验 |
| 工作总览 | `business-process` | W10 | 待核验 | 候选源码：app/workspace.tsx | 待核验 | 待核验 |
| 工作总览 | `personal-tasks` | W10 | 待核验 | 候选源码：app/workspace.tsx | 待核验 | 待核验 |
| 工作总览 | `dashboard` | W10 | 待核验 | 候选源码：app/workspace.tsx | 待核验 | 待核验 |
| 工作总览 | `reports` | W10 | 待核验 | 候选源码：app/workspace.tsx | 待核验 | 待核验 |
| 业务部 | `customers` | W1–W3 | 待核验 | 候选源码：lib/customer-project-api.ts、lib/customer-workflow-api.ts、lib/customer-quote-api.ts | 待核验 | 待核验 |
| 业务部 | `customer-projects` | W1–W3 | 待核验 | 候选源码：lib/customer-project-api.ts、lib/customer-workflow-api.ts、lib/customer-quote-api.ts | 待核验 | 待核验 |
| 业务部 | `process-rfq` | W1–W3 | 待核验 | 候选源码：lib/customer-project-api.ts、lib/customer-workflow-api.ts、lib/customer-quote-api.ts | 待核验 | 待核验 |
| 业务部 | `sales` | W1–W3 | 待核验 | 候选源码：lib/customer-project-api.ts、lib/customer-workflow-api.ts、lib/customer-quote-api.ts | 待核验 | 待核验 |
| 业务部 | `customer-quotes` | W1–W3 | 待核验 | 候选源码：lib/customer-project-api.ts、lib/customer-workflow-api.ts、lib/customer-quote-api.ts | 待核验 | 待核验 |
| 业务部 | `customer-price-archive` | W1–W3 | 待核验 | 候选源码：lib/customer-project-api.ts、lib/customer-workflow-api.ts、lib/customer-quote-api.ts | 待核验 | 待核验 |
| 业务部 | `mail` | W1–W3 | 待核验 | 候选源码：lib/customer-project-api.ts、lib/customer-workflow-api.ts、lib/customer-quote-api.ts | 待核验 | 待核验 |
| 业务部 | `whatsapp` | W1–W3 | 待核验 | 候选源码：lib/customer-project-api.ts、lib/customer-workflow-api.ts、lib/customer-quote-api.ts | 待核验 | 待核验 |
| 业务部 | `communications` | W1–W3 | 待核验 | 候选源码：lib/customer-project-api.ts、lib/customer-workflow-api.ts、lib/customer-quote-api.ts | 待核验 | 待核验 |
| 客服与单证 | `service` | W3/W7/W9 | 待核验 | 候选源码：lib/service-workspace-api.ts、lib/handoff-business-api.ts、lib/collaboration-api.ts | 待核验 | 待核验 |
| 客服与单证 | `service-workspace` | W3/W7/W9 | 待核验 | 候选源码：lib/service-workspace-api.ts、lib/handoff-business-api.ts、lib/collaboration-api.ts | 待核验 | 待核验 |
| 客服与单证 | `service-followups` | W3/W7/W9 | 待核验 | 候选源码：lib/service-workspace-api.ts、lib/handoff-business-api.ts、lib/collaboration-api.ts | 待核验 | 待核验 |
| 客服与单证 | `order-confirmations` | W3/W7/W9 | 待核验 | 候选源码：lib/service-workspace-api.ts、lib/handoff-business-api.ts、lib/collaboration-api.ts | 待核验 | 待核验 |
| 客服与单证 | `factory-orders` | W3/W7/W9 | 待核验 | 候选源码：lib/service-workspace-api.ts、lib/handoff-business-api.ts、lib/collaboration-api.ts | 待核验 | 待核验 |
| 客服与单证 | `kingdee-sales` | W3/W7/W9 | 待核验 | 候选源码：lib/service-workspace-api.ts、lib/handoff-business-api.ts、lib/collaboration-api.ts | 待核验 | 待核验 |
| 客服与单证 | `production-orders` | W3/W7/W9 | 待核验 | 候选源码：lib/service-workspace-api.ts、lib/handoff-business-api.ts、lib/collaboration-api.ts | 待核验 | 待核验 |
| 客服与单证 | `documents` | W3/W7/W9 | 待核验 | 候选源码：lib/service-workspace-api.ts、lib/handoff-business-api.ts、lib/collaboration-api.ts | 待核验 | 待核验 |
| 客服与单证 | `process-complaint` | W3/W7/W9 | 待核验 | 候选源码：lib/service-workspace-api.ts、lib/handoff-business-api.ts、lib/collaboration-api.ts | 待核验 | 待核验 |
| 客服与单证 | `completed` | W3/W7/W9 | 待核验 | 候选源码：lib/service-workspace-api.ts、lib/handoff-business-api.ts、lib/collaboration-api.ts | 待核验 | 待核验 |
| 工程部 | `ie-quotes` | W2/W4 | 待核验 | 候选源码：lib/engineering-drawing-api.ts、lib/engineering-sop-api.ts、lib/ie-quote-api.ts | 待核验 | 待核验 |
| 工程部 | `engineering-materials` | W2/W4 | 待核验 | 候选源码：lib/engineering-drawing-api.ts、lib/engineering-sop-api.ts、lib/ie-quote-api.ts | 待核验 | 待核验 |
| 工程部 | `engineering-drawings` | W2/W4 | 待核验 | 候选源码：lib/engineering-drawing-api.ts、lib/engineering-sop-api.ts、lib/ie-quote-api.ts | 待核验 | 待核验 |
| 工程部 | `process-sample` | W2/W4 | 待核验 | 候选源码：lib/engineering-drawing-api.ts、lib/engineering-sop-api.ts、lib/ie-quote-api.ts | 待核验 | 待核验 |
| 工程部 | `process-engineering-change` | W2/W4 | 待核验 | 候选源码：lib/engineering-drawing-api.ts、lib/engineering-sop-api.ts、lib/ie-quote-api.ts | 待核验 | 待核验 |
| PMC 计划 | `production-planning` | W5–W6 | 待核验 | 候选源码：lib/pmc-api.ts、lib/planning-control-api.ts | 待核验 | 待核验 |
| PMC 计划 | `pmc-handoff` | W5–W6 | 待核验 | 候选源码：lib/pmc-api.ts、lib/planning-control-api.ts | 待核验 | 待核验 |
| PMC 计划 | `process-material-kit` | W5–W6 | 待核验 | 候选源码：lib/pmc-api.ts、lib/planning-control-api.ts | 待核验 | 待核验 |
| PMC 计划 | `pmc` | W5–W6 | 待核验 | 候选源码：lib/pmc-api.ts、lib/planning-control-api.ts | 待核验 | 待核验 |
| PMC 计划 | `planning-control` | W5–W6 | 待核验 | 候选源码：lib/pmc-api.ts、lib/planning-control-api.ts | 待核验 | 待核验 |
| PMC 计划 | `orders` | W5–W6 | 待核验 | 候选源码：lib/pmc-api.ts、lib/planning-control-api.ts | 待核验 | 待核验 |
| PMC 计划 | `mine` | W5–W6 | 待核验 | 候选源码：lib/pmc-api.ts、lib/planning-control-api.ts | 待核验 | 待核验 |
| 采购与外协 | `supplier-workspace` | W5–W6/W8 | 待核验 | 候选源码：lib/purchase-api.ts、lib/supplier-api.ts、lib/finished-supplier-api.ts | 待核验 | 待核验 |
| 采购与外协 | `supplier-pending` | W5–W6/W8 | 待核验 | 候选源码：lib/purchase-api.ts、lib/supplier-api.ts、lib/finished-supplier-api.ts | 待核验 | 待核验 |
| 采购与外协 | `supplier-followup` | W5–W6/W8 | 待核验 | 候选源码：lib/purchase-api.ts、lib/supplier-api.ts、lib/finished-supplier-api.ts | 待核验 | 待核验 |
| 采购与外协 | `supplier-samples` | W5–W6/W8 | 待核验 | 候选源码：lib/purchase-api.ts、lib/supplier-api.ts、lib/finished-supplier-api.ts | 待核验 | 待核验 |
| 采购与外协 | `supplier-kit` | W5–W6/W8 | 待核验 | 候选源码：lib/purchase-api.ts、lib/supplier-api.ts、lib/finished-supplier-api.ts | 待核验 | 待核验 |
| 采购与外协 | `supplier-outsourcing` | W5–W6/W8 | 待核验 | 候选源码：lib/purchase-api.ts、lib/supplier-api.ts、lib/finished-supplier-api.ts | 待核验 | 待核验 |
| 采购与外协 | `finished-outsourcing` | W5–W6/W8 | 待核验 | 候选源码：lib/purchase-api.ts、lib/supplier-api.ts、lib/finished-supplier-api.ts | 待核验 | 待核验 |
| 采购与外协 | `supplier-risk` | W5–W6/W8 | 待核验 | 候选源码：lib/purchase-api.ts、lib/supplier-api.ts、lib/finished-supplier-api.ts | 待核验 | 待核验 |
| 仓储物流 | `receiving` | W6–W7 | 待核验 | 候选源码：lib/purchase-api.ts、lib/service-workspace-api.ts、lib/process-workspace-api.ts | 待核验 | 待核验 |
| 仓储物流 | `process-warehouse` | W6–W7 | 待核验 | 候选源码：lib/purchase-api.ts、lib/service-workspace-api.ts、lib/process-workspace-api.ts | 待核验 | 待核验 |
| 仓储物流 | `process-packaging` | W6–W7 | 待核验 | 候选源码：lib/purchase-api.ts、lib/service-workspace-api.ts、lib/process-workspace-api.ts | 待核验 | 待核验 |
| 仓储物流 | `production-shipments` | W6–W7 | 待核验 | 候选源码：lib/purchase-api.ts、lib/service-workspace-api.ts、lib/process-workspace-api.ts | 待核验 | 待核验 |
| 仓储物流 | `logistics-waybills` | W6–W7 | 待核验 | 候选源码：lib/purchase-api.ts、lib/service-workspace-api.ts、lib/process-workspace-api.ts | 待核验 | 待核验 |
| 仓储物流 | `shipment-followups` | W6–W7 | 待核验 | 候选源码：lib/purchase-api.ts、lib/service-workspace-api.ts、lib/process-workspace-api.ts | 待核验 | 待核验 |
| 生产车间 | `department` | W6 | 待核验 | 候选源码：lib/operations.ts、lib/loss-api.ts、lib/finished-supplier-api.ts | 待核验 | 待核验 |
| 生产车间 | `mes` | W6 | 待核验 | 候选源码：lib/operations.ts、lib/loss-api.ts、lib/finished-supplier-api.ts | 待核验 | 待核验 |
| 生产车间 | `losses` | W6 | 待核验 | 候选源码：lib/operations.ts、lib/loss-api.ts、lib/finished-supplier-api.ts | 待核验 | 待核验 |
| 品质部 | `process-iqc` | W6–W7 | 待核验 | 候选源码：lib/process-workspace-api.ts | 待核验 | 待核验 |
| 品质部 | `process-first-article` | W6–W7 | 待核验 | 候选源码：lib/process-workspace-api.ts | 待核验 | 待核验 |
| 品质部 | `process-process-quality` | W6–W7 | 待核验 | 候选源码：lib/process-workspace-api.ts | 待核验 | 待核验 |
| 品质部 | `process-outsourcing-quality` | W6–W7 | 待核验 | 候选源码：lib/process-workspace-api.ts | 待核验 | 待核验 |
| 品质部 | `process-oqc` | W6–W7 | 待核验 | 候选源码：lib/process-workspace-api.ts | 待核验 | 待核验 |
| 品质部 | `process-shipment-release` | W6–W7 | 待核验 | 候选源码：lib/process-workspace-api.ts | 待核验 | 待核验 |
| 财务部 | `payment-terms` | W8 | 待核验 | 候选源码：lib/customer-project-finance-api.ts、lib/ar-workspace-api.ts、lib/payment-terms-api.ts | 待核验 | 待核验 |
| 财务部 | `supplier-reconciliation` | W8 | 待核验 | 候选源码：lib/customer-project-finance-api.ts、lib/ar-workspace-api.ts、lib/payment-terms-api.ts | 待核验 | 待核验 |
| 财务部 | `process-supplier-reconciliation` | W8 | 待核验 | 候选源码：lib/customer-project-finance-api.ts、lib/ar-workspace-api.ts、lib/payment-terms-api.ts | 待核验 | 待核验 |
| 财务部 | `ar-workspace` | W8 | 待核验 | 候选源码：lib/customer-project-finance-api.ts、lib/ar-workspace-api.ts、lib/payment-terms-api.ts | 待核验 | 待核验 |
| 财务部 | `service-receivables` | W8 | 待核验 | 候选源码：lib/customer-project-finance-api.ts、lib/ar-workspace-api.ts、lib/payment-terms-api.ts | 待核验 | 待核验 |
| 财务部 | `project-finance` | W8 | 待核验 | 候选源码：lib/customer-project-finance-api.ts、lib/ar-workspace-api.ts、lib/payment-terms-api.ts | 待核验 | 待核验 |
| 财务部 | `finance-documents` | W8 | 待核验 | 候选源码：lib/customer-project-finance-api.ts、lib/ar-workspace-api.ts、lib/payment-terms-api.ts | 待核验 | 待核验 |
| 系统管理 | `business-rules` | W10 | 待核验 | 候选源码：app/api/workspace/[action]/route.ts、lib/handoff-framework-api.ts | 待核验 | 待核验 |
| 系统管理 | `imports` | W10 | 待核验 | 候选源码：app/api/workspace/[action]/route.ts、lib/handoff-framework-api.ts | 待核验 | 待核验 |
| 系统管理 | `settings` | W10 | 待核验 | 候选源码：app/api/workspace/[action]/route.ts、lib/handoff-framework-api.ts | 待核验 | 待核验 |
| 系统管理 | `members` | W10 | 待核验 | 候选源码：app/api/workspace/[action]/route.ts、lib/handoff-framework-api.ts | 待核验 | 待核验 |
| 系统管理 | `maintenance` | W10 | 待核验 | 候选源码：app/api/workspace/[action]/route.ts、lib/handoff-framework-api.ts | 待核验 | 待核验 |
| 系统管理 | `business-tools` | W10 | 待核验 | 候选源码：app/api/workspace/[action]/route.ts、lib/handoff-framework-api.ts | 待核验 | 待核验 |

## 重点共用表单及已发现的边界

| 表单族 | 服务端入口线索 | 现有能力和待核验 |
| --- | --- | --- |
| 流程作业 | `process-data`、`process-history`、`process-save`；`lib/process-workspace-api.ts` | 流程类型共享入口但详情字段按类型校验；服务器校验客户、订单、组别和角色；个别类型当前 CLI 已查询，写入未接入。另有 `process-change-*`，预览是否登记记录需核验。 |
| 客户项目 | `customer-project-*`；`lib/customer-project-api.ts` | 保存、项目回收/恢复、款式、轮次、任务、图纸及样品等存在不同 schema；表单字段、权限和副作用待逐项核验。 |
| 项目结算 | `project-finance-*`、`project-receipt-*` 等；`lib/customer-project-finance-api.ts` | 通用项目财务登记按 `entryType` 区分；收款核实、分配、冲销、退款等是不同动作，不可合并。具体角色及金额规则逐项核验。 |
| 采购 | `purchase-*`；`lib/purchase-api.ts`、`lib/purchase-change-api.ts` | 涉及预览、提交、保存、收货、归档；具体副作用、角色和字段待核验。 |
| 客服/单证 | `service-*`、`handoff-business-*`；对应 API 文件 | 跟进、应收、单据状态和附件分别核验；不得将登记状态视为真实外部发送。 |
| 账号与设置 | `member`、`framework-*`、`payment-terms-*` 等 | 应按实际服务端权限核验，禁止因目录可见而推断允许管理；凭据不进入 CLI 参数/日志。 |

## 已初核的字段和动作（仍需真实处理器验收）

| 页面与动作 | 请求字段线索 | 版本、权限与约束线索 | 状态 |
| --- | --- | --- | --- |
| 客户资料：`customer-save` | `id`、`expectedVersion`、`createOnly`、`customer`、`customerCode`、责任姓名和成员、`directory`、`workflow`、`notes`、`active`；嵌套字段见 `lib/collaboration-api.ts` 对应 schema | 客户目录修改要求版本；责任、客户身份冲突及付款条件需服务端校验。具体角色/字段范围待完整核对 | 查询部分已接入；写入未接入 |
| 项目保存：`customer-project-save` | `id`、`version`、`token`、`customerId`、`code`、`title`、`description`、`teamId`、业务/客服负责人、审核人、`dueDate`、`status`、`development`；具体默认值与约束见 `lib/customer-project-api.ts` | 客户范围、项目角色和任务关系须服务端校验；回收与恢复为独立动作，不是物理删除 | 查询部分已接入；写入未接入 |
| 流程作业：`process-save` | `id`、`version`、`token`、`type`、`customerId`、`orderId`、`teamId`、`title`、负责人/日期/状态、来源依据和版本、产出证据、阻塞与下一步、`notes`、`details`；`details` 按类型使用不同 schema | 服务端校验成员角色、客户/订单关联、组别、负责人和必要版本；已有 token 去重实现，具体各流程字段待逐项核验 | 10 类流程部分查询已接入；写入未接入 |

字段表是代码核对线索，并非最终用户可直接提交的完整契约；每个后续批次还必须验证默认值、嵌套结构、敏感字段、不可修改字段、冲突/回读及权限矩阵。

## W1 接口先行核查：客户主档

`lib/collaboration-api.ts` 的 `customer-save` 不是天然安全的通用 PATCH：按客户名称查找已有记录，`createOnly` 才明确拒绝已存在客户；若省略多项字段，schema 对部分字段提供空字符串或其他默认值。旧记录只在提交了 `expectedVersion` 时一般性比较版本，维护 `directory` 则要求该版本。直接把任意部分 JSON 接到该保存入口可能覆盖原值，因此 W1 必须先设计并验证只改指定字段的服务器端合并与并发保护；不能由 CLI 读取后盲目补全并伪装成安全的部分更新。

该入口要求有效的 `admin`、`pmc`、`sales` 或 `clerk`，并进一步执行只读限制、客户责任字段与角色限制；PMC 不得新建或修改客户名称和编号，公海转移走原有业务流程。客户端不能按角色名称简单推断实际客户范围。入口当前 schema 没有通用请求 token，新增/修改遇到超时不能假设可安全重试；必须先核查原操作，或在服务器补充与实际操作绑定的幂等机制。

项目 `customer-project-save` 检查对应客户写入权限，对负责人、小组及审核人另有限制；流程 `process-save` 由服务器校验具体流程类型、客户/订单及组范围，并在提供 token 时维护请求指纹。两者的具体字段、业务规则和重试语义仍须按各动作完成契约与合成测试。

## 其他已确认的接口差异

- `process-save` 更新必须匹配当前版本，新建不得携带旧版本；类型、客户、订单和业务组不可改绑。`token` 可选，服务端按员工和请求指纹检测复用；缺省字段有默认值，更新前仍须核对完整表单语义及并发。各类型 `details` 的字段和权限不相同。
- `factory-order-save` 的动作字段区分草稿、客服确认、PMC 确认和下发；多个文本字段有空值默认，当前请求 schema 未提供版本或 token。历史会新增版本，但不等于客户端的过期保护或请求去重。W3 接入前须补充或验证针对相应动作的服务器并发、幂等及回读契约，不把下发简化为普通保存。
- `workflow` 是另一个订单交接入口，携带订单 `version` 和动作；业务、客服、PMC 各自的责任校验不同，不能仅靠读取订单权限调用。以上是源码审计线索，具体功能仍需独立合成测试。

## 缺口状态

- 此表还不是逐字段、逐角色的完成矩阵；待逐批读取页面及服务端 schema，逐项标注可复用、需新增接口或不支持、CRUD 语义和验收证据。
- 附件、批量导入、审批、外部同步/发送、历史及只读报表需要独立记录副作用；不假设所有 `GET` 都是无副作用。
- 尚未确定全员下载入口、升级渠道、不同系统分发及容量上限；见 W11。测试环境的容量结果不得当作生产承诺。
