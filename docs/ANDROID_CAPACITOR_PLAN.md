# Capacitor 安卓原型：技术方案与风险（评估稿）

日期：2026-10-15
状态：**评估稿，待确认**。本轮**未**创建 `android/` 工程、**未**新增任何依赖、**未**签名、**未**发布，也未改动任何代码或冻结单元。
前置：手机展示层（DS-01~DS-03）已交付；**顶层布局与列表/详情导航尚未落地**（`src/App.tsx` 无手机断点代码，见 `docs/ANDROID_MOBILE_DS_REPORT.md` 第 7 节）。本方案假定该阶段完成后再开工。
相关文档：`docs/ANDROID_MOBILE_HANDOFF.md`（第 8 节后续打包阶段）、`docs/FROZEN.md`、`docs/VAULT_FORMAT.md`、`docs/VAULT_WRITE_GATE.md`、`docs/LOCAL_WEB.md`、`docs/WEB_PORTABLE.md`。

---

## 0. 结论摘要

1. 端口只有一个：渲染层所有文件能力都走 `window.knowledgeGraphDesktop`（冻结单元 `desktop-bridge` + `vault-io`）。安卓端只要**原生实现同一份接口**，React/业务/格式代码可以零改动复用。这是本方案最大的杠杆，也是最大的约束 —— 新增方法必须走解冻流程。
2. 手机**不做**桌面同步盘直连。vault 以**沙箱私有目录**为主库，跨设备交换走「导出 zip → SAF 保存/分享 → 另一端导入」。理由是百度网盘安卓端不提供可挂载文件系统，SAF 直连 vault 目录在 Android 11+ 限制下也拿不到可靠性能。
3. 三处降级按用户决定执行：`localPdf` 绝对路径语义在手机上失效 → 改为**重新导入附件**（写进 vault 内 `attachments/`）；Zotero SQLite 首版**不读** → BibTeX / RIS / CSL JSON 文件导入 + DOI/arXiv 联网查询；剪贴板 RTF 域代码 → **纯文本**。
4. 写入门禁（`vaultGate`）在手机上必须完整生效，且手机端**不认识、不生成、不删除**任何它不理解的 front matter 字段。2026-10-14 旧桌面构建抹掉 `zoteroKeys`/`localPdf` 的事故是这条红线的由来。
5. 需要用户批准的四类动作：创建 `android/` 工程、安装依赖/插件（含自定义原生插件）、签名、发布。四者在本文中**只做选型与验收标准，不做实施**。

---

## 1. 现状基线（可直接复用的能力）

| 能力 | 现有实现 | 手机端复用方式 |
| --- | --- | --- |
| 文件能力抽象 | `src/lib/vaultFs.ts`、`src/lib/attachments.ts`、`src/lib/syncFile.ts` 全部转调 `window.knowledgeGraphDesktop.*`（约 27 个方法） | 原生桥实现同一接口；渲染层不改 |
| vault 目录句柄 | `resolvedVaultDir()`：用户选择值 → `defaultVaultDir` 兜底 | 手机上 `dir` 退化为**不透明句柄**（`sandbox://vault` 或 `saf://<编码后的 tree uri>`），接口字符串不变 |
| 写盘 | `useVaultWriter`：`WRITE_DEBOUNCE` 防抖 + `flush()`；`vaultGate` 门禁 + 删除数 0 约束 | 生命周期钩子直接调用已有 `flush()` |
| 附件 | `attachments.ts`：`attachments/<id>.pdf` + `attachments/<id>.annotations.json`，`addPdfToVault(File)`、`readPdf`、`removeAttachment` | PDF 重新导入的落盘路径**已经存在**，只需接一个文件来源 |
| 匹配规则 | `src/lib/pdfMatch.ts`：`matchScore(title, fileName)`、`indexKeysFor`、`stripZoteroPrefix` | 重新导入附件时按文件名↔标题匹配，规则与 `pdf:link` 同源 |
| 文献导入 | `src/lib/literature.ts`（citation-js）：DOI、arXiv、BibTeX、RIS、CSL 转换 | 已是降级路径的全部底座 |
| 冲突检测 | `src/hooks/useVaultConflicts.ts` | `resume` 时用它替代移动端不可靠的 `fs.watch` |
| 构建产物 | `npm run build` → `dist/`，`npm run release:web` → 免安装网页包 | Capacitor 的 `webDir` 指向同一 `dist/` |

