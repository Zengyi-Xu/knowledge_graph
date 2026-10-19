# 打包体积与加载时机预算（Vite 资产 raw / gzip）

一句话：**入口 chunk ≤500KB、进文献列表新增 ≤200KB、GraphView ≤80KB；PDF 阅读器 / pdf.worker、
编辑器（Vditor）、citation-js 一律「用到才下载」**。两套自动化守着它：构建期静态预算 + 真实浏览器六场景实测。

## 1. 现状（2026-10-15 这次重构之后）

### 场景口径

两种口径，回答不同问题，都记进了基线：

* **静态口径**（`npm run budget:check`，不需要浏览器）：从 Rollup 的 chunk 图算「这个场景的静态闭包里有哪些 chunk」。
  这是 CI 门禁用的口径——它只看「谁必然要下载」，不受这一次点击快慢影响。
* **浏览器实测**（`npm run test:bundle-scenarios`，headless Chrome + 本机网页端）：真点 UI，记录真的落到
  `/assets/` 的请求。体积取构建产物清单（本地网页端不压缩，所以 raw ≈ 真实传输）。

| 场景 | 静态：JS raw / gzip | 浏览器实测：JS raw / gzip（chunk 数） |
| --- | --- | --- |
| 首页（默认「并列」视图：图谱 + 笔记预览） | 458.0 / 146.8 KB | 695.9 / 210.5 KB（10） |
| 文献列表 | 529.8 / 171.4 KB | 742.3 / 225.7 KB（14） |
| 预览（阅读态） | 663.4 / 198.2 KB | 695.9 / 210.5 KB（10） |
| 编辑（所见即所得） | 999.7 / 280.8 KB | 1032.3 / 293.1 KB（11，含 Vditor 336.4） |
| 图谱 | 490.5 / 159.2 KB | 695.9 / 210.5 KB（10） |
| PDF 全屏阅读 | 1141.1 / 343.6 KB | 2454.8 / 738.8 KB（18，含 pdf.worker 1234.7） |
| （用户触发）复制引用 / 导入 BibTeX | 3470.4 / 900.0 KB | 只在点的时候下载 |

另外每次启动还会下载样式表 `assets/index-*.css` 86.8 KB / gzip 14.5 KB。

静态口径里「首页」只有入口 chunk 自己（458.0KB）；浏览器实测的 695.9KB 是「默认并列视图」把图谱和笔记正文
一起渲染出来的总量，两者差的就是 GraphView + NoteEditor/PreviewContent 那几块。

### 这次改完的对比（同一台机器，同一份源码）

| 指标 | 改之前 | 改之后 |
| --- | --- | --- |
| 入口 chunk | 681.7 KB / 201.4 KB gzip | **458.0 KB / 146.8 KB gzip** |
| 进文献列表要多下载 | **2831.6 KB**（citation-js 整包，静态依赖）+ 35.5 KB | **46.4 KB** |
| 打开 PDF 才下载 | 440.4 KB + worker 1234.7 KB（本来就已经是懒加载） | 不变，且有测试守着 |
| 编辑模式才下载 | 336.4 KB（Vditor，本来就是懒加载） | 不变，且有测试守着 |

`citation-js` 那 2.8MB 以前是 `LiteratureView` 的**静态**依赖（`LiteratureView-*.js` 里写着
`from"./literature-*.js"`），所以点「文献」就会把 @citation-js/plugin-wikidata（2.3MB）+ citeproc 全拉下来。
现在它只挂在「排版引文 / 解析 BibTeX」这些动作后面。

## 2. 预算（CI 门禁）

| 预算 | 口径 | 现状 |
| --- | --- | --- |
| 主入口 chunk ≤ 500KB raw | 入口 chunk 自己 | 458.0 KB |
| 进文献列表新增 ≤ 200KB raw | 文献列表静态闭包 − 入口闭包 | 71.8 KB |
| GraphView ≤ 80KB raw | GraphView chunk 总和 | 32.1 KB |
| PdfViewer + pdf.worker 只在 pdf 场景加载 | 不得出现在 首页/文献/预览/图谱 的闭包里 | ✓（worker 只被 PdfViewer chunk 引用） |
| 编辑器 Vditor 只在 edit 场景加载 | 同上 | ✓ |
| citation-js + CSL 样式 只在用户触发时加载 | 同上 | ✓ |
| index.html 不预载懒加载 chunk | modulepreload 名单 | ✓（0 个预载） |
| 每个场景总量相对基线涨幅 ≤ 10% | 对比 `perf/bundle-baseline.json` | ✓ |

