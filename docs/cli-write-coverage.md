# CLI 全站入口覆盖清单（W0）

基线：`2cd873e`，2026-10-27。本页由 `lib/department-workspace-navigation.ts` 的 `departmentRouteOrder` 明确列出的入口逐一登记；动态生成或落入管理组的旧入口仍待逐页扫描。清单是盘点起点，不表示这些页面可见于每个员工，也不表示已完成逐表单/字段/接口/权限核验。字段、动作、角色与范围、依赖和验收均须在对应批次补齐；不能将页面入口数量当作完成数量。页面表中的候选源码是按栏目归集的排查入口，不表示每个源码均适用于该页面，必须逐项核对。

业务接口入口为 `app/api/workspace/[action]/route.ts`；具体限制以各处理器和数据模型为准。已有 CLI 查询和写入以 `cli/src/catalog.ts` 及 [写入阶段计划](cli-write-implementation-plan.md) 为准，W1 已部分接入客户主档、跟进、项目及询价，尚未覆盖全部字段和动作；处理器初筛见 [API 源码索引](cli-write-api-index.md)，部分 schema 的顶层字段线索见 [字段源码索引](cli-write-field-index.md)。从界面枚举实际按钮、隐含表单、动态角色入口、附件和外部动作，是后续逐批必须完成的工作。所有空缺必须显式登记，不能由页面名称推断权限或 CRUD。

### W1 表单与动作对应（开发已接入，阶段验收进行中）

各行字段以服务端 schema 和 CLI 输入白名单为准；只使用员工本人会话，未新增 CLI 确认机制。新增主档接口需要随网站代码更新；提交和推送不会部署。

| 页面/表单 | 命令与接口 | 角色/范围与保存语义 | 验证 |
| --- | --- | --- | --- |
| 客户主档及目录 | `customers create/master/master-update`；`customer-save`、`customer-master-data/patch` | 复用既有主档和目录权限；PMC名称编号只读、分级及启停限已有管理员规则；指定字段增量更新 | 合成业务/PMC/管理员、旧版本拒绝、未指定字段保留 |
| 客户资料/联系人 | `customers profile-update/sensitive/sensitive-update`；`customer-workflow-profile-save/data` | 联系人等沿用现有结构；付款资料显式读取、银行修改限财务/管理员 | 合成越权与版本、通用输出不扩散付款字段 |
| 客户跟进与排程 | `customers schedule-set/followup-add`；既有workflow处理器 | 客户负责人、独立资料/状态版本、请求UUID | 合成创建回读、重复提交与越权 |
| 客户流转/公海 | `customers transfers/transfer --action` | 10种固定动作；接收限本人，批准限管理员；双记录版本 | 完整合成流转场景、无权拒绝 |
| 客户任务 | `customer-tasks list/history/save`；`customer-workflow-task-*` | 负责人及客户责任范围，创建0、修改当前版本 | 合成完成及历史、越权拒绝 |
| 客户/项目正式附件 | `attachments list/download/upload/update`；`customer-workflow-file-*` | 原件与资料分离、上传20MiB、归档保留原件 | 上传重放、归档、原件摘要及不覆盖下载 |
| 项目主表与回收站 | `projects create/update/recycle/trash/restore`；`customer-project-*` | 客户/业务组权限，保留关联和状态；有依赖时服务器拒绝回收 | 合成增改、旧版本、越权、回收恢复 |
| 普通款色/轮次/沟通/待办 | `projects entry-schema/entry-save --type`；`customer-project-entry-save` | 同网站普通表单，可留空、数量0；修改仅提交变化字段。原有正式保存/提交/审核命令保留各自语义 | 合成4类增改与重放、跨客户拒绝、旧版本、原字段保留 |
| 项目原始资料 | `projects file-upload/file-download`、`entry-save --type attachment`；`customer-project-attachment/file/entry-save` | 原件50MiB；原始沟通类别仅项目级；元数据修改保留hash和文件键 | 合成上传去重、资料修改、下载原字节和不覆盖 |
| 项目开发与文档 | `projects development-show/save/log`、`document-show/save` | 客户项目责任范围；独立版本，历史保存 | 合成维护、历史回读和越权 |
| 客户跟进工作台 | `followups create/update/list/show/action/mailbox/history`；`customer-project-followup-*` | 转项目/邮件归属是固定业务动作；邮件仅档案读取和归属登记，不对外发送 | 阶段验证纳入转项目、归属、历史及实际CLI进程 |
| 需求/询价 | `inquiries create/update/list/show/history`；`process-save/data/history` | 限rfq、客户/组/负责人范围；未知数量与0分开 | 合成增改、版本、权限、原关联保留 |

