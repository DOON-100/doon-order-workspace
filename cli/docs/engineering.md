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

`action --type submit|review|revise --input <JSON> --version <当前版本>`复用既有动作；review需id、decision（approve/return）、reason，其他需id。填报人与审核人分离、补充资料及修订规则保持有效。无客户端重复确认、无虚假请求幂等或自动重试。目录、物料名称、附件、模板及交接命令见下文；W2整阶段验收记录以进度计划为准。


## 工程报价参考资料与业务交接（0.31.0）

`reference-schema/list/save --type catalog|preset|tooling`分别管理基价目录、工艺预设、稳定模具登记。保存新增用版本0，修改在JSON提供id并用当前版本，未提供顶层字段保留、数组完整替换。工程人员可用list的`--include-inactive`回读停用目录和预设；普通读取不会因此扩大范围。模具实际收费仍限服务器绑定的复核人员并须凭证，已收费记录不能直接撤销。

`names-schema`给出名称资料结构，`names-import --input <JSON> --version <当前版本> --request-id <UUID>`由管理员迁入独立名称资料。JSON的catalog包括sourceFilename、sourceSha256、entries；每行保留id、code、name、可选nameEn、sourceSheet、sourceRow。`names --search <文字> --limit <1-100> --offset <0-2000>`使用服务器分页。引用已保存报价的名称时保留catalogId、catalogVersion、entryId；改名须按网站规则清除旧引用。

`form <报价ID> --version <已发布版本>`返回有权查看的完整字段和handoffCandidates。`handoff --action push --input <JSON> --version <已发布报价版本>`的JSON是id（报价ID）、recipientMemberIds。服务器只允许下推最新已复核版本，收件人须已有该客户报价责任，并排除工程填报、复核和最终审批人员。`handoffs [交接ID] [--quote <报价ID>]`读取目录或详情；`handoff --action accept`的JSON只有id（交接ID），版本指交接记录版本，且必须由指定收件人本人操作。该交接不发送邮件。

## 工程文件与模板

`file-schema --type drawing|template`给出上传字段；`file-list <报价ID> --version <版本>`读取该版本的附件摘要、图纸匹配状态和模板状态。`file-upload --type drawing --input <JSON> --file <原件> --version <当前版本>`的JSON是quoteId、lineId、可选replaceAttachmentId；不超过12MiB，格式和内容由服务器核验。上传或替换都生成新版本，原件保留。

`file-action --action remove|bind --input <JSON> --version <当前版本>`使用id（报价ID）、lineId、attachmentId；bind还需网站原有的acknowledgeDrawingRevision=true业务字段。remove只移除当前引用，bind恢复或重绑同款式原件，均保留历史。`file-download <报价ID> --type drawing --id <附件ID> --version <版本> --output <新文件>`按大小和SHA-256校验并拒绝覆盖。

`file-upload --type template`仅管理员使用，JSON包括quoteId、sheetBindings（sheetName与lineId逐款对应）以及网站既有的acknowledgeRemoveUnmapped=true字段。原Excel私有保留，打印副本移除未映射表；CLI不新增确认提示，也不自动补业务字段。`file-export <报价ID> --type draft|released --version <版本> --output <新.xlsx>`由服务器按模板、当前权限和数据完整性导出，未发布草稿保持其原有标记，不会冒充已复核版本。

远端2026-10-27物料清单更新已兼容：`ie-quotes names --kind raw|part`分别查询原始名称与物料名称，保留`sourceName/nameUsage`及目录版本供表单引用；CLI显式分页，网站未指定分页时继续返回完整清单。表单已同步`materialPricingMode=checklist`及`nameUsage=part-v1`字段，空材料价格、独立复核及管理人员填报规则以最新服务器为准，不由CLI自行计算。
