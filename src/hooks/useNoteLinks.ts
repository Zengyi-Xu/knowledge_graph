/**
 * 笔记之间的连接：标题索引（解析 [[wikilink]]）与图谱边。
 * 纯派生状态，不碰磁盘；由笔记数组推出来。
 */
import { useCallback, useMemo } from 'react'
import type { Note } from '@/types/note'
import { indexByTitle, noteEdges } from '@/lib/noteStore'

export interface NoteLinksApi {
  /** 标题（小写）→ 笔记 */
  byTitle: Map<string, Note>
  resolveLink: (title: string) => Note | undefined
  /** 图谱边：sourceId → targetId（无向、去重） */
  edges: { source: string; target: string }[]
}

export function useNoteLinks(notes: Note[]): NoteLinksApi {
  const byTitle = useMemo(() => indexByTitle(notes), [notes])
  const edges = useMemo(() => noteEdges(notes, byTitle), [notes, byTitle])
  const resolveLink = useCallback((title: string): Note | undefined => byTitle.get(title.toLowerCase()), [byTitle])
  return { byTitle, resolveLink, edges }
}
