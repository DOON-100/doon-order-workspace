# 批次 2：下载成品包验收

日期：2026-10-27。版本0.3.0，功能提交 `9102065109decc7b818c3412c8fcb71dcc23ea82`。本页只记录合成环境验收，不含业务记录、员工身份或连接配置。

- 来源：[GitHub Windows CLI CI 40418271078](https://github.com/DOON-100/doon-order-workspace/actions/runs/40418271078)，结论success，artifact ID `12696410864`。
- 下载外层ZIP SHA-256：`4934a516b2aed0f61c61d93ea3df7af4aac72d522c610cb3d2eee6768bebd639`，与GitHub构建元数据一致。
- 内层 `doon-cli-0.3.0-9102065109de-windows-x64.zip` SHA-256：`7bef152bade6ab46fd3a88105f1b61697daec84c7b0467dd806f1ea9888a2c0c`，与随包摘要一致。
- 校验包内版本/提交及sourceDirty=false，每个文件与同提交本地独立构建的字节数和摘要一致后执行。CI元数据通过GitHub连接读取，原始artifact经公开下载代理取得；未发送公司配置或凭据。
- 在新临时目录安装，不修改用户PATH或既有配置。验证安装命令入口，然后使用安装后的包内Node24.14.0和程序执行以下全部命令；JSON成功、命令名、退出状态及命令目录均核对。样例数据只存在于临时本机服务器。

| 命令 | 结果 |
| --- | --- |
| setup | 通过 |
| login | 通过（复用合成会话） |
| logout | 通过（撤销合成会话） |
| whoami | 通过 |
| doctor | 通过 |
| commands | 通过（38项与实际登记一致） |
| modules | 通过 |
| sales teams list | 通过 |
| sales customers list | 通过 |
| sales customers show | 通过 |
| sales customers history | 通过 |
| sales projects list | 通过 |
| sales projects show | 通过 |
| sales projects history | 通过 |
| sales inquiries list | 通过 |
| sales inquiries show | 通过 |
| sales inquiries history | 通过 |
| sales quotes list | 通过 |
| sales quotes show | 通过 |
| sales quotes history | 通过 |
| sales quotes version | 通过 |
| sales quotes export-completed | 通过 |
| sales orders list | 通过 |
| sales orders show | 通过 |
| sales sources list | 通过 |
| sales sources show | 通过 |
| sales sources export | 通过 |
| service pi list | 通过 |
| service pi show | 通过 |
| service pi history | 通过 |
| service pi version | 通过 |
| service documents list | 通过 |
| service documents show | 通过 |
| service documents history | 通过 |
| service documents version | 通过 |
| service production-orders list | 通过 |
| service production-orders show | 通过 |
| service production-orders history | 通过 |

共38/38条通过，同时22项真实业务处理器集成通过。额外检查不同员工权限、跨组拒绝、只有全订单查询权的账号不能读取商业原单/PI、历史版本绑定、初始密码限制、停用后会话撤销及真实XLSX内容。

业务查询前后合成业务记录、修订号及附件原字节一致；登录/退出只在合成库产生鉴权留痕。测试结束停止本机服务器，移除临时数据库、文件、会话、配置及隔离安装，确认目录不存在；生产请求数0、用户PATH未改。另清理本轮146个CLI测试目录和1个原生HTTP测试目录，保留之前已有目录。功能与下载包保留，不进行生产数据“恢复”或数据库覆盖。

其他本机检查：36/36 CLI测试、完整业务回归主报告364项及独立子套件、网站/CLI类型检查、16/16隔离原生HTTP和Windows安装包完整性/篡改检查通过。正式服务器与真实员工电脑不在本轮验收范围。
