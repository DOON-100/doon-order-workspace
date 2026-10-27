# 批次 1：业务部查询

客户端 0.2.0，复用现有鉴权和业务 API，无新增服务器部署要求。实际可用性取决于服务器接口版本和员工权限。15 个命令均不写业务记录；导出只在本机创建文件。

```powershell
doon sales teams list --json
doon sales customers list --team TEAM_ID --search 客户名 --limit 20 --json
doon sales customers show CUSTOMER_ID --team TEAM_ID --json
doon sales projects list --customer CUSTOMER_ID --json
doon sales inquiries show INQUIRY_ID --json
doon sales quotes version QUOTE_ID 1 --json
doon sales quotes export-completed --team TEAM_ID --output C:\Private\completed-new.xlsx --json
```

示例 ID 须替换为实际编号。参数以 `doon sales <资源> <动作> --help` 为准。

| 资源 | 动作 | 现有接口 |
| --- | --- | --- |
| teams | list | business-team-data |
| customers | list / show / history | customer-workflow-data、customer-workflow-history；名称取自 business-team-data |
| projects | list / show / history | customer-project-data、customer-project-history |
| inquiries | list / show / history | process-data（固定 type=rfq）、process-history |
| quotes | list / show / history / version | customer-quotes、customer-quote-version |
| quotes | export-completed | customer-quote-completed-export |

上述查询命令支持 `--team <精确ID>`；不填时查询全部获授权范围。查询支持 `--customer <精确ID>`、`--limit 1..100`（默认20）、`--offset 0..1000000`（默认0）；list 额外支持 `--search`，按当前资源摘要字段搜索。客户 show/history 的编号是客户 ID；其余为对应记录 ID。没有 `--mine`，未把姓名或角色推测为归属。

分页为客户端筛选、分页，服务器仍按现有接口读取。返回 page.total、rows 和 nextOffset；详情每个子列表独立分页。scope 描述请求范围和权限来源。业务组筛选要求列表接口回显已应用的组范围；详情和历史先核对记录处于该列表，避免直接详情接口忽略组筛选。权限不足、协议不符或范围无法确认时报错。

客户资料省略银行与快递账号。项目历史只给操作摘要，不展开原始快照。报价只展示对客商业字段，省略内部成本、来源公式和原始历史快照；保留 null、0、范围及复核标记。历史报价改绑过客户时暂不展示，请到网页核查。任何省略均不代表网页中没有相应内容。服务端 canEdit 等是员工权限信息，不表示 CLI 已提供修改命令。

已完成报价总表导出使用已有纯读取接口，只支持 team 和必填 output；不支持客户、搜索或分页，导出所选组内全部获授权的已完成行。文件上限32 MiB，校验类型和 XLSX ZIP 签名后独占创建新文件；返回路径、字节数和 SHA-256。已有文件拒绝覆盖。未接入会生成服务器归档的模板导出接口。

除下述 W1 客户资料更新、排程、项目和询价创建、项目款色、轮次与沟通登记外，其他新增、修改、删除、提交、审批、发送等仍暂缓；附件下载、模板归档导出、完整客户资料导出及服务端分页也尚未开放。沿用 Cookie 的权限由服务器决定，固定接口白名单不能替代服务器权限隔离。

## 客户资料与跟进排程写入（W1）

使用本人账号登录，先用 `doon sales customers show <客户ID> --json` 查看该客户和当前 `profile.version` 或 `workflow.version`。工作流尚不存在时版本为 0；仅支持本人在服务器上的客户权限，不支持业务组参数，也不能用这些命令修改银行资料或快递账号。

`profile-update` 输入 UTF-8 JSON，例如 `{ "customerId": "客户ID", "patch": { "website": "https://example.test" } }`；只更新 patch 中指定的字段；本批输入的客户编号及字段值不接受首尾空格。`schedule-set` 输入例如 `{ "customerId": "客户ID", "next": "跟进样品", "nextDate": "2026-12-01" }`。

```text
doon sales customers profile-update --input <文件> --version <当前版本> --request-id <UUID> --json
doon sales customers schedule-set --input <文件> --version <当前版本> --request-id <UUID> --json
```

