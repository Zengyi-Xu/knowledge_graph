# 冻结单元（黑箱）注册表

一句话：**下面这些单元的内部实现是黑箱 —— 不要读、不要改，按「契约」用就行。**
锁定内容在 `frozen.json`，校验脚本 `scripts/frozen-check.mjs`。
改了被锁定的东西而没有重新锁定，`npm run frozen:check` 就会失败。

## 三条命令

| 命令 | 干什么 | 耗时 |
| --- | --- | --- |
| `npm run frozen:check` | 锁定内容（哈希 / 导出名 / IPC 清单）是否还和磁盘一致 | < 1s |
| `npm run test:frozen` | 上面 + 顺序跑全部守护测试（黑箱行为回归） | ~40s |
| `npm run frozen:update -- "<单元> <为什么>"` | 以当前磁盘状态**重新锁定**（= 解冻），并写进 `frozen.json` 的 history | < 1s |

## 两级冻结

- **全冻结（tier 1）**：文件内容按 sha256 锁死。内部实现是黑箱，新增/删除文件也会被发现。
  适合：生成物、第三方运行时、语法已封板且单测完备的纯函数模块。
- **契约冻结（tier 2）**：只锁公开导出名 / 接口清单。内部实现可以改，但改完必须让守护测试全绿。
  适合：还会长字段、长分支，但对外形状已经稳定的核心模块。

两级都遵循同一条纪律：**要动，就先说明理由，再 `frozen:update` 显式解冻**——不要顺手重构。

哈希按**内容**算（CRLF/LF 先归一化），所以换行符随 checkout 环境变化不会误报；真正的改动会。
`frozen.json` 的 `locked` 由脚本生成，别手改。

## 注册表

| 单元 | 级别 | 文件 | 锁的是什么 | 守护测试 |
| --- | --- | --- | --- | --- |
| `ui-kit` | 全冻结 | `src/components/ui/**`（53） | shadcn/ui 生成组件 | — |
| `csl-data` | 全冻结 | `src/lib/csl/**`（4） | 上游 CSL 样式 + 生成的 `styles.ts` | — |
| `editor-runtime` | 全冻结 | `public/vditor/**`（295） | Vditor 编辑器运行时资源 | — |
| `md-parser` | 全冻结 | `src/lib/md.ts`、`src/lib/tex.ts` | Markdown / LaTeX 解析器 | `test:md` |
| `md-render` | 全冻结 | `src/components/Markdown.tsx`、`src/lib/previewTheme.ts`、`src/markdown-base.css`、`src/themes/**` | 阅读面板渲染层与样式拼装 | `test:md-render` |
| `vault-format` | 契约冻结 | `src/lib/vaultFormat.ts` | front matter 读写与写入计划 | `test:vault`、`test:vault-e2e`、`test:vault-gate` |
| `vault-gate` | 契约冻结 | `src/lib/vaultGate.ts` | 写入门禁：声明判定、只读范围、未知字段保留、写盘计划过滤 | `test:vault-gate` |
| `vault-io` | 契约冻结 | `src/lib/vaultFs.ts`、`src/lib/vaultLoad.ts`、`src/lib/syncFile.ts` | vault 读写通道与同步文件封装 | `test:vault-e2e` |
| `zotero-rules` | 契约冻结 | `src/lib/zoteroMeta.ts`、`src/lib/zoteroImport.ts`、`src/lib/zoteroSync.ts` | Zotero 分类/标签/去重/导入规则 | `test:zotero`、`test:zotero-import`、`test:zotero-e2e` |
| `desktop-bridge` | 契约冻结 | `electron/*.cjs`、`src/types/desktop.d.ts` | 页面 ↔ 主进程的 29 个方法 + 26 个 IPC 通道 | 契约交叉校验（内置）、`test:vault-gate`、`test:web` |
| `note-store` | 契约冻结 | `src/types/note.ts`、`src/lib/noteStore.ts` | 笔记数据模型（类型/元数据常量）与纯数据操作（缓存、合并、双链边） | `test:use-notes` |
| `md-import` | 契约冻结 | `src/lib/mdImport.ts` | 外部 Markdown 导入解析（front matter 标量剥引号、CRLF/BOM） | `test:md-import` |
| `math-pipeline` | 契约冻结 | `src/lib/mathMarkup.ts`、`src/lib/katexRuntime.ts` | 公式渲染管线（占位抽取 + KaTeX 运行时水合） | `test:math` |
| `lit-view-logic` | 契约冻结 | `src/components/literature/` 的 5 个纯模块 | 文献表视图逻辑（分类树、筛选分页、PDF 徽标、导入输入、同步流程） | `test:lit-view`、`test:lit-dom` |
| `citation-copy` | 契约冻结 | `src/lib/copyCitation.ts`、`src/lib/rtfField.ts` | 引用复制与 Word RTF 域代码 | `test:lit` |
| `pdf-source` | 契约冻结 | `src/lib/pdfSource.ts`、`src/lib/localPdfFallback.ts` | PDF 来源优先级链与本地兜底匹配 | `test:lit-view`、`test:web` |
| `ai-chat` | 契约冻结 | `src/lib/aiChat.ts`、`src/lib/aiPrompts.ts` | AI 面板纯逻辑（上下文装配、历史截断、任务模板） | `test:ai-chat` |
| `capabilities` | 契约冻结 | `src/lib/env.ts`、`src/lib/capabilities.ts`、`src/lib/degrade.ts` | 能力检测与降级口径 | `test:mobile` |

