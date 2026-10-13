/**
 * 文献库视图：全部 literature 笔记的表格（排序 / 搜索 / 筛选）、DOI/arXiv 与 BibTeX/RIS 导入、复制引用。
 * 单击标题或用「操作」菜单打开笔记；点 PDF 徽标用系统默认阅读器打开本机 Zotero 里对应的 PDF。
 * 表格按 150 行增量渲染，避免一次挂载上千行；「未分类」按“没有任何真实分类”动态显示，不落盘。
 * 纯网络 + 剪贴板能力，浏览器版与桌面版均可用。
 */
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { BookOpen, ClipboardCopy, FileText, Import, MoreVertical, Search, SlidersHorizontal } from 'lucide-react'
import type { Note } from '@/types/note'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { readSetting, writeSetting } from '@/lib/env'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { ImportedLit } from '@/lib/literature'
import { CITATION_STYLES, cleanLiteratureTitle, litToCSL } from '@/lib/literature'
import type { CitationStyleId } from '@/lib/literature'
import { copyCitationFor } from '@/lib/copyCitation'
import { writeBibliographyClipboard, writeCitationClipboard } from '@/lib/rtfField'
import { planZoteroSync, type ZoteroSyncPlan, type ZoteroSyncUpdate } from '@/lib/zoteroSync'
import { realCollectionsOf } from '@/lib/zoteroMeta'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface Props {
  notes: Note[]
  onOpenNote: (id: string) => void
  /** 批量创建文献笔记（citekey 撞名由调用方处理） */
  onImport: (items: ImportedLit[]) => void
  /** 应用 Zotero 同步计划：合并 collections 与新增标签（调用方负责写库） */
  onApplySync: (updates: ZoteroSyncUpdate[]) => void
}

type SortKey = 'title' | 'author' | 'year' | 'venue' | 'citekey'

/** 本机 Zotero 数据库位置；本地网页端由启动参数 --zotero-db 固定 */
export const ZOTERO_DB_KEY = 'zotero-db-v1'
const DEFAULT_ZOTERO_DB = 'D:\\BaiduSyncdisk\\Bibliotx\\Zotero\\zotero.sqlite'

/** 首选项：上次选过的库 > 运行环境给的默认值（Electron preload / 本地网页服务端） */
function initialZoteroDb(): string {
  const desktop = typeof window !== 'undefined' ? window.knowledgeGraphDesktop : undefined
  return readSetting(ZOTERO_DB_KEY) || desktop?.defaultZoteroDb || DEFAULT_ZOTERO_DB
}

/** 一个列表一次渲染的最大行数，避免上千行一次挂载 */
const PAGE_SIZE = 150
/** 「标签」列默认隐藏（表格更窄，PDF 与标题始终可见），偏好记在本地 */
const SHOW_TAGS_KEY = 'lit-show-tags-v1'

/** 真实分类：历史占位「未分类」不算分类（新数据不会再写它，旧数据同步/去重后会被清掉） */
function realCollections(note: Note): string[] {
  return realCollectionsOf(note.literature?.collections)
}

/** 分类显示：没有任何真实分类的文献动态标成「未分类」，避免看起来像没同步 */
function collectionLabel(note: Note): string {
  const paths = realCollections(note)
  return paths.length ? paths.join('；') : '未分类'
}

/** 分类筛选用一级分类（路径首段） */
function topCollectionOf(path: string): string {
  return path.split('/')[0].trim()
}


