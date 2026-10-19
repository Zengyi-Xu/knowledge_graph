# 项目开发记忆（给 AI 代理；改动本项目前先读这一页）

## 冻结单元（黑箱）——先看这一节，能省掉大量读码

`frozen.json` + `scripts/frozen-check.mjs` 把 9 个单元锁成黑箱（完整契约与解冻流程：[docs/FROZEN.md](docs/FROZEN.md)）：
`ui-kit`(`src/components/ui/**`)、`csl-data`、`editor-runtime`(`public/vditor/**`)、`md-parser`(`md.ts`+`tex.ts`)、
`md-render`(`Markdown.tsx`+`previewTheme.ts`+`markdown-base.css`+`themes/**`)、`vault-format`、`vault-io`、`zotero-rules`、`desktop-bridge`(`electron/**`+`types/desktop.d.ts`)。

- **不要读这些单元的内部实现，也不要改**。要什么能力直接查契约：Markdown 语法 → `docs/MARKDOWN_RENDERER.md`；
  vault 字段 → `docs/VAULT_FORMAT.md`；桌面能力 → `src/types/desktop.d.ts`；其余 → `docs/FROZEN.md`。
  手写冻结模块开头有 `FROZEN(...)` 标记，看到就停手。
- 校验：`npm run frozen:check`（秒级，看有没有碰坏锁定内容）；`npm run test:frozen` = 校验 + 全部守护测试（约 40s）。
- 确实必须改（不是顺手重构）：先让 `test:frozen` 全绿，再 `npm run frozen:update -- "<单元> <理由>"` 显式解冻，并同步契约文档。

## 常用命令

- 体积与加载时机：`npm run budget:check`（自带一次构建；断言 入口 chunk ≤500KB、进文献列表新增 ≤200KB、
  GraphView ≤80KB、PDF/编辑器/citation-js 的加载时机、场景总量不超基线 10%；`budget:baseline` 刷基线、
  `budget:modules` 看模块级归属）；`npm run test:bundle-scenarios`（headless Chrome 实测 首页/文献/预览/编辑/图谱/PDF
  每个场景真实加载了什么）。口径、改法、坑都在 `docs/BUNDLE_BUDGET.md`——
  **不要用 `manualChunks` 给懒加载 chunk 改名**：Rollup 会把它提升成入口的静态 import（index.html 出现 modulepreload，
  2.7MB 的 citation chunk 会在首屏就下载）。
- 构建 / 回归：`npm run build`（tsc -b + vite build）、`npm run test:vault | test:vault-gate | test:use-notes | test:lit | test:web | test:zotero | test:zotero-import | test:zotero-e2e`
- `npm run test:use-notes`（约 15s）：useNotes 的特征测试——真实临时 vault（`electron/vaultFs.cjs`）+ 极简 React 替身（`scripts/harness/react-shim.ts`）在 Node 里驱动真实 hook，锁住
  「装载完成前不写盘 / debounce / 加载期冲突暂停写盘 / 离线读取失败中止 / 未知字段保留 / 未纳管 md 不动 / 删除数 0 / 双链与图谱边」。
- useNotes 已按关注点拆开（`NotesApi` 门面不变）：纯数据 `src/lib/noteStore.ts`；编排 `src/hooks/useVaultSession.ts`（账本 `useVaultLedger()` + 装载门禁 + 分批载入）、
  `useVaultWriter.ts`（防抖写盘）、`useVaultWatcher.ts`（外部改动轮询）、`useVaultConflicts.ts`（加载期冲突取舍）、`useNoteLinks.ts`（双链/图谱边）；`src/hooks/useNotes.ts` 只做拼装。
- 文献表（视图层）：`npm run test:lit-view`（分类 / 筛选 / 分页 / PDF 徽标 / 同步对话框的纯逻辑 + 组件 SSR，秒级）、
  `npm run test:lit-dom`（无头 Chrome 真实点击：PDF 徽标即时响应、「显示更多」加 150 行、筛选变更把分页退回首页、同步对话框读取→预览→应用全流程）。
- 手机 / 平板与能力降级：`npm run test:mobile`（无头 Chrome 真跑 360/390/412/768/1024/1440 六档 × 有桥 / 无桥，
  量导航、列表、编辑、预览、文献卡片、PDF 降级、存储面板、触摸目标、控制台；360/390/412 靠 iframe 拿真视口，
  因为无头窗口最小宽度约 500px）。`--no-build` 复用 dist、`--only 360,768` 挑宽度、`--shots[=状态]` 出截图；
  能力检测与降级口径见 [docs/MOBILE_PHASE1_REPORT.md](docs/MOBILE_PHASE1_REPORT.md)。
- 批量 Zotero 同步：`npm run zotero:sync -- --vault "<v>" --db "<zotero.sqlite>"`（dry-run，不在 vault 建任何目录/文件）；
  `--apply` 才写盘（先整库备份 `.backups/zotero-import-<时间戳>/`）；`--report <file>` 指定报告；`--limit <n>` 小批量试跑；`--allow-missing` 放行索引里读不到的文件；
  **`--prune` 额外做减法**：删掉笔记里已不存在于 Zotero 的分类路径与由旧分类派生的「方向:」标签（默认不加 = 只做并集）。
- 本地 PDF 认回：`npm run pdf:link -- --vault "<v>"`（dry-run）/ `--apply`（先备份）——按「Zotero 附件文件名 → 标题（清洗后）」在 Literature/Archive/Inform/Zotero storage 等目录搜 PDF，命中的绝对路径写进笔记的 `literature.localPdf`（只记路径，不复制不移动文件；同一份 PDF 只归一篇）。搜索目录用 `--search` 追加（传了 `--search` 就用它替换默认目录），`--loose` 放宽到 0.70。
  注意：`--db` 不指定时它默认找 `%APPDATA%\Zotero\Zotero\zotero.sqlite`（profile 目录，本机并不存在这个库）——**本机要显式传 `--db "C:\Users\Administrator\Zotero\zotero.sqlite"`**。
