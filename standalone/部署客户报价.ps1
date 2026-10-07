param([Parameter(Mandatory=$true)][string]$DraftPath,[Parameter(Mandatory=$true)][string]$SourcePath,[string]$AccessConfigPath='')
$ErrorActionPreference='Stop'
$projectRoot=(Resolve-Path -LiteralPath (Split-Path $PSScriptRoot -Parent)).Path
Set-Location -LiteralPath $projectRoot
$env:DOON_DATA_DIR=Join-Path $projectRoot 'lan-data'
$nodePath='C:\Program Files\nodejs\node.exe'
$stage=(Resolve-Path -LiteralPath (Join-Path $projectRoot 'test-output\quote-review-build')).Path
$live=(Resolve-Path -LiteralPath (Join-Path $projectRoot 'lan-dist')).Path
if ($live -ne (Join-Path $projectRoot 'lan-dist') -or $stage -ne (Join-Path $projectRoot 'test-output\quote-review-build')) { throw 'Unexpected build paths.' }
$DraftPath=(Resolve-Path -LiteralPath $DraftPath).Path
$SourcePath=(Resolve-Path -LiteralPath $SourcePath).Path
$browser=Get-Content -LiteralPath 'test-output\customer-quote-browser-result.json' -Raw | ConvertFrom-Json
$business=Get-Content -LiteralPath 'test-output\result.json' -Raw | ConvertFrom-Json
if ($browser.passed -lt 15 -or $business.passed -lt 73) { throw 'Required quotation checks have not passed.' }
foreach ($file in @('workspace-api.mjs','runtime.mjs','auth.mjs','server.mjs','manage.mjs','client\index.html')) { if (-not (Test-Path -LiteralPath (Join-Path $stage $file))) { throw "Missing build artifact: $file" } }
if ($AccessConfigPath) {
 $AccessConfigPath=(Resolve-Path -LiteralPath $AccessConfigPath).Path
 & $nodePath 'standalone/configure-customer-quote-access.mjs' --build-dir $stage --config $AccessConfigPath --dry-run
 if ($LASTEXITCODE -ne 0) { throw 'Quotation access preflight failed; service has not been stopped.' }
}
$task=Get-ScheduledTask -TaskName 'DOON-Order-Workspace'
$hostScript=Join-Path $PSScriptRoot 'service-host.mjs'
if (-not $task.Settings.Enabled) { throw 'The supervisor is manually paused; do not enable it automatically.' }
if ($task.Actions.WorkingDirectory -ne $projectRoot -or -not $task.Actions.Arguments.Contains($hostScript)) { throw 'Scheduled task does not match this project.' }
$expectedHost=$hostScript.Replace('\','/').ToLowerInvariant()
$expectedServer=(Join-Path $live 'server.mjs').Replace('\','/').ToLowerInvariant()
$nodes=Get-CimInstance Win32_Process -Filter "Name = 'node.exe'"
$listeners=@(Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue)
if ($listeners.Count -eq 0) { throw 'Production is not listening; investigate before deployment.' }
foreach ($listener in $listeners) { $process=$nodes | Where-Object ProcessId -eq $listener.OwningProcess; if (-not $process.CommandLine -or -not $process.CommandLine.Replace('\','/').ToLowerInvariant().Contains($expectedServer)) { throw 'Port 8787 is not owned by this app.' } }
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$rollback=Join-Path $projectRoot ('test-output\customer-quote-rollback-'+$stamp)
$checkpoint=Join-Path $projectRoot ('test-output\customer-quote-preservation-'+$stamp+'.json')
New-Item -ItemType Directory -Path $rollback | Out-Null
Get-ChildItem -LiteralPath $live | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $rollback -Recurse -Force }
$backup=& $nodePath 'lan-dist/manage.mjs' backup
if ($LASTEXITCODE -ne 0) { throw 'Database and attachment backup failed.' }
$paused=$false
$dataWritesStarted=$false
$releaseReady=$false
$stoppedBackup=$null
$accessResult=$null
try {
 Disable-ScheduledTask -TaskName $task.TaskName | Out-Null
 $paused=$true
 Stop-ScheduledTask -TaskName $task.TaskName
 $nodes=Get-CimInstance Win32_Process -Filter "Name = 'node.exe'"
 $nodes | Where-Object { $_.CommandLine -and ($_.CommandLine.Replace('\','/').ToLowerInvariant().Contains($expectedHost) -or $_.CommandLine.Replace('\','/').ToLowerInvariant().Contains($expectedServer)) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
 for ($i=0;$i -lt 20;$i++) { if (-not (Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue)) { break }; Start-Sleep -Milliseconds 250 }
 if (Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue) { throw 'Production listener is still active; no code copied.' }
 # A second consistent snapshot includes changes made while the online backup ran.
 $stoppedBackup=& $nodePath 'lan-dist/manage.mjs' backup
 if ($LASTEXITCODE -ne 0) { throw 'Stopped-service database and attachment backup failed.' }
 & $nodePath 'scripts/verify-customer-quote-deployment.mjs' before $checkpoint
 if ($LASTEXITCODE -ne 0) { throw 'Pre-deployment preservation checkpoint failed.' }
 Get-ChildItem -LiteralPath $stage | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $live -Recurse -Force }
 & $nodePath 'scripts/verify-customer-quote-deployment.mjs' after $checkpoint
 if ($LASTEXITCODE -ne 0) { throw 'Code deployment changed data; stop and investigate.' }
 $dataWritesStarted=$true
 & $nodePath 'standalone/import-customer-quote.mjs' --build-dir $live --draft $DraftPath --source $SourcePath
 if ($LASTEXITCODE -ne 0) { throw 'Draft import did not finish. Existing data has not been rolled back; inspect any newly created draft.' }
 & $nodePath 'scripts/verify-customer-quote-deployment.mjs' after $checkpoint
 if ($LASTEXITCODE -ne 0) { throw 'Post-import preservation check failed. Do not roll back the database.' }
 # First customer binding is an explicitly approved, versioned change. Its own
 # preservation gate permits only that change and the dedicated access policy.
 if ($AccessConfigPath) {
  $accessResult=& $nodePath 'standalone/configure-customer-quote-access.mjs' --build-dir $live --config $AccessConfigPath --apply
  if ($LASTEXITCODE -ne 0) { throw 'Quotation access configuration failed; inspect the preservation report. Never restore old data.' }
 }
 $releaseReady=$true
} finally {
 if ($paused) {
  if ($releaseReady -or -not $dataWritesStarted) {
   if (-not $releaseReady) { Get-ChildItem -LiteralPath $rollback | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $live -Recurse -Force } }
   Enable-ScheduledTask -TaskName $task.TaskName | Out-Null
   Start-ScheduledTask -TaskName $task.TaskName
  } else {
   Write-Warning 'Data maintenance did not complete. The verified supervisor remains paused to avoid publishing partial permissions. Inspect preserved records and finish the pending import/access step before enabling DOON-Order-Workspace. Never restore the old database.'
  }
 }
}
$healthy=$false
for ($i=0;$i -lt 30;$i++) { try { $health=Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 2; if ($health.ok) { $healthy=$true;break } } catch {}; Start-Sleep -Milliseconds 500 }
if (-not $healthy) { throw 'Post-deployment health check failed; code rollback is retained. Do not restore old data.' }
$page=Invoke-WebRequest -UseBasicParsing -Uri 'http://192.168.1.176:8787/customer-quotes' -TimeoutSec 10
$result=[pscustomobject]@{deployedAt=[DateTime]::UtcNow.ToString('o');healthy=$healthy;pageStatus=[int]$page.StatusCode;dataPreserved=$true;checkpoint=$checkpoint;rollback=$rollback;backup=($backup|ConvertFrom-Json);stoppedBackup=($stoppedBackup|ConvertFrom-Json);access=if($accessResult){$accessResult|ConvertFrom-Json}else{$null}}
$result|ConvertTo-Json -Depth 4|Set-Content -LiteralPath 'test-output\customer-quote-deployment.json' -Encoding utf8
$result|ConvertTo-Json -Depth 4