本批不增加客户物理删除或清除历史/附件原件。项目工程图纸、签样、正式下单在W4；报价在W2；订单及交接在W3；历史工作台批量迁入、模板及组织管理在W10；外部真实邮件发送按通讯功能独立审计，当前邮件归属不等于发送。完整安装包验收尚未完成，不能把开发覆盖当成全员可用。

| 栏目 | 页面/入口标识 | 计划批次 | 表单与字段 | 动作/接口 | 角色与记录范围 | 验收 |
| --- | --- | --- | --- | --- | --- | --- |
| 工作总览 | `workbench` | W10 | 待核验 | 候选源码：app/workspace.tsx | 待核验 | 待核验 |
| 工作总览 | `business-process` | W10 | 待核验 | 候选源码：app/workspace.tsx | 待核验 | 待核验 |
| 工作总览 | `personal-tasks` | W10 | 待核验 | 候选源码：app/workspace.tsx | 待核验 | 待核验 |
| 工作总览 | `dashboard` | W10 | 待核验 | 候选源码：app/workspace.tsx | 待核验 | 待核验 |
| 工作总览 | `reports` | W10 | 待核验 | 候选源码：app/workspace.tsx | 待核验 | 待核验 |
| 业务部 | `customers` | W1–W3 | 待核验 | 候选源码：lib/customer-project-api.ts、lib/customer-workflow-api.ts、lib/customer-quote-api.ts | 待核验 | 待核验 |
| 业务部 | `customer-projects` | W1–W3 | 待核验 | 候选源码：lib/customer-project-api.ts、lib/customer-workflow-api.ts、lib/customer-quote-api.ts | 待核验 | 待核验 |
| 业务部 | `process-rfq` | W1–W3 | 已核对：下方 14 类流程矩阵 | `process-data` / `process-history` / `process-save` | 已核对：下方矩阵与服务端范围 | CLI 已接入询价创建与更新；阶段验收待完成 |
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
| 客服与单证 | `process-complaint` | W3/W7/W9 | 已核对：下方 14 类流程矩阵 | `process-data` / `process-history` / `process-save` | 已核对：下方矩阵与服务端范围 | CLI 写入待实现 |
| 客服与单证 | `completed` | W3/W7/W9 | 待核验 | 候选源码：lib/service-workspace-api.ts、lib/handoff-business-api.ts、lib/collaboration-api.ts | 待核验 | 待核验 |
| 工程部 | `ie-quotes` | W2/W4 | 待核验 | 候选源码：lib/engineering-drawing-api.ts、lib/engineering-sop-api.ts、lib/ie-quote-api.ts | 待核验 | 待核验 |
| 工程部 | `engineering-materials` | W2/W4 | 待核验 | 候选源码：lib/engineering-drawing-api.ts、lib/engineering-sop-api.ts、lib/ie-quote-api.ts | 待核验 | 待核验 |
| 工程部 | `engineering-drawings` | W2/W4 | 待核验 | 候选源码：lib/engineering-drawing-api.ts、lib/engineering-sop-api.ts、lib/ie-quote-api.ts | 待核验 | 待核验 |
| 工程部 | `process-sample` | W2/W4 | 已核对：下方 14 类流程矩阵 | `process-data` / `process-history` / `process-save` | 已核对：下方矩阵与服务端范围 | CLI 写入待实现 |
| 工程部 | `process-engineering-change` | W2/W4 | 已核对：下方 14 类流程矩阵 | `process-data` / `process-history` / `process-save` | 已核对：下方矩阵与服务端范围 | CLI 写入待实现 |
| PMC 计划 | `production-planning` | W5–W6 | 待核验 | 候选源码：lib/pmc-api.ts、lib/planning-control-api.ts | 待核验 | 待核验 |
| PMC 计划 | `pmc-handoff` | W5–W6 | 待核验 | 候选源码：lib/pmc-api.ts、lib/planning-control-api.ts | 待核验 | 待核验 |
| PMC 计划 | `process-material-kit` | W5–W6 | 已核对：下方 14 类流程矩阵 | `process-data` / `process-history` / `process-save` | 已核对：下方矩阵与服务端范围 | CLI 写入待实现 |
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
| 仓储物流 | `process-warehouse` | W6–W7 | 已核对：下方 14 类流程矩阵 | `process-data` / `process-history` / `process-save` | 已核对：下方矩阵与服务端范围 | CLI 写入待实现 |
| 仓储物流 | `process-packaging` | W6–W7 | 已核对：下方 14 类流程矩阵 | `process-data` / `process-history` / `process-save` | 已核对：下方矩阵与服务端范围 | CLI 写入待实现 |
| 仓储物流 | `production-shipments` | W6–W7 | 待核验 | 候选源码：lib/purchase-api.ts、lib/service-workspace-api.ts、lib/process-workspace-api.ts | 待核验 | 待核验 |
| 仓储物流 | `logistics-waybills` | W6–W7 | 待核验 | 候选源码：lib/purchase-api.ts、lib/service-workspace-api.ts、lib/process-workspace-api.ts | 待核验 | 待核验 |
| 仓储物流 | `shipment-followups` | W6–W7 | 待核验 | 候选源码：lib/purchase-api.ts、lib/service-workspace-api.ts、lib/process-workspace-api.ts | 待核验 | 待核验 |
| 生产车间 | `department` | W6 | 待核验 | 候选源码：lib/operations.ts、lib/loss-api.ts、lib/finished-supplier-api.ts | 待核验 | 待核验 |
| 生产车间 | `mes` | W6 | 待核验 | 候选源码：lib/operations.ts、lib/loss-api.ts、lib/finished-supplier-api.ts | 待核验 | 待核验 |
| 生产车间 | `losses` | W6 | 待核验 | 候选源码：lib/operations.ts、lib/loss-api.ts、lib/finished-supplier-api.ts | 待核验 | 待核验 |
| 品质部 | `process-iqc` | W6–W7 | 已核对：下方 14 类流程矩阵 | `process-data` / `process-history` / `process-save` | 已核对：下方矩阵与服务端范围 | CLI 写入待实现 |
| 品质部 | `process-first-article` | W6–W7 | 已核对：下方 14 类流程矩阵 | `process-data` / `process-history` / `process-save` | 已核对：下方矩阵与服务端范围 | CLI 写入待实现 |
| 品质部 | `process-process-quality` | W6–W7 | 已核对：下方 14 类流程矩阵 | `process-data` / `process-history` / `process-save` | 已核对：下方矩阵与服务端范围 | CLI 写入待实现 |
| 品质部 | `process-outsourcing-quality` | W6–W7 | 已核对：下方 14 类流程矩阵 | `process-data` / `process-history` / `process-save` | 已核对：下方矩阵与服务端范围 | CLI 写入待实现 |
| 品质部 | `process-oqc` | W6–W7 | 已核对：下方 14 类流程矩阵 | `process-data` / `process-history` / `process-save` | 已核对：下方矩阵与服务端范围 | CLI 写入待实现 |
| 品质部 | `process-shipment-release` | W6–W7 | 已核对：下方 14 类流程矩阵 | `process-data` / `process-history` / `process-save` | 已核对：下方矩阵与服务端范围 | CLI 写入待实现 |
| 财务部 | `payment-terms` | W8 | 待核验 | 候选源码：lib/customer-project-finance-api.ts、lib/ar-workspace-api.ts、lib/payment-terms-api.ts | 待核验 | 待核验 |
| 财务部 | `supplier-reconciliation` | W8 | 待核验 | 候选源码：lib/customer-project-finance-api.ts、lib/ar-workspace-api.ts、lib/payment-terms-api.ts | 待核验 | 待核验 |
| 财务部 | `process-supplier-reconciliation` | W8 | 已核对：下方 14 类流程矩阵 | `process-data` / `process-history` / `process-save` | 已核对：下方矩阵与服务端范围 | CLI 写入待实现 |
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

