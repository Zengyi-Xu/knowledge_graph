/**
 * 引用工作台：一级入口之一，把所有「引用」能力集中到一处——
 * 复制单篇引用（GB/T 7714 / APA / BibTeX）、复制引用键、把筛选结果按所选样式
 * 排成参考文献表（RTF 富文本 + 纯文本，粘贴进 Word 保留域代码）。
 * 纯网络 + 剪贴板能力，浏览器版与桌面版均可用；与文献视图共用同一套引文库。
 */
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { BookOpen, ClipboardCopy, MoreVertical, Quote, Search } from 'lucide-react'
import type { Note } from '@/types/note'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { CITATION_STYLES, cleanLiteratureTitle, litToCSL, type CitationStyleId } from '@/lib/literature'
import { copyCitationFor } from '@/lib/copyCitation'
import { writeBibliographyClipboard, writeCitationClipboard } from '@/lib/rtfField'

const PAGE_SIZE = 150

interface Props {
  notes: Note[]
  onOpenNote: (id: string) => void
  /** 空库时引导去文献入口 */
  onGoLiterature: () => void
}

export function CitationsView({ notes, onOpenNote, onGoLiterature }: Props) {
  const [search, setSearch] = useState('')
  const [styleId, setStyleId] = useState<CitationStyleId>('gb')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  const literature = useMemo(
    () =>
      notes
        .filter((n) => n.literature)
        .sort((a, b) => Number(b.literature!.year || 0) - Number(a.literature!.year || 0)),
    [notes],
  )

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return literature
    return literature.filter((n) => {
      const lit = n.literature!
      const hay = [
        lit.citekey,
        n.title,
        lit.authors.join(' '),
        lit.venue,
        lit.collections?.join(' ') ?? '',
        n.tags.join(' '),
      ]
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [literature, search])

  const copyCitekey = async (n: Note) => {
    const key = n.literature?.citekey
    if (!key) {
      toast.info('这篇文献还没有引用键')
      return
    }
    await navigator.clipboard.writeText(key)
    toast.success(`已复制引用键 ${key}`)
  }

  const authorLine = (n: Note) => {
    const lit = n.literature!
    const names = lit.authors.slice(0, 3).map((a) => a.trim().split(/\s+/).pop() ?? a)
    if (lit.authors.length > 3) names.push('等')
    return `${names.join('，')}${lit.year ? ` · ${lit.year}` : ''}`
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div className="flex items-center gap-3 rounded-lg border bg-card p-3 text-sm">
        <Quote className="h-4 w-4 shrink-0 text-primary" />
        <p className="min-w-0 text-muted-foreground">
          复制单篇引用粘贴到论文或笔记；「复制参考文献表」按所选样式把当前筛选结果排成文献表（富文本 + 纯文本），在 Word 里粘贴即可生成域代码。
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 md:max-w-xs">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索引用键 / 标题 / 作者 / 期刊"
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
            title="把当前筛选出的文献按所选样式排成文献表，复制为 RTF 富文本 + 纯文本"
            onClick={() => void writeBibliographyClipboard(rows.map(litToCSL), styleId)}
          >
            <ClipboardCopy className="mr-1 h-3.5 w-3.5" /> 复制参考文献表
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-40">引用键</TableHead>
              <TableHead>文献</TableHead>
              <TableHead className="w-56">作者 · 年份</TableHead>
              <TableHead className="w-14"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.slice(0, visibleCount).map((n) => (
              <TableRow key={n.id} className="cursor-pointer" onClick={() => onOpenNote(n.id)}>
                <TableCell>
                  <button
                    type="button"
                    className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs hover:bg-accent"
                    title="复制引用键"
                    onClick={(e) => {
                      e.stopPropagation()
                      void copyCitekey(n)
                    }}
                  >
                    {n.literature?.citekey ?? '（无引用键）'}
                  </button>
                </TableCell>
                <TableCell className="min-w-0 max-w-0 truncate font-medium" title={n.title}>
                  {cleanLiteratureTitle(n.title)}
                </TableCell>
                <TableCell className="truncate text-xs text-muted-foreground">{authorLine(n)}</TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="复制引用">
                        <MoreVertical className="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => void writeCitationClipboard([litToCSL(n)], styleId)}>
                        Word 引用（{CITATION_STYLES[styleId].label}）
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void copyCitationFor(n, 'gb')}>复制引用 GB/T 7714</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void copyCitationFor(n, 'apa')}>复制引用 APA</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void copyCitationFor(n, 'bibtex')}>复制 BibTeX</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => void copyCitekey(n)}>复制引用键</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
            {rows.length > visibleCount && (
              <TableRow>
                <TableCell colSpan={4} className="py-3 text-center">
                  <Button variant="outline" size="sm" onClick={() => setVisibleCount((v) => v + PAGE_SIZE)}>
                    显示更多（还有 {rows.length - visibleCount} 篇）
                  </Button>
                </TableCell>
              </TableRow>
            )}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-12 text-center text-muted-foreground">
                  <BookOpen className="mx-auto mb-2 h-6 w-6" />
                  {literature.length === 0 ? (
                    <>
                      还没有文献条目
                      <div className="mt-3">
                        <Button variant="outline" size="sm" onClick={onGoLiterature}>去「文献」导入或连接 Zotero</Button>
                      </div>
                    </>
                  ) : (
                    '没有匹配的文献'
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
