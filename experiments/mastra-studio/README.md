# Mastra Studio 本地测试

在 `codex/mastra-local-validation` 分支完善正式岗位 Agent，复用数据台的登录与公司图标。总管、PMC、采购、客服使用正式岗位名称；测试数据来源不附加到 Agent 名称或页面标题。默认保留合成演练，也可显式选择本机业务快照进行验证；Git 操作不自动部署到 ECS。

## 启动

需要 Node.js 22.18+（建议 24 LTS）。在仓库根目录安装项目依赖后运行：

```powershell
npm run install:ci
npm ci --prefix experiments/mastra-studio
npm start --prefix experiments/mastra-studio
```

默认入口：`http://127.0.0.1:8797`。端口占用时停止启动，不停止已有服务；可用 `$env:DOON_STUDIO_PORT='8798'` 指定其他测试端口，拒绝 8787。

脚本自动构建到 `test-output/mastra-studio-build/`，首次创建专用测试库和 `studio_admin` 测试账号。随机密码仅保存在被忽略的 `test-output/mastra-studio-sandbox/本地测试登录.txt`，不会打印密码或提交到仓库。重复启动沿用测试库和会话，不重置账号，不重复初始化。启动脚本固定使用上述目录，不读取或复制原 `lan-data/`。

登录后点击左上角原公司图标，新标签页进入 `/studio/`，数据台当前页面与未保存输入保留。Studio 顶部有“返回数据台”。原公司图案、尺寸、导航、业务表单不变；测试环境显示独立测试提示。普通服务未启用 Studio 时保持原图标行为。

Studio 左上角使用原公司 Logo，名称及浏览器标题为 **Agent Studio**。品牌样式由本目录的 `brand.css` 提供，通过现有登录保护的路径加载；不修改依赖包，重新安装依赖后仍有效。

连接设置、搜索弹窗、资源页等明显的界面品牌文字也统一为 Agent Studio / Agent，并隐藏云服务推广卡片。`branding.mjs` 仅在响应中替换固定版本的已知界面字符串，不全局替换标识符；实际 SDK 包名、代码示例、官方文档链接和开源信息保持准确。

## 免费 Editor（已有岗位配置）

合成模式的四个 Agent 已接入 `@mastra/editor 0.16.3`，核心依赖保持原固定版本。进入任一 Agent → **Editor** → **Open configuration** → **System Prompt** 编辑提示词，或在 **Tools** 编辑已有工具的说明。窄窗口中配置面板默认收起。点击 **Save New Version** 保存独立草稿，测试后点击 **Publish** 才影响已发布配置；历史版本可查看并还原为新草稿。保留官方菜单中明确的 **Save & Publish** 操作，普通保存不会自动发布。

Editor 使用独立 Agent 存储的配置表，本地为 Studio 专用 SQLite，云端为既有 Agent PostgreSQL；首次仅为尚无 Editor 配置的岗位增量登记代码基线。已有草稿、发布版本、记忆与轨迹不重置。应用阻止版本删除，并拦截上游默认 50 版自动清理，保留全部编辑历史。岗位委派明确解析采购 Agent 当前发布版本，草稿不会因委派而提前生效。

当前编辑范围为提示词与已有工具说明。岗位名称、模型、工具执行代码、业务权限、记忆配置和运行限制由服务端控制；新增岗位、工具、MCP、工作区、外部集成及删除历史的接口不开放。Agent Builder / Workflow Builder 均明确关闭，不配置企业许可证，不接入付费 Mastra 托管服务。模型试运行仍可能产生已有 DeepSeek API 用量；合成离线测试不会调用收费模型。

真实业务快照模式与后台协作验证运行时沿用原固定岗位策略，本次不开放它们的编辑入口。Editor 所有页面与 API 沿用既有会话、技术角色与 Origin 校验；具有调试访问权的技术账号共享该环境的配置管理能力。软件接入和 Git 推送不代表云端更新。

验证：`npm run test:editor --prefix experiments/mastra-studio`，并运行本页原有测试命令。界面验收应实际完成修改、保存草稿和发布，不能只确认 Editor 标签可见。

## 可以试什么

