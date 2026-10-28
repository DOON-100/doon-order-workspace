# Codex / WorkBuddy 调用说明

发行包的统一入口是 [README](../README.md)。当前 0.42.0 共 425 条命令，413 条属于本期范围，12 条金蝶暂缓；下文按业务阶段解释操作约定，实际验证状态以仓库执行记录为准。客户端安装不自动更新服务器。

员工先在自己的 Windows 终端安装并运行 `doon login`，随后重新打开工具，使其获得用户 PATH。工具使用同一个 `doon` 命令；是否能执行系统命令仍取决于各工具实际版本和授权，需在员工电脑验收。

1. 运行 `doon commands --json` 读取实际命令，按具体命令 `--help` 核对参数。`modules` 中的 pending 栏目尚不能执行。
2. 用 `doon whoami --json` 核对身份。AUTH_REQUIRED 时让员工本人回到终端登录；mustChange=true 时让员工在网页修改初始密码。
3. 机器调用统一加 `--json`，检查进程退出码和 ok。只把 data 当作结果，不把 stdout 的出现当成功。
4. 登录由员工交互完成；不要索要、读取配置文件中的会话、复制凭据、把密码写入参数/环境/脚本/提示词。
5. 实际可用功能以 `commands`、`schema` 及各业务说明为准；W1—W10 已接相应固定业务入口，金蝶继续暂缓。不要猜测命令或用 HTTP/SQL/本机运维脚本补做缺少的功能。
6. RATE_LIMITED 时按提示等待，避免并行重试与循环轮询。其他错误按 code 处理；POST 的 outcomeUnknown 不表示未执行。

该说明约束使用方式，不能代替服务器权限控制。CLI 会话沿用员工原有权限，没有新增独立只读令牌。正式接入模型参与的业务写入时，继续按项目规则人工确认并由服务器执行和回读。

查询优先明确当前命令支持的 `--team`、`--customer` 和记录编号，核对结果 scope；不填 team 通常表示全部获授权范围。筛选支持范围按命令及资源确定，不能为不支持的入口添加参数。列表用 nextOffset 继续读取，不能把第一页或投影字段当成全部业务内容。`--mine` 尚未定义，不能使用。详情各子列表分别分页；字段裁剪、历史摘要及导出边界见 [业务部说明](sales.md)。导出须使用明确的新本地路径，不会覆盖已有文件；不要将业务文件放进公开仓库。

订单/原单使用 `--customer-code` 精确匹配 customer 原值；单据使用 `--customer` 档案ID和 `--order` 订单行ID。不要将记录编号、单据号、订单号、原单ID和客户ID混用。sourceChanged=true、未知价格、待核对原单或草稿状态须如实呈现；生产交接资料不代表生产已下达。详见 [订单及单据说明](orders.md)。

IE 报价不能用 `--team`，按服务器授权及可选客户ID读取，含工程成本；权限、状态、空值和零不得猜测。样品是项目内的样品记录，范围、状态与报价、生产许可各自独立。详见 [工程说明](engineering.md)。

批次4新增PMC核对轮次、采购、外协及工厂内部订单查询。采购余额未核对时已收数量为 null，不能当作0；未下发的内部订单不能说成已下发。PMC轮次按内制或成品外发范围读取，并非完整历史。详见 [PMC与采购说明](planning.md)。

批次5新增生产报工、成品外发、质检、包装、出货放行及客服发货查询。期初未核定的入仓和在途余额为 null，不能当成0；包装核对、入仓、出货放行和实际发货是不同事实。详见 [生产与交付说明](operations.md)。

批次6新增财务、对账和客诉查询。项目财务须明确 `--kind`，金额 `Cents` 字段使用币种最小单位；草稿、独立待核对、已确认、已收、已退款及冲销各自保留状态，不混同历史财务总账。详见 [财务说明](finance.md)。

## W1 客户资料与排程

对于已经明确的操作，使用 `sales customers create`、`sales customers master-update`、`sales customers followup-add`、`sales customers profile-update` 、`sales customers schedule-set` 、`sales projects create` 、`sales projects update` 、`sales projects trash`、`sales projects restore`、`sales inquiries create`、`sales inquiries update`、`sales projects item-add`、`sales projects item-update`、`sales projects round-update` 或 `sales projects communication-add` 或 `sales projects round-add` 或 `sales followups create`、`sales followups update`，以及 `sales projects task-create`、`task-update`、`task-submit`、`task-review`，按业务部说明准备 JSON 文件和操作 UUID，更新操作提供当前版本；CLI 不增加确认逻辑。不要更改未指定的资料字段，不用命令行传入账号密码或会话。出现 `outcomeUnknown` 或 `READBACK_FAILED` 时先查询原结果，不自行生成新 UUID 重复提交。仅同一操作、同一内容可使用原 UUID 复核重放；无权限或版本变化时停止并报告。


