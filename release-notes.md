Windows + macOS + Linux 三端桌面版；Windows 安装包与免安装网页包同步发布。

## 本次更新

- **研究追问助手**：点「完成笔记 · 研究追问」，基于当前笔记内容生成 3 个有针对性的研究问题
  （概念澄清 / 证据核查 / 方法审查 / 边界与反例 / 知识连接 / 下一步行动，每题附一句「为什么值得问」）。
  回答先存为草稿，确认后才插入笔记；本地问题库在 sidecar 里逐步学习你的偏好。默认走本地模型
  （ollama 路由，可配置），不出本机。
- **主题分组**：每篇笔记可以归一个主题，落盘就是 `主题:<名称>` 标签；侧栏在「按类型 / 按主题」
  两种分组间切换。命令行 `npm run topics:suggest` 生成主题建议（先 dry-run 看清单），
  `npm run topics:apply` 才写盘。
- **关系与大纲抽屉**：标题栏链环按钮打开右侧抽屉——**反向链接**（谁用 `[[标题]]` 引了这篇）、
  **本文大纲**（点击跳转）、**缺失链接**（正文提到但没有的笔记）。
- **搜索增强**：覆盖标题 / 正文 / 标签，结果里显示命中处前后一小段正文并高亮关键词。
- **新启动面板（Windows 网页包）**：双击 `启动知识图谱.pyw` 打开小型面板——服务状态灯、
  启动 / 停止 / 打开知识图谱 / 查看日志；关闭窗口只是最小化，「退出」才停止本次启动的服务。
  由 Python 3 无窗口运行，不再经过 Windows Script Host；Node 仍随包附带。排错时改用
  `启动知识图谱.cmd`（保留命令窗口，关窗即停）。
- 其余为图谱、文献表、引用列表、移动端的细节修正。

## 下载

| 平台 | 文件 |
| --- | --- |
| Windows x64 | `KnowledgeGraph-1.2.7-win-x64.exe` |
| macOS Apple 芯片（M 系列） | `KnowledgeGraph-1.2.7-mac-arm64.dmg` |
| macOS Intel | `KnowledgeGraph-1.2.7-mac-x64.dmg` |
| Linux arm64（树莓派 64 位） | `KnowledgeGraph-1.2.7-linux-arm64.deb` / `KnowledgeGraph-1.2.7-linux-arm64.AppImage` |

Windows x64 仍可继续用免安装网页包；三端安装包与网页包读写同一份 vault，升级应用不会迁移或覆盖笔记。

## 升级

- **macOS**：先完全退出旧版（⌘Q）→ 打开新 dmg → 把 `KnowledgeGraph` 拖进「应用程序」→
  弹出「已存在」时选「替换」。笔记库（默认 `~/Documents/知识图谱`）与设置
  （`~/Library/Application Support/KnowledgeGraph`）都在 App 之外，替换 App 不会动它们。
  应用未做 Apple 签名/公证：首次打开被拦时右键 App →「打开」；若提示「已损坏」，
  执行 `xattr -cr /Applications/KnowledgeGraph.app` 再打开。
- **Windows**：直接运行新的 `KnowledgeGraph-1.2.7-win-x64.exe` 覆盖安装。
  免安装网页包：解压新 ZIP 覆盖旧目录即可；启动方式从 `启动知识图谱.wsf` 换成
  双击 `启动知识图谱.pyw`（需要 Python 3；`启动知识图谱.cmd` 是窗口版）。
- **Linux**：`sudo apt install ./KnowledgeGraph-1.2.7-linux-arm64.deb`，或替换旧的 AppImage。

## 数据目录

- Linux / macOS 默认笔记库：`~/Documents/知识图谱`；Zotero 库默认读 `~/Zotero/zotero.sqlite`。
- Windows 笔记库由界面里选择，默认读同目录下的 vault；桌面版与网页包共用。
