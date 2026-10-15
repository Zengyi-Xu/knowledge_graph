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
echo 知识图谱 v1.2.0 最新网页端
echo 浏览器打开后，请保留此窗口；关闭窗口会停止本地服务。
node scripts\start-local-web.mjs %*
if errorlevel 1 pause
