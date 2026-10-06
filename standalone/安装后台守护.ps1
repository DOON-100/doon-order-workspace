$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$nodePath = 'C:\Program Files\nodejs\node.exe'
$hostScript = Join-Path $PSScriptRoot 'service-host.mjs'
$taskName = 'DOON-Order-Workspace'
if (-not (Test-Path -LiteralPath $nodePath)) { throw '找不到 Node.js。' }
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'lan-dist\server.mjs'))) { throw '缺少内网运行版本。' }
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) { throw '同名后台任务已存在，请检查后再更新，不覆盖现有任务。' }
$account = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$taskShell = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$hostCommand = "& '" + $nodePath.Replace("'", "''") + "' '" + $hostScript.Replace("'", "''") + "'; exit " + '$LASTEXITCODE'
$taskArguments = '-NoProfile -NonInteractive -WindowStyle Hidden -Command "' + $hostCommand + '"'
$action = New-ScheduledTaskAction -Execute $taskShell -Argument $taskArguments -WorkingDirectory $projectRoot
$onLogon = New-ScheduledTaskTrigger -AtLogOn -User $account
$recovery = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($onLogon,$recovery) -Settings $settings -Principal $principal -Description '度昂订单中台：当前 Windows 用户登录后运行；保持公司内网服务，意外退出自动恢复；不保存密码。' | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Host '后台守护已安装。当前 Windows 用户登录后自动运行，服务异常退出会自动恢复。主机关机、睡眠或用户注销期间不可访问。'
