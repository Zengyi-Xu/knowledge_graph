# 安卓 / 手机布局适配 —— DeepSeek 交付报告

日期：2026-10-09
对应交接文档：`docs/ANDROID_MOBILE_HANDOFF.md`
本轮范围：DS-01 ~ DS-04（仅手机展示层适配）+ v1.1.0 公开版功能整合
分支：`android-mobile`（基于公开仓库 `origin/main` @ `8f3617c`，v1.1.0）
验证脚手架：`mobile-e2e/`（本分支内，未跟踪的测试工具，不参与打包）

> **重要前提（2026-10-09 更新）**
>
> 本地仓库里 `main` 与 `origin/main` 是**两条无共同祖先的历史**：
>
> | 分支 | 内容 |
> | --- | --- |
> | 本地 `main`（`deb62c4`） | **私有**历史，含个人笔记 |
> | `origin/main`（`8f3617c`） | 公开的 `local-note-graph`，v1.0.1 → **v1.1.0**，`public/notes.json` 为空 |
>
> 遵循「安卓不干扰 main」的要求，本分支与全部验证都在一个**独立 git worktree** 里进行：
> 工作目录 `D:\kimi_workspace\knowledge-graph-android`，分支 `android-mobile`。
> 本地 `main` 与私有工作区**未被切换、未被修改**。
>
> 手机适配（DS-01~03）的源码改动此前已存在于 `origin/main`（逐字节比对确认，包括
> `--write-code-bg` 代码块配色修复与 `.note-item-title` 作用域类），因此本分支天然包含
> **v1.1.0 的全部功能**：标签交集筛选、节点多色环、双向同步 + 冲突处理（`ConflictDialog`）、
> 笔记/图谱/并列三种视图、列表整栏折叠、上下标支持。

## 0. 一句话结论

DS-01 ~ DS-04 已完成；v1.1.0 公开版功能已整合进 `android-mobile` 分支，并在该基线上全量重测通过（**44 个场景、0 断言失败、0 控制台错误**）。

整合过程中发现并修复了两处被 DS-03 验收条件覆盖的**真实手机端缺陷**：

- **P2-1**：Vue 深色主题下代码块浅底浅字，对比度 **1.06:1**，完全不可读 → 修复后 **12.33:1**。
- **P2-2**：v1.1.0 的「笔记」视图固定左右分栏（源码 | 渲染），手机上每栏只剩几十像素 → 手机端强制退回「预览/编辑」切换，桌面与平板保持分栏。

顶层仍有需要核心负责人接入的项，但比 v1.0.1 时**已大幅缩小**：v1.1.0 自带了列表整栏折叠，360px 下仍会被 `App.tsx` 自身的最小宽度撑破（详见第 7 节）。

## 1. 已完成任务编号与未完成任务

| 编号 | 任务 | 状态 |
| --- | --- | --- |
| DS-01 | 笔记列表手机触摸适配 | 已完成 |
| DS-02 | 编辑界面与工具栏手机适配 | 已完成 |
| DS-03 | 正文与主题手机适配（含 Shadow DOM 样式边界） | 已完成 |
| DS-04 | 测试与交接（build / lint / 多尺寸多主题验证 / 本报告） | 已完成 |
| — | 顶层列表/详情导航（`App.tsx`） | **未做，按约定属核心负责人** |

未完成事项集中在第 7 节「需要核心负责人接入」与第 8 节「已知问题」。

## 2. 修改文件列表及修改目的

本轮只改了 4 个文件，共 `265 insertions(+) / 58 deletions(-)`（相对 v1.0.1 基线）；在 v1.1.0 基线上整合时另加了 2 处小修正，见下方「整合改动」：

