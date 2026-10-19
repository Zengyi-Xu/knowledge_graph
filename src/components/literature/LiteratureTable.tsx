/**
 * 文献表（纯展示）：表头排序、150 行 + 「显示更多」、PDF 徽标（按钮，单击即读，无延迟）、行内操作菜单。
 * 「标签」列默认隐藏（由调用方传入 showTags），保证标题与 PDF 列始终可见。
 */
import { useEffect, useRef } from 'react'
import { BookOpen, FileText, MoreVertical } from 'lucide-react'
import type { Note } from '@/types/note'
import { useIsMobile } from '@/hooks/use-mobile'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { CITATION_STYLES, cleanLiteratureTitle, litToCSL, type CitationStyleId } from '@/lib/literature'
import { copyCitationFor } from '@/lib/copyCitation'
import { writeCitationClipboard } from '@/lib/rtfField'
import { collectionLabel, realCollections } from './collectionTree'
import { hasReadablePdf, pdfCellView } from './pdfCell'
import type { PageSlice, SortKey } from './literatureQuery'

export interface LiteratureRowActions {
  onOpenNote: (id: string) => void
  onReadPdf: (id: string) => void
  /** 用系统阅读器打开（localPdf → Zotero 库里的 PDF，多 key 回退） */
  onOpenLocalPdf: (note: Note) => void
  /** 在 Zotero 里定位该条目 */
  onOpenInZotero: (note: Note) => void
  styleId: CitationStyleId
}

export interface LiteratureTableProps {
  page: PageSlice
  /** 库里的文献总数（0 篇时的空状态文案不同） */
  literatureCount: number
  showTags: boolean
  /** 图谱 / 侧栏当前选中的那篇：表格（或手机卡片）里高亮它，回来时一眼能认出来 */
  selectedId?: string | null
  onShowMore: () => void
  onSort: (key: SortKey) => void
  sortMark: (key: SortKey) => string
  actions: LiteratureRowActions
}

/** PDF 状态列：有可读 PDF 时徽标本身就是按钮（单击直接进全屏阅读） */
export function PdfCell({ note, onReadPdf, onOpenInZotero }: { note: Note; onReadPdf: (id: string) => void; onOpenInZotero: (note: Note) => void }) {
  const view = pdfCellView(note)
  if (view.kind === 'read') {
    return (
      <Button
        variant="secondary"
        size="sm"
        className="h-6 gap-1 px-2 text-[10px]"
        title={view.matched ? '在本机 PDF 目录里按标题匹配到这份文件（还没记进笔记）；点击在软件内阅读' : '在软件内全屏阅读 PDF'}
        onClick={(e) => {
          e.stopPropagation()
          onReadPdf(note.id)
        }}
      >
        <FileText className="h-3 w-3" /> PDF
      </Button>
    )
  }
  if (view.kind === 'unsynced') return <span className="text-xs text-muted-foreground">未同步</span>
  if (view.kind === 'missing') {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-1 text-[10px] text-muted-foreground"
        title="本机没有这份 PDF：在 Zotero 里打开该条目即可下载/打开它"
        onClick={(e) => {
          e.stopPropagation()
          onOpenInZotero(note)
        }}
      >
        文件不在本机 · 在 Zotero 打开
      </Button>
    )
  }
  return <span className="text-xs text-muted-foreground">{view.text}</span>
}

/**
 * 行内操作菜单（表格行与手机卡片共用同一份实现，功能不减）。
 * `touchTarget` 为真时菜单项按 ≥44px 渲染（手机）；桌面保持原本高度。
 */
