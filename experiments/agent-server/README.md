# 云端 Agent Studio 容器

将本地已验证的 Studio、四个合成 Agent 和 DeepSeek 余额/错误说明部署为单独容器；中台继续原生运行，既有代码、账号和业务库不切换到测试分支。第一阶段只提供合成工具与语言辅助验证，不写订单、不发送企微，不开放 Shell 或业务数据库文件。

## 运行关系

```text
浏览器 → 原 HTTPS nginx
          ├─ 原中台 /api/*、原业务页面 → 原生 8787
          └─ /studio/* → loopback 8799 → Agent Docker
                        ├─ 每次请求回查中台 /api/auth/session
                        ├─ Studio / Agent / DeepSeek
                        └─ 独立 PostgreSQL 记忆库与观测库
```

现有 PostgreSQL 容器与命名卷保留，新增 `doon_agent_studio` 和 `doon_agent_studio_observability`，由单独的 `doon_studio` 非超级用户持有。旧验证数据库不覆盖、不迁移；本地 Studio 的 LibSQL 数据也不拷贝到服务器。新库通过 `PostgresStoreVNext` 支持记忆、工作流快照、Traces 与 Metrics，两个连接池各最多 3 条连接。

Agent 复用 `doon-agent-validation_default` Docker bridge 网络连接 PostgreSQL。`extra_hosts` 将 `host.docker.internal` 指向宿主机，只用于 HTTPS 回查原有会话；证书仍按原公开 Origin 的域名/IP 校验，保持可信 CA 校验。不启用 host 网络、不发布 PostgreSQL 端口，不挂载业务 SQLite、附件或 Docker socket。

## 登录和权限

所有 `/studio/*` 请求，包括 API、静态资源、余额、模型生成和工作流，都由容器外层统一校验；只接受现有中台返回的已完成改密的 `admin` / `programmer`。原中台负责判断账号是否启用、会话是否到期和当前角色，容器不缓存授权，不读取账号库。退出、停用或角色变化会影响下一次请求。

浏览器 Cookie 仅经内部 HTTPS 回送原中台的会话查询接口，原 API 令牌不会传给 Mastra、工具或模型，也不会记录到日志。客户端自称的角色、Authorization 和身份头不授予权限。认证服务不可用时关闭访问，返回 503；非 GET/HEAD 操作要求原公开 Origin。会话失效的 Studio 首页回到中台登录，其余受保护路径返回 401。登录后可再次点击公司图标进入。

中台 HTML 由 nginx 的 `sub_filter` 加入同源的 `entry.js`；该脚本只在已登录且角色允许时，将现有公司图片包成“打开 Agent Studio”的链接，不改变图案、尺寸或业务页面。实际权限始终由服务器校验。撤掉对应 nginx 片段即可撤回此入口，不需要重建或重启原中台。依赖现有 `.brand-logo` 容器，原 UI 改版时需重新核对。入口脚本无密钥，可公开获取，不能据此进入 Studio。

此入口是技术人员共用的合成调试环境，不是员工业务工作台；当前不提供正式的用户/任务级 memory 隔离、业务审批授权或企微交互。

## 构建与配置

从 `experiments/` 构建；Dockerfile 专用白名单排除测试脚本、数据库、凭据和私有配置。

```sh
docker build -f agent-server/Dockerfile -t doon-agent-studio:<version> .
```

部署目录放 `compose.yaml`、`.env` 与 `secrets/`。父目录和 secrets 目录由 root 以 0700 保护；密钥文件须允许容器中的非 root 用户读取。配置含：

```text
AGENT_VERSION=<version>
PUBLIC_ORIGIN=https://<existing-platform-host>
```

`secrets/deepseek_api_key` 为 DeepSeek Key，`secrets/pg_studio_password` 为独立数据库用户密码；均不进入镜像、源码、CLI 参数或日志。Compose 会以文件挂载，真实模型为 `deepseek-flash`。余额与错误说明沿用 [Studio 接入说明](../mastra-studio/README.md)。

Studio 启动时将挂载文件中的 DeepSeek Key 读入服务端进程内的标准 `DEEPSEEK_API_KEY` 变量，使官方 Provider 发现接口及模型选择器能识别文件配置。Docker 配置仍只指定文件路径，浏览器只收到 `connected` 布尔状态，不返回密钥。该状态表示已配置；实际认证或余额错误仍由调用结果与侧栏状态说明。替换密钥文件后重建 Agent 容器以同步此启动配置。

Agent 内存限制 768MiB、CPU 0.75 核，非 root、只读根目录、64MiB 临时目录、无额外 capabilities；日志限制 3×10MiB。仅向宿主机 `127.0.0.1:8799` 发布，公网仍只使用原 HTTPS 入口。模型生成端点默认最多 2 个并发，请求正文最多 512KiB。健康检查表示进程完成初始化并能响应，不替代数据库监控、真实用户登录验收或模型可用性监控。

检查新库初始化与备份后启动：

```sh
docker compose config --quiet
docker compose up -d --wait
```

将 `nginx.locations.conf` 合并到原 HTTPS server，将 `nginx.root.conf` 中的指令加入原 HTML location；保留 `/api/`、证书、安全头、日志和现有 upstream 规则。先保存原 nginx 配置并核对它没有被其他操作更新，验证 `nginx -t` 通过后平滑 reload。

## 发布与回退

发布前保存原代码、SQLite 在线快照、附件哈希、nginx 原配置，以及现有 PostgreSQL 逻辑备份。后续发布 Agent 只更换镜像版本并重建 Agent 容器；不切换正式服务分支，不重置任何卷，不使用 `down -v`。

回退只恢复原 nginx 配置和旧 Agent 镜像；保留 PostgreSQL 库、卷及运行期间新增的数据。不得用旧备份覆盖现库。数据库恢复和跨版本快照迁移另行核对与授权。长期应在 CI 构建并从私有镜像仓库拉取；本次服务器临时构建目录在代码推送后清理，保留运行配置、密钥、镜像和数据。

测试：`node --test experiments/agent-server/server.test.mjs`，并运行原 Studio 集成测试。网关测试只用合成身份，覆盖逐次鉴权、角色、首次改密、撤销、认证服务故障、同源校验、Cookie 不下传、并发和大小限制。不得创建生产测试账号、读取员工密码或伪造正式会话完成验收。实测记录见 [云端 Studio 部署记录](../../docs/cloud-agent-studio-deployment.md)。

参考：[Docker bridge / host-gateway](https://docs.docker.com/reference/cli/docker/container/run/#add-host)、[nginx sub_filter](https://nginx.org/en/docs/http/ngx_http_sub_module.html)、[Mastra Studio 自托管](https://mastra.ai/docs/studio/deployment)。
