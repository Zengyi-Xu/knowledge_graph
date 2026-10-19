# v1.2.1 本地网页端

## 使用

双击项目根目录的 `启动网页端.wsf`，在默认浏览器打开 `http://127.0.0.1:4173`，桌面不会留下命令窗口。
服务在后台运行，关闭它请双击 `停止网页端.wsf`。如果服务已在运行，启动脚本会打开已有网页。
需要看实时输出或排查问题时，双击 `启动网页端.cmd`（窗口版：使用期间保留窗口，关窗口即停止服务）。

也可在项目目录运行：

```powershell
npm run build
npm run web:local -- --vault "D:\Notes\KnowledgeGraph" --zotero-db "%APPDATA%\Zotero\Zotero\zotero.sqlite" --pdf-root "D:\Papers"
```

## 本地笔记库

启动脚本优先使用已有的 `D:\BaiduSyncdisk\Bibliotx\Vault`，否则使用已有的
`%USERPROFILE%\Documents\知识图谱`；两者都不存在时在网页内选择目录，不自动创建空库。
Zotero 优先使用 `D:\BaiduSyncdisk\Bibliotx\Zotero\zotero.sqlite`，再尝试 `%APPDATA%` 下的库。
已有的 Literature、Archive、Inform 和 Zotero storage 目录会作为本地 PDF 目录授权。
也可先设置 `KG_VAULT_DIR` 与
`KG_ZOTERO_DB` 环境变量。网页顶栏显示当前完整路径，切换库用「选择目录」输入已有目录的绝对路径。

笔记仍保存为原目录里的 `.md` 和 `meta.json`，人物、项目、技能、学习、其他、文献文件夹继续保留。
附件保存在 `attachments/`；JSON 同步快照保存在 `sync/notes.json` 或用户选择的本地 JSON 文件。
网页设置由当前浏览器保存，笔记正文由本地服务直接读写 vault。
应用保留 Zotero 数据库只读访问、附件/PDF/标注与双向文件同步能力。

## 文献表

- **打开 PDF**：点「PDF」徽标进入全屏双栏阅读工作台；左侧阅读 PDF，右侧编辑/预览笔记。选中原文后点「链接到笔记」，会插入带页码的摘录；点击笔记中的链接可跳回原页和高亮。也可点「系统阅读器」。PDF 来源优先使用 `localPdf`，否则按 Zotero key 解析（多 key 回退）。
  打开动作不经过 `cmd start`，Windows 上直接 `explorer.exe <文件>`，文件名含 `&`、括号也不会被解释。
  本机没有这份 PDF 时，PDF 列显示「文件不在本机 · 在 Zotero 打开」，点它会用 `zotero://select/library/items/<key>` 跳到 Zotero 并选中该条目（Zotero 会按需下载附件）。
- **本地 PDF 匹配**：笔记标题/Zotero 附件名 → 在指定目录里搜 PDF，命中后把路径写进 `literature.localPdf`（只记路径，不复制不移动文件）：
  ```powershell
  npm run pdf:link -- --vault "<vault>"                    # dry-run：逐条预览
  npm run pdf:link -- --vault "<vault>" --report <file>    # JSON 报告
  npm run pdf:link -- --vault "<vault>" --search "D:\某目录"   # 追加搜索目录（可多次）
  npm run pdf:link -- --vault "<vault>" --apply            # 写盘（先备份改动文件）
  ```
  匹配优先级：Zotero 附件文件名（换了附件 key 也能认回）> 标题完全相同 > 前缀包含 > 词集相似（默认阈值 0.92，--loose 降到 0.70）；同一份 PDF 只归一篇。
- **打开时的兜底匹配（`pdf:match-titles`）**：`localPdf` 与 Zotero 都没命中的文献，文献表自动把它们交给本机服务，
  由它在授权目录（`--pdf-root`）里按文件名保守匹配（`scripts/pdf-match.mjs`，同一分数并列就不猜）。
  命中后 PDF 徽标直接可读，详情页附件区显示「匹配到的本地 PDF」+ 一个「记到这篇笔记」按钮
  —— 点一下才写进 `literature.localPdf`；不点是纯内存状态，不改任何文件。这样即使字段被旧客户端抹掉，
  论文和 PDF 都还在本机时界面也不会一片空白。桌面版没有这个方法，自动跳过。
