# 文献分类 · 图谱档位 · 汇总类型 · AI 接口 —— 开发规范

> 前置现状（2026-10-11 晚）：文献功能 Phase 0~3 已合并，**2267 篇文献已导入**，
> 应用跑在浏览器 localStorage 模式（尚未选 vault）。本文档规划四件事，
> 分别编号 A~D，按依赖顺序实施，每个阶段独立验收。
> 版本策略：这批功能走 0.3.x；验收后升 1.0.0。

---

## A. 文献分类体系（对齐 Zotero）

### 目标

把 Zotero 的**分类树（collections）**迁移为应用内文献的分类字段，并给每篇文献
自动生成标签；分类与标签的日常维护交给 AI（见 D），人只在例外情况下干预。

### 数据来源

直接只读读取 Zotero 本地库（比导出文件更全、可重复同步）：

- 默认路径：`%USERPROFILE%\Zotero\zotero.sqlite`（用户确认实际路径）
- 用 `better-sqlite3`（主进程，只读打开 + WAL 兼容）读三张表：
  `collections`（层级，parentCollectionID）、`collectionItems`、`items`、
  `itemDataValues`（DOI/title）、`tags` + `itemTags`。
- **绝不写 Zotero 库**；Zotero 运行时会锁库，读不到就提示用户先关 Zotero。

### 数据模型（扩展 LiteratureMeta）

frontmatter 新增两个字段（旧数据缺省为空，向前兼容）：

```yaml
collections: ["硅光/电光调制器", "可见光通信"]   # Zotero 分类路径，多选
```

- `LiteratureMeta.collections: string[]`，序列化/解析规则与 `authors` 完全一致。
- Zotero collection 的**层级用 `/` 压平**成路径字符串（应用现有标签系统也是
  `前缀:值` 的扁平结构，图谱筛选原生支持，零新增机制）。

### 自动标签规则（确定性生成，不依赖模型）

每篇文献自动打两组标签（已存在则不重复）：

| 标签 | 例子 | 来源 |
| --- | --- | --- |
| `期刊:<venue>` | `期刊:Science` | LiteratureMeta.venue |
| `年份:<year>` | `年份:2026` | LiteratureMeta.year |

分类不打标签：**分类树只存在 `literature.collections`**（完整路径）。旧版把树压平成
`方向:<一级分类>` 标签，会与 `collections` 漂移（分类被清空后标签仍留着），现已废弃，
同步/去重时一律清掉。作者名不打标签（会爆炸）。

### 与已有 2267 篇文献的去重合并

- 匹配键优先级：`DOI 完全一致` > `标题小写归一化一致`（去标点/空格）。
- 命中的文献：补上 `collections` 与自动标签，**不覆盖**用户已改过的字段
  （已有同名标签保留；venue/year 已存在则不覆盖）。
- Zotero 里有、应用里没有的：可选「补导入」（沿用 Phase 1 的 BibTeX 管线）。

### 验收

- 关闭 Zotero 时一键同步，2267 篇全部匹配或明确报告未匹配清单；
- 重启应用后 collections/标签完整还原；`test:vault` 增加 frontmatter 往返用例。

---

## B. 图谱四档位 + 大规模布局

### 四档位（图谱视图顶部 SegmentedControl）

| 档位 | 含义 |
| --- | --- |
| **无文献** | 现状：滤掉全部 literature 节点 |
| **仅有关联**（默认） | 只显示**度数 ≥ 1** 的文献节点（被任何笔记 [[双链]]、或作者名命中人物笔记、或被引用关系连接） |
| **全部** | 笔记 + 全部文献（2267+ 节点） |
| **仅文献** | 只显示文献节点及其相互连边（看文献共现/引用网） |

档位写入本地设置；「仅有关联」的度数阈值可配置（默认 1）。

### 大规模布局（节点数 > 500 时自动启用「疏布模式」）

用户明确要求：**节点间充分距离、较低引力和斥力**。实现：

- 进入条件：当前档位渲染节点数 > 500（阈值可调）。
- 自动参数：连线长度 ×1.8、节点斥力 ×0.4、双链引力 ×0.5、中心聚集 ×0.3，
  并在力参数面板显示「疏布模式已自动启用（可手动覆盖）」。
- **标签渲染降级**：仅非文献节点 + 鼠标悬停节点显示文字标签；文献节点用小圆点
  （半径按度数分级）。2267 个 SVG text 节点是性能杀手，必须裁剪。
