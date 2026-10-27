# Codex / WorkBuddy 调用说明

员工先在自己的 Windows 终端安装并运行 `doon login`，随后重新打开工具，使其获得用户 PATH。工具使用同一个 `doon` 命令；是否能执行系统命令仍取决于各工具实际版本和授权，需在员工电脑验收。

1. 运行 `doon commands --json` 读取实际命令，按具体命令 `--help` 核对参数。`modules` 中的 pending 栏目尚不能执行。
2. 用 `doon whoami --json` 核对身份。AUTH_REQUIRED 时让员工本人回到终端登录；mustChange=true 时让员工在网页修改初始密码。
3. 机器调用统一加 `--json`，检查进程退出码和 ok。只把 data 当作结果，不把 stdout 的出现当成功。
4. 登录由员工交互完成；不要索要、读取配置文件中的会话、复制凭据、把密码写入参数/环境/脚本/提示词。
5. 已支持业务组、客户、项目、询价、报价、订单、销售原单、PI、客服单据、生产交接、工程、样品、PMC、采购和外协查询，以及报价总表和单张销售原单导出。已支持客户资料字段更新、跟进排程、创建客户项目和询价记录、追加项目款色、轮次、沟通、待办与客户跟进；其他业务写入、采购修改或审批尚未开放。不要猜测命令或用 HTTP/SQL/本机运维脚本补做缺少的功能。
6. RATE_LIMITED 时按提示等待，避免并行重试与循环轮询。其他错误按 code 处理；POST 的 outcomeUnknown 不表示未执行。

该说明约束使用方式，不能代替服务器权限控制。首版 CLI 会话沿用员工原有权限，没有新增独立只读令牌。正式接入模型参与的业务写入时，继续按项目规则人工确认并由服务器执行和回读。

查询优先明确 `--team`、`--customer` 和记录编号，核对结果 scope；不填 team 表示全部获授权范围。列表用 nextOffset 继续读取，不能把第一页或投影字段当成全部业务内容。`--mine` 尚未定义，不能使用。详情各子列表分别分页；字段裁剪、历史摘要及导出边界见 [业务部说明](sales.md)。导出须使用明确的新本地路径，不会覆盖已有文件；不要将业务文件放进公开仓库。

订单/原单使用 `--customer-code` 精确匹配 customer 原值；单据使用 `--customer` 档案ID和 `--order` 订单行ID。不要将记录编号、单据号、订单号、原单ID和客户ID混用。sourceChanged=true、未知价格、待核对原单或草稿状态须如实呈现；生产交接资料不代表生产已下达。详见 [订单及单据说明](orders.md)。

IE 报价不能用 `--team`，按服务器授权及可选客户ID读取，含工程成本；权限、状态、空值和零不得猜测。样品是项目内的样品记录，范围、状态与报价、生产许可各自独立。详见 [工程说明](engineering.md)。

批次4新增PMC核对轮次、采购、外协及工厂内部订单查询。采购余额未核对时已收数量为 null，不能当作0；未下发的内部订单不能说成已下发。PMC轮次按内制或成品外发范围读取，并非完整历史。详见 [PMC与采购说明](planning.md)。

批次5新增生产报工、成品外发、质检、包装、出货放行及客服发货查询。期初未核定的入仓和在途余额为 null，不能当成0；包装核对、入仓、出货放行和实际发货是不同事实。详见 [生产与交付说明](operations.md)。

批次6新增财务、对账和客诉查询。项目财务须明确 `--kind`，金额 `Cents` 字段使用币种最小单位；草稿、独立待核对、已确认、已收、已退款及冲销各自保留状态，不混同历史财务总账。详见 [财务说明](finance.md)。

## W1 客户资料与排程

对于已经明确的操作，使用 `sales customers profile-update` 、`sales customers schedule-set` 、`sales projects create` 、`sales projects update` 、`sales inquiries create`、`sales inquiries update`、`sales projects item-add` 或 `sales projects communication-add` 或 `sales projects round-add` 或 `sales followups create`、`sales followups update`，以及 `sales projects task-create`、`task-submit`、`task-review`，按业务部说明准备 JSON 文件和操作 UUID，更新操作提供当前版本；CLI 不增加确认逻辑。不要更改未指定的资料字段，不用命令行传入账号密码或会话。出现 `outcomeUnknown` 或 `READBACK_FAILED` 时先查询原结果，不自行生成新 UUID 重复提交。仅同一操作、同一内容可使用原 UUID 复核重放；无权限或版本变化时停止并报告。