## 14 类流程表单核对（源码基线 d5a7bde）

以下均使用 GET `process-data` / `process-history` 和 POST `process-save`，共用记录的客户、订单、业务组、标题、负责人、计划/实际日期、状态、来源、证据、关口、阻塞、下一步和备注字段。`details` 的专用字段如下，所有类型还共享 `gateReason`、`documentRef`。此表覆盖的是流程跟进记录，不能将其当作实际库存、放行、发运或财务记账；写入 CLI 均未接入。

| 页面/类型 | details 专用字段 | 写入角色线索（均须再通过具体客户、订单与组别权限） |
| --- | --- | --- |
| `process-rfq` / `rfq` | requirement, targetDelivery, quantity, currency, quoteRef | 管理员；sales、clerk、pmc 且满足客户责任或订单条件 |
| `process-sample` / `sample` | sampleVersion, sampleQuantity, sampleResult, signoffRef | 管理员；sales、clerk、pmc 且满足客户责任或订单条件；工程部门 clerk 按源码另有规则 |
| `process-engineering-change` / `engineering-change` | previousVersion, newVersion, changeReason, impactScope, approvalRef | 管理员；工程/工程审核部门 clerk |
| `process-iqc` / `iqc` | inspectedQuantity, acceptedQuantity, rejectedQuantity, inspectionRef, processName, supplierName, lotNo | 管理员；production、pmc；pmc / plating / semifinished 部门 clerk |
| `process-material-kit` / `material-kit` | requiredQuantity, readyQuantity, shortageNote, materialListRef | 管理员；production、pmc；pmc / semifinished / plastic 部门 clerk |
| `process-warehouse` / `warehouse` | movementType, quantity, warehouseName, sourceDocumentRef | 管理员；production、pmc；plating / semifinished / finished 部门 clerk |
| `process-first-article` / `first-article` | inspectedQuantity, acceptedQuantity, rejectedQuantity, inspectionRef, processName | 管理员；production、pmc；工厂指定部门 clerk |
| `process-process-quality` / `process-quality` | inspectedQuantity, acceptedQuantity, rejectedQuantity, inspectionRef, processName | 管理员；production、pmc；工厂指定部门 clerk |
| `process-outsourcing-quality` / `outsourcing-quality` | inspectedQuantity, acceptedQuantity, rejectedQuantity, inspectionRef, processName, supplierName, lotNo | 管理员；production、pmc；outsourcing / plating 部门 clerk |
| `process-oqc` / `oqc` | inspectedQuantity, acceptedQuantity, rejectedQuantity, inspectionRef, processName | 管理员；production、pmc；finished 部门 clerk |
| `process-packaging` / `packaging` | quantity, cartons, packingSpec, packingListRef | 管理员；production、pmc；finished 部门 clerk |
| `process-shipment-release` / `shipment-release` | quantity, logisticsRef, releaseRef | 管理员；production、pmc；finished 部门 clerk |
| `process-supplier-reconciliation` / `supplier-reconciliation` | supplierName, statementRef, invoiceRef, currency, amount | 管理员；finance、pmc；还须有供应商价格可见权限 |
| `process-complaint` / `complaint` | complaintRef, cause, correction, verification, customerConfirmation | 管理员；sales、clerk、pmc 且满足客户责任或订单条件 |

