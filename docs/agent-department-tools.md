# Agent 十部门工具：首批运行契约

本轮在 `codex/mastra-local-validation` 实现；没有部署、业务写入或变更正式账号权限。目标仍是按原登录权限覆盖中台增删改查，本轮完成共用执行器、十组工具登记、首批查询与流程修改草稿。

## 当前能力

Studio 工具目录新增 `departmentSales`、`departmentService`、`departmentEngineering`、`departmentPlanning`、`departmentPurchasing`、`departmentWarehouse`、`departmentProduction`、`departmentQuality`、`departmentFinance`、`departmentManagement`。新建 Agent 可选择这些工具；总协调岗位保留十组必需入口，不覆盖已有提示词、记忆及版本。

所有组共用 `department-executor.mjs`，按 `list → inspect → query/prepare` 调用：

| 操作 | 实际行为 |
| --- | --- |
| list | 返回该部门已适配动作、仍未接通接口；清单不是用户授权结果 |
| inspect | 经当前登录读取原业务接口，返回可见数据对象、字段与精确参数契约 |
| query | 读取原接口授权 DTO；严格限制动作、范围、字段及分页，最多 20 条/页 |
| prepare | 对已适配流程生成待核对草稿；默认不持久化。启用流程确认接入后登记独立预览并返回本人确认链接，仍不执行业务 |

首批包含现有 **34 个业务读取视图**，加 **14 类流程读取动作**及对应的 **14 个新增／修改草稿动作**。报价模板必须指定 `customerAccountId`，流程类型由动作固定绑定。原接口缺失、失效或拒绝时返回错误，不改用聚合数据或其他身份绕过。

14 类流程覆盖业务、客服、工程、PMC、仓储、品质、财务七组；采购、生产、管理本轮接入查询及未适配动作目录，尚未接入各自写入草稿。原接口清单 359 项仍逐项保留，尚未适配的接口标明 `not-executable`。现有 34 个视图的查询参数仅开放登记字段，其他筛选条件须继续适配。

## 权限与草稿

身份及 Cookie 由受信任网关上下文传入；模型不能传账号、角色、任意 URL、HTTP 方法、数据库或 Shell 参数。每次业务读取重新鉴权，原中台仍负责记录、客户及字段权限，部门分组不扩大权限。后台事件查询继续限制在本次授权记录，不能调用业务修改草稿。

流程草稿先回查原接口 `allowedKinds`、`canCreate`、记录 `canEdit` 和当前版本；更新只合并显式字段及明细，不改已有类型、客户、订单、小组，不接受模型覆盖 token、业务版本或操作者。`expectedVersion` 仅用于核对查询时的版本，不能指定新版本。原 DTO 不支持修改时拒绝草稿。创建权限和可编辑标记仅用于提前拦截，不能代替中台提交时的关联及权限校验。

字段类型、严格日期、数量平衡、金额精度及完成条件来自中台纯校验函数的生成副本。模型须提供修改依据的位置，并保留未知项和冲突；程序不将这些来源声明当作已验证证据。默认返回 `draft-only`；启用确认接入后返回 `pending-confirmation` 或 `preview-uncertain`。草稿结果均保持 `saved:false`、`executed:false`、`basisVerified:false`。记录版本、原内容、拟修改内容、依据及契约版本的哈希只用于核对，不能作为批准令牌。

模型工具没有业务确认、删除、外发或自动重试入口。人工确认页面与固定 API 已单独接通，详见[流程确认接入](agent-process-change-confirmation.md)，默认关闭且未部署。历史删除、作废、撤销、归档等必须继续按原接口语义逐项适配。

## 契约来源与更新

`department-registry.json` 引用主线接口清单提交 `35d441d`，保留文件哈希及完整提交号。Agent 分支没有复制主线业务运行时、数据库或附件；`process-contract.generated.mjs` 仅包含经选择的纯字段及完成校验函数。

在 Agent 工作树执行以下命令，`--repo` 指向中台源码工作树，`--ref` 使用已审核的不可变提交。生成器仅通过 `git show` 读取提交，使用 TypeScript AST 提取，不导入业务服务。

```powershell
node experiments/mastra-studio/generate-department-contracts.mjs --repo <中台源码目录> --ref 35d441d --check
```

更新契约时去掉 `--check`，审核生成差异并运行测试。本地纯校验用于草稿提前检查；启用流程确认后，由中台实际校验、返回当前规则指纹并绑定预览，执行时拒绝已变化的规则和来源。

```powershell
cd experiments/mastra-studio
npm run test:departments
```

测试全部使用合成身份与数据、隔离的临时 Studio 存储，覆盖十组可发现性、按原身份读取、14 类严格字段校验、草稿保留旧字段、越权／过期版本／未知接口拒绝、后台范围和 Studio 新建 Agent 工具选择。Docker 构建白名单包含运行契约文件，不包含生成脚本及测试。

2026-10-20 本地验证通过：`node tests/run.mjs`、`tsc --noEmit`、契约生成一致性检查、专项 15 项、Studio 完整回归 64 项。使用独立 `test-output/department-tools-build` 构建后，`standalone/test.mjs` 的 15 项 HTTP 检查通过；Agent 构建上下文白名单打包成功。没有调用正式业务 API、外部模型或部署脚本；这些结果不代表服务器已上线或全部接口已验收。

后续已补上这 14 类流程的人工预览确认、服务端执行与回读留痕，见[流程确认接入](agent-process-change-confirmation.md)。其余采购、生产、管理等业务动作仍须逐项适配；当前不是全部十组的完整增删改查。
