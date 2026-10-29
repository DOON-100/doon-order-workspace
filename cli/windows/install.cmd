@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
set "DoonInstallExitCode=%errorlevel%"
if not "%DoonInstallExitCode%"=="0" if "%~1"=="" pause
exit /b %DoonInstallExitCode%
