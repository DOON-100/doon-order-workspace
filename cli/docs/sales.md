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

`doon sales projects recycle --json` 查询有权管理的回收站项目；`doon sales projects trash --input <文件> --version <当前版本> --request-id <UUID> --json` 移入回收站，输入 `id` 和 `reason`；`doon sales projects restore` 使用同样参数，输入仅 `id`。服务器校验项目管理权限和未完成事项，回收不物理删除记录，恢复沿用原业务状态。

`doon sales customers followup-add --input <文件> --version <跟进状态版本> --request-id <UUID> --json` 登记客户沟通并更新跟进状态，与项目跟进记录不同。输入须包含 `customerId`、`at`、`channel`、`content`、`result`、`disposition`、`next`、`nextDate`、`evidence`；`channel` 支持邮件、孚盟（历史）、WhatsApp Business、个人微信、会议、电话、其他；`disposition` 为继续跟进或暂停跟进。暂停时下次日期填空字符串；状态版本从客户详情获取。仅登记事实，不发送消息；重复匹配的历史记录可能导致回读结果不明，须查询原记录。

`doon sales projects item-update` 与 `round-update` 使用 `--input <文件> --version <当前版本> --request-id <UUID>` 修改款色和轮次。为防止旧接口默认值覆盖，输入须包含当前全部可编辑字段：款色为 `id`、`projectId`、`model`、`quantity`、`customerModel`、`drawing`、`color`、`lens`、`material`、`requirements`；轮次为 `id`、`projectId`、`title`、`type`、`scope`、`parentRoundId`、`stage`、`requiredDrawingTypes`、`requireQuote`、`requiredSampleIds`、`sampleGateStage`、`sampleGateNote`、`dueDate`、`reason`、`status`。服务器保留已转单记录并拒绝不允许的修改。

`doon sales projects development-show <项目ID> --customer <客户ID> --json` 查询独立的项目开发资料与进展，尚无资料时版本为 0。`development-save --input <文件> --version <版本> --request-id <UUID>` 维护阶段，输入 `customerId`、`projectId`、`stage`、`next`、`notes`、`reason`；`development-log` 使用同样参数，输入 `customerId`、`projectId`、`stage`、`next`、`result`，追加进展并保留原备注。阶段为待核实、需求了解、可行性、报价、打样、样品反馈、商务确认、暂缓或关闭。

`doon sales projects document-show <项目ID> --customer <客户ID> --json` 查询项目资料文档及历史版本；没有文档时版本为 0。`doon sales projects document-save --input <文件> --version <版本> --request-id <UUID>` 保存新版本，JSON 包含 `customerId`、`projectId`、`content`、`reason`；服务器保留原文和历史版本。

## 客户和项目附件

`sales attachments list --customer <客户ID> [--project <项目ID>]` 查看附件；`download <附件ID>` 增加相同范围参数及 `--output <新文件>`，校验大小与 SHA-256 后新建文件，不覆盖现有文件。`upload --input <JSON> --file <原件> --request-id <UUID>` 上传，JSON 需提供 `customerId`、`title`、`fileVersion`，客户附件指定 `category`，项目附件指定 `projectId` 和 `folder`，可提供 `documentType`、`status`、`note`；原件限 20 MiB。`update --input <JSON> --version <版本> --request-id <UUID>` 可维护或归档，须提供 `id`、`customerId`、`projectId`、分类或目录、`documentType`、`title`、`fileVersion`、`status`、`note`、`reason`。实际目录、类型与权限以服务器校验为准。

## 客户交接与公海

`sales customers transfers --json` 查询授权范围的客户状态、客户版本、交接、公海申请、领取申请及销售人员。`sales customers transfer --action <动作> --input <JSON> --version <状态版本> --request-id <UUID>` 执行固定业务动作。动作支持 `primary`、`handoff`、`accept`、`cancel-handoff`、`pool-request`、`pool-approve`、`pool-reject`、`pool-withdraw`、`claim`、`claim-approve`；服务器执行现有本人接收与管理员审批规则。JSON 必含 `customerId`、`customerVersion`；主负责人和交接提供 `to`、`reason`；公海申请提供 `reason`（两年未下单或多轮跟进未成功）、`basis`；领取提供 `next`、`nextDate`、`reason`；处理现有申请提供 `id`、`requestVersion`、`note`。

