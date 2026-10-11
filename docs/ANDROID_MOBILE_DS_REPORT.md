# 安卓 / 手机布局适配 —— DeepSeek 交付报告

日期：2026-10-09
对应交接文档：`docs/ANDROID_MOBILE_HANDOFF.md`
本轮范围：DS-01 ~ DS-04（仅手机展示层适配）

## 0. 一句话结论

DS-01、DS-02、DS-03 已完成并自测通过；DS-04 的构建、lint、多尺寸多主题自动化验证已完成。
**但存在一个必须先处理的阻塞项（本报告第 7 节）：`src/App.tsx` 的顶层布局没有手机适配，导致 360px 宽时正文可用宽度只有 104px，手机端实际上不可用。**该文件按交接文档约定「本轮只阅读」，因此我实现并自测了组件层适配、量化了顶层阻塞并给出可直接接入的最小改法，但**未**修改它。

另外发现并修复了一个交接文档未预见、但被 DS-03 验收条件（「全部主题在手机可阅读」）覆盖的真实缺陷：Vue 深色主题下代码块是浅底浅字，对比度 1.06:1，完全不可读。详见第 6 节 P2-1。

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

本轮只改了 4 个文件，共 `265 insertions(+) / 58 deletions(-)`：

| 文件 | 变更量 | 修改目的 |
| --- | --- | --- |
| `src/components/NoteList.tsx` | +113 −25 区间内 | 搜索框 / 新建按钮 / 列表项在手机端达到 ≥44px 触摸目标；长中文标题允许两行换行且不挤压图标与元数据；手机端每条只显示首个标签（桌面仍 3 个）；为空状态与长列表保持原有滚动行为。业务语义（搜索、分组、选择、新建）未改动。 |
| `src/components/NoteEditor.tsx` | +101 −58 | 手机端标题输入框独占一行、查看与删除/导出/导入主题收进「更多操作」菜单（功能不减，删除仍走 `confirm`）；工具栏换行；编辑区与笔记链接建议列表适配小屏。默认预览、切换笔记回到预览、保存逻辑、主题存储键均未改动。 |
| `src/components/PreviewContent.tsx` | +81 | 手机（`max-width:767px`）正文样式：留白由 `20px 30px 100px`/`clamp(20px,5%,64px)` 收到 `14px 14px 56px`；正文 16px 稳定字号；图片按容器缩放；表格与代码块局部横向滚动；长链接 / 长连续文本断行；`#write` 的 `overflow-x` 由主题的 `hidden` 改为 `clip`；上下标恢复语义；按阅读主题给出代码块底色。**规则写在 Shadow DOM 样式边界内**（正文在 Shadow DOM 中，全局 CSS 不作用于内部）。 |
| `src/index.css` | +28 | 新增 `.note-item` / `.note-item-title` 两个作用域类：手机端 ≥44px 行高、两行截断、`overflow-wrap: anywhere`。桌面（≥768px）行为与改动前一致，仅在 `.note-item-title` 上保留原有 `truncate`。未使用全局 `overflow-x: hidden` 兜底。 |

未改动（按约定）：`src/App.tsx`、`src/components/GraphView.tsx`、`src/components/Markdown.tsx`、`src/lib/md.ts`、`src/hooks/useNotes.ts`、`src/types/note.ts`、`src/lib/syncFile.ts`、`src/types/desktop.d.ts`、`electron/`、`package.json`、`package-lock.json`、`src/themes/vue-light.css`、`src/themes/vue-night.css`（两个内置主题文件一行未动）、`public/notes.json`。

### 工作区说明（重要）

`git status` 里还有**不属于本轮**的改动，我未触碰也未还原：`src/App.tsx`、`src/components/GraphView.tsx`、`src/hooks/useNotes.ts`、`src/lib/md.ts`、`scripts/md-selftest.mjs`、`.gitignore`、`public/notes.json`（会话期间被外部进程从 92,702 B 改成 113,844 B，并有 `.bak-*` 备份），以及未跟踪的 `_kaust_preview/`、`_kaust_template_preview/`、`_online_kaust_templates/`、`scripts/md-scripts-render-test.tsx`、`docs/HANDOFF_FOR_NEXT_AGENT.md`、`docs/MARKDOWN_SCRIPTS_FIX.md`。会话开始时 `git status --short` 只有 `M package.json`、`M package-lock.json`、`?? docs/`，其余均为会话期间其他对话/进程写入。

