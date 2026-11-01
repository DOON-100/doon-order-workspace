@echo off
REM DOON 一键部署工具启动脚本
REM 双击本文件即可启动交互式部署向导

chcp 65001 >nul
setlocal enabledelayedexpansion

set "NODE="

REM 1) 优先用 WorkBuddy 自带 Node（读取 current 文件得到版本目录）
if exist "%USERPROFILE%\.workbuddy\binaries\node\versions\current" (
  set /p VER=<"%USERPROFILE%\.workbuddy\binaries\node\versions\current"
  if exist "%USERPROFILE%\.workbuddy\binaries\node\versions\!VER!\node.exe" (
    set "NODE=%USERPROFILE%\.workbuddy\binaries\node\versions\!VER!\node.exe"
  )
)

REM 2) 其次尝试系统 PATH 里的 node
if not defined NODE (
  where node >nul 2>nul && set "NODE=node"
)

if not defined NODE (
  echo [错误] 未找到 Node.js。
  echo 请安装 Node.js，或使用 WorkBuddy 自带的 Node 环境。
  pause
  exit /b 1
)

cd /d "%~dp0"

echo 使用 Node: %NODE%
echo.

if "%~1"=="" (
  "%NODE%" deploy.mjs
) else (
  "%NODE%" deploy.mjs "%~1"
)

echo.
echo 按任意键退出...
pause >nul