`viewer`、`programmer`、`supplier`、停用或被配置为只读的成员不得维护流程记录。角色只是必要条件：服务端还检查记录访问、客户/订单是否匹配、业务组、客户启用、负责人及各类型完成条件；负责人的选择不会授予权限。数量字段为可选非负整数；`amount` 是有限的非负数、最多两位小数。具体限值、默认值和门槛以 `lib/process-workspace.ts`、`lib/process-workspace-api.ts` 为准。更新须当前版本，token 去重需实际提供；新建及完成门槛分别校验。

## W1 接口先行核查：客户主档

`lib/collaboration-api.ts` 的 `customer-save` 不是天然安全的通用 PATCH：按客户名称查找已有记录，`createOnly` 才明确拒绝已存在客户；若省略多项字段，schema 对部分字段提供空字符串或其他默认值。旧记录只在提交了 `expectedVersion` 时一般性比较版本，维护 `directory` 则要求该版本。直接把任意部分 JSON 接到该保存入口可能覆盖原值，因此 W1 必须先设计并验证只改指定字段的服务器端合并与并发保护；不能由 CLI 读取后盲目补全并伪装成安全的部分更新。

该入口要求有效的 `admin`、`pmc`、`sales` 或 `clerk`，并进一步执行只读限制、客户责任字段与角色限制；PMC 不得新建或修改客户名称和编号，公海转移走原有业务流程。客户端不能按角色名称简单推断实际客户范围。入口当前 schema 没有通用请求 token，新增/修改遇到超时不能假设可安全重试；必须先核查原操作，或在服务器补充与实际操作绑定的幂等机制。

