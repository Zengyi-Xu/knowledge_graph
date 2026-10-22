# Zotero 标注与子笔记：导入（只读）与回写（只增）

> 状态：2026-10-23 首版（单篇手动同步）；同日加 P1 回写。
> 导入**只读 Zotero**：不写 Zotero 数据库、不复制 PDF、不改文献 front matter、不自动改 Markdown 正文。
> 回写只做一件事：把本软件里画的高亮**新建**成 Zotero 附件下的 annotation 条目（只增，不删、不改 Zotero 已有对象）。

## 1. 能做什么

- 在 PDF 阅读工作台 / 文献详情附件区点「同步 Zotero 标注」，把这篇文献的 Zotero 高亮与子笔记读进来。
- Zotero 高亮按原有渲染路径画在 PDF 上（颜色跟随 Zotero，只读：不能在本软件删除或改批注）。
- 「Zotero 标注」列表同时列出**画不上去**的标注（图片 / 墨迹 / 便签 / 文本 / 缺文字 / 位置损坏），并给出原因。
- 「Zotero 笔记」面板显示纯文本；「导出到当前笔记」追加到 Markdown（同一条笔记只导出一次）。
- 重复同步幂等：同一份库同步两次，高亮不会翻倍；Zotero 里改颜色/批注会更新，删掉的高亮会消失。
- **回写**：在阅读工作台顶部点「回写 Zotero (N)」，把本软件画的高亮按 PDF 坐标写回 Zotero，
  之后在 Zotero 里打开同一份 PDF 就能看到（第 7 节）；回写过的条目标「已回写 Zotero」，不会重复提交。

明确不做：自动追加正文、复制/移动 PDF、图片与墨迹标注绘制、跨 PDF 副本猜身份、
**删除/修改 Zotero 里已有的标注**、全库后台自动回写、双向编辑同步。

## 2. Zotero 数据库关联（真实 schema）

```
itemAnnotations.parentItemID ──► itemAttachments.itemID ──► itemAttachments.parentItemID ──► items(书目, key)
itemNotes.parentItemID       ──► items(书目) 或 itemAttachments.itemID（两种挂法都要查）
```

- `itemAnnotations.type` 是内部编号（没有 `annotationTypes` 表可 join）：

  | 值 | 类型 | 是否画到 PDF |
  | --- | --- | --- |
  | 1 | `highlight` | ✅ |
  | 5 | `underline` | ✅（按高亮方式降级） |
  | 2 | `note`（便签） | ❌ 列表显示 |
  | 3 | `image` | ❌ 列表显示 |
  | 4 | `ink` | ❌ 列表显示（position 里只有 paths，没有 pageIndex） |
  | 6 | `text`（文本框） | ❌ 列表显示 |

- `position` 是 Zotero 序列化的 JSON：`{"pageIndex":37,"rects":[[x1,y1,x2,y2]]}`，
  坐标是 PDF 点、原点在左下。**`pageIndex` 从 0 开始**，本软件页码 = `pageIndex + 1`。
  `pageLabel` 只是显示用的页码标签（可能是 `38`、`xiv`），不能当页索引。
- `items.dateAdded / dateModified` 是 UTC 的 `YYYY-MM-DD HH:MM:SS`，桥接层转成 ISO（`…Z`）再交给页面。
- 标注/笔记自身也要排除 `deletedItems` 里的条目。

`electron/zoteroFs.cjs` 的 `readZoteroMarkup(dbPath, zoteroKey, extraKeys?)` 负责这段查询，
对外只暴露 `window.knowledgeGraphDesktop.readZoteroMarkup`（Electron IPC `zotero:read-markup` / 本地网页同 action）。
附件路径由主进程/本机服务从数据库解析，**页面不能传任何附件路径**；数据库路径在桌面端按用户选定的
`zotero.sqlite` 校验，网页端只认启动参数 `--zotero-db` 授权的那一个。

## 3. sidecar 存储

与本地标注 `.annotations.json` 完全分开（避免旧版本回写时覆盖其中一方），
文件名复用 `annotationStoreId(noteId, pdfSource)`：

