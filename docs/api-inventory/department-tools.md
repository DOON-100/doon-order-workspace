# 按 10 个部门分组的工具适配表

由 `node scripts/group-api-inventory.mjs` 根据导航、接口清单与人工分组配置生成。当前是接入配置方案，未注册运行工具或开放业务写入。

源清单：[接口清点报告](../api-inventory.md)；分组配置：[department-mapping.json](department-mapping.json)；机器可读结果：[department-tools.json](department-tools.json)。

## 范围与组织方式

共 364 个去重接口，其中工作区 341 个、基础接口 23 个。严格使用左侧除“工作总览”之外的 10 组。共用接口只登记一次，通过 groups 在多组展示，各组数量不可相加当作接口总数。

- 分组帮助 Agent 找到业务能力，不是角色或授权列表。账号能否操作，由原中台逐请求、逐记录、逐字段校验。
- 同一 Agent 可以使用多个分组；进入某组、创建 Agent 或勾选工具都不增加权限。
- 按业务对象生成具体动作工具，共用执行层；不会将 336 个接口全部作为独立工具一次塞给模型。
- 通用流程按 14 种 type 固定各自字段与规则；模型不能任意切换 type、直接更新状态绕过专用动作。
- 账号、密码、会话、服务身份和调度属于系统管理清点范围，其中应用内/后台专用入口不能作为普通模型工具。
- 管理组只是目录归属：human-admin-flow 不表示所有动作都必须是 admin，仍采用原角色/负责人规则。
- 工作总览继续由授权查询汇总，不新增第 11 个工具分组。

