param(
 [string]$StagePath='test-output\engineering-drawing-build',
 [string]$InputPath='',
 [string]$SourcePath='',
 [string]$ActorId='',
 [switch]$CodeOnly,
 [switch]$ApplyDeployment
)
$ErrorActionPreference='Stop'
if ($CodeOnly -and ($InputPath -or $SourcePath -or $ActorId)) { throw 'CodeOnly cannot import source data.' }
if (-not $CodeOnly -and (-not $InputPath -or -not $SourcePath -or -not $ActorId)) { throw 'Select CodeOnly, or provide InputPath, SourcePath and ActorId for additive import.' }
$projectRoot=(Resolve-Path -LiteralPath (Split-Path $PSScriptRoot -Parent)).Path
Set-Location -LiteralPath $projectRoot
$nodePath=(Get-Command node.exe -ErrorAction Stop).Source
$env:DOON_DATA_DIR=Join-Path $projectRoot 'lan-data'
$stage=(Resolve-Path -LiteralPath $StagePath).Path
$live=(Resolve-Path -LiteralPath (Join-Path $projectRoot 'lan-dist')).Path
$testRoot=(Resolve-Path -LiteralPath (Join-Path $projectRoot 'test-output')).Path
if ($live -ne (Join-Path $projectRoot 'lan-dist') -or -not $stage.StartsWith($testRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected build paths.' }
foreach ($target in @($stage,$live,$testRoot)) { if ((Get-Item -LiteralPath $target).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Deployment paths cannot be junctions or symbolic links.' } }
& $nodePath 'standalone/verify-engineering-drawing-release.mjs' --build-dir $stage --check-only
if ($LASTEXITCODE -ne 0) { throw 'Exact source/build release verification failed; production has not changed.' }
$preview=$null
if (-not $CodeOnly) {
 $InputPath=(Resolve-Path -LiteralPath $InputPath).Path
 $SourcePath=(Resolve-Path -LiteralPath $SourcePath).Path
 $previewOutput=& $nodePath 'standalone/import-engineering-drawings.mjs' --input $InputPath --source $SourcePath --actor-id $ActorId
 if ($LASTEXITCODE -ne 0) { throw 'Import preflight failed; production has not changed.' }
 $preview=$previewOutput | ConvertFrom-Json
}
if (-not $ApplyDeployment) {
 [pscustomobject]@{mode='validated-only';build=$stage;codeOnly=[bool]$CodeOnly;import=$preview;note='No service restart or business import performed. Use ApplyDeployment only for an authorized release.'}|ConvertTo-Json -Depth 5
 return
}
$task=Get-ScheduledTask -TaskName 'DOON-Order-Workspace'
$hostScript=Join-Path $PSScriptRoot 'service-host.mjs'
if (-not $task.Settings.Enabled) { throw 'The supervisor is manually paused; deployment will not enable it.' }
$taskActions=@($task.Actions)
if ($taskActions.Count -ne 1 -or $taskActions[0].WorkingDirectory -ne $projectRoot) { throw 'Scheduled task does not match this project.' }
$taskAction=$taskActions[0]
$wrapperScript=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'service-host-start.ps1')).Path
$taskShell=Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$wrapperArguments='-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy RemoteSigned -File "'+$wrapperScript+'"'
$legacyHostCommand="& '"+$nodePath.Replace("'","''")+"' '"+$hostScript.Replace("'","''")+"'; exit "+'$LASTEXITCODE'
$legacyArguments='-NoProfile -NonInteractive -WindowStyle Hidden -Command "'+$legacyHostCommand+'"'
# Accept only the exact known wrapper or the exact original guardian action.
# A matching filename embedded in an arbitrary shell command is insufficient.
$knownWrapper=$taskAction.Execute -eq $taskShell -and $taskAction.Arguments -eq $wrapperArguments
$knownLegacy=$taskAction.Execute -eq $taskShell -and $taskAction.Arguments -eq $legacyArguments
$knownDirect=$taskAction.Execute -eq $nodePath -and $taskAction.Arguments -eq ('"'+$hostScript+'"')
if (-not ($knownWrapper -or $knownLegacy -or $knownDirect)) { throw 'Scheduled task action is not an exact approved entry point for this project.' }
$expectedHost=$hostScript.Replace('\','/').ToLowerInvariant()
$expectedServer=(Join-Path $live 'server.mjs').Replace('\','/').ToLowerInvariant()
$nodes=Get-CimInstance Win32_Process -Filter "Name = 'node.exe'"
$listeners=@(Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction Stop)
if ($listeners.Count -eq 0) { throw 'Production is not listening; investigate before deployment.' }
foreach ($listener in $listeners) {
 $process=$nodes | Where-Object ProcessId -eq $listener.OwningProcess
 if (-not $process.CommandLine -or -not $process.CommandLine.Replace('\','/').ToLowerInvariant().Contains($expectedServer)) { throw 'Port 8787 is not owned by this app.' }
}
$health=Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 5
if (-not $health.ok) { throw 'Production health check failed before deployment.' }
$stamp=(Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[Guid]::NewGuid().ToString('N').Substring(0,8)
$rollback=[IO.Path]::GetFullPath((Join-Path $testRoot ('engineering-drawing-rollback-'+$stamp)))
$failedBuild=[IO.Path]::GetFullPath((Join-Path $testRoot ('engineering-drawing-failed-build-'+$stamp)))
$checkpoint=Join-Path $testRoot ('engineering-drawing-preservation-'+$stamp+'.json')
# Validate both absolute move destinations before any directory move.
foreach ($destination in @($rollback,$failedBuild)) { if (-not $destination.StartsWith($testRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or (Test-Path -LiteralPath $destination)) { throw 'Invalid or occupied rollback target.' } }
$backup=& $nodePath 'lan-dist/manage.mjs' backup
if ($LASTEXITCODE -ne 0) { throw 'Online database and attachment backup failed.' }
$paused=$false;$codeMoved=$false;$dataWritesStarted=$false;$releaseReady=$false;$stoppedBackup=$null;$importResult=$null
try {
 Disable-ScheduledTask -TaskName $task.TaskName | Out-Null
 $paused=$true
 Stop-ScheduledTask -TaskName $task.TaskName
 $nodes=Get-CimInstance Win32_Process -Filter "Name = 'node.exe'"
 $nodes | Where-Object { $_.CommandLine -and ($_.CommandLine.Replace('\','/').ToLowerInvariant().Contains($expectedHost) -or $_.CommandLine.Replace('\','/').ToLowerInvariant().Contains($expectedServer)) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
 for ($i=0;$i -lt 20;$i++) { if (-not (Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue)) { break }; Start-Sleep -Milliseconds 250 }
 if (Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue) { throw 'Production listener is still active; code was not moved.' }
 $stoppedBackup=& $nodePath 'lan-dist/manage.mjs' backup
 if ($LASTEXITCODE -ne 0) { throw 'Stopped-service database and attachment backup failed.' }
 & $nodePath 'scripts/verify-engineering-drawing-deployment.mjs' before $checkpoint
 if ($LASTEXITCODE -ne 0) { throw 'Pre-deployment preservation checkpoint failed.' }
 & $nodePath 'standalone/verify-engineering-drawing-release.mjs' --build-dir $stage --check-only
 if ($LASTEXITCODE -ne 0) { throw 'Source/build changed after preflight; code was not moved.' }
 Move-Item -LiteralPath $live -Destination $rollback
 $codeMoved=$true
 New-Item -ItemType Directory -Path $live | Out-Null
 Get-ChildItem -LiteralPath $stage -Force | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $live -Recurse -Force }
 & $nodePath 'scripts/verify-engineering-drawing-deployment.mjs' after $checkpoint --unchanged
 if ($LASTEXITCODE -ne 0) { throw 'Code deployment changed business data; investigate before continuing.' }
 if (-not $CodeOnly) {
  # Refresh the read-only plan after the stop, including changes made during the online backup.
  $previewOutput=& $nodePath 'standalone/import-engineering-drawings.mjs' --input $InputPath --source $SourcePath --actor-id $ActorId
  if ($LASTEXITCODE -ne 0) { throw 'Stopped-service import preflight failed.' }
  $preview=$previewOutput | ConvertFrom-Json
  $dataWritesStarted=$true
  $importOutput=& $nodePath 'standalone/import-engineering-drawings.mjs' --input $InputPath --source $SourcePath --actor-id $ActorId --apply --plan-hash $preview.planHash
  if ($LASTEXITCODE -ne 0) { throw 'Import did not finish; inspect the retained backup and drawing rows. Do not restore an old database.' }
  $importResult=$importOutput | ConvertFrom-Json
  & $nodePath 'scripts/verify-engineering-drawing-deployment.mjs' after $checkpoint
  if ($LASTEXITCODE -ne 0) { throw 'Post-import preservation failed; leave service paused for investigation.' }
 }
 $releaseReady=$true
} finally {
 if ($paused) {
  if ($releaseReady -or -not $dataWritesStarted) {
   if (-not $releaseReady -and $codeMoved) {
    # Both targets above were checked to remain in this project's test-output directory.
    if (Test-Path -LiteralPath $live) { Move-Item -LiteralPath $live -Destination $failedBuild }
    Move-Item -LiteralPath $rollback -Destination $live
   }
   Enable-ScheduledTask -TaskName $task.TaskName | Out-Null
   Start-ScheduledTask -TaskName $task.TaskName
  } else { Write-Warning 'Import or preservation did not finish. Supervisor remains paused. Inspect new drawing records and backups before resuming; never restore the old database over current data.' }
 }
}
$healthy=$false
for ($i=0;$i -lt 30;$i++) { try { $health=Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 2; if ($health.ok) { $healthy=$true;break } } catch {}; Start-Sleep -Milliseconds 500 }
if (-not $healthy) { throw 'Post-release health check failed. Code rollback and backups are retained; no database rollback was attempted.' }
$page=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8787/engineering-drawings' -TimeoutSec 10
$result=[pscustomobject]@{deployedAt=[DateTime]::UtcNow.ToString('o');healthy=$healthy;pageStatus=[int]$page.StatusCode;codeOnly=[bool]$CodeOnly;dataPreserved=$true;checkpoint=$checkpoint;rollback=$rollback;backup=($backup|ConvertFrom-Json);stoppedBackup=($stoppedBackup|ConvertFrom-Json);import=$importResult}
$result|ConvertTo-Json -Depth 6|Set-Content -LiteralPath (Join-Path $testRoot 'engineering-drawing-deployment.json') -Encoding utf8
$result|ConvertTo-Json -Depth 6
