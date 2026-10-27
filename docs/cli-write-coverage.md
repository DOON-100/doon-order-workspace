# CLI 全站入口覆盖清单（W0）

基线：`2cd873e`，2026-10-27。本页由 `lib/department-workspace-navigation.ts` 的 `departmentRouteOrder` 明确列出的入口逐一登记；动态生成或落入管理组的旧入口仍待逐页扫描。清单是盘点起点，不表示这些页面可见于每个员工，也不表示已完成逐表单/字段/接口/权限核验。字段、动作、角色与范围、依赖和验收均须在对应批次补齐；不能将页面入口数量当作完成数量。

业务接口入口为 `app/api/workspace/[action]/route.ts`；具体限制以各处理器和数据模型为准。已有 CLI 查询覆盖与实际 `cli/src/catalog.ts` 对照。所有业务写入仍未开放；候选接口及批次见 [写入阶段计划](cli-write-implementation-plan.md)。从界面枚举实际按钮、隐含表单、动态角色入口、附件和外部动作，是后续逐批必须完成的工作。所有空缺必须显式登记，不能由页面名称推断权限或 CRUD。

| 栏目 | 页面/入口标识 | 计划批次 | 表单与字段 | 动作/接口 | 角色与记录范围 | 验收 |
| --- | --- | --- | --- | --- | --- | --- |
| 工作总览 | `workbench` | W10 | 待核验 | 待核验 | 待核验 | 待核验 |
| 工作总览 | `business-process` | W10 | 待核验 | 待核验 | 待核验 | 待核验 |
| 工作总览 | `personal-tasks` | W10 | 待核验 | 待核验 | 待核验 | 待核验 |
| 工作总览 | `dashboard` | W10 | 待核验 | 待核验 | 待核验 | 待核验 |
| 工作总览 | `reports` | W10 | 待核验 | 待核验 | 待核验 | 待核验 |
| 业务部 | `customers` | W1–W3 | 待核验 | 待核验 | 待核验 | 待核验 |
| 业务部 | `customer-projects` | W1–W3 | 待核验 | 待核验 | 待核验 | 待核验 |
| 业务部 | `process-rfq` | W1–W3 | 待核验 | 待核验 | 待核验 | 待核验 |
| 业务部 | `sales` | W1–W3 | 待核验 | 待核验 | 待核验 | 待核验 |
| 业务部 | `customer-quotes` | W1–W3 | 待核验 | 待核验 | 待核验 | 待核验 |
| 业务部 | `customer-price-archive` | W1–W3 | 待核验 | 待核验 | 待核验 | 待核验 |
| 业务部 | `mail` | W1–W3 | 待核验 | 待核验 | 待核验 | 待核验 |
| 业务部 | `whatsapp` | W1–W3 | 待核验 | 待核验 | 待核验 | 待核验 |
| 业务部 | `communications` | W1–W3 | 待核验 | 待核验 | 待核验 | 待核验 |
| 客服与单证 | `service` | W3/W7/W9 | 待核验 | 待核验 | 待核验 | 待核验 |
| 客服与单证 | `service-workspace` | W3/W7/W9 | 待核验 | 待核验 | 待核验 | 待核验 |
| 客服与单证 | `service-followups` | W3/W7/W9 | 待核验 | 待核验 | 待核验 | 待核验 |
| 客服与单证 | `order-confirmations` | W3/W7/W9 | 待核验 | 待核验 | 待核验 | 待核验 |
| 客服与单证 | `factory-orders` | W3/W7/W9 | 待核验 | 待核验 | 待核验 | 待核验 |
| 客服与单证 | `kingdee-sales` | W3/W7/W9 | 待核验 | 待核验 | 待核验 | 待核验 |
| 客服与单证 | `production-orders` | W3/W7/W9 | 待核验 | 待核验 | 待核验 | 待核验 |
| 客服与单证 | `documents` | W3/W7/W9 | 待核验 | 待核验 | 待核验 | 待核验 |
| 客服与单证 | `process-complaint` | W3/W7/W9 | 待核验 | 待核验 | 待核验 | 待核验 |
| 客服与单证 | `completed` | W3/W7/W9 | 待核验 | 待核验 | 待核验 | 待核验 |
| 工程部 | `ie-quotes` | W2/W4 | 待核验 | 待核验 | 待核验 | 待核验 |
| 工程部 | `engineering-materials` | W2/W4 | 待核验 | 待核验 | 待核验 | 待核验 |
| 工程部 | `engineering-drawings` | W2/W4 | 待核验 | 待核验 | 待核验 | 待核验 |
| 工程部 | `process-sample` | W2/W4 | 待核验 | 待核验 | 待核验 | 待核验 |
| 工程部 | `process-engineering-change` | W2/W4 | 待核验 | 待核验 | 待核验 | 待核验 |
| PMC 计划 | `production-planning` | W5–W6 | 待核验 | 待核验 | 待核验 | 待核验 |
| PMC 计划 | `pmc-handoff` | W5–W6 | 待核验 | 待核验 | 待核验 | 待核验 |
| PMC 计划 | `process-material-kit` | W5–W6 | 待核验 | 待核验 | 待核验 | 待核验 |
| PMC 计划 | `pmc` | W5–W6 | 待核验 | 待核验 | 待核验 | 待核验 |
| PMC 计划 | `planning-control` | W5–W6 | 待核验 | 待核验 | 待核验 | 待核验 |
| PMC 计划 | `orders` | W5–W6 | 待核验 | 待核验 | 待核验 | 待核验 |
| PMC 计划 | `mine` | W5–W6 | 待核验 | 待核验 | 待核验 | 待核验 |
| 采购与外协 | `supplier-workspace` | W5–W6/W8 | 待核验 | 待核验 | 待核验 | 待核验 |
| 采购与外协 | `supplier-pending` | W5–W6/W8 | 待核验 | 待核验 | 待核验 | 待核验 |
| 采购与外协 | `supplier-followup` | W5–W6/W8 | 待核验 | 待核验 | 待核验 | 待核验 |
| 采购与外协 | `supplier-samples` | W5–W6/W8 | 待核验 | 待核验 | 待核验 | 待核验 |
| 采购与外协 | `supplier-kit` | W5–W6/W8 | 待核验 | 待核验 | 待核验 | 待核验 |
| 采购与外协 | `supplier-outsourcing` | W5–W6/W8 | 待核验 | 待核验 | 待核验 | 待核验 |
| 采购与外协 | `finished-outsourcing` | W5–W6/W8 | 待核验 | 待核验 | 待核验 | 待核验 |
| 采购与外协 | `supplier-risk` | W5–W6/W8 | 待核验 | 待核验 | 待核验 | 待核验 |
| 仓储物流 | `receiving` | W6–W7 | 待核验 | 待核验 | 待核验 | 待核验 |
| 仓储物流 | `process-warehouse` | W6–W7 | 待核验 | 待核验 | 待核验 | 待核验 |
| 仓储物流 | `process-packaging` | W6–W7 | 待核验 | 待核验 | 待核验 | 待核验 |
| 仓储物流 | `production-shipments` | W6–W7 | 待核验 | 待核验 | 待核验 | 待核验 |
| 仓储物流 | `logistics-waybills` | W6–W7 | 待核验 | 待核验 | 待核验 | 待核验 |
| 仓储物流 | `shipment-followups` | W6–W7 | 待核验 | 待核验 | 待核验 | 待核验 |
| 生产车间 | `department` | W6 | 待核验 | 待核验 | 待核验 | 待核验 |
| 生产车间 | `mes` | W6 | 待核验 | 待核验 | 待核验 | 待核验 |
| 生产车间 | `losses` | W6 | 待核验 | 待核验 | 待核验 | 待核验 |
| 品质部 | `process-iqc` | W6–W7 | 待核验 | 待核验 | 待核验 | 待核验 |
| 品质部 | `process-first-article` | W6–W7 | 待核验 | 待核验 | 待核验 | 待核验 |
| 品质部 | `process-process-quality` | W6–W7 | 待核验 | 待核验 | 待核验 | 待核验 |
| 品质部 | `process-outsourcing-quality` | W6–W7 | 待核验 | 待核验 | 待核验 | 待核验 |
| 品质部 | `process-oqc` | W6–W7 | 待核验 | 待核验 | 待核验 | 待核验 |
| 品质部 | `process-shipment-release` | W6–W7 | 待核验 | 待核验 | 待核验 | 待核验 |
| 财务部 | `payment-terms` | W8 | 待核验 | 待核验 | 待核验 | 待核验 |
| 财务部 | `supplier-reconciliation` | W8 | 待核验 | 待核验 | 待核验 | 待核验 |
| 财务部 | `process-supplier-reconciliation` | W8 | 待核验 | 待核验 | 待核验 | 待核验 |
| 财务部 | `ar-workspace` | W8 | 待核验 | 待核验 | 待核验 | 待核验 |
| 财务部 | `service-receivables` | W8 | 待核验 | 待核验 | 待核验 | 待核验 |
| 财务部 | `project-finance` | W8 | 待核验 | 待核验 | 待核验 | 待核验 |
| 财务部 | `finance-documents` | W8 | 待核验 | 待核验 | 待核验 | 待核验 |
| 系统管理 | `business-rules` | W10 | 待核验 | 待核验 | 待核验 | 待核验 |
| 系统管理 | `imports` | W10 | 待核验 | 待核验 | 待核验 | 待核验 |
| 系统管理 | `settings` | W10 | 待核验 | 待核验 | 待核验 | 待核验 |
| 系统管理 | `members` | W10 | 待核验 | 待核验 | 待核验 | 待核验 |
| 系统管理 | `maintenance` | W10 | 待核验 | 待核验 | 待核验 | 待核验 |
| 系统管理 | `business-tools` | W10 | 待核验 | 待核验 | 待核验 | 待核验 |

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

## 缺口状态

- 此表还不是逐字段、逐角色的完成矩阵；待逐批读取页面及服务端 schema，逐项标注可复用、需新增接口或不支持、CRUD 语义和验收证据。
- 附件、批量导入、审批、外部同步/发送、历史及只读报表需要独立记录副作用；不假设所有 `GET` 都是无副作用。
- 尚未确定全员下载入口、升级渠道、不同系统分发及容量上限；见 W11。测试环境的容量结果不得当作生产承诺。
