# 文献功能开发规范（交接给实现者）

> 目标：在本应用（本地优先 Markdown 笔记 + 知识图谱，Electron + React 19 + TS + Vite）
> 中加入 Zotero 的核心能力：**文献库管理、PDF 阅读与划词标注、基于剪贴板的 Word 引用**
> （含真域代码）。分四个 Phase，每个 Phase 独立可交付、独立验收。
>
> 实现者请先完整阅读本文件，再按 Phase 顺序实施。**每完成一个 Phase 必须跑通全部
> 测试与构建，然后暂停等待人工验收，得到确认后再进入下一个 Phase。**

---

## 0. 背景速览（不要跳过）

应用现状：

- 桌面版（Electron）把笔记存为用户自选 vault 目录里的「每篇一个 `.md` + 根目录
  `meta.json` 索引」；浏览器版退化到 localStorage。
- **md 是唯一事实来源**：frontmatter 存全部元数据，正文是 Markdown，支持 `[[双链]]`、
  `#标签`。`meta.json` 只是索引，丢了能重建。
- 五种笔记类型（person/task/skill/question/other）各落一个子文件夹
  （`TYPE_FOLDERS`，见 `src/lib/vaultFormat.ts`）。
- 渲染进程**不直接碰磁盘**：一切文件读写通过 `window.knowledgeGraphDesktop`
  （preload 暴露）→ IPC → `electron/*.cjs`。新增文件能力必须走这个模式。
- 自研 Markdown 解析器（`src/lib/md.ts`）出于安全会剥掉 `<iframe>/<object>/<embed>` 等，
  **PDF 渲染必须用 PDF.js 画 canvas，不得放宽 sanitizer**。

### 必读文件清单（动手前全部读完）

| 文件 | 为什么必读 |
| --- | --- |
| `src/types/note.ts` | Note 类型、NOTE_TYPE_META（类型颜色/标签） |
| `src/lib/vaultFormat.ts` | frontmatter 序列化/解析、文件夹分配、写盘计划 |
| `src/lib/vaultFs.ts` + `src/types/desktop.d.ts` | 渲染进程侧的文件访问封装与类型声明 |
| `electron/main.cjs` / `preload.cjs` / `vaultFs.cjs` | IPC 三层结构与路径安全（normalizeRel/resolveInside） |
| `src/hooks/useNotes.ts` | 笔记状态、vault 账本、外部改动轮询 |
| `src/lib/syncFile.ts` | 同步 JSON 的序列化/解析（stable canon） |
| `scripts/vault-selftest.ts` | 自测写法（esbuild 打 CJS 后用 node 跑） |
| `docs/VAULT_FORMAT.md` | 存储格式文档（改格式必须同步改它） |

### 铁律（违反任何一条视为返工）

1. **md 是唯一事实来源**。PDF 等二进制走 `attachments/` 目录，元数据（作者/DOI/引用键等）
   进 frontmatter，同步 JSON 只同步元数据不同步 PDF 本体。
2. **不放宽 `src/lib/md.ts` 的 sanitizer**；不引入 `<iframe>/<object>/<embed>` 展示 PDF。
3. 新文件能力必须：渲染进程 API（`src/lib/`）→ preload 白名单 → `ipcMain.handle` →
   `electron/*.cjs`，路径校验复用 `normalizeRel`/`resolveInside` 的同等强度，
   只允许访问 vault 内 `attachments/` 目录。
4. 开发版/正式版隔离（`IS_DEV`、`kg-`/`kg-dev-` 前缀）不得破坏。
5. `npm run test:vault`、`npm run test:vault-e2e`、`npm run test:md` 全绿，
   `npm run build`（含 `tsc -b`）无错，`npm run lint` 无新增告警。
6. 代码注释与 UI 文案用中文，风格与现有代码一致；Electron 侧文件保持 `.cjs`。
7. 旧 vault 向前兼容：旧目录没有文献相关字段/文件夹时必须原样工作，不得强制迁移。
8. 浏览器版降级优雅：文件附件相关 UI 显示「仅桌面版可用」，核心笔记功能不受影响。

---

## Phase 0 — 数据模型：文献类型（预计 2~3 天）

### 目标

新增笔记类型 `literature`（文献），frontmatter 扩展文献元数据字段，全流程
（创建/编辑/保存/读回/同步/改名/换类型/图谱）可用。

### 任务

