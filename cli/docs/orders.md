# 批次 2：订单、PI 与客服制单查询

版本 0.3.0。本批新增16个命令，总计38个（7个基础命令、31个业务查询/导出）。不需要 MCP，Codex/WorkBuddy 使用相同命令和 JSON 约定。业务写入、生成、提交、审批、发送、生产下达及金蝶上传尚未开放。

| 命令组 | 动作 | 复用接口及含义 |
| --- | --- | --- |
| sales orders | list / show | data：当前员工获授权的原有订单明细；一个 ID 是一行，不是按订单号合并的整单 |
| sales sources | list / show / export | sales-order-sources-data / sales-order-sources-export：销售原单证据，不自动建立生产订单 |
| service pi | list / show / history / version | handoff-business-data / handoff-business-history：仅 PI 类业务单据 |
| service documents | list / show / history / version | 同上：PI、invoice、packing、waybill、paymentrequest |
| service production-orders | list / show / history | 同上：production_order 类型的生产交接资料；不等于正式生产下达或投产许可 |

```powershell
doon sales orders list --team TEAM_ID --customer-code C001 --limit 20 --json
doon sales orders show ORDER_LINE_ID --json
doon sales sources show SOURCE_ID --json
doon sales sources export SOURCE_ID --team TEAM_ID --output C:\Private\source-new.xlsx --json
doon service pi list --customer CUSTOMER_ID --order ORDER_LINE_ID --json
doon service pi version PI_ID 1 --team TEAM_ID --json
doon service documents list --type invoice --json
doon service production-orders show HANDOFF_ID --json
```

替换示例中的 ID 和客户原值。所有命令支持 team；查询支持 limit（默认20，1–100）、offset（默认0，至1000000），list 额外支持 search。分页与搜索在客户端执行，服务器仍按现有接口读取；输出限额与批次1一致。

订单及销售原单没有可靠的 customerId 字段，使用 `--customer-code` 精确匹配返回记录的 customer 原值（可能是编码或名称，区分大小写，最长160字符），不按名称猜测客户档案关联。客服单据使用 `--customer` 精确档案ID和 `--order` 精确订单明细ID；documents 额外支持 type。客户责任权限与全订单查询权限不同：能看订单不代表能看含价格的原单或 PI。

订单详情只展示固定字段、同一行的跟进及附件目录，不返回原台账列、原始审计快照或存储键。旧接口审计列表会截断，因此订单 history 暂缓，不能把最后250条全局审计当作完整订单历史。

原单详情保留逐行数量、未知值、原始单价文字、颜色候选、来源单元格和告警，省略原公式。原单导出复用已有纯读取 XLSX 接口，导出单张原单的完整授权内容，与详情字段投影不同；不覆盖已有本地文件。不能把待核对原单当成已确认订单。

单据详情保留 draft/pending_check/checked 状态、sourceChanged/changedSourceIds 和原订单行引用；“已核对”不表示已审批、发送、收款或投产。字段投影省略本地路径、快递账号及原始来源快照。历史先核对当前记录处于所选组/客户/订单，再由服务器鉴权读取，核验每版的客户、项目、订单、类型与版本绑定；缺失或冲突时报错。历史版的来源变化标记按服务器当前来源计算，不是历史时点的许可证明。

订单和单据要求服务器回显所选业务组范围。销售原单沿用其独立的 Vary: X-Workspace-Team 合约和服务端授权/组筛选；缺少该声明时报错。该接口没有范围回显，Vary 只能验证所需接口合约，不能证明任意修改过的服务器正确实现筛选；升级服务器时须保留范围集成验收。

## 下载包逐条验收与测试回退

本机使用下载成品包，在新的隔离安装目录安装，不修改用户 PATH 或既有 CLI 配置。包内每个文件必须与同提交本地独立构建清单一致；再使用成品包自己的 Node 和程序，对临时本机服务器、合成账号/数据运行全部38个已支持命令。

登录命令复用预先建立的合成会话；密码提示的交互和拒绝注入由基础测试覆盖。业务查询前后逐值核对业务记录、修订号和附件原字节，登出验证会话撤销。登录/登出本身会写合成鉴权日志。测试结束停止临时服务器并移除测试数据库、导出文件、会话及隔离安装目录，保留无业务内容的验收摘要和下载包。正式服务器不参与测试，CLI 功能代码保留。

维护者可运行 `node cli/scripts/test-windows-package.mjs --archive <下载包.zip> --reference-manifest <独立本地构建release.json> --expected-commit <完整提交号> --report <摘要路径>`。需要根目录依赖和 CLI 构建已准备，参考清单必须来自同提交的干净本地构建；校验失败不得执行包。


## W3：订单、原单与单据写入

CLI 0.32.0复用现有网站接口，不增加确认提示。先用对应`schema`查看字段，用`form`读取当前版本，再将指定字段写入UTF-8 JSON；权限、既有业务核对、来源和生产门禁仍由服务器决定。下列示例中的编号和UUID须替换为真实本次操作值。结果不明时先查询，不自动重试；只有内容与版本完全相同的原请求才可复用原UUID。

```powershell
doon sales orders schema --type order --json
doon sales orders form <lineId> --json
doon sales orders update --input order.json --version 3 --json
doon sales orders workflow --type submit-service --input handoff.json --version 4 --json
doon purchasing factory-orders form <lineId> --json
doon purchasing factory-orders save --type draft --input factory.json --version 2 --order-version 5 --request-id <uuid> --json
```