**不可复用**：`scripts/local-web.mjs` / `start-portable-web.mjs`（安卓没有 Node 运行时；把 Node 打包进 APK 体积、启动与商店政策都不可接受，明确排除）。

---

## 2. 架构：安卓端桥接层

```
React 业务层（不改）
  └─ vaultFs.ts / attachments.ts / syncFile.ts / pdfSource.ts
       └─ window.knowledgeGraphDesktop        ← 冻结合同（唯一端口）
            ├─ 桌面版：electron/preload.cjs（现状）
            ├─ 本地网页版：scripts/local-web.mjs（现状）
            └─ 安卓版：Capacitor 原生桥（本方案新增，Kotlin）
                 ├─ 沙箱 vault 读写（app-private）
                 ├─ SAF 选择器（导入 / 导出 / 备份）
                 ├─ FileProvider + 系统分享 / 打开
                 ├─ 返回键与应用生命周期事件
                 └─ 剩余空间查询
```

**设计原则**

- 端口不扩散：安卓桥只实现已有方法语义；新增方法（分享、返回键、剩余空间）**先出提案 → 解冻 `desktop-bridge` → 同步 `docs/FROZEN.md` → 桌面实现同步补齐**，否则两端能力表会漂移。
- 能力缺失要「显式不可用」，不能返回 `undefined`：`vaultSupported()`、`attachmentsSupported()` 是按方法存在性判断的，缺失方法必须缺席或抛明确错误，让 UI 走降级提示，而不是静默失败。
- 目录句柄统一为不透明字符串，安卓端用 scheme 前缀区分沙箱/SAF，渲染层继续用字符串比较与存储，不新增分支。

### 2.1 契约逐项能力表（首版，v1 = 不含 SAF 外部库）

| 方法组 | 安卓 v1 | 说明 |
| --- | --- | --- |
| `chooseVaultDir` / `listVault` / `readVaultFiles` / `writeVault` / `openVaultDir` | 可用 | 落在沙箱主库；`openVaultDir` 语义变为「在系统文件管理器中不可见」→ 返回明确提示文案 |
| `listAttachments` / `readAttachment` / `writeAttachment` / `removeAttachment` | 可用 | app-private 读写，二进制走 Uint8Array |
| `openAttachmentExternal` | 语义变化 | 不再调用桌面阅读器，改为 FileProvider `ACTION_VIEW` / 分享面板 |
| `chooseOpenAttachment` / `chooseSaveAttachment` | 可用 | 映射到 SAF 选择器；取消返回 `null`，不报错 |
| `chooseSyncFile` / `readSyncFile` / `writeSyncFile` | 沙箱内可用 | 跨设备同步文件需 SAF 目录（v2） |
| `writeClipboardRtf` | **不可用（降级）** | WebView 无 CF_RTF，见 §11.3 |
| `readZotero` / `openZoteroPdf` / `readZoteroPdf` / `selectZoteroItem` | **不可用（降级）** | 见 §11.2 |
| `openExternalFile` / `readExternalPdf` | **不可用（降级）** | `localPdf` 绝对路径在手机上无意义，见 §11.1 |
| `aiStatus` / `aiComplete` | 待确认 | 网关通常是局域网 `http://` 明文地址：Android 9+ 默认禁明文，且手机与 PC 不同网即不可达。要么走 HTTPS 公网网关，要么首版隐藏 AI 入口 |
| `isElectron` / `isLocalWeb` / `defaultVaultDir` / `defaultZoteroDb` | 重定义 | 全部为「安卓」语义：`isElectron=false`、`isLocalWeb=false`、`defaultVaultDir='sandbox://vault'`、`defaultZoteroDb=''` |

---

## 3. 应用沙箱存储

**目录布局（app-private，`Directory.Data` 对应的 `files/`）**

```
files/
  vault/                 # 主库，与桌面 vault 同构：meta.json + *.md + attachments/
    meta.json
    *.md
    attachments/<id>.pdf, <id>.annotations.json
    sync/notes.json
  snapshots/             # 自动快照（写前 + 每次批量操作前），保留最近 N 份
  drafts/                # 编辑中草稿 journal，见 §10
  tmp/                   # 导入中转、zip 生成、分享前拷贝
  vault-identity.json    # vault 身份：id + 创建时间 + 规格版本，防串库
```