每次新操作使用新的 UUID，并保留原输入和 UUID；相同操作重试必须使用原 UUID 和完全相同内容。客户端不会自动重试，网络中断或回读失败先查询原结果；服务端仍会复核权限、版本和内容。修改后查询可能因权限收回或并发修改而无法验证，客户端不会宣称回读成功。除本页明确列出的操作外，其他客户、项目、询价写入仍在 W1 待办。

## 创建客户开发项目

`doon sales projects create --input <文件> --request-id <UUID> --json`；输入 UTF-8 JSON，例如 `{ "customerId": "客户ID", "title": "项目名称" }`。可选字段为 `code`、`description`、`teamId`、`salesMemberId`、`serviceMemberIds` 和 `dueDate`。只创建当前员工对该客户有写权限的项目，服务器会校验业务组与责任人。新建需要独立 UUID，重放使用完全相同的输入和 UUID；本批不支持项目修改或删除。

## 创建询价需求记录

`doon sales inquiries create --input <文件> --request-id <UUID> --json`；输入示例：`{ "customerId": "客户ID", "title": "询价事项", "details": { "requirement": "客户要求", "quantity": 0 } }`。可选顶层字段有 `orderId`、`teamId`、`notes`；`details` 支持 `gateReason`、`documentRef`、`requirement`、`targetDelivery`、`quantity`、`currency`、`quoteRef`。只新建询价流程跟踪记录，不能用于改写订单或报价；服务器校验客户、订单和业务组权限。未填写的内容不推断，数量 0 不代表未知。

## 项目款色与沟通

`doon sales projects item-add --input <文件> --request-id <UUID> --json` 新增款色。输入示例：`{ "projectId": "项目ID", "model": "款号", "quantity": 5 }`；可选 `customerModel`、`drawing`、`color`、`lens`、`material`、`requirements`。

`doon sales projects round-add --input <文件> --request-id <UUID> --json` 新增项目轮次。输入示例：`{ "projectId": "项目ID", "title": "开发轮次", "type": "development", "scope": [{ "itemId": "项目款色ID", "quantity": 5 }] }`。`type` 可为 `development`、`revision`、`sales_sample`、`preproduction`、`bulk`；修改轮次须提供 `parentRoundId` 和 `reason`。可选 `stage`、`requiredDrawingTypes`、`requireQuote`、`requiredSampleIds`、`sampleGateStage`、`sampleGateNote`、`dueDate`；服务器校验款色归属和业务条件。此命令只新增，不覆盖已有轮次。

`doon sales projects communication-add --input <文件> --request-id <UUID> --json` 追加沟通记录。输入示例：`{ "projectId": "项目ID", "occurredAt": "2026-10-20", "content": "沟通内容" }`；可选 `roundId`、`channel`、`contact`、`nextAction`、`ownerId`、`dueDate`、`visibility`、`attachmentIds`。如果填写 `nextAction`，服务器还会生成关联的项目任务；不填写时不会创建该任务。此命令只登记沟通，不对外发送。

上述三项均以新 UUID 和现有项目权限提交并回读；当前仅新增，不通过默认字段覆盖旧记录。

## 客户跟进

`doon sales followups list --json` 和 `doon sales followups show <ID> --json` 查询本人有权访问的跟进记录，不支持业务组筛选；列表的 `members` 提供服务器返回的人员 ID、姓名和角色，供选择负责人，权限仍由服务器校验。`doon sales followups create --input <文件> --request-id <UUID> --json` 新建跟进；输入示例：`{ "ownerId": "负责人ID", "customerId": "客户ID", "projectId": "项目ID", "title": "跟进事项" }`。客户和项目可省略；关联项目须属于所选客户。可选 `category`、`stars`、`status`、`followUpDate`、`notes`、`nextAction`、`checklist`，`category` 可取 `shipping`、`order`、`exhibition`、`engineering`、`other`，`stars` 为 0–3；`status` 可取 `pending`、`in_progress`、`waiting_customer`、`waiting_internal`、`completed`。每项检查包括 `id`、`text`、`checked`。服务器校验客户及负责人权限，此命令仅新增，不覆盖旧跟进。

## 项目待办