`src/components/NoteList.tsx` 也被另一路改动叠加过（新增了按类型折叠分组、`kaust-kg-collapsed-types` 存储键、chevron 图标）。该改动**保留了本轮的 `.note-item` / `.note-item-title` 类与手机尺寸**，两者未冲突；我未还原它。因此本报告描述的 NoteList 行为以「手机适配 + 分组折叠」共同存在为准。

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
> kaust-knowledge-graph@1.0.1 build
> tsc -b && vite build
✓ 1812 modules transformed.
dist/index.html                   0.42 kB │ gzip:   0.31 kB
dist/assets/index-6pPWzzEh.css   82.21 kB │ gzip:  13.68 kB
dist/assets/index-CiT9-OYQ.js   563.97 kB │ gzip: 165.27 kB
✓ built in 4.06s
==== EXIT CODE: 0 ====
```

- `tsc -b` 零类型错误、零诊断输出。
- 唯一警告是既有的 chunk > 500 kB 提示，改动前的基线日志里已存在，非新增。
- 体积对比（基线 → 最终）：CSS 80.94 → 82.21 kB，JS 535.48 → 563.97 kB。增量来自手机端样式与菜单控件，属于预期。
- 日志：`.tmp-e2e/final-build.txt`。

### lint —— 未通过，但 100% 为既有问题

```
✖ 34 problems (32 errors, 2 warnings)
==== EXIT CODE: 1 ====
```

- 基线（改动前）：`✖ 32 problems (31 errors, 1 warning)`。
- 相对基线的**唯一**增量是 `release/public-source/` 这个被一起 lint 到的旧发布副本目录多出 1 error + 1 warning（该目录在会话期间被外部进程刷新，新增了 `App.tsx`、`hooks/useNotes.ts` 两份副本）。`src/` 侧 16 errors + 1 warning 与基线**逐条完全一致，零漂移**。
- `src/App.tsx:149:6` 的 `react-hooks/exhaustive-deps` 警告是既有问题。
- **本轮四个目标文件的命中数均为 0**（`NoteList.tsx` = 0、`NoteEditor.tsx` = 0、`PreviewContent.tsx` = 0、`index.css` 不被 eslint 覆盖）。改动前的基线里这三个文件同样为 0，即**无回归**。
- 日志：`.tmp-e2e/final-lint.txt`。

结论：**本轮未引入任何新的 lint error，也未引入新的 warning**（唯一增量来自外部刷新的 release 副本）。

## 5. 已测尺寸、主题、测试场景与无个人信息截图位置

### 测试方法（可复现）

用**人工编造的合成测试数据**（标题一律带「示例」「测试」，正文含 `H<sub>2</sub>O`、宽表格、超长代码行、800×600 内联 SVG 图、超长 URL、超长连续英文单词、8 个标签、空笔记）驱动真实应用：

- 测试实例：`.tmp-e2e/vite.harness.config.ts`（Vite root 指向 `.tmp-e2e`，`publicDir` 指向合成数据目录）。应用虽然仍会 `fetch ./notes.json`，但 `seed.js` 在启动前已把合成数据写进 `localStorage`，`useNotes` 因 `prev.length > 0` 不会采用该响应——`public/notes.json` 里的个人笔记**从未被加载或渲染**。
- 浏览器：无头 Chrome + CDP，逐个场景设置 `Emulation.setDeviceMetricsOverride`。
- 交互：React 19 不响应 JS 合成的 `click`/`input`（实测 `element.click()` 与 `dispatchEvent` 都改不动 `data-state`），因此由 CDP 派发**真实** `Input.dispatchMouseEvent` / `Input.insertText` 来切笔记、切标签页、输入搜索词与 `[[`。
- 命令：`node .tmp-e2e/run.mjs`（产出 `out/results.json`）+ `node .tmp-e2e/analyze.mjs`（断言与指标表）。
- 原始数据：`.tmp-e2e/out/results.json`。

### 覆盖矩阵（44 个场景，全部通过，控制台零错误）

| 环境 | 尺寸 | 场景 |
| --- | --- | --- |
| 小手机 | 360×800 | default / night / paper / vue-light / vue-night / custom / 编辑态 / 笔记链接建议 / 无搜索结果 / 空笔记 / 单条笔记 / 8 个标签 / 宽表格 / 长代码行+大图 |
| 常见手机 | 390×844、412×915 | default、vue-night |
| 手机横屏 | 844×390 | default |
| 平板 | 768×1024、1024×768 | default、宽表格、vue-light |
| 电脑 | 1440×900 | default、vue-night、长代码行+大图 |

**6 个主题全部覆盖**：default、paper、night、vue-light、vue-night、custom（自定义主题用一份故意过火的 CSS 做压力测试：`#write{padding:10px 40px; max-width:900px; overflow-x:hidden}`、`table{width:1200px}`、`img{width:1400px}`）。

### 关键实测结果

**手机端（360px，Shell 修正后即真实手机可用宽度）**

| 指标 | 结果 |
| --- | --- |
| 页面横向滚动 | **无**（`scrollWidth == clientWidth == 360`，全部 22 个手机场景） |
| 溢出到视口外的元素 | **0 个** |
| 正文 `padding` | `14px 14px 56px`（6 个主题一致） |
| 正文 `font-size` | `16px`（不随视口缩放） |
| `#write` `overflow-x` | `clip`（不再用 `hidden` 掩盖溢出） |
| 宽表格 | 容器 `332 → 679px`，`overflow-x: auto` → 局部横向滚动，页面不被撑宽 |
| 长代码行 | `pre 332 → 606px`，`overflow-x: auto` → 局部横向滚动 |
| 800×600 大图 | 渲染为 **332×250**（等比缩放，不溢出） |
| 触摸目标 | 扫描 37 项，**36 项 ≥44px**；唯一 <44px 的是未适配的顶栏「自动同步」开关（App.tsx，范围外）。正文内的行内文字链接不按 44px 约束。 |
| 编辑态 | 编辑标签页可切换、textarea 360×245 可见 |
| 笔记链接建议 | 手机端浮层宽约 356px（左右各 2px 内边距）、未超出视口 |
| 无搜索结果 | 正确显示「没有匹配的笔记」 |
| 空笔记状态 | 无横向滚动 |

**平板 / 电脑（回归，必须与改动前一致）**

| 尺寸 | 正文 `padding` | 正文 `font-size` | 页面横向滚动 |
| --- | --- | --- | --- |
| 844×390 | `28px 29.3906px 64px` | 15px | 无 |
| 768×1024 | `28px 25.5938px 64px` | 15px | 无 |
| 1024×768（vue-light） | `20px 30px 100px` | 15px | 无 |
| 1440×900 | `28px 59.1875px 64px` | 15px | 无 |

平板与电脑的正文留白、字号、`overflow-x` 与改动前**逐值一致**——手机规则全部包在 `@media (max-width:767px)` 内，768px 及以上完全不生效。

**断言**：44 个场景共 0 条失败。断言覆盖：无控制台错误、手机端不横向滚动、桌面/平板不横向滚动、手机正文样式生效、场景控制真的生效（防止「测到旧状态」的假通过）、宽表格/代码块可局部滚动、图片不溢出、触摸目标、上下标语义、空状态与建议列表等非成功路径。

### 截图

**45 张无个人信息截图**位于 `.tmp-e2e/out/screenshots/`，文件名格式 `{宽}x{高}__{场景}.png`（全宽外壳场景带 `__shell-mobile` 后缀）。截图内容全部是上述合成数据。

`.tmp-e2e/` 是未跟踪的验证脚手架（不是产品代码），核心负责人如需复核可直接 `node .tmp-e2e/run.mjs` 重跑；确认后可整体删除，删除不影响 `src/`。

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

### P3-1（未修复，记录并建议接受）：桌面/平板端超长不可断词仍会撑宽

`768x1024` 下正文里 60 字符的连续英文单词（`Supercalifragilistic...`）与 108 字符的超长 URL 仍会把 `#write > div` 的 `scrollWidth` 撑到 1632px。原因是我的 `overflow-wrap: anywhere` 断行规则**按设计只放在 767px 以下的媒体查询里**——修它就等于修改桌面排版，超出本轮授权。

判定：P3，仅影响「极窄内容区 + 超长不可断词」的合成极端情况；真实桌面 1440px 下正文有 820px 可用宽度，不触发。已在 `.tmp-e2e` 断言中显式归类为「既有桌面问题」，不计入移动适配失败。

### P3-2（未修复）：桌面端上下标垂直对齐

Tailwind preflight 把所有元素重置为 `vertical-align: baseline`，桌面端 `<sub>`/`<sup>` 因此与正文同基线。手机端我已恢复 `sub`/`super` 语义（12.48px）。桌面端属既有问题，未改。

### P3-3（未修复，范围外）：顶栏「自动同步」开关触摸目标 32×18px

位于 `src/App.tsx`，本轮只阅读。

## 7. 需要核心负责人接入的导航或接口需求

### 阻塞项：`src/App.tsx` 顶层布局必须适配，否则手机端不可用

**实测证据（360×800，未改动 App.tsx）**：

| 指标 | 实测值 |
| --- | --- |
| `aside`（笔记列表侧栏）宽度 | 固定 **256px** |
| `main`（正文区）可用宽度 | **104px** |
| 文档 `scrollWidth` / `clientWidth` | **760 / 360** |
| 页面横向滚动 | **是** |
| 溢出到视口外的元素 | 25 个，全部来自顶栏与主区工具栏 |

104px 的正文区意味着：标题输入框、类型/等级选择器、标签、正文全部无法阅读或操作。这不是组件缺陷——同一份组件在「隐藏侧栏、主区全宽」的模拟外壳下（等同未来的列表/详情切换）**全部 22 个手机场景零横向滚动、零溢出、36/37 项触摸目标达标**。

**需要接入的内容**（按交接文档约定属核心负责人）：

1. **列表 ⇄ 详情分屏切换**：手机端默认显示列表，选中笔记后显示详情，并提供返回。
2. **顶栏工具栏换行或收进菜单**：`header` 目前是 `flex h-14 items-center gap-3 px-4`，内含 4 个带文字按钮 + 1 个图标按钮，总宽约 506px，360px 下被硬裁。可行改法：`header` 加 `flex-wrap` + `h-auto min-h-14`（我的测试外壳用的就是这个），或把「导入备份 / 导入 .md / 导出备份」收进一个下拉菜单。
3. **侧栏 `aside` 在手机端改为抽屉或隐藏**：现在 `w-64 shrink-0` 恒定占据 256px。
4. **安卓系统返回键**：与列表/详情切换联动。
5. 顶栏「自动同步」开关触摸目标提升到 ≥44px。

我已在测试脚手架里验证过上述第 2 条的样式效果（`.tmp-e2e/probe.js` 的 `applyShellMobile()`），可作为参考。

### 接口需求：无

本轮**没有**新增或修改任何 Props，也没有要求 `App.tsx` 传入新参数。核心负责人接入导航时不需要为本轮的三个组件增加接口。

### 可选改进建议（非阻塞）

- 把第 6 节 P2-1 的代码块主题变量从「仅手机」提升为「全尺寸」，同时修好桌面端 Vue 深色代码块。
- 宽表格与代码块虽然可以局部横滑，但手机端滚动条默认不可见，用户可能不知道右边还有内容。可考虑加边界渐隐或「← 可横滑」提示（属于体验优化，本轮未做以免改动 `Markdown.tsx`）。
- `night` / `vue-night` 下表格表头仍是浅色底（来自 Markdown 的 `bg-muted`），可读但突兀，与 P2-1 同源。

## 8. 其它

- **未提交、未推送、未发布、未生成安装包**，符合交接文档要求。
- **未修改任何个人笔记**：`public/notes.json` 未被本轮读写（其变更来自外部进程，见第 2 节）；测试全程使用合成数据。
- **未修改依赖**：`package.json` / `package-lock.json` 的改动是会话开始前就存在的，非本轮。
- **未修改 Markdown 解析与渲染**：`Markdown.tsx`、`lib/md.ts`、`types/note.ts` 一行未动。
- **未修改保存与同步逻辑**：`useNotes.ts`、`syncFile.ts`、`desktop.d.ts`、`electron/` 一行未动。
- **未修改两个内置主题文件**：`vue-light.css`、`vue-night.css` 一行未动（手机覆盖放在 `PreviewContent.tsx` 的 Shadow 样式里，且排在主题 CSS 之后）。
- **未添加安卓工程**：无 `android/`、无 `capacitor.config.ts`。
