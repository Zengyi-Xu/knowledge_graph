/**
 * 文献表的查询模型（纯函数）：筛选 → 排序 → 150 行分页。
 *
 * 「150 行增量渲染」「筛选变化回到首页」这两条不变量都写在这里，组件只消费结果：
 * `useLiteratureQuery` 是它的 React 外壳（`src/components/literature/useLiteratureQuery.ts`）。
 */
import type { Note } from '@/types/note'
import { cleanLiteratureTitle } from '@/lib/literature'
import { ALL_COLLECTIONS, matchesCollectionFilter } from './collectionTree'
import { hasReadablePdf } from './pdfCell'

/** 一个列表一次渲染的最大行数，避免上千行一次挂载 */
export const PAGE_SIZE = 150
/** 期刊/会议筛选项最多列出的条数（按篇数倒序） */
export const VENUE_OPTION_LIMIT = 80
/** 期刊筛选的「全部」哨兵值 */
export const ALL_VENUES = 'all'

export type SortKey = 'title' | 'author' | 'year' | 'venue' | 'citekey'

export interface LiteratureQueryState {
  search: string
  sortKey: SortKey
  sortAsc: boolean
  /** 分类路径 / `ALL_COLLECTIONS` / `NO_COLLECTION` */
  collection: string
  venue: string
  yearFrom: string
  yearTo: string
  onlyWithPdf: boolean
}

/** 表格打开的默认筛选：年份倒序（没有年份的排在最后）、不筛分类 */
export function initialQueryState(overrides: Partial<LiteratureQueryState> = {}): LiteratureQueryState {
  return {
    search: '',
    sortKey: 'year',
    sortAsc: false,
    collection: ALL_COLLECTIONS,
    venue: ALL_VENUES,
    yearFrom: '',
    yearTo: '',
    onlyWithPdf: false,
    ...overrides,
  }
}

/** 筛选指纹：任何一项变化都要把「显示更多」退回首页 */
export function queryFingerprint(q: LiteratureQueryState): string {
  return [q.search, q.sortKey, q.sortAsc, q.collection, q.venue, q.yearFrom, q.yearTo, q.onlyWithPdf].join('\u0000')
}

export function hasActiveFilters(q: LiteratureQueryState): boolean {
  return (
    q.collection !== ALL_COLLECTIONS || q.venue !== ALL_VENUES || q.yearFrom.trim() !== '' || q.yearTo.trim() !== '' || q.onlyWithPdf
  )
}

/** 年份输入只留数字、最多 4 位（`-`、中文、粘贴的杂字符都挡掉） */
export function sanitizeYearInput(value: string): string {
  return value.replace(/[^\d]/g, '').slice(0, 4)
}

/** 预编译后的筛选条件（一次转换，逐条判定时不再重复解析） */
export interface PreparedQuery {
  needle: string
  collection: string
  venue: string
  yearFrom: number | null
  yearTo: number | null
  onlyWithPdf: boolean
}

export function prepareQuery(q: LiteratureQueryState): PreparedQuery {
  return {
    needle: q.search.trim().toLowerCase(),
    collection: q.collection,
    venue: q.venue,
    yearFrom: q.yearFrom.trim() === '' ? null : Number(q.yearFrom),
    yearTo: q.yearTo.trim() === '' ? null : Number(q.yearTo),
    onlyWithPdf: q.onlyWithPdf,
  }
}

