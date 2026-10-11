/**
 * Zotero → 笔记库的分类/标签同步（纯函数，可单测）。
 * 只做「计划」：比对 Zotero 读出的条目与本地文献笔记，产出待应用的更新，
 * 由调用方（UI）确认后逐个 updateNote 应用。绝不直接改笔记。
 *
 * 匹配优先级：DOI（小写一致）> 标题归一化一致。
 * 标签规则：`方向:<分类首段>`、`期刊:<venue>`、`年份:<year>`，已存在的标签不重复加。
 * collections 与已有值取并集，不覆盖。
 */
import type { Note } from '@/types/note'

export interface ZoteroItem {
  zoteroKey: number
  itemType: string
  title: string
  doi: string
  year: number | null
  venue: string
  authors: string[]
  collectionPaths: string[]
}

export interface ZoteroSyncUpdate {
  noteId: string
  /** 合并后的完整 collections（并集，已排序去重） */
  collections: string[]
  /** 需要新增的标签（已排除笔记现有标签） */
  tagsToAdd: string[]
}

export interface ZoteroSyncPlan {
  updates: ZoteroSyncUpdate[]
  /** 在笔记库里找不到对应文献的 Zotero 条目 */
  unmatchedZotero: ZoteroItem[]
  matchedCount: number
}

/** 标题归一化：小写 + 去掉所有非字母数字字符（容忍大小写/标点/空格差异） */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]/g, '')
}

/** 为一条 Zotero 条目生成应补的标签（不含笔记已有标签的过滤） */
export function tagsForZoteroItem(item: ZoteroItem): string[] {
  const tags = new Set<string>()
  for (const path of item.collectionPaths) {
    const first = path.split('/')[0].trim()
    if (first) tags.add(`方向:${first}`)
  }
  if (item.venue.trim()) tags.add(`期刊:${item.venue.trim()}`)
  if (item.year != null) tags.add(`年份:${item.year}`)
  return [...tags]
}

export function planZoteroSync(zoteroItems: ZoteroItem[], notes: Note[]): ZoteroSyncPlan {
  const doiMap = new Map<string, ZoteroItem>()
  const titleMap = new Map<string, ZoteroItem>()
  for (const item of zoteroItems) {
    if (item.doi && !doiMap.has(item.doi)) doiMap.set(item.doi, item)
    const key = normalizeTitle(item.title)
    if (key && !titleMap.has(key)) titleMap.set(key, item)
  }

  const updates: ZoteroSyncUpdate[] = []
  const matchedKeys = new Set<number>()
  let matchedCount = 0

  for (const note of notes) {
    if (note.type !== 'literature' || !note.literature) continue
    const lit = note.literature
    const item =
      (lit.doi && doiMap.get(lit.doi.trim().toLowerCase())) ||
      titleMap.get(normalizeTitle(note.title))
    if (!item) continue

    matchedCount++
    matchedKeys.add(item.zoteroKey)

    const collections = [...new Set([...(lit.collections ?? []), ...item.collectionPaths])].sort()
    const existingTags = new Set(note.tags)
    const tagsToAdd = tagsForZoteroItem(item).filter((t) => !existingTags.has(t))

    if (
      collections.length !== (lit.collections?.length ?? 0) ||
      tagsToAdd.length > 0
    ) {
      updates.push({ noteId: note.id, collections, tagsToAdd })
    }
  }

  const unmatchedZotero = zoteroItems.filter((i) => !matchedKeys.has(i.zoteroKey))
  return { updates, unmatchedZotero, matchedCount }
}
