$ErrorActionPreference = 'Stop'
$framework = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$output = Join-Path $PSScriptRoot 'bin'
New-Item -ItemType Directory -Force -Path $output | Out-Null
$refs = @('System.dll','System.Core.dll','System.Xml.dll','System.Xml.Linq.dll','System.Web.Extensions.dll','System.IO.Compression.dll','System.IO.Compression.FileSystem.dll','System.Xaml.dll','WPF\WindowsBase.dll','WPF\PresentationCore.dll','WPF\PresentationFramework.dll') | ForEach-Object { '/r:' + (Join-Path $framework $_) }
$sources = Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.cs' | ForEach-Object { $_.FullName }
& (Join-Path $framework 'csc.exe') /nologo /target:winexe /platform:x64 /optimize+ ('/out:' + (Join-Path $output 'DoonWorkbench.exe')) $refs $sources
if ($LASTEXITCODE -ne 0) { throw 'Desktop compilation failed' }
Write-Output (Join-Path $output 'DoonWorkbench.exe')
