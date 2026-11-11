# Chatwoot 独立试运行与中台入口

本阶段复用 Chatwoot 原生界面。入口位于中台「邮箱」页面顶部，名称为「进入 Chatwoot」，在新标签页打开；不增加导航栏菜单。员工沿用当前中台登录身份，不注册第二套账号、不输入 Chatwoot 密码。

## 代码与部署边界

- 本机下载官方源码及固定版本社区版镜像，在本机编辑和检查后再上传服务器。
- `integrations/chatwoot/compose.yaml` 管理独立项目。应用、后台任务、pgvector、Redis、身份网关分开运行；数据库及附件使用独立持久目录。
- 运行配置、密钥、业务内容、数据库、附件、备份与实际服务器信息均保存在私有位置，不进入公开仓库。
- 参考目录布局为：`src/`、`deploy/`、`config/`、`data/`、`releases/`、`logs/`、`backups/`、`reports/`。Compose 文件和网关放入 `deploy/`，私有配置及持久数据分别位于相邻的 `config/` 和 `data/`。
- Chatwoot 的源码、配置与数据限定在独立空间。中台程序及邮箱按钮按用户明确授权，核对现用提交后走新 CI、Linux 包和独立发布流程；接入代理仅新增已核对的 Chatwoot 路由。保全原业务记录、附件、账号权限及调度，不更新或重启 Agent。启动项目不会自动接入邮件、WhatsApp 或其他业务渠道。

## 统一身份

`gateway.mjs` 通过 HTTPS 调用中台既有 `/api/auth/session`，只转发指定的中台会话 Cookie。它检查在职内部身份和首次改密状态，不读取密码、不挂载中台数据库。创建的 Chatwoot 身份使用中台稳定用户 ID 对应，保存姓名、账号标识和来源邮箱；内部技术邮箱由稳定 ID 派生，员工无需维护。

网关在服务端申请并消费 Chatwoot 一次性登录凭据，将原生前端需要的会话信息写入 Cookie 后直接跳转原生工作区。浏览器地址不携带登录令牌，原生注册、密码登录和密码重置接口不向员工开放。

每次页面/API 请求重新验证中台登录，成功鉴权结果不缓存；并发中的相同检查可合并。身份绑定同时包含当前会话、员工、角色及 Chatwoot 工作区。角色变化、账号停用、登录失效或鉴权服务异常均拒绝继续读取。WebSocket 连接建立时检查身份，存续时每 15 秒复核；撤销至断开存在该检查间隔，不能宣称实时零延迟撤销。

试运行沿用一个空工作区，普通内部成员映射为 agent，中台管理员映射为 administrator。尚未接入真实渠道；收件箱、客户责任范围及共享会话权限应在接入真实业务之前独立设计和验收，不能将免登录通过视为消息权限已全面对应。

## 私有运行配置

1. `.env` 必须指定已经校验的镜像 ID：`CHATWOOT_IMAGE`、`POSTGRES_IMAGE`、`REDIS_IMAGE`、`GATEWAY_IMAGE`，以及可选的 `CHATWOOT_GATEWAY_PORT`。`pull_policy: never` 防止运行时拉取未经校验的镜像。
2. `config/chatwoot.env` 设置生产运行模式、独立 PostgreSQL/Redis 连接、密钥、`FRONTEND_URL`、本地附件存储、关闭自助注册、关闭遥测/推送中继及低并发参数。不填现有员工密码或业务渠道凭据。
3. `config/postgres.env` 仅含新实例的库名、用户名与随机密码；`config/redis.conf` 使用独立随机密码及持久化设置。
4. 在新数据库完成迁移后，用 `bootstrap.rb` 初始化一个空工作区和 Platform App。它只允许空安装；输出凭据到指定私有文件，禁止覆盖已有初始化结果。
5. `config/gateway.json` 包含 `publicOrigin`、`middleSessionUrl`、`chatwootOrigin`、`platformToken`、`bindingKey`、`accountId`、`stateDir` 和 `sessionCookieName`。服务端凭据只留在受限配置文件中。

试运行容器的内存上限合计约 1.6 GiB，数据库与 Redis 无宿主机端口；网关只绑定宿主机回环地址。该配置用于低并发验证，不能据此承诺正式容量。

## 入口启用与验收

邮箱页面只有在 `/chatwoot/status` 返回获授权的 `{enabled:true}` 后才显示按钮。未接入网关的环境保留原页面，不显示不可用入口。

邮箱按钮随正式前端源码经过 CI 构建并打入 Linux 包。接入需要审核现有代理上的新增路由，包括 `/chatwoot/`、Chatwoot 原生 `/app/`、`/auth/`、`/api/v1/`、`/api/v2/`、`/vite/`、`/brand-assets/`、`/cable` 及附件路径，并逐项核对与既有路由是否冲突；保留中台原有 `/assets/`、`/api/auth/`、`/api/workspace/` 及 Agent 路由。不得直接套用或覆盖现有代理配置。启用前执行既定代码回退和一致性备份流程。

- 合成检查：`node tests/chatwoot-gateway.mjs`，覆盖正常进入、身份隔离、角色变化、撤权、服务故障、CSRF、WebSocket 与重启后身份对应保留。
- 业务代码检查：`node tests/run.mjs`、`node node_modules/typescript/bin/tsc --noEmit`；涉及内网运行时还须独立构建和执行 `node standalone/test.mjs`。
- 浏览器验收必须实际点击邮箱按钮，确认直接进入原生工作区且不出现登录/注册表单。合成浏览器检查与真实员工验收分别记录；未完成真实点击时不得宣称线上入口已经可用。
- 容器重启后核验配置、工作区和测试数据；新增业务渠道、发送及历史导入另行验收。