```text
<vault>/attachments/<annotationStoreId>.annotations.json   # 本软件自己的高亮（可编辑）
<vault>/attachments/<annotationStoreId>.zotero.json        # Zotero 只读镜像（同步整份替换）
```

```json
{
  "format": "kaust-kg-zotero-markup",
  "version": 1,
  "noteId": "l-1750000000000-abc",
  "parentKeys": ["B72ZZ5KU"],
  "attachmentKey": "MDST3RNK",
  "attachmentPath": "C:\\Users\\<你>\\Zotero\\storage\\MDST3RNK\\论文.pdf",
  "attachments": [
    { "key": "MDST3RNK", "parentKey": "B72ZZ5KU", "path": "…\\论文.pdf", "fileName": "论文.pdf", "exists": true, "primary": true }
  ],
  "annotations": [
    {
      "key": "NGZU3IN8", "parentKey": "B72ZZ5KU", "attachmentKey": "MDST3RNK",
      "attachmentPath": "…\\论文.pdf", "type": "highlight",
      "text": "levure", "comment": "", "color": "#ffd400",
      "pageIndex": 96, "pageLabel": "85", "rects": [[329.452, 623.078, 361.396, 634.79]],
      "status": "ok", "dateAdded": "2025-02-10T11:28:35Z", "dateModified": "2025-02-10T11:28:35Z"
    }
  ],
  "notes": [
    { "key": "IZKA3966", "parentKey": "LAURQGPP", "html": "<div class=\"zotero-note\">…</div>", "dateAdded": "…", "dateModified": "…" }
  ],
  "skipped": { "unsupportedType": 82, "missingText": 0, "invalidPosition": 0, "otherAttachment": 0 },
  "syncedAt": 1790000000000
}
```

写入走现有附件桥 `writeAttachment`（临时文件 + rename，天然原子）；
**只有查询与写盘都成功才替换**，任何一步失败都保留上一次的 sidecar。

## 4. 合并与身份

- 本地标注永远保留，且只存在 `.annotations.json`；Zotero 记录只存在 `.zotero.json`。
- Zotero 标注 id 固定为 `zotero-<annotationKey>`（不用 `:` 是因为 PDF 引用链接的 id 白名单只有 `[a-zA-Z0-9_-]`）。
- 阅读器拿到的是两份合并后的列表；写盘回调只作用于本地那一份（Zotero 项在 UI 上是只读的）。
- 同步计划 `planZoteroMarkupSync` 用本次完整结果**整份替换** Zotero 部分：
  改颜色/批注/文字 → 新记录生效；删除 → 不在新结果里自然消失；重复 key → 去重只留一份。
- 查询失败、数据库被占用、结果不完整时**不做删除收口**（旧数据原样保留）。

## 5. 当前 PDF 与附件的匹配

| 当前 PDF 来源 | 判定方式 | 不匹配时 |
| --- | --- | --- |
| Zotero（`preferredPdfSource` 的 `zotero`） | 用同步时记下的主附件（与 `readZoteroPdf` 同一规则：按 key 顺序第一份存在的 PDF） | 列表仍显示，注明「属于另一份 Zotero PDF」 |
| `localPdf`（绝对路径） | 规范化路径比较（`\`→`/`、Windows 盘符大小写不敏感） | 同上，不在页面上画 |
| vault 内附件（复制的 PDF 副本） | 不算 Zotero 那份文件 | 提示「当前阅读的是 vault 里的副本」，只列文字 |

同一篇文献有多份 PDF 时，标注按 `attachmentKey` 分组：只画当前那份的，其余计入
`skipped.otherAttachment` 并在面板里警告——绝不把第一份的标注盖到第二份上。
首版不做内容指纹，不靠文件名猜身份。

## 6. 导出到 Markdown

- 高亮：复用 `appendPdfReference`（`## PDF 摘录` + `[↗ PDF 第 N 页]` 链接）；已导出过的标注 id 不会再追加。
- 笔记：

  ```markdown
  ## Zotero 笔记

  > 导入自 Zotero，更新时间：2026-06-21 18:34
  >
  > 笔记正文……

  <!-- zotero-note:IZKA3966 -->
  ```

  注释标记渲染出来是空块（不可见），只用于「同一条 Zotero 笔记只导出一次」的判定。
