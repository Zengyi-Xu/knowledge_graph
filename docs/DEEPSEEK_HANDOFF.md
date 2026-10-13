# DeepSeek 接手说明（2026-10-13）

## 1. 用户当前目标

用户的最新要求是：

1. 现有文献基本没有分类，需要从本地 Zotero 批量导入/同步分类。
2. 文献表中双击一篇文献时，如果本地 Zotero 中存在 PDF，直接用系统默认 PDF 阅读器打开。
3. 数据规模较大，必须用脚本处理，不能逐篇操作。
4. 继续使用网页端，不再打包 Electron 应用。
5. 继续使用现有本地笔记库及其类型分区，不移动到浏览器 localStorage。

用户此前还要求先读根目录的 `CHATGPT你要看这个！！.txt`。其中的启动性能和 WYSIWYG 工作已经完成，详见第 3 节。

## 2. 真实数据路径与只读统计

- 仓库：`D:\kimi_workspace\knowledge-graph`
- 真实 vault：`D:\BaiduSyncdisk\Bibliotx\Vault`
- Zotero 数据库：`D:\BaiduSyncdisk\Bibliotx\Zotero\zotero.sqlite`
- Zotero 数据库必须只读打开，绝不能修改。
- 当前 vault 的 `meta.json` 只登记 42 篇，目录内共约 45 个 md；开始本任务时没有 `文献/` 条目。
- 旧代码按“有 title 字段”判断书目，错误地把带标题的 attachment 也算作文献。

2026-10-13 对 Zotero 数据库的实际统计：

- 全部未删除对象：annotation 2329、attachment 1411、note 355、journalArticle 998、conferencePaper 194、webpage 138、book 18、thesis 11、bookSection 5、computerProgram 3、preprint 1、document 1。
- 有 title 的对象共 2679，其中 attachment 1312。
- 排除 `attachment`、`annotation`、`note` 后，真正书目共 **1367 篇**。
- 有 Zotero collection 的真正书目共 **666 篇**；其余 **701 篇**应归入明确的“未分类”，避免界面仍像没有分类。
- PDF 附件记录 734 条：linkMode 0 有 249、1 有 468、2 有 10、3 有 7。
- `storage:` 路径 717 条，绝对路径 10 条，其他/不可直接解析 7 条。
- 当前机器实际存在并可访问的 PDF 文件共 **318 份**。
- 有 PDF 记录的真正书目共 709 篇；“有记录”和“本地实际存在”必须区分。

Zotero 内部 `storage:xxx.pdf` 的真实路径规则：

```text
<zotero.sqlite 所在目录>\storage\<附件 item 的 items.key>\<文件名>
```

父书目必须保存 `items.key`（8 位 Zotero key），不能保存数值 `itemID`；`itemID` 会变化，不适合作为稳定引用。

## 3. 已完成、不要重做的工作

当前工作树包含大量尚未提交的连续改动，不能 reset/revert，也不能只保留本任务文件。

已经完成并验证的功能包括：

- 本地网页端服务：`scripts/local-web.mjs`、`scripts/local-bridge.js`、`启动网页端.cmd`。
- 默认打开真实 vault，所有笔记继续保存为本地 md + `meta.json`。
- 启动分阶段加载、并发读取，解决约 2000 篇文献阻塞首屏的问题；写盘安全阀已处理。
- WYSIWYG 编辑器及经典模式切换。
- 图谱 linked 档的文献节点爆炸问题。
- 此前通过的验证：`test:vault` 54/54、`test:lit` 39/39、`test:web` 17/17、`test:startup-e2e` 28/28、WYSIWYG 单测 16/16、WYSIWYG e2e 19/19、`npm run build`。

注意：这些是开始 Zotero/PDF 新改动之前的结果。当前半成品状态需要重新跑测试。

网页端曾在 `http://127.0.0.1:4173` 运行，进程加载的是修改前的服务代码。完成新功能后必须停止旧进程、重新 build 并重启，不能只刷新浏览器。

## 4. 本轮已做的半成品改动

### `electron/zoteroFs.cjs`

已改为：

- 排除 `attachment`、`annotation`、`note`。
- 返回真实字符串 `zoteroKey`。
- 为每条书目统计 `pdfCount` 和 `availablePdfCount`。
- 新增 `resolveZoteroPdf(dbPath, zoteroKey)`，只返回第一份实际存在的本地 PDF 路径。
- 支持 Zotero `storage:` 路径和绝对路径。

这里还需补测试。还要确认 linked attachment 的其他相对路径规则；目前无法解析的 7 条可以安全视为不可用，不要猜路径。

### 类型与 frontmatter

已在 `src/types/note.ts` 的 `LiteratureMeta` 添加可选字段：