- **网页端打开 localPdf**：需要把它的上级目录用 `--pdf-root` 授权；未授权的路径会被服务端拒绝。
- **筛选**：分类（含「未分类」）、期刊/会议、年份范围、「有本地 PDF」开关；分类计数按真实分类统计。
- **未分类是动态状态**：只有「没有任何真实分类」才显示未分类，`collections` 里不写「未分类」，标签里也不写分类（旧版压平的「方向:」标签已废弃，同步时会清掉）。
  历史数据在同步/去重时自动清理。
- **表格宽度**：「标签」列默认隐藏，可随时用「标签列」按钮打开；引用相关操作收进行尾「⋮」菜单。
- **渲染**：一次渲染 150 行，底部「显示更多」按需追加，避免上千行一次挂载。
- **标题清洗**（仅显示层，不改数据）：解 HTML 实体、去 `<sub>` 等内联标签、去 `$…$` 定界符（含反斜杠的 LaTeX 保持原样）、去站点尾缀。

本地服务仅监听 `127.0.0.1`，文件接口校验页面来源、Host 和每次启动生成的访问令牌；外部网站不能直接调用。
DOI/arXiv 导入与手动 AI 调用沿用原功能的网络请求。普通笔记读取和编辑在本机完成。
更换浏览器时重新选择同一个 vault 即可；浏览器设置与旧 Electron 设置互相独立。

## 启动与写盘保护

首先读取索引和普通笔记，文献正文在界面出现后按批次加载，文件读取最多 32 个并发。
图谱、文献视图、引用引擎、AI 面板、PDF 和新编辑器均按需加载。

文献尚未完整加载时，可编辑已出现的普通笔记；写盘暂存等待，完整导入、导出和全库 JSON 同步暂停。
所有正文读完并完成目录核对后才解除写盘保护，避免未加载文献被误当成已删除。
读盘失败或索引在加载期间变化时显示错误并继续暂停写盘。目录里的未纳管 `.md` 不会被改写。
同一笔记在加载期间同时被本地和磁盘修改时，所有文献仍会继续读取，但写盘与全库同步保持暂停。
根据提示选择「保留本地编辑」或「采用磁盘版本」后才恢复保存。

**服务端写入门禁（2026-10-16 加，最后一道防线）**：`scripts/vault-write-guard.mjs` 在服务端逐篇比对
「磁盘声明」与「要写入的新文本」——笔记声明了 `requiredCapabilities` 就必须还带着那些字段（`zoteroKeys`、`localPdf`
及其声明行），`meta.json` 也不能丢掉 `formatVersion` 或自定义顶层键。任何一篇不符合就**整批拒绝**并在界面报错。
客户端里的门禁只约束新客户端；这一层挡的是**任何写入方**（旧页面、旧构建、将来的别的工具）。
背景与复盘见 [VAULT_WRITE_GATE.md](VAULT_WRITE_GATE.md)。

## 编辑模式

笔记编辑区的「编辑模式」可选择「所见即所得」或「经典模式」，默认所见即所得并记忆选择。
所见即所得模式基于 Vditor，与 Word/OneNote 一致：正文始终可直接输入，标题、加粗、列表等格式随打随排版。
编辑器始终直接保存 Markdown 原文，双链、任务、表格、代码块及未识别语法不会经过富文本转换。
支持格式工具栏、双链模板插入、撤销/重做、中文组合输入；`[[双链]]` 在编辑器内按字面文本保留，点击跳转请用经典模式/预览。

## Word 引用（域代码）

文献笔记「复制引用 → 插入 Word 引用（域代码）」会写入真正的 CF_RTF 域（`ADDIN ZOTERO_ITEM CSL_CITATION`，含完整 citation payload），粘进 Word 后可由 Zotero 插件识别。
浏览器自身写不了 `text/rtf`：本地网页端由本机服务代写剪贴板（`/api/local` 的 `clipboard:write-rtf`，PowerShell `SetDataObject`，载荷走临时文件），桌面版走 Electron 原生剪贴板，Safari 走原生剪贴板 API，其余环境降级为纯文本并提示。
回归：`npm run verify:word`（Windows + Word，真机粘贴断言 fields=1）；`npm run test:lit` 覆盖域代码格式（`\fldinst` 指令不得用花括号包裹，否则 Word 会退化成字面文本）。

