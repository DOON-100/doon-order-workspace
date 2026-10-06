$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $projectRoot
$nodePath = 'C:\Program Files\nodejs\node.exe'
$stage = Join-Path $projectRoot 'test-output\metric-build'
$live = Join-Path $projectRoot 'lan-dist'
$rollback = Join-Path $projectRoot ('test-output\metric-rollback-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$checks = Get-Content -LiteralPath 'test-output\metric-acceptance-result.json' -Raw | ConvertFrom-Json
$business = Get-Content -LiteralPath 'test-output\result.json' -Raw | ConvertFrom-Json
if ($checks.passed -ne 14 -or $business.passed -ne 52) { throw '汇总明细或业务回归验收未通过。' }
foreach ($part in @('workspace-api.mjs','client\index.html','client\assets')) {
    if (-not (Test-Path -LiteralPath (Join-Path $stage $part))) { throw ('缺少验收构建：' + $part) }
}
$status = Get-Content -LiteralPath 'lan-data\service-status.json' -Raw | ConvertFrom-Json
if ($status.state -ne 'running') { throw '现有后台守护未处于运行状态，不重启服务。' }
$child = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + [int]$status.childPid)
$guardian = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + [int]$status.hostPid)
$expectedServer = (Join-Path $live 'server.mjs').Replace('\','/').ToLowerInvariant()
$expectedGuardian = (Join-Path $PSScriptRoot 'service-host.mjs').Replace('\','/').ToLowerInvariant()
if (-not $child.CommandLine -or -not $child.CommandLine.Replace('\','/').ToLowerInvariant().Contains($expectedServer) -or $child.ParentProcessId -ne $guardian.ProcessId) { throw '服务进程与本项目不匹配。' }
if (-not $guardian.CommandLine -or -not $guardian.CommandLine.Replace('\','/').ToLowerInvariant().Contains($expectedGuardian)) { throw '后台守护进程不匹配。' }
if (-not (Invoke-RestMethod 'http://127.0.0.1:8787/health' -TimeoutSec 3).ok) { throw '原服务健康检查失败。' }
New-Item -ItemType Directory -Path $rollback | Out-Null
Copy-Item -LiteralPath (Join-Path $live 'workspace-api.mjs') -Destination $rollback
Copy-Item -LiteralPath (Join-Path $live 'client') -Destination $rollback -Recurse
& $nodePath 'scripts/verify-metric-live.mjs' before
if ($LASTEXITCODE -ne 0) { throw '部署前只读校验失败。' }
$ready = $false
try {
    # Keep old hashed assets for open browser tabs. Only code/static resources change.
    Get-ChildItem -LiteralPath (Join-Path $stage 'client\assets') -File | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $live 'client\assets') -Force }
    Copy-Item -LiteralPath (Join-Path $stage 'workspace-api.mjs') -Destination (Join-Path $live 'workspace-api.mjs') -Force
    Copy-Item -LiteralPath (Join-Path $stage 'client\index.html') -Destination (Join-Path $live 'client\index.html') -Force
    Stop-Process -Id $child.ProcessId -Force
    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 500
        try {
            $fresh = Get-Content -LiteralPath 'lan-data\server-status.json' -Raw | ConvertFrom-Json
            $health = Invoke-RestMethod 'http://127.0.0.1:8787/health' -TimeoutSec 2
            if ($fresh.pid -ne $child.ProcessId -and $health.ok) { $ready = $true; break }
        } catch {}
    }
    if (-not $ready) { throw '更新后服务没有恢复。' }
    $page = Invoke-WebRequest -UseBasicParsing 'http://192.168.1.176:8787/' -TimeoutSec 5
    $expectedHtml = Get-Content -LiteralPath (Join-Path $stage 'client\index.html') -Raw
    if ($page.Content.Trim() -ne $expectedHtml.Trim()) { throw '内网页面未加载本次构建。' }
    & $nodePath 'scripts/verify-metric-live.mjs' after
    if ($LASTEXITCODE -ne 0) { throw '部署前后业务数据检查未通过。' }
    [pscustomobject]@{deployedAt=[DateTime]::UtcNow.ToString('o');healthy=$true;oldPid=$child.ProcessId;newPid=$fresh.pid;rollback=$rollback;checks=$checks.passed;businessChecks=$business.passed;url='http://192.168.1.176:8787';businessDataPreserved=$true} | ConvertTo-Json | Set-Content -LiteralPath 'test-output\metric-deployment.json' -Encoding utf8
    Get-Content -LiteralPath 'test-output\metric-deployment.json' -Raw
} catch {
    Copy-Item -LiteralPath (Join-Path $rollback 'workspace-api.mjs') -Destination (Join-Path $live 'workspace-api.mjs') -Force
    Get-ChildItem -LiteralPath (Join-Path $rollback 'client') | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $live 'client') -Recurse -Force }
    $current = Get-Content -LiteralPath 'lan-data\server-status.json' -Raw | ConvertFrom-Json
    $process = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + [int]$current.pid)
    if ($process.CommandLine -and $process.CommandLine.Replace('\','/').ToLowerInvariant().Contains($expectedServer)) { Stop-Process -Id $process.ProcessId -Force }
    throw
}
