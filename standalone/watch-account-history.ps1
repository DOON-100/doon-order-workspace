param(
    [Parameter(Mandatory=$true)][string]$InstanceId,
    [Parameter(Mandatory=$true)][string]$Region,
    [Parameter(Mandatory=$true)][string]$DataDirectory,
    [Parameter(Mandatory=$true)][string]$Username,
    [string]$Profile = 'default',
    [ValidateRange(2,300)][int]$IntervalSeconds = 5,
    [switch]$Once
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$wb = (Get-Command workbench -ErrorAction SilentlyContinue).Source
if (-not $wb) { $wb = Join-Path $env:LOCALAPPDATA 'Programs\workbench\workbench.exe' }
if (-not (Test-Path -LiteralPath $wb)) { throw 'Workbench CLI is not installed.' }
$seen = New-Object 'System.Collections.Generic.Dictionary[string,string]'
$settings = @{directory=$DataDirectory;username=$Username.Trim().ToLowerInvariant()} | ConvertTo-Json -Compress
$settingsBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($settings))
$query = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'account-history-query.py'))
$query = $query.Replace('__SETTINGS__',$settingsBase64)
Write-Host "Watching $Username on ECS $InstanceId ($Region). Times: Beijing (UTC+8)."
Write-Host "Existing events appear first; checking every $IntervalSeconds seconds. Ctrl+C stops."
Write-Host 'Scope: saved audit, authentication, module versions/events, embedded reviews and import/export/attachment evidence.'
Write-Host '[Time] Operator | Action | Target | Source | Relation | IP'
$initial = $true
while ($true) {
    # Base64 protects multiline Python quotes when Windows PowerShell passes native arguments.
    $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($query))
    $command = 'printf %s ' + $encoded + ' | base64 -d | python3 -'
    $raw = & $wb exec --instance-id $InstanceId --region $Region --profile $Profile --command $command --timeout 30 --output json
    $cliExitCode = $LASTEXITCODE
    $result = ($raw -join "`n") | ConvertFrom-Json
    if ($cliExitCode -ne 0 -or $null -eq $result.exit_code -or $result.exit_code -ne 0) {
        throw "Remote query failed: $($result.message) $($result.stderr)"
    }
    $history = $result.output | ConvertFrom-Json
    foreach ($event in $history.events) {
        if ($null -eq $event) { continue }
        $previous = $null
        $known = $seen.TryGetValue([string]$event.key,[ref]$previous)
        if ($known -and $previous -eq $event.sha256) { continue }
        $change = if ($known) { 'UPDATED EVIDENCE' } else { 'HISTORY' }
        Write-Host "[$($event.time)] $($event.operator) | $($event.action) | $($event.target) | $($event.source) | $($event.relation) | $($event.ip)"
        Write-Host "  $change | version=$($event.version) | fields=$($event.fields -join ',') | identity=$($event.identityMatch) | SHA256=$($event.sha256)"
        $seen[[string]$event.key] = [string]$event.sha256
    }
    if ($initial) { Write-Host "Loaded $($history.count) saved history/evidence entries (no 200-row truncation). Waiting for new or changed entries..."; $initial = $false }
    if ($Once) { break }
    Start-Sleep -Seconds $IntervalSeconds
}
