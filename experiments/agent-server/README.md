# 云端 Agent Studio 容器

界面资源在逐次鉴权后独立返回，不等待个人 Agent 运行时或 PostgreSQL 初始化；API、会话与工作流继续使用原有隔离运行时。云端就绪前完成主脚本中文化和压缩预热。静态资源支持 gzip 和私有 ETag 条件缓存，304 同样先验证现有会话，动态 API 不缓存；字体支持 TTF / WOFF / WOFF2。回归：`node --test experiments/agent-server/loading.test.mjs`，覆盖大脚本压缩还原、缓存撤权、冷运行时期间加载界面及字体读取。本说明描述源码能力，不表示线上已更新。

## 真实业务只读模式（2026-10-19）

设置 `AGENT_DATA_MODE=live-readonly` 后，容器通过原 HTTPS `/api/auth/session` 和固定 `/api/workspace/{source}` GET 视图读取业务，不挂载业务 SQLite 或附件目录。业务请求每次重新验证当前会话、成员与权限，字段目录来自相同的授权响应；模型只获取选定数据集的必要字段，每页最多 20 条、48KiB。账号、集成和凭据字段额外排除。会话 Cookie 只存在于服务器读取闭包，不能由模型指定或写入配置、轨迹及数据库。

每个登录身份以服务端生成的哈希 schema 隔离 Agent 配置、Prompt、对话、工作流和轨迹。沿用原 PostgreSQL 数据库，新建独立 schema，不覆盖旧共享合成记录；真实模式没有自动导入旧合成工具及工作流。运行时最多缓存 4 个账号，超出容量返回 429，闲置实例仅关闭连接，永不清理持久数据。当前 Studio 准入仍限已改密的管理员和程序员，原业务角色和授权不变。

免费 Agent/Prompt 编辑、聊天内工作流预览与确认、可视化编辑和人工审核均保留。真实模式禁用仅适用于合成采购的巡检、筛选及草稿节点；模型与浏览器不能安装任意代码、外部工具、覆盖服务端模型或伪造工具输出。工作流配置、审核及草稿保存在独立 Agent 数据库，不写原业务记录。

常用的“读取记录→人工审核→通过后汇总、拒绝直接结束”使用 `previewRecordReviewWorkflow`：模型仅填写授权模块、数据对象、名称和日历时间，固定程序生成唯一开始/结束节点及两条审核分支。`previewWorkflow` 仍支持其他有界图。两者共用预览有效期、真实身份、权限复核、人工确认及幂等保存机制；工具本身不能确认保存或批准审核。目录合并同轮在途请求，原业务 GET 逐次鉴权；单模块暂时失败单列为 unavailable，不以失败推断无数据，也不阻断其他模块。

定时任务可配置每天、周一至周五或指定星期。**当前已发布的云端版本尚未启用无人值守调度和业务变更采集。** 本测试分支新增独立只读授权桥、后台调度 worker 与持久运行结果，需要原生桥和 Agent 镜像分别部署、配置独立密钥，再由本人启用已发布流程；普通登录 Cookie 不保存成后台凭据。实现边界、启用步骤和验收见 [云端自动调度](../../docs/cloud-workflow-schedules.md)，本次源码更新不代表云端状态变化。

镜像源包使用正向文件清单生成：`node experiments/agent-server/package.mjs <新的暂存绝对目录>`，输出 `.tar.gz`、逐文件 SHA-256 和源码基线，排除私有配置、凭据、数据库、附件、测试与 `node_modules`。在暂存根目录运行 `docker build -f agent-server/Dockerfile -t doon-agent-studio:<新版本> .`。配置模板仍默认合成模式，启用真实读取必须显式设置数据模式。

云端测试：`node --test experiments/agent-server/server.test.mjs experiments/agent-server/business-api.test.mjs experiments/agent-server/live-studio.test.mjs`，使用合成身份与隔离库验证真实运行路径。历史部署说明如下；候选镜像与过去的合成验收不代表新版已完成真实账号验收。

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