## 各单元契约

### ui-kit（全冻结）

可以用组件本身（`<Button variant="outline" size="sm">` 之类），需要什么就往 `@/components/ui/*` 引。
**不要读它们的内部实现，也不要手改**——要加/换组件就用 shadcn CLI 生成，然后 `frozen:update`。
自己写的界面组件（`NoteList.tsx`、`LiteratureView.tsx`…）不在冻结里，随便改。

### csl-data（全冻结）

`styles.ts` 里是三个常量：`GB_CSL_XML`（GB/T 7714-2015 顺序编码制）、`APA_CSL_XML`、`ZH_CN_LOCALE_XML`。
`styles.ts` 由 `scripts/gen-csl-ts.mjs` 生成，手改会被覆盖。换样式：改 `*.csl` → 跑生成脚本 → `frozen:update`。
消费方是 `src/lib/copyCitation.ts`（不在冻结里）。

### editor-runtime（全冻结）

`public/vditor/dist/**` 是第三方（Vditor + highlight.js 等）运行时资源，随 `index.html` 静态加载。
使用方是 `src/components/WysiwygEditor.tsx`（不在冻结里）——编辑器接线、事件过滤、双链渲染都在那边改。
升级 Vditor = 换这套资源 + `frozen:update`。不要在 vendor 文件里打补丁。

### md-parser（全冻结）

契约（`src/lib/md.ts`）：

```
parseMarkdown(src: string, ctx?: ParseContext): Block[]
parseInline(src: string, ctx?: ParseContext): Inline[]
splitRow(line: string): string[]
```

契约（`src/lib/tex.ts`）：`parseTex(src) → Tex[] | null`（不认识就返回 `null`，调用方退回显示源码）、
`texIsTall(nodes) → boolean`。AST 类型 `Align / Inline / Block / ListItem / DefItem / FootnoteItem / TocItem / Tex` 也在契约内。

支持的语法清单见 [MARKDOWN_RENDERER.md](MARKDOWN_RENDERER.md)——**要确认某个写法支不支持，看那张表，不要读解析器**。
不保证的是：AST 里字段以外的内部结构、辅助函数、正则实现。守护测试 `scripts/md-selftest.mjs`（136 项，含真实笔记冒烟）。

### md-render（全冻结）