订单修改文件为`{"id":"<lineId>","patch":{"notes":"待核实资料"}}`，只改指定字段。允许字段按网站原角色规则校验；服务端允许旧版本的不冲突字段合并，冲突时拒绝，不提供强制覆盖。交接共用`workflow --type submit-service|return-business|submit-pmc|accept-pmc`，文件包含`id`及可选`note`，退回须原因；排期`save-pmc`按W5继续。

内部订单文件包含`lineId`和本次指定的`sourceEnglish/chineseProcess/materialSpec/platingSpec/lensSpec/materialImageConfirmed`字段，其余从明确指定的历史版本保留。`save --type draft|service-confirm|pmc-confirm|release`共用一条命令；内部订单版本首次0，源订单版本须当前正整数，二者均由服务端核对。下发仍须既有PMC权限、前置状态和生产门禁。修改新增历史版本，原件、原记录与旧版不覆盖。服务器须支持`factory-order-version-token-v1`；旧服务器在发送写入前明确拒绝，网站和CLI须配套更新。

`purchasing factory-orders export --order <lineId> --output original.xlsx`导出指定订单行的中英表格（一次一行，保留隐藏的原订单/内部订单版本；不代表下发）。中英内部订单XLSX使用`table-preview --input context.json --file original.xlsx`，10MiB上限；上下文为`customer/orderNo/customerPO/reference`可选字段。预览会保存本人预览记录，但不会创建或更新订单。检查预览后以`table-commit --input {"id":"<previewId>"}`提交同一预览；没有交互确认提示。服务端原子复核源订单和内部订单版本，CLI回读创建的明细和历史版本；重复提交同一预览不会重复建单。原订单数量及身份不能借此入口覆盖。

`doon sales sources schema/import --input source.json --request-id <uuid>`只供管理员迁入完整结构化原单证据（8MiB），保留来源、原始文字、颜色候选及数量，不创建生产需求，不覆盖同号的不同原单。

### 共用内部资料与PI单据表单

```powershell
doon service documents schema --kind source --type po --json
doon service documents references --customer <customerId> --json
doon service documents save --kind source --type po --input po.json --version 0 --request-id <uuid> --json
doon service documents generate --type pi --input basis.json --version 2 --request-id <uuid> --json
doon service documents action --type submit --input action.json --version 1 --request-id <uuid> --json
```

`save`按`--kind source|document`与`--type`复用。W3资料类型为`po/engineering_drawing/engineering_quote/production_order`，单据为`pi/invoice/packing/paymentrequest/waybill`。新建包含`customerId/number/fields/lines/sourceRefs`，项目和原订单按对应业务要求显式关联；修改提供`id`和当前版本。顶层字段增量保存，`fields`按键合并，`lines/sourceRefs/originRefs`一旦指定即完整替换。服务器校验精确关联、金额、来源版本、人员及不可移除的原始依据。显式`form`用于编辑，包含当前有权查看的业务字段；概要查询的脱敏投影不变，存储键和原始来源快照不输出。

`generate`文件含`sourceId/number`及按单据需要的PI关联，`--version`是来源版本；`action --type submit|return|confirm`文件含`id/note`，`--version`是单据版本。PI从客户PO生成，内容核对只限原服务器指定负责人，管理员身份不能代替负责人核对。物流单据还依赖生产出货资料，财务请款还依赖真实应收和已入账记录；对应来源的维护分别按W7/W8继续，不靠填参数绕过前提。“已核对”不等于发送、收款或投产。

`files <id>`查询原件目录；`file-upload --input attachment.json --file original.pdf --version <number> --request-id <uuid>`文件资料含`id/note`，10MiB上限。`file-download <id> <fileId> --output <newFile>`回读核对大小及SHA-256，不覆盖本地已有文件。上传会递增资料版本，原件不可变；旧PI会显示其依据已变化。

### 金蝶销售草稿与中英原单

`doon sales kingdee schema/status/list/form`分别查询表单、连接就绪状态、草稿目录及完整授权输入。`prepare --input {"sourceId":"..."}`复用已有原单生成草稿；`save --input {"id":"...","inputs":{"remark":"..."}} --version <number>`合并指定输入字段，`lines`完整替换，须保留全部原单明细标识。草稿输入最多2MiB。

原单使用`source-template --output template.xlsx`下载模板，`source-preview --file original.xlsx`上传不超过8MiB的中英原单并保存原件及解析预览。`source-commit --input {"id":"<previewId>","acknowledged":true}`复用网站既有原文核对字段，提交本人预览并创建原单及草稿，不覆盖同号资料。`source-download <sourceId> --output original.xlsx`核验SHA-256并下载不可变原件。

`action --type validate|confirm|upload|reconcile --input action.json --version <number>`复用既有动作；确认文件另含网站原有的`acknowledged:true`，不是CLI额外确认层。校验也会更新草稿版本；已配置金蝶连接时可能查询远端基础资料。`export <draftId> --version <number> --output new.xlsx`只导出已通过全单校验和当前客服确认的模板。

当前服务端尚未核定“现销／赊销”的金蝶直接上传字段映射，真实上传保持受限；CLI没有绕过开关或协议缺口。上传/核查命令不是上线承诺，必须先查看`status`，结果不明使用原操作核查，不能换UUID或重复上传。W3验收在无金蝶凭据的本地合成服务中完成，未访问正式服务器或真实ERP。

W3未增加普通订单跟进待办、普通订单附件及跨栏目维护入口；这些共用操作在W10补齐。图号更正及冻结按W4，排期按W5，出货与财务依据按W7/W8，不把当前命令数称为全站CRUD完成。
