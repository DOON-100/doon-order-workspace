# 批次 3：工程、样品和 IE 报价查询

版本 0.4.0 新增 12 个查询命令，总计 50 个已支持命令。使用员工原有登录及服务器权限；不提供审核、批准、提交、发送、上传、制造或其他业务写入。

| 命令组 | 动作 | 数据来源 |
| --- | --- | --- |
| engineering drawings | list / show / history | 画图需求、状态、审批信息及历史操作摘要 |
| engineering sops | list / show / history | SOP 与 MES 跟进任务及历史操作摘要 |
| engineering samples | list / show | 客户项目样品、样品范围和当前执行状态 |
| engineering ie-quotes | list / show / history / version | IE 报价、成本、审核状态及服务器授权的历史版本 |

```powershell
doon engineering drawings list --team TEAM_ID --customer CUSTOMER_ID --json
doon engineering drawings history DRAWING_ID --json
doon engineering sops show SOP_ID --json
doon engineering samples show SAMPLE_ID --project PROJECT_ID --json
doon engineering ie-quotes show IE_QUOTE_ID --customer CUSTOMER_ID --json
doon engineering ie-quotes version IE_QUOTE_ID 1 --json
```

以实际编号替换示例 ID。查询支持精确 `--customer`、客户端 `--limit` 和 `--offset`，列表支持 `--search`；样品支持精确 `--project`。图纸、SOP 和样品支持 `--team`，请求业务组时要求服务端回显已应用范围，历史先核对当前列表范围再由服务端重新授权。

IE 报价接口没有可靠的业务组筛选协议，本批不提供 `--team`；以服务器员工权限和可选精确客户 ID 为范围。IE 结果包含服务器授权查看的工程成本和计算依据，请按员工现有权限使用和保存。价格空值、零、未适用、需要核对事项、报价版本和审核状态保持原意，不由 CLI 推断审批结果。

图纸、SOP 历史只展示操作摘要，省略原始来源与历史快照；样品展示明确的款式 ID 和数量，省略付款与原始快照。IE 详细成本、材料、工序、外发与模具按服务器原结果展示；不将已发布工程报价等同于已确认客户报价。所有分页为客户端分页，详情子列表分别分页；服务端仍读取现有数据集合。

附件下载、SOP/MES 文件上传、样品维护、工程报价创建/复核/发布、对外发送和历史样品独立版本查询暂缓。已下载的 Windows 包按既有隔离验收工具逐条测试，临时服务器、数据和安装目录在测试后清理。


## IE报价写入（W2进行中）

`engineering ie-quotes schema|form <id>`提供字段和授权当前表单；`save --input <JSON> [--version <当前版本>]`新增或修改报价。修改JSON提供id和改变的顶层字段，版本为当前版本；未提供字段从授权当前表单保留，数组按完整内容替换。材料、工艺、外协、一次性费用及人工价格调整使用网站原有字段；精确计算、原因和来源签名校验由服务器承担。

`action --type submit|review|revise --input <JSON> --version <当前版本>`复用既有动作；review需id、decision（approve/return）、reason，其他需id。填报人与审核人分离、补充资料及修订规则保持有效。无客户端重复确认、无虚假请求幂等或自动重试。目录、物料名称维护、附件、模板及业务交接尚在W2后续清单。