/** 单篇判定：分类（含整棵子树）/ 期刊 / 年份范围 / 有本地 PDF / 全文关键词 */
export function matchesQuery(note: Note, q: PreparedQuery): boolean {
  const lit = note.literature
  if (q.onlyWithPdf && !hasReadablePdf(note)) return false
  if (!matchesCollectionFilter(note, q.collection)) return false
  if (q.venue !== ALL_VENUES && (lit?.venue ?? '').trim() !== q.venue) return false
  if (q.yearFrom !== null || q.yearTo !== null) {
    const year = typeof lit?.year === 'number' ? lit.year : null
    if (year === null) return false
    if (q.yearFrom !== null && Number.isFinite(q.yearFrom) && year < q.yearFrom) return false
    if (q.yearTo !== null && Number.isFinite(q.yearTo) && year > q.yearTo) return false
  }
  if (!q.needle) return true
  const hay = [
    note.title,
    cleanLiteratureTitle(note.title),
    lit?.venue ?? '',
    lit?.doi ?? '',
    lit?.citekey ?? '',
    ...(lit?.authors ?? []),
    ...(lit?.collections ?? []),
    ...note.tags,
  ]
    .join('\n')
    .toLowerCase()
  return hay.includes(q.needle)
}

/** 排序取值：标题 / 第一作者 / 期刊 / citekey 用小写字符串，年份缺失记 -1（倒序时排在最后） */
export function sortValue(note: Note, key: SortKey): string | number {
  switch (key) {
    case 'title':
      return note.title.toLowerCase()
    case 'author':
      return (note.literature?.authors?.[0] ?? '').toLowerCase()
    case 'venue':
      return (note.literature?.venue ?? '').toLowerCase()
    case 'citekey':
      return (note.literature?.citekey ?? '').toLowerCase()
    case 'year':
      return typeof note.literature?.year === 'number' ? note.literature.year : -1
    default:
      return ''
  }
}

/** 点击表头：同列切换方向，换列则切到该列并回到升序 */
export function toggleSort(q: LiteratureQueryState, key: SortKey): LiteratureQueryState {
  if (q.sortKey === key) return { ...q, sortAsc: !q.sortAsc }
  return { ...q, sortKey: key, sortAsc: true }
}

/** 表头箭头（` ↑` / ` ↓` / 空） */
export function sortMark(q: LiteratureQueryState, key: SortKey): string {
  return q.sortKey === key ? (q.sortAsc ? ' ↑' : ' ↓') : ''
}

/** 筛选 + 排序（不修改入参） */
export function selectLiterature(literature: Note[], q: LiteratureQueryState): Note[] {
  const prepared = prepareQuery(q)
  const filtered = literature.filter((n) => matchesQuery(n, prepared))
  return sortNotes(filtered, q.sortKey, q.sortAsc)
}

export function sortNotes(rows: Note[], key: SortKey, asc: boolean): Note[] {
  return [...rows].sort((a, b) => {
    const va = sortValue(a, key)
    const vb = sortValue(b, key)
    const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))
    return asc ? cmp : -cmp
  })
}

/** 期刊/会议筛选项：按篇数倒序（同数按名称），最多 80 条 */
export function venueOptionsOf(literature: Note[]): [string, number][] {
  const counts = new Map<string, number>()
  for (const note of literature) {
    const venue = (note.literature?.venue ?? '').trim()
    if (venue) counts.set(venue, (counts.get(venue) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, VENUE_OPTION_LIMIT)
}

/** 分页状态：`key` 是当时的筛选指纹 */
export interface PageState {
  key: string
  count: number
}

/** 筛选指纹变化就把「显示更多」退回首页；没变化时返回原对象（不触发多余渲染） */
export function resetPageOnFilterChange(page: PageState, key: string): PageState {
  return page.key === key ? page : { key, count: PAGE_SIZE }
}

/** 「显示更多」的下一步计数 */
export function nextVisibleCount(visibleCount: number): number {
  return visibleCount + PAGE_SIZE
}

export interface PageSlice {
  /** 本次实际渲染的行 */
  rows: Note[]
  /** 已显示行数（最多 = 总数） */
  visible: number
  total: number
  remaining: number
  hasMore: boolean
}

/** 只切前 visibleCount 行：总数超出一页时由「显示更多」按 150 递增 */
export function paginate(rows: Note[], visibleCount: number): PageSlice {
  const visible = Math.max(0, Math.min(visibleCount, rows.length))
  return { rows: rows.slice(0, visibleCount), visible, total: rows.length, remaining: rows.length - visible, hasMore: rows.length > visible }
}
