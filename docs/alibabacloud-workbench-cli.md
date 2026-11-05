# 云服务器维护入口

本文件只记录通用连接方法。实际实例 ID、地域、机器规格、资源采样、连接状态与运维记录保存在受控私有位置，不提交公开仓库。连接、部署、重启或业务数据操作均须遵循对应任务的授权范围。

## 本机配置

使用本机已安装的 Workbench CLI，通过其交互配置保存认证；不要把密钥放进命令、URL、截图或日志。凭据配置位于本机用户配置目录，不提交 Git。权限不足时核对已授权的 RAM 资源范围，不自动扩大授权。

## PowerShell 示例

由管理员在本机提供目标信息，环境变量不写入公开脚本：

```powershell
$wb = Join-Path $env:LOCALAPPDATA 'Programs\workbench\workbench.exe'
$instanceId = $env:DOON_ECS_INSTANCE_ID
$region = $env:DOON_ECS_REGION
if (-not $instanceId -or -not $region) { throw '请先在本机配置已授权的实例和地域。' }
& $wb connect --instance-id $instanceId --region $region --profile default
```

用 `Ctrl+D` 退出。只读检查示例：

```powershell
& $wb exec --instance-id $instanceId --region $region --profile default --command 'uname -srmo; uptime; df -hT; free -h' --timeout 30
```

诊断输出可能包含真实主机信息，应保存到被忽略的私有运维目录，只向公开文档提交脱敏结论。此说明不是实际服务器已连接、已部署或已验收的证据。
