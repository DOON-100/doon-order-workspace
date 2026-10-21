# 原生中台代码发布

`standalone/deploy-code-update.ps1` 只发布代码，不导入业务数据或配置。新增目录、字典等数据由各自的授权维护工具另行预览、提交和回读。不得把客户订单、源模板、私有词典或备份提交到公开仓库。

发布前核对 `git status --short --branch`、`git branch --show-current`、`git rev-parse HEAD`、`git rev-parse origin/main`。`origin/main` 只是本地缓存；用 `git ls-remote --heads origin main` 核对远程，再按需要 `git fetch origin main` 和安全合并。不得自动丢弃他人改动或强制推送。核对本次文件清单后，按项目规则提交并推送通过检查的代码；提交不等于部署。

先把 `DOON_BUILD_DIR` 指向本项目 `test-output/` 下的专用目录，再运行 `node standalone/build.mjs`。未指定该变量会直接构建正式 `lan-dist`，不能作为发布前验证方法。完成业务测试、TypeScript、隔离的 standalone 测试和本次功能验收；这些检查使用临时库和独立端口。

部署工具复用现有构建器的全源码与产物哈希清单 `customer-price-build-evidence.json`，不依赖报价业务的测试数量或数据。最后一次源码修改后须重新构建；执行时再次校验所有源码和产物。检查结果由执行者写入私有回执，绑定这份清单的 SHA-256，不能把示例回执当作真实检查结果：

```json
{
  "format": "doon-code-update-validation-v1",
  "manifestSha256": "<实际构建清单SHA-256>",
  "checks": [
    {"name":"business-tests","command":"node tests/run.mjs","exitCode":0,"completedAt":"<实际时间>"},
    {"name":"typescript","command":"node node_modules/typescript/bin/tsc --noEmit","exitCode":0,"completedAt":"<实际时间>"},
    {"name":"standalone","command":"<本次隔离测试命令>","exitCode":0,"completedAt":"<实际时间>"},
    {"name":"feature","command":"<本次功能验收命令>","exitCode":0,"completedAt":"<实际时间>"}
  ]
}
```

明确发布范围后在能够读取计划任务和进程归属的 Windows 上下文执行：

```powershell
.\standalone\deploy-code-update.ps1 -StagePath 'test-output\<本次构建目录>' -ExpectedManifestSha256 '<实际SHA-256>' -ValidationPath 'test-output\<本次检查回执>.json' -SmokePath '/<本次页面>'
```

脚本固定正式目标为当前项目 `lan-dist`、`lan-data`、8787 和 `DOON-Order-Workspace`，拒绝手工暂停的守护任务、目录链接、其他项目进程或无法核实的服务归属。它接受已知的 `service-host-start.ps1` 入口和旧安装脚本的直接 host 入口，不修改计划任务定义或账号。

执行顺序是：校验构建和检查回执 → 独立复制候选代码并比对 → SQLite 在线快照及附件校验 → 暂停守护并停服 → 第二份一致快照及原数据哈希检查点 → 整目录替换代码并保留旧版本 → 验证记录、附件、账号元数据和业务版本完全不变 → 恢复守护 → 检查健康、页面和原数据。全过程不读取密码或会话令牌，也不初始化数据库。

失败会优先停服务并恢复旧代码目录；不会用旧数据库覆盖期间新增数据。启动后的严格保护检查可能发现真实用户并发写入，此时保留现库、回退代码并调查，不能把差异自动当作允许删除的数据。回退无法核实时输出 `manual-attention-required`，保留现场与摘要。检查点、结果、失败代码和旧代码保存在 `test-output/code-update-<时间>/`，一致备份保存在 `lan-data/backups/code-update-*`。成功后旧代码仍保留；新配置导入不属于这一步。

发布工具自身的合成测试：`node standalone/test-code-update.mjs` 与 `powershell -NoProfile -ExecutionPolicy RemoteSigned -File standalone/test-code-update.ps1`。后者与现有守护启动器一样仅设置当前进程的脚本策略，不修改系统策略。这些测试不会调用部署入口、计划任务或正式数据库。
