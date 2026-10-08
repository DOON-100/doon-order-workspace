# Code-only release. Ivy data is imported separately by the reviewed additive CLI.
$ErrorActionPreference='Stop'
$projectRoot=(Resolve-Path -LiteralPath (Split-Path $PSScriptRoot -Parent)).Path
Set-Location -LiteralPath $projectRoot
$env:DOON_DATA_DIR=Join-Path $projectRoot 'lan-data'
$nodePath='C:\Program Files\nodejs\node.exe'
$stage=(Resolve-Path -LiteralPath (Join-Path $projectRoot 'test-output\service-workspace-build')).Path
$live=(Resolve-Path -LiteralPath (Join-Path $projectRoot 'lan-dist')).Path
if ($live -ne (Join-Path $projectRoot 'lan-dist') -or $stage -ne (Join-Path $projectRoot 'test-output\service-workspace-build')) { throw 'Unexpected build paths.' }
foreach ($file in @('workspace-api.mjs','runtime.mjs','auth.mjs','server.mjs','manage.mjs','client\index.html')) {
 if (-not (Test-Path -LiteralPath (Join-Path $stage $file))) { throw "Missing artifact: $file" }
}
$business=Get-Content -LiteralPath 'test-output\result.json' -Raw | ConvertFrom-Json
if ($business.passed -lt 96) { throw 'Required business regression checks have not passed.' }
$task=Get-ScheduledTask -TaskName 'DOON-Order-Workspace'
$hostScript=Join-Path $PSScriptRoot 'service-host.mjs'
if (-not $task.Settings.Enabled) { throw 'Supervisor is manually paused; do not enable automatically.' }
if ($task.Actions.WorkingDirectory -ne $projectRoot -or -not $task.Actions.Arguments.Contains($hostScript)) { throw 'Task belongs to another project.' }
$expectedHost=$hostScript.Replace('\','/').ToLowerInvariant()
$expectedServer=(Join-Path $live 'server.mjs').Replace('\','/').ToLowerInvariant()
$nodes=Get-CimInstance Win32_Process -Filter "Name = 'node.exe'"
$listeners=@(Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue)
if (-not $listeners.Count) { throw 'Production is not listening; investigate first.' }
foreach ($listener in $listeners) {
 $process=$nodes | Where-Object ProcessId -eq $listener.OwningProcess
 if (-not $process.CommandLine -or -not $process.CommandLine.Replace('\','/').ToLowerInvariant().Contains($expectedServer)) { throw 'Port 8787 is not owned by this app.' }
}
function Stop-VerifiedService {
 Disable-ScheduledTask -TaskName $task.TaskName | Out-Null
 Stop-ScheduledTask -TaskName $task.TaskName
 Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object {
  $_.CommandLine -and ($_.CommandLine.Replace('\','/').ToLowerInvariant().Contains($expectedHost) -or $_.CommandLine.Replace('\','/').ToLowerInvariant().Contains($expectedServer))
 } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
 for ($i=0;$i -lt 20;$i++) { if (-not (Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue)) { return }; Start-Sleep -Milliseconds 250 }
 throw 'Listener is still active; no code may be copied.'
}
function Start-VerifiedService {
 Enable-ScheduledTask -TaskName $task.TaskName | Out-Null
 Start-ScheduledTask -TaskName $task.TaskName
}
function Test-ReleaseHealth {
 for ($i=0;$i -lt 30;$i++) {
  try { $health=Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 2; if ($health.ok -and $health.service -eq '度昂订单协作中台·内网版') { return $true } } catch {}
  Start-Sleep -Milliseconds 500
 }
 return $false
}
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$rollback=Join-Path $projectRoot ('test-output\service-code-rollback-'+$stamp)
$checkpoint=Join-Path $projectRoot ('test-output\service-preservation-'+$stamp+'.json')
New-Item -ItemType Directory -Path $rollback | Out-Null
Get-ChildItem -LiteralPath $live | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $rollback -Recurse -Force }
$onlineBackup=& $nodePath 'lan-dist/manage.mjs' backup
if ($LASTEXITCODE -ne 0) { throw 'Online database/attachment backup failed; service unchanged.' }
$maintenance=$false
$codeTouched=$false
try {
 $maintenance=$true
 Stop-VerifiedService
 # Include legitimate employee edits made during the online backup.
 $stoppedBackup=& $nodePath 'lan-dist/manage.mjs' backup
 if ($LASTEXITCODE -ne 0) { throw 'Stopped-service backup failed.' }
 $before=& $nodePath 'scripts/verify-customer-quote-deployment.mjs' before $checkpoint
 if ($LASTEXITCODE -ne 0) { throw 'Preservation checkpoint failed.' }
 # Copy code only; never replace lan-data. Keep old hashed assets for open tabs.
 $codeTouched=$true
 Get-ChildItem -LiteralPath $stage | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $live -Recurse -Force }
 $after=& $nodePath 'scripts/verify-customer-quote-deployment.mjs' after $checkpoint --unchanged
 if ($LASTEXITCODE -ne 0) { throw 'Historical data changed during release; investigate.' }
 Start-VerifiedService
 if (-not (Test-ReleaseHealth)) { throw 'New service health check failed.' }
 $page=Invoke-WebRequest -UseBasicParsing -Uri 'http://192.168.1.176:8787/service' -TimeoutSec 10
 if ($page.StatusCode -ne 200) { throw 'Service workspace page is not reachable.' }
 $expectedHtml=[System.IO.File]::ReadAllText((Join-Path $stage 'client\index.html'))
 if ($page.Content -ne $expectedHtml) { throw 'Served page is not the tested build.' }
 $maintenance=$false
} catch {
 $failure=$_
 $recoveryFailure=$null
 if ($maintenance) {
  try {
   # A failed initial stop has not changed code: resume the original supervisor
   # directly, rather than retrying the same failing stop and leaving it disabled.
   if ($codeTouched) {
    Stop-VerifiedService
    Get-ChildItem -LiteralPath $rollback | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $live -Recurse -Force }
   }
   Start-VerifiedService
   if (-not (Test-ReleaseHealth)) { throw 'Recovery health check did not pass.' }
  } catch { $recoveryFailure=$_ }
 }
 if ($recoveryFailure) { throw "Release failed: $failure. Recovery also failed: $recoveryFailure. Inspect supervisor state before proceeding; database was never restored or overwritten." }
 throw $failure
}
$result=[pscustomobject]@{deployedAt=[DateTime]::UtcNow.ToString('o');healthy=$true;pageStatus=[int]$page.StatusCode;dataPreserved=$true;checkpoint=$checkpoint;rollback=$rollback;before=($before|ConvertFrom-Json);after=($after|ConvertFrom-Json);onlineBackup=($onlineBackup|ConvertFrom-Json);stoppedBackup=($stoppedBackup|ConvertFrom-Json)}
$result|ConvertTo-Json -Depth 6|Set-Content -LiteralPath ('test-output\service-deployment-'+$stamp+'.json') -Encoding utf8
$result|ConvertTo-Json -Depth 6
