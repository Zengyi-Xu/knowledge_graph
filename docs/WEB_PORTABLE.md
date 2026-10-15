# 知识图谱免安装网页端

适用于 Windows x64。压缩包已附带 Node 与 SQLite，不需要安装 Node、npm、Electron 或管理员权限。

## 第一次使用

1. 从 GitHub 最新 Release 下载 `knowledge-graph-web-1.2.0-windows-x64.zip`。
2. 完整解压到一个可写的固定文件夹，不能直接在压缩包内运行。
3. 双击 `启动知识图谱.cmd`，默认浏览器打开 `http://127.0.0.1:4173`。
4. 保留命令窗口；关闭窗口或按 Ctrl+C 可停止服务。

首次启动使用程序文件夹中的 `data/vault` 保存笔记。顶栏可选择已有笔记目录；配置文件中也可以设置固定路径。
程序本体可分享给其他人；分享前不要把自己的 `data` 文件夹或个人配置一起发出。

## Zotero、PDF 与已有笔记

编辑 `配置.json` 后重启程序。例如（请替换为自己的路径）：

```json
{
  "vaultDir": "D:/MyNotes",
  "zoteroDb": "C:/Users/YourName/Zotero/zotero.sqlite",
  "pdfRoots": ["D:/Papers"],
  "port": 4173,
  "openBrowser": true
}
```

留空 `zoteroDb` 时尝试查找当前用户的默认 Zotero 库；数据库只读访问。
Zotero storage 自动授权，其他本地 PDF 目录加入 `pdfRoots` 后即可在内置阅读器打开。
没有 Zotero 也能使用普通笔记、图谱与手动文献记录。

## 更新和常见问题

- 更新时先停止旧服务，再将新版本解压到新文件夹。保留旧 `data/vault`，在新 `配置.json` 中指向它，或复制自己的笔记目录和配置；不要用空目录覆盖笔记。
- 已运行同端口服务时会打开已有服务。如需另开一份应用，将 `port` 改为其他未占用端口。
- 浏览器设置按浏览器和端口分别保存；笔记正文仍是本地 Markdown 文件。
- 如果浏览器显示旧界面，按 Ctrl+F5 强制刷新。请先关闭旧桌面版，避免旧版本回写不认识的字段。
- 这是本地网页，不是公共在线站点。`127.0.0.1` 只在本机有效。
- 普通笔记、PDF 和图谱在本机工作；在线文献检索、DOI/arXiv 导入和配置后的 AI 功能需要网络。

校验下载文件时可运行 `Get-FileHash <ZIP文件> -Algorithm SHA256`，与 Release 的 `SHA256SUMS.txt` 比较。

## 开发者重打包

先运行 `npm run build`，再运行 `npm run release:web`。打包脚本复用 `dist`，不重复构建。
可用 `--node <node.exe>` 和 `--node-license <LICENSE>` 指定要随包分发的 Node 及对应官方许可证。
构建清单记录应用版本、Node 版本、平台、源码提交和文件哈希。
