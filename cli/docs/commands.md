# CLI 命令目录

由命令登记自动生成，客户端版本 0.32.0。所有命令均支持 `--json`；帮助支持 `--help`。本目录只列实际命令，栏目状态不代表员工授权。

| 用法 | 行为 | 副作用 |
| --- | --- | --- |
| `doon setup --server <origin> [--allow-local-http]` | 保存公司 HTTPS 地址；HTTP 仅供显式启用的本机测试 | local-config |
| `doon login [--username <name>]` | 交互登录员工账号；有效会话直接复用 | auth-session-and-audit |
| `doon logout [--local-only]` | 注销服务器会话并清除本机凭据；可显式只清本机 | auth-session-and-audit |
| `doon whoami` | 向服务器核对当前身份和初始密码状态 | session-last-seen |
| `doon doctor` | 检查连接、服务响应、运行模式和当前会话 | session-last-seen |
| `doon commands` | 列出实际实现的命令及其作用 | none |
| `doon modules` | 按中台顺序列出栏目及接入进度 | none |
| `doon sales orders schema --type <type>` | 订单修改/交接字段 | local-read |
| `doon sales orders form <id>` | 读取订单修改字段 | business-read-and-session-last-seen |
| `doon sales orders update --input <file> --version <number>` | 更新指定订单字段 | business-write |
| `doon sales orders workflow --type <type> --input <file> --version <number>` | 业务客服PMC交接 | business-write |
| `doon sales sources schema` | 销售原单证据字段 | local-read |
| `doon sales sources import --input <file> --request-id <uuid>` | 管理员迁入原单证据 | business-write |
| `doon purchasing factory-orders schema --type <type>` | 内部订单或导入字段 | local-read |
| `doon purchasing factory-orders form <lineId>` | 读取最新内部订单与源订单版本 | business-read-and-session-last-seen |
| `doon purchasing factory-orders export --order <id> [--reference <text>] --output <file.xlsx>` | 导出指定订单行的中英内部订单表格 | business-read-and-session-last-seen |
| `doon purchasing factory-orders save --type <type> --input <file> --version <number> --order-version <number> --request-id <uuid>` | 维护内部订单并核对双版本 | business-write |
| `doon purchasing factory-orders table-preview --input <file> --file <file.xlsx>` | 保存中英内部订单导入预览 | business-write |
| `doon purchasing factory-orders table-commit --input <file>` | 提交本人预览并复核双版本 | business-write |
| `doon service documents schema --kind <kind> --type <type>` | 查询内部资料或单据字段 | local-read |
| `doon service documents references [--kind <kind>] [--type <type>] [--customer <id>] [--limit <number>] [--offset <number>]` | 查询授权关联资料及人员 | business-read-and-session-last-seen |
| `doon service documents form <id>` | 读取内部资料或单据可编辑字段 | business-read-and-session-last-seen |
| `doon service documents save --kind <kind> --type <type> --input <file> --version <number> --request-id <uuid>` | 统一新增或修改资料及单据 | business-write |
| `doon service documents action --type <type> --input <file> --version <number> --request-id <uuid>` | 提交退回或核对单据 | business-write |
| `doon service documents generate --type <type> --input <file> --version <number> --request-id <uuid>` | 从指定来源版本生成业务单据 | business-write |
| `doon service documents files <id>` | 查询内部资料原件目录 | business-read-and-session-last-seen |
| `doon service documents file-upload --input <file> --file <file> --version <number> --request-id <uuid>` | 归档资料原件 | business-write |
| `doon service documents file-download <id> <fileId> --output <file>` | 核验并下载资料原件 | business-read-and-session-last-seen |
| `doon sales kingdee schema` | 销售草稿表单及动作字段 | local-read |
| `doon sales kingdee status` | 查询金蝶模板、配置及协议就绪状态 | business-read-and-session-last-seen |
| `doon sales kingdee list [--customer <value>] [--limit <number>] [--offset <number>]` | 查询授权销售草稿 | business-read-and-session-last-seen |
| `doon sales kingdee form <id>` | 读取销售草稿输入及核查结果 | business-read-and-session-last-seen |
| `doon sales kingdee prepare --input <file>` | 从已有原单准备销售草稿 | business-write |
| `doon sales kingdee save --input <file> --version <number>` | 修改销售草稿指定字段 | business-write |
| `doon sales kingdee action --type <type> --input <file> --version <number>` | 校验确认或受控金蝶上传/核查，不自动重试 | business-write |
| `doon sales kingdee source-preview --file <file.xlsx>` | 保存中英原单及解析预览 | business-write |
| `doon sales kingdee source-commit --input <file>` | 提交本人原单预览及草稿 | business-write |
| `doon sales kingdee source-template --output <file.xlsx>` | 下载中英原单上传模板 | business-read-and-session-last-seen |
| `doon sales kingdee source-download <id> --output <file.xlsx>` | 核验并下载原单原件 | business-read-and-session-last-seen |
| `doon sales kingdee export <id> --version <number> --output <file.xlsx>` | 导出客服已确认的金蝶模板 | business-read-and-session-last-seen |
| `doon sales prices schema --type dataset|selection|source` | 查询价格档案表单字段 | local-read |
| `doon sales prices list [--customer <id>] [--view sku|history]` | 查询授权历史价格及发票依据 | business-read-and-session-last-seen |
| `doon sales prices archive <id>` | 管理员核对档案摘要与来源目录 | business-read-and-session-last-seen |
| `doon sales prices import --input <file>` | 迁入新价格档案并核对摘要 | business-write |
| `doon sales prices selection-save --input <file> --version <number>` | 保存发票价格规则并回读 | business-write |
| `doon sales prices source-upload --input <file> --file <file>` | 按来源摘要归档价格原件 | business-write |
| `doon sales prices source-download <archiveId> <fileId> --output <file>` | 管理员核验并下载价格原件 | local-file-and-session-last-seen |
| `doon sales prices export [--customer <id>] [--view sku|history] --output <file.xlsx>` | 导出授权价格摘录 | local-file-and-session-last-seen |
| `doon sales quotes file-schema --type <type>` | 查询文件上传字段 | local-read |
| `doon sales quotes file-list <quoteId> --version <number>` | 查询指定报价版本的文件与模板状态 | business-read-and-session-last-seen |
| `doon sales quotes file-upload --type <type> --input <file> --file <file> [--version <number>]` | 上传指定类别报价文件并回读 | business-write |
| `doon sales quotes file-action --action <action> --input <file> --version <number>` | 维护文件引用或应用模板并回读 | business-write |
| `doon sales quotes file-download <quoteId> --type <type> [--id <id>] --version <number> --output <file>` | 核验并下载报价文件 | local-file-and-session-last-seen |
| `doon sales quotes file-export <quoteId> --type <type> --version <number> --output <file>` | 导出客户模板并按原权限归档成品 | business-write |
| `doon sales quotes record-sent --input <file> --version <number> --request-id <uuid>` | 登记已发送事实，不发送消息 | business-write |
| `doon sales quotes templates --customer <id>` | 查询客户报价模板 | business-read-and-session-last-seen |
| `doon engineering ie-quotes file-schema --type <type>` | 查询文件上传字段 | local-read |
| `doon engineering ie-quotes file-list <quoteId> --version <number>` | 查询指定报价版本的文件与模板状态 | business-read-and-session-last-seen |
| `doon engineering ie-quotes file-upload --type <type> --input <file> --file <file> [--version <number>]` | 上传指定类别报价文件并回读 | business-write |
| `doon engineering ie-quotes file-action --action <action> --input <file> --version <number>` | 维护文件引用或应用模板并回读 | business-write |
| `doon engineering ie-quotes file-download <quoteId> --type <type> [--id <id>] --version <number> --output <file>` | 核验并下载报价文件 | local-file-and-session-last-seen |
| `doon engineering ie-quotes file-export <quoteId> --type <type> --version <number> --output <file>` | 导出内部报价文件 | local-file-and-session-last-seen |
| `doon engineering ie-quotes handoffs [id] [--quote <id>]` | 查询工程交接目录或详情 | business-read-and-session-last-seen |
| `doon engineering ie-quotes handoff --action push|accept --input <file> --version <number>` | 下推工程报价或本人接收并回读 | business-write |
| `doon engineering ie-quotes names-schema` | 查询材料名称资料导入字段 | local-read |
| `doon engineering ie-quotes names [--kind <kind>] [--search <text>] [--limit <number>] [--offset <number>]` | 查询授权材料名称和来源行 | business-read-and-session-last-seen |
| `doon engineering ie-quotes names-import --input <file> --version <number> --request-id <uuid>` | 迁入独立材料名称资料并回读 | business-write |
| `doon engineering ie-quotes reference-schema --type catalog|preset|tooling` | 查询基价、预设或模具表单字段 | local-read |
| `doon engineering ie-quotes reference-list --type catalog|preset|tooling [--include-inactive]` | 查询授权报价参考资料 | business-read-and-session-last-seen |
| `doon engineering ie-quotes reference-save --type catalog|preset|tooling --input <file> [--version <number>]` | 新增或修改报价参考资料并回读 | business-write |
| `doon sales quotes schema` | 查询报价表单与动作字段 | local-read |
| `doon sales quotes form <id> [--version <number>]` | 读取授权的可编辑报价字段 | business-read-and-session-last-seen |
| `doon sales quotes save --input <file> [--version <number>]` | 新增报价或更新指定字段并回读 | business-write |
| `doon sales quotes action --type <type> --input <file> --version <number>` | 执行既有报价业务动作并回读 | business-write |
| `doon engineering ie-quotes schema` | 查询报价表单与动作字段 | local-read |
| `doon engineering ie-quotes form <id> [--version <number>]` | 读取授权的可编辑报价字段 | business-read-and-session-last-seen |
| `doon engineering ie-quotes save --input <file> [--version <number>]` | 新增报价或更新指定字段并回读 | business-write |
| `doon engineering ie-quotes action --type <type> --input <file> --version <number>` | 执行既有报价业务动作并回读 | business-write |
| `doon sales teams list` | 查询本人可见业务组 | business-read-and-session-last-seen |
| `doon sales customers list` | 查询客户清单 | business-read-and-session-last-seen |
| `doon sales customers show <id>` | 查看客户资料与跟进 | business-read-and-session-last-seen |
| `doon sales customers history <id>` | 查询客户历史摘要 | business-read-and-session-last-seen |
| `doon sales customers master <id>` | 查看可维护的客户主档 | business-read-and-session-last-seen |
| `doon sales customers sensitive <id>` | 按权限查看客户付款和快递账号资料 | business-read-and-session-last-seen |
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
| `doon sales followups action --type promote|classify --input <file> --version <number> --request-id <uuid>` | 跟进转项目或邮件归属登记并回读 | business-write |
| `doon sales followups mailbox [id]` | 查询授权邮件档案目录或指定正文 | business-read-and-session-last-seen |
| `doon sales followups history <id>` | 查询跟进或邮件归属历史 | business-read-and-session-last-seen |
| `doon sales projects file-upload --input <file> --file <file>` | 上传项目原件并回读，按内容去重 | business-write |
| `doon sales projects file-download <id> --project <id> --output <file>` | 按摘要校验并下载项目原件 | local-file-and-session-last-seen |
| `doon sales projects entry-schema --type <type>` | 查询普通项目表单的字段与规则 | local-read |
| `doon sales projects entry-save --type <type> --input <file> [--version <number>] --request-id <uuid>` | 按类型新增或修改普通项目表单并回读 | business-write |
| `doon sales customers sensitive-update --input <file> --version <number> --request-id <uuid>` | 按服务器权限更新客户付款或快递资料 | business-write |
| `doon sales projects document-save --input <file> --version <number> --request-id <uuid>` | 保存项目资料文档并回读 | business-write |
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
| `doon sales projects document-show <id> --customer <id>` | 查询项目资料文档与历史 | business-read-and-session-last-seen |
| `doon sales attachments list --customer <id> [--project <id>]` | 查询客户或项目附件 | business-read-and-session-last-seen |
| `doon sales attachments download <id> --customer <id> [--project <id>] --output <file>` | 校验并下载授权附件 | local-file-and-session-last-seen |
| `doon sales attachments upload --input <file> --file <file> --request-id <uuid>` | 上传客户或项目附件并回读 | business-write |
| `doon sales attachments update --input <file> --version <number> --request-id <uuid>` | 修改或归档附件资料并回读 | business-write |
| `doon sales customers transfers` | 查询客户流转与公海工作台 | business-read-and-session-last-seen |
| `doon sales customers transfer --action <action> --input <file> --version <number> --request-id <uuid>` | 执行客户流转的指定业务动作并回读 | business-write |
| `doon sales customer-tasks list [--customer <id>]` | 查询客户任务与负责人 | business-read-and-session-last-seen |
| `doon sales customer-tasks history <id>` | 查询客户任务历史 | business-read-and-session-last-seen |
| `doon sales customer-tasks save --input <file> --version <number> --request-id <uuid>` | 新增或修改客户任务并回读 | business-write |
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

查询阶段共接入 111 个业务查询/导出命令；W1已接入客户/项目表单、资料、任务、流转及原件；W2已接入工程与客户报价、目录/模具/名称资料、交接、模板/附件、历史价格和已发送事实登记。W1/W2本地成品验收完成；W3已接入订单字段、交接、内部订单、原单、PI等单据及金蝶草稿，本地验收结果见仓库执行记录，后续批次写入待开发。新增W3查询及编辑表单不改变查询阶段原111条命令的范围。图纸、SOP、样品及既有业务查询支持业务组，IE报价不支持业务组筛选；查询使用客户端分页，列表额外支持搜索。订单/原单使用 customer-code 精确原值，单据使用 customer/order 的明确ID，不能混用。已完成总表导出仅支持业务组和新输出路径。参数见各命令 --help，范围与字段说明见 [业务部说明](sales.md)、[订单/单据说明](orders.md) 、[工程说明](engineering.md) 、[PMC与采购说明](planning.md) 、[生产与交付说明](operations.md) 和 [财务说明](finance.md)。密码只在员工交互终端输入，`--json` 不会使登录变为无人值守。