- 去重：`npm run dedupe:vault -- --vault "<v>"`（预览，逐组列出保留/被合并/可疑）；
  `--apply` 写盘；`--merge-suspect` 合并标题仅近似相等的可疑组；`--fix-placeholders` 清理全库历史占位「未分类」。
- 「仅文献」图谱的聚类（只读，不写 vault）：`npm run cluster:report -- --vault "<v>" [--top 10] [--samples 3] [--json <file>]`
  —— 打印每个簇的名字/规模/代表词/样例标题/内聚度与 `lift`（簇内点对相似度 ÷ 全局平均），用来调参和验收；
  算法本身在 `src/lib/litCluster.ts`，图谱与脚本共用同一份（详见「文献数据模型」之后的图谱那条）。

两个同步入口的分工：界面「同步 Zotero 分类」= 只更新已有笔记的 collections/标签/key/PDF 状态，不新建；
命令行 `zotero:sync` = 全量扫（可新建）；`dedupe:vault` = 合并重复。三者规则必须一致（都走 `src/lib/zoteroMeta.ts` / `zoteroImport.ts` 的公共规则）。

## 文献数据模型（不变量，2026-10-13 修复后）

1. `literature.zoteroKeys: string[]` 是这篇文献全部 Zotero key 的并集；`zoteroKey` 是主 key（优先取本机有 PDF 的，且固定排在 `zoteroKeys[0]`）。
   Zotero 库里的重复条目由 `coalesceZoteroItems` 先归并成一个同步单元再匹配笔记 —— **「去重后再次同步」必须 0 新建**，回归在 `scripts/zotero-import-e2e.mjs` 第 4 步（`npm run test:zotero-e2e`）。
2. 「未分类」是动态状态，不落盘：`collections` 不写「未分类」，标签里也不写分类 —— **分类只存在 `collections`（完整路径的树）**；界面用 `realCollectionsOf()`（`src/lib/zoteroMeta.ts`）判断。旧版把树压平成 `方向:<一级分类>` 标签（会与 collections 漂移：分类清空后标签还留着，实测 454 篇），已废弃 —— 同步/去重一律清掉（`isDirectionTag`），AI 面板的「方向」选项改从 `collections` 首段取。
3. 写盘安全：dry-run 不在 vault 创建任何文件/目录；`--apply` 先备份；`planVaultWrite` 的删除数必须为 0；未纳管 md 一律不碰；
   索引里登记但磁盘读不到的文件（同步盘离线）→ **直接中止**，绝不静默丢索引。
4. 去重只做并集、不丢数据：被合并项正文不在保留项里则追加到末尾（带来源标注）；collections/tags/attachments/zoteroKeys 全并集；PDF 计数取组内之和；可疑组（标题仅近似相等）默认跳过。
5. 打开本地文件不走 shell：Windows `explorer.exe <file>`（`scripts/local-web.mjs` 的 `openerCommand`），文件名含 `&`、括号不会被解释；
   `resolveZoteroPdf(dbPath, key, extraKeys)` 支持多 key 回退（去重后的文献可选到任一 key 下的 PDF）。
6. 文献表 UI：**侧栏（`src/components/NoteList.tsx`）只列非文献笔记** —— 一千多篇文献既不列条目也不列分类树（会和几十条笔记抢版面）；
   单击标题/行打开笔记，PDF 徽标本身是按钮（单击打开、无 220ms 延迟）；「标签」列默认隐藏；行内「⋮」菜单承接引用操作；
   一次渲染 150 行 +「显示更多」；标题显示走 `cleanLiteratureTitle`（解 HTML 实体、去内联标签/站点尾缀/`$…$` 定界符，只影响显示，不改数据）；
   **分类是折叠树**：`collectionTree.ts` 建树与计数（`collectionTreeOf`，计数 = 子树唯一篇数，同一篇挂多条路径只算一次），
   `CollectionFilter.tsx` 渲染 —— 下拉默认只画一级分类，按 ▸ 逐级展开子目录，选中任意层级都连带它的整棵子树；
   表格「分类」列（`collectionLabel`）只显示一级分类：1896 篇里三级路径全铺开反而看不出重点。
   完整路径只存在数据里（`literature.collections`），界面不改数据。
   视图层拆在 `src/components/literature/`：`collectionTree`（分类树与筛选值）、`literatureQuery` + `useLiteratureQuery`（筛选 → 排序 → 150 行分页）、
   `pdfCell`（PDF 徽标判定）、`LiteratureToolbar` / `LiteratureTable`（工具栏与表格）、`DoiImportDialog` / `BibImportDialog` / `ZoteroSyncDialog`（弹窗，对话框流程在 `zoteroSyncFlow`）。
   改规则改纯模块，别把分支写回组件；回归用 `npm run test:lit-view`（纯逻辑 + SSR）与 `npm run test:lit-dom`（无头 Chrome 真实点击）。
7. PDF 打开链（优先级）：`literature.localPdf`（pdf:link 写入的绝对路径，只记路径不复制文件）→ Zotero `zoteroKeys`（多 key 回退）→ **按标题兜底匹配**（`scripts/pdf-match.mjs`：`localPdf`/Zotero 都没命中时，本机服务在 `--pdf-root` 目录里按文件名保守匹配，命中只在内存里用；详情页可点「记到这篇笔记」才写 `localPdf`）→ 都没有时「在 Zotero 打开」用 `zotero://select/library/items/<key>` 定位条目。
   网页端打开 localPdf 必须落在 `--pdf-root` 授权目录（`启动网页端.cmd` 已带常用目录）；桌面版走 `file:open-external`（只接受存在的 `.pdf` 绝对路径）。
   **任何写盘路径都必须认识 front matter 字段**：老构建/老页面回写会静默丢掉它不认识的字段（2026-10-13 一次、2026-10-16 又一次——后者一次抹掉 1792 篇）；改字段后要同步 `vaultFormat` 读写 + 让用户强刷网页端。