契约：`Markdown`（named export，props `content / notes / onOpenNote / onCreateNote`）、
`previewCss(theme, customCss) → string`、`MARKDOWN_BASE_CSS`、`themeStyles`。
渲染出的 **Typora 兼容类名**（`.md-fences`、`.md-meta-block`、`.md-task-list-item`、`.md-footnote`、`.md-toc`、`.mathjax-block`）
是契约的一部分：主题 CSS 靠它命中，改类名等于破坏主题。挂载与 Shadow DOM 在 `PreviewContent.tsx`（不在冻结里）。
`src/themes/vue-light.css`、`vue-night.css` 由 `scripts/prepare-vue-theme.mjs` 从 `src/themes/vendor/` 生成：重生成后 `frozen:update`。

### vault-format（契约冻结）

最重要的黑箱：**磁盘格式的唯一出入口**。契约 = [VAULT_FORMAT.md](VAULT_FORMAT.md) 里那张 front matter 字段表
+ `vaultFormat.ts` 的 26 个导出名。必须一直成立的三条：

1. `md` 是唯一事实来源，`meta.json` 只是索引（丢了能靠 front matter 还原）；
2. **回写必须保留不认识的 front matter 字段**（2026-10-13 真丢过 `zoteroKeys`）；
3. `planVaultWrite` 的删除数必须为 0；未纳管的 md 一律不碰。

加字段：改读写两侧 → 跑 `npm run test:frozen` → `frozen:update` → 更新 VAULT_FORMAT.md 字段表 → 让用户强刷网页端。

### vault-gate（契约冻结）

契约 = `vaultGate.ts` 的导出名 + [VAULT_WRITE_GATE.md](VAULT_WRITE_GATE.md) 的判定规则：声明
（`formatVersion` / `minimumWriterVersion` / `requiredCapabilities`）怎么读、什么情况下只读（单篇 / 整库），
以及写盘计划必须满足的四条红线 —— **未知字段保留、删除数 0、未纳管 md 不动、索引读不到就中止**。
守护测试 `test:vault-gate`（43 项，含 2026-10-13 事故的复现）。

`vaultFormat` 的序列化与主进程 `writeVault` 都调它。**能力名 = front matter 字段名**，加字段就加能力
（`CAPABILITY_FIELDS`），加能力的笔记才会被打上声明。

### vault-io（契约冻结）

契约 = 三个模块的导出名（含 `LITERATURE_BATCH_SIZE = 64`、`VaultLoadGate`、`readVaultBatch`）。
它们只是**封装层**：真正落盘由 `desktop-bridge` 的 `vault:write` 完成（主进程侧做路径校验）。
浏览器/网页端模式下同一套调用走本地网页桥。

### zotero-rules（契约冻结）

契约 = AGENTS.md「文献数据模型」那 7 条不变量 + 三个模块的导出名。
界面「同步 Zotero 分类」、命令行 `zotero:sync`、命令行 `dedupe:vault` **共用这套规则，改一处必须三处一致**。
典型公式：`coalesceZoteroItems` 归并 → `mergeLiterature`/`planZoteroImport` 产出计划 → 调用方应用。
「去重后再次同步必须 0 新建」是硬门槛（`test:zotero-e2e` 第 4 步）。
分类只由 `collections`（完整路径的树）承担；旧版压平写入的 `方向:<一级分类>` 标签已废弃
（识别用 `isDirectionTag` / `DIRECTION_TAG_PREFIX`），同步与去重一律清掉、不再产出；全库一次性清理入口
`npm run tags:strip-direction`（dry-run 默认，`--apply` 先逐文件备份）。

### desktop-bridge（契约冻结）

契约 = `window.knowledgeGraphDesktop` 的方法与 IPC 通道名，类型来源是 `src/types/desktop.d.ts`。
校验脚本会交叉检查「d.ts 声明的必选方法 ↔ `electron/preload.cjs` 实际暴露」，两边不一致就失败。
改契约 = 同时动 `preload.cjs` + `desktop.d.ts`（+ 主进程 handler）+ `frozen:update`。
主进程脚本里的其余实现（窗口管理、安全头、路径白名单）是黑箱：**排查问题时才读，功能开发只用上面的方法**。

