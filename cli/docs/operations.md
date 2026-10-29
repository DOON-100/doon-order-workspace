# 生产、品质、仓储与交付

CLI 0.36.0累计324条登记命令。原查询保留；W6新增40条，W7新增10条发运登记/物流跟进及结单命令，并扩OQC/包装/出货放行和生产出货来源单据。金蝶继续暂缓，财务按W8继续。

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

客户端分页不会减少服务器现有接口的数据读取。正式使用前需在真实员工电脑及目标服务器验证权限与兼容性。

## W6固定程序

| 命令组 | 新增入口 | 数据及权限边界 |
| --- | --- | --- |
| `operations ledger` | schema/form/history/save | 服务器按部门返回可编辑原表列；保存指定patch及订单版本，AP/BB自动日期不手填，损耗携带patch也必须满足原投产门禁 |
| `operations losses` | schema/list/form/history/save/export | 独立累计损耗及冲减链；source=balance或mes、previousId、订单version与UUID；MES仅凭证，不向MES外呼 |
| `operations reports` | schema/form/history/action/import-preview/import-show/import-commit/source-download | match/correction/review按报告/源订单/更正版本；原件导入可改变报工数量，更正申请/审核本身不改变报工数量 |
| `operations corrections` | list/form/history | 待审核、待MES人工处理与导出回读已核验分别表达；原报告需新导入值一致且已审批才可核验 |
| `operations receipts` | schema/file-upload/save/file-download | 原工序外发收货，校验送货凭证、外协及源订单双版本、UUID/角色/数量；不是采购明细核数 |
| `quality records` | schema/list/form/references/history/save | --type iqc/first-article/process-quality/outsourcing-quality；按原部门、客户、订单、业务组和负责人权限 |
| `warehouse records` | 同上 | --type material-kit/warehouse；独立齐料及仓储凭据，不自动过账库存或派工 |
| `operations finished` | 扩展action/schema，新增files/file-upload/file-download | 员工receive/qc/stock/return/close；任务版本与UUID，stock/return/close还核源订单版本，附件核字节数和SHA-256 |

```powershell
doon operations ledger form ORDER_ID --json
doon operations ledger save --input process.json --version CURRENT_ORDER_VERSION --json
doon operations losses schema --json
doon quality records schema --type iqc --json
doon quality records save --type iqc --input inspection.json --version 0 --request-id UUID --json
doon warehouse records save --type material-kit --input kit.json --version CURRENT_VERSION --request-id UUID --replace-details --json
doon operations finished action --type receive --input receipt.json --version CURRENT_TASK_VERSION --request-id UUID --json
```

先获取schema/form/references准备UTF-8 JSON。流程记录的details默认按键合并；明确需要把旧已知值改回未知时，用`--replace-details`并提供完整目标details对象，省略的数字恢复未知，不以null代替数字，也不把未知当0。类型/客户/订单/业务组不可改绑。完成仍需实际日期、依据、负责人、合法关口及数量关系；取消和恢复是留痕的状态维护，不删除历史。

MES `import-preview`会保存原件和预览，归business-write，不是只读试运行；`import-commit`绑定原件摘要、批次范围、选择和版本。没有手工report create或直接改写报工数量命令。建议数量经MES更正申请、审核后仍需实际MES人工处理与新的导出文件，CLI不联系MES。固定处理器校验后回读来源和目标；无权限或旧版本时停止。

成品任务必须已经由供应商接单并且期初合法。receive只登记收货，qc分开记合格/不良，stock仅合格且未入仓部分并按原规则回写BF/BG；return分别核对批次或期初库存，close需欠数、在途、待检、待入仓及返工均清零并满足源BF。production可收发但不能用管理员结单权限；服务器每次重放也重新校验当前动作角色。供应商专属accept/promise/progress/exception/shipment/rework-confirm继续在既有门户完成，员工不能代行。

附件上传先检查服务器完整性契约，上传下载均核对不可变id、任务/原件归属、字节数和摘要，下载只新建文件。核数、外协收货、仓储凭据、库存及品质是不同记录。所有动作沿用原权限和业务门禁；CLI不新增对话确认或真实外发。连接中断、写后回读失败先查原动作；无UUID契约的原表单元格保存不宣称自动去重。

## W7交付记录与单据

- `quality records --type oqc`和`warehouse records --type packaging/shipment-release`复用schema/list/form/references/history/save。检验三数及完成依据、包装数量/箱数/规格/装箱单引用、放行物流/放行依据由原服务器校验；流程凭据不会自动过账库存或判定已发运。
- `service shipments schema/list/references/form/history/save/files/file-upload/file-download`维护发运与物流跟进。新增version=0，修改用当前版本及UUID；有关联订单必须额外`--order-version`。更新仅指定字段并按原历史版本重建合法重放，服务器核权限、版本、订单来源及团队范围；旧服务器无协议标记时写前拒绝。
- 发运details使用invoiceNo、quantity、shipDate、carrier、trackingNo、packingNote；status=open/done/cancelled。新增跟进可只填customerId，标题自动生成，数量和日期未确认时可省略；done必须填写正整数quantity及实际发运日期，同订单所有done分批合计不得超原数量。取消/重新打开是台账状态维护，不等于承运商撤单。没有承运商查询、真实发送或客户签收字段，不猜测物流状态。
- `operations ledger schema --type lifecycle`及`lifecycle --input <file> --version <number>`复用原结单/恢复。输入id、mode=active/archived、reason，归档需closedDate。成品文员只能办理足量入仓后的正常结单；PMC/管理员才可特殊结单和恢复。无UUID契约，不自动重试。包装入仓仍是W6原表BF/BG，启用成品协作的订单不得绕过其专用入口。
- `service documents`现支持`--kind source --type production_shipment`；references提供精确发运记录id/version供只读来源引用。装箱单/运单无价格，Invoice另需当前PI版本、行映射与累计数量限制。原件及来源版本保留，资料内容checked不等于已经发送、承运商收件或客户签收。

```powershell
doon service shipments references --customer CUSTOMER_ID --json
doon service shipments save --input shipment.json --version 0 --order-version CURRENT_ORDER_VERSION --request-id UUID --json
doon operations ledger schema --type lifecycle --json
doon operations ledger lifecycle --input archive.json --version CURRENT_ORDER_VERSION --json
doon service documents references --kind source --type production_shipment --customer CUSTOMER_ID --json
```

业务成员编号从references取得；`whoami.identity.id`是登录身份，不能擅自用来代替memberId。附件按记录、客户、字节数与SHA-256核对，下载不覆盖已有文件；上传接口无UUID时先查目录再核查中断结果。
