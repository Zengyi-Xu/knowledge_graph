/**
 * 文献表自测：分类树 / 筛选 / 分页 / PDF 徽标 / Zotero 同步对话框流程 + 组件 SSR 结构。
 *
 * 全部用内存 fixture：不读真实 vault、不碰真实 Zotero 库；冻结单元 zotero-rules 只读不改。
 * 跑法：npm run test:lit-view（esbuild 打包 + node，无浏览器、无网络）
 */
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Note } from '@/types/note'
import type { ZoteroItem, ZoteroSyncPlan, ZoteroSyncUpdate } from '@/lib/zoteroSync'
import {
  NO_COLLECTION,
  collectionLabel,
  collectionTreeOf,
  findCollection,
  matchesCollectionFilter,
  realCollections,
} from '@/components/literature/collectionTree'
import {
  PAGE_SIZE,
  hasActiveFilters,
  initialQueryState,
  nextVisibleCount,
  paginate,
  queryFingerprint,
  resetPageOnFilterChange,
  sanitizeYearInput,
  selectLiterature,
  sortMark,
  toggleSort,
  venueOptionsOf,
} from '@/components/literature/literatureQuery'
import { hasReadablePdf, pdfCellView } from '@/components/literature/pdfCell'
import { clearLocalPdfMatch, ensureLocalPdfMatches, localPdfMatch } from '@/lib/localPdfFallback'
import { cachedPdfSource, externalPdfSource, loadPdfSourceCached, type PdfSource } from '@/lib/pdfSource'
import { PREVIEW_LIMIT, applyAction, hasHiddenUpdates, previewUpdates, readAction, readSyncPlan } from '@/components/literature/zoteroSyncFlow'
import { looksLikeArxivId } from '@/components/literature/importInput'
import { LiteratureTable } from '@/components/literature/LiteratureTable'
import { LiteratureToolbar } from '@/components/literature/LiteratureToolbar'
import { useLiteratureQuery } from '@/components/literature/useLiteratureQuery'
import { LiteratureView } from '@/components/LiteratureView'

let passed = 0
const failures: string[] = []

