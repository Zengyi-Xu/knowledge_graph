/**
 * 笔记数据存储的纯逻辑：新建 / 更新 / 合并 / 整体替换、标题索引与图谱边、
 * 本地缓存（localStorage）与「用户主动清空」标记。
 *
 * 这里不放 React、也不放 vault 文件 IO —— 目录读写与写盘编排在
 * `src/hooks/useVaultSession.ts` / `useVaultWriter.ts` 里。纯函数默认把「现在」
 * 作为参数传入，方便测试固定时间戳。
 */
import { APP_NAME, readSetting, removeSetting, writeSetting } from '@/lib/env'
import { extractLinks, uid } from '@/types/note'
import type { Note } from '@/types/note'

/** 浏览器版 / 离线回退用的笔记缓存键 */
export const NOTES_CACHE_KEY = 'notes-v1'
/** 用户主动清空所有笔记时置位，避免下次启动又被种子/同步数据「复活」 */
export const EMPTY_FLAG = 'empty-v1'

export function isExplicitlyEmpty(): boolean {
  try {
    return readSetting(EMPTY_FLAG) === '1'
  } catch {
    return false
  }
}

export function markExplicitlyEmpty(): void {
  try {
    writeSetting(EMPTY_FLAG, '1')
  } catch {
    /* localStorage 不可用时忽略 */
  }
}

export function clearExplicitlyEmpty(): void {
  try {
    removeSetting(EMPTY_FLAG)
  } catch {
    /* ignore */
  }
}

/** 读本地缓存的笔记；没有缓存 / 坏数据时返回空数组（初始内容交给同步或种子逻辑） */
export function readCachedNotes(): Note[] {
  try {
    const raw = readSetting(NOTES_CACHE_KEY)
    if (raw !== null) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed as Note[]
    }
  } catch {
    /* ignore */
  }
  return []
}

/** 写本地缓存；返回 false 表示写入失败（配额满等），调用方应提示用户尚未持久化 */
export function writeCachedNotes(notes: Note[]): boolean {
  try {
    return writeSetting(NOTES_CACHE_KEY, JSON.stringify(notes))
  } catch {
    return false
  }
}

/** 首次使用时的内置示例笔记 */
export function seedNotes(): Note[] {
  const now = Date.now()
  return [
    {
      id: uid(),
      title: '使用指南',
      type: 'other',
      grade: '',
      tags: ['指南'],
      content: `欢迎使用${APP_NAME}！

## 这个工具是做什么的

把一个团队/课题组里的信息整理成互相跳转的笔记：谁完成了什么工作、你可以向谁寻求哪方面的帮助。

## 七种笔记类型

- **人物** — 记录某位同事：研究方向、技能、性格、可以帮你什么（存到 人物 文件夹）
- **项目** — 课题组的项目、paper、实验任务（存到 项目 文件夹）
- **技能** — 具体技术点（如某个软件、实验方法）（存到 技能 文件夹）
- **学习** — 你想学的东西、想问的问题（存到 学习 文件夹）
- **文献** — 论文条目：作者、期刊、DOI、PDF 附件、引用复制（存到 文献 文件夹）
- **汇总** — 主题/周期性的综述，通常由 AI 统筹生成（存到 汇总 文件夹）
- **其他** — 任何不方便归类的内容（存到 Inbox 文件夹）

**类型决定文件夹**：勾选哪一类，这篇笔记就落到对应的子文件夹；改类型时会弹窗确认，然后连同文件一起迁移过去。

## 如何建立联系

在笔记正文中用双方括号引用其他笔记，例如：[[示例人物 张三]]。
被引用的笔记会在图谱视图中与当前笔记连线。

## 标签与年级

- 用 #标签 的形式给笔记打标签，如 #机器学习 #电镜
- 人物笔记可以设置「年级/身份」（教授/博后/博士/硕士…），图谱可按此筛选

## 图谱视图

切换到「图谱」页面后，可以：

1. 按**类型**筛选（只看人物、只看任务…）
2. 按**年级**筛选（只看博士生…）
3. 按**标签**筛选
4. 点击节点进入**焦点模式**，只显示与该节点直接相连的笔记，简化复杂图谱
5. 拖动节点调整布局

桌面版的笔记保存在你选择的 vault 目录里：每篇一个 .md 文件（带 frontmatter），按类型放进对应的子文件夹；
vault 根目录另有一个 meta.json 索引。可以用 Obsidian 直接打开这个目录；本应用不会改动目录里不属于它的 md 文件。`,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: uid(),
      title: '示例人物 张三',
      type: 'person',
      grade: 'phd',
      tags: ['示例', '机器学习'],
      content: `这是一篇**示例人物**笔记，了解用法后可以删除。

## 基本信息

- 年级：博士生（三年级）
- 方向：#机器学习 在材料筛选中的应用

## 他完成过的工作

- 参与了 [[示例项目 某材料数据库]] 的搭建
- 熟悉 Python 和 [[技能示例 PyTorch]]

## 可以寻求的帮助

- 问代码问题很耐心，可以约每周讨论
- 借得到某仪器的预约权限

关联：[[使用指南]]`,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: uid(),
      title: '示例项目 某材料数据库',
      type: 'task',
      grade: '',
      tags: ['示例', '数据库'],
      content: `示例项目笔记。

## 简介

课题组维护的某材料性质数据库。

## 相关成员

- [[示例人物 张三]] 负责数据清洗
- 需要 [[技能示例 PyTorch]] 做模型训练`,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: uid(),
      title: '技能示例 PyTorch',
      type: 'skill',
      grade: '',
      tags: ['示例', '编程'],
      content: `示例技能笔记。

深度学习框架。[[示例人物 张三]] 用它搭过 GNN 模型。

可以在 #学习 笔记里记录你想学的 PyTorch 知识点。`,
      createdAt: now,
      updatedAt: now,
    },
  ]
}