- **Agents**：总管、PMC、采购、客服四个 Agent，身份和职责由 [岗位契约](profiles.mjs)统一定义。默认合成模式中，可进入总管 Agent，输入“检查采购欠料，委派采购 Agent 核对供应商复期并生成催交草稿”。
- **工具与委派**：展示 `inspectOverdue → delegateProcurement → 采购 Agent`，采购 Agent 再调用检查及草稿工具。固定场景 `SYN-STUDIO-001` 欠料 30、供应商复期 2026-10-14，检查基准日固定为 2026-10-17。本地脚本模型不理解自由语义，输入其他问题也会演示同一场景。
- **Workflows**：`synthetic-procurement-followup` 工作流，输入 `{}`，运行检查与草稿两个步骤，结果 `sent: false`。此工作流没有真实派单、人工审批或消息发送。
- **Memory**：会话写入独立 `studio/mastra.sqlite`；重开或重启可继续查看。每次取最近 12 条消息，关闭自动标题、向量召回与工作记忆，不产生额外模型调用。测试环境供获授权技术账号共享调试，不代表已完成正式业务的用户/任务记忆隔离。
- **Traces**：展示 Agent、模型、工具、委派和工作流的运行轨迹；仅写本地存储导出器，无云端导出器。用量是固定脚本计数，不能用于估算真实模型费用。

默认 `offline` 模式不调用真实模型；选择 DeepSeek 后会产生真实模型用量。默认数据源为合成演练；显式业务快照模式见下文。两种数据模式均不连接企业微信。业务闭环仍按 [Agent 设计规划](../../docs/agent-system-design.md) 的后续阶段实现。

## 岗位身份、数据与 prompt

正式岗位定义集中在 [profiles.mjs](profiles.mjs)，当前版本 `2026-10-17.1`。每岗分别定义身份、目标、职责、禁止越界、交接和工具范围；岗位不等于员工或审批人。真实成员由本机显式配置，读取复用当前分支的业务权限函数，不接受模型声明的身份、owner 或客户范围。

四岗共用 [公司背景](company-context.mjs)：已确认 DOON 为工贸一体的眼镜厂家，结合现有工作台说明客户开发、工程、报价、样办、采购、计划、制造协作与交付之间的关系。总管从客户和工厂全局协调；具体产能、人员规模、产品系列、市场与认证等未确认信息不补写。配置版本只作为内部维护元数据，不进入 Agent 的 prompt 或自我介绍。

| Agent | 职责 | 本机业务验证可用工具 |
| --- | --- | --- |
| 总管 Agent | 风险优先级、跨岗位阻塞与核验清单 | 覆盖、采购、订单、项目、跟进、客服记录 |
| PMC Agent | 计划衔接、订单影响与齐料证据核查 | 覆盖、订单、采购、项目 |
| 采购 Agent | 采购义务、净合格收货、承诺与内部核查草稿 | 覆盖、采购、内部草稿 |
| 客服 Agent | 客户项目、待办与交期沟通辅助 | 覆盖、订单、项目、跟进、客服记录 |

工具返回记录 ID、版本、来源截至日、来源指纹和快照标识。分页上限 50，返回精确筛选条件、匹配总数、下一页位置、是否到末页及当前响应是否覆盖全部匹配集。风险筛选不等于所有在跟数据；不同单位不相加，样本不冒充全量。确定性数量、日期与状态由工具提供；模型输出仍须人工核验。

## 用本机业务快照测试正式岗位

快照仅是测试输入，不是 Agent 的身份或产品名称。正式角色与 prompt 的公共部分可复用，数据适配独立在 [business-facts.mjs](business-facts.mjs)，Agent 装配在 [business-agents.mjs](business-agents.mjs)。此入口当前仅在本机隔离环境开放；没有因此部署云端、接通实时业务或开放写入。

1. 显式选择本机业务 SQLite，运行在线快照工具。源库只读打开，使用 SQLite backup API，不复制运行中的主文件。输出目录必须是 `test-output` 下尚不存在的新目录；工具校验数据库与附件摘要，不读取附件内容到模型，也不修改原件。

   ```powershell
   node experiments/mastra-studio/snapshot.mjs <本机源SQLite> <test-output中的新目录>
   ```

