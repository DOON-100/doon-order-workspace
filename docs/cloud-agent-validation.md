# 云端 Docker、PostgreSQL 与 Agent 基础验收

日期：2026-10-17。范围：现有阿里云 ECS 上新增独立合成验证环境。实现及复现说明见 [experiments/cloud-agent](../experiments/cloud-agent/README.md)。

## 结论

Docker、PostgreSQL 和 Mastra Agent 的基础执行链已在实际 ECS 上跑通；记忆、暂停快照、Traces 和 Metrics 能持久化，重新创建容器后可恢复。当前配置适合继续开展小规模功能验证，不代表完整业务上线或容量压测已通过。

中台保留原生运行方式、原 SQLite 和附件目录；新增的两个测试容器不挂载这些业务目录。没有修改原中台 UI、账号权限、nginx 路由或安全组。

## 环境与实际部署

| 项目 | 实测配置 |
| --- | --- |
| ECS | Ubuntu 24.04.5 LTS，x86_64，2 vCPU，4GiB 标称内存 |
| Docker Engine / Compose | 29.9.1 / 5.6.0，Docker 官方 apt 源安装 |
| PostgreSQL | 16.15，独立容器与命名持久卷；宿主机不开放 5432 |
| Node | 容器内 v24.22.0 |
| Mastra | core 1.77.0，pg 1.31.2，memory 1.21.1，observability 1.20.1 |
| 存储 | `PostgresStoreVNext`；记忆/工作流与观测数据分两个测试数据库，连接池各最多 3 条 |
| Agent API | 宿主机 `127.0.0.1:8798`；健康检查以外要求独立 Bearer 凭据 |
| 运行身份 | Agent 非 root、只读文件系统、无附加 capabilities；不挂载 Docker socket |
| 资源限制 | Agent 640MiB / 0.75 核；PostgreSQL 512MiB / 0.5 核；日志分别限制 3×10MiB |

服务器直连 Docker Hub 超时，实际从 ECR Public 的 `docker/library` 拉取 Node 和 PostgreSQL 镜像，并按摘要固定。未配置第三方镜像加速器。依赖版本和基础镜像摘要保存在构建文件中。

本轮通过阿里云官方 `aliyun` CLI 的 ECS 云助手执行。Workbench CLI 本机 daemon 通信被拒绝，未通过重启 daemon 或其他服务绕过。未创建额外云实例、托管数据库或公网入口。

## 已通过的验证

| 验证 | 结果与证据摘要 |
| --- | --- |
| 镜像构建、容器启动 | Agent 与 PostgreSQL 均为 healthy |
| API 鉴权 | 无凭据返回 401；带浏览器 Origin 的调用返回 403；正确服务凭据可执行 |
| Agent 工具与委派 | 总管读取固定欠料场景，委派采购 Agent，采购执行工具生成草稿；始终 `sent:false` |
| 记忆写入 | 独立合成 thread 保存 2 条消息 |
| 工作流暂停 | 合成审批步骤进入 suspended，快照保存到 PostgreSQL |
| Metrics 存储与查询 | 首轮 35 条记录，完成恢复验证后 39 条；指标列表及 count 聚合均可查询 |
| Traces | 首轮 3 条，恢复验证后 4 条根轨迹 |
| 容器重建 | PostgreSQL 与 Agent 均执行 force-recreate，保留原命名卷；旧 thread 的 2 条消息和原 suspended 快照仍可读 |
| standby | 从重建前的暂停快照恢复，仍保持 suspended |
| approve | 同一工作流随后成功完成，结果为 approve，未执行发送 |
| reject | 另一合成工作流完成，结果为 reject，未执行发送 |
| 数据库角色 | Agent 登录角色不是 superuser，没有创建数据库或角色权限 |
| 暴露与挂载 | 8798 仅 loopback；5432 未发布；Agent 仅挂载测试密钥，PostgreSQL 仅挂载自身测试卷、初始化脚本及密钥 |
| 中台可用性 | 原进程未变化，NRestarts=0；通过原 HTTPS 网关访问 `/api/auth/session` 返回 200，TLS 校验通过 |

指标包含 Agent、模型、工具、processor 和 workflow 耗时，以及模型 token 用量。它们来自合成脚本模型，不能用于估算真实模型延迟、质量或费用。Metrics 存储可用不等于原本的本地 Studio 已连接此库；本轮没有开放云端 Studio 页面。

## 数据保全与资源观察

安装前通过 SQLite 在线备份保存一致性快照，另保存原代码归档和附件备份；校验只输出摘要及哈希，没有公开业务内容或凭据。

- 原业务记录 4,220 条：最终缺失 0、内容变化 0、新增 0。
- 原账号 36 个：最终缺失或内容变化 0。
- 原附件 99 个：最终缺失或哈希变化 0。
- 原 SQLite 完整性检查：`ok`。
- 初始快照 SHA-256：`329a58734210b26ad992eb718623d9fe509562457ec8c9d7d014187b529b547e`。
- 原代码归档 SHA-256：`64762ab3a39f4eb7512cecc756366fa3b61ce93b0026b942364b2e8108ab9f42`。

重建测试容器前，对两个合成 PostgreSQL 数据库分别使用 `pg_dump -Fc` 备份，保存在服务器受限目录；没有用旧数据库覆盖任何现库。本轮尚未执行 PostgreSQL 备份的完整还原演练。

完成恢复测试时的一次观测：Agent 约 152.5MiB，PostgreSQL 约 37.77MiB，主机 MemAvailable 约 2.61GiB。这是低负载瞬时值，容器用量也不包含 Docker daemon 和所有主机开销；尚未验证长时间并发、真实模型调用或峰值容量。

## 本轮交付与后续边界

运行形态已落地为：中台原生服务＋业务 SQLite，旁边新增 Agent Docker＋PostgreSQL Docker。测试容器保持运行，重启策略为 `unless-stopped`；没有与正式订单建立数据通路。PostgreSQL 卷独立于容器生命周期，仍位于同一 ECS 磁盘，不构成异地备份。

本轮源码在测试分支维护。构建只传入合成运行程序与依赖清单；凭据在服务器生成，不进入镜像或 Git。长期应改为 CI 构建和私有镜像仓库发布，服务器按摘要拉取；本轮未建立自动发布流水线。

后续尚需实施：真实模型接入与预算、按任务/人员授权的中台内部 API、持久化请求与审批决定、Outbox/幂等恢复、企微提醒与按钮、Studio 云端访问控制、定时任务、7 天轨迹清理、业务与审计数据的分类保留、自动备份与还原演练、监控告警和容量测试。这些不应从本轮基础验收中推断为已经完成。

官方机制参考：[Docker Ubuntu 安装](https://docs.docker.com/engine/install/ubuntu/)、[PostgreSQL 官方镜像与初始化](https://hub.docker.com/_/postgres)、[Mastra PostgreSQL](https://mastra.ai/integrations/databases/postgresql)、[Mastra Metrics](https://mastra.ai/docs/observability/metrics/overview)。上述机制须以本轮固定版本实测结果为准。