8. **写入门禁（已接线，2026-10-15；2026-10-16 补服务端层）**：`src/lib/vaultGate.ts`（冻结单元 `vault-gate`）+ `npm run test:vault-gate`（43 项）
   —— 声明 `formatVersion` / `minimumWriterVersion` / `requiredCapabilities` 超出本客户端能力就只读：单篇只读的笔记不写、
   不删、不改名，meta 声明超限则整库停写；回写必须保留不认识的 front matter 字段；批量入口删除数 0、未纳管 md 不动、
   索引里读不到就中止；主进程落盘前再查一次声明。**加字段 = 加能力**（`CAPABILITY_FIELDS`），带新字段的笔记才会被打标
   （策略 B：普通笔记逐字节不变、升级零重写）。设计与已知缺口见 `docs/VAULT_WRITE_GATE.md`。
   **2026-10-16 补的服务端层（`scripts/vault-write-guard.mjs`，`scripts/local-web.mjs` 的 `vault:write` 里）**：客户端门禁只约束
   「认得出声明」的写入方，一个**认得出声明却复现不出字段**的旧页面照样能过。服务端改为比对「新文本里字段还在不在」：
   声明了 `requiredCapabilities` 的笔记丢了这些字段（或声明行本身、或把值清空）就**整批拒绝**并在界面报错；
   `meta.json` 同样不能丢 `formatVersion` / 自定义顶层键。`npm run test:web` 覆盖（56 项）。
9. **PDF 阅读器（`src/components/PdfViewer.tsx` + `src/components/pdfTextLayer.css`）**：canvas 画页面，textLayer 只负责划选/高亮锚定。
   pdf.js 6 的契约有三处容易踩，少一处就会出现「整页文字重影」（2026-10-15 修过）：容器必须带 `textLayer` 类（pdf.js 不自己加）、
   必须引入 textLayer 的最小样式（`pdfTextLayer.css`，`color: transparent` + 绝对定位）、缩放变量是 `--total-scale-factor`
   （= CSS 缩放比；旧名 `--scale-factor` 不再被读取），且传给 `TextLayer` 的 viewport 要用 CSS 尺寸的那份（DPR 由 pdf.js 内部再乘）。
   另有三个「会整页白屏 / 静默坏掉」的坑（2026-10-15 修）：`getDocument({ data })` 会把 `data.buffer` **转移**给 worker
   （原 Uint8Array 立即失效 —— 传会话缓存的字节必须 `new Uint8Array(data)` 复制一份）；`PDFDocumentProxy` 没有 `destroy()`，
   销毁要走 `getDocument()` 返回的 loading task；`focusAnnotationId` 必须归一成 `null`（没传时是 `undefined`，
   与 `prevFocusId` 的 `null` 恒不相等 → 渲染期 setState 死循环 → React 「Too many re-renders」白屏）。
10. **详情页的「外部 PDF」（2026-10-15）**：文献笔记的 PDF 常常不在 vault 里（`localPdf` 或 Zotero 库），
   附件列表只管 `attachments`（应用内导入的），所以详情页附件区额外渲染一条「本地 PDF / Zotero PDF」条目：
   快照（第一页）+ 点击就地阅读；操作按钮一律独立成与「添加文件」并列的 `Button`
   （「全屏阅读」走文献表 PDF 徽标同一个 `openPdfReader`），别塞进芯片里 —— 芯片里的图标没人看得出能点。
   「添加文件」刻意不叫「添加 PDF」：有 `localPdf`/Zotero PDF 的篇目本来就有 PDF，叫「添加 PDF」会被读成「这篇没有 PDF」。
   判定用 `externalPdfSource()`（`src/lib/pdfSource.ts`，与 `preferredPdfSource` 同优先级，附件不算外部）；
   字节按来源缓存（`loadPdfSourceCached` / `cachedPdfSource`，同一份 PDF 不重复跨桥读），
   快照组件 `src/components/PdfSnapshot.tsx` 必须懒加载**并且只在这份 PDF 已读过时才挂载**——
   打开笔记就挂载会把 pdfjs（1MB）拉进编辑路径，`test:bundle-scenarios` 的 `preview/edit` 场景会直接判失败。