async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`)
    console.log(`  ✗ ${name}\n      ${error instanceof Error ? error.message : String(error)}`)
  }
}

function section(title: string) {
  console.log(`\n${title}`)
}

function litNote(id: string, title: string, partial: Partial<Note['literature']> = {}, tags: string[] = []): Note {
  return {
    id,
    title,
    type: 'literature',
    grade: '',
    tags,
    content: '',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    literature: {
      authors: ['Zhang, San'],
      venue: 'Nature Photonics',
      year: 2024,
      doi: '10.1038/s41566-024-0001',
      citekey: id,
      attachments: [],
      collections: [],
      ...partial,
    },
  }
}

/**
 * 临时把 window 换成最小替身：pdfSource 的 Zotero 分支要读 `desk`，而自测跑在 node 里（没有 window）。
 * 用完立刻还原，避免让 SSR 断言以为自己在浏览器里跑。
 */
async function withFakeWindow(bridge: Record<string, unknown>, fn: () => Promise<void> | void): Promise<void> {
  const g = globalThis as { window?: unknown }
  const had = 'window' in g
  const before = g.window
  g.window = { knowledgeGraphDesktop: bridge }
  try {
    await fn()
  } finally {
    if (had) g.window = before
    else delete g.window
  }
}

/** 分类树 fixture：父 / 子 / 孙 + 同一篇挂两条路径 + 未分类（两种形态）+ 另一棵树 */
function treeFixture(): Note[] {
  return [
    litNote('A', '父分类直属', { collections: ['硅光'] }),
    litNote('B', '子分类一', { collections: ['硅光/探测器'] }),
    litNote('C', '子分类二', { collections: ['硅光/调制器'] }),
    litNote('D', '同一篇挂两条路径', { collections: ['硅光/调制器', '硅光/探测器'] }),
    litNote('E', '另一棵树', { collections: ['算法'] }),
    litNote('F', '孙分类', { collections: ['硅光/调制器/高速'] }),
    litNote('G', '没有分类', { collections: [] }),
    litNote('H', '历史占位', { collections: ['未分类'] }),
  ]
}

function zItem(partial: Partial<ZoteroItem> = {}): ZoteroItem {
  return {
    zoteroKey: 'AAAA1111',
    itemType: 'journalArticle',
    title: 'Silicon photonics for quantum computing',
    doi: '10.1038/s41566-024-0001',
    year: 2024,
    venue: 'Nature Photonics',
    authors: ['Zhang, San'],
    collectionPaths: [],
    pdfCount: 0,
    availablePdfCount: 0,
    ...partial,
  }
}

/** 只给出关心的字段，其余补成合法计划（类型安全，不用 as 强转） */
function planOf(updates: Partial<ZoteroSyncUpdate>[], unmatched: ZoteroItem[] = []): ZoteroSyncPlan {
  return {
    updates: updates.map((u) => ({
      noteId: 'x',
      collections: [],
      tagsToAdd: [],
      tagsToRemove: [],
      zoteroKey: '',
      zoteroKeys: [],
      zoteroPdfCount: 0,
      zoteroAvailablePdfCount: 0,
      ...u,
    })),
    unmatchedZotero: unmatched,
    matchedCount: updates.length,
  }
}

const noop = () => {}

/** 表格需要的行动作（SSR 只渲染结构，不触发） */
const testActions = { onOpenNote: noop, onReadPdf: noop, onOpenLocalPdf: noop, onOpenInZotero: noop, styleId: 'gb' as const }

/** 用真实 hook 驱动工具栏 + 表格，断言「hook → 展示」的接线 */
function QueryProbe({ notes, showTags }: { notes: Note[]; showTags: boolean }) {
  const ctl = useLiteratureQuery(notes)
  return (
    <>
      <LiteratureToolbar
        ctl={ctl}
        showTags={showTags}
        onToggleTags={noop}
        styleId="gb"
        onStyleChange={noop}
        onCopyBibliography={noop}
        onOpenDoi={noop}
        onOpenBib={noop}
        onOpenZotero={noop}
      />
      <LiteratureTable
        page={ctl.page}
        literatureCount={ctl.literature.length}
        showTags={showTags}
        onShowMore={ctl.showMore}
        onSort={ctl.toggleSort}
        sortMark={ctl.sortMark}
        actions={testActions}
      />
    </>
  )
}

function tableOf(notes: Note[], showTags = false) {
  return renderToStaticMarkup(
    <LiteratureTable
      page={paginate(notes, PAGE_SIZE)}
      literatureCount={notes.length}
      showTags={showTags}
      onShowMore={noop}
      onSort={noop}
      sortMark={() => ''}
      actions={testActions}
    />,
  )
}

async function main() {
  section('分类（折叠树：一级默认可见 / 子树计数 / 逐级展开 / 未分类动态）')
  {
    const literature = treeFixture()
    const { tree, none } = collectionTreeOf(literature)
    const top = (p: string) => tree.find((n) => n.path === p)

    await check('默认只有一级节点，深层都在 children 里（不展开就不渲染）', () => {
      assert.deepEqual(tree.map((n) => n.path), ['硅光', '算法'])
      const kids = top('硅光')!.children.map((n) => n.path)
      assert.deepEqual(new Set(kids), new Set(['硅光/探测器', '硅光/调制器']))
      assert.deepEqual(kids, [...kids].sort((a, b) => a.localeCompare(b, 'zh-CN')), '同级按 zh-CN 排序')
      assert.deepEqual(findCollection(tree, '硅光/调制器')?.children.map((n) => n.path), ['硅光/调制器/高速'])
    })
    await check('节点计数 = 子树唯一篇数（硅光 = A + B + C + D + F = 5）', () => {
      assert.equal(top('硅光')?.count, 5)
      assert.equal(findCollection(tree, '硅光/探测器')?.count, 2)
      assert.equal(findCollection(tree, '硅光/调制器')?.count, 3)
      assert.equal(findCollection(tree, '硅光/调制器/高速')?.count, 1)
      assert.equal(top('算法')?.count, 1)
    })
    await check('同一篇挂多条路径只算一次（D 在两条子路径下都还是同一篇）', () => {
      const duplicated = [litNote('x', 'x', { collections: ['硅光/探测器', '硅光/调制器'] })]
      assert.equal(collectionTreeOf(duplicated).tree[0].count, 1)
    })
    await check('同级按 localeCompare(zh-CN) 排序', () => {
      const shuffled = [litNote('y', 'y', { collections: ['b'] }), litNote('z', 'z', { collections: ['a'] })]
      assert.deepEqual(collectionTreeOf(shuffled).tree.map((n) => n.path), ['a', 'b'])
    })
    await check('findCollection 按完整路径取节点（触发器上的计数用它）', () => {
      assert.equal(findCollection(tree, '硅光/调制器/高速')?.count, 1)
      assert.equal(findCollection(tree, '不存在'), undefined)
    })
    await check('未分类动态：空 collections 与历史占位「未分类」都算未分类，且不进分类树', () => {
      assert.equal(none, 2)
      assert.equal(findCollection(tree, '未分类'), undefined)
      assert.deepEqual(realCollections(litNote('x', 'x', { collections: ['未分类'] })), [])
      assert.deepEqual(realCollections(litNote('x', 'x', { collections: ['未分类', '硅光'] })), ['硅光'])
    })
    await check('分类显示：只显示一级分类，多个用「；」连接，没有真实分类显示未分类', () => {
      assert.equal(collectionLabel(litNote('x', 'x', { collections: ['硅光/调制器', '算法'] })), '硅光；算法')
      assert.equal(collectionLabel(litNote('x', 'x', { collections: ['硅光/调制器/高速'] })), '硅光')
      assert.equal(collectionLabel(litNote('x', 'x', { collections: [] })), '未分类')
      assert.equal(collectionLabel(litNote('x', 'x', {})), '未分类')
    })
    await check('分类筛选：选中某个分类连带整棵子树；未分类只留没有真实分类的', () => {
      assert.equal(matchesCollectionFilter(litNote('x', 'x', { collections: ['硅光/调制器/高速'] }), '硅光'), true)
      assert.equal(matchesCollectionFilter(litNote('x', 'x', { collections: ['硅光器件'] }), '硅光'), false, '前缀相近但不是子路径')
      assert.equal(matchesCollectionFilter(litNote('x', 'x', { collections: [] }), NO_COLLECTION), true)
      assert.equal(matchesCollectionFilter(litNote('x', 'x', { collections: ['未分类'] }), NO_COLLECTION), true)
      assert.equal(matchesCollectionFilter(litNote('x', 'x', { collections: ['硅光'] }), NO_COLLECTION), false)
      assert.equal(matchesCollectionFilter(litNote('x', 'x', { collections: [] }), 'all'), true)
    })
  }

  section('筛选（关键词 / 分类 / 期刊 / 年份 / 有本地 PDF）')
  {
    const literature = [
      litNote('n1', 'Silicon photonics for quantum computing', { venue: 'Nature Photonics', year: 2024, doi: '10.1038/a', citekey: 'zhang2024silicon', collections: ['硅光/调制器'] }),
      litNote('n2', 'Optical modulators in thin film lithium niobate', { venue: 'Nature Photonics', year: 2023, doi: '10.1038/b', citekey: 'li2023modulator', collections: ['硅光/调制器/高速'], localPdf: 'D:/pdfs/b.pdf' }),
      litNote('n3', 'A survey on graph neural networks', { venue: 'IEEE TKDE', year: 2022, doi: '10.1109/c', citekey: 'wang2022gnn', collections: ['算法'] }),
      litNote('n4', 'Untitled preprint', { venue: '', year: '', doi: '', citekey: 'anon', authors: [], collections: [] }),
      litNote('n5', 'Zotero 里有 PDF 的一篇', { venue: 'IEEE TKDE', year: 2021, zoteroKey: 'AAAA1111', zoteroPdfCount: 1, zoteroAvailablePdfCount: 1, collections: ['算法'] }),
    ]
    const ids = (q: Parameters<typeof selectLiterature>[1]) => selectLiterature(literature, q).map((n) => n.id)

    await check('关键词覆盖标题 / 期刊 / DOI / citekey / 作者 / 分类，大小写不敏感', () => {
      assert.deepEqual(ids(initialQueryState({ search: 'SILICON' })), ['n1'])
      assert.deepEqual(ids(initialQueryState({ search: '10.1109/c' })), ['n3'])
      assert.deepEqual(ids(initialQueryState({ search: 'li2023modulator' })), ['n2'])
      assert.deepEqual(ids(initialQueryState({ search: 'zhang, san' })).sort(), ['n1', 'n2', 'n3', 'n5'])
      assert.deepEqual(ids(initialQueryState({ search: '硅光/调制器' })).sort(), ['n1', 'n2'])
      assert.deepEqual(ids(initialQueryState({ search: '高速' })), ['n2'])
      assert.deepEqual(ids(initialQueryState({ search: '  nature photonics  ' })).sort(), ['n1', 'n2'])
      assert.deepEqual(ids(initialQueryState({ search: '不存在' })), [])
    })
    await check('标签参与搜索（只读，不改数据）', () => {
      const tagged = [litNote('t1', 'Tagged', {}, ['方向:硅光'])]
      assert.deepEqual(selectLiterature(tagged, initialQueryState({ search: '方向:硅光' })).map((n) => n.id), ['t1'])
    })
    await check('分类筛选带整棵子树', () => {
      assert.deepEqual(ids(initialQueryState({ collection: '硅光' })).sort(), ['n1', 'n2'])
    })
    await check('未分类筛选只留没有真实分类的', () => {
      assert.deepEqual(ids(initialQueryState({ collection: NO_COLLECTION })), ['n4'])
    })
    await check('期刊筛选精确匹配', () => {
      assert.deepEqual(ids(initialQueryState({ venue: 'IEEE TKDE' })).sort(), ['n3', 'n5'])
      assert.deepEqual(ids(initialQueryState({ venue: 'Nature' })), [])
    })
    await check('年份范围含边界；没有年份的文献被排除', () => {
      const range = (from: string, to: string) => ids(initialQueryState({ yearFrom: from, yearTo: to })).sort()
      assert.deepEqual(range('2022', '2023'), ['n2', 'n3'])
      assert.deepEqual(range('2023', ''), ['n1', 'n2'])
      assert.deepEqual(range('', '2022'), ['n3', 'n5'])
      assert.equal(range('2010', '2030').includes('n4'), false)
      assert.deepEqual(range('2025', ''), [])
    })
    await check('有本地 PDF：localPdf 或 Zotero 可访问 PDF 都算', () => {
      assert.deepEqual(ids(initialQueryState({ onlyWithPdf: true })).sort(), ['n2', 'n5'])
    })
    await check('多条件叠加（分类 + 年份 + 关键词）', () => {
      assert.deepEqual(ids(initialQueryState({ collection: '硅光', yearFrom: '2023', yearTo: '2024', search: 'modulat' })), ['n2'])
    })
    await check('清除筛选只清四项：保留搜索词与排序', () => {
      const q = initialQueryState({ search: '硅光', sortKey: 'title', sortAsc: true, collection: '算法', venue: 'IEEE TKDE', yearFrom: '2020', onlyWithPdf: true })
      assert.equal(hasActiveFilters(q), true)
      const cleared = { ...q, collection: 'all', venue: 'all', yearFrom: '', yearTo: '', onlyWithPdf: false }
      assert.equal(hasActiveFilters(cleared), false)
      assert.deepEqual([cleared.search, cleared.sortKey, cleared.sortAsc], ['硅光', 'title', true])
    })
    await check('默认没有筛选；搜索词单独存在不算「筛选项已启用」（不显示清除筛选）', () => {
      assert.equal(hasActiveFilters(initialQueryState()), false)
      assert.equal(hasActiveFilters(initialQueryState({ search: 'x' })), false)
    })
    await check('年份输入只留数字、最多 4 位', () => {
      assert.equal(sanitizeYearInput('20a24年'), '2024')
      assert.equal(sanitizeYearInput('123456'), '1234')
      assert.equal(sanitizeYearInput('-'), '')
      assert.equal(sanitizeYearInput('2024-01'), '2024')
    })
    await check('期刊下拉按篇数倒序（同数按名称），最多 80 个', () => {
      const opts = venueOptionsOf(literature)
      assert.deepEqual(opts, [['IEEE TKDE', 2], ['Nature Photonics', 2]])
      const many = Array.from({ length: 100 }, (_, i) => litNote(`v${i}`, `t${i}`, { venue: `V${i}` }))
      assert.equal(venueOptionsOf(many).length, 80)
    })
  }

  section('排序')
  {
    const literature = [
      litNote('old', 'B paper', { year: 2019, venue: 'Avenue', authors: ['Zhou, Wu'], citekey: 'zhou2019' }),
      litNote('new', 'A paper', { year: 2024, venue: 'Bvenue', authors: ['An, Qi'], citekey: 'an2024' }),
      litNote('none', 'C paper', { year: '' }),
    ]
    const ids = (q: Parameters<typeof selectLiterature>[1]) => selectLiterature(literature, q).map((n) => n.id)

    await check('默认年份倒序，没有年份的排最后', () => {
      assert.deepEqual(ids(initialQueryState()), ['new', 'old', 'none'])
    })
    await check('切表头：同列翻方向，异列换键并回到升序', () => {
      const titleAsc = toggleSort(initialQueryState(), 'title')
      assert.deepEqual([titleAsc.sortKey, titleAsc.sortAsc], ['title', true])
      const titleDesc = toggleSort(titleAsc, 'title')
      assert.deepEqual([titleDesc.sortKey, titleDesc.sortAsc], ['title', false])
      assert.deepEqual([toggleSort(titleDesc, 'year').sortKey, toggleSort(titleDesc, 'year').sortAsc], ['year', true])
    })
    await check('标题/作者/期刊/citekey 排序；年份升序时没有年份的排最前', () => {
      const by = (sortKey: 'title' | 'author' | 'venue' | 'citekey' | 'year', sortAsc: boolean) => ids(initialQueryState({ sortKey, sortAsc }))
      assert.deepEqual(by('title', true), ['new', 'old', 'none'])
      assert.deepEqual(by('author', true), ['new', 'none', 'old'])
      assert.deepEqual(by('venue', true), ['old', 'new', 'none'])
      assert.deepEqual(by('citekey', true), ['new', 'none', 'old'])
      assert.deepEqual(by('year', true), ['none', 'old', 'new'])
    })
    await check('表头箭头：当前列 ↑ / ↓，其它列为空', () => {
      const q = initialQueryState({ sortKey: 'title', sortAsc: false })
      assert.equal(sortMark(q, 'title'), ' ↓')
      assert.equal(sortMark(q, 'year'), '')
      assert.equal(sortMark({ ...q, sortAsc: true }, 'title'), ' ↑')
    })
    await check('排序不改动入参数组', () => {
      const input = [litNote('a', 'a', { year: 2000 }), litNote('b', 'b', { year: 2020 })]
      const out = selectLiterature(input, initialQueryState())
      assert.deepEqual(input.map((n) => n.id), ['a', 'b'])
      assert.deepEqual(out.map((n) => n.id), ['b', 'a'])
      assert.notEqual(out, input)
    })
  }

  section('分页（150 行增量渲染）')
  {
    const many = Array.from({ length: 400 }, (_, i) => litNote(`n${i}`, `Paper ${i}`, { year: 2000 + (i % 25) }))

    await check('PAGE_SIZE = 150', () => assert.equal(PAGE_SIZE, 150))
    await check('400 篇：首页 150 行，还剩 250，出现「显示更多」', () => {
      const page = paginate(many, PAGE_SIZE)
      assert.equal(page.rows.length, 150)
      assert.equal(page.total, 400)
      assert.equal(page.remaining, 250)
      assert.equal(page.hasMore, true)
    })
    await check('显示更多按 150 递增：150 → 300 → 400，末页不再有更多', () => {
      let count = PAGE_SIZE
      const steps: number[] = []
      for (let i = 0; i < 3; i++) {
        count = nextVisibleCount(count)
        steps.push(paginate(many, count).visible)
      }
      assert.deepEqual(steps, [300, 400, 400])
      assert.equal(paginate(many, 400).hasMore, false)
      assert.equal(paginate(many, 400).remaining, 0)
    })
    await check('不足一页时不出现「显示更多」', () => {
      const page = paginate(many.slice(0, 12), PAGE_SIZE)
      assert.deepEqual([page.rows.length, page.hasMore, page.remaining], [12, false, 0])
    })
    await check('筛选指纹：任何一项变化都不同，相同条件稳定', () => {
      const base = initialQueryState()
      assert.equal(queryFingerprint(base), queryFingerprint(initialQueryState()))
      const variants = [
        initialQueryState({ search: 'x' }),
        initialQueryState({ sortKey: 'title' }),
        initialQueryState({ sortAsc: true }),
        initialQueryState({ collection: '硅光' }),
        initialQueryState({ venue: 'V' }),
        initialQueryState({ yearFrom: '2020' }),
        initialQueryState({ yearTo: '2020' }),
        initialQueryState({ onlyWithPdf: true }),
      ]
      for (const v of variants) assert.notEqual(queryFingerprint(v), queryFingerprint(base))
    })
    await check('筛选指纹变化 → 退回 150 行首页；没变化时不触发渲染（返回原对象）', () => {
      const page = { key: 'k1', count: 450 }
      assert.equal(resetPageOnFilterChange(page, 'k1'), page)
      assert.deepEqual(resetPageOnFilterChange(page, 'k2'), { key: 'k2', count: PAGE_SIZE })
    })
    await check('筛选后行数变少：分页按新结果重算，首页仍是 150', () => {
      const filtered = selectLiterature(many, initialQueryState({ yearFrom: '2010' }))
      assert.ok(filtered.length < 400 && filtered.length > 150, `实际 ${filtered.length}`)
      const page = paginate(filtered, PAGE_SIZE)
      assert.equal(page.rows.length, 150)
      assert.equal(page.remaining, filtered.length - 150)
    })
  }

  section('PDF 徽标（即时响应 / 状态分级）')
  {
    await check('localPdf → read（徽标本身就是按钮，单击即读）', () => {
      assert.deepEqual(pdfCellView(litNote('x', 'x', { localPdf: 'D:/a/b.pdf' })), { kind: 'read' })
    })
    await check('Zotero 有可访问 PDF → read（去重合并后的多 key 计数）', () => {
      assert.deepEqual(pdfCellView(litNote('x', 'x', { zoteroKey: 'K', zoteroKeys: ['K', 'K2'], zoteroPdfCount: 2, zoteroAvailablePdfCount: 1 })), { kind: 'read' })
    })
    await check('有 key 但没同步过 PDF 状态 → unsynced', () => {
      assert.deepEqual(pdfCellView(litNote('x', 'x', { zoteroKey: 'K' })), { kind: 'unsynced' })
    })
    await check('Zotero 登记了 PDF 但本机没有 → missing（引导去 Zotero 打开）', () => {
      assert.deepEqual(pdfCellView(litNote('x', 'x', { zoteroKey: 'K', zoteroPdfCount: 1, zoteroAvailablePdfCount: 0 })), { kind: 'missing' })
    })
    await check('登记 0 个 PDF → 纯文字「无本地 PDF」；没有 key → 「—」', () => {
      assert.deepEqual(pdfCellView(litNote('x', 'x', { zoteroKey: 'K', zoteroPdfCount: 0, zoteroAvailablePdfCount: 0 })), { kind: 'none', text: '无本地 PDF' })
      assert.deepEqual(pdfCellView(litNote('x', 'x', {})), { kind: 'none', text: '—' })
      assert.deepEqual(pdfCellView(litNote('x', 'x', { localPdf: '' })), { kind: 'none', text: '—' })
    })
    await check('hasReadablePdf 与行内菜单一致（菜单里才显示全屏阅读/系统阅读器）', () => {
      assert.equal(hasReadablePdf(litNote('x', 'x', { localPdf: 'D:/a/b.pdf' })), true)
      assert.equal(hasReadablePdf(litNote('x', 'x', { zoteroAvailablePdfCount: 1 })), true)
      assert.equal(hasReadablePdf(litNote('x', 'x', { zoteroKey: 'K', zoteroPdfCount: 1, zoteroAvailablePdfCount: 0 })), false)
      assert.equal(hasReadablePdf(litNote('x', 'x', { zoteroAvailablePdfCount: 0 })), false)
      assert.equal(hasReadablePdf(litNote('x', 'x', {})), false)
    })
    await check('字段全缺时用「按标题兜底匹配」的本地 PDF：徽标可用且标为 matched', async () => {
      const note = litNote('fallback-1', 'A Matched Paper Title')
      await withFakeWindow(
        {
          matchLocalPdf: async () => ({
            matches: { 'fallback-1': { path: 'D:/lib/matched.pdf', score: 1, reason: '文件名与标题完全一致' } },
            stats: { titles: 1, files: 1, compared: 1, matched: 1 },
          }),
        },
        async () => {
          ensureLocalPdfMatches([note])
          await new Promise((resolve) => setTimeout(resolve, 0))
          assert.deepEqual(pdfCellView(note), { kind: 'read', matched: true })
          assert.equal(hasReadablePdf(note), true)
          assert.deepEqual(externalPdfSource(note), { kind: 'local-scan', path: 'D:/lib/matched.pdf' })
          clearLocalPdfMatch(note.id)
          assert.equal(hasReadablePdf(note), false)
        },
      )
    })
    await check('兜底匹配不覆盖已有来源：有 localPdf / Zotero PDF 时不算 matched', () => {
      const note = litNote('fallback-2', 'Another Title', { localPdf: 'D:/a/b.pdf' })
      assert.deepEqual(pdfCellView(note), { kind: 'read' })
      assert.equal(localPdfMatch(note), null)
    })
  }

  section('详情页的外部 PDF（localPdf / Zotero）')
  {
    await check('localPdf 优先于 Zotero；应用内附件不算「外部 PDF」', () => {
      assert.deepEqual(externalPdfSource(litNote('x', 'x', { localPdf: 'D:/a/b.pdf' })), { kind: 'local', path: 'D:/a/b.pdf' })
      // 只有应用内附件 → 详情页不显示外部条目（「尚无附件」照旧）
      assert.equal(externalPdfSource(litNote('x', 'x', { attachments: ['att-1'] })), null)
      // Zotero 登记了 PDF 但本机没有 → 也不显示（与徽标 missing 一致，不假装能读）
      assert.equal(externalPdfSource(litNote('x', 'x', { zoteroKey: 'K', zoteroPdfCount: 1, zoteroAvailablePdfCount: 0 })), null)
      assert.equal(externalPdfSource(litNote('x', 'x', { localPdf: '', attachments: ['att-1'] })), null)
    })

    await check('Zotero 可读 PDF → 外部来源带上多 key（去重后的回退列表）', async () => {
      await withFakeWindow({ defaultZoteroDb: 'D:/zotero.sqlite' }, async () => {
        assert.deepEqual(
          externalPdfSource(litNote('x', 'x', { zoteroKey: 'K', zoteroKeys: ['K', 'K2'], zoteroPdfCount: 2, zoteroAvailablePdfCount: 1 })),
          { kind: 'zotero', dbPath: 'D:/zotero.sqlite', key: 'K', keys: ['K', 'K2'] },
        )
      })
    })

    await check('同一份 PDF 只跨桥读一次；不同来源互不串用', async () => {
      let reads = 0
      await withFakeWindow(
        {
          readZoteroPdf: async () => {
            reads++
            return { data: new Uint8Array([1, 2, 3]), name: 'K.pdf', path: 'D:/z/K.pdf' }
          },
        },
        async () => {
          const source: PdfSource = { kind: 'zotero', dbPath: 'D:/z.sqlite', key: 'K', keys: [] }
          const first = await loadPdfSourceCached(source)
          const again = await loadPdfSourceCached(source)
          assert.equal(reads, 1)
          assert.equal(first, again)
          assert.equal(cachedPdfSource(source), first)
          assert.equal(cachedPdfSource({ kind: 'local', path: 'D:/other.pdf' }), null)
        },
      )
    })
  }

  section('同步 Zotero 对话框（读取 → 计划 → 应用）')
  {
    const notes = [
      litNote('n-sync', 'Silicon photonics for quantum computing', { zoteroKey: 'AAAA1111', collections: [] }),
      litNote('n-other', '不是这篇', { zoteroKey: 'ZZZZ9999', doi: '10.9/none' }),
    ]
    const items = [
      zItem({ zoteroKey: 'AAAA1111', collectionPaths: ['硅光/调制器'], venue: 'Nature Photonics', year: 2024, pdfCount: 1, availablePdfCount: 1 }),
      zItem({ zoteroKey: 'BBBB2222', title: 'Zotero 里有、笔记里没有的一篇', doi: '10.1/zzz', collectionPaths: ['其它'] }),
    ]
    let seenPath = ''
    const bridge = {
      readZotero: async (dbPath: string) => {
        seenPath = dbPath
        return { collections: ['硅光', '硅光/调制器'], items }
      },
    }

    await check('路径去首尾空白后才读库', async () => {
      await readSyncPlan(bridge, '   D:/Zotero/zotero.sqlite   ', notes)
      assert.equal(seenPath, 'D:/Zotero/zotero.sqlite')
    })
    await check('没有桥（非桌面 / 非网页端）→ 明确报错，不静默走空计划', async () => {
      await assert.rejects(() => readSyncPlan(undefined, 'D:/z.sqlite', notes), /仅桌面版或本地网页端可用/)
    })
    await check('路径为空 → 报错，且不读库', async () => {
      let called = false
      const spy = {
        readZotero: async () => {
          called = true
          return { collections: [], items: [] }
        },
      }
      await assert.rejects(() => readSyncPlan(spy, '   ', notes), /请先填写 zotero\.sqlite/)
      assert.equal(called, false)
    })
    await check('计划：按 key 匹配到要更新的那篇，其余进 unmatchedZotero', async () => {
      const plan = await readSyncPlan(bridge, 'D:/z.sqlite', notes)
      assert.equal(plan.matchedCount, 1)
      assert.deepEqual(plan.updates.map((u) => u.noteId), ['n-sync'])
      assert.deepEqual(plan.unmatchedZotero.map((i) => i.zoteroKey), ['BBBB2222'])
    })
    await check('更新带上分类 / Zotero key / PDF 计数 / 自动标签（写库由调用方负责）', async () => {
      const plan = await readSyncPlan(bridge, 'D:/z.sqlite', notes)
      const u = plan.updates[0]
      assert.deepEqual(u.collections, ['硅光/调制器'])
      assert.equal(u.zoteroKey, 'AAAA1111')
      assert.deepEqual(u.zoteroKeys, ['AAAA1111'])
      assert.deepEqual([u.zoteroPdfCount, u.zoteroAvailablePdfCount], [1, 1])
      assert.deepEqual(u.tagsToAdd, ['期刊:Nature Photonics', '年份:2024'])
      assert.deepEqual(u.tagsToRemove, [])
    })
    await check('读取失败原样抛出（对话框转 toast，不当成「0 条更新」）', async () => {
      const broken = {
        readZotero: async () => {
          throw new Error('database is locked')
        },
      }
      await assert.rejects(() => readSyncPlan(broken, 'D:/z.sqlite', notes), /database is locked/)
    })
    await check('「读取并预览」：读取中或无路径时禁用', () => {
      assert.deepEqual(readAction(false, 'D:/z.sqlite'), { label: '读取并预览', disabled: false })
      assert.deepEqual(readAction(true, 'D:/z.sqlite'), { label: '读取中…', disabled: true })
      assert.deepEqual(readAction(false, '  '), { label: '读取并预览', disabled: true })
    })
    await check('「应用 N 条更新」：0 条更新时禁用（不写空计划）', () => {
      assert.deepEqual(applyAction(planOf([])), { label: '应用 0 条更新', disabled: true })
      assert.deepEqual(applyAction(planOf([{ noteId: 'a' }])), { label: '应用 1 条更新', disabled: false })
    })
    await check('预览最多 50 条，其余标「其余从略」', () => {
      const updates = Array.from({ length: 51 }, (_, i) => ({ noteId: `n${i}` }))
      const plan = planOf(updates)
      assert.equal(PREVIEW_LIMIT, 50)
      assert.equal(previewUpdates(plan).length, 50)
      assert.equal(hasHiddenUpdates(plan), true)
      assert.equal(hasHiddenUpdates(planOf(updates.slice(0, 50))), false)
    })
    await check('DOI / arXiv 输入形态：arXiv 编号与 abs/pdf 链接走 arXiv，其余走 DOI', () => {
      assert.equal(looksLikeArxivId('2401.12345'), true)
      assert.equal(looksLikeArxivId('2401.12345.pdf'), true)
      assert.equal(looksLikeArxivId('https://arxiv.org/abs/2401.12345'), true)
      // 已知缺口（沿用重构前行为，与 importFromArxiv 的清洗规则一致）：/pdf/ 形式的链接不会被识别成 arXiv 编号
      assert.equal(looksLikeArxivId('http://arxiv.org/pdf/2401.12345'), false)
      assert.equal(looksLikeArxivId('10.1038/s41586-020-2649-2'), false)
      assert.equal(looksLikeArxivId('2401.123'), false)
    })
  }

  section('组件 SSR（真实渲染结构）')
  {
    const many = Array.from({ length: 400 }, (_, i) => litNote(`n${i}`, `Paper ${i}`, { year: 2000 + (i % 25), venue: 'Nature Photonics' }))
    const withPdf = [
      litNote('p1', '本地 PDF 的一篇', { localPdf: 'D:/pdfs/p1.pdf' }),
      litNote('p2', 'Zotero 里有 PDF 的一篇', { zoteroKey: 'K1', zoteroPdfCount: 1, zoteroAvailablePdfCount: 1 }),
      litNote('p3', '文件不在本机的一篇', { zoteroKey: 'K2', zoteroPdfCount: 1, zoteroAvailablePdfCount: 0 }),
      litNote('p4', '未同步的一篇', { zoteroKey: 'K3' }),
      litNote('p5', '没有 PDF 的一篇', {}),
    ]
    const html = renderToStaticMarkup(<QueryProbe notes={[...many, ...withPdf]} showTags={false} />)
    const headerRow = html.slice(html.indexOf('<thead'), html.indexOf('</thead>'))
    const bodyRows = html.slice(html.indexOf('</thead>')).match(/<tr/g) ?? []

    await check('工具栏计数 = 筛出 / 全部', () => {
      assert.ok(html.includes('405 / 405 篇文献'), '未找到计数文案')
    })
    await check('首屏只渲染 150 行数据 + 1 行「显示更多」，剩 255 篇', () => {
      assert.equal(bodyRows.length, 151, `实际 ${bodyRows.length} 行`)
      assert.ok(html.includes('显示更多（还有 255 篇）'))
    })
    await check('标签列默认隐藏（表头没有「标签」，带标签的行也不渲染 chip）', () => {
      assert.equal(headerRow.includes('标签'), false)
      const tagged = renderToStaticMarkup(<QueryProbe notes={[litNote('t1', '有标签的一篇', {}, ['方向:硅光'])]} showTags={false} />)
      assert.equal(tagged.includes('#方向:硅光'), false)
    })
    await check('PDF 徽标是真实 <button>（按钮即入口，不是要延迟/悬停才响应的徽章）', () => {
      const buttons = html.match(/<button[^>]*title="在软件内全屏阅读 PDF"[^>]*>/g) ?? []
      assert.equal(buttons.length, 2, `本地 PDF + Zotero 可访问 PDF 各一个按钮，实际 ${buttons.length}`)
      assert.ok(
        buttons.every((tag) => tag.includes('data-slot="button"') && tag.includes('data-variant="secondary"')),
        buttons.join('\n'),
      )
      assert.ok(html.includes('单击标题打开笔记；点 PDF 徽标进入全屏阅读'))
    })
    await check('文件不在本机 → 按钮引导去 Zotero；未同步 / 没有 key 是纯文字', () => {
      assert.ok(/<button[^>]*>[^<]*文件不在本机 · 在 Zotero 打开/.test(html))
      assert.ok(html.includes('未同步'))
      assert.ok(html.includes('>—<'))
    })
    await check('行内「操作」按钮存在（引用 / 打开动作的入口）', () => {
      assert.ok(/<button[^>]*title="操作"/.test(html))
    })
    await check('打开「标签列」后表头出现标签列，超过 4 个折叠成「+N」', () => {
      const withTags = renderToStaticMarkup(<QueryProbe notes={[litNote('t1', '标签一篇', {}, ['方向:硅光', '期刊:NP', '年份:2024', 'a', 'b'])]} showTags />)
      const head = withTags.slice(withTags.indexOf('<thead'), withTags.indexOf('</thead>'))
      assert.ok(head.includes('标签'))
      assert.ok(withTags.includes('#方向:硅光'))
      assert.ok(withTags.includes('+1'))
    })
    await check('空状态：库里没有文献 / 没有匹配，两种文案', () => {
      assert.ok(tableOf([], false).includes('还没有文献笔记'))
      const noMatch = renderToStaticMarkup(
        <LiteratureTable
          page={{ rows: [], visible: 0, total: 0, remaining: 0, hasMore: false }}
          literatureCount={3}
          showTags={false}
          onShowMore={noop}
          onSort={noop}
          sortMark={() => ''}
          actions={testActions}
        />,
      )
      assert.ok(noMatch.includes('没有匹配的文献'))
    })
    await check('整个视图 SSR：默认 150 行、标签列隐藏（浏览器端文案不依赖 window）', () => {
      const view = renderToStaticMarkup(
        <LiteratureView notes={[...many, ...withPdf]} onOpenNote={noop} onReadPdf={noop} onImport={noop} onApplySync={noop} />,
      )
      const body = view.slice(view.indexOf('</thead>'))
      assert.equal((body.match(/<tr/g) ?? []).length, 151)
      assert.equal(view.slice(view.indexOf('<thead'), view.indexOf('</thead>')).includes('标签'), false)
      assert.ok(view.includes('同步 Zotero 分类'))
    })
  }

  console.log('')
  console.log(`通过 ${passed} 项，失败 ${failures.length} 项`)
  if (failures.length) {
    console.log('---- 失败明细 ----')
    for (const f of failures) console.log('· ' + f)
  }
  process.exit(failures.length ? 1 : 0)
}

void main()
