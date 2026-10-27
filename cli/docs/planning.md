# 批次 4：PMC、采购与外协查询

CLI 0.5.0 新增9条查询命令，总计59条已支持命令。使用员工原有登录和服务器权限；本批不开放业务写入、审批、下发或供应商外发。

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

排期修改、采购导入/收货/退货、外协创建/审批和工厂生产资料确认/下发，以及尚无完整只读入口的历史暂缓。正式投入员工使用前需完成真实员工权限和服务器版本验收。