2. 在本机环境配置 `DOON_STUDIO_DATA_MODE=real-snapshot`、`DOON_STUDIO_SNAPSHOT_DIR` 和 `DOON_STUDIO_MEMBER_ID`。后者必须是快照中有效且非供应商的真实成员 ID，工具按该成员的既有权限查询；不会赋予测试账号对应的生产账号或生产会话。路径、ID、密钥及业务输出仅放忽略目录，不写入源码。
3. 用原启动方式进入本机 Studio。数据台登录仍用独立合成账号与空测试库；岗位查询使用校验过的业务快照。两者不合库、不导入、不开启生产端口。记忆和轨迹按数据模式、快照和实际成员分别存储，避免旧合成对话混入真实业务验证。

没有真实模型时只做明确说明的连接诊断，不用脚本伪装理解自由问题。选择 DeepSeek 时沿用服务端密钥，模型只获得当前工具允许投影的必要字段；不发送账号表、密码、会话、附件原件、财务明细或整库。

本机 Studio 的实际 `send-message`、`threads/subscribe`、`threads/abort` 协议已适配。消息只接受文字；附件和伪造工具结果拒绝。浏览器传来的模型、prompt、客户端工具、requestContext 与运行参数不覆盖服务端岗位配置。直接 generate/stream 的额外覆盖参数拒绝；资源编辑、任意工具执行、Workflow、克隆、信号注入和业务写入入口不开放。页面通用设置控件不作为岗位配置的持久编辑入口。

岗位回答明确区分观察日、快照生成时间和业务来源截至日期；没有订单/BOM/MES 时报告缺口，不从项目或采购猜测齐料。收货基数未知不当零，退货待补不重复计入欠数；采购源交期、内部预计和供应商承诺分别解释。草稿只返回内部核查文本，不发送、不创建正式任务、不改业务状态。

本机技术调试账号能查看该实例的调试会话；此验证入口不等于已完成正式员工多用户记忆隔离、实时撤权同步、消息闭环或生产容量验收。上线须接入对应的可信数据适配及身份链路，不能把固定测试成员配置直接作为员工生产授权。

## DeepSeek 模型、余额与状态

左侧栏底部固定显示 DeepSeek 官方图标、后端实际配置的模型号、账户余额和状态。窄窗口中展开导航可见；侧栏缩到图标模式时保留图标和可访问说明。点击可展开充值/赠金明细、查询时间、最近模型 HTTP 请求结果、刷新按钮及官方文档链接。不在顶部增加余额组件，不修改原数据台 UI。

密钥仅从服务端 `DEEPSEEK_API_KEY` 或 `DEEPSEEK_API_KEY_FILE` 读取，文件配置优先；不接受浏览器上传 Key，不返回 Key，不自动读取 `.env`。启用真实模型时，在已有密钥环境中启动：

```powershell
$env:DOON_STUDIO_MODEL='deepseek-flash'
npm start --prefix experiments/mastra-studio
```

支持 `offline`（默认）、`deepseek-flash`、`deepseek-v4-pro`。Key 单独存在不会切换原有合成模型，但可以查询账户余额；明确选择 DeepSeek 模型时，缺少 Key 会拒绝创建 Studio，不静默回退。所有 Agent 使用同一后端模型配置。模型号是请求使用的官方 API ID，可能是厂商滚动别名，不冒充更具体的底层权重版本。

适配器固定 `@ai-sdk/deepseek@1.0.63`，与当前 Mastra 的 AI SDK v2 协议兼容。合成场景默认关闭 thinking，每次生成输出最多 768 tokens，最多 5 个步骤；不代表所有调用的总 token 上限或完整预算机制。真实模型仅在明确生成请求时调用，查询余额不触发生成。

余额通过服务端请求官方 `GET https://api.deepseek.com/user/balance`，账户不同币种分别展示，保留接口原始精度；不把无余额或查询失败显示成 `0`。余额成功缓存 60 秒、失败缓存 30 秒，合并并发请求；手动刷新最短间隔 10 秒。页面可见时每 15 秒读取一次本地状态，外部余额查询仍受缓存控制，后台标签页不轮询。