// ------------------------------------------------------------- 笔记集合操作

/** 由 Partial 造出新笔记（补齐 id/类型/时间戳）；返回顺序与入参一致 */
export function createNotesFrom(partials: Partial<Note>[], now = Date.now()): Note[] {
  return partials.map((partial) => ({
    id: uid(),
    title: partial.title ?? '未命名笔记',
    type: partial.type ?? 'other',
    grade: partial.grade ?? '',
    tags: partial.tags ?? [],
    content: partial.content ?? '',
    createdAt: now,
    updatedAt: now,
    ...(partial.literature ? { literature: partial.literature } : {}),
  }))
}

/** 按 id 批量打补丁（共用同一个 updatedAt） */
export function patchNotes(notes: Note[], patches: { id: string; patch: Partial<Note> }[], now = Date.now()): Note[] {
  const byId = new Map(patches.map(({ id, patch }) => [id, patch]))
  return notes.map((note) => {
    const patch = byId.get(note.id)
    return patch ? { ...note, ...patch, updatedAt: now } : note
  })
}

/** 按标题合并一批笔记（同标题更新、新标题新增），避免出现重复节点 */
export function mergeNotesByTitle(
  notes: Note[],
  incoming: Note[],
  now = Date.now(),
): { notes: Note[]; added: number; updated: number } {
  const pending = new Map<string, Note>()
  for (const raw of incoming) {
    if (raw && typeof raw.title === 'string' && typeof raw.content === 'string') {
      pending.set(raw.title.toLowerCase(), raw)
    }
  }
  let updated = 0
  const next: Note[] = notes.map((note) => {
    const key = note.title.toLowerCase()
    const raw = pending.get(key)
    if (!raw) return note
    pending.delete(key)
    updated++
    return {
      ...note,
      type: raw.type ?? note.type,
      grade: raw.grade ?? note.grade,
      tags: Array.isArray(raw.tags) ? raw.tags : note.tags,
      content: raw.content,
      updatedAt: now,
      ...(raw.literature ? { literature: raw.literature } : {}),
    }
  })
  let added = 0
  for (const raw of pending.values()) {
    next.unshift({
      id: raw.id || uid(),
      title: raw.title,
      type: raw.type ?? 'other',
      grade: raw.grade ?? '',
      tags: Array.isArray(raw.tags) ? raw.tags : [],
      content: raw.content,
      createdAt: raw.createdAt ?? now,
      updatedAt: raw.updatedAt ?? now,
      ...(raw.literature ? { literature: raw.literature } : {}),
    })
    added++
  }
  return { notes: next, added, updated }
}

/** 清洗外来数据（导入备份 / notes.json）：坏条目丢掉，缺字段补默认值 */
export function sanitizeIncomingNotes(incoming: Note[], now = Date.now()): Note[] {
  return incoming
    .filter((note) => note && typeof note.title === 'string' && typeof note.content === 'string')
    .map((note) => ({
      id: note.id || uid(),
      title: note.title,
      type: note.type ?? 'other',
      grade: note.grade ?? '',
      tags: Array.isArray(note.tags) ? note.tags : [],
      content: note.content,
      createdAt: note.createdAt ?? now,
      updatedAt: note.updatedAt ?? now,
      ...(note.literature ? { literature: note.literature } : {}),
    }))
}

// ------------------------------------------------------------- 派生视图

/** 标题（小写）→ 笔记，用于解析 [[wikilink]] */
export function indexByTitle(notes: Note[]): Map<string, Note> {
  const map = new Map<string, Note>()
  for (const note of notes) map.set(note.title.toLowerCase(), note)
  return map
}

/** 图谱边：[[wikilink]] 指向的笔记两两连一条无向边（去重） */
export function noteEdges(notes: Note[], byTitle: Map<string, Note>): { source: string; target: string }[] {
  const set = new Set<string>()
  for (const note of notes) {
    for (const title of extractLinks(note.content)) {
      const target = byTitle.get(title.toLowerCase())
      if (target && target.id !== note.id) {
        set.add(note.id < target.id ? `${note.id}|${target.id}` : `${target.id}|${note.id}`)
      }
    }
  }
  return [...set].map((key) => {
    const [source, target] = key.split('|')
    return { source, target }
  })
}
