# Code-only release: never restore, import, initialize, or overwrite business data.
param(
    [Parameter(Mandatory=$true)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$ExpectedLiveManifestHash,
    [Parameter(Mandatory=$true)][string]$BrowserAcceptancePath,
    [string]$ReleaseSourceRoot = '',
    [switch]$PreflightOnly
)
$ErrorActionPreference = 'Stop'
$ExpectedLiveManifestHash = $ExpectedLiveManifestHash.ToLowerInvariant()
$projectRoot = (Resolve-Path -LiteralPath (Split-Path $PSScriptRoot -Parent)).Path
Set-Location -LiteralPath $projectRoot
if (-not $ReleaseSourceRoot) { $ReleaseSourceRoot = $projectRoot }
$sourceRoot = (Resolve-Path -LiteralPath $ReleaseSourceRoot).Path
$privateRoot = (Resolve-Path -LiteralPath (Join-Path $projectRoot 'test-output')).Path
if ($sourceRoot -ne $projectRoot -and -not $sourceRoot.StartsWith($privateRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Release source must be the project or an isolated source inside its test-output directory.' }
$stage = (Resolve-Path -LiteralPath (Join-Path $sourceRoot 'test-output/planning-control-build')).Path
$live = (Resolve-Path -LiteralPath (Join-Path $projectRoot 'lan-dist')).Path
$nodePath = Join-Path $env:ProgramFiles 'nodejs/node.exe'
$manifestName = 'customer-price-build-evidence.json'
$liveManifest = Join-Path $live $manifestName
$stageManifest = Join-Path $stage $manifestName
$browserReport = (Resolve-Path -LiteralPath $BrowserAcceptancePath).Path
if (-not $browserReport.StartsWith($privateRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Browser acceptance must be a private report inside this project test-output.' }
$taskName = 'DOON-Order-Workspace'
$stamp = (Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N').Substring(0,8)
$rollback = Join-Path $privateRoot ('planning-control-code-rollback-'+$stamp)
$checkpoint = Join-Path $privateRoot ('planning-control-preservation-'+$stamp+'.json')
$backupPath = Join-Path $privateRoot ('planning-control-data-backup-'+$stamp)
$logPath = Join-Path $privateRoot ('planning-control-release-'+$stamp+'.jsonl')
$lockPath = Join-Path $privateRoot 'planning-control-release.lock'
$lock = $null
$maintenance = $false
$codeTouched = $false
$deployedManifestHash = ''
$rollbackManifestHash = ''

function Assert-RealPath([string]$Target) {
    $item = Get-Item -LiteralPath $Target
    while ($item) {
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Deployment paths cannot traverse links or redirected directories.' }
        if ($item -is [IO.DirectoryInfo]) { $item = $item.Parent } else { $item = $item.Directory }
    }
}
function Write-ReleaseLog([string]$Event) {
    [pscustomobject]@{at=[DateTime]::UtcNow.ToString('o');event=$Event} | ConvertTo-Json -Compress | Add-Content -LiteralPath $logPath -Encoding utf8
}
function Assert-LiveManifest {
    if ((Get-FileHash -LiteralPath $liveManifest -Algorithm SHA256).Hash -ne $ExpectedLiveManifestHash) { throw 'Live manifest changed: another release occurred. Rebuild and revalidate against the current live baseline.' }
}
function Artifact-Path([string]$Root,[string]$Relative) {
    if ($Relative -match '(^[\\/]|:|(^|[\\/])\.\.?([\\/]|$))') { throw 'Invalid artifact path.' }
    $target = [IO.Path]::GetFullPath((Join-Path $Root $Relative))
    if (-not $target.StartsWith($Root+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Artifact escapes its build directory.' }
    return $target
}
function Assert-Artifacts([string]$Root,$Manifest) {
    foreach ($entry in $Manifest.artifactHashes.PSObject.Properties) {
        $target = Artifact-Path $Root $entry.Name
        Assert-RealPath $target
        if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $entry.Value) { throw 'Build artifact differs from its verified manifest.' }
    }
}
function Read-ArtifactInventory([string]$Root) {
    # Node supplies the same lexical path ordering as the build evidence verifier.
    $inventoryCode = @'
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=process.argv[2],names=[];
async function walk(dir){for(const entry of await fs.readdir(dir,{withFileTypes:true})){
 const target=path.join(dir,entry.name);
 if(entry.isSymbolicLink())throw new Error('Artifact links are not permitted');
 if(entry.isDirectory())await walk(target);else if(entry.isFile())names.push(path.relative(root,target).replaceAll('\\','/'));else throw new Error('Unexpected artifact entry');
}}
await walk(root);const hashes={};for(const name of names.sort())if(name!=='customer-price-build-evidence.json')hashes[name]=createHash('sha256').update(await fs.readFile(path.join(root,name))).digest('hex');
console.log(JSON.stringify(hashes));
'@
    $result = $inventoryCode | & $nodePath --input-type=module - $Root
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inventory build artifacts.' }
    return $result | ConvertFrom-Json
}
function Test-LegacyAsset([string]$Name) { return $Name -match '^client/assets/[^/]+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9.]+$' }
function Assert-LiveInventory {
    $current = Read-ArtifactInventory $live
    if (($current | ConvertTo-Json -Compress -Depth 10) -ne ($baselineInventory | ConvertTo-Json -Compress -Depth 10)) { throw 'Live artifact set changed during release preparation.' }
}
function Assert-CompleteArtifacts($Manifest) {
    $actual = Read-ArtifactInventory $live
    if (($actual | ConvertTo-Json -Compress -Depth 10) -ne ($Manifest.artifactHashes | ConvertTo-Json -Compress -Depth 10)) { throw 'Installed manifest does not cover the exact live artifact set.' }
}
function Install-CompleteManifest($Base,[string]$TestedHash,[string]$Phase) {
    Assert-Artifacts $live $Base
    $actual = Read-ArtifactInventory $live
    $retained = [ordered]@{}
    foreach ($entry in $actual.PSObject.Properties) {
        if ($Base.artifactHashes.PSObject.Properties[$entry.Name]) { continue }
        if (-not (Test-LegacyAsset $entry.Name)) { throw 'Unexpected retained artifact; only content-hashed browser assets may remain.' }
        $known = $baselineInventory.PSObject.Properties[$entry.Name]
        if (-not $known) { $known = $release.artifactHashes.PSObject.Properties[$entry.Name] }
        if (-not $known -or $known.Value -ne $entry.Value) { throw 'Retained browser asset differs from its verified bytes.' }
        $retained[$entry.Name] = $entry.Value
    }
    $result = $Base | ConvertTo-Json -Depth 100 | ConvertFrom-Json
    $result.artifactHashes = $actual
    $result | Add-Member -NotePropertyName deployment -NotePropertyValue ([ordered]@{phase=$Phase;testedManifestSha256=$TestedHash;baselineManifestSha256=$ExpectedLiveManifestHash;retainedAssetHashes=$retained;at=[DateTime]::UtcNow.ToString('o')}) -Force
    $candidate = Join-Path $privateRoot ('planning-control-manifest-'+$stamp+'-'+$Phase+'.json')
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes(($result | ConvertTo-Json -Depth 100))
    $stream = [IO.File]::Open($candidate,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try { $stream.Write($bytes,0,$bytes.Length) } finally { $stream.Dispose() }
    $hash = (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash.ToLowerInvariant()
    # Both paths are in this project on the same volume. Replace only the manifest atomically.
    $previousManifest = $candidate+'.previous'
    if (Test-Path -LiteralPath $previousManifest) { throw 'Previous manifest backup already exists.' }
    if ($Phase -eq 'release') { Assert-LiveManifest }
    [IO.File]::Replace($candidate,$liveManifest,$previousManifest)
    return $hash
}
function Assert-Build {
    Push-Location -LiteralPath $sourceRoot
    try {
        $verifyCode = 'import {verifyCustomerPriceBuildEvidence} from "./scripts/customer-price-build-evidence.mjs"; const evidence=await verifyCustomerPriceBuildEvidence(process.argv[2]); console.log(JSON.stringify(evidence));'
        $output = $verifyCode | & $nodePath --input-type=module - $stage
        if ($LASTEXITCODE -ne 0) { throw 'Source/build hash verification failed.' }
        $evidence = $output | ConvertFrom-Json
        $acceptance = Get-Content -LiteralPath 'test-output/planning-control-release-validation.json' -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($acceptance.manifestSha256 -ne $evidence.manifestSha256) { throw 'Acceptance does not identify this exact build.' }
        foreach ($key in @('typescript','business','runtime','browser','preservation')) { if ($acceptance.$key -ne $true) { throw 'Required isolated acceptance checks are incomplete.' } }
        if ($null -eq $acceptance.productionWrites -or $acceptance.productionWrites -ne 0 -or $null -eq $acceptance.errors -or @($acceptance.errors).Count -ne 0) { throw 'Acceptance must use isolated data without errors or production writes.' }
        $age = ([DateTime]::UtcNow-[DateTime]::Parse($acceptance.at).ToUniversalTime()).TotalHours
        if ($age -lt -0.0834 -or $age -ge 24) { throw 'Acceptance evidence is expired or future-dated.' }
        $browser = Get-Content -LiteralPath $browserReport -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($browser.buildEvidence.manifestSha256 -ne $evidence.manifestSha256 -or $browser.passed -lt 1 -or @($browser.checks).Count -ne $browser.passed -or $browser.scope -ne 'synthetic database only') { throw 'Browser report does not prove acceptance of this exact isolated build.' }
        if ($browser.PSObject.Properties['errors'] -and @($browser.errors).Count -ne 0) { throw 'Browser acceptance contains runtime errors.' }
        if (([DateTime]::UtcNow-(Get-Item -LiteralPath $browserReport).LastWriteTimeUtc).TotalHours -ge 24) { throw 'Browser acceptance is expired.' }
    } finally { Pop-Location }
}
function Assert-Ownership {
    $task = Get-ScheduledTask -TaskName $taskName
    $hostScript = Join-Path $PSScriptRoot 'service-host.mjs'
    $starter = Join-Path $PSScriptRoot 'service-host-start.ps1'
    if (-not $task.Settings.Enabled) { throw 'The supervisor is paused; deployment must not enable it.' }
    if ($task.Actions.WorkingDirectory -ne $projectRoot -or (-not $task.Actions.Arguments.Contains($hostScript) -and -not $task.Actions.Arguments.Contains($starter))) { throw 'Scheduled task does not belong to this project.' }
    $nodes = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'"
    $listeners = @(Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue)
    if (-not $listeners.Count) { throw 'The production listener is unavailable.' }
    $expected = (Join-Path $live 'server.mjs').Replace('\','/').ToLowerInvariant()
    foreach ($listener in $listeners) {
        $owner = $nodes | Where-Object ProcessId -eq $listener.OwningProcess
        if (-not $owner.CommandLine -or -not $owner.CommandLine.Replace('\','/').ToLowerInvariant().Contains($expected)) { throw 'Port 8787 is owned by another service.' }
    }
}
function Stop-VerifiedService {
    Disable-ScheduledTask -TaskName $taskName | Out-Null
    Stop-ScheduledTask -TaskName $taskName
    $hostScript = (Join-Path $PSScriptRoot 'service-host.mjs').Replace('\','/').ToLowerInvariant()
    $serverScript = (Join-Path $live 'server.mjs').Replace('\','/').ToLowerInvariant()
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object {
        $_.CommandLine -and ($_.CommandLine.Replace('\','/').ToLowerInvariant().Contains($hostScript) -or $_.CommandLine.Replace('\','/').ToLowerInvariant().Contains($serverScript))
    } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    for ($attempt=0;$attempt -lt 40;$attempt++) {
        if (-not (Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue)) { return }
        Start-Sleep -Milliseconds 250
    }
    throw 'The listener did not stop; no code can be replaced.'
}
function Start-VerifiedService {
    Enable-ScheduledTask -TaskName $taskName | Out-Null
    # Existing service-host-start.ps1 launches Node with WindowStyle Hidden.
    Start-ScheduledTask -TaskName $taskName
}
function Assert-Health {
    for ($attempt=0;$attempt -lt 30;$attempt++) {
        try { $health=Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health' -TimeoutSec 2; if ($health.ok -and $health.service -eq '度昂订单协作中台·内网版') { return } } catch {}
        Start-Sleep -Milliseconds 500
    }
    throw 'Production health check failed.'
}

try {
    foreach ($target in @($sourceRoot,$stage,$live,$privateRoot,$browserReport,(Join-Path $projectRoot 'lan-data'))) { Assert-RealPath $target }
    $lock = [IO.File]::Open($lockPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    Write-ReleaseLog 'preflight-start'
    Assert-LiveManifest
    $baseline = Get-Content -LiteralPath $liveManifest -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert-Artifacts $live $baseline
    $baselineInventory = Read-ArtifactInventory $live
    foreach ($entry in $baselineInventory.PSObject.Properties) {
        if (-not $baseline.artifactHashes.PSObject.Properties[$entry.Name] -and -not (Test-LegacyAsset $entry.Name)) { throw 'An untracked live file is not a content-hashed browser asset.' }
    }
    Assert-Build
    $release = Get-Content -LiteralPath $stageManifest -Raw -Encoding UTF8 | ConvertFrom-Json
    $stageManifestHash = (Get-FileHash -LiteralPath $stageManifest -Algorithm SHA256).Hash.ToLowerInvariant()
    foreach ($required in @('client/index.html','workspace-api.mjs','server.mjs','runtime.mjs','auth.mjs','manage.mjs')) { if (-not $release.artifactHashes.PSObject.Properties[$required]) { throw 'A required release artifact is missing.' } }
    foreach ($entry in $release.artifactHashes.PSObject.Properties) { if ($entry.Name -notmatch '^(client/|(?:workspace-api|server|runtime|auth|manage|supplier-gateway|employee-gateway)\.mjs$)') { throw 'Unexpected release artifact; data files cannot be deployed.' } }
    foreach ($entry in $baselineInventory.PSObject.Properties) { if (-not $release.artifactHashes.PSObject.Properties[$entry.Name] -and -not (Test-LegacyAsset $entry.Name)) { throw 'Release would leave an obsolete non-asset file. Prepare an explicit reviewed migration.' } }
    Assert-Ownership
    Assert-Health
    Write-ReleaseLog 'preflight-passed'
    if ($PreflightOnly) { [pscustomobject]@{preflight=$true;productionWrites=0;expectedLiveManifestHash=$ExpectedLiveManifestHash} | ConvertTo-Json; return }

    # Final check is immediately before the maintenance window; stale releases abort.
    Assert-LiveManifest
    Assert-Artifacts $live $baseline
    Assert-LiveInventory
    New-Item -ItemType Directory -Path $rollback -ErrorAction Stop | Out-Null
    Get-ChildItem -LiteralPath $live | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $rollback -Recurse -Force }
    $maintenance = $true
    Stop-VerifiedService
    Write-ReleaseLog 'writes-frozen'
    Assert-LiveManifest
    Assert-Artifacts $live $baseline
    Assert-LiveInventory
    Assert-Build
    & $nodePath 'scripts/backup-planning-control-release.mjs' $backupPath
    if ($LASTEXITCODE -ne 0) { throw 'Final consistent backup failed; no code replaced.' }
    & $nodePath 'scripts/verify-planning-control-preservation.mjs' before $checkpoint
    if ($LASTEXITCODE -ne 0) { throw 'Final preservation checkpoint failed; no code replaced.' }
    Write-ReleaseLog 'final-backup-and-checkpoint-passed'
    Assert-LiveManifest
    Assert-Artifacts $live $baseline
    Assert-LiveInventory
    Assert-Build
    if ((Get-FileHash -LiteralPath $stageManifest -Algorithm SHA256).Hash -ne $stageManifestHash) { throw 'Staging build changed during release preparation.' }
    $codeTouched = $true
    foreach ($entry in $release.artifactHashes.PSObject.Properties) {
        $from = Artifact-Path $stage $entry.Name
        $to = Artifact-Path $live $entry.Name
        New-Item -ItemType Directory -Path (Split-Path $to -Parent) -Force | Out-Null
        Copy-Item -LiteralPath $from -Destination $to -Force
    }
    # Preserve old hashed assets and cover every actual artifact in the installed evidence.
    $deployedManifestHash = Install-CompleteManifest $release $stageManifestHash 'release'
    Write-ReleaseLog ('deployed-manifest-sha256-'+$deployedManifestHash)
    Assert-Artifacts $live $release
    & $nodePath 'scripts/verify-planning-control-preservation.mjs' after $checkpoint
    if ($LASTEXITCODE -ne 0) { throw 'Data changed during the frozen code replacement window.' }
    Write-ReleaseLog 'frozen-data-unchanged'
    Start-VerifiedService
    Assert-Health
    Assert-Artifacts $live $release
    if ((Get-FileHash -LiteralPath $liveManifest -Algorithm SHA256).Hash -ne $deployedManifestHash) { throw 'Installed release manifest changed after startup.' }
    Assert-CompleteArtifacts (Get-Content -LiteralPath $liveManifest -Raw -Encoding UTF8 | ConvertFrom-Json)
    $page = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8787/production-planning' -TimeoutSec 15
    if ($page.StatusCode -ne 200 -or $page.Content -ne [IO.File]::ReadAllText((Join-Path $stage 'client/index.html'))) { throw 'Served page differs from the tested release.' }
    # Do not compare the live DB after reopening: employees may have committed new work.
    $maintenance = $false
    Write-ReleaseLog 'release-complete'
    [pscustomobject]@{healthy=$true;codeOnly=$true;frozenDataUnchanged=$true;databaseRestored=$false;testedManifestSha256=$stageManifestHash;deployedManifestSha256=$deployedManifestHash;backup=$backupPath;checkpoint=$checkpoint;rollback=$rollback;log=$logPath} | ConvertTo-Json
} catch {
    $failureLine = $_.InvocationInfo.ScriptLineNumber
    $failureType = $_.Exception.GetType().Name
    if ($lock) { Write-ReleaseLog 'release-failed' }
    if ($lock) { Write-ReleaseLog ('failure-at-line-'+$failureLine+'-'+$failureType) }
    if ($maintenance) {
        try {
            if ($codeTouched) {
                $currentManifestHash = (Get-FileHash -LiteralPath $liveManifest -Algorithm SHA256).Hash
                if ($currentManifestHash -ne $ExpectedLiveManifestHash -and $currentManifestHash -ne $deployedManifestHash) { throw 'Another release changed live code; automatic code rollback is blocked.' }
                Stop-VerifiedService
                # Remove only newly introduced code/static files from this release; retain hashed assets.
                foreach ($entry in $release.artifactHashes.PSObject.Properties) {
                    if (-not $baselineInventory.PSObject.Properties[$entry.Name] -and -not (Test-LegacyAsset $entry.Name)) {
                        $target = Artifact-Path $live $entry.Name
                        if (Test-Path -LiteralPath $target) { Assert-RealPath $target; Remove-Item -LiteralPath $target }
                    }
                }
                Get-ChildItem -LiteralPath $rollback | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $live -Recurse -Force }
                Assert-Artifacts $live $baseline
                $rollbackManifestHash = Install-CompleteManifest $baseline $ExpectedLiveManifestHash 'rollback'
                Write-ReleaseLog ('rollback-manifest-sha256-'+$rollbackManifestHash)
                Write-ReleaseLog 'code-only-rollback-complete'
            }
            Start-VerifiedService
            Assert-Health
            Write-ReleaseLog 'service-recovered-data-retained'
        } catch { Write-ReleaseLog 'recovery-needs-operator'; throw 'Release/recovery failed. Current database and attachments were retained. Inspect the private release log; do not restore an old database.' }
    }
    throw 'Release did not complete. Original/current data was never restored or overwritten. Inspect private release logs and verify the current service before retrying.'
} finally {
    if ($lock) { $lock.Dispose(); Remove-Item -LiteralPath $lockPath }
}
