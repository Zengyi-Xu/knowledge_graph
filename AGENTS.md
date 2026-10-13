# 项目开发记忆（给 AI 代理；改动本项目前先读这一页）

## 常用命令

- 构建 / 回归：`npm run build`（tsc -b + vite build）、`npm run test:vault | test:lit | test:web | test:zotero | test:zotero-import | test:zotero-e2e`
- 批量 Zotero 同步：`npm run zotero:sync -- --vault "<v>" --db "<zotero.sqlite>"`（dry-run，不在 vault 建任何目录/文件）；
  `--apply` 才写盘（先整库备份 `.backups/zotero-import-<时间戳>/`）；`--report <file>` 指定报告；`--limit <n>` 小批量试跑；`--allow-missing` 放行索引里读不到的文件。
- 去重：`npm run dedupe:vault -- --vault "<v>"`（预览，逐组列出保留/被合并/可疑）；
  `--apply` 写盘；`--merge-suspect` 合并标题仅近似相等的可疑组；`--fix-placeholders` 清理全库历史占位「未分类」。

两个同步入口的分工：界面「同步 Zotero 分类」= 只更新已有笔记的 collections/标签/key/PDF 状态，不新建；
命令行 `zotero:sync` = 全量扫（可新建）；`dedupe:vault` = 合并重复。三者规则必须一致（都走 `src/lib/zoteroMeta.ts` / `zoteroImport.ts` 的公共规则）。

## 文献数据模型（不变量，2026-10-13 修复后）

1. `literature.zoteroKeys: string[]` 是这篇文献全部 Zotero key 的并集；`zoteroKey` 是主 key（优先取本机有 PDF 的，且固定排在 `zoteroKeys[0]`）。
   Zotero 库里的重复条目由 `coalesceZoteroItems` 先归并成一个同步单元再匹配笔记 —— **「去重后再次同步」必须 0 新建**，回归在 `scripts/zotero-import-e2e.mjs` 第 4 步（`npm run test:zotero-e2e`）。
2. 「未分类」是动态状态，不落盘：`collections` 不写「未分类」、`tags` 不写「方向:未分类」；界面用 `realCollectionsOf()`（`src/lib/zoteroMeta.ts`）判断。同步/去重会清理历史占位。
3. 写盘安全：dry-run 不在 vault 创建任何文件/目录；`--apply` 先备份；`planVaultWrite` 的删除数必须为 0；未纳管 md 一律不碰；
   索引里登记但磁盘读不到的文件（同步盘离线）→ **直接中止**，绝不静默丢索引。
4. 去重只做并集、不丢数据：被合并项正文不在保留项里则追加到末尾（带来源标注）；collections/tags/attachments/zoteroKeys 全并集；PDF 计数取组内之和；可疑组（标题仅近似相等）默认跳过。
5. 打开本地文件不走 shell：Windows `explorer.exe <file>`（`scripts/local-web.mjs` 的 `openerCommand`），文件名含 `&`、括号不会被解释；
   `resolveZoteroPdf(dbPath, key, extraKeys)` 支持多 key 回退（去重后的文献可选到任一 key 下的 PDF）。
6. 文献表 UI：单击标题/行打开笔记，PDF 徽标本身是按钮（单击打开、无 220ms 延迟）；「标签」列默认隐藏；行内「⋮」菜单承接引用操作；
   一次渲染 150 行 +「显示更多」；标题显示走 `cleanLiteratureTitle`（解 HTML 实体、去内联标签/站点尾缀/`$…$` 定界符，只影响显示，不改数据）。

## 真实数据环境（动手前先看）

- 真实 vault：`D:\BaiduSyncdisk\Bibliotx\Vault`（668 篇文献、meta 710 条）；Zotero 库：`D:\BaiduSyncdisk\Bibliotx\Zotero\zotero.sqlite`（1367 条书目，只读同步盘）。
- 改真实库之前：先复制 vault 副本跑 dry-run，核对「新建/更新/删除」数字；应用真实库写入前必须由用户明确同意。
- 2026-10-13 已更新真实库（`zotero:sync --apply`，备份 `.backups/zotero-import-20261013-230700/`）：匹配 1367 全按 key、新建 0、更新 668、删除 0；
  复跑 = 0/0/0；`dedupe:vault` = 0 组；正文被改动 0；真正未分类 64 篇；529 篇带多个 `zoteroKeys`。
- 旧版 dry-run 留下的 6 个 `.backups/zotero-preview-*` 目录仍在（仅报告，可删）。

## 代理工作纪律（省上下文与额度）

- 不要整页读无障碍树或全量 DOM：用「过滤 + 小 limit」的元素快照、按 `maxChars` 截断的文本快照、`region` 裁剪图，只读需要的那一小块。
- 验证顺序：先 `npx tsc -b`（秒级）→ 跑目标测试（`test:zotero-e2e` 等）→ 最后才 `npm run build`；同一结果不要重复构建。
- 长任务先建 TodoList；真实数据操作前先备份并在副本上验证；失败先看脚本输出，不要盲目重跑。
