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
| `vault-format` | 契约冻结 | `src/lib/vaultFormat.ts` | front matter 读写与写入计划 | `test:vault`、`test:vault-e2e` |
| `vault-io` | 契约冻结 | `src/lib/vaultFs.ts`、`src/lib/vaultLoad.ts`、`src/lib/syncFile.ts` | vault 读写通道与同步文件封装 | `test:vault-e2e` |
| `zotero-rules` | 契约冻结 | `src/lib/zoteroMeta.ts`、`src/lib/zoteroImport.ts`、`src/lib/zoteroSync.ts` | Zotero 分类/标签/去重/导入规则 | `test:zotero`、`test:zotero-import`、`test:zotero-e2e` |
| `desktop-bridge` | 契约冻结 | `electron/*.cjs`、`src/types/desktop.d.ts` | 页面 ↔ 主进程的 27 个方法 + 24 个 IPC 通道 | 契约交叉校验（内置） |

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

### vault-io（契约冻结）

契约 = 三个模块的导出名（含 `LITERATURE_BATCH_SIZE = 64`、`VaultLoadGate`、`readVaultBatch`）。
它们只是**封装层**：真正落盘由 `desktop-bridge` 的 `vault:write` 完成（主进程侧做路径校验）。
浏览器/网页端模式下同一套调用走本地网页桥。

### zotero-rules（契约冻结）

契约 = AGENTS.md「文献数据模型」那 7 条不变量 + 三个模块的导出名。
界面「同步 Zotero 分类」、命令行 `zotero:sync`、命令行 `dedupe:vault` **共用这套规则，改一处必须三处一致**。
典型公式：`coalesceZoteroItems` 归并 → `mergeLiterature`/`planZoteroImport` 产出计划 → 调用方应用。
「去重后再次同步必须 0 新建」是硬门槛（`test:zotero-e2e` 第 4 步）。

### desktop-bridge（契约冻结）

契约 = `window.knowledgeGraphDesktop` 的方法与 IPC 通道名，类型来源是 `src/types/desktop.d.ts`。
校验脚本会交叉检查「d.ts 声明的必选方法 ↔ `electron/preload.cjs` 实际暴露」，两边不一致就失败。
改契约 = 同时动 `preload.cjs` + `desktop.d.ts`（+ 主进程 handler）+ `frozen:update`。
主进程脚本里的其余实现（窗口管理、安全头、路径白名单）是黑箱：**排查问题时才读，功能开发只用上面的方法**。

## 解冻流程

1. 先确认真的必须改（顺手重构、格式化、"顺便优化"都不算）。
2. 改完跑 `npm run test:frozen`，守护测试必须全绿。
3. `npm run frozen:update -- "vault-format 增加 localPdf 字段"`——重新锁定，理由进 `frozen.json` 的 history。
4. 同步契约文档（本页对应单元 / `VAULT_FORMAT.md` / `MARKDOWN_RENDERER.md` / `desktop.d.ts`），
   并在下面的「变更记录」补一行。

## 不冻结的部分（边界）

界面与交互（`App.tsx`、`useNotes.ts`、`GraphView.tsx`、`NoteEditor.tsx`、`NoteList.tsx`、`LiteratureView.tsx`、`PdfViewer.tsx`）、
样式（`index.css`、`App.css`）、正在校准的模块（`literature.ts`、`attachments.ts`、`pdfAnchor.ts`、`pdfMatch.ts`、`aiOps.ts`、`rtfField.ts`）、
`scripts/**` 与文档。原则：**改动频繁或还没定型的，不冻**——冻结只用来保护"已经不需要再看"的东西。

## 变更记录

- 2026-10-14：首次建立基线，9 个单元（5 全冻结 + 4 契约冻结），校验与解冻流程就位。
- 2026-10-14：desktop-bridge 增加只读 PDF 字节接口，供全屏阅读工作台读取 localPdf / Zotero PDF。
