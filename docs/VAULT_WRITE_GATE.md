# vault 安全写入门禁（formatVersion / minimumWriterVersion / requiredCapabilities）

状态：**已接线并全绿**（2026-10-15 解冻 vault-format / desktop-bridge，打标策略 B；`npm run test:vault-gate` 43 项通过）。
改动落在 `src/lib/vaultFormat.ts`（声明序列化、未知字段合并、只读排除、meta 声明）、`src/lib/vaultGate.ts`（判定层，
已登记为冻结单元）、`electron/vaultFs.cjs`（落盘前最后一道防线）、`src/hooks/useNotes.ts` 与 `NoteEditor` /
`DataSafetyStatus`（只读打开与提示）。

## 要防的是什么

2026-10-13：旧桌面端不认识 front matter 里的 `zoteroKeys` / `localPdf`，回写时把它不认识的字段整段抹掉
（668 篇全丢）。根因不是某个字段写错，而是**写入方对「它不认识的字段」没有约束**。门禁按三层补上：

1. **声明**：写入方把「这篇笔记要求写入方具备什么」写进 front matter；
2. **判定**：读到的要求超出自己能力 → 只读（该篇只读；meta.json 自己的声明超限则整库只读），绝不回写；
3. **兜底**：任何回写都必须把「本写入方不认识」的字段原样带回；写盘计划里未纳管的 md 不写不删、
   索引里登记却读不到的文件直接中止。

局限（必须说清）：门禁只对**认识门禁的写入方**有效。2026-10-13 那个旧 EXE 既不读也不认这些字段，
唯一有效的办法是停用它（AGENTS.md 已写死：旧桌面 EXE 禁止再用于真实库）。

## 三个字段（md front matter；meta.json 顶层可选镜像）

| 字段 | 含义 | 缺失时 |
| --- | --- | --- |
| `formatVersion` | 这篇 md 的磁盘格式代次；写入方的代次低一档就不许写 | 基线 1（历史格式，人人可写） |
| `minimumWriterVersion` | 这篇的数据要求的最低写入方能力修订号（`WRITER_VERSION`） | 0（无要求） |
| `requiredCapabilities` | 能力名数组（= front matter 字段名），写入方必须能重新生成这些字段 | 空（无要求） |

- 本客户端：`formatVersion = 2`、`WRITER_VERSION = 2`、能力 `zoteroKeys` / `localPdf`
  （2026-10-13 丢的就是这两个，所以它们是第一批能力）。
- 能力名 = 字段名，将来加字段就加能力：`requiredCapabilitiesFor(note)` 只看这篇真的带了哪些数据，
  所以**只有带这些数据的笔记才会被打标**。
- 认不出来的一律按「更高版本」处理（`formatVersion: 高` / `0` / `2.5` → 只读）：宁可只读，不要覆盖未知格式。
- 老 vault（无声明）保持可写 —— 不做迁移、不因为门禁把老库锁死。

## 判定与过滤（`src/lib/vaultGate.ts`，纯函数，不冻结）

| 函数 | 作用 |
| --- | --- |
| `readDeclaration(text)` / `readMetaDeclaration(json)` | 从 md / meta.json 读声明（不依赖 vaultFormat 的解析器，能容忍别家的写法） |
| `checkWriteGate(decl, writer)` | 单篇能不能写 + 只读理由（UI 横幅 / CLI 日志直接用） |
| `decideVaultGate(files, metaText, writer)` | 打开 vault 时的整体判定：meta 超限 → 整库只读；单篇超限 → 那篇只读 |
| `mergeFrontMatter(disk, next, writer)` | **未知字段保留**：把磁盘上「本写入方不认识」的字段连注释、块状列表一起搬进新文本 |
| `unknownKeys(disk, writer)` | 这次会抢救回哪些字段（日志 / 提示） |
| `gateWritePlan({plan, index, diskFiles, diskText, …})` | 把门禁套在写盘计划上：见下面四条红线 |

四条红线（`gateWritePlan`，默认参数就是最保守的一档）：

