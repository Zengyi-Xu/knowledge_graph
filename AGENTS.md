# 项目开发记忆（给 AI 代理；改动本项目前先读这一页）

> 本页只放每次会话必需的索引级摘要，**务必保持短小**。展开细节、踩坑记录、回归测试口径都在
> [docs/DEV_MEMORY.md](docs/DEV_MEMORY.md)（按本页标题可检索）；改动相关行为时两处同步更新。

## 冻结单元（黑箱）

18 个单元由 `frozen.json` + `scripts/frozen-check.mjs` 锁定（清单与解冻流程：[docs/FROZEN.md](docs/FROZEN.md)）：
`ui-kit`、`csl-data`、`editor-runtime`、`md-parser`、`md-render`、`vault-format`、`vault-io`、`zotero-rules`、
`desktop-bridge`(`electron/**`+`types/desktop.d.ts`)、`vault-gate`、`note-store`、`md-import`、`math-pipeline`、
`lit-view-logic`、`citation-copy`、`pdf-source`、`ai-chat`、`capabilities`。

- 不读内部实现、不改；要能力查公开契约（Markdown 语法 → `docs/MARKDOWN_RENDERER.md`；vault 字段 → `docs/VAULT_FORMAT.md`；
  桌面能力 → `src/types/desktop.d.ts`）。看到 `FROZEN(...)` 标记就停手。
- 校验：`npm run frozen:check`（秒级）；`npm run test:frozen` = 校验 + 全部守护测试。必须改时：先 `test:frozen` 全绿，
  再 `npm run frozen:update -- "<单元> <理由>"` 显式解冻并同步契约文档。

## 常用命令

- 构建/类型：`npm run build`（tsc -b + vite build）。
- 回归测试：`npm run test:vault | test:vault-gate | test:use-notes | test:lit | test:lit-view | test:lit-dom |
  test:web | test:zotero | test:zotero-import | test:zotero-e2e | test:mobile | test:math | test:wysiwyg-e2e | test:organize`。
- 体积：`npm run budget:check`（先 `npm run budget:report` 刷 `perf/bundle-lanes.json`，否则哈希变了整片误报）、
  `npm run test:bundle-scenarios`。**别用 `manualChunks` 给懒加载 chunk 改名**（会被提升成静态 import，2.7MB citation
  chunk 上首屏）。口径见 `docs/BUNDLE_BUDGET.md`。
- Zotero 同步/去重/PDF 认回/主题建议等脚本用法与写盘安全约定 → `docs/DEV_MEMORY.md`「常用命令」。

## 文献数据模型（不变量）

1. `zoteroKeys` 是全部 key 并集，`zoteroKey` 是主 key（固定 `zoteroKeys[0]`）；去重后复跑同步必须 0 新建。
2. **分类只存 `literature.collections`**（完整路径树），不落「未分类」、不用「方向:」标签（已废弃，同步一律清）。
3. 写盘安全：dry-run 不落盘；`--apply` 先备份成单个 zip（`.backups/<动作>-<时间戳>.zip`）；删除数必须 0；
   未纳管 md 不碰；索引读不到文件 → 中止不丢索引。
4. 去重只做并集不丢数据；可疑组（标题近似）默认跳过。
5. 打开本地文件走 `explorer.exe` 不走 shell。
6. 文献表：侧栏只列非文献笔记；分类是折叠树（计数=子树唯一篇数）；视图层逻辑在 `src/components/literature/` 纯模块，
   别把分支写回组件。
7. PDF 打开链：`localPdf` → Zotero 多 key 回退 → 按标题兜底匹配（只内存）→ `zotero://select`。网页端 localPdf 必须在
   `--pdf-root` 白名单内。**任何写盘路径必须认识 front matter 字段**，老构建会静默丢字段。
8. 写入门禁（`vaultGate.ts` + 服务端 `vault-write-guard.mjs`）：声明超能力就只读；回写必须保留不认识字段；
   服务端比对「新文本里字段还在不在」，丢了就整批拒绝。加字段 = 加能力（`CAPABILITY_FIELDS`）。

各功能点（PDF 阅读器、内嵌面板、图谱聚类/焦点、AI 面板、公式、WYSIWYG 编辑器、Zotero 标注、主题层）的
实现位置、踩坑与回归测试名 → `docs/DEV_MEMORY.md`「文献数据模型」第 9–19 条；
「研究追问」本地助手（题库/单篇记录/ollama 路由/sidecar 存储）→ `docs/DEV_MEMORY.md`「研究追问」。

## 真实数据环境

- 真实 vault：`D:\BaiduSyncdisk\Bibliotx\Vault`（1896 篇文献）。**Zotero 库用 `C:\Users\Administrator\Zotero\zotero.sqlite`**
  （Zotero 10 在用的）；D 盘 Baidu 副本是 2025-03 冻住的旧库，只剩归档价值，拿它当同步源必出「分类对不上」。
- 动真实库前：先在副本上 dry-run 核对数字；写入前必须用户明确同意；只有 v1.2.6+ 构建认识新字段，
  `release-archive/` 旧 EXE 禁止再用于真实 vault。
- 2026-10-16 事故教训：旧客户端回写抹掉 1792 篇 front matter 字段 → 已加客户端+服务端双层写入门禁。
- 历史操作记录（备份位置、同步数字）→ `docs/DEV_MEMORY.md`「真实数据环境」。

## 发行与启动器

- 打 `v*` tag → GitHub Actions 三端并行发 Release（Windows NSIS / macOS dmg+zip / Linux AppImage+deb）；
  Release 正文取根目录 `release-notes.md`。网页包：`npm run build` + `npm run release:web`。**不主动 push，用户明确要求才提交。**
- `.cmd` 启动器必须 CRLF（LF 会被 cmd.exe 截断命令）；双击入口是 `.wsf`（无窗口，别改回 `.vbs`，中文会按 ACP 乱码）；
  停止脚本会杀本机所有本地服务实例，自动化清场用 `taskkill /PID <pid> /T`。回归 `npm run test:web-portable`。

## 代理工作纪律

省 token：先 Grep 定位再局部读、输出先截断、合并工具调用、默认不派子代理（全局规则见 `~/.kimi-code/AGENTS.md`）。
验证顺序：先 `npx tsc -b` → 目标测试 → 最后 `npm run build`；同一结果不重复构建。