2026-10-23 新增只读方法 `readZoteroMarkup(dbPath, zoteroKey, zoteroKeys?)`（IPC `zotero:read-markup`，
网页桥同名 action）：标注 → PDF 附件 → 书目的关联、子笔记、跳过计数。附件归属只由主进程/本机服务解析，
页面不能传附件路径；查询失败会抛错，不会用空结果冒充成功。用法与 sidecar 格式见 [ZOTERO_MARKUP.md](ZOTERO_MARKUP.md)。

2026-10-23 新增写入方法 `zoteroLocalApi(request)`（IPC `zotero:local-api`，网页桥同名 action），
`action` 为 `status` / `authorize` / `write`：只连 `127.0.0.1:23119` 的 Zotero 10+ 本地写入 API，
把本软件画的高亮**新建**成 annotation 条目（只增，不删改 Zotero 已有对象）。
本地密钥只缓存在宿主进程内存，渲染端拿不到；单次密钥失效（401）由调用方重新授权后重试一次。
设计、坐标来源与限制见 [ZOTERO_MARKUP.md](ZOTERO_MARKUP.md) 第 7 节。

### note-store（契约冻结）

契约 = `src/types/note.ts` 与 `src/lib/noteStore.ts` 的导出名：`Note` / `LiteratureMeta` / `NoteType` 等数据模型、
`NOTE_TYPE_META` / `GRADE_META` 常量，以及纯数据操作（`readCachedNotes` / `createNotesFrom` / `patchNotes` /
`mergeNotesByTitle` / `sanitizeIncomingNotes` / `noteEdges` 等）。注意：锁的是**导出名**，接口字段的增删不被锁，
但数据模型字段变动必须同步 `vaultFormat` 的读写（字段 = 能力，见 vault-gate）。
守护测试 `test:use-notes` 用真实临时 vault 驱动真实 hook，行为回归覆盖这些纯函数。

### md-import（契约冻结）

契约 = `src/lib/mdImport.ts` 的导出名 + 两条硬规则：**YAML 标量必须剥外层引号**
（`title: "…"` / `tags: ["…"]`，否则引号会进正文、落盘后双重转义）；CRLF / BOM / 单引号 / 块状 tags 都要认。
守护测试 `test:md-import`（8 项）。

### math-pipeline（契约冻结）

契约 = 两个模块的导出名：`prepareMathMarkdown` 把 `$…$` / `$$…$$` / `\(...\)` / 数学环境抽成
`KGMATHPLACEHOLDER<n>END`（代码围栏与货币金额不误判、未闭合块不吞后文），
`katexRuntime` 的 `hydrateMath` / `installKatexStyles` / `hydrateVditorMath` 负责在预览与编辑器里水合。
消费方是 `PreviewContent.tsx` / `WysiwygEditor.tsx`（不在冻结里，动态 import 接入）。
守护测试 `test:math`（7 项，真实截图回归 + KaTeX 全量渲染）。

### lit-view-logic（契约冻结）

契约 = `src/components/literature/` 下 5 个纯模块的导出名：`collectionTree`（建树与子树唯一篇数计数）、
`literatureQuery`（筛选 → 排序 → 150 行分页）、`pdfCell`（PDF 徽标判定）、`importInput`（DOI/arXiv/Bib/RIS 输入识别）、
`zoteroSyncFlow`（同步对话框流程）。**改规则改这里的纯模块，别把分支写回组件**——组件（`LiteratureTable.tsx` 等）
不在冻结里。守护测试 `test:lit-view`（62 项纯逻辑 + SSR）与 `test:lit-dom`（45 项无头 Chrome 真实点击）。

### citation-copy（契约冻结）

