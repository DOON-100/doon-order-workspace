# CLI 命令目录

由命令登记自动生成，客户端版本 0.2.0。所有命令均支持 `--json`；帮助支持 `--help`。本目录只列实际命令，栏目状态不代表员工授权。

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
| `doon sales projects list` | 查询开发项目 | business-read-and-session-last-seen |
| `doon sales projects show <id>` | 查看项目与款色、轮次、任务 | business-read-and-session-last-seen |
| `doon sales projects history <id>` | 查询项目历史摘要 | business-read-and-session-last-seen |
| `doon sales inquiries list` | 查询询价与需求评估 | business-read-and-session-last-seen |
| `doon sales inquiries show <id>` | 查看询价依据与未知项 | business-read-and-session-last-seen |
| `doon sales inquiries history <id>` | 查询询价历史版本 | business-read-and-session-last-seen |
| `doon sales quotes list` | 查询客户报价 | business-read-and-session-last-seen |
| `doon sales quotes show <id>` | 查看报价商业字段 | business-read-and-session-last-seen |
| `doon sales quotes history <id>` | 查询报价版本目录 | business-read-and-session-last-seen |
| `doon sales quotes version <id> <version>` | 读取指定报价历史版本 | business-read-and-session-last-seen |
| `doon sales quotes export-completed --output <file.xlsx>` | 导出当前业务组或全部有权查看的已完成报价总表 | local-file-and-session-last-seen |

## 业务栏目

| 栏目 | 标识 | 状态 |
| --- | --- | --- |
| 工作总览 | overview | pending |
| 业务部 | sales | partial |
| 客服与单证 | service | pending |
| 工程部 | engineering | pending |
| PMC 计划 | planning | pending |
| 采购与外协 | purchasing | pending |
| 仓储物流 | warehouse | pending |
| 生产车间 | production | pending |
| 品质部 | quality | pending |
| 财务部 | finance | pending |
| 系统管理 | management | pending |

批次 1 已接入业务部 15 个查询/导出命令。查询支持业务组、精确客户编号和客户端分页；列表额外支持搜索。已完成总表导出仅支持业务组和新输出路径。参数见各命令 --help，范围与字段说明见 [业务部说明](sales.md)。密码只在员工交互终端输入，`--json` 不会使登录变为无人值守。
