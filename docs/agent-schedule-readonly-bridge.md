# Agent 日历调度只读接口

原生中台提供可选 `/api/agent-schedules/*` 接口，为独立 Agent 服务提供按本人明确授权、可撤销的定时读取。此模块为固定程序，不包含模型、聊天或 Studio 页面；Agent 实现继续在 `codex/mastra-local-validation` 分支独立发布。

默认关闭。部署时通过 `DOON_STUDIO_SCHEDULES_ENABLED=1` 和私有密钥文件路径 `DOON_STUDIO_SCHEDULES_KEY_FILE` 显式启用。Agent 挂载同一独立随机密钥，普通会话 Cookie 只用于本人启用、暂停及查看状态，不持久保存为后台凭据。密钥不得写入仓库、命令行、URL 或日志。

授权绑定账号、配置人、工作流发布版本、模块、数据对象、范围、条件、日历时间和最长 30 天有效期。每次读取由原 workspace GET 处理器检查当前账号及业务权限，账号停用、强制改密、撤权、授权到期、暂停或替换后拒绝执行。接口只接受注册模块，禁止指定任意地址、SQL、Shell 或业务写入。每日批次使用北京时间；超过 100 条匹配或 2 MiB 时整批拒绝，不截断。后台租约通过原子 SQL 与递增编号实现单一消费者，过期或失去续约即拒绝新读取。

启用时仅新增 `studio_schedule_grants` 追加授权表、对应索引与 `studio_schedule_lease` 租约表，不改业务记录、工作区版本、账号或附件，也不要求启用业务事件采集。关闭时不初始化这些表。Agent 通过 HTTPS 调用此接口，不挂载中台数据库和附件。

`standalone/schedule-engine/` 为无模型依赖的条件、日历和权限投影函数，其初始实现与 Agent 分支 `c9fd14a` 对齐。原生构建将它们打包进 `agent-schedules.mjs`；服务端只新增该文件和 `server.mjs` 的接口挂接。部署前保存代码回退点、SQLite 在线快照、附件哈希和 Agent PostgreSQL 逻辑备份，验证恢复后更新。回退只恢复代码及配置，保留运行期间的新记录，禁止用旧库覆盖现库。

检查：`node tests/run.mjs`、`node node_modules/typescript/bin/tsc --noEmit`，设置独立 `DOON_BUILD_DIR` 后运行 `node standalone/build.mjs`、`node standalone/test.mjs`、`node --test standalone/agent-schedules.test.mjs`。HTTP 测试使用临时合成库与 19914 端口，覆盖原会话授权、服务身份、退出及重启后保留、账号停用即时拒绝、原订单哈希不变和无需事件采集。Git 提交不等于部署，现有任务仍需本人核对并启用。
