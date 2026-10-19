# 交接说明（2026-10-13 · Word 域代码引用修复）

> 历史记录：其中的 Electron 发布目录操作已由当前 `docs/RELEASE.md` 取代，不再执行。

> **状态：已完成并验证**（接手会话 2026-10-13 晚）。结论与实现见下，第 3 节的步骤已全部落地。

上一轮交接见 `docs/KIMI_HANDOFF_2026-10-13.md`（Zotero 导入 / 本地 PDF / Vditor 编辑器，已全部完成并提交 `6b57fd5`，工作树干净）。本文只写本轮未完成的：**「插入 Word 引用（域代码）」在浏览器里降级为纯文本**。

---

## 1. 问题

文献笔记 → 「复制引用」→「插入 Word 引用（域代码）」→ 粘到 Word 是纯文本。
原因：写剪贴板走 `navigator.clipboard.write` 的 `text/rtf`，Chrome/Edge **不支持**该类型 → `src/lib/rtfField.ts:106` catch 后回退纯文本。

## 2. 实验结论（本机已实跑验证，脚本保留在 scripts/）

| 通道 | 结果 |
|---|---|
| CF_HTML + `mso-element:field-begin/separator/end`（含/不含 Word 序言、裸指令/条件注释指令，6 种变体） | ❌ Word 粘贴全部忽略，只出字面文本。**死路，别再试** |
| CF_RTF 最简域 `{\rtf1\ansi{\field{\*\fldinst PAGE}{\fldrslt 1}}}` | ✅ fields=1，code=PAGE |
| **RTF 语法要点**：`\fldinst` 指令**不能加花括号** | `{\*\fldinst ADDIN X}{\fldrslt R}` ✅；`{\*\fldinst{ ADDIN X }{\fldrslt R}}` ❌；`{\*\fldinst{ PAGE }...}` ❌ |

**现有代码 bug**：`src/lib/rtfField.ts` 的 `buildCitationFieldRtf` 生成 `{\field{\*\fldinst{ ADDIN ZOTERO_ITEM ... }{\fldrslt ...}}}` —— 指令被花括号包住，按上表**即使走 RTF 通道也成不了域**。这是第一处要改的。

实验脚本（可复跑，均用 Word COM 验证）：
- `scripts/word-field-experiment.ps1`（HTML 6 变体，全失败）
- `scripts/word-rtf-bisect.ps1`（RTF 语法二分，V1/V4 成功）
- `scripts/word-rtf-real.ps1`（完整粘贴验证：读 `.tmp-vault-test/rtf-payload.txt` → CF_RTF 剪贴板 → Word 粘贴 → 打印 fields/codes）
- `scripts/gen-rtf-sample.ts`（esbuild 打包打印真实 buildCitationFieldRtf 输出）

## 3. 实施步骤（按序）

1. **修 `buildCitationFieldRtf`**（`src/lib/rtfField.ts:65`）：
   `{\field{\*\fldinst ADDIN ZOTERO_ITEM ${rtfEscape(json)}}{\fldrslt ${displayToRtf(...)}}}`
   （去掉 `\fldinst` 后的 `{` 和指令尾的 ` }`；Zotero 兼容格式 `ADDIN ZOTERO_ITEM <json>` 中间一个空格。）
   同步更新引用该格式的单测（grep `fldinst` 找全部断言）。
2. **剪贴板写入四通道优先级**（改 `writeRtfClipboard`）：
   a. **桌面 Electron**：`electron/main.cjs` 加 `ipcMain.handle('clipboard:write-rtf', ...)` 用 Electron `clipboard.write({ rtf, text })`；`electron/preload.cjs` 暴露 `writeClipboardRtf`；`src/types/desktop.d.ts` 补类型。
   b. **本地网页端（4173）**：`scripts/local-web.mjs` 加 `POST /api/clipboard-rtf {rtf, plain}` → 写 payload 到临时文件 → spawn PowerShell 按 `scripts/word-rtf-real.ps1` 的 DataObject 方式写剪贴板（**必须走临时文件传参，禁止命令行拼接，防注入**；服务已绑 127.0.0.1）。`scripts/local-bridge.js` 暴露 `writeClipboardRtf`；rtfField 检测 `location.host` 为 127.0.0.1:4173/localhost 时调用。
   c. Safari：`ClipboardItem.supports?.('text/rtf')` 为真时走原生 `navigator.clipboard.write`（保留现有代码）。
   d. 都失败 → 纯文本 + 现有 toast 提示。
3. **RTF 文档包装**：clipboard 写入时包完整 RTF 文档头 `{\rtf1\ansi\deff0{\fonttbl{\f0 Arial;}}\f0\fs24 <field>\par}`（参考 `scripts/gen-rtf-sample.ts`；改完后用 `word-rtf-real.ps1` 实跑验证 fields=1 且 code 以 `ADDIN ZOTERO_ITEM` 开头）。
4. **验证**：`npm run test:lit`（rtfField 单测）→ `npm run build`（4173 即时生效，无需重启服务）→ `word-rtf-real.ps1` 真机验证 → 完成后清理 `scripts/word-*.ps1`、`gen-rtf-sample.ts`（或保留 bisect 作回归）。
5. 桌面版：`release/知识图谱-v0.3.2/resources/app/` 按需同步新 main.cjs/preload/dist（用户主要用网页端，优先级低）。

## 4. 关键路径

- 要改的核心：`src/lib/rtfField.ts`（唯一业务逻辑点）
- 入口调用：NoteEditor.tsx 的 `copyWordCitation`、LiteratureView 的引用复制
- 验证环境：本机装有 Word（COM 自动化可用，实验脚本即模板）