**要点与理由**

1. 沙箱私有目录**不需要任何运行时权限**，读写是原生速度，`listVault`（668 md + meta 710 条）可在百毫秒级完成 —— 这是把它选为主库的核心原因。
2. 代价：**卸载即全部丢失**；Android 11+ 起 `Android/data/<pkg>` 也不再对第三方文件管理器开放，用户无法手动拷出。因此「备份/导出」不是可选功能，而是首版必须有的出口（§4）。
3. 首次启动必须走**引导**（已有 `Onboarding.tsx`）：说明数据只在本机、如何导出备份、如何恢复；不接受「点过就忘」的静默创建。
4. `vault-identity.json` 用于拒绝把「另一个 vault 的备份」静默合并进当前库：恢复时身份不一致必须显式确认。
5. SAF 外部库（v2，非首版）：`ACTION_OPEN_DOCUMENT_TREE` + `takePersistableUriPermission`，`dir` 句柄为 `saf://…`。**已知代价**：DocumentFile 逐个子项查询很慢，668 文件的列目录可能到秒级；SAF 也不保证 `rename` 原子性与 mtime 语义。故 v2 定位为「只读/低频交换」，不做默认工作库。

---

## 4. 备份与恢复

**备份**

- 内容：`meta.json` + `*.md` + `attachments/`（可选，PDF 体积大）+ 清单 `manifest.json`（vault 身份、`formatVersion`、生成时间、条目数、每个文件的 sha256、备注「仅笔记 / 含附件」）。
- 生成：在 `tmp/` 里流式打包，避免整包进 JS 内存。**当前仓库没有任何 zip 依赖**（多依赖 `better-sqlite3`/Node 脚本与系统压缩工具），安卓端需要「自带 zip 库」或「原生 zip」二选一 —— 二者都属于**新增依赖/原生代码，需批准**；选型前先做体积与内存实测。
- 出口三条，用户自选：① SAF 保存到自选目录；② 系统分享面板（网盘/邮件/IM）；③ 若已授权 SAF 目录，直接写入该目录。
- 命名：`kg-vault-YYYYMMDD-HHmm.zip`，含身份与版本，便于恢复时校验。

**自动快照（沙箱内）**

- 触发点：每次批量写（Zotero/DOI 导入、去重、附件批量导入）、每次恢复前、每日首次启动。
- 策略：只存 md + meta（不存附件），滚动保留最近 N 份并设总量上限；超限先删最旧。上限与 N 写进设置，默认值待定。

**恢复**

1. 选文件 → 解包到 `tmp/`；
2. 读 `manifest.json` → 过 `vaultGate`：`formatVersion` / `minimumWriterVersion` / `requiredCapabilities` 超限即**只读拒绝**，并说明原因；
3. 与当前库做**试算**（复用 `planVaultWrite` 思路）：列出新建 / 更新 / 删除/跳过；
4. 默认**合并**（按笔记 id 匹配），不默认覆盖；删除数必须为 0，超出即要求显式确认；
5. 落盘顺序：快照 → 写 md → 写 meta（meta 最后）→ 校验 sha256 抽检 → 报告结果；
6. 任一步失败：回滚到快照，保留 `tmp/` 现场供排查，**不允许半写状态留库**。

---

## 5. 文件导入导出

| 类型 | 入口 | 目标 | 约束 |
| --- | --- | --- | --- |
| `.md` 笔记 | 现有 `BackupTransferMenu` 隐藏 input → 改为 SAF 选择器 | vault 根 | 未纳管 md 不覆盖；同名冲突要显式询问 |
| JSON 备份 | 现有导入备份 | 全库 | 走 `vaultGate` 与试算 |
| BibTeX / RIS | 现有 `BibImportDialog`（粘贴） | 新建文献笔记 | 与 `zoteroMeta` 匹配规则一致，避免桌面再同步时重复建 |
| CSL JSON | **新增**（citation-js 已支持解析） | 新建文献笔记 | 规则同上 |
| PDF | **重新导入附件**（§11.1） | `vault/attachments/<id>.pdf` | 复用 `addPdfToVault`；匹配用 `pdfMatch.matchScore` |
| 主题 CSS | 现有入口 | 主题目录 | 手机上「打开目录」不可用 → 改为应用内主题管理 |
| vault zip | §4 | 全库 | 同上 |
| 文献表 | 现有「复制引用」 | 剪贴板纯文本（RTF 降级） | 见 §11.3 |

