# 批次 4：下载成品包验收

日期：2026-10-27。CLI 0.5.0，成品提交 `81a832ea0222cb462f5ce08aa30751350f613700`。本页仅记录合成环境结果，不含业务数据、员工身份或连接配置。

- [GitHub Windows CLI CI 40424335072](https://github.com/DOON-100/doon-order-workspace/actions/runs/40424335072) 成功，artifact ID `12698943361`。
- 外层构建包 SHA-256 `afcf7ca9387b1f213a006fe11b10e8b37479ae1a806a656c02d9304262190ff0` 与GitHub元数据一致；内层 CLI ZIP SHA-256 `051a840b99179512c9a9b2fd9e5515509f0dae57132b2f1d40d49a9475813560` 与随包清单一致。
- 下载包提交与版本匹配且 sourceDirty=false；每个文件的字节数和摘要与同提交本地独立构建一致。验证后在临时目录安装，使用安装后的包内 Node 24.14.0 与 CLI 执行所有登记命令。
- **59/59条命令成功**：此前50条及以下新增9条均逐条执行。无业务内容的机器摘要保存在被忽略的 `test-output/cli-batch4-package-acceptance.json`；完整命令列表见 [命令目录](../cli/docs/commands.md)。

| 新增命令 | 结果 |
| --- | --- |
| planning rounds list | 通过 |
| planning rounds show | 通过 |
| purchasing purchases list | 通过 |
| purchasing purchases show | 通过 |
| purchasing purchases history | 通过 |
| purchasing outsource list | 通过 |
| purchasing outsource show | 通过 |
| purchasing factory-orders list | 通过 |
| purchasing factory-orders show | 通过 |

31项真实业务处理器合成检查通过，使用PMC和销售账号分别核对轮次权限、内部与成品外发范围、跨客户拒绝、采购未核对余额、事件历史、工厂内部订单状态和既有业务命令。登录命令复用预建合成会话，密码交互由基础测试覆盖。

业务查询前后合成业务记录、修订号和附件原字节一致；测试结束停止本机服务器并删除临时数据库、附件、会话、导出文件及隔离安装。正式服务器请求数0，用户PATH未修改。另清理本轮61个CLI测试目录及1个原生HTTP测试目录，保留之前已有目录。

其他本机检查：43/43 CLI测试、完整业务回归主报告364项及独立子套件、网站/CLI类型检查、隔离原生HTTP 16/16及Windows安装包完整性和篡改检查通过。真实员工电脑、正式服务器及生产容量不在本轮验收范围。