按官方通用错误文档解释 400、401、402、422、429、500、503，展示 HTTP 状态、可安全展示的 `error.code` / `error.type`、原因及处理建议。网络失败、超时、非法响应和未列出的状态单独标记为本系统诊断或未归类，不伪造官方定义。余额错误与最近模型 HTTP 错误分别记录；不透传上游原始错误消息或请求内容，模型失败响应也转换为安全说明。此状态不替代流式最终结果和运行轨迹。

状态、图标和脚本全部经过原 Studio 登录及管理员/程序员角色校验；刷新 POST 继续校验同源 Origin；响应 `no-store`，服务端状态仅驻留进程内存。余额查询正常只代表该接口成功，不等于每次模型推理成功。重启后最近模型 HTTP 状态重新开始记录，页面会明确提示尚未验证。

图标原件来自 [DeepSeek 官方文档 favicon](https://api-docs.deepseek.com/img/favicon.svg)，存放在 `assets/deepseek.svg`，页面不向第三方加载图片。依据：[余额接口](https://api-docs.deepseek.com/zh-cn/api/get-user-balance/)、[错误码](https://api-docs.deepseek.com/zh-cn/quick_start/error_codes/)、[当前模型 ID](https://api-docs.deepseek.com/zh-cn/)。

本功能在本地测试分支提供；云端 Docker 验证程序和正式中台未因此切换模型或部署 Studio。

## 接入与权限

```text
浏览器 → 本地数据台 127.0.0.1:8797
          ├─ 原业务 UI / 原 API（独立测试库）
          └─ /studio/* → 逐次校验数据台会话
                         ├─ 官方 mastra 包内 Studio 静态资源
                         └─ /studio/api/* → @mastra/hono → Mastra
                                                   └─ 独立合成 memory / trace 库
```

同一进程、同源路径，没有另开一个可绕过登录的 4111 端口。入口、静态资源与所有 API 都先经应用外层校验，包括 Mastra 自身标为 public 的路由。未登录的入口跳转登录页，其余资源返回 401；仅已完成改密且启用的管理员、程序员允许调试，其他角色返回 403。退出、会话失效或角色变化会作用于后续请求；已加载在浏览器中的旧内容不会被远程擦除。修改类请求校验 Origin，不把会话令牌放在 URL。

默认关闭。显式启用仍须同时满足 `DOON_STUDIO_ENABLED=1`、`DOON_SYNTHETIC_ONLY=1`、127.0.0.1、非正式端口、专用目录标识；供应商入口、员工公网网关和只读验收模式拒绝启用。校验发生在业务 runtime 打开数据库之前。正式开放及权限映射另行设计，不能把本地测试开关当生产部署方案。

依赖独立锁定在本目录：core 1.78.0、CLI/Studio 1.34.2、Hono 适配器 1.7.20、memory 1.21.1、libsql 1.26.1、observability 1.20.1。根项目依赖保持不变。Studio 复用官方静态包与运行配置替换机制：[官方自托管说明](https://mastra.ai/docs/studio/deployment)。

## 验证

在根目录运行：

```powershell
node tests/run.mjs
node node_modules/typescript/bin/tsc --noEmit
$env:DOON_BUILD_DIR='test-output/mastra-studio-check-build'
node standalone/build.mjs
node standalone/test.mjs
node --test experiments/mastra-studio/studio.test.mjs
node --test experiments/mastra-studio/deepseek.test.mjs
```

新增集成测试覆盖官方页面与资源、工具和委派、流式回复、工作流、memory 重启保留、trace 入库、禁用配置、未登录、首次改密、非技术角色、跨站修改、退出后失效，以及取消资源请求后服务继续运行。测试使用临时数据库与随机本地端口。

云端 PostgreSQL 的 Traces 查询还需运行 `node --test experiments/mastra-studio/observability.test.mjs`。该测试模拟非空 PostgreSQL 查询响应，经实际 Hono 路由验证游标与页码两种分页，以及输出/错误预览字段；空列表或仅验证轨迹入库不足以覆盖响应格式兼容性。当前 `@mastra/core` 与 `@mastra/server` 对齐到 1.78.0；升级 Mastra 依赖时须一起核对响应契约，不能仅依赖宽泛的 peerDependencies 范围。

浏览器验收需实际通过公司图标进入 Studio，执行总管 Agent，查看 Traces 和 Workflows；不以单纯出现 Studio 首页作为完整运行证据。
