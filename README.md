# 知识图谱

当前 v1.2.1 提供附带 Node 的 Windows x64 免安装网页包：解压后双击 `启动知识图谱.wsf`（无窗口启动），无需安装 Node、npm 或 Electron。
详见 [免安装网页使用说明](docs/WEB_PORTABLE.md)；完整功能用法见 [使用手册](docs/USAGE.md)。
开发目录网页端仍可双击 `启动网页端.wsf`，
或按 [本地网页端说明](docs/LOCAL_WEB.md) 启动。

本地优先的 Markdown 笔记 + 知识图谱应用。笔记之间用 `[[双链]]` 关联，在图谱视图里
把「谁做过什么、一个问题牵涉哪些工作」看成一整张网。

推荐发行方式是 Windows x64 **免安装本地网页包**。Electron 桥仍保留给开发、自动化测试和旧接口兼容，
但不再生成或发布 EXE/安装器。笔记以「每篇一个 `.md` + 一个 `meta.json` 索引」存在你自己选的目录里，
可以直接用 Obsidian 打开。

## 功能

- **笔记 / 图谱 / 并列** 三种布局，可互相跳转
- 五种笔记类型：人物、项目、技能、学习、其他（各有专属颜色，按类型分文件夹）
- `[[双链]]`（输入 `[[` 自动补全）、`#标签`、Markdown 渲染、表格、上下标
- 图谱支持按 **类型 / 年级 / 标签** 组合筛选；标签按 `前缀:` 分组，组内「或」、跨组「与」
- 单击节点选中、再次单击打开笔记；右键聚焦，按到焦点的跳数逐层虚化
- **图谱力参数可调**：节点斥力、双链引力、连线长度、中心聚集四根滑杆 +
  紧凑 / 标准 / 宽松 / 极散预设，参数本地记忆，改完可一键「重新布局」
- 支持**双向同步文件**（本地改动写回 JSON，外部改动拉进应用；两边同时改会弹冲突对比）
- 阅读主题可选内置主题，或导入 Typora `.css`
- **文献库**（Zotero 核心能力）：
  - 新增「文献」笔记类型与文献视图：表格排序 / 搜索，DOI（CrossRef/DataCite）与
    arXiv 一键导入元数据，BibTeX / RIS 粘贴批量导入（citekey 自动生成、撞名追加后缀）
  - 复制引用：**GB/T 7714-2015**（国标顺序编码制）/ **APA** / BibTeX 三种格式
  - PDF 阅读工作台：从文献表点 PDF 徽标进入全屏双栏阅读，左侧翻页 / 缩放 / 搜索，
    右侧编辑或预览文献笔记；选中 PDF 原文可建立页码链接，点笔记中的链接可跳回原文
  - PDF 标注存在 vault 的 `attachments/` 里；也可随时改用系统 PDF 阅读器
  - **插入 Word 引用**：复制 RTF 域代码（`ADDIN ZOTERO_ITEM`，与 Zotero 兼容），
    粘进 Word 是可更新的真实域（Alt+F9 可见域代码）；一键复制参考文献表

## 安装

在 [最新 Release](https://github.com/Zengyi-Xu/knowledge_graph/releases/latest) 页面下载：

| 文件 | 用途 |
| --- | --- |
| `knowledge-graph-web-<版本>-windows-x64.zip` | 唯一推荐：附带 Node，解压后双击启动网页 |

发布页同时提供 SHA-256；下载后可按 [免安装网页使用说明](docs/WEB_PORTABLE.md) 校验。
免安装不等于笔记跟着程序走：笔记仍在你选择的 vault 目录里。

## 笔记存在哪

- **本地网页端**：你选的 vault 目录，每篇一个 `.md`（frontmatter 存元数据）+ 根目录一个
  `meta.json` 索引；`md` 是唯一事实来源，`meta.json` 丢了也能靠 md 完整还原。
  文献笔记的 PDF 附件与划词标注存在 `attachments/` 子目录里。
  目录里不属于本应用的 md 不会被读写，只会显示「另有 N 个未纳管 md」。
- **普通浏览器开发版 / 尚未选择目录时**：浏览器 `localStorage`。
- 跨机器迁移：用顶栏的导出 / 导入 JSON，或同步文件。

> 本仓库**不含任何笔记数据**。`public/notes.json`、vault 目录、导出的 JSON 快照都被
> `.gitignore` 排除，打包白名单也会拒绝它们进入共享 ZIP。请不要把真实笔记提交到公开仓库。

## 开发环境和发布环境

这是有意的设计，避免开发时误改正式数据：

| | 开发版 | 发布版（本地网页包） |
| --- | --- | --- |
| 谁在用 | `npm run dev`（浏览器）；必要时 `npm run desktop:dev` 验证兼容层 | 解压 ZIP 后双击 `启动知识图谱.wsf`（无窗口；`启动知识图谱.cmd` 是窗口版） |
| 前端产物 | Vite 开发服务；兼容测试使用 `dist-dev/` | `dist/` + 本地服务 + 随包 Node |
| 数据 | 使用专门的测试 vault | 用户明确选择的 vault |
| localStorage 键 | `kg-dev-*` | `kg-*` |

开发时不要选择真实 vault；旧桌面 EXE 已退出发行路线，也不应再用于真实数据。细节见
[docs/ENVIRONMENTS.md](docs/ENVIRONMENTS.md)。

## 打包发布

```bash
npm run build
npm run release:web
```

先完成类型检查和生产构建，再生成 `release/web-v<版本>/` 下的目录包、ZIP、`MANIFEST.json`
和 `SHA256SUMS.txt`。发布流程见
[docs/RELEASE.md](docs/RELEASE.md)。

## 常用命令

```bash
npm ci                       # 安装依赖
npm run dev                  # 浏览器开发服务器（http://localhost:3000）
npm run desktop:dev          # 仅验证冻结的 Electron 兼容层，不用于发布
npm run build                # 生产构建到 dist/
npm run release:web          # 推荐：生成 Windows x64 免安装网页包与校验值
npm run test:web             # 本地网页桥回归
npm run test:vault           # vault 存储格式 / 增量写盘自测
npm run test:md              # Markdown 渲染自测
```

技术栈：React 19 + TypeScript + Vite + Tailwind CSS + shadcn/ui；Electron 暂留为冻结兼容层。

移动端下一阶段以复用现有网页资源的 Capacitor Android 壳为方向，先完成导航、存储、备份、
文件权限与真机验证，再讨论 APK 正式发布；详见 [移动端交接](docs/ANDROID_MOBILE_HANDOFF.md)。

## 说明

- 源码更新不会更新已下载的网页包；请重新构建并下载新 ZIP。
- `npm run build` 只刷新 `dist/`，`npm run release:web` 才生成新的分享包。
- vault 内部格式与键名细节见 [docs/VAULT_FORMAT.md](docs/VAULT_FORMAT.md)。
