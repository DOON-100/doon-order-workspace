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
