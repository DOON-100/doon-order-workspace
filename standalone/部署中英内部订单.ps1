$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Split-Path $PSScriptRoot -Parent)).Path
Set-Location -LiteralPath $projectRoot
$nodePath = 'C:\Program Files\nodejs\node.exe'
$stage = Join-Path $projectRoot 'test-output\factory-order-build'
$live = Join-Path $projectRoot 'lan-dist'
$rollback = Join-Path $projectRoot ('test-output\factory-order-rollback-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
if ((Get-Content -LiteralPath 'test-output\result.json' -Raw | ConvertFrom-Json).passed -lt 74) { throw '业务验收未通过。' }
if (-not (Test-Path -LiteralPath (Join-Path $stage 'workspace-api.mjs'))) { throw '缺少独立验收构建。' }
$task = Get-ScheduledTask -TaskName 'DOON-Order-Workspace'
$hostScript = Join-Path $PSScriptRoot 'service-host.mjs'
if (-not $task.Settings.Enabled) { throw '后台任务已人工暂停，不自动启用。' }
if ($task.Actions.WorkingDirectory -ne $projectRoot -or -not $task.Actions.Arguments.Contains("'" + $hostScript.Replace("'", "''") + "'")) { throw '后台任务不属于本项目。' }
New-Item -ItemType Directory -Path $rollback | Out-Null
Get-ChildItem -LiteralPath $live | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $rollback -Recurse -Force }
$backupText = & $nodePath 'lan-dist/manage.mjs' backup
if ($LASTEXITCODE -ne 0) { throw '正式数据在线备份失败。' }
$backup = $backupText | ConvertFrom-Json
$installed = $false
$paused = $false
try {
    Disable-ScheduledTask -TaskName $task.TaskName | Out-Null
    $paused = $true
    Stop-ScheduledTask -TaskName $task.TaskName
    $expectedHost = $hostScript.Replace('\','/').ToLowerInvariant()
    $expectedServer = (Join-Path $live 'server.mjs').Replace('\','/').ToLowerInvariant()
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -and ($_.CommandLine.Replace('\','/').ToLowerInvariant().Contains($expectedHost) -or $_.CommandLine.Replace('\','/').ToLowerInvariant().Contains($expectedServer)) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    if (Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue) { throw '8787仍被占用，停止更新。' }
    Get-ChildItem -LiteralPath $stage | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $live -Recurse -Force }
    & $nodePath 'scripts/verify-record-preservation.mjs' (Join-Path $backup.folder 'workspace.sqlite')
    if ($LASTEXITCODE -ne 0) { throw '订单与账号数据保护校验失败。' }
    $installed = $true
} finally {
    if ($paused) {
        if (-not $installed) { Get-ChildItem -LiteralPath $rollback | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $live -Recurse -Force } }
        Enable-ScheduledTask -TaskName $task.TaskName | Out-Null
        Start-ScheduledTask -TaskName $task.TaskName
    }
}
$healthy = $false
for ($i=0; $i -lt 20; $i++) {
    try { if ((Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 2).ok) { $healthy=$true; break } } catch {}
    Start-Sleep -Milliseconds 500
}
if (-not $healthy) { throw '更新后服务健康检查未通过。' }
[pscustomobject]@{deployedAt=[DateTime]::UtcNow.ToString('o');healthy=$healthy;rollback=$rollback;backup=$backup.folder} | ConvertTo-Json | Set-Content -LiteralPath 'test-output\factory-order-deployment.json' -Encoding utf8
Write-Output '中英内部订单表格版已更新，订单与账号数据保持不变。'
