# 本地存储格式（vault）：类型分文件夹，每篇一个 md + 一个 meta.json

桌面版可以把笔记存在你指定的目录（下称 vault）里。**笔记按类型放进对应的子文件夹**，结构如下：

```
<vault>/
  人物/                              ← 人物
    张三.md                         ← 一篇笔记一个文件，自包含
    李四.md
  项目/                              ← 项目
    某器件项目.md
  技能/                              ← 技能
    某仿真软件.md
  学习/                              ← 学习
    （想学的东西、想问的问题）
  文献/                              ← 文献（literature）
    某篇论文.md
  Inbox/                             ← 其他（未分类默认落点）
  sync/
    notes.json                       ← 全量导出：只用于同步 / 备份
  meta.json                          ← 索引：id ↔ 相对路径（不是笔记内容）
```

要点：**md 是唯一事实来源**。meta.json 只是索引，删掉它也不会丢内容——应用会按每篇 md 里的
frontmatter 完整还原（重建索引后文件名可能按标题重新对齐）。

## 类型 → 文件夹

| 类型 | 文件夹 | 说明 |
| --- | --- | --- |
| `person` 人物 | `人物/` | 老师、同学、合作者 |
| `task` 项目 | `项目/` | 课题、论文、实验任务 |
| `skill` 技能 | `技能/` | 具体技术点、软件、方法 |
| `question` 学习 | `学习/` | 想学的东西、想问的问题 |
| `literature` 文献 | `文献/` | 论文、专利等文献（元数据见下） |
| `other` 其他 | `Inbox/` | 暂时不归类的内容 |

新建笔记按类型落进对应文件夹；**改类型时会弹窗确认，确认后文件连同内容一起迁移到新文件夹**。
已经在 vault 里的旧文件位置不会被擅自搬迁——只有类型发生变化时才迁移那一篇。

> 旧版本把人物笔记放在 `KAUST团队/`。这个目录**仍然被识别**：只要标题没变，那些文件会原地保留，
> 不会被批量搬到 `人物/`；只有新建的人物笔记、或你改了标题的那一篇，才会落到 `人物/`。

## 一篇 md 长什么样

```markdown
---
format: kaust-kg-note
id: "a5j48a0muwbz8dl"
title: "版图设计"
type: skill
grade: phd
tags: ["硅光", "功能:无源器件与波导", "器件:波导"]
created: 2026-10-06T07:01:57.417Z
updated: 2026-10-08T17:10:12.478Z
---

## 这项工作是什么

正文就是普通 Markdown，`[[双链]]` 与 `#标签` 的写法与界面上一致。
```

| 字段 | 说明 |
| --- | --- |
| `format` | 固定 `kaust-kg-note`，用来识别「这是本应用的笔记」（历史标识，保持不变以免旧 vault 被当成外来文件） |
| `id` | 稳定标识；改名、改内容都不变，图谱连线靠标题，同步合并靠它 |
| `title` | 笔记标题，也是文件名来源（两者可以不同，见下） |
| `type` | `person` / `task` / `skill` / `question` / `literature` / `other` |
| `grade` | 仅人物笔记用：`pi` / `postdoc` / `phd` / `master` / `undergrad` / `engineer` / `staff` |
| `tags` | 字符串数组；`功能:xxx` 这类带冒号的标签整套照原样保留 |
| `created` / `updated` | ISO 时间，精确到毫秒 |

正文取 frontmatter 之后的全部内容，原样保存（不做 trim、不动内部换行）。

## 文献类型（literature）的 frontmatter 字段

`type: literature` 的笔记在通用字段之外多六个字段，**空数组/空串也写出来**（字段稳定存在）：

```markdown
---
format: kaust-kg-note
id: "a5j48a0muwbz8dl"
title: "Silicon photonics for quantum computing"
type: literature
authors: ["Zhang, San", "Li, Si"]
venue: "Nature Photonics"
year: 2024
doi: "10.1038/s41566-024-xxxx"
citekey: "zhang2024silicon"
attachments: []
tags: ["方向:硅光"]
created: 2026-10-06T07:01:57.417Z
updated: 2026-10-08T17:10:12.478Z
---
```

| 字段 | 说明 |
| --- | --- |
| `authors` | 作者全名数组，一行一个的输入在文件里是 JSON 数组；`"Family, Given"` 或 `"Given Family"` 均可 |
| `venue` | 期刊/会议名，可为空串 |
| `year` | 发表年（数字）；未知时写 `year: ""` |
| `doi` | DOI 字符串，可为空 |
| `citekey` | 引用键（第一作者姓小写 + 年份 + 标题首词），库内唯一；由应用生成，也可手改 |
| `attachments` | 附件 id 数组（见下文 attachments/ 约定） |

非 literature 类型的 md 即使带这些字段也会被忽略（按 `type` 判断）；旧 vault 里没有这些字段的
literature 笔记照常可读（解析端用空值补齐）。同步 JSON 里 `literature` 固定在 `grade` 之后、
`tags` 之前输出；没有文献数据的旧笔记序列化结果逐字节不变。

## attachments/：PDF 附件与划词标注

文献笔记可挂 PDF 附件。二进制与标注都存在 vault 根目录的 `attachments/` 下，
**文件名即附件 id**（原始文件名另存在标注 JSON 里）：

```
<vault>/
  attachments/
    <附件id>.pdf                 ← PDF 二进制（应用内用 PDF.js 渲染，不放宽 md sanitizer）
    <附件id>.annotations.json    ← 划词标注（JSON）
