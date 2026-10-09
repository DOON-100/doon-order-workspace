param(
    [string]$NodePath = (Join-Path $env:ProgramFiles 'nodejs\node.exe')
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Split-Path $PSScriptRoot -Parent)).Path
$guardianScript = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'service-host.mjs')).Path
$nodeExecutable = (Resolve-Path -LiteralPath $NodePath).Path
$dataDirectory = Join-Path $projectRoot 'lan-data'
New-Item -ItemType Directory -Path $dataDirectory -Force | Out-Null

# Keep the scheduled PowerShell action alive for the lifetime of the guardian.
# Explicit Start-Process avoids native argument forwarding in hidden PS 5 hosts.
$guardianArgument = '"' + $guardianScript + '"'
$guardianProcess = Start-Process -FilePath $nodeExecutable `
    -ArgumentList @($guardianArgument) `
    -WorkingDirectory $projectRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $dataDirectory 'service-host-output.log') `
    -RedirectStandardError (Join-Path $dataDirectory 'service-host-error.log') `
    -PassThru

# PS 5 may release the native handle before exposing ExitCode unless it was
# acquired while the process was alive. Keep it available through the wait.
$null = $guardianProcess.Handle
$guardianProcess.WaitForExit()
$guardianProcess.Refresh()
exit $guardianProcess.ExitCode