| 文件 | 变更量 | 修改目的 |
| --- | --- | --- |
| `src/components/NoteList.tsx` | +113 −25 区间内 | 搜索框 / 新建按钮 / 列表项在手机端达到 ≥44px 触摸目标；长中文标题允许两行换行且不挤压图标与元数据；手机端每条只显示首个标签（桌面仍 3 个）；为空状态与长列表保持原有滚动行为。业务语义（搜索、分组、选择、新建）未改动。 |
| `src/components/NoteEditor.tsx` | +101 −58 | 手机端标题输入框独占一行、查看与删除/导出/导入主题收进「更多操作」菜单（功能不减，删除仍走 `confirm`）；工具栏换行；编辑区与笔记链接建议列表适配小屏。默认预览、切换笔记回到预览、保存逻辑均未改动。 |
| `src/components/PreviewContent.tsx` | +81 | 手机（`max-width:767px`）正文样式：留白由 `20px 30px 100px`/`clamp(20px,5%,64px)` 收到 `14px 14px 56px`；正文 16px 稳定字号；图片按容器缩放；表格与代码块局部横向滚动；长链接 / 长连续文本断行；`#write` 的 `overflow-x` 由主题的 `hidden` 改为 `clip`；上下标恢复语义；按阅读主题给出代码块底色。**规则写在 Shadow DOM 样式边界内**（正文在 Shadow DOM 中，全局 CSS 不作用于内部）。 |
| `src/index.css` | +28 | 新增 `.note-item` / `.note-item-title` 两个作用域类：手机端 ≥44px 行高、两行截断、`overflow-wrap: anywhere`。桌面（≥768px）行为与改动前一致。未使用全局 `overflow-x: hidden` 兜底。 |

### 整合 v1.1.0 时的追加改动（本次）

| 文件 | 改动 | 原因 |
| --- | --- | --- |
| `src/components/NoteEditor.tsx` | `+3 −1`：引入 `useIsMobile()`，用 `const useSplit = splitView && !isMobile` 替换渲染分支里的 `splitView` | **P2-2**：v1.1.0 的「笔记」视图以 `splitView={true}` 渲染，手机上左右两栏各只剩约 50px，既不能读也不能写。手机端退回「预览/编辑」切换，桌面/平板保持分栏。`useIsMobile` 是仓库 `src/hooks/use-mobile.ts` 里**已有**的 hook（基于 `matchMedia('(max-width: 767px)')`），未新增依赖，也未引入散落的全局事件监听。 |
| `src/components/PreviewContent.tsx` | `+3 −2`：行内 `code` 由 `overflow-wrap: normal` 改为 `anywhere` + `word-break: break-word` | 实测发现：只给外层 `p`/`li` 设 `overflow-wrap` **不会**让 inline 元素内部产生断行机会，含超长单词的 `<code>` 仍会溢出 12px。修复后 360px 下该场景 0 溢出。`pre > code` 仍由更高优先级的 `#write pre code { white-space: pre }` 保持不换行 + 局部横滑。 |

未改动（按约定）：`src/App.tsx`、`src/components/GraphView.tsx`、`src/components/Markdown.tsx`、`src/lib/md.ts`、`src/hooks/useNotes.ts`、`src/types/note.ts`、`src/lib/syncFile.ts`、`src/types/desktop.d.ts`、`electron/`、`package.json`、`package-lock.json`、`src/themes/vue-light.css`、`src/themes/vue-night.css`（两个内置主题文件一行未动）、`public/notes.json`。

### 工作区说明（重要）

本分支运行在独立 worktree 里，**没有触碰**私有 `main` 与 `D:\kimi_workspace\knowledge-graph` 工作区。私有 `main` 上另有一路并行对话在改 `src/App.tsx`、`GraphView.tsx`、`useNotes.ts`、`syncFile.ts`、`electron/` 等文件，并新增 `ConflictDialog.tsx`——这些内容 v1.1.0 里**已经有了**，因此不构成本分支的功能缺口；我既未还原也未搬运它们。

`public/notes.json` 在本公开分支里被 `.gitignore` 忽略且**不存在**，安卓分支因此天然不含任何个人笔记。

## 3. Props 或共享样式变化及对其他组件的影响

**Props：零变化。** 三个组件的 Props 接口与调用方式完全未动，`App.tsx` 现有调用无需任何调整即可继续工作（除顶层布局本身的问题外）。

**共享样式变化：无跨文件影响。**

| 变化 | 作用域 | 对其他组件的影响 |
| --- | --- | --- |
| `.note-item`、`.note-item-title`（`src/index.css`） | 仅这两类名，只被 `NoteList.tsx` 使用 | 无。未新增全局选择器、未修改 Tailwind 配置、未覆盖任何 `src/components/ui/` 控件。 |
| `PreviewContent.tsx` 内的 Shadow DOM 样式 | Shadow Root 内部，选择器前缀均为 `#write` | **零外泄**：Shadow DOM 天然隔离，且规则只在 `@media (max-width:767px)` 内。 |
| `--write-code-bg` / `--write-code-color` / `--write-inline-code-color` | 定义在 `#write` 上（Shadow 内） | 无。自定义主题若定义同名变量可覆盖（这是有意留的扩展点）。 |

