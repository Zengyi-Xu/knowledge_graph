# 知识图谱免安装网页端

适用于 Windows x64。压缩包已附带 Node 与 SQLite，不需要安装 Node、npm、Electron 或管理员权限。

## 第一次使用

1. 从 GitHub 最新 Release 下载 `knowledge-graph-web-<版本>-windows-x64.zip`（本版本即 `1.2.1`）。
2. 完整解压到一个可写的固定文件夹，不能直接在压缩包内运行。
3. 双击 `启动知识图谱.wsf`，默认浏览器打开 `http://127.0.0.1:4173`。桌面**不会出现命令窗口**：
   它是 Windows Script Host 脚本，把输出写进 `data/temp/web-server.log` 后以隐藏窗口运行服务；起不来时会弹提示框并附上日志末尾。
4. 关闭服务：双击 `停止知识图谱.wsf`（本机所有知识图谱本地服务进程都会停）。
   想看实时输出、或 `.wsf` 被安全软件拦住排查时，双击 `启动知识图谱.cmd`（窗口版，行为与以前一致，关窗口即停止）。

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

- 更新时先双击 `停止知识图谱.wsf` 停止旧服务，再将新版本解压到新文件夹。保留旧 `data/vault`，在新 `配置.json` 中指向它，或复制自己的笔记目录和配置；不要用空目录覆盖笔记。
- 已运行同端口服务时会打开已有服务。如需另开一份应用，将 `port` 改为其他未占用端口。
- `.wsf` 是 Windows 自带的脚本格式（Windows Script Host）。刚下载的 ZIP 解压后首次双击 `.wsf` 时，
  Windows 可能弹一次「是否运行 / 发布者未知」的安全提示，选「运行」即可（同一台机器只问一次）。
  个别企业策略会禁用脚本宿主，这种情况下改双击 `启动知识图谱.cmd`：功能一样，只是会保留一个命令窗口。
- 浏览器设置按浏览器和端口分别保存；笔记正文仍是本地 Markdown 文件。
- 如果浏览器显示旧界面，按 Ctrl+F5 强制刷新。请先关闭旧桌面版，避免旧版本回写不认识的字段。
- 若 Windows 弹出 `node.exe` 错误 `0xc0000142`，先把整个目录移到不含中文的短路径（例如 `D:\KnowledgeGraph`）再启动；不要只移动 `node.exe`。
  这个错误码表示 DLL 初始化失败，除了路径，**目录本身的权限/受控状态**也会触发（企业安全软件、受控文件夹访问、
  受限沙箱或只允许读取的盘）。判别方法：把 `runtime\node.exe` 复制到 `%TEMP%` 下执行 `--version`；
  能打印版本号说明文件本身没坏，问题在原来那个目录，换个可执行目录解压即可（不必重装、也不必换版本）。
- 这是本地网页，不是公共在线站点。`127.0.0.1` 只在本机有效。
- 普通笔记、PDF 和图谱在本机工作；在线文献检索、DOI/arXiv 导入和配置后的 AI 功能需要网络。

校验下载文件时可运行 `Get-FileHash <ZIP文件> -Algorithm SHA256`，与 Release 的 `SHA256SUMS.txt` 比较。

## 开发者重打包

先运行 `npm run build`，再运行 `npm run release:web`。打包脚本复用 `dist`，不重复构建。
可用 `--node <node.exe>` 和 `--node-license <LICENSE>` 指定要随包分发的 Node 及对应官方许可证。
构建清单记录应用版本、Node 版本、平台、源码提交和文件哈希。

同一版本要重新打包（本地验收）时加 `--replace`：已有目录包与 ZIP 会改名为 `*.superseded-<时间戳>` 保留，
不会删除；脚本始终拒绝把含 `data/` 的目录打成 ZIP，避免把用户笔记发出去。
