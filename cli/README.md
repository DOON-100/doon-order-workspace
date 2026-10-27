# 度昂员工 CLI

版本 0.5.0，批次 4。Commander.js 负责命令解析，复用中台员工登录与业务接口。支持 7 个基础命令及 52 个业务查询/导出命令，新增 PMC 核对轮次、采购、外协和工厂内部订单查询。详见 [业务部说明](docs/sales.md)、[订单及单据说明](docs/orders.md)、[工程说明](docs/engineering.md) 和 [PMC与采购说明](docs/planning.md)。

实施范围和实际验收状态见仓库 [实施计划](../docs/cli-implementation-plan.md) 与 [执行记录](../docs/cli-execution-log.md)。命令准确列表见 [自动生成的目录](docs/commands.md)，Codex / WorkBuddy 使用约定见 [工具调用说明](docs/agent-usage.md)。

## Windows 员工安装

使用公司提供的可信 HTTPS 链接下载 Windows x64 ZIP，核对发布方提供的 SHA-256 后解压，双击 `install.cmd`。安装助手校验包内文件，安装到当前用户目录并添加用户 PATH。重开终端、Codex 和 WorkBuddy 后使用 `doon`。

```powershell
doon setup --server https://workspace.example
doon doctor
doon login
doon whoami --json
```

`workspace.example` 仅为占位地址，公司正式地址由管理员提供，公开包没有私有连接配置。密码输入不会显示，不接受密码参数、环境变量或管道。初始密码尚未修改时先在员工网站修改，再重新登录。

程序保存在 `%LOCALAPPDATA%\Doon\CLI\programs`，命令入口在其 `bin` 目录。配置和加密会话保存在 `%LOCALAPPDATA%\Doon\CLI`；安装/升级只更新程序和入口。重新运行可信的新版安装包即可升级；安装旧版包可切回已保留版本。在线新版本提示、自动更新、代码签名和正式下载页待接入；首版只提供可验证的安装包。员工电脑的脚本执行策略需在试点验收，不自动改动系统策略。

会话使用 Windows DPAPI 按当前 Windows 用户加密；不打印 Cookie。该加密减少明文落盘，不隔离同一用户运行的其他程序。会话沿用服务器最长 12 小时、空闲 2 小时失效、改密/重置/停用校验。Cookie 具有员工现有权限，CLI 命令清单不等于服务器已把凭据限制为只读。

`doon logout` 先撤销服务器会话，成功后清除本机；网络失败保留凭据以便重试。`doon logout --local-only` 明确只清本机，不宣称撤销服务器会话。切换服务器前先退出，避免把旧会话发到新地址。

## 输出与连接行为

JSON 成功结构为 `{schema:"doon-cli-output-v1",ok:true,command,data}`，失败为 `{schema,ok:false,error:{code,message,...}}`。每次只输出一份 JSON，交互提示在 stderr。JSON 将中文等非 ASCII 字符编码为标准 `\uXXXX`，解析后还原，兼容旧 Windows PowerShell 的进程输出编码。`commands --json` 是可执行命令清单；`modules --json` 是计划目录，不包含虚构的可执行命令。

| 退出码 | 含义 |
| --- | --- |
| 0 | 命令成功；doctor 的 authenticated=false 仍可表示连接诊断成功 |
| 1 | 客户端内部错误 |
| 2 | 命令、输入或请求参数无效 |
| 3 | 本机配置/凭据存储问题 |
| 4 | 登录或权限问题 |
| 5 | 网络、超时、响应协议或服务器故障 |
| 6 | 服务器限流 |
| 7 | 记录不存在或不在所选授权范围 |
| 130 | 员工取消交互 |

基础接口响应上限 64 KiB、单请求超时 15 秒，同一命令中的请求顺序执行。客户端不自动重试 POST，不跟随跳转，不关闭 HTTPS 证书校验，不后台轮询。错误只输出客户端定义的消息，不回显远端错误正文、密码或令牌。`RATE_LIMITED` 可带 retryAfterSeconds；网络失败的 POST 可带 outcomeUnknown，须核查后再决定重做。

业务请求超时 30 秒，响应上限 32 MiB；命令输出按 JSON Unicode 转义后限制为 512 KiB，超限报错，不输出部分结果。列表在客户端筛选和分页，不会降低服务器全量读取的工作量；详情的各子列表独立使用相同 limit/offset。

doctor 检查 health、运行模式和当前身份，不调用管理员维护或业务数据接口。当前服务器没有公开构建版本握手；`serverBuild=null` 不证明所有业务接口兼容。`installedBusinessCommands=52` 是本机已安装命令数，`businessCommandsAvailable=null` 表示没有探测当前账号业务接口的可用性。

## 开发与合成测试

```powershell
cd cli
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run docs:check
npm run test:integration
npm run package:windows
```

要求 Node >=22.13。发行包固定携带 Node 24.14.0；Windows x64 打包会从 nodejs.org 下载对应 ZIP 和 SHA256SUMS，校验后提取运行时及许可证。压缩包解压后再次验证清单，在隔离安装目录测试命令入口。CI 只上传 Actions 构建附件，不发布 Release 或部署服务器。

业务集成测试还依赖仓库根目录已安装的锁定依赖，使用真实业务处理器、隔离 SQLite、临时附件和随机测试端口，核对授权、版本、导出与原始数据完整性。

`DOON_CLI_HOME` 仅供开发/测试重定向本机配置目录，必须是绝对路径，不能设置为共享或公开目录。合成服务使用 `setup --server http://127.0.0.1:<测试端口> --allow-local-http`；不允许公网 HTTP。测试使用临时目录和合成账号，不访问真实员工或生产数据库。

首版持久凭据仅支持 Windows；Linux/macOS 可构建和运行无凭据基础命令，持久登录支持留待后续批次。所有依赖许可证随 Windows 包提供。