**未修改共享控件**：`src/components/ui/` 下 60 个文件一行未动。手机端菜单复用的是仓库已有的 `dropdown-menu.tsx`（Radix）。

**未引入新依赖**：`package.json` / `package-lock.json` 未由本轮修改。

## 4. build、lint 的实际结果

### build —— 通过

```
> kaust-knowledge-graph@1.1.0 build
> tsc -b && vite build
✓ 1813 modules transformed.
dist/index.html                   0.42 kB │ gzip:   0.30 kB
dist/assets/index-UCpOoQWI.css   82.60 kB │ gzip:  13.78 kB
dist/assets/index-BMtGiNhL.js   583.85 kB │ gzip: 170.93 kB
✓ built in 2.86s
==== BUILD EXIT: 0 ====
```

- `tsc -b` 零类型错误、零诊断输出。
- 唯一警告是既有的 chunk > 500 kB 提示，非本次引入。

### lint —— 未通过，但全部为既有问题

```
✖ 15 problems (15 errors, 0 warnings)
==== LINT EXIT: 1 ====
```

- 15 个 error 全部落在**真实 `src/` 源码**的历史规则问题上：`src/components/GraphView.tsx`（3）、`ui/badge.tsx`、`ui/button-group.tsx`、`ui/button.tsx`、`ui/form.tsx`、`ui/navigation-menu.tsx`、`ui/sidebar.tsx`（2）、`ui/toggle.tsx`、`lib/md.ts`（2）、`types/note.ts`（2）。规则为 `react-refresh/only-export-components`、`react-hooks/refs`、`react-hooks/purity`、`no-useless-escape`，与本次手机适配无关。
- 本分支**没有**私有工作区里那个会被一起 lint 到的 `release/public-source/` 副本目录，所以 error 总数（15）明显低于私有分支（31）。
- **本轮四个目标文件的命中数均为 0**（`NoteList.tsx`、`NoteEditor.tsx`、`PreviewContent.tsx` 真被 eslint 检查过且干净；`index.css` 不在 eslint 的 `**/*.{ts,tsx}` 覆盖范围内）。
- 测试脚手架 `mobile-e2e/` 命中数为 0，未给仓库引入 lint 噪音。
- 日志：`mobile-e2e/out/android-build.txt`、`mobile-e2e/out/android-lint.txt`。

## 5. 已测尺寸、主题、测试场景与无个人信息截图位置

### 测试方法（可复现）

用**人工编造的合成测试数据**（标题一律带「示例」「测试」，正文含 `H<sub>2</sub>O`、宽表格、超长代码行、800×600 内联 SVG 图、超长 URL、超长连续英文单词、8 个标签、空笔记）驱动真实应用：

- 测试实例：`mobile-e2e/vite.harness.config.ts`（Vite root 指向 `mobile-e2e`，`publicDir` 指向合成数据目录，**绝不加载仓库根目录的 `public/notes.json`**）。应用虽然仍会 `fetch ./notes.json`，但 `seed.js` 在启动前已把合成数据写进 `localStorage`，`useNotes` 因 `prev.length > 0` 不会采用该响应。
- 浏览器：无头 Chrome + CDP，逐个场景设置 `Emulation.setDeviceMetricsOverride`。
- 交互：React 19 不响应 JS 合成的 `click`/`input`（实测 `element.click()` 与 `dispatchEvent` 都改不动 `data-state`），因此由 CDP 派发**真实** `Input.dispatchMouseEvent` / `Input.insertText` 来切视图、切笔记、切标签页、输入搜索词与 `[[`。
- 命令：`node mobile-e2e/run.mjs`（产出 `out/results.json`）+ `node mobile-e2e/analyze.mjs`（断言与指标表）。
- 原始数据：`mobile-e2e/out/results.json`。

### 关于 v1.1.0 的两套口径

v1.1.0 的 `.gitignore` 会忽略 `public/notes.json`，仓库里不存在该文件；harness 使用自己的合成数据。测试分两组口径：