function RowActionsMenu({
  note,
  onReadPdf,
  onOpenLocalPdf,
  onOpenInZotero,
  styleId,
  touchTarget,
}: {
  note: Note
  onReadPdf: (id: string) => void
  onOpenLocalPdf: (note: Note) => void
  onOpenInZotero: (note: Note) => void
  styleId: CitationStyleId
  touchTarget: boolean
}) {
  const item = touchTarget ? 'min-h-11' : undefined
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={touchTarget ? 'h-11 w-11' : 'h-8 w-8'}
          title="操作"
          aria-label={`操作：${cleanLiteratureTitle(note.title)}`}
        >
          <MoreVertical className={touchTarget ? 'h-4 w-4' : 'h-3.5 w-3.5'} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {hasReadablePdf(note) && (
          <>
            <DropdownMenuItem className={item} onSelect={() => onReadPdf(note.id)}>在软件内全屏阅读</DropdownMenuItem>
            <DropdownMenuItem className={item} onSelect={() => onOpenLocalPdf(note)}>用系统阅读器打开</DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem className={item} onSelect={() => onOpenInZotero(note)}>在 Zotero 中打开</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className={item} onSelect={() => void writeCitationClipboard([litToCSL(note)], styleId)}>
          Word 引用（{CITATION_STYLES[styleId].label}）
        </DropdownMenuItem>
        <DropdownMenuItem className={item} onSelect={() => void copyCitationFor(note, 'gb')}>复制引用 GB/T 7714</DropdownMenuItem>
        <DropdownMenuItem className={item} onSelect={() => void copyCitationFor(note, 'apa')}>复制引用 APA</DropdownMenuItem>
        <DropdownMenuItem className={item} onSelect={() => void copyCitationFor(note, 'bibtex')}>复制 BibTeX</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * 手机端（<768px）的文献卡片列表：一张卡片 = 一篇文献。
 * 与表格同一份数据切片（150 行 + 显示更多），可点击区域按 ≥44px 处理。
 */
function LiteratureCardList({
  page,
  literatureCount,
  selectedId,
  onShowMore,
  actions,
}: {
  page: PageSlice
  literatureCount: number
  selectedId?: string | null
  onShowMore: () => void
  actions: LiteratureRowActions
}) {
  const { onOpenNote, onReadPdf, onOpenLocalPdf, onOpenInZotero, styleId } = actions
  if (page.total === 0) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        <BookOpen className="mx-auto mb-2 h-6 w-6" />
        {literatureCount === 0 ? '还没有文献笔记：用上方的按钮按 DOI / BibTeX 导入' : '没有匹配的文献'}
      </div>
    )
  }
  return (
    <ul className="divide-y" data-testid="literature-cards">
      {page.rows.map((n) => (
        <li key={n.id} className={`p-3 ${n.id === selectedId ? 'bg-accent/60' : ''}`} data-lit-selected={n.id === selectedId ? '1' : undefined}>
          <div className="flex items-start gap-2">
            <button
              type="button"
              className="min-w-0 flex-1 text-left"
              onClick={() => onOpenNote(n.id)}
              title={cleanLiteratureTitle(n.title)}
            >
              <span className="line-clamp-2 text-sm font-medium">{cleanLiteratureTitle(n.title)}</span>
              <span className="mt-1 block truncate text-xs text-muted-foreground">
                {[n.literature?.year, n.literature?.venue, realCollections(n).length ? collectionLabel(n) : '未分类']
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </button>
            <RowActionsMenu
              note={n}
              onReadPdf={onReadPdf}
              onOpenLocalPdf={onOpenLocalPdf}
              onOpenInZotero={onOpenInZotero}
              styleId={styleId}
              touchTarget
            />
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <PdfCell note={n} onReadPdf={onReadPdf} onOpenInZotero={onOpenInZotero} />
          </div>
        </li>
      ))}
      {page.hasMore && (
        <li className="p-3 text-center">
          <Button variant="outline" className="h-11 w-full" onClick={onShowMore}>
            显示更多（还有 {page.remaining} 篇）
          </Button>
        </li>
      )}
    </ul>
  )
}

export function LiteratureTable({ page, literatureCount, showTags, selectedId, onShowMore, onSort, sortMark, actions }: LiteratureTableProps) {
  const { onOpenNote, onReadPdf, onOpenLocalPdf, onOpenInZotero, styleId } = actions
  const isMobile = useIsMobile()
  const listRef = useRef<HTMLDivElement | null>(null)
  // 从图谱/侧栏带着选中项进来时，高亮的那一行要在视野里（150 行里翻半天等于没高亮）
  useEffect(() => {
    listRef.current?.querySelector('[data-lit-selected="1"]')?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])
  return (
    <div ref={listRef} className="min-h-0 flex-1 overflow-auto rounded-lg border bg-card" data-testid="literature-list">
      {isMobile ? (
        <LiteratureCardList
          page={page}
          literatureCount={literatureCount}
          selectedId={selectedId}
          onShowMore={onShowMore}
          actions={actions}
        />
      ) : (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="cursor-pointer" onClick={() => onSort('title')}>
              标题{sortMark('title')}
            </TableHead>
            <TableHead>分类（Zotero）</TableHead>
            <TableHead className="cursor-pointer" onClick={() => onSort('year')}>
              年份{sortMark('year')}
            </TableHead>
            <TableHead className="cursor-pointer" onClick={() => onSort('venue')}>
              期刊/会议{sortMark('venue')}
            </TableHead>
            <TableHead className="w-20">PDF</TableHead>
            {showTags && <TableHead className="min-w-64">标签</TableHead>}
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {page.rows.map((n) => (
            <TableRow
              key={n.id}
              className={`cursor-pointer ${n.id === selectedId ? 'bg-accent/60' : ''}`}
              data-lit-selected={n.id === selectedId ? '1' : undefined}
              title={cleanLiteratureTitle(n.title)}
              onClick={() => onOpenNote(n.id)}
            >
              <TableCell className="max-w-80 min-w-56 truncate font-medium">{cleanLiteratureTitle(n.title)}</TableCell>
              <TableCell className="max-w-48 truncate text-xs" title={collectionLabel(n)}>
                {realCollections(n).length ? collectionLabel(n) : <span className="text-muted-foreground">未分类</span>}
              </TableCell>
              <TableCell className="w-14">{n.literature?.year ?? ''}</TableCell>
              <TableCell className="max-w-40 truncate">{n.literature?.venue ?? ''}</TableCell>
              <TableCell>
                <PdfCell note={n} onReadPdf={onReadPdf} onOpenInZotero={onOpenInZotero} />
              </TableCell>
              {showTags && (
                <TableCell>
                  <div className="flex flex-nowrap items-center gap-1">
                    {n.tags.slice(0, 4).map((t) => (
                      <Badge key={t} variant="secondary" className="shrink-0 text-[10px]">
                        #{t}
                      </Badge>
                    ))}
                    {n.tags.length > 4 && <span className="shrink-0 text-[10px] text-muted-foreground">+{n.tags.length - 4}</span>}
                  </div>
                </TableCell>
              )}
              <TableCell onClick={(e) => e.stopPropagation()}>
                <RowActionsMenu
                  note={n}
                  onReadPdf={onReadPdf}
                  onOpenLocalPdf={onOpenLocalPdf}
                  onOpenInZotero={onOpenInZotero}
                  styleId={styleId}
                  touchTarget={false}
                />
              </TableCell>
            </TableRow>
          ))}
          {page.hasMore && (
            <TableRow>
              <TableCell colSpan={showTags ? 7 : 6} className="py-3 text-center">
                <Button variant="outline" size="sm" onClick={onShowMore}>
                  显示更多（还有 {page.remaining} 篇）
                </Button>
              </TableCell>
            </TableRow>
          )}
          {page.total === 0 && (
            <TableRow>
              <TableCell colSpan={showTags ? 7 : 6} className="py-12 text-center text-muted-foreground">
                <BookOpen className="mx-auto mb-2 h-6 w-6" />
                {literatureCount === 0 ? '还没有文献笔记：用右上方按钮按 DOI / BibTeX 导入' : '没有匹配的文献'}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      )}
    </div>
  )
}
