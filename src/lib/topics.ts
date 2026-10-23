/**
 * 主题层：用 `主题:<名称>` 标签给笔记分层（不新增 front matter 字段）。
 *
 * 为什么不是字段：加字段要动 vault-format / note-store / vault-gate 三个冻结单元，
 * 还要给旧客户端加能力位（见 docs/FROZEN.md）。标签是已有字段，旧客户端原样保留，
 * 所以主题先用标签表达；P4 如果确实要做磁盘目录，再从标签迁移。
 *
 * 约定（写进 AGENTS.md）：
 * - 前缀固定 `主题:`，单层，不嵌套；名称不含 `[` `]` `#`，最长 40 字；
 * - 一篇笔记最多一个主题标签，改主题 = 换掉这一条；
 * - 文献笔记不参与主题（1896 篇空壳，主题属于「笔记」这一层）。
 */
import type { Note } from '@/types/note'

export const TOPIC_PREFIX = '主题:'
/** 没有主题的笔记归到这一组（不落盘，只是个分组名） */
export const NO_TOPIC = '未归主题'

const TOPIC_PATTERN = /^主题[:：]/

/** 是否主题标签（同时认半角/全角冒号，避免手输全角后变成两个主题） */
export function isTopicTag(tag: string): boolean {
  return TOPIC_PATTERN.test(tag.trim())
}

/** 规范化主题名：去 #、去前缀、压空白、去方括号，截到 40 字 */
export function normalizeTopic(raw: string): string {
  return raw
    .trim()
    .replace(/^#/, '')
    .replace(TOPIC_PATTERN, '')
    .replace(/[[\]#]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 40)
    .trim()
}

/** 笔记的主题；没有返回空串（多个主题标签时取第一个） */
export function topicOf(note: Pick<Note, 'tags'>): string {
  for (const tag of note.tags) {
    if (!isTopicTag(tag)) continue
    const topic = normalizeTopic(tag)
    if (topic) return topic
  }
  return ''
}

/** 换上某个主题（空串 = 去掉主题），其余标签顺序不变 */
export function withTopic(tags: string[], topic: string): string[] {
  const rest = tags.filter((t) => !isTopicTag(t))
  const next = normalizeTopic(topic)
  return next ? [...rest, TOPIC_PREFIX + next] : rest
}

export interface TopicCount {
  topic: string
  count: number
}

/** 主题清单：按篇数降序，同篇数按名称；空主题不在这里出现 */
export function topicCounts(notes: Note[]): TopicCount[] {
  const counts = new Map<string, number>()
  for (const note of notes) {
    const topic = topicOf(note)
    if (!topic) continue
    counts.set(topic, (counts.get(topic) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([topic, count]) => ({ topic, count }))
    .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic, 'zh-CN'))
}

export interface TopicGroup {
  /** 分组键：主题名，或 NO_TOPIC */
  key: string
  label: string
  notes: Note[]
}

/** 按主题分组：有主题的在前（篇数降序），「未归主题」永远排最后 */
export function groupByTopic(notes: Note[]): TopicGroup[] {
  const groups = new Map<string, Note[]>()
  const loose: Note[] = []
  for (const note of notes) {
    const topic = topicOf(note)
    if (!topic) {
      loose.push(note)
      continue
    }
    const list = groups.get(topic) ?? []
    list.push(note)
    groups.set(topic, list)
  }
  const ordered = [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'zh-CN'))
    .map(([topic, list]) => ({ key: topic, label: topic, notes: sortByUpdated(list) }))
  if (loose.length) ordered.push({ key: NO_TOPIC, label: NO_TOPIC, notes: sortByUpdated(loose) })
  return ordered
}

function sortByUpdated(list: Note[]): Note[] {
  return [...list].sort((a, b) => b.updatedAt - a.updatedAt)
}