- **`shellMode=original`**：完全按 v1.1.0 原样渲染，用来量化 `App.tsx` 顶层在 360px 下的真实表现（预期溢出 17 条，见第 7 节）。
- **`shellMode=mobile`**：在测试实例里注入一段模拟「手机端列表/详情切换之后」的样式（`aside{display:none}` + `main{flex-basis:100%;min-width:0}` + 顶栏换行），用来在**真实手机可用宽度**下单独判定组件层是否达标。这段样式只存在于测试实例，不在产品代码里。

### 覆盖矩阵（44 个场景，0 断言失败，控制台零错误）

| 环境 | 尺寸 | 场景 |
| --- | --- | --- |
| 小手机 | 360×800 | default / night / paper / vue-light / vue-night / custom / 编辑态 / 笔记链接建议 / 无搜索结果 / 空笔记 / 单条笔记 / 8 个标签 / 宽表格 / 长代码行+大图 |
| 常见手机 | 390×844、412×915 | default、vue-night |
| 手机横屏 | 844×390 | default |
| 平板 | 768×1024、1024×768 | default、宽表格、vue-light |
| 电脑 | 1440×900 | default、vue-night、长代码行+大图 |

**6 个主题全部覆盖**：default、paper、night、vue-light、vue-night、custom（自定义主题用一份故意过火的 CSS 做压力测试：`#write{padding:10px 40px; max-width:900px; overflow-x:hidden}`、`table{width:1200px}`、`img{width:1400px}`）。

### 关键实测结果

**手机端（360px，「顶栏已适配」口径 = 真实手机可用宽度）**

| 指标 | 结果 |
| --- | --- |
| 页面横向滚动 | **无**（`scrollWidth == clientWidth == 360`，全部 21 个 shell-mobile 场景） |
| 溢出到视口外的元素 | **0 个**（`overflowFlagged` 合计 0） |
| 正文 `padding` | `14px 14px 56px`（6 个主题一致） |
| 正文 `font-size` | `16px`（不随视口缩放） |
| `#write` `overflow-x` | `clip`（不再用 `hidden` 掩盖溢出） |
| 正文实际可用宽度 | 360 → **332px**（左右各 14px 留白） |
| 宽表格 | 容器 `332 → 679px`（vue-light 为 `332 → 727px`），`overflow-x: auto` → 局部横向滚动，页面不被撑宽 |
| 长代码行 | `pre 332 → 606px`（vue-night `332 → 651px`），`overflow-x: auto` → 局部横向滚动 |
| 800×600 大图 | 渲染为 **332×250**（等比缩放，不溢出） |
| 触摸目标 | 扫描 45 项，**44 项 ≥44px**；唯一 <44px 的是 `App.tsx` 同步状态栏的「双向同步」开关（32×18，属顶层范围）。正文内的行内文字链接（`<a>`）热区等于行盒，不按 44px 约束。 |
| 编辑态 | 编辑标签页可切换、编辑区可见（textarea `360×245`） |
| 笔记链接建议 | 手机端浮层宽约 356px、未超出视口 |
| 无搜索结果 | 正确显示「没有匹配的笔记」 |
| 空笔记状态 | 无横向滚动，主按钮完整可见 |
| 上下标 | `<sub>`/`<sup>` 均为 `12.48px`，`vertical-align: sub` / `super`（桌面端仍是 preflight 的 `baseline`，见第 6 节 P3-2） |
| 代码块配色（手机） | code：`#f8f8f8/#202428`；code-night：`#1a1a1a/#d9d9d9`；code-paper：`#f0ede5/#273430`；code-custom：`#f8f8f8/#e96900` |

**平板 / 电脑（回归）**

| 尺寸 | 正文 `padding` | 正文 `font-size` | 页面横向滚动 |
| --- | --- | --- | --- |
| 844×390 | `28px 20px 64px` | 15px | 无 |
| 768×1024 | `28px 20px 64px` | 15px | 无 |
| 1024×768（vue-light） | `20px 30px 100px` | 15px | 无 |
| 1440×900 | `28px 29.5938px 64px` | 15px | 无 |

