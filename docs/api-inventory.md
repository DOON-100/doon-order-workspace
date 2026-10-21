# 中台接口清点：Agent 全模块增删改查接入基线

日期：2026-10-21（Asia/Shanghai）。本清单生成仅做静态源码索引，不注册工具、不改变权限，也不触发业务请求或部署。

## 1. 清点结论

以 `204450f` 业务源码及本次金蝶采购只读查询与仅新增同步接口为基线，清点到 **378 项规范接口动作**：

| 范围 | 数量 | 说明 |
| --- | ---: | --- |
| `/api/workspace/{action}` | 355 | GET 117、POST 238，覆盖 47 个处理器文件分组 |
| `/api/auth/*` | 11 | 登录、会话、账号及维护 |
| `/api/agent-schedules/*` | 10 | 本人调度授权及后台只读桥 |
| `/health`、`/api/review-mode` | 2 | 运行状态、验收副本标识 |
| 合计 | **378** | 按规范方法 + 路径去重；不另计 HEAD 兼容行为 |

**47 是处理器文件分组数，不是页面数或独立业务模块数；238 个 POST 也不等于 237 个通用写接口。** 导入、上传、预览、审批、状态流转、授权配置都包含其中。

完整逐项表见 **[工作区接口清单](api-inventory/workspace-endpoints.md)**；机器可读证据见 **[接口索引 JSON](api-inventory/workspace-endpoints.json)**。每项都有方法、action、动作索引、处理器位置、分发链及可找到的页面引用。

按用户确认的左侧 10 个分组，后续整理见 **[部门工具适配表](api-inventory/department-tools.md)** 和[分组配置](api-inventory/department-mapping.json)。其中保留跨部门共用接口，并将 14 类流程、12 类业务资料/单据、6 类客服记录按具体类型归组；当前是静态接入方案，尚未注册运行工具。

本清单是静态源码索引，不代表服务器已部署当前版本。源码清点不等于接口线上已开放、权限测试通过或 Agent 已接通。

## 2. 业务能力覆盖表

下表按业务归并，帮助决定下一步工具映射。“新增/修改”只表示已有对应业务路径，不代表任意账号、任意字段均可操作；同一 `save` 是否新增由 ID、版本及处理器规则决定。“无独立入口”不代表应新增删除接口，更不代表业务缺陷。

所有工作区 action 均以 `/api/workspace/` 为前缀。表中列代表接口，全部接口仍以逐项清单为准。

