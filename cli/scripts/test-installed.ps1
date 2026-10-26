param([Parameter(Mandatory=$true)][string]$InstallRoot)
$ErrorActionPreference = 'Stop'
$Output = & (Join-Path $InstallRoot 'bin\doon.cmd') commands --json
if ($LASTEXITCODE -ne 0) { throw 'Installed command failed.' }
$Result = $Output | ConvertFrom-Json
if (-not $Result.ok -or $Result.schema -ne 'doon-cli-output-v1' -or $Result.command -ne 'commands') { throw 'Installed command output invalid.' }
Write-Output 'PASS relocated installed command'