`doon sales projects task-create --input <文件> --request-id <UUID> --json` 创建待办，输入示例：`{ "projectId": "项目ID", "title": "待办事项", "ownerId": "跟进人ID", "serviceReviewerId": "客服审核人ID", "salesReviewerId": "业务审核人ID" }`。可选 `roundId`、`description`、`waitingFor`、`dueDate`。负责人和审核人须符合服务器的客户、小组及职责配置。

`doon sales projects task-submit --input <文件> --version <当前版本> --request-id <UUID> --json` 由指定跟进人提交，输入为 `projectId`、`id` 和 `result`。`doon sales projects task-review` 使用相同版本及请求标识参数，输入为 `projectId`、`id`、`stage`（`service` 或 `sales`）、`decision`（`approve` 或 `return`）及可选 `comment`；退回须填写意见。服务器执行原有两级审核，CLI 不增加确认。项目详情可查询待办版本、人员和权限标记。

`doon sales followups update --input <文件> --version <当前版本> --request-id <UUID> --json` 更新跟进。为避免旧接口默认值覆盖原资料，输入必须包含 `id`、`ownerId`、`customerId`、`projectId`、`title`、`category`、`stars`、`status`、`followUpDate`、`notes`、`nextAction` 和 `checklist`；先用 `show` 获取当前记录及版本，保留未修改字段，允许明确空字符串和空清单。服务器重新校验权限和版本。

`doon sales projects update --input <文件> --version <当前版本> --request-id <UUID> --json` 修改项目主表。先用 `sales projects show` 取得当前版本和字段；输入须完整提供 `id`、`customerId`、`title`、`code`、`description`、`teamId`、`salesMemberId`、`serviceMemberIds`、`serviceReviewerId`、`salesReviewerId`、`dueDate` 和 `status`，以防旧接口默认值覆盖。旧项目中缺少的审核人字段使用空字符串。服务器校验成员、客户、小组、项目状态与版本。

`doon sales inquiries update --input <文件> --version <当前版本> --request-id <UUID> --json` 更新询价。先查询当前记录；输入必须完整包含 `id`、`customerId`、`orderId`、`teamId`、`title`、`batch`、`ownerId`、`responsibleId`、`plannedDate`、`actualDate`、`status`、`inputBasis`、`inputVersion`、`outputEvidence`、`gateStatus`、`blocker`、`nextAction`、`nextOwnerId`、`nextDueDate`、`notes`，以及 `details` 的 `gateReason`、`documentRef`、`requirement`、`targetDelivery`、`quantity`、`currency`、`quoteRef`。未确认数量使用 `null`，明确零用 `0`；缺省的文字字段使用空字符串。服务器校验关联、权限、状态和版本。

`doon sales projects task-update --input <文件> --version <当前版本> --request-id <UUID> --json` 调整待办或将 `status` 设为 `cancelled` 取消。先查询项目详情，完整提供 `id`、`projectId`、`title`、`ownerId`、`roundId`、`description`、`serviceReviewerId`、`salesReviewerId`、`waitingFor`、`dueDate` 和 `status`；审核中调整或取消须提供 `changeReason`。取消时保留当前配置字段，服务器保留原记录和审核历史。

`doon sales customers create --input <文件> --json` 新建客户主档。输入示例：`{ "customer": "客户名称", "customerCode": "客户编号", "salesName": "本人姓名" }`，还可指定 `serviceName` 和 `notes`；服务器决定哪些角色可创建及可指派的责任人。该接口仅创建，客户名称已存在时拒绝覆盖。服务器没有请求标识幂等能力，因此结果不明时先查询客户，不要盲目重复提交。

`doon sales customers master <ID> --json` 查询可维护客户主档和版本；`doon sales customers master-update --input <文件> --version <版本> --json` 只更新指定主档字段。输入示例：`{ "id": "客户ID", "patch": { "notes": "客户备注" } }`；允许的字段为 `customer`、`customerCode`、`notes`。后台保留未指定字段、原责任和账号权限，并按原规则记录身份变化及审计。该功能需要服务器同步更新；当前仅覆盖管理员及本人负责的业务/客服，其他角色按服务器权限暂不开放。结果不明先查询当前记录，不自动重试。