1. **`src/types/note.ts`**
   - `NoteType` 增加 `'literature'`。
   - 新增接口：
     ```ts
     export interface LiteratureMeta {
       authors: string[]      // 全名，如 ["Zhang, San", "Li, Si"]
       venue: string          // 期刊/会议名，可为空
       year: number | ''      // 发表年
       doi: string            // 可为空
       citekey: string        // 引用键，如 zhang2024silicon；库内唯一
       attachments: string[]  // 附件 id 列表，见 Phase 2；Phase 0 先落字段
     }
     ```
   - `Note` 增加可选字段 `literature?: LiteratureMeta`（仅 type === 'literature' 时有值）。
   - `NOTE_TYPE_META` 增加 `literature: { label: '文献', color: '#2aa1a8', bg: 'rgba(42,161,168,0.14)' }`
     （青色系，与现有五色可区分）。
   - `TYPE_FOLDERS`（`vaultFormat.ts`）增加 `literature: '文献'`。

2. **`src/lib/vaultFormat.ts`**
   - `toMarkdown`：type 为 literature 且 `note.literature` 存在时，frontmatter 追加
     （全部单行 JSON 或既有数组写法，与 `tags` 同款）：
     ```
     authors: ["Zhang, San", "Li, Si"]
     venue: "Nature Photonics"
     year: 2024
     doi: "10.1038/s41566-024-xxxx"
     citekey: "zhang2024silicon"
     attachments: []
     ```
     空数组/空字符串**也写出来**（字段稳定存在，解析端简单）；`year` 为空写 `year: ""`。
   - `parseNoteMarkdown`：解析上述字段（复用现有的 `parseTagValue` 解析数组风格
     `authors`；`year` 转 number，非数字置 `''`；`doi`/`venue`/`citekey` 走 `stripQuotes`）。
     解析结果挂到 `note.literature`（缺字段时用空值补齐完整对象）。
     **非 literature 类型的 md 即使带这些字段也不挂 literature**（按 type 判断）。
   - `needsRewrite` 判定逻辑不变（文献字段缺失不触发 rewrite，允许用户手写 md 不带这些字段）。

3. **`src/lib/syncFile.ts`**
   - `canonNote` 增加 `literature` 字段（位置固定在 `grade` 之后、`tags` 之前，
     保持 stable 序列化）；值为 `undefined` 时**不输出该键**（旧数据序列化结果不变）。
   - `parseNotes`：容错解析 `literature` 对象（字段类型逐个校验，坏字段回空值）。

4. **UI 接线**
   - `NoteEditor.tsx`：类型选择器自动带出新类型（若它是遍历 `NOTE_TYPE_META` 则零改动，
     确认即可）；type 切到 `literature` 时显示文献元数据编辑区（作者一行一个、venue、
     year、doi、citekey 只读自动生成 + 手动改按钮），切走时不显示。
   - citekey 生成规则：`第一作者姓小写 + year + 标题首词小写`，如 `zhang2024silicon`；
     库内撞名时追加 `b/c/d…`。生成逻辑放 `src/lib/citekey.ts` 并导出纯函数
     `makeCitekey(lit, title, existing: Set<string>)`。
   - `FolderMoveDialog`（改类型迁移）与图谱筛选：确认新类型自动生效；不生效则按现有
     模式的同样方式补一行。

5. **测试**
   - `scripts/vault-selftest.ts` 新增用例（仿照现有 `check(...)` 写法）：
     - literature 笔记 `toMarkdown` → `parseNoteMarkdown` 往返，六个字段全部还原；
     - 旧格式 md（无文献字段）解析后 `literature` 为 undefined，序列化结果与旧版逐字节一致；
     - `assignFileNames` 中 literature 笔记落 `文献/` 文件夹；
     - citekey 生成与撞名追加。

### 验收

- `npm run test:vault` 全绿（新增用例 ≥ 4）。
- `npm run build` + `npm run lint` 通过。
- 开发版手动验证：新建文献笔记 → 填元数据 → 重启应用（或切目录重载）→ 字段完整还原；
  在 Obsidian 里手改 frontmatter 字段 → 应用跟随目录改动正确读回。
- `docs/VAULT_FORMAT.md` 增补文献类型与字段说明。

---

## Phase 1 — 文献库与引用复制（预计 1 周）

### 目标

文献列表视图；DOI/arXiv 元数据导入；BibTeX/RIS 导入；一键复制引用
（GB/T 7714、APA、BibTeX）。

### 依赖

