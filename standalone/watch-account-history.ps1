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
$cursor = [long]0
$settings = @{directory=$DataDirectory;username=$Username.Trim().ToLowerInvariant()} | ConvertTo-Json -Compress
$settingsBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($settings))
$query = @'
import sqlite3,json,base64,pathlib
settings=json.loads(base64.b64decode('__SETTINGS__'))
database=pathlib.Path(settings['directory'])/'workspace.sqlite'
db=sqlite3.connect(database.as_uri()+'?mode=ro',uri=True)
try:
    db.execute('PRAGMA query_only=ON')
    rows=db.execute("""
        SELECT r.rowid,
          datetime(json_extract(r.data,'$.createdAt'),'+8 hours'),
          json_extract(r.data,'$.action'),json_extract(r.data,'$.targetId'),
          coalesce(operator.username,json_extract(r.data,'$.actor'),'unknown'),
          CASE WHEN r.kind='auth_event' THEN 'authentication'
               WHEN json_extract(r.data,'$.actorId')=subject.member_id THEN 'account-action'
               ELSE 'account-changed' END,
          coalesce(json_extract(r.data,'$.ip'),'')
        FROM records r
        CROSS JOIN local_accounts subject
        LEFT JOIN local_accounts operator ON operator.member_id=json_extract(r.data,'$.actorId')
        WHERE r.kind IN ('audit','auth_event') AND subject.username=? AND r.rowid>?
          AND (json_extract(r.data,'$.actorId')=subject.member_id
            OR json_extract(r.data,'$.targetId')=subject.member_id
            OR r.kind='auth_event' AND json_extract(r.data,'$.username')=subject.username)
        ORDER BY r.rowid LIMIT 200
    """,(settings['username'],__CURSOR__)).fetchall()
    print(json.dumps([{'cursor':r[0],'time':r[1],'action':r[2],'target':r[3],'operator':r[4],'relation':r[5],'ip':r[6]} for r in rows],ensure_ascii=False))
finally:
    db.close()
'@
$query = $query.Replace('__SETTINGS__',$settingsBase64)
Write-Host "Watching $Username on ECS $InstanceId ($Region). Times: Beijing (UTC+8)."
Write-Host "Existing events appear first; checking every $IntervalSeconds seconds. Ctrl+C stops."
Write-Host '[Time] Operator | Action | Target | Relation | IP'
while ($true) {
    $python = $query.Replace('__CURSOR__',[string]$cursor)
    # Base64 protects multiline Python quotes when Windows PowerShell passes native arguments.
    $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($python))
    $command = 'printf %s ' + $encoded + ' | base64 -d | python3 -'
    $raw = & $wb exec --instance-id $InstanceId --region $Region --profile $Profile --command $command --timeout 30 --output json
    $cliExitCode = $LASTEXITCODE
    $result = ($raw -join "`n") | ConvertFrom-Json
    if ($cliExitCode -ne 0 -or $null -eq $result.exit_code -or $result.exit_code -ne 0) {
        throw "Remote query failed: $($result.message) $($result.stderr)"
    }
    $events = $result.output | ConvertFrom-Json
    foreach ($event in $events) {
        if ($null -eq $event) { continue }
        Write-Host "[$($event.time)] $($event.operator) | $($event.action) | $($event.target) | $($event.relation) | $($event.ip)"
        $cursor = [long]$event.cursor
    }
    if ($Once) { break }
    Start-Sleep -Seconds $IntervalSeconds
}
