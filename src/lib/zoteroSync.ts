// FROZEN(zotero-rules) 契约冻结：导出名与 AGENTS.md「文献数据模型」不变量已锁定，内部可改 —— 改完跑 npm run test:frozen（docs/FROZEN.md）
/**
 * Zotero → 笔记库的分类/标签同步（纯函数，可单测）。
 * 只做「计划」：比对 Zotero 读出的条目与本地文献笔记，产出待应用的更新，
 * 由调用方（UI）确认后逐个 updateNote 应用。绝不直接改笔记。
 *
 * 匹配优先级：Zotero key（最稳）> DOI（小写一致）> 标题归一化一致。
 * 标签规则：只补 `期刊:<venue>`、`年份:<year>`，已存在的标签不重复加；
 * 旧版「方向:」标签会被清掉（分类只由 collections 这棵树承担，不再压平成标签）。
 * collections 与已有值取并集；无真实分类保持空数组，由界面动态显示“未分类”。
 */
import type { Note } from '@/types/note'
import { coalesceZoteroItems, mergeCollections, mergeZoteroTags, normalizeTitle } from '@/lib/zoteroMeta'
import type { CoalescedZoteroItem } from '@/lib/zoteroMeta'

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
  /** 需要清理的历史占位标签 */
  tagsToRemove: string[]
  /** Zotero 条目的稳定 key，写回 literature.zoteroKey */
  zoteroKey: string
  /** 去重归并后保留的全部 Zotero key */
  zoteroKeys: string[]
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
  const coalesced = coalesceZoteroItems(zoteroItems)
  const keyMap = new Map<string, CoalescedZoteroItem>()
  const doiMap = new Map<string, CoalescedZoteroItem>()
  const titleMap = new Map<string, CoalescedZoteroItem>()
  for (const item of coalesced) {
    for (const key of item.zoteroKeys) if (key && !keyMap.has(key)) keyMap.set(key, item)
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
      [...(lit.zoteroKeys ?? []), ...(lit.zoteroKey ? [lit.zoteroKey] : [])].map((key) => keyMap.get(key)).find(Boolean) ||
      (lit.doi && doiMap.get(lit.doi.trim().toLowerCase())) ||
      titleMap.get(normalizeTitle(note.title))
    if (!item) continue

    matchedCount++
    const zoteroKeys = item.zoteroKeys
    for (const key of zoteroKeys) matchedKeys.add(key)

    const before = lit.collections ?? []
    const collections = mergeCollections(before, item.collectionPaths)
    const nextTags = mergeZoteroTags(note.tags, item)
    const existingTags = new Set(note.tags)
    const nextTagSet = new Set(nextTags)
    const tagsToAdd = nextTags.filter((tag) => !existingTags.has(tag))
    const tagsToRemove = note.tags.filter((tag) => !nextTagSet.has(tag))
    const pdfCount = item.pdfCount ?? 0
    const availablePdfCount = item.availablePdfCount ?? 0
    const changed =
      collections.length !== before.length ||
      collections.some((c, i) => c !== before[i]) ||
      tagsToAdd.length > 0 ||
      tagsToRemove.length > 0 ||
      lit.zoteroKey !== item.zoteroKey ||
      JSON.stringify(lit.zoteroKeys ?? []) !== JSON.stringify(zoteroKeys) ||
      lit.zoteroPdfCount !== pdfCount ||
      lit.zoteroAvailablePdfCount !== availablePdfCount

    if (changed) {
      updates.push({
        noteId: note.id,
        collections,
        tagsToAdd,
        tagsToRemove,
        zoteroKey: item.zoteroKey,
        zoteroKeys,
        zoteroPdfCount: pdfCount,
        zoteroAvailablePdfCount: availablePdfCount,
      })
    }
  }

  const unmatchedZotero = zoteroItems.filter((i) => !matchedKeys.has(i.zoteroKey))
  return { updates, unmatchedZotero, matchedCount }
}
