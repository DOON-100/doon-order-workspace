# CLI 全站入口覆盖清单（W0）

基线：`2cd873e`，2026-10-27。本页由 `lib/department-workspace-navigation.ts` 的 `departmentRouteOrder` 明确列出的入口逐一登记；动态生成或落入管理组的旧入口仍待逐页扫描。清单是盘点起点，不表示这些页面可见于每个员工，也不表示已完成逐表单/字段/接口/权限核验。字段、动作、角色与范围、依赖和验收均须在对应批次补齐；不能将页面入口数量当作完成数量。页面表中的候选源码是按栏目归集的排查入口，不表示每个源码均适用于该页面，必须逐项核对。

业务接口入口为 `app/api/workspace/[action]/route.ts`；具体限制以各处理器和数据模型为准。已有 CLI 查询和写入以 `cli/src/catalog.ts` 及 [写入阶段计划](cli-write-implementation-plan.md) 为准，W1/W2已完成本地成品验收，W3订单/单据/内部交接已完成208条本地成品与GitHub来源核验；处理器初筛见 [API 源码索引](cli-write-api-index.md)，部分 schema 的顶层字段线索见 [字段源码索引](cli-write-field-index.md)。从界面枚举实际按钮、隐含表单、动态角色入口、附件和外部动作，是后续逐批必须完成的工作。所有空缺必须显式登记，不能由页面名称推断权限或 CRUD。

### W1 表单与动作对应（本地成品验收通过）

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

本批不增加客户物理删除或清除历史/附件原件。项目工程图纸、签样、正式下单在W4；报价在W2；订单及交接在W3；历史工作台批量迁入、模板及组织管理在W10；外部真实邮件发送按通讯功能独立审计，当前邮件归属不等于发送。W1本地安装包验收已通过；代码同步和0.32.0的GitHub下载来源核验已完成，全员分发按W11。

### W2 对应矩阵（本地成品175条命令验收通过）

| 页面/表单 | 命令与接口 | 范围及保存语义 | 合成验证 |
| --- | --- | --- | --- |
| IE核价/成本、客户报价 | schema/form/save/action；各自quote-save及状态动作 | 授权字段合并、版本保护，数组完整替换；精确计算和自审拒绝由服务器执行 | 创建/修改、提交/复核/发布/修订、最终确认和显式采用工程来源 |
| 基价目录、工艺预设、模具 | reference-schema/list/save --type | 工程维护、复核收费凭证；停用保留记录，工程可按权限回读停用项目 | 停用/恢复、预设字段保留、非复核人拒收款凭证 |
| 材料名称资料 | names-schema/names/names-import | 名称参考独立版本，管理员迁入、全角色仍按IE访问权限；服务器分页 | UUID去重、非管理员拒绝、来源行与25条分页 |
| 工程业务下推和接收 | handoffs/handoff --action；固定GET/POST逻辑映射 | 最新已复核版本、已有责任的独立业务收件人、本人接收；不发邮件 | 工程人员排除收件、错人拒收、本人接收、重复请求 |
| IE图纸、原件引用和打印模板 | file-schema/list/upload/action/download/export | 原件12MiB，移除引用保留字节，管理员模板逐款绑定，历史版本查询 | 哈希/大小、替换与重绑、模板绑定、草稿/发布导出 |
| 客户原报价、图片和图纸 | file-upload/source或media，file-list/download | 原件10MiB；原报价下载限管理员，其他文件按客户/版本范围；不覆盖原件 | 字节一致、普通人员禁止读内部原件、重复媒体去重 |
| 客户模板、成品导出及归档 | templates、file-upload/template或archive、file-action/apply-template、file-export | 模板限管理员；应用生成待核对草稿；可维护人员的导出可能归档成品 | 模板应用、价格/单位复核后确认、成品内容核验、摘要回读 |
| 已发送事实 | record-sent；customer-quote-record-sent | 仅登记、不外发；已确认版本、日期和载荷指纹 | 跨客户拒绝、相同请求去重、同标识不同内容拒绝 |
| 历史价格、SKU发票依据和原件 | sales prices schema/list/archive/import/source-upload/source-download/export | 摘录按客户权限，导入/原件限管理员；新档案、摘要、不覆盖历史 | 内容去重、原件不覆盖、跨角色拒绝、来源摘要与导出 |
| 发票价格规则和镜片说明 | sales prices selection-save | 报价管理员，版本及当前规则SHA；未指定说明保留 | 首次/更新/旧版本拒绝、无改动重放、普通人员拒绝 |