| 业务范围 | 查询 | 新增/登记 | 修改 | 删除、撤销或退出机制 | 必须保留的专用动作 |
| --- | --- | --- | --- | --- | --- |
| 订单总表、原表工序 | `data`、`job`、`read-version` | `preview → commit-import`、`ledger-preview → ledger-commit` | `edit-order`、`ledger-edit`、`drawing-correction` | `ledger-lifecycle` 归档/恢复；无通用物理删除入口 | `review`、`workflow`、`pack`、`match`、`ledger-assign` |
| 客户主档、工厂订单 | `customer-master-capabilities`、`factory-orders` | `customer-save`、`customer-import`、工厂订单保存/表格导入 | `customer-save`、`factory-order-save` | 通过既有状态/保存规则；无独立通用删除入口 | 模板上传、表格预览/提交、金蝶导出 |
| 供应商、外协、收货 | `data` 聚合、供应商导出/报价文件 | `supplier-save`、`outsource-create`、`receipt-photo → receipt-confirm` | `supplier-save`、`outsource-update`、报价保存 | `outsource-cancel` | `outsource-approve`；收货数量/工序联动 |
| 采购跟单 | `purchase-data/history/export/held` | `purchase-preview → purchase-commit` | `purchase-save`、`purchase-receipt` | `purchase-archive`；无通用物理删除 | 来源版本、分批导入、收货/退货核算 |
| PMC 核单 | `pmc-data` | `pmc-round` | `pmc-save` | 无独立删除入口 | `pmc-review` |
| 成品供应商协作 | `finished-supplier-data/file` | `finished-supplier-task-create/attachment` | 复期、进度、异常等专用动作 | 结单 `finished-supplier-close`；退货不是删除 | 接单、基线确认、质检、收货、返工、入仓 |
| 金蝶待核对 | `kingdee-pending-data/file` | `kingdee-pending-preview → kingdee-pending-commit` | 来源快照经确认增量登记 | 无独立删除入口 | 不代表金蝶/MES 实时写接口 |
| 金蝶采购只读查询 | `kingdee-readonly-status/query` | 无 | 无 | 无 | 鉴权后只读查询采购列表与商品行，不生成中台快照或业务关联 |
| 部门流程记录 | `process-data/history` | `process-save` | `process-save` | 状态遵循各流程 schema；无独立通用删除 | 多记录类型共用入口，按 type 校验 |
| 计划与产能 | `planning-control-data/history` | 计划、产能窗口、分配的 save | 对应 save | 通过 transition 允许的状态变化 | 计算保存、计划/分配状态流转 |
| 损耗 | 总表数据、`loss-export` | `loss-record` | 用确认记录增减更正 | 无独立删除入口 | 部门确认、月度口径 |
| 工程画图 | `drawing-data/history` | `drawing-import/detail-add/email-intake`、`drawing-save` | `drawing-save` | 无独立通用删除入口 | 图纸审核、邮件事件审核 |
| 工程 SOP | `sop-data/history/file` | `sop-create/change/attachment` | `sop-target/prepare` | `sop-cancel` | MES 上传登记与确认，不等于直接写 MES |
| 客服业务 | `service-data/history/file` | `service-save/attachment/receipt` | `service-save` | `service-receipt-reverse` 撤销收款记录 | 收款与附件分别校验 |
| 客户报价、模板、历史价格 | `customer-quotes`、版本、模板、原件、历史价格 | 报价保存/上传、模板登记、历史价格导入 | 报价保存/修订、模板应用、来源选择 | `customer-quote-template-archive`；不物理删除报价历史 | 确认、已发送登记、授权配置、成品导出 |
| 客户档案、文件、待办 | `customer-workflow-data/history/files/tasks` 等 | 跟进、日程、任务、原件、轻量项目登记 | 档案/文件信息/任务/项目保存 | 由对应保存状态控制；无统一删除入口 | 银行资料与普通字段权限不同 |
| 客户公海与交接 | `customer-workflow-transfers` | 交接、入公海申请、领取申请 | 主负责人及授权状态流转 | `cancel-handoff`、`pool-withdraw` | 审批、拒绝、指定销售本人接收 |
| 客户项目、样办、协作 | `customer-project-data/history/file`、`project-collaboration-data` | 项目、明细、轮次、任务、附件、样办 | 各 save、分工、进度、关联 | `customer-project-trash/restore`、图纸撤回、协作任务取消 | 样办下达/复期/寄送/签收；任务提交/审核 |
| 项目跟进与历史邮件 | `customer-project-followup-data/history/source-file` | 跟进保存、历史导入 | 跟进保存、邮件归类 | 无独立删除入口 | 转为正式项目；历史导入仅管理员 |
| 项目财务 | `project-finance-data/history`、单据打印 | 费用、财务条目、收款通知、单据、售后/退款申请 | 对应 save、修订及调整 | 收款冲销、核销释放、退款取消 | 核实、核销、费用确认、退款执行；不能用普通字段改状态代替 |
| 应收、发票、对账、付款条件 | 应收视图、发票/对账单原件、客户模板、付款条件 | 发票导入、凭证、对账单、客户模板及付款条件登记 | 来源关联、扩展字段、备注、里程碑 | `payment-terms-disable`；账务记录无通用删除 | 单据审核/签发、对账、授权负责人配置 |
| 业务交接与单据 | `handoff-business-data/history/file/print/review-data` | 保存、生成、附件 | 保存、定金声明等 | `handoff-business-return` 是退回阶段，不是删除 | 提交、确认、生产采纳签署、规则配置 |
| 渠道、知识、通知、人工沟通 | `framework-channels/knowledge/notices`、上下文/历史、沟通草稿视图 | 账号/消息/草稿登记 | 配置、消息关联/绑定/处理、草稿保存 | 沟通退回；知识无独立 CRUD 写入口 | 通知签收、草稿提交/完成审核；不等于外部发送 |
| 财务任务、离职交接 | 财务任务/历史/汇总、交接清单 | 财务任务保存、离职交接草稿 | 阶段动作及保存 | 财务任务取消、离职交接取消 | 指定接收、退回、审核、交接完成 |
| 固定数据工具 | `fixed-data-tools`、任务/文件/报价 | 工作簿核验、归属核验、费用预览结果 | 费用决定按现有授权执行 | 无独立删除入口 | 只读业务处理也可能保存任务、结果文件及审计 |
| 成员、权限及运行维护 | 成员聚合、业务组、账号/历史/维护视图 | `/api/auth/accounts` 创建账号 | `member`、模块专用授权配置 | 停用按账号/成员规则；无账号物理删除接口 | 密码、会话、备份不能当普通业务字段交给模型 |

## 3. 原生服务接口逐项清单（23 项）

这些不经过工作区动态路由。源码为 [standalone/server.mjs](../standalone/server.mjs)、[standalone/auth.mjs](../standalone/auth.mjs)、[调度桥](../standalone/agent-schedules.mjs)。

