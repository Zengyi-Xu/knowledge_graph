Windows + macOS + Linux 三端桌面版；Windows 安装包从这一版起恢复发布。

## 本次更新

- **PDF 阅读器**：连续滚动 / 单页 / 双页对开三种浏览模式（双页可选「封面单页起」），
  键盘 PageUp/PageDown、方向键、Home/End 翻页，单页与双页下滚轮滚到页边继续滚也会翻页；
  缩放与当前页搜索照旧。
- **PDF 高亮**：同一条高亮的多个覆盖矩形合并成一条 SVG path 绘制，多行高亮在接缝处不再叠出深色横带。
- **阅读工作台的笔记栏**换成与主界面相同的所见即所得编辑器（公式、双链、表格直接可见），
  不必再来回切「编辑 / 预览」。
- **笔记**：新增「返回上一篇笔记」按钮与 `Alt+←` 快捷键；编辑器里输入 `[[` 直接弹出笔记标题补全。
- **图谱**：新增「静止停帧」开关（默认开），节点停稳后停止力模拟，长时间挂着更省电；
  拖动节点、改力参数或重新布局会自动唤醒。
- **数据安全**：Zotero 同步 / 去重 / PDF 认回 / 清理方向标签在写盘前备份成单个
  `.backups/<动作>-<时间戳>.zip`，同步盘不再逐文件上传几万个 md；包内保留原目录结构。
- **Windows**：恢复 NSIS 安装包（x64），与 macOS / Linux 同一次 tag 一起构建发布。

## 下载

| 平台 | 文件 |
| --- | --- |
| Windows x64 | `KnowledgeGraph-1.2.6-win-x64.exe` |
| macOS Apple 芯片（M 系列） | `KnowledgeGraph-1.2.6-mac-arm64.dmg` |
| macOS Intel | `KnowledgeGraph-1.2.6-mac-x64.dmg` |
| Linux arm64（树莓派 64 位） | `KnowledgeGraph-1.2.6-linux-arm64.deb` / `KnowledgeGraph-1.2.6-linux-arm64.AppImage` |

Windows x64 仍可继续用免安装网页包；三端安装包与网页包读写同一份 vault，升级应用不会迁移或覆盖笔记。

## 升级

- **macOS**：先完全退出旧版（⌘Q）→ 打开新 dmg → 把 `KnowledgeGraph` 拖进「应用程序」→
  弹出「已存在」时选「替换」。笔记库（默认 `~/Documents/知识图谱`）与设置
  （`~/Library/Application Support/KnowledgeGraph`）都在 App 之外，替换 App 不会动它们。
  应用未做 Apple 签名/公证：首次打开被拦时右键 App →「打开」；若提示「已损坏」，
  执行 `xattr -cr /Applications/KnowledgeGraph.app` 再打开。
- **Windows**：直接运行新的 `KnowledgeGraph-1.2.6-win-x64.exe` 覆盖安装。
- **Linux**：`sudo apt install ./KnowledgeGraph-1.2.6-linux-arm64.deb`，或替换旧的 AppImage。

## 数据目录

- Linux / macOS 默认笔记库：`~/Documents/知识图谱`；Zotero 库默认读 `~/Zotero/zotero.sqlite`。
- Windows 笔记库由界面里选择，默认读同目录下的 vault；桌面版与网页包共用。
