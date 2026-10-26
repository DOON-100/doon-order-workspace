# CLI 执行记录

## 2026-10-27：批次 0 开始

- 已核对工作区：`codex/account-login-history` 与 `origin/main` 同为 `efbcf99`，保留无关未跟踪 `.workbuddy/`。
- 已核对现有登录/会话、HTTPS 网关与栏目定义。客户端采用独立 `cli/` 包，复用现有接口；本轮不修改生产服务。
- 实施中：基础命令、Windows 加密会话、独立安装包、合成测试与 CI。
- 下一步：完成框架并逐项填写 [验收清单](cli-implementation-plan.md)。

## 2026-10-27：批次 0 框架与 CLI 验收完成

- 已实现独立 TypeScript / ESM 客户端，锁定 Commander 15.0.0；7 个基础命令和 11 个待接入栏目，命令目录自动生成。
- Windows 会话采用 DPAPI CurrentUser 加密。只在交互终端输入密码；JSON 不输出 Cookie，旧版 PowerShell 通过 Unicode 转义获得稳定 JSON。
- CLI 自动测试涵盖地址与会话绑定、登录复用、撤销/过期、初始密码、限流/超时、响应大小、真实跳转拒绝、进程 JSON/退出码、真实 DPAPI、非交互密码注入拒绝；最终数量在项目回归结束后记录。原生登录集成使用独立临时目录、随机测试端口和合成账号，不调用业务 API。
- 交互终端测试通过：使用明确的合成密码，输入不回显，登录后可解密读取会话，测试结束清除本机会话。
- Windows 包通过：官方 Node 24.14.0 ZIP 校验、携带运行时和许可证、压缩后解压校验、离开源码目录执行、隔离目录安装、重复安装保留配置、修改文件后拒绝安装。用户 PATH 及真实员工环境不由该隔离测试代替。
- 发现并修复两项 Windows 兼容问题：安装校验不依赖 Get-FileHash 模块；JSON 输出使用标准 Unicode 转义，避免旧 PowerShell 错误解码中文。
- 网站 TypeScript 检查已通过。完整 `node tests/run.mjs` 仍在执行；结束后更新本记录并提交推送。
- 已添加独立 Windows CLI CI，上传带摘要的构建附件；没有设置 Release 发布或生产部署动作。

## 2026-10-27：项目回归环境补齐

- 隔离构建与 `node standalone/test.mjs` **16/16 通过**，输出目录为 `test-output/cli-batch0-native-build`，使用临时数据库和测试端口。
- 第一轮 `node tests/run.mjs` 执行至最后的本机模拟 SMTP 检查时，因本机缺少锁文件已声明的 `nodemailer@10.2.1` 退出；此前业务断言已通过，未将整轮标记为成功。
- 按根 `package-lock.json` 的精确 SHA-512 恢复本机缺失的单个依赖，未修改根依赖声明或锁文件。单独 `node tests/ie-mail-cases.mjs` 已通过，真实 MIME/SMTP 仅发送到本机模拟服务。
- 已重新执行完整业务回归，最终状态见下方记录。CLI 最终自动测试为 **17/17 通过**。

## 2026-10-27：批次 0 开发与本地验收完成

- 第二轮 `node tests/run.mjs` **退出码 0**。最终主报告 `test-output/result.json` 的 passed 为 **364**，生成于北京时间 2026-10-27 06:18；脚本另执行的独立子套件也全部结束成功。
- `node node_modules/typescript/bin/tsc --noEmit`、CLI 独立 TypeScript 构建、**17/17 CLI 测试**、`npm run docs:check` 及隔离构建后的 **16/16 内网 HTTP 测试**通过。
- Windows 包在仓库外的临时目录解压、安装与执行，清除测试进程的 NODE_PATH/NODE_OPTIONS，避免借用开发机依赖。包内版本与 package.json 一致；完整性校验、重复安装保留配置及篡改拒绝均通过。
- 已自查提交文件清单，包、数据库、会话、运行配置、node_modules 和测试输出均未进入 Git；无关 `.workbuddy/` 保留。
- 本页随批次 0 功能按主线提交推送；提交号和远端同步由 Git 历史追踪。Windows CLI CI 已配置，远端执行结果以 Actions 实际状态为准，不将本地验证写成远端 CI 已成功。
- 当前可用：7 个基础命令；全部业务栏目仍为 pending。下一步是批次 1 的客户、项目、询价与报价接口清单及首批适配，本轮未开始。
- 实际员工安装、Codex / WorkBuddy 联动、正式下载入口、版本更新提示及容量测试保持在 [分发前待办](cli-implementation-plan.md) 中。