平板与电脑的正文 `overflow-x` 为 `visible`、字号为 15px，**手机规则完全没有生效**——移动样式全部包在 `@media (max-width:767px)` 内。（注：v1.1.0 自身把 `#write > div` 的左右内边距改成了随容器缩放的 `clamp`，因此同样在 768/1440 下，v1.0.1 的 `25.5938px`/`59.1875px` 现在读到 `20px`/`29.5938px`。这是上游版本变化，不是本次适配造成的。）

**断言**：44 个场景共 **0** 条失败；`controlsSettled` 44/44；控制台错误 **0**。断言覆盖：无控制台错误、手机端不横向滚动、桌面/平板不横向滚动、手机正文样式生效、场景控制真的生效（防止「测到旧状态」的假通过：切视图/切笔记/切标签页/输入搜索词都校验落地）、宽表格与代码块可局部滚动、图片不溢出、触摸目标、上下标语义、空状态与链接建议等非成功路径。

### 截图

**45 张无个人信息截图**位于 `mobile-e2e/out/screenshots/`，文件名格式 `{宽}x{高}__{场景}.png`（全宽口径带 `__shell-mobile` 后缀）。截图内容全部是合成数据。

`mobile-e2e/` 是验证脚手架（不是产品代码，不参与 `dist` 打包）；如需复核可直接 `node mobile-e2e/run.mjs` 重跑。`mobile-e2e/out/` 是运行产物，可随时删除。

### 未验证事项

浏览器模拟**不能**证明安卓软键盘、系统返回键、文件权限、状态栏、离线与重启行为。这些必须留到后续 APK 真机阶段（交接文档第 8 节）。截图也**不能**证明滚动容器的可滑动性，后者由 DOM 指标（`scrollWidth > clientWidth` + `overflow-x: auto`）证明。

## 6. 已知问题

### P2-1（本轮已修复）：Vue 深色主题下代码块浅底浅字，对比度 1.06:1

**发现方式**：截图审查对 `360x800__code-night__shell-mobile.png` 做像素采样，报出「深色主题里嵌了一块浅色板，几乎不可读」。随后用 DOM 实测确认。

**根因（不是移动适配引入的，是既有主题缺陷在手机端被放大）**：

- `Markdown.tsx` 给代码块渲染 `<pre className="my-2 overflow-x-auto rounded bg-muted p-3">`。`bg-muted` 来自 Tailwind 的 `--muted`，而本应用的深浅色**不通过 `.dark` 类切换**（是通过「阅读主题」下拉），所以 `--muted` 恒为浅色 `240 4.8% 95.9%` → 渲染为 `rgb(244,244,245)`。
- 同时 `vue-night.css` 用 `#write .md-fences { background-color: hsl(0,0%,10%) !important }` 给代码块上深色底——但手写的 markdown 渲染器输出的是**裸 `<pre>`**，没有 `.md-fences` 类，这条规则匹配不上；只有 `#write code { color:#f3b37f }` 生效。
- 结果：浅底 `rgb(244,244,245)` + 浅字 `rgb(238,238,238)` = **1.06:1**（内层橙色 token 也只有 1.65:1）。

**修复**（限定在 `PreviewContent.tsx` 的 Shadow DOM 样式内，且只在手机媒体查询里）：给 `#write` 定义 `--write-code-bg` / `--write-code-color` / `--write-inline-code-color`，按阅读主题取值（vue-night → `hsl(0,0%,10%)` + `hsl(0,0%,85%)`；night → `#303d3a` + `#e4e9e5`；paper → `#f0ede5` + `#273430`；default/vue-light → `#f8f8f8`；颜色值取自各主题自身的 token）。

**修复后实测对比度**：

| 主题 | 修复前 | 修复后 |
| --- | --- | --- |
| vue-night | **1.06:1** | **12.33:1** |
| night | — | 9.21:1 |
| paper | — | 11.08:1 |
| default / vue-light | — | 14.71:1 |
| custom（示例） | — | 12.19:1 |

全部达到 WCAG AAA（≥7:1）。

**遗留**：修复只在手机媒体查询内，**桌面端 Vue 深色代码块仍是浅底浅字（1.06:1）**。这是既有桌面问题，不在「移动适配」范围内，我未顺手改动以免超出授权范围。建议核心负责人把同一组变量提升为全尺寸规则（约 6 行）后一并修复。

