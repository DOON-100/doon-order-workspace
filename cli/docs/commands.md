# CLI 命令目录

由命令登记自动生成，客户端版本 0.23.0。所有命令均支持 `--json`；帮助支持 `--help`。本目录只列实际命令，栏目状态不代表员工授权。

| 用法 | 行为 | 副作用 |
| --- | --- | --- |
| `doon setup --server <origin> [--allow-local-http]` | 保存公司 HTTPS 地址；HTTP 仅供显式启用的本机测试 | local-config |
| `doon login [--username <name>]` | 交互登录员工账号；有效会话直接复用 | auth-session-and-audit |
| `doon logout [--local-only]` | 注销服务器会话并清除本机凭据；可显式只清本机 | auth-session-and-audit |
| `doon whoami` | 向服务器核对当前身份和初始密码状态 | session-last-seen |
| `doon doctor` | 检查连接、服务响应、运行模式和当前会话 | session-last-seen |
| `doon commands` | 列出实际实现的命令及其作用 | none |
| `doon modules` | 按中台顺序列出栏目及接入进度 | none |
| `doon sales teams list` | 查询本人可见业务组 | business-read-and-session-last-seen |
| `doon sales customers list` | 查询客户清单 | business-read-and-session-last-seen |
| `doon sales customers show <id>` | 查看客户资料与跟进 | business-read-and-session-last-seen |
| `doon sales customers history <id>` | 查询客户历史摘要 | business-read-and-session-last-seen |
| `doon sales customers master <id>` | 查看可维护的客户主档 | business-read-and-session-last-seen |
| `doon sales projects list` | 查询开发项目 | business-read-and-session-last-seen |
| `doon sales projects show <id>` | 查看项目与款色、轮次、任务 | business-read-and-session-last-seen |
| `doon sales projects history <id>` | 查询项目历史摘要 | business-read-and-session-last-seen |
| `doon sales projects recycle` | 查询授权项目回收站 | business-read-and-session-last-seen |
| `doon sales followups list` | 查询客户跟进 | business-read-and-session-last-seen |
| `doon sales followups show <id>` | 查看客户跟进 | business-read-and-session-last-seen |
| `doon sales inquiries list` | 查询询价与需求评估 | business-read-and-session-last-seen |
| `doon sales inquiries show <id>` | 查看询价依据与未知项 | business-read-and-session-last-seen |
| `doon sales inquiries history <id>` | 查询询价历史版本 | business-read-and-session-last-seen |
| `doon sales quotes list` | 查询客户报价 | business-read-and-session-last-seen |
| `doon sales quotes show <id>` | 查看报价商业字段 | business-read-and-session-last-seen |
| `doon sales quotes history <id>` | 查询报价版本目录 | business-read-and-session-last-seen |
| `doon sales quotes version <id> <version>` | 读取指定报价历史版本 | business-read-and-session-last-seen |
| `doon sales quotes export-completed --output <file.xlsx>` | 导出当前业务组或全部有权查看的已完成报价总表 | local-file-and-session-last-seen |
| `doon sales projects development-save --input <file> --version <number> --request-id <uuid>` | 维护项目开发阶段并回读 | business-write |
| `doon sales projects development-log --input <file> --version <number> --request-id <uuid>` | 登记项目开发进展并回读 | business-write |
| `doon sales projects item-update --input <file> --version <number> --request-id <uuid>` | 修改项目款色并回读 | business-write |
| `doon sales projects round-update --input <file> --version <number> --request-id <uuid>` | 修改项目轮次并回读 | business-write |
| `doon sales customers followup-add --input <file> --version <number> --request-id <uuid>` | 登记客户沟通与跟进并回读 | business-write |
| `doon sales projects trash --input <file> --version <number> --request-id <uuid>` | 将项目移入回收站并回读 | business-write |
| `doon sales projects restore --input <file> --version <number> --request-id <uuid>` | 恢复项目并回读 | business-write |
| `doon sales customers master-update --input <file> --version <number>` | 更新客户主档指定字段并回读 | business-write |
| `doon sales customers create --input <file>` | 创建客户主档并回读 | business-write |
| `doon sales projects task-update --input <file> --version <number> --request-id <uuid>` | 调整或取消项目待办并回读 | business-write |
| `doon sales inquiries update --input <file> --version <number> --request-id <uuid>` | 更新询价需求并回读 | business-write |
| `doon sales projects update --input <file> --version <number> --request-id <uuid>` | 更新客户项目并回读 | business-write |
| `doon sales followups update --input <file> --version <number> --request-id <uuid>` | 更新客户跟进并回读 | business-write |
| `doon sales projects task-create --input <file> --request-id <uuid>` | 新增项目待办并回读 | business-write |
| `doon sales projects task-submit --input <file> --version <number> --request-id <uuid>` | 提交项目待办结果并回读 | business-write |
| `doon sales projects task-review --input <file> --version <number> --request-id <uuid>` | 审核项目待办并回读 | business-write |
| `doon sales followups create --input <file> --request-id <uuid>` | 新增客户跟进并回读 | business-write |
| `doon sales projects round-add --input <file> --request-id <uuid>` | 新增项目轮次并回读 | business-write |
| `doon sales projects item-add --input <file> --request-id <uuid>` | 新增项目款色并回读 | business-write |
| `doon sales projects communication-add --input <file> --request-id <uuid>` | 新增项目沟通记录并回读 | business-write |
| `doon sales inquiries create --input <file> --request-id <uuid>` | 创建询价需求记录并回读 | business-write |
| `doon sales projects create --input <file> --request-id <uuid>` | 创建客户开发项目并回读 | business-write |
| `doon sales customers profile-update --input <file> --version <number> --request-id <uuid>` | 更新客户通用资料的指定字段并回读 | business-write |
| `doon sales customers schedule-set --input <file> --version <number> --request-id <uuid>` | 安排客户下次跟进并回读 | business-write |
| `doon sales projects development-show <id> --customer <id>` | 查询项目开发阶段与进展 | business-read-and-session-last-seen |
| `doon sales orders list` | 查询获授权的订单明细 | business-read-and-session-last-seen |
| `doon sales orders show <id>` | 查看订单明细、跟进和附件目录 | business-read-and-session-last-seen |
| `doon sales sources list` | 查询销售原单证据 | business-read-and-session-last-seen |
| `doon sales sources show <id>` | 查看原单逐行字段与来源位置 | business-read-and-session-last-seen |
| `doon sales sources export <id> --output <file.xlsx>` | 导出单张获授权销售原单 XLSX | local-file-and-session-last-seen |
| `doon service pi list` | 查询 PI 草稿和已核对记录 | business-read-and-session-last-seen |
| `doon service pi show <id>` | 查看 PI 当前字段与来源变化标记 | business-read-and-session-last-seen |
| `doon service pi history <id>` | 查询 PI 历史版本目录 | business-read-and-session-last-seen |
| `doon service pi version <id> <version>` | 查看 PI 指定历史版本 | business-read-and-session-last-seen |
| `doon service documents list` | 查询现有业务单据 | business-read-and-session-last-seen |
| `doon service documents show <id>` | 查看业务单据内容 | business-read-and-session-last-seen |
| `doon service documents history <id>` | 查询业务单据版本目录 | business-read-and-session-last-seen |
| `doon service documents version <id> <version>` | 查看业务单据指定版本 | business-read-and-session-last-seen |
| `doon service production-orders list` | 查询生产交接资料（不代表已下达生产） | business-read-and-session-last-seen |
| `doon service production-orders show <id>` | 查看生产交接字段和原订单行引用 | business-read-and-session-last-seen |
| `doon service production-orders history <id>` | 查询生产交接资料历史摘要 | business-read-and-session-last-seen |
| `doon engineering drawings list` | 查询工程画图需求 | business-read-and-session-last-seen |
| `doon engineering drawings show <id>` | 查看画图需求 | business-read-and-session-last-seen |
| `doon engineering drawings history <id>` | 查询画图历史摘要 | business-read-and-session-last-seen |
| `doon engineering sops list` | 查询SOP与MES跟进 | business-read-and-session-last-seen |
| `doon engineering sops show <id>` | 查看SOP任务 | business-read-and-session-last-seen |
| `doon engineering sops history <id>` | 查询SOP历史摘要 | business-read-and-session-last-seen |
| `doon engineering samples list` | 查询授权样品 | business-read-and-session-last-seen |
| `doon engineering samples show <id>` | 查看样品详情 | business-read-and-session-last-seen |
| `doon engineering ie-quotes list` | 查询授权IE报价 | business-read-and-session-last-seen |
| `doon engineering ie-quotes show <id>` | 查看工程报价与成本 | business-read-and-session-last-seen |
| `doon engineering ie-quotes history <id>` | 查询工程报价历史目录 | business-read-and-session-last-seen |
| `doon engineering ie-quotes version <id> <version>` | 查看指定工程报价版本 | business-read-and-session-last-seen |
| `doon planning rounds list` | 查询PMC核对轮次 | business-read-and-session-last-seen |
| `doon planning rounds show <id>` | 查看核对轮次及明细状态 | business-read-and-session-last-seen |
| `doon purchasing purchases list` | 查询获授权采购明细 | business-read-and-session-last-seen |
| `doon purchasing purchases show <id>` | 查看采购跟单及收货状态 | business-read-and-session-last-seen |
| `doon purchasing purchases history <id>` | 查询采购事件及最近编辑摘要 | business-read-and-session-last-seen |
| `doon purchasing outsource list` | 查询获授权外协单 | business-read-and-session-last-seen |
| `doon purchasing outsource show <id>` | 查看外协单 | business-read-and-session-last-seen |
| `doon purchasing factory-orders list` | 查询工厂内部订单版本 | business-read-and-session-last-seen |
| `doon purchasing factory-orders show <id>` | 查看工厂内部订单版本 | business-read-and-session-last-seen |
| `doon operations reports list` | 查询生产报工 | business-read-and-session-last-seen |
| `doon operations reports show <id>` | 查看生产报工明细 | business-read-and-session-last-seen |
| `doon operations finished list` | 查询成品外发任务 | business-read-and-session-last-seen |
| `doon operations finished show <id>` | 查看成品任务、在途与入仓状态 | business-read-and-session-last-seen |
| `doon operations finished history <id>` | 查询成品任务事件摘要 | business-read-and-session-last-seen |
| `doon operations quality list --type <type>` | 查询指定质检类型 | business-read-and-session-last-seen |
| `doon operations quality show <id> --type <type>` | 查看指定质检记录 | business-read-and-session-last-seen |
| `doon operations quality history <id> --type <type>` | 查看指定质检历史 | business-read-and-session-last-seen |
| `doon operations packaging list` | 查询包装核对记录 | business-read-and-session-last-seen |
| `doon operations packaging show <id>` | 查看包装核对 | business-read-and-session-last-seen |
| `doon operations packaging history <id>` | 查看包装历史 | business-read-and-session-last-seen |
| `doon operations releases list` | 查询出货放行记录 | business-read-and-session-last-seen |
| `doon operations releases show <id>` | 查看出货放行 | business-read-and-session-last-seen |
| `doon operations releases history <id>` | 查看出货放行历史 | business-read-and-session-last-seen |
| `doon operations shipments list` | 查询客服发货记录 | business-read-and-session-last-seen |
| `doon operations shipments show <id>` | 查看客服发货记录 | business-read-and-session-last-seen |
| `doon operations shipments history <id>` | 查看客服发货历史 | business-read-and-session-last-seen |
| `doon finance records list --kind <kind>` | 查询指定项目财务记录 | business-read-and-session-last-seen |
| `doon finance records show <id> --kind <kind>` | 查看项目财务记录 | business-read-and-session-last-seen |
| `doon finance records history <id> --kind <kind>` | 查看项目财务历史摘要 | business-read-and-session-last-seen |
| `doon finance receivables list` | 查询客服应收记录 | business-read-and-session-last-seen |
| `doon finance receivables show <id>` | 查看应收及已收余额 | business-read-and-session-last-seen |
| `doon finance receivables history <id>` | 查看应收历史摘要 | business-read-and-session-last-seen |
| `doon finance reconciliations list` | 查询供应商对账记录 | business-read-and-session-last-seen |
| `doon finance reconciliations show <id>` | 查看供应商对账 | business-read-and-session-last-seen |
| `doon finance reconciliations history <id>` | 查看供应商对账历史 | business-read-and-session-last-seen |
| `doon finance complaints list` | 查询客户投诉记录 | business-read-and-session-last-seen |
| `doon finance complaints show <id>` | 查看客户投诉 | business-read-and-session-last-seen |
| `doon finance complaints history <id>` | 查看客户投诉历史 | business-read-and-session-last-seen |

