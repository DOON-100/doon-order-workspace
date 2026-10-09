param(
    [string]$StagePath = 'test-output\finished-supplier-build',
    [string]$AcceptancePath = 'test-output\finished-supplier-acceptance.json',
    [string]$NodePath = 'C:\Program Files\nodejs\node.exe',
    [ValidateRange(30,300)][int]$HealthTimeoutSeconds = 180
)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Split-Path $PSScriptRoot -Parent)).Path
Set-Location -LiteralPath $projectRoot
$env:DOON_DATA_DIR = Join-Path $projectRoot 'lan-data'
$nodePath = (Resolve-Path -LiteralPath $NodePath).Path
$stage = (Resolve-Path -LiteralPath $StagePath).Path
$acceptancePath = (Resolve-Path -LiteralPath $AcceptancePath).Path
$live = (Resolve-Path -LiteralPath (Join-Path $projectRoot 'lan-dist')).Path
$testRoot = (Resolve-Path -LiteralPath (Join-Path $projectRoot 'test-output')).Path
$hostScript = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'service-host.mjs')).Path
$taskName = 'DOON-Order-Workspace'
$preservationScript = Join-Path $projectRoot 'scripts\verify-customer-quote-deployment.mjs'

function Normalize-LocalPath([string]$Value) {
    if (-not $Value) { throw 'An expected local path is empty.' }
    return [System.IO.Path]::GetFullPath(($Value -replace '[\\/]+', '\')).TrimEnd('\').ToLowerInvariant()
}
function Contains-ExactPath([string]$Command, [string]$ExpectedPath) {
    if (-not $Command) { return $false }
    $normalized = ($Command -replace '[\\/]+', '\').ToLowerInvariant()
    $expected = Normalize-LocalPath $ExpectedPath
    return [regex]::IsMatch($normalized, '(?:^|[\s''"])' + [regex]::Escape($expected) + '(?=$|[\s''"])')
}
function Assert-ProjectTask {
    $current = Get-ScheduledTask -TaskName $taskName
    $actions = @($current.Actions)
    if ($actions.Count -ne 1 -or (Normalize-LocalPath $actions[0].WorkingDirectory) -ne (Normalize-LocalPath $projectRoot) -or -not (Contains-ExactPath $actions[0].Arguments $hostScript)) {
        throw 'The scheduled task does not exactly match this project and supervisor.'
    }
    $expectedShell = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
    if ((Normalize-LocalPath $actions[0].Execute) -ne (Normalize-LocalPath $expectedShell)) { throw 'Unexpected supervisor executable; configuration has not been changed.' }
    return $current
}
function Get-OwnedNodes {
    $nodes = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'")
    $guardianIds = @($nodes | Where-Object { Contains-ExactPath $_.CommandLine $hostScript } | ForEach-Object { $_.ProcessId })
    $listenerIds = @(Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { $_.OwningProcess })
    return @($nodes | Where-Object {
        $_.CommandLine -and ((Contains-ExactPath $_.CommandLine $hostScript) -or ((Contains-ExactPath $_.CommandLine (Join-Path $live 'server.mjs')) -and ($_.ProcessId -in $listenerIds -or $_.ParentProcessId -in $guardianIds)))
    })
}
function Assert-PortOwner([bool]$Required = $true) {
    $listeners = @(Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue)
    if ($Required -and $listeners.Count -eq 0) { throw 'Production is not listening on 8787; investigate before deployment.' }
    foreach ($listener in $listeners) {
        $owned = Get-CimInstance Win32_Process -Filter ("ProcessId = " + $listener.OwningProcess)
        if (-not $owned -or $owned.Name -ne 'node.exe' -or -not (Contains-ExactPath $owned.CommandLine (Join-Path $live 'server.mjs'))) {
            throw 'Port 8787 belongs to another process; no unrelated process will be stopped.'
        }
    }
}
function Stop-OwnedService {
    $null = Assert-ProjectTask
    Assert-PortOwner $false
    $beforeStop = @(Get-OwnedNodes)
    Disable-ScheduledTask -TaskName $taskName | Out-Null
    Stop-ScheduledTask -TaskName $taskName
    $targets = @($beforeStop + @(Get-OwnedNodes) | Sort-Object ProcessId -Unique)
    foreach ($owned in $targets) {
        $current = Get-CimInstance Win32_Process -Filter ("ProcessId = " + $owned.ProcessId)
        if (-not $current) { continue }
        if ($current.Name -ne 'node.exe' -or (-not (Contains-ExactPath $current.CommandLine $hostScript) -and -not (Contains-ExactPath $current.CommandLine (Join-Path $live 'server.mjs')))) { throw 'An owned process identity changed; refusing to stop the replacement.' }
        try { Stop-Process -Id $owned.ProcessId -Force -ErrorAction Stop }
        catch { if (Get-Process -Id $owned.ProcessId -ErrorAction SilentlyContinue) { throw } }
    }
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        if (-not (Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue)) { return }
        Start-Sleep -Milliseconds 250
    }
    throw '8787 is still active; build files have not been replaced.'
}
function Start-OwnedService {
    $null = Assert-ProjectTask
    Enable-ScheduledTask -TaskName $taskName | Out-Null
    Start-ScheduledTask -TaskName $taskName
}
function Wait-Healthy {
    $deadline = [DateTime]::UtcNow.AddSeconds($HealthTimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        try {
            $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 2
            if ($health.ok -and $health.service -eq '度昂订单协作中台·内网版') { Assert-PortOwner; return $true }
        } catch { }
        Start-Sleep -Milliseconds 500
    }
    throw "The company service did not become healthy on 8787 within $HealthTimeoutSeconds seconds."
}
function Replace-Code([string]$SourceDirectory) {
    # The only recursive deletion is the checked build-output client directory.
    # lan-data, SQLite, accounts, attachments and backups are never moved or removed.
    $client = Join-Path $live 'client'
    if ((Normalize-LocalPath $live) -ne (Normalize-LocalPath (Join-Path $projectRoot 'lan-dist')) -or (Normalize-LocalPath $client) -ne (Normalize-LocalPath (Join-Path $projectRoot 'lan-dist\client'))) { throw 'Unexpected code replacement target.' }
    if (Test-Path -LiteralPath $client) {
        $resolvedClient = (Resolve-Path -LiteralPath $client).Path
        if ((Normalize-LocalPath $resolvedClient) -ne (Normalize-LocalPath $client) -or ((Get-Item -LiteralPath $client -Force).Attributes -band [System.IO.FileAttributes]::ReparsePoint)) { throw 'Refusing to replace a redirected client directory.' }
        Remove-Item -LiteralPath $resolvedClient -Recurse -Force
    }
    foreach ($entry in (Get-ChildItem -LiteralPath $SourceDirectory -Force)) { Copy-Item -LiteralPath $entry.FullName -Destination $live -Recurse -Force }
}
function Assert-CopiedArtifacts {
    $manifest = Get-Content -LiteralPath (Join-Path $stage 'customer-price-build-evidence.json') -Raw | ConvertFrom-Json
    if ((Get-FileHash -LiteralPath (Join-Path $live 'customer-price-build-evidence.json') -Algorithm SHA256).Hash.ToLowerInvariant() -ne $buildEvidence.manifestSha256) { throw 'Copied build evidence does not match acceptance.' }
    foreach ($artifact in $manifest.artifactHashes.PSObject.Properties) {
        $target = [System.IO.Path]::GetFullPath((Join-Path $live $artifact.Name))
        if (-not (Normalize-LocalPath $target).StartsWith((Normalize-LocalPath $live) + '\')) { throw 'Unexpected artifact path in build evidence.' }
        if (-not (Test-Path -LiteralPath $target -PathType Leaf) -or (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $artifact.Value) { throw 'A copied build artifact differs from the accepted stage.' }
    }
}

if (-not (Normalize-LocalPath $stage).StartsWith((Normalize-LocalPath $testRoot) + '\') -or -not (Normalize-LocalPath $acceptancePath).StartsWith((Normalize-LocalPath $testRoot) + '\') -or (Normalize-LocalPath $live) -ne (Normalize-LocalPath (Join-Path $projectRoot 'lan-dist'))) { throw 'Build and acceptance paths must be inside project test-output; live must be project lan-dist.' }
foreach ($filename in @('workspace-api.mjs','runtime.mjs','auth.mjs','server.mjs','manage.mjs','supplier-gateway.mjs','client\index.html','customer-price-build-evidence.json')) {
    if (-not (Test-Path -LiteralPath (Join-Path $stage $filename) -PathType Leaf)) { throw "Missing accepted build artifact: $filename" }
}
$allowedBuildEntries = @('workspace-api.mjs','runtime.mjs','auth.mjs','server.mjs','manage.mjs','supplier-gateway.mjs','client','customer-price-build-evidence.json')
foreach ($entry in (Get-ChildItem -LiteralPath $stage -Force)) { if ($entry.Name -notin $allowedBuildEntries) { throw "Unexpected file in code-only build: $($entry.Name)" } }
foreach ($directory in @($stage,$live)) { if ((Get-Item -LiteralPath $directory -Force).Attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw 'Build directories must not be links or junctions.' } }
# A saved JS bridge avoids PowerShell 5 native-argument quote rewriting.
$verifyBridge = Join-Path $testRoot ('finished-supplier-verify-' + [Guid]::NewGuid().ToString('N') + '.mjs')
$verifySource = @'
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const {verifyCustomerPriceBuildEvidence}=await import(pathToFileURL(path.resolve(process.argv[2], 'scripts/customer-price-build-evidence.mjs')).href);
console.log(JSON.stringify(await verifyCustomerPriceBuildEvidence(process.argv[3])));
'@
[System.IO.File]::WriteAllText($verifyBridge, $verifySource, (New-Object System.Text.UTF8Encoding($false)))
$buildText = & $nodePath $verifyBridge $projectRoot $stage
if ($LASTEXITCODE -ne 0) { throw 'Source/build correspondence failed before stopping production.' }
$buildEvidence = $buildText | ConvertFrom-Json
$acceptance = Get-Content -LiteralPath $acceptancePath -Raw | ConvertFrom-Json
if ($acceptance.format -ne 'finished-supplier-acceptance-v1' -or $acceptance.passed -ne $true -or $acceptance.buildManifestSha256 -ne $buildEvidence.manifestSha256) { throw 'Acceptance evidence does not match this source/build manifest.' }
foreach ($check in @('business','typecheck','standalone','gateway','supplierApi','supplierBrowser')) { if ($acceptance.checks.$check -ne $true) { throw "Required acceptance check did not pass: $check" } }
if ([DateTimeOffset]::Parse($acceptance.at) -lt [DateTimeOffset]::Parse($buildEvidence.builtAt) -or [DateTimeOffset]::Parse($acceptance.at) -gt [DateTimeOffset]::UtcNow.AddMinutes(5)) { throw 'Acceptance timestamp is inconsistent with the accepted build.' }
$task = Assert-ProjectTask
if (-not $task.Settings.Enabled) { throw 'The company supervisor is manually paused; it will not be enabled by this deployment.' }
Assert-PortOwner
$stamp = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8)
$rollback = Join-Path $testRoot ('finished-supplier-rollback-' + $stamp)
$checkpoint = Join-Path $testRoot ('finished-supplier-preservation-' + $stamp + '.json')
New-Item -ItemType Directory -Path $rollback | Out-Null
foreach ($entry in (Get-ChildItem -LiteralPath $live -Force)) { Copy-Item -LiteralPath $entry.FullName -Destination $rollback -Recurse -Force }
$onlineBackupText = & $nodePath (Join-Path $live 'manage.mjs') backup
if ($LASTEXITCODE -ne 0) { throw 'Online SQLite and attachment backup failed; service has not been stopped.' }
$onlineBackup = $onlineBackupText | ConvertFrom-Json
$maintenanceStarted = $false
$stoppedBackup = $null
try {
    # Only company 8787 is controlled. This script never opens 8788 or changes tasks.
    $maintenanceStarted = $true
    Stop-OwnedService
    $stoppedBackupText = & $nodePath (Join-Path $live 'manage.mjs') backup
    if ($LASTEXITCODE -ne 0) { throw 'Stopped-service consistent backup failed.' }
    $stoppedBackup = $stoppedBackupText | ConvertFrom-Json
    & $nodePath $preservationScript before $checkpoint
    if ($LASTEXITCODE -ne 0) { throw 'Record/account-metadata/attachment checkpoint failed.' }
    Replace-Code $stage
    Assert-CopiedArtifacts
    & $nodePath $preservationScript after $checkpoint --unchanged
    if ($LASTEXITCODE -ne 0) { throw 'Code-only replacement changed records, account metadata or attachments.' }
    Start-OwnedService
    $null = Wait-Healthy
    $pages = foreach ($route in @('finished-outsourcing','supplier-portal')) {
        $page = Invoke-WebRequest -UseBasicParsing -Uri ('http://127.0.0.1:8787/' + $route) -TimeoutSec 10
        if ([int]$page.StatusCode -ne 200) { throw "Deployed page is unavailable: $route" }
        [pscustomobject]@{route=$route;status=[int]$page.StatusCode}
    }
} catch {
    $failure = $_
    if ($maintenanceStarted) {
        try {
            Stop-OwnedService
            Replace-Code $rollback
            Start-OwnedService
            $null = Wait-Healthy
        } catch { throw ('Deployment failed: ' + $failure.Exception.Message + '; code rollback/restart also failed: ' + $_.Exception.Message + '. Database and attachments were never restored. Rollback: ' + $rollback) }
    }
    throw ('Deployment failed; prior company code was restored and restarted. ' + $failure.Exception.Message + '. Data was not rolled back. Code rollback: ' + $rollback)
}
$result = [pscustomobject]@{deployedAt=[DateTime]::UtcNow.ToString('o');healthy=$true;codeOnly=$true;publicListenerStarted=$false;stage=$stage;acceptance=$acceptancePath;manifestSha256=$buildEvidence.manifestSha256;pages=$pages;dataPreserved=$true;checkpoint=$checkpoint;rollback=$rollback;onlineBackup=$onlineBackup;stoppedBackup=$stoppedBackup}
$result | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $testRoot 'finished-supplier-deployment.json') -Encoding utf8
$result | ConvertTo-Json -Depth 5
