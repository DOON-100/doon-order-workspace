param(
 [Parameter(Mandatory=$true)][string]$StagePath,
 [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{64}$')][string]$ExpectedManifestSha256,
 [Parameter(Mandatory=$true)][string]$ValidationPath,
 [string]$SmokePath='/',
 [string]$ReleaseSourceRoot=''
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$projectRoot=(Resolve-Path -LiteralPath (Split-Path $PSScriptRoot -Parent)).Path
Set-Location -LiteralPath $projectRoot
$nodePath=(Get-Command node.exe -ErrorAction Stop).Source
$stage=(Resolve-Path -LiteralPath $StagePath).Path
$live=(Resolve-Path -LiteralPath (Join-Path $projectRoot 'lan-dist')).Path
$data=(Resolve-Path -LiteralPath (Join-Path $projectRoot 'lan-data')).Path
$validation=(Resolve-Path -LiteralPath $ValidationPath).Path
$tool=Join-Path $projectRoot 'scripts\verify-code-update.mjs'
$hostScript=Join-Path $projectRoot 'standalone\service-host.mjs'
$serverScript=Join-Path $live 'server.mjs'
$taskName='DOON-Order-Workspace'
if ($SmokePath -notmatch '^/[a-zA-Z0-9/_-]*$') { throw 'SmokePath must be a local page path without query parameters.' }
function Node-Json([string[]]$Arguments) {
 $output=& $nodePath $tool @Arguments
 if ($LASTEXITCODE -ne 0) { throw 'Code-update verification failed; see the preceding diagnostic.' }
 return ($output | ConvertFrom-Json)
}
function Assert-PlainPath([string]$Value,[string]$Expected) {
 $actual=(Resolve-Path -LiteralPath $Value).Path
 if ($actual -ne $Expected -or (((Get-Item -LiteralPath $actual).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) { throw 'Unexpected path or directory junction.' }
}
Assert-PlainPath $live (Join-Path $projectRoot 'lan-dist')
Assert-PlainPath $data (Join-Path $projectRoot 'lan-data')
$stageArguments=@('stage',$stage,$ExpectedManifestSha256)
if ($ReleaseSourceRoot) { $stageArguments+=@((Resolve-Path -LiteralPath $ReleaseSourceRoot).Path) }
$build=Node-Json $stageArguments
$checks=Node-Json @('validation',$validation,$ExpectedManifestSha256)
function Test-ScriptProcess($Process,[string]$Script) {
 if (-not $Process -or -not $Process.CommandLine -or -not $Process.ExecutablePath) { return $false }
 if ([IO.Path]::GetFullPath($Process.ExecutablePath) -ne [IO.Path]::GetFullPath($nodePath)) { return $false }
 $line=$Process.CommandLine.Replace('\','/')
 $target=$Script.Replace('\','/')
 # Only this Node executable with this entry point, with no extra commands or arguments.
 $token='(?:"'+[regex]::Escape($target)+'"'
 if ($target -notmatch '\s') { $token+='|'+[regex]::Escape($target) }
 $token+=')'
 $executable=$nodePath.Replace('\','/')
 $exeToken='(?:"'+[regex]::Escape($executable)+'"'
 if ($executable -notmatch '\s') { $exeToken+='|'+[regex]::Escape($executable) }
 $exeToken+=')'
 return ($line -match ('(?i)^'+$exeToken+'\s+'+$token+'\s*$'))
}
function Get-Listeners { return @(Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction Stop) }
function Assert-Owners {
 $listeners=@(Get-Listeners)
 if ($listeners.Count -eq 0) { throw 'Port 8787 is not listening; investigate before deployment.' }
 foreach ($listener in $listeners) {
  $process=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$listener.OwningProcess) -ErrorAction Stop
  if (-not (Test-ScriptProcess $process $serverScript)) { throw 'Port 8787 does not belong to the exact selected application.' }
 }
}
function Wait-Stopped {
 for ($attempt=0;$attempt -lt 30;$attempt++) {
  # Enumerating all listeners avoids the cmdlet error when no row matches a port.
  if (@(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object LocalPort -eq 8787).Count -eq 0) { return }
  Start-Sleep -Milliseconds 250
 }
 throw 'Port 8787 remains active; code directories will not be moved.'
}
function Stop-OwnedService {
 Disable-ScheduledTask -TaskName $taskName | Out-Null
 Stop-ScheduledTask -TaskName $taskName
 foreach ($process in @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction Stop)) {
  if ((Test-ScriptProcess $process $hostScript) -or (Test-ScriptProcess $process $serverScript)) {
   try { Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop }
   catch {
    # Stopping the host can finish its child before this captured row is reached.
    # A process that still exists is a real failure, not an ignored stop error.
    if (Get-Process -Id $process.ProcessId -ErrorAction SilentlyContinue) { throw }
   }
  }
 }
 Wait-Stopped
}
function Start-OwnedService {
 Enable-ScheduledTask -TaskName $taskName | Out-Null
 Start-ScheduledTask -TaskName $taskName
}
function Assert-Healthy {
 for ($attempt=0;$attempt -lt 30;$attempt++) {
  try {
   # Windows PowerShell 5 defaults JSON without charset to a legacy encoding.
   $healthResponse=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 2
   $health=[Text.Encoding]::UTF8.GetString($healthResponse.RawContentStream.ToArray()) | ConvertFrom-Json
   if ($health.ok -and $health.service -eq '度昂订单协作中台·内网版') {
    Assert-Owners
    $page=Invoke-WebRequest -UseBasicParsing -Uri ('http://127.0.0.1:8787'+$SmokePath) -TimeoutSec 5
    if ([int]$page.StatusCode -eq 200) { return }
   }
  } catch { }
  Start-Sleep -Milliseconds 500
 }
 throw 'Application health or page check failed.'
}
$task=Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
if (-not $task.Settings.Enabled) { throw 'The supervisor is manually paused; do not enable it automatically.' }
if (@($task.Actions).Count -ne 1 -or $task.Actions[0].WorkingDirectory -ne $projectRoot) { throw 'Scheduled task belongs to another project.' }
$taskArguments=$task.Actions[0].Arguments.Replace('\','/')
$launcher=Join-Path $projectRoot 'standalone\service-host-start.ps1'
$taskShell=Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$wrapperPattern='(?i)^-NoProfile\s+-NonInteractive\s+-WindowStyle\s+Hidden\s+(?:-ExecutionPolicy\s+RemoteSigned\s+)?-File\s+"'+[regex]::Escape($launcher.Replace('\','/'))+'"\s*$'
$directPattern='(?i)^-NoProfile\s+-NonInteractive\s+-WindowStyle\s+Hidden\s+-Command\s+"&\s+'''+[regex]::Escape($nodePath.Replace('\','/'))+'''\s+'''+[regex]::Escape($hostScript.Replace('\','/'))+''';\s*exit\s+\$LASTEXITCODE"\s*$'
if ($task.Actions[0].Execute -ne $taskShell -or ($taskArguments -notmatch $wrapperPattern -and $taskArguments -notmatch $directPattern)) { throw 'Scheduled task does not match a verified supervisor launcher for this project.' }
Assert-Owners
Assert-Healthy
$stamp=(Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[Guid]::NewGuid().ToString('N').Substring(0,8)
$release=Join-Path $projectRoot ('test-output\code-update-'+$stamp)
New-Item -ItemType Directory -Path $release | Out-Null
$candidate=Join-Path $release 'candidate-code'
$rollback=Join-Path $release 'previous-code'
$failedCode=Join-Path $release 'failed-code'
$checkpoint=Join-Path $release 'preservation.json'
$resultPath=Join-Path $release 'deployment.json'
Copy-Item -LiteralPath $stage -Destination $candidate -Recurse
$candidateHash=(Node-Json @('tree',$candidate)).hash
$stageHash=(Node-Json @('tree',$stage)).hash
if ($candidateHash -ne $stageHash) { throw 'Staging copy verification failed.' }
$priorCodeHash=(Node-Json @('tree',$live)).hash
$backupRoot=Join-Path $data 'backups'
if (-not (Test-Path -LiteralPath $backupRoot)) { New-Item -ItemType Directory -Path $backupRoot | Out-Null }
Assert-PlainPath $backupRoot (Join-Path $data 'backups')
$onlineBackup=Node-Json @('backup',$data,(Join-Path $backupRoot ('code-update-online-'+$stamp)))
$paused=$false
$movedOld=$false
$installed=$false
$completed=$false
$stoppedBackup=$null
$preserved=$null
$rollbackState='not-needed'
try {
 # Recheck after snapshot and before taking the service down.
 $null=Node-Json $stageArguments
 Assert-Owners
 $paused=$true
 Stop-OwnedService
 $stoppedBackup=Node-Json @('backup',$data,(Join-Path $backupRoot ('code-update-stopped-'+$stamp)))
 $null=Node-Json @('before',$data,$checkpoint)
 # All moves stay inside the verified project, and destinations must not exist.
 Assert-PlainPath $live (Join-Path $projectRoot 'lan-dist')
 Assert-PlainPath $release (Join-Path $projectRoot ('test-output\code-update-'+$stamp))
 Assert-PlainPath $candidate (Join-Path $release 'candidate-code')
 if ((Node-Json @('tree',$candidate)).hash -ne $stageHash -or (Node-Json @('tree',$live)).hash -ne $priorCodeHash) { throw 'Code changed after release preparation.' }
 Move-Item -LiteralPath $live -Destination $rollback
 $movedOld=$true
 Move-Item -LiteralPath $candidate -Destination $live
 $installed=$true
 $preserved=Node-Json @('after',$data,$checkpoint)
 Start-OwnedService
 $paused=$false
 Assert-Healthy
 # This gate is exact. Concurrent business activity requires investigation, not database rollback.
 $preserved=Node-Json @('after',$data,$checkpoint)
 $completed=$true
} catch {
 $failure=$_.Exception.Message
 if ($movedOld) {
  try {
   $paused=$true
   Stop-OwnedService
   Assert-PlainPath $rollback (Join-Path $release 'previous-code')
   if ((Node-Json @('tree',$rollback)).hash -ne $priorCodeHash) { throw 'Rollback code hash mismatch.' }
   if ($installed) {
    Assert-PlainPath $live (Join-Path $projectRoot 'lan-dist')
    Move-Item -LiteralPath $live -Destination $failedCode
   }
   if (Test-Path -LiteralPath $live) { throw 'Live destination unexpectedly exists.' }
   Move-Item -LiteralPath $rollback -Destination $live
   Start-OwnedService
   $paused=$false
   Assert-Healthy
   $rollbackState='code-restored-data-not-restored'
  } catch {
   $rollbackState='manual-attention-required'
   Write-Warning ('Code rollback or restart could not be verified: '+$_.Exception.Message+'. Database has NOT been restored. Inspect the retained release directory.')
  }
 } elseif ($paused) {
  Start-OwnedService
  $paused=$false
 }
 [pscustomobject]@{ok=$false;at=[DateTime]::UtcNow.ToString('o');message=$failure;rollbackState=$rollbackState;dataRestored=$false;release=$release;checkpoint=$checkpoint;onlineBackup=$onlineBackup;stoppedBackup=$stoppedBackup} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $resultPath -Encoding utf8
 throw ('Code update failed: '+$failure+'. Rollback status: '+$rollbackState+'. No database restore was performed.')
}
if ($completed) {
 $result=[pscustomobject]@{ok=$true;at=[DateTime]::UtcNow.ToString('o');codeOnly=$true;healthy=$true;build=$build;validation=$checks;preservation=$preserved;previousCode=$rollback;previousCodeHash=$priorCodeHash;deployedCodeHash=$stageHash;checkpoint=$checkpoint;onlineBackup=$onlineBackup;stoppedBackup=$stoppedBackup;dataImported=$false;resultPath=$resultPath}
 $result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $resultPath -Encoding utf8
 $result | ConvertTo-Json -Depth 6
}
