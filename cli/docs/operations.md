# 批次 5：生产、品质、包装与交付查询

CLI 0.6.0 新增17条查询命令，总计76条已支持命令。沿用现有员工登录、服务器授权及记录类型；本批不提供生产报工、质检确认、包装入仓或发货写入。

| 命令组 | 动作 | 记录及范围 |
| --- | --- | --- |
| operations reports | list / show | 已授权订单关联的生产报工 |
| operations finished | list / show / history | 成品外发任务、阶段、在途/收货/检验/入仓/返工及事件摘要 |
| operations quality | list / show / history | 指定类型的检验记录 |
| operations packaging | list / show / history | 包装核对记录 |
| operations releases | list / show / history | 出货放行记录 |
| operations shipments | list / show / history | 客服发货记录 |

```powershell
doon operations reports list --team TEAM_ID --order ORDER_LINE_ID --json
doon operations finished show TASK_ID --team TEAM_ID --json
doon operations quality list --type iqc --customer CUSTOMER_ID --json
doon operations packaging show PACKING_ID --json
doon operations releases show RELEASE_ID --json
doon operations shipments history SHIPMENT_ID --json
```

替换示例编号。质检必须指定类型：`iqc`（来料）、`first-article`（首件）、`process-quality`（过程）、`outsourcing-quality`（外协）或 `oqc`（成品）。所有查询支持 `--team`、精确订单明细 `--order`、客户端分页 `--limit/--offset`，列表支持搜索；质检、包装、放行和发货还可指定客户档案 `--customer`。服务端必须回显已应用的业务组；历史先核对当前授权列表及记录、客户、订单、类型和版本，再由服务端重新鉴权。

成品任务期初未核定时，入仓、在途、待检、待入仓和剩余余额可能为 null，不能当成0；供应商发出、公司收货、质检合格和入仓数量各自独立。阶段完成数与期初数分别保留。任务事件只展示摘要，不展示附件内容或原始事件载荷。

包装核对是业务记录，不等于包装已经入仓；出货放行记录不等于实际出货；客服发货记录处于未完成状态或实际发货日期为空时，不能称为已出货。生产报工的审核状态按原值展示。历史只展示操作摘要，省略原始快照。

客户端分页不会减少服务器现有接口的数据读取。新增/修改、质检判定、入仓、供应商交货、放行和发送等业务写入暂缓；单据下载与缺少完整只读接口的历史也暂缓。正式使用前需在真实员工电脑及目标服务器验证权限与兼容性。