人员绑定、个人通知邮箱、真实SMTP发送与其他通讯配置在W10单独覆盖；本批没有外部邮件发送。阶段检查以进度计划和成品验收记录为准，0.31.0已通过实际安装后175条命令验收，远端同步和CI来源复核待网络恢复。

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


### W3 对应矩阵（33条新命令及全208条命令成品验收通过）

| 页面/表单 | 命令与接口 | 权限、版本与数据语义 | 验证 |
| --- | --- | --- | --- |
| 客户订单字段 | `sales orders schema/form/update`；`data/edit-order` | 服务端原角色字段白名单、按字段冲突合并；仅提交patch | 合成增量修改、越权及回读 |
| 业务客服PMC交接 | `sales orders workflow --type`；`workflow` | 原客户责任及订单版本；不代为确认责任，不开放W5排期 | 合成提交客服及拒绝无权调用 |
| 销售原单结构化证据 | `sales sources schema/import`；`sales-order-sources-import/data` | 管理员、UUID、完整来源摘要、同号资料不可覆盖，不创建生产需求 | 合成迁入、重放及普通业务拒绝 |
| 中英内部订单 | `purchasing factory-orders schema/form/export/save --type`；`factory-orders/factory-order-save` | 旧服务器先拒绝；内部和源订单版本、员工与完整载荷绑定UUID；保留历史和生产门禁 | 合成旧版本/旧源版本/不同载荷UUID/跨账号/并发/后续版本后的原请求重放 |
| 内部订单表格 | `table-preview/table-commit`；`factory-order-table-*` | 本人预览、双版本原子检查、保留源订单数量身份；提交返回ID并真实回读 | 合成新订单及草稿、预览后变更拒绝、重复预览提交不重复建单 |
| 客户PO及工程/生产交接资料 | `service documents schema/references/form/save --kind source --type`；`handoff-business-*` | PO/工程资料/生产交接用统一字段保存；字段按键合并，数组完整替换 | 合成指定字段保留、来源/订单精确关联、越权及旧版 |
| PI及现有单据 | `save --kind document/generate/action --type`；`handoff-business-*` | 明确来源版本，PI从PO生成，指定负责人核对；物流来源与财务请款另按W7/W8补齐前提 | 合成生成、提交、本人核对、管理员不能替代负责人及旧依据检测 |
| 单据和交接原件 | `files/file-upload/file-download`；`handoff-business-attachment/file` | 10MiB、UUID、版本、不可变原件及摘要；下载不覆盖本地原文件 | 合成上传、原字节核对及已有文件拒绝 |
| 中英原单上传及草稿 | `sales kingdee source-template/source-preview/source-commit/source-download/prepare`；`kingdee-sales-*` | 8MiB原件，预览保存原件但不提交；本人确认提交，保留摘要和原单行标识 | 合成模板、预览归属、重复提交、原件摘要与不可覆盖 |
| 金蝶销售草稿 | `schema/status/list/form/save/action/export`；`kingdee-sales-*` | 版本、原单全行、真实客服责任及有效确认；validate也写版本，配置存在时可能外部只读查询 | 合成增改、全单校验、客服确认、标准模板导出 |
| 金蝶真实上传/核查 | 共用`action --type upload/reconcile` | 原服务器就绪/配置/开关/确认和上传留痕；当前协议缺口继续拒绝真实上传，不重试 | 本地无金蝶配置时拒绝，无真实ERP请求；不宣称端到端真实上传通过 |