```

frontmatter 的 `attachments: ["<id>"]` 只记 id；删除附件会连同标注 JSON 一起删除。
附件读写只能落在 `attachments/` 内的一层文件名（`^attachments/[^/]+$`，主进程白名单 +
`normalizeRel`/`resolveInside` 双重校验），渲染进程不直接碰磁盘。

标注 JSON 结构（`format` 标记 + 版本号，便于将来迁移）：

```json
{
  "format": "kaust-kg-pdf-annotations",
  "version": 1,
  "fileName": "原始文件名.pdf",
  "items": [
    {
      "id": "…", "page": 3, "color": "#ffd54a",
      "anchor": { "exact": "选中的原文", "prefix": "前文≤40字", "suffix": "后文≤40字" },
      "comment": "", "createdAt": 1728600000000
    }
  ]
}
```

锚定策略：重新打开时先按 `exact` 匹配；匹配不到再用 `prefix`+`suffix` 模糊找回；
都找不到就标记为失效（UI 不渲染，但数据保留在 JSON 里不丢）。

## meta.json

```json
{
  "format": "kaust-kg-vault",
  "version": 1,
  "notes": [
    { "id": "a5j48a0muwbz8dl", "file": "技能/版图设计.md", "title": "版图设计" }
  ]
}
```

`file` 是**相对 vault 根目录的路径**（用 `/` 分隔），可以带子文件夹。

`notes` 的顺序就是笔记列表的显示顺序。记 `title` 是为了分辨两种情况：

- 标题没变、文件名却和标题不一致 → 认定是你手动改了文件名，**保留你的名字**；
- 标题变了 → 把文件重命名为新标题对应的名字。

## 文件名规则

- 非法字符 `\ / : * ? " < > |` 与控制字符替换成 `_`；结尾的点和空格去掉；
  `CON` 之类的 Windows 保留名加 `_` 前缀；过长标题截断到 60 字。
- 标题为空（或全是点）→ `未命名笔记.md`。
- 重名冲突 → `标题-2.md`、`标题-3.md`（按创建时间先到先得，与列表顺序无关）。
- **目录里不属于本应用的 md 永远不会被读取、修改或删除**；只有在重名时会让位（加后缀），
  界面上会显示「目录中另有 N 个未纳管 md」。

## 写入行为

- 在界面里改动后约 0.5 秒防抖写盘，**只写变化的那一篇**（内容 + 文件名都没变就不碰文件）。
- 删除笔记只删 `meta.json` 里登记过的文件。
- 每篇 md 都是「先写临时文件再改名」，中途失败不会留下半截文件；写顺序为 md → 删旧文件 → meta.json。
- 开启「跟随目录改动」后每 3 秒检查一次目录：在 Obsidian / Typora / 任何编辑器里改 md、
  删 md，改动会自动进到应用（本地正在编辑且尚未落盘的那一篇会保留本地版本，并在状态栏提示）。

## 与「同步文件」的关系

单文件 JSON（`notes.json`）只承担**跨机器同步 / 备份**的角色；vault 模式下默认放在 `<vault>\sync\notes.json`：

- 「保存到同步文件」/「导出备份」→ 把当前全部笔记写成一个 JSON；
- 「导入备份」/「重新载入」→ 读入 JSON 后重建内存状态，随后自动按上面的规则落成若干 md + meta.json。

也就是说：**本地是 md + meta.json，同步时才用单一 JSON 文件。**

## 已知取舍

- 目录里已有的 md 不会被自动接管成笔记（避免改写别人笔记的 frontmatter）。
  要把外部 md 拿进来，用顶栏的「导入 .md」。
- meta.json 里的 id 是权威的：若在应用外把一篇 md 的 `id` 改掉，等价于「删掉旧笔记 + 新建一篇」。
- 浏览器版没有目录写入权限，仍然使用浏览器 localStorage（`kg-notes-v1`；开发版为
  `kg-dev-notes-v1`，两者互不影响）。
  首次在桌面版选择目录时，会把当时的笔记整体写成 md。
- 旧键名（`kaust-knowledge-graph-notes-v1`）会在正式版里自动前向迁移到 `kg-notes-v1`。

## 自测

```bash
npm run test:vault        # 格式往返 / 文件名冲突 / 增量写盘 / 真实磁盘读写（31 项）
npm run test:vault-e2e    # 启动真实桌面版，验证「界面编辑→md 落盘」「外部改动→应用跟随」（16 项）
```
