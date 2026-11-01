param([Parameter(Mandatory=$true)][string]$Archive,[Parameter(Mandatory=$true)][string]$ExpectedHash,[Parameter(Mandatory=$true)][string]$ExpectedVersion,[Parameter(Mandatory=$true)][string]$ExpectedCommit)
$ErrorActionPreference='Stop'
# Agent hosts may inherit PowerShell 7 modules that Windows PowerShell cannot load.
$env:PSModulePath=[IO.Path]::Combine($PSHOME,'Modules')
if($ExpectedHash -notmatch '^[a-f0-9]{64}$' -or $ExpectedVersion -notmatch '^\d+\.\d+\.\d+$' -or $ExpectedCommit -notmatch '^[a-f0-9]{40}$'){throw 'Invalid release metadata.'}
$PackageRoot=[IO.Path]::GetFullPath($PSScriptRoot)
$Programs=Split-Path -Parent $PackageRoot
if((Split-Path -Leaf $Programs) -ne 'programs' -or -not (Test-Path -LiteralPath (Join-Path $PackageRoot 'release.json'))){throw 'Run the updater from an installed CLI.'}
$InstallRoot=Split-Path -Parent $Programs
$ActualHash=(Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash.ToLowerInvariant()
if($ActualHash -ne $ExpectedHash){throw 'Archive integrity mismatch.'}
$Stage=Join-Path ([IO.Path]::GetTempPath()) ('doon-cli-update-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Stage | Out-Null
try{
 Add-Type -AssemblyName System.IO.Compression.FileSystem
 $Zip=[IO.Compression.ZipFile]::OpenRead($Archive)
 try{
  $Names=@{}
  foreach($Entry in $Zip.Entries){
   $Name=$Entry.FullName.Replace('\','/')
   if($Name -notmatch '^[a-zA-Z0-9._/-]+$' -or $Name.StartsWith('/') -or ($Name -split '/') -contains '..' -or $Names.ContainsKey($Name)){throw 'Unsafe archive entry.'}
   $Names[$Name]=$true
  }
 }finally{$Zip.Dispose()}
 Expand-Archive -LiteralPath $Archive -DestinationPath $Stage
 $Manifest=Get-Content -LiteralPath (Join-Path $Stage 'release.json') -Raw | ConvertFrom-Json
 if($Manifest.version -ne $ExpectedVersion -or $Manifest.commit -ne $ExpectedCommit -or $Manifest.sourceDirty -ne $false -or $Manifest.platform -ne 'win32-x64'){throw 'Release metadata mismatch.'}
 & (Join-Path $Stage 'install.ps1') -InstallRoot $InstallRoot -SkipPathUpdate -UpdateOnly
}finally{
 $Resolved=[IO.Path]::GetFullPath($Stage)
 $TempRoot=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
 if((Split-Path -Parent $Resolved) -ne $TempRoot -or (Split-Path -Leaf $Resolved) -notmatch '^doon-cli-update-[a-f0-9]{32}$' -or ((Get-Item -LiteralPath $Resolved -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Unsafe update cleanup path.'}
 Remove-Item -LiteralPath $Resolved -Recurse -Force
}