**铁律**：SAF 返回的 `content://` URI **绝不写入任何数据文件**。所有外部文件一律先复制进沙箱/ vault 再引用 —— URI 会失效，持久化授权也只是概率成功，一旦落进 front matter 就是数据损坏。

---

## 6. 返回键

当前 `src/main.tsx` 挂了 `BrowserRouter`，但 `App.tsx` 没有路由，导航是组件内 state。返回键要做对，先要有**单一导航栈**：

- 建议：顶层视图（列表 / 详情 / 图谱 / 文献 / 引文）收敛为一个显式栈（引入 `Routes` 或自建 store，二选一，由响应式阶段决定），返回键只消费这一个来源。
- `backButton` 处理优先级：① 关闭最上层弹窗/菜单（Radix 层用 `onOpenChange(false)`，注意不能靠合成事件猜）→ ② 若有未保存编辑，弹确认（再按一次才退出，不用阻塞式 `confirm`）→ ③ 详情退列表 → ④ 已在列表根：两次按内 `App.minimizeApp()`（安卓惯例），不直接退出。
- 与手势返回、系统返回共用同一处理函数，禁止在组件里各自 `history.back()`。
- 验收：每一层的返回都能用键盘 Esc 与系统返回**得到同一结果**；弹窗嵌套（如确认框盖在 Dialog 上）只关一层。

---

## 7. PDF 打开与分享

**应用内阅读（首选）**：`pdfSource` 的 `attachment` 分支已可用；沙箱附件直接读。`local`/`zotero` 两个分支在安卓恒不可用，UI 要给出「本机没有这份 PDF，重新导入」而不是报错。

**系统打开 / 分享**：沙箱文件不能直接把 `file://` 路径给别的应用，必须：

1. 读（或直接从 `attachments/` 复制）到 `Directory.Cache`（应用内缓存，属 FileProvider 可暴露路径）；
2. 取 `content://` URI（FileProvider authority）；
3. `ACTION_VIEW`（系统 PDF 阅读器）或系统分享面板（微信/网盘/邮件）；
4. 授予读权限的 Intent flag 必须显式带上，否则接收方拿到 URI 也读不了；
5. `tmp/`、`Cache` 里的副本在分享结束后（或启动时）清理，避免副本在手机里无限堆积 —— 尤其注意这是**用户隐私副本**。

选型注意：Capacitor 官方 Filesystem/Share 是否覆盖「从 app-private 文件生成可分享 URI」需要先做一次最小验证（只读调研，不加依赖）。若不覆盖，退化为一个几十行的自定义 Kotlin 插件提供 `shareFile(path) / viewFile(path)`，同样需批准。

---

## 8. 权限拒绝

**默认零运行时权限**：沙箱读写、SAF 选择器（用户交互式临时授权）、分享、FileProvider、返回键**统统不需要**危险权限。首版不申请 `READ/WRITE_EXTERNAL_STORAGE`、不申请通知权限（如后续要「后台保存完成提醒」再单独讨论）。

| 场景 | 用户行为 | 期望表现 |
| --- | --- | --- |
| 选择 PDF/zip 时按返回 | 取消 | 静默回到上一态，**不报错、不 toast 错误**（区分「取消」与「失败」） |
| 拒绝某次 SAF 授权 | 拒绝 | 提示可重试；不写入任何半成品 |
| 持久化目录授权失效（重启/换设备后） | — | 该 vault 标记为「需要重新授权」，只读并给出重新选择入口 |
| 无法获得任何可写位置 | — | 降级为纯只读浏览 + 明确说明，不静默丢弃用户编辑（参考现有门禁的只读通道） |
| 被永久拒绝（不再询问） | — | 文案说明去哪开权限 + 提供「改用沙箱目录」的替代路径 |

原则：**权限拒绝不是错误状态，是一条降级分支**。UI 文案要与 `DataSafetyStatus` 的现有语义对齐（「能写 / 只读 / 不能写」）。

---

## 9. 空间不足

