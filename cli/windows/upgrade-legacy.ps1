param([Parameter(Mandatory=$true)][string]$ExpectedOrigin,[string]$InstallRoot='',[switch]$DownloadOnly)
$ErrorActionPreference='Stop'
$env:PSModulePath=[IO.Path]::Combine($PSHOME,'Modules')
if(-not $InstallRoot){$InstallRoot=Join-Path $env:LOCALAPPDATA 'Doon\CLI'}
if(-not [IO.Path]::IsPathRooted($InstallRoot)){throw 'InstallRoot must be absolute.'}
$InstallRoot=[IO.Path]::GetFullPath($InstallRoot)
function Assert-Physical([string]$Path){if((Get-Item -LiteralPath $Path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'CLI paths must not be links.'}}
Assert-Physical $InstallRoot
$Programs=Join-Path $InstallRoot 'programs';Assert-Physical $Programs
Assert-Physical (Join-Path $InstallRoot 'bin')
$Shim=Join-Path $InstallRoot 'bin\doon.cmd';Assert-Physical $Shim
$Match=[regex]::Match([IO.File]::ReadAllText($Shim),'programs\\(\d+\.\d+\.\d+-[a-f0-9]{12})\\doon\.cmd')
if(-not $Match.Success){throw 'A clean installed Doon CLI is required.'}
$ProgramRoot=Join-Path $Programs $Match.Groups[1].Value;Assert-Physical $ProgramRoot
Assert-Physical (Join-Path $ProgramRoot 'dist')
Assert-Physical (Join-Path $ProgramRoot 'release.json')
$Installed=Get-Content -LiteralPath (Join-Path $ProgramRoot 'release.json') -Raw | ConvertFrom-Json
if($Installed.platform -ne 'win32-x64' -or $Installed.sourceDirty -ne $false -or $Match.Groups[1].Value -ne ($Installed.version+'-'+$Installed.commit.Substring(0,12))){throw 'Installed release metadata is invalid.'}
foreach($Name in @('node.exe','package.json','dist/state.js','dist/errors.js')){
 $File=Join-Path $ProgramRoot $Name;Assert-Physical $File
 if(-not $Installed.files.PSObject.Properties[$Name] -or (Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Installed.files.$Name.sha256){throw 'Installed credential helper integrity check failed.'}
}
$Stage=Join-Path ([IO.Path]::GetTempPath()) ('doon-cli-bootstrap-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Stage | Out-Null
try{
 $Downloader=@'
const fs=require('node:fs/promises'),path=require('node:path'),{pathToFileURL}=require('node:url'),{createHash}=require('node:crypto');
const [program,home,stage,expectedOrigin,currentVersion]=process.argv.slice(2);
async function run(){
 const {StateStore}=await import(pathToFileURL(path.join(program,'dist/state.js')).href);
 const store=new StateStore(home),config=await store.config();
 if(config.origin!==expectedOrigin)throw Error('The configured company server differs from the requested upgrade server.');
 const session=await store.session(config);if(!session)throw Error('Run doon login with your own account, then retry this command.');
 async function read(endpoint,limit){
  const controller=new AbortController();let idle;
  const progress=()=>{clearTimeout(idle);idle=setTimeout(()=>controller.abort(),30000);};
  const timer=setTimeout(()=>controller.abort(),900000);progress();
  try{
   const response=await fetch(new URL(endpoint,config.origin),{redirect:'error',signal:controller.signal,headers:{Cookie:session.cookie,Accept:endpoint.endsWith('/latest')?'application/json':'application/octet-stream'}});
   if(!response.ok)throw Error(response.status===401?'Run doon login with your own account, then retry.':'The company server rejected the upgrade request (HTTP '+response.status+').');
   if(endpoint.endsWith('/latest')&&!response.headers.get('content-type')?.includes('application/json'))throw Error('Invalid release response.');
   if(Number(response.headers.get('content-length')||0)>limit)throw Error('Upgrade response exceeds its size limit.');
   const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>limit){controller.abort();throw Error('Upgrade response exceeds its size limit.');}if(chunk.length)progress();chunks.push(chunk);}
   return Buffer.concat(chunks);
  }finally{clearTimeout(timer);clearTimeout(idle);}
 }
 const release=JSON.parse((await read('/api/cli-update/latest',65536)).toString('utf8'));
 if(release.format!=='doon-cli-update-v1'||!/^\d+\.\d+\.\d+$/.test(release.version)||!/^\d+\.\d+\.\d+$/.test(currentVersion)||!/^[a-f0-9]{40}$/.test(release.commit)||release.file!==`doon-cli-${release.version}-${release.commit.slice(0,12)}-windows-x64.zip`||release.sourceDirty!==false||!Number.isInteger(release.bytes)||release.bytes<1||release.bytes>128*1024*1024||!/^[a-f0-9]{64}$/.test(release.sha256))throw Error('Invalid release manifest.');
 const a=release.version.split('.').map(Number),b=currentVersion.split('.').map(Number),newer=a.some((v,i)=>v>b[i]&&a.slice(0,i).every((p,j)=>p===b[j]));
 if(!newer){await fs.writeFile(path.join(stage,'download.json'),JSON.stringify({updateAvailable:false,version:currentVersion}));return;}
 const bytes=await read('/api/cli-update/package',128*1024*1024);
 if(bytes.length!==release.bytes||createHash('sha256').update(bytes).digest('hex')!==release.sha256)throw Error('Package integrity check failed. Nothing was installed.');
 await fs.writeFile(path.join(stage,release.file),bytes,{flag:'wx'});
 await fs.writeFile(path.join(stage,'download.json'),JSON.stringify({...release,updateAvailable:true}));
}
run().catch(error=>{console.error(error?.code==='AUTH_REQUIRED'?'Run doon login, then retry.':error?.message||'Upgrade failed.');process.exitCode=1;});
'@
 $DownloaderPath=Join-Path $Stage 'download.cjs';[IO.File]::WriteAllText($DownloaderPath,$Downloader,[Text.Encoding]::UTF8)
 & (Join-Path $ProgramRoot 'node.exe') $DownloaderPath $ProgramRoot $InstallRoot $Stage $ExpectedOrigin ([string]$Installed.version)
 if($LASTEXITCODE -ne 0){throw 'Authenticated upgrade download did not complete; the installed program was not changed.'}
 $Release=Get-Content -LiteralPath (Join-Path $Stage 'download.json') -Raw | ConvertFrom-Json
 if(-not $Release.updateAvailable){[Console]::WriteLine('Already current: '+$Release.version);return}
 if($DownloadOnly){[Console]::WriteLine('Authenticated download verified: '+$Release.version);return}
 $Archive=Join-Path $Stage $Release.file
 Add-Type -AssemblyName System.IO.Compression.FileSystem
 $Zip=[IO.Compression.ZipFile]::OpenRead($Archive)
 try{
  $Names=@{};$Total=0
  foreach($Entry in $Zip.Entries){
   $Name=$Entry.FullName.Replace('\','/');$Total+=$Entry.Length
   if($Name -notmatch '^[a-zA-Z0-9._/-]+$' -or $Name.StartsWith('/') -or ($Name -split '/') -contains '..' -or ($Name -split '/') -contains '.' -or $Names.ContainsKey($Name) -or (($Entry.ExternalAttributes -shr 16) -band 61440) -eq 40960){throw 'Unsafe package entry.'}
   if($Names.Count -ge 2000 -or $Total -gt 536870912 -or $Entry.Length -gt 268435456){throw 'Expanded package exceeds its size limit.'}
   $Names[$Name]=$true
  }
 }finally{$Zip.Dispose()}
 $Extracted=Join-Path $Stage 'package';Expand-Archive -LiteralPath $Archive -DestinationPath $Extracted
 $Manifest=Get-Content -LiteralPath (Join-Path $Extracted 'release.json') -Raw | ConvertFrom-Json
 if($Manifest.format -ne 'doon-cli-windows-v1' -or $Manifest.platform -ne 'win32-x64' -or $Manifest.sourceDirty -ne $false -or $Manifest.version -ne $Release.version -or $Manifest.commit -ne $Release.commit){throw 'Package release identity mismatch.'}
 $Files=@(Get-ChildItem -LiteralPath $Extracted -Force -Recurse -File | Where-Object FullName -ne (Join-Path $Extracted 'release.json'))
 if($Files.Count -ne @($Manifest.files.PSObject.Properties).Count){throw 'Unexpected package files.'}
 foreach($Entry in $Manifest.files.PSObject.Properties){
  if($Entry.Name -notmatch '^[a-zA-Z0-9._/-]+$' -or ($Entry.Name -split '/') -contains '..'){throw 'Invalid package manifest path.'}
  $File=[IO.Path]::GetFullPath((Join-Path $Extracted $Entry.Name))
  if(-not $File.StartsWith($Extracted+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Package path escaped the extraction directory.'}
  Assert-Physical $File
  if((Get-Item -LiteralPath $File).Length -ne $Entry.Value.bytes -or (Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Entry.Value.sha256){throw 'Package file integrity mismatch.'}
 }
 if(-not $Manifest.files.PSObject.Properties['install.ps1']){throw 'Installer is missing from the verified manifest.'}
 & (Join-Path $Extracted 'install.ps1') -InstallRoot $InstallRoot -SkipPathUpdate -UpdateOnly
 $Version=& (Join-Path $InstallRoot 'bin\doon.cmd') --version
 if($LASTEXITCODE -ne 0 -or $Version.Trim() -ne $Release.version){throw 'Installed version verification failed.'}
 [Console]::WriteLine('CLI upgraded to '+$Release.version+'. Existing account configuration is retained. Reopen the terminal or Agent.')
}finally{
 $Resolved=[IO.Path]::GetFullPath($Stage);$Temp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
 if((Split-Path -Parent $Resolved) -ne $Temp -or (Split-Path -Leaf $Resolved) -notmatch '^doon-cli-bootstrap-[a-f0-9]{32}$'){throw 'Unsafe upgrade temporary directory.'}
 Assert-Physical $Resolved
 if(Get-ChildItem -LiteralPath $Resolved -Force -Recurse -Attributes ReparsePoint | Select-Object -First 1){throw 'Unexpected temporary link; automatic cleanup stopped.'}
 Remove-Item -LiteralPath $Resolved -Recurse -Force
}
