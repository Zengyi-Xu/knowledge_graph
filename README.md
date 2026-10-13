# 知识图谱

当前 v0.3.2 提供可直接使用现有本地笔记库的网页入口：双击 `启动网页端.cmd`，
或按 [本地网页端说明](docs/LOCAL_WEB.md) 启动。旧桌面 release 的排查记录见
[启动与数据验证记录](docs/STARTUP_0.3.2.md)。

本地优先的 Markdown 笔记 + 知识图谱应用。笔记之间用 `[[双链]]` 关联，在图谱视图里
把「谁做过什么、一个问题牵涉哪些工作」看成一整张网。

Windows 桌面版（Electron）提供**免安装 exe**与安装程序；笔记以「每篇一个 `.md` +
一个 `meta.json` 索引」存在你自己选的目录里，可以直接用 Obsidian 打开。

## 功能

- **笔记 / 图谱 / 并列** 三种布局，可互相跳转
- 五种笔记类型：人物、项目、技能、学习、其他（各有专属颜色，按类型分文件夹）
- `[[双链]]`（输入 `[[` 自动补全）、`#标签`、Markdown 渲染、表格、上下标
- 图谱支持按 **类型 / 年级 / 标签** 组合筛选；标签按 `前缀:` 分组，组内「或」、跨组「与」
- 单击节点选中、再次单击打开笔记；右键聚焦，按到焦点的跳数逐层虚化
- **图谱力参数可调**：节点斥力、双链引力、连线长度、中心聚集四根滑杆 +
  紧凑 / 标准 / 宽松 / 极散预设，参数本地记忆，改完可一键「重新布局」
- 桌面版支持**双向同步文件**（本地改动写回 JSON，外部改动拉进应用；两边同时改会弹冲突对比）
- 阅读主题可选内置主题，或导入 Typora `.css`
- **文献库**（Zotero 核心能力）：
  - 新增「文献」笔记类型与文献视图：表格排序 / 搜索，DOI（CrossRef/DataCite）与
    arXiv 一键导入元数据，BibTeX / RIS 粘贴批量导入（citekey 自动生成、撞名追加后缀）
  - 复制引用：**GB/T 7714-2015**（国标顺序编码制）/ **APA** / BibTeX 三种格式
  - PDF 附件（仅桌面版）：应用内阅读（翻页 / 缩放 / 搜索），**划词高亮标注**存在
    vault 的 `attachments/` 里，评论与「导出到笔记」；浏览器版显示降级提示
  - **插入 Word 引用**：复制 RTF 域代码（`ADDIN ZOTERO_ITEM`，与 Zotero 兼容），
    粘进 Word 是可更新的真实域（Alt+F9 可见域代码）；一键复制参考文献表

## 安装

在 [Releases](https://github.com/Zengyi-Xu/local-note-graph/releases) 页面下载：

| 文件 | 用途 |
| --- | --- |
| `知识图谱-Portable-<版本>-x64.exe` | 免安装，双击启动 |
| `知识图谱-Setup-<版本>-x64.exe` | 安装后从桌面 / 开始菜单启动 |

安装包没有代码签名，Windows 可能显示安全提示；请核对下载来源与发布页里的校验值。

免安装 ≠ 笔记跟着 exe 走：exe 只是程序，笔记在你选择的 vault 目录里。

## 笔记存在哪

- **桌面版**：你选的 vault 目录，每篇一个 `.md`（frontmatter 存元数据）+ 根目录一个
  `meta.json` 索引；`md` 是唯一事实来源，`meta.json` 丢了也能靠 md 完整还原。
  文献笔记的 PDF 附件与划词标注存在 `attachments/` 子目录里。
  目录里不属于本应用的 md 不会被读写，只会显示「另有 N 个未纳管 md」。
- **浏览器版 / 尚未选择目录时**：浏览器 `localStorage`。
- 跨机器迁移：用顶栏的导出 / 导入 JSON，或桌面版的同步文件。

> 本仓库**不含任何笔记数据**。`public/notes.json`、vault 目录、导出的 JSON 快照都被
> `.gitignore` 排除，打包时也不会进入 exe。请不要把真实笔记提交到公开仓库。

## 开发环境和正式环境是分开的

这是有意的设计，避免开发时误改正式数据：

| | 开发版 | 正式版（打包后的 exe） |
| --- | --- | --- |
| 谁在用 | `npm run dev`（浏览器）、`npm run desktop:dev` | Releases 里的 exe |
| 前端产物 | `dist-dev/` | `dist/` |
| Electron `userData` | `%APPDATA%/知识图谱-dev` | `%APPDATA%/知识图谱` |
| localStorage 键 | `kg-dev-*` | `kg-*` |
| DevTools | 允许 | 关闭（被打开也会立即关掉） |
| 窗口标题 | `知识图谱（开发版）`（页面无法覆盖） | `知识图谱` |
| 界面角标 | 橙色「开发版」 | 版本号 |

两套 `userData` 分开后，开发版的 localStorage（含 vault 目录、同步路径）永远写不到正式版，
反之亦然；开发版也不会继承正式版的历史键。细节见
[docs/ENVIRONMENTS.md](docs/ENVIRONMENTS.md)。

## 每次改动都留一个版本

```bash
npm run release:portable
```

会依次：类型检查 + 生产构建 → 打一个免安装 exe → 在 `release/v<版本>/` 下写
`MANIFEST.json`（版本、git commit、构建时间、exe 的 SHA-256）并追加 `CHANGELOG.md`。

历史版本不会被覆盖，`release/` 因此就是「每次编辑都留档」的目录。发布流程见
[docs/RELEASE.md](docs/RELEASE.md)。

## 常用命令

```bash
npm ci                       # 安装依赖
npm run dev                  # 浏览器开发服务器（http://localhost:3000）
npm run dev:desktop          # 开发版桌面应用：构建到 dist-dev/ 后启动 Electron
npm run build                # 生产构建到 dist/
npm run desktop:pack         # 免安装 exe（release/v<版本>/）
npm run desktop:installer    # Windows 安装程序
npm run desktop:dist         # 上面两个都打
npm run release:portable     # 推荐：构建 + 免安装 exe + 记录校验值
npm run test:vault           # vault 存储格式 / 增量写盘自测
npm run test:md              # Markdown 渲染自测
```

技术栈：React 19 + TypeScript + Vite + Tailwind CSS + shadcn/ui + Electron。

## 说明

- 源码更新不会更新已下载的旧 exe，请用新版本重新打包 / 下载。
- `npm run build`（生产）只刷新 `dist/`，`release/` 里的历史 exe 不受影响。
- vault 内部格式与键名细节见 [docs/VAULT_FORMAT.md](docs/VAULT_FORMAT.md)。
