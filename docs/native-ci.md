# 中台自动检查与打包

`.github/workflows/native-ci.yml` 在 `main` 推送、目标为 `main` 的 PR 和手动运行时执行。使用 GitHub 托管的 Ubuntu 22.04 x64 和 Node 24.14.0，仅授予仓库读取权限，不使用服务器凭据或生产数据，也不执行部署。第三方 Actions 固定到提交 SHA。

流程：锁文件安装依赖 → 合成业务测试 → TypeScript → 打包完整性测试 → 在 `test-output/native-ci-build` 构建 → 原生 HTTP、员工/供应商入口及发布校验工具测试 → 在仓库外安装运行依赖 → 打包、重新解压、校验并执行合成 HTTP 测试。任一环节失败均不上传版本包。现有数据工具 CI 保持独立；本流程不代表所有业务场景或服务器兼容性已完成验收。

只有 `main` 的成功运行上传 `doon-native-linux-x64-<完整提交号>-<运行次数>` Artifact。PR 也验证打包，但不发布下载产物。Artifact 包含：

- `doon-native-<完整提交号>-linux-x64-node24.tar.gz`：`lan-dist/`、依照锁文件安装的生产 `node_modules/`、包描述及锁文件、`release.json`。
- `release.json`：提交号、运行平台和 Node 版本、CI 运行标识、源码构建证据摘要、逐文件 SHA-256/长度及内部符号链接目标。
- `SHA256SUMS`：压缩包 SHA-256，供下载后校验。

程序包通过明确的路径白名单组装，不上传整个 checkout、测试结果目录、数据库、附件、备份、`.env` 或本机配置。包内含现有中台鉴权/API 及可选调度桥接代码，不含独立 Agent 服务、模型配置或镜像；打包不启用调度桥接。依赖安装禁用生命周期脚本，交付前对解压后的实际文件执行测试。新增运行文件或静态资源类型须同步调整打包白名单并验证。

在 GitHub 仓库的 Actions → Native middle-platform CI → 成功运行 → Artifacts 下载。产物保留 30 天，过期后可对 `main` 手动重新运行；它们是 CI 候选版本，不是永久 Release，也不代表生产发布已批准。未来服务器下载程序须验证仓库、workflow、`main` 来源、成功结论、提交号、运行次数和文件摘要，不得只按文件名或最大版本号安装。SHA-256 用于完整性校验，不能替代来源认证。

目标环境目前限定为 Linux x64，基准为 Ubuntu 22.04、Node 24.14.0；Node 可执行程序不包含在包内。Windows、ARM64 或其他系统/Node 版本需要对应构建与验收，不能直接宣称兼容。服务器必须显式指定独立的绝对 `DOON_DATA_DIR`，保留现有账号、附件、运行配置和服务定义；不得调用 `manage.mjs init` 初始化正式数据。

后续另行实现服务器下载、增量传输、在线快照与附件验证、版本切换、健康检查及代码回退。本流程不会连接、停止或重启 8787，不更新 Docker Agent，不改变既有“提交不等于部署”的边界。Windows 本地发布脚本不能直接作为 Linux 部署器使用。

本地可运行 `node tests/native-release.mjs` 验证打包边界；完整打包在干净的 Linux x64 checkout 执行，并需要 npm 和 tar。先按工作流完成检查与隔离构建，再执行 `DOON_BUILD_DIR=test-output/native-ci-build node scripts/package-native-release.mjs`。输出目录已存在时拒绝覆盖，避免上传旧包。