- `citation-js`（主包即可，含 core + 常用 plugin；锁定版本写入 package.json）。
- 从官方 CSL style 仓库取两个样式文件存到 `src/lib/csl/`：
  - `gb-t-7714-2015-numeric-bilan.csl`（国标顺序编码制）
  - `apa.csl`
  （实现者自行下载并核对许可证为 CC-BY-SA / 无限制，文件头注释写明来源 URL。）

### 任务

1. **`src/lib/literature.ts`**（纯函数模块，便于单测）
   - `litToCSL(note): object` —— Note.literature → CSL-JSON（id 用 citekey，
     author 解析为 CSL creator 结构 `"Zhang, San"` → `{family:'Zhang', given:'San'}`，
     已带逗号按逗号切，否则整个作为 family）。
   - `importFromDoi(doi): Promise<Partial<LiteratureMeta> & {title...}>` ——
     fetch `https://api.crossref.org/works/{encodeURIComponent(doi)}`，
     失败时回退 `https://api.datacite.org/dois/{doi}`。解析出
     title/authors/venue(DOI 的 container-title)/year/doi。网络错误抛中文错误信息。
   - `importFromArxiv(id)` —— fetch `https://export.arxiv.org/api/query?id_list=<id>`，
     XML 解析（DOMParser）标题/作者/摘要/年份；venue 填 `'arXiv:<id>'`。
   - `importFromBibtex(text)` / `importFromRis(text)` —— 调 citation-js
     （`Cite.parse` 或 `new Cite(text)`），取第一条的 CSL-JSON 转 LiteratureMeta。
   - `formatCitation(csl, styleId): string` —— 用 citation-js 的
     `citation-js/plugin-csl` + 内嵌样式文件输出单条引文（去掉前后包裹的
     bibliography 标签，只留条目文本）。
   - `formatBibliography(items: CSL[], styleId)` —— 多条 + 文献表头（按需）。

2. **文献视图**
   - `src/components/LiteratureView.tsx`：表格列出全部 literature 笔记
     （标题/第一作者 et al./年份/venue/citekey/标签），列头点击排序，
     顶部搜索框（标题+作者+venue 子串）。行点击打开对应笔记（复用现有打开逻辑）。
   - 在现有「笔记/图谱/并列」布局切换处增加「文献」入口；用 shadcn 现有 Table 组件。
   - 工具栏按钮：「按 DOI/arXiv 导入」（弹窗输入标识符，成功即创建 literature 笔记，
     自动 citekey）、「导入 BibTeX/RIS」（textarea 粘贴，支持多条，逐条创建，
     重复 citekey 自动追加后缀）。

3. **复制引用**
   - 每行（笔记编辑器文献区同）提供「复制引用」下拉：GB/T 7714、APA、BibTeX 三选一，
     走 `navigator.clipboard.writeText`，sonner toast 提示「已复制」。
   - BibTeX 输出用 citation-js 的 bibtex 输出格式，或直接自己拼
     `@article{citekey, ...}`（自拼更可控，推荐自拼，避免 citation-js 输出键名不可控）。

4. **测试**
   - 新增 `scripts/literature-selftest.ts` + package.json 脚本 `test:lit`
     （esbuild 打法照抄 vault-selftest；CrossRef/arXiv 网络请求**打桩**，
     用 fixture 字符串，不真实联网）。
   - 用例：CSL 转换（含 `"Family, Given"` 与 `"Family Given"` 两种作者写法）、
     citekey 规则、`formatCitation` 对 stub 样式的输出、BibTeX 自拼快照。

### 验收

- 断网状态下 `test:lit` 全绿；`test:vault` / `test:vault-e2e` / `test:md` 无回归。
- 手动验证：输入 `10.1038/s41586-020-2649-2` 能建成文献笔记并复制出国标引文；
  粘贴一段含 3 条的 BibTeX 能导入 3 篇且 citekey 不撞。
- 浏览器版同样可用（导入/复制全是网络+剪贴板，无文件访问）。

---

## Phase 2 — PDF 阅读与划词标注（预计 1.5~2 周，工作量最大）

### 目标

文献笔记可挂 PDF 附件；应用内阅读（翻页/缩放/文字选择/搜索）；划词高亮存盘、
可导出到笔记正文。

### 存储约定（写进 `docs/VAULT_FORMAT.md`）

```
<vault>/
  attachments/
    <附件id>.pdf                 ← 二进制，文件名即 id（保持原扩展名）
    <附件id>.annotations.json    ← 标注（JSON，见下）
```

- 附件 id 用现有 `uid()`。frontmatter `attachments: ["<id>"]` 只记 id，
  原始文件名另存在标注 JSON 顶部的 `fileName` 字段。