1. **未知字段保留**：每个写回文本都先过 `mergeFrontMatter`；写入方认识、因此有权重新生成的字段以新值为准
   （字段被真正删掉时不会复活），不认识的字段原样带回。
2. **删除数为 0**：`allowDeletes` 默认 false —— 门禁一律不做删除；显式放行时也要求「在 meta.json 索引里 +
   不是只读 + 能读到正文」，否则只记录 `skippedDeletes` 理由。
3. **未纳管 md 不动**：不在索引里的路径既不写也不删（唯一例外：盘上那个文件本来就是本应用的笔记，
   说明上次写盘中断在写 meta 之前，允许继续写）。
4. **离线中止**：索引里登记、磁盘上却读不到正文的条目 → 抛错中止（`allowMissing: true` 才放行，
   放行的只进 `missing` 列表，绝不静默丢索引）。
   改名场景额外查一篇：声明在「当前文件」里，回写目标是新路径 —— 两边都查，否则改个名就绕过了门禁。

## 接线点（解冻后按此落地）

| 文件 | 改动 | 状态 |
| --- | --- | --- |
| `src/lib/vaultFormat.ts` | `toMarkdown` 按需写声明行；`planVaultWrite` 合并未知字段、把只读笔记从 writes/deletes 里排除、meta 声明超限时整库停写；`buildMeta` 写 `formatVersion`、meta 未知顶层键保留 | ✅ 已接线（vault-format 解冻；导出名集合不变） |
| `src/lib/vaultGate.ts` | 判定层与计划过滤（`gateWritePlan`） | ✅ 已接线（新冻结单元 vault-gate） |
| `electron/vaultFs.cjs` | `writeVault` 落盘前读一次原文件：声明超出写入方就整批拒绝覆盖 | ✅ 已接线（desktop-bridge 解冻；IPC / preload 不变） |
| `src/hooks/useNotes.ts` | 加载解锁前算一次只读范围 → 状态栏横幅；只读笔记禁编辑 / 禁删 | ✅ 已接线 |
| `src/components/NoteEditor.tsx`、`DataSafetyStatus.tsx` | 只读笔记锁住「编辑」页与删除入口，并显示提示条 / 状态栏一行 | ✅ 已接线 |
| `scripts/local-web.mjs` | 落盘前跑**服务端**门禁（`scripts/vault-write-guard.mjs`）：逐篇比对磁盘声明与新文本，任何一篇丢掉 `requiredCapabilities` 里的字段（或声明行本身）就整批拒绝；`meta.json` 同样不能丢 `formatVersion` / 自定义顶层键 | ✅ 已接线（2026-10-16，`test:web` 56 项） |
| `scripts/zotero-vault-sync.ts`、`vault-add-note.ts` | 走 `planVaultWrite` → 第一层门禁自动生效；zotero 同步另有「索引里读不到就中止」 | ✅ 自动继承 |
| `scripts/dedupe-vault.ts`、`link-local-pdfs.ts` | 文本级拼接（直接改 front matter 文本），天然保留字段；**未接门禁** | ⚠️ 已知边界 |
| `src/lib/vaultFs.ts`、`vaultLoad.ts` | 不用改：加载器已经把磁盘原文交给调用方 | ✅ 不动（vault-io 未解冻） |

已知缺口（都记在这儿，不影响今天的真实库）：

1. **需要规范化的文件**（front matter 缺 `id` / `title` / 时间 / `format` 的手写 md）第一次被接管时，
   `written` 账本里没有它们的原文，那一次重写的未知字段不会合并回来。补这个口子要改 `vaultLoad.readVaultBatch`
   （把 needsRewrite 的原文也放进 `written`）= 再动一次 vault-io。真实库里这类文件 4 篇、未知字段 0 个。
