@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "runtime\node.exe" (
  echo 缺少运行环境，请完整解压整个 ZIP 文件夹后再启动。
  pause
  exit /b 1
)
"%~dp0runtime\node.exe" "%~dp0scripts\start-portable-web.mjs" %*
if errorlevel 1 pause
