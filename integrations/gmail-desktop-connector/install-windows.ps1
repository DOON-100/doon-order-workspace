param(
 [Parameter(Mandatory=$true)][string]$SourceDirectory,
 [Parameter(Mandatory=$true)][string]$NodePath,
 [switch]$NoStartup
)
$ErrorActionPreference='Stop'
$source=(Resolve-Path -LiteralPath $SourceDirectory).Path
$node=(Resolve-Path -LiteralPath $NodePath).Path
$release=Get-Content -LiteralPath (Join-Path $source 'release.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if($release.format -ne 'doon-gmail-client-v1'){throw 'Not a Gmail connector package'}
$bundle=Join-Path $source 'connector.mjs'
if((Get-FileHash -LiteralPath $bundle -Algorithm SHA256).Hash.ToLowerInvariant() -ne $release.sha256){throw 'Connector package checksum mismatch'}
$version=& $node --version
if($version -notmatch '^v24\.(?:1[3-9]|[2-9][0-9])\.' -and $version -notmatch '^v(?:2[5-9]|[3-9][0-9])\.'){throw 'Node 24.13 or newer required'}
$runtime=Join-Path $env:LOCALAPPDATA 'Doon\GmailConnector'
$app=Join-Path $runtime ('app\'+$release.version+'-'+$release.sha256.Substring(0,12))
New-Item -ItemType Directory -Path $app -Force | Out-Null
foreach($name in @('connector.mjs','release.json','THIRD_PARTY_LICENSES.txt')){
 $target=Join-Path $app $name
 if(Test-Path -LiteralPath $target){
  if((Get-FileHash -LiteralPath $target).Hash -ne (Get-FileHash -LiteralPath (Join-Path $source $name)).Hash){throw 'Installed release differs; refusing overwrite'}
 }else{Copy-Item -LiteralPath (Join-Path $source $name) -Destination $target}
}
$active=@{nodePath=$node;appPath=(Join-Path $app 'connector.mjs');sha256=$release.sha256}
$active | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtime 'active.json') -Encoding UTF8
$launcher=@'
$ErrorActionPreference='Stop'
$a=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'active.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if((Get-FileHash -LiteralPath $a.appPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $a.sha256){throw 'Connector checksum mismatch'}
$log=Join-Path $PSScriptRoot 'connector.log'
if((Test-Path -LiteralPath $log) -and (Get-Item -LiteralPath $log).Length -gt 5242880){Move-Item -LiteralPath $log -Destination ($log+'.previous') -Force}
$env:NODE_NO_WARNINGS='1'
$ErrorActionPreference='Continue'
& $a.nodePath $a.appPath run *>> $log
exit $LASTEXITCODE
'@
$start=Join-Path $runtime 'start.ps1'
Set-Content -LiteralPath $start -Value $launcher -Encoding UTF8
$authScript=@'
$a=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'active.json') -Raw -Encoding UTF8 | ConvertFrom-Json
& $a.nodePath $a.appPath auth
if($LASTEXITCODE -eq 0){Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',('"'+(Join-Path $PSScriptRoot 'start.ps1')+'"'))}
'@
Set-Content -LiteralPath (Join-Path $runtime 'reauthorize.ps1') -Value $authScript -Encoding UTF8
$statusScript=@'
$a=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'active.json') -Raw -Encoding UTF8 | ConvertFrom-Json
& $a.nodePath $a.appPath status
'@
Set-Content -LiteralPath (Join-Path $runtime 'status.ps1') -Value $statusScript -Encoding UTF8
$shell=New-Object -ComObject WScript.Shell
$programs=Join-Path ([Environment]::GetFolderPath('Programs')) 'DOON Gmail Connector'
New-Item -ItemType Directory -Path $programs -Force | Out-Null
foreach($item in @(@('Gmail connector status','status.ps1'),@('Gmail authorize again','reauthorize.ps1'))){
 $entry=$shell.CreateShortcut((Join-Path $programs ($item[0]+'.lnk')))
 $entry.TargetPath=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
 $entry.Arguments='-NoProfile -NoExit -ExecutionPolicy Bypass -File "'+(Join-Path $runtime $item[1])+'"'
 $entry.WorkingDirectory=$runtime
 $entry.Save()
}
if(!$NoStartup){
 $scheduled=$false
 try{
  $taskName='DOON Gmail Connector'
  $existing=Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if($existing -and $existing.Description -ne 'DOON Gmail desktop connector'){throw 'Task name belongs to another program'}
  $windowsUser=[Security.Principal.WindowsIdentity]::GetCurrent().Name
  $action=New-ScheduledTaskAction -Execute (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "'+$start+'"') -WorkingDirectory $runtime
  $trigger=New-ScheduledTaskTrigger -AtLogOn -User $windowsUser
  $principal=New-ScheduledTaskPrincipal -UserId $windowsUser -LogonType Interactive -RunLevel Limited
  $settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
  Register-ScheduledTask -TaskName $taskName -Description 'DOON Gmail desktop connector' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
  $scheduled=$true
 }catch{Write-Output 'Scheduled-task installation unavailable; using the current-user Startup shortcut.'}
 $startup=[Environment]::GetFolderPath('Startup')
 $shell=New-Object -ComObject WScript.Shell
 $shortcutPath=Join-Path $startup 'DOON Gmail Connector.lnk'
 $shortcut=$shell.CreateShortcut($shortcutPath)
 if((Test-Path -LiteralPath $shortcutPath) -and $shortcut.Description -ne 'DOON Gmail desktop connector'){throw 'Existing startup shortcut is not owned by this connector'}
 if($scheduled){
  if(Test-Path -LiteralPath $shortcutPath){Remove-Item -LiteralPath $shortcutPath}
 }else{
  $shortcut.TargetPath=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $shortcut.Arguments='-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "'+$start+'"'
  $shortcut.WorkingDirectory=$runtime
  $shortcut.WindowStyle=7
  $shortcut.Description='DOON Gmail desktop connector'
  $shortcut.Save()
 }
}
Write-Output 'Installed the Gmail connector in its own Windows-user directory. Existing services were not changed.'