11. **内嵌 PDF 面板的布局（2026-10-15）**：`src/lib/inlinePdfPanel.ts` 是模块级小状态（不使用 Provider，
   避免给 App 的整段布局重排缩进）：面板上报「展开与否」，布局注册挂载点，`LiteratureAttachments`
   用 `createPortal` 把面板投进那一列。并列视图三列都按比例分（图谱 26% / 详情+正文 34% / 面板 40%），
   不外溢、窗口变窄一起缩。图谱圆点的屏幕尺寸乘一个列宽系数 `uiScale = clamp(width/900, 0.72, 1)`
   （`GraphView.tsx`，与 `1/zoom` 一起写进节点组的 `scale()`，所以圆点不随视野缩放变大变小）：窄列里标签会互相压住，
   必须随列宽缩小；宽列不放大。边的线宽仍按 `1/zoom` 保持屏幕粗细。
   **标签字号随视野缩放**（组内再乘一次 `labelZoom = clamp(zoom, 0.8, 2)`，把组上的 `1/zoom` 抵消回来）：
   放大时字变大（封顶 2×），缩小时字变小；缩到 `zoom < 0.8` 认为「文字已挤不下」，进入**大节点优先**渲染——
   只给 `labelHubs`（连接数排前 `LABEL_HUB_COUNT`(10) 的**笔记**节点，文献本来就不标标题、不占名额）标字
   （字号停在 0.8 倍，不再继续变小），其余节点虚化（`CROWDED_OPACITY` 0.3）+ 缩小（`CROWDED_SHRINK` 0.6）
   且不显示文字；悬停/聚焦的节点不受影响（标签按不小于基准字号显示）。
   **判定用排名而不是固定度数阈值**：档位/筛选一变节点规模能差几十倍，固定阈值要么标满屏、要么一个不标；
   度数相同的按 id 稳定排序，保证同一份数据每次选中同一批，标签不会跳来跳去。
   工具栏另有「**只标大节点**」开关（`graph-hub-only-v1` 本地记忆）：强制开启时无视视野大小，始终只标这前 N 个；
   统计栏在两种情况下都提示（自动时写「放大即恢复」，强制时写「已强制开启」）。
   **标签的间距也必须跟着字号放大**（踩过：间距写成常量时，放大后文字会和圆环「相切」）：
   基线距离写成 `y = (r + LABEL_RING_OUT)/textZoom + LABEL_GAP`——`LABEL_GAP`(14) 在 `scale(textZoom)` 组内，
   屏幕上就变成 `14 × textZoom`（随字号等比放大），`(r + 6)` 那一项保持圆环外沿的恒定屏幕距离（圆点不缩放）。
   实测 100% 时圆环下沿到文字的空隙 3px，350%（字号 2×）时 6px。
   回归：`.tmp-graph-zoom/check.mjs`（headless Chrome 真滚轮，量 SVG 文字的真实渲染高度、圆点半径、
   「圆环下沿 → 文字上沿」的空隙，点数前 10 的排名结果与强制开关，并出截图 `.tmp-graph-zoom/shots/`）。
   **「仅文献」档按聚类看文献（2026-10-16）**：1896 篇文献全铺开只是一团雾，所以**先只画几个簇**，
   点一下簇就直接铺开它的成员文献（**只有一级**，2026-10-16 改：两级下钻用起来多余）；点进某一簇之后，
   **其它簇和它们的成员一个都不渲染**（不是虚化，是根本不进 DOM）。
   - 算法在 `src/lib/litCluster.ts`（纯函数，图谱与报告脚本共用）：特征 = Zotero 分类路径的每一段 +
     非「期刊:/年份:」标签 + 标题词（英文按词、**中文按二元组**，单字太泛/三元组太稀疏），三类分别加权、
     tf-idf 后 L2 归一化、余弦相似度；**球面 k-means**（k-means++ 初始化 + 固定种子 PRNG）。
     簇数自适应 `clamp(round(sqrt(N/18)), 6, 12)`；文献 < 60 篇直接返回 null（视图铺开节点更清楚）。
     模块仍保留「再分一层小簇」的能力（`subLevels: true`，`splitMin` 56 / `subSize` 28 / `maxSub` 12），
     只有离线报告用得上（判断一个大簇内部是否同质）；图谱传 `subLevels: false`。
   - **输入先按 id 排序**：k-means++ 初值按位置取，顺序一变结果就变（同一份库按文件名装载 vs 按索引装载
     会得到完全不同的簇）；排序后簇与簇 id 稳定，「下钻路径/簇颜色」不会自己跳到别的簇上。
   - **多次重启取最优**（`restarts` 4）：评分 `Σ |簇|² × 簇内平均相似度²`（等价于「簇内点对相似度总量」；
     直接 Σ|簇|×内聚度不行 —— 合并两个不相干的簇也能刷分，实测会挑出「一大堆 + 一堆碎片」的解）。
     碎片簇（< 8 篇）先并进质心最近的兄弟簇再评分；分不出两个像样的子簇就干脆不分层（只影响 `subLevels` 那条路径）。
   - 簇名 = 簇内出现率够高、全局越专属越高的词项（分类段另有加成，量纲/序号/`01_论文库` 这类过半出现的段剔除）；
     两个字项分数接近时拼成「A · B」；**同一层不许用同一个词打头**（重名在下钻界面里分不清点哪个），
     撞词就换下一个候选词。簇名在图上按 18 字截断显示（13 字会把「high-speed systems · …」截成和
     「high-speed systems」一模一样）。
   - 渲染：簇节点是**合成节点**（id 前缀 `#cl:`，不在 notes 里），跟真实笔记共用 `nodesRef` 与同一套力导向；
     圆大小随成员数 `clamp(15 + 1.5√n, 15, 46)`，颜色取 `CLUSTER_COLORS`，圆内是篇数、圆下是簇名；
     **单击铺开这一簇的文献、右键返回上一层**，面包屑「全部 N 簇 › 簇名」可点回顶层。
     簇节点单独加一份斥力（`CLUSTER_REPULSION_BOOST` 2.5）：十来个节点按默认斥力会缩成一团。
     开关「文献聚类」（`graph-lit-cluster-v1`，默认开），关掉 = 铺开全部文献节点。
   - **成员按「连到哪个中心」上色**（2026-10-16）：中心 = 被标字的标签枢纽（连接数前 10），
     每个中心一个固定莫兰迪色号 `HUB_COLORS`（跟着排名走，同一份数据同一个中心同一种颜色），
     中心自己用该色号满填（`fillOpacity` 1）、成员 0.85 —— 测试就靠这个区分中心/成员（别用「有没有标签」认，
     放大后人人都标字）。归属：`assignHubIds`（`litCluster.ts`）先做**多源 BFS**（有边就按边走近的那个，
     和肉眼看到的连边一致），没有边通往任何中心的成员按**特征相似度**兜底归到最像的中心 ——
     文献图很稀（真库 370 篇的簇里 206 篇没有通往任何中心的边），只按 BFS 会有六成成员染不上色。
     两端同属一个中心的边也跟着该色号（`stroke`），归属在连线上一眼看得出来。
     色号是**浅莫兰迪**：十色按色相拉开约 36°（灰玫/灰杏/灰黄/灰黄绿/灰薄荷/灰青/灰天蓝/灰长春花/灰丁香/灰洋红），
     再统一往灰里压一点（保住莫兰迪的灰调）—— 明度够高、色相互相分得开。踩过两次：
     十个灰调挤在一起（`#4f7391` 那档太沉、`#93a5b8` 那档配虚化又发白）时，「哪个点属于哪个中心」根本读不出来。
     配套：虚化下限 `HUB_DIM_OPACITY` 0.85（`fillOpacity` 中心 1、成员 0.85）。
   - **同一层里离重心远的节点虚化**（`spreadFade`，按到该层重心距离 / 均方半径归一，1.0 起淡、1.7 到 `SPREAD_MAX_FADE` 0.66）：
     偏题的成员退到背景，簇心部分才读得清。它**不和「大节点优先」的虚化叠加**（叠加会淡到 0.1，基本看不见）；
     **中心不参与**（把锚点淡掉就没有「围着谁」可言了）；成员少于 4 篇时不参与（没有「远近」可言）。
   - **进某一层时自动把这一层装进视野**（点簇/返回/首次进入，量当前层节点的包围盒算缩放，下限 30%；
     用户手动平移/缩放后本次不再插手）：并列视图里图谱只占很窄一条（1440px 窗口下图谱列可能只有 480px），
     固定 100% 视野会把外圈簇节点挤出可视区 —— 那时它**连点都点不到**（实测踩过）。
     另：`pointer-events-none` 必须写在左右两个工具栏容器上（子控件 `pointer-events-auto`），
     否则那两个透明矩形会把落在下面的节点点击整块吃掉（一起踩过）。
     进簇后视野常 < 80% ⇒ 「大节点优先」接管，只标连接数前 10 篇（放大即恢复），这是预期行为。
   - 聚类只为**筛选后**的文献计算（簇上写的篇数必须和进去看到的篇数一致），代价 ~0.2s/次（1896 篇、4 次重启）；
     簇视图下话题边只对当前这一簇的文献构建（其余不渲染，建了也是白算），顺带省掉一次 O(n²)。
   - 离线调参/验收：`npm run cluster:report -- --vault "<v>"`（走应用自己的解析器 `parseNoteMarkdown`，
     否则报告里的簇和界面里的不是一个东西）打印每个簇的名字/规模/代表词/样例标题/内聚度 `intra` 与 `lift`
     （簇内点对相似度 ÷ 全局平均，> 1 才算「比瞎猜更聚」）。2026-10-16 实测：1896 篇 → 10 簇、225ms，
     簇名 `vlc·可见光通信(370, lift 4.6)` / `00_笔记库·02学习笔记(315, 0.49 杂物堆)` / `modulation·ofdm(186, 2.6)` /
     `coherent·laser(184, 3.5)` / `underwater vlc(175, 4.4)` / `ai·neural networks(154, 4.5)` / `lidar·sensing(148, 3.1)` …
   - 回归：`.tmp-graph-cluster/check.mjs`（合成 510 篇 6 主题 × 3 标记：簇数/篇数守恒/名字唯一/点簇直接铺开成员
     且 DOM 节点数 == 该簇篇数/主题纯度/远心虚化/面包屑返回/关掉开关铺开全部；**按中心上色**用连线端点的世界坐标
     还原邻接，验「与中心相邻的成员染的是那个中心的色号」「每个成员都染上了色」「中心色号互不相同」，
     再放大到 350% 验「全部标字 + 虚化改由远心决定」）；加 `--real` 换成**复制一份真库**
     （只搬 md + meta.json，**绝不把应用指到真库上**：应用有可能整库回写）跑同样的链路，实测 26 项全绿。
     注意点击要把鼠标移开再量（停在节点上会触发悬停，悬停节点强制标字，会污染「只标前 10」的判定）。
   中间那列的「详情信息（头部 + `LiteratureFields`）与正文各占半列」**必须写成固定高度**：
   详情两块 `h-1/4`、正文 `h-1/2`，三块都 `min-h-0 shrink-0 overflow-y-auto`。
   踩过的坑（`test:*` 都测不出来，只能靠 CDP 量真实盒子）：
   - `basis-1/2`（百分比 flex-basis）在 stretch 出来的高度上不生效，退化成内容高度；
   - `basis-0 grow` 权重也不行 —— 浏览器会按「内容自动最小高度」把详情两块卡在 112/79px，
     实测正文只拿到 45%（`min-h-0` 也压不动那两个量块）；
   - 固定 `h-*` 才是确定的（百分比高度对 stretch 出来的父高是解析得出的）。
   没有挂载点（单栏「笔记」视图、手机端、自测里的 SSR）时 `slot` 为 null，面板就地分栏渲染。