## 3. 加载时机规则（改代码时要守住的）

1. **引文排版一律异步**：`formatBibliography / formatCitation / formatCitationMarker / parseCitationText /
   importFromBibtex / importFromRis` 都是 `Promise`（内部 `loadCite()` 动态 import）。
   纯函数保持同步、永不 import citation-js：`litToCSL`、`buildBibtex`、`cleanLiteratureTitle`、
   `CITATION_STYLES`、`importFromDoi`、`importFromArxiv`。
2. **RTF 的纯函数只收「排好版的文本」**：`buildCitationFieldRtf(items, styleId, displayText)`、
   `bibliographyRtfFromText(text)`；要排版走异步的 `buildClipboardParts` / `write*Clipboard`。
3. **笔记正文（预览 + 编辑）整条链懒加载**：`App.tsx` 里 `NoteEditor` 用 `lazy()`，它带出来的
   Markdown 渲染层、主题 CSS、md/tex 解析器、编辑器都不会进入口。
4. **PDF 只在打开时**：`PdfReadingWorkspace` / `LiteratureAttachments` 动态 import `PdfViewer`；
   `pdf.worker.min-*.mjs` 由 pdf.js 在 `getDocument` 时才取（唯一引用方是 PdfViewer chunk）。
   PDF 全屏阅读打开的那一下总量 ~1.7MB，属于预期。
5. **不要用 `manualChunks` 给这些懒加载 chunk 改名**：实测 Rollup 会把手动 chunk 提升成入口的静态 import，
   `index.html` 里冒出 `modulepreload`，2.7MB 的 citation chunk 会在首屏就下载。要稳定的逻辑名就用
   `build.manifest`（预算脚本就是这么拿到「chunk ↔ 源码模块」映射的）。

## 4. 怎么跑

```bash
npm run budget:report            # 构建 + 打印预算表/场景表/最大资产（不因超预算失败）
npm run budget:check             # 同上，但超预算退出码 1（CI 用这个）
npm run budget:baseline          # 把当前结果写进 perf/bundle-baseline.json（改完优化、确认无误后再刷）
npm run test:bundle-scenarios    # headless Chrome 实测六个场景真的加载了什么（需要 Chrome/Edge）
npm run budget:modules           # 模块级体积归属：某个 chunk 里到底是谁胖（--top 40 / --json）
```

产物：

* `perf/bundle-baseline.json` — 基线（每个资产的 raw/gzip + 每个场景的静态总量），CI 对比它判回归。
* `perf/bundle-lanes.json` — 构建期算出的「场景 → chunk 集合」「按需单元 → chunk」，浏览器实测拿它当对照。
* `perf/bundle-scenarios.json` — 最近一次浏览器实测结果（场景 → 实际请求的 chunk 与体积）。

想在浏览器实测里加一个场景：在 `scripts/bundle-scenarios.mjs` 的 `SCENARIOS` 里加一项，写清
`drive`（怎么点到那个状态）、`allow`（允许出现哪些场景的 chunk）、`forbid`/`require`（按需单元的名字，
取自 `perf/bundle-lanes.json` 的 `units`）。

## 5. 还没做（下一轮候选，按收益排序）

1. **citation chunk 里 2.3MB 是 Wikidata 插件**（`@citation-js/plugin-wikidata` + `wikibase-sdk`）。用户触发才下载，
   所以不再影响首屏；但如果没人用「Q123」这种 Wikidata 输入，可以改成只 import
   `@citation-js/core` + `plugin-csl` + `plugin-bibtex` + `plugin-ris`，把这块从 ~2.6MB 砍到 ~0.5MB。
2. **首页总量 695.9KB**：默认「并列」视图同时渲染图谱 + 笔记正文，`NoteEditor + PreviewContent + ui/select`
   约 205KB 属于「还没点开笔记就先付费」。要压就得改默认视图，或等用户真的选中笔记再挂正文。
3. **`ui/select` 约 70KB**（radix-select + floating-ui）只在编辑器工具条用一次，可以再拆一层。
4. **入口只剩 ~42KB 余量**：继续往入口加东西之前先跑 `npm run budget:check`。（这次顺手去掉了入口里
   完全没用到的 `react-router`（~35KB）：全库没有任何 `Routes/useNavigate/useParams`，只有 `main.tsx` 引过它。）
