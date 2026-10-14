# 使用 Workbench Skill 连接阿里云服务器

通过 `alibabacloud-workbench-cli` Skill，可以在 Codex 中用中文查询 ECS、执行远程命令、查看日志和传输文件。本指南使用 Windows PowerShell，示例地域为深圳 `cn-shenzhen`。

## 1. 准备条件

- 目标服务器为运行中的 Linux ECS，云助手 Agent 已安装并正常运行。
- 本机已安装 Skill 和 Workbench CLI；本次已验证 CLI v1.0.4 可用。
- RAM 用户具备 Workbench 所需权限，本机已配置该用户的认证。
- 本机能够访问阿里云 API 和 Workbench 后端。

Workbench 支持连接没有公网 IP 的实例。当前 CLI 不支持 Windows ECS；详细条件见[官方管理指南](https://help.aliyun.com/zh/ecs/user-guide/use-workbench-cli-to-manage-ecs-instances)。

## 2. 安装 Skill 和 CLI

Skill 和 CLI 需要分别安装。

在 Codex 中发送以下请求安装 Skill：

> 请通过 https://skills.aliyun.com/api/public/skills/alibabacloud-workbench-cli/download 下载并安装 alibabacloud-workbench-cli Skill。

新技能通常在下一条消息可用；未识别时重启 Codex。参见[官方技能说明](https://learn.chatgpt.com/docs/build-skills)。

在新电脑的 PowerShell 中安装 CLI，可使用阿里云提供的命令：

```powershell
irm https://workbench-cli.oss-cn-hangzhou.aliyuncs.com/install.ps1 | iex
```

安装脚本会下载 CLI 并校验 SHA-256。建议先查看脚本；安装目录以实际输出为准。本次本机安装时修正了脚本的普通用户安装路径，使用下列用户目录：

```powershell
$wb = Join-Path $env:LOCALAPPDATA 'Programs\workbench\workbench.exe'
& $wb version
```

如果通过官方脚本安装在其他位置且 PATH 已生效，可用以下方式确定可执行文件路径：

```powershell
$wb = (Get-Command workbench -ErrorAction Stop).Source
& $wb version
```

以下命令沿用同一个 PowerShell 窗口中的 `$wb`。若提示找不到 `workbench`，重新打开终端，或直接使用安装目录中的 `workbench.exe`。

## 3. 配置 RAM 权限和认证

在 RAM 控制台创建或选择 RAM 用户，按照[官方凭证与权限配置步骤](https://help.aliyun.com/zh/ecs/user-guide/install-and-configure-workbench-cli-credentials)创建自定义策略并授权给该用户，再创建或使用已启用的 AccessKey。生产环境建议使用 RAM 角色等可自动刷新临时凭证的方式。

**AccessKey 已启用只表示密钥可用，仍需为 RAM 用户授予操作权限。** 查询实例需要 `ecs:DescribeInstances`；连接还涉及 Workbench 登录、云助手和终端会话权限。首次使用可能需要创建 Workbench 服务关联角色，完整策略与授权范围以官方文档为准。

本机采用 AK 认证时执行：

```powershell
& $wb config --profile default
```

按提示选择 `AK`，输入同一对 AccessKey ID 和 Secret。配置保存在本机 `%USERPROFILE%\.workbench\config.json`。如果当前使用其他配置，可切换到本次配置：

```powershell
& $wb config switch --profile default
```

- AccessKey ID 通常以 `LTAI` 开头，用于认证。
- ECS 实例 ID 以 `i-` 开头，用于指定服务器。
- RAM 控制台登录密码不用于这个 CLI 的 AK 认证流程。
- Secret 只在本机交互输入，不写入聊天、命令参数、Markdown 或公开仓库。
- 不运行 `config get` 来分享配置，因为输出可能包含凭证。

## 4. 找到服务器并检查连接

先查询深圳地域的实例列表：

```powershell
& $wb list ecs --region cn-shenzhen --output json
```

也可进入阿里云 ECS 控制台，选择“华南1（深圳）”，在实例详情中复制实例 ID。

将下面的示例 ID 替换为真实实例 ID，再执行系统、磁盘和内存检查：

```powershell
$instanceId = 'i-xxxxxxxxxxxxxxxxxxxx'
& $wb exec --instance-id $instanceId --region cn-shenzhen --command 'hostname; uname -srmo; cat /etc/os-release; uptime; df -hT; free -h' --timeout 30 --output json
```

该命令只查询主机名、系统与内核、运行时间与负载、磁盘和内存情况。检查结果中的 `exit_code` 应为 `0`，输出通常位于 `stdout` 或 `output`。

若希望自己进入交互终端，可执行：

```powershell
& $wb connect --instance-id $instanceId --region cn-shenzhen
```

使用 `Ctrl+D` 退出交互会话。参见[官方连接指南](https://help.aliyun.com/zh/ecs/user-guide/connect-to-an-instance-through-workbench-cli/)。

## 5. 在 Codex 中直接使用 Skill

完成本机认证后，把实际实例 ID 和要做的事情告诉 Codex。例如，先替换下面的示例 ID：

> 使用 alibabacloud-workbench-cli，连接实例 i-xxxxxxxxxxxxxxxxxxxx，地域 cn-shenzhen，检查系统、磁盘和内存。

其他常用请求：

> 使用 alibabacloud-workbench-cli，列出深圳地域的 ECS 实例。

> 查看这台服务器的 nginx 状态和最近 100 行错误日志。

每次远程 `exec` 使用独立 shell，前一次的 `cd` 或环境变量不会保留。需要在指定目录执行时，应在同一次命令中切换目录再执行。

涉及部署、删除、覆盖文件或停止、重启服务时，应明确目标和操作范围。本项目正式服务使用 8787 端口；提交或推送代码不代表部署，不因此执行服务重启。

## 6. 常见错误

| 错误 | 含义及处理 |
| --- | --- |
| 找不到 `workbench` | PATH 尚未刷新或安装目录不同。重新打开终端，或使用完整路径。 |
| `IncompleteSignature` / `SignatureDoesNotMatch` | 签名校验失败。核对 ID 与 Secret 是否来自同一对密钥、是否完整、是否带有多余空格，重新运行 `config`。 |
| `InvalidAccessKeyId` | 密钥不存在或无效。在 RAM 控制台核对对应 ID、启用状态及是否已删除，并检查当前 Profile。 |
| `Forbidden.RAM` | RAM 权限不足。依据报错中的 `AuthAction` 检查策略及资源范围；查询实例常见缺失项为 `ecs:DescribeInstances`。 |
| `Forbidden.Unauthorized` | 连接操作未获授权。核对 Workbench 权限、授权用户及实例资源范围。 |
| 超时或云助手相关错误 | 检查实例是否运行、云助手 Agent 状态及本机网络连通性。 |

修正后重试。排错时仅分享错误码和必要提示，不分享完整配置文件、密钥、会话信息或密码。已泄露的密码和密钥应更换，并在本机更新认证配置。
