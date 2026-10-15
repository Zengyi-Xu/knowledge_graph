// FROZEN(zotero-rules) 契约冻结：导出名与 AGENTS.md「文献数据模型」不变量已锁定，内部可改 —— 改完跑 npm run test:frozen（docs/FROZEN.md）
/**
 * Zotero → 笔记库的批量导入计划（纯函数，可单测，也可被脚本/UI 复用）。
 *
 * 设计要点：
 * - 先把 Zotero 中 DOI/标题一致且 DOI 不冲突的重复条目归并，再匹配已有笔记；
 * - 匹配优先级：已有 literature.zoteroKeys/zoteroKey > DOI（小写）> 标题归一化；
 * - 匹配到的笔记：合并分类、补空缺的 venue/year/doi/authors、刷新 Zotero key 与 PDF 状态；
 *   正文、标签（只做并集）、附件、类型一律不动。
 * - 未匹配的 Zotero 书目：新建 `type: literature` 笔记，id 固定在 `zotero-<key>` 上，
 *   因此重复执行不会产生重复笔记（幂等）。
 * - 只读 Zotero；不改任何文件，写盘由调用方（scripts/zotero-vault-sync.ts）负责。
 */
import type { LiteratureMeta, Note } from '@/types/note'
import { emptyLiterature } from '@/types/note'
import { makeCitekey } from '@/lib/citekey'
import { coalesceZoteroItems, mergeCollections, mergeZoteroTags, normalizeTitle } from '@/lib/zoteroMeta'
import type { CoalescedZoteroItem } from '@/lib/zoteroMeta'
import type { ZoteroItem } from '@/lib/zoteroSync'
import { toMarkdown } from '@/lib/vaultFormat'

export interface ZoteroImportStats {
  /** Zotero 中排除附件/批注/笔记后的真正书目数 */
  zoteroItems: number
  /** 匹配到已有文献笔记的条目数 */
  matched: number
  matchedByKey: number
  matchedByDoi: number
  matchedByTitle: number
  /** 新建的文献笔记数 */
  created: number
  /** 匹配到但内容有变化的笔记数 */
  updated: number
  /** 匹配到且内容完全没变的笔记数 */
  unchanged: number
  /** 带有 Zotero 分类的书目数 */
  withCollections: number
  /** 落到「未分类」的书目数 */
  unclassified: number
  /** 本机存在可访问 PDF 的书目数 */
  withAvailablePdf: number
  /** 可访问 PDF 总数 */
  availablePdfTotal: number
  /** 有 PDF 记录（不论文件是否在本机）的书目数 */
  withPdfRecords: number
}

export interface ZoteroImportPlan {
  /** 合并后的全量笔记：原有笔记保持原顺序，新建的追加在末尾 */
  notes: Note[]
  stats: ZoteroImportStats
  createdIds: string[]
  updatedIds: string[]
  /** 同一批里标题重复（文件名会加 -2/-3 后缀）的条目数 */
  duplicateTitles: number
}

/** 分类 / 标签 / key / PDF 状态一次写好；不改动传入对象 */
export function mergeLiterature(lit: LiteratureMeta, item: ZoteroItem | CoalescedZoteroItem, citekey: string): LiteratureMeta {
  const incomingKeys = 'zoteroKeys' in item ? item.zoteroKeys : [item.zoteroKey]
  // 主 key 优先选本机有 PDF 的那个（打开 PDF 走它），并固定排在 zoteroKeys 首位，保证多次合并顺序稳定
  const preferIncoming = (item.availablePdfCount ?? 0) > 0 || !lit.zoteroKey
  const zoteroKey = preferIncoming ? item.zoteroKey : lit.zoteroKey
  const zoteroKeys = [...new Set([zoteroKey, ...(lit.zoteroKeys ?? []), ...(lit.zoteroKey ? [lit.zoteroKey] : []), ...incomingKeys])]
    .filter((key): key is string => Boolean(key))
  return {
    ...lit,
    authors: lit.authors.length ? lit.authors : item.authors,
    venue: lit.venue || item.venue,
    year: typeof lit.year === 'number' ? lit.year : item.year ?? '',
    doi: lit.doi || item.doi,
    citekey: lit.citekey || citekey,
    collections: mergeCollections(lit.collections, item.collectionPaths),
    zoteroKey,
    zoteroKeys,
    zoteroPdfCount: item.pdfCount ?? 0,
    zoteroAvailablePdfCount: item.availablePdfCount ?? 0,
  }
}

/** 新建文献笔记：id 由 Zotero key 派生，保证重复执行时稳定可识别 */
export function literatureNoteFor(item: ZoteroItem, citekey: string, now: number): Note {
  return {
    id: `zotero-${item.zoteroKey.toLowerCase()}`,
    title: item.title || '未命名文献',
    type: 'literature',
    grade: '',
    tags: mergeZoteroTags([], item),
    content: '',
    createdAt: now,
    updatedAt: now,
    literature: mergeLiterature(emptyLiterature(), item, citekey),
  }
}