12. **PDF 高亮必须 `mix-blend-multiply`**（`PdfViewer.tsx` 的标注色块）：色块叠在 canvas 之上，
   半透明色块会把正文冲淡成灰（看着像没渲染清楚）；multiply 才是「荧光笔垫在文字下面」：白底染色、黑字仍是黑字。
13. **单栏「笔记」视图是流式滚动（flow，2026-10-16 加）**：整篇笔记（标题/标签/两条工具条/正文）一起随外层容器滚，
   正文不再自己滚 —— 只让正文滚时，744px 高的窗口里正文只有 343px，滚下去之后是整屏 744px。
   - 只有桌面端传 `NoteEditor flow`：单栏「笔记」与**并列**视图的笔记列都是 flow（并列那张卡片自己就是滚动容器：
     `min-w-0 flex-1 overflow-y-auto rounded-lg border bg-card`，共用同一个 `note-flow-scroll` testid 与 `noteScrollRef`）；
     手机详情页保持原来的「整屏高度 + 正文内部滚」。
   - 调用方给滚动容器：`App.tsx` 的 `data-testid="note-flow-scroll"`（`min-h-0 flex-1 overflow-y-auto`），
     `NoteEditor` 根节点在 flow 下是 `min-h-full flex flex-col`（不是 `h-full`）。切笔记/切视图要把它的 `scrollTop` 归零
     （`noteScrollRef` 的 effect），否则新笔记一打开就是「标题已经被滚走」的样子。
   - **四处必须一起改，少一处正文就退回内部滚动**（回归：`.tmp-flow-layout/check.mjs`，量的是真实浏览器里的
     `.vditor-wysiwyg` 的 `overflow-y` 与容器 `clientHeight/scrollHeight`）：
     ① `WysiwygEditor.css` 末尾的 `.kg-vditor-flow`（`.vditor` / `.vditor-content` / `.vditor-wysiwyg` / `pre.vditor-reset`
     全部 `height: auto; min-height: 0; overflow: visible`）—— 故意放在文件末尾，靠「同权重 + 次序」盖掉前面的
     `height: 100%` 与 `overflow-y: auto`；② `WysiwygEditor.tsx` 按 `flow` 换类名；③ `PreviewContent` 的 flow 不套
     `h-full overflow-y-auto`；④ 经典模式（左源码右渲染）的 textarea 没有自动高度：`NoteEditor` 的 `autoGrow()`
     按 `scrollHeight` 顶高 + `pb-[40vh]` 底部留白。
   - **Vditor 会给可编辑根节点写内联 padding（实测 `padding: 10px 35px`）**，内联权重最高，所以
     `WysiwygEditor.css` 里那条 `padding: … 40vh …` 平时是死的（查过：只有它一条规则匹配、计算值却是 10px）；
     flow 档在文件末尾用 `!important` 改左右留白并只把 `padding-bottom: 40vh` 加回来（实测滚到底最后一行离窗口下沿 298px，
     打字时插入点不顶屏幕边缘）。非 flow 档保持 Vditor 的内联值，行为不变。
   - **flow 档正文铺满整列**：Vditor 把可编辑根节点卡在 `max-width: 56em`（15px 字号 = 840px；1440 窗口下这一列
     1156px，右侧白空三百多像素 —— 用户报的「横向宽度没到全宽」就是这个），并给内联 `padding: 10px 35px`。
     flow 档两条都盖掉：`max-width: none`（同权重 + 次序），左右 `padding: 16px !important`（与标题栏/工具条的
     `px-3 md:px-4` 对齐；并列那一列窄，35px 两侧要吃掉近两成宽度）。实测 `pre.vditor-reset` 宽 840 → 1156px。
     别把 `max-width` 收回去当「阅读舒适度」：用户明确要全宽。
   - 打字跟随靠浏览器原生 caret-into-view（实测：滚到底再输入，容器 `scrollTop` 会跟着涨）；`kg-vditor-flow` 里
     不要再造滚动容器，否则 Vditor 自己那套 `scrollTop` 逻辑会和页面级滚动打架。
   - 顶部视图切换条同时压紧（`py-1` + `TabsList h-8` + 触发按钮 `h-7 px-2 text-xs`）：实测 53px → 41px；
     再往上就得动顶栏（`md:min-h-14`）与两条状态栏（`py-1.5`），各约 6px，还没动。
   - 回归：`npm run test:mobile`（325 项，含 768/1024/1440 三档桌面宽度）、`npm run test:bundle-scenarios`
     ——**先跑 `npm run budget:report` 刷 `perf/bundle-lanes.json`**：预测是按 chunk 文件名校对的，重新构建后哈希一变，
     不刷会整片误报「多加载」。