项目自建 Agent 管理界面通过 `/studio/manage/*` 提供，复用既有 Studio 鉴权，镜像须同时包含 `agent-manager.mjs`、HTML、JS、CSS。名称、提示词和工具选择保存在原独立 Agent 配置及版本表，发布前同样需要完整备份与核验；不创建或挂载业务库。工作流管理通过 `/studio/workflow-manager/*` 提供，镜像还须包含 `workflow-manager.mjs`、HTML、JS、CSS；定义与人工审核日志保存在同一 Agent 数据库的独立记录类型中，审核人通过认证上下文传递，不依赖客户端身份头。下述 `20261018-editor-candidate` 仅包含当时的 Editor 接入，不包含后来新增的管理入口、工作流与视口修复，不能作为当前功能的发布镜像，正式更新需重新构建和独立授权。

免费 Editor 的部署准备已包含在镜像白名单中（`editor.mjs` 与岗位配置依赖），不启用 EE Builder。编辑内容写入 `doon_agent_studio` 的 Agent 配置与版本表，沿用所有 `/studio/*` 的原会话和 Origin 校验；数据库及卷必须保留。更新前须对既有 memory、traces、Agent 配置及全部历史做逻辑备份和摘要核验。源代码与当前云镜像存在岗位定义差异时，先核对并保留原云端岗位配置，不因接入 Editor 顺带替换其他实验功能；首次增量登记以本次实际获准发布的岗位代码为基线。云端更新记录须与本地接入验收分开记录。

2026-10-18 已构建未发布候选 `doon-agent-studio:20261018-editor-candidate`，镜像 ID 为 `sha256:0a250d7a5c7ccdda03e3774a66cf0e5c5dde58e3c1272fe2287f7bf879d9402f`。岗位与服务代码以 `d7b690e` 为基线，先与现有云容器相应文件的 SHA-256 核对一致，再仅附加 Editor 接入；依赖使用本次锁定文件。独立内部 Docker 网络、无公开端口的临时 PostgreSQL 16 和无生产挂载的候选容器已验证四岗读取、草稿与发布隔离、显式发布、重建运行时后保留配置及两条原合成消息；Builder 关闭，外部模型调用为零。临时数据库容器和网络已清理，现有云端容器未切换。候选源码归档与哈希清单仅保存在本机忽略的 `test-output/editor-cloud-candidate-20261018*` 及服务器独立候选目录，不能将该记录描述为已上线。

发布前保存原代码、SQLite 在线快照、附件哈希、nginx 原配置，以及现有 PostgreSQL 逻辑备份。后续发布 Agent 只更换镜像版本并重建 Agent 容器；不切换正式服务分支，不重置任何卷，不使用 `down -v`。

回退只恢复原 nginx 配置和旧 Agent 镜像；保留 PostgreSQL 库、卷及运行期间新增的数据。不得用旧备份覆盖现库。数据库恢复和跨版本快照迁移另行核对与授权。长期应在 CI 构建并从私有镜像仓库拉取；本次服务器临时构建目录在代码推送后清理，保留运行配置、密钥、镜像和数据。

测试：`node --test experiments/agent-server/server.test.mjs`，并运行原 Studio 集成测试。网关测试只用合成身份，覆盖逐次鉴权、角色、首次改密、撤销、认证服务故障、同源校验、Cookie 不下传、并发和大小限制。不得创建生产测试账号、读取员工密码或伪造正式会话完成验收。实测记录见 [云端 Studio 部署记录](../../docs/cloud-agent-studio-deployment.md)。

参考：[Docker bridge / host-gateway](https://docs.docker.com/reference/cli/docker/container/run/#add-host)、[nginx sub_filter](https://nginx.org/en/docs/http/ngx_http_sub_module.html)、[Mastra Studio 自托管](https://mastra.ai/docs/studio/deployment)。