契约 = `copyCitationFor`（GB/T 7714 / APA / BibTeX 三格式进剪贴板）与 `rtfField` 的 RTF 域代码函数
（`buildCitationFieldRtf` / `bibliographyRtfFromText` / `buildClipboardParts` / `writeCitationClipboard` /
`writeBibliographyClipboard`）：产物必须是 Word 可更新的真实域（`ADDIN ZOTERO_ITEM`，与 Zotero 兼容，
Alt+F9 可见域代码）。守护测试 `test:lit` 的 H 组（8 项，含转义快照与多 key 选取）。

### pdf-source（契约冻结）

契约 = PDF 打开优先级链（`preferredPdfSource` / `externalPdfSource`）：`localPdf` → Zotero 多 key 回退 →
`localPdfFallback` 按标题的内存兜底（并列不猜、一份 PDF 只归一篇、不落盘，「记到这篇笔记」才写 `localPdf`）；
附件不算外部来源。另含字节缓存（`loadPdfSourceCached`）与标注仓库 id（`annotationStoreId`）。
守护测试 `test:lit-view`（徽标与来源优先级）与 `test:web`（服务端 `--pdf-root` 授权与协议 URL）。

### ai-chat（契约冻结）

契约 = `aiChat.ts`（`noteContextFor` 上下文装配：不附 / 当前笔记 / 当前笔记+双链反链、60k 截断；
`trimChatHistory` 只留最近 20 条）与 `aiPrompts.ts`（任务模板与 `汇总:` 标签前缀）。
**自由提问只读**——这里没有任何写盘路径。守护测试 `test:ai-chat`（14 项）。

### capabilities（契约冻结）

契约 = `env.ts`（运行环境判定）、`capabilities.ts`（桥 / 触摸 / 存储能力检测）与 `degrade.ts`（降级决策）的
导出名；降级口径见 [MOBILE_PHASE1_REPORT.md](MOBILE_PHASE1_REPORT.md)。守护测试 `test:mobile`
（325 项，无头 Chrome 六档宽度 × 有桥/无桥）——较重，日常回归可只跑 `frozen:check`，改动本单元时才需要全量。

## 解冻流程

1. 先确认真的必须改（顺手重构、格式化、"顺便优化"都不算）。
2. 改完跑 `npm run test:frozen`，守护测试必须全绿。
3. `npm run frozen:update -- "vault-format 增加 localPdf 字段"`——重新锁定，理由进 `frozen.json` 的 history。
4. 同步契约文档（本页对应单元 / `VAULT_FORMAT.md` / `MARKDOWN_RENDERER.md` / `desktop.d.ts`），
   并在下面的「变更记录」补一行。

## 不冻结的部分（边界）

界面与交互（`App.tsx`、`useNotes.ts`、`GraphView.tsx`、`NoteEditor.tsx`、`NoteList.tsx`、`LiteratureView.tsx`、`PdfViewer.tsx`、
`src/components/literature/` 的组件与 `useLiteratureQuery.ts`）、样式（`index.css`、`App.css`）、
正在校准的模块（`literature.ts`、`attachments.ts`、`pdfAnchor.ts`、`pdfMatch.ts`、`aiOps.ts`、`litCluster.ts`、`graphModel.ts`、
`graphPhysics.ts`、`topicLinks.ts`、`titleClean.ts`、`pwa.ts`、`inlinePdfPanel.ts`）、`scripts/**` 与文档。
原则：**改动频繁或还没定型的，不冻**——冻结只用来保护"已经不需要再看"的东西。

## 变更记录

- 2026-10-14：首次建立基线，9 个单元（5 全冻结 + 4 契约冻结），校验与解冻流程就位。
- 2026-10-14：desktop-bridge 增加只读 PDF 字节接口，供全屏阅读工作台读取 localPdf / Zotero PDF。
- 2026-10-15：新增 `vault-gate` 单元；`vault-format` 增加写入门禁（声明字段、未知字段保留、只读笔记不写不删
  不改名、meta 声明超限整库停写），`desktop-bridge` 的 `writeVault` 增加落盘前最后一道防线。设计与已知缺口见
  [VAULT_WRITE_GATE.md](VAULT_WRITE_GATE.md)；打标策略 B（只有带能力数据的笔记才写声明，升级零重写）。
