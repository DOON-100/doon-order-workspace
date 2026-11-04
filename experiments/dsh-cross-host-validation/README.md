# DSH 总管与员工环境验证

本目录是独立实验，不部署中台，不改变账号权限、订单、附件或调度。DSH 官方源码放在仓库外，通过 `baseline.json` 固定提交；不把上游源码、依赖和运行数据复制进本仓库。

2026-11-04 的实测结论见 [验证结果](RESULTS.md)：158 项源码测试和 3 项真实父子运行时组合测试通过；长期独立员工环境之间的通信尚未实现和实测。

## 本次要核对的问题

1. 同一个 DSH 会话树内，总管和员工角色能否互发消息，陌生会话能否被拒绝。
2. 独立子进程后端提供的是临时任务执行还是可持续通信的员工环境。
3. 原生团队任务的版本、归属、持久化规则是否能作为业务协作的基础。
4. 非 owner 的访问策略能否拒绝未授权访问；默认 owner 行为不能冒充员工权限隔离。
5. 已有 Doon CLI 能否在独立配置目录发现命令并连接 8797，同时不继承员工凭据。

## 验证层次

| 层次 | 方法 | 能说明什么 |
|---|---|---|
| 源码核查 | 固定提交，读取实现和原生测试 | 已有接口及其限制，不代表运行通过 |
| 上游源码测试 | `run-upstream.mjs` 执行六组原生测试 | 通信、权限和任务算法；其中模型及部分子进程运行时为上游合成替身 |
| 真实父子进程组合 | `run-upstream.mjs ... composition` 执行上游组合测试 | 完整 DSH headless 父运行时与 SDK profile 子运行时；模型为合成替身，不是长期员工环境 |
| 8797 只读连接探测 | `probe-local.mjs` 调用真实 CLI，使用全新临时配置 | 命令目录、健康入口、环境标识和未登录拒绝 |
| 三个独立员工环境 | 后续分别启动 DSH、独立身份、插件和存储 | 需要另行实测，不能由前两项推导成功 |
| 业务与模型联调 | 指定身份、有限数据、受控模型出口和人工确认 | 本实验脚本不读取业务副本、不调用真实模型 |

同一个 Windows 用户下的多个进程和 `DSH_HOME` 目录，只是配置分离，不是可防御恶意插件的操作系统隔离。CLI 的 DPAPI 也不能隔离同一 Windows 用户启动的不同 Agent。正式员工环境仍需独立权限边界。

## 可复现命令

在单独克隆的官方源码中使用其锁定的 pnpm 版本安装依赖。本轮先禁用安装脚本，避免安装阶段自动设置 Git hooks 或构建无关组件；若运行测试需要本地原生组件，必须记录实际补充的构建步骤。

```powershell
# DSH 源码目录，HEAD 必须匹配 baseline.json。
pnpm install --frozen-lockfile --ignore-scripts

# 本验证分支的仓库根目录。
npm --prefix cli ci --ignore-scripts --no-audit --no-fund
npm --prefix cli run build
node experiments/dsh-cross-host-validation/probe-local.mjs
node experiments/dsh-cross-host-validation/run-upstream.mjs E:/DOON/deepseek-harness
node experiments/dsh-cross-host-validation/run-upstream.mjs E:/DOON/deepseek-harness composition
```

`probe-local.mjs` 固定只访问 `http://127.0.0.1:8797` 的公开健康入口及客户项目页面；CLI `whoami` 使用无登录凭据的临时目录，必须返回 `AUTH_REQUIRED`。不调用登录、业务查询、写入、导入或任何部署入口。没有启动或重建 8797 的逻辑。

`run-upstream.mjs` 检查上游提交，去除常用模型和中台环境配置，设置独立临时 `DSH_HOME` 和禁用遥测的测试标志。默认模式使用合成模型/协议替身。`composition` 模式使用上游的 headless/SDK profile 及真实进程，仅将模型换成测试模型，验证启动、路由、结果和错误返回；不验证 GUI、远程部署或真实模型能力。它调用的是源码内现成后端的测试，不是要求中台应用改用 DSH SDK。默认 profile 的日志上传路径仍需在真实运行联调前分别核对、关闭并验证。

生成结果保存在被忽略的 `test-output/dsh-cross-host-validation/`，包括测试计数和本地诊断。不得把员工凭据、原始业务数据、会话和附件加入本目录或公开测试报告。

## 后续跨环境验收

若采用长期独立员工环境，应验证受控的任务与消息连接：总管派单、员工领取、回传依据、来源身份不可伪造、跨员工访问拒绝、撤权立即生效、重启恢复、重复投递不重复执行、等待人工不算完成。收到消息、模型回复完成和中台实际执行完成分别记录。

现有原生子 Agent 能力与新增加的跨环境桥接必须分别归属。不能用自写模拟 Agent 的通过结果宣称 DSH 原生支持跨服务器员工协作。