不增加订单、原单、单据或历史的物理删除；出货来源维护按W7，财务依据按W8，组织、模板配置及全局历史导入按W10继续。旧网站的内部订单保存调用保留原语义，CLI的新保护必须配套部署网站版本。本批Git提交不触发部署。

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
- `factory-order-save` 的动作字段区分草稿、客服确认、PMC 确认和下发；多个文本字段有空值默认，W3已补可选token/expectedVersion/orderVersion，三者须一起提供，CLI强制使用。按当前账号、明细及完整内容指纹绑定原操作，新增写入原子复核双版本，重放回读原不可变历史；GET响应契约标识阻止旧服务器静默忽略新保护字段。原网站无新字段的旧调用保持兼容，不将下发简化为普通保存。
- `workflow` 是另一个订单交接入口，携带订单 `version` 和动作；业务、客服、PMC 各自的责任校验不同，不能仅靠读取订单权限调用。以上是源码审计线索，具体功能仍需独立合成测试。

## 缺口状态

- 此表还不是逐字段、逐角色的完成矩阵；待逐批读取页面及服务端 schema，逐项标注可复用、需新增接口或不支持、CRUD 语义和验收证据。
- 附件、批量导入、审批、外部同步/发送、历史及只读报表需要独立记录副作用；不假设所有 `GET` 都是无副作用。
- 尚未确定全员下载入口、升级渠道、不同系统分发及容量上限；见 W11。测试环境的容量结果不得当作生产承诺。


## W4 工程与样办表单对应（220条本期命令及GitHub来源核验通过）

| 页面/表单 | CLI与服务器接口 | 权限/版本/副作用及保留 | 证据 |
| --- | --- | --- | --- |
| 工程画图需求 | `engineering drawings schema/form/references/save`；drawing-save/data | 创建标识仅新建；修改当前版本与指定字段，工程执行字段和需求字段按原角色分开 | 合成增改、未知/0、冲突、不同内容UUID及越权 |
| 审图/变更/追加明细 | `drawings action --type review/event-review/detail-add`及events；drawing-review/event-review/detail-add/history | 工程需求版本；审图限指定角色，关键依据变更撤回批准，采纳事件只登记决定不自动覆盖字段 | 合成独立审图、原批准撤销、变更事件和明细 |
| 工程历史原表 | `drawings import`；drawing-import | 管理员、来源摘要/工作表/行号身份；追加证据、原列保留，同来源冲突拒绝 | 合成新建/跳过及普通业务拒绝 |
| SOP指令及任务 | `engineering sops schema/form/references/action --type`；sop-create/change/target/prepare/mes-upload/confirm/cancel | 新建操作标识、当前任务版本、目标版本和不可变历史；实际MES凭证登记不操作MES | 合成创建/明确版本/准备/事实/独立确认/后续改图/取消；本人自确认拒绝 |
| SOP原件及凭证 | `sops files/file-upload/file-download`；sop-attachment/file | 10MiB、类型及内容签名、归属和SHA-256；文件追加不更换原件、不递增任务版本 | 合成独立文件、下载原字节及本地不覆盖 |
| 项目图纸/客户确认/报价 | `engineering projects schema/references/form/save --type drawing/confirmation/quote-link/drawing-withdraw`；customer-project-* | 项目/轮次/款色、原件、明确图纸及报价历史版本；客户证据和原撤回留痕 | 合成原件/图纸/客户决定/精确报价引用、撤回、跨客户拒绝 |
| 内部样办 | 共用projects save --type sample-release/sample-update/sample-promise | 下达绑定轮次版本及原技术/付款门禁；执行按当前样办版本，内部预计与对客日期分开 | 合成下达、接单/制作/QC/可寄、越级拒绝，指定字段保留 |
| 寄样/签收/反馈 | 共用projects save --type sample-dispatch/dispatch-receive/sample-feedback | 不超未寄数量，明确实寄与签收；逐款反馈保存证据，不自动寄送/发消息 | 合成分批寄样、签收与逐款客批 |
| 大货正式交接 | 共用projects save --type bulk-link | 轮次与每条订单版本、正式来源、图纸/客户确认/报价/财务前提；不覆盖原订单数量身份 | 合成精确关联及原数量回读保全 |
| 样品签样与工程变更/冻结依据 | `engineering records schema/list/form/history/save --type sample/engineering-change`；process-data/history/save | 原角色/客户/订单/业务组；字段增量、details合并、历史不可变，完成关口依据仍必填 | 合成2类型增改完成、旧版/重放、历史、0及原字段保留 |
| 台账图号更正 | `sales orders drawing-correct`；drawing-correction | 原管理员/PMC权限、原订单版本、原因及历史身份；保留主键与原件 | 合成更正及普通业务拒绝 |

