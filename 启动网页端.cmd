@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js，再运行此文件。
  pause
  exit /b 1
)
if not exist "dist\index.html" (
  call npm run build
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
echo 知识图谱 v1.2.7 最新网页端
echo 双击 启动网页端.wsf 启动时不会出现这个窗口；本窗口模式下关闭窗口即停止服务，无窗口模式用 停止网页端.wsf 停止。
node scripts\start-local-web.mjs %*
set "kgExit=%errorlevel%"
if not "%kgExit%"=="0" (
  echo.
  echo 服务已退出（代码 %kgExit%）。检查上面的输出后再启动一次。
  pause
)
exit /b %kgExit%