项目 `customer-project-save` 检查对应客户写入权限，对负责人、小组及审核人另有限制；流程 `process-save` 由服务器校验具体流程类型、客户/订单及组范围，并在提供 token 时维护请求指纹。两者的具体字段、业务规则和重试语义仍须按各动作完成契约与合成测试。

## 客户跟进、项目协作与付款条件接口核对

| 页面 / 表单 | 动作与字段 | 权限、版本和限制 | 当前状态 |
| --- | --- | --- | --- |
| 客户通用资料 | `customer-workflow-profile-save`：`token`, `customerId`, `version`, `patch`；patch 字段定义在 `lib/customer-workflow.ts` | 当前客户责任范围；普通资料和银行资料有不同写权限，启用状态与策略均须满足；服务器合并 patch 并验证完整结果，token 为 UUID、版本可为 0 | 查询、非银行/非快递账号资料字段更新已接入；其余字段级权限须逐字段验收 |
| 客户跟进与排程 | `customer-workflow-followup`：token、客户、版本、日期、渠道、内容、结果、处理、下一步、证据；`customer-workflow-schedule`：token、客户、版本、下一步、日期 | 客户责任内的已启用账号及 workflow 权限；同键重放走服务器去重；日期、继续/暂停条件分别校验 | 待实现写入 |
| 项目开发跟进 | `customer-project-followup-save`：token、id、version、ownerId、customerId、projectId、title、category、stars、status、日期、备注、下一步、checklist | 活跃的 admin/sales/clerk/pmc；非管理员不能改派负责人；关联客户要求操作人和负责人均有客户写权限；更新版本与 token 校验 | 待实现写入 |
| 跟进邮件归类／转项目 | `customer-project-followup-mail-classify`、`customer-project-followup-promote`；字段详见 `lib/customer-project-followup-api.ts` | 当前跟进或邮件写权限；原负责人、客户和项目组关联一致；使用 UUID token 及当前版本；历史迁入 `customer-project-followup-import` 仅管理员 | 待实现写入；迁入和附件另审计 |
| 项目协作任务 | `project-collaboration-save/followup/complete/cancel/acknowledge`；保存包含项目、轮次、节点、部门、负责人、标题、说明和期限；其他动作包含 token、id、version、comment | 派发、取消、收阅由项目授权管理人执行；完成须指定负责人本人；项目管理人回复不能代替执行人改变状态；项目和客户须可写 | 待实现写入；不因收到协作任务而扩大客户权限 |
| 公司付款条件 | `payment-terms-save/authorize/disable/authorizers-save`；token、version，授权/停用含 id 和 reason；名单含成员列表和 reason | 仅管理员配置授权名单；授权/停用由指定负责人执行；草稿创建人或授权负责人维护相应草稿；已授权版本不可直接修改；版本及 UUID token 校验 | 待实现写入，授权和停用保留为业务动作 |

## 采购与收货接口核对

`lib/purchase-api.ts` 中 `purchase-preview` 虽叫预览，实际会保存导入任务、解析明细和上传原件；它不是零写入 dry-run。`purchase-commit` 按 40 行分批提交，并检查来源版本及预览后的收货变化；不能把批次当作整表原子写入。两个动作限制 `broad(m)` 权限，文件和业务日期有独立校验；失败后应检查已有批次及偏移，不盲目新建或重复提交。

`purchase-save` 使用 `changes` 数组，每项含 id、version、field、value，仅支持供应商复期、预计到货、下次催交和跟进备注；同字段被其他人更改会拒绝，部分异字段修改可合并。其本身没有通用 token。`purchase-receipt` 使用 id、version、type、quantity、returnPending、date、reference、note 和 UUID token；服务端检查权限、当前版本、凭证、数量及重复请求，并区分初始核对、收货、退货、补回和更正。`purchase-archive` 逐条核验版本和齐货条件并保留归档记录，不是删除。各动作仍待 CLI 接入及逐角色测试。

## 客服与 PMC 表单核对

客服 `service-save` 以 `type` 区分六类记录，共用 id、version、customerId、orderId、teamId、ownerId、审核人、title、description、status、waitingFor、dueDate、nextFollowUp；`details` 分别为：

| type | details 字段 |
| --- | --- |
| customer_profile | contactPerson, email, phone, address |
| followup | category |
| project | model, drawing, stage |
| sample | model, drawing, sampleType, approvalCustomer, approvalColor, approvalEngraving, approvalAccessory, trackingNo |
| shipment | invoiceNo, quantity, shipDate, carrier, trackingNo, packingNote |
| receivable | invoiceNo, currency, amount, terms |

