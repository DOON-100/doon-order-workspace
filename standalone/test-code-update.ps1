# Extract selected functions only. Service/process/network commands below are pure stubs.
$ErrorActionPreference='Stop'
$tokens=$null
$errors=$null
$scriptPath=Join-Path $PSScriptRoot 'deploy-code-update.ps1'
$ast=[System.Management.Automation.Language.Parser]::ParseFile($scriptPath,[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw 'Deployment script has syntax errors.' }
$function=$ast.Find({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Test-ScriptProcess'},$true)
if (-not $function) { throw 'Ownership predicate missing.' }
. ([ScriptBlock]::Create($function.Extent.Text))
$nodePath='C:\Program Files\nodejs\node.exe'
$server='D:\synthetic\web\lan-dist\server.mjs'
function Check([string]$CommandLine,[string]$Executable,[bool]$Expected) {
 $process=[pscustomobject]@{CommandLine=$CommandLine;ExecutablePath=$Executable}
 if ((Test-ScriptProcess $process $server) -ne $Expected) { throw 'Ownership predicate assertion failed.' }
}
Check ('"'+$nodePath+'" '+$server) $nodePath $true
Check ('"'+$nodePath+'" "'+$server+'"') $nodePath $true
Check ('"'+$nodePath+'" '+$server+'.other') $nodePath $false
Check ('"'+$nodePath+'" D:\another\web\lan-dist\server.mjs') $nodePath $false
Check ('"'+$nodePath+'" -e "'+$server+'"') $nodePath $false
Check ('"'+$nodePath+'" '+$server+' --extra') $nodePath $false
Check ('"'+$nodePath+'" lan-dist/server.mjs') $nodePath $false
Check ('"'+$nodePath+'" '+$server) 'C:\another\node.exe' $false
$passed=8

# Fail closed if a later implementation adds an unstubbed command to either function.
function Import-TestFunction([string]$Name,[string[]]$AllowedCommands) {
 $definition=$ast.Find({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $Name},$true)
 if (-not $definition) { throw ('Missing function: '+$Name) }
 foreach ($command in $definition.FindAll({param($node) $node -is [System.Management.Automation.Language.CommandAst]},$true)) {
  if (-not $command.GetCommandName() -or $AllowedCommands -notcontains $command.GetCommandName()) { throw ('Unstubbed command in '+$Name) }
 }
 return [ScriptBlock]::Create($definition.Extent.Text)
}
. (Import-TestFunction 'Stop-OwnedService' @('Disable-ScheduledTask','Out-Null','Stop-ScheduledTask','Get-CimInstance','Test-ScriptProcess','Stop-Process','Get-Process','Wait-Stopped'))
. (Import-TestFunction 'Assert-Healthy' @('Invoke-WebRequest','Invoke-RestMethod','ConvertFrom-Json','Assert-Owners','Start-Sleep'))

$taskName='SYNTHETIC-NOT-A-REAL-TASK'
$hostScript='D:\synthetic\web\standalone\service-host.mjs'
$serverScript=$server
$SmokePath='/synthetic-smoke'
$script:rows=@(
 [pscustomobject]@{ProcessId=111;ExecutablePath=$nodePath;CommandLine=('"'+$nodePath+'" '+$hostScript)},
 [pscustomobject]@{ProcessId=222;ExecutablePath=$nodePath;CommandLine=('"'+$nodePath+'" '+$serverScript)},
 [pscustomobject]@{ProcessId=333;ExecutablePath=$nodePath;CommandLine=('"'+$nodePath+'" D:\unrelated\server.mjs')}
)
function Disable-ScheduledTask { [CmdletBinding()]param([string]$TaskName) if ($TaskName -ne 'SYNTHETIC-NOT-A-REAL-TASK') { throw 'Unexpected task' }; $script:disableCalls++ }
function Stop-ScheduledTask { [CmdletBinding()]param([string]$TaskName) if ($TaskName -ne 'SYNTHETIC-NOT-A-REAL-TASK') { throw 'Unexpected task' }; $script:taskStopCalls++ }
function Get-CimInstance { [CmdletBinding()]param([string]$ClassName,[string]$Filter) if ($ClassName -ne 'Win32_Process' -or $Filter -ne "Name = 'node.exe'") { throw 'Unexpected process query' }; return $script:rows }
function Stop-Process {
 [CmdletBinding()]param([int]$Id,[switch]$Force)
 $script:stopCalls+=@($Id)
 if (-not $Force -or $Id -notin @(111,222)) { throw 'Unexpected stop target' }
 if ($script:scenario -eq 'still-present') { throw 'Synthetic access denied; process still exists' }
 if ($Id -eq 111) { $script:existing=@{}; return } # Host stop also finishes its child.
 throw 'Synthetic process already exited'
}
function Get-Process { [CmdletBinding()]param([int]$Id) $script:lookupCalls+=@($Id); if ($script:existing.ContainsKey($Id)) { return [pscustomobject]@{Id=$Id} } }
function Wait-Stopped { $script:waitCalls++ }
function Assert-Owners { $script:ownerChecks++ }
function Start-Sleep { [CmdletBinding()]param([int]$Milliseconds) if ($Milliseconds -ne 500) { throw 'Unexpected sleep' }; $script:sleepCalls++ }
function Invoke-RestMethod { [CmdletBinding()]param([string]$Uri,[int]$TimeoutSec) throw 'Network forbidden; use the synthetic UTF-8 response' }
function Invoke-WebRequest {
 [CmdletBinding()]param([switch]$UseBasicParsing,[string]$Uri,[int]$TimeoutSec)
 if (-not $UseBasicParsing) { throw 'Unexpected request mode' }
 if ($Uri -eq 'http://127.0.0.1:8787/health') {
  $script:healthCalls++
  # Actual non-ASCII UTF-8 bytes, no charset; Content is deliberately decoded incorrectly.
  $name=[string]::Concat([char[]]@(0x5EA6,0x6602,0x8BA2,0x5355,0x534F,0x4F5C,0x4E2D,0x53F0,0x00B7,0x5185,0x7F51,0x7248))
  if ($script:invalidHealth) { $name='unrelated-service' }
  $bytes=[Text.Encoding]::UTF8.GetBytes(([pscustomobject]@{ok=$true;service=$name} | ConvertTo-Json -Compress))
  return [pscustomobject]@{StatusCode=200;Headers=@{'Content-Type'='application/json'};Content=[Text.Encoding]::GetEncoding(1252).GetString($bytes);RawContentStream=[IO.MemoryStream]::new($bytes)}
 }
 if ($Uri -eq ('http://127.0.0.1:8787'+$SmokePath)) { $script:pageCalls++; return [pscustomobject]@{StatusCode=200} }
 throw 'Unexpected URL; no network call is permitted'
}
# Ensure command resolution cannot fall through to real process, service, or network cmdlets.
foreach ($name in @('Disable-ScheduledTask','Stop-ScheduledTask','Get-CimInstance','Stop-Process','Get-Process','Wait-Stopped','Assert-Owners','Start-Sleep','Invoke-WebRequest','Invoke-RestMethod')) {
 if ((Get-Command $name).CommandType -ne 'Function') { throw ('Missing stub: '+$name) }
}

$script:scenario='child-exited'
$script:existing=@{111=$true;222=$true}
$script:stopCalls=@();$script:lookupCalls=@();$script:disableCalls=0;$script:taskStopCalls=0;$script:waitCalls=0
Stop-OwnedService
if (($script:stopCalls -join ',') -ne '111,222' -or ($script:lookupCalls -join ',') -ne '222' -or $script:waitCalls -ne 1 -or $script:disableCalls -ne 1 -or $script:taskStopCalls -ne 1) { throw 'Already-exited child must continue through Wait-Stopped; unrelated process must remain untouched.' }
$passed++

$script:scenario='still-present'
$script:existing=@{111=$true;222=$true}
$script:stopCalls=@();$script:lookupCalls=@();$script:disableCalls=0;$script:taskStopCalls=0;$script:waitCalls=0
$caught=$false
try { Stop-OwnedService } catch { if ($_.Exception.Message -notlike 'Synthetic access denied*') { throw }; $caught=$true }
if (-not $caught -or ($script:stopCalls -join ',') -ne '111' -or ($script:lookupCalls -join ',') -ne '111' -or $script:waitCalls -ne 0) { throw 'A failed stop of an existing process must abort.' }
$passed++

$script:invalidHealth=$false
$script:healthCalls=0;$script:pageCalls=0;$script:ownerChecks=0;$script:sleepCalls=0
Assert-Healthy
if ($script:healthCalls -ne 1 -or $script:pageCalls -ne 1 -or $script:ownerChecks -ne 1 -or $script:sleepCalls -ne 0) { throw 'UTF-8 response without charset must pass despite incorrectly decoded Content.' }
$passed++

$script:invalidHealth=$true
$script:healthCalls=0;$script:pageCalls=0;$script:ownerChecks=0;$script:sleepCalls=0
$caught=$false
try { Assert-Healthy } catch { if ($_.Exception.Message -ne 'Application health or page check failed.') { throw }; $caught=$true }
if (-not $caught -or $script:healthCalls -ne 30 -or $script:pageCalls -ne 0 -or $script:ownerChecks -ne 0) { throw 'An unrelated service must not pass health validation.' }
$passed++
[pscustomobject]@{ok=$true;passed=$passed;synthetic=$true;productionTouched=$false;stubbedServiceProcessAndNetwork=$true} | ConvertTo-Json -Compress