-  init 布局用 `d3-force` 的 `phylotaxis`/网格初值（比全随机初值更均匀），
  减少「先挤成一团再炸开」的过程。

### 文献之间的边（让「仅有关联」「仅文献」两档有意义）

- **作者→人物**：文献第一作者（或全部作者）的姓/全名命中人物笔记标题时建边，
  在图谱数据层生成（不改 md 内容）。
- **引用关系**：从 Zotero 读 `itemReferences`（2267 篇的内部互引）生成文献↔文献边。
  数据量大，做**懒加载**：只在前两个档位需要时才计算并缓存。
- 标签共现**不做**硬边（聚类视图以后再说）。

### 验收

- 四档位切换流畅；「全部」档位在 2300 节点下拖拽不卡（帧率目测 ≥ 30）；
- 默认档「仅有关联」打开时图谱规模与现在相当；
- 疏布模式触发/退出正确，手动调整参数后不再自动覆盖（会话内记忆）。

---

## C. 新笔记类型：汇总（summary）

### 目标

给 AI 一个专门的落点：周期性/主题性的文献汇总、方向综述。

### 实现

- `NoteType` 增加 `'summary'`（label 汇总，琥珀色 `#e8a34a` 系，区别于现有五色），
  文件夹 `汇总/`，frontmatter 无新字段（正文就是 Markdown，可 [[双链]] 到文献）。
- 「汇总」笔记的编辑器顶部多一条提示条：「此笔记由 AI 统筹生成，可人工修订」+
  「AI 更新」按钮（见 D）。
- 图谱上汇总节点按类型筛选器自然出现，无需特殊处理。

### 验收

- 新建/改类型/重启还原全流程；`TYPE_FOLDERS` 落盘正确。

---

## D. AI 接口：调用本机 Kimi Code 更新 Vault

### 设计原则

1. **AI 不绕过应用**：无论哪种模式，AI 的产出必须经过应用/用户确认才落盘；
   直接改文件的模式也要走 vault 既有的「跟随目录改动」通道（已有审计）。
2. **可重复、幂等**：同一个任务重跑不产生重复笔记/标签。
3. **模型可替换**：接口层与提示词层分离，K2.8/K3 随时切换。

### 本机调研结论（2026-10-11 晚已做）

- 本机 Kimi Code 是 **GUI 应用**（`%LOCALAPPDATA%\Programs\Kimi Code`），
  PATH 上**没有** `kimi` CLI、无全局 npm 包 →「spawn 本机 Kimi Code 进程」不可行。
- 但 Kimi Code 的配置里暴露了一个 **anthropic-messages 兼容的模型网关**
  （`agent-gw.kimi.com/coding`，当前配置模型 `k2p6`），用户的 API key 已在 Kimi Code
  配置中。→ 应用走「**同一个后端**」即可，等价于调本机 Kimi Code 的脑子。
- **因此实现改为**：Electron 主进程直接调该网关（anthropic-messages 协议，
  streaming），key 从 Kimi Code 的配置文件读取（只读，**绝不写入仓库/日志**），
  并在应用设置里允许覆盖（为以后换 K3 / 自建端点留口）。
- 抽象一层 `AiProvider` 接口（`complete(prompt, schema)`），当前实现
  `KimiGatewayProvider`；将来若 Kimi Code 出了 headless CLI 可无缝加
  `LocalCliProvider`。联网需求与「任务必需外无外发」的验收条目同步更新。

### 两种工作模式

**模式 1：AI 批量整理 vault（主力模式，改动量大时）**

- Electron 主进程把任务上下文（文献清单快照 + 指令）发给模型网关，
  要求模型**输出 patch 式的 operations JSON**（与模式 2 同一 schema）。
- 渲染进程展示「AI 提议的改动 N 条」总览 → 用户一键确认（或逐条勾选）→
  走 `planVaultWrite` 落盘。改动量大时也允许用户选「直接落盘并触发
  既有的目录轮询回读」。

**模式 2：应用内申请-确认（精细模式，单篇/小批量）**

- 渲染进程把任务发给主进程 → 主进程调 Kimi Code 的**结构化输出**
  （要求返回 operations JSON：create/update/retag 三类操作，带目标 id 与字段）。
