/**
 * 文献分类（Zotero 的 "父/子/…" 全路径）。
 *
 * 分工：
 * - **筛选下拉**：折叠树 —— 默认只显示一级分类，需要时逐级展开下面的子目录（`collectionTreeOf`）；
 * - **表格「分类」列**：只显示一级分类（`collectionLabel`），1896 篇里三级路径全铺开反而看不出重点。
 *
 * 数据不动：笔记与 Zotero 里仍是完整路径，这里只负责建树、计数与显示。
 * 计数口径：节点的子树唯一篇数，同一篇挂在多条路径下只算一次。
 *
 * 纯函数，无 React 依赖，可在 node 里直接单测（`npm run test:lit-view`）。
 */
import type { Note } from '@/types/note'
import { realCollectionsOf } from '@/lib/zoteroMeta'

/** 分类筛选下拉里代表「全部分类」的哨兵值 */
export const ALL_COLLECTIONS = 'all'
/** 「未分类」的哨兵值：动态状态，不落盘（历史占位「未分类」不算分类） */
export const NO_COLLECTION = '__none__'

/** 真实分类：历史占位「未分类」不算分类（同步/去重会清理它） */
export function realCollections(note: Note): string[] {
  return realCollectionsOf(note.literature?.collections)
}

/** 路径的第一段 = 一级分类（表格里只显示到这一层） */
export function topCollection(path: string): string {
  return path.split('/')[0].trim()
}

/** 这篇文献的一级分类：去重、保持 `collections` 里的原顺序 */
export function topCollections(note: Note): string[] {
  const out: string[] = []
  for (const path of realCollections(note)) {
    const top = topCollection(path)
    if (top && !out.includes(top)) out.push(top)
  }
  return out
}

/** 分类单元格显示：一级分类用「；」连接；没有任何真实分类的文献动态标成「未分类」 */
export function collectionLabel(note: Note): string {
  const tops = topCollections(note)
  return tops.length ? tops.join('；') : '未分类'
}

export interface CollectionNode {
  name: string
  /** 完整路径，也是筛选值 */
  path: string
  /** 子树唯一篇数（含子分类） */
  count: number
  /** 子分类：默认折叠，展开时才渲染 */
  children: CollectionNode[]
}

interface MutableNode {
  name: string
  path: string
  ids: Set<string>
  children: Map<string, MutableNode>
}

/**
 * 按 "父/子/…" 路径建树（同级按 zh-CN 排序），并算出每个节点的子树唯一篇数。
 * 「未分类」是动态状态、不进树，篇数单独用 `none` 返回。
 */
export function collectionTreeOf(literature: Note[]): { tree: CollectionNode[]; none: number } {
  const root: MutableNode = { name: '', path: '', ids: new Set(), children: new Map() }
  let none = 0

  for (const note of literature) {
    const paths = realCollections(note)
    if (!paths.length) {
      none++
      continue
    }
    const seen = new Set<string>()
    for (const raw of paths) {
      const segs = raw.split('/').map((s) => s.trim()).filter(Boolean)
      const key = segs.join('/')
      if (!key || seen.has(key)) continue
      seen.add(key)
      let node = root
      for (const seg of segs) {
        let child = node.children.get(seg)
        if (!child) {
          child = { name: seg, path: node.path ? `${node.path}/${seg}` : seg, ids: new Set(), children: new Map() }
          node.children.set(seg, child)
        }
        node = child
      }
      node.ids.add(note.id)
    }
  }

  const finalize = (node: MutableNode): { node: CollectionNode; ids: Set<string> } => {
    const ids = new Set(node.ids)
    const children: CollectionNode[] = []
    for (const child of [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))) {
      const done = finalize(child)
      done.ids.forEach((id) => ids.add(id))
      children.push(done.node)
    }
    return { node: { name: node.name, path: node.path, count: ids.size, children }, ids }
  }

  return { tree: finalize(root).node.children, none }
}

/** 按完整路径在树里找节点（触发器上显示选中分类的子树篇数） */
export function findCollection(tree: CollectionNode[], path: string): CollectionNode | undefined {
  for (const node of tree) {
    if (node.path === path) return node
    const hit = findCollection(node.children, path)
    if (hit) return hit
  }
  return undefined
}

/** 分类筛选：选中某个分类会连带它的整棵子树 */
export function matchesCollectionFilter(note: Note, filter: string): boolean {
  if (filter === ALL_COLLECTIONS) return true
  const paths = realCollections(note)
  if (filter === NO_COLLECTION) return paths.length === 0
  const prefix = `${filter}/`
  return paths.some((c) => c === filter || c.startsWith(prefix))
}