14. **并列视图的图谱焦点跟随当前笔记（2026-10-19）**：任何入口打开的笔记（侧栏搜索/列表、新建、导入等，
   即 `activeId` 变化）都会同步为图谱 `focusId`；`openNote` 里直接 set 一次，保证「清掉焦点后再点同一篇」也能重新聚焦。
   **反向也是通的**：图谱里点中节点会把该笔记设为当前项（`activeId`）——并列视图单击节点直接打开
   （`GraphView openOnClick`，右侧换正文、左侧列表高亮并 `scrollIntoView` 滚到它，不再需要点第二次）；
   图谱单栏保留「先选中、再次单击打开」（单栏里打开会切走视图），但第一次单击同样经 `onSelectNote`
   让侧栏高亮。文献视图的文献表/手机卡片按 `activeId` 高亮当前那篇并滚进视野（`data-lit-selected`；
   只在已加载的 150 行里命中，翻页外的篇目不强行插队/改排序）。
   外部选中的节点可能落在窄列视野外 → `GraphView` 聚焦时若节点中心距视口边不足 80px 就把相机平移过去
   （已在视野内不动，点图谱节点不会跳视野）。焦点节点被筛选/聚类挡住时 `focusActive` 为 false：
   整图不虚化、底部也不显示「焦点：」。回归：`.tmp-focus-sync/check.mjs`（合成 21 篇：放大到多数节点出视野 →
   侧栏搜索选中 → 焦点栏出现、相机把节点带进视野、其它节点虚化；空白取消；同一篇再选仍聚焦；
   并列视图单击节点 → 右侧换成该笔记、侧栏对应项高亮）。

15. **AI 面板（2026-10-19 补齐）**：顶栏「AI 统筹」= 自由提问 + 四个任务模板。自由提问在
   `src/components/AiPanel.tsx` + `src/lib/aiChat.ts`（上下文范围：不附 / 当前笔记 / 当前笔记+双链与反链，
   60k 字符截断；多轮历史只留最近 20 条）。**自由提问只读**：不发 operations、不写盘、不要求同步快照；
   回答用 `Markdown` 渲染，`[[标题]]` 可点开笔记。网关 `electron/aiGateway.cjs`（`desktop-bridge` 契约冻结）
   支持 `kimi` 与 `deepseek`：DeepSeek key 从 `~/.zcode/v2/provider_config.json` 的 deepseek provider
   只读提取（环境变量 `DEEPSEEK_API_KEY` 优先，DSH 凭据兜底），模型默认 `deepseek-flash`，可切 `deepseek-v4-pro`；
   端点/模型可用 `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL` 覆盖。桌面走 IPC，网页走 `scripts/local-web.mjs`
   的 `ai:*`；**改网关后必须重启网页服务**（Node require 缓存，否则新 UI 会报「缺少 prompt」或把 DeepSeek
   显示成 Kimi 的模型）。回归：`npm run test:ai-chat`（14 项纯逻辑）、`npm run test:web`（56 项）。

