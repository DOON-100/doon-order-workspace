param([string]$InstallRoot = '', [switch]$SkipPathUpdate)
$ErrorActionPreference = 'Stop'

function Get-Sha256([string]$File) {
  $Stream = [IO.File]::OpenRead($File)
  $Algorithm = [Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($Algorithm.ComputeHash($Stream)).Replace('-', '').ToLowerInvariant() }
  finally { $Algorithm.Dispose(); $Stream.Dispose() }
}

function Test-Package([string]$Root) {
  $Root = [IO.Path]::GetFullPath($Root)
  if ((Get-Item -LiteralPath $Root -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Package root cannot be a link.' }
  $Manifest = Get-Content -LiteralPath (Join-Path $Root 'release.json') -Raw | ConvertFrom-Json
  if ($Manifest.format -ne 'doon-cli-windows-v1' -or $Manifest.platform -ne 'win32-x64') { throw 'Invalid CLI package format.' }
  $Items = @(Get-ChildItem -LiteralPath $Root -Force -Recurse)
  if (@($Items | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count) { throw 'Package links are not allowed.' }
  $Files = @($Items | Where-Object { -not $_.PSIsContainer -and $_.FullName -ne (Join-Path $Root 'release.json') })
  $Expected = @($Manifest.files.PSObject.Properties)
  if ($Files.Count -ne $Expected.Count) { throw 'Unexpected package files.' }
  foreach ($Entry in $Expected) {
    if ($Entry.Name -notmatch '^[a-zA-Z0-9._/-]+$' -or ($Entry.Name -split '/') -contains '..') { throw 'Invalid package path.' }
    $Target = [IO.Path]::GetFullPath((Join-Path $Root $Entry.Name))
    if (-not $Target.StartsWith($Root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe package path.' }
    if (-not (Test-Path -LiteralPath $Target -PathType Leaf)) { throw 'Package file missing.' }
    if ((Get-Item -LiteralPath $Target).Length -ne $Entry.Value.bytes -or (Get-Sha256 $Target) -ne $Entry.Value.sha256) { throw 'Package integrity mismatch.' }
  }
  return $Manifest
}

$Manifest = Test-Package $PSScriptRoot
if (-not $InstallRoot) { $InstallRoot = Join-Path $env:LOCALAPPDATA 'Doon\CLI' }
if (-not [IO.Path]::IsPathRooted($InstallRoot)) { throw 'InstallRoot must be absolute.' }
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
if ($InstallRoot -eq [IO.Path]::GetPathRoot($InstallRoot)) { throw 'Cannot install at a drive root.' }
if (Test-Path -LiteralPath $InstallRoot) {
  if ((Get-Item -LiteralPath $InstallRoot -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'InstallRoot cannot be a link.' }
}
$Version = [string]$Manifest.version
$Commit = [string]$Manifest.commit
if ($Version -notmatch '^\d+\.\d+\.\d+$' -or $Commit -notmatch '^[a-f0-9]{40}$') { throw 'Invalid release version.' }
$ReleaseId = $Version + '-' + $Commit.Substring(0, 12) + $(if ($Manifest.sourceDirty) { '-dev' } else { '' })
$Programs = Join-Path $InstallRoot 'programs'
$Bin = Join-Path $InstallRoot 'bin'
foreach ($Folder in @($Programs, $Bin)) {
  New-Item -ItemType Directory -Path $Folder -Force | Out-Null
  if ((Get-Item -LiteralPath $Folder -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Program directories cannot be links.' }
}
$Target = Join-Path $Programs $ReleaseId
if (Test-Path -LiteralPath $Target) {
  $Existing = Test-Package $Target
  if (@($Existing.files.PSObject.Properties).Count -ne @($Manifest.files.PSObject.Properties).Count) { throw 'A different package already uses this release path.' }
  foreach ($Entry in $Manifest.files.PSObject.Properties) {
    $Old = $Existing.files.PSObject.Properties[$Entry.Name]
    if ($null -eq $Old -or $Old.Value.sha256 -ne $Entry.Value.sha256 -or $Old.Value.bytes -ne $Entry.Value.bytes) { throw 'A different package already uses this release path.' }
  }
} else {
  $Stage = Join-Path $Programs ('.install-' + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $Stage | Out-Null
  foreach ($Item in Get-ChildItem -LiteralPath $PSScriptRoot -Force) { Copy-Item -LiteralPath $Item.FullName -Destination $Stage -Recurse }
  $Verified = Test-Package $Stage
  foreach ($MovePath in @($Stage, $Target)) {
    if (-not ([IO.Path]::GetFullPath($MovePath)).StartsWith($Programs + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe program installation path.' }
  }
  Move-Item -LiteralPath $Stage -Destination $Target
}
$Shim = '@echo off' + "`r`n" + '@call "%~dp0..\programs\' + $ReleaseId + '\doon.cmd" %*' + "`r`n"
[IO.File]::WriteAllText((Join-Path $Bin 'doon.cmd'), $Shim, [Text.Encoding]::ASCII)
if (-not $SkipPathUpdate) {
  $UserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $Parts = @($UserPath -split ';' | Where-Object { $_ })
  if (-not @($Parts | Where-Object { $_.TrimEnd('\') -ieq $Bin.TrimEnd('\') }).Count) {
    [Environment]::SetEnvironmentVariable('Path', (($Parts + $Bin) -join ';'), 'User')
  }
}
Write-Output ('Installed Doon CLI ' + $Version + '. Reopen your terminal, then run doon setup --server <company HTTPS origin>.')