| 方法 | 路径 | 用途 | 身份与范围 |
| --- | --- | --- | --- |
| GET | `/api/auth/session` | 返回公开会话摘要 | 允许返回未登录状态；不返回密码或会话令牌 |
| POST | `/api/auth/login` | 登录 | 凭据核验、限流、入口人员限制 |
| POST | `/api/auth/logout` | 注销 | 撤销当前会话 |
| POST | `/api/auth/password` | 修改本人密码 | 当前会话、原密码核验；注销旧会话 |
| GET | `/api/auth/maintenance` | 运行/备份状态摘要 | 已改初始密码；管理员或程序员 |
| GET | `/api/auth/accounts` | 账号列表 | 已改初始密码；管理员；不返回密码散列 |
| POST | `/api/auth/accounts` | 创建账号 | 管理员；角色/人员类型/客户/部门等校验 |
| GET | `/api/auth/history` | 登录历史 | 管理员；查询参数校验 |
| POST | `/api/auth/reset` | 重置账号密码 | 管理员；撤销既有会话 |
| GET | `/api/auth/backup` | 最近备份摘要 | 管理员 |
| POST | `/api/auth/backup` | 触发备份 | 管理员；属于维护动作，不在本次执行 |
| GET | `/api/agent-schedules/status` | 桥状态与最长授权期 | 当前内部有效账号；桥需启用 |
| POST | `/api/agent-schedules/grant` | 创建本人范围授权 | 当前账号、工作流版本、范围、条件及日历；重验业务读取 |
| POST | `/api/agent-schedules/revoke` | 撤销本人授权 | 当前账号、工作流及可选授权 ID |
| POST | `/api/agent-schedules/service/probe` | 服务身份探测 | 独立服务身份 |
| POST | `/api/agent-schedules/service/lease` | 后台租约申请/续约/释放 | 服务身份、worker 与递增编号 |
| POST | `/api/agent-schedules/service/owners` | 当前有效授权人 | 服务身份、有效租约；逐账号核验 |
| POST | `/api/agent-schedules/service/catalog` | 被授权数据目录 | 服务身份、租约、当前有效授权及账号权限 |
| POST | `/api/agent-schedules/service/schedule` | 日历匹配的只读结果 | 同上；有数量及大小上限 |
| POST | `/api/agent-schedules/service/verify` | 核验来源是否仍有效 | 同上；核对当前来源 |
| POST | `/api/agent-schedules/service/query` | 在授权范围内查询 | 同上；限定模块、对象、范围和字段 |
| GET | `/health` | 服务存活摘要 | 先通过原生网络/Host 或代理入口检查 |
| GET | `/api/review-mode` | 只读验收副本标识 | 同上 |

方法说明：原生入口全局仅接受 GET/POST/HEAD，POST 要求同源 Origin。工作区 HEAD 进入 GET 分支；`/health` 分支没有独立方法限制，因此它也接受全局允许且通过相应检查的方法。上述统计按建议使用的规范动作计数，不把方法兼容分支重复算成业务能力。PUT/PATCH/DELETE 不是本项目原生 CRUD 的 HTTP 入口。

供应商入口还使用自己的白名单，只允许 `finished-supplier-data/file/accept/progress/promise/exception/shipment/rework-confirm/attachment` 等指定动作；有处理器不代表供应商可调用全部成品协作动作。只读验收模式另行拒绝业务 POST。

## 4. 权限入口与请求形态

现有主链路：

1. 原生网络/Host 或代理来源检查、同源 Origin 检查。
2. `session()` 核验当前账号、有效期、停用与入口身份；要求修改初始密码。
3. 可信身份经 `context.run()` 传入工作区，`actor()` 获取实际成员。
4. 模块处理器检查角色、客户/业务组/部门/任务范围、字段权限和当前业务状态。
5. `commit()` 校验工作区修订号；很多模块另有记录版本、请求 token、审计和回读。

对应源码：[原生入口](../standalone/server.mjs)、[会话](../standalone/auth.mjs)、[工作区路由](../app/api/workspace/%5Baction%5D/route.ts)、[状态与提交](../lib/store.ts)、[基础权限](../lib/domain.ts)、[业务组投影](../lib/business-team-scope.ts)。不同动作使用的具体保护并不完全相同，不能把“已有通用链路”当成所有 378 项均已通过越权/幂等验收。

| 形态 | 已发现情况 | 下一步工具适配需要保留 |
| --- | --- | --- |
| GET 查询 | 综合数据、按 ID 的详情/历史、能力、文件/导出 | query 参数、客户/业务组范围、行与字段裁剪 |
| JSON POST | 保存、状态、授权、审核、导入提交 | 各动作 schema；ID、version、token 等不能统一猜测 |
| multipart POST | 附件、原表、凭证等 | 文件类型/大小、原件哈希、归属、附带表单字段 |
| 文件响应 | XLSX、PDF、图片、JSON 归档等 | 不能作为普通 JSON 记录工具处理 |
| 分批/多阶段 | preview → commit、提交 → 审核、申请 → 执行 | 原动作顺序、版本及范围必须保留 |