## 业务栏目

| 栏目 | 标识 | 状态 |
| --- | --- | --- |
| 工作总览 | overview | pending |
| 业务部 | sales | partial |
| 客服与单证 | service | partial |
| 工程部 | engineering | partial |
| PMC 计划 | planning | partial |
| 采购与外协 | purchasing | partial |
| 仓储物流 | warehouse | partial |
| 生产车间 | production | partial |
| 品质部 | quality | partial |
| 财务部 | finance | partial |
| 系统管理 | management | pending |

查询阶段共接入 86 个业务查询/导出命令；W1 已接入客户主档创建及指定字段更新、客户资料更新、跟进排程、项目创建及更新、询价创建及更新、项目款色、轮次、沟通、待办与客户跟进新增及更新写入，其他写入仍待开发。图纸、SOP、样品及既有业务查询支持业务组，IE报价不支持业务组筛选；查询使用客户端分页，列表额外支持搜索。订单/原单使用 customer-code 精确原值，单据使用 customer/order 的明确ID，不能混用。已完成总表导出仅支持业务组和新输出路径。参数见各命令 --help，范围与字段说明见 [业务部说明](sales.md)、[订单/单据说明](orders.md) 、[工程说明](engineering.md) 、[PMC与采购说明](planning.md) 、[生产与交付说明](operations.md) 和 [财务说明](finance.md)。密码只在员工交互终端输入，`--json` 不会使登录变为无人值守。
