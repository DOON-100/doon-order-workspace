$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $projectRoot
$nodePath = 'C:\Program Files\nodejs\node.exe'
$shellPath = (Get-Process -Id $PID).Path
$stage = Join-Path $projectRoot 'test-output\pmc-build'
$live = Join-Path $projectRoot 'lan-dist'
$rollback = Join-Path $projectRoot ('test-output\pmc-rollback-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
if (-not (Test-Path -LiteralPath (Join-Path $stage 'workspace-api.mjs'))) { throw '缺少已验收的构建。' }
$checks = Get-Content -LiteralPath (Join-Path $projectRoot 'test-output\pmc-browser-result.json') -Raw | ConvertFrom-Json
if ($checks.passed -ne 11) { throw 'PMC浏览器验收未通过。' }
$task = Get-ScheduledTask -TaskName 'DOON-Order-Workspace'
if (-not $task.Settings.Enabled) { throw '网站处于人工维护状态，本次不自动启用。' }
New-Item -ItemType Directory -Path $rollback | Out-Null
Get-ChildItem -LiteralPath $live | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $rollback -Recurse -Force }
$backup = & $nodePath 'lan-dist/manage.mjs' backup
if ($LASTEXITCODE -ne 0) { throw '正式数据备份失败。' }
$stopped = $false
$installed = $false
try {
    & $shellPath -NoProfile -NonInteractive -File (Join-Path $PSScriptRoot '停止订单中台.ps1')
    if ($LASTEXITCODE -ne 0) { throw '停止网站失败。' }
    $stopped = $true
    & $nodePath 'scripts/verify-pmc-deployment.mjs' before
    if ($LASTEXITCODE -ne 0) { throw '无法保存部署前数据校验。' }
    Get-ChildItem -LiteralPath $stage | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $live -Recurse -Force }
    & $nodePath 'scripts/verify-pmc-deployment.mjs' after
    if ($LASTEXITCODE -ne 0) { throw '部署数据一致性校验失败。' }
    $installed = $true
} finally {
    if ($stopped) {
        if (-not $installed) {
            Get-ChildItem -LiteralPath $rollback | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $live -Recurse -Force }
        }
        & $shellPath -NoProfile -NonInteractive -File (Join-Path $PSScriptRoot '启动订单中台.ps1')
        if ($LASTEXITCODE -ne 0) { throw '启动网站失败，需要检查守护日志。' }
    }
}
$local = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 5
$page = Invoke-WebRequest -UseBasicParsing -Uri 'http://192.168.1.176:8787/pmc' -TimeoutSec 5
$record = [pscustomobject]@{ deployedAt=[DateTime]::UtcNow.ToString('o'); healthy=$local.ok; pmcStatus=[int]$page.StatusCode; backup=($backup|ConvertFrom-Json); rollback=$rollback; clientHtml=$page.Content }
$record | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath 'test-output/pmc-deployment.json' -Encoding utf8
$record | Select-Object deployedAt,healthy,pmcStatus,backup,rollback | ConvertTo-Json -Depth 4
