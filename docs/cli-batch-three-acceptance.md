# 批次 3：下载成品包验收

日期：2026-10-27。CLI 0.4.0，功能提交 `84149159ccb2bdf3b6ebc5286012863be88ff22f`。本页仅记录合成环境结果，不含业务数据、员工身份或连接配置。

- [GitHub Windows CLI CI 40422177122](https://github.com/DOON-100/doon-order-workspace/actions/runs/40422177122) 成功，artifact ID `12698141294`。
- 外层构建包 SHA-256 `e4e346f5b9f226ae65f9a47a9033c70ed59f616876dc22b9eb95587c4cd67be4`，与 GitHub 元数据一致；内层 CLI ZIP SHA-256 `ee4a1cdee689dad2f87f785e81ff22dfad173ac628c8c6ad7943825f4ecfb9a3`，与随包清单一致。
- 下载包提交与版本匹配且 sourceDirty=false；每个文件的摘要及字节数与同提交本地独立构建一致。验证后在临时目录安装，不改用户 PATH 或已有配置，并使用安装后的包内 Node 24.14.0 及 CLI 运行所有登记命令。
- 共 **50/50 条命令成功**，包含此前的38条基础、业务部和客服命令，以及以下全部12条新增命令。执行顺序、逐条结果及无业务内容的机器摘要保存在本机被忽略的 `test-output/cli-batch3-package-acceptance.json`；完整命令列表见 [命令目录](../cli/docs/commands.md)。

| 新增命令 | 结果 |
| --- | --- |
| engineering drawings list | 通过 |
| engineering drawings show | 通过 |
| engineering drawings history | 通过 |
| engineering sops list | 通过 |
| engineering sops show | 通过 |
| engineering sops history | 通过 |
| engineering samples list | 通过 |
| engineering samples show | 通过 |
| engineering ie-quotes list | 通过 |
| engineering ie-quotes show | 通过 |
| engineering ie-quotes history | 通过 |
| engineering ie-quotes version | 通过 |

真实业务处理器合成集成27项通过，检查授权和无授权员工、跨客户及业务组、历史客户和版本绑定、IE零值与未知值、初始密码、停用撤销和已支持导出。登录命令复用预先建立的合成会话；密码交互由基础测试覆盖。

业务查询前后逐值核对合成业务记录与修订号、附件原字节；登录/退出只产生合成鉴权留痕。测试结束停止本机服务器并删除临时数据、数据库、附件、会话、导出文件和隔离安装，确认目录不存在。正式服务器请求数0；用户PATH未修改。另移除本轮116个CLI测试目录及1个原生HTTP测试目录，保留以前已有目录。

其他本机检查：40/40 CLI测试、完整业务回归主报告364项及独立子套件、网站/CLI类型检查、隔离原生HTTP 16/16 和 Windows 安装包完整性/篡改检查通过。员工实机、正式服务器及生产容量不在本轮验收范围。