1. **预检**：导入/恢复/导出前估算所需空间（笔记 = meta+md 大小；zip ≈ 内容的 1.0~1.3 倍；附件 = 原文件大小 + 快照），与剩余空间比对，低于安全阈值（建议 50 MB 或估算值的 1.5 倍）直接拒绝并说明。剩余空间需原生 `StatFs`（`navigator.storage.estimate()` 只反映 WebView 源配额，不反映设备空间）→ **新增原生调用，需批准**。
2. **错误映射**：`ENOSPC` / `QuotaExceededError` / 写入返回 0 字节，统一映射为「空间不足」文案，绝不显示原始错误码，也不重试。
3. **原子性**：批量写入一律「临时文件 → 校验 → 改名/替换 → 最后写 meta」；失败保留原文件。删除数仍需为 0。
4. **zip 的空间放大**：打包需要「源 + 包」两份空间；若空间不足则提示「先导出到外部目录再删本地缓存」，或提供「仅笔记不含附件」的轻量备份。
5. **磁盘写满时的落盘策略**：优先保住 `meta.json` 与 md 的一致性；附件写失败只报附件失败，不让库处于半状态。
6. 验收：用真机或模拟器的受限存储配额跑一次「导入大 PDF → 中途空间耗尽」，确认库文件与备份均为可打开状态。

---

## 10. 生命周期保存

1. **保存时机**：沿用已有 `useVaultWriter` 的防抖 + `flush()`，在 `appStateChange(isActive=false)`、`pause`、`visibilitychange(hidden)`、返回键退出前，都调用一次 `flush()`。
2. **`beforeunload` 不可依赖**：WebView 里不可靠，不能作为唯一保存点。
3. **草稿 journal**：编辑中不直接改正库。每次编辑把草稿写 `drafts/<noteId>.json`（含时间戳与内容哈希），落正库成功后删除。被系统杀进程后，下次启动发现残留草稿 → 提供「恢复/丢弃」二选一。这是防「安卓直接杀进程不给回调」的兜底。
4. **resume 时重扫**：移动端没有可靠的 `fs.watch`（SAF 更不保证），改为 `resume` 时 `listVault` 重扫 + 用 `useVaultConflicts` 的规则判定外部改动；发现磁盘版本变化时按「不静默覆盖」处理（提示三选一：保留本机 / 采用磁盘 / 另存副本）。
5. **长任务**：恢复、批量导入、zip 打包期间禁止被「pause 保存」打断 —— 用互斥标记让生命周期保存排队，而不是并发写。
6. 验收真机项：息屏/切后台/来电 `/`杀进程/低内存回收后重开，检查最后编辑内容是否可恢复、有无重复笔记。

---

## 11. 三处降级的具体设计

### 11.1 `localPdf` 绝对路径 → 重新导入附件

**问题**：`localPdf` 存的是 Windows 绝对路径（`D:\BaiduSyncdisk\…`），手机上没有这个路径；SAF 给的是每次会话可能变化的 `content://`，也不该写进 front matter。

**方案**

- 安卓端**忽略** `localPdf`（不读、不写、**绝不清空**）。它仍是桌面端的有效字段，手机上删除等于毁掉桌面路径 —— 这是 2026-10-14 事故的反面教训。
- 手机上 PDF 的唯一权威来源是 `literature.attachments[]`（vault 内 `attachments/<id>.pdf`），随 vault 一起走，跨设备天然可携带。
- 新增「重新导入 PDF」流程：SAF 多选 PDF → 写 `attachments/`（复用 `addPdfToVault`）→ 按文件名与文献标题匹配（复用 `pdfMatch.matchScore` + `stripZoteroPrefix` + `cleanLiteratureTitle`）→ **匹配不唯一或低于阈值时不自动归属**，进入待认领列表由用户点选（避免一份 PDF 归两篇）。
- 进度与失败：大 PDF（上限沿用桌面 150 MB 约定）复制要显示进度；中断不留下孤儿文件（先写 `.part` 再改名）。
- 批量认领可直接复用 `scripts/link-local-pdfs.ts` 的匹配语义，但**不要把该脚本搬进 APK**（它依赖 Node）—— 抽公共匹配函数即可。

### 11.2 Zotero SQLite → BibTeX / CSL JSON / DOI（首版）

**问题**：`zotero.sqlite` 在桌面同步盘，安卓端既拿不到可靠文件路径，也没有 SQLite 读取能力（`better-sqlite3` 是 Node 依赖）；即便能读，也只读同步盘的一份快照。

**方案**

