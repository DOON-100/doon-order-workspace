$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$managedTask = Get-ScheduledTask -TaskName 'DOON-Order-Workspace' -ErrorAction SilentlyContinue
if ($managedTask) {
    $expectedHost = Join-Path $PSScriptRoot 'service-host.mjs'
    if ($managedTask.Actions.WorkingDirectory -ne $projectRoot -or -not $managedTask.Actions.Arguments.Contains("'" + $expectedHost.Replace("'", "''") + "'")) { throw '后台任务与本项目不匹配，不停止其他任务。' }
    Disable-ScheduledTask -TaskName $managedTask.TaskName | Out-Null
    Stop-ScheduledTask -TaskName $managedTask.TaskName
    Write-Host '已暂停后台守护；下次运行启动脚本可恢复。'
}
$statusPath = Join-Path $projectRoot 'lan-data\server-status.json'
if (-not (Test-Path -LiteralPath $statusPath)) { Write-Host '没有运行记录。'; exit }
$serverInfo = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json
$processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $($serverInfo.pid)"
if ($processInfo -and $processInfo.Name -eq 'node.exe' -and $processInfo.CommandLine -like '*lan-dist/server.mjs*') { Stop-Process -Id $serverInfo.pid; Write-Host '订单中台已停止。' } else { Write-Host '记录的进程已退出，不停止其他程序。' }