export function planZoteroImport(
  items: ZoteroItem[],
  notes: Note[],
  now = Date.now(),
): ZoteroImportPlan {
  const literatures = notes.filter((n) => n.type === 'literature' && n.literature)
  const byKey = new Map<string, Note>()
  const byDoi = new Map<string, Note>()
  const byTitle = new Map<string, Note | null>()
  const indexNote = (note: Note) => {
    const lit = note.literature!
    for (const key of [...(lit.zoteroKeys ?? []), ...(lit.zoteroKey ? [lit.zoteroKey] : [])]) byKey.set(key, note)
    const doi = lit.doi.trim().toLowerCase()
    if (doi) byDoi.set(doi, note)
    const title = normalizeTitle(note.title)
    if (title) {
      const current = byTitle.get(title)
      if (current === undefined || current?.id === note.id) byTitle.set(title, note)
      else byTitle.set(title, null)
    }
  }
  for (const note of literatures) indexNote(note)

  const stats: ZoteroImportStats = {
    zoteroItems: items.length,
    matched: 0,
    matchedByKey: 0,
    matchedByDoi: 0,
    matchedByTitle: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    withCollections: 0,
    unclassified: 0,
    withAvailablePdf: 0,
    availablePdfTotal: 0,
    withPdfRecords: 0,
  }

  const existingCitekeys = new Set(
    notes.map((n) => n.literature?.citekey).filter((k): k is string => Boolean(k)),
  )
  const takenIds = new Set(notes.map((n) => n.id))
  const titles = new Map<string, number>()
  const working = new Map(notes.map((note) => [note.id, note]))
  const created: Note[] = []
  const createdIds: string[] = []
  const matchedExistingIds = new Set<string>()
  const originalIds = new Set(notes.map((note) => note.id))

  for (const item of items) {
    const titleKey = normalizeTitle(item.title)
    titles.set(titleKey, (titles.get(titleKey) ?? 0) + 1)
    if (item.collectionPaths.length) stats.withCollections++
    else stats.unclassified++
    stats.availablePdfTotal += item.availablePdfCount ?? 0
    if ((item.availablePdfCount ?? 0) > 0) stats.withAvailablePdf++
    if ((item.pdfCount ?? 0) > 0) stats.withPdfRecords++
  }

  for (const item of coalesceZoteroItems(items)) {
    let note = item.zoteroKeys.map((key) => byKey.get(key)).find(Boolean)
    let via: 'key' | 'doi' | 'title' | '' = note ? 'key' : ''
    if (!note) {
      note = item.doi ? byDoi.get(item.doi.trim().toLowerCase()) : undefined
      if (note) via = 'doi'
    }
    if (!note) {
      const titleMatch = byTitle.get(normalizeTitle(item.title))
      if (titleMatch && (!item.doi || !titleMatch.literature?.doi || titleMatch.literature.doi.toLowerCase() === item.doi.toLowerCase())) note = titleMatch
      if (note) via = 'title'
    }

    if (!note) {
      const citekey = makeCitekey(
        { authors: item.authors, year: item.year ?? '' },
        item.title,
        existingCitekeys,
      )
      existingCitekeys.add(citekey)
      const fresh = literatureNoteFor(item, citekey, now)
      let id = fresh.id
      for (let i = 2; takenIds.has(id); i++) id = `${fresh.id}-${i}`
      fresh.id = id
      takenIds.add(id)
      created.push(fresh)
      createdIds.push(id)
      working.set(id, fresh)
      indexNote(fresh)
      continue
    }

    const represented = item.zoteroKeys.length
    stats.matched += represented
    if (via === 'key') stats.matchedByKey += represented
    else if (via === 'doi') stats.matchedByDoi += represented
    else stats.matchedByTitle += represented
    if (originalIds.has(note.id)) matchedExistingIds.add(note.id)

    const current = working.get(note.id) ?? note
    const lit = current.literature!
    const citekey = lit.citekey || makeCitekey({ authors: item.authors, year: item.year ?? '' }, item.title, existingCitekeys)
    existingCitekeys.add(citekey)
    const next: Note = {
      ...current,
      tags: mergeZoteroTags(current.tags, item),
      literature: mergeLiterature(lit, item, citekey),
    }
    working.set(note.id, next)
    indexNote(next)
  }

  const merged = notes.map((n) => {
    const next = working.get(n.id) ?? n
    if (toMarkdown(next) === toMarkdown(n)) return n
    return { ...next, updatedAt: now }
  })
  const updatedIds = merged.filter((note, index) => toMarkdown(note) !== toMarkdown(notes[index])).map((note) => note.id)
  stats.created = createdIds.length
  stats.updated = updatedIds.length
  stats.unchanged = [...matchedExistingIds].filter((id) => !updatedIds.includes(id)).length
  let duplicateTitles = 0
  for (const count of titles.values()) if (count > 1) duplicateTitles += count - 1

  return {
    notes: [...merged, ...created.map((note) => working.get(note.id) ?? note)],
    stats,
    createdIds,
    updatedIds,
    duplicateTitles,
  }
}