2. `dedupe:vault` / `pdf:link` 是文本级拼接，未接门禁（见上表 ⚠️）；要挡未来格式的笔记时再补。
3. ~~主进程的最后一道防线只查 md~~ → **2026-10-16 已补**：`scripts/vault-write-guard.mjs` 的 `findMetaLoss`
   在 `vault:write` 里拒绝丢掉 `formatVersion` 或自定义顶层键的 `meta.json`。
   为什么必须补：`electron/vaultFs.cjs` 的 `gateAllowsWrite` 只判断「磁盘声明是否超出本写入方」，
   一个**认得出声明、却复现不出字段**的写入方（旧页面）照样能过——2026-10-16 就是这么丢掉 1792 篇的
   `zoteroKeys` / `localPdf` 的。服务端这一层按「新文本里字段还在不在」判定，对任何写入方生效。

## 2026-10-16 事故与这一层的关系（复盘）

- 12:17:44–12:17:51，一个旧客户端连上本地服务后把整个库重写了一遍：1792 篇文献丢掉
  `formatVersion` / `minimumWriterVersion` / `requiredCapabilities` / `zoteroKeys` / `localPdf` / PDF 计数，
  1577 篇顺带被剪掉几条已不存在的分类路径；正文、标题、DOI 等一个字节都没变。
- 当时的门禁（客户端 `src/lib/vaultGate.ts` + 主进程 `gateAllowsWrite`）都放行了：磁盘声明的是
  `minimumWriterVersion: 2` + `requiredCapabilities: ["zoteroKeys"]`，对写入方来说「认得」。
- 恢复：用 `.backups/zotero-import-20261015-231001` 精确补回字段（`restore-fields.mjs`），
  验收口径是「磁盘原文 == 应用自己的 `toMarkdown(parse(text))`」1896/1896 一致，再跑 `zotero:sync` 收敛到 0 变动。
- 补的防线：服务端字段级门禁（本条）+ `scripts/pdf-match.mjs` 的本地 PDF 兜底（字段都丢了也还能按标题认出 PDF）。

被否掉的替代方案：在 `useNotes` / `local-web.mjs` 里做「写完再补字段」的包装。理由：那样 front matter
就有两个真相源（守护测试覆盖不到格式本身），而且应用里那份「磁盘现状账本」与实际落盘内容长期不一致。

## 上线顺序与风险

1. 先发布带门禁的网页端包（`npm run release:web`），确认所有人强刷；**旧的桌面 EXE / 旧页面标签页必须先停用**
   —— 它们不认识门禁。
2. 第一次带声明的写盘前先备份（沿用 `.backups/` 习惯）。
3. 打标策略：**按 B 实现** —— 只有带 `requiredCapabilities` 的笔记才写声明行（下表是当时的实测依据）。

| 策略 | 行为 | 真实库代价（2026-10-15 探针实测：vault 里 714 篇 md、索引 710 条） |
| --- | --- | --- |
| **B（已采用）** | 只给带 `requiredCapabilities` 的笔记写声明行 | 今天 0 篇带 `zoteroKeys`/`localPdf` → 升级本身**不触发任何重写**；等 `zotero:sync --apply` / `pdf:link --apply` 恢复字段时顺手打标 |
| A（未采用） | `toMarkdown` 一律写 `formatVersion: 2`，全库统一 | 升级后第一次 flush 重写全部 714 篇（每篇多一行），同步盘要跟着传一轮 |

两条策略下「未知字段保留 / 删除数 0 / 未纳管不动 / 离线中止」的行为完全一样，差别只在普通笔记有没有声明行。

## 自测

```bash
npm run test:vault-gate    # 43 项（A 声明扫描 / B 判定 / C 全库判定 / D 未知字段 / E 四条红线 / F 接线）
```

另在真实 vault 上跑了只读探针（2026-10-15）：714 篇 md / 710 条索引，门禁前后「写入 4、删除 0、missing 0、
只读 0、合并后往返解析不一致 0 篇」，未知字段 0 篇（今天的 md 都是本应用自己写的）。

解冻与文档：本页、`docs/VAULT_FORMAT.md` 的字段表、`docs/FROZEN.md` 的单元表与变更记录都已同步；
`test:vault-gate` 已加进 vault-format / vault-gate / desktop-bridge 的 `guards`。