- 标注 JSON 结构：
  ```json
  {
    "format": "kaust-kg-pdf-annotations",
    "version": 1,
    "fileName": "原始文件名.pdf",
    "items": [
      {
        "id": "…", "page": 3, "color": "#ffd54a",
        "anchor": { "exact": "选中的原文", "prefix": "前文≤40字", "suffix": "后文≤40字" },
        "comment": "", "createdAt": 1728600000000
      }
    ]
  }
  ```
  锚定策略：记录页码 + exact + prefix/suffix；重新打开时先按 exact 匹配，
  匹配不到再 prefix+suffix 模糊找回（找不到就标记为「已失效」，不丢数据）。

### 任务

1. **Electron 侧**
   - `electron/vaultFs.cjs`：把 `normalizeRel`/`resolveInside` 导出（供下面复用）。
   - 新建 `electron/attachmentFs.cjs`：
     - `list(dir)`：列 `attachments/` 下全部文件的相对名与 mtime/size；
     - `read(dir, rel)`：返回二进制（`fs.readFile`；IPC 传 Buffer，preload 侧收到
       Uint8Array）；校验 rel 必须是 `attachments/` 内一层文件名（`^attachments/[^/]+$`）；
     - `write(dir, rel, data)`：原子写（复用 `writeFileAtomic` 同款临时文件+rename）；
     - `remove(dir, rel)`。
   - `electron/main.cjs` 注册 `attachments:list/read/write/remove` 四个 handler，
     参数校验风格照抄 `registerVaultHandlers`；另加 `attachments:choose-open` 与
     `attachments:choose-save` 两个原生对话框（打开选 pdf，保存选目标目录）。
   - `electron/preload.cjs` 白名单暴露；`src/types/desktop.d.ts` 补类型
     （二进制用 `Uint8Array`）。

2. **`src/lib/attachments.ts`**：渲染进程封装——
   `addPdfToVault(file: File): Promise<string>`（浏览器版无桌面 API 时抛
   「附件仅桌面版可用」）、`readPdf(id)`、`saveAnnotations(id, json)`、
   `readAnnotations(id)`、`removeAttachment(id)`。

3. **PDF 渲染 `src/components/PdfViewer.tsx`**
   - 依赖 `pdfjs-dist`；worker 用 Vite 的 `?url` 引入：
     ```ts
     import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
     pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl
     ```
   - canvas 渲染当前页 + pdfjs textLayer（可选中复制；划词高亮依赖它）。
   - 控件：上一页/下一页、页码输入、缩放（适应宽度/50%~300%）、文字搜索
     （pdfjs 自带 find controller 思路，自绘简单 UI）。
   - 虚拟滚动/双栏等高级排版**不做**，保持单页纵向。
   - props：`data: Uint8Array`、`annotations`、`onAddAnnotation(range, color)`、
     `onDeleteAnnotation(id)`。

4. **标注交互 `src/components/PdfAnnotator.tsx`**（可并入 PdfViewer）
   - 选中 textLayer 文字 → 弹出小色板（黄/绿/蓝/红/紫）→ 生成 anchor 存入
     annotations.json（防抖 500ms 写盘，风格与笔记写盘一致）。
   - 高亮渲染：按 anchor.exact 在 textLayer DOM 里二次定位加 `<span>` 底色；
     点击高亮显示评论框（可改评论/删高亮/「导出到笔记」）。
   - 「导出到笔记」：把 `> 高亮文本 — p.3 [附件名]` 追加到文献笔记正文末尾
     （走 `updateNote`，不要直接改文件）。

5. **UI 接线**
   - `NoteEditor.tsx`：文献笔记显示「附件」区——列表（文件名、大小、打开/删除）、
     「添加 PDF」按钮（`<input type="file" accept=".pdf">`，桌面版调
     `addPdfToVault`，选中后写入 `note.literature.attachments` 并 `updateNote`）。
   - 打开附件：用 `react-resizable-panels`（已在依赖）在笔记区右侧开 PDF 面板；
     浏览器版显示降级提示。
   - 删除附件：弹确认（AlertDialog），删文件 + 清 frontmatter 字段。

6. **测试**
   - `scripts/vault-selftest.ts` 增加附件路径安全用例：
     `attachments/../../x.pdf`、`attachments/a/b.pdf`、绝对路径必须被拒；
     原子写后读回一致；删除后 annotations 一并删除的行为（若实现级联删除）。
   - 标注锚定逻辑（exact 命中 / prefix+suffix 兜底 / 失效标记）抽成纯函数放
     `src/lib/pdfAnchor.ts` 并单测。