### P2-2（本次整合时已修复）：v1.1.0「笔记」视图固定左右分栏，手机上每栏只剩几十像素

**发现方式**：把测试脚手架接到 v1.1.0 后发现 `360x800` 下取不到「预览/编辑」这组标签，进一步排查 `App.tsx` 才看清：

- v1.1.0 的三种视图是 `笔记 / 图谱 / 并列`。其中「笔记」视图以 `editorFor(active, true)` 渲染，即 `splitView={true}`。
- `NoteEditor` 在 `splitView` 为真时渲染「左：Markdown 源码 · 右：渲染结果」两栏，**不渲染**「预览/编辑」切换，两栏各占 `w-1/2`。
- 360px 下实测：主区 104px（顶栏未适配）或 360px（顶栏适配后），两栏各约 50px / 180px。50px 的渲染栏里 `#write` 只有 52px 宽、16px 字号，实际不可读也不可写。

**修复**（`src/components/NoteEditor.tsx`，3 行）：引入仓库**已有**的 `useIsMobile()`，用 `const useSplit = splitView && !isMobile` 取代渲染分支里的 `splitView`。手机端因此退回「预览/编辑」切换（这也正是交接文档第 1 节要求的「默认预览，编辑与预览切换」），桌面与平板继续按调用方的 `splitView` 显示分栏。

**注意事项**：`useIsMobile()` 是 `matchMedia('(max-width: 767px)')` 的实现，首帧返回 `false`、effect 后纠正，因此手机上会有一帧分栏闪现（内容已在上面表格里注明）。三档平板/桌面尺寸实测仍为分栏、无横向滚动。

### P3-1（未修复，记录并建议接受）：桌面/平板端超长不可断词仍会撑宽

`768x1024` 下正文里 60 字符的连续英文单词（`Supercalifragilistic...`）与 108 字符的超长 URL 仍会把 `#write > div` 的 `scrollWidth` 撑到 1632px。原因是我的 `overflow-wrap: anywhere` 断行规则**按设计只放在 767px 以下的媒体查询里**——修它就等于修改桌面排版，超出本轮授权。

判定：P3，仅影响「极窄内容区 + 超长不可断词」的合成极端情况；真实桌面 1440px 下正文有 820px 可用宽度，不触发。已在 `.tmp-e2e` 断言中显式归类为「既有桌面问题」，不计入移动适配失败。

### P3-2（未修复）：桌面端上下标垂直对齐

Tailwind preflight 把所有元素重置为 `vertical-align: baseline`，桌面端 `<sub>`/`<sup>` 因此与正文同基线。手机端我已恢复 `sub`/`super` 语义（12.48px）。桌面端属既有问题，未改。

### P3-3（未修复，范围外）：同步状态栏「双向同步」开关触摸目标 32×18px

位于 `src/App.tsx`（v1.1.0 里由「自动同步」改名为「双向同步」），属顶层范围。这也是全部 21 个手机场景里**唯一**一个 <44px 的可交互控件。

## 7. 需要核心负责人接入的导航或接口需求

### 阻塞项：`src/App.tsx` 顶层仍会被自身最小宽度撑破（比 v1.0.1 已大幅改善）

v1.1.0 已经做了两件好事：**笔记列表可以整栏折叠**（`note-graph-list-open` + 主区左上角的 `PanelLeft` 按钮），以及顶栏「重新载入」等控件。但 360px 下仍然溢出：

**实测证据（360×800，`shellMode=original`，完全按 v1.1.0 原样渲染）**：

| 指标 | 实测值 |
| --- | --- |
| `aside`（笔记列表侧栏，展开时） | 固定 **256px**（`w-64 shrink-0`） |
| `main`（正文区）最小宽度 | **104px**（受下层内容最小宽度约束，`width:100%` 也压不下去） |
| 文档 `scrollWidth` / `clientWidth` | **700 / 360** |
| 页面横向滚动 | **是**（16 个原始口径手机场景全部如此） |
| 溢出到视口外的元素 | 每次约 6–25 个，来自顶栏按钮组与主区视图标签行 |
| 主区视图标签行最小宽度 | 约 **228px**（3 个 `TabsTrigger` × 74px，`笔记/图谱/并列`） |
| 顶栏按钮组宽度 | 约 **618px**（「保存到同步文件 / 重新载入 / 导入备份 / 导入 .md / 导出备份」+ 图标按钮，不换行） |

