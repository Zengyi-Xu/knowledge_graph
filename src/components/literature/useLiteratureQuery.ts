/**
 * 文献表的查询 hook：把纯查询模型（collectionTree + literatureQuery）接到 React 状态上。
 *
 * 「筛选/排序任何一项变化 → 回到 150 行首页」在渲染期同步调整（不用 effect），
 * 所以首屏和筛选后都不会多渲染一帧。
 */
import { useMemo, useState } from 'react'
import type { Note } from '@/types/note'
import { ALL_COLLECTIONS, collectionTreeOf, findCollection, type CollectionNode } from './collectionTree'
import {
  ALL_VENUES,
  PAGE_SIZE,
  type LiteratureQueryState,
  type PageSlice,
  type SortKey,
  hasActiveFilters,
  initialQueryState,
  nextVisibleCount,
  paginate,
  queryFingerprint,
  resetPageOnFilterChange,
  sanitizeYearInput,
  selectLiterature,
  sortMark as sortMarkOf,
  toggleSort as toggleSortOf,
  venueOptionsOf,
} from './literatureQuery'

export interface LiteratureQueryController {
  /** 全部文献笔记（type === 'literature'） */
  literature: Note[]
  state: LiteratureQueryState
  setSearch: (value: string) => void
  setCollection: (value: string) => void
  setVenue: (value: string) => void
  /** 只留数字、最多 4 位 */
  setYearFrom: (value: string) => void
  setYearTo: (value: string) => void
  toggleOnlyWithPdf: () => void
  toggleSort: (key: SortKey) => void
  sortMark: (key: SortKey) => string
  /** 只清分类/期刊/年份/PDF 四项，保留搜索词与排序 */
  clearFilters: () => void
  filtersActive: boolean
  /** 筛选 + 排序后的全部行 */
  rows: Note[]
  /** 当前该渲染的那一页（150 行 + 剩余数） */
  page: PageSlice
  showMore: () => void
  /** 分类折叠树（默认只画一级，展开由组件负责）+「未分类」篇数 */
  collectionTree: { tree: CollectionNode[]; none: number }
  /** 当前选中分类的子树篇数（触发按钮上跟着显示） */
  selectedCollectionCount: number | undefined
  venueOptions: [string, number][]
}

export function useLiteratureQuery(notes: Note[]): LiteratureQueryController {
  const [state, setState] = useState<LiteratureQueryState>(initialQueryState)

  const literature = useMemo(() => notes.filter((n) => n.type === 'literature'), [notes])

  // 筛选/排序变化时把「显示更多」计数重置回首页（render 期调整，避免 effect 里的同步 setState）
  const fingerprint = queryFingerprint(state)
  const [page, setPage] = useState(() => ({ key: fingerprint, count: PAGE_SIZE }))
  const synced = resetPageOnFilterChange(page, fingerprint)
  if (synced !== page) setPage(synced)

  const rows = useMemo(() => selectLiterature(literature, state), [literature, state])
  const collectionTree = useMemo(() => collectionTreeOf(literature), [literature])
  const venueOptions = useMemo(() => venueOptionsOf(literature), [literature])

  const patch = (next: Partial<LiteratureQueryState>) => setState((s) => ({ ...s, ...next }))

  return {
    literature,
    state,
    setSearch: (value) => patch({ search: value }),
    setCollection: (value) => patch({ collection: value }),
    setVenue: (value) => patch({ venue: value }),
    setYearFrom: (value) => patch({ yearFrom: sanitizeYearInput(value) }),
    setYearTo: (value) => patch({ yearTo: sanitizeYearInput(value) }),
    toggleOnlyWithPdf: () => setState((s) => ({ ...s, onlyWithPdf: !s.onlyWithPdf })),
    toggleSort: (key) => setState((s) => toggleSortOf(s, key)),
    sortMark: (key) => sortMarkOf(state, key),
    clearFilters: () => patch({ collection: ALL_COLLECTIONS, venue: ALL_VENUES, yearFrom: '', yearTo: '', onlyWithPdf: false }),
    filtersActive: hasActiveFilters(state),
    rows,
    page: paginate(rows, page.count),
    showMore: () => setPage((p) => ({ ...p, count: nextVisibleCount(p.count) })),
    collectionTree,
    selectedCollectionCount: findCollection(collectionTree.tree, state.collection)?.count,
    venueOptions,
  }
}