- 安卓端 `readZotero` 等四个方法**整体不可用**，`zoteroSyncPanel` 等入口在手机上是隐藏或降级提示，不做「假同步」。
- 替代链路（都在现有能力内）：① Zotero 桌面「导出文献库 → BibTeX / CSL JSON」→ 传到手机 → 导入；② 直接粘贴 BibTeX / RIS（已有 `BibImportDialog`）；③ 单篇按 DOI / arXiv 联网补全（已有 `ImportFromDoi/Arxiv`）。
- **匹配规则必须与桌面同源**（`zoteroMeta.ts`）：按 DOI → citekey → 标题+年份 的优先级匹配，避免「手机导入一遍、桌面再同步又建一遍」的重复笔记。这是首版最容易出数据事故的地方，需要专门回归用例。
- 手机导入的条目通常没有 `zoteroKey`：桌面 `zotero:sync` 之后要靠 DOI/标题规则认回。若认不回，会新建笔记 —— 需要在 `docs/VAULT_FORMAT.md` 里明确这条不变量，并提供一条手工「合并/关联」入口。
- 联网查询需要 `INTERNET` 权限（Capacitor 模板默认含）、HTTPS、超时与失败重试；离线时直接提示，不做后台队列（首版）。
- `zotero://select` 在 Android 端不可依赖：改为「复制 DOI / 打开 DOI 落地页」。

### 11.3 RTF → 纯文本

**现状**：`writeClipboardRtf` 只用于「复制文献表 + Word 域代码」（`src/lib/rtfField.ts`、`CitationsView`、`LiteratureToolbar`），桌面走 CF_RTF；浏览器写不了 `text/rtf`。

**方案**

- 安卓端复制**纯文本**文献表（现有 plain-text 分支已存在），按钮文案明确写「复制纯文本文献表（不含 Word 域）」，并在首次使用时说明：手机上无法粘贴成 Zotero/Word 可刷新的引文域，需要域代码请在桌面端操作。
- `writeClipboardRtf` 在安卓桥中**不存在**（或返回明确错误）；调用点需判能力后再决定走 RTF 还是纯文本，不能让 `undefined` 崩掉。
- 可选增强（不进首版）：额外提供 HTML 剪贴板变体（WebView 支持 `text/html`），Word/WPS 移动端粘贴可保留上下标；能否保留域代码要实测，不预先承诺。

---

## 12. 风险登记表

| # | 风险 | 级别 | 触发条件 | 缓解 | 验证方式 |
| --- | --- | --- | --- | --- | --- |
| R1 | 新增桥接方法要解冻 `desktop-bridge`/`vault-io`，两端能力漂移 | P1 | 为分享/返回键/剩余空间加方法 | 先出契约提案 → `npm run test:frozen` 全绿 → `frozen:update` → 同步 `docs/FROZEN.md`；桌面端同步实现或显式声明不支持 | `npm run frozen:check` + 契约文档一致性检查 |
| R2 | 手机端回写抹掉不认识的字段（`localPdf`/`zoteroKeys` 事故重演） | P0 | 手机端 `toMarkdown`/写盘未过门禁 | 手机端必须走 `vaultGate`（策略 B：只改自己认识的字段）；「忽略但不删」作为验收项 | 用带 `zoteroKeys`/`localPdf` 的样本在手机上「改标题 → 保存」后 diff 字段 |
| R3 | 卸载/清数据即全库丢失 | P0 | 用户在沙箱主库模式下卸载 | 首次启动引导 + 强制可发现的备份出口 + 自动快照 + 定期提醒 | 真机卸载重装演练，确认备份可完整恢复 |
| R4 | 手机导入文献与桌面 `zotero:sync` 互相建重复笔记 | P1 | 无 `zoteroKey` 的条目 | 匹配规则与桌面同源 + 合并入口 + 回归用例 | 构造「手机导入 → 桌面 sync」场景，断言 0 新建 |
| R5 | 大 vault + 大附件导致 OOM/卡顿（668 篇真实规模，附件可能上百 MB） | P1 | zip 打包、PDF 读取、列表渲染 | 流式处理、分块、避免整包进 JS 内存；列表虚拟化继续观察；沿用 150 MB 附件上限 | 真机跑 668 篇 + 200 MB 附件的一次完整备份 |
| R6 | SAF 性能与语义（列目录慢、无原子 rename、授权失效） | P1 | v2 直连外部目录 | v1 只用沙箱；SAF 仅作导入导出通道，不做工作库 | SAF 目录上跑 668 文件的列目录计时 |
| R7 | 生命周期杀进程丢最后编辑 | P1 | 后台被回收 | pause 强制 flush + 草稿 journal + 崩溃恢复入口 | 真机「编辑后立即杀进程」恢复演练 |
| R8 | 空间不足导致半写/损坏 | P0 | 低存储导入/备份 | 预检 + 原子写 + 写前快照 + 失败回滚 + 删除数 0 | 受限空间跑导入，检查文件可打开 |
| R9 | 插件/依赖选型失真（官方插件不覆盖 app-private 分享、zip、StatFs） | P2 | 依赖能力假设错误 | 先做只读调研 + 最小验证，再报批准；备选是自写小插件 | 一次最小 PoC（不改主仓）|
| R10 | AI 网关在手机不可用（局域网明文 HTTP、跨网不可达） | P2 | 用户期望手机也能用 AI 统筹 | 首版隐藏或标注「需与网关同网且已配置」 | 手机连同一 Wi-Fi 实测 `aiStatus` |
| R11 | 隐私：分享/缓存的 PDF 副本、备份 zip 留在手机各处 | P1 | 分享后未清理、导出到公共目录 | 分享副本用后即清 + 备份导出显式提示落点 + 不做后台静默上传 | 分享后检查 `Cache`/`tmp` 是否清空 |
| R12 | 真机差异（厂商 ROM 杀后台、WebView 版本、软键盘） | P2 | 各机型测试不充分 | 明确测试矩阵，至少覆盖 Android 12/14 各一台 + 一家厂商 ROM | 真机矩阵表 |
| R13 | 响应式顶层导航未落地导致返回键无栈可依 | P1（阻塞） | 直接开工安卓壳 | 等响应式阶段把顶层视图栈定下来再加返回键；其余部分可先行 | 响应式阶段验收后再接返回键 |

