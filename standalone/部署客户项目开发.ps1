# Code-only release. No imports, migrations, grants, customer changes or seeding.
$ErrorActionPreference='Stop'
$projectRoot=(Resolve-Path -LiteralPath (Split-Path $PSScriptRoot -Parent)).Path
Set-Location -LiteralPath $projectRoot
$env:DOON_DATA_DIR=Join-Path $projectRoot 'lan-data'
$env:DOON_RELEASE_BACKUP_SOURCE=$env:DOON_DATA_DIR
$nodePath=Join-Path $env:ProgramFiles 'nodejs\node.exe'
$stage=(Resolve-Path -LiteralPath (Join-Path $projectRoot 'test-output\customer-project-build')).Path
$live=(Resolve-Path -LiteralPath (Join-Path $projectRoot 'lan-dist')).Path
if ($stage -ne (Join-Path $projectRoot 'test-output\customer-project-build') -or $live -ne (Join-Path $projectRoot 'lan-dist')) { throw 'Unexpected release paths.' }
& $nodePath 'scripts/verify-customer-project-release.mjs' $stage
if ($LASTEXITCODE -ne 0) { throw 'Tested source/build evidence does not match; production unchanged.' }
$task=Get-ScheduledTask -TaskName 'DOON-Order-Workspace'
$hostScript=Join-Path $PSScriptRoot 'service-host.mjs'
$starterScript=Join-Path $PSScriptRoot 'service-host-start.ps1'
if (-not $task.Settings.Enabled) { throw 'Supervisor manually paused; do not enable automatically.' }
if ($task.Actions.WorkingDirectory -ne $projectRoot -or (-not $task.Actions.Arguments.Contains($starterScript) -and -not $task.Actions.Arguments.Contains($hostScript))) { throw 'Task belongs to another project.' }
$expectedHost=$hostScript.Replace('\','/').ToLowerInvariant()
$expectedServer=(Join-Path $live 'server.mjs').Replace('\','/').ToLowerInvariant()
$nodes=Get-CimInstance Win32_Process -Filter "Name = 'node.exe'"
$listeners=@(Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue)
if (-not $listeners.Count) { throw 'Production not listening; investigate before release.' }
foreach ($listener in $listeners) {
 $process=$nodes|Where-Object ProcessId -eq $listener.OwningProcess
 if (-not $process.CommandLine -or -not $process.CommandLine.Replace('\','/').ToLowerInvariant().Contains($expectedServer)) { throw 'Port 8787 does not belong to this app.' }
}
function Stop-VerifiedService {
 Disable-ScheduledTask -TaskName $task.TaskName|Out-Null
 Stop-ScheduledTask -TaskName $task.TaskName
 Get-CimInstance Win32_Process -Filter "Name = 'node.exe'"|Where-Object {
  $_.CommandLine -and ($_.CommandLine.Replace('\','/').ToLowerInvariant().Contains($expectedHost) -or $_.CommandLine.Replace('\','/').ToLowerInvariant().Contains($expectedServer))
 }|ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
 for ($i=0;$i -lt 40;$i++) { if (-not (Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue)) { return }; Start-Sleep -Milliseconds 250 }
 throw 'Listener still active; no code may be copied.'
}
function Start-VerifiedService { Enable-ScheduledTask -TaskName $task.TaskName|Out-Null; Start-ScheduledTask -TaskName $task.TaskName }
function Test-ReleaseHealth {
 for ($i=0;$i -lt 30;$i++) {
  try { $health=Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 2; if ($health.ok -and $health.service -eq '度昂订单协作中台·内网版') { return $true } } catch {}
  Start-Sleep -Milliseconds 500
 }
 return $false
}
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$rollback=Join-Path $projectRoot ('test-output\customer-project-code-rollback-'+$stamp)
$checkpoint=Join-Path $projectRoot ('test-output\customer-project-preservation-'+$stamp+'.json')
# Every computed copy target is checked to remain within this workspace.
foreach ($target in @($rollback,$checkpoint)) { if (-not [IO.Path]::GetFullPath($target).StartsWith($projectRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Output escapes workspace.' } }
New-Item -ItemType Directory -Path $rollback|Out-Null
Get-ChildItem -LiteralPath $live|ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $rollback -Recurse -Force }
$maintenance=$false
$codeTouched=$false
try {
 $maintenance=$true
 Stop-VerifiedService
 # Independent SQLite backup uses a read-only source connection, never runtime initialization.
 $backupPath=Join-Path $projectRoot ('test-output\customer-project-data-backup-'+$stamp)
 $stoppedBackup=& $nodePath 'scripts/backup-customer-project-release.mjs' $backupPath
 if ($LASTEXITCODE -ne 0) { throw 'Stopped-service consistent backup failed.' }
 $before=& $nodePath 'scripts/verify-customer-quote-deployment.mjs' before $checkpoint
 if ($LASTEXITCODE -ne 0) { throw 'Read-only preservation checkpoint failed.' }
 $codeTouched=$true
 # Never copy to lan-data. Keep old hashed assets available for existing tabs.
 Get-ChildItem -LiteralPath $stage|ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $live -Recurse -Force }
 $after=& $nodePath 'scripts/verify-customer-quote-deployment.mjs' after $checkpoint --unchanged
 if ($LASTEXITCODE -ne 0) { throw 'Code replacement changed business records, attachments or accounts.' }
 Start-VerifiedService
 if (-not (Test-ReleaseHealth)) { throw 'New service health check failed.' }
 $page=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8787/customer-projects' -TimeoutSec 15
 $expectedHtml=[IO.File]::ReadAllText((Join-Path $stage 'client\index.html'))
 if ($page.StatusCode -ne 200 -or $page.Content -ne $expectedHtml) { throw 'Served page does not match tested release.' }
 # Startup and anonymous verification must not initialize project business data.
 $started=& $nodePath 'scripts/verify-customer-quote-deployment.mjs' after $checkpoint --unchanged
 if ($LASTEXITCODE -ne 0) { throw 'Business preservation differs after startup; investigate concurrent employee activity.' }
 $maintenance=$false
} catch {
 $failure=$_
 $recoveryFailure=$null
 if ($maintenance) {
  try {
   if ($codeTouched) {
    Stop-VerifiedService
    Get-ChildItem -LiteralPath $rollback|ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $live -Recurse -Force }
   }
   Start-VerifiedService
   if (-not (Test-ReleaseHealth)) { throw 'Recovery health check failed.' }
  } catch { $recoveryFailure=$_ }
 }
 if ($recoveryFailure) { throw "Release failed: $failure. Recovery also failed: $recoveryFailure. The database has not been restored or overwritten." }
 throw $failure
}
$result=[pscustomobject]@{deployedAt=[DateTime]::UtcNow.ToString('o');healthy=$true;pageStatus=[int]$page.StatusCode;codeOnly=$true;dataPreserved=$true;checkpoint=$checkpoint;rollback=$rollback;before=($before|ConvertFrom-Json);after=($after|ConvertFrom-Json);afterStartup=($started|ConvertFrom-Json);stoppedBackup=($stoppedBackup|ConvertFrom-Json)}
$result|ConvertTo-Json -Depth 6|Set-Content -LiteralPath ('test-output\customer-project-deployment-'+$stamp+'.json') -Encoding utf8
$result|ConvertTo-Json -Depth 6