本批仅复用已有有鉴权API，不增加物理删除、隐式外发或新的CLI确认；全局账号/模板/邮件与其他共用维护继续按W10。金蝶既有12条命令保留但本批暂停操作，成品验收明确排除并列明；不将金蝶命令目录存在称为已继续联调。

W4最终证据见[W4验收](cli-write-w4-acceptance.md)：0.33.0共232条登记命令，本期执行220条、跳过12条金蝶；72组合成链路通过，测试数据和安装已清理，未部署。

## W5 计划、采购与供应商表单对应

CLI 0.34.0新增42条命令；字段以各schema命令和CLI白名单为准。集中检查及成品证据见[W5验收](cli-write-w5-acceptance.md)。

| 页面/表单 | 命令与接口 | 权限、版本与副作用 | 合成验证 |
| --- | --- | --- | --- |
| 订单排期与PMC总表 | planning orders schema/form/save、pmc schema/save；workflow、pmc-save | 原PMC/交接权限、订单版本；指定字段/单元格合并，固定核算日期 | 未指定字段保留、同字段冲突、越权、非法日期 |
| PMC核对轮次 | planning rounds schema/start/review；pmc-round/review/data | 本人internal/external范围；UUID绑定完整lineIds/scope，核对进度绑定订单版本 | 重放、不同内容拒绝、本人轮次及原订单保全 |
| 计划工作台与齐套 | planning control schema/references/list/form/history/save/action --type record；planning-control-* | 9场景27模块；经理/指定负责人、记录版本、来源、状态门禁及历史 | 各模块真实增改、字段/历史、来源变化/权限/重放 |
| 测算与有限产能 | 同组--type calculation/window/allocation；planning-control-calculation-save、planning-capacity-* | 服务端计算、窗口占用及订单未排数量；确认/取消独立，非派工或库存 | 分母未知/0、负荷超限、来源版本、取消释放 |
| 采购跟进 | purchasing purchases schema/form/save；purchase-save/data | 原采购权限；4字段并发合并，无UUID去重 | 旧版本异字段合并、同字段冲突、原raw/source及未知余额保全 |
| 采购核数/收退补/存档 | purchases action --type opening/correction/receipt/return/replacement/archive；purchase-receipt/archive | 核数UUID绑定身份/完整输入和版本；存档逐项版本、真实退货恢复跟进，不等于库存 | 四位小数、0/null、凭证冲突、越权/不同内容UUID、存档重开、响应丢失/回读失败 |
| 供应商主档 | purchasing suppliers schema/list/form/save；supplier-save/data | 原采购权限、主档版本、指定字段，停用不删除 | 增量、旧版/无权拒绝，联系人保留 |
| 供应商报价及原件 | purchasing supplier-quotes schema/list/form/history/save/files/file-upload/file-download/template/export；supplier-quote-* | 原价格权限；原子版本/UUID；报价追加版本，原件独立摘要下载 | 同版本竞态仅一笔成功、重放/异身份拒绝、旧报价及原件字节、真实XLSX |
| 外协下达/采购复期 | purchasing outsource schema/form/references/history/action；outsource-create/update/approve/cancel | 原工序/采购/主管权限；新增源订单版本和UUID，其余外协版本，不对外发送 | 原订单保全、旧版/异身份/异内容UUID、跟进/审批/取消及历史 |
| 成品外发准备 | operations finished schema/form/references/action；finished-supplier-order-confirm/task-create/baseline-confirm/baseline-stage | 员工分类/建账/期初；订单和任务独立版本及UUID，明确未知/0 | 分类、待核定到核定、工序null到0、旧版拒绝，源订单身份数量保全 |

金蝶采购源表purchase-preview/commit/held继续暂缓；预览保存批次和原件，不能称只读。purchase-change-*为网站提案确认，CLI不读取或传递批准；直接员工业务请求使用原采购接口，模型业务提案保留已有人工审批边界。成品供应商接单/复期、进度、来料仓储、生产及品质按W6继续；无物理删除、任意HTTP/Shell/数据库入口或正式部署。

