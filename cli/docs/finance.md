# 批次 6：财务、对账与售后查询

CLI 0.7.0 新增12条查询命令，总计88条已支持命令。沿用服务器现有员工、客户与业务组权限；不提供确认收款、核销、调账、退款、审批、发送或其他财务写入。

| 命令组 | 动作 | 记录及范围 |
| --- | --- | --- |
| finance records | list / show / history | 指定类型的项目财务记录，须传 `--kind` |
| finance receivables | list / show / history | 客服工作台的应收账款及核算余额 |
| finance reconciliations | list / show / history | 供应商对账流程记录 |
| finance complaints | list / show / history | 客诉流程记录 |

项目财务的 `--kind` 支持：`charges` 收费、`receipts` 收款、`allocations` 分配、`adjustments` 调整、`creditApplications` 抵扣、`documents` 单据、`notices` 付款通知、`cases` 售后、`costs` 售后费用、`refunds` 退款、`requirements` 付款要求、`sends` 发送留痕、`reversals` 收款冲销。拼写区分大小写，不能用任意集合名。

```powershell
doon finance records list --kind charges --customer CUSTOMER_ID --team TEAM_ID --json
doon finance records show CHARGE_ID --kind charges --project PROJECT_ID --json
doon finance records history RECEIPT_ID --kind receipts --json
doon finance receivables show RECEIVABLE_ID --json
doon finance reconciliations list --team TEAM_ID --json
doon finance complaints show COMPLAINT_ID --json
```

替换示例 ID。所有查询支持 `--team`、精确客户档案 `--customer`、客户端 `--limit/--offset`，列表支持搜索；项目财务还支持精确 `--project`。部分收款等记录本身没有项目 ID，按项目筛选时不会通过猜测关系补入。业务组须由服务器回显确认；历史先核对当前授权列表，再由服务端重新授权，并验证记录与客户绑定。涉及业务组或项目筛选时，也核对历史项目绑定；业务组筛选时核对历史显式组绑定。

名称以 `Cents` 结尾的金额单位为币种的最小单位（例如美元分）；币种和原始数值分别保留，不跨币种合计或将未知值当成0。项目财务的 `net` 是现有服务端结果；`draft`、`independent`、`pending`、`confirmed` 等状态必须与金额一起核对。草稿或独立待核对记录不能当作已确认收入、已实际退款或已核销。应收记录的已收和余额由服务端计算，既有退款、冲销及分配保留独立事实。

输出省略结构化银行账号、付款人字段及原始历史快照；备注和凭据说明等自由文本仍按获授权原文展示，可能包含员工录入的信息。项目财务、客服应收与历史财务总账属于不同模块，CLI 不将其自动合并或把某一结果当成公司全部财务。历史账龄总账、历史发票原件/对账文件和新增报表导出暂缓。分页在客户端执行，服务器仍读取原接口集合。正式使用前需验证目标服务器版本和真实员工权限。
