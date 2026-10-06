$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $projectRoot
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$nodePath = if ($nodeCommand) { $nodeCommand.Source } else { 'C:\Program Files\nodejs\node.exe' }
if (-not (Test-Path -LiteralPath $nodePath)) { throw '请安装 Node.js 22.18 或更新版本。' }
$managedTask = Get-ScheduledTask -TaskName 'DOON-Order-Workspace' -ErrorAction SilentlyContinue
if ($managedTask) {
    $expectedHost = Join-Path $PSScriptRoot 'service-host.mjs'
    if ($managedTask.Actions.WorkingDirectory -ne $projectRoot -or -not $managedTask.Actions.Arguments.Contains("'" + $expectedHost.Replace("'", "''") + "'")) { throw '后台任务与本项目不匹配，请先检查。' }
    if ($managedTask.State -eq 'Disabled') { Enable-ScheduledTask -TaskName $managedTask.TaskName | Out-Null }
    if ($managedTask.State -ne 'Running') { Start-ScheduledTask -TaskName $managedTask.TaskName }
    for ($attempt = 0; $attempt -lt 15; $attempt++) {
        try { $managedHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 2 } catch { $managedHealth = $null }
        if ($managedHealth.ok -and $managedHealth.service -eq '度昂订单协作中台·内网版') { Write-Host '订单中台已运行，后台守护已开启。'; exit }
        Start-Sleep -Seconds 1
    }
    throw '服务未在预期时间就绪，请检查 lan-data/service-events.jsonl 与 server-error.log。'
}
try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 2 } catch { $health = $null }
if ($health.ok -and $health.service -eq '度昂订单协作中台·内网版') { Write-Host '订单中台已经运行。'; exit }
Start-Process -FilePath $nodePath -ArgumentList 'lan-dist/server.mjs' -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput "$projectRoot\lan-data\server.log" -RedirectStandardError "$projectRoot\lan-data\server-error.log"
Write-Host '订单中台已启动。本机打开 http://127.0.0.1:8787；内网地址见 lan-data/server-status.json。'