```ts
zoteroKey?: string
zoteroPdfCount?: number
zoteroAvailablePdfCount?: number
```

已在 `src/types/desktop.d.ts` 中把 `zoteroKey` 改成字符串，并声明 `openZoteroPdf`。

已在 `src/lib/zoteroSync.ts` 中把 `zoteroKey` 从 number 改成 string，并补 PDF 计数字段。

已在 `src/lib/vaultFormat.ts` 中添加序列化/解析字段，但这里有一个已知未修复 bug：`parseFrontmatter()` 会把 key 全部转为小写，而当前解析代码用了 `str('zoteroPdfCount')`、`str('zoteroAvailablePdfCount')`、`str('zoteroKey')`。必须改成：

```ts
str('zoteropdfcount')
str('zoteroavailablepdfcount')
str('zoterokey')
```

上一条 patch 在用户中断时没有应用，当前文件仍是错误状态。

### 当前代码不完整，暂时不能视为可交付

`src/types/desktop.d.ts` 已声明 `openZoteroPdf`，但以下实现尚未接上：

- `electron/preload.cjs`
- `electron/main.cjs`
- `scripts/local-bridge.js`
- `scripts/local-web.mjs`

网页端是用户当前唯一目标，因此 Electron 侧可以保持兼容，但至少本地网页桥必须完成。

## 5. 建议的最终实现

### 5.1 批量导入脚本

新增一个可重复运行、幂等的脚本，例如：

```text
scripts/zotero-vault-sync.ts
```

建议通过 esbuild 打包后执行，并在 `package.json` 增加脚本命令。逻辑：

1. 只读读取 Zotero。
2. 读取 vault 的 `meta.json` 和索引内 md，用 `parseNoteMarkdown` 还原现有笔记。
3. 匹配优先级：已有 `literature.zoteroKey` > DOI > 标题归一化。
4. 匹配到的文献合并分类、刷新 Zotero key 和 PDF 计数，不清空用户已有正文、标签、附件。
5. 未匹配的真正书目创建 `type: literature` 笔记，稳定 id 建议 `zotero-<小写 key>`。
6. 有 collection 时保存完整层级到 `literature.collections`；没有 collection 时保存 `["未分类"]`。
7. 标签至少添加：`方向:<一级分类>`；无 collection 添加 `方向:未分类`；另可继续使用 `期刊:<venue>`、`年份:<year>`。
8. 所有文献仍由 `TYPE_FOLDERS.literature = '文献'` 写入 `文献/`，保持 vault 分区。
9. citekey 用现有 `makeCitekey`/文献导入逻辑生成并处理冲突。
10. 默认先输出 dry-run JSON 报告；实际应用参数用 `--apply`。

写盘前必须创建完整备份，建议：

```text
<vault>\.backups\zotero-import-YYYYMMDD-HHmmss\
```

至少备份原始 `meta.json` 和所有索引登记的 md。`.backups` 以点开头，现有扫描器会跳过。写盘使用现有 `planVaultWrite` + `electron/vaultFs.cjs.writeVault`，不要手拼覆盖，也不要删除未纳管 md。

真实 vault 在先前工作中已有安全快照：仓库内忽略目录 `.tmp-real-vault-safety`，覆盖当时 46 个 md/索引文件。仍需为本次批量导入再建带时间戳的 vault 内备份。

### 5.2 网页端打开 Zotero PDF

`scripts/local-web.mjs` 应增加 `zoteroDb` 配置和白名单，不要允许前端请求任意 sqlite/任意文件：

```js
createLocalServer({ port, vault, zoteroDb, dist })
```

启动参数：

```text
--zotero-db "D:\BaiduSyncdisk\Bibliotx\Zotero\zotero.sqlite"
```

`启动网页端.cmd` 也要加这个参数。

建议本地 API：

```text
zotero:read
zotero:open-pdf
```

`zotero:open-pdf` 只接收书目 `zoteroKey`，数据库路径固定使用服务端启动时授权的 `zoteroDb`。后端调用 `resolveZoteroPdf` 得到路径后，在 Windows 用：

```js
spawn('cmd.exe', ['/c', 'start', '', pdfPath], { windowsHide: true, detached: true, stdio: 'ignore' }).unref()
```

更稳妥可用 `rundll32.exe url.dll,FileProtocolHandler <pdfPath>`。不要把任意绝对路径开放成通用 `openPath` API。

`scripts/local-bridge.js` 暴露：

```js
defaultZoteroDb: config.zoteroDb,
openZoteroPdf: (_dbPath, zoteroKey) => call('zotero:open-pdf', { zoteroKey })
```

保留 `_dbPath` 参数是为了与 Electron bridge 类型一致，但网页服务端不能信任它。

