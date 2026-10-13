# 交接说明（2026-10-13 · Zotero 批量分类 + 本地 PDF 打开）

上一轮交接见 `docs/DEEPSEEK_HANDOFF.md`（启动性能 / WYSIWYG 部分已完成）。本文只写本轮。

---

## 1. 本轮已完成（代码 + 真实数据）

### 1.1 批量导入 1367 篇 Zotero 书目到本地笔记库 ✅

- 脚本：`scripts/zotero-vault-sync.ts`（esbuild 打包成 cjs 运行）
  - 运行：`npm run zotero:sync -- --vault "<vault>" --db "<zotero.sqlite>"`（dry-run，只出报告）
  - 应用：在上面命令后加 `--apply`（写盘前自动建带时间戳的完整备份）
  - 幂等：重复执行 `新建 0 / 更新 0 / 写盘 0 / 删除 0`
- 真实 vault 已应用（`D:\BaiduSyncdisk\Bibliotx\Vault`）：
  - `文献/` 下 **1367 个 md**，meta.json 共 **1409 篇**（原有 42 篇 + 1367 篇文献）
  - 原有 46 个 md **字节未变**，删除数 **0**，meta 指向的文件全部存在且大小写唯一
  - 分类：**666 篇有分类**、**701 篇「未分类」**；本地可访问 PDF：**305 篇书目 / 318 份文件**
  - 备份目录：`D:\BaiduSyncdisk\Bibliotx\Vault\.backups\zotero-import-20261013-192226\`（含原 md + meta.json + report.json）
  - 每个 Zotero 书目导出文件都带：`zoteroKey`（8 位字符串）、`zoteroPdfCount`、`zoteroAvailablePdfCount`、`collections`（无分类写 `["未分类"]`）、`方向:xxx / 期刊:xxx / 年份:xxxx` 标签
- Zotero 只读：全程 `readonly`，读取前后数据库字节不变（有单测断言）。

### 1.2 文献表双击打开本地 PDF ✅

- 网页端服务：`scripts/local-web.mjs` 新增 `--zotero-db` 启动参数 + 数据库白名单
  - `zotero:read` 只允许启动时授权的那个库；`zotero:open-pdf` 只接收 `zoteroKey`，路径固定由服务端解析，前端无法指定任意文件（有单测）
  - Windows 用 `cmd /c start "" <pdf>` 交给系统默认阅读器
- `启动网页端.cmd` 已带 `--zotero-db "D:\BaiduSyncdisk\Bibliotx\Zotero\zotero.sqlite"`（库不存在时降级提示）
- `scripts/local-bridge.js` 暴露 `defaultZoteroDb`、`openZoteroPdf`；Electron 侧（`electron/preload.cjs`、`electron/main.cjs`）同步补齐 `zotero:open-pdf` 与 `defaultZoteroDb`
- 文献表 `LiteratureView.tsx`：
  - 新增「分类（Zotero）」列（空 → 显示「未分类」）与「PDF」状态列（`PDF` / `文件不在本机` / `无本地 PDF` / `未同步` / `—`）
  - **单击打开笔记（220ms 延时，保证 dblclick 能触发），双击用系统默认阅读器打开本地 PDF**，失败弹中文 toast
  - 搜索范围扩到分类 / DOI / citekey / 标签；Zotero 库路径默认取 `defaultZoteroDb` 并持久化（`kg-zotero-db-v1`）
- 实测：服务在 `http://127.0.0.1:4173` 运行中，`zotero:open-pdf` 抽查 3 篇已成功由系统阅读器打开；未知 key → 400 中文错误；未授权 sqlite → 400

### 1.3 顺带修掉的真实缺陷 ✅

1. `vaultFormat.ts` 前端小写 key bug（`zoteroPdfCount` 等永远读不到）→ 改为小写 key，且缺字段时不写 `undefined`（老笔记往返不变）
2. `zoteroFs.cjs` 的 Zotero 字段映射错误：**DOI 是 fieldID 59（不是 8，8 是 shortTitle）**，venue 应按类型取 `publicationTitle(38)` / `proceedingsTitle(57)` 等 → 修好后 969 条有 DOI、1151 条有 venue（修复前为 0）
3. **Windows 大小写文件名冲突**：两条只有大小写差异的标题会被分配成同一个物理文件、后写静默覆盖（1367 篇里有 8 组中招）→ `assignFileNames` 全部改按小写比较，`planVaultWrite` 增加「仍被存活笔记占用的路径不删」保护；已重建那 8 篇并加单测
4. WYSIWYG 双链样式失效：Vditor 的渲染块整体装在 `pre.vditor-reset` 里，装饰函数却排除了所有 `pre` → 改为只排除代码块/预览块（`wysiwyg-e2e` 从失败变 17/17）
5. 测试与实现漂移：`startup-e2e`、`vault-e2e` 里的「100 篇笔记 / 2000 篇笔记」和「经典 textarea」判断已过时（现为「N 个条目」+ 默认所见即所得模式）→ 已修

