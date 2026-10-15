# Mastra 本地能力验证

本实验位于项目分支 `codex/mastra-local-validation`，用于验证数据中台、协同任务与 Agent 的接入机制。使用独立依赖、合成订单、本地模拟模型和临时数据库。测试不会连接现有业务数据库、模型供应商或企业微信，不启动8787服务，不执行部署。

## 版本与源码

- 上游：https://github.com/mastra-ai/mastra
- 固定发布：`@mastra/core@1.77.0`
- 固定提交：`f88217d19b63d362ff97723c1a339fbf89a1bbb0`
- 本地源码分支：`codex/doon-local-validation`；上游远程名 `upstream`。
- 集成依赖：`@mastra/core=1.77.0`、`@mastra/libsql=1.26.1`、`zod=3.25.76`，由本目录的lockfile固定。

源码仓库与业务仓库分开放置。初始GitHub连接不稳定，采用partial clone，并从相同版本发布包的source map恢复原始核心TS文件。`verify-source.mjs`只接受与固定提交中Git blob哈希完全一致的内容，写入本地源码目录并缓存为Git对象；不会生成替代实现或覆盖修改过的源码。

目前核验并恢复711个原始核心源码文件；源码验证直接加载调度比较函数执行5项检查。业务场景集成测试使用同版本发布SDK。**这不是整个上游monorepo的源码构建或完整测试认证**；未拉取全部示例、文档及测试依赖。

## 本地运行

在本目录执行：

```powershell
npm ci --no-audit --no-fund
npm test
npm run test:source -- <本地Mastra源码目录>
```

Node要求至少22.13，本轮使用24.14.0。测试使用Node自带SQLite和本地libSQL；数据库位于系统临时目录 `doon-mastra-*`，测试后清理。Windows的libSQL句柄在同进程关闭后仍可能占用文件，因此文件存储场景在子进程内完成，待进程退出后清理。

源码首次准备可使用：

```powershell
git -c http.version=HTTP/1.1 clone --filter=blob:none --sparse --depth 1 --single-branch --branch "@mastra/core@1.77.0" https://github.com/mastra-ai/mastra.git <本地Mastra源码目录>
git -C <本地Mastra源码目录> remote rename origin upstream
git -C <本地Mastra源码目录> switch -c codex/doon-local-validation
```

## 已通过的11项集成验证

| 场景 | 检查内容 |
| --- | --- |
| 每日新上下文 | 同一Agent的下一次无记忆调用不携带上一轮私有标记 |
| 工具调用 | Agent真实执行循环调用具有schema的合成订单工具 |
| 工具人工批准 | `requireApproval`暂停期间副作用为0，明确批准后才执行 |
| 多Agent协作 | 客服Agent调用订单Agent；过滤后的交接不包含父会话私有标记 |
| 脚本结合 | 经工具调用固定本地Node脚本，参数限定为合成订单 |
| 跨进程恢复 | 一个进程暂停工作流，退出后另一个进程读取快照并继续 |
| 人工拒绝 | 被拒绝的流程失败，未创建任务或业务审计 |
| 审批人不匹配 | 应用层拒绝非指定审批人，不产生业务写入 |
| 来源已变化 | 应用层发现订单版本变化，旧审批不能放行 |
| 重复执行保护 | 同一动作重试100次，仅有1项任务与1项审计；更换内容被拒绝 |
| 调度持久化 | 北京时间每日计划以暂停状态保存，运行时重建后仍在，未绑定历史会话 |

审核权限、来源校验、幂等账本是本实验实现的应用责任，不应将这些测试结果归为Mastra自动提供的业务保障。调度测试验证定义持久化，没有等待真实9点触发，也没有验证宕机补跑。

本轮额外运行的主项目TypeScript检查通过。主项目完整业务回归已启动但耗时较长，随后主动停止，**未将其计为通过**。本次只新增本目录的隔离实验，没有修改业务代码或运行时，因此实验验收以本目录11项集成测试及5项直接源码检查为准。

`lab.mjs`定义模拟模型、业务工具、应用账本及人工工作流；`workflow-worker.mjs`验证跨进程恢复；`runtime-worker.mjs`验证工具审批与调度；`validation.test.mjs`组织断言。

## 对项目的初步结论和下一步

目前已验证：项目需要的短上下文执行、工具、跨Agent交接、人工介入、跨进程恢复和脚本包装，在这一版本上可以组合运行。待处理任务与关键操作账本可以持久保存，无需把全部历史对话带入每日执行。

下一步可以在这个分支继续实现只读业务API适配及员工任务展示，先使用合成数据。真实模型质量、费用和连通性；当前项目权限接口适配；生产PostgreSQL；Durable Agent崩溃重放；真实计时触发；企业微信投递回执；不可变审计；负载容量，均尚未在本实验验证。

本轮没有修改主项目依赖、业务逻辑、原始记录或附件。未创建GitHub远端fork，未推送实验代码，也未上传、停止或重启任何服务器服务。