### 5.3 文献表双击与分类列

改 `src/components/LiteratureView.tsx`：

- 搜索范围加入 `literature.collections`。
- 增加“分类”列，显示 collection 路径；空值显示“未分类”。
- 增加 PDF 状态图标/文本：`zoteroAvailablePdfCount > 0` 显示“PDF”，否则显示“无本地 PDF”。
- 双击行时调用 `openZoteroPdf(defaultZoteroDb, zoteroKey)`，失败用 toast 显示中文原因。
- 单击仍打开笔记，但不能直接在 `onClick` 立即切换视图，否则第一次点击会让表格卸载，浏览器来不及触发 `dblclick`。使用约 220ms 的单击定时器；`onDoubleClick` 清掉定时器并打开 PDF。
- 引用按钮所在单元格继续 `stopPropagation()`。
- 工具提示明确写“单击打开笔记，双击打开本地 PDF”。

当前组件里 Zotero 默认路径仍是错误的：

```text
C:\Users\Administrator\Zotero\zotero.sqlite
```

应优先用 `window.knowledgeGraphDesktop.defaultZoteroDb`，真实默认是 `D:\BaiduSyncdisk\Bibliotx\Zotero\zotero.sqlite`，并把用户选择持久化。

### 5.4 同步计划类型

`ZoteroSyncUpdate` 当前只同步 `collections` 和 `tagsToAdd`。要让 UI 内再次同步时不丢 key/PDF 状态，建议加：

```ts
zoteroKey: string
zoteroPdfCount: number
zoteroAvailablePdfCount: number
```

同时改 `src/App.tsx` 的 `applyZoteroSync`，将这些字段写入 `literature`。

批量首次导入仍由脚本完成；UI 的“同步 Zotero 分类”用于后续增量刷新。

## 6. 测试与验收

至少补以下测试：

1. `zoteroFs`：附件/批注/笔记不会进入 items；字符串 Zotero key 正确；`storage:` 路径正确；只有实际存在的 PDF 计入 available；resolve 不存在文件时返回中文错误。
2. `vaultFormat`：三个 Zotero 字段 round-trip；旧文献 frontmatter 没有这些字段时仍兼容。
3. `zoteroSync`：无分类变为“未分类”；同步更新 key 和 PDF 数量；字符串 key 匹配。
4. `local-web-selftest`：`zotero:open-pdf` 不能打开任意路径/任意数据库；不存在 PDF 返回 400；测试时不要真的启动阅读器，可向 server 注入 opener 或只测 resolver。
5. 批量脚本 dry-run：报告真正书目 1367，不能是 2679。
6. apply 后：原 42 篇索引笔记仍全部存在；新增/更新文献约 1367 篇；无删除；`文献/` 文件数与 `meta.json` 对应；随机解析 50 篇无错误。
7. 分类统计：666 篇保留 Zotero 分类，701 篇明确为“未分类”。
8. 本地 PDF 状态：可用 PDF 总数应与当前环境统计接近 318；双击抽查 3 篇能由系统阅读器打开。

建议依次运行：

```powershell
npm run test:vault
npm run test:lit
npm run test:web
npm run test:startup-e2e
npm run test:wysiwyg-e2e
npm run build
```

然后运行批量脚本 dry-run，人工检查报告，再 `--apply`。本次用户已经明确授权执行批量处理，不需要再询问是否应用；但必须先备份，并在报告中明确写入/更新/删除数，删除数应为 0。

## 7. 当前工作树与操作红线

- `git status` 有大量修改和未跟踪文件，都是同一轮功能工作的一部分。
- 不要执行 `git reset --hard`、`git clean`、整目录覆盖或删除未跟踪文件。
- 不要覆盖旧 release，也不要打包新 exe；用户明确选择网页端。
- 不要复制 PDF 到 vault；笔记只保存 Zotero key 和状态，打开时从 Zotero 库解析真实路径。
- 不要把 1367 篇文献放回 localStorage；必须写到本地 vault 的 `文献/` 分区。
- 不要修改 Zotero sqlite。
- 本次批处理应幂等：重复执行不能再新增重复文献。

## 8. 建议接手顺序

1. 修 `vaultFormat` 小写 key bug。
2. 完成 local web 的受限 `zotero:open-pdf` 桥与启动参数。
3. 完成 LiteratureView 分类列、PDF 状态和单双击行为。
4. 扩充 Zotero 同步更新字段。
5. 写批量同步脚本与 dry-run 报告。
6. 补测试并跑全套验证。
7. 对真实 vault 建时间戳备份，dry-run，检查 1367/666/701/约318 等统计，再 apply。
8. 重建 dist、重启 4173 服务，在浏览器验证分类、搜索、单击与双击。

