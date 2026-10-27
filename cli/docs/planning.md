# PMC、采购、供应商与外协

CLI 0.34.0 在既有查询上接入 W5 排期、计划/齐套、有限产能、采购跟进/核数、供应商/报价、外协和成品协作准备。权限、业务状态及最终数量由服务器校验；命令不新增对话确认。以下查询继续可用。

| 命令组 | 动作 | 数据含义 |
| --- | --- | --- |
| planning rounds | list / show | PMC或管理员可见的最近核对轮次及轮次内审核状态；默认内部生产，可用 `--scope external` 查询成品外发范围 |
| purchasing purchases | list / show / history | 已授权采购明细、采购事件和最多最近50条编辑摘要 |
| purchasing outsource | list / show | 已授权订单关联的外协单 |
| purchasing factory-orders | list / show | 已授权订单关联的工厂内部订单各版本；状态说明当前是否已下发 |

```powershell
doon planning rounds list --scope internal --team TEAM_ID --json
doon planning rounds show ROUND_ID --scope external --json
doon purchasing purchases list --team TEAM_ID --search SUPPLIER --json
doon purchasing purchases history PURCHASE_ID --json
doon purchasing outsource show OUTSOURCE_ID --order ORDER_LINE_ID --json
doon purchasing factory-orders show FACTORY_ORDER_ID --json
```

替换示例编号。所有命令支持业务组 `--team`、客户端分页 `--limit/--offset`，列表支持搜索；外协与内部订单支持精确订单明细 `--order`。服务器必须回显已应用的业务组；采购历史在当前授权列表内核对记录后再访问服务器，编辑摘要由现有接口限制为最近50条，不能视为完整编辑历史。

采购 `balanceKnown=false` 表示余额尚未核对，CLI 将已收和退货待补显示为 null；余额已核对时才原样显示数值0或其他数值。不将供应商复期、预计到货和实际收货混为一谈。采购来源原表字段不在详情中展示；不能根据未核对余额推断齐货。

PMC轮次接口仅返回各人员指定生产范围的最近轮次，并非完整历史。工厂内部订单返回现有每个版本，不把未下发状态当作已下发；外协的审批状态和已收数量按原记录展示。结果不包含导入原表及存储键。分页在客户端执行，服务器仍读取原接口集合。

W3 已接内部订单确认/下发；W5 的写入见下表。真实员工权限、客户端升级及正式分发按 W11 验收。

| 命令组 | 新动作 | 保存与权限 |
| --- | --- | --- |
| `planning orders` | `schema/form/save` | 当前订单版本、指定排期/物料/异常/交期字段；原网站 PMC 交接门禁 |
| `planning pmc` | `schema/save` | U、AB、AC、AD、AE、AF 指定单元格；按字段并发合并，不覆盖同事其他修改；自动日期由固定程序计算 |
| `planning rounds` | `schema/start/review` | 本人内部/外部生产范围轮次；新增 UUID 绑定完整范围，核对进度绑定当前订单版本 |
| `planning control` | `schema/references/list/form/history/save/action` | `--type record/calculation/window/allocation`，9 场景、27 模块；独立计划、齐套依据、测算、产能窗口及分配，不自动派工或扣库存 |
| `purchasing purchases` | `schema/form/save/action` | 跟进仅指定变更字段；核数按当前版本与 UUID 去重；齐货存档逐项携带版本，保留原件和事件 |
| `purchasing suppliers` | `schema/list/form/save` | 主档新增版本 0，修改带 id 与当前版本；停用保留原记录 |
| `purchasing supplier-quotes` | `schema/list/form/history/save/files/file-upload/file-download/template/export` | 原价格权限；修订追加版本不覆盖旧报价；当前版本和 UUID 在服务端原子校验；原件保存与报价录入分开 |
| `purchasing outsource` | `schema/form/references/history/action` | `--type create/update/approve/cancel`；新增核对源订单版本及 UUID，跟进/审批/取消核对外协版本，主管身份仍由服务器决定 |
| `operations finished` | `schema/form/references/action` | 本批仅员工 `order-confirm/task-create/baseline-confirm/baseline-stage`，独立任务及期初核定；不实际向供应商发送 |

先运行对应 `schema` 与 `form` 获取允许字段、必填项和版本，再准备 UTF-8 JSON 文件。例如：

```powershell
doon planning control schema --type record --scenario SCENARIO_ID --module MODULE_ID --json
doon planning control save --type record --input plan.json --version 0 --request-id UUID --json
doon purchasing purchases schema --type followup --json
doon purchasing purchases save --input followup.json --version CURRENT_VERSION --json
doon purchasing purchases action --type receipt --input receipt.json --version CURRENT_VERSION --request-id UUID --json
doon purchasing outsource action --type approve --input approval.json --version CURRENT_VERSION --json
```

采购 `save` 输入为 `id` 与一个或多个 `promisedDate/expectedDate/nextFollowupDate/followupNote`。原接口支持同字段未变化时的旧版本合并，并非整行版本锁；没有请求标识去重。采购 `action --type opening/correction` 输入 `id/quantity/date/reference/note`，可选 `returnPending`，省略时按 0；`receipt/return/replacement` 不接受该字段。数量最多四位小数；核数使用原始 UUID、原版本和完整原输入重放，不自行换新编号重试。`archive` 输入 `{items:[{id,version}],date,note}`，不提供 `--version` 或 `--request-id`；必须已审核、未关闭、已齐货且无待补。已存档实际退货会按既有规则恢复跟进。采购核数不等于仓库库存或质检放行。

产能分配确认/取消与计划推进/退回/归档/恢复使用独立 `action`。负责人可编辑的进度字段、状态条件、来源订单版本及可用产能由服务端重算；计算结果保留分母未知与数值 0。供应商报价修订以 `quoteGroupId` 和当前版本追加，数组与嵌套对象以各 `schema` 说明为准。`supplier-quotes file-upload` 只保存原报价证据，不调用模型提取；下载核对 SHA-256 且不覆盖已有文件。

金蝶采购源表 `purchase-preview/commit/held` 继续暂缓：预览会保存批次及原件，不能称为只读试运行。既有 `purchase-change-*` 是网站提案确认流程，CLI 不读取或传递该批准，也不以聊天记录伪造批准。员工直接请求使用上述原业务接口；模型业务提案若仍需要既有人工审批，应在现有受控入口完成。成品供应商接单/复期、进度、收发、质检和入仓按 W6 继续，员工 CLI 不接受供应商账号。

无 UUID 契约的操作不宣称自动去重。连接中断或回读失败会标记结果未知；先查询原记录/历史，客户端不会自动重试。新增轮次/报价/外协的兼容契约未就绪时，在写入前要求更新服务器。提交推送与部署分开，现有服务器尚未更新时相应新能力不能直接使用。
