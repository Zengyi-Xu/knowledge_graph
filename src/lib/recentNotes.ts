import { readSetting, writeSetting } from '@/lib/env'
import type { Note } from '@/types/note'

/**
 * 「最近笔记」记录：本地 localStorage 里的打开顺序表。
 * 纯逻辑（touch/resolve）不碰存储，便于自测；load/save 只是薄封装。
 */

export interface RecentNoteEntry {
  id: string
  /** 最近一次打开时间戳（ms） */
  at: number
}

/** 设置键（经 storageKey 加 dev/prod 前缀） */
export const RECENT_NOTES_KEY = 'recent-notes-v1'

/** 菜单默认显示条数；其余收进「显示更多」 */
export const RECENT_PREVIEW_COUNT = 7

/** 本地只保留最近 N 条（显示不受限，500 条已远超实用范围） */
export const RECENT_STORAGE_CAP = 500

/** 解析存储内容；损坏或旧格式一律视为空表，不抛错 */
export function parseRecent(raw: string | null): RecentNoteEntry[] {
  if (!raw) return []
  try {
    const value = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    return value
      .filter((e): e is RecentNoteEntry => !!e && typeof e.id === 'string' && typeof e.at === 'number')
      .slice(0, RECENT_STORAGE_CAP)
  } catch {
    return []
  }
}

/**
 * 记录一次打开：同 id 去重并提到最前，超出上限截断。
 * 未发生变化时返回原数组（供调用方跳过 setState/写盘）。
 */
export function touchRecent(list: RecentNoteEntry[], id: string, now = Date.now()): RecentNoteEntry[] {
  if (!id) return list
  const rest = list.filter((e) => e.id !== id)
  const next = [{ id, at: now }, ...rest]
  if (next.length > RECENT_STORAGE_CAP) next.length = RECENT_STORAGE_CAP
  if (next.length === list.length && next[0].at === list[0]?.at && next[0].id === list[0]?.id) return list
  return next
}

/** 按打开顺序解析出仍存在的笔记；被删的 id 静默跳过 */
export function resolveRecent(entries: RecentNoteEntry[], notes: Note[]): { note: Note; at: number }[] {
  const byId = new Map(notes.map((n) => [n.id, n]))
  const out: { note: Note; at: number }[] = []
  for (const e of entries) {
    const note = byId.get(e.id)
    if (note) out.push({ note, at: e.at })
  }
  return out
}

export function loadRecent(): RecentNoteEntry[] {
  return parseRecent(readSetting(RECENT_NOTES_KEY))
}

export function saveRecent(list: RecentNoteEntry[]): void {
  writeSetting(RECENT_NOTES_KEY, JSON.stringify(list.slice(0, RECENT_STORAGE_CAP)))
}