## W2与W3

报价、目录、交接、报价文件与历史价格按`sales.md`和`engineering.md`说明使用。订单指定字段修改、交接、原单、工厂内部订单、PI等单据及金蝶草稿按[订单说明](orders.md)使用；相同表单采用`save/action --type`参数复用。内部订单必须先核对服务器版本保护契约，读到旧服务器时停止写入并报告需更新网站。预览命令本身可能保存预览或原件，不能宣称完全只读。服务端已有核对字段和人员责任继续有效，不额外增加CLI确认提示。

12条 `sales kingdee` 命令保留在目录中，按当前范围暂缓调用；不得将命令可解析当作已上传或擅自修改开关。测试与示例使用合成资料，运行前核对配置的公司服务器；不要把账号密码、会话或业务原件提交公开仓库。


W4按[工程说明](engineering.md)使用统一schema/form/save/action及类型参数；样办执行、图纸版本、客户确认、SOP凭证与独立确认各按服务器原职责校验，事实登记不代表实际上传MES或实际发货。金蝶相关操作暂缓，后续单独安排，本批不调用其既有命令。

W5按[PMC与采购说明](planning.md)获取字段、关联和版本，使用指定字段更新。采购未核数为null，不能猜成0；计划/齐套记录、产能方案、采购净合格数和仓库库存各自独立。轮次、供应商报价与外协新增先核验服务器新契约，拒绝时报告需更新网站；客户端不会绕过旧服务器。CLI不读取或传递 `purchase-change-*` 的操作批准，模型业务提案仍须在已有受控入口完成人工审批。成品外发本批只接员工分类、任务发布及期初核定，供应商接单与进度/收发品质在W6。真实外发与部署不因CLI调用、提交或推送而发生。

W6按[生产与交付说明](operations.md)使用各类schema/form/references及精确版本。原表工序、累计损耗、采购核数、工序外协收货、质量/仓储凭据和成品入仓分别执行；不相互冒充。流程details默认增量合并，明确清除已知数值时才用--replace-details。MES预览保存原件和任务，申请/批准更正不改报工数量，必须新导出回读核验；CLI不实际操作MES。成品接单/复期/进度/发货/返工确认是供应商专属，员工CLI拒绝代行。任何请求重放均须保留原UUID与完整原载荷，撤权后不因旧成功记录而放行。

W7的OQC、包装/放行凭据、入仓、结单、生产出货来源、装箱单/运单/Invoice和发运登记是不同事实。按[交付说明](operations.md)准备原版本及依据；done/checked不推断承运商已收或客户签收。service shipments保存需原记录UUID/版本及关联订单当前版本，不能替换客户、猜数量或擅自重发；原件上传无UUID时先查询核查。引用业务成员从references取memberId，不把whoami登录身份当成员编号。


## W8财务固定程序

按[财务说明](finance.md)使用`finance project`、`finance ar`、`finance payment-terms`、`finance receivables`和`finance reconciliations`。先读schema/form/references再准备明确字段；沿用员工原权限，不从目录或管理员身份推断核款、指定业务授权或负责人审批资格。元文本、整数分、null及负数按各原接口保留，不自动换算。来源版本/哈希、记录版本和UUID重放必须使用原载荷。

AR总表精确选集preview只读；文件导入保存原件与批次，单据开立可能按原规则生成应收和付款计划。历史累计核对与当前到账分别记录，已发送事实/HTML下载不执行外发。AR导出逐范围执行，canExport不代表所有读取范围都可导出。写后回读失败先核查，禁止空成功响应替代业务结果。退款售后和权限配置使用各自独立入口，金蝶继续暂缓。

`finance ar` 的筛选按资源区分：`workspace` 支持客户、组、币种和期间；`documents` 仅客户和组；`invoices/imports/statements/files` 仅客户；`profiles` 支持客户和发票；`master` 支持客户和组，`references` 可另指定条目ID；`bindings` 不支持筛选。不支持的参数直接拒绝，不能据此猜测空结果或扩大范围。完整参数表见[财务说明](finance.md)。期间限定回款/出货业绩，不截断当前余额；`totals` 是所选范围汇总，不是当前页小计。


## W9 售后、投诉与回访

按[财务说明](finance.md)使用项目财务after-sale/cost/entry-refunds及refund-request/execute/cancel类型；投诉使用finance complaints的schema/form/references/revisions/save。复用原角色、客户/项目/订单/业务组、版本、来源和UUID，未知字段不猜填。退款execute只登记原生中台凭据，返回bankTransferPerformed:false，不执行银行转账。

处理完成、关口通过、客户确认文本已登记及客户接受各自核对，禁止自动推断。客户回访仅使用W1真实关联字段；投诉/售后/回访之间缺失的机器关联如实说明，原编号可留作文字证据，不添加虚构外键。金额精度、指定付款授权和导出边界继续生效，金蝶暂缓。