## W6 生产、质量、仓储与成品收发对应

新增40条及2条既有入口扩展；字段来自production-write.ts、process-schemas.ts、supplier-schemas.ts及schema命令，验收见[W6记录](cli-write-w6-acceptance.md)。

| 页面/表单 | CLI/接口 | 边界 | 合成检查 |
| --- | --- | --- | --- |
| 部门原表工序 | operations ledger schema/form/history/save；ledger-edit/production-workspace-* | 服务器返回部门可写列，订单版本与原投产门禁，AP/BB自动日期 | 指定列、越权/版本、原身份数量、历史 |
| 累计损耗与冲减 | operations losses schema/list/form/history/save/export；loss-record/export | 部门、订单版本、previousId、累计数量和UUID，patch不绕投产 | 0/null/平衡、冲减、来源凭据、异kind标识碰撞/原记录保全 |
| MES报工及更正 | operations reports/corrections schema/form/history/action等；production-report-action | 报告/订单/更正各自版本及原子UUID，不直接改报工量 | 关联、更正/审核不改数量、新导出审批一致才核验、重放/越权 |
| MES原件 | reports import-preview/import-show/import-commit/source-download；preview/job/commit-import/file | 保存原件和任务是写入；绑定摘要、选择及来源版本，真实MES请求0 | 原件字节、选择变化拒绝、旧来源/重放与导入结果回读 |
| 工序外协收货 | operations receipts schema/file-upload/save/file-download；receipt-photo/confirm/ledger-file | 外协+订单双版本、凭证和UUID身份内容绑定，不等于采购核数 | 收货/不良、旧双版本、异内容/身份、原件及未涉及记录 |
| 质量/齐料/仓储 | quality/warehouse records schema/list/form/references/history/save；process-data/history/save | IQC/首件/过程/外协质检、material-kit/warehouse；原角色/客户/组/状态，独立证据不自动库存 | 6型增量/显式恢复未知/完成/取消恢复/7版历史、数量/来源/越权/回读未知 |
| 成品员工收发 | operations finished action/schema --type receive/qc/stock/return/close；finished-supplier-* | 任务UUID及写角色，库存/结单额外源订单版本，旧服务器缺新契约在写前拒绝 | 两套分批/返工/退货、BF/BG/结单回读、撤权重放、越量与未知期初 |
| 成品原件 | finished files/file-upload/file-download；finished-supplier-attachment/file | 完整性契约、不可变任务/文件id、字节数及SHA-256 | 原件追加、摘要/归属、旧服务器拒绝、已有本地文件不覆盖 |

供应商专属accept/promise/progress/exception/shipment/rework-confirm仍使用既有门户，员工CLI不代行；无任意Shell/数据库、物理删除、真实MES/ERP/物流外发或正式部署。包装/发运及财务按W7/W8继续。

## W7交付对应

| 页面 | CLI/接口 | 范围与证据 |
| --- | --- | --- |
| OQC/包装/放行 | quality/warehouse records --type oqc/packaging/shipment-release；process-save | 原部门/客户/组与版本UUID；三数/数量/完成依据、未知、取消恢复和历史通过；不自动库存 |
| 发运/物流跟进 | service shipments九命令；service-save/data/history/attachment/file | 客户责任、业务组、源订单版本/记录UUID，分批合计/日期、旧版越权、原件回读通过；无承运商/签收接口 |
| 结单/恢复 | operations ledger lifecycle；ledger-lifecycle | 原角色/严格版本、足量入仓/日期；管理员恢复、旧版拒绝及原身份数量保全；无UUID不重试 |
| 生产出货资料 | service documents type=production_shipment | 精确发运id/version可引用，保留原人工登记；来源数量/版本、原件、来源变化拦提交通过 |
| 物流单据 | documents generate/save/action | packing/waybill无价格，Invoice当前PI及行价/累计数量，负责销售核对；超量、过期、管理员代签拒绝通过 |

BF/BG入仓复用W6，成品协作保留专用入口；内容checked、发运登记、承运商接收和客户签收分别表达，不用样办签收冒充大货。字段和当前结果见[W7验收](cli-write-w7-acceptance.md)。
