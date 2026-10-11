/**
 * 文献库视图：全部 literature 笔记的表格（排序 / 搜索）、DOI/arXiv 与 BibTeX/RIS 导入、复制引用。
 * 纯网络 + 剪贴板能力，浏览器版与桌面版均可用。
 */
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { BookOpen, ClipboardCopy, Import, Search } from 'lucide-react'
import type { Note } from '@/types/note'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
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
import { copyCitationFor } from '@/lib/copyCitation'

interface Props {
  notes: Note[]
  onOpenNote: (id: string) => void
  /** 批量创建文献笔记（citekey 撞名由调用方处理） */
  onImport: (items: ImportedLit[]) => void
}

type SortKey = 'title' | 'author' | 'year' | 'venue' | 'citekey'

/** 第一作者显示：单个全名；多个加 et al. */
function firstAuthorLabel(note: Note): string {
  const authors = note.literature?.authors ?? []
  if (!authors.length) return ''
  return authors.length > 1 ? `${authors[0]} et al.` : authors[0]
}

export function LiteratureView({ notes, onOpenNote, onImport }: Props) {
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('year')
  const [sortAsc, setSortAsc] = useState(false)
  const [doiOpen, setDoiOpen] = useState(false)
  const [bibOpen, setBibOpen] = useState(false)

  const literature = useMemo(() => notes.filter((n) => n.type === 'literature'), [notes])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = q
      ? literature.filter((n) => {
          const hay = [n.title, n.literature?.venue ?? '', ...(n.literature?.authors ?? [])].join('\n').toLowerCase()
          return hay.includes(q)
        })
      : literature
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
  }, [literature, search, sortKey, sortAsc])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc((v) => !v)
    else {
      setSortKey(key)
      setSortAsc(true)
    }
  }

  const sortMark = (key: SortKey) => (sortKey === key ? (sortAsc ? ' ↑' : ' ↓') : '')

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 md:max-w-xs">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索标题 / 作者 / 期刊"
            className="pl-7"
          />
        </div>
        <span className="text-xs text-muted-foreground">{rows.length} / {literature.length} 篇文献</span>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setDoiOpen(true)}>
            <Import className="mr-1 h-3.5 w-3.5" /> 按 DOI / arXiv 导入
          </Button>
          <Button variant="outline" size="sm" onClick={() => setBibOpen(true)}>
            <Import className="mr-1 h-3.5 w-3.5" /> 导入 BibTeX / RIS
          </Button>
        </div>
      </div>

      {/* 文献表 */}
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="cursor-pointer" onClick={() => toggleSort('title')}>标题{sortMark('title')}</TableHead>
              <TableHead className="cursor-pointer" onClick={() => toggleSort('author')}>第一作者{sortMark('author')}</TableHead>
              <TableHead className="cursor-pointer" onClick={() => toggleSort('year')}>年份{sortMark('year')}</TableHead>
              <TableHead className="cursor-pointer" onClick={() => toggleSort('venue')}>期刊/会议{sortMark('venue')}</TableHead>
              <TableHead className="cursor-pointer" onClick={() => toggleSort('citekey')}>citekey{sortMark('citekey')}</TableHead>
              <TableHead>标签</TableHead>
              <TableHead className="w-24">引用</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((n) => (
              <TableRow key={n.id} className="cursor-pointer" onClick={() => onOpenNote(n.id)}>
                <TableCell className="max-w-64 truncate font-medium">{n.title}</TableCell>
                <TableCell className="max-w-40 truncate">{firstAuthorLabel(n)}</TableCell>
                <TableCell className="w-16">{n.literature?.year ?? ''}</TableCell>
                <TableCell className="max-w-48 truncate">{n.literature?.venue ?? ''}</TableCell>
                <TableCell>
                  <code className="text-xs text-muted-foreground">{n.literature?.citekey ?? ''}</code>
                </TableCell>
                <TableCell className="max-w-40">
                  <div className="flex flex-wrap gap-1">
                    {n.tags.slice(0, 3).map((t) => (
                      <Badge key={t} variant="secondary" className="text-[10px]">#{t}</Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="复制引用">
                        <ClipboardCopy className="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => void copyCitationFor(n, 'gb')}>GB/T 7714</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void copyCitationFor(n, 'apa')}>APA</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void copyCitationFor(n, 'bibtex')}>BibTeX</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-12 text-center text-muted-foreground">
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