## Zotero 批量同步（扫描 → 预览 → 备份 → 应用）

```powershell
npm run zotero:sync -- --vault "<vault>" --db "<zotero.sqlite>"              # dry-run：扫描+预览；不在 vault 里建任何目录/文件
npm run zotero:sync -- --vault "<vault>" --db "<zotero.sqlite>" --report <file>   # 指定报告落盘位置
npm run zotero:sync -- --vault "<vault>" --db "<zotero.sqlite>" --apply      # 先整库备份，再写盘
```

- 只读打开 Zotero；排除附件/批注/笔记；匹配顺序 `zoteroKeys/zoteroKey` > DOI > 标题归一化。
- Zotero 库里的重复条目先归并成一个同步单元：多个 key 落到同一篇笔记的 `zoteroKeys`，**重复执行不会新建重复文献**。
- dry-run 的报告默认落系统临时目录（`--report` 可指定）；`--apply` 备份到 `.backups/zotero-import-<时间戳>/`，删除数必须为 0，未纳管 md 一律不碰。
- 索引里登记、磁盘上读不到的文件（同步盘离线等）会**直接中止同步**，避免重建 `meta.json` 时丢索引；确认是永久删除后加 `--allow-missing`。
- `--limit <n>` 可先小批量试跑。分类/标签会顺手清理历史占位「未分类」与旧版压平的「方向:」标签。

## 文献库去重

Zotero 库自身可能存在重复条目（同一 DOI / 同一标题两条，常见于同一批文献被导入过两次）。
vault 同步会如实镜像，因此笔记里会出现重复文献。用合并脚本清理：

```powershell
npm run dedupe:vault -- --vault "<vault>"                     # dry-run：逐组预览保留项/被合并项/风险标记
npm run dedupe:vault -- --vault "<vault>" --report <file>     # 额外把预览报告写成 JSON
npm run dedupe:vault -- --vault "<vault>" --apply             # 写盘：先备份本次改动的文件，再合并/删除
npm run dedupe:vault -- --vault "<vault>" --apply --fix-placeholders   # 顺带清理全库历史占位「未分类」
```

- 分组：同一 DOI ⇒ 同篇；标题相近且 DOI 不冲突（至少一边为空）⇒ 同篇（并查集连通）。
- 保留：有真实分类 > 有本机 PDF > 有 DOI > created 最早 > 文件名序。
- 合并只做并集、不丢数据：collections/tags/attachments 取并集（历史占位「未分类」「方向:未分类」不写入）；
  `zoteroKeys` 记下全部 Zotero key（主 key 优先取有本机 PDF 的），被合并项的正文若不在保留项里会追加到末尾。
- 安全：标题只是近似相等的「可疑组」默认跳过（加 `--merge-suspect` 才合并）；`--apply` 先备份到 `.backups/dedupe-<时间戳>/`。
- 幂等：再跑应为 0 组；顺带清理指向已删文件的悬空 `meta.json` 条目。
- **去重后再同步不会重新长出来**：合并后的笔记带全部 key，官方同步按 `zoteroKeys` 命中（`npm run test:zotero-e2e` 覆盖这条链路）。
- 诊断：`node scripts/audit-vault-dupes.mjs`（vault 侧）、`node scripts/audit-zotero-dupes.mjs`（Zotero 库侧）。
- 2026-10-13 实测：1367 → 668 篇（合并 560 组，删除 699 个重复文件，全部有备份）；
  同日复核：668 篇再同步为「新建 0、更新 0、删除 0」，真正未分类 64 篇（界面动态显示，不落盘）。

## 验证命令

```powershell
npm run build
npm run test:vault
npm run test:lit
npm run test:web
npm run test:zotero            # zoteroFs 只读读取
npm run test:zotero-import     # 批量导入计划（含「去重后再次同步」纯逻辑）
npm run test:zotero-e2e        # 合成库端到端：同步 → 去重 → 再同步（必须 0 新建）
npm run test:startup
npm run test:startup-e2e
npm run test:wysiwyg-e2e
npm run verify:word
```

文件 I/O 性能测试与隔离浏览器测试不能代表所有百度同步盘占位文件或 Defender 扫描条件。
实际库中的当前条目数量与交接文件描述不同，具体证据见 `STARTUP_0.3.2.md`。
