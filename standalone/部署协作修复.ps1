$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $projectRoot
$nodePath = 'C:\Program Files\nodejs\node.exe'
$stage = Join-Path $projectRoot 'test-output\collaboration-build'
$live = Join-Path $projectRoot 'lan-dist'
$rollback = Join-Path $projectRoot ('test-output\collaboration-rollback-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$checks = Get-Content -LiteralPath 'test-output\collaboration-browser-result.json' -Raw | ConvertFrom-Json
if ($checks.passed -ne 10) { throw '协作修复浏览器验收未通过。' }
$pmcChecks = Get-Content -LiteralPath 'test-output\pmc-browser-result.json' -Raw | ConvertFrom-Json
if ($pmcChecks.passed -ne 11) { throw 'PMC 回归验收未通过。' }
$business = Get-Content -LiteralPath 'test-output\result.json' -Raw | ConvertFrom-Json
if ($business.passed -ne 52) { throw '业务验收未通过。' }
if (-not (Test-Path -LiteralPath (Join-Path $stage 'workspace-api.mjs'))) { throw '缺少验收构建。' }
$task = Get-ScheduledTask -TaskName 'DOON-Order-Workspace'
$hostScript = Join-Path $PSScriptRoot 'service-host.mjs'
if (-not $task.Settings.Enabled) { throw '后台任务人工暂停中，不自动启用。' }
if ($task.Actions.WorkingDirectory -ne $projectRoot -or -not $task.Actions.Arguments.Contains("'" + $hostScript.Replace("'", "''") + "'")) { throw '任务与本项目不一致。' }
New-Item -ItemType Directory -Path $rollback | Out-Null
Get-ChildItem -LiteralPath $live | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $rollback -Recurse -Force }
$backup = & $nodePath 'lan-dist/manage.mjs' backup
if ($LASTEXITCODE -ne 0) { throw '正式数据库及附件备份失败。' }
$installed = $false
$paused = $false
try {
    Disable-ScheduledTask -TaskName $task.TaskName | Out-Null
    $paused = $true
    Stop-ScheduledTask -TaskName $task.TaskName
    $expectedHost = $hostScript.Replace('\','/').ToLowerInvariant()
    $expectedServer = (Join-Path $live 'server.mjs').Replace('\','/').ToLowerInvariant()
    $nodes = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'"
    $nodes | Where-Object { $_.CommandLine -and $_.CommandLine.Replace('\','/').ToLowerInvariant().Contains($expectedHost) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    $nodes | Where-Object { $_.CommandLine -and $_.CommandLine.Replace('\','/').ToLowerInvariant().Contains($expectedServer) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    if (Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue) { throw '8787 仍被监听，停止部署。' }
    & $nodePath 'scripts/verify-pmc-deployment.mjs' before
    if ($LASTEXITCODE -ne 0) { throw '部署前数据校验失败。' }
    Get-ChildItem -LiteralPath $stage | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $live -Recurse -Force }
    & $nodePath 'scripts/verify-pmc-deployment.mjs' after
    if ($LASTEXITCODE -ne 0) { throw '代码部署前后数据不一致。' }
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
    try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 2; if ($health.ok) { $healthy=$true; break } } catch {}
    Start-Sleep -Milliseconds 500
}
if (-not $healthy) { throw '部署后健康检查未通过。' }
$pages = @()
foreach ($route in @('department','finished-outsourcing','imports','receiving','pmc','login')) {
    $page = Invoke-WebRequest -UseBasicParsing -Uri ('http://192.168.1.176:8787/' + $route) -TimeoutSec 10
    $pages += [pscustomobject]@{route=$route;status=[int]$page.StatusCode}
}
& $nodePath 'scripts/verify-collaboration-live.mjs'
if ($LASTEXITCODE -ne 0) { throw '业务数据只读核验失败。' }
$result = [pscustomobject]@{ deployedAt=[DateTime]::UtcNow.ToString('o'); healthy=$healthy; pages=$pages; backup=($backup|ConvertFrom-Json); rollback=$rollback; clientHtml=$page.Content }
$result | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath 'test-output/collaboration-deployment.json' -Encoding utf8
$result | Select-Object deployedAt,healthy,pages,backup,rollback | ConvertTo-Json -Depth 4
