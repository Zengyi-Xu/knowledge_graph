import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useIsMobile } from '@/hooks/use-mobile'
import { RECENT_PREVIEW_COUNT, resolveRecent } from '@/lib/recentNotes'
import type { Note } from '@/types/note'
import { ChevronDown, ChevronUp, History } from 'lucide-react'

interface Props {
  notes: Note[]
  /** 本地记录的打开顺序（新→旧），含可能已删除的 id */
  entries: { id: string; at: number }[]
  onOpen: (id: string) => void
}

function formatTime(at: number): string {
  const d = new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 顶栏「最近笔记」：按打开顺序列出最近 7 篇，底部「显示全部」展开完整列表
 * （本地最多保留 500 条记录，滚动查看）。被删除的笔记自动跳过。
 */
export function RecentNotesMenu({ notes, entries, onOpen }: Props) {
  const isMobile = useIsMobile()
  const [expanded, setExpanded] = useState(false)
  const recent = resolveRecent(entries, notes)
  const preview = expanded ? recent : recent.slice(0, RECENT_PREVIEW_COUNT)
  const hasMore = recent.length > RECENT_PREVIEW_COUNT

  const item = (note: Note, at: number) => (
    <DropdownMenuItem
      key={note.id}
      className={isMobile ? 'min-h-11' : undefined}
      onSelect={() => onOpen(note.id)}
    >
      <span className="min-w-0 flex-1 truncate">{note.title || '未命名'}</span>
      <span className="ml-3 shrink-0 text-[11px] text-muted-foreground">{formatTime(at)}</span>
    </DropdownMenuItem>
  )

  return (
    <DropdownMenu onOpenChange={(open) => !open && setExpanded(false)}>
      <DropdownMenuTrigger asChild>
        {isMobile ? (
          <Button variant="outline" size="icon" className="h-11 w-11" title="最近笔记" aria-label="最近笔记">
            <History className="h-4 w-4" />
          </Button>
        ) : (
          <Button variant="outline" size="sm" title="按打开顺序查看最近笔记">
            <History className="h-3.5 w-3.5 xl:mr-1" /> <span className="hidden xl:inline">最近笔记</span>
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={`w-64 ${hasMore && expanded ? 'max-h-96 overflow-y-auto' : ''}`}>
        <DropdownMenuLabel>最近笔记{recent.length > 0 ? `（${recent.length}）` : ''}</DropdownMenuLabel>
        {recent.length === 0 ? (
          <DropdownMenuItem disabled>暂无最近笔记</DropdownMenuItem>
        ) : (
          <>
            {preview.map(({ note, at }) => item(note, at))}
            {hasMore && !expanded && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem className={isMobile ? 'min-h-11' : undefined} onSelect={(e) => { e.preventDefault(); setExpanded(true) }}>
                  <ChevronDown className="mr-2 h-4 w-4" /> 显示全部 {recent.length} 篇
                </DropdownMenuItem>
              </>
            )}
            {hasMore && expanded && (
              <DropdownMenuItem className={isMobile ? 'min-h-11' : undefined} onSelect={(e) => { e.preventDefault(); setExpanded(false) }}>
                <ChevronUp className="mr-2 h-4 w-4" /> 只显示最近 {RECENT_PREVIEW_COUNT} 篇
              </DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
