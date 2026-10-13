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
set "ZOTERO_DB=D:\BaiduSyncdisk\Bibliotx\Zotero\zotero.sqlite"
if not exist "%ZOTERO_DB%" (
  echo 警告：未找到 Zotero 数据库 %ZOTERO_DB%
  echo 文献表仍可使用，但双击打开本地 PDF 会不可用。
  node scripts\local-web.mjs --vault "D:\BaiduSyncdisk\Bibliotx\Vault"
) else (
  node scripts\local-web.mjs --vault "D:\BaiduSyncdisk\Bibliotx\Vault" --zotero-db "%ZOTERO_DB%"
)
if errorlevel 1 pause