- 正文 HTML 一律转纯文本显示/导出（`plainTextFromZoteroNote`），组件不使用 `dangerouslySetInnerHTML`。

## 7. 回写 Zotero（只增）

### 7.1 用户流程

1. 先同步一次（Zotero 退出时读 SQLite），确认这篇文献的 Zotero 附件（写进 sidecar 的 `attachmentKey`）。
2. **打开 Zotero**（回写要走 Zotero 10+ 的本地写入 API，Zotero 必须在运行；
   设置 → 高级 → 勾选「允许本机其它应用与 Zotero 通信」）。
3. 在 PDF 阅读工作台里画高亮；顶部出现「回写 Zotero (N)」，点一下。
4. 第一次会弹 Zotero 的授权对话框（Allow / Always Allow / Deny）；选 Always Allow 以后不用再点。
5. 成功后高亮保持本地可编辑，详情弹层里多一行「已回写 Zotero」，Zotero 的同一份 PDF 上立即出现这条高亮。

回写只处理**本软件画的**高亮；Zotero 自己的标注永远只读，不会因为回写被改/删。
一条高亮只会创建一次：本地标注记下返回的 `zotero.key`，之后再点回写会跳过它；
重新同步时也按这个 key 认出「自己刚写进去的那条」，不会在阅读器里叠出一份只读副本。

### 7.2 坐标从哪来

- 画高亮时就把**屏幕选区**换算成 PDF 坐标（pdf.js 视口的 `convertToPdfPoint`，旋转页也对），
  与 `pageLabel`、`sortIndex` 一起存进 `.annotations.json` 的可选字段：

  ```json
  {
    "id": "…", "page": 12, "color": "#ffd54a",
    "position": { "pageIndex": 11, "rects": [[91.027, 275.764, 133.93, 288.115]] },
    "pageLabel": "12",
    "sortIndex": "00011|000456|00321",
    "zotero": { "key": "NGZU3IN8", "attachmentKey": "MDST3RNK", "syncedAt": 1790000000000 }
  }
  ```

- `position` 与 Zotero 的 `annotationPosition` 同构：**`pageIndex` 从 0 开始**、rects 单位 point、原点左下。
- `sortIndex` 是 Zotero 的排序键 `页|字符偏移|距页顶`（各段补零）。字符偏移只数非空白字符，
  与 Zotero 的口径一致；只影响 Zotero 标注列表里的先后顺序。
- 旧版本画的高亮没有这些字段：**不回写、不猜坐标**，在计划里计入 `no-position` 并跳过。

### 7.3 桥与授权

- 新增一个桥方法 `zoteroLocalApi(request)`（IPC `zotero:local-api`，网页桥同名 action），
  `request.action` 三种：`status` / `authorize` / `write`。
- 实现在 `electron/zoteroLocalApi.cjs`（桌面主进程与本机网页服务共用），只连 `http://127.0.0.1:23119/api/`：
  - `GET /api/` 读 `Zotero-Server-ID`（Zotero 10+ 才有，也是「能不能写」的判据）；
  - `POST /api/local/authorize` 拿本地密钥；密钥**只留在宿主进程内存**，页面拿不到；
  - `POST /api/users/0/items` 批量创建 annotation（一次 ≤ 50 条）。
- 单次密钥在一次成功写入后即失效：客户端收到 `401` 会再授权并重试一次；
  用户选 Always Allow 的长期密钥可一直复用。换库（`Zotero-Server-ID` 变了）时清空缓存。
- 写入的条目形如（`annotationType` 必须排在其它 annotation 字段之前，Zotero 会校验顺序）：

  ```json
  { "itemType": "annotation", "parentItem": "MDST3RNK", "annotationType": "highlight",
    "annotationText": "…", "annotationComment": "", "annotationColor": "#ffd54a",
    "annotationPageLabel": "12", "annotationSortIndex": "00011|000456|00321",
    "annotationPosition": "{\"pageIndex\":11,\"rects\":[[91.027,275.764,133.93,288.115]]}" }
  ```

