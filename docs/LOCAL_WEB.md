# v0.3.2 本地网页端

## 使用

双击项目根目录的 `启动网页端.cmd`，在默认浏览器打开 `http://127.0.0.1:4173`。
命令窗口运行的是本地文件服务；使用期间保留此窗口。关闭窗口停止服务，再次双击可启动。
如果服务已在运行，启动脚本会打开已有网页。

也可在项目目录运行：

```powershell
npm run build
npm run web:local -- --vault "D:\BaiduSyncdisk\Bibliotx\Vault"
```

这次交付使用网页入口，不生成新的桌面 exe，也不修改旧 release 文件。

## 本地笔记库

默认沿用 `D:\BaiduSyncdisk\Bibliotx\Vault`。网页顶栏显示当前完整路径，切换库用「选择目录」输入已有目录的绝对路径。

笔记仍保存为原目录里的 `.md` 和 `meta.json`，人物、项目、技能、学习、其他、文献文件夹继续保留。
附件保存在 `attachments/`；JSON 同步快照保存在 `sync/notes.json` 或用户选择的本地 JSON 文件。
网页设置由当前浏览器保存，笔记正文由本地服务直接读写 vault。
应用保留 Zotero 数据库只读访问、附件/PDF/标注与双向文件同步能力。

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

## 编辑模式

笔记编辑区的「编辑模式」可选择「所见即所得」或「经典模式」，默认所见即所得并记忆选择。
所见即所得模式基于 Vditor，与 Word/OneNote 一致：正文始终可直接输入，标题、加粗、列表等格式随打随排版。
编辑器始终直接保存 Markdown 原文，双链、任务、表格、代码块及未识别语法不会经过富文本转换。
支持格式工具栏、双链模板插入、撤销/重做、中文组合输入；`[[双链]]` 在编辑器内按字面文本保留，点击跳转请用经典模式/预览。

## Word 引用（域代码）

文献笔记「复制引用 → 插入 Word 引用（域代码）」会写入真正的 CF_RTF 域（`ADDIN ZOTERO_ITEM`，Zotero 兼容），粘进 Word 是可刷新的真域。
浏览器自身写不了 `text/rtf`：本地网页端由本机服务代写剪贴板（`/api/local` 的 `clipboard:write-rtf`，PowerShell `SetDataObject`，载荷走临时文件），桌面版走 Electron 原生剪贴板，Safari 走原生剪贴板 API，其余环境降级为纯文本并提示。
回归：`npm run verify:word`（Windows + Word，真机粘贴断言 fields=1）；`npm run test:lit` 覆盖域代码格式（`\fldinst` 指令不得用花括号包裹，否则 Word 会退化成字面文本）。

## 文献库去重

Zotero 库自身可能存在重复条目（同一 DOI / 同一标题两条，常见于同一批文献被导入过两次）。
vault 同步会如实镜像，因此笔记里会出现重复文献。用合并脚本清理：

```powershell
npm run dedupe:vault -- --vault "<vault>"          # dry-run：列出重复组与保留策略
npm run dedupe:vault -- --vault "<vault>" --apply  # 写盘：先整库备份，再合并/删除
```

- 分组：同一 DOI ⇒ 同篇；标题相近且 DOI 不冲突（至少一边为空）⇒ 同篇（并查集连通）。
- 保留：有分类 > 有本机 PDF > 有 DOI > created 最早 > 文件名序；collections/tags/attachments 取并集。
- 幂等：再跑应为 0 组；顺带清理指向已删文件的悬空 `meta.json` 条目。
- 与后续同步兼容：导入匹配顺序是 zoteroKey > DOI > 标题，被合并掉的那条会按 DOI/标题匹配回保留项，不会重新长出来。
- 诊断：`node scripts/audit-vault-dupes.mjs`（vault 侧）、`node scripts/audit-zotero-dupes.mjs`（Zotero 库侧）。
- 2026-10-13 实测：1367 → 668 篇（合并 560 组，删除 699 个重复文件，全部有备份）。

## 验证命令

```powershell
npm run build
npm run test:vault
npm run test:lit
npm run test:web
npm run test:startup
npm run test:startup-e2e
npm run test:wysiwyg-e2e
npm run verify:word
```

文件 I/O 性能测试与隔离浏览器测试不能代表所有百度同步盘占位文件或 Defender 扫描条件。
实际库中的当前条目数量与交接文件描述不同，具体证据见 `STARTUP_0.3.2.md`。