- 应用用 zod 校验 → UI 弹确认面板（逐条列：哪篇、改什么、旧值→新值）→
  确认后走 `planVaultWrite` 统一落盘。**校验不过就整批拒绝并附 AI 原始输出**。

### UI

- 顶栏「AI 统筹」按钮 → 面板，内置任务模板：
  1. 同步 Zotero 分类（= A 的启动入口）
  2. 整理文献标签/分类（全库或按一级分类限定范围）
  3. 生成方向汇总（选一级分类 → 产出「汇总」笔记：该方向文献清单、
     趋势、值得读 Top-N，互链 [[citekey标题]]）
  4. 图谱健康检查（孤儿文献、断链、疑似重复）
- **自由提问（2026-10-19 已实现）**：面板顶部有输入框，支持多轮对话；可选上下文
  「不附笔记 / 当前笔记 / 当前笔记 + 关联（双链与反链，最多 8 篇，60k 字符截断）」。
  回答用 Markdown 渲染，`[[标题]]` 可直接打开对应笔记。自由提问**只读**：不跑
  operations、不写盘、不要求同步快照；要改笔记仍走任务模板或编辑器。
- 每次运行任务记录日志（任务、模型、耗时、改动统计），存 `vault/sync/ai-log.json`。

### 模型提供方（2026-10-19）

网关在 `electron/aiGateway.cjs`，同时支持：

- `kimi`：Kimi Code 的 anthropic-messages 网关，key 从 `~/.kimi/kimi-claw/openclaw.json`
  的 `models.providers.kimi-coding` 只读提取。
- `deepseek`：DeepSeek 官方 OpenAI 兼容接口（`https://api.deepseek.com/chat/completions`）。
  key 优先级：环境变量 `DEEPSEEK_API_KEY` → `~/.zcode/v2/provider_config.json` 的
  `deepseek` provider → `~/.dsh/.credentials.yaml`。模型默认取该 provider 的
  `modelOrder[0]`（本机为 `deepseek-flash`），面板可切 `deepseek-flash` / `deepseek-v4-pro`。
  可用 `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL` / `DEEPSEEK_CONFIG` 覆盖。

桌面端走 `ai:status` / `ai:complete` IPC，网页端走 `scripts/local-web.mjs` 的同一套
`ai:*` 方法；两边都不接受调用方传任意 URL。网页服务重启后才会重新加载网关模块
（Node require 缓存）。

### 安全边界（写死）

- API key 只存在于本机进程内：从 Kimi Code / ZCode / DSH 配置只读提取，
  **绝不写入仓库、日志、报错信息**（UI 上脱敏显示）。
- AI 的产出只能走 operations JSON → 校验 → 确认 → `planVaultWrite`，
  模型**永远没有直接文件写权限**。自由提问不产生 operations，也不写盘。
- 禁止 AI 触碰：`meta.json`、`attachments/` 二进制、未纳管 md、同步 JSON。
- 每次 AI **任务**运行前自动「保存到同步文件」做一次快照，失败则拒绝运行（可回滚）；
  自由提问不写盘，因此不做快照。

### 验收

- 模式 1 批量整理 100 篇标签 ≤ 3 分钟且正确落盘回读；
- 模式 2 提交非法 JSON/非法字段时被拒且 UI 展示原因；
- 除模型网关域名外无外发请求（抓包验证）；断网时 AI 面板优雅降级提示。

---

## 实施顺序与版本

1. **C**（汇总类型，半天）→ **B**（图谱档位，2~3 天）→ **A**（Zotero 同步，2~3 天）
   → **D**（AI 接口，3~5 天，先模式 2 后模式 1）。
   C/B/A 互相独立可并行；D 依赖 A 的分类字段。
2. 全程 0.3.0~0.3.x；用户验收后升 1.0.0。
3. 每个阶段结束：全套自测 + 构建 + 确认无笔记数据混入后推送
   `github.com/Zengyi-Xu/knowledge_graph`。

## 模型选型结论（详见对话回复）

- A/B/C 与 D 的管线代码：**Kimi K2.8 可胜任**（有今天 Phase 0~3 的成功先例）。
- D 的「统筹整理 2267 篇文献」开放任务：**建议 K3**——长上下文 + 约束遵循 +
  结构化输出稳定性是瓶颈；K2.8 能跑但返工率高。
- 无论用哪个模型，应用侧校验层不变：模型只是操作计划的**提案者**，
  应用是**裁决者**。