服务端校验有效账号、客户责任、指定人、订单客户一致及业务类型；更新须匹配版本，客户和类型不可改绑。`service-save` 没有 token，网络异常后不可盲目重复新增。到账和冲销分别使用 `service-receipt`、`service-receipt-reverse`，须当前版本、UUID token 和服务端范围检查；金额以分处理，冲销保留原凭证。出货完成需要实际日期和订单数量约束，不能根据包装入仓推断。`service-attachment` 为独立上传，需按附件格式、权限及版本单独验收。

PMC `pmc-save` 批量变更字段需 id、version、col、value，并按同一字段的历史版本检查冲突；它无通用 token。`pmc-round` 新建轮次使用 token、lineIds、scope、productionScope；**已有 token 的重放只核对人员和生产范围，没有比较完整 lineIds/scope**。W5 不能把该 token 当成已绑定完整内容的通用幂等保证，须先补服务端校验或明确暂缓。`pmc-review` 则使用 roundId、lineId、version、status、note，并限定当前人员的最新轮次和原订单范围；此接口无通用 token。所有操作还须通过 `broad` 权限和订单可见性，不能以本表概述替代逐角色验收。

## 报价与项目财务接口核对

- `customer-quote-save` 新建/更新客户报价草稿，更新须当前版本，普通成员不能改绑客户；内部成本等字段按服务器内部核价权限限制。`customer-quote-confirm` 使用 id、version 和英文核对字段；普通报价最终确认须报价管理员，关联 IE 版本则另有指定审批规则。确认生成版本及归档，修订、附件和“登记已发送”各有独立入口，不得把登记发送当作真实发送。保存/确认的完整字段及去重能力仍须逐动作审计。
- `ie-quote-save` 保存工程核价，服务器按配置的工程人员及客户权限检查并计算成本；更新须当前版本，不能换客户。提交、评审、修订、目录、模具登记和角色配置分别有独立动作与权限，不能通过改变 `type` 混成普通保存。
- `project-finance-entry-save` 使用 projectId、roundId、entryType、data、token 和可选 id/version；五类登记分别为 receipts、allocations、adjustments、creditApplications、refunds，数据字段不同。`project-receipt-verify/reverse`、`project-allocation/allocation-release`、`project-adjustment`、`project-credit-apply` 和 `project-refund-execute/cancel` 是独立业务动作，需要服务端相应核实权限；草稿写入权限不能推断为核款或退款权限。
- `project-finance-grant-save` 单独维护授权，服务器要求管理员；非核实人员的部分财务响应会省略 account 和 payer，不能由 CLI 读取后以空值覆盖。财务请求 token、指纹、当前权限及项目状态由服务端共同核对，金额和币种需按实际 schema 保持精度。详细字段、外部实际付款含义与每个动作的角色仍须逐项测试。

## 其他已确认的接口差异

- `process-save` 更新必须匹配当前版本，新建不得携带旧版本；类型、客户、订单和业务组不可改绑。`token` 可选，服务端按员工和请求指纹检测复用；缺省字段有默认值，更新前仍须核对完整表单语义及并发。各类型 `details` 的字段和权限不相同。
- `factory-order-save` 的动作字段区分草稿、客服确认、PMC 确认和下发；多个文本字段有空值默认，当前请求 schema 未提供版本或 token。历史会新增版本，但不等于客户端的过期保护或请求去重。W3 接入前须补充或验证针对相应动作的服务器并发、幂等及回读契约，不把下发简化为普通保存。
- `workflow` 是另一个订单交接入口，携带订单 `version` 和动作；业务、客服、PMC 各自的责任校验不同，不能仅靠读取订单权限调用。以上是源码审计线索，具体功能仍需独立合成测试。

## 缺口状态

- 此表还不是逐字段、逐角色的完成矩阵；待逐批读取页面及服务端 schema，逐项标注可复用、需新增接口或不支持、CRUD 语义和验收证据。
- 附件、批量导入、审批、外部同步/发送、历史及只读报表需要独立记录副作用；不假设所有 `GET` 都是无副作用。
- 尚未确定全员下载入口、升级渠道、不同系统分发及容量上限；见 W11。测试环境的容量结果不得当作生产承诺。