`sales customer-tasks list [--customer <ID>]` 查询独立客户任务及可选负责人；`history <ID>` 查询历史；`save --input <JSON> --version <版本> --request-id <UUID>` 用于新增和修改，新增版本为0且不提供 `id`，修改提供 `id` 和当前版本。JSON 完整提供 `customerId`（无客户可为空）、`title`、`ownerId`、`due`、`status`、`result`、`notes`；状态可为待接手、进行中、受阻、完成、取消。服务器校验负责人及客户权限，完成须有结果。

`sales customers sensitive <客户ID> --json` 按服务器权限明确读取付款和快递账号资料及资料版本；`sensitive-update --input <JSON> --version <版本> --request-id <UUID>` 更新指定字段，JSON 为 `customerId` 和 `patch`，仅允许 `bankPaymentInfo`、`courierAccount`。银行资料维护继续限服务器允许的管理员/财务，其他人员不能借 CLI 扩权；输出只包含本次指定字段。

客户主档 `master` 和 `master-update` 还支持目录字段、责任成员及启停：`patch.directory` 可指定国家、等级、分类、重点标记、历史日期及默认付款条件；责任字段为 `salesName`、`serviceName`、`pmcName`、`salesMemberIds`、`serviceMemberIds`、`quoteMemberIds`，启停为 `active`。未指定字段保留。服务器仍限制管理员专属操作、PMC 名称/编号限制及业务/客服的本人客户范围；公海分类须用流转流程。责任数组的添加、替换及回退姓名匹配语义与服务器既有规则一致。


## 普通项目表单与项目原件

`doon sales projects entry-schema --type item|round|communication|task|attachment --json` 返回该类型允许字段。`entry-save --type <类型> --input <JSON> --request-id <UUID>` 新增普通记录；JSON至少提供projectId，其他字段与网站普通表单一致，可留空。修改时在JSON提供id并加`--version <当前版本>`，仅提交变化字段，服务器保留未提供资料。attachment只允许修改已上传原件的资料。普通保存不执行正式下单、寄样或对外发送；现有正式保存、任务提交/审核命令仍复用各自业务规则。

项目原件使用`projects file-upload --input <JSON> --file <原件>`，JSON字段为projectId、可选roundId、category、note。category为general或original-communication，后者仅项目级、roundId须为空，允许任意原件扩展名；上传上限50MiB，服务器按项目/轮次/分类/文件名/内容摘要/说明去重，未提供请求UUID语义。结果不明先查询`projects show <项目ID>`的attachments。`file-download <附件ID> --project <项目ID> --output <新文件>`校验大小和SHA-256后写入新文件，拒绝覆盖。原件与`sales attachments`客户工作流正式附件是网站原有的两种记录，关联沟通原件须使用项目原件ID。

## 跟进转项目和归档邮件

`doon sales followups action --type promote|classify --input <JSON> --version <当前版本> --request-id <UUID>`。promote输入id（跟进ID）、customerId、可选teamId、title、description、code；classify输入id（邮件档案ID）、followupIds数组，空数组表示移出归属。服务器继续检查跟进负责人、客户/组权限和邮件来源。`mailbox [邮件ID]`读取目录或指定正文；`history <跟进或邮件ID>`读取授权历史。以上不发送邮件。历史工作台批量导入属于W10。


## 客户报价写入（W2进行中）

`sales quotes schema`查询允许字段，`form <id>`读取有权编辑的字段，`save --input <JSON> [--version <当前版本>]`统一新增与修改。新增不提供id和已有版本；修改JSON提供id，只填写改变的顶层字段，CLI先读取授权当前记录并核对版本后合并保存。数组须提供完整替换内容和稳定行ID，不能把一行当成整个明细数组。服务器校验字段、金额、来源、角色、状态并保留隐藏内容；不提供没有服务端支持的请求UUID或自动重试。

`action --type confirm|revise|adopt-ie --input <JSON> --version <当前版本>`执行现有业务动作，字段见schema。confirm中的acknowledgeEnglish是网站原有最终英文核对字段；审批身份继续由服务器决定。采用IE必须显式传工程版本、款式对应和适用范围。结果不明先查询，不能假设未保存。附件、模板、已发送登记等W2剩余动作尚未接入。