16. **公式渲染（2026-10-19）**：阅读面板不再依赖冻结解析器的 LaTeX 子集。`src/lib/mathMarkup.ts` 在正文进入
   `Markdown` 之前，把 `$…$` / `\(…\)` / `$$…$$` / `\[…\]` / `equation|align|gather|matrix|cases|…` 环境抽成
   `KGMATHPLACEHOLDER<n>END`；`src/lib/katexRuntime.ts` 再动态加载 KaTeX（无公式不下载、不依赖 CDN），在
   Shadow DOM 内渲染 HTML + MathML。占位符只替换渲染后的文本节点，`md.ts` / `tex.ts` / `Markdown.tsx` 均未改动
   （`frozen:check` 全绿），旧的 `tex.ts` 子集继续作为冻结契约保留。
   - 代码围栏与行内代码不抽取；货币金额（`$20 … $30`、纯数字 `$5$`）不误判；MathType 导出的
     `equation/align/gather` 归一成 KaTeX 的 `aligned/gathered`，`\label/\ref/\eqref/\nonumber` 会被清掉；
     KaTeX 语法错误时保留原始 LaTeX 并标红，不会渲染半截公式。
   - 所见即所得编辑器：Vditor 自带公式渲染要从 CDN 取 KaTeX，离线/本机部署会失败。`WysiwygEditor` 用
     MutationObserver 调 `hydrateVditorMath` 替换 `.language-math` 可见层（隐藏源码不动，序列化/撤销仍归 Vditor）；
     `preview.math.inlineDigit` 让 `$10\log…$` 这类数字起始的行内公式也能识别；新输入与外部写入的公式都会在下一次
     装饰时补渲染。
   - 回归：`npm run test:math`（抽取、防误判、HTML+MathML）、`npm run visual:math`（真实 PreviewContent + Shadow DOM，
     900px / 390px 两档截图与溢出自检）、`npm run test:wysiwyg-e2e`（首屏公式 + 新输入公式）。2026-10-19 真库
     只读扫描：11 篇含公式笔记 / 472 个公式，KaTeX 0 失败，预处理后正文 0 条残留 LaTeX 命令。
   - 已知边界：块级公式需用标准写法（`$$` 独占一行、或 `$$…$$` 同一行）；`$$ x` 开头、下一行才 `$$` 结束的变体
     不会被抽取（真库中没有这种写法）。四空格缩进代码块里的 `$…$` 会被当公式（只承诺保护围栏/行内代码）。
   - KaTeX 字体（woff2/woff/ttf）随构建进入 `dist/assets`，离线包可用；`katexRuntime` 是懒加载 chunk，
     不要把 `katex` 或 `katex/dist/katex.min.css` 改成静态 import，否则首屏预算会回退。

## 真实数据环境（动手前先看）

- 真实 vault：`D:\BaiduSyncdisk\Bibliotx\Vault`（2026-10-15 起 1896 篇文献）；**Zotero 库以 Zotero 自己在用的那个为准**：
  `C:\Users\Administrator\Zotero\zotero.sqlite`（Zotero 10，实测 2267 条书目 / 有分类 2241、132 个分类，含 2026 年那套主题分类）。
  `D:\BaiduSyncdisk\Bibliotx\Zotero\zotero.sqlite` 是 **2025-03 就冻住的旧副本**（1367 书目 / 64 分类、旧分类法），只剩归档价值：
  拿它当同步源就会得到「分类对不上 Zotero」的假象。库路径的解析在 `scripts/start-local-web.mjs`（读 profile 的 `prefs.js` 里
  `extensions.zotero.dataDir`，再回退 `~/Zotero`、Baidu 副本）；`pdf:link` 的默认值仍是 profile 目录，本机必须显式传 `--db`。
- 改真实库之前：先复制 vault 副本跑 dry-run，核对「新建/更新/删除」数字；应用真实库写入前必须由用户明确同意。
- 2026-10-13 已更新真实库（`zotero:sync --apply`，备份 `.backups/zotero-import-20261013-230700/`）：匹配 1367 全按 key、新建 0、更新 668、删除 0；
  复跑 = 0/0/0；`dedupe:vault` = 0 组；正文被改动 0；真正未分类 64 篇；529 篇带多个 `zoteroKeys`。
- 同日 `pdf:link --apply` 给 61 篇补上 `localPdf`（备份 `.backups/pdf-link-20261013203154/`）：界面「有本地 PDF」341/668（280 原有 + 61 认回）；其余 327 篇 PDF 本机没有（Zotero 侧只有 `.zotero-ft-cache`，坚果云 WebDAV zip 属于另一个库，对这批无增益）。
- 2026-10-14 实测：上面两处字段曾被旧桌面端构建（`resources/app/dist`）回写时整段抹掉（668 篇 0 篇带 `zoteroKeys`/`localPdf`）。
- **2026-10-16 又发生一次，当天已定位并修复**：12:17:44–12:17:51 一个旧客户端连上本地服务后把整个库重写了一遍——
  1792 篇文献丢掉 `formatVersion`/`minimumWriterVersion`/`requiredCapabilities`/`zoteroKey(s)`/PDF 计数，454 篇丢 `localPdf`，
  1577 篇顺带被剪掉几条已不存在的分类路径（正文/标题/DOI 一字未改，1848 个文件里 1792 个只差 front matter）。
  写入方不是当前构建（现在的客户端有 `mergeFrontMatter` + 声明门禁），最可能是浏览器里被 service worker 缓存的旧壳/旧标签页。
  处置：① 用 `.backups/zotero-import-20261015-231001` 精确补回字段（脚本 `.tmp-pdf-recovery/restore-fields.mjs`，
  原文件备份 `.backups/field-restore-20261016093244/`），验收口径「磁盘原文 == `toMarkdown(parseNoteMarkdown(text))`」**1896/1896 一致**；
  ② `zotero:sync --apply`（备份 `.backups/zotero-import-20261016-123302/`）写 12 篇、删 0，复跑 0/0/0，**本机可访问 PDF 555 份 / 539 条书目**；
  ③ 服务端字段级写入门禁（见「文献数据模型」第 8 条）；④ 旧桌面版与旧网页包归档到 `release-archive/旧入口-20261016/`（`dist-dev/` 重新生成）。
