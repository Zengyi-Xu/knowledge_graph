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
rem 笔记里 localPdf 记录的 PDF 允许在这些目录里打开（pdf:link 脚本用同样的目录）
set "PDF_ROOTS=--pdf-root "D:\BaiduSyncdisk\Bibliotx\Literature" --pdf-root "D:\BaiduSyncdisk\Bibliotx\Archive" --pdf-root "D:\BaiduSyncdisk\Bibliotx\Inform" --pdf-root "D:\BaiduSyncdisk\Bibliotx\Zotero\storage" --pdf-root "C:\Users\%USERNAME%\Zotero\storage""
if not exist "%ZOTERO_DB%" (
  echo 警告：未找到 Zotero 数据库 %ZOTERO_DB%
  echo 文献表仍可使用，点 PDF 徽标打开 Zotero 库里的 PDF 会不可用（localPdf 记录的 PDF 不受影响）。
  node scripts\local-web.mjs --vault "D:\BaiduSyncdisk\Bibliotx\Vault" %PDF_ROOTS%
) else (
  node scripts\local-web.mjs --vault "D:\BaiduSyncdisk\Bibliotx\Vault" --zotero-db "%ZOTERO_DB%" %PDF_ROOTS%
)
if errorlevel 1 pause
