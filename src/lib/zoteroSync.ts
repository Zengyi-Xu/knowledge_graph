/**
 * Zotero → 笔记库的分类/标签同步（纯函数，可单测）。
 * 只做「计划」：比对 Zotero 读出的条目与本地文献笔记，产出待应用的更新，
 * 由调用方（UI）确认后逐个 updateNote 应用。绝不直接改笔记。
 *
 * 匹配优先级：Zotero key（最稳）> DOI（小写一致）> 标题归一化一致。
 * 标签规则：`方向:<分类首段>`、`期刊:<venue>`、`年份:<year>`，已存在的标签不重复加。
 * collections 与已有值取并集；Zotero 里没有分类的条目落到「未分类」（有真实分类时不再保留）。
 */
import type { Note } from '@/types/note'
import { mergeCollections, normalizeTitle, tagsForZoteroItem } from '@/lib/zoteroMeta'

/** 标题归一化 / 标签规则 / 分类合并都在 zoteroMeta，这里转出以保持既有引用可用 */
export { normalizeTitle, tagsForZoteroItem, mergeCollections, UNCLASSIFIED } from '@/lib/zoteroMeta'

export interface ZoteroItem {
  zoteroKey: string
  itemType: string
  title: string
  doi: string
  year: number | null
  venue: string
  authors: string[]
  collectionPaths: string[]
  pdfCount: number
  availablePdfCount: number
}

export interface ZoteroSyncUpdate {
  noteId: string
  /** 合并后的完整 collections（并集，已排序去重；空则记「未分类」） */
  collections: string[]
  /** 需要新增的标签（已排除笔记现有标签） */
  tagsToAdd: string[]
  /** Zotero 条目的稳定 key，写回 literature.zoteroKey */
  zoteroKey: string
  /** Zotero 中登记的 PDF 数量 */
  zoteroPdfCount: number
  /** 当前实际存在于本机的 PDF 数量 */
  zoteroAvailablePdfCount: number
}

export interface ZoteroSyncPlan {
  updates: ZoteroSyncUpdate[]
  /** 在笔记库里找不到对应文献的 Zotero 条目 */
  unmatchedZotero: ZoteroItem[]
  matchedCount: number
}

export function planZoteroSync(zoteroItems: ZoteroItem[], notes: Note[]): ZoteroSyncPlan {
  const keyMap = new Map<string, ZoteroItem>()
  const doiMap = new Map<string, ZoteroItem>()
  const titleMap = new Map<string, ZoteroItem>()
  for (const item of zoteroItems) {
    if (item.zoteroKey && !keyMap.has(item.zoteroKey)) keyMap.set(item.zoteroKey, item)
    if (item.doi && !doiMap.has(item.doi)) doiMap.set(item.doi, item)
    const key = normalizeTitle(item.title)
    if (key && !titleMap.has(key)) titleMap.set(key, item)
  }

  const updates: ZoteroSyncUpdate[] = []
  const matchedKeys = new Set<string>()
  let matchedCount = 0

  for (const note of notes) {
    if (note.type !== 'literature' || !note.literature) continue
    const lit = note.literature
    const item =
      (lit.zoteroKey && keyMap.get(lit.zoteroKey)) ||
      (lit.doi && doiMap.get(lit.doi.trim().toLowerCase())) ||
      titleMap.get(normalizeTitle(note.title))
    if (!item) continue

    matchedCount++
    matchedKeys.add(item.zoteroKey)

    const before = lit.collections ?? []
    const collections = mergeCollections(before, item.collectionPaths)
    const existingTags = new Set(note.tags)
    const tagsToAdd = tagsForZoteroItem(item).filter((t) => !existingTags.has(t))
    const pdfCount = item.pdfCount ?? 0
    const availablePdfCount = item.availablePdfCount ?? 0
    const changed =
      collections.length !== before.length ||
      collections.some((c, i) => c !== before[i]) ||
      tagsToAdd.length > 0 ||
      lit.zoteroKey !== item.zoteroKey ||
      lit.zoteroPdfCount !== pdfCount ||
      lit.zoteroAvailablePdfCount !== availablePdfCount

    if (changed) {
      updates.push({
        noteId: note.id,
        collections,
        tagsToAdd,
        zoteroKey: item.zoteroKey,
        zoteroPdfCount: pdfCount,
        zoteroAvailablePdfCount: availablePdfCount,
      })
    }
  }

  const unmatchedZotero = zoteroItems.filter((i) => !matchedKeys.has(i.zoteroKey))
  return { updates, unmatchedZotero, matchedCount }
}
