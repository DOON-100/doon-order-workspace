# P2：DeepSeek V4 Pro 真实模型与对抗验证

本目录接续 P0/P1，在实验分支上验证真实 DeepSeek 官方 API 的工具调用、审批暂停和跨进程恢复。全部输入和工具结果为合成数据，无业务库、附件原件、正式任务、8787 或部署入口。验收结果见 [ACCEPTANCE.md](./ACCEPTANCE.md)。

## 配置与执行

Node 至少 22.13，本轮使用 24.19.0。依赖独立固定为 core 1.77.0、libSQL 1.26.1、DeepSeek 原生适配器 3.0.52、zod 3.25.76。

在本目录执行：

```powershell
npm ci --no-audit --no-fund
npm test
```

将 `.env.example` 复制为 `.env.local`，在本机文件中填写 `DEEPSEEK_API_KEY`。不要把密钥放在命令参数、聊天、Git 或日志中。本目录忽略 `.env*`，只有空模板允许提交。账号需有官方 API 可用余额。

Base URL 固定为 `https://api.deepseek.com`，模型固定为 `deepseek-v4-pro`。使用原生 `createDeepSeek` 对象传给 Mastra，避免在 Mastra router 中配置 `url` 后转成另一种兼容适配器。没有网关、自动回退模型或供应商切换。

确认本次调用预算后执行：

```powershell
npm run live
```

此命令显式使用 `--live --synthetic --budget-cny=10`。也可使用更低的独立 5 元额度：

```powershell
node --env-file=.env.local run.mjs --live --synthetic --budget-cny=5
```

终端仅输出 `P2_RESULT` 安全摘要和系统临时目录位置。最终核验：

```powershell
node --env-file=.env.local verify.mjs "<P2_RESULT.directory>"
```

`verify.mjs` 检查实际网络用量、状态、跨进程 PID、来源工具结果、reasoning 哈希回传和预算；分别报告本次用量／估算费用及累计额度占用，并统计实际非流式／SSE 请求数。如果已配置 Key，还在这个新建实验目录中检查凭据字节是否意外落盘，只输出检查数量。

失败即停止，没有自动重试。如排查后需要人工重跑同一轮，使用 `--resume-budget "<原目录>"`，并传入与原目录相同的 `--budget-cny=5` 或 `10`。它保留先前费用与次数，再以新 case ID 跑一轮，旧阶段摘要也保留；**不会重置原预算或给旧 5 元轮次提额**。不要靠新建目录绕过同一轮的累计预算。

## 验证链路

两种 thinking 设置分别执行：

1. `generate` 调用只读合成订单工具，并从真实工具结果返回核验字段。
2. `stream` 执行相同工具循环，消费完整 SSE 与用量。
3. 工具 `requireApproval` 暂停：副作用为 0，进程关闭；另一个进程读取 libSQL 快照并模拟批准：恰好创建 1 条合成效果记录。
4. 另一个独立 case 暂停后跨进程模拟拒绝：效果记录仍为 0。

共 8 个场景、12 个子进程阶段，正常预计 16 个模型请求。审批决定由测试程序模拟，未接真实员工登录、审批 UI 或生产授权。测试使用正常进程退出后重建，不冒充 Durable Agent 任意崩溃重放认证。

thinking 开启时使用 `reasoningEffort: high`、`toolChoice: auto`；不使用 thinking 不支持的强制工具选择。暂停前的模型 reasoning 原文留在本机临时快照中用于恢复，日志只保存哈希与长度；核对恢复请求中的哈希与前一响应完全一致。

## 出站与预算控制

`transport.mjs` 只接受官方 HTTPS `/chat/completions` 的 POST，禁止重定向；校验模型、thinking、最大输出令牌与请求大小。使用 provider 注入的 fetch，不关闭 TLS 验证。注册表自动刷新关闭，不影响已授权的官方模型请求。

每个目录有跨进程共享的 `budget.json`，请求发出前持久预留费用。按官方人民币高峰价（输入全部按未缓存 9 元/百万 tokens、输出 27 元/百万 tokens）估算，输出包含 reasoning，不能重复计费。预留对输入做保守字节上界并加余量；成功取得 usage 后释放未使用预留，超时、断流或缺 usage 保留全额。最多 24 次请求，每次最多输出 4096 tokens；预算、次数或协议异常会阻止继续调用。

这些是基于官方公开定价与服务端 usage 的本地预算控制，不是供应商账单的硬充值限额。实际费用受缓存和时段价格影响，以账号账单为准；正式计费策略变化时需先更新费率与测试。独立运行新目录有独立账本，同一授权轮次的重试必须复用原目录。

## 外部 Agent 对抗请求

在 P1 目录运行新增的 `tests/adversarial.test.mjs`。客户端模拟 WorkBuddy/Codex 风格的 HTTP 请求，但不连接这两个产品、不读取它们的配置或凭据，也不需要额外模型费用。

覆盖跨客户读写、伪造身份、额外字段、旧版本覆盖、重复提交、绕过审批、越权附件下载和批量参数超限。测试在临时本机端口运行，攻击后比较合成源对象与建议库哈希。早期发现的公开 A/B 身份入口已关闭，现需服务端随机分配的合成凭据登录。当前业务写接口全关闭、附件下载未提供，因此这些负例不证明未来业务写入、审批或附件权限实现正确。

## 接入 P1 建议生成

`npm run live:p1 -- --budget-ledger "<已有 P2 目录>"` 在已有账本内继续生成 A/B 的合成建议；不重置此前费用，不在网页内暴露生成入口。它通过 P1 的凭据登录、受信会话、只读工具与最终批次事务，逐请求检查模型正文不包含凭据、Cookie、私有字段或另一客户内容。预算前置检查要求剩余至少 8 次请求（每员工最多 4 步）；无论成功或失败都保存本次及累计费用／预留。

2026-10-16 此前实测新增 6 次请求、4 条建议；含更早 16 次请求，累计 22 次，保守估算 ¥0.191215。旧账本仍保留更严格的 ¥5 限额，未因用户授权 ¥10 而自动提额。当前 24 次请求上限仅剩 2 次，不能再次运行完整双员工联调；后续扩展必须显式处理累计额度和次数，不可另建账本绕过。该实测使用当时的独立认证，详见 [历史模型验收](../mastra-p1/AUTH-MODEL-ACCEPTANCE.md)。

后续主线权限适配已将本入口改为 `project-auth.mjs`：真实主线认证源码运行在新建合成认证库中。新版本完成离线 SDK／HTTP／权限及零出站预算回归，尚未再次调用收费模型，新增费用为零；见 [最新主线认证验收](../mastra-p1/PROJECT-AUTH-ACCEPTANCE.md)。

官方依据：[接口配置](https://api-docs.deepseek.com/)、[思考模式与工具历史](https://api-docs.deepseek.com/guides/thinking_mode/)、[人民币定价](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)。
