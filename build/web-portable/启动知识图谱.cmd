@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "runtime\node.exe" (
  echo 缺少运行环境，请完整解压整个 ZIP 文件夹后再启动。
  pause
  exit /b 1
)
"%~dp0runtime\node.exe" "%~dp0scripts\start-portable-web.mjs" %*
set "kgExit=%errorlevel%"
if not "%kgExit%"=="0" (
  echo.
  echo 服务已退出（代码 %kgExit%）。检查上面的输出后再启动一次。
  pause
)
exit /b %kgExit%
