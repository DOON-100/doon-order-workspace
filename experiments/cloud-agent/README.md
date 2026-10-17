# 云端 Agent 基础验证

独立的合成测试程序，用来验证 ECS 上 Docker、PostgreSQL 和 Mastra 的组合。它不读取业务中台、不接入正式账号、不发送企业微信，也不使用真实模型密钥。模型使用 AI SDK 协议的固定脚本，验证框架执行链，不能据此判断模型的理解和决策能力。

## 结构与边界

- `agent`：非 root、只读文件系统，运行总管和采购两个 Agent，通过工具委派；单次请求串行执行。
- `postgres`：PostgreSQL 16，独立持久卷；`doon_agent_validation` 保存记忆与工作流，`doon_agent_observability` 保存 Traces 和 Metrics。两库共用一个测试实例，不能视为生产资源隔离。
- 使用固定的 `@mastra/core@1.77.0`、`@mastra/pg@1.31.2` 和 `PostgresStoreVNext`；两个数据库连接池分别最多 3 条连接。
- Agent API 发布到宿主机 `127.0.0.1:8798`，PostgreSQL 不发布宿主机端口；不增加 nginx 路由或公网规则。
- `/health` 只报告存活状态。其余 API 要求 `Authorization: Bearer`，拒绝浏览器 Origin。这是独立测试服务凭据，尚未接入中台用户/任务授权。
- Agent 内存上限 640MiB、CPU 上限 0.75 核；PostgreSQL 为 512MiB、0.5 核；两者日志各限制为 3×10MiB。限制不等于实际占用，也不代表负载验收。
- 唯一订单为 `SYN-CLOUD-001`；动作均返回 `sent:false`。

## 构建与运行

在 `experiments/` 目录构建，Dockerfile 自带上下文白名单，不包含本机依赖、数据库或凭据：

```sh
docker build -f cloud-agent/Dockerfile -t doon-agent-validation:p1 .
```

部署目录只放 `compose.yaml`、`init-db.sh`、可选的 `.env` 和 `secrets/`。宿主机以 root 保护部署目录和 `secrets/`（0700）；用安全随机源分别生成三个至少 32 字节随机值，保存为 `pg_admin_password`、`pg_agent_password`、`api_token`。文件需要容器内相应用户可读，父目录须限制宿主机其他用户访问。不得把真实值写入源码、CLI 参数或日志。`secrets/` 和 `.env` 已忽略。

```sh
docker compose config --quiet
docker compose up -d --wait
docker compose exec -T agent node verify.mjs before > before.json
```

`before.json` 仅有合成 ID、计数与指标名。验证程序检查鉴权拒绝、Agent 调用、记忆、暂停快照和 Metrics 查询。

为了验证更换容器后的持久化，只对该独立测试项目重建容器，保留原卷：

```sh
docker compose up -d --force-recreate --wait
docker compose exec -T agent node verify.mjs after < before.json
```

第二阶段检查重建前的消息和暂停状态，再验证 standby 后仍暂停、approve 后完成、reject 被工作流接收。这里验证的是 SDK 恢复能力；正式请求/决定记录、审批人权限、并发幂等、Outbox 和企微交互仍须按架构规划实现。

禁止使用 `down -v`、清空卷或把业务库挂入此环境。更换镜像仅重建 Agent 时，可使用 `docker compose up -d --no-deps agent`；新版本与旧工作流快照的兼容性需要另行验收。

## 当前不涵盖

真实模型、正式业务内部 API、Studio 云端网页入口、企微提醒与审批按钮、多用户权限、定时调度、7 天轨迹清理、PostgreSQL 定期备份恢复和长时间并发压测。容器卷能跨容器重建保存数据，不能代替异地备份。

初次验证允许在服务器临时构建；长期应在 CI 构建镜像并推送私有镜像仓库，服务器只保留运行配置、密钥、持久化数据和需保留的镜像。不要把生产数据或私有配置提交到公开 GitHub。

实测结果见 [云端验收记录](../../docs/cloud-agent-validation.md)。配置依据：[Docker Ubuntu 安装](https://docs.docker.com/engine/install/ubuntu/)、[PostgreSQL 官方镜像](https://hub.docker.com/_/postgres)、[Mastra PostgreSQL](https://mastra.ai/integrations/databases/postgresql)。
