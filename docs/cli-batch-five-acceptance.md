# 批次 5：下载成品包验收

日期：2026-10-27。CLI 0.6.0，成品提交 `6dec1dd14ff679cd1c1ffabc1adac3abf2ed8646`。本页只记录合成环境结果，不含业务数据、员工身份或连接配置。

- [GitHub Windows CLI CI 40427313405](https://github.com/DOON-100/doon-order-workspace/actions/runs/40427313405) 成功，artifact ID `12700751182`。
- 外层构建包 SHA-256 `8dab6e91a9e869acf96c519c60fd5367bb8567a899d27da60c8c3c56b3ff8468` 与GitHub元数据一致；内层 CLI ZIP SHA-256 `a16a1f5dcba325b3e7fa2f08131b05e959580f73edd543614b4ad9cc1e2ec48b` 与随包清单一致。
- 下载包提交与版本匹配且 sourceDirty=false；每个文件的字节数和摘要与同提交本地独立构建一致。验证后在临时目录安装，使用包内Node 24.14.0及CLI运行所有登记命令。
- **76/76条命令成功**：此前59条及以下新增17条均逐条执行。无业务内容的机器摘要保存在被忽略的 `test-output/cli-batch5-package-acceptance.json`；完整命令列表见 [命令目录](../cli/docs/commands.md)。

| 新增命令 | 结果 |
| --- | --- |
| operations reports list / show | 通过 |
| operations finished list / show / history | 通过 |
| operations quality list / show / history | 通过 |
| operations packaging list / show / history | 通过 |
| operations releases list / show / history | 通过 |
| operations shipments list / show / history | 通过 |

38项真实业务处理器合成检查通过，验证五类质检、业务组及跨客户拒绝、期初未核定、阶段与在途/收货/检验/入仓状态、包装/放行/实际发货记录及既有业务命令。登录命令复用预建合成会话，密码交互由基础测试覆盖。

业务查询前后合成业务记录、修订号及附件原字节一致；测试结束停止本机服务器并删除临时数据库、附件、会话、导出文件和隔离安装。正式服务器请求数0，用户PATH未修改。另清理本轮128个CLI测试目录和1个原生HTTP测试目录，保留之前已有目录。

其他本机检查：46/46 CLI测试、完整业务回归主报告364项及独立子套件、网站/CLI类型检查、隔离原生HTTP 16/16及Windows安装包完整性和篡改检查通过。真实员工电脑、正式服务器及生产容量不在本轮验收范围。
