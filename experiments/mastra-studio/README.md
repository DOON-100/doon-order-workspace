# Mastra Studio 本地测试

在 `codex/mastra-local-validation` 分支运行官方 Studio，复用数据台的登录与公司图标。只使用合成场景；本目录不是生产 Agent 服务，也不自动部署到 ECS。

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

## 可以试什么

- **Agents**：总管、PMC、采购、客服四个 Agent，均标为“离线合成”。进入总管 Agent，输入“检查采购欠料，委派采购 Agent 核对供应商复期并生成催交草稿”。
- **工具与委派**：展示 `inspectOverdue → delegateProcurement → 采购 Agent`，采购 Agent 再调用检查及草稿工具。固定场景 `SYN-STUDIO-001` 欠料 30、供应商复期 2026-10-14，检查基准日固定为 2026-10-17。本地脚本模型不理解自由语义，输入其他问题也会演示同一场景。
- **Workflows**：`synthetic-procurement-followup` 工作流，输入 `{}`，运行检查与草稿两个步骤，结果 `sent: false`。此工作流没有真实派单、人工审批或消息发送。
- **Memory**：会话写入独立 `studio/mastra.sqlite`；重开或重启可继续查看。每次取最近 12 条消息，关闭自动标题、向量召回与工作记忆，不产生额外模型调用。测试环境供获授权技术账号共享调试，不代表已完成正式业务的用户/任务记忆隔离。
- **Traces**：展示 Agent、模型、工具、委派和工作流的运行轨迹；仅写本地存储导出器，无云端导出器。用量是固定脚本计数，不能用于估算真实模型费用。

当前无付费模型调用，不读取正式订单、附件或供应商配置，不连接企业微信。真实模型和业务闭环仍按 [Agent 设计规划](../../docs/agent-system-design.md) 的后续阶段实现。

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

依赖独立锁定在本目录：core 1.77.0、CLI/Studio 1.34.2、Hono 适配器 1.7.20、memory 1.21.1、libsql 1.26.1、observability 1.20.1。根项目依赖保持不变。Studio 复用官方静态包与运行配置替换机制：[官方自托管说明](https://mastra.ai/docs/studio/deployment)。

## 验证

在根目录运行：

```powershell
node tests/run.mjs
node node_modules/typescript/bin/tsc --noEmit
$env:DOON_BUILD_DIR='test-output/mastra-studio-check-build'
node standalone/build.mjs
node standalone/test.mjs
node --test experiments/mastra-studio/studio.test.mjs
```

新增集成测试覆盖官方页面与资源、工具和委派、流式回复、工作流、memory 重启保留、trace 入库、禁用配置、未登录、首次改密、非技术角色、跨站修改、退出后失效，以及取消资源请求后服务继续运行。测试使用临时数据库与随机本地端口。

浏览器验收需实际通过公司图标进入 Studio，执行总管 Agent，查看 Traces 和 Workflows；不以单纯出现 Studio 首页作为完整运行证据。