export function LiteratureView({ notes, onOpenNote, onImport, onApplySync }: Props) {
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('year')
  const [sortAsc, setSortAsc] = useState(false)
  const [doiOpen, setDoiOpen] = useState(false)
  const [bibOpen, setBibOpen] = useState(false)
  const [zoteroOpen, setZoteroOpen] = useState(false)
  const [zoteroDb, setZoteroDb] = useState(initialZoteroDb)
  const [styleId, setStyleId] = useState<CitationStyleId>('gb')
  const [showTags, setShowTags] = useState(() => readSetting(SHOW_TAGS_KEY) === '1')
  const [fCollection, setFCollection] = useState('all')
  const [fVenue, setFVenue] = useState('all')
  const [fYearFrom, setFYearFrom] = useState('')
  const [fYearTo, setFYearTo] = useState('')
  const [onlyWithPdf, setOnlyWithPdf] = useState(false)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  useEffect(() => {
    writeSetting(ZOTERO_DB_KEY, zoteroDb)
  }, [zoteroDb])

  useEffect(() => {
    writeSetting(SHOW_TAGS_KEY, showTags ? '1' : '0')
  }, [showTags])

  const literature = useMemo(() => notes.filter((n) => n.type === 'literature'), [notes])

  /** 分类筛选项：一级分类 → 篇数（没有真实分类的归入 __none__） */
  const collectionOptions = useMemo(() => {
    const counts = new Map<string, number>()
    let none = 0
    for (const note of literature) {
      const tops = new Set(realCollections(note).map(topCollectionOf).filter(Boolean))
      if (!tops.size) none++
      else for (const top of tops) counts.set(top, (counts.get(top) ?? 0) + 1)
    }
    const options = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'))
    return { options, none }
  }, [literature])

  /** 期刊筛选项：出现的期刊按篇数倒序，取前 80 个 */
  const venueOptions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const note of literature) {
      const venue = (note.literature?.venue ?? '').trim()
      if (venue) counts.set(venue, (counts.get(venue) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 80)
  }, [literature])

  const filtersActive =
    fCollection !== 'all' || fVenue !== 'all' || fYearFrom.trim() !== '' || fYearTo.trim() !== '' || onlyWithPdf

  const clearFilters = () => {
    setFCollection('all')
    setFVenue('all')
    setFYearFrom('')
    setFYearTo('')
    setOnlyWithPdf(false)
  }

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const yearFrom = fYearFrom.trim() === '' ? null : Number(fYearFrom)
    const yearTo = fYearTo.trim() === '' ? null : Number(fYearTo)
    const filtered = literature.filter((n) => {
      if (onlyWithPdf && !((n.literature?.zoteroAvailablePdfCount ?? 0) > 0)) return false
      if (fCollection === '__none__') {
        if (realCollections(n).length) return false
      } else if (fCollection !== 'all') {
        if (!realCollections(n).some((c) => topCollectionOf(c) === fCollection)) return false
      }
      if (fVenue !== 'all' && (n.literature?.venue ?? '').trim() !== fVenue) return false
      if (yearFrom !== null || yearTo !== null) {
        const year = typeof n.literature?.year === 'number' ? n.literature.year : null
        if (year === null) return false
        if (yearFrom !== null && Number.isFinite(yearFrom) && year < yearFrom) return false
        if (yearTo !== null && Number.isFinite(yearTo) && year > yearTo) return false
      }
      if (!q) return true
      const hay = [
        n.title,
        cleanLiteratureTitle(n.title),
        n.literature?.venue ?? '',
        n.literature?.doi ?? '',
        n.literature?.citekey ?? '',
        ...(n.literature?.authors ?? []),
        ...(n.literature?.collections ?? []),
        ...n.tags,
      ].join('\n').toLowerCase()
      return hay.includes(q)
    })
    const val = (n: Note): string | number => {
      switch (sortKey) {
        case 'title':
          return n.title.toLowerCase()
        case 'author':
          return (n.literature?.authors?.[0] ?? '').toLowerCase()
        case 'venue':
          return (n.literature?.venue ?? '').toLowerCase()
        case 'citekey':
          return (n.literature?.citekey ?? '').toLowerCase()
        case 'year':
          return typeof n.literature?.year === 'number' ? n.literature.year : -1
      }
    }
    return [...filtered].sort((a, b) => {
      const va = val(a)
      const vb = val(b)
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))
      return sortAsc ? cmp : -cmp
    })
  }, [literature, search, sortKey, sortAsc, fCollection, fVenue, fYearFrom, fYearTo, onlyWithPdf])

  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [search, sortKey, sortAsc, fCollection, fVenue, fYearFrom, fYearTo, onlyWithPdf])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc((v) => !v)
    else {
      setSortKey(key)
      setSortAsc(true)
    }
  }

  const sortMark = (key: SortKey) => (sortKey === key ? (sortAsc ? ' ↑' : ' ↓') : '')

  /** 从本机 Zotero 库解析这篇文献的 PDF，交给系统默认阅读器（去重合并后的文献可带多个 key） */
  const openLocalPdf = async (note: Note) => {
    const lit = note.literature
    const key = lit?.zoteroKey
    if (!key) {
      toast.info('这篇文献还没有对应 Zotero 条目：先「同步 Zotero 分类」或用批量脚本导入')
      return
    }
    const desktop = window.knowledgeGraphDesktop
    if (!desktop?.openZoteroPdf) {
      toast.error('当前环境不支持打开本地 PDF（请在本地网页端或桌面版中使用）')
      return
    }
    try {
      await desktop.openZoteroPdf(desktop.isLocalWeb ? '' : zoteroDb, key, lit?.zoteroKeys ?? [])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '打开 PDF 失败')
    }
  }

  /** PDF 状态列：区分「有本地 PDF」「有记录但文件不在本机」「未同步」；有 PDF 时徽标本身就是打开按钮 */
  const pdfCell = (note: Note) => {
    const lit = note.literature
    if (!lit?.zoteroKey) return <span className="text-xs text-muted-foreground">—</span>
    const available = lit.zoteroAvailablePdfCount
    if (available === undefined) return <span className="text-xs text-muted-foreground">未同步</span>
    if (available > 0) {
      return (
        <Button
          variant="secondary"
          size="sm"
          className="h-6 gap-1 px-2 text-[10px]"
          title="用系统默认阅读器打开本地 PDF"
          onClick={(e) => {
            e.stopPropagation()
            void openLocalPdf(note)
          }}
        >
          <FileText className="h-3 w-3" /> PDF
        </Button>
      )
    }
    return <span className="text-xs text-muted-foreground">{lit.zoteroPdfCount ? '文件不在本机' : '无本地 PDF'}</span>
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 md:max-w-xs">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索标题 / 作者 / 期刊 / 分类 / 标签"
            className="pl-7"
          />
        </div>
        <span className="text-xs text-muted-foreground">{rows.length} / {literature.length} 篇文献</span>
        <div className="ml-auto flex items-center gap-2">
          <Select value={styleId} onValueChange={(v) => setStyleId(v as CitationStyleId)}>
            <SelectTrigger className="h-8 w-[130px] text-xs" aria-label="引用样式">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.values(CITATION_STYLES).map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            title="把当前筛出的文献按所选样式排成文献表，复制为 RTF 富文本 + 纯文本"
            onClick={() => void writeBibliographyClipboard(rows.map(litToCSL), styleId)}
          >
            <ClipboardCopy className="mr-1 h-3.5 w-3.5" /> 复制参考文献表
          </Button>
          <Button variant="outline" size="sm" onClick={() => setDoiOpen(true)}>
            <Import className="mr-1 h-3.5 w-3.5" /> 按 DOI / arXiv 导入
          </Button>
          <Button variant="outline" size="sm" onClick={() => setBibOpen(true)}>
            <Import className="mr-1 h-3.5 w-3.5" /> 导入 BibTeX / RIS
          </Button>
          <Button variant="outline" size="sm" title="读取本机 Zotero 数据库，为文献笔记同步分类并自动打标签" onClick={() => setZoteroOpen(true)}>
            <BookOpen className="mr-1 h-3.5 w-3.5" /> 同步 Zotero 分类
          </Button>
        </div>
      </div>

      {/* 筛选行：分类 / 期刊 / 年份范围 / 有本地 PDF / 真未分类 */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <SlidersHorizontal className="h-3.5 w-3.5" />
        <Select value={fCollection} onValueChange={setFCollection}>
          <SelectTrigger className="h-7 w-[170px] text-xs" aria-label="按分类筛选">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部分类</SelectItem>
            <SelectItem value="__none__">未分类（{collectionOptions.none}）</SelectItem>
            {collectionOptions.options.map(([name, count]) => (
              <SelectItem key={name} value={name}>{name}（{count}）</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={fVenue} onValueChange={setFVenue}>
          <SelectTrigger className="h-7 w-[190px] text-xs" aria-label="按期刊筛选">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部期刊/会议</SelectItem>
            {venueOptions.map(([name, count]) => (
              <SelectItem key={name} value={name}>{name}（{count}）</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1">
          <Input
            value={fYearFrom}
            onChange={(e) => setFYearFrom(e.target.value.replace(/[^\d]/g, '').slice(0, 4))}
            placeholder="年（起）"
            className="h-7 w-20 text-xs"
            aria-label="起始年份"
          />
          <span>–</span>
          <Input
            value={fYearTo}
            onChange={(e) => setFYearTo(e.target.value.replace(/[^\d]/g, '').slice(0, 4))}
            placeholder="年（止）"
            className="h-7 w-20 text-xs"
            aria-label="结束年份"
          />
        </div>
        <Button
          variant={onlyWithPdf ? 'default' : 'outline'}
          size="sm"
          className="h-7 text-xs"
          title="只显示本机 Zotero 里有可访问 PDF 的文献"
          onClick={() => setOnlyWithPdf((v) => !v)}
        >
          有本地 PDF
        </Button>
        <Button
          variant={showTags ? 'default' : 'outline'}
          size="sm"
          className="h-7 text-xs"
          title="显示 / 隐藏「标签」列（默认隐藏，保证标题与 PDF 列始终可见）"
          onClick={() => setShowTags((v) => !v)}
        >
          标签列
        </Button>
        {filtersActive && (
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={clearFilters}>
            清除筛选
          </Button>
        )}
        <span className="ml-auto hidden md:inline">单击标题打开笔记；点 PDF 徽标打开本地文件</span>
      </div>

      {/* 文献表 */}
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="cursor-pointer" onClick={() => toggleSort('title')}>标题{sortMark('title')}</TableHead>
              <TableHead>分类（Zotero）</TableHead>
              <TableHead className="cursor-pointer" onClick={() => toggleSort('year')}>年份{sortMark('year')}</TableHead>
              <TableHead className="cursor-pointer" onClick={() => toggleSort('venue')}>期刊/会议{sortMark('venue')}</TableHead>
              <TableHead className="w-20">PDF</TableHead>
              {showTags && <TableHead className="min-w-64">标签</TableHead>}
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.slice(0, visibleCount).map((n) => (
              <TableRow
                key={n.id}
                className="cursor-pointer"
                title={cleanLiteratureTitle(n.title)}
                onClick={() => onOpenNote(n.id)}
              >
                <TableCell className="max-w-80 min-w-56 truncate font-medium">{cleanLiteratureTitle(n.title)}</TableCell>
                <TableCell className="max-w-48 truncate text-xs" title={collectionLabel(n)}>
                  {realCollections(n).length ? collectionLabel(n) : <span className="text-muted-foreground">未分类</span>}
                </TableCell>
                <TableCell className="w-14">{n.literature?.year ?? ''}</TableCell>
                <TableCell className="max-w-40 truncate">{n.literature?.venue ?? ''}</TableCell>
                <TableCell>{pdfCell(n)}</TableCell>
                {showTags && (
                  <TableCell>
                    <div className="flex flex-nowrap items-center gap-1">
                      {n.tags.slice(0, 4).map((t) => (
                        <Badge key={t} variant="secondary" className="shrink-0 text-[10px]">#{t}</Badge>
                      ))}
                      {n.tags.length > 4 && (
                        <span className="shrink-0 text-[10px] text-muted-foreground">+{n.tags.length - 4}</span>
                      )}
                    </div>
                  </TableCell>
                )}
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="操作">
                        <MoreVertical className="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {(n.literature?.zoteroAvailablePdfCount ?? 0) > 0 && (
                        <>
                          <DropdownMenuItem onSelect={() => void openLocalPdf(n)}>打开本地 PDF</DropdownMenuItem>
                          <DropdownMenuSeparator />
                        </>
                      )}
                      <DropdownMenuItem onSelect={() => void writeCitationClipboard([litToCSL(n)], styleId)}>
                        Word 引用（{CITATION_STYLES[styleId].label}）
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void copyCitationFor(n, 'gb')}>复制引用 GB/T 7714</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void copyCitationFor(n, 'apa')}>复制引用 APA</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void copyCitationFor(n, 'bibtex')}>复制 BibTeX</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
            {rows.length > visibleCount && (
              <TableRow>
                <TableCell colSpan={showTags ? 7 : 6} className="py-3 text-center">
                  <Button variant="outline" size="sm" onClick={() => setVisibleCount((v) => v + PAGE_SIZE)}>
                    显示更多（还有 {rows.length - visibleCount} 篇）
                  </Button>
                </TableCell>
              </TableRow>
            )}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={showTags ? 7 : 6} className="py-12 text-center text-muted-foreground">
                  <BookOpen className="mx-auto mb-2 h-6 w-6" />
                  {literature.length === 0 ? '还没有文献笔记：用右上方按钮按 DOI / BibTeX 导入' : '没有匹配的文献'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <DoiImportDialog open={doiOpen} onClose={() => setDoiOpen(false)} onImport={onImport} />
      <BibImportDialog open={bibOpen} onClose={() => setBibOpen(false)} onImport={onImport} />
      <ZoteroSyncDialog
        open={zoteroOpen}
        notes={notes}
        dbPath={zoteroDb}
        onDbPathChange={setZoteroDb}
        onClose={() => setZoteroOpen(false)}
        onApply={(updates) => {
          onApplySync(updates)
          setZoteroOpen(false)
        }}
      />
    </div>
  )
}

/** DOI / arXiv 导入弹窗：按输入形态自动判断走哪个源 */
function DoiImportDialog({
  open,
  onClose,
  onImport,
}: {
  open: boolean
  onClose: () => void
  onImport: (items: ImportedLit[]) => void
}) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async () => {
    const id = value.trim()
    if (!id || busy) return
    setBusy(true)
    try {
      const { importFromArxiv, importFromDoi } = await import('@/lib/literature')
      const looksArxiv = /^\d{4}\.\d{4,5}$/.test(id.replace(/^https?:\/\/arxiv\.org\/(abs\/)?/i, '').replace(/\.pdf$/i, ''))
      const lit = looksArxiv ? await importFromArxiv(id) : await importFromDoi(id)
      onImport([lit])
      setValue('')
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '导入失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>按 DOI / arXiv 导入</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>输入 DOI（如 10.1038/s41586-020-2649-2）或 arXiv 编号（如 2401.12345），自动抓取元数据并创建文献笔记。</p>
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void run()}
            placeholder="10.xxxx/xxxx 或 2401.12345"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={() => void run()} disabled={busy || !value.trim()}>{busy ? '导入中…' : '导入'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** BibTeX / RIS 粘贴导入弹窗：支持多条，逐条创建 */
function BibImportDialog({
  open,
  onClose,
  onImport,
}: {
  open: boolean
  onClose: () => void
  onImport: (items: ImportedLit[]) => void
}) {
  const [text, setText] = useState('')

  const run = async () => {
    try {
      const { parseCitationText } = await import('@/lib/literature')
      const items = parseCitationText(text)
      if (!items.length) {
        toast.error('没有解析到文献条目，请检查 BibTeX / RIS 文本')
        return
      }
      onImport(items)
      setText('')
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '导入失败')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>导入 BibTeX / RIS</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>粘贴 BibTeX 或 RIS 文本，支持多条，逐条创建文献笔记（重复 citekey 自动追加后缀）。</p>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'@article{zhang2024silicon,\n  title={...},\n  author={...},\n  year={2024}\n}'}
            className="min-h-48 font-mono text-xs"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={() => void run()} disabled={!text.trim()}>导入</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Zotero 分类同步弹窗：选库 → 读取 → 预览计划 → 确认应用 */
function ZoteroSyncDialog({
  open,
  notes,
  dbPath,
  onDbPathChange,
  onClose,
  onApply,
}: {
  open: boolean
  notes: Note[]
  dbPath: string
  onDbPathChange: (value: string) => void
  onClose: () => void
  onApply: (updates: ZoteroSyncUpdate[]) => void
}) {
  const [busy, setBusy] = useState(false)
  const [plan, setPlan] = useState<ZoteroSyncPlan | null>(null)

  const desktop = typeof window !== 'undefined' ? window.knowledgeGraphDesktop : undefined
  /** 本地网页端：库路径由服务端启动参数固定，页面改不了 */
  const fixedByServer = Boolean(desktop?.isLocalWeb)

  const run = async () => {
    if (!desktop || busy) return
    setBusy(true)
    setPlan(null)
    try {
      const data = await desktop.readZotero(dbPath.trim())
      setPlan(planZoteroSync(data.items, notes))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '读取 Zotero 失败')
    } finally {
      setBusy(false)
    }
  }

  const close = () => {
    setPlan(null)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>同步 Zotero 分类</DialogTitle>
        </DialogHeader>
        {!desktop ? (
          <p className="text-sm text-muted-foreground">仅桌面版可用：请在 Electron 应用内使用。</p>
        ) : !plan ? (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>只读打开本机 Zotero 数据库，按 Zotero key / DOI / 标题匹配文献笔记，同步 Zotero 分类（与已有分类取并集，历史占位「未分类」会被清掉，没有真实分类时界面动态显示「未分类」）并自动补充「方向:」「期刊:」「年份:」标签，同时刷新 Zotero key 与 PDF 状态。<strong className="text-foreground">请先把 Zotero 完全退出</strong>，否则会因数据库锁定而失败。</p>
            {fixedByServer ? (
              <p className="rounded border bg-muted/40 p-2 font-mono text-xs break-all">{dbPath || '（未配置）'}</p>
            ) : (
              <Input
                value={dbPath}
                onChange={(e) => onDbPathChange(e.target.value)}
                placeholder="zotero.sqlite 的完整路径"
                className="font-mono text-xs"
              />
            )}
          </div>
        ) : (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>匹配到 {plan.matchedCount} 篇文献笔记；其中 {plan.updates.length} 篇需要更新分类或标签。</p>
            <p>Zotero 中有 {plan.unmatchedZotero.length} 条带题名的条目在本库没有对应笔记（忽略即可，不会创建）。</p>
            {plan.updates.length > 0 && (
              <ul className="max-h-40 space-y-1 overflow-auto rounded border p-2 text-xs">
                {plan.updates.slice(0, 50).map((u) => {
                  const note = notes.find((n) => n.id === u.noteId)
                  return (
                    <li key={u.noteId}>
                      <span className="font-medium text-foreground">{note?.title ?? u.noteId}</span>
                      {u.collections.length > 0 && <span>{' · 分类 → '}{u.collections.join('；')}</span>}
                      {u.tagsToAdd.length > 0 && <span>{' · +标签 '}{u.tagsToAdd.map((t) => `#${t}`).join(' ')}</span>}
                      {u.tagsToRemove.length > 0 && <span>{' · −标签 '}{u.tagsToRemove.map((t) => `#${t}`).join(' ')}</span>}
                    </li>
                  )
                })}
                {plan.updates.length > 50 && <li>…… 共 {plan.updates.length} 条，其余从略</li>}
              </ul>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={close}>取消</Button>
          {!plan ? (
            <Button onClick={() => void run()} disabled={busy || !dbPath.trim()}>
              {busy ? '读取中…' : '读取并预览'}
            </Button>
          ) : (
            <Button onClick={() => onApply(plan.updates)} disabled={plan.updates.length === 0}>
              应用 {plan.updates.length} 条更新
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
