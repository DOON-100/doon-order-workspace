# 批次 1：业务部查询

客户端 0.2.0，复用现有鉴权和业务 API，无新增服务器部署要求。实际可用性取决于服务器接口版本和员工权限。15 个命令均不写业务记录；导出只在本机创建文件。

```powershell
doon sales teams list --json
doon sales customers list --team TEAM_ID --search 客户名 --limit 20 --json
doon sales customers show CUSTOMER_ID --team TEAM_ID --json
doon sales projects list --customer CUSTOMER_ID --json
doon sales inquiries show INQUIRY_ID --json
doon sales quotes version QUOTE_ID 1 --json
doon sales quotes export-completed --team TEAM_ID --output C:\Private\completed-new.xlsx --json
```

示例 ID 须替换为实际编号。参数以 `doon sales <资源> <动作> --help` 为准。

| 资源 | 动作 | 现有接口 |
| --- | --- | --- |
| teams | list | business-team-data |
| customers | list / show / history | customer-workflow-data、customer-workflow-history；名称取自 business-team-data |
| projects | list / show / history | customer-project-data、customer-project-history |
| inquiries | list / show / history | process-data（固定 type=rfq）、process-history |
| quotes | list / show / history / version | customer-quotes、customer-quote-version |
| quotes | export-completed | customer-quote-completed-export |

所有命令支持 `--team <精确ID>`；不填时查询全部获授权范围。查询支持 `--customer <精确ID>`、`--limit 1..100`（默认20）、`--offset 0..1000000`（默认0）；list 额外支持 `--search`，按当前资源摘要字段搜索。客户 show/history 的编号是客户 ID；其余为对应记录 ID。没有 `--mine`，未把姓名或角色推测为归属。

分页为客户端筛选、分页，服务器仍按现有接口读取。返回 page.total、rows 和 nextOffset；详情每个子列表独立分页。scope 描述请求范围和权限来源。业务组筛选要求列表接口回显已应用的组范围；详情和历史先核对记录处于该列表，避免直接详情接口忽略组筛选。权限不足、协议不符或范围无法确认时报错。

客户资料省略银行与快递账号。项目历史只给操作摘要，不展开原始快照。报价只展示对客商业字段，省略内部成本、来源公式和原始历史快照；保留 null、0、范围及复核标记。历史报价改绑过客户时暂不展示，请到网页核查。任何省略均不代表网页中没有相应内容。服务端 canEdit 等是员工权限信息，不表示 CLI 已提供修改命令。

已完成报价总表导出使用已有纯读取接口，只支持 team 和必填 output；不支持客户、搜索或分页，导出所选组内全部获授权的已完成行。文件上限32 MiB，校验类型和 XLSX ZIP 签名后独占创建新文件；返回路径、字节数和 SHA-256。已有文件拒绝覆盖。未接入会生成服务器归档的模板导出接口。

暂缓新增、修改、删除、提交、审批、发送、附件下载、模板归档导出、完整客户资料导出及服务端分页。沿用 Cookie 的权限未被服务端限制成只读；命令仅使用固定 GET 白名单，不能替代服务器权限隔离。