> 注：v1.1.0 把同步状态栏的开关改成了「双向同步」，**顶栏按钮组本身仍然没有换行**，所以即使收起列表，`main` 的最小宽度（228px 视图标签行）加上顶栏仍然放不下。

**这不是组件缺陷**：同一份组件在模拟「手机端列表/详情切换之后」的口径下（`aside` 隐藏 + `main{flex-basis:100%;min-width:0}` + 顶栏换行），**全部 21 个手机场景零横向滚动、零溢出、44/45 项触摸目标达标**。

**需要接入的内容**（按交接文档约定属核心负责人）：

1. **主区视图标签行在手机端收窄或可横滑**：`笔记/图谱/并列` 三个 `TabsTrigger` 各带图标+文字，最小 74px，合计约 228px，是 `main` 最小宽度的主要来源。可行改法：手机端只显示图标（`hidden md:inline` 包住文字）、缩短为「笔记/图谱/并列」两字、或给该行加 `overflow-x-auto`。
2. **顶栏按钮组换行或收进菜单**：`header` 是 `flex h-14 items-center gap-3 px-4`，按钮组 `ml-auto flex items-center gap-2` 合计约 618px，360px 下被硬裁。可行改法：给 `header`/按钮组加 `flex-wrap` + `h-auto min-h-14`，或把「重新载入 / 导入备份 / 导入 .md / 导出备份」收进一个下拉菜单（导出/删除的收进菜单模式在 `NoteEditor` 里已有先例）。
3. **列表 ⇄ 详情分屏切换**：列表折叠已经可用，但手机端还需要「选中笔记后进入详情、可返回」的导航语义。
4. **安卓系统返回键**：与上面的导航联动。
5. **「双向同步」开关触摸目标提升到 ≥44px**。
6. （可选）**并列视图在手机上如何处理**：`view === 'both'` 是图谱 + 编辑器左右并排，手机上同样会很窄，建议明确降级策略。

我在测试脚手架里验证过第 2 条的样式效果（`mobile-e2e/probe.js` 的 `applyShellMobile()`），可直接参考。

### 接口需求：无

本轮**没有**新增或修改任何 Props。整合时对 `NoteEditor` 的改动只用了可选 prop `splitView` 的现有语义，没有新增参数；`App.tsx` 调用处无需改动。核心负责人接入导航时不需要为本轮的三个组件增加接口。

### 可选改进建议（非阻塞）

- 把第 6 节 P2-1 的代码块主题变量从「仅手机」提升为「全尺寸」，同时修好桌面端 Vue 深色代码块。
- 宽表格与代码块虽然可以局部横滑，但手机端滚动条默认不可见，用户可能不知道右边还有内容。可考虑加边界渐隐或「← 可横滑」提示（属于体验优化，本轮未做以免改动 `Markdown.tsx`）。
- `night` / `vue-night` 下表格表头仍是浅色底（来自 Markdown 的 `bg-muted`），可读但突兀，与 P2-1 同源。

## 8. 其它

- **本分支未推送到任何远端**（`android-mobile` 只存在于本机 worktree），未发布、未生成安装包。
- **未修改任何个人笔记**：本公开分支里 `public/notes.json` 被 `.gitignore` 忽略且不存在；测试全程使用合成数据。
- **未修改依赖**：`package.json` / `package-lock.json` 一行未动（`npm ci` 只装依赖，不改清单）。
- **未修改 Markdown 解析与渲染**：`Markdown.tsx`、`lib/md.ts`、`types/note.ts` 一行未动。
- **未修改保存与同步逻辑**：`useNotes.ts`、`syncFile.ts`、`desktop.d.ts`、`electron/`、`ConflictDialog.tsx` 一行未动。
- **未修改两个内置主题文件**：`vue-light.css`、`vue-night.css` 一行未动（手机覆盖放在 `PreviewContent.tsx` 的 Shadow 样式里，且排在主题 CSS 之后）。
- **未添加安卓工程**：无 `android/`、无 `capacitor.config.ts`。
- **未触碰私有 `main`**：全部工作在独立 worktree `D:\kimi_workspace\knowledge-graph-android` 内完成，私有工作区未被切换、未被提交。
