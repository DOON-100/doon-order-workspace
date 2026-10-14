# 阿里云服务器日常连接

## 当前环境

| 项目 | 已确认情况 |
| --- | --- |
| 本机 | Windows 10 家庭中文版，64 位，使用 PowerShell |
| 服务器地域 | 深圳，`cn-shenzhen` |
| ECS 实例型号 | `ecs.e-c1m2.large` |
| 实例系列 | 经济型 e，共享型实例 |
| CPU 型号（系统显示） | Intel Xeon Platinum；未显示具体型号编号 |
| CPU / 内存 | 2 vCPU、4GiB 内存；系统识别内存约 3.5GiB |
| 架构 / 虚拟化 | x86_64 / KVM |
| 服务器系统 | Ubuntu 24.04.5 LTS，64 位 |
| 系统盘 | 80GiB；根分区约 79G |
| 交换空间 | 4GiB |

核实日期：2026-10-14。实例型号来自阿里云实例查询，CPU 信息来自服务器 `lscpu`，磁盘容量来自 `lsblk`；系列名称及标称 CPU / 内存对应[阿里云官方规格表](https://help.aliyun.com/zh/ecs/user-guide/shared-instance-families)。

认证与 RAM 权限已配置，已成功连接。本机配置使用 `default`，日常直接连接即可。以下示例中的实例 ID 需要替换；带实际实例 ID 的个人版保存在本机，不提交到公开仓库。

## 在 Codex 中用中文操作

将示例 ID 替换为实际 ID，再发送：

> 使用 alibabacloud-workbench-cli，连接实例 i-xxxxxxxxxxxxxxxxxxxx，地域 cn-shenzhen，检查系统、磁盘和内存。

同一对话后续可以直接说：

> 检查这台服务器的磁盘剩余空间和内存使用情况。

> 查看这台服务器当前运行的服务和监听端口。

## 自己用 PowerShell 连接

打开 PowerShell，设置本机实际使用的程序路径，并替换示例实例 ID：

```powershell
$wb = Join-Path $env:LOCALAPPDATA 'Programs\workbench\workbench.exe'
$instanceId = 'i-xxxxxxxxxxxxxxxxxxxx'
```

进入服务器终端：

```powershell
& $wb connect --instance-id $instanceId --region cn-shenzhen --profile default
```

按 `Ctrl+D` 退出。只需要检查系统、磁盘和内存时：

```powershell
& $wb exec --instance-id $instanceId --region cn-shenzhen --profile default --command 'hostname; uname -srmo; cat /etc/os-release; uptime; df -hT; free -h' --timeout 30
```

在同一个 PowerShell 窗口中使用以上命令；新窗口重新设置 `$wb` 和 `$instanceId`。

## 连接出错时

- 找不到 `workbench`：直接使用以上 `$wb` 路径，无需依赖 PATH。
- 密钥已更换，或返回 `InvalidAccessKeyId`、`SignatureDoesNotMatch`：执行 `& $wb config --profile default`，在本机输入对应的新凭证。
- 返回 `Forbidden.RAM` 或 `Forbidden.Unauthorized`：检查当前 RAM 用户的授权和实例资源范围；按[官方权限说明](https://help.aliyun.com/zh/ecs/user-guide/install-and-configure-workbench-cli-credentials)核对。

凭证保存在本机 `%USERPROFILE%\.workbench\config.json`。不要把密码、Secret 或配置文件写进文档、聊天和公开仓库。
