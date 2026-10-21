# Studio 只读记录查看器

`scripts/read-studio-history.py` 是服务器管理员使用的独立读取器，Python 3.10+，无需第三方依赖。它通过本机 Docker 的 PostgreSQL socket 读取 Studio 两库；每次 SQL 查询均使用 `BEGIN READ ONLY`、只读字段投影和 15 秒语句超时。平台 SQLite 使用 `mode=ro`、`query_only` 和读事务。不会启动应用运行时、初始化表、修改数据库、调度、配置或服务。

```bash
python3 scripts/read-studio-history.py \
  --container YOUR_POSTGRES_CONTAINER \
  --platform-db /YOUR_PLATFORM_DATA/workspace.sqlite \
  --access-log /YOUR_NGINX_LOG/access.log \
  --since 2026-10-21T00:00:00.000Z \
  --until 2026-10-22T00:00:00.000Z
```

数据库固定为项目 Studio 的 `doon_agent_studio` 与 `doon_agent_studio_observability`；只枚举 `agent_user_` 加 32 位十六进制哈希的隔离 schema，不扫描旧共享合成库。连接权限依赖服务器管理员的 Docker 权限，没有读取密码文件或把凭据放进命令。

## 覆盖与依据

| 记录 | 来源与限制 |
| --- | --- |
| 登录成功、失败、退出 | 平台 `auth_event`；Studio 共用账号，登录事件不能证明进入过 Studio，明确标记为“平台鉴权” |
| 访问 Studio、操作请求、拒绝与失败 | Nginx 现用及轮转访问日志；有时间、IP、方法、路径、HTTP 状态，没有真实账号，不按 IP 猜测人员；HTTP 成功不等于业务执行成功 |
| 创建 Agent、保存版本、当前状态 | `mastra_agents`、`mastra_agent_versions`；内置初始化与用户创建分开标记；发布状态只代表当前留存状态，不能还原每一次未留痕的发布或删除 |
| 会话及对话 | `mastra_threads`、`mastra_messages`；显示已持久化的用户文本及 Agent 文本回复，不是逐 token 流；不显示 reasoning、原始工具参数/结果或附件内容 |
| 工作流配置、提案、审核、调度与执行 | 项目工作流版本账本和工作流运行状态；只选状态、名称、版本、审核动作等元数据，不展开业务载荷 |
| Agent、模型、工具运行与失败 | 已持久化的 span 轨迹；显示开始/结束状态和对象，避免重复输出模型 token/chunk；不展示请求上下文、模型推理内容或原始业务输入输出 |

账号通过当前平台账号 ID 的 SHA-256 前 32 位对应 schema。配置、对话等显示的是存储归属；明确留有审核人时显示审核人。这不是对所有动作的独立实名审计。账号已删除时保留 schema 标识，不虚构姓名。

读取器返回 `events`、`signature`、`nextOffset`、`more`、`warnings`。`--page-size` 默认 50，最大 200，仅为每批传输数量，不是总条数上限。持续查看器每轮固定 `since/until`，读完所有页，按事件 ID 和内容签名防重复；下一轮重新扫描同一初始时间之后的记录，从而识别延迟写入和状态更新。分页期间数据变化可能使本轮位置移动，重复扫描会补齐仍留存的记录；这不构成审计完整性保证。来源异常必须明确显示，不能把部分来源失败解释为没有活动。

默认过滤成功的后台 GET 轮询与资源加载，保留入口访问、写请求和失败；`--all-requests` 显示全部 Studio HTTP 请求。`--username` 精确筛选归属账号，不能识别人员的代理日志不进入该结果。

服务器路径、实例及桌面启动脚本只保存在本机私有位置。查看器不自动保存业务日志、会话或查询结果。完整对话本身可能包含业务内容，只在授权环境查看，不提交公开仓库。已对常见意外明文令牌形式做遮盖，但不承诺任意自然语言内容都已脱敏。

合成验证：`python tests/studio-history.py`。这是运维只读工具，未改业务处理、Studio 鉴权或生产部署。