- 2026-10-16：`zotero-rules` 新增导出 `DIRECTION_TAG_PREFIX` / `isDirectionTag`，并**废弃「方向:」标签**：
  `tagsForZoteroItem` 只产出 `期刊:`/`年份:`，`mergeZoteroTags` 清掉全部 `方向:`（含历史「方向:未分类」占位），
  `zotero:sync --prune` 同步收口。理由：分类树只该存在 `collections` 里，压平副本会漂移 —— 真实库实测
  454 篇界面「未分类」却仍挂着 `方向:01_论文库`。全库一次性清理：`npm run tags:strip-direction`
  （真实 vault 已跑：1775 篇 / 1948 条，逐文件备份 `.backups/direction-tags-20261016100738`）。
  AI 面板的「方向」选项改从 `collections` 首段取，汇总笔记标签改用 `汇总:<一级分类>`。
- 2026-10-19：`desktop-bridge` 的 AI 网关扩展为双提供方（`kimi` / `deepseek`），
  `aiStatus` 改为接收 `{ provider, configPath? }`，`aiComplete` 增加 `messages`（多轮）
  与 `model` 参数；网页桥接同步。方法名与 IPC 通道名不变，网页端 56 项回归仍全绿。
- 2026-10-19：**扩容到 18 个单元**：首版发布后在真实库上稳定运行的 8 组模块纳入契约冻结 ——
  `note-store`（数据模型与纯数据操作）、`md-import`、`math-pipeline`、`lit-view-logic`、
  `citation-copy`（rtfField 从「正在校准」毕业）、`pdf-source`、`ai-chat`、`capabilities`。
  全部为 tier 2（锁导出名 + 守护测试），实现仍可改。新单元守护测试当日全绿：
  test:md-import 8、test:math 7、test:ai-chat 14、test:lit 48、test:lit-view 62、test:lit-dom 45、
  test:use-notes 10、test:web 56、test:mobile 325。
  顺带修了 `test:math` 的行尾脆弱性：夹具在 `core.autocrlf=true` 的 Windows 签出成 CRLF 会误挂，
  现在读入时先归一成 LF。
- 2026-10-23：`desktop-bridge` 增加只读 `readZoteroMarkup`（27→28 个方法、24→25 个 IPC 通道），
  用于导入单篇文献的 Zotero 高亮与子笔记。**只读**：不写 Zotero、不改 front matter、不复制 PDF；
  标注镜像存独立的 `attachments/<storeId>.zotero.json`，与本软件自己的 `.annotations.json` 分开。
  设计与已知限制见 [ZOTERO_MARKUP.md](ZOTERO_MARKUP.md)；新增 `test:zotero-markup`（58 项）、
  `test:zotero-panel`（17 项），`test:zotero` 扩到 40 项、`test:web` 扩到 72 项。
- 2026-10-23（同日第二版）：`desktop-bridge` 增加 `zoteroLocalApi`（28→29 个方法、25→26 个 IPC 通道），
  走 Zotero 10+ 本地写入 API 把本软件画的高亮**回写**成 annotation（只增；不删、不改 Zotero 已有对象）。
  高亮在创建时记下 PDF 坐标 / `pageLabel` / `sortIndex`（`.annotations.json` 的可选字段，向后兼容），
  回写成功后把返回的 key 记回本地标注，重新同步时按 key 去重；本地 API 密钥只留在宿主进程内存。
  新增 `test:zotero-writeback`（41 项）与 `test:zotero-local-api`（28 项，假 Zotero 服务器），
  `test:web` 扩到 75 项。细节见 [ZOTERO_MARKUP.md](ZOTERO_MARKUP.md) 第 7 节。
