# 财务、应收与结算

CLI 0.38.0登记366条，其中12条金蝶继续暂缓、本期354条非金蝶。保留W8新增37条及全部精度、权限、原件和回读保护；W9再新增5条投诉命令，项目财务按type复用售后、费用及退款处理。W9合并开发59组/14个实际入口通过，完整CLI、全站、独立HTTP、Windows成品及CI来源验收待办。

## 项目财务

`finance project schema/form/references/history/save/action/print`复用原项目财务处理器。保存类型为`charge`、`notice`、`document`、`entry-receipts`、`entry-allocations`、`entry-adjustments`、`entry-creditApplications`；动作包括收费确认、付款要求、正式到账核实/冲销、分配/释放、调账、抵扣，以及单据确认/修订/已发送事实登记。售后和退款见下方W9，授权维护仍按W10。

```powershell
doon finance project schema --type charge --json
doon finance project form RECORD_ID --kind charges --json
doon finance project save --type charge --input charge.json --version 0 --request-id UUID --json
doon finance project action --type receipt-verify --input receipt.json --request-id UUID --json
```

项目和客服金额输入为原币元的十进制字符串，最多两位小数；输出`amountCents`等为整数分。新建独立登记是待核实草稿，正式到账、分配和调账继续要求核实权限。更新使用服务器提供的`effectiveVersion`；历史版本缺省为1仅沿用原服务端明示契约。相同UUID/原载荷的重放从指定历史基础版本重建，不回填最新版本。单据打印指定版本；发送事实指定`expectedDocumentVersion`，保全原发送快照。已签发PI的收费、币种和计划继续锁定；调账、释放及冲销回读关联凭据。

## AR统一入口

`finance ar schema/list/form/references/history/save/preview/file-upload/file-download/export`使用固定`--type`和`--resource`。资源包含workspace、documents、bindings、invoices、imports、statements、files、profiles、master。保存类型包含来源绑定、负责人核对/开立/里程碑、发票备注/历史累计核对、statement、客户展示配置/扩展值/来源链接、历史总表精确选集登记及维护。导入和补证分别使用`invoice-import`、`invoice-proof`。

```powershell
doon finance ar schema --type invoice-reconcile --json
doon finance ar list --resource invoices --customer CUSTOMER_ID --json
doon finance ar preview --input selection.json --json
doon finance ar export --resource master --team TEAM_ID --output ar-master.csv --json
```

AR的`*Cents`输入直接使用整数分，`null`表示未知，零和原生允许的负贷项分别保留。历史累计核对只维护历史依据，不生成当期现金。精确选集总表预览只读，登记重新核对previewHash；来源绑定及里程碑指定源版本，来源链接指定目标版本。原件追加保留，重复文件成功亦绑定本次UUID；同UUID不同内容拒绝。

读取范围和导出范围分别计算。管理员与原业务组成员保留原范围导出权；显式grant同时需要该范围的read/export。`canExport`仅表示至少存在一个导出范围，具体见`exportCompany/exportTeamIds`；混合查询不能夹带只有读取权的另一组。CSV和生成/下载statement按来源逐行校验，原件证据下载保持已有读取权限。statement为冻结草稿，下载HTML不发送给客户。

## 付款条件、客服应收及供应商对账

`finance payment-terms schema/list/form/history/save/action --type authorize|disable`沿用草稿创建人和指定业务授权人。管理员配置身份不自动替代指定授权人。指定人员须仍符合在职admin/sales角色，AR readOnly优先；源版本派生保留原family/termVersion，已授权内容不覆盖。

`finance receivables`保留list/show/history，新增schema/form/references/revisions/save/action/files/file-upload/file-download。保存关联订单时提供`--order-version`，新建0、更新真实当前版本和UUID；到账及全额冲销各自独立。实际到账日期不得晚于上海当日，已收后币种/发票等保持原规则。金额历史以整数分精确重建元文本，未知不填0。

`finance reconciliations`保留查询，新增schema/form/references/revisions/save，固定复用`supplier-reconciliation`流程。销售有价格读取权仍不因此取得维护权；维护按原管理员/PMC/财务角色。该记录保存对账依据，不执行付款、开票或供应商消息。

## 执行与回读

字段、动作和权限以各自schema和原生处理器为准。金额不自动换汇或跨币种相加。身份、客户/项目/业务组、版本、UUID、来源及余额由服务器原子重核。原件按摘要下载到新文件，存储键和私有来源快照不进入常规输出。`READBACK_FAILED`或`outcomeUnknown`表示原动作待核查，应先读取原记录/请求；不得生成新UUID盲目重提。业务记账不是银行转账，事实登记不是邮件或ERP外发。


## W9 售后、整改和退款凭据

`finance project`沿用原7个命令名，新增保存类型`after-sale`、`cost`、`entry-refunds`以及动作`refund-request`、`refund-execute`、`refund-cancel`。先读schema与references，使用原客户/项目/轮次、订单及真实当前版本；原附件、客户回访和单据以服务端授权目录为准。

```powershell
doon finance project schema --type after-sale --json
doon finance project save --type after-sale --input after-sale.json --version 0 --request-id UUID --json
doon finance project action --type refund-request --input refund-request.json --request-id UUID --json
doon finance complaints schema --json
doon finance complaints save --input complaint.json --version 0 --request-id UUID --json
```

售后记录保留原数量、处理方式、状态、责任人、客户证据、执行备注、实际退回/完成/补发数量、物流号和客户接受字段。由有权限人员明确输入业务事实，不从完成状态自动填客户接受，不增加原处理器没有的数量或结案门槛。费用、独立退款草稿、正式退款申请、执行凭据和取消分别记录。执行按原核实权限、原到账可用余额、分配/释放、已退款额及流水约束重新核对；`bankTransferPerformed:false`表示只登记中台执行凭据，不调用银行付款。

`finance complaints`保留list/show/history，新增schema/form/references/revisions/save。投诉复用原`process-save`及当前客户/订单/业务组、负责人、期限、关口和证据规则；details默认增量，明确整对象替换用`--replace-details`。原因、整改、核验及原完成关口继续有效，原内部验证/不适用结案路径保留。客户确认文本的recorded只表示已登记文本，unknown保持待核实；完成、通过或回访完成不等于客户接受、退款或发货。

客户回访复用W1：`sales customers followup-add`仅客户关联，`sales followups create/update`支持客户/项目。投诉记录没有projectId/afterSaleId，回访没有complaintId/orderId/afterSaleId；原编号可作为inputBasis/documentRef/notes等文字依据保存，不伪造机器外键或自动闭环。原关联、创建信息、未知字段、历史版本及附件原件保留。UUID重放保持原内容和指定历史基础版本，撤权或回读失败仍按原核查规则处理。
