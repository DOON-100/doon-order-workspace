# 采购业务人工确认接口

本批开放采购跟进、收货、退货、退货补回、齐货存档五类操作。每份提案只处理一条明确的采购明细，可以同时修改该明细的多个跟进字段。复用原采购业务规则、原记录编号、来源列、事件与审计；不新增采购订单，不做原表导入、期初核定、更正或物理删除。

| operation | 输入 | 原业务动作 |
| --- | --- | --- |
| followup | id、version、fields：供应商复期／预计到货／下次催交／跟进备注 | purchase-save |
| receipt | id、version、quantity、date、reference、note | purchase-receipt 的 receipt |
| return | 同上 | purchase-receipt 的 return |
| replacement | 同上 | purchase-receipt 的 replacement |
| archive | id、version、date、note | purchase-archive |

日期使用 YYYY-MM-DD，数量必须大于零且最多四位小数。型号、供应商、采购数量、原表列及关联订单不属于可改字段。原采购维护权限保持不变，仍由 `broad` 和当前有效成员校验；工具分组及负责人名称不产生额外授权。

## 固定接口和事务

路径前缀 `/api/workspace/`：

- `GET purchase-change-contract`：固定协议 `doon-purchase-change-v1`、规则指纹、五个 operation、30 分钟有效期。
- `POST purchase-change-preview`：`{requestId,rulesVersion,payload,basis}`；程序生成 UUID，basis 保留来源位置、未知项和冲突。保存独立 `purchase_change` 预览，业务零写入。
- `GET purchase-change?id=UUID`：仅创建本人在当前维护权限内读取，返回完整提案、原值、固定程序计算的数量／状态效果，以及执行后的原记录和回执。
- `POST purchase-change-confirm`：只接收 `{id,digest,approved:true}`，不能覆盖预览载荷。
- `POST purchase-change-cancel`：只接收 `{id,digest}`；取消未执行提案，不撤销已经保存的业务。

流程与采购通过 `confirmed-change.ts` 共用身份、摘要、依据、来源、规则、有效期、确认、事务回执和查询机制，业务适配器由服务端静态登记。流程原接口和协议保留；规则指纹升级会使旧的待确认预览拒绝执行，须重新预览。已执行记录和历史保留。

采购适配器绑定当前明细、原始来源字段、已有采购事件和操作者记录。服务端重新运行 `buildPurchaseWrite`，同时核对计算效果与预览一致，业务明细、采购事件／原审计、提案完成状态与独立执行审计一次事务提交。相关来源、版本、权限或规则变化、未知项、冲突、超时均拒绝执行。

原采购页面也复用该执行计划，原批量保存、导入及单元格冲突规则继续保留。收退货请求令牌额外核对真实操作者与完整载荷（包含可选字段）；日期按原规则规范化后比较。同标识更换数量、遗漏已有待补基数或换操作者返回冲突，避免把不同请求误认为已成功。

## 数量和历史规则

普通收货不能占用退货待补数量；退货减少净合格已收量并增加待补；补货不能超过待补量；未知收货基数、未审核或已关闭来源拒绝收退货。已存档明细只允许实际退货，退货恢复跟进并保留原事件／审计。齐货存档必须已审核、已核对齐货且无退货待补。

这些行为更新本中台采购跟单和采购事件，不向 ERP 写入，也不替代财务或正式库存。凭证引用是人员提供的依据，程序不把引用文本当成已验证的附件事实。

## 验证和发布

`tests/purchase-change.mjs` 使用独立内存数据库及真实 API 路由，覆盖五类操作、原始列和附件保全、权限撤销、来源漂移、预览绑定、数量拒绝、取消／过期／未知项／冲突、事务回滚、并发及回执重查；已加入 `tests/run.mjs`。共享辅助程序只包含合成数据。

本轮仅开发和验证。提交不触发部署，不修改正式数据、账号、调度或服务配置。Agent 的工具、确认页面及独立开关在测试分支交付。
