/**
 * Zotero 条目 → 笔记字段的公共规则（纯函数，批量导入脚本与 UI 增量同步共用）。
 * 分类缺失时统一记成「未分类」，让界面能看出「已同步但没有分类」和「没同步过」的区别。
 */
import type { ZoteroItem } from './zoteroSync'

/** 没有 Zotero 分类时写入的占位分类 */
export const UNCLASSIFIED = '未分类'

/**
 * 合并分类：已有分类 ∪ Zotero 分类，排序去重。
 * 「未分类」是占位值——一旦有真实分类就不再保留；两边都为空时才记「未分类」。
 */
export function mergeCollections(existing: string[] | undefined, incoming: string[]): string[] {
  const merged = new Set<string>()
  for (const path of [...(existing ?? []), ...incoming]) {
    const value = path.trim()
    if (value && value !== UNCLASSIFIED) merged.add(value)
  }
  const out = [...merged].sort()
  return out.length ? out : [UNCLASSIFIED]
}

/**
 * 为一条 Zotero 条目生成应补的标签（不含「笔记已有标签」的过滤）：
 * `方向:<一级分类>`（无分类时 `方向:未分类`）、`期刊:<venue>`、`年份:<year>`。
 */
export function tagsForZoteroItem(item: Pick<ZoteroItem, 'collectionPaths' | 'venue' | 'year'>): string[] {
  const tags = new Set<string>()
  for (const path of item.collectionPaths) {
    const first = path.split('/')[0].trim()
    if (first) tags.add(`方向:${first}`)
  }
  if (!item.collectionPaths.length) tags.add(`方向:${UNCLASSIFIED}`)
  if (item.venue.trim()) tags.add(`期刊:${item.venue.trim()}`)
  if (item.year != null) tags.add(`年份:${item.year}`)
  return [...tags]
}

/** 标题归一化：小写 + 去掉所有非字母数字字符（容忍大小写/标点/空格差异） */
export function normalizeTitle(title: string): string {
  return (title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]/g, '')
}