- 错误都有可读原因：Zotero 没开 / 本地 API 没开（403）/ 版本太低（没有 Server ID）/
  用户拒绝（403 denied）/ 请求太频繁（429，带 Retry-After）/ 库被锁（409）/ 换库（412）。
- 回写不碰 `zotero.sqlite`：数据库仍只由只读查询使用，两边互不干扰（因此导入要求退出 Zotero，
  回写要求 Zotero 在运行；两者分先后操作即可）。

### 7.4 测试

- `npm run test:zotero-writeback`：纯逻辑（坐标/排序键、跳过原因、请求体、结果落地、合并去重、文案，41 项）。
- `npm run test:zotero-local-api`：假 Zotero 本地 API 服务器，跑通探测、授权、单次/长期密钥、
  部分失败、401 重授权、拒绝/限流/换库、参数校验（28 项）。
- 真实 Zotero 只在手工验收时连：本机实测需 Zotero 10+ 且本地 API 已启用。

## 8. 测试

| 命令 | 覆盖 |
| --- | --- |
| `npm run test:zotero` | 合成库：标注→附件→书目、类型映射、缺文字/坏 position、多 PDF 归属、子笔记两种挂法、只读哈希（40 项） |
| `npm run test:zotero-markup` | 纯逻辑：页码 +1、稳定 id、颜色、合并、幂等/删除/更新、HTML→文本、路径匹配、导出标记（59 项） |
| `npm run test:zotero-panel` | 面板 SSR：禁用原因、数量、只读、导出幂等、HTML 不进 DOM（17 项） |
| `npm run test:zotero-writeback` | 回写纯逻辑：计划/跳过原因/请求体/落地/合并/文案（41 项） |
| `npm run test:zotero-local-api` | 假本地 API：探测、授权、单次密钥、部分失败、401/403/429/412（28 项） |
| `npm run test:web` | 网页桥：授权库、非法 key、路径注入无效、未配置/不存在条目报错、回写转发与坏请求（75 项） |

## 9. 真实库只读验收（2026-10-23）

- 书目 `B72ZZ5KU`（247 条标注）：主附件 `MDST3RNK`，可画高亮 165 条，跳过 82 条（便签/墨迹/文本）；
- 书目 `LAURQGPP`：141 条子笔记全部归到该条目；
- 书目 `5G9MXU8G`：2 份 PDF（7 + 51 条标注），`otherAttachment` 正确记 51，主附件只拿自己的 7 条；
- 全程未写 Zotero（读前后 sha256 一致，见 `test:zotero` 的只读断言）。

## 10. 已知限制

- 高亮靠**文本重新锚定**（现有 `locateAnchor`）：PDF 文本层与 Zotero 记录的文本略有差异（连字/断词）时可能找不到，
  这时该条不进 `skipped`（它是合法可画标注），但页面上不会出现色块；文字列表仍可看到与导出。
- `rects` 已随记录保存，但首版不直接按坐标绘制（避免再复制一套 SVG 高亮实现）。
- 同一段文字在页内重复出现时，重锚定可能落在第一处。
- 多份 PDF 时只画当前打开的那份；换一份 PDF 要重新进入阅读器（sidecar 不区分「哪份」的显示状态）。
- 回写限制：
  - 必须是**本软件画的高亮**且带坐标（旧版本画的没有坐标，跳过并计数）；
  - 目标附件来自上一次同步的 sidecar：**没同步过就不知道要写到哪份 PDF 上**，按钮会提示先同步一次；
  - 只增不删：在软件里删掉一条已回写的高亮，Zotero 里那条仍然存在（要删得去 Zotero 删）；
    改批注也不会同步回 Zotero（P1 不做双向写回）；
  - Zotero 里已存在一条**内容相同**的高亮时，回写仍会新建一条（不去重：Zotero 没有内容指纹）；
  - 回写要求 Zotero 正在运行且开启本地 API；导入要求退出 Zotero（SQLite 锁），两者要分先后操作；
  - 一次最多 50 条（Zotero 多对象写入上限），更多请分两次点。
