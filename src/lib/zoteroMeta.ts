// FROZEN(zotero-rules) 契约冻结：导出名与 AGENTS.md「文献数据模型」不变量已锁定，内部可改 —— 改完跑 npm run test:frozen（docs/FROZEN.md）
/**
 * Zotero 条目 → 笔记字段的公共规则（纯函数，批量导入脚本与 UI 增量同步共用）。
 * 「未分类」只在界面按“没有真实分类”动态显示，不写成永久分类或标签。
 * 分类只存在 `collections`（完整路径的树）里；旧版把树压平写进 `方向:` 标签，现已废弃、同步时清理。
 */
import type { ZoteroItem } from './zoteroSync'

/** 兼容旧数据时需要清理的历史占位分类 */
export const UNCLASSIFIED = '未分类'
/** 旧版「方向:<一级分类>」标签前缀：分类树的压平副本，已废弃（分类只由 `collections` 承担） */
export const DIRECTION_TAG_PREFIX = '方向:'
export const UNCLASSIFIED_TAG = `${DIRECTION_TAG_PREFIX}${UNCLASSIFIED}`

/** 是否为旧版「方向:」标签（压平副本，同步时一律清掉，避免与 `collections` 漂移） */
export function isDirectionTag(tag: string): boolean {
  return tag.startsWith(DIRECTION_TAG_PREFIX)
}

/** 合并分类：已有分类 ∪ Zotero 分类，排序去重。
 * 历史占位值「未分类」会被清理；没有真实分类时返回空数组，由界面动态显示。
 */
export function mergeCollections(existing: string[] | undefined, incoming: string[]): string[] {
  const merged = new Set<string>()
  for (const path of [...(existing ?? []), ...incoming]) {
    const value = path.trim()
    if (value && value !== UNCLASSIFIED) merged.add(value)
  }
  const out = [...merged].sort()
  return out
}

/** 真实分类（滤掉历史占位「未分类」）：界面判断“是否未分类”与分类树都用它 */
export function realCollectionsOf(collections: string[] | undefined): string[] {
  return (collections ?? []).filter((path) => {
    const value = path.trim()
    return Boolean(value) && value !== UNCLASSIFIED
  })
}

/**
 * 为一条 Zotero 条目生成应补的标签（不含「笔记已有标签」的过滤）：`期刊:<venue>`、`年份:<year>`。
 *
 * 不再产出「方向:」标签：分类树由 `collections` 单独承担，标签里不留压平副本。
 */
export function tagsForZoteroItem(item: Pick<ZoteroItem, 'collectionPaths' | 'venue' | 'year'>): string[] {
  const tags = new Set<string>()
  if (item.venue.trim()) tags.add(`期刊:${item.venue.trim()}`)
  if (item.year != null) tags.add(`年份:${item.year}`)
  return [...tags]
}

/** 合并 Zotero 派生标签，同时清掉旧版写入的「方向:」标签（含「方向:未分类」占位）。 */
export function mergeZoteroTags(existing: string[], item: Pick<ZoteroItem, 'collectionPaths' | 'venue' | 'year'>): string[] {
  return [...new Set([...existing.filter((tag) => !isDirectionTag(tag)), ...tagsForZoteroItem(item)])]
}

export interface CoalescedZoteroItem extends ZoteroItem {
  /** 同一 DOI/标题归并出的全部 Zotero key */
  zoteroKeys: string[]
}

/**
 * 把 Zotero 中同一论文的重复条目归并为一个同步单元。
 * DOI 相同一定归并；标题相同仅在 DOI 不冲突时归并，避免同名不同论文被误合并。
 */
export function coalesceZoteroItems(items: ZoteroItem[]): CoalescedZoteroItem[] {
  interface Group { items: ZoteroItem[]; dois: Set<string> }
  const groups: Group[] = []
  const byDoi = new Map<string, Group>()
  const byTitle = new Map<string, Group | null>()

  for (const item of items) {
    const doi = item.doi.trim().toLowerCase()
    const title = normalizeTitle(item.title)
    let group = doi ? byDoi.get(doi) : undefined
    if (!group && title) {
      const candidate = byTitle.get(title)
      if (candidate && (!doi || candidate.dois.size === 0 || candidate.dois.has(doi))) group = candidate
    }
    if (!group) {
      group = { items: [], dois: new Set() }
      groups.push(group)
    }
    group.items.push(item)
    if (doi) {
      group.dois.add(doi)
      byDoi.set(doi, group)
    }
    if (title) {
      const current = byTitle.get(title)
      if (current === undefined || current === group) byTitle.set(title, group)
      else if (current && current !== group) byTitle.set(title, null)
    }
  }

  return groups.map((group) => {
    const unique = [...new Map(group.items.map((item) => [item.zoteroKey, item])).values()]
    const primary = unique.find((item) => (item.availablePdfCount ?? 0) > 0) ?? unique[0]
    const first = (pick: (item: ZoteroItem) => string) => unique.map(pick).find(Boolean) ?? ''
    const authors = unique.find((item) => item.authors.length)?.authors ?? []
    const year = unique.find((item) => item.year != null)?.year ?? null
    return {
      ...primary,
      title: first((item) => item.title),
      doi: first((item) => item.doi).toLowerCase(),
      venue: first((item) => item.venue),
      authors,
      year,
      collectionPaths: [...new Set(unique.flatMap((item) => item.collectionPaths))].sort(),
      pdfCount: unique.reduce((sum, item) => sum + (item.pdfCount ?? 0), 0),
      availablePdfCount: unique.reduce((sum, item) => sum + (item.availablePdfCount ?? 0), 0),
      zoteroKeys: unique.map((item) => item.zoteroKey),
    }
  })
}

/** 标题归一化：小写 + 去掉所有非字母数字字符（容忍大小写/标点/空格差异） */
export function normalizeTitle(title: string): string {
  return (title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]/g, '')
}