---

## 13. 分期与验收门槛

| 阶段 | 内容 | 门槛 | 需要批准的动作 |
| --- | --- | --- | --- |
| T0 调研（不动仓库） | 插件能力核对：私有文件分享 URI、SAF 选择、zip、StatFs、返回键与生命周期事件；用现有 `dist/` 在既有 WebView 容器里跑通渲染与性能 | 出一页调研结论 + 明确「哪些必须自写原生」 | 否（只读调研） |
| T1 最小壳 | 创建 `android/`、加插件、沙箱 vault 桥（vault + 附件读写）、FileProvider 分享、返回键（依赖响应式顶层栈） | 668 篇库能列目录、打开、编辑保存、分享一份 PDF | **创建工程 + 安装依赖** |
| T2 数据安全 | 备份/恢复、zip、导入导出矩阵、生命周期保存与草稿、权限拒绝与空间不足的降级路径 | 验收：备份可完整恢复；杀进程不丢；低存储不半写；`vaultGate` 在手机上生效 | 依赖 T1 |
| T3 降级收尾 | localPdf 重新导入、BibTeX/CSL/DOI 导入、RTF→纯文本 | 验收：三处降级文案与实际行为一致；桌面路径字段不被改动 | 依赖 T1 |
| T4 真机验收与发布 | 多机型矩阵、签名、发布 | 用户在真机上验收通过 | **签名 + 发布** |

每阶段结束后跑：`npx tsc -b` → 目标测试（`test:vault`、`test:vault-gate`、`test:lit`、`test:web`）→ `npm run frozen:check` → 需要时 `npm run build`。不重复构建。

---

## 14. 待用户确认的决策点

1. **主库位置**：接受「沙箱为主库 + 显式导出/导入」吗？（另一个选项是首版就做 SAF 外部库，代价是性能与授权复杂度，见 R6。）
2. **zip 方案**：允许为打包新增一个渲染层 zip 依赖，还是宁可写原生 zip（都算新增依赖/原生代码）？
3. **AI 入口**：手机首版隐藏，还是投入做 HTTPS 公网网关？
4. **附件是否进备份默认集**：默认含附件（体积大）还是默认仅笔记、附件另选？
5. **Zotero 替代链是否够用**：接受「Zotero 桌面导出 BibTeX/CSL JSON → 传到手机导入」这条手工链作为首版正式路径吗？
6. **返回键与顶层导航**：先等响应式阶段的顶层栈方案定稿，还是并行推进（会让返回键返工）？

