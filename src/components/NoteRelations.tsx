import { useEffect, useMemo, useState } from 'react'
import type { Note } from '@/types/note'
import { Button } from '@/components/ui/button'
import { Link2, ListTree, Unlink, X } from 'lucide-react'
import { backlinksOf, brokenLinksOf, outlineOf, type Backlink } from '@/lib/noteRelations'

interface Props {
  open: boolean
  note: Note
  allNotes: Note[]
  onClose: () => void
  onOpenNote: (id: string) => void
  /** 跳到大纲第 index 个标题（由编辑器决定走预览 / 所见即所得 / 源码哪条路） */
  onJumpHeading: (index: number) => void
}

/**
 * 「关系」抽屉：反向链接 + 本文大纲 + 缺失链接。
 *
 * 反链是**打开时算一次**（扫全库 2000 篇正文），不跟着每次按键重算 —— 抽屉开着编辑时
 * 每敲一个字重扫 8MB 会明显卡。切笔记 / 重新打开会重算；大纲跟着正文实时变。
 */
export function NoteRelations({ open, note, allNotes, onClose, onOpenNote, onJumpHeading }: Props) {
  const [backlinks, setBacklinks] = useState<Backlink[]>([])
  const outline = useMemo(() => outlineOf(note.content), [note.content])
  const broken = useMemo(() => brokenLinksOf(note, allNotes), [note, allNotes])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    // 让出一帧再扫，打开抽屉不卡住点击动画
    const timer = window.setTimeout(() => {
      if (!cancelled) setBacklinks(backlinksOf(allNotes, note))
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
    // 只用 id / 标题定位目标；正文和 allNotes 每次编辑都变，故意不作依赖（见上方注释）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, note.id, note.title])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <aside
      className="fixed inset-y-0 right-0 z-40 flex w-[min(86vw,340px)] flex-col border-l bg-background shadow-2xl"
      role="dialog"
      aria-label="关系与大纲"
    >
      <div className="flex items-start gap-2 border-b p-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">关系与大纲</div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground" title={note.title}>
            {note.title || '未命名笔记'}
          </div>
        </div>
        <Button autoFocus variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onClose} title="关闭（Esc）">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        <section>
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Link2 className="h-3.5 w-3.5" />
            反向链接
            <span className="text-muted-foreground/60">({backlinks.length})</span>
          </div>
          {backlinks.length === 0 ? (
            <p className="rounded-md border border-dashed px-2 py-3 text-xs text-muted-foreground">
              还没有别的笔记用 {'[[' + (note.title || '标题') + ']]'} 链接到这里。
            </p>
          ) : (
            <ul className="space-y-1">
              {backlinks.map((entry) => (
                <li key={entry.note.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onOpenNote(entry.note.id)
                      onClose()
                    }}
                    className="block w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
                  >
                    <div className="truncate text-sm">{entry.note.title || '未命名笔记'}</div>
                    <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                      {entry.snippet}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <ListTree className="h-3.5 w-3.5" />
            本文大纲
            <span className="text-muted-foreground/60">({outline.length})</span>
          </div>
          {outline.length === 0 ? (
            <p className="rounded-md border border-dashed px-2 py-3 text-xs text-muted-foreground">
              正文还没有 `#` 标题。写几个小节标题，这里就能一键跳转。
            </p>
          ) : (
            <ul className="space-y-0.5">
              {outline.map((entry, index) => (
                <li key={`${entry.index}-${entry.text}`}>
                  <button
                    type="button"
                    onClick={() => onJumpHeading(index)}
                    className="block w-full truncate rounded-md px-2 py-1 text-left text-xs text-foreground/90 transition-colors hover:bg-accent"
                    style={{ paddingLeft: `${8 + (entry.level - 1) * 12}px` }}
                    title={entry.text}
                  >
                    {entry.text}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {broken.length > 0 && (
          <section>
            <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Unlink className="h-3.5 w-3.5" />
              缺失链接
              <span className="text-muted-foreground/60">({broken.length})</span>
            </div>
            <ul className="space-y-0.5">
              {broken.map((title) => (
                <li key={title} className="truncate rounded-md bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
                  {title}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </aside>
  )
}