原生请求体上限按路由区分，默认 11 MiB，部分迁移/附件路由为 21、25、51、65、80 MiB；处理器还会限制实际文件大小。具体字段及限制以源码/schema 为准，本次未将其转换为可执行 OpenAPI 或工具输入规范。

## 5. 本次发现的接入缺口

1. **不是没有业务接口，主要缺统一工具映射。** 已有 351 个工作区动作，下一步应逐项映射，而不是另建通用数据库 CRUD。
2. **查询常是综合视图，不是每种记录一个接口。** `data` 已包含订单、报工、供应商、外发、收货、附件、评论、成员、审计等授权集合；不能因没有单独 `/comments` 就认定没有评论读取能力。模型侧仍需明确数据集及字段。
3. **没有全局通用删除入口。** 已有项目回收站/恢复、归档、停用、取消、冲销等不同机制。知识文档等内容没有独立新增/修改接口。把这些标为“原生不提供/专用动作”，不能为了凑齐 CRUD 直接清除原记录。
4. **“预览”不保证零持久化。** `ledger-preview`、`purchase-preview` 等会保存来源文件和导入批次；固定工具的业务只读操作也会保存独立任务/结果。因此工具说明需要分别描述“是否改变业务记录”和“是否保存批次/文件/审计”。
5. **GET 也不能直接视为绝对无副作用。** `customer-quote-template-export` 在具备相应维护权限且没有缓存时会生成并归档成品文件。见[模板导出处理器](../lib/customer-quote-template-api.ts#L59)。下一步接入前应将这种生成/归档行为明确标记，不能当成纯读取。
6. **一个保存接口可能覆盖多种操作。** `process-save` 按 type 处理不同流程，`save` 类常按 ID 判断创建或更新。不能只按接口名字决定新增/修改范围。
7. **身份与权限不能从浏览器按钮推断。** 供应商白名单、财务只读、银行资料、核价内部字段、客户责任、指定接收人及任务审核是不同层次的限制。前端可见按钮只是引用证据。
8. **业务字段契约仍需逐接口提取。** 本次完成路径/动作/处理器/页面引用及权限入口清点；下一步才生成工具所需的精确入参、返回数据集和变更确认规则。未完成的工作不标为已接通。

Agent 接入边界沿用已核对的测试分支 `fa7d292`：真实模式工具目前提供目录、授权记录读取和工作流辅助，不提供完整业务写回工具。该结论是源码状态，不是服务器当前镜像核验。

## 6. 清点方法、验证与复用

使用可复用静态工具 [audit-api-inventory.mjs](../scripts/audit-api-inventory.mjs)。它读取 TypeScript AST，追踪主路由及二级处理器，展开允许列表、schema 键、动作映射、前缀拼接和后缀分发。不会导入业务模块、访问数据库、启动服务或发出 HTTP 请求。

```powershell
node scripts/audit-api-inventory.mjs
node scripts/audit-api-inventory.mjs --check
```

当前静态检查覆盖 87 个方法/处理器组合，无法展开的已识别允许列表为 0；页面固定工作区 URL 未匹配项为 0。另有 4 组页面动态前缀，已保留在 JSON 中并对照相应处理器核查。对包装函数的 action 字符串也保留引用，但没有逐一执行页面。

初次清点时另用独立遍历对照 221 处处理器中的 action 字面量比较，均能在当时索引中找到对应方法及动作；当时 336 个方法/action 键无重复，所有处理器证据文件存在，保留 561 处精确字符串引用，86 项没有精确页面引用。上述引用统计是初次清点记录，当前范围以生成的 JSON 为准；动态前缀调用和维护入口不能据此标成接口缺失或无人使用。流程确认后，本次再补入 5 个采购确认接口并重新生成清单。

边界：

- 统计包含中台当前主入口及原生运行入口；排除 `examples/` 演示、测试端点、静态页面/资源和独立 Agent Studio 管理 API。Studio 是调用方，本次目标是中台提供的能力。
- 静态工具不是通用控制流/权限证明器；新增动态分发写法需人工复核。源码哈希覆盖参与解析的文件，不是整个仓库完整性证明。
- 初次清点仅调整文档和扫描脚本；后续新增固定流程与采购确认接口，另按项目规则执行业务回归、类型检查及隔离构建／HTTP 验证，详见[流程确认接口](process-change-confirmation.md)。不运行正式接口或生产维护脚本。
- 未构建、覆盖或重启 8787，未修改 `lan-data`、账号、权限、附件、调度配置，也未同步生产备份。
