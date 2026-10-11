import type { Note } from '@/types/note'
import { uid } from '@/types/note'

/** 设置键基名；实际键由 src/lib/env.ts 加 `kg-` / `kg-dev-` 前缀 */
export const SYNC_PATH_KEY = 'sync-path-v1'
export const AUTO_SYNC_KEY = 'auto-sync-v1'
/** 上次「两边一致」时的快照（稳定序列化后的字符串），用于判断谁改了 */
export const SYNC_BASELINE_KEY = 'sync-baseline-v1'

export function isDesktop(): boolean {
  return Boolean(window.knowledgeGraphDesktop?.isElectron)
}

/** 固定字段顺序，保证同一份笔记每次序列化结果一致，才能可靠比对 */
function canonNote(n: Note) {
  return {
    id: n.id,
    title: n.title,
    type: n.type ?? 'other',
    grade: n.grade ?? '',
    tags: Array.isArray(n.tags) ? [...n.tags] : [],
    content: n.content ?? '',
    createdAt: n.createdAt ?? 0,
    updatedAt: n.updatedAt ?? 0,
  }
}

/** 稳定序列化：既用于写入同步文件，也用于比对两边是否一致 */
export function serializeNotes(notes: Note[]): string {
  return JSON.stringify(notes.map(canonNote), null, 2)
}

/** 解析同步文件内容，返回笔记数组；格式不对返回 null */
export function parseNotes(text: string): Note[] | null {
  try {
    const arr = JSON.parse(text)
    if (!Array.isArray(arr)) return null
    const now = Date.now()
    return arr
      .filter((n) => n && typeof n.title === 'string' && typeof n.content === 'string')
      .map((n) => ({
        id: typeof n.id === 'string' && n.id ? n.id : uid(),
        title: n.title as string,
        type: (n.type ?? 'other') as Note['type'],
        grade: (n.grade ?? '') as Note['grade'],
        tags: Array.isArray(n.tags) ? (n.tags as unknown[]).filter((t): t is string => typeof t === 'string') : [],
        content: n.content as string,
        createdAt: typeof n.createdAt === 'number' ? n.createdAt : now,
        updatedAt: typeof n.updatedAt === 'number' ? n.updatedAt : now,
      }))
  } catch {
    return null
  }
}

export function downloadNotes(notes: Note[], filename: string): void {
  const blob = new Blob([serializeNotes(notes)], { type: 'application/json' })
  const anchor = document.createElement('a')
  anchor.href = URL.createObjectURL(blob)
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(anchor.href)
}

export async function saveNotesToSyncFile(notes: Note[], filePath: string): Promise<string> {
  const api = window.knowledgeGraphDesktop
  if (!api) throw new Error('桌面文件同步 API 不可用')
  const result = await api.writeSyncFile(filePath, serializeNotes(notes))
  return result.filePath
}

/** 读取同步文件内容；文件不存在返回 null；非桌面版返回 null */
export async function readSyncFileText(filePath: string): Promise<string | null> {
  const api = window.knowledgeGraphDesktop
  if (!api?.readSyncFile) return null
  const result = await api.readSyncFile(filePath)
  return result?.content ?? null
}
