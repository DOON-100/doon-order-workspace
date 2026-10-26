# CLI 命令目录

由命令登记自动生成，客户端版本 0.1.0。所有命令均支持 `--json`；帮助支持 `--help`。本目录只列实际命令，栏目状态不代表员工授权。

| 用法 | 行为 | 副作用 |
| --- | --- | --- |
| `doon setup --server <origin> [--allow-local-http]` | 保存公司 HTTPS 地址；HTTP 仅供显式启用的本机测试 | local-config |
| `doon login [--username <name>]` | 交互登录员工账号；有效会话直接复用 | auth-session-and-audit |
| `doon logout [--local-only]` | 注销服务器会话并清除本机凭据；可显式只清本机 | auth-session-and-audit |
| `doon whoami` | 向服务器核对当前身份和初始密码状态 | session-last-seen |
| `doon doctor` | 检查连接、服务响应、运行模式和当前会话 | session-last-seen |
| `doon commands` | 列出实际实现的命令及其作用 | none |
| `doon modules` | 按中台顺序列出栏目及接入进度 | none |

## 业务栏目

| 栏目 | 标识 | 状态 |
| --- | --- | --- |
| 工作总览 | overview | pending |
| 业务部 | sales | pending |
| 客服与单证 | service | pending |
| 工程部 | engineering | pending |
| PMC 计划 | planning | pending |
| 采购与外协 | purchasing | pending |
| 仓储物流 | warehouse | pending |
| 生产车间 | production | pending |
| 品质部 | quality | pending |
| 财务部 | finance | pending |
| 系统管理 | management | pending |

批次 0 没有业务数据命令。密码只在员工交互终端输入，`--json` 不会使登录变为无人值守。
