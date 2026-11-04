# DSH 总管与独立员工环境：首次验证结果

日期：2026-11-04。范围：源码能力核对、原生测试、8797 公开入口与真实 CLI 的无凭据探测。没有部署、调用真实模型或读取业务数据。

## 结论

可以继续采用 DSH 源码作为员工 Agent 的运行基础。已验证它具备同一会话树内通信、团队任务、权限检查，以及启动完整 DSH 子进程并接收结果的基础能力。但这些能力不能直接等同于“总管管理多个长期、彼此隔离的员工环境”。本次没有实现或验证后者。

如果采用长期独立员工环境，建议在 DSH 之外保留共同任务服务，并通过插件或受控连接器接入各环境。总管具有派单与查看获授权结果的能力；跨环境身份、可见范围、撤权与执行权限由程序判断，不由总管提示词决定。中台仍通过有鉴权的 API/CLI 访问，不向 Agent 挂载数据库或附件目录。

## 固定源码与环境

- 来源：[DeepSeek 官方仓库](https://github.com/deepseek-ai/deepseek-harness)。本地克隆路径为 `E:\DOON\deepseek-harness`。
- 提交：`fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`，包版本 `0.2.2-rc.1`；浅克隆包含该提交全部源码，不包含完整历史。
- Windows，Node `24.14.0`，上游锁定的 pnpm `11.28.5`。
- 使用 `pnpm install --frozen-lockfile --ignore-scripts`；未修改上游受版本管理的文件，未额外执行原生依赖构建。
- Doon 实验基于 `ff43f1ecffc87ef281aa8842e152f2488c0fb9bb`，位于独立工作树和 `codex/dsh-cross-host-validation` 分支。

## 实际执行结果

| 验证 | 结果 | 证明范围 |
|---|---|---|
| 原生同树通信 `sibling-messages.spec.ts` | 17 项通过 | 同树消息、跨分支成员寻址、冷恢复、无关父会话与过期发送者拒绝 |
| 原生子 Agent 控制 `control.spec.ts` | 19 项通过 | 控制与生命周期规则 |
| 子进程后端 `subagent-dsh-sdk.spec.ts` | 55 项通过 | 后端与协议边界；这组测试的子运行时是上游替身 |
| 团队任务 `team.spec.ts` | 40 项通过 | 任务、归属和版本检查 |
| 团队恢复 `persistence.spec.ts` | 6 项通过 | 合成会话下的持久化和重启恢复 |
| 非 owner 访问 `remote-access.host.spec.ts` | 21 项通过 | 资源授权、拒绝、访问时重查策略 |
| 真实父子运行时 `loader-composition.e2e.ts` | 3 项通过 | 真实 headless 父运行时与 SDK profile 子运行时的路由、工作目录、错误返回及提前拒绝；模型为测试替身 |
| CLI 编译 | 通过 | 仅在实验工作树安装 CLI 依赖并编译 |
| CLI 命令发现 | 427 个命令可枚举 | 仅证明命令目录可用，不能宣称 427 个业务动作均已联调 |
| 8797 健康与页面 | 通过 | `/health` 返回成功，页面包含本地测试与服务器数据副本标识 |
| 全新 CLI 配置下的 `whoami` | `AUTH_REQUIRED`，符合预期 | 未继承员工凭据；不代表完成有身份的中台接入 |

上游两组共 **161 项通过、0 失败、0 跳过**。全部模型输入为合成内容。测试输出保存在被 Git 忽略的目录，脚本清理其自建临时配置目录。没有占用新的持续服务端口，也没有改变 8797 的持久数据或配置。

## 已有能力的边界

### 同一总管下的成员，可以原生通信

同树的 `send_message` 能向兄弟成员、不同子分支和总管发送消息。无关父会话下的成员不能因为名称相同就获得通信权限；上游测试明确验证拒绝这类调用。

证据：[同树通信测试](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/subagent/subagent/tests/sibling-messages.spec.ts)。这是同一子 Agent 树的能力，不能直接当成任意员工 DSH 实例之间的寻址服务。

### 原生 Teams 不是跨进程共同任务服务

上游说明 Teams 在现有子 Agent 树上增加持久任务看板；成员共享工作区，Teams 不提供跨进程协调或独立工作目录。任务的版本检查可以借鉴，但不能据此认定员工 A、员工 B 的独立容器会自动共享任务。

证据：[Agent Team 说明](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/team/agent-team/README.md)。

### 真实子进程能启动，但属于按次新建的任务执行

DSH 源码内的 `subagent-dsh-sdk` 后端每次启动新的完整运行时，传入任务并返回最终文本或错误。上游明确限定为本机子进程，没有进程池；远程运行时还需要新的后端和工作目录映射。此次真实组合测试通过，也只覆盖该模式。

证据：[本机子进程后端](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/subagent/subagent-dsh-sdk/README.md)、[实际组合测试](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/subagent/subagent-dsh-sdk/tests/loader-composition.e2e.ts)。源码中的 ACP 后端同样说明工作目录为本机路径，远程映射和可继续调用的子会话属于后续能力，见 [ACP 后端说明](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/subagent/subagent-acp/README.md)。

### 远程权限和 Liveshare 可参考，但不能直接替代员工协作系统

远程访问模块已有资源与动作授权机制，默认 owner 不受非 owner 策略约束，员工身份必须正确映射。Liveshare 提供通过独立服务器共享会话的机制，属于实验功能；其说明指出服务器侧的 OAuth、数据库、路由和部署不包含在该包中。本轮未运行 Liveshare 网络链路。

证据：[Remote Access](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/api/remote-access/README.md)、[Liveshare](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/experimental/liveshare/README.md)。

## 尚未证明的部分与下一步验收

本机没有可直接使用的 Docker CLI。本轮没有验证 Linux 容器、恶意插件隔离、员工真实身份、真实模型调用、业务查询/写入或跨环境网络协议。同一 Windows 用户下多个进程、目录或 DPAPI 文件不能作为员工之间的安全隔离证明。

下一阶段应在三个具有独立身份和存储权限的环境中启动总管、员工 A、员工 B，使用合成数据验证：

1. 总管通过共同任务服务向 A 派单；B 看不到未授权任务，发送者不能伪造身份。
2. A 接收并处理任务、回传依据；总管能核对执行结果，收到回复不能自动当成业务完成。
3. 撤权后旧连接和排队任务被拒绝；重启能恢复任务，重复投递不会重复执行。
4. 各环境的插件与文件权限独立；安装插件不会获得另一名员工或中台的数据目录权限。
5. 之后再接入指定测试身份的中台 API/CLI；模型参与的业务判断保留人工确认，实际执行由服务端复核权限、版本和幂等。

这些是下一阶段尚待实现和实测的项目，不计入本次通过数量。复现方式见 [README](README.md)。