---

## 2. 测试与验证结果（本轮全部实跑）

| 命令 | 结果 |
| --- | --- |
| `npm run test:vault` | 60/60 |
| `npm run test:lit` | 42/42 |
| `npm run test:web` | 29/29 |
| `npm run test:zotero` | 23/23（新建：合成 Zotero 库只读、排除附件/批注/笔记、storage 路径、可用 PDF 计数） |
| `npm run test:zotero-import` | 19/19（匹配优先级、未分类、幂等、不覆盖用户正文） |
| `npm run test:zotero-e2e` | 26/26（真跑脚本：dry-run → apply → 再 apply 幂等 + 备份完整性） |
| `npm run test:startup-e2e` | 28/28 |
| `npm run test:wysiwyg-e2e` | 17/17 |
| `npm run test:vault-e2e` | 17/17（Electron 桌面版仍可正常启动，兼容性 OK） |
| `npm run test:startup` / `test:md` / `test:md-render` | 通过 / 136 项 / 28 项 |
| `npm run build` | 通过 |

真实数据核对：dry-run 报告 `1367 条书目（有分类 666 / 未分类 701）`、`本机可访问 PDF 318 份`；应用后 `文献/` 1367 个文件、meta 1409 条、0 删除、原 46 个 md 字节不变。

---

## 3. 待办（建议接手顺序）

1. **浏览器人工验收**（服务已在跑，代码是最新的）：
   打开 <http://127.0.0.1:4173> → 文献标签页，确认：
   - 1409 篇里能筛出「未分类」的 701 篇；分类列显示层级路径
   - 单击行打开笔记、双击行用系统阅读器打开 PDF（无本地 PDF 的给中文提示）
   - 搜索分类名（如「论文写作」）能筛出结果；图谱视图在 1409 篇规模下的流畅度
   - 若浏览器里仍是旧数据，刷新页面即可（vault 是唯一事实来源，localStorage 只是缓存）
   - 若 4173 上没有服务：`启动网页端.cmd`（已带 `--zotero-db`）
2. **提交这批工作**：仓库有 26 个已修改 + 27 个未跟踪文件（含本轮与上一轮的全部功能），仍未 commit。红线：不要 `git reset --hard` / `git clean`。
3. **可选清理**：`D:\BaiduSyncdisk\Bibliotx\Vault\.backups\` 下已积累 8 个目录（4 个 preview 报告 + 4 个导入备份），确认无误后可删；vault 根目录的 `HANDOFF_DEEPSEEK.md` 是更早的交接文件，可自行决定是否移出 vault。
4. **UI 增量同步未在浏览器里点过**：文献表右上「同步 Zotero 分类」按钮已支持写回 `zoteroKey`/PDF 状态，代码与单测通过，但没做浏览器实点（批量导入已覆盖同一逻辑）。
5. **已知取舍（非缺陷）**：
   - 一个书目有多份 PDF 时，双击打开「第一份实际存在」的，没有选择界面
   - Zotero 里存在 8 组「只有大小写差异的重名条目」（用户库中的重复项），笔记侧按 Zotero 如实保留为独立条目；如要合并需在 Zotero 里处理，脚本不会替用户合并
   - `npm run lint` 有 15 个既有 error（都在 `src/components/ui/*` 与 `src/types/note.ts`，与本轮无关，未动）
6. **未纳入本轮**：不再打包 Electron exe（用户明确只要网页端）；没有把 PDF 复制进 vault；没有改动 Zotero sqlite。

---

## 4. 关键路径速查

- 真实 vault：`D:\BaiduSyncdisk\Bibliotx\Vault`（`文献/` 1367 篇 + 原有 42 篇）
- Zotero 库（只读）：`D:\BaiduSyncdisk\Bibliotx\Zotero\zotero.sqlite`
- 批量脚本：`npm run zotero:sync -- --vault "<vault>" --db "<db>" [--apply]`
- 网页端：`启动网页端.cmd` 或 `node scripts/local-web.mjs --vault "<vault>" --zotero-db "<db>"`
- 报告样例：`.backups/zotero-import-20261013-192226/report.json`（含 createdIds / updatedIds / 分类与 PDF 统计）
