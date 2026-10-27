# 批次 6：下载成品包验收

日期：2026-10-27。CLI 0.7.0，成品提交 `f8608b3ee4fd3eb16a4e742da093cc1362c40ae4`。本页只记录合成环境结果，不含业务数据、员工身份或连接配置。

- [GitHub Windows CLI CI 40430089229](https://github.com/DOON-100/doon-order-workspace/actions/runs/40430089229) 成功，artifact ID `12701672182`。
- 外层构建包 SHA-256 `7a6f4f6dd861da9e79980ba531591b961bc77748510e9fad7d7bb1c247328c53` 与GitHub元数据一致；内层 CLI ZIP SHA-256 `b452df81872beb20f68a88cbb85abfad10fea6d37d05e1035ca35679a427414f` 与随包清单一致。
- 下载包提交与版本匹配且 sourceDirty=false；每个文件的字节数和摘要与同提交本地独立构建一致。验证后在临时目录安装，使用包内Node 24.14.0及CLI运行所有登记命令。
- **88/88条命令成功**：此前76条及以下新增12条均逐条执行。无业务内容的机器摘要保存在被忽略的 `test-output/cli-batch6-package-acceptance.json`；完整命令列表见 [命令目录](../cli/docs/commands.md)。

| 新增命令 | 结果 |
| --- | --- |
| finance records list / show / history | 通过 |
| finance receivables list / show / history | 通过 |
| finance reconciliations list / show / history | 通过 |
| finance complaints list / show / history | 通过 |

44项真实业务处理器合成检查通过，验证13类项目财务记录、业务组及跨客户限制、历史记录绑定、结构化账号/付款人字段裁剪、草稿和金额、应收、对账与客诉及既有业务命令。登录命令复用预建合成会话，密码交互由基础测试覆盖。

业务查询前后合成业务记录、修订号及附件原字节一致；测试结束停止本机服务器并删除临时数据库、附件、会话、导出文件和隔离安装。正式服务器请求数0，用户PATH未修改。另清理本轮272个CLI测试目录和1个原生HTTP测试目录，保留之前已有目录。

其他本机检查：50/50 CLI测试、完整业务回归主报告364项及独立子套件、网站/CLI类型检查、隔离原生HTTP 16/16及Windows安装包完整性和篡改检查通过。曾有并行本机连接检查失败，集成结束后串行重跑通过。真实员工电脑、正式服务器及生产容量不在本轮验收范围。
