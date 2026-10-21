# Load only the pure ownership predicate from the parsed source; no release entry point runs.
$ErrorActionPreference='Stop'
$tokens=$null
$errors=$null
$scriptPath=Join-Path $PSScriptRoot 'deploy-code-update.ps1'
$ast=[System.Management.Automation.Language.Parser]::ParseFile($scriptPath,[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw 'Deployment script has syntax errors.' }
$function=$ast.Find({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Test-ScriptProcess'},$true)
if (-not $function) { throw 'Ownership predicate missing.' }
. ([ScriptBlock]::Create($function.Extent.Text))
$nodePath='C:\Program Files\nodejs\node.exe'
$server='D:\synthetic\web\lan-dist\server.mjs'
function Check([string]$CommandLine,[string]$Executable,[bool]$Expected) {
 $process=[pscustomobject]@{CommandLine=$CommandLine;ExecutablePath=$Executable}
 if ((Test-ScriptProcess $process $server) -ne $Expected) { throw 'Ownership predicate assertion failed.' }
}
Check ('"'+$nodePath+'" '+$server) $nodePath $true
Check ('"'+$nodePath+'" "'+$server+'"') $nodePath $true
Check ('"'+$nodePath+'" '+$server+'.other') $nodePath $false
Check ('"'+$nodePath+'" D:\another\web\lan-dist\server.mjs') $nodePath $false
Check ('"'+$nodePath+'" -e "'+$server+'"') $nodePath $false
Check ('"'+$nodePath+'" '+$server+' --extra') $nodePath $false
Check ('"'+$nodePath+'" lan-dist/server.mjs') $nodePath $false
Check ('"'+$nodePath+'" '+$server) 'C:\another\node.exe' $false
[pscustomobject]@{ok=$true;passed=8;synthetic=$true;productionTouched=$false} | ConvertTo-Json -Compress