| 分组 | 接口关联数（含共用） | 所含业务流程类型 |
| --- | ---: | --- |
| [业务部](#sales) | 111 | 询价与需求评估 |
| [客服与单证](#service) | 116 | 客诉与复盘 |
| [工程部](#engineering) | 56 | 样品与签样、工程变更 |
| [PMC 计划](#planning) | 66 | 配套齐料 |
| [采购与外协](#purchasing) | 47 | 使用已有专用业务动作 |
| [仓储物流](#warehouse) | 40 | 仓库流转、包装核对 |
| [生产车间](#production) | 28 | 使用已有专用业务动作 |
| [品质部](#quality) | 12 | 来料检验、首件确认、过程检验、外协检验、成品检验、出货放行记录 |
| [财务部](#finance) | 88 | 供应商对账 |
| [系统管理](#management) | 65 | 使用已有专用业务动作 |

<a id="sales"></a>

## 业务部

客户开发 → 需求与报价。

导航范围：`customers`、`customer-projects`、`process-rfq`、`sales`、`customer-quotes`、`customer-price-archive`、`mail`、`whatsapp`、`communications`。

| 业务对象 | 查询/读取接口 | 保存、变更及专用动作 | 字段与规则来源 |
| --- | --- | --- | --- |
| 授权聚合数据、版本与业务组目录 | `business-team-data`、`data`、`read-version` | 此对象未登记 POST 动作 | [route.ts](../../app/api/workspace/%5Baction%5D/route.ts) |
| 客户主档 | `customer-master-capabilities`、`customer-template` | `customer-import`、`customer-save` | [collaboration-api.ts](../../lib/collaboration-api.ts) |
| 历史价格原件 | `customer-price-archive`、`customer-price-archive-export`、`customer-price-archive-file` | `customer-price-archive-file-upload`、`customer-price-archive-import`、`customer-price-selection-save` | [customer-price-archive-api.ts](../../lib/customer-price-archive-api.ts) |
| 项目、图纸与样办共用查询及原件 | `customer-project-data`、`customer-project-file`、`customer-project-history` | `customer-project-attachment` | [customer-project-api.ts](../../lib/customer-project-api.ts) |
| 客户项目、样办与回收站 | 由关联视图/专用入口读取，未另造查询 | `customer-project-bulk-link`、`customer-project-communication`、`customer-project-entry-save`、`customer-project-item-save`、`customer-project-quote-link`、`customer-project-restore`、`customer-project-round-save`、`customer-project-save`、`customer-project-task-review`、`customer-project-task-save`、`customer-project-task-submit`、`customer-project-trash` | [customer-project-api.ts](../../lib/customer-project-api.ts) |
| 项目跟进与历史邮件 | `customer-project-followup-data`、`customer-project-followup-history`、`customer-project-followup-source-file` | `customer-project-followup-import`、`customer-project-followup-mail-classify`、`customer-project-followup-promote`、`customer-project-followup-save` | [customer-project-followup-api.ts](../../lib/customer-project-followup-api.ts) |
| 客户报价 | `customer-quote-access`、`customer-quote-completed`、`customer-quote-file`、`customer-quote-media-file`、`customer-quote-version`、`customer-quotes` | `customer-quote-confirm`、`customer-quote-media-upload`、`customer-quote-record-sent`、`customer-quote-revise`、`customer-quote-save`、`customer-quote-upload` | [customer-quote-api.ts](../../lib/customer-quote-api.ts) |
| 报价模板 | `customer-quote-completed-export`、`customer-quote-template-output-file`、`customer-quote-templates` | `customer-quote-template-apply`、`customer-quote-template-archive`、`customer-quote-template-register` | [customer-quote-template-api.ts](../../lib/customer-quote-template-api.ts) |
| 客户报价模板成品 | `customer-quote-template-export` | 此对象未登记 POST 动作 | [customer-quote-template-api.ts](../../lib/customer-quote-template-api.ts) |
| 客户公海与交接 | `customer-workflow-transfers` | `customer-workflow-accept`、`customer-workflow-cancel-handoff`、`customer-workflow-claim`、`customer-workflow-claim-approve`、`customer-workflow-handoff`、`customer-workflow-pool-approve`、`customer-workflow-pool-reject`、`customer-workflow-pool-request`、`customer-workflow-pool-withdraw`、`customer-workflow-primary` | [customer-workflow-transfers.ts](../../lib/customer-workflow-transfers.ts) |
| 客户档案与跟进 | `customer-workflow-data`、`customer-workflow-export`、`customer-workflow-history` | `customer-workflow-followup`、`customer-workflow-profile-save`、`customer-workflow-schedule` | [customer-workflow-api.ts](../../lib/customer-workflow-api.ts) |
| 客户文件与轻量项目 | `customer-workflow-file`、`customer-workflow-files`、`customer-workflow-project`、`customer-workflow-project-document` | `customer-workflow-file-save`、`customer-workflow-file-upload`、`customer-workflow-project-document-save`、`customer-workflow-project-log`、`customer-workflow-project-save` | [customer-workflow-files.ts](../../lib/customer-workflow-files.ts) |
| 客户待办 | `customer-workflow-task-history`、`customer-workflow-tasks` | `customer-workflow-task-save` | [customer-workflow-tasks.ts](../../lib/customer-workflow-tasks.ts) |
| 固定报价费用工具 | `fixed-tool-quote` | `fixed-tool-fees-decision`、`fixed-tool-fees-preview` | [fixed-tool-fees.ts](../../lib/fixed-tool-fees.ts) |
| 沟通渠道、规则文档与通知 | `framework-channel-context`、`framework-channel-history`、`framework-channels` | `framework-message-bind`、`framework-message-link`、`framework-message-process`、`framework-message-save` | [handoff-framework-api.ts](../../lib/handoff-framework-api.ts) |
| 本人授权通知与签收 | `framework-notices` | `framework-notice-receive` | [handoff-framework-api.ts](../../lib/handoff-framework-api.ts) |
| 部门流程记录 | `process-data`、`process-history` | `process-save` | [process-workspace-api.ts](../../lib/process-workspace-api.ts) |
| 项目跨部门协作 | `project-collaboration-data` | `project-collaboration-acknowledge`、`project-collaboration-cancel`、`project-collaboration-complete`、`project-collaboration-followup`、`project-collaboration-save` | [project-collaboration-api.ts](../../lib/project-collaboration-api.ts) |
| 人工沟通草稿 | `unified-communication-data`、`unified-communication-history` | `unified-communication-complete-review`、`unified-communication-return`、`unified-communication-save`、`unified-communication-submit` | [unified-communication-api.ts](../../lib/unified-communication-api.ts) |

本组接入边界：

- 读取候选，待核验返回字段及副作用：43 项。
- 业务动作，按具体内容确认后执行：67 项。
- 文件生成/归档，非纯读取：1 项。

本组流程字段（以下仅列 details；公共字段见后文）：

| 流程 | 固定 type | 业务明细字段 |
| --- | --- | --- |
| 询价与需求评估 | `rfq` | 不适用或关口判断依据 `gateReason`（文本）、单据引用 `documentRef`（文本）、客户要求 `requirement`（文本）、期望交期 `targetDelivery`（文本）、需求数量 `quantity`（数值）、币种 `currency`（文本）、报价引用 `quoteRef`（文本） |

<a id="service"></a>

## 客服与单证

订单评审 → 制单交接 → 售后复盘。

导航范围：`service`、`service-workspace`、`service-followups`、`order-confirmations`、`factory-orders`、`production-orders`、`documents`、`process-complaint`、`completed`。

| 业务对象 | 查询/读取接口 | 保存、变更及专用动作 | 字段与规则来源 |
| --- | --- | --- | --- |
| 订单附件、备注与任务 | `file` | `attachment`、`comment`、`task` | [route.ts](../../app/api/workspace/%5Baction%5D/route.ts) |
| 授权聚合数据、版本与业务组目录 | `business-team-data`、`data`、`read-version` | 此对象未登记 POST 动作 | [route.ts](../../app/api/workspace/%5Baction%5D/route.ts) |
| 项目、图纸与样办共用查询及原件 | `customer-project-data`、`customer-project-file`、`customer-project-history` | `customer-project-attachment` | [customer-project-api.ts](../../lib/customer-project-api.ts) |
| 客户项目、样办与回收站 | 由关联视图/专用入口读取，未另造查询 | `customer-project-bulk-link`、`customer-project-communication`、`customer-project-entry-save`、`customer-project-item-save`、`customer-project-quote-link`、`customer-project-restore`、`customer-project-round-save`、`customer-project-save`、`customer-project-task-review`、`customer-project-task-save`、`customer-project-task-submit`、`customer-project-trash` | [customer-project-api.ts](../../lib/customer-project-api.ts) |
| 项目图纸、签样与样办 | 由关联视图/专用入口读取，未另造查询 | `customer-project-confirmation`、`customer-project-drawing`、`customer-project-drawing-withdraw`、`customer-project-sample-feedback`、`customer-project-sample-promise`、`customer-project-sample-release`、`customer-project-sample-update` | [customer-project-api.ts](../../lib/customer-project-api.ts) |
| 样办寄送与签收 | 由关联视图/专用入口读取，未另造查询 | `customer-project-dispatch-receive`、`customer-project-sample-dispatch` | [customer-project-api.ts](../../lib/customer-project-api.ts) |
| 客户档案与跟进 | `customer-workflow-data`、`customer-workflow-export`、`customer-workflow-history` | `customer-workflow-followup`、`customer-workflow-profile-save`、`customer-workflow-schedule` | [customer-workflow-api.ts](../../lib/customer-workflow-api.ts) |
| 客户文件与轻量项目 | `customer-workflow-file`、`customer-workflow-files`、`customer-workflow-project`、`customer-workflow-project-document` | `customer-workflow-file-save`、`customer-workflow-file-upload`、`customer-workflow-project-document-save`、`customer-workflow-project-log`、`customer-workflow-project-save` | [customer-workflow-files.ts](../../lib/customer-workflow-files.ts) |
| 客户待办 | `customer-workflow-task-history`、`customer-workflow-tasks` | `customer-workflow-task-save` | [customer-workflow-tasks.ts](../../lib/customer-workflow-tasks.ts) |
| 订单原表与报表 | `ledger-export`、`ledger-file`、`metric-export` | `export` | [route.ts](../../app/api/workspace/%5Baction%5D/route.ts)、[operations.ts](../../lib/operations.ts) |
| 客户主档、工厂订单与金蝶模板 | `factory-order-export`、`factory-order-table-export`、`factory-order-templates`、`factory-orders` | `factory-order-save`、`factory-order-table-commit`、`factory-order-table-preview`、`factory-order-template`、`workflow` | [collaboration-api.ts](../../lib/collaboration-api.ts) |
| 沟通渠道、规则文档与通知 | `framework-channel-context`、`framework-channel-history`、`framework-channels` | `framework-message-bind`、`framework-message-link`、`framework-message-process`、`framework-message-save` | [handoff-framework-api.ts](../../lib/handoff-framework-api.ts) |
| 财务协作任务 | `framework-finance-task-history`、`framework-finance-task-summary`、`framework-finance-tasks` | `framework-finance-task-accept`、`framework-finance-task-cancel`、`framework-finance-task-return`、`framework-finance-task-review`、`framework-finance-task-save`、`framework-finance-task-submit` | [framework-finance-task.ts](../../lib/framework-finance-task.ts) |
| 本人授权通知与签收 | `framework-notices` | `framework-notice-receive` | [handoff-framework-api.ts](../../lib/handoff-framework-api.ts) |
| 业务交接与单据 | `handoff-business-data`、`handoff-business-file`、`handoff-business-history`、`handoff-business-print`、`handoff-business-review-data` | `handoff-business-attachment`、`handoff-business-confirm`、`handoff-business-generate`、`handoff-business-return`、`handoff-business-save`、`handoff-business-submit` | [handoff-business-api.ts](../../lib/handoff-business-api.ts) |
| 交接定金与例外 | 由关联视图/专用入口读取，未另造查询 | `handoff-business-deposit-declaration`、`handoff-business-payment-exception` | [handoff-payment-actions.ts](../../lib/handoff-payment-actions.ts) |
| 部门流程记录 | `process-data`、`process-history` | `process-save` | [process-workspace-api.ts](../../lib/process-workspace-api.ts) |
| 项目跨部门协作 | `project-collaboration-data` | `project-collaboration-acknowledge`、`project-collaboration-cancel`、`project-collaboration-complete`、`project-collaboration-followup`、`project-collaboration-save` | [project-collaboration-api.ts](../../lib/project-collaboration-api.ts) |
| 客服业务 | `service-data`、`service-file`、`service-history` | `service-attachment`、`service-save` | [service-workspace-api.ts](../../lib/service-workspace-api.ts) |
| 客服业务收款及冲销 | 由关联视图/专用入口读取，未另造查询 | `service-receipt`、`service-receipt-reverse` | [service-workspace-api.ts](../../lib/service-workspace-api.ts) |
| 人工沟通草稿 | `unified-communication-data`、`unified-communication-history` | `unified-communication-complete-review`、`unified-communication-return`、`unified-communication-save`、`unified-communication-submit` | [unified-communication-api.ts](../../lib/unified-communication-api.ts) |

本组接入边界：

- 业务动作，按具体内容确认后执行：73 项。
- 读取候选，待核验返回字段及副作用：43 项。

本组流程字段（以下仅列 details；公共字段见后文）：

| 流程 | 固定 type | 业务明细字段 |
| --- | --- | --- |
| 客诉与复盘 | `complaint` | 不适用或关口判断依据 `gateReason`（文本）、单据引用 `documentRef`（文本）、客诉引用 `complaintRef`（文本）、原因 `cause`（文本）、纠正措施 `correction`（文本）、验证结果 `verification`（文本）、客户确认 `customerConfirmation`（文本） |

跨部门共用接口在本组的具体对象类型：

| 共用业务 | 本组类型 | 字段与规则 |
| --- | --- | --- |
| 跨部门业务资料与单据 | `po`、`production_order`、`finance_request`、`pi`、`invoice`、`packing`、`paymentrequest` | [lib/handoff-business.ts](../../lib/handoff-business.ts)；按 kind/type 生成具体动作契约；共用视图按授权对象裁剪。来源版本、单据生成与财务状态继续由原接口校验，不以目录位置授予单据权限。 |
| 客服、发运签收与订单应收 | `customer_profile`、`followup`、`project`、`sample`、`shipment`、`receivable` | [lib/service-workspace.ts](../../lib/service-workspace.ts)；shipment-followups 和 service-receivables 复用此工作台，分别按 shipment、receivable 裁剪；不是两个新的业务数据库。 |

<a id="engineering"></a>

## 工程部

图纸 → 样品与资料确认。

导航范围：`engineering-materials`、`engineering-drawings`、`process-sample`、`process-engineering-change`。

| 业务对象 | 查询/读取接口 | 保存、变更及专用动作 | 字段与规则来源 |
| --- | --- | --- | --- |
| 授权聚合数据、版本与业务组目录 | `business-team-data`、`data`、`read-version` | 此对象未登记 POST 动作 | [route.ts](../../app/api/workspace/%5Baction%5D/route.ts) |
| 项目、图纸与样办共用查询及原件 | `customer-project-data`、`customer-project-file`、`customer-project-history` | `customer-project-attachment` | [customer-project-api.ts](../../lib/customer-project-api.ts) |
| 项目图纸、签样与样办 | 由关联视图/专用入口读取，未另造查询 | `customer-project-confirmation`、`customer-project-drawing`、`customer-project-drawing-withdraw`、`customer-project-sample-feedback`、`customer-project-sample-promise`、`customer-project-sample-release`、`customer-project-sample-update` | [customer-project-api.ts](../../lib/customer-project-api.ts) |
| 图号更正 | 由关联视图/专用入口读取，未另造查询 | `drawing-correction` | [drawing-correction-api.ts](../../lib/drawing-correction-api.ts) |
| 工程画图 | `drawing-data`、`drawing-history` | `drawing-detail-add`、`drawing-email-intake`、`drawing-event-review`、`drawing-import`、`drawing-review`、`drawing-save` | [engineering-drawing-api.ts](../../lib/engineering-drawing-api.ts) |
| 本人授权通知与签收 | `framework-notices` | `framework-notice-receive` | [handoff-framework-api.ts](../../lib/handoff-framework-api.ts) |
| 业务交接与单据 | `handoff-business-data`、`handoff-business-file`、`handoff-business-history`、`handoff-business-print`、`handoff-business-review-data` | `handoff-business-attachment`、`handoff-business-confirm`、`handoff-business-generate`、`handoff-business-return`、`handoff-business-save`、`handoff-business-submit` | [handoff-business-api.ts](../../lib/handoff-business-api.ts) |
| 部门流程记录 | `process-data`、`process-history` | `process-save` | [process-workspace-api.ts](../../lib/process-workspace-api.ts) |
| 项目跨部门协作 | `project-collaboration-data` | `project-collaboration-acknowledge`、`project-collaboration-cancel`、`project-collaboration-complete`、`project-collaboration-followup`、`project-collaboration-save` | [project-collaboration-api.ts](../../lib/project-collaboration-api.ts) |
| 工程 SOP | `sop-data`、`sop-file`、`sop-history` | `sop-attachment`、`sop-cancel`、`sop-change`、`sop-confirm`、`sop-create`、`sop-mes-upload`、`sop-prepare`、`sop-target` | [engineering-sop-api.ts](../../lib/engineering-sop-api.ts) |

本组接入边界：

- 读取候选，待核验返回字段及副作用：20 项。
- 业务动作，按具体内容确认后执行：36 项。

本组流程字段（以下仅列 details；公共字段见后文）：

| 流程 | 固定 type | 业务明细字段 |
| --- | --- | --- |
| 样品与签样 | `sample` | 不适用或关口判断依据 `gateReason`（文本）、单据引用 `documentRef`（文本）、样品版本 `sampleVersion`（文本）、样品数量 `sampleQuantity`（数值）、样品结果 `sampleResult`（文本）、签样凭证 `signoffRef`（文本） |
| 工程变更 | `engineering-change` | 不适用或关口判断依据 `gateReason`（文本）、单据引用 `documentRef`（文本）、原版本 `previousVersion`（文本）、新版本 `newVersion`（文本）、变更原因 `changeReason`（文本）、影响范围 `impactScope`（文本）、审批引用 `approvalRef`（文本） |

跨部门共用接口在本组的具体对象类型：

| 共用业务 | 本组类型 | 字段与规则 |
| --- | --- | --- |
| 跨部门业务资料与单据 | `engineering_drawing`、`engineering_quote` | [lib/handoff-business.ts](../../lib/handoff-business.ts)；按 kind/type 生成具体动作契约；共用视图按授权对象裁剪。来源版本、单据生成与财务状态继续由原接口校验，不以目录位置授予单据权限。 |

<a id="planning"></a>

## PMC 计划

订单接收 → 齐套与排程。

导航范围：`production-planning`、`pmc-handoff`、`process-material-kit`、`pmc`、`planning-control`、`orders`、`mine`。

| 业务对象 | 查询/读取接口 | 保存、变更及专用动作 | 字段与规则来源 |
| --- | --- | --- | --- |
| 订单附件、备注与任务 | `file` | `attachment`、`comment`、`task` | [route.ts](../../app/api/workspace/%5Baction%5D/route.ts) |
| 授权聚合数据、版本与业务组目录 | `business-team-data`、`data`、`read-version` | 此对象未登记 POST 动作 | [route.ts](../../app/api/workspace/%5Baction%5D/route.ts) |
| 原表/MES 文件导入与批次 | `job`、`template` | `commit-import`、`inspect`、`preview` | [route.ts](../../app/api/workspace/%5Baction%5D/route.ts) |
| 订单维护与核对 | 由关联视图/专用入口读取，未另造查询 | `correction`、`edit-order`、`match`、`review` | [route.ts](../../app/api/workspace/%5Baction%5D/route.ts) |
| 图号更正 | 由关联视图/专用入口读取，未另造查询 | `drawing-correction` | [drawing-correction-api.ts](../../lib/drawing-correction-api.ts) |
| 订单原表与报表 | `ledger-export`、`ledger-file`、`metric-export` | `export` | [route.ts](../../app/api/workspace/%5Baction%5D/route.ts)、[operations.ts](../../lib/operations.ts) |
| 客户主档、工厂订单与金蝶模板 | `factory-order-export`、`factory-order-table-export`、`factory-order-templates`、`factory-orders` | `factory-order-save`、`factory-order-table-commit`、`factory-order-table-preview`、`factory-order-template`、`workflow` | [collaboration-api.ts](../../lib/collaboration-api.ts) |
| 本人授权通知与签收 | `framework-notices` | `framework-notice-receive` | [handoff-framework-api.ts](../../lib/handoff-framework-api.ts) |
| 生产审核规则与采纳 | 由关联视图/专用入口读取，未另造查询 | `handoff-business-adoption-sign` | [handoff-production-review.ts](../../lib/handoff-production-review.ts) |
| 业务交接与单据 | `handoff-business-data`、`handoff-business-file`、`handoff-business-history`、`handoff-business-print`、`handoff-business-review-data` | `handoff-business-attachment`、`handoff-business-confirm`、`handoff-business-generate`、`handoff-business-return`、`handoff-business-save`、`handoff-business-submit` | [handoff-business-api.ts](../../lib/handoff-business-api.ts) |
| 金蝶订单导出与模板 | `kingdee-export` | `kingdee-template` | [collaboration-api.ts](../../lib/collaboration-api.ts) |
| 订单指派与归档 | 由关联视图/专用入口读取，未另造查询 | `ledger-assign`、`ledger-lifecycle` | [operations.ts](../../lib/operations.ts) |
| 原版工作簿导入 | 由关联视图/专用入口读取，未另造查询 | `ledger-commit`、`ledger-preview` | [operations.ts](../../lib/operations.ts) |
| 订单工序、外发收货与原表 | 由关联视图/专用入口读取，未另造查询 | `ledger-edit` | [operations.ts](../../lib/operations.ts) |
| 计划与产能 | `planning-control-data`、`planning-control-history` | `planning-capacity-allocation-save`、`planning-capacity-allocation-transition`、`planning-capacity-window-save`、`planning-control-calculation-save`、`planning-control-save`、`planning-control-transition` | [planning-control-api.ts](../../lib/planning-control-api.ts) |
| PMC 核单 | `pmc-data` | `pmc-review`、`pmc-round`、`pmc-save` | [pmc-api.ts](../../lib/pmc-api.ts) |
| 部门流程记录 | `process-data`、`process-history` | `process-save` | [process-workspace-api.ts](../../lib/process-workspace-api.ts) |

本组接入边界：

- 业务动作，按具体内容确认后执行：41 项。
- 读取候选，待核验返回字段及副作用：25 项。

本组流程字段（以下仅列 details；公共字段见后文）：

| 流程 | 固定 type | 业务明细字段 |
| --- | --- | --- |
| 配套齐料 | `material-kit` | 不适用或关口判断依据 `gateReason`（文本）、单据引用 `documentRef`（文本）、需求数量 `requiredQuantity`（数值）、齐套数量 `readyQuantity`（数值）、缺料事项 `shortageNote`（文本）、配料清单引用 `materialListRef`（文本） |

跨部门共用接口在本组的具体对象类型：

| 共用业务 | 本组类型 | 字段与规则 |
| --- | --- | --- |
| 跨部门业务资料与单据 | `production_order` | [lib/handoff-business.ts](../../lib/handoff-business.ts)；按 kind/type 生成具体动作契约；共用视图按授权对象裁剪。来源版本、单据生成与财务状态继续由原接口校验，不以目录位置授予单据权限。 |

<a id="purchasing"></a>

## 采购与外协

采购 → 催料与外发。

导航范围：`supplier-workspace`、`supplier-pending`、`supplier-followup`、`supplier-samples`、`supplier-kit`、`supplier-outsourcing`、`finished-outsourcing`、`supplier-risk`。

| 业务对象 | 查询/读取接口 | 保存、变更及专用动作 | 字段与规则来源 |
| --- | --- | --- | --- |
| 授权聚合数据、版本与业务组目录 | `business-team-data`、`data`、`read-version` | 此对象未登记 POST 动作 | [route.ts](../../app/api/workspace/%5Baction%5D/route.ts) |
| 成品供应商协作 | 由关联视图/专用入口读取，未另造查询 | `finished-supplier-accept`、`finished-supplier-baseline-confirm`、`finished-supplier-baseline-stage`、`finished-supplier-close`、`finished-supplier-exception`、`finished-supplier-order-confirm`、`finished-supplier-progress`、`finished-supplier-promise`、`finished-supplier-rework-confirm`、`finished-supplier-task-create` | [finished-supplier-api.ts](../../lib/finished-supplier-api.ts) |
| 成品外协凭证 | `finished-supplier-file` | `finished-supplier-attachment` | [finished-supplier-api.ts](../../lib/finished-supplier-api.ts) |
| 成品外协授权视图 | `finished-supplier-data` | 此对象未登记 POST 动作 | [finished-supplier-api.ts](../../lib/finished-supplier-api.ts) |
| 成品外协质检 | 由关联视图/专用入口读取，未另造查询 | `finished-supplier-qc` | [finished-supplier-api.ts](../../lib/finished-supplier-api.ts) |
| 成品外协发运、收货、退货与入仓 | 由关联视图/专用入口读取，未另造查询 | `finished-supplier-receive`、`finished-supplier-return`、`finished-supplier-shipment`、`finished-supplier-stock` | [finished-supplier-api.ts](../../lib/finished-supplier-api.ts) |
| 本人授权通知与签收 | `framework-notices` | `framework-notice-receive` | [handoff-framework-api.ts](../../lib/handoff-framework-api.ts) |
| 金蝶待核对 | `kingdee-pending-data`、`kingdee-pending-file` | `kingdee-pending-commit`、`kingdee-pending-preview` | [kingdee-pending-api.ts](../../lib/kingdee-pending-api.ts) |
| 供应商与外协 | `supplier-export`、`supplier-quote-export`、`supplier-quote-file`、`supplier-quote-template` | `outsource-approve`、`outsource-cancel`、`outsource-update`、`supplier-quote-file`、`supplier-quote-save`、`supplier-save` | [supplier-api.ts](../../lib/supplier-api.ts) |
| 工序外发登记 | 由关联视图/专用入口读取，未另造查询 | `outsource-create` | [operations.ts](../../lib/operations.ts) |
| 采购跟单 | `purchase-data`、`purchase-export`、`purchase-held`、`purchase-history` | `purchase-archive`、`purchase-commit`、`purchase-preview`、`purchase-receipt`、`purchase-save` | [purchase-api.ts](../../lib/purchase-api.ts) |

本组接入边界：

- 读取候选，待核验返回字段及副作用：16 项。
- 业务动作，按具体内容确认后执行：31 项。

<a id="warehouse"></a>

## 仓储物流

收货 → 仓储与发运。

导航范围：`receiving`、`process-warehouse`、`process-packaging`、`production-shipments`、`logistics-waybills`、`shipment-followups`。

| 业务对象 | 查询/读取接口 | 保存、变更及专用动作 | 字段与规则来源 |
| --- | --- | --- | --- |
| 授权聚合数据、版本与业务组目录 | `business-team-data`、`data`、`read-version` | 此对象未登记 POST 动作 | [route.ts](../../app/api/workspace/%5Baction%5D/route.ts) |
| 项目、图纸与样办共用查询及原件 | `customer-project-data`、`customer-project-file`、`customer-project-history` | `customer-project-attachment` | [customer-project-api.ts](../../lib/customer-project-api.ts) |
| 样办寄送与签收 | 由关联视图/专用入口读取，未另造查询 | `customer-project-dispatch-receive`、`customer-project-sample-dispatch` | [customer-project-api.ts](../../lib/customer-project-api.ts) |
| 成品外协凭证 | `finished-supplier-file` | `finished-supplier-attachment` | [finished-supplier-api.ts](../../lib/finished-supplier-api.ts) |
| 成品外协授权视图 | `finished-supplier-data` | 此对象未登记 POST 动作 | [finished-supplier-api.ts](../../lib/finished-supplier-api.ts) |
| 成品外协发运、收货、退货与入仓 | 由关联视图/专用入口读取，未另造查询 | `finished-supplier-receive`、`finished-supplier-return`、`finished-supplier-shipment`、`finished-supplier-stock` | [finished-supplier-api.ts](../../lib/finished-supplier-api.ts) |
| 本人授权通知与签收 | `framework-notices` | `framework-notice-receive` | [handoff-framework-api.ts](../../lib/handoff-framework-api.ts) |
| 业务交接与单据 | `handoff-business-data`、`handoff-business-file`、`handoff-business-history`、`handoff-business-print`、`handoff-business-review-data` | `handoff-business-attachment`、`handoff-business-confirm`、`handoff-business-generate`、`handoff-business-return`、`handoff-business-save`、`handoff-business-submit` | [handoff-business-api.ts](../../lib/handoff-business-api.ts) |
| 包装入仓 | 由关联视图/专用入口读取，未另造查询 | `pack` | [route.ts](../../app/api/workspace/%5Baction%5D/route.ts) |
| 部门流程记录 | `process-data`、`process-history` | `process-save` | [process-workspace-api.ts](../../lib/process-workspace-api.ts) |
| 送货凭证与收货确认 | 由关联视图/专用入口读取，未另造查询 | `receipt-confirm`、`receipt-photo` | [operations.ts](../../lib/operations.ts) |
| 客服业务 | `service-data`、`service-file`、`service-history` | `service-attachment`、`service-save` | [service-workspace-api.ts](../../lib/service-workspace-api.ts) |

本组接入边界：

- 读取候选，待核验返回字段及副作用：19 项。
- 业务动作，按具体内容确认后执行：21 项。

本组流程字段（以下仅列 details；公共字段见后文）：

| 流程 | 固定 type | 业务明细字段 |
| --- | --- | --- |
| 仓库流转 | `warehouse` | 不适用或关口判断依据 `gateReason`（文本）、单据引用 `documentRef`（文本）、流转类型 `movementType`（文本）、流转数量 `quantity`（数值）、仓库名称 `warehouseName`（文本）、出入库单引用 `sourceDocumentRef`（文本） |
| 包装核对 | `packaging` | 不适用或关口判断依据 `gateReason`（文本）、单据引用 `documentRef`（文本）、包装数量 `quantity`（数值）、箱数 `cartons`（数值）、包装要求版本 `packingSpec`（文本）、装箱单引用 `packingListRef`（文本） |

跨部门共用接口在本组的具体对象类型：

| 共用业务 | 本组类型 | 字段与规则 |
| --- | --- | --- |
| 跨部门业务资料与单据 | `production_shipment`、`packing`、`waybill` | [lib/handoff-business.ts](../../lib/handoff-business.ts)；按 kind/type 生成具体动作契约；共用视图按授权对象裁剪。来源版本、单据生成与财务状态继续由原接口校验，不以目录位置授予单据权限。 |
| 客服、发运签收与订单应收 | `shipment` | [lib/service-workspace.ts](../../lib/service-workspace.ts)；shipment-followups 和 service-receivables 复用此工作台，分别按 shipment、receivable 裁剪；不是两个新的业务数据库。 |

<a id="production"></a>

## 生产车间

工序流转 → 报工与损耗。

导航范围：`department`、`mes`、`losses`。

| 业务对象 | 查询/读取接口 | 保存、变更及专用动作 | 字段与规则来源 |
| --- | --- | --- | --- |
| 订单附件、备注与任务 | `file` | `attachment`、`comment`、`task` | [route.ts](../../app/api/workspace/%5Baction%5D/route.ts) |
| 授权聚合数据、版本与业务组目录 | `business-team-data`、`data`、`read-version` | 此对象未登记 POST 动作 | [route.ts](../../app/api/workspace/%5Baction%5D/route.ts) |
| 原表/MES 文件导入与批次 | `job`、`template` | `commit-import`、`inspect`、`preview` | [route.ts](../../app/api/workspace/%5Baction%5D/route.ts) |
| 订单维护与核对 | 由关联视图/专用入口读取，未另造查询 | `correction`、`edit-order`、`match`、`review` | [route.ts](../../app/api/workspace/%5Baction%5D/route.ts) |
| 订单原表与报表 | `ledger-export`、`ledger-file`、`metric-export` | `export` | [route.ts](../../app/api/workspace/%5Baction%5D/route.ts)、[operations.ts](../../lib/operations.ts) |
| 本人授权通知与签收 | `framework-notices` | `framework-notice-receive` | [handoff-framework-api.ts](../../lib/handoff-framework-api.ts) |
| 生产审核规则与采纳 | 由关联视图/专用入口读取，未另造查询 | `handoff-business-adoption-sign` | [handoff-production-review.ts](../../lib/handoff-production-review.ts) |
| 订单工序、外发收货与原表 | 由关联视图/专用入口读取，未另造查询 | `ledger-edit` | [operations.ts](../../lib/operations.ts) |
| 损耗 | `loss-export` | `loss-record` | [loss-api.ts](../../lib/loss-api.ts) |
| 工序外发登记 | 由关联视图/专用入口读取，未另造查询 | `outsource-create` | [operations.ts](../../lib/operations.ts) |
| 包装入仓 | 由关联视图/专用入口读取，未另造查询 | `pack` | [route.ts](../../app/api/workspace/%5Baction%5D/route.ts) |

本组接入边界：

- 业务动作，按具体内容确认后执行：17 项。
- 读取候选，待核验返回字段及副作用：11 项。

<a id="quality"></a>

## 品质部

来料 → 过程与出货放行。

导航范围：`process-iqc`、`process-first-article`、`process-process-quality`、`process-outsourcing-quality`、`process-oqc`、`process-shipment-release`。

| 业务对象 | 查询/读取接口 | 保存、变更及专用动作 | 字段与规则来源 |
| --- | --- | --- | --- |
| 授权聚合数据、版本与业务组目录 | `business-team-data`、`data`、`read-version` | 此对象未登记 POST 动作 | [route.ts](../../app/api/workspace/%5Baction%5D/route.ts) |
| 成品外协凭证 | `finished-supplier-file` | `finished-supplier-attachment` | [finished-supplier-api.ts](../../lib/finished-supplier-api.ts) |
| 成品外协授权视图 | `finished-supplier-data` | 此对象未登记 POST 动作 | [finished-supplier-api.ts](../../lib/finished-supplier-api.ts) |
| 成品外协质检 | 由关联视图/专用入口读取，未另造查询 | `finished-supplier-qc` | [finished-supplier-api.ts](../../lib/finished-supplier-api.ts) |
| 本人授权通知与签收 | `framework-notices` | `framework-notice-receive` | [handoff-framework-api.ts](../../lib/handoff-framework-api.ts) |
| 部门流程记录 | `process-data`、`process-history` | `process-save` | [process-workspace-api.ts](../../lib/process-workspace-api.ts) |

本组接入边界：

- 读取候选，待核验返回字段及副作用：8 项。
- 业务动作，按具体内容确认后执行：4 项。

本组流程字段（以下仅列 details；公共字段见后文）：

| 流程 | 固定 type | 业务明细字段 |
| --- | --- | --- |
| 来料检验 | `iqc` | 不适用或关口判断依据 `gateReason`（文本）、单据引用 `documentRef`（文本）、检验数量 `inspectedQuantity`（数值）、合格数量 `acceptedQuantity`（数值）、不良数量 `rejectedQuantity`（数值）、检验单引用 `inspectionRef`（文本）、工序名称 `processName`（文本）、供应商 `supplierName`（文本）、来料批次 `lotNo`（文本） |
| 首件确认 | `first-article` | 不适用或关口判断依据 `gateReason`（文本）、单据引用 `documentRef`（文本）、检验数量 `inspectedQuantity`（数值）、合格数量 `acceptedQuantity`（数值）、不良数量 `rejectedQuantity`（数值）、检验单引用 `inspectionRef`（文本）、工序名称 `processName`（文本） |
| 过程检验 | `process-quality` | 不适用或关口判断依据 `gateReason`（文本）、单据引用 `documentRef`（文本）、检验数量 `inspectedQuantity`（数值）、合格数量 `acceptedQuantity`（数值）、不良数量 `rejectedQuantity`（数值）、检验单引用 `inspectionRef`（文本）、工序名称 `processName`（文本） |
| 外协检验 | `outsourcing-quality` | 不适用或关口判断依据 `gateReason`（文本）、单据引用 `documentRef`（文本）、检验数量 `inspectedQuantity`（数值）、合格数量 `acceptedQuantity`（数值）、不良数量 `rejectedQuantity`（数值）、检验单引用 `inspectionRef`（文本）、工序名称 `processName`（文本）、供应商 `supplierName`（文本）、外协批次 `lotNo`（文本） |
| 成品检验 | `oqc` | 不适用或关口判断依据 `gateReason`（文本）、单据引用 `documentRef`（文本）、检验数量 `inspectedQuantity`（数值）、合格数量 `acceptedQuantity`（数值）、不良数量 `rejectedQuantity`（数值）、检验单引用 `inspectionRef`（文本）、工序名称 `processName`（文本） |
| 出货放行记录 | `shipment-release` | 不适用或关口判断依据 `gateReason`（文本）、单据引用 `documentRef`（文本）、出货数量 `quantity`（数值）、物流凭证 `logisticsRef`（文本）、实际放行单引用 `releaseRef`（文本） |

<a id="finance"></a>

## 财务部

对账 → 应收与回款。

导航范围：`payment-terms`、`supplier-reconciliation`、`process-supplier-reconciliation`、`ar-workspace`、`service-receivables`、`project-finance`、`finance-documents`。

| 业务对象 | 查询/读取接口 | 保存、变更及专用动作 | 字段与规则来源 |
| --- | --- | --- | --- |
| 应收工作台与授权 | `ar-access-data`、`ar-dashboard-data`、`ar-export`、`ar-workspace-data` | 此对象未登记 POST 动作 | [ar-workspace-api.ts](../../lib/ar-workspace-api.ts) |
| 应收客户模板 | `ar-customer-profiles-data` | `ar-customer-profile-save`、`ar-invoice-extra-save`、`ar-invoice-source-link` | [ar-customer-profiles-api.ts](../../lib/ar-customer-profiles-api.ts) |
| 正式财务单据 | 由关联视图/专用入口读取，未另造查询 | `ar-document-issue`、`ar-document-milestone`、`ar-document-review` | [ar-document-issue.ts](../../lib/ar-document-issue.ts) |
| 发票原件与对账 | `ar-invoice-data`、`ar-invoice-file`、`ar-invoice-statement-file` | `ar-invoice-import`、`ar-invoice-note`、`ar-invoice-proof`、`ar-invoice-reconcile`、`ar-invoice-statement` | [ar-invoice-ledger-api.ts](../../lib/ar-invoice-ledger-api.ts) |
| 应收总表 | `ar-master-data`、`ar-master-export` | `ar-master-entry-save`、`ar-master-register-legacy`、`ar-master-source-link` | [ar-master-ledger-api.ts](../../lib/ar-master-ledger-api.ts) |
| 授权聚合数据、版本与业务组目录 | `business-team-data`、`data`、`read-version` | 此对象未登记 POST 动作 | [route.ts](../../app/api/workspace/%5Baction%5D/route.ts) |
| 财务协作任务 | `framework-finance-task-history`、`framework-finance-task-summary`、`framework-finance-tasks` | `framework-finance-task-accept`、`framework-finance-task-cancel`、`framework-finance-task-return`、`framework-finance-task-review`、`framework-finance-task-save`、`framework-finance-task-submit` | [framework-finance-task.ts](../../lib/framework-finance-task.ts) |
| 本人授权通知与签收 | `framework-notices` | `framework-notice-receive` | [handoff-framework-api.ts](../../lib/handoff-framework-api.ts) |
| 业务交接与单据 | `handoff-business-data`、`handoff-business-file`、`handoff-business-history`、`handoff-business-print`、`handoff-business-review-data` | `handoff-business-attachment`、`handoff-business-confirm`、`handoff-business-generate`、`handoff-business-return`、`handoff-business-save`、`handoff-business-submit` | [handoff-business-api.ts](../../lib/handoff-business-api.ts) |
| 交接定金与例外 | 由关联视图/专用入口读取，未另造查询 | `handoff-business-deposit-declaration`、`handoff-business-payment-exception` | [handoff-payment-actions.ts](../../lib/handoff-payment-actions.ts) |
| 付款条件 | `payment-terms-data` | `payment-terms-authorize`、`payment-terms-disable`、`payment-terms-save` | [payment-terms-api.ts](../../lib/payment-terms-api.ts) |
| 部门流程记录 | `process-data`、`process-history` | `process-save` | [process-workspace-api.ts](../../lib/process-workspace-api.ts) |
| 项目财务 | `project-document-print`、`project-finance-data`、`project-finance-history` | `project-adjustment`、`project-after-sale-cost`、`project-after-sale-save`、`project-allocation`、`project-allocation-release`、`project-charge-confirm`、`project-charge-save`、`project-credit-apply`、`project-document-confirm`、`project-document-revise`、`project-document-save`、`project-document-sent`、`project-finance-entry-save`、`project-payment-notice`、`project-payment-requirement`、`project-receipt-reverse`、`project-receipt-verify`、`project-refund-cancel`、`project-refund-execute`、`project-refund-request` | [customer-project-finance-api.ts](../../lib/customer-project-finance-api.ts) |
| 客服业务 | `service-data`、`service-file`、`service-history` | `service-attachment`、`service-save` | [service-workspace-api.ts](../../lib/service-workspace-api.ts) |
| 客服业务收款及冲销 | 由关联视图/专用入口读取，未另造查询 | `service-receipt`、`service-receipt-reverse` | [service-workspace-api.ts](../../lib/service-workspace-api.ts) |

本组接入边界：

- 读取候选，待核验返回字段及副作用：31 项。
- 业务动作，按具体内容确认后执行：57 项。

本组流程字段（以下仅列 details；公共字段见后文）：

| 流程 | 固定 type | 业务明细字段 |
| --- | --- | --- |
| 供应商对账 | `supplier-reconciliation` | 不适用或关口判断依据 `gateReason`（文本）、单据引用 `documentRef`（文本）、供应商 `supplierName`（文本）、对账单引用 `statementRef`（文本）、发票引用 `invoiceRef`（文本）、币种 `currency`（文本）、对账金额 `amount`（数值） |

跨部门共用接口在本组的具体对象类型：

| 共用业务 | 本组类型 | 字段与规则 |
| --- | --- | --- |
| 跨部门业务资料与单据 | `finance_file`、`finance_request`、`pi`、`invoice`、`paymentrequest` | [lib/handoff-business.ts](../../lib/handoff-business.ts)；按 kind/type 生成具体动作契约；共用视图按授权对象裁剪。来源版本、单据生成与财务状态继续由原接口校验，不以目录位置授予单据权限。 |
| 客服、发运签收与订单应收 | `receivable` | [lib/service-workspace.ts](../../lib/service-workspace.ts)；shipment-followups 和 service-receivables 复用此工作台，分别按 shipment、receivable 裁剪；不是两个新的业务数据库。 |

<a id="management"></a>

## 系统管理

规则 → 账号与系统维护。

导航范围：`business-rules`、`imports`、`settings`、`members`、`maintenance`、`business-tools`。

| 业务对象 | 查询/读取接口 | 保存、变更及专用动作 | 字段与规则来源 |
| --- | --- | --- | --- |
| 业务授权与规则配置 | 由关联视图/专用入口读取，未另造查询 | `ar-access-grant-save`、`ar-source-binding-save`、`customer-quote-access-update`、`handoff-business-review-policy`、`payment-terms-authorizers-save`、`project-finance-grant-save` | [ar-workspace-api.ts](../../lib/ar-workspace-api.ts)、[customer-quote-policy-api.ts](../../lib/customer-quote-policy-api.ts)、[handoff-production-review.ts](../../lib/handoff-production-review.ts)、[payment-terms-api.ts](../../lib/payment-terms-api.ts)、[customer-project-finance-api.ts](../../lib/customer-project-finance-api.ts) |
| 成员与维护 | `backup` | `enroll`、`member` | [route.ts](../../app/api/workspace/%5Baction%5D/route.ts) |
| 授权聚合数据、版本与业务组目录 | `business-team-data`、`data`、`read-version` | 此对象未登记 POST 动作 | [route.ts](../../app/api/workspace/%5Baction%5D/route.ts) |
| 原表/MES 文件导入与批次 | `job`、`template` | `commit-import`、`inspect`、`preview` | [route.ts](../../app/api/workspace/%5Baction%5D/route.ts) |
| 项目团队与责任名单 | 由关联视图/专用入口读取，未另造查询 | `customer-project-assignment-roster-save`、`customer-project-team-save` | [customer-project-api.ts](../../lib/customer-project-api.ts) |
| 固定数据工具 | `fixed-data-tools`、`fixed-tool-file`、`fixed-tool-job` | `fixed-tool-ownership`、`fixed-tool-workbook` | [fixed-data-tools-api.ts](../../lib/fixed-data-tools-api.ts) |
| 业务规则、渠道配置与知识 | `framework-knowledge`、`framework-knowledge-document`、`framework-settings` | `framework-account-save`、`framework-config-save` | [handoff-framework-api.ts](../../lib/handoff-framework-api.ts) |
| 本人授权通知与签收 | `framework-notices` | `framework-notice-receive` | [handoff-framework-api.ts](../../lib/handoff-framework-api.ts) |
| 离职交接 | `framework-offboarding`、`framework-offboarding-incoming` | `framework-offboarding-accept`、`framework-offboarding-cancel`、`framework-offboarding-draft`、`framework-offboarding-finalize` | [framework-offboarding.ts](../../lib/framework-offboarding.ts) |
| 交接服务配置 | 由关联视图/专用入口读取，未另造查询 | `handoff-business-service-config` | [handoff-business-settings.ts](../../lib/handoff-business-settings.ts) |
| 金蝶订单导出与模板 | `kingdee-export` | `kingdee-template` | [collaboration-api.ts](../../lib/collaboration-api.ts) |
| 原版工作簿导入 | 由关联视图/专用入口读取，未另造查询 | `ledger-commit`、`ledger-preview` | [operations.ts](../../lib/operations.ts) |
| 会话摘要 | `/api/auth/session` | 此对象未登记 POST 动作 | [server.mjs](../../standalone/server.mjs) |
| 登录 | 由关联视图/专用入口读取，未另造查询 | `/api/auth/login` | [server.mjs](../../standalone/server.mjs) |
| 注销 | 由关联视图/专用入口读取，未另造查询 | `/api/auth/logout` | [server.mjs](../../standalone/server.mjs) |
| 本人改密 | 由关联视图/专用入口读取，未另造查询 | `/api/auth/password` | [server.mjs](../../standalone/server.mjs) |
| 运行状态 | `/api/auth/maintenance` | 此对象未登记 POST 动作 | [server.mjs](../../standalone/server.mjs) |
| 账号目录 | `/api/auth/accounts` | 此对象未登记 POST 动作 | [server.mjs](../../standalone/server.mjs) |
| 创建账号 | 由关联视图/专用入口读取，未另造查询 | `/api/auth/accounts` | [server.mjs](../../standalone/server.mjs) |
| 登录历史 | `/api/auth/history` | 此对象未登记 POST 动作 | [server.mjs](../../standalone/server.mjs) |
| 重置密码 | 由关联视图/专用入口读取，未另造查询 | `/api/auth/reset` | [server.mjs](../../standalone/server.mjs) |
| 备份摘要 | `/api/auth/backup` | 此对象未登记 POST 动作 | [server.mjs](../../standalone/server.mjs) |
| 备份维护 | 由关联视图/专用入口读取，未另造查询 | `/api/auth/backup` | [server.mjs](../../standalone/server.mjs) |
| 调度桥状态 | `/api/agent-schedules/status` | 此对象未登记 POST 动作 | [agent-schedules.mjs](../../standalone/agent-schedules.mjs) |
| 本人定时授权 | 由关联视图/专用入口读取，未另造查询 | `/api/agent-schedules/grant` | [agent-schedules.mjs](../../standalone/agent-schedules.mjs) |
| 撤销本人授权 | 由关联视图/专用入口读取，未另造查询 | `/api/agent-schedules/revoke` | [agent-schedules.mjs](../../standalone/agent-schedules.mjs) |
| 服务身份探测 | 由关联视图/专用入口读取，未另造查询 | `/api/agent-schedules/service/probe` | [agent-schedules.mjs](../../standalone/agent-schedules.mjs) |
| 后台租约 | 由关联视图/专用入口读取，未另造查询 | `/api/agent-schedules/service/lease` | [agent-schedules.mjs](../../standalone/agent-schedules.mjs) |
| 有效授权人 | 由关联视图/专用入口读取，未另造查询 | `/api/agent-schedules/service/owners` | [agent-schedules.mjs](../../standalone/agent-schedules.mjs) |
| 授权数据目录 | 由关联视图/专用入口读取，未另造查询 | `/api/agent-schedules/service/catalog` | [agent-schedules.mjs](../../standalone/agent-schedules.mjs) |
| 日历匹配 | 由关联视图/专用入口读取，未另造查询 | `/api/agent-schedules/service/schedule` | [agent-schedules.mjs](../../standalone/agent-schedules.mjs) |
| 来源核验 | 由关联视图/专用入口读取，未另造查询 | `/api/agent-schedules/service/verify` | [agent-schedules.mjs](../../standalone/agent-schedules.mjs) |
| 后台授权查询 | 由关联视图/专用入口读取，未另造查询 | `/api/agent-schedules/service/query` | [agent-schedules.mjs](../../standalone/agent-schedules.mjs) |
| 存活状态 | `/health` | 此对象未登记 POST 动作 | [server.mjs](../../standalone/server.mjs) |
| 验收副本标识 | `/api/review-mode` | 此对象未登记 POST 动作 | [server.mjs](../../standalone/server.mjs) |

本组接入边界：

- 管理/敏感入口，保留原授权及人工操作：22 项。
- 读取候选，待核验返回字段及副作用：12 项。
- 业务动作，按具体内容确认后执行：14 项。
- 应用内流程，不交模型凭据：10 项。
- 后台专用，不交模型服务身份：7 项。

## 共用逻辑与字段边界

| 层次 | 做什么 | 不代替什么 |
| --- | --- | --- |
| 部门目录 | 展示当前账号可用的对象与动作 | 不依据部门名称直接授予权限 |
| 动作契约 | 指定现有接口、入参 schema、返回投影及固定流程类型 | 不开放任意 URL、SQL、字段补丁 |
| 公共执行层 | 绑定身份、目标与版本；预览、确认、调用、回读和错误处理 | 不复制或绕过中台业务校验 |
| 中台原接口 | 执行原有角色/数据/字段权限及数量、金额、状态规则 | 不把模型判断当成授权或审核决定 |

14 类流程共用 `process-data`、`process-history`、`process-save`。工具的 type 由注册配置固定；历史查询仅接收 id，必须读取并核验该记录实际类型和权限，不能假设它支持 type 参数。

公共字段：`id`、`version`、`token`、`type`、`customerId`、`orderId`、`teamId`、`title`、`batch`、`ownerId`、`responsibleId`、`plannedDate`、`actualDate`、`status`、`inputBasis`、`inputVersion`、`outputEvidence`、`gateStatus`、`blocker`、`nextAction`、`nextOwnerId`、`nextDueDate`、`notes`、`details`。

其中 id 从授权查询绑定，version 从已读版本绑定，token 由执行程序生成并在重试时保留，type 由具体工具固定。用户可以提出客户、订单、负责人等业务选择，仍须服务端校验关联与可见范围；这些字段不代表调用身份。业务操作者来自会话，模型不能填写。

流程保存继续复用 `canReadProcessRecord`、`canWriteProcessKind`、`canEditProcessRecord`、`assertProcessCompletion`，包括检验数量平衡、齐料数量、完成证据、责任人、阻塞和各类型必要依据。模型不得自行判定检验通过、签样、放行或关闭。

## 当前交付与待实施项

- 已完成：10 组与页面导航对应；359 项接口全部有组别；跨部门共用关系；14 类流程及其业务明细字段；12 类业务资料/单据与 6 类客服记录的分组；字段/schema 来源索引；应用内/后台专用边界。
- 字段来源索引是文件级导航，不是已完成的每个动作输入/输出契约。JSON 的 contractStatus 明确为 source-located-not-adapted。
- 下一步实施：从原 schema 提取动作精确入参和返回投影，建立公共执行层及变更确认入口，再逐组接入 Studio 并做权限/业务回归。
- 原表导入预览、固定工具结果和报价模板导出可能落盘，不能仅用 GET/POST 或名称决定副作用。
- 通用管理表、聚合数据和接口数量不表示存在通用物理删除；保留原归档、取消、作废、回收和历史规则。
- 这是与业务清点配套的静态资料，保存在主线文档；Agent 运行代码仍按项目规则在测试分支实现、独立发布。

## 复核命令

```powershell
node scripts/audit-api-inventory.mjs --check
node scripts/group-api-inventory.mjs --check
```

生成器只读取源码与清单，不导入业务模块或调用服务；会拒绝遗漏接口、未知组名、重复覆盖、失效动作、流程类型不一致和过期清单。