## W10固定程序调用

W10基础入口包括管理6、通讯9、工具15；0.40/0.41又补齐客服记录、协作、通用跟进和历史适配。当前总数以README和实际commands目录为准，不把旧阶段的中间验证状态作为当前结果。

先读取各组schema/references/form，准备明确完整字段、原版本或hash及同一UUID，不猜身份/金额/关联，不凭聊天推断业务批准。

`admin management schema/references/form/save/action/history`提供11种固定save及4种离岗动作。沿用管理员或原框架配置角色，完整表单携带真实version、完整来源hash和UUID；重放重核当前身份，保全未知字段、既有userId/邮箱/创建时间。业务成员新增是未绑定身份，不写认证账号表。AR读取grant、项目财务核实grant、付款授权名单、IE/客价/双签政策分别按原规则维护，不从目录可见推断核实权限。离岗由指定接收人本人确认，管理员完成时重核库存/来源hash，原子转交并停用，保留全部历史；不能代接收或自动接受。

`management communications schema/list/references/form/history/context/preview/save/action`按固定resource/type复用人工email/WhatsApp、统一沟通、通知、知识和通知邮箱。原客户、渠道、项目/订单与版本/来源/内容hash继续有效；手工稿、processed、本人接收、负责销售内部核对和发送各自独立。CLI写邮箱要求UUID，登录身份不改；知识22键只读全文，缺失保持缺失，没有导入/维护或Shell补齐入口。IE内部通知仅使用固定原生协议，服务器决定收件人/邮箱与原Excel附件；engineering与sales_approval正向检查使用本地合成传输，成品验证状态见执行记录。sending/unknown先查原历史，不自动重发；不宣称真实SMTP已验证。

`system workspace schema/list/form/references/history/save/action/inspect/preview/commit/workbook/ownership/report/template/file-download`覆盖原跟进待办、财务协作任务、普通/原版导入、精确owner绑定和固定工具。comment要求订单版本+UUID，task要求完整原hash/版本；财务任务save/submit/accept/return/review/cancel只做协作，不产生现金。owner按明确ID/版本与previewHash一次原子提交，不循环姓名/30行旧接口。普通导入每批200行、原版35行，绑定原件hash、原选择/原因/offset及计划行摘要；旧原版缺rowsHash/writeContract只回读和下载，不补造历史摘要去提交。报表生成归档hash/ID；旧报表未存摘要时明示为本次只读计算的当前原件hash。

固定工作簿和客户归属工具仅管理员；未知归属不猜测。文件/费用预览可能保存任务和原件，inspect及owner预览只读。费用保留原报价单位/null，不能套AR整数分；fixed-decision须显式填写原job/previewHash及approve/reject/defer，由原程序重核版本、范围、规则和有效期，不接聊天批准、不自动approve。没有任意HTTP/SQL/Shell或SMTP兜底。结果不明先查询原请求/批次，不换UUID盲重提。

保留AR导出范围、付款授权人当前角色及售后规则；业务成员新增不创建登录账号。框架执行关闭，模板/路径仅登记；知识没有维护API。账号密码、正式运行配置/调度/备份/部署及真实外发不因CLI安装自动授权。
## 客服独立记录与项目协作

`service records` 的必填 `--type` 只接受 `customer_profile|followup|project|sample`，分别是客服工作台的独立记录，不替代客户主档或客户项目。先查 `schema`、`references` 和 `form`，再用UTF-8 JSON文件执行 `save --version --request-id`；修改只指定需要更新的字段，保留其他原字段。关联订单必须显式提供 `--order-version`。文件入口只追加原件，下载要求新路径并核验摘要。

`system collaboration` 是独立项目协作任务，区别于W1客户任务。`schema/list/references/form/history/save/action` 复用现有项目任务API；`action --type` 只接受 `followup|complete|cancel|acknowledge`。负责人本人完成，管理人改派、取消或收阅；收阅不等于审批。更新须显式提供完整可编辑字段和非空reason，并使用真实版本与本次UUID。旧服务器没有写入契约时拒绝写入，结果不明先查询原任务及历史，不自动重试。

`system followups` 接入通用业务沟通及附件。先用 `schema` 和 `targets --module` 查询支持栏目及授权目标，再把服务器返回的 `module/collection/recordId/sectionKey` 四元组写入JSON。`list/show/files/file-download` 只查询该目标；`save --input --request-id [--files]` 的JSON额外提供note，只追加独立记录和原件，不改变原订单、审批或财务状态。单原件20MiB、最多10个、合计49MiB；下载校验摘要且不覆盖旧文件。项目目录/页签范围按原服务端校验；金蝶及采购源快照跟进暂缓。不存在改写、删除或真实外发入口。
