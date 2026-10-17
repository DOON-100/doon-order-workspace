# Mastra Studio 本地接入验收

日期：2026-10-17（Asia/Shanghai）。代码基线：测试分支 `codex/mastra-local-validation` 的 `e877210`，本次变更新增 Studio 入口与独立实验。验证环境 Windows、Node.js 24.14.0。

## 自动验证

以下命令均已实际运行并以退出码 0 结束：

| 检查 | 结果 |
| --- | --- |
| `node tests/run.mjs` | 原项目全量业务回归通过，包含数据保全、授权、版本与关联校验 |
| `node node_modules/typescript/bin/tsc --noEmit` | 通过 |
| `DOON_BUILD_DIR=test-output/mastra-studio-build node standalone/build.mjs` | 通过；保留原构建的分包体积提示 |
| `DOON_BUILD_DIR=test-output/mastra-studio-build node standalone/test.mjs` | 15 项内网 HTTP 检查通过 |
| `node --test experiments/mastra-studio/studio.test.mjs` | 3 组集成测试通过 |
| `git diff --check` | 通过 |

新增测试实际覆盖官方 Studio 页面和静态资源、四个 Agent 注册、总管工具委派及下一轮重新取数、流式回复、合成工作流、memory 重启保留、trace 写入独立库、默认关闭与错误配置拒绝、匿名请求、首次改密、销售角色拒绝、跨站修改拒绝、退出后会话失效。另覆盖浏览器取消静态资源请求后服务仍正常响应，修复了重复写响应头造成预览退出的问题。

## 浏览器验证

1. 打开 `http://127.0.0.1:8797`，使用专用合成管理员登录，原数据台导航与公司图标正常显示。
2. 点击左上角公司图标，原标签页仍保留数据台，新标签页进入官方 Mastra Studio 的 Agents 列表；有“返回数据台”及本地合成提示。
3. 在总管 Agent 输入合成采购巡检任务，实际看到 `InspectOverdue`、`DelegateProcurement` 工具调用与最终回复。回复明确注明固定脚本、合成场景、未发送企业微信。
4. 重启本次独立预览后，Studio 的 Traces 列表仍展示总管与采购 Agent 的已完成记录，验证页面查询与本地持久化可用。
5. 在 Workflows 打开 `synthetic-procurement-followup`，实际点击 Run，两个节点均为 Completed，整体为 Success。截图保存在被忽略的 `test-output/mastra-studio-workflow.png`。

预览只监听 `127.0.0.1:8797`。凭据、测试库、memory、trace、截图和日志均留在被忽略的目录；未读取或写入原业务库、原附件、员工密码，未部署或重启 ECS，未变更正式 8787 服务。

## 能力边界

这是官方 Studio 的可运行本地接入，测试 Agent 使用确定性离线模型，执行同一合成采购场景。它验证 SDK 调用、工具、工作流、记忆、轨迹和入口权限，不验证真实模型推理质量。未接真实订单、企业微信发送、定时巡检、生产多租户记忆隔离、动态岗位授权、人工审批或真实业务闭环；后续按总体设计继续实现。

## 公司品牌调整补记（2026-10-17）

左侧品牌区改用数据台原公司图案及 `Agent Studio`，浏览器标题和小图标同步更新。检查并调整连接设置、搜索弹窗、资源页、启动失败及其他已知界面提示；隐藏云服务推广卡片和未安装编辑器的包安装提示。文档真实地址、SDK 包名、API 标识与开源信息保留。

本次仅修改独立 Studio 的品牌适配，没有修改业务代码。重新运行 Studio 三组集成测试、独立构建和 15 项内网 HTTP 检查，全部通过。浏览器已实际检查公司 Logo 的完整比例、Agent 列表、连接设置、搜索标题与资源页；设置及资源页可见正文未再发现 Mastra 字样。公司 Logo 截图见被忽略的 `test-output/agent-studio-company-brand.png`。本地预览更新前为两份测试 SQLite 执行在线快照与完整性检查，沿用原测试账号和历史会话，未接触正式数据。