### 验收

- 桌面开发版手动全流程：添加 PDF → 关闭重开 → 划词高亮 → 重启应用 → 高亮与评论仍在；
  外部用 Obsidian 改同笔记 frontmatter 不丢附件引用；删除附件文件后 UI 显示「文件缺失」
  而不是崩溃。
- `npm run test:vault` 等全部自测绿；`npm run build` 通过（注意 pdfjs worker 的
  打包产物路径在 Electron `kg://` 协议下可用——这是本 Phase 最大风险点，
  先花最多半天验证最小 demo 再铺开）。
- 浏览器版：文献笔记正常显示，附件区显示「仅桌面版可用」。

---

## Phase 3 — 剪贴板引用（真域代码）（预计 1 周）

### 目标

复制 RTF 域代码到剪贴板，粘进 Word 得到**可更新的真实域**；
兼容 Zotero 域格式（`ADDIN ZOTERO_ITEM`），附带「复制参考文献表」。

### 任务

1. **`src/lib/rtfField.ts`**（纯函数 + 单测）
   - `buildCitationFieldRtf(cslItems, styleId, displayText): string`
     生成 RTF 1.6 字符串，核心结构：
     ```
     {\field{\*\fldinst{ ADDIN ZOTERO_ITEM
       {"citationItems":[{"id":citekey,"itemData":{<CSL-JSON>}}, ...],
        "properties":{"formattedCitation":"<displayText>"},
        "schema":"https://github.com/zotero/zotero/schema/citation.json# 0.1"}
     }{\fldrslt <displayText>}}}
     ```
     CSL-JSON 与 displayText 中的 RTF 特殊字符（`\ { }`、非 ASCII）按 RTF 规则转义
     （Unicode 用 `\uN?` 序列）。
   - `writeCitationClipboard(cslItems, styleId)`：优先
     `navigator.clipboard.write(new ClipboardItem({'text/rtf': rtfBlob, 'text/plain': plainBlob}))`，
     失败（权限/不支持）回退纯文本并 toast 说明「当前为纯文本引用」。
   - 上标数字样式（GB/T 7714）的 displayText 在 RTF 里用 `{\super [1]}` 实现。

2. **UI**
   - 文献视图每行与编辑器文献区增加「插入 Word 引用」按钮 = 复制域代码；
   - 「复制参考文献表」按钮：把当前视图筛出的文献按所选样式排成完整文献表
     （GB/T 7714 带 `[1] [2]` 编号）复制为 RTF 富文本 + 纯文本双格式。

3. **测试**
   - `scripts/literature-selftest.ts` 增加 RTF 生成用例：
     域指令含合法 JSON、特殊字符转义快照、多作者多条拼接；
     ClipboardItem 构造逻辑打桩验证内容类型 fallback。
   - 人工验证清单写进 PR 描述：粘到 Word → 右键域 → 「切换域代码」可见
     `ADDIN ZOTERO_ITEM`；Zotero 装插件的机器上该域可被 Zotero 识别刷新。

### 验收

- 自测全绿；Word 2016+（及 WPS）粘贴后显示引文、Alt+F9 可见域代码；
- 浏览器版同样可用（纯剪贴板能力）。

---

## 通用要求

- **提交节奏**：每个 Phase 一个 commit（或少量逻辑提交），commit message 中文、
  注明 Phase；不夹带与当前 Phase 无关的重构。
- **文档**：每个 Phase 同步更新 `docs/VAULT_FORMAT.md`（attachments/ 目录、
  文献 frontmatter 字段、标注 JSON），最后统一更新 `README.md` 功能列表。
- **禁止事项**：不改 sanitizer；不给渲染进程开 nodeIntegration；不引入新字体/
  外部 CDN 资源；PDF.js worker 必须本地打包；不在渲染进程直接 `fetch` 本地文件。
- 网络请求只在 Phase 1 的导入模块里出现（CrossRef/arXiv/DataCite 三个域名），
  其余功能必须离线可用。

## 完成定义（全部 Phase 结束后）

1. `npm run test:vault && npm run test:vault-e2e && npm run test:md && npm run test:lit`
   全绿；`npm run build && npm run lint` 干净。
2. `npm run release:portable` 能打出免安装 exe 并写入 `release/` 版本目录。
3. 人工过一遍四 Phase 各自的「验收」清单。