- **2026-10-15 定位并修掉「知识图谱和 Zotero 对不上」**：根因是同步源一直指着 D 盘那本旧副本。按 C 盘线上库重跑
  `zotero:sync --apply`（备份 `.backups/zotero-import-20261015-164713/`）：匹配 762（key 488 / 标题 274）、新建 1228、更新 562、删除 0，写盘 1790 个 md，
  `zoteroKeys` 恢复（1790 篇带多 key）；再跑 `--prune`（备份 `.backups/zotero-import-20261015-164952/`）：592 篇删掉 645 条已不存在的分类路径 + 610 条旧「方向:」标签，
  55 篇清空后按「未分类」动态显示；两者复跑 = 0 变动。同日还改了 `src/components/PdfViewer.tsx`（PDF 预览重影，见下）与
  `scripts/start-local-web.mjs`（Zotero 库路径）。**未做**：`pdf:link` 没重跑——网页端打开 PDF 走本机服务的 `readZoteroPdf`（按 key 直读 Zotero storage），
  `localPdf` 不是必需；真要补，`--search` 必须指真实 storage（`C:\Users\Administrator\Zotero\storage` 已在 `--pdf-root` 白名单里）。
- 旧版 dry-run 留下的 6 个 `.backups/zotero-preview-*` 目录仍在（仅报告，可删）。

## 代理工作纪律（省上下文与额度）

- 不要整页读无障碍树或全量 DOM：用「过滤 + 小 limit」的元素快照、按 `maxChars` 截断的文本快照、`region` 裁剪图，只读需要的那一小块。
- 验证顺序：先 `npx tsc -b`（秒级）→ 跑目标测试（`test:zotero-e2e` 等）→ 最后才 `npm run build`；同一结果不要重复构建。
- 长任务先建 TodoList；真实数据操作前先备份并在副本上验证；失败先看脚本输出，不要盲目重跑。
- **当前唯一推荐发行路线是免安装网页包**：改完 `src/` 后运行 `npm run build`，发布时再运行 `npm run release:web`。
  不再生成或刷新 Electron EXE/NSIS 安装器。旧桌面 EXE 不认识新增字段，禁止再用于真实 vault；`electron/**` 仅作为冻结兼容层和开发/测试依赖保留。
- **`.cmd` 启动器必须保持 CRLF**：`启动网页端.cmd` 与 `build/web-portable/启动知识图谱.cmd` 都是 `chcp 65001` + UTF-8 中文；
  换成 LF 换行后 `cmd.exe` 会截断命令（实测把 `echo` 读成 `ho`、`node` 读成 `ode`，并误报「请先安装 Node.js」而无法启动）。
  用工具改写这两个文件后要确认换行没被改成 LF（`file x.cmd` 应显示 `with CRLF line terminators`）。
- **默认入口是 `.wsf` 无窗口启动器（2026-10-15 加）**：双击 `.cmd` 必然弹出并常驻一个控制台窗口，所以双击入口改成
  `启动网页端.wsf` / `停止网页端.wsf`（开发目录）与 `build/web-portable/启动知识图谱.wsf` / `停止知识图谱.wsf`（免安装包）。
  它用窗口样式 0 跑同一个 `.cmd`，输出进 `data/temp/web-server.log`，日志里没有 `127.0.0.1:` 就弹提示框（提示文字来自日志，可读中文）。
  只写 `.wsf`，**别改回 `.vbs`**：Windows Script Host 按系统 ACP（本机 936）读 `.vbs`，UTF-8 里的中文会全乱（实测 `AscW` 得 `5A34`）；
  `.wsf` 走 XML 声明里的 UTF-8，中文正常。三个启动器都按 CRLF 存盘（打包脚本会统一改写）。日志被运行中的服务独占时（cmd 的 `>>` 不允许第二个写入者）改走 `> nul`，由 `.cmd` 打开已有页面。
  停止脚本按命令行里的 `local-web.mjs` 匹配 node 进程 → **会停掉本机所有知识图谱本地服务**（包括 dev/测试实例），别在自动化里用它清场，用 `taskkill /PID <pid> /T`。
  回归：`npm run test:web-portable`（已覆盖 `.wsf` 起服务 + 写日志 + 中文不乱码）。
## Token 成本纪律（用户要求：所有工作先考虑省 token）

**成本 ≈ 步数 × 当时的上下文长度**：服务端每次请求都会重读整段对话。2026-10 实测单月 1.07B
tokens 中 98.6% 花在"重读上下文"上，模型输出只占 0.3%。省 token = 压住上下文和步数。

- **长任务分段**：单条会话上下文到 ~150k 就写交接文档、开新会话继续（实测上下文压在 150k 内可省约 48%）。
- **大文件不整读**：先 Grep 定位再局部读；大目录、二进制、生成物、虚拟环境不要读。
- **大输出先截断**：Bash / 测试日志 / 大 JSON 先 `head`/`tail`/`grep`/`jq` 缩到几十行再看。
- **合并工具调用**：能一条命令串做完的不要拆成几十个小调用——每碎一步都要重读全部上下文。
- **大块 Edit/Write 拆小**：整段替换的内容会长期留在上下文里被反复重读。
- **默认不派子代理**，不做无谓的并行会话 / 重复探索。
- **自查命令**：`python "C:/Users/Administrator/.zcode/workspace/default/naval-game/tools/token_report.py" --days 30`
  （口径见该仓库 `docs/token消耗分析.md`）。
